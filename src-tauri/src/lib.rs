use agent_client_protocol::{self as acp, Agent as _};
use async_trait::async_trait;
use aws_config::BehaviorVersion;
use aws_sdk_bedrockruntime as bedrockruntime;
use aws_types::region::Region;
use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::cell::RefCell;
use std::collections::HashMap;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{fs::OpenOptions, io::Write};
use tauri::Manager;
use tokio::sync::{mpsc, oneshot};
use tokio::task::LocalSet;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

const COMMIT_FIELD_DELIMITER: &str = "\u{001f}";
const WORKTREE_COMMIT_REFERENCE: &str = "WORKTREE";
const CM_COMMAND_NAME: &str = "cm";
const CM_APP_BUNDLE_IDENTIFIER: &str = "sh.checkmate.desktop";
const CM_APP_NAME: &str = "checkmate.sh";
const ACP_SESSION_POOL_MAX_SIZE: usize = 4;
const AGENT_TRACKING_BLOCK_START: &str = "<!-- checkmate:tracking:start -->";
const AGENT_TRACKING_BLOCK_END: &str = "<!-- checkmate:tracking:end -->";
const AGENT_TRACKING_SCHEMA_RELATIVE_PATH: &str = ".checkmate/commit_context.schema.json";
const AGENT_TRACKING_SCHEMA_MANAGED_MARKER: &str = "\"x-checkmate-managed\": true";
const AGENT_TRACKING_BLOCK_BODY: &str = r#"## Checkmate Tracking (added by checkmate.sh)
- Required schema: `.checkmate/commit_context.schema.json` (`checkmate.commit_context.v1`).
- For each commit, store `.checkmate/commit_context/<commit_sha>.json`.
- Required fields:
  - `schema_version`, `commit_sha`, `branch`, `title`
  - `rationale`
  - `change_summary[]` with `file`, `intent`, `risk`
  - `validation[]` with `name`, `result`, `evidence`
  - `agent_context` with `tool`, `session_id`, `prompt_summary`
  - `open_questions[]` and `follow_ups[]`
- Preserve validation evidence and known risks for reviewers."#;
const AGENT_TRACKING_SCHEMA_JSON: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Checkmate Commit Context",
  "description": "Structured rationale and validation metadata for a commit.",
  "type": "object",
  "x-checkmate-managed": true,
  "properties": {
    "schema_version": {
      "const": "checkmate.commit_context.v1"
    },
    "commit_sha": {
      "type": "string",
      "minLength": 1
    },
    "branch": {
      "type": "string",
      "minLength": 1
    },
    "title": {
      "type": "string",
      "minLength": 1
    },
    "rationale": {
      "type": "string",
      "minLength": 1
    },
    "change_summary": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "file": { "type": "string", "minLength": 1 },
          "intent": { "type": "string", "minLength": 1 },
          "risk": { "type": "string", "enum": ["low", "medium", "high"] }
        },
        "required": ["file", "intent", "risk"],
        "additionalProperties": false
      }
    },
    "validation": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "minLength": 1 },
          "result": { "type": "string", "enum": ["pass", "fail", "not_run"] },
          "evidence": { "type": "string" }
        },
        "required": ["name", "result", "evidence"],
        "additionalProperties": false
      }
    },
    "agent_context": {
      "type": "object",
      "properties": {
        "tool": { "type": "string", "minLength": 1 },
        "session_id": { "type": "string", "minLength": 1 },
        "prompt_summary": { "type": "string", "minLength": 1 }
      },
      "required": ["tool", "session_id", "prompt_summary"],
      "additionalProperties": false
    },
    "open_questions": {
      "type": "array",
      "items": { "type": "string" }
    },
    "follow_ups": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": [
    "schema_version",
    "commit_sha",
    "branch",
    "title",
    "rationale",
    "change_summary",
    "validation",
    "agent_context",
    "open_questions",
    "follow_ups"
  ],
  "additionalProperties": false
}"#;

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

#[derive(Clone)]
struct AcpSessionHandle {
    sender: mpsc::UnboundedSender<AcpPromptJob>,
    in_flight: Arc<AtomicUsize>,
}

struct AcpPromptJob {
    prompt: String,
    response_tx: oneshot::Sender<Result<String, String>>,
}

#[derive(Default)]
struct AcpSessionPool {
    handles: Vec<AcpSessionHandle>,
    next_index: usize,
}

#[derive(Default)]
struct AcpSessionManagerState {
    sessions: Mutex<HashMap<String, AcpSessionPool>>,
}

#[derive(Default)]
struct BedrockRuntimeState {
    clients: Mutex<HashMap<String, bedrockruntime::Client>>,
}

#[derive(Clone)]
struct AcpInvocationConfig {
    command: String,
    args: Vec<String>,
    cwd: PathBuf,
    session_key: String,
}

#[derive(Default)]
struct AcpTurnBuffer {
    active_session_id: Option<String>,
    output: String,
}

impl AcpTurnBuffer {
    fn begin_turn(&mut self, session_id: &acp::SessionId) {
        self.active_session_id = Some(session_id.to_string());
        self.output.clear();
    }

    fn append_text(&mut self, session_id: &acp::SessionId, value: &str) {
        let session_id_text = session_id.to_string();
        if self.active_session_id.as_deref() != Some(session_id_text.as_str()) {
            return;
        }

        if self.output.is_empty() {
            self.output.push_str(value);
            return;
        }

        if self.output.ends_with(char::is_whitespace) || value.starts_with(char::is_whitespace) {
            self.output.push_str(value);
            return;
        }

        self.output.push('\n');
        self.output.push_str(value);
    }

    fn finish_turn(&mut self) -> String {
        self.active_session_id = None;
        std::mem::take(&mut self.output).trim().to_string()
    }
}

#[derive(Clone)]
struct AcpClientHandler {
    turn_buffer: Rc<RefCell<AcpTurnBuffer>>,
}

#[async_trait(?Send)]
impl acp::Client for AcpClientHandler {
    async fn request_permission(
        &self,
        args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        if let Some(option) = args
            .options
            .iter()
            .find(|option| option.kind == acp::PermissionOptionKind::AllowOnce)
        {
            return Ok(acp::RequestPermissionResponse::new(
                acp::RequestPermissionOutcome::Selected(acp::SelectedPermissionOutcome::new(
                    option.option_id.clone(),
                )),
            ));
        }

        if let Some(option) = args
            .options
            .iter()
            .find(|option| option.kind == acp::PermissionOptionKind::RejectOnce)
        {
            return Ok(acp::RequestPermissionResponse::new(
                acp::RequestPermissionOutcome::Selected(acp::SelectedPermissionOutcome::new(
                    option.option_id.clone(),
                )),
            ));
        }

        Ok(acp::RequestPermissionResponse::new(
            acp::RequestPermissionOutcome::Cancelled,
        ))
    }

    async fn session_notification(&self, args: acp::SessionNotification) -> acp::Result<()> {
        let mut turn_buffer = self.turn_buffer.borrow_mut();
        match args.update {
            acp::SessionUpdate::AgentMessageChunk(chunk) => {
                if let Some(text) = acp_content_block_text(&chunk.content) {
                    turn_buffer.append_text(&args.session_id, &text);
                }
            }
            _ => {}
        }

        Ok(())
    }
}

struct AcpWorkerSession {
    connection: acp::ClientSideConnection,
    _child: tokio::process::Child,
    session_id: acp::SessionId,
    turn_buffer: Rc<RefCell<AcpTurnBuffer>>,
}

