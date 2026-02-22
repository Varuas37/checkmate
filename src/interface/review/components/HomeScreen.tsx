import { Button, Input } from "../../../design-system/index.ts";
import { cn } from "../../../shared/index.ts";
import type { RecentProjectEntry } from "../../../shared/index.ts";

export interface HomeScreenProps {
  readonly reviewerName: string;
  readonly reviewerEmail: string;
  readonly repositoryPath: string;
  readonly commitSha: string;
  readonly recentProjects: readonly RecentProjectEntry[];
  readonly errorMessage: string | null;
  readonly isStarting: boolean;
  readonly onReviewerNameChange: (value: string) => void;
  readonly onReviewerEmailChange: (value: string) => void;
  readonly onRepositoryPathChange: (value: string) => void;
  readonly onCommitShaChange: (value: string) => void;
  readonly onBrowseRepository: () => void | Promise<void>;
  readonly onSelectRecentProject: (repositoryPath: string) => void;
  readonly onStart: () => void;
}

interface HomeSectionTitleProps {
  readonly label: string;
}

function HomeSectionTitle({ label }: HomeSectionTitleProps) {
  return (
    <div className="flex items-center gap-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-subtle">{label}</p>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

interface HomeActionRowProps {
  readonly label: string;
  readonly detail: string;
  readonly shortcut: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

function HomeActionRow({ label, detail, shortcut, disabled = false, onClick }: HomeActionRowProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-sm px-1.5 py-2 text-left transition-colors",
        "hover:bg-surface-subtle/35",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
      )}
      onClick={() => onClick()}
      disabled={disabled}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none text-muted">+</span>
          <p className="truncate text-base font-medium tracking-tight text-text">{label}</p>
        </div>
        <p className="truncate pl-6 font-mono text-[11px] text-text-subtle">{detail}</p>
      </div>
      <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">{shortcut}</span>
    </button>
  );
}

export function HomeScreen({
  reviewerName,
  reviewerEmail,
  repositoryPath,
  commitSha,
  recentProjects,
  errorMessage,
  isStarting,
  onReviewerNameChange,
  onReviewerEmailChange,
  onRepositoryPathChange,
  onCommitShaChange,
  onBrowseRepository,
  onSelectRecentProject,
  onStart,
}: HomeScreenProps) {
  const normalizedRepositoryPath = repositoryPath.trim();
  const normalizedCommitSha = commitSha.trim();
  const normalizedName = reviewerName.trim();
  const normalizedEmail = reviewerEmail.trim();

  const projectHint = normalizedRepositoryPath.length > 0 ? normalizedRepositoryPath : "No repository selected";
  const reviewHint =
    normalizedName.length > 0 && normalizedEmail.length > 0
      ? `${normalizedName} · ${normalizedCommitSha || "HEAD"}`
      : "Set reviewer identity below";
  const minimalInputClass =
    "h-8 rounded-none border-x-0 border-t-0 border-b border-b-border/70 bg-transparent px-0 shadow-none hover:border-b-border-strong focus-visible:ring-0";

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-canvas px-4 py-8 text-text">
      <div className="w-full max-w-[54rem] px-2">
        <div className="mx-auto w-full max-w-[52rem] py-10 sm:px-2">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center text-muted">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
                <path d="m7.5 15.5 9-9" />
                <path d="M8 8h4v4" />
                <path d="M12 16H8v-4" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-display text-[30px] font-semibold leading-tight tracking-tight text-text">
                Welcome back to CodeLens
              </h1>
              <p className="truncate text-sm text-muted">The review surface for AI-generated commits.</p>
            </div>
          </div>

          <div className="mt-8 space-y-6">
            <section>
              <HomeSectionTitle label="Get Started" />
              <div className="mt-2 space-y-1">
                <HomeActionRow
                  label="Open Project"
                  detail={projectHint}
                  shortcut="cmd-o"
                  onClick={() => {
                    void onBrowseRepository();
                  }}
                />
                <HomeActionRow
                  label={isStarting ? "Opening Review" : "Open Review"}
                  detail={reviewHint}
                  shortcut="enter"
                  onClick={onStart}
                  disabled={isStarting}
                />
              </div>
            </section>

            <section>
              <HomeSectionTitle label="Review Setup" />
              <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_9rem]">
                <label className="space-y-1 text-[11px] uppercase tracking-[0.1em] text-muted">
                  Project Path
                  <Input
                    value={repositoryPath}
                    onChange={(event) => onRepositoryPathChange(event.target.value)}
                    placeholder="/path/to/repository"
                    className={cn("font-mono text-xs", minimalInputClass)}
                  />
                </label>
                <div className="flex items-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-full justify-start px-0"
                    onClick={() => {
                      void onBrowseRepository();
                    }}
                  >
                    Browse
                  </Button>
                </div>
                <label className="space-y-1 text-[11px] uppercase tracking-[0.1em] text-muted md:max-w-[12rem]">
                  Commit
                  <Input
                    value={commitSha}
                    onChange={(event) => onCommitShaChange(event.target.value)}
                    placeholder="HEAD"
                    className={cn("font-mono text-xs", minimalInputClass)}
                  />
                </label>
              </div>
            </section>

            <section>
              <HomeSectionTitle label="Reviewer Identity" />
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <label className="space-y-1 text-[11px] uppercase tracking-[0.1em] text-muted">
                  Name
                  <Input
                    value={reviewerName}
                    onChange={(event) => onReviewerNameChange(event.target.value)}
                    placeholder="Your name"
                    className={minimalInputClass}
                  />
                </label>
                <label className="space-y-1 text-[11px] uppercase tracking-[0.1em] text-muted">
                  Email
                  <Input
                    value={reviewerEmail}
                    onChange={(event) => onReviewerEmailChange(event.target.value)}
                    placeholder="name@company.com"
                    className={minimalInputClass}
                  />
                </label>
              </div>
              <p className="mt-1 text-xs text-muted">
                Saved locally and used as the default author for review comments.
              </p>
            </section>

            <section>
              <HomeSectionTitle label="Recent Projects" />
              <div className="mt-2 space-y-1">
                {recentProjects.length === 0 && <p className="px-1.5 py-2 text-sm text-muted">No recent projects yet.</p>}
                {recentProjects.map((entry, index) => (
                  <button
                    key={`${entry.repositoryPath}-${index}`}
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-sm px-1.5 py-2 text-left transition-colors",
                      "hover:bg-surface-subtle/35",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                    )}
                    onClick={() => onSelectRecentProject(entry.repositoryPath)}
                  >
                    <span className="truncate font-mono text-xs text-text">{entry.repositoryPath}</span>
                    <span className="shrink-0 font-mono text-[11px] text-text-subtle">
                      {index < 9 ? `cmd-${index + 1}` : new Date(entry.lastOpenedAtIso).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {errorMessage && (
              <p className="px-1.5 text-sm text-danger">{errorMessage}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
