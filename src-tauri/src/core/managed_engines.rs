//! Fixed personal-engine launch policy. The shared Dstar actor is the only caller;
//! neither executable paths nor command arguments cross the renderer boundary.
#[cfg(unix)]
#[path = "atomic_child_path.rs"]
mod atomic_child_path;

#[path = "gguf_context.rs"]
pub(super) mod gguf_context;

use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::process::{Child, Command};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Dstar,
    Strata,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub max_context: Option<u32>,
    pub strata_context: u32,
    pub active_context: Option<u32>,
    pub engine: Option<Engine>,
    pub desired_engine: Option<Engine>,
    pub status: String,
    pub owned: bool,
    pub served_models: Vec<String>,
    pub elapsed_seconds: u64,
    pub error: Option<String>,
}

// Reserve the native signed-position headroom; actual RAM admission remains
// owned by the engine. The summary contract still requires at least 16K.
pub(super) const DEFAULT_STRATA_CONTEXT: u32 = 65_536;
pub(super) const MAX_LOCAL_CONTEXT: u32 = i32::MAX as u32 - 8192 - 128;

fn strata_summary_budget(context: u32) -> u64 {
    // Keep the validated 64K allowance. Each extra native cell contributes
    // 14,208 bytes across the twelve mutable attention layers; fixed recurrent
    // state, alignment and descriptor headroom remain covered by the base.
    1_300_000_000 + u64::from(context.saturating_sub(DEFAULT_STRATA_CONTEXT)) * 14_208
}
pub(super) fn validate_strata_context(context: u32) -> Result<(), String> {
    if (16_384..=MAX_LOCAL_CONTEXT).contains(&context) {
        Ok(())
    } else {
        Err("invalidStrataContext".into())
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StrataSettings {
    context: u32,
}

// Run only the pinned read-only calculator, never an inference engine. Checking
// the baseline before projecting one context field prevents requalifying drift.
const CONTEXT_PIN_SCRIPT: &str = r#"
import hashlib, json, pathlib, sys
cfg = json.load(sys.stdin)
root = pathlib.Path(cfg['cwd']) / 'serve'
names = ('server.py', 'atomic_summary.py', 'priority.py', 'priority_client.py', 'disk_session.py', 'history_plan.py')
hashes = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in names}
backend = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()
if backend != cfg['atomic_summary_expected_backend_sha256']:
    raise ValueError('strataContextPinMismatch')
from serve.server import prepare_summary_qualification_pins
import copy
baseline = copy.deepcopy(cfg)
index = baseline['args'].index('--max-context') + 1
context = int(cfg['args'][index])
expected_budget = 1300000000 + max(0, context - 65536) * 14208
if cfg.get('atomic_summary_state_bank_max_bytes') != expected_budget:
    raise ValueError('strataContextPinMismatch')
baseline['args'][index] = '65536'
baseline['atomic_summary_state_bank_max_bytes'] = 1300000000
observed = prepare_summary_qualification_pins(baseline, offline=True)
for key, value in observed.items():
    if value != baseline.get(key):
        raise ValueError('strataContextPinMismatch')
projected = prepare_summary_qualification_pins(cfg, offline=True)
for key in ('atomic_summary_expected_native_sha256', 'atomic_summary_expected_backend_sha256'):
    if projected.get(key) != cfg.get(key):
        raise ValueError('strataContextPinMismatch')
print(json.dumps(projected))
"#;

pub(super) struct Environment {
    pub dstar_root: PathBuf,
    pub strata_root: PathBuf,
    pub dstar_port: u16,
    pub strata_port: u16,
    pub other_ports: Vec<u16>,
    pub scan_processes: bool,
    #[cfg(test)]
    pub mock_strata: Option<PathBuf>,
}

impl Environment {
    pub fn personal(dstar_root: PathBuf) -> Self {
        let home = dirs::home_dir().unwrap_or_default();
        Self {
            dstar_root,
            strata_root: home.join("strata-iq2-comparison-nov08"),
            dstar_port: 8010,
            strata_port: 18080,
            other_ports: vec![18010],
            scan_processes: true,
            #[cfg(test)]
            mock_strata: None,
        }
    }

    pub fn strata_model_context(&self) -> Option<u32> {
        gguf_context::read(
            &self
                .dstar_root
                .join("models/IQ3_XXS/Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00001-of-00002.gguf"),
        )
    }

    pub fn load_strata_context(&self) -> u32 {
        fs::read(self.dstar_root.join("atomic-strata-settings.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<StrataSettings>(&bytes).ok())
            .map(|settings| settings.context)
            .filter(|context| validate_strata_context(*context).is_ok())
            .unwrap_or(DEFAULT_STRATA_CONTEXT)
    }

    pub fn save_strata_context(&self, context: u32) -> Result<(), String> {
        validate_strata_context(context)?;
        // A separate atomic file cannot overwrite Dstar's model/context choice.
        fs::create_dir_all(&self.dstar_root).map_err(|_| "strataSettingsWriteFailed")?;
        let temporary = self.dstar_root.join(format!(
            ".atomic-strata-settings-{}.json",
            uuid::Uuid::new_v4()
        ));
        let result = (|| {
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&temporary)
                .map_err(|_| "strataSettingsWriteFailed")?;
            file.write_all(
                &serde_json::to_vec(&StrataSettings { context })
                    .map_err(|_| "strataSettingsWriteFailed")?,
            )
            .map_err(|_| "strataSettingsWriteFailed")?;
            file.sync_all().map_err(|_| "strataSettingsWriteFailed")?;
            fs::rename(
                &temporary,
                self.dstar_root.join("atomic-strata-settings.json"),
            )
            .map_err(|_| "strataSettingsWriteFailed")
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result.map_err(str::to_owned)
    }

    pub fn port(&self, engine: Engine) -> u16 {
        match engine {
            Engine::Dstar => self.dstar_port,
            Engine::Strata => self.strata_port,
        }
    }

    pub fn ports_free(&self) -> Result<(), String> {
        // Keep the probes together so no two configured ports can be duplicates.
        let mut probes = Vec::new();
        for port in [self.dstar_port, self.strata_port]
            .into_iter()
            .chain(self.other_ports.iter().copied())
        {
            probes.push(
                std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
                    .map_err(|_| "foreignEngine".to_string())?,
            );
            probes.push(
                std::net::TcpListener::bind((std::net::Ipv6Addr::LOCALHOST, port))
                    .map_err(|_| "foreignEngine".to_string())?,
            );
        }
        Ok(())
    }

    pub fn ensure_no_foreign_engine(&self) -> Result<(), String> {
        self.ports_free()?;
        if !self.scan_processes {
            return Ok(());
        }
        use sysinfo::{ProcessesToUpdate, System};
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::All, true);
        // Fail closed if process inspection failed. A closed port is not proof
        // that an engine still loading its weights has released GPU memory.
        if system.processes().is_empty() {
            return Err("processInspectionFailed".into());
        }
        if system.processes().values().any(|process| {
            process.status() != sysinfo::ProcessStatus::Zombie
                && is_heavy_engine(
                    &process.name().to_string_lossy(),
                    &process
                        .cmd()
                        .iter()
                        .map(|arg| arg.to_string_lossy().into_owned())
                        .collect::<Vec<_>>(),
                )
        }) {
            return Err("foreignEngine".into());
        }
        Ok(())
    }

    pub async fn ensure_no_competitor(&self, engine: Engine, root: u32) -> Result<(), String> {
        for port in [self.dstar_port, self.strata_port]
            .into_iter()
            .chain(self.other_ports.iter().copied())
        {
            if !port_available(port)
                && (port != self.port(engine) || !owns_listener(root, port).await?)
            {
                return Err("foreignEngine".into());
            }
        }
        if self.scan_processes {
            let owned = owned_pids(root)?;
            let mut system = sysinfo::System::new();
            system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
            if system.processes().is_empty() {
                return Err("processInspectionFailed".into());
            }
            if system.processes().iter().any(|(pid, process)| {
                !owned.contains(&pid.as_u32())
                    && process.status() != sysinfo::ProcessStatus::Zombie
                    && is_heavy_engine(
                        &process.name().to_string_lossy(),
                        &process
                            .cmd()
                            .iter()
                            .map(|a| a.to_string_lossy().into_owned())
                            .collect::<Vec<_>>(),
                    )
            }) {
                return Err("foreignEngine".into());
            }
        }
        Ok(())
    }

    pub fn validate_strata(&self) -> Result<(), String> {
        if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            return Err("unsupportedPlatform".into());
        }
        #[cfg(test)]
        if let Some(script) = &self.mock_strata {
            return script
                .is_file()
                .then_some(())
                .ok_or("missingRuntime".into());
        }
        let root = &self.strata_root;
        for relative in [
            "venv/bin/python",
            "feature-integration/runtime-image-summary-v34/serve/server.py",
            "feature-integration/engine-image-summary-v34/strata",
            "candidate/strata-vision",
            "feature-integration/engine-priority-v7/metal/data/expert-profile.bin",
            "feature-integration/pack-iq3/tokenizer/tokenizer.json",
        ] {
            if !root.join(relative).is_file() {
                return Err(format!("missingStrataRuntime: {relative}"));
            }
        }
        for relative in [
            "models/IQ3_XXS/Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00001-of-00002.gguf",
            "models/IQ3_XXS/Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00002-of-00002.gguf",
            "models/mmproj-Qwen3.8-Flash-Next-Q8_0.gguf",
        ] {
            super::dstar::payload_ready(&self.dstar_root.join(relative))?;
        }
        Ok(())
    }

    fn strata_config(&self, context: u32) -> serde_json::Value {
        let root = &self.strata_root;
        let first = self
            .dstar_root
            .join("models/IQ3_XXS/Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00001-of-00002.gguf");
        serde_json::json!({
            "exe": root.join("feature-integration/engine-image-summary-v34/strata"),
            "args": [
                "--pack", root.join("feature-integration/pack-iq3").to_string_lossy(),
                "--native", first.to_string_lossy(),
                "--ple-gguf", self.dstar_root.join("models/IQ3_XXS/Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00002-of-00002.gguf").to_string_lossy(),
                "--expert-profile", root.join("feature-integration/engine-priority-v7/metal/data/expert-profile.bin").to_string_lossy(),
                "--expert-cache", "64", "--prefill", "2048", "--spec", "2",
                "--max-context", context.to_string(), "--mmap-experts", "--prompt-cache", "6",
                "--conversation-cache-mib", "1024", "--kv", "int8", "--suffix-draft", "0", "--vision"
            ],
            "cwd": root.join("feature-integration/runtime-image-summary-v34"),
            "tokenizer": root.join("feature-integration/pack-iq3/tokenizer"),
            "model_name": "ista-iq3-xxs",
            "effort_position": "end",
            "log": root.join("strata-atomic.log"),
            "atomic_disk_session_dir": self.dstar_root.join("kv-cache-strata-iq3"),
            "atomic_disk_session_previous_backend_sha256": "d011acf0ee6a13ddf08ede2967e0cd345a6c327358b1426997c5fb89173bcf1b",
            "atomic_summary_mode": "state-bank-v1",
            "atomic_summary_scheduler": "weighted-quanta-v1",
            "atomic_summary_foreground_weight": 8,
            "atomic_summary_state_bank_enabled": true,
            "atomic_summary_clone_enabled": true,
            "atomic_summary_state_bank_max_bytes": strata_summary_budget(context),
            "atomic_summary_state_bank_provenance": "experimental-user-validation",
            "atomic_summary_transaction_qualified": false,
            "atomic_completion_review_qualified": false,
            "atomic_summary_expected_native_sha256": "cc8a0002024dc5cc2ddba0c57938390354b654028b789f330d0bda2d27252052",
            "atomic_summary_expected_model_fingerprint": "strata-stat-v2:401f2352597b8d474e478ec358050f3036d38d040eaa1d73c5dddd8bd86a8612",
            "atomic_summary_expected_backend_sha256": "6613de82d4eaecb3a932e2f4621f0dbca646e9304593d47aa642d4932a8ac709",
            "backend": "metal", "lib_dirs": [], "port": self.strata_port,
            "host": "127.0.0.1", "open_browser": false, "mtp": false, "api_monitor": false,
            "env": {
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                "STRATA_METAL_PROMPT_EXPERTS": "v2", "STRATA_METAL_F16": "0",
                "STRATA_METAL_PROMPT_CHUNK": "2048", "STRATA_ROUTE_TAIL_SKIP": "0",
                "STRATA_PREFILL_CPU_SHARE": "0",
                "STRATA_ATOMIC_SUMMARY_HEADROOM_TOKENS": "8192"
            },
            "vision": {
                "exe": root.join("candidate/strata-vision"),
                "mmproj": self.dstar_root.join("models/mmproj-Qwen3.8-Flash-Next-Q8_0.gguf"),
                "model": first, "gpu": true, "max_tokens": 1024
            }
        })
    }

    fn pinned_strata_config(&self, context: u32) -> Result<serde_json::Value, String> {
        validate_strata_context(context)?;
        let mut config = self.strata_config(context);
        let mut cmd = std::process::Command::new(self.strata_root.join("venv/bin/python"));
        cmd.args(["-B", "-c", CONTEXT_PIN_SCRIPT])
            .current_dir(
                self.strata_root
                    .join("feature-integration/runtime-image-summary-v34"),
            )
            .env("PYTHONUNBUFFERED", "1")
            .env("STRATA_NO_PRESET", "1")
            .env_remove("PYTHONPATH")
            .env_remove("PYTHONHOME")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(unix)]
        if let Some(path) =
            atomic_child_path::atomic_deduplicated_path(std::env::var_os("PATH").as_deref())
        {
            cmd.env("PATH", path);
        }
        let mut child = cmd
            .spawn()
            .map_err(|_| "strataContextPinCalculationFailed")?;
        let input = serde_json::to_vec(&config).map_err(|_| "strataContextPinCalculationFailed")?;
        let write = child
            .stdin
            .take()
            .ok_or("strataContextPinCalculationFailed")?
            .write_all(&input);
        if write.is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("strataContextPinCalculationFailed".into());
        }
        let started = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if started.elapsed() < Duration::from_secs(15) => {
                    std::thread::sleep(Duration::from_millis(20))
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("strataContextPinCalculationFailed".into());
                }
            }
        }
        let output = child
            .wait_with_output()
            .map_err(|_| "strataContextPinCalculationFailed")?;
        if !output.status.success() {
            return Err("strataContextPinMismatch".into());
        }
        let pins: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| "strataContextPinCalculationFailed")?;
        for key in [
            "atomic_summary_expected_native_sha256",
            "atomic_summary_expected_backend_sha256",
        ] {
            if pins[key] != config[key] {
                return Err("strataContextPinMismatch".into());
            }
        }
        let fingerprint = pins["atomic_summary_expected_model_fingerprint"]
            .as_str()
            .ok_or("strataContextPinCalculationFailed")?;
        if !fingerprint
            .strip_prefix("strata-stat-v2:")
            .is_some_and(|hash| {
                hash.len() == 64
                    && hash
                        .bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            })
        {
            return Err("strataContextPinCalculationFailed".into());
        }
        config["atomic_summary_expected_model_fingerprint"] = fingerprint.into();
        Ok(config)
    }

    pub fn launch_strata(
        &self,
        context: u32,
    ) -> Result<(Child, Option<PathBuf>, Option<String>), String> {
        validate_strata_context(context)?;
        self.validate_strata()?;
        #[cfg(test)]
        if let Some(script) = &self.mock_strata {
            let mut cmd = Command::new("/bin/bash");
            cmd.arg(script)
                .arg(context.to_string())
                .current_dir(&self.dstar_root)
                .stdin(Stdio::piped())
                .kill_on_drop(false);
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                cmd.as_std_mut().process_group(0);
            }
            return cmd
                .spawn()
                .map(|child| (child, None, None))
                .map_err(|e| e.to_string());
        }
        // Generate the reviewed configuration ourselves, never run hooks or
        // commands from an editable config file supplied by the renderer.
        let configuration = self.pinned_strata_config(context)?;
        let logs = self.dstar_root.join("logs");
        fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
        let config = logs.join(format!("atomic-strata-{}.json", uuid::Uuid::new_v4()));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&config).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(&configuration).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        drop(file);
        let key = hex::encode(rand::random::<[u8; 32]>());
        let result = (|| {
            let log = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(logs.join("atomic-strata.log"))
                .map_err(|e| e.to_string())?;
            let stderr = log.try_clone().map_err(|e| e.to_string())?;
            let mut cmd = Command::new(self.strata_root.join("venv/bin/python"));
            // fix_path_env can append a directory already present in the GUI PATH.
            // Match the qualified lookup order without hiding new unique entries.
            // Only this child changes; native/backend qualification pins stay strict.
            #[cfg(unix)]
            if let Some(path) =
                atomic_child_path::atomic_deduplicated_path(std::env::var_os("PATH").as_deref())
            {
                cmd.env("PATH", path);
            }
            // stdin is the private parent-loss pipe supported by Strata. Keep
            // it open in Child; EOF on an app crash invokes Strata's own cleanup.
            cmd.args(["-m", "serve.server", "--engine", "strata", "--config"])
                .arg(&config)
                .args([
                    "--host",
                    "127.0.0.1",
                    "--port",
                    &self.strata_port.to_string(),
                    "--offline",
                    "--owner-fd",
                    "0",
                    "--shutdown-timeout",
                    "120",
                ])
                .current_dir(
                    self.strata_root
                        .join("feature-integration/runtime-image-summary-v34"),
                )
                .env("STRATA_OWNER_ATTEST_KEY", &key)
                .env("PYTHONUNBUFFERED", "1")
                .env("STRATA_NO_PRESET", "1")
                .env_remove("PYTHONPATH")
                .env_remove("PYTHONHOME")
                .stdin(Stdio::piped())
                .stdout(Stdio::from(log))
                .stderr(Stdio::from(stderr))
                // Killing Python on drop would strand its separately-grouped
                // inference/vision children. Its owner pipe handles this instead.
                .kill_on_drop(false);
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                cmd.as_std_mut().process_group(0);
            }
            cmd.spawn().map_err(|e| e.to_string())
        })();
        match result {
            Ok(child) => Ok((child, Some(config), Some(key))),
            Err(error) => {
                let _ = fs::remove_file(&config);
                Err(error)
            }
        }
    }
}