impl AcpSessionHandle {
    fn spawn(config: AcpInvocationConfig) -> Self {
        let (sender, mut receiver) = mpsc::unbounded_channel::<AcpPromptJob>();
        let in_flight = Arc::new(AtomicUsize::new(0));

        std::thread::spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    while let Some(job) = receiver.blocking_recv() {
                        let _ = job
                            .response_tx
                            .send(Err(format!("Failed to start ACP runtime: {}", error)));
                    }
                    return;
                }
            };

            let local_set = LocalSet::new();
            local_set.block_on(&runtime, async move {
                let mut session: Option<AcpWorkerSession> = None;

                while let Some(job) = receiver.recv().await {
                    if session.is_none() {
                        match connect_acp_session(&config).await {
                            Ok(connected) => {
                                session = Some(connected);
                            }
                            Err(error) => {
                                let _ = job.response_tx.send(Err(error));
                                break;
                            }
                        }
                    }

                    let result = if let Some(active_session) = session.as_ref() {
                        run_acp_worker_prompt(active_session, &job.prompt).await
                    } else {
                        Err("ACP session is unavailable.".to_string())
                    };

                    if result.is_err() {
                        session = None;
                    }

                    let _ = job.response_tx.send(result);
                }
            });
        });

        Self { sender, in_flight }
    }

    fn load(&self) -> usize {
        self.in_flight.load(Ordering::Relaxed)
    }

    async fn prompt(&self, prompt: String) -> Result<String, String> {
        self.in_flight.fetch_add(1, Ordering::Relaxed);
        let (response_tx, response_rx) = oneshot::channel();
        if self
            .sender
            .send(AcpPromptJob {
                prompt,
                response_tx,
            })
            .is_err()
        {
            self.in_flight.fetch_sub(1, Ordering::Relaxed);
            return Err("ACP session is no longer available.".to_string());
        }

        let result = response_rx
            .await
            .map_err(|_| "ACP session closed before producing a response.".to_string());
        self.in_flight.fetch_sub(1, Ordering::Relaxed);
        result?
    }
}

impl AcpSessionManagerState {
    fn get_or_create(&self, config: &AcpInvocationConfig) -> AcpSessionHandle {
        let mut sessions = self
            .sessions
            .lock()
            .expect("ACP session manager lock poisoned");

        let pool = sessions
            .entry(config.session_key.clone())
            .or_insert_with(AcpSessionPool::default);

        if pool.handles.is_empty() {
            let handle = AcpSessionHandle::spawn(config.clone());
            pool.handles.push(handle.clone());
            return handle;
        }

        let min_load = pool
            .handles
            .iter()
            .map(AcpSessionHandle::load)
            .min()
            .unwrap_or(0);

        if min_load > 0 && pool.handles.len() < ACP_SESSION_POOL_MAX_SIZE {
            let handle = AcpSessionHandle::spawn(config.clone());
            pool.handles.push(handle.clone());
            pool.next_index = 0;
            return handle;
        }

        let start_index = pool.next_index % pool.handles.len();
        let relative_index = (0..pool.handles.len())
            .find(|offset| {
                pool.handles[(start_index + *offset) % pool.handles.len()].load() == min_load
            })
            .unwrap_or(0);
        let selected_index = (start_index + relative_index) % pool.handles.len();
        pool.next_index = (selected_index + 1) % pool.handles.len();
        pool.handles[selected_index].clone()
    }

    fn remove(&self, session_key: &str) {
        let mut sessions = self
            .sessions
            .lock()
            .expect("ACP session manager lock poisoned");
        sessions.remove(session_key);
    }

    fn clear(&self) {
        let mut sessions = self
            .sessions
            .lock()
            .expect("ACP session manager lock poisoned");
        sessions.clear();
    }
}

fn acp_content_block_text(content: &acp::ContentBlock) -> Option<String> {
    match content {
        acp::ContentBlock::Text(text) => Some(text.text.clone()),
        _ => None,
    }
}

fn pick_safe_session_mode(modes: &acp::SessionModeState) -> Option<acp::SessionModeId> {
    let preferred_fragments = ["plan", "read", "review", "ask"];

    preferred_fragments.iter().find_map(|fragment| {
        modes.available_modes.iter().find_map(|mode| {
            let id = mode.id.to_string().to_ascii_lowercase();
            let name = mode.name.to_ascii_lowercase();
            if id.contains(fragment) || name.contains(fragment) {
                Some(mode.id.clone())
            } else {
                None
            }
        })
    })
}

fn validate_acp_cwd(cwd: Option<String>) -> Result<PathBuf, String> {
    let path = if let Some(value) = cwd {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            std::env::current_dir()
                .map_err(|error| format!("Failed to resolve current directory: {}", error))?
        } else {
            PathBuf::from(trimmed)
        }
    } else {
        std::env::current_dir()
            .map_err(|error| format!("Failed to resolve current directory: {}", error))?
    };

    if !path.is_absolute() {
        return Err("ACP working directory must be an absolute path.".to_string());
    }

    if !path.exists() || !path.is_dir() {
        return Err(format!(
            "ACP working directory does not exist or is not a directory: {}",
            path.display()
        ));
    }

    Ok(path)
}

fn normalize_acp_invocation(
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<AcpInvocationConfig, String> {
    let normalized_command = command.trim().to_string();
    if normalized_command.is_empty() {
        return Err("ACP agent command cannot be empty.".to_string());
    }

    let normalized_args = args
        .into_iter()
        .map(|arg| arg.trim().to_string())
        .filter(|arg| !arg.is_empty())
        .collect::<Vec<_>>();
    let cwd = validate_acp_cwd(cwd)?;
    let session_key = format!(
        "{}\u{001f}{}\u{001f}{}",
        normalized_command,
        normalized_args.join("\u{001f}"),
        cwd.display()
    );

    Ok(AcpInvocationConfig {
        command: normalized_command,
        args: normalized_args,
        cwd,
        session_key,
    })
}

fn is_default_claude_acp_command(command: &str) -> bool {
    matches!(command.trim(), "claude-code-acp" | "claude-agent-acp")
}

fn is_executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        return std::fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
    }

    #[cfg(not(unix))]
    {
        true
    }
}

fn resolve_executable(program: &str) -> Option<PathBuf> {
    let trimmed = program.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.contains('/') || trimmed.contains('\\') {
        let candidate = PathBuf::from(trimmed);
        return if is_executable_file(&candidate) {
            Some(candidate)
        } else {
            None
        };
    }

    let mut candidates = path_entries();

    if let Some(home_value) = std::env::var_os("HOME") {
        let home_path = PathBuf::from(home_value);
        for directory in preferred_cm_directories(&home_path) {
            if candidates.iter().all(|existing| existing != &directory) {
                candidates.push(directory);
            }
        }
    }

    for directory in candidates {
        let candidate = directory.join(trimmed);
        if is_executable_file(&candidate) {
            return Some(candidate);
        }
    }

    None
}

fn build_acp_child(
    program: impl AsRef<std::ffi::OsStr>,
    args: &[String],
) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(program);
    command
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .kill_on_drop(true);
    command
}

fn spawn_acp_child(config: &AcpInvocationConfig) -> Result<tokio::process::Child, String> {
    let primary_program =
        resolve_executable(&config.command).unwrap_or_else(|| PathBuf::from(&config.command));
    let mut primary_command = build_acp_child(&primary_program, &config.args);
    match primary_command.spawn() {
        Ok(child) => Ok(child),
        Err(primary_error)
            if primary_error.kind() == std::io::ErrorKind::NotFound
                && is_default_claude_acp_command(&config.command) =>
        {
            let mut fallback_args = vec![
                "-y".to_string(),
                "@zed-industries/claude-agent-acp".to_string(),
            ];
            fallback_args.extend(config.args.iter().cloned());
            let fallback_program =
                resolve_executable("npx").unwrap_or_else(|| PathBuf::from("npx"));
            let mut fallback_command = build_acp_child(&fallback_program, &fallback_args);
            fallback_command.spawn().map_err(|fallback_error| {
                format!(
                    "Failed to start ACP agent '{}': {}. Tried fallback 'npx -y @zed-industries/claude-agent-acp' and that also failed: {}.",
                    config.command, primary_error, fallback_error
                )
            })
        }
        Err(error) => Err(format!(
            "Failed to start ACP agent '{}': {}. Ensure it is installed and on your PATH.",
            config.command, error
        )),
    }
}

