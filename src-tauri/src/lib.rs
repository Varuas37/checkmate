use serde::Serialize;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::Manager;

const COMMIT_FIELD_DELIMITER: &str = "\u{001f}";
const WORKTREE_COMMIT_REFERENCE: &str = "WORKTREE";
const CM_COMMAND_NAME: &str = "cm";
const CM_APP_BUNDLE_IDENTIFIER: &str = "sh.checkmate.desktop";
const CM_APP_NAME: &str = "checkmate.sh";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub repository_path: String,
    pub commit_sha: String,
}

#[derive(Default)]
struct LaunchRequestState {
    launch_request: Mutex<Option<LaunchRequest>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CmCliInstallResult {
    pub install_path: String,
    pub on_path: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CmCliStatus {
    pub installed: bool,
    pub install_path: Option<String>,
    pub on_path: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitListItem {
    pub hash: String,
    pub short_hash: String,
    pub summary: String,
    pub author: String,
    pub author_email: String,
    pub authored_at_iso: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub hash: String,
    pub short_hash: String,
    pub title: String,
    pub description: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at_iso: String,
    pub parent_commit_shas: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileVersions {
    pub old_content: Option<String>,
    pub new_content: Option<String>,
}

fn validate_repository_path(repo_path: &str) -> Result<PathBuf, String> {
    let trimmed = repo_path.trim();

    if trimmed.is_empty() {
        return Err("Repository path is required.".to_string());
    }

    let canonical_path = std::fs::canonicalize(trimmed)
        .map_err(|error| format!("Failed to resolve repository path: {}", error))?;

    if !canonical_path.is_dir() {
        return Err("Repository path must point to a directory.".to_string());
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(&canonical_path)
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .output()
        .map_err(|error| format!("Failed to validate git repository path: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("Provided path is not a git repository.".to_string());
        }

        return Err(stderr);
    }

    Ok(canonical_path)
}

fn validate_commit_reference(reference: &str) -> Result<String, String> {
    let trimmed = reference.trim();

    if trimmed.is_empty() {
        return Err("Commit reference is required.".to_string());
    }

    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err("Commit reference must not contain newline characters.".to_string());
    }

    Ok(trimmed.to_string())
}

fn validate_file_reference(path: &str, label: &str) -> Result<String, String> {
    let trimmed = path.trim();

    if trimmed.is_empty() {
        return Err(format!("{} is required.", label));
    }

    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err(format!("{} must not contain newline characters.", label));
    }

    let parsed_path = Path::new(trimmed);
    if parsed_path.is_absolute()
        || parsed_path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!(
            "{} must be a repository-relative path without parent traversal.",
            label
        ));
    }

    Ok(trimmed.to_string())
}

fn validate_text_file_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();

    if trimmed.is_empty() {
        return Err("File path is required.".to_string());
    }

    let canonical_path = std::fs::canonicalize(trimmed)
        .map_err(|error| format!("Failed to resolve file path: {}", error))?;

    if !canonical_path.is_file() {
        return Err("File path must point to a file.".to_string());
    }

    Ok(canonical_path)
}

fn run_git(repo_path: &Path, args: &[String]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .map_err(|error| format!("Failed to execute git command: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let command_repr = args.join(" ");

        if stderr.is_empty() {
            return Err(format!("Git command failed: {}", command_repr));
        }

        return Err(format!("Git command failed: {} ({})", command_repr, stderr));
    }

    String::from_utf8(output.stdout)
        .map_err(|error| format!("Git output was not valid UTF-8: {}", error))
}

fn run_git_optional(repo_path: &Path, args: &[String]) -> Result<Option<String>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .map_err(|error| format!("Failed to execute git command: {}", error))?;

    if !output.status.success() {
        return Ok(None);
    }

    let text = String::from_utf8(output.stdout)
        .map_err(|error| format!("Git output was not valid UTF-8: {}", error))?;
    Ok(Some(text))
}

fn is_worktree_reference(reference: &str) -> bool {
    reference.eq_ignore_ascii_case(WORKTREE_COMMIT_REFERENCE)
}