fn is_heavy_engine(name: &str, args: &[String]) -> bool {
    let binary = |text: &str| {
        matches!(
            Path::new(text).file_name().and_then(|n| n.to_str()),
            Some("ds4-server" | "strata" | "strata-vision")
        )
    };
    binary(name)
        || args.first().is_some_and(|arg| binary(arg))
        || args
            .windows(2)
            .any(|pair| pair[0] == "-m" && pair[1] == "serve.server")
        || args.iter().any(|arg| arg.ends_with("/serve/server.py"))
        || args.windows(2).any(|pair| {
            Path::new(&pair[0])
                .file_name()
                .is_some_and(|name| name == "dstar")
                && pair[1] == "serve"
        })
}

pub(super) fn signal(child: &mut Child, engine: Engine, force: bool) {
    if engine == Engine::Dstar {
        super::dstar::signal_child(child, force);
        return;
    }
    // Signal only the owned Python API. Its finally block drains requests,
    // closes inference through STOP/QUIT and shuts down vision, including their
    // separate process groups. A group signal here bypasses that ordering.
    if let Some(pid) = child.id() {
        #[cfg(unix)]
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
        #[cfg(not(unix))]
        {
            let _ = pid;
            child.stdin.take();
        }
    }
}

pub(super) fn port_available(port: u16) -> bool {
    std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).is_ok()
        && std::net::TcpListener::bind((std::net::Ipv6Addr::LOCALHOST, port)).is_ok()
}