async fn connect_acp_session(config: &AcpInvocationConfig) -> Result<AcpWorkerSession, String> {
    let mut child = spawn_acp_child(config)?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture ACP agent stdin.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture ACP agent stdout.".to_string())?;

    let turn_buffer = Rc::new(RefCell::new(AcpTurnBuffer::default()));
    let (connection, io_task) = acp::ClientSideConnection::new(
        AcpClientHandler {
            turn_buffer: turn_buffer.clone(),
        },
        stdin.compat_write(),
        stdout.compat(),
        |future| {
            tokio::task::spawn_local(future);
        },
    );

    tokio::task::spawn_local(async move {
        let _ = io_task.await;
    });

    let initialize_response = connection
        .initialize(
            acp::InitializeRequest::new(acp::ProtocolVersion::V1)
                .client_capabilities(
                    acp::ClientCapabilities::new()
                        .fs(acp::FileSystemCapabilities::new())
                        .terminal(false),
                )
                .client_info(
                    acp::Implementation::new("checkmate-desktop", env!("CARGO_PKG_VERSION"))
                        .title("checkmate.sh"),
                ),
        )
        .await
        .map_err(|error| format!("Failed to initialize ACP session: {}", error))?;

    if initialize_response.protocol_version != acp::ProtocolVersion::V1 {
        return Err(format!(
            "Unsupported ACP protocol version returned by agent: {:?}",
            initialize_response.protocol_version
        ));
    }

    let new_session_response = connection
        .new_session(acp::NewSessionRequest::new(config.cwd.clone()))
        .await
        .map_err(|error| format!("Failed to create ACP session: {}", error))?;

    if let Some(modes) = new_session_response.modes.as_ref() {
        if let Some(mode_id) = pick_safe_session_mode(modes) {
            let _ = connection
                .set_session_mode(acp::SetSessionModeRequest::new(
                    new_session_response.session_id.clone(),
                    mode_id,
                ))
                .await;
        }
    }

    Ok(AcpWorkerSession {
        connection,
        _child: child,
        session_id: new_session_response.session_id,
        turn_buffer,
    })
}

