use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

const COMMIT_FIELD_DELIMITER: &str = "\u{001f}";

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

    String::from_utf8(output.stdout).map_err(|error| format!("Git output was not valid UTF-8: {}", error))
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
        commit_reference,
    ];
    let output = run_git(&repository_path, &args)?;

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

    let description = if body.is_empty() {
        title.clone()
    } else {
        body
    };
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

#[tauri::command]
fn read_commit_patch(repo_path: String, commit_hash: String) -> Result<String, String> {
    let repository_path = validate_repository_path(&repo_path)?;
    let commit_reference = validate_commit_reference(&commit_hash)?;

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
fn run_claude_prompt(prompt: String) -> Result<String, String> {
    let trimmed_prompt = prompt.trim();

    if trimmed_prompt.is_empty() {
        return Err("Claude prompt cannot be empty.".to_string());
    }

    let output = Command::new("claude")
        .arg("-p")
        .arg(trimmed_prompt)
        .output()
        .map_err(|error| format!("Failed to run Claude CLI. Ensure `claude` is installed: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("Claude CLI execution failed.".to_string());
        }

        return Err(stderr);
    }

    String::from_utf8(output.stdout).map_err(|error| format!("Claude CLI output was not valid UTF-8: {}", error))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_commits,
            read_commit_details,
            read_commit_patch,
            run_claude_prompt
        ])
        .run(tauri::generate_context!())
        .expect("error while running easy_visualization tauri shell");
}