fn has_head_commit(repo_path: &Path) -> Result<bool, String> {
    let args = vec![
        "rev-parse".to_string(),
        "--verify".to_string(),
        "HEAD".to_string(),
    ];
    let output = run_git_optional(repo_path, &args)?;
    Ok(output.map(|text| !text.trim().is_empty()).unwrap_or(false))
}

fn parse_commit_details_output(output: &str) -> Result<CommitDetails, String> {
    let mut parts = output.splitn(8, COMMIT_FIELD_DELIMITER);
    let hash = parts.next().unwrap_or_default().trim().to_string();
    let short_hash = parts.next().unwrap_or_default().trim().to_string();
    let author_name = parts.next().unwrap_or_default().trim().to_string();
    let author_email = parts.next().unwrap_or_default().trim().to_string();
    let authored_at_iso = parts.next().unwrap_or_default().trim().to_string();
    let title = parts.next().unwrap_or_default().trim().to_string();
    let body = parts.next().unwrap_or_default().trim().to_string();
    let parent_hashes_raw = parts.next().unwrap_or_default().trim().to_string();

    if hash.is_empty() {
        return Err("Failed to parse commit details from git output.".to_string());
    }

    let description = if body.is_empty() { title.clone() } else { body };
    let parent_commit_shas = parent_hashes_raw
        .split_whitespace()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();

    Ok(CommitDetails {
        hash,
        short_hash,
        title,
        description,
        author_name,
        author_email,
        authored_at_iso,
        parent_commit_shas,
    })
}

fn read_commit_details_for_reference(
    repository_path: &Path,
    commit_reference: &str,
) -> Result<CommitDetails, String> {
    let pretty_format = format!(
        "--pretty=format:%H{}%h{}%an{}%ae{}%aI{}%s{}%b{}%P",
        COMMIT_FIELD_DELIMITER,
        COMMIT_FIELD_DELIMITER,
        COMMIT_FIELD_DELIMITER,
        COMMIT_FIELD_DELIMITER,
        COMMIT_FIELD_DELIMITER,
        COMMIT_FIELD_DELIMITER,
        COMMIT_FIELD_DELIMITER
    );
    let args = vec![
        "show".to_string(),
        "-s".to_string(),
        "--date=iso-strict".to_string(),
        pretty_format,
        commit_reference.to_string(),
    ];
    let output = run_git(repository_path, &args)?;
    parse_commit_details_output(&output)
}

fn read_git_config_value(repo_path: &Path, key: &str) -> Result<Option<String>, String> {
    let args = vec!["config".to_string(), "--get".to_string(), key.to_string()];
    let value = run_git_optional(repo_path, &args)?
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());
    Ok(value)
}

fn read_worktree_commit_details(repository_path: &Path) -> Result<CommitDetails, String> {
    let head_details = read_commit_details_for_reference(repository_path, "HEAD").ok();
    let git_user_name = read_git_config_value(repository_path, "user.name")?;
    let git_user_email = read_git_config_value(repository_path, "user.email")?;

    let author_name = git_user_name
        .or_else(|| {
            head_details
                .as_ref()
                .map(|details| details.author_name.clone())
        })
        .unwrap_or_else(|| "Draft Author".to_string());

    let author_email = git_user_email
        .or_else(|| {
            head_details
                .as_ref()
                .map(|details| details.author_email.clone())
        })
        .unwrap_or_else(|| "draft@localhost".to_string());

    let parent_commit_shas = head_details
        .as_ref()
        .map(|details| vec![details.hash.clone()])
        .unwrap_or_default();

    Ok(CommitDetails {
        hash: WORKTREE_COMMIT_REFERENCE.to_string(),
        short_hash: WORKTREE_COMMIT_REFERENCE.to_string(),
        title: "Working tree draft changes".to_string(),
        description: "Uncommitted changes in the current working tree.".to_string(),
        author_name,
        author_email,
        authored_at_iso: head_details
            .as_ref()
            .map(|details| details.authored_at_iso.clone())
            .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string()),
        parent_commit_shas,
    })
}

fn read_untracked_files(repository_path: &Path) -> Result<Vec<String>, String> {
    let args = vec![
        "ls-files".to_string(),
        "--others".to_string(),
        "--exclude-standard".to_string(),
    ];
    let output = run_git(repository_path, &args)?;
    Ok(output
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect())
}