async fn run_acp_worker_prompt(session: &AcpWorkerSession, prompt: &str) -> Result<String, String> {
    session
        .turn_buffer
        .borrow_mut()
        .begin_turn(&session.session_id);

    let response = session
        .connection
        .prompt(acp::PromptRequest::new(
            session.session_id.clone(),
            vec![prompt.to_string().into()],
        ))
        .await
        .map_err(|error| format!("ACP prompt failed: {}", error))?;

    let output = session.turn_buffer.borrow_mut().finish_turn();

    match response.stop_reason {
        acp::StopReason::Cancelled => Err("ACP prompt was cancelled.".to_string()),
        acp::StopReason::Refusal => {
            if output.is_empty() {
                Err("ACP agent refused the request.".to_string())
            } else {
                Err(format!("ACP agent refused the request: {}", output))
            }
        }
        acp::StopReason::EndTurn
        | acp::StopReason::MaxTokens
        | acp::StopReason::MaxTurnRequests => {
            if output.is_empty() {
                Err("ACP agent returned no text output.".to_string())
            } else {
                Ok(output)
            }
        }
        _ => {
            if output.is_empty() {
                Err("ACP prompt ended without usable text output.".to_string())
            } else {
                Ok(output)
            }
        }
    }
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
pub struct AgentTrackingInitializationResult {
    pub agent_file_created: bool,
    pub agent_file_updated: bool,
    pub agent_reference_file_created: bool,
    pub agent_reference_file_updated: bool,
    pub schema_file_created: bool,
    pub schema_file_updated: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTrackingStatus {
    pub enabled: bool,
    pub has_tracking_block: bool,
    pub has_agent_reference: bool,
    pub has_commit_context_schema: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTrackingRemovalResult {
    pub removed: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentImageStorageResult {
    pub image_ref: String,
    pub markdown_url: String,
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
pub struct ReviewCommitFeed {
    pub recent_commits: Vec<CommitListItem>,
    pub branch_only_commits: Vec<CommitListItem>,
    pub mainline_reference: Option<String>,
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

fn append_text_block(existing: &str, block: &str) -> String {
    let mut updated = existing.to_string();

    if !updated.is_empty() && !updated.ends_with('\n') {
        updated.push('\n');
    }

    if !updated.trim().is_empty() {
        updated.push('\n');
    }

    updated.push_str(block);

    if !updated.ends_with('\n') {
        updated.push('\n');
    }

    updated
}

fn tracking_block() -> String {
    format!(
        "{}\n{}\n{}",
        AGENT_TRACKING_BLOCK_START, AGENT_TRACKING_BLOCK_BODY, AGENT_TRACKING_BLOCK_END
    )
}

fn ensure_agent_tracking_file(repository_path: &Path) -> Result<(bool, bool), String> {
    let agent_path = repository_path.join("AGENT.md");
    let block = tracking_block();

    if !agent_path.exists() {
        let content = format!("# AGENT.md\n\n{}\n", block);
        std::fs::write(&agent_path, content)
            .map_err(|error| format!("Failed to write {}: {}", agent_path.display(), error))?;
        return Ok((true, false));
    }

    let existing = std::fs::read_to_string(&agent_path)
        .map_err(|error| format!("Failed to read {}: {}", agent_path.display(), error))?;

    if existing.contains(AGENT_TRACKING_BLOCK_START) && existing.contains(AGENT_TRACKING_BLOCK_END)
    {
        return Ok((false, false));
    }

    let updated = append_text_block(&existing, &block);
    std::fs::write(&agent_path, updated)
        .map_err(|error| format!("Failed to update {}: {}", agent_path.display(), error))?;

    Ok((false, true))
}

fn contains_agent_reference(content: &str) -> bool {
    content
        .lines()
        .any(|line| line.to_ascii_lowercase().contains("@agent.md"))
}

fn ensure_agent_reference_file(repository_path: &Path) -> Result<(bool, bool), String> {
    let claude_path = repository_path.join("CLAUDE.md");

    if !claude_path.exists() {
        std::fs::write(&claude_path, "@AGENT.md\n")
            .map_err(|error| format!("Failed to write {}: {}", claude_path.display(), error))?;
        return Ok((true, false));
    }

    let existing = std::fs::read_to_string(&claude_path)
        .map_err(|error| format!("Failed to read {}: {}", claude_path.display(), error))?;

    if contains_agent_reference(&existing) {
        return Ok((false, false));
    }

    let updated = append_text_block(&existing, "@AGENT.md");
    std::fs::write(&claude_path, updated)
        .map_err(|error| format!("Failed to update {}: {}", claude_path.display(), error))?;

    Ok((false, true))
}

fn ensure_commit_context_schema_file(repository_path: &Path) -> Result<(bool, bool), String> {
    let schema_path = repository_path.join(AGENT_TRACKING_SCHEMA_RELATIVE_PATH);

    if let Some(parent) = schema_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {}", parent.display(), error))?;
    }

    if !schema_path.exists() {
        std::fs::write(&schema_path, AGENT_TRACKING_SCHEMA_JSON)
            .map_err(|error| format!("Failed to write {}: {}", schema_path.display(), error))?;
        return Ok((true, false));
    }

    let existing = std::fs::read_to_string(&schema_path)
        .map_err(|error| format!("Failed to read {}: {}", schema_path.display(), error))?;

    if existing.trim() == AGENT_TRACKING_SCHEMA_JSON.trim() {
        return Ok((false, false));
    }

    if existing.contains(AGENT_TRACKING_SCHEMA_MANAGED_MARKER) {
        std::fs::write(&schema_path, AGENT_TRACKING_SCHEMA_JSON)
            .map_err(|error| format!("Failed to update {}: {}", schema_path.display(), error))?;
        return Ok((false, true));
    }

    Ok((false, false))
}

fn has_agent_tracking_block(content: &str) -> bool {
    content.contains(AGENT_TRACKING_BLOCK_START) && content.contains(AGENT_TRACKING_BLOCK_END)
}

fn is_agent_reference_line(line: &str) -> bool {
    line.trim()
        .to_ascii_lowercase()
        .replace(' ', "")
        .eq("@agent.md")
}

fn remove_agent_tracking_block(repository_path: &Path) -> Result<bool, String> {
    let agent_path = repository_path.join("AGENT.md");
    if !agent_path.exists() {
        return Ok(false);
    }

    let existing = std::fs::read_to_string(&agent_path)
        .map_err(|error| format!("Failed to read {}: {}", agent_path.display(), error))?;

    if !has_agent_tracking_block(&existing) {
        return Ok(false);
    }

    let mut skip = false;
    let mut kept_lines: Vec<&str> = Vec::new();
    for line in existing.lines() {
        let trimmed = line.trim_end();
        if trimmed == AGENT_TRACKING_BLOCK_START {
            skip = true;
            continue;
        }
        if trimmed == AGENT_TRACKING_BLOCK_END {
            skip = false;
            continue;
        }
        if !skip {
            kept_lines.push(line);
        }
    }

    let mut updated = kept_lines.join("\n");
    if existing.ends_with('\n') && !updated.ends_with('\n') {
        updated.push('\n');
    }

    if updated == existing {
        return Ok(false);
    }

    std::fs::write(&agent_path, updated)
        .map_err(|error| format!("Failed to update {}: {}", agent_path.display(), error))?;
    Ok(true)
}

fn remove_agent_reference_file(repository_path: &Path) -> Result<bool, String> {
    let claude_path = repository_path.join("CLAUDE.md");
    if !claude_path.exists() {
        return Ok(false);
    }

    let existing = std::fs::read_to_string(&claude_path)
        .map_err(|error| format!("Failed to read {}: {}", claude_path.display(), error))?;

    let kept_lines: Vec<&str> = existing
        .lines()
        .filter(|line| !is_agent_reference_line(line))
        .collect();

    let mut updated = kept_lines.join("\n");
    if existing.ends_with('\n') && !updated.ends_with('\n') {
        updated.push('\n');
    }

    if updated == existing {
        return Ok(false);
    }

    std::fs::write(&claude_path, updated)
        .map_err(|error| format!("Failed to update {}: {}", claude_path.display(), error))?;
    Ok(true)
}

fn remove_managed_schema(repository_path: &Path) -> Result<bool, String> {
    let schema_path = repository_path.join(AGENT_TRACKING_SCHEMA_RELATIVE_PATH);
    if !schema_path.exists() {
        return Ok(false);
    }

    let existing = std::fs::read_to_string(&schema_path)
        .map_err(|error| format!("Failed to read {}: {}", schema_path.display(), error))?;
    if !existing.contains(AGENT_TRACKING_SCHEMA_MANAGED_MARKER) {
        return Ok(false);
    }

    std::fs::remove_file(&schema_path)
        .map_err(|error| format!("Failed to remove {}: {}", schema_path.display(), error))?;
    Ok(true)
}

fn remove_managed_enforcement(repository_path: &Path) -> Result<bool, String> {
    let enforcement_path = repository_path.join(".checkmate/enforcement.json");
    if !enforcement_path.exists() {
        return Ok(false);
    }

    let existing = std::fs::read_to_string(&enforcement_path)
        .map_err(|error| format!("Failed to read {}: {}", enforcement_path.display(), error))?;
    if !existing.contains("\"x-checkmate-managed\": true") {
        return Ok(false);
    }

    std::fs::remove_file(&enforcement_path)
        .map_err(|error| format!("Failed to remove {}: {}", enforcement_path.display(), error))?;
    Ok(true)
}

fn remove_managed_hooks_fallback(repository_path: &Path) -> Result<bool, String> {
    let mut changed = false;

    let hooks_path_args = vec![
        "config".to_string(),
        "--local".to_string(),
        "--get".to_string(),
        "core.hooksPath".to_string(),
    ];
    let local_hooks_path = run_git_optional(repository_path, &hooks_path_args)?
        .map(|value| value.trim().to_string())
        .unwrap_or_default();

    if local_hooks_path == ".githooks" {
        let unset_args = vec![
            "config".to_string(),
            "--local".to_string(),
            "--unset".to_string(),
            "core.hooksPath".to_string(),
        ];
        let _ = run_git_optional(repository_path, &unset_args)?;
        changed = true;
    }

    let tracked_hook_args = vec![
        "ls-files".to_string(),
        "--error-unmatch".to_string(),
        ".githooks/commit-msg".to_string(),
    ];
    let tracked_hook_exists = run_git_optional(repository_path, &tracked_hook_args)?
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    let hook_path = repository_path.join(".githooks/commit-msg");
    if !tracked_hook_exists && hook_path.exists() {
        let hook_content = std::fs::read_to_string(&hook_path)
            .map_err(|error| format!("Failed to read {}: {}", hook_path.display(), error))?;
        if hook_content.contains("# checkmate-managed: commit-msg-hook-v1") {
            std::fs::remove_file(&hook_path)
                .map_err(|error| format!("Failed to remove {}: {}", hook_path.display(), error))?;
            changed = true;
        }
    }

    Ok(changed)
}

fn run_hooks_remove_script_if_present(repository_path: &Path) {
    let hooks_script = repository_path.join("scripts/install-git-hooks.sh");
    if !hooks_script.is_file() {
        return;
    }

    let _ = Command::new("bash")
        .arg(hooks_script)
        .arg("--remove")
        .current_dir(repository_path)
        .output();
}

fn remove_directory_if_empty(path: &Path) {
    if !path.exists() {
        return;
    }

    let _ = std::fs::remove_dir(path);
}

fn tracking_status_for_repository(repository_path: &Path) -> Result<AgentTrackingStatus, String> {
    let agent_path = repository_path.join("AGENT.md");
    let has_tracking_block = if agent_path.exists() {
        let content = std::fs::read_to_string(&agent_path)
            .map_err(|error| format!("Failed to read {}: {}", agent_path.display(), error))?;
        has_agent_tracking_block(&content)
    } else {
        false
    };

    let claude_path = repository_path.join("CLAUDE.md");
    let has_agent_reference = if claude_path.exists() {
        let content = std::fs::read_to_string(&claude_path)
            .map_err(|error| format!("Failed to read {}: {}", claude_path.display(), error))?;
        contains_agent_reference(&content)
    } else {
        false
    };

    let schema_path = repository_path.join(AGENT_TRACKING_SCHEMA_RELATIVE_PATH);
    let has_commit_context_schema = schema_path.exists();

    Ok(AgentTrackingStatus {
        enabled: has_tracking_block && has_agent_reference && has_commit_context_schema,
        has_tracking_block,
        has_agent_reference,
        has_commit_context_schema,
    })
}

const COMMENT_IMAGE_URL_PREFIX: &str = "checkmate-image://";
const COMMENT_IMAGE_DIRECTORY: &str = "comment-images";
const APPLICATION_LOG_FILE_NAME: &str = "application_logs.log";

fn resolve_comment_images_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {}", error))?;

    let image_dir = app_data_dir.join(COMMENT_IMAGE_DIRECTORY);
    std::fs::create_dir_all(&image_dir)
        .map_err(|error| format!("Failed to create comment image directory: {}", error))?;
    Ok(image_dir)
}

fn resolve_application_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {}", error))?;
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Failed to create app data directory: {}", error))?;
    Ok(app_data_dir.join(APPLICATION_LOG_FILE_NAME))
}

fn sanitize_log_value(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\t', "\\t")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

fn preview_for_log(value: &str, max_chars: usize) -> String {
    let normalized = value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .replace('\n', "\\n");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }

    let mut clipped = String::new();
    for character in normalized.chars().take(max_chars.saturating_sub(1)) {
        clipped.push(character);
    }
    clipped.push('…');
    clipped
}

fn append_application_log_line(
    app: &tauri::AppHandle,
    source: &str,
    event: &str,
    message: &str,
    fields_json: Option<&str>,
) -> Result<(), String> {
    let normalized_source = source.trim();
    if !normalized_source.starts_with("frontend_") && !normalized_source.starts_with("backend_") {
        return Err("Log source must begin with `frontend_` or `backend_`.".to_string());
    }

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    let log_path = resolve_application_log_path(app)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("Failed to open application log file: {}", error))?;

    let mut line = format!(
        "{}\t{}\t{}\t{}",
        timestamp_ms,
        sanitize_log_value(normalized_source),
        sanitize_log_value(event.trim()),
        sanitize_log_value(message.trim()),
    );

    if let Some(raw_fields) = fields_json {
        let normalized_fields = raw_fields.trim();
        if !normalized_fields.is_empty() {
            line.push('\t');
            line.push_str(normalized_fields);
        }
    }

    line.push('\n');
    file.write_all(line.as_bytes())
        .map_err(|error| format!("Failed to append application log line: {}", error))?;
    Ok(())
}

fn extension_for_mime_type(mime_type: &str) -> Option<&'static str> {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        "image/tiff" | "image/tif" => Some("tiff"),
        _ => None,
    }
}

fn mime_type_for_extension(extension: &str) -> &'static str {
    match extension.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "tiff" | "tif" => "image/tiff",
        _ => "application/octet-stream",
    }
}

fn validate_comment_image_ref(image_ref: &str) -> Result<String, String> {
    let trimmed = image_ref.trim();
    if trimmed.is_empty() {
        return Err("Image reference is required.".to_string());
    }

    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-')
    {
        return Err("Image reference contains unsupported characters.".to_string());
    }

    Ok(trimmed.to_string())
}

