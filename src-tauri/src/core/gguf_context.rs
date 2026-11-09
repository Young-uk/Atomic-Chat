//! Read model context metadata without mapping or loading any tensor weights.
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};
fn number(file: &mut File, bytes: usize) -> Option<u64> {
    let mut value = [0u8; 8];
    file.read_exact(&mut value[..bytes]).ok()?;
    Some(u64::from_le_bytes(value))
}
fn string(file: &mut File, limit: u64) -> Option<String> {
    let n = number(file, 8)?;
    if n > limit {
        return None;
    }
    let mut text = vec![0; n as usize];
    file.read_exact(&mut text).ok()?;
    String::from_utf8(text).ok()
}
fn skip(file: &mut File, kind: u64, depth: u8) -> Option<()> {
    if depth > 8 {
        return None;
    }
    let size = match kind {
        0 | 1 | 7 => 1,
        2 | 3 => 2,
        4 | 5 | 6 => 4,
        10 | 11 | 12 => 8,
        8 => number(file, 8)?,
        9 => {
            let subtype = number(file, 4)?;
            let n = number(file, 8)?;
            if n > 1_000_000 {
                return None;
            }
            for _ in 0..n {
                skip(file, subtype, depth + 1)?;
            }
            return Some(());
        }
        _ => return None,
    };
    if size > 128 * 1024 * 1024 {
        return None;
    }
    file.seek(SeekFrom::Current(size.try_into().ok()?)).ok()?;
    Some(())
}
pub(crate) fn read(path: &Path) -> Option<u32> {
    let mut file = File::open(path).ok()?;
    let mut magic = [0; 4];
    file.read_exact(&mut magic).ok()?;
    if magic != *b"GGUF" || ![2, 3].contains(&number(&mut file, 4)?) {
        return None;
    }
    number(&mut file, 8)?;
    let count = number(&mut file, 8)?;
    if count > 100_000 {
        return None;
    }
    let mut architecture = String::new();
    let mut contexts = Vec::new();
    for _ in 0..count {
        if file.stream_position().ok()? > 128 * 1024 * 1024 {
            return None;
        }
        let key = string(&mut file, 4096)?;
        let kind = number(&mut file, 4)?;
        if key == "general.architecture" && kind == 8 {
            architecture = string(&mut file, 128)?;
        } else if key.ends_with(".context_length") && [4, 5, 10, 11].contains(&kind) {
            let value = number(&mut file, if kind == 4 || kind == 5 { 4 } else { 8 })?;
            if (kind != 5 || value <= i32::MAX as u64)
                && (kind != 11 || value <= i64::MAX as u64)
                && value > 0
                && value <= u32::MAX as u64
            {
                contexts.push((key, value as u32));
            }
        } else {
            skip(&mut file, kind, 0)?;
        }
        if !architecture.is_empty() {
            if let Some((_, value)) = contexts
                .iter()
                .find(|(key, _)| key == &format!("{architecture}.context_length"))
            {
                return Some(*value);
            }
        }
    }
    None
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_architecture_limit_and_rejects_truncated_headers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.gguf");
        let mut b = b"GGUF".to_vec();
        b.extend(3u32.to_le_bytes());
        b.extend(0u64.to_le_bytes());
        b.extend(2u64.to_le_bytes());
        for (key, kind, data) in [
            ("general.architecture", 8u32, {
                let mut d = 8u64.to_le_bytes().to_vec();
                d.extend(b"qwen4exp");
                d
            }),
            (
                "qwen4exp.context_length",
                4u32,
                262144u32.to_le_bytes().to_vec(),
            ),
        ] {
            b.extend((key.len() as u64).to_le_bytes());
            b.extend(key.as_bytes());
            b.extend(kind.to_le_bytes());
            b.extend(data);
        }
        std::fs::write(&path, &b).unwrap();
        assert_eq!(read(&path), Some(262144));
        let mut negative = b.clone();
        let end = negative.len();
        negative[end - 8..end - 4].copy_from_slice(&5u32.to_le_bytes());
        negative[end - 4..].copy_from_slice(&(-1i32).to_le_bytes());
        std::fs::write(&path, &negative).unwrap();
        assert_eq!(read(&path), None);
        std::fs::write(&path, &b[..20]).unwrap();
        assert_eq!(read(&path), None);
    }
}
