import { cn } from "../../shared/index.ts";

export interface TabButtonProps {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}

export function TabButton({ label, active, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-2 text-sm font-semibold transition-colors",
        active ? "bg-accent text-accent-contrast" : "bg-surface text-muted hover:bg-elevated hover:text-text",
      )}
    >
      {label}
    </button>
  );
}