fn build_comment_image_ref(extension: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("img-{}-{}.{}", std::process::id(), timestamp, extension)
}

fn cm_script_contents() -> String {
    format!(
        r#"#!/usr/bin/env bash
set -euo pipefail

MODE="open"
if [[ $# -gt 0 ]]; then
  case "$1" in
    init)
      MODE="init"
      shift
      ;;
    remove)
      MODE="remove"
      shift
      ;;
  esac
fi

print_usage() {{
  cat <<'USAGE'
Usage:
  cm [path]
  cm [path] --commit <ref>
  cm [path] --draft
  cm init [path] [--enforcement <off|basic|strict>]
  cm remove [path]

Examples:
  cm .
  cm . --draft
  cm init . --enforcement strict
  cm remove .
USAGE
}}

TARGET_PATH="."
COMMIT_REF="HEAD"
ENFORCEMENT_LEVEL="off"

if [[ "$MODE" == "init" ]]; then
  INIT_PATH_SET=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --enforcement)
        if [[ $# -lt 2 ]]; then
          echo "cm: missing value for --enforcement" >&2
          exit 1
        fi
        ENFORCEMENT_LEVEL="$2"
        shift 2
        ;;
      -h|--help)
        print_usage
        exit 0
        ;;
      *)
        if [[ $INIT_PATH_SET -eq 1 ]]; then
          echo "cm: too many arguments for init" >&2
          exit 1
        fi
        TARGET_PATH="$1"
        INIT_PATH_SET=1
        shift
        ;;
    esac
  done
elif [[ "$MODE" == "remove" ]]; then
  REMOVE_PATH_SET=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        print_usage
        exit 0
        ;;
      *)
        if [[ $REMOVE_PATH_SET -eq 1 ]]; then
          echo "cm: too many arguments for remove" >&2
          exit 1
        fi
        TARGET_PATH="$1"
        REMOVE_PATH_SET=1
        shift
        ;;
    esac
  done
else
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
        print_usage
        exit 0
        ;;
      *)
        TARGET_PATH="$1"
        shift
        ;;
    esac
  done
fi

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

if [[ "$MODE" == "init" ]]; then
  case "$ENFORCEMENT_LEVEL" in
    off|basic|strict) ;;
    *)
      echo "cm: unsupported enforcement level '$ENFORCEMENT_LEVEL' (expected off|basic|strict)" >&2
      exit 1
      ;;
  esac
fi

if [[ "$MODE" == "init" ]]; then
  ensure_agent_file() {{
    local agent_file="$REPO_PATH/AGENT.md"
    if [[ ! -f "$agent_file" ]]; then
      printf '# AGENT.md\n\n' > "$agent_file"
      cat <<'BLOCK' >> "$agent_file"
{agent_block_start}
{agent_block_body}
{agent_block_end}
BLOCK
      printf '\n' >> "$agent_file"
      return
    fi

    if grep -Fq '{agent_block_start}' "$agent_file"; then
      return
    fi

    printf '\n\n' >> "$agent_file"
    cat <<'BLOCK' >> "$agent_file"
{agent_block_start}
{agent_block_body}
{agent_block_end}
BLOCK
    printf '\n' >> "$agent_file"
  }}

  ensure_agent_reference_file() {{
    local claude_file="$REPO_PATH/CLAUDE.md"
    if [[ ! -f "$claude_file" ]]; then
      printf '@AGENT.md\n' > "$claude_file"
      return
    fi

    if grep -Eiq '@[[:space:]]*AGENT\.md' "$claude_file"; then
      return
    fi

    printf '\n@AGENT.md\n' >> "$claude_file"
  }}

  ensure_schema_file() {{
    local schema_dir="$REPO_PATH/.checkmate"
    local schema_file="$schema_dir/commit_context.schema.json"
    mkdir -p "$schema_dir"

    if [[ -f "$schema_file" ]] && ! grep -Fq '{schema_managed_marker}' "$schema_file"; then
      return
    fi

    cat <<'SCHEMA' > "$schema_file"
{commit_context_schema}
SCHEMA
  }}

  ensure_agent_file
  ensure_agent_reference_file
  ensure_schema_file
  hooks_script="$REPO_PATH/scripts/install-git-hooks.sh"
  if [[ -f "$hooks_script" ]]; then
    if [[ -x "$hooks_script" ]]; then
      "$hooks_script" --level "$ENFORCEMENT_LEVEL"
    else
      bash "$hooks_script" --level "$ENFORCEMENT_LEVEL"
    fi
  elif [[ "$ENFORCEMENT_LEVEL" != "off" ]]; then
    echo "cm: warning: scripts/install-git-hooks.sh not found; enforcement setup skipped." >&2
  fi

  echo "cm: tracking initialized for $REPO_PATH (enforcement: $ENFORCEMENT_LEVEL)"
  exit 0
fi

if [[ "$MODE" == "remove" ]]; then
  remove_agent_block() {{
    local agent_file="$REPO_PATH/AGENT.md"
    if [[ ! -f "$agent_file" ]] || ! grep -Fq '{agent_block_start}' "$agent_file"; then
      return
    fi

    local tmp_file
    tmp_file="$(mktemp)"
    local skip=0
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" == '{agent_block_start}' ]]; then
        skip=1
        continue
      fi
      if [[ "$line" == '{agent_block_end}' ]]; then
        skip=0
        continue
      fi
      if [[ $skip -eq 0 ]]; then
        printf '%s\n' "$line" >> "$tmp_file"
      fi
    done < "$agent_file"
    mv "$tmp_file" "$agent_file"
  }}

  remove_agent_reference_file() {{
    local claude_file="$REPO_PATH/CLAUDE.md"
    if [[ ! -f "$claude_file" ]]; then
      return
    fi

    local tmp_file
    tmp_file="$(mktemp)"
    grep -Eiv '^[[:space:]]*@[[:space:]]*AGENT\.md[[:space:]]*$' "$claude_file" > "$tmp_file" || true
    mv "$tmp_file" "$claude_file"
  }}

  remove_managed_schema() {{
    local schema_file="$REPO_PATH/.checkmate/commit_context.schema.json"
    if [[ -f "$schema_file" ]] && grep -Fq '{schema_managed_marker}' "$schema_file"; then
      rm -f "$schema_file"
    fi
  }}

  remove_managed_enforcement() {{
    local enforcement_file="$REPO_PATH/.checkmate/enforcement.json"
    if [[ -f "$enforcement_file" ]] && grep -Fq '"x-checkmate-managed": true' "$enforcement_file"; then
      rm -f "$enforcement_file"
    fi
  }}

  remove_managed_hooks_fallback() {{
    local hooks_path
    hooks_path="$(git -C "$REPO_PATH" config --local --get core.hooksPath || true)"
    if [[ "$hooks_path" == ".githooks" ]]; then
      git -C "$REPO_PATH" config --local --unset core.hooksPath || true
    fi

    if git -C "$REPO_PATH" ls-files --error-unmatch ".githooks/commit-msg" >/dev/null 2>&1; then
      return
    fi

    local hook_file="$REPO_PATH/.githooks/commit-msg"
    if [[ -f "$hook_file" ]] && grep -Fq '# checkmate-managed: commit-msg-hook-v1' "$hook_file"; then
      rm -f "$hook_file"
    fi
  }}

  hooks_script="$REPO_PATH/scripts/install-git-hooks.sh"
  if [[ -f "$hooks_script" ]]; then
    if [[ -x "$hooks_script" ]]; then
      "$hooks_script" --remove || true
    else
      bash "$hooks_script" --remove || true
    fi
  else
    remove_managed_hooks_fallback
  fi

  remove_agent_block
  remove_agent_reference_file
  remove_managed_schema
  remove_managed_enforcement
  rmdir "$REPO_PATH/.githooks" >/dev/null 2>&1 || true
  rmdir "$REPO_PATH/.checkmate" >/dev/null 2>&1 || true

  echo "cm: tracking removed for $REPO_PATH"
  exit 0
fi

if ! open -nb "{bundle_id}" --args --repo "$REPO_PATH" --commit "$COMMIT_REF" >/dev/null 2>&1; then
  open -na "{app_name}" --args --repo "$REPO_PATH" --commit "$COMMIT_REF"
