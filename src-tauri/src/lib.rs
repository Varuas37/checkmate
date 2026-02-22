use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

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

pub fn run() {
    tauri::Builder::default()
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
            run_cli_agent_prompt
        ])
        .run(tauri::generate_context!())
        .expect("error while running checkmate.sh tauri shell");
}