#[derive(Clone, Copy)]
pub(super) struct ProcessIdentity {
    pid: u32,
    started: u64,
}

pub(super) fn owned_family(root: u32) -> Result<Vec<ProcessIdentity>, String> {
    use sysinfo::{Pid, ProcessesToUpdate, System};
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    if system.process(Pid::from_u32(root)).is_none() {
        return Err("processInspectionFailed".into());
    }
    let mut owned = vec![root];
    loop {
        let before = owned.len();
        for (pid, process) in system.processes() {
            if !owned.contains(&pid.as_u32())
                && process
                    .parent()
                    .is_some_and(|p| owned.contains(&p.as_u32()))
            {
                owned.push(pid.as_u32());
            }
        }
        if owned.len() == before {
            return Ok(owned
                .into_iter()
                .filter_map(|pid| {
                    system
                        .process(Pid::from_u32(pid))
                        .map(|process| ProcessIdentity {
                            pid,
                            started: process.start_time(),
                        })
                })
                .collect());
        }
    }
}

fn owned_pids(root: u32) -> Result<Vec<u32>, String> {
    owned_family(root).map(|family| family.into_iter().map(|p| p.pid).collect())
}

pub(super) fn family_alive(family: &[ProcessIdentity]) -> Result<bool, String> {
    use sysinfo::{Pid, ProcessStatus, ProcessesToUpdate, System};
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    if system.processes().is_empty() {
        return Err("processInspectionFailed".into());
    }
    Ok(family.iter().any(|identity| {
        system
            .process(Pid::from_u32(identity.pid))
            .is_some_and(|process| {
                process.start_time() == identity.started
                    && process.status() != ProcessStatus::Zombie
            })
    }))
}