fi
"#,
        worktree_ref = WORKTREE_COMMIT_REFERENCE,
        agent_block_start = AGENT_TRACKING_BLOCK_START,
        agent_block_body = AGENT_TRACKING_BLOCK_BODY,
        agent_block_end = AGENT_TRACKING_BLOCK_END,
        schema_managed_marker = AGENT_TRACKING_SCHEMA_MANAGED_MARKER,
        commit_context_schema = AGENT_TRACKING_SCHEMA_JSON,
        bundle_id = CM_APP_BUNDLE_IDENTIFIER,
        app_name = CM_APP_NAME
    )
}

fn parse_commit_list_items(output: &str) -> Vec<CommitListItem> {
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

    commits
}

fn read_commit_list_items(
    repository_path: &Path,
    max_count: usize,
    range: Option<&str>,
) -> Result<Vec<CommitListItem>, String> {
    let pretty_format = format!(
        "--pretty=format:%H{}%h{}%an{}%ae{}%aI{}%s",
        COMMIT_FIELD_DELIMITER,
        COMMIT_FIELD_DELIMITER,
        COMMIT_FIELD_DELIMITER,
        COMMIT_FIELD_DELIMITER,
        COMMIT_FIELD_DELIMITER
    );
    let mut args = vec!["log".to_string()];

    if let Some(trimmed_range) = range
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        args.push(trimmed_range.to_string());
    }

    args.push(format!("--max-count={}", max_count.clamp(1, 500)));
    args.push("--date=iso-strict".to_string());
    args.push(pretty_format);

    let output = run_git(repository_path, &args)?;
    Ok(parse_commit_list_items(&output))
}

fn git_reference_exists(repository_path: &Path, reference: &str) -> Result<bool, String> {
    let args = vec![
        "rev-parse".to_string(),
        "--verify".to_string(),
        reference.to_string(),
    ];
    let output = run_git_optional(repository_path, &args)?;
    Ok(output
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false))
}

fn resolve_mainline_reference(repository_path: &Path) -> Result<Option<String>, String> {
    let origin_head_args = vec![
        "symbolic-ref".to_string(),
        "--quiet".to_string(),
        "--short".to_string(),
        "refs/remotes/origin/HEAD".to_string(),
    ];

    if let Some(origin_head) = run_git_optional(repository_path, &origin_head_args)?
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        if git_reference_exists(repository_path, &origin_head)? {
            return Ok(Some(origin_head));
        }
    }

    let candidates = [
        "main",
        "master",
        "trunk",
        "origin/main",
        "origin/master",
        "origin/trunk",
        "upstream/main",
        "upstream/master",
        "upstream/trunk",
    ];

    for candidate in candidates {
        if git_reference_exists(repository_path, candidate)? {
            return Ok(Some(candidate.to_string()));
        }
    }

    Ok(None)
}

#[tauri::command]
fn list_commits(repo_path: String, limit: Option<usize>) -> Result<Vec<CommitListItem>, String> {
    let repository_path = validate_repository_path(&repo_path)?;
    let max_count = limit.unwrap_or(120).clamp(1, 500);
    read_commit_list_items(&repository_path, max_count, None)
}

#[tauri::command]
fn list_review_commits(
    repo_path: String,
    recent_limit: Option<usize>,
    branch_only_limit: Option<usize>,
) -> Result<ReviewCommitFeed, String> {
    let repository_path = validate_repository_path(&repo_path)?;
    let recent_max = recent_limit.unwrap_or(15).clamp(1, 200);
    let branch_only_max = branch_only_limit.unwrap_or(240).clamp(1, 500);

    let recent_commits = read_commit_list_items(&repository_path, recent_max, None)?;
    let mainline_reference = resolve_mainline_reference(&repository_path)?;

    let branch_only_commits = if let Some(mainline_ref) = &mainline_reference {
        let range = format!("{}..HEAD", mainline_ref);
        read_commit_list_items(&repository_path, branch_only_max, Some(&range))?
    } else {
        Vec::new()
    };

    Ok(ReviewCommitFeed {
        recent_commits,
        branch_only_commits,
        mainline_reference,
    })
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
async fn run_claude_prompt(app: tauri::AppHandle, prompt: String) -> Result<String, String> {
    let trimmed_prompt = prompt.trim();

    if trimmed_prompt.is_empty() {
        return Err("Claude prompt cannot be empty.".to_string());
    }

    let prompt_arg = trimmed_prompt.to_string();
    let started_at = SystemTime::now();
    let _ = append_application_log_line(
        &app,
        "backend_cli",
        "run_claude_prompt_start",
        &format!("prompt_len={}", prompt_arg.len()),
        None,
    );

    let result = tauri::async_runtime::spawn_blocking(move || {
        let resolved_program =
            resolve_executable("claude").unwrap_or_else(|| PathBuf::from("claude"));
        let output = Command::new(&resolved_program)
            .arg("-p")
            .arg(prompt_arg)
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
    })
    .await
    .map_err(|error| format!("Failed to join Claude CLI task: {}", error))?;

    let elapsed_ms = SystemTime::now()
        .duration_since(started_at)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    match &result {
        Ok(output) => {
            let _ = append_application_log_line(
                &app,
                "backend_cli",
                "run_claude_prompt_success",
                &format!("elapsed_ms={} output_len={}", elapsed_ms, output.len()),
                None,
            );
        }
        Err(error_message) => {
            let _ = append_application_log_line(
                &app,
                "backend_cli",
                "run_claude_prompt_error",
                &format!("elapsed_ms={} error={}", elapsed_ms, error_message),
                None,
            );
        }
    }

    result
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
fn read_system_username() -> Option<String> {
    ["USER", "USERNAME", "LOGNAME"]
        .into_iter()
        .find_map(|key| std::env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn read_clipboard_text_with_command(command: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(command)
        .args(args)
        .output()
        .map_err(|error| format!("Failed to run clipboard command '{}': {}", command, error))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err(format!("Clipboard command '{}' failed.", command));
        }
        return Err(format!(
            "Clipboard command '{}' failed: {}",
            command, stderr
        ));
    }

    String::from_utf8(output.stdout)
        .map(|value| value.trim_end_matches(['\r', '\n']).to_string())
        .map_err(|error| format!("Clipboard output is not valid UTF-8: {}", error))
}

#[tauri::command]
fn read_clipboard_text() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        return read_clipboard_text_with_command("pbpaste", &[]);
    }

    #[cfg(target_os = "windows")]
    {
        return read_clipboard_text_with_command(
            "powershell",
            &["-NoProfile", "-Command", "Get-Clipboard -Raw"],
        );
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        match read_clipboard_text_with_command("wl-paste", &["--no-newline"]) {
            Ok(value) => return Ok(value),
            Err(wl_error) => match read_clipboard_text_with_command(
                "xclip",
                &["-selection", "clipboard", "-out"],
            ) {
                Ok(value) => return Ok(value),
                Err(xclip_error) => {
                    return Err(format!(
                        "Unable to read clipboard text. wl-paste error: {}; xclip error: {}",
                        wl_error, xclip_error
                    ));
                }
            },
        }
    }

    #[allow(unreachable_code)]
    Err("Clipboard read is not supported on this platform.".to_string())
}

#[tauri::command]
async fn run_cli_agent_prompt(
    app: tauri::AppHandle,
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

    let command_name = trimmed_command.to_string();
    let prompt_arg = trimmed_prompt.to_string();
    let started_at = SystemTime::now();
    let _ = append_application_log_line(
        &app,
        "backend_cli",
        "run_cli_agent_prompt_start",
        &format!(
            "command={} args_count={} prompt_len={}",
            command_name,
            args.len(),
            prompt_arg.len()
        ),
        None,
    );

    let command_name_for_log = command_name.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let resolved_program =
            resolve_executable(&command_name).unwrap_or_else(|| PathBuf::from(&command_name));
        let output = Command::new(&resolved_program)
            .args(&args)
            .arg(prompt_arg)
            .output()
            .map_err(|error| {
                format!(
                    "Failed to run CLI agent '{}': {}. Ensure it is installed and on your PATH.",
                    command_name, error
                )
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if stderr.is_empty() {
                return Err(format!("CLI agent '{}' execution failed.", command_name));
            }

            return Err(stderr);
        }

        String::from_utf8(output.stdout)
            .map_err(|error| format!("CLI agent output was not valid UTF-8: {}", error))
    })
    .await
    .map_err(|error| format!("Failed to join CLI agent task: {}", error))?;

    let elapsed_ms = SystemTime::now()
        .duration_since(started_at)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    match &result {
        Ok(output) => {
            let fields_json = serde_json::json!({
                "outputLen": output.len(),
                "outputPreview": preview_for_log(output, 260),
            })
            .to_string();
            let _ = append_application_log_line(
                &app,
                "backend_cli",
                "run_cli_agent_prompt_success",
                &format!(
                    "command={} elapsed_ms={} output_len={}",
                    command_name_for_log,
                    elapsed_ms,
                    output.len()
                ),
                Some(&fields_json),
            );
        }
        Err(error_message) => {
            let _ = append_application_log_line(
                &app,
                "backend_cli",
                "run_cli_agent_prompt_error",
                &format!(
                    "command={} elapsed_ms={} error={}",
                    command_name_for_log, elapsed_ms, error_message
                ),
                None,
            );
        }
    }

    result
}

