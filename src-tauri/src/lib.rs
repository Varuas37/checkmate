use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitListItem {
    pub hash: String,
    pub summary: String,
    pub author: String,
    pub committed_at: String,
}

pub fn cmd_list_commits(repo_path: String, limit: Option<usize>) -> Result<Vec<CommitListItem>, String> {
    let _ = (repo_path, limit);

    // SECURITY PLACEHOLDER:
    // - Canonicalize and validate repo_path against an explicit allowlist.
    // - Allow only read-only git operations for this command.
    // - Reject shell interpretation and pass arguments as structured values only.
    Err("not implemented: list_commits command stub".to_string())
}

pub fn cmd_read_file_diff(repo_path: String, commit_hash: String, file_path: String) -> Result<String, String> {
    let _ = (repo_path, commit_hash, file_path);

    // SECURITY PLACEHOLDER:
    // - Validate commit_hash format and deny revision-range expressions.
    // - Restrict file_path to tracked files inside the allowed repository root.
    // - Enforce output-size limits before returning diff content to the frontend.
    Err("not implemented: read_file_diff command stub".to_string())
}

pub fn run() {
    tauri::Builder::default()
        // SECURITY PLACEHOLDER:
        // Keep capabilities least-privilege in src-tauri/capabilities/*.json
        // when file system, shell, or dialog plugins are introduced.
        //
        // TODO: wire command stubs via `#[tauri::command]` + `generate_handler!`
        // after desktop command contracts are finalized.
        .run(tauri::generate_context!())
        .expect("error while running easy_visualization tauri shell");
}
