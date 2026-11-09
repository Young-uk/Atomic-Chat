//! Disk checkpoints are owned by conversation IDs, independently of clone receipts.
//! Tombstones are published before unlinking so a concurrent native writer cannot
//! resurrect a deleted conversation at shutdown. Shared prefix owners retain it.
use std::{fs, io, path::Path};

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn payload_name(name: &str) -> bool {
    let (stem, suffix) = name.rsplit_once('.').unwrap_or(("", ""));
    ((suffix == "kv" && stem.len() == 40) || (suffix == "session" && stem.len() == 32))
        && stem
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn unlink(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

pub fn forget_thread(root: &Path, id: &str) -> Result<u64, String> {
    if !valid_id(id) {
        return Err("Invalid conversation cache owner".into());
    }
    let mut removed = 0;
    let directories = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e.to_string()),
    };
    for entry in directories {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !(name == "kv-cache" || name.starts_with("kv-cache-"))
            || !entry.file_type().map_err(|e| e.to_string())?.is_dir()
        {
            continue;
        }
        let dir = entry.path();
        let markers = dir.join(".deleted-threads");
        if fs::symlink_metadata(&markers).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("Cache tombstone directory is a symlink".into());
        }
        fs::create_dir_all(&markers).map_err(|e| e.to_string())?;
        let marker = markers.join(id);
        if fs::symlink_metadata(&marker).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("Cache tombstone is a symlink".into());
        }
        fs::write(&marker, b"deleted\n").map_err(|e| e.to_string())?;
        for item in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let name = item.file_name().to_string_lossy().into_owned();
            let Some(payload) = name.strip_suffix(".threads") else {
                continue;
            };
            if !payload_name(payload) {
                continue;
            }
            let kind = match item.file_type() {
                Ok(kind) => kind,
                Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
                Err(e) => return Err(e.to_string()),
            };
            if !kind.is_file() {
                continue;
            }
            let size = match item.metadata() {
                Ok(meta) => meta.len(),
                Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
                Err(e) => return Err(e.to_string()),
            };
            if size > 131072 {
                return Err("Cache ownership metadata is too large".into());
            }
            let text = match fs::read_to_string(item.path()) {
                Ok(t) => t,
                Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
                Err(e) => return Err(e.to_string()),
            };
            let owners: Vec<_> = text.lines().collect();
            if !owners.contains(&id)
                || owners
                    .iter()
                    .any(|owner| !valid_id(owner) || !markers.join(owner).exists())
            {
                continue;
            }
            let target = dir.join(payload);
            if let Ok(meta) = fs::symlink_metadata(&target) {
                if !meta.file_type().is_file() {
                    return Err("Cache payload is not a regular file".into());
                }
                removed += meta.len();
            }
            unlink(&target).map_err(|e| e.to_string())?;
            unlink(&item.path()).map_err(|e| e.to_string())?;
            let manifest = dir.join("latest.json");
            if let Ok(bytes) = fs::symlink_metadata(&manifest).and_then(|meta| {
                if meta.file_type().is_file() {
                    fs::read(&manifest)
                } else {
                    Err(io::Error::other("Not a cache manifest"))
                }
            }) {
                if serde_json::from_slice::<serde_json::Value>(&bytes)
                    .ok()
                    .and_then(|r| r["file"].as_str().map(str::to_owned))
                    .as_deref()
                    == Some(payload)
                {
                    unlink(&manifest).map_err(|e| e.to_string())?;
                }
            }
        }
        let receipt = dir.join("atomic-summary-receipt.json");
        if let Ok(bytes) = fs::symlink_metadata(&receipt).and_then(|meta| {
            if meta.file_type().is_file() {
                fs::read(&receipt)
            } else {
                Err(io::Error::other("Not a cache receipt"))
            }
        }) {
            if serde_json::from_slice::<serde_json::Value>(&bytes)
                .ok()
                .and_then(|r| r["owner"].as_str().map(str::to_owned))
                .is_some_and(|owner| owner.split('/').next() == Some(id))
            {
                unlink(&receipt).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deletes_only_unshared_owned_checkpoints_and_blocks_future_writes() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("kv-cache-iq3");
        fs::create_dir(&dir).unwrap();
        let name = format!("{}.kv", "a".repeat(40));
        fs::write(dir.join(&name), b"cache").unwrap();
        fs::write(dir.join(format!("{name}.threads")), b"room-a\nroom-b\n").unwrap();
        let unrelated = dir.join(format!("{}.kv", "b".repeat(40)));
        fs::write(&unrelated, b"other").unwrap();
        assert_eq!(forget_thread(temp.path(), "room-a").unwrap(), 0);
        assert!(dir.join(&name).exists());
        assert!(dir.join(".deleted-threads/room-a").exists());
        assert_eq!(forget_thread(temp.path(), "room-b").unwrap(), 5);
        assert!(!dir.join(&name).exists());
        assert!(unrelated.exists());
        assert_eq!(forget_thread(temp.path(), "room-b").unwrap(), 0);
        assert!(forget_thread(temp.path(), "../escape").is_err());
    }
    #[test]
    fn deletes_strata_manifest_with_its_owned_payload() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("kv-cache-strata-iq3");
        fs::create_dir(&dir).unwrap();
        let name = format!("{}.session", "a".repeat(32));
        fs::write(dir.join(&name), b"state").unwrap();
        fs::write(dir.join(format!("{name}.threads")), b"room\n").unwrap();
        fs::write(
            dir.join("latest.json"),
            serde_json::json!({"file":name}).to_string(),
        )
        .unwrap();
        assert_eq!(forget_thread(temp.path(), "room").unwrap(), 5);
        assert!(!dir.join("latest.json").exists());
    }
}

#[cfg(all(test, unix))]
mod symlink_tests {
    use super::*;
    #[test]
    fn rejects_a_tombstone_symlink_without_touching_its_target() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("kv-cache-iq3/.deleted-threads");
        fs::create_dir_all(&dir).unwrap();
        let target = temp.path().join("unrelated");
        fs::write(&target, b"unchanged").unwrap();
        std::os::unix::fs::symlink(&target, dir.join("room")).unwrap();
        assert!(forget_thread(temp.path(), "room").is_err());
        assert_eq!(fs::read(target).unwrap(), b"unchanged");
    }
}
