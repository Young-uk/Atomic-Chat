//! Personal-fork Dstar control. A single actor owns the child and every transition;
//! the UI never supplies a command, executable path, host, or extra arguments.
use super::managed_engines::{self, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::{Manager, Runtime};
use tokio::{
    process::{Child, Command},
    sync::{mpsc, oneshot},
};

const DEFAULT_CONTEXT: u32 = 65_536;
// Long-context KV checkpoints must finish before the owned process is killed.
// Keep a bounded fallback for an unresponsive server, including app exit.
const STOP_GRACE: Duration = Duration::from_secs(120);
const SHUTDOWN_REPLY_GRACE: Duration = Duration::from_secs(195);

fn stop_grace_expired(elapsed: Duration) -> bool {
    elapsed >= STOP_GRACE
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub model: String,
    pub context: u32,
}
impl Default for Selection {
    fn default() -> Self {
        Self {
            model: "iq3".into(),
            context: DEFAULT_CONTEXT,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelChoice {
    id: String,
    name: String,
    available: bool,
    reason: Option<String>,
    bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    available: bool,
    status: String,
    owned: bool,
    selection: Selection,
    models: Vec<ModelChoice>,
    served_models: Vec<String>,
    elapsed_seconds: u64,
    error: Option<String>,
    log: String,
}

enum Message {
    Request {
        action: String,
        selection: Option<Selection>,
        reply: oneshot::Sender<Result<Snapshot, String>>,
    },
    Managed {
        action: String,
        engine: Option<Engine>,
        selection: Option<Selection>,
        strata_context: Option<u32>,
        reply: oneshot::Sender<Result<managed_engines::Snapshot, String>>,
    },
    Shutdown(oneshot::Sender<()>),
}

pub struct DstarController {
    tx: mpsc::Sender<Message>,
    closing: Arc<AtomicBool>,
}
impl DstarController {
    pub fn new(root: PathBuf) -> Self {
        Self::with_environment(managed_engines::Environment::personal(root))
    }

    fn with_environment(env: managed_engines::Environment) -> Self {
        let (tx, rx) = mpsc::channel(16);
        let closing = Arc::new(AtomicBool::new(false));
        tauri::async_runtime::spawn(run(env, rx, closing.clone()));
        Self { tx, closing }
    }

    #[cfg(test)]
    fn with_port(root: PathBuf, port: u16) -> Self {
        let mut env = managed_engines::Environment::personal(root);
        env.dstar_port = port;
        env.strata_port = tests::unused_port();
        env.other_ports.clear();
        env.scan_processes = false;
        Self::with_environment(env)
    }

    async fn managed_request_with_context(
        &self,
        action: String,
        engine: Option<Engine>,
        selection: Option<Selection>,
        strata_context: Option<u32>,
    ) -> Result<managed_engines::Snapshot, String> {
        if self.closing.load(Ordering::SeqCst) {
            return Err("controllerStopping".into());
        }
        let (reply, answer) = oneshot::channel();
        self.tx
            .send(Message::Managed {
                action,
                engine,
                selection,
                strata_context,
                reply,
            })
            .await
            .map_err(|_| "Engine controller stopped".to_string())?;
        answer
            .await
            .map_err(|_| "Engine controller stopped".to_string())?
    }

    #[cfg(test)]
    async fn managed_request(
        &self,
        action: String,
        engine: Option<Engine>,
        selection: Option<Selection>,
    ) -> Result<managed_engines::Snapshot, String> {
        self.managed_request_with_context(action, engine, selection, None)
            .await
    }

    async fn request(
        &self,
        action: String,
        selection: Option<Selection>,
    ) -> Result<Snapshot, String> {
        if self.closing.load(Ordering::SeqCst) {
            return Err("controllerStopping".into());
        }
        let (reply, answer) = oneshot::channel();
        self.tx
            .send(Message::Request {
                action,
                selection,
                reply,
            })
            .await
            .map_err(|_| "Dstar controller stopped")?;
        answer
            .await
            .map_err(|_| "Dstar controller stopped".to_string())?
    }
}

pub fn install<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(home) = dirs::home_dir() {
        app.manage(DstarController::new(
            home.join("Library/Application Support/dstar"),
        ));
    }
}

pub async fn shutdown<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(controller) = app.try_state::<DstarController>() {
        controller.closing.store(true, Ordering::SeqCst);
        let (reply, answer) = oneshot::channel();
        if controller.tx.send(Message::Shutdown(reply)).await.is_ok() {
            let _ = tokio::time::timeout(SHUTDOWN_REPLY_GRACE, answer).await;
        }
    }
}

#[tauri::command]
pub async fn dstar_control(
    controller: tauri::State<'_, DstarController>,
    action: String,
    selection: Option<Selection>,
) -> Result<Snapshot, String> {
    controller.request(action, selection).await
}

#[tauri::command]
pub async fn managed_engine_control(
    controller: tauri::State<'_, DstarController>,
    action: String,
    engine: Option<Engine>,
    selection: Option<Selection>,
    strata_context: Option<u32>,
) -> Result<managed_engines::Snapshot, String> {
    controller
        .managed_request_with_context(action, engine, selection, strata_context)
        .await
}

// A preallocated file is not a downloaded model. Our legacy downloader's map
// has inclusive completed ranges and a separately completed prefix.
pub(super) fn payload_ready(path: &Path) -> Result<u64, String> {
    let size = fs::metadata(path).map_err(|_| "missingFiles")?.len();
    let mut file = fs::File::open(path).map_err(|_| "unreadableFiles")?;
    let mut magic = [0; 4];
    file.read_exact(&mut magic).map_err(|_| "incompleteFiles")?;
    if magic != *b"GGUF" {
        return Err("invalidFiles".into());
    }
    let map = path.with_file_name(format!(
        "{}.ranges.json",
        path.file_name().unwrap().to_string_lossy()
    ));
    if map.exists() {
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(map).map_err(|_| "incompleteFiles")?)
                .map_err(|_| "incompleteFiles")?;
        let mut covered = value["prefix"].as_u64().ok_or("incompleteFiles")?;
        if covered > size {
            return Err("incompleteFiles".into());
        }
        let mut ranges = value["done"]
            .as_array()
            .ok_or("incompleteFiles")?
            .iter()
            .map(|range| {
                Ok((
                    range[0].as_u64().ok_or("incompleteFiles")?,
                    range[1].as_u64().ok_or("incompleteFiles")?,
                ))
            })
            .collect::<Result<Vec<(u64, u64)>, String>>()?;
        ranges.sort_unstable();
        for (start, end) in ranges {
            if start > end || end >= size || start > covered {
                return Err("incompleteFiles".into());
            }
            covered = covered.max(end + 1);
        }
        if covered != size {
            return Err("incompleteFiles".into());
        }
    }
    Ok(size)
}

fn choices(root: &Path) -> Vec<ModelChoice> {
    let models = root.join("models");
    let mut result: Vec<ModelChoice> = [("q2", "Q2_0"), ("iq3", "IQ3_XXS"), ("iq3s", "IQ3_S")]
        .into_iter()
        .map(|(id, tag)| {
            let first = models.join(tag).join(format!(
                "Qwen3.8-Flash-Next-GSQ-RCO-{tag}-00001-of-00002.gguf"
            ));
            let second = [tag, "Q2_0", "IQ3_XXS", "IQ3_S"]
                .into_iter()
                .map(|candidate| {
                    models.join(candidate).join(format!(
                        "Qwen3.8-Flash-Next-GSQ-RCO-{candidate}-00002-of-00002.gguf"
                    ))
                })
                .find(|p| p.exists());
            let result = payload_ready(&first)
                .and_then(|a| payload_ready(&second.ok_or("missingFiles")?).map(|b| a + b));
            ModelChoice {
                id: id.into(),
                name: format!("Qwen3.8 Flash Next · {tag}"),
                available: result.is_ok(),
                bytes: result.as_ref().copied().unwrap_or(0),
                reason: result.err(),
            }
        })
        .collect();
    // This release has its own explicitly verified shard pair. Never silently
    // reuse a legacy shard; an installer may place a verified hardlink here.
    let hybrid = models.join("SHEFOWL-HYBRID");
    let first =
        hybrid.join("Qwen3.8-Flash-Next-GSQ-RCO-abliterated-IQ3_XXS-Q2_0-00001-of-00002.gguf");
    let second =
        hybrid.join("Qwen3.8-Flash-Next-GSQ-RCO-abliterated-IQ3_XXS-Q2_0-00002-of-00002.gguf");
    let readiness = payload_ready(&first).and_then(|a| payload_ready(&second).map(|b| a + b));
    result.push(ModelChoice {
        id: "shefowl-hybrid".into(),
        name: "Qwen3.8 Flash Next · shefowl512E · IQ3_XXS/Q2_0".into(),
        available: readiness.is_ok(),
        bytes: readiness.as_ref().copied().unwrap_or(0),
        reason: readiness.err(),
    });
    // The official release has a separate identity and explicitly verified pair.
    let official = models.join("IQ2_XS");
    let first = official.join("Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00001-of-00002.gguf");
    let second = official.join("Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00002-of-00002.gguf");
    let readiness = payload_ready(&first).and_then(|a| payload_ready(&second).map(|b| a + b));
    result.push(ModelChoice {
        id: "ista-iq2-xs".into(),
        name: "Qwen3.8 Flash Next · ISTA · IQ2_XS".into(),
        available: readiness.is_ok(),
        bytes: readiness.as_ref().copied().unwrap_or(0),
        reason: readiness.err(),
    });
    result
}

fn validate(selection: &Selection, models: &[ModelChoice]) -> Result<(), String> {
    if !(512..=524_288).contains(&selection.context) {
        return Err("invalidContext".into());
    }
    let model = models
        .iter()
        .find(|m| m.id == selection.model)
        .ok_or("unknownModel")?;
    if !model.available {
        return Err(model
            .reason
            .clone()
            .unwrap_or_else(|| "missingFiles".into()));
    }
    Ok(())
}

fn log_tail(root: &Path) -> String {
    let Ok(mut file) = fs::File::open(root.join("logs/atomic-dstar.log")) else {
        return String::new();
    };
    let Ok(size) = file.metadata().map(|v| v.len()) else {
        return String::new();
    };
    let _ = file.seek(SeekFrom::Start(size.saturating_sub(12_000)));
    let mut bytes = Vec::new();
    let _ = file.read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).into_owned()
}