fn build_untracked_text_file_patch(repository_path: &Path, relative_path: &str) -> Option<String> {
    let resolved_path = resolve_repository_file_path(repository_path, relative_path)?;
    if !resolved_path.is_file() {
        return None;
    }

    let content = std::fs::read_to_string(&resolved_path).ok()?;
    let lines = content.lines().collect::<Vec<_>>();
    let line_count = lines.len();

    let mut patch = String::new();
    patch.push_str(&format!("diff --git a/{0} b/{0}\n", relative_path));
    patch.push_str("new file mode 100644\n");
    patch.push_str("--- /dev/null\n");
    patch.push_str(&format!("+++ b/{}\n", relative_path));
    patch.push_str(&format!("@@ -0,0 +1,{} @@\n", line_count));

    for line in lines {
        patch.push('+');
        patch.push_str(line);
        patch.push('\n');
    }

    Some(patch)
}

fn read_worktree_patch(repository_path: &Path) -> Result<String, String> {
    let has_head = has_head_commit(repository_path)?;
    let mut args = vec![
        "diff".to_string(),
        "--find-renames".to_string(),
        "--unified=3".to_string(),
    ];

    if has_head {
        args.push("HEAD".to_string());
    }

    let mut patch = run_git(repository_path, &args)?;
    let untracked_files = read_untracked_files(repository_path)?;
    let mut untracked_patches = untracked_files
        .iter()
        .filter_map(|path| build_untracked_text_file_patch(repository_path, path))
        .collect::<Vec<_>>();

    if !untracked_patches.is_empty() {
        if !patch.is_empty() && !patch.ends_with('\n') {
            patch.push('\n');
        }

        patch.push_str(&untracked_patches.join("\n"));
        if !patch.ends_with('\n') {
            patch.push('\n');
        }
        untracked_patches.clear();
    }

    Ok(patch)
}

fn resolve_repository_file_path(repository_path: &Path, relative_path: &str) -> Option<PathBuf> {
    let parsed_path = Path::new(relative_path);
    if parsed_path.is_absolute()
        || parsed_path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return None;
    }

    Some(repository_path.join(parsed_path))
}

fn read_worktree_file_versions(
    repository_path: &Path,
    old_file_path: &str,
    new_file_path: &str,
) -> Result<CommitFileVersions, String> {
    let old_content = if has_head_commit(repository_path)? {
        let old_spec = format!("HEAD:{}", old_file_path);
        let old_args = vec!["show".to_string(), old_spec];
        run_git_optional(repository_path, &old_args)?
    } else {
        None
    };

    let new_content = if let Some(resolved_new_path) =
        resolve_repository_file_path(repository_path, new_file_path)
    {
        if resolved_new_path.is_file() {
            std::fs::read_to_string(&resolved_new_path).ok()
        } else {
            None
        }
    } else {
        return Err("New file path must be repository-relative.".to_string());
    };

    Ok(CommitFileVersions {
        old_content,
        new_content,
    })
}

fn normalize_cli_arg(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.contains('\n') || trimmed.contains('\r') {
        return None;
    }

    Some(trimmed.to_string())
}

fn parse_launch_request_from_args() -> Option<LaunchRequest> {
    let args = std::env::args().collect::<Vec<_>>();
    let mut repository_path: Option<String> = None;
    let mut commit_sha: Option<String> = None;
    let mut index = 1usize;

    while index < args.len() {
        match args[index].as_str() {
            "--repo" => {
                if let Some(value) = args.get(index + 1) {
                    repository_path = normalize_cli_arg(value);
                    index += 2;
                    continue;
                }
            }
            "--commit" => {
                if let Some(value) = args.get(index + 1) {
                    commit_sha = normalize_cli_arg(value);
                    index += 2;
                    continue;
                }
            }
            _ => {}
        }

        index += 1;
    }

    let repository_path = repository_path?;
    Some(LaunchRequest {
        repository_path,
        commit_sha: commit_sha.unwrap_or_else(|| "HEAD".to_string()),
    })
}

fn path_entries() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|raw_path| std::env::split_paths(&raw_path).collect::<Vec<_>>())
        .unwrap_or_default()
}