#[tauri::command]
async fn run_acp_agent_prompt(
    app: tauri::AppHandle,
    state: tauri::State<'_, AcpSessionManagerState>,
    command: String,
    args: Vec<String>,
    prompt: String,
    cwd: Option<String>,
) -> Result<String, String> {
    let trimmed_prompt = prompt.trim();
    if trimmed_prompt.is_empty() {
        return Err("ACP agent prompt cannot be empty.".to_string());
    }

    let config = normalize_acp_invocation(command, args, cwd)?;
    let prompt_arg = trimmed_prompt.to_string();
    let started_at = SystemTime::now();
    let _ = append_application_log_line(
        &app,
        "backend_acp",
        "run_acp_agent_prompt_start",
        &format!(
            "command={} args_count={} prompt_len={} cwd={}",
            config.command,
            config.args.len(),
            prompt_arg.len(),
            config.cwd.display()
        ),
        None,
    );

    let handle = state.get_or_create(&config);
    let first_attempt = handle.prompt(prompt_arg.clone()).await;
    let result = match first_attempt {
        Ok(output) => Ok(output),
        Err(first_error) => {
            state.remove(&config.session_key);
            let retry_handle = state.get_or_create(&config);
            match retry_handle.prompt(prompt_arg).await {
                Ok(output) => Ok(output),
                Err(retry_error) => Err(format!("{} Retry failed: {}", first_error, retry_error)),
            }
        }
    };

    let elapsed_ms = SystemTime::now()
        .duration_since(started_at)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    match &result {
        Ok(output) => {
            let fields_json = serde_json::json!({
                "outputLen": output.len(),
                "outputPreview": preview_for_log(output, 260),
            })
            .to_string();
            let _ = append_application_log_line(
                &app,
                "backend_acp",
                "run_acp_agent_prompt_success",
                &format!(
                    "command={} elapsed_ms={} output_len={}",
                    config.command,
                    elapsed_ms,
                    output.len()
                ),
                Some(&fields_json),
            );
        }
        Err(error_message) => {
            let _ = append_application_log_line(
                &app,
                "backend_acp",
                "run_acp_agent_prompt_error",
                &format!(
                    "command={} elapsed_ms={} error={}",
                    config.command, elapsed_ms, error_message
                ),
                None,
            );
            state.remove(&config.session_key);
        }
    }

    result
}

#[tauri::command]
fn clear_acp_agent_sessions(state: tauri::State<'_, AcpSessionManagerState>) {
    state.clear();
}

async fn bedrock_client_for_region(
    state: &BedrockRuntimeState,
    region: &str,
) -> Result<bedrockruntime::Client, String> {
    let normalized_region = region.trim();
    if normalized_region.is_empty() {
        return Err("AWS region is required for Bedrock requests.".to_string());
    }

    {
        let cache = state
            .clients
            .lock()
            .map_err(|_| "Bedrock client cache lock poisoned.".to_string())?;
        if let Some(client) = cache.get(normalized_region) {
            return Ok(client.clone());
        }
    }

    let config = aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new(normalized_region.to_string()))
        .load()
        .await;
    let client = bedrockruntime::Client::new(&config);

    let mut cache = state
        .clients
        .lock()
        .map_err(|_| "Bedrock client cache lock poisoned.".to_string())?;
    cache.insert(normalized_region.to_string(), client.clone());
    Ok(client)
}

fn extract_bedrock_text(value: &serde_json::Value) -> Option<String> {
    if let Some(content) = value.get("content").and_then(|v| v.as_array()) {
        let fragments = content
            .iter()
            .filter_map(|block| {
                if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }

                if let Some(text) = block.as_str() {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }

                None
            })
            .collect::<Vec<_>>();

        if !fragments.is_empty() {
            return Some(fragments.join("\n"));
        }
    }

    value
        .get("completion")
        .and_then(|completion| completion.as_str())
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

#[tauri::command]
async fn run_bedrock_converse_prompt(
    app: tauri::AppHandle,
    state: tauri::State<'_, BedrockRuntimeState>,
    region: String,
    model_id: String,
    system: String,
    prompt: String,
    max_tokens: u32,
) -> Result<String, String> {
    let normalized_region = region.trim();
    if normalized_region.is_empty() {
        return Err("AWS region is required.".to_string());
    }

    let normalized_model_id = model_id.trim();
    if normalized_model_id.is_empty() {
        return Err("Bedrock model ID is required.".to_string());
    }

    let normalized_prompt = prompt.trim();
    if normalized_prompt.is_empty() {
        return Err("Bedrock prompt cannot be empty.".to_string());
    }

    let normalized_system = system.trim();
    let started_at = SystemTime::now();
    let _ = append_application_log_line(
        &app,
        "backend_bedrock",
        "run_bedrock_prompt_start",
        &format!(
            "region={} model_id={} prompt_len={} system_len={} max_tokens={}",
            normalized_region,
            normalized_model_id,
            normalized_prompt.len(),
            normalized_system.len(),
            max_tokens
        ),
        None,
    );

    let client = bedrock_client_for_region(&state, normalized_region).await?;

    let mut request_json = serde_json::json!({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "messages": [
            {
                "role": "user",
                "content": [
                    { "type": "text", "text": normalized_prompt }
                ]
            }
        ]
    });

    if !normalized_system.is_empty() {
        request_json["system"] = serde_json::Value::String(normalized_system.to_string());
    }

    let body = serde_json::to_vec(&request_json)
        .map_err(|error| format!("Failed to serialize Bedrock request JSON: {}", error))?;

    let result = client
        .invoke_model()
        .model_id(normalized_model_id)
        .content_type("application/json")
        .accept("application/json")
        .body(bedrockruntime::primitives::Blob::new(body))
        .send()
        .await
        .map_err(|error| format!("Bedrock request failed: {}", error));

    let elapsed_ms = SystemTime::now()
        .duration_since(started_at)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    match result {
        Ok(response) => {
            let raw_body = response.body().as_ref();
            let parsed: serde_json::Value = serde_json::from_slice(raw_body)
                .map_err(|error| format!("Bedrock response was not valid JSON: {}", error))?;

            let output = extract_bedrock_text(&parsed).unwrap_or_default();
            if output.trim().is_empty() {
                let _ = append_application_log_line(
                    &app,
                    "backend_bedrock",
                    "run_bedrock_prompt_error",
                    &format!(
                        "elapsed_ms={} error=Bedrock response contained no text output.",
                        elapsed_ms
                    ),
                    None,
                );
                return Err("Bedrock response contained no text output.".to_string());
            }

            let _ = append_application_log_line(
                &app,
                "backend_bedrock",
                "run_bedrock_prompt_success",
                &format!("elapsed_ms={} output_len={}", elapsed_ms, output.len()),
                None,
            );
            Ok(output.trim().to_string())
        }
        Err(error_message) => {
            let _ = append_application_log_line(
                &app,
                "backend_bedrock",
                "run_bedrock_prompt_error",
                &format!("elapsed_ms={} error={}", elapsed_ms, error_message),
                None,
            );
            Err(error_message)
        }
    }
}