fn launch(root: &Path, selection: &Selection, port: u16) -> Result<Child, String> {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return Err("unsupportedPlatform".into());
    }
    validate(selection, &choices(root))?;
    // Check the port without taking over an unrelated server or trusting a stale PID file.
    let probe = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .map_err(|_| "portInUse")?;
    drop(probe);
    for binary in ["dstar", "ds4-server", "ds4"] {
        if !root.join(binary).is_file() {
            return Err("missingRuntime".into());
        }
    }
    let logs = root.join("logs");
    fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs.join("atomic-dstar.log"))
        .map_err(|e| e.to_string())?;
    let stderr = log.try_clone().map_err(|e| e.to_string())?;
    // Keep the existing IQ3 KV directory with a 4 GiB disk cap.
    // A full 64K checkpoint exceeds 2 GiB; reserve room for it and shared prefixes. Other quants get
    // separate directories; model payloads are never moved or downloaded here.
    let cache = if selection.model == "iq3" {
        root.join("kv-cache-iq3")
    } else {
        root.join(format!("kv-cache-{}", selection.model))
    };
    let mut cmd = Command::new("/bin/bash");
    cmd.arg(root.join("dstar"))
        .args([
            "serve",
            "--quant",
            &selection.model,
            "--ctx",
            &selection.context.to_string(),
            "--port",
            &port.to_string(),
            "--",
            "--kv-disk-dir",
        ])
        .arg(cache)
        .args(["--kv-disk-space-mb", "4096"])
        .current_dir(root)
        .env("DSTAR_MODELS", root.join("models"))
        .env("HOST", "127.0.0.1")
        .env_remove("DSTAR_MODEL")
        .env_remove("DSTAR_QUANT")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr))
        .kill_on_drop(true);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.as_std_mut().process_group(0);
    }
    // Opt-in local test build only; ordinary Personal builds remain single-slot.
    if option_env!("ATOMIC_DSTAR_SUMMARY_TEST") == Some("true") {
        cmd.arg("--summary-slot");
    }
    cmd.spawn().map_err(|e| e.to_string())
}

pub(super) fn signal_child(child: &mut Child, force: bool) {
    if let Some(pid) = child.id() {
        #[cfg(unix)]
        unsafe {
            libc::kill(
                -(pid as i32),
                if force { libc::SIGKILL } else { libc::SIGTERM },
            );
        }
        #[cfg(not(unix))]
        {
            let _ = force;
            let _ = pid;
            let _ = child.start_kill();
        }
    }
}