fn is_directory_writable(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }

    let probe_path = path.join(".cm-write-probe");
    match std::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&probe_path)
    {
        Ok(_) => {
            let _ = std::fs::remove_file(probe_path);
            true
        }
        Err(_) => false,
    }
}

fn is_transient_path_entry(path: &Path) -> bool {
    let as_text = path.to_string_lossy();
    as_text.contains("/var/folders/")
        || as_text.contains("/tmp/")
        || as_text.contains(".cache/")
        || as_text.contains(".yarn-cache")
}

fn preferred_cm_directories(home_path: &Path) -> Vec<PathBuf> {
    vec![
        PathBuf::from("/opt/checkmate/bin"),
        home_path.join(".local/bin"),
        home_path.join("bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]
}

fn select_cm_install_directory() -> Result<(PathBuf, bool), String> {
    let path_entries = path_entries();
    let home_path = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Failed to resolve HOME directory for cm installation.".to_string())?;

    let preferred_paths = preferred_cm_directories(&home_path);

    for entry in &preferred_paths {
        if !entry.is_dir() {
            continue;
        }

        if is_directory_writable(entry) {
            let on_path = path_entries.iter().any(|path_entry| path_entry == entry);
            return Ok((entry.clone(), on_path));
        }
    }

    for entry in &path_entries {
        if is_transient_path_entry(entry) {
            continue;
        }

        if is_directory_writable(entry) {
            return Ok((entry.clone(), true));
        }
    }

    for entry in preferred_paths {
        if std::fs::create_dir_all(&entry).is_err() {
            continue;
        }

        if is_directory_writable(&entry) {
            let on_path = path_entries.iter().any(|path_entry| path_entry == &entry);
            return Ok((entry, on_path));
        }
    }

    Err("Failed to find a writable directory for installing `cm`.".to_string())
}

fn resolve_shell_profile_path() -> Option<PathBuf> {
    let home_path = std::env::var_os("HOME").map(PathBuf::from)?;
    let shell = std::env::var("SHELL").unwrap_or_default();

    let profile_name = if shell.contains("zsh") {
        ".zshrc"
    } else if shell.contains("bash") {
        ".bashrc"
    } else {
        ".profile"
    };

    Some(home_path.join(profile_name))
}

fn profile_contains_path_entry(profile_path: &Path, directory: &Path) -> bool {
    let profile_contents = std::fs::read_to_string(profile_path).unwrap_or_default();
    let target = directory.to_string_lossy();

    profile_contents
        .lines()
        .any(|line| line.contains("PATH") && line.contains(target.as_ref()))
}

fn ensure_path_entry_in_shell_profile(directory: &Path) -> Result<bool, String> {
    let Some(profile_path) = resolve_shell_profile_path() else {
        return Ok(false);
    };

    if profile_contains_path_entry(&profile_path, directory) {
        return Ok(true);
    }

    let mut contents = if profile_path.exists() {
        std::fs::read_to_string(&profile_path)
            .map_err(|error| format!("Failed to read {}: {}", profile_path.display(), error))?
    } else {
        String::new()
    };

    if !contents.is_empty() && !contents.ends_with('\n') {
        contents.push('\n');
    }

    let export_line = format!("export PATH=\"{}:$PATH\"", directory.to_string_lossy());
    contents.push_str(&export_line);
    contents.push('\n');

    std::fs::write(&profile_path, contents)
        .map_err(|error| format!("Failed to update {}: {}", profile_path.display(), error))?;

    Ok(true)
}

fn cm_script_contents() -> String {
    format!(
        r#"#!/usr/bin/env bash
set -euo pipefail

TARGET_PATH="."
COMMIT_REF="HEAD"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --draft|--worktree|-d)
      COMMIT_REF="{worktree_ref}"
      shift
      ;;
    --commit)
      if [[ $# -lt 2 ]]; then
        echo "cm: missing value for --commit" >&2
        exit 1
      fi
      COMMIT_REF="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'USAGE'
Usage:
  cm [path]
  cm [path] --commit <ref>
  cm [path] --draft

Examples:
  cm .
  cm . --draft
USAGE
      exit 0
      ;;
    *)
      TARGET_PATH="$1"
      shift
      ;;
  esac
done

if [[ "$TARGET_PATH" == "." ]]; then
  TARGET_PATH="$PWD"
fi

if [[ ! -d "$TARGET_PATH" ]]; then
  echo "cm: folder not found: $TARGET_PATH" >&2
  exit 1
fi

REPO_PATH="$(cd "$TARGET_PATH" && pwd)"

if ! git -C "$REPO_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "cm: not a git repository: $REPO_PATH" >&2
  exit 1
fi

if ! open -nb "{bundle_id}" --args --repo "$REPO_PATH" --commit "$COMMIT_REF" >/dev/null 2>&1; then
  open -na "{app_name}" --args --repo "$REPO_PATH" --commit "$COMMIT_REF"
fi
"#,
        worktree_ref = WORKTREE_COMMIT_REFERENCE,
        bundle_id = CM_APP_BUNDLE_IDENTIFIER,
        app_name = CM_APP_NAME
    )
}

#[tauri::command]
fn list_commits(repo_path: String, limit: Option<usize>) -> Result<Vec<CommitListItem>, String> {
    let repository_path = validate_repository_path(&repo_path)?;
    let max_count = limit.unwrap_or(120).clamp(1, 500);

    let pretty_format = format!(
        "--pretty=format:%H{}%h{}%an{}%ae{}%aI{}%s",
        COMMIT_FIELD_DELIMITER,
        COMMIT_FIELD_DELIMITER,
        COMMIT_FIELD_DELIMITER,
        COMMIT_FIELD_DELIMITER,
        COMMIT_FIELD_DELIMITER
    );
    let args = vec![
        "log".to_string(),
        format!("--max-count={}", max_count),
        "--date=iso-strict".to_string(),
        pretty_format,
    ];
    let output = run_git(&repository_path, &args)?;

    let mut commits = Vec::new();

    for line in output.lines() {
        let mut parts = line.split(COMMIT_FIELD_DELIMITER);
        let hash = parts.next().unwrap_or_default().trim().to_string();
        let short_hash = parts.next().unwrap_or_default().trim().to_string();
        let author = parts.next().unwrap_or_default().trim().to_string();
        let author_email = parts.next().unwrap_or_default().trim().to_string();
        let authored_at_iso = parts.next().unwrap_or_default().trim().to_string();
        let summary = parts.next().unwrap_or_default().trim().to_string();

        if hash.is_empty() {
            continue;
        }

        commits.push(CommitListItem {
            hash,
            short_hash,
            summary,
            author,
            author_email,
            authored_at_iso,
        });
    }

    Ok(commits)
}

#[tauri::command]
fn read_commit_details(repo_path: String, commit_hash: String) -> Result<CommitDetails, String> {
    let repository_path = validate_repository_path(&repo_path)?;
    let commit_reference = validate_commit_reference(&commit_hash)?;

    if is_worktree_reference(&commit_reference) {
        return read_worktree_commit_details(&repository_path);
    }

    read_commit_details_for_reference(&repository_path, &commit_reference)
}

#[tauri::command]
fn read_commit_patch(repo_path: String, commit_hash: String) -> Result<String, String> {
    let repository_path = validate_repository_path(&repo_path)?;
    let commit_reference = validate_commit_reference(&commit_hash)?;

    if is_worktree_reference(&commit_reference) {
        return read_worktree_patch(&repository_path);
    }

    let args = vec![
        "show".to_string(),
        "--format=".to_string(),
        "--find-renames".to_string(),
        "--unified=3".to_string(),
        commit_reference,
    ];

    run_git(&repository_path, &args)
}

#[tauri::command]
fn read_current_branch(repo_path: String) -> Result<String, String> {
    let repository_path = validate_repository_path(&repo_path)?;
    let args = vec![
        "rev-parse".to_string(),
        "--abbrev-ref".to_string(),
        "HEAD".to_string(),
    ];
    let output = run_git(&repository_path, &args)?;
    let branch = output.trim().to_string();

    if branch.is_empty() {
        return Err("Failed to resolve current branch.".to_string());
    }

    Ok(branch)
}

#[tauri::command]
fn list_local_branches(repo_path: String) -> Result<Vec<String>, String> {
    let repository_path = validate_repository_path(&repo_path)?;
    let current_branch = read_current_branch(repo_path).unwrap_or_default();
    let args = vec![
        "for-each-ref".to_string(),
        "--format=%(refname:short)".to_string(),
        "refs/heads".to_string(),
    ];
    let output = run_git(&repository_path, &args)?;

    let mut branches = output
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|branch| !branch.is_empty())
        .collect::<Vec<_>>();

    branches.sort();
    branches.dedup();

    if !current_branch.is_empty() {
        if let Some(index) = branches.iter().position(|branch| branch == &current_branch) {
            let active = branches.remove(index);
            branches.insert(0, active);
        } else {
            branches.insert(0, current_branch);
        }
    }

    if branches.is_empty() {
        return Err("No local branches found.".to_string());
    }

    Ok(branches)
}

