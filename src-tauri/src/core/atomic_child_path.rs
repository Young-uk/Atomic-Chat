//! Remove only exact duplicate POSIX PATH entries for the Atomic-managed Strata child.
//! Do not normalize paths, remove empty entries, change the parent, or invent a PATH.
use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::os::unix::ffi::{OsStrExt, OsStringExt};

pub fn atomic_deduplicated_path(path: Option<&OsStr>) -> Option<OsString> {
    let path = path?;
    let mut seen = HashSet::new();
    let mut output = Vec::with_capacity(path.as_bytes().len());
    let mut first = true;
    for entry in path.as_bytes().split(|byte| *byte == b':') {
        if seen.insert(entry) {
            if !first {
                output.push(b':');
            }
            output.extend_from_slice(entry);
            first = false;
        }
    }
    Some(OsString::from_vec(output))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dedup(input: &str) -> OsString {
        atomic_deduplicated_path(Some(OsStr::new(input))).unwrap()
    }

    #[test]
    fn atomic_preserves_first_occurrence_order() {
        assert_eq!(dedup("/b:/a:/b:/c:/a"), OsStr::new("/b:/a:/c"));
    }

    #[test]
    fn atomic_preserves_unique_paths_byte_for_byte() {
        let path = "/opt/bin:/usr/bin:/bin:~/.dotnet/tools:./bin";
        assert_eq!(dedup(path), OsStr::new(path));
    }

    #[test]
    fn atomic_keeps_new_unique_directory_visible_to_fingerprint() {
        let qualified = dedup("/usr/bin:/bin");
        let changed = dedup("/new/bin:/usr/bin:/bin:/usr/bin");
        assert_eq!(changed, OsStr::new("/new/bin:/usr/bin:/bin"));
        assert_ne!(changed, qualified);
    }

    #[test]
    fn atomic_preserves_first_empty_current_directory_entry() {
        assert_eq!(dedup(":/a::/b:"), OsStr::new(":/a:/b"));
        assert_eq!(dedup("/a::/b:"), OsStr::new("/a::/b"));
        assert_eq!(dedup("/a:/b:"), OsStr::new("/a:/b:"));
        assert_eq!(dedup("::"), OsStr::new(""));
    }

    #[test]
    fn atomic_distinguishes_missing_and_empty_path() {
        assert_eq!(atomic_deduplicated_path(None), None);
        assert_eq!(dedup(""), OsStr::new(""));
    }

    #[test]
    fn atomic_does_not_canonicalize_or_case_fold() {
        assert_eq!(
            dedup("/A:/a:/a/../b:/b:~/bin:./bin"),
            OsStr::new("/A:/a:/a/../b:/b:~/bin:./bin")
        );
    }

    #[test]
    fn atomic_preserves_non_utf8_path_bytes() {
        let input = OsStr::from_bytes(b"/a:\xff/bin:/a:\xff/bin:/b");
        let result = atomic_deduplicated_path(Some(input)).unwrap();
        assert_eq!(result.as_bytes(), b"/a:\xff/bin:/b");
    }

    #[test]
    fn atomic_repairs_repeated_trailing_directory_idempotently() {
        let result = dedup("/usr/bin:/Users/example/.lmstudio/bin:/Users/example/.lmstudio/bin");
        assert_eq!(result, OsStr::new("/usr/bin:/Users/example/.lmstudio/bin"));
        assert_eq!(atomic_deduplicated_path(Some(&result)).unwrap(), result);
    }
}
