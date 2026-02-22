import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Input } from "../../../design-system/index.ts";
import { cn } from "../../../shared/index.ts";

export type CommandPaletteSection = "diff-sections" | "commits" | "settings";

export interface CommandPaletteItem {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly section?: CommandPaletteSection;
  readonly keywords?: readonly string[];
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly title?: string;
  readonly items: readonly CommandPaletteItem[];
  readonly onRun: (item: CommandPaletteItem) => void | Promise<void>;
  readonly onClose: () => void;
}

const SECTIONS: readonly { readonly id: CommandPaletteSection; readonly label: string }[] = [
  { id: "diff-sections", label: "Diff Sections" },
  { id: "commits", label: "Commits" },
  { id: "settings", label: "Settings" },
];

function resolveSection(item: CommandPaletteItem): CommandPaletteSection {
  return item.section ?? "diff-sections";
}

export function CommandPalette({
  open,
  title = "Command Palette",
  items,
  onRun,
  onClose,
}: CommandPaletteProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeSection, setActiveSection] = useState<CommandPaletteSection>("diff-sections");

  const cycleSection = useCallback((direction: 1 | -1) => {
    setActiveSection((current) => {
      const currentIndex = SECTIONS.findIndex((section) => section.id === current);
      const normalizedIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = (normalizedIndex + direction + SECTIONS.length) % SECTIONS.length;
      return SECTIONS[nextIndex]?.id ?? current;
    });
    setActiveIndex(0);
  }, []);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const inActiveSection = items.filter((item) => resolveSection(item) === activeSection);

    if (normalizedQuery.length === 0) {
      return inActiveSection.slice(0, 200);
    }

    return inActiveSection
      .filter((item) => {
        const haystack = [item.label, item.detail ?? "", ...(item.keywords ?? [])].join(" ").toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .slice(0, 200);
  }, [activeSection, items, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery("");
    setActiveSection("diff-sections");
    setActiveIndex(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleTabCycle = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const eventTarget = event.target;
      if (
        panelRef.current &&
        eventTarget instanceof Node &&
        !panelRef.current.contains(eventTarget)
      ) {
        return;
      }

      event.preventDefault();
      cycleSection(event.shiftKey ? -1 : 1);
    };

    window.addEventListener("keydown", handleTabCycle);
    return () => {
      window.removeEventListener("keydown", handleTabCycle);
    };
  }, [cycleSection, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const clamped = Math.min(activeIndex, Math.max(filteredItems.length - 1, 0));
    if (clamped !== activeIndex) {
      setActiveIndex(clamped);
    }
  }, [activeIndex, filteredItems.length, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-canvas/60 px-4 pt-20 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={panelRef}
        className="w-full max-w-2xl rounded-xl border border-border/60 bg-surface/95 p-3 shadow-soft"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            {SECTIONS.map((section) => {
              const isActive = section.id === activeSection;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] uppercase tracking-[0.1em] transition-colors",
                    isActive ? "bg-accent/14 text-accent" : "text-muted hover:text-text",
                  )}
                  onClick={() => {
                    setActiveSection(section.id);
                    setActiveIndex(0);
                    inputRef.current?.focus();
                  }}
                >
                  {section.label}
                </button>
              );
            })}
          </div>

          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a file, navigation target, or command..."
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }

              if (event.key === "Tab") {
                event.preventDefault();
                cycleSection(event.shiftKey ? -1 : 1);
                return;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, Math.max(filteredItems.length - 1, 0)));
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
                return;
              }

              if (event.key === "Enter") {
                event.preventDefault();
                const selectedItem = filteredItems[activeIndex];
                if (!selectedItem) {
                  return;
                }

                void Promise.resolve(onRun(selectedItem)).finally(() => {
                  onClose();
                });
              }
            }}
          />

          <div className="max-h-[30rem] overflow-y-auto">
            {filteredItems.length === 0 && (
              <p className="px-3 py-5 text-sm text-muted">No command matches your query.</p>
            )}

            {filteredItems.map((item, index) => {
              const isActive = index === activeIndex;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left transition-colors",
                    isActive ? "bg-accent/14 text-text" : "text-muted hover:bg-elevated/60",
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    void Promise.resolve(onRun(item)).finally(() => {
                      onClose();
                    });
                  }}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.label}</p>
                    {item.detail && <p className="truncate text-xs text-muted">{item.detail}</p>}
                  </div>
                </button>
              );
            })}
          </div>

          <p className="text-xs text-muted">
            Tab to switch sections, Enter to run, arrows to navigate, Esc to close.
          </p>
        </div>
      </div>
    </div>
  );
}