#[tauri::command]
fn read_commit_file_versions(
    repo_path: String,
    commit_hash: String,
    old_path: String,
    new_path: String,
) -> Result<CommitFileVersions, String> {
    let repository_path = validate_repository_path(&repo_path)?;
    let commit_reference = validate_commit_reference(&commit_hash)?;
    let old_file_path = validate_file_reference(&old_path, "Old file path")?;
    let new_file_path = validate_file_reference(&new_path, "New file path")?;

    if is_worktree_reference(&commit_reference) {
        return read_worktree_file_versions(&repository_path, &old_file_path, &new_file_path);
    }

    let parent_args = vec!["rev-parse".to_string(), format!("{}^", commit_reference)];
    let parent_commit = run_git_optional(&repository_path, &parent_args)?
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let old_content = if let Some(parent_sha) = parent_commit {
        let old_spec = format!("{}:{}", parent_sha, old_file_path);
        let old_args = vec!["show".to_string(), old_spec];
        run_git_optional(&repository_path, &old_args)?
    } else {
        None
    };

    let new_spec = format!("{}:{}", commit_reference, new_file_path);
    let new_args = vec!["show".to_string(), new_spec];
    let new_content = run_git_optional(&repository_path, &new_args)?;

    Ok(CommitFileVersions {
        old_content,
        new_content,
    })
}

