import { useEffect, type ReactNode } from "react";

import { Button } from "../primitives/Button.tsx";
import { Card, CardBody, CardHeader, CardTitle } from "../primitives/Card.tsx";
import { cn } from "../../shared/index.ts";

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
  readonly panelClassName?: string;
}

export function Modal({ open, onClose, title, children, panelClassName }: ModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <Card
        className={cn("mx-4 w-full max-w-md", panelClassName)}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close modal">
            ✕
          </Button>
        </CardHeader>
        <CardBody>{children}</CardBody>
      </Card>
    </div>
  );
}
