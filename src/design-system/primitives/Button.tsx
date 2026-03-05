import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "../../shared/index.ts";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-accent bg-accent text-accent-contrast shadow-soft hover:border-accent-emphasis hover:bg-accent-emphasis disabled:border-accent/35 disabled:bg-accent/35",
  secondary:
    "border border-border bg-surface text-text hover:border-border-strong hover:bg-elevated disabled:border-border-muted disabled:text-muted",
  ghost:
    "border border-transparent bg-transparent text-muted hover:border-border hover:bg-surface-subtle hover:text-text disabled:text-text-subtle",
  danger:
    "border border-danger bg-danger text-accent-contrast hover:border-danger-emphasis hover:bg-danger-emphasis disabled:border-danger/35 disabled:bg-danger/35",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 font-mono text-[11px] uppercase tracking-[0.08em]",
  md: "h-10 px-4 text-sm",
};

const TOOLTIP_EDGE_PADDING = 8;
const TOOLTIP_GAP = 8;

type TooltipPlacement = "top" | "bottom";

interface TooltipCoords {
  readonly top: number;
  readonly left: number;
}

function calculateTooltipPlacement(
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
): { readonly placement: TooltipPlacement; readonly coords: TooltipCoords } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const canFitAbove = triggerRect.top >= tooltipRect.height + TOOLTIP_GAP + TOOLTIP_EDGE_PADDING;
  const canFitBelow =
    viewportHeight - triggerRect.bottom >= tooltipRect.height + TOOLTIP_GAP + TOOLTIP_EDGE_PADDING;

  let placement: TooltipPlacement;
  if (canFitAbove) {
    placement = "top";
  } else if (canFitBelow) {
    placement = "bottom";
  } else {
    placement = triggerRect.top >= viewportHeight - triggerRect.bottom ? "top" : "bottom";
  }

  let top = placement === "top"
    ? triggerRect.top - tooltipRect.height - TOOLTIP_GAP
    : triggerRect.bottom + TOOLTIP_GAP;
  top = Math.max(TOOLTIP_EDGE_PADDING, Math.min(top, viewportHeight - tooltipRect.height - TOOLTIP_EDGE_PADDING));

  let left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
  left = Math.max(TOOLTIP_EDGE_PADDING, Math.min(left, viewportWidth - tooltipRect.width - TOOLTIP_EDGE_PADDING));

  return {
    placement,
    coords: {
      top,
      left,
    },
  };
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  title,
  ...props
}: ButtonProps) {
  const {
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
    onPointerDown,
    ...restProps
  } = props;
  const resolvedTooltip =
    title
    ?? (typeof props["aria-label"] === "string" ? props["aria-label"] : undefined);
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const [tooltipPlacement, setTooltipPlacement] = useState<TooltipPlacement>("top");
  const [tooltipCoords, setTooltipCoords] = useState<TooltipCoords>({
    top: -9999,
    left: -9999,
  });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);

  const updateTooltipPosition = useCallback(() => {
    if (!isTooltipVisible || !resolvedTooltip || typeof window === "undefined") {
      return;
    }

    const buttonElement = buttonRef.current;
    const tooltipElement = tooltipRef.current;
    if (!buttonElement || !tooltipElement) {
      return;
    }

    const next = calculateTooltipPlacement(
      buttonElement.getBoundingClientRect(),
      tooltipElement.getBoundingClientRect(),
    );

    setTooltipPlacement(next.placement);
    setTooltipCoords((current) => {
      if (
        Math.abs(current.top - next.coords.top) < 0.5
        && Math.abs(current.left - next.coords.left) < 0.5
      ) {
        return current;
      }
      return next.coords;
    });
  }, [isTooltipVisible, resolvedTooltip]);

  useLayoutEffect(() => {
    if (!isTooltipVisible || !resolvedTooltip) {
      return;
    }

    updateTooltipPosition();
  }, [isTooltipVisible, resolvedTooltip, updateTooltipPosition]);

  useEffect(() => {
    if (!isTooltipVisible || !resolvedTooltip) {
      return;
    }

    const handleViewportChange = () => {
      updateTooltipPosition();
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isTooltipVisible, resolvedTooltip, updateTooltipPosition]);

  const handleMouseEnter = (event: MouseEvent<HTMLButtonElement>) => {
    onMouseEnter?.(event);
    if (resolvedTooltip) {
      setIsTooltipVisible(true);
    }
  };

  const handleMouseLeave = (event: MouseEvent<HTMLButtonElement>) => {
    onMouseLeave?.(event);
    setIsTooltipVisible(false);
  };

  const handleFocus = (event: FocusEvent<HTMLButtonElement>) => {
    onFocus?.(event);
    if (resolvedTooltip) {
      setIsTooltipVisible(true);
    }
  };

  const handleBlur = (event: FocusEvent<HTMLButtonElement>) => {
    onBlur?.(event);
    setIsTooltipVisible(false);
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event);
    setIsTooltipVisible(false);
  };

  const tooltipNode = isTooltipVisible && resolvedTooltip && typeof document !== "undefined"
    ? createPortal(
      <span
        ref={tooltipRef}
        role="tooltip"
        className={cn(
          "cm-floating-tooltip",
          tooltipPlacement === "bottom" ? "cm-floating-tooltip--bottom" : "cm-floating-tooltip--top",
        )}
        style={tooltipCoords}
      >
        {resolvedTooltip}
      </span>,
      document.body,
    )
    : null;

  return (
    <>
      <button
        ref={buttonRef}
        type={type}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          "disabled:cursor-not-allowed disabled:opacity-60",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPointerDown={handlePointerDown}
        {...restProps}
      />
      {tooltipNode}
    </>
  );
}