#[tauri::command]
fn run_claude_prompt(prompt: String) -> Result<String, String> {
    let trimmed_prompt = prompt.trim();

    if trimmed_prompt.is_empty() {
        return Err("Claude prompt cannot be empty.".to_string());
    }

    let output = Command::new("claude")
        .arg("-p")
        .arg(trimmed_prompt)
        .output()
        .map_err(|error| {
            format!(
                "Failed to run Claude CLI. Ensure `claude` is installed: {}",
                error
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("Claude CLI execution failed.".to_string());
        }

        return Err(stderr);
    }

    String::from_utf8(output.stdout)
        .map_err(|error| format!("Claude CLI output was not valid UTF-8: {}", error))
}

#[tauri::command]
fn read_text_file(file_path: String) -> Result<String, String> {
    let path = validate_text_file_path(&file_path)?;

    std::fs::read_to_string(path).map_err(|error| format!("Failed to read text file: {}", error))
}

#[tauri::command]
fn read_app_settings(app: tauri::AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {}", error))?;

    let settings_path = app_data_dir.join("settings.json");

    if !settings_path.exists() {
        return Ok(String::new());
    }

    std::fs::read_to_string(&settings_path)
        .map_err(|error| format!("Failed to read settings file: {}", error))
}

#[tauri::command]
fn write_app_settings(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {}", error))?;

    std::fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Failed to create app data directory: {}", error))?;

    let settings_path = app_data_dir.join("settings.json");

    std::fs::write(&settings_path, content)
        .map_err(|error| format!("Failed to write settings file: {}", error))
}

#[tauri::command]
fn run_cli_agent_prompt(
    command: String,
    args: Vec<String>,
    prompt: String,
) -> Result<String, String> {
    let trimmed_command = command.trim();

    if trimmed_command.is_empty() {
        return Err("CLI agent command cannot be empty.".to_string());
    }

    let trimmed_prompt = prompt.trim();

    if trimmed_prompt.is_empty() {
        return Err("CLI agent prompt cannot be empty.".to_string());
    }

    let output = Command::new(trimmed_command)
        .args(&args)
        .arg(trimmed_prompt)
        .output()
        .map_err(|error| {
            format!(
                "Failed to run CLI agent '{}': {}. Ensure it is installed and on your PATH.",
                trimmed_command, error
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err(format!("CLI agent '{}' execution failed.", trimmed_command));
        }

        return Err(stderr);
    }

    String::from_utf8(output.stdout)
        .map_err(|error| format!("CLI agent output was not valid UTF-8: {}", error))
}

#[tauri::command]
fn read_launch_request(state: tauri::State<'_, LaunchRequestState>) -> Option<LaunchRequest> {
    state
        .launch_request
        .lock()
        .ok()
        .and_then(|request| request.clone())
}

#[tauri::command]
fn read_cm_cli_status() -> Result<CmCliStatus, String> {
    let path_entries = path_entries();
    let mut install_path: Option<PathBuf> = None;

    for entry in &path_entries {
        let candidate = entry.join(CM_COMMAND_NAME);
        if candidate.is_file() {
            install_path = Some(candidate);
            break;
        }
    }

    if install_path.is_none() {
        if let Some(home_path) = std::env::var_os("HOME").map(PathBuf::from) {
            for candidate in [
                home_path.join(".local/bin").join(CM_COMMAND_NAME),
                home_path.join("bin").join(CM_COMMAND_NAME),
            ] {
                if candidate.is_file() {
                    install_path = Some(candidate);
                    break;
                }
            }
        }
    }

    let on_path_from_environment = install_path
        .as_ref()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .map(|parent| path_entries.iter().any(|entry| entry == &parent))
        .unwrap_or(false);

    let on_path_from_profile = if let (Some(installed_path), Some(profile_path)) =
        (install_path.as_ref(), resolve_shell_profile_path())
    {
        installed_path
            .parent()
            .map(|parent| profile_contains_path_entry(&profile_path, parent))
            .unwrap_or(false)
    } else {
        false
    };

    let on_path = on_path_from_environment || on_path_from_profile;

    Ok(CmCliStatus {
        installed: install_path.is_some(),
        install_path: install_path.map(|path| path.to_string_lossy().to_string()),
        on_path,
    })
}

#[tauri::command]
fn install_cm_cli_in_path() -> Result<CmCliInstallResult, String> {
    let (install_directory, on_path) = select_cm_install_directory()?;
    let script_path = install_directory.join(CM_COMMAND_NAME);
    let script_contents = cm_script_contents();

    std::fs::write(&script_path, script_contents)
        .map_err(|error| format!("Failed to write cm command: {}", error))?;

    #[cfg(unix)]
    {
        let metadata = std::fs::metadata(&script_path)
            .map_err(|error| format!("Failed to read cm command permissions: {}", error))?;
        let mut permissions = metadata.permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&script_path, permissions)
            .map_err(|error| format!("Failed to set cm command permissions: {}", error))?;
    }

    let path_ready = if on_path {
        true
    } else {
        ensure_path_entry_in_shell_profile(&install_directory)?
    };

    let install_path = script_path.to_string_lossy().to_string();
    let message = if path_ready {
        format!(
            "Installed `cm` at {}. Restart your terminal to use `cm`.",
            install_path
        )
    } else {
        format!(
            "Installed `cm` at {}. Add {} to your shell PATH.",
            install_path,
            install_directory.to_string_lossy()
        )
    };

    Ok(CmCliInstallResult {
        install_path,
        on_path: path_ready,
        message,
    })
}

pub fn run() {
    let launch_request = parse_launch_request_from_args();

    tauri::Builder::default()
        .manage(LaunchRequestState {
            launch_request: Mutex::new(launch_request),
        })
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.remove_menu()?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_commits,
            read_commit_details,
            read_commit_patch,
            read_current_branch,
            list_local_branches,
            read_commit_file_versions,
            run_claude_prompt,
            read_text_file,
            read_app_settings,
            write_app_settings,
            run_cli_agent_prompt,
            read_launch_request,
            read_cm_cli_status,
            install_cm_cli_in_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running checkmate.sh tauri shell");
}