async fn served_models(client: &reqwest::Client, port: u16) -> Vec<String> {
    let Ok(response) = client
        .get(format!("http://127.0.0.1:{port}/v1/models"))
        .send()
        .await
    else {
        return vec![];
    };
    if !response.status().is_success() {
        return vec![];
    }
    let Ok(value) = response.json::<serde_json::Value>().await else {
        return vec![];
    };
    value["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m["id"].as_str().map(str::to_string))
        .collect()
}

struct OwnedEngine {
    process: Child,
    engine: Engine,
    strata_context: Option<u32>,
    started: Instant,
    ready: bool,
    observation_error: Option<String>,
    last_probe: Instant,
    config: Option<PathBuf>,
    // Private controller credential: never serialized, logged or sent to renderer.
    summary_owner_key: Option<String>,
    // Keep outside Child: Child::wait() otherwise closes stdin before waiting.
    owner_pipe: Option<tokio::process::ChildStdin>,
    stopping_family: Vec<managed_engines::ProcessIdentity>,
}
impl OwnedEngine {
    // Readiness observations may recover, but only on a new authoritative match
    // plus nonempty models. Never change sticky lifecycle errors here. `ready`
    // remains ever-ready so uncertainty cannot bypass the summary drain barrier.
    fn observe_models(
        &mut self,
        has_models: bool,
        ownership: Result<bool, String>,
        port: u16,
    ) -> bool {
        if !has_models {
            return false;
        }
        let error = match ownership {
            Ok(true) => {
                self.observation_error = None;
                self.ready = true;
                return true;
            }
            Ok(false) => "foreignEngine".to_owned(),
            Err(reason) => {
                log::warn!("[atomic-engine] ownership inspection failed: engine={:?} root={:?} port={} reason={}", self.engine, self.process.id(), port, reason);
                "processInspectionFailed".to_owned()
            }
        };
        if self.observation_error.as_ref() != Some(&error) {
            log::warn!(
                "[atomic-engine] readiness blocked: engine={:?} root={:?} port={} reason={}",
                self.engine,
                self.process.id(),
                port,
                error
            );
        }
        self.observation_error = Some(error);
        false
    }
}

impl Drop for OwnedEngine {
    fn drop(&mut self) {
        if let Some(path) = &self.config {
            let _ = fs::remove_file(path);
        }
    }
}

#[derive(Clone)]
struct RequestedEngine {
    engine: Engine,
    selection: Selection,
    strata_context: u32,
}

struct Actor {
    env: managed_engines::Environment,
    client: reqwest::Client,
    owned: Option<OwnedEngine>,
    stopping: Option<Instant>,
    pending: Option<RequestedEngine>,
    selection: Selection,
    strata_context: u32,
    error: Option<String>,
    error_engine: Option<Engine>,
}

impl Actor {
    fn lifecycle_error_for(&self, engine: Option<Engine>) -> Option<String> {
        if engine == self.error_engine {
            self.error.clone()
        } else {
            None
        }
    }

    fn visible_error_for(&self, engine: Option<Engine>) -> Option<String> {
        self.lifecycle_error_for(engine).or_else(|| {
            self.owned
                .as_ref()
                .filter(|owned| Some(owned.engine) == engine)
                .and_then(|owned| owned.observation_error.clone())
        })
    }

    fn validate_target(&self, next: &RequestedEngine) -> Result<(), String> {
        match next.engine {
            Engine::Dstar => {
                validate(&next.selection, &choices(&self.env.dstar_root))?;
                for name in ["dstar", "ds4", "ds4-server"] {
                    if !self.env.dstar_root.join(name).is_file() {
                        return Err("missingRuntime".into());
                    }
                }
                Ok(())
            }
            Engine::Strata => {
                managed_engines::validate_strata_context(next.strata_context)?;
                self.env.validate_strata()
            }
        }
    }

    fn start(&mut self, next: RequestedEngine) -> Result<(), String> {
        // This is the sole launch site for BOTH native APIs. It is also checked
        // again after a graceful stop, because a third party may have started
        // an engine while ours was draining.
        if self.owned.is_some() {
            return Err("engineTransition".into());
        }
        self.validate_target(&next)?;
        self.env.ensure_no_foreign_engine()?;
        let (mut process, config, summary_owner_key) = match next.engine {
            Engine::Dstar => (
                launch(&self.env.dstar_root, &next.selection, self.env.dstar_port)?,
                None,
                None,
            ),
            Engine::Strata => self.env.launch_strata(next.strata_context)?,
        };
        let owner_pipe = process.stdin.take();
        self.owned = Some(OwnedEngine {
            process,
            owner_pipe,
            stopping_family: Vec::new(),
            engine: next.engine,
            strata_context: (next.engine == Engine::Strata).then_some(next.strata_context),
            started: Instant::now(),
            ready: false,
            observation_error: None,
            last_probe: Instant::now(),
            config,
            summary_owner_key,
        });
        if next.engine == Engine::Dstar {
            self.selection = next.selection;
            if let Ok(bytes) = serde_json::to_vec(&self.selection) {
                let _ = fs::write(self.env.dstar_root.join("atomic-settings.json"), bytes);
            }
        }
        self.stopping = None;
        self.error = None;
        self.error_engine = Some(next.engine);
        Ok(())
    }

    async fn quiesce(&self, next: Option<Engine>) -> Result<(), String> {
        let Some(owned) = &self.owned else {
            return Ok(());
        };
        if !owned.ready
            || owned.engine != Engine::Strata
            || next == Some(Engine::Strata)
            || self.stopping.is_some()
        {
            return Ok(());
        }
        let Some(key) = &owned.summary_owner_key else {
            return Ok(());
        };
        managed_engines::drain_strata_summary(
            &self.client,
            self.env.strata_port,
            owned.process.id().ok_or("notOwned")?,
            key,
        )
        .await
    }

    async fn resume_summary(&self) -> Result<(), String> {
        let Some(owned) = &self.owned else {
            return Ok(());
        };
        if !owned.ready || owned.engine != Engine::Strata || self.stopping.is_some() {
            return Ok(());
        }
        let Some(key) = &owned.summary_owner_key else {
            return Ok(());
        };
        managed_engines::resume_strata_summary(
            &self.client,
            self.env.strata_port,
            owned.process.id().ok_or("notOwned")?,
            key,
        )
        .await
    }

    async fn begin_stop(&mut self) -> Result<(), String> {
        if self.stopping.is_some() {
            return if self.error.as_deref() == Some("stopFailed") {
                Err("stopFailed".into())
            } else {
                Ok(())
            };
        }
        let owned = self.owned.as_mut().ok_or("notOwned")?;
        managed_engines::check_idle(
            &self.client,
            self.env.port(owned.engine),
            owned.engine,
            owned.ready,
            owned.process.id().ok_or("notOwned")?,
        )
        .await?;
        owned.stopping_family =
            managed_engines::owned_family(owned.process.id().ok_or("notOwned")?)?;
        managed_engines::signal(&mut owned.process, owned.engine, false);
        self.stopping = Some(Instant::now());
        Ok(())
    }

    async fn ensure(&mut self, next: RequestedEngine) -> Result<(), String> {
        self.validate_target(&next)?;
        if self.stopping.is_some() {
            // The launcher may already be reaped while its captured children
            // checkpoint. Coalescing changes only the future target; start()
            // rechecks foreign processes/ports after every owned member exits.
            self.begin_stop().await?;
            self.pending = Some(next);
            return Ok(());
        }
        if let Some(owned) = &self.owned {
            if self.stopping.is_none()
                && owned.engine == next.engine
                && (if next.engine == Engine::Strata {
                    owned.strata_context == Some(next.strata_context)
                } else {
                    self.selection == next.selection
                })
            {
                if next.engine == Engine::Strata {
                    self.resume_summary().await?;
                }
                return Ok(());
            }
            self.env
                .ensure_no_competitor(owned.engine, owned.process.id().ok_or("notOwned")?)
                .await?;
            // Context changes also need the authenticated summary/admission barrier.
            self.quiesce(None).await?;
            if let Err(error) = self.begin_stop().await {
                let _ = self.resume_summary().await;
                return Err(error);
            }
            // Rapid choices coalesce while the old child drains. Nothing else
            // can spawn until this actor confirms its child actually exited.
            self.pending = Some(next);
            Ok(())
        } else {
            self.start(next)
        }
    }

    async fn dstar_request(
        &mut self,
        action: &str,
        requested: Option<Selection>,
    ) -> Result<Snapshot, String> {
        match action {
            "start" => {
                if self
                    .owned
                    .as_ref()
                    .is_some_and(|owned| owned.engine == Engine::Dstar)
                {
                    return Err("alreadyRunning".into());
                }
                // Preserve the old panel's occupied-Dstar-port error spelling.
                if std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, self.env.dstar_port))
                    .is_err()
                {
                    return Err("portInUse".into());
                }
                let next = RequestedEngine {
                    engine: Engine::Dstar,
                    strata_context: self.strata_context,
                    selection: requested.unwrap_or_else(|| self.selection.clone()),
                };
                self.validate_target(&next)?;
                self.quiesce(Some(Engine::Dstar)).await?;
                if let Err(error) = self.ensure(next).await {
                    let _ = self.resume_summary().await;
                    return Err(error);
                }
            }
            "stop" => {
                if !self
                    .owned
                    .as_ref()
                    .is_some_and(|owned| owned.engine == Engine::Dstar)
                {
                    return Err("notOwned".into());
                }
                self.begin_stop().await?;
                self.pending = None;
            }
            "status" => {}
            _ => return Err("unknownAction".into()),
        }
        let models = choices(&self.env.dstar_root);
        let mut served = if self.stopping.is_some() {
            vec![]
        } else {
            served_models(&self.client, self.env.dstar_port).await
        };
        let available = cfg!(all(target_os = "macos", target_arch = "aarch64"))
            && self.env.dstar_root.join("dstar").is_file()
            && self.env.dstar_root.join("ds4-server").is_file();
        let owned = self
            .owned
            .as_ref()
            .is_some_and(|owned| owned.engine == Engine::Dstar);
        if owned && !served.is_empty() {
            if let Some(process) = self.owned.as_mut() {
                let result = match process.process.id() {
                    Some(pid) => managed_engines::owns_listener(pid, self.env.dstar_port).await,
                    None => Err("processInspectionFailed".into()),
                };
                if !process.observe_models(true, result, self.env.dstar_port) {
                    served.clear();
                }
            }
        }
        let error = self.visible_error_for(Some(Engine::Dstar));
        let queued = self
            .pending
            .as_ref()
            .filter(|next| next.engine == Engine::Dstar);
        let status = if !available {
            "unavailable"
        } else if queued.is_some() {
            // The old engine still owns its process tree. Dstar is queued, not
            // stopped or owned yet; show its requested settings while waiting.
            "loading"
        } else if owned && self.stopping.is_some() {
            "stopping"
        } else if owned && error.is_some() {
            "error"
        } else if !served.is_empty() {
            if owned {
                "ready"
            } else {
                "external"
            }
        } else if owned {
            "loading"
        } else if error.is_some() {
            "error"
        } else {
            "stopped"
        };
        Ok(Snapshot {
            available,
            status: status.into(),
            owned,
            selection: queued
                .map(|next| next.selection.clone())
                .unwrap_or_else(|| self.selection.clone()),
            models,
            served_models: served,
            elapsed_seconds: self
                .owned
                .as_ref()
                .filter(|p| p.engine == Engine::Dstar)
                .map(|p| p.started.elapsed().as_secs())
                .unwrap_or(0),
            error,
            log: log_tail(&self.env.dstar_root),
        })
    }

    async fn snapshot(&mut self, requested: Option<Engine>) -> managed_engines::Snapshot {
        let current = self.owned.as_ref().map(|owned| owned.engine);
        let engine = current
            .or(requested)
            .or_else(|| self.error.as_ref().and(self.error_engine));
        let mut served = match engine.filter(|_| self.stopping.is_none()) {
            Some(engine) => served_models(&self.client, self.env.port(engine)).await,
            None => vec![],
        };
        if !served.is_empty() {
            if let Some(owned) = self.owned.as_mut() {
                let port = self.env.port(owned.engine);
                let result = match owned.process.id() {
                    Some(pid) => managed_engines::owns_listener(pid, port).await,
                    None => Err("processInspectionFailed".into()),
                };
                if !owned.observe_models(true, result, port) {
                    served.clear();
                }
            }
        }
        let error = self.visible_error_for(engine);
        let external = current.is_none()
            && engine.is_some_and(|engine| !managed_engines::port_available(self.env.port(engine)));
        let status = if error.is_some() && self.stopping.is_none()
            || error.as_deref() == Some("stopFailed")
        {
            "error"
        } else if self.stopping.is_some() {
            "stopping"
        } else if self.owned.is_some() {
            if served.is_empty() {
                "loading"
            } else {
                "ready"
            }
        } else if external {
            "external"
        } else if error.is_some() {
            "error"
        } else {
            "stopped"
        };
        managed_engines::Snapshot {
            strata_context: self.strata_context,
            active_context: self.owned.as_ref().and_then(|owned| owned.strata_context),
            engine: if current.is_some() || external {
                engine
            } else {
                None
            },
            desired_engine: self.pending.as_ref().map(|next| next.engine).or(current),
            status: status.into(),
            owned: self.owned.is_some(),
            served_models: served,
            elapsed_seconds: self
                .owned
                .as_ref()
                .map(|p| p.started.elapsed().as_secs())
                .unwrap_or(0),
            error,
        }
    }

    async fn tick(&mut self) {
        let mut ended = false;
        if let Some(owned) = self.owned.as_mut() {
            match owned.process.try_wait() {
                Ok(Some(status)) => {
                    if self.stopping.is_none() {
                        self.error = Some(format!("engineExited: {status}"));
                    }
                    // caffeinate can exit before ds4 finishes checkpointing.
                    // Keep ownership until the captured descendants also exit;
                    // PID plus start time prevents a recycled PID holding us up.
                    match managed_engines::family_alive(&owned.stopping_family) {
                        Ok(false) => ended = true,
                        Ok(true) => {
                            let grace = if owned.engine == Engine::Dstar {
                                STOP_GRACE
                            } else {
                                managed_engines::STRATA_STOP_GRACE
                            };
                            if self.stopping.is_some_and(|t| t.elapsed() >= grace) {
                                self.error = Some("stopFailed".into());
                                self.pending = None;
                            }
                        }
                        Err(error) => {
                            self.error = Some(error);
                            self.pending = None;
                        }
                    }
                }
                Err(error) => {
                    // Do not discard ownership after an uncertain wait failure.
                    // Losing the handle would permit a second heavy launch.
                    self.error = Some(format!("engineWaitFailed: {error}"));
                    self.pending = None;
                }
                Ok(None) => {
                    if let Some(stopping) = self.stopping {
                        if owned.engine == Engine::Dstar && stop_grace_expired(stopping.elapsed()) {
                            managed_engines::signal(&mut owned.process, owned.engine, true);
                        } else if owned.engine == Engine::Strata
                            && stopping.elapsed() >= managed_engines::STRATA_STOP_GRACE
                        {
                            // Python owns separate inference/vision process groups.
                            // Never kill only Python and then claim the GPU is free.
                            self.error = Some("stopFailed".into());
                            self.pending = None;
                        }
                    } else if !owned.ready || owned.observation_error.is_some() {
                        // Readiness is native state, not contingent on a panel
                        // remaining mounted or a renderer continuing to poll.
                        if owned.last_probe.elapsed() >= Duration::from_secs(1) {
                            let port = self.env.port(owned.engine);
                            let served = served_models(&self.client, port).await;
                            if !served.is_empty() {
                                let result = match owned.process.id() {
                                    Some(pid) => managed_engines::owns_listener(pid, port).await,
                                    None => Err("processInspectionFailed".into()),
                                };
                                owned.observe_models(true, result, port);
                            }
                            owned.last_probe = Instant::now();
                        }
                        if !owned.ready && owned.started.elapsed() >= managed_engines::LOAD_GRACE {
                            self.error = Some("engineLoadTimeout".into());
                            self.pending = None;
                            if let Some(pid) = owned.process.id() {
                                owned.stopping_family =
                                    managed_engines::owned_family(pid).unwrap_or_default();
                            }
                            managed_engines::signal(&mut owned.process, owned.engine, false);
                            self.stopping = Some(Instant::now());
                        }
                    }
                }
            }
        }
        if ended {
            self.owned = None;
            self.stopping = None;
            if let Some(next) = self.pending.take() {
                self.error_engine = Some(next.engine);
                if let Err(error) = self.start(next) {
                    self.error = Some(error);
                }
            }
        }
    }

    async fn shutdown(&mut self) {
        self.pending = None;
        if let Some(owned) = self.owned.as_mut() {
            if self.stopping.is_none() {
                if let Some(pid) = owned.process.id() {
                    owned.stopping_family = managed_engines::owned_family(pid).unwrap_or_default();
                }
                managed_engines::signal(&mut owned.process, owned.engine, false);
            }
            let grace = if owned.engine == Engine::Dstar {
                STOP_GRACE
            } else {
                managed_engines::STRATA_STOP_GRACE
            };
            let deadline = Instant::now() + grace;
            loop {
                let exited = matches!(owned.process.try_wait(), Ok(Some(_)));
                if exited
                    && matches!(
                        managed_engines::family_alive(&owned.stopping_family),
                        Ok(false)
                    )
                {
                    break;
                }
                if Instant::now() >= deadline {
                    if owned.engine == Engine::Dstar {
                        // A live Child still proves its own process-group identity.
                        // If only descendants remain, do not guess at recycled IDs.
                        managed_engines::signal(&mut owned.process, owned.engine, true);
                        let _ = tokio::time::timeout(Duration::from_secs(3), owned.process.wait())
                            .await;
                        log::warn!("[atomic-engines] Dstar shutdown grace expired");
                    } else {
                        owned.owner_pipe.take();
                        log::error!("[atomic-engines] Strata did not finish graceful shutdown; its owner guard is closing it");
                    }
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
        self.owned = None;
    }
}

async fn run(
    env: managed_engines::Environment,
    mut rx: mpsc::Receiver<Message>,
    closing: Arc<AtomicBool>,
) {
    let client = match reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(750))
        .build()
    {
        Ok(client) => client,
        Err(_) => return,
    };
    let selection = fs::read(env.dstar_root.join("atomic-settings.json"))
        .ok()
        .and_then(|v| serde_json::from_slice::<Selection>(&v).ok())
        .unwrap_or_default();
    let strata_context = env.load_strata_context();
    let mut actor = Actor {
        strata_context,
        error_engine: None,
        env,
        client,
        owned: None,
        stopping: None,
        pending: None,
        selection,
        error: None,
    };
    let mut ticker = tokio::time::interval(Duration::from_millis(250));
    loop {
        tokio::select! {
            message = rx.recv() => match message {
                Some(Message::Shutdown(reply)) => {
                    closing.store(true, Ordering::SeqCst);
                    rx.close();
                    actor.shutdown().await;
                    let _ = reply.send(());
                    break;
                }
                Some(Message::Request { action, selection, reply }) => {
                    if closing.load(Ordering::SeqCst) {
                        let _ = reply.send(Err("controllerStopping".into())); continue;
                    }
                    actor.tick().await;
                    let result = actor.dstar_request(&action, selection).await;
                    let _ = reply.send(result);
                }
                Some(Message::Managed { action, engine, selection, strata_context, reply }) => {
                    if closing.load(Ordering::SeqCst) {
                        let _ = reply.send(Err("controllerStopping".into())); continue;
                    }
                    actor.tick().await;
                    if strata_context.is_some() && (engine != Some(Engine::Strata) || !matches!(action.as_str(), "ensure" | "configure")) {
                        let _ = reply.send(Err("invalidStrataContextAction".into())); continue;
                    }
                    let context = strata_context.unwrap_or(actor.strata_context);
                    if let Err(error) = managed_engines::validate_strata_context(context) {
                        let _ = reply.send(Err(error)); continue;
                    }
                    if matches!(action.as_str(), "ensure" | "configure") && engine == Some(Engine::Strata)
                        && (strata_context.is_some() || context != actor.strata_context) {
                        if action == "ensure" {
                            let target = RequestedEngine {
                                engine: Engine::Strata,
                                selection: actor.selection.clone(),
                                strata_context: context,
                            };
                            if let Err(error) = actor.validate_target(&target) {
                                let _ = reply.send(Err(error)); continue;
                            }
                        }
                        // Commit the desired setting before any new lifecycle effect.
                        // If ensure later fails (busy/foreign/runtime error), retain this
                        // saved preference; active_context still describes the old child.
                        // A rollback would require another fallible storage operation.
                        if let Err(error) = actor.env.save_strata_context(context) {
                            let _ = reply.send(Err(error)); continue;
                        }
                        actor.strata_context = context;
                    }
                    let result = match action.as_str() {
                        "quiesce" => actor.quiesce(engine).await,
                        "resume" => actor.resume_summary().await,
                        "ensure" => match engine {
                            Some(engine) => actor.ensure(RequestedEngine {
                                engine, selection: selection.unwrap_or_else(|| actor.selection.clone()), strata_context: context,
                            }).await,
                            None => Err("missingEngine".into()),
                        },
                        "configure" if engine == Some(Engine::Strata) => Ok(()),
                        "stop" => {
                            if engine.is_some() && actor.pending.as_ref().is_some_and(|next| Some(next.engine) == engine) {
                                // Cancel a queued choice, including Dstar -> Strata
                                // while Dstar is still draining. Never launch it later.
                                actor.pending = None;
                                Ok(())
                            } else if engine.is_some() && actor.owned.as_ref().is_some_and(|owned| Some(owned.engine) != engine) {
                                Err("notOwned".into())
                            } else {
                                // Endpoint Stop can target the owned engine even
                                // when the renderer has selected another model.
                                // Enforce the barrier here, not only in the chat coordinator.
                                let result = match actor.quiesce(None).await {
                                    Ok(()) => actor.begin_stop().await,
                                    Err(error) => Err(error),
                                };
                                if result.is_ok() { actor.pending = None; }
                                else { let _ = actor.resume_summary().await; }
                                result
                            }
                        },
                        "status" => Ok(()),
                        _ => Err("unknownAction".into()),
                    };
                    match result {
                        Ok(()) => {
                            let snapshot = actor.snapshot(engine).await; let _ = reply.send(Ok(snapshot));
                        }
                        Err(error) => { let _ = reply.send(Err(error)); }
                    }
                }
                None => { actor.shutdown().await; break; }
            },
            _ = ticker.tick() => {
                // Once exit has been requested, no queued target can launch.
                if closing.load(Ordering::SeqCst) { actor.pending = None; }
                actor.tick().await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        let models = root.path().join("models/IQ3_XXS");
        fs::create_dir_all(&models).unwrap();
        for shard in [1, 2] {
            fs::write(
                models.join(format!(
                    "Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-{shard:05}-of-00002.gguf"
                )),
                b"GGUF123456789012",
            )
            .unwrap();
        }
        fs::write(
            root.path().join("dstar"),
            b"printf '%s' $$ > atomic-test.pid\nexec sleep 60\n",
        )
        .unwrap();
        for name in ["ds4", "ds4-server"] {
            fs::write(root.path().join(name), b"fixture").unwrap();
        }
        root
    }

    pub(super) fn unused_port() -> u16 {
        std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn actor_rejects_duplicate_start_and_can_stop_during_loading() {
        let root = fixture();
        let controller = DstarController::with_port(root.path().into(), unused_port());
        let first = controller
            .request("start".into(), Some(Selection::default()))
            .await
            .unwrap();
        assert_eq!(first.status, "loading");
        assert!(first.owned);
        assert_eq!(
            controller
                .request("start".into(), Some(Selection::default()))
                .await
                .unwrap_err(),
            "alreadyRunning"
        );
        controller.request("stop".into(), None).await.unwrap();
        let deadline = Instant::now() + Duration::from_secs(6);
        loop {
            let state = controller.request("status".into(), None).await.unwrap();
            if !state.owned {
                assert_eq!(state.status, "stopped");
                break;
            }
            assert!(Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let again = controller
            .request(
                "start".into(),
                Some(Selection {
                    model: "iq3".into(),
                    context: 32768,
                }),
            )
            .await
            .unwrap();
        assert_eq!(again.selection.context, 32768);
        let (reply, answer) = oneshot::channel();
        controller.tx.send(Message::Shutdown(reply)).await.unwrap();
        tokio::time::timeout(Duration::from_secs(6), answer)
            .await
            .unwrap()
            .unwrap();
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn unrelated_listener_is_not_taken_over_or_stopped() {
        let root = fixture();
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let controller = DstarController::with_port(root.path().into(), port);
        assert_eq!(
            controller
                .request("start".into(), Some(Selection::default()))
                .await
                .unwrap_err(),
            "portInUse"
        );
        assert_eq!(
            controller.request("stop".into(), None).await.unwrap_err(),
            "notOwned"
        );
        assert_eq!(listener.local_addr().unwrap().port(), port);
        assert!(!root.path().join("atomic-test.pid").exists());
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn shutdown_waits_for_a_slow_checkpoint_writer() {
        let root = fixture();
        // A synthetic server needs six seconds to flush after TERM. The old
        // five-second process-group kill prevented the completion marker.
        fs::write(root.path().join("dstar"),
            b"trap 'sleep 6; echo saved > checkpoint-saved; exit 0' TERM\necho ready > checkpoint-ready\nwhile :; do sleep 0.1; done\n").unwrap();
        let controller = DstarController::with_port(root.path().into(), unused_port());
        controller
            .request("start".into(), Some(Selection::default()))
            .await
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !root.path().join("checkpoint-ready").exists() {
            assert!(Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let (reply, answer) = oneshot::channel();
        controller.tx.send(Message::Shutdown(reply)).await.unwrap();
        tokio::time::timeout(Duration::from_secs(15), answer)
            .await
            .unwrap()
            .unwrap();
        assert!(root.path().join("checkpoint-saved").exists());
    }

    fn managed_fixture() -> (tempfile::TempDir, managed_engines::Environment) {
        let root = fixture();
        let script = root.path().join("mock-strata.sh");
        fs::write(
            &script,
            b"printf '%s' $$ > strata-test.pid\nexec sleep 60\n",
        )
        .unwrap();
        let mut env = managed_engines::Environment::personal(root.path().into());
        env.dstar_port = unused_port();
        env.strata_port = unused_port();
        env.other_ports.clear();
        env.scan_processes = false;
        env.mock_strata = Some(script);
        (root, env)
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn strata_context_restarts_owned_runtime_and_preserves_dstar_settings() {
        let (root, env) = managed_fixture();
        fs::write(
            env.mock_strata.as_ref().unwrap(),
            b"printf '%s %s\\n' $$ \"$1\" >> strata-starts.txt\nexec sleep 60\n",
        )
        .unwrap();
        let dstar = br#"{"model":"iq3","context":32768}"#;
        fs::write(root.path().join("atomic-settings.json"), dstar).unwrap();
        let controller = DstarController::with_environment(env);
        let first = controller
            .managed_request_with_context("ensure".into(), Some(Engine::Strata), None, Some(32768))
            .await
            .unwrap();
        assert_eq!(first.strata_context, 32768);
        assert_eq!(first.active_context, Some(32768));
        tokio::time::sleep(Duration::from_millis(150)).await;
        let starts = fs::read_to_string(root.path().join("strata-starts.txt")).unwrap();
        assert!(starts.contains("32768"));
        controller
            .managed_request_with_context("ensure".into(), Some(Engine::Strata), None, Some(32768))
            .await
            .unwrap();
        assert_eq!(
            fs::read_to_string(root.path().join("strata-starts.txt")).unwrap(),
            starts
        );
        let changed = controller
            .managed_request_with_context("ensure".into(), Some(Engine::Strata), None, Some(16384))
            .await
            .unwrap();
        assert_eq!(changed.strata_context, 16384);
        assert_eq!(changed.active_context, Some(32768));
        assert_eq!(changed.status, "stopping");
        let next = wait_managed(&controller, Some(Engine::Strata)).await;
        assert_eq!(next.active_context, Some(16384));
        tokio::time::sleep(Duration::from_millis(150)).await;
        let starts = fs::read_to_string(root.path().join("strata-starts.txt")).unwrap();
        assert_eq!(starts.lines().count(), 2);
        assert!(starts.ends_with("16384\n"));
        assert_eq!(
            controller
                .managed_request_with_context(
                    "ensure".into(),
                    Some(Engine::Strata),
                    None,
                    Some(65537)
                )
                .await
                .unwrap_err(),
            "invalidStrataContext"
        );
        assert_eq!(
            fs::read(root.path().join("atomic-settings.json")).unwrap(),
            dstar
        );
        close_controller(&controller).await;
        let (_, mut env) = managed_fixture();
        env.dstar_root = root.path().into();
        let controller = DstarController::with_environment(env);
        let saved = controller
            .managed_request("status".into(), Some(Engine::Strata), None)
            .await
            .unwrap();
        assert_eq!(saved.strata_context, 16384);
        assert_eq!(saved.active_context, None);
        close_controller(&controller).await;
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn strata_context_storage_failure_never_starts_or_stops_runtime() {
        let (root, env) = managed_fixture();
        let settings = root.path().join("atomic-strata-settings.json");
        // A directory makes the atomic replacement fail even when tests run as root.
        fs::create_dir(&settings).unwrap();
        let controller = DstarController::with_environment(env);
        assert_eq!(
            controller
                .managed_request_with_context(
                    "ensure".into(),
                    Some(Engine::Strata),
                    None,
                    Some(32768)
                )
                .await
                .unwrap_err(),
            "strataSettingsWriteFailed"
        );
        assert!(!root.path().join("strata-test.pid").exists());
        let stopped = controller
            .managed_request("status".into(), Some(Engine::Strata), None)
            .await
            .unwrap();
        assert_eq!(stopped.active_context, None);
        assert_eq!(
            stopped.strata_context,
            managed_engines::DEFAULT_STRATA_CONTEXT
        );
        fs::remove_dir(&settings).unwrap();
        controller
            .managed_request_with_context("ensure".into(), Some(Engine::Strata), None, Some(32768))
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(150)).await;
        let pid = fs::read(root.path().join("strata-test.pid")).unwrap();
        let backup = root.path().join("settings-backup.json");
        fs::rename(&settings, &backup).unwrap();
        fs::create_dir(&settings).unwrap();
        assert_eq!(
            controller
                .managed_request_with_context(
                    "ensure".into(),
                    Some(Engine::Strata),
                    None,
                    Some(16384)
                )
                .await
                .unwrap_err(),
            "strataSettingsWriteFailed"
        );
        tokio::time::sleep(Duration::from_millis(300)).await;
        let state = controller
            .managed_request("status".into(), Some(Engine::Strata), None)
            .await
            .unwrap();
        assert_eq!(state.active_context, Some(32768));
        assert_eq!(state.strata_context, 32768);
        assert_ne!(state.status, "stopping");
        assert_eq!(fs::read(root.path().join("strata-test.pid")).unwrap(), pid);
        fs::remove_dir(&settings).unwrap();
        fs::rename(backup, &settings).unwrap();
        close_controller(&controller).await;
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn strata_context_failed_ensure_keeps_saved_desired_and_old_active_context() {
        let (root, mut env) = managed_fixture();
        let competitor_port = unused_port();
        env.other_ports.push(competitor_port);
        let controller = DstarController::with_environment(env);
        controller
            .managed_request_with_context("ensure".into(), Some(Engine::Strata), None, Some(32768))
            .await
            .unwrap();
        let competitor =
            std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, competitor_port)).unwrap();
        assert_eq!(
            controller
                .managed_request_with_context(
                    "ensure".into(),
                    Some(Engine::Strata),
                    None,
                    Some(16384)
                )
                .await
                .unwrap_err(),
            "foreignEngine"
        );
        let state = controller
            .managed_request("status".into(), Some(Engine::Strata), None)
            .await
            .unwrap();
        assert_eq!(state.strata_context, 16384);
        assert_eq!(state.active_context, Some(32768));
        assert_ne!(state.status, "stopping");
        let saved: serde_json::Value = serde_json::from_slice(
            &fs::read(root.path().join("atomic-strata-settings.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(saved["context"], 16384);
        drop(competitor);
        close_controller(&controller).await;
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn ownership_observations_recover_without_clearing_lifecycle_or_other_engine_errors() {
        let (_root, env) = managed_fixture();
        let mut actor = Actor {
            env,
            client: reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_millis(100))
                .build()
                .unwrap(),
            owned: None,
            stopping: None,
            pending: None,
            selection: Selection::default(),
            strata_context: managed_engines::DEFAULT_STRATA_CONTEXT,
            error: None,
            error_engine: None,
        };
        actor
            .start(RequestedEngine {
                engine: Engine::Strata,
                selection: Selection::default(),
                strata_context: 32768,
            })
            .unwrap();
        let port = actor.env.strata_port;
        let owned = actor.owned.as_mut().unwrap();
        assert!(!owned.observe_models(true, Err("inspection timeout".into()), port));
        assert_eq!(
            owned.observation_error.as_deref(),
            Some("processInspectionFailed")
        );
        assert!(!owned.observe_models(false, Ok(true), port));
        assert_eq!(
            owned.observation_error.as_deref(),
            Some("processInspectionFailed")
        );
        assert!(!owned.observe_models(true, Ok(false), port));
        assert_eq!(owned.observation_error.as_deref(), Some("foreignEngine"));
        assert!(!owned.observe_models(true, Ok(false), port));
        assert_eq!(owned.observation_error.as_deref(), Some("foreignEngine"));
        assert!(owned.observe_models(true, Ok(true), port));
        assert!(owned.ready);
        assert_eq!(owned.observation_error, None);
        // Empty fresh models must not reuse an old readiness success.
        let empty = actor.snapshot(Some(Engine::Strata)).await;
        assert_eq!(empty.status, "loading");
        assert!(empty.served_models.is_empty());
        for fault in ["stopFailed", "engineWaitFailed: mock", "engineExited: mock"] {
            actor.error = Some(fault.into());
            assert!(actor
                .owned
                .as_mut()
                .unwrap()
                .observe_models(true, Ok(true), port));
            assert_eq!(
                actor.visible_error_for(Some(Engine::Strata)).as_deref(),
                Some(fault)
            );
            assert_eq!(actor.visible_error_for(Some(Engine::Dstar)), None);
            let inactive = actor.dstar_request("status", None).await.unwrap();
            assert_eq!(inactive.error, None);
            assert_eq!(inactive.status, "stopped");
        }
        actor.error = None;
        actor
            .owned
            .as_mut()
            .unwrap()
            .observe_models(true, Err("transient".into()), port);
        let inactive = actor.dstar_request("status", None).await.unwrap();
        assert_eq!(inactive.error, None);
        assert_eq!(inactive.status, "stopped");
        // Dropping a generation drops its observation, not a lifecycle fault.
        actor.shutdown().await;
        assert_eq!(actor.visible_error_for(Some(Engine::Strata)), None);
        actor.error = Some("engineExited: mock".into());
        let stopped_error = actor.snapshot(None).await;
        assert_eq!(stopped_error.error.as_deref(), Some("engineExited: mock"));
        assert_eq!(stopped_error.status, "error");
    }

    async fn close_controller(controller: &DstarController) {
        controller.closing.store(true, Ordering::SeqCst);
        let (reply, answer) = oneshot::channel();
        controller.tx.send(Message::Shutdown(reply)).await.unwrap();
        tokio::time::timeout(Duration::from_secs(15), answer)
            .await
            .unwrap()
            .unwrap();
    }

    async fn wait_managed(
        controller: &DstarController,
        engine: Option<Engine>,
    ) -> managed_engines::Snapshot {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let state = controller
                .managed_request("status".into(), engine, None)
                .await
                .unwrap();
            if state.engine == engine && state.status != "stopping" {
                return state;
            }
            assert!(Instant::now() < deadline, "state: {state:?}");
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn legacy_dstar_start_coordinates_owned_strata_shutdown() {
        let (_root, env) = managed_fixture();
        let controller = DstarController::with_environment(env);
        let state = controller
            .managed_request("ensure".into(), Some(Engine::Strata), None)
            .await
            .unwrap();
        assert_eq!(state.engine, Some(Engine::Strata));
        assert!(state.owned);
        let requested = Selection {
            model: "iq3".into(),
            context: 32768,
        };
        let queued = controller
            .request("start".into(), Some(requested.clone()))
            .await
            .unwrap();
        assert_eq!(queued.status, "loading");
        assert!(!queued.owned);
        assert_eq!(queued.selection, requested);
        let state = wait_managed(&controller, Some(Engine::Dstar)).await;
        assert!(state.owned);
        assert_eq!(state.engine, Some(Engine::Dstar));
        assert_eq!(
            controller
                .request("status".into(), None)
                .await
                .unwrap()
                .selection,
            requested
        );
        close_controller(&controller).await;
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn unrelated_models_response_is_never_owned_readiness() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (_root, env) = managed_fixture();
        let port = env.dstar_port;
        let controller = DstarController::with_environment(env);
        controller.request("start".into(), None).await.unwrap();
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
            .await
            .unwrap();
        let responder = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let mut request = [0; 4096];
                let _ = socket.read(&mut request).await;
                let body = r#"{"data":[{"id":"unrelated-model"}]}"#;
                let response = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{}", body.len(), body);
                let _ = socket.write_all(response.as_bytes()).await;
            }
        });
        let state = controller
            .managed_request("status".into(), Some(Engine::Dstar), None)
            .await
            .unwrap();
        assert_eq!(state.status, "error");
        assert_eq!(state.error.as_deref(), Some("foreignEngine"));
        assert!(state.served_models.is_empty());
        assert!(state.owned);
        close_controller(&controller).await;
        responder.abort();
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn foreign_strata_port_blocks_direct_dstar_without_touching_listener() {
        let (_root, mut env) = managed_fixture();
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        env.strata_port = listener.local_addr().unwrap().port();
        let controller = DstarController::with_environment(env);
        assert_eq!(
            controller.request("start".into(), None).await.unwrap_err(),
            "foreignEngine"
        );
        assert_eq!(
            controller
                .managed_request("ensure".into(), Some(Engine::Strata), None)
                .await
                .unwrap_err(),
            "foreignEngine"
        );
        assert!(listener.local_addr().is_ok());
        close_controller(&controller).await;
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn competing_listener_does_not_stop_the_current_engine() {
        let (_root, env) = managed_fixture();
        let strata_port = env.strata_port;
        let controller = DstarController::with_environment(env);
        controller.request("start".into(), None).await.unwrap();
        let listener =
            std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, strata_port)).unwrap();
        assert_eq!(
            controller
                .managed_request("ensure".into(), Some(Engine::Strata), None)
                .await
                .unwrap_err(),
            "foreignEngine"
        );
        let state = controller.request("status".into(), None).await.unwrap();
        assert!(state.owned);
        assert_eq!(state.status, "loading");
        close_controller(&controller).await;
        assert!(listener.local_addr().is_ok());
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn rapid_switches_coalesce_and_do_not_overlap_children() {
        let (root, env) = managed_fixture();
        // Hold graceful shutdown long enough for both later requests to queue.
        fs::write(root.path().join("dstar"), b"trap 'sleep 1; exit 0' TERM\nprintf '%s' $$ > atomic-test.pid\nwhile :; do sleep 0.1; done\n").unwrap();
        let controller = DstarController::with_environment(env);
        controller.request("start".into(), None).await.unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        let first = controller
            .managed_request("ensure".into(), Some(Engine::Strata), None)
            .await
            .unwrap();
        assert_eq!(first.status, "stopping");
        let latest = controller
            .managed_request("ensure".into(), Some(Engine::Dstar), None)
            .await
            .unwrap();
        assert_eq!(latest.desired_engine, Some(Engine::Dstar));
        let state = wait_managed(&controller, Some(Engine::Dstar)).await;
        assert_eq!(state.status, "loading");
        assert!(!root.path().join("strata-test.pid").exists());
        close_controller(&controller).await;
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn launcher_exit_waits_for_owned_checkpoint_descendant() {
        let (root, env) = managed_fixture();
        fs::write(root.path().join("checkpoint-worker.sh"), b"trap 'sleep 1; printf saved > descendant-checkpoint; exit 0' TERM\nwhile :; do sleep 0.1; done\n").unwrap();
        fs::write(
            root.path().join("dstar"),
            b"trap 'exit 0' TERM\n/bin/bash checkpoint-worker.sh &\nwait $!\n",
        )
        .unwrap();
        let controller = DstarController::with_environment(env);
        controller.request("start".into(), None).await.unwrap();
        tokio::time::sleep(Duration::from_millis(150)).await;
        controller
            .managed_request("ensure".into(), Some(Engine::Strata), None)
            .await
            .unwrap();
        let state = wait_managed(&controller, Some(Engine::Strata)).await;
        assert!(state.owned);
        assert!(root.path().join("descendant-checkpoint").exists());
        close_controller(&controller).await;
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn newest_choice_wins_after_launcher_is_reaped_but_descendant_is_draining() {
        let (root, env) = managed_fixture();
        fs::write(
            root.path().join("checkpoint-worker.sh"),
            b"trap 'sleep 1; exit 0' TERM\nwhile :; do sleep 0.1; done\n",
        )
        .unwrap();
        fs::write(
            root.path().join("dstar"),
            b"trap 'exit 0' TERM\n/bin/bash checkpoint-worker.sh &\nwait $!\n",
        )
        .unwrap();
        let mut actor = Actor {
            strata_context: managed_engines::DEFAULT_STRATA_CONTEXT,
            error_engine: None,
            env,
            client: reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_millis(500))
                .build()
                .unwrap(),
            owned: None,
            stopping: None,
            pending: None,
            selection: Selection::default(),
            error: None,
        };
        actor
            .start(RequestedEngine {
                engine: Engine::Dstar,
                selection: Selection::default(),
                strata_context: managed_engines::DEFAULT_STRATA_CONTEXT,
            })
            .unwrap();
        tokio::time::sleep(Duration::from_millis(150)).await;
        actor
            .ensure(RequestedEngine {
                engine: Engine::Strata,
                selection: Selection::default(),
                strata_context: managed_engines::DEFAULT_STRATA_CONTEXT,
            })
            .await
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while actor
            .owned
            .as_ref()
            .is_some_and(|owned| owned.process.id().is_some())
        {
            actor.tick().await;
            assert!(Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(actor.owned.is_some());
        actor
            .ensure(RequestedEngine {
                engine: Engine::Dstar,
                selection: Selection::default(),
                strata_context: managed_engines::DEFAULT_STRATA_CONTEXT,
            })
            .await
            .unwrap();
        assert_eq!(actor.pending.as_ref().unwrap().engine, Engine::Dstar);
        while actor.stopping.is_some() {
            actor.tick().await;
            assert!(Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(actor.owned.as_ref().unwrap().engine, Engine::Dstar);
        assert!(!root.path().join("strata-test.pid").exists());
        actor.shutdown().await;
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn cancellation_clears_pending_target_while_previous_engine_drains() {
        let (root, env) = managed_fixture();
        fs::write(
            root.path().join("dstar"),
            b"trap 'sleep 1; exit 0' TERM\nwhile :; do sleep 0.1; done\n",
        )
        .unwrap();
        let controller = DstarController::with_environment(env);
        controller.request("start".into(), None).await.unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        controller
            .managed_request("ensure".into(), Some(Engine::Strata), None)
            .await
            .unwrap();
        controller
            .managed_request("stop".into(), Some(Engine::Strata), None)
            .await
            .unwrap();
        let state = wait_managed(&controller, None).await;
        assert!(!state.owned);
        assert_eq!(state.status, "stopped");
        assert!(!root.path().join("strata-test.pid").exists());
        close_controller(&controller).await;
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn failed_target_never_restarts_or_overlaps_previous_engine() {
        let (root, env) = managed_fixture();
        fs::write(env.mock_strata.as_ref().unwrap(), b"exit 7\n").unwrap();
        let controller = DstarController::with_environment(env);
        controller.request("start".into(), None).await.unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        controller
            .managed_request("ensure".into(), Some(Engine::Strata), None)
            .await
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let state = controller
                .managed_request("status".into(), Some(Engine::Strata), None)
                .await
                .unwrap();
            if state.status == "error" {
                assert!(!state.owned);
                assert!(state.error.unwrap().starts_with("engineExited"));
                break;
            }
            assert!(Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let dstar = controller.request("status".into(), None).await.unwrap();
        assert!(!dstar.owned);
        assert!(root.path().join("atomic-test.pid").exists());
        close_controller(&controller).await;
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn quitting_while_loading_discards_pending_launch_and_rejects_new_start() {
        let (root, env) = managed_fixture();
        fs::write(
            root.path().join("dstar"),
            b"trap 'sleep 1; exit 0' TERM\nwhile :; do sleep 0.1; done\n",
        )
        .unwrap();
        let controller = DstarController::with_environment(env);
        controller.request("start".into(), None).await.unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        controller
            .managed_request("ensure".into(), Some(Engine::Strata), None)
            .await
            .unwrap();
        close_controller(&controller).await;
        assert_eq!(
            controller
                .managed_request("ensure".into(), Some(Engine::Strata), None)
                .await
                .unwrap_err(),
            "controllerStopping"
        );
        assert!(!root.path().join("strata-test.pid").exists());
    }

    #[test]
    fn checkpoint_shutdown_outlives_the_old_five_second_limit() {
        assert!(!stop_grace_expired(Duration::from_secs(6)));
        assert!(!stop_grace_expired(Duration::from_secs(119)));
        assert!(stop_grace_expired(Duration::from_secs(120)));
        assert!(SHUTDOWN_REPLY_GRACE > STOP_GRACE);
    }

    #[test]
    fn missing_quant_is_not_confused_with_its_range_maps() {
        let root = fixture();
        let q2 = root.path().join("models/Q2_0");
        fs::create_dir_all(&q2).unwrap();
        fs::write(
            q2.join("Qwen3.8-Flash-Next-GSQ-RCO-Q2_0-00001-of-00002.gguf.ranges.json"),
            b"{}",
        )
        .unwrap();
        let models = choices(root.path());
        assert!(models.iter().find(|m| m.id == "iq3").unwrap().available);
        assert!(!models.iter().find(|m| m.id == "q2").unwrap().available);
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn hybrid_launch_is_explicit_and_keeps_the_legacy_cache() {
        let root = fixture();
        let hybrid = root.path().join("models/SHEFOWL-HYBRID");
        fs::create_dir_all(&hybrid).unwrap();
        for shard in [1, 2] {
            fs::write(
                hybrid.join(format!(
                    "Qwen3.8-Flash-Next-GSQ-RCO-abliterated-IQ3_XXS-Q2_0-{shard:05}-of-00002.gguf"
                )),
                b"GGUF1234",
            )
            .unwrap();
        }
        let old_cache = root.path().join("kv-cache-iq3");
        fs::create_dir_all(&old_cache).unwrap();
        fs::write(old_cache.join("keep"), b"original checkpoint").unwrap();
        fs::write(
            root.path().join("dstar"),
            b"printf '%s\n' \"$@\" > captured-args\n",
        )
        .unwrap();
        let selection = Selection {
            model: "shefowl-hybrid".into(),
            context: DEFAULT_CONTEXT,
        };
        let mut child = launch(root.path(), &selection, unused_port()).unwrap();
        assert!(child.wait().await.unwrap().success());
        let args = fs::read_to_string(root.path().join("captured-args")).unwrap();
        let args: Vec<_> = args.lines().collect();
        assert_eq!(&args[..3], &["serve", "--quant", "shefowl-hybrid"]);
        let cache_index = args.iter().position(|arg| *arg == "--kv-disk-dir").unwrap();
        assert_eq!(
            Path::new(args[cache_index + 1]),
            root.path().join("kv-cache-shefowl-hybrid")
        );
        assert_eq!(
            fs::read(old_cache.join("keep")).unwrap(),
            b"original checkpoint"
        );
        let encoded = serde_json::to_string(&selection).unwrap();
        assert_eq!(
            serde_json::from_str::<Selection>(&encoded).unwrap(),
            selection
        );
    }

    #[test]
    fn hybrid_requires_its_explicit_pair_and_reports_the_accurate_name() {
        let root = fixture();
        let hybrid = root.path().join("models/SHEFOWL-HYBRID");
        fs::create_dir_all(&hybrid).unwrap();
        let first =
            hybrid.join("Qwen3.8-Flash-Next-GSQ-RCO-abliterated-IQ3_XXS-Q2_0-00001-of-00002.gguf");
        let second =
            hybrid.join("Qwen3.8-Flash-Next-GSQ-RCO-abliterated-IQ3_XXS-Q2_0-00002-of-00002.gguf");
        fs::write(&first, b"GGUF1234").unwrap();
        let models = choices(root.path());
        let model = models.iter().find(|m| m.id == "shefowl-hybrid").unwrap();
        assert!(!model.available); // The fixture's legacy IQ3 shard is not reused.
        assert_eq!(model.reason.as_deref(), Some("missingFiles"));
        assert_eq!(
            model.name,
            "Qwen3.8 Flash Next · shefowl512E · IQ3_XXS/Q2_0"
        );
        fs::write(&second, b"GGUF5678").unwrap();
        let models = choices(root.path());
        let model = models.iter().find(|m| m.id == "shefowl-hybrid").unwrap();
        assert!(model.available);
        assert_eq!(model.bytes, 16);
        assert!(validate(
            &Selection {
                model: "shefowl-hybrid".into(),
                context: DEFAULT_CONTEXT,
            },
            &models
        )
        .is_ok());
        fs::write(&second, b"broken!").unwrap();
        assert!(
            !choices(root.path())
                .iter()
                .find(|m| m.id == "shefowl-hybrid")
                .unwrap()
                .available
        );
        assert_eq!(Selection::default().model, "iq3");
    }

    #[test]
    fn official_iq2_requires_its_explicit_pair_and_label() {
        let root = fixture();
        let official = root.path().join("models/IQ2_XS");
        fs::create_dir_all(&official).unwrap();
        let first = official.join("Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00001-of-00002.gguf");
        let second = official.join("Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00002-of-00002.gguf");
        fs::write(&first, b"GGUF1234").unwrap();
        let models = choices(root.path());
        let model = models.iter().find(|m| m.id == "ista-iq2-xs").unwrap();
        assert_eq!(model.name, "Qwen3.8 Flash Next · ISTA · IQ2_XS");
        assert!(!model.available);
        assert_eq!(model.reason.as_deref(), Some("missingFiles"));
        fs::write(&second, b"GGUF5678").unwrap();
        let models = choices(root.path());
        let model = models.iter().find(|m| m.id == "ista-iq2-xs").unwrap();
        assert!(model.available);
        assert_eq!(model.bytes, 16);
        assert!(validate(
            &Selection {
                model: "ista-iq2-xs".into(),
                context: DEFAULT_CONTEXT,
            },
            &models
        )
        .is_ok());
        fs::write(&second, b"broken!").unwrap();
        assert!(
            !choices(root.path())
                .iter()
                .find(|m| m.id == "ista-iq2-xs")
                .unwrap()
                .available
        );
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[tokio::test]
    async fn official_iq2_launch_keeps_each_previous_cache_separate() {
        let root = fixture();
        let official = root.path().join("models/IQ2_XS");
        fs::create_dir_all(&official).unwrap();
        for shard in [1, 2] {
            fs::write(
                official.join(format!(
                    "Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-{shard:05}-of-00002.gguf"
                )),
                b"GGUF1234",
            )
            .unwrap();
        }
        for cache in ["kv-cache-iq3", "kv-cache-shefowl-hybrid"] {
            fs::create_dir_all(root.path().join(cache)).unwrap();
            fs::write(root.path().join(cache).join("keep"), b"original checkpoint").unwrap();
        }
        fs::write(
            root.path().join("dstar"),
            b"printf '%s\n' \"$@\" > captured-args\n",
        )
        .unwrap();
        let selection = Selection {
            model: "ista-iq2-xs".into(),
            context: DEFAULT_CONTEXT,
        };
        let mut child = launch(root.path(), &selection, unused_port()).unwrap();
        assert!(child.wait().await.unwrap().success());
        let args = fs::read_to_string(root.path().join("captured-args")).unwrap();
        let args: Vec<_> = args.lines().collect();
        assert_eq!(&args[..3], &["serve", "--quant", "ista-iq2-xs"]);
        let index = args.iter().position(|arg| *arg == "--kv-disk-dir").unwrap();
        assert_eq!(
            Path::new(args[index + 1]),
            root.path().join("kv-cache-ista-iq2-xs")
        );
        for cache in ["kv-cache-iq3", "kv-cache-shefowl-hybrid"] {
            assert_eq!(
                fs::read(root.path().join(cache).join("keep")).unwrap(),
                b"original checkpoint"
            );
        }
        let encoded = serde_json::to_string(&selection).unwrap();
        assert_eq!(
            serde_json::from_str::<Selection>(&encoded).unwrap(),
            selection
        );
    }

    #[test]
    fn incomplete_preallocated_ranges_are_not_models() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("model.gguf");
        fs::write(&path, b"GGUF123456789012").unwrap();
        fs::write(
            temp.path().join("model.gguf.ranges.json"),
            br#"{"prefix":0,"done":[[0,3],[8,15]]}"#,
        )
        .unwrap();
        assert_eq!(payload_ready(&path).unwrap_err(), "incompleteFiles");
        fs::write(
            temp.path().join("model.gguf.ranges.json"),
            br#"{"prefix":4,"done":[[4,15]]}"#,
        )
        .unwrap();
        assert_eq!(payload_ready(&path).unwrap(), 16);
    }
    #[test]
    fn selection_does_not_allow_commands_or_unbounded_contexts() {
        let list = vec![ModelChoice {
            id: "iq3".into(),
            name: "test".into(),
            available: true,
            reason: None,
            bytes: 16,
        }];
        assert!(validate(&Selection::default(), &list).is_ok());
        assert!(validate(
            &Selection {
                model: "--lan".into(),
                context: DEFAULT_CONTEXT
            },
            &list
        )
        .is_err());
        assert!(validate(
            &Selection {
                model: "iq3".into(),
                context: u32::MAX
            },
            &list
        )
        .is_err());
    }
}
