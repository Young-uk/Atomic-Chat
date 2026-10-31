//! Verified context snapshots live beside the original thread, which is never
//! truncated. UUID names and create-new staging files keep writers independent.
use serde_json::Value;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

fn component(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 180
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.~".contains(&c))
        && value != "."
        && value != ".."
}
fn directory(root: &Path, thread: &str) -> Result<PathBuf, String> {
    if !component(thread) {
        return Err("Invalid archive thread ID".into());
    }
    let dir = super::utils::get_thread_dir(root, thread).join("context-archives");
    // Existing symlink components must never escape the data directory.
    let mut check = root.to_path_buf();
    for part in ["threads", thread, "context-archives"] {
        check.push(part);
        if fs::symlink_metadata(&check)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err("Archive path contains a symlink".into());
        }
    }
    Ok(dir)
}
fn persist(root: &Path, thread: &str, name: &str, data: &str) -> Result<(), String> {
    if !component(name) || !name.ends_with(".json") || data.len() > 16 * 1024 * 1024 {
        return Err("Invalid archive file".into());
    }
    let record: Value = serde_json::from_str(data).map_err(|e| e.to_string())?;
    if record["threadId"].as_str() != Some(thread)
        || record["version"].as_u64() != Some(1)
        || !record["source"].is_array()
    {
        return Err("Invalid archive record".into());
    }
    let dir = directory(root, thread)?;
    // Never recreate a thread deleted while background inference was running.
    if !dir.parent().map(|p| p.is_dir()).unwrap_or(false) {
        return Err("Archive thread no longer exists".into());
    }
    match fs::create_dir(&dir) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.to_string()),
    }
    let path = dir.join(name);
    if fs::symlink_metadata(&path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("Archive file is a symlink".into());
    }
    if path.exists() {
        let old: Value = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if old["source"] != record["source"] || old["id"] != record["id"] {
            return Err("Archive source is immutable".into());
        }
    }
    let staging = dir.join(format!("{}.{}.pending", name, uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staging)
        .map_err(|e| e.to_string())?;
    file.write_all(data.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    drop(file);
    if fs::read(&staging).map_err(|e| e.to_string())? != data.as_bytes() {
        return Err("Archive verification failed".into());
    }
    fs::rename(&staging, &path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    fs::File::open(&dir)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn context_archive<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    thread_id: String,
    name: Option<String>,
    data: Option<String>,
) -> Result<Vec<String>, String> {
    let root = crate::core::app::commands::get_jan_data_folder_path(app);
    tauri::async_runtime::spawn_blocking(move || {
        if let (Some(name), Some(data)) = (&name, &data) {
            persist(&root, &thread_id, name, data)?;
            return Ok(vec![]);
        }
        if name.is_some() || data.is_some() {
            return Err("Archive name and data must be supplied together".into());
        }
        let dir = directory(&root, &thread_id)?;
        if !dir.exists() {
            return Ok(vec![]);
        }
        let mut paths = fs::read_dir(dir)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        paths.sort_by_key(|e| e.file_name());
        let mut records = Vec::new();
        for entry in paths {
            if entry.file_type().map_err(|e| e.to_string())?.is_file()
                && entry.path().extension().and_then(|s| s.to_str()) == Some("json")
            {
                records.push(fs::read_to_string(entry.path()).map_err(|e| e.to_string())?);
            }
        }
        Ok(records)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn durable_archive_preserves_source_and_rejects_traversal() {
        let root = std::env::temp_dir().join(format!("atomic-archive-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("threads/test")).unwrap();
        let raw = r#"{"version":1,"id":"one","threadId":"test","source":[{"id":"a"}]}"#;
        persist(&root, "test", "2026-10-30-02-00-00~2026-10-30-03-00-00_one.json", raw).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("threads/test/context-archives/2026-10-30-02-00-00~2026-10-30-03-00-00_one.json"))
                .unwrap(),
            raw
        );
        assert!(persist(&root, "../escape", "one.json", raw).is_err());
        assert!(persist(&root, "test", "../one.json", raw).is_err());
        assert!(persist(
            &root,
            "test",
            "2026-10-30-02-00-00~2026-10-30-03-00-00_one.json",
            &raw.replace("\"a\"", "\"b\"")
        )
        .is_err());
        // Test artifacts remain available for inspection; production never deletes history.
    }
}