// These queries inspect TCP/Unix socket descriptors, not files on a mount.
// macOS lsof can still emit this unrelated SMB mount-table diagnostic while
// successfully returning socket PIDs. Accept only its exact three-line form;
// permission errors, truncated warnings and every other diagnostic fail closed.
fn socket_inspection_diagnostics_ok(stderr: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(stderr) else {
        return false;
    };
    let mut lines = text.lines();
    while let Some(line) = lines.next() {
        let Some(path) =
            line.strip_prefix("lsof: WARNING: can't stat() smbfs file system /Volumes/")
        else {
            return false;
        };
        if path.is_empty() || lines.next() != Some("      Output information may be incomplete.") {
            return false;
        }
        let Some(device) = lines
            .next()
            .and_then(|line| line.strip_prefix("      assuming \"dev="))
            .and_then(|line| line.strip_suffix("\" from mount table"))
        else {
            return false;
        };
        if device.is_empty() || !device.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return false;
        }
    }
    true
}

async fn lsof(args: &[String]) -> Result<String, String> {
    let output = tokio::time::timeout(
        Duration::from_secs(3),
        Command::new("/usr/sbin/lsof")
            .args(args)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| {
        log::warn!("[atomic-engine] socket inspection failed: kind=timeout");
        "processInspectionFailed".to_string()
    })?
    .map_err(|error| {
        log::warn!(
            "[atomic-engine] socket inspection failed: kind=spawn io={:?}",
            error.kind()
        );
        "processInspectionFailed".to_string()
    })?;
    // lsof's exit 1 with no diagnostics means the filter matched no files.
    if (!output.status.success() && output.status.code() != Some(1))
        || !socket_inspection_diagnostics_ok(&output.stderr)
    {
        log::warn!(
            "[atomic-engine] socket inspection failed: kind=result exit={:?} diagnostic_bytes={}",
            output.status.code(),
            output.stderr.len()
        );
        return Err("processInspectionFailed".into());
    }
    String::from_utf8(output.stdout).map_err(|_| "processInspectionFailed".into())
}

pub(super) async fn owns_listener(root: u32, port: u16) -> Result<bool, String> {
    // Never reuse an old positive observation. One transient OS inspection
    // failure gets one entirely fresh process-tree and socket inspection.
    retry_listener_inspection(|| inspect_listener(root, port)).await
}

