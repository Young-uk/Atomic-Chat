//! Personal-fork Dstar control. A single actor owns the child and every transition;
//! the UI never supplies a command, executable path, host, or extra arguments.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};
use tauri::{Manager, Runtime};
use tokio::{
    process::{Child, Command},
    sync::{mpsc, oneshot},
};

const PORT: u16 = 8010;
const DEFAULT_CONTEXT: u32 = 65_536;
// Long-context KV checkpoints must finish before the owned process is killed.
// Keep a bounded fallback for an unresponsive server, including app exit.
const STOP_GRACE: Duration = Duration::from_secs(120);
const SHUTDOWN_REPLY_GRACE: Duration = Duration::from_secs(125);

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
    Shutdown(oneshot::Sender<()>),
}

pub struct DstarController {
    tx: mpsc::Sender<Message>,
}
impl DstarController {
    pub fn new(root: PathBuf) -> Self {
        Self::with_port(root, PORT)
    }

    fn with_port(root: PathBuf, port: u16) -> Self {
        let (tx, rx) = mpsc::channel(16);
        tauri::async_runtime::spawn(run(root, rx, port));
        Self { tx }
    }

    async fn request(
        &self,
        action: String,
        selection: Option<Selection>,
    ) -> Result<Snapshot, String> {
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

// A preallocated file is not a downloaded model. Our legacy downloader's map
// has inclusive completed ranges and a separately completed prefix.
fn payload_ready(path: &Path) -> Result<u64, String> {
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
    [("q2", "Q2_0"), ("iq3", "IQ3_XXS"), ("iq3s", "IQ3_S")]
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
        .collect()
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
    // Keep the existing IQ3 KV directory and 2 GiB disk cap. Other quants get
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
        .args(["--kv-disk-space-mb", "2048"])
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
    cmd.spawn().map_err(|e| e.to_string())
}

fn signal_child(child: &mut Child, force: bool) {
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

async fn run(root: PathBuf, mut rx: mpsc::Receiver<Message>, port: u16) {
    let client = match reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(500))
        .build()
    {
        Ok(client) => client,
        Err(_) => return,
    };
    let mut child: Option<Child> = None;
    let mut stopping: Option<Instant> = None;
    let mut started: Option<Instant> = None;
    let mut selection = fs::read(root.join("atomic-settings.json"))
        .ok()
        .and_then(|v| serde_json::from_slice::<Selection>(&v).ok())
        .unwrap_or_default();
    let mut error = None;
    let mut ticker = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            message = rx.recv() => match message {
                Some(Message::Shutdown(reply)) => {
                    if let Some(mut process) = child.take() {
                        signal_child(&mut process, false);
                        if tokio::time::timeout(STOP_GRACE, process.wait()).await.is_err() {
                            signal_child(&mut process, true); let _ = process.wait().await;
                        }
                    }
                    let _ = reply.send(()); break;
                }
                Some(Message::Request { action, selection: requested, reply }) => {
                    let result = match action.as_str() {
                        "start" => {
                            if child.is_some() { Err("alreadyRunning".to_string()) } else {
                                let next = requested.unwrap_or_else(|| selection.clone());
                                match launch(&root, &next, port) {
                                    Ok(process) => {
                                        child = Some(process); selection = next; error = None;
                                        stopping = None; started = Some(Instant::now());
                                        if let Ok(bytes) = serde_json::to_vec(&selection) { let _ = fs::write(root.join("atomic-settings.json"), bytes); }
                                        Ok(())
                                    }
                                    Err(message) => Err(message),
                                }
                            }
                        }
                        "stop" => {
                            if let Some(process) = child.as_mut() {
                                if stopping.is_none() { signal_child(process, false); stopping = Some(Instant::now()); }
                                Ok(())
                            } else { Err("notOwned".into()) }
                        }
                        "status" => Ok(()),
                        _ => Err("unknownAction".into()),
                    };
                    if let Err(message) = result { let _ = reply.send(Err(message)); continue; }
                    let models = choices(&root);
                    let served = if cfg!(all(target_os = "macos", target_arch = "aarch64")) { served_models(&client, port).await } else { vec![] };
                    let available = cfg!(all(target_os = "macos", target_arch = "aarch64")) && root.join("dstar").is_file() && root.join("ds4-server").is_file();
                    let status = if !available { "unavailable" } else if stopping.is_some() { "stopping" }
                        else if !served.is_empty() { if child.is_some() { "ready" } else { "external" } }
                        else if child.is_some() { "loading" } else if error.is_some() { "error" } else { "stopped" };
                    let snapshot = Snapshot { available, status: status.into(), owned: child.is_some(), selection: selection.clone(), models,
                        served_models: served, elapsed_seconds: started.map(|t| t.elapsed().as_secs()).unwrap_or(0), error: error.clone(), log: log_tail(&root) };
                    let _ = reply.send(Ok(snapshot));
                }
                None => { if let Some(mut process) = child.take() { signal_child(&mut process, true); let _ = process.wait().await; } break; }
            },
            _ = ticker.tick() => {
                if let Some(process) = child.as_mut() {
                    if stopping.is_some_and(|t| stop_grace_expired(t.elapsed())) { signal_child(process, true); }
                    match process.try_wait() {
                        Ok(Some(status)) => {
                            if stopping.is_none() { error = Some(format!("Dstar exited: {status}")); }
                            child = None; stopping = None; started = None;
                        }
                        Err(e) => { error = Some(e.to_string()); signal_child(process, true); child = None; stopping = None; }
                        Ok(None) => {}
                    }
                }
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

    fn unused_port() -> u16 {
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
        controller.request("start".into(), Some(Selection::default())).await.unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !root.path().join("checkpoint-ready").exists() {
            assert!(Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let (reply, answer) = oneshot::channel();
        controller.tx.send(Message::Shutdown(reply)).await.unwrap();
        tokio::time::timeout(Duration::from_secs(15), answer).await.unwrap().unwrap();
        assert!(root.path().join("checkpoint-saved").exists());
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