#[tauri::command]
fn append_application_log(
    app: tauri::AppHandle,
    source: String,
    event: String,
    message: String,
    fields_json: Option<String>,
) -> Result<(), String> {
    append_application_log_line(&app, &source, &event, &message, fields_json.as_deref())
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
fn initialize_agent_tracking(
    repo_path: String,
) -> Result<AgentTrackingInitializationResult, String> {
    let repository_path = validate_repository_path(&repo_path)?;

    let (agent_file_created, agent_file_updated) = ensure_agent_tracking_file(&repository_path)?;
    let (agent_reference_file_created, agent_reference_file_updated) =
        ensure_agent_reference_file(&repository_path)?;
    let (schema_file_created, schema_file_updated) =
        ensure_commit_context_schema_file(&repository_path)?;

    let message = if agent_file_created
        || agent_file_updated
        || agent_reference_file_created
        || agent_reference_file_updated
        || schema_file_created
        || schema_file_updated
    {
        let mut changes: Vec<String> = Vec::new();
        if agent_file_created {
            changes.push("created AGENT.md".to_string());
        } else if agent_file_updated {
            changes.push("updated AGENT.md".to_string());
        }
        if agent_reference_file_created {
            changes.push("created agent reference file (CLAUDE.md)".to_string());
        } else if agent_reference_file_updated {
            changes.push("updated agent reference file (CLAUDE.md)".to_string());
        }
        if schema_file_created {
            changes.push(format!("created {}", AGENT_TRACKING_SCHEMA_RELATIVE_PATH));
        } else if schema_file_updated {
            changes.push(format!("updated {}", AGENT_TRACKING_SCHEMA_RELATIVE_PATH));
        }
        format!("Tracking initialized: {}.", changes.join(", "))
    } else {
        "Tracking already initialized (AGENT.md, agent reference file, and commit context schema are up to date).".to_string()
    };

    Ok(AgentTrackingInitializationResult {
        agent_file_created,
        agent_file_updated,
        agent_reference_file_created,
        agent_reference_file_updated,
        schema_file_created,
        schema_file_updated,
        message,
    })
}

#[tauri::command]
fn read_agent_tracking_status(repo_path: String) -> Result<AgentTrackingStatus, String> {
    let repository_path = validate_repository_path(&repo_path)?;
    tracking_status_for_repository(&repository_path)
}

#[tauri::command]
fn remove_agent_tracking(repo_path: String) -> Result<AgentTrackingRemovalResult, String> {
    let repository_path = validate_repository_path(&repo_path)?;

    run_hooks_remove_script_if_present(&repository_path);
    let hooks_fallback_removed = remove_managed_hooks_fallback(&repository_path)?;
    let agent_block_removed = remove_agent_tracking_block(&repository_path)?;
    let agent_reference_removed = remove_agent_reference_file(&repository_path)?;
    let schema_removed = remove_managed_schema(&repository_path)?;
    let enforcement_removed = remove_managed_enforcement(&repository_path)?;

    remove_directory_if_empty(&repository_path.join(".githooks"));
    remove_directory_if_empty(&repository_path.join(".checkmate/comment-images"));
    remove_directory_if_empty(&repository_path.join(".checkmate"));

    let removed = agent_block_removed
        || agent_reference_removed
        || schema_removed
        || enforcement_removed
        || hooks_fallback_removed;

    let message = if removed {
        let mut changes: Vec<String> = Vec::new();
        if agent_block_removed {
            changes.push("removed tracking block from AGENT.md".to_string());
        }
        if agent_reference_removed {
            changes.push(
                "removed @AGENT.md reference from agent reference file (CLAUDE.md)".to_string(),
            );
        }
        if schema_removed {
            changes.push(format!("removed {}", AGENT_TRACKING_SCHEMA_RELATIVE_PATH));
        }
        if enforcement_removed {
            changes.push("removed .checkmate/enforcement.json".to_string());
        }
        if hooks_fallback_removed {
            changes.push("removed managed git hook configuration".to_string());
        }
        format!("Tracking removed: {}.", changes.join(", "))
    } else {
        "Tracking was already disabled for this repository.".to_string()
    };

    Ok(AgentTrackingRemovalResult { removed, message })
}

#[tauri::command]
fn store_comment_image(
    app: tauri::AppHandle,
    base64_data: String,
    mime_type: String,
) -> Result<CommentImageStorageResult, String> {
    let started_at = SystemTime::now();
    let _ = append_application_log_line(
        &app,
        "backend_storage",
        "store_comment_image_start",
        &format!(
            "mime_type={} base64_len={}",
            mime_type.trim(),
            base64_data.trim().len()
        ),
        None,
    );
    let extension = extension_for_mime_type(&mime_type).ok_or_else(|| {
        "Only PNG, JPG, WEBP, GIF, and TIFF clipboard images are supported.".to_string()
    })?;
    let image_bytes = general_purpose::STANDARD
        .decode(base64_data.trim())
        .map_err(|error| format!("Failed to decode image data: {}", error))?;
    if image_bytes.is_empty() {
        return Err("Image data is empty.".to_string());
    }

    let image_dir = resolve_comment_images_directory(&app)?;
    let image_ref = build_comment_image_ref(extension);
    let image_path = image_dir.join(&image_ref);
    std::fs::write(&image_path, image_bytes)
        .map_err(|error| format!("Failed to store image: {}", error))?;

    let elapsed_ms = SystemTime::now()
        .duration_since(started_at)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let _ = append_application_log_line(
        &app,
        "backend_storage",
        "store_comment_image_success",
        &format!("elapsed_ms={} image_ref={}", elapsed_ms, image_ref),
        None,
    );

    Ok(CommentImageStorageResult {
        image_ref: image_ref.clone(),
        markdown_url: format!("{}{}", COMMENT_IMAGE_URL_PREFIX, image_ref),
    })
}

#[tauri::command]
fn resolve_comment_image_data_url(
    app: tauri::AppHandle,
    image_ref: String,
) -> Result<String, String> {
    let normalized_ref = validate_comment_image_ref(&image_ref)?;
    let image_dir = resolve_comment_images_directory(&app)?;
    let image_path = image_dir.join(&normalized_ref);

    if !image_path.is_file() {
        return Err("Stored comment image was not found.".to_string());
    }

    let bytes = std::fs::read(&image_path)
        .map_err(|error| format!("Failed to read stored comment image: {}", error))?;
    let extension = image_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let mime_type = mime_type_for_extension(extension);
    let encoded = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{};base64,{}", mime_type, encoded))
}

#[tauri::command]
fn delete_comment_images(app: tauri::AppHandle, image_refs: Vec<String>) -> Result<usize, String> {
    let image_dir = resolve_comment_images_directory(&app)?;
    let mut removed_count = 0usize;

    for image_ref in image_refs {
        let normalized_ref = match validate_comment_image_ref(&image_ref) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let image_path = image_dir.join(normalized_ref);
        if !image_path.exists() {
            continue;
        }

        std::fs::remove_file(&image_path)
            .map_err(|error| format!("Failed to delete comment image: {}", error))?;
        removed_count += 1;
    }

    remove_directory_if_empty(&image_dir);

    Ok(removed_count)
}

#[tauri::command]
fn read_cm_cli_status() -> Result<CmCliStatus, String> {
    let path_entries = path_entries();
    let home_path = std::env::var_os("HOME").map(PathBuf::from);
    let preferred_roots = home_path
        .as_ref()
        .map(|path| preferred_cm_directories(path))
        .unwrap_or_default();

    let mut candidate_roots: Vec<PathBuf> = preferred_roots.clone();

    for entry in &path_entries {
        if is_transient_path_entry(entry) || candidate_roots.iter().any(|root| root == entry) {
            continue;
        }

        candidate_roots.push(entry.clone());
    }

    let install_path = candidate_roots
        .iter()
        .map(|root| root.join(CM_COMMAND_NAME))
        .find(|candidate| candidate.is_file());

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
        .manage(AcpSessionManagerState::default())
        .manage(BedrockRuntimeState::default())
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
            list_review_commits,
            read_commit_details,
            read_commit_patch,
            read_current_branch,
            list_local_branches,
            read_commit_file_versions,
            run_claude_prompt,
            read_text_file,
            read_app_settings,
            write_app_settings,
            read_system_username,
            read_clipboard_text,
            run_cli_agent_prompt,
            run_acp_agent_prompt,
            clear_acp_agent_sessions,
            run_bedrock_converse_prompt,
            append_application_log,
            read_launch_request,
            initialize_agent_tracking,
            read_agent_tracking_status,
            remove_agent_tracking,
            store_comment_image,
            resolve_comment_image_data_url,
            delete_comment_images,
            read_cm_cli_status,
            install_cm_cli_in_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running checkmate.sh tauri shell");
}