async fn retry_listener_inspection<F, Fut>(mut inspect: F) -> Result<bool, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<bool, String>>,
{
    match inspect().await {
        Err(_) => {
            tokio::task::yield_now().await;
            inspect().await
        }
        result => result,
    }
}

async fn inspect_listener(root: u32, port: u16) -> Result<bool, String> {
    let owned = owned_pids(root).map_err(|error| {
        log::warn!("[atomic-engine] socket inspection failed: kind=process-tree root={root}");
        error
    })?;
    let output = lsof(&[
        "-nP".into(),
        format!("-iTCP:{port}"),
        "-sTCP:LISTEN".into(),
        "-Fp".into(),
    ])
    .await?;
    let pids = output
        .lines()
        .filter_map(|line| line.strip_prefix('p'))
        .map(|pid| {
            pid.parse::<u32>()
                .map_err(|_| "processInspectionFailed".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(!pids.is_empty() && pids.iter().all(|pid| owned.contains(pid)))
}

pub(super) async fn check_idle(
    client: &reqwest::Client,
    port: u16,
    engine: Engine,
    has_been_ready: bool,
    root: u32,
) -> Result<(), String> {
    if engine == Engine::Dstar {
        // This installed Dstar has no activity endpoint. A normal request owns
        // an accepted TCP socket; retained/disconnected SSE owns a Unix socket
        // pair until its capture thread finishes (ds4_resumable.h). Check both
        // on the owned launcher AND all its children. Never treat its capability
        // response or an absent HTTP connection as proof of idle retained work.
        let pids = owned_pids(root)?
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        for filter in [vec!["-iTCP", "-sTCP:ESTABLISHED"], vec!["-U"]] {
            let mut args = vec![
                "-nP".into(),
                "-a".into(),
                "-p".into(),
                pids.clone(),
                "-Fp".into(),
            ];
            args.extend(filter.into_iter().map(str::to_string));
            if !lsof(&args).await?.trim().is_empty() {
                return Err("engineBusy".into());
            }
        }
        return Ok(());
    }
    let response = client
        .get(format!("http://127.0.0.1:{port}/v1/status"))
        .send()
        .await;
    let value = match response {
        Ok(response) if response.status().is_success() => {
            response.json::<serde_json::Value>().await.ok()
        }
        _ => None,
    };
    if let Some(value) = value {
        if !owns_listener(root, port).await? {
            return Err("foreignEngine".into());
        }
        return strata_idle_from_status(&value);
    }
    // Before the server binds it cannot have accepted a request. Once ready,
    // an unreadable status is not a license to interrupt an unknown request.
    if !has_been_ready && std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).is_ok()
    {
        Ok(())
    } else {
        Err("engineBusyUnknown".into())
    }
}

// Cancellation of the HTTP summary request is not proof of restored native KV.
// Suspend only this owned server's summary lane, then wait for rollback itself.
pub(super) async fn drain_strata_summary(
    client: &reqwest::Client,
    port: u16,
    root: u32,
    key: &str,
) -> Result<(), String> {
    let initial = strata_status(client, port, root).await?;
    let Some(summary) = initial.get("atomic_summary") else {
        return strata_idle_from_status(&initial);
    };
    // A poisoned runtime may acknowledge an idle shutdown-only barrier. It
    // stays poisoned and cannot resume; never bypass the authenticated barrier.
    if summary["recovery_required"].as_bool() == Some(true) {
        summary_no_foreground(summary)?;
    } else {
        summary_safe_to_drain(summary)?;
    }
    if !owns_listener(root, port).await? {
        return Err("foreignEngine".into());
    }
    let base = format!("http://127.0.0.1:{port}/v1");
    let cancel = client
        .post(format!("{base}/atomic/summary-cancel"))
        .header("X-Atomic-Owner-Key", key)
        .json(&serde_json::json!({"suspend": true, "drain": true}))
        .send()
        .await
        .map_err(|_| "engineBusyUnknown".to_string())?;
    if !cancel.status().is_success() {
        return Err("engineBusyUnknown".into());
    }
    let result = tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            if !owns_listener(root, port).await? {
                return Err("foreignEngine".into());
            }
            let value = client
                .get(format!("{base}/status"))
                .send()
                .await
                .map_err(|_| "engineBusyUnknown".to_string())?
                .error_for_status()
                .map_err(|_| "engineBusyUnknown".to_string())?
                .json::<serde_json::Value>()
                .await
                .map_err(|_| "engineBusyUnknown".to_string())?;
            if value["atomic_summary"]["recovery_required"].as_bool() == Some(true) {
                return strata_idle_from_status(&value);
            }
            summary_safe_to_drain(&value["atomic_summary"])?;
            let reserved = value["atomic_inference_reserved"]
                .as_u64()
                .ok_or("engineBusyUnknown")?;
            let in_flight = value["activity"]["in_flight"]
                .as_u64()
                .ok_or("engineBusyUnknown")?;
            if summary_restored(&value["atomic_summary"])? && reserved == 0 && in_flight == 0 {
                return strata_idle_from_status(&value);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .unwrap_or_else(|_| Err("engineSummaryRollbackTimeout".into()));
    // A refused switch must not permanently disable future background work.
    // Never contact a replacement listener, or resume a poisoned transaction.
    if result.is_err()
        && result.as_ref().err().map(String::as_str) != Some("engineSummaryRecoveryRequired")
        && owns_listener(root, port).await.unwrap_or(false)
    {
        let _ = resume_strata_summary(client, port, root, key).await;
    }
    result
}

pub(super) async fn resume_strata_summary(
    client: &reqwest::Client,
    port: u16,
    root: u32,
    key: &str,
) -> Result<(), String> {
    if !owns_listener(root, port).await? {
        return Err("foreignEngine".into());
    }
    client
        .post(format!("http://127.0.0.1:{port}/v1/atomic/summary-resume"))
        .header("X-Atomic-Owner-Key", key)
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|_| "engineBusyUnknown".to_string())?
        .error_for_status()
        .map_err(|_| "engineBusyUnknown".to_string())?;
    Ok(())
}

async fn strata_status(
    client: &reqwest::Client,
    port: u16,
    root: u32,
) -> Result<serde_json::Value, String> {
    if !owns_listener(root, port).await? {
        return Err("foreignEngine".into());
    }
    client
        .get(format!("http://127.0.0.1:{port}/v1/status"))
        .send()
        .await
        .map_err(|_| "engineBusyUnknown".to_string())?
        .error_for_status()
        .map_err(|_| "engineBusyUnknown".to_string())?
        .json()
        .await
        .map_err(|_| "engineBusyUnknown".to_string())
}

fn summary_safe_to_drain(summary: &serde_json::Value) -> Result<(), String> {
    match summary["recovery_required"].as_bool() {
        Some(true) => return Err("engineSummaryRecoveryRequired".into()),
        Some(false) => (),
        None => return Err("engineBusyUnknown".into()),
    }
    summary_no_foreground(summary)
}

fn summary_no_foreground(summary: &serde_json::Value) -> Result<(), String> {
    match summary["foreground_requests"].as_u64() {
        Some(0) => Ok(()),
        Some(_) => Err("engineBusy".into()),
        None => Err("engineBusyUnknown".into()),
    }
}

fn summary_restored(summary: &serde_json::Value) -> Result<bool, String> {
    summary_safe_to_drain(summary)?;
    let mut restored = true;
    for key in ["pending", "active", "rollback_pending"] {
        restored &= !summary[key].as_bool().ok_or("engineBusyUnknown")?;
    }
    Ok(restored)
}

fn strata_idle_from_status(value: &serde_json::Value) -> Result<(), String> {
    if let Some(summary) = value.get("atomic_summary") {
        if summary["inference_draining"].as_bool() != Some(true) {
            return Err("engineNotQuiesced".into());
        }
        if value["atomic_inference_reserved"].as_u64() != Some(0) {
            return Err("engineBusy".into());
        }
        if summary["recovery_required"].as_bool() == Some(true) {
            if summary["recovery_stop_ready"].as_bool() != Some(true) {
                return Err("engineSummaryRecoveryRequired".into());
            }
            summary_no_foreground(summary)?;
            // rollback_pending remains true for poisoned state. Disposal does
            // not restore it: it is allowed only with no live summary owner,
            // after the runtime has atomically closed all inference admission.
            summary["rollback_pending"]
                .as_bool()
                .ok_or("engineBusyUnknown")?;
            for key in ["pending", "active"] {
                if summary[key].as_bool().ok_or("engineBusyUnknown")? {
                    return Err("engineBusy".into());
                }
            }
        } else if !summary_restored(summary)? {
            return Err("engineBusy".into());
        }
    }
    match value["activity"]["in_flight"].as_u64() {
        Some(0) => Ok(()),
        Some(_) => Err("engineBusy".into()),
        None => Err("engineBusyUnknown".into()),
    }
}

pub(super) const LOAD_GRACE: Duration = Duration::from_secs(300);
// Strata drains for 120 s, then its own bounded inference/vision cleanup runs.
pub(super) const STRATA_STOP_GRACE: Duration = Duration::from_secs(180);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_budget_scales_with_context_without_a_fixed_ceiling() {
        assert_eq!(strata_summary_budget(16_384), 1_300_000_000);
        assert_eq!(strata_summary_budget(65_536), 1_300_000_000);
        assert_eq!(strata_summary_budget(131_072), 2_231_135_488);
        assert!(strata_summary_budget(1_048_576) > strata_summary_budget(524_288));
        assert!(strata_summary_budget(MAX_LOCAL_CONTEXT) < 9_007_199_254_740_991);
        assert!(validate_strata_context(MAX_LOCAL_CONTEXT).is_ok());
        assert!(validate_strata_context(MAX_LOCAL_CONTEXT + 1).is_err());
    }

    #[test]
    fn strata_context_storage_is_separate_bounded_and_recovers_corruption() {
        let root = tempfile::tempdir().unwrap();
        let env = Environment::personal(root.path().into());
        let dstar = br#"{"model":"iq4","context":32768}"#;
        fs::write(root.path().join("atomic-settings.json"), dstar).unwrap();
        assert_eq!(env.load_strata_context(), DEFAULT_STRATA_CONTEXT);
        for context in [16_384, 32_768, 65_536, 65_537, 131_072, 524_288, 1_048_576] {
            env.save_strata_context(context).unwrap();
            assert_eq!(env.load_strata_context(), context);
            let args = env.strata_config(context)["args"]
                .as_array()
                .unwrap()
                .clone();
            let index = args.iter().position(|arg| arg == "--max-context").unwrap();
            assert_eq!(args[index + 1], context.to_string());
        }
        let saved_context = env.load_strata_context();
        for context in [0, 16_383, MAX_LOCAL_CONTEXT + 1, u32::MAX] {
            assert_eq!(
                env.save_strata_context(context).unwrap_err(),
                "invalidStrataContext"
            );
            assert_eq!(env.load_strata_context(), saved_context);
        }
        for invalid in [
            "broken",
            "{\"context\":1}",
            "{\"context\":32768.5}",
            "{\"context\":32768,\"exe\":\"bad\"}",
        ] {
            fs::write(root.path().join("atomic-strata-settings.json"), invalid).unwrap();
            assert_eq!(env.load_strata_context(), DEFAULT_STRATA_CONTEXT);
        }
        assert_eq!(
            fs::read(root.path().join("atomic-settings.json")).unwrap(),
            dstar
        );
    }

    #[test]
    fn recognises_engine_processes_without_matching_unrelated_arguments() {
        for args in [
            vec!["/x/ds4-server"],
            vec!["python", "-m", "serve.server"],
            vec!["python", "/x/serve/server.py"],
            vec!["/bin/bash", "/x/dstar", "serve"],
        ] {
            assert!(is_heavy_engine(
                "python",
                &args.into_iter().map(str::to_string).collect::<Vec<_>>()
            ));
        }
        assert!(!is_heavy_engine(
            "rg",
            &["rg".into(), "strata".into(), "serve.server".into()]
        ));
    }

    #[test]
    fn busy_and_malformed_status_fail_closed() {
        assert!(strata_idle_from_status(&serde_json::json!({"activity":{"in_flight":0}})).is_ok());
        assert_eq!(
            strata_idle_from_status(&serde_json::json!({"activity":{"in_flight":1}})).unwrap_err(),
            "engineBusy"
        );
        assert_eq!(
            strata_idle_from_status(&serde_json::json!({})).unwrap_err(),
            "engineBusyUnknown"
        );
    }

    #[test]
    fn summary_restore_and_admission_drain_are_required_before_stop() {
        let idle = serde_json::json!({
            "activity": {"in_flight": 0}, "atomic_inference_reserved": 0,
            "atomic_summary": {"pending": false, "active": false, "rollback_pending": false,
                "recovery_required": false, "foreground_requests": 0, "inference_draining": true}
        });
        assert!(strata_idle_from_status(&idle).is_ok());
        for field in ["pending", "active", "rollback_pending"] {
            let mut pending = idle.clone();
            pending["atomic_summary"][field] = true.into();
            assert_eq!(strata_idle_from_status(&pending).unwrap_err(), "engineBusy");
        }
        let mut foreground = idle.clone();
        foreground["atomic_summary"]["foreground_requests"] = 1.into();
        assert_eq!(
            strata_idle_from_status(&foreground).unwrap_err(),
            "engineBusy"
        );
        let mut preparing = idle.clone();
        preparing["atomic_inference_reserved"] = 1.into();
        assert_eq!(
            strata_idle_from_status(&preparing).unwrap_err(),
            "engineBusy"
        );
        let mut live_admission = idle.clone();
        live_admission["atomic_summary"]["inference_draining"] = false.into();
        assert_eq!(
            strata_idle_from_status(&live_admission).unwrap_err(),
            "engineNotQuiesced"
        );
        let mut poison = idle.clone();
        poison["atomic_summary"]["recovery_required"] = true.into();
        assert_eq!(
            strata_idle_from_status(&poison).unwrap_err(),
            "engineSummaryRecoveryRequired"
        );
        let mut malformed = idle;
        malformed["atomic_summary"]["active"] = serde_json::Value::Null;
        assert_eq!(
            strata_idle_from_status(&malformed).unwrap_err(),
            "engineBusyUnknown"
        );
    }

    #[test]
    fn poisoned_disposal_requires_explicit_barrier_and_no_remaining_work() {
        let idle = serde_json::json!({
            "activity": {"in_flight": 0}, "atomic_inference_reserved": 0,
            "atomic_summary": {"pending": false, "active": false, "rollback_pending": true,
                "recovery_required": true, "recovery_stop_ready": true,
                "foreground_requests": 0, "inference_draining": true}
        });
        assert!(strata_idle_from_status(&idle).is_ok());
        for field in ["pending", "active"] {
            let mut busy = idle.clone();
            busy["atomic_summary"][field] = true.into();
            assert_eq!(strata_idle_from_status(&busy).unwrap_err(), "engineBusy");
        }
        for field in ["recovery_stop_ready", "inference_draining"] {
            let mut missing = idle.clone();
            missing["atomic_summary"][field] = false.into();
            assert!(strata_idle_from_status(&missing).is_err());
        }
        for field in [
            "pending",
            "active",
            "rollback_pending",
            "foreground_requests",
        ] {
            let mut missing = idle.clone();
            missing["atomic_summary"][field] = serde_json::Value::Null;
            assert!(strata_idle_from_status(&missing).is_err());
        }
        let mut busy = idle.clone();
        busy["atomic_summary"]["foreground_requests"] = 1.into();
        assert!(strata_idle_from_status(&busy).is_err());
        let mut busy = idle.clone();
        busy["atomic_inference_reserved"] = 1.into();
        assert!(strata_idle_from_status(&busy).is_err());
        let mut busy = idle;
        busy["activity"]["in_flight"] = 1.into();
        assert!(strata_idle_from_status(&busy).is_err());
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn owned_summary_barrier_waits_for_restore_and_authenticates_only_controls() {
        use std::io::{BufRead, BufReader, Read};
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let mut statuses = 0;
            for _ in 0..5 {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request = String::new();
                reader.read_line(&mut request).unwrap();
                let mut headers = String::new();
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse::<usize>().unwrap();
                    }
                    headers.push_str(&line.to_lowercase());
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let response = if request.starts_with("GET /v1/status ") {
                    assert!(!headers.contains("x-atomic-owner-key"));
                    statuses += 1;
                    let pending = statuses < 3;
                    serde_json::json!({"activity":{"in_flight":if pending {1} else {0}},
                        "atomic_inference_reserved":if pending {1} else {0},
                        "atomic_summary":{"enabled":true,"pending":pending,"active":pending,
                            "rollback_pending":pending,"recovery_required":false,
                            "foreground_requests":0,"inference_draining":statuses > 1}})
                } else {
                    assert!(headers.contains("x-atomic-owner-key: test-private-key"));
                    if request.contains("summary-cancel") {
                        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
                        assert_eq!(body["suspend"], true);
                        assert_eq!(body["drain"], true);
                    } else {
                        assert!(request.contains("summary-resume"));
                    }
                    serde_json::json!({})
                }
                .to_string();
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
            }
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        drain_strata_summary(&client, port, std::process::id(), "test-private-key")
            .await
            .unwrap();
        resume_strata_summary(&client, port, std::process::id(), "test-private-key")
            .await
            .unwrap();
        server.join().unwrap();
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn detached_retained_stream_socket_is_busy_without_a_tcp_client() {
        let (_capture, _inference) = std::os::unix::net::UnixStream::pair().unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        assert_eq!(
            check_idle(&client, 0, Engine::Dstar, true, std::process::id())
                .await
                .unwrap_err(),
            "engineBusy"
        );
    }

    #[test]
    fn socket_diagnostics_accept_only_complete_unrelated_smb_mount_warnings() {
        let warning = b"lsof: WARNING: can't stat() smbfs file system /Volumes/[C] Windows 11\n      Output information may be incomplete.\n      assuming \"dev=36000005\" from mount table\n";
        assert!(socket_inspection_diagnostics_ok(b""));
        assert!(socket_inspection_diagnostics_ok(warning));
        let repeated = [warning.as_slice(), warning.as_slice()].concat();
        assert!(socket_inspection_diagnostics_ok(&repeated));
        for invalid in [
            b"lsof: permission denied\n".as_slice(),
            b"lsof: WARNING: can't stat() smbfs file system /Volumes/test\n",
            b"lsof: WARNING: can't stat() apfs file system /Volumes/test\n",
            b"\xff",
        ] {
            assert!(!socket_inspection_diagnostics_ok(invalid));
        }
        let with_error = [
            warning.as_slice(),
            b"lsof: can't inspect process: permission denied\n",
        ]
        .concat();
        assert!(!socket_inspection_diagnostics_ok(&with_error));
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn live_listener_must_belong_to_owned_process_tree() {
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(owns_listener(std::process::id(), port).await.unwrap());
        let mut unrelated = Command::new("/bin/sleep")
            .arg("30")
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        assert!(!owns_listener(unrelated.id().unwrap(), port).await.unwrap());
        unrelated.kill().await.unwrap();
        unrelated.wait().await.unwrap();
        assert!(listener.local_addr().is_ok());
    }

    #[test]
    fn generated_config_preserves_reviewed_profile_and_cannot_accept_hooks() {
        let env = Environment::personal(PathBuf::from("/home/test/dstar"));
        let config = env.strata_config(DEFAULT_STRATA_CONTEXT);
        assert_eq!(config["host"], "127.0.0.1");
        assert_eq!(config["port"], 18080);
        assert_eq!(config["model_name"], "ista-iq3-xxs");
        assert_eq!(config["effort_position"], "end");
        assert_eq!(
            config["exe"],
            env.strata_root
                .join("feature-integration/engine-image-summary-v34/strata")
                .to_string_lossy()
                .as_ref()
        );
        assert_eq!(
            config["cwd"],
            env.strata_root
                .join("feature-integration/runtime-image-summary-v34")
                .to_string_lossy()
                .as_ref()
        );
        assert_eq!(
            config["tokenizer"],
            env.strata_root
                .join("feature-integration/pack-iq3/tokenizer")
                .to_string_lossy()
                .as_ref()
        );
        assert_eq!(config["vision"]["model"], "/home/test/dstar/models/IQ3_XXS/Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00001-of-00002.gguf");
        assert!(config.get("before_load").is_none());
        assert_eq!(config["env"]["PATH"], "/usr/bin:/bin:/usr/sbin:/sbin");
        assert_eq!(config["env"]["PATH"], "/usr/bin:/bin:/usr/sbin:/sbin");
        assert_eq!(config["atomic_summary_mode"], "state-bank-v1");
        assert_eq!(config["atomic_summary_scheduler"], "weighted-quanta-v1");
        assert_eq!(config["atomic_summary_foreground_weight"], 8);
        assert_eq!(config["atomic_summary_state_bank_enabled"], true);
        assert_eq!(config["atomic_summary_state_bank_max_bytes"], 1300000000);
        assert_eq!(config["atomic_summary_clone_enabled"], true);
        assert_eq!(
            config["env"]["STRATA_ATOMIC_SUMMARY_HEADROOM_TOKENS"],
            "8192"
        );
        assert_eq!(
            config["atomic_summary_state_bank_provenance"],
            "experimental-user-validation"
        );
        assert_eq!(config["atomic_summary_transaction_qualified"], false);
        assert_eq!(config["atomic_completion_review_qualified"], false);
        assert!(config
            .get("atomic_summary_qualified_max_main_tokens")
            .is_none());
        assert!(config
            .get("atomic_summary_qualified_max_snapshot_bytes")
            .is_none());
        assert!(config
            .get("atomic_summary_qualified_max_protected_bytes")
            .is_none());
        assert!(config.get("atomic_summary_snapshot_path").is_none());
        assert_eq!(
            config["atomic_summary_expected_native_sha256"],
            "cc8a0002024dc5cc2ddba0c57938390354b654028b789f330d0bda2d27252052"
        );
        assert_eq!(
            config["atomic_summary_expected_model_fingerprint"],
            "strata-stat-v2:401f2352597b8d474e478ec358050f3036d38d040eaa1d73c5dddd8bd86a8612"
        );
        assert_eq!(
            config["atomic_summary_expected_backend_sha256"],
            "6613de82d4eaecb3a932e2f4621f0dbca646e9304593d47aa642d4932a8ac709"
        );
        assert!(!config.to_string().contains("OWNER_ATTEST"));
        let args = config["args"].as_array().unwrap();
        for pair in [
            ["--max-context", "65536"],
            ["--prompt-cache", "6"],
            ["--conversation-cache-mib", "1024"],
        ] {
            assert!(args
                .windows(2)
                .any(|window| window[0] == pair[0] && window[1] == pair[1]));
        }
    }
}

#[cfg(test)]
mod listener_retry_tests {
    use super::retry_listener_inspection;
    #[tokio::test]
    async fn rechecks_uncertainty_but_never_promotes_it_or_retries_a_foreign_listener() {
        for (results, expected, count) in [
            (vec![Err("timeout".into()), Ok(true)], Ok(true), 2),
            (vec![Err("timeout".into()), Ok(false)], Ok(false), 2),
            (vec![Ok(false)], Ok(false), 1),
            (vec![Ok(true)], Ok(true), 1),
            (
                vec![Err("timeout".into()), Err("still unavailable".into())],
                Err("still unavailable".into()),
                2,
            ),
        ] {
            let mut attempts = 0;
            let mut results = results.into_iter();
            let result = retry_listener_inspection(|| {
                attempts += 1;
                std::future::ready(results.next().unwrap())
            })
            .await;
            assert_eq!(result, expected);
            assert_eq!(attempts, count);
        }
    }
}
