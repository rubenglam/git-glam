use crate::history::git;
use std::{path::Path, time::Duration};

fn stage_git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let mut full = vec!["--literal-pathspecs", "-c", "core.quotepath=false"];
    full.extend_from_slice(args);
    git(dir, &full, Duration::from_secs(30), 32 * 1024 * 1024)
}
fn validate_paths(paths: &[String]) -> Result<(), String> {
    if paths.is_empty()
        || paths
            .iter()
            .any(|p| p.is_empty() || p.contains('\0') || p.starts_with('-'))
    {
        Err("Archivos no válidos".into())
    } else {
        Ok(())
    }
}
fn paths_action(dir: &Path, paths: &[String], staged: bool) -> Result<(), String> {
    validate_paths(paths)?;
    let mut args = if staged {
        vec!["add", "-A", "--"]
    } else {
        vec!["reset", "-q", "--"]
    };
    args.extend(paths.iter().map(String::as_str));
    stage_git(dir, &args).map(|_| ())
}
#[tauri::command]
pub async fn stage_paths(dir: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || paths_action(Path::new(&dir), &paths, true))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn unstage_paths(dir: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || paths_action(Path::new(&dir), &paths, false))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn staged_diff(dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        stage_git(
            Path::new(&dir),
            &[
                "diff",
                "--cached",
                "--no-color",
                "--no-ext-diff",
                "--no-textconv",
                "--src-prefix=a/",
                "--dst-prefix=b/",
            ],
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn last_message(dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(stage_git(Path::new(&dir), &["log", "-1", "--format=%B"])
            .unwrap_or_default()
            .trim_end()
            .to_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Command};
    fn run(dir: &Path, args: &[&str]) {
        assert!(
            Command::new("git")
                .args(args)
                .current_dir(dir)
                .output()
                .unwrap()
                .status
                .success()
        );
    }
    #[test]
    fn stages_and_unstages_literal_names_before_first_commit() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        run(dir, &["init", "-q"]);
        fs::write(dir.join("a[1].txt"), "hello").unwrap();
        fs::write(dir.join("a1.txt"), "other").unwrap();
        let names = vec!["a[1].txt".to_string()];
        paths_action(dir, &names, true).unwrap();
        let staged = stage_git(dir, &["diff", "--cached", "--name-only"]).unwrap();
        assert_eq!(staged.trim(), "a[1].txt");
        paths_action(dir, &names, false).unwrap();
        assert!(
            stage_git(dir, &["diff", "--cached", "--name-only"])
                .unwrap()
                .is_empty()
        );
        assert!(paths_action(dir, &["-bad".into()], true).is_err());
    }
}

#[derive(serde::Deserialize)]
pub struct DiffRequest {
    path: String,
    staged: Option<bool>,
}
fn raw_diff(dir: &Path, request: &DiffRequest) -> Result<String, String> {
    validate_paths(std::slice::from_ref(&request.path))?;
    let base = [
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--src-prefix=a/",
        "--dst-prefix=b/",
    ];
    let mut args = base.to_vec();
    if request.staged.unwrap_or(false) {
        args.extend(["--cached", "--", request.path.as_str()]);
        return stage_git(dir, &args);
    }
    if !stage_git(dir, &["ls-files", "--", &request.path])?
        .trim()
        .is_empty()
    {
        args.extend(["--", request.path.as_str()]);
        return stage_git(dir, &args);
    }
    args.extend(["--no-index", "--", "/dev/null", request.path.as_str()]);
    let mut full = vec!["--literal-pathspecs", "-c", "core.quotepath=false"];
    full.extend(args);
    crate::history::git_with_exit(dir, &full, Duration::from_secs(30), 32 * 1024 * 1024, true)
}
fn discard_inner(dir: &Path, paths: &[String]) -> Result<(), String> {
    validate_paths(paths)?;
    let mut args = vec!["ls-files", "-z", "--"];
    args.extend(paths.iter().map(String::as_str));
    let tracked = stage_git(dir, &args)?;
    let tracked: std::collections::HashSet<_> =
        tracked.split('\0').filter(|s| !s.is_empty()).collect();
    let restore: Vec<_> = paths
        .iter()
        .map(String::as_str)
        .filter(|p| tracked.contains(p))
        .collect();
    let clean: Vec<_> = paths
        .iter()
        .map(String::as_str)
        .filter(|p| !tracked.contains(p))
        .collect();
    if !restore.is_empty() {
        let mut args = vec!["restore", "--worktree", "--"];
        args.extend(restore);
        stage_git(dir, &args)?;
    }
    if !clean.is_empty() {
        let mut args = vec!["clean", "-f", "-q", "--"];
        args.extend(clean);
        stage_git(dir, &args)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn working_diff(dir: String, request: DiffRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || raw_diff(Path::new(&dir), &request))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn discard_paths(dir: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || discard_inner(Path::new(&dir), &paths))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod extra_tests {
    use super::*;
    use std::{fs, process::Command};
    fn g(d: &Path, a: &[&str]) {
        assert!(
            Command::new("git")
                .args(a)
                .current_dir(d)
                .output()
                .unwrap()
                .status
                .success()
        );
    }
    #[test]
    fn untracked_diff_and_discard_preserves_index() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        g(d, &["init", "-q"]);
        g(d, &["config", "user.name", "Test"]);
        g(d, &["config", "user.email", "test@example.com"]);
        fs::write(d.join("tracked"), "old\n").unwrap();
        g(d, &["add", "tracked"]);
        g(d, &["commit", "-qm", "first"]);
        fs::write(d.join("tracked"), "staged\n").unwrap();
        g(d, &["add", "tracked"]);
        fs::write(d.join("tracked"), "unstaged\n").unwrap();
        fs::write(d.join("new"), "new\n").unwrap();
        let diff = raw_diff(
            d,
            &DiffRequest {
                path: "new".into(),
                staged: Some(false),
            },
        )
        .unwrap();
        assert!(diff.contains("+new"));
        discard_inner(d, &["tracked".into(), "new".into()]).unwrap();
        assert_eq!(
            fs::read_to_string(d.join("tracked"))
                .unwrap()
                .replace("\r\n", "\n"),
            "staged\n"
        );
        assert!(!d.join("new").exists());
    }
}
use std::io::Write;
#[derive(serde::Deserialize)]
pub struct HunkRequest {
    path: String,
    index: usize,
    header: String,
    staged: Option<bool>,
}
fn range_of(header: &str) -> Option<&str> {
    let end = header.get(3..)?.find(" @@")? + 6;
    let range = header.get(..end)?;
    if !range.starts_with("@@ -") || !range.contains(" +") {
        None
    } else {
        Some(range)
    }
}
fn hunk_inner(dir: &Path, req: HunkRequest, discard: bool) -> Result<(), String> {
    validate_paths(std::slice::from_ref(&req.path))?;
    let staged = req.staged.unwrap_or(false) && !discard;
    if !staged
        && stage_git(dir, &["ls-files", "--", &req.path])?
            .trim()
            .is_empty()
    {
        return Err("Los archivos nuevos solo se pueden preparar o descartar enteros".into());
    }
    let mut args = vec![
        "--literal-pathspecs",
        "-c",
        "core.quotepath=false",
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--src-prefix=a/",
        "--dst-prefix=b/",
    ];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", req.path.as_str()]);
    let patch = crate::history::git_bytes_with_exit(
        dir,
        &args,
        Duration::from_secs(30),
        32 * 1024 * 1024,
        false,
    )?;
    let starts: Vec<usize> = patch
        .windows(3)
        .enumerate()
        .filter_map(|(i, v)| {
            if v == b"@@ " && (i == 0 || patch[i - 1] == b'\n') {
                Some(i)
            } else {
                None
            }
        })
        .collect();
    let Some(&start) = starts.get(req.index) else {
        return Err("El archivo ha cambiado. Actualiza los cambios e inténtalo de nuevo.".into());
    };
    let end = starts.get(req.index + 1).copied().unwrap_or(patch.len());
    let hunk = &patch[start..end];
    let line_end = hunk.iter().position(|b| *b == b'\n').unwrap_or(hunk.len());
    let hunk_header =
        std::str::from_utf8(&hunk[..line_end]).map_err(|_| "Cabecera de bloque no válida")?;
    if range_of(hunk_header).is_none() || range_of(hunk_header) != range_of(&req.header) {
        return Err("El archivo ha cambiado. Actualiza los cambios e inténtalo de nuevo.".into());
    }
    let header = &patch[..starts[0]];
    let mut tmp = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
    tmp.write_all(header)
        .and_then(|_| tmp.write_all(hunk))
        .map_err(|e| e.to_string())?;
    if !hunk.ends_with(b"\n") {
        tmp.write_all(b"\n").map_err(|e| e.to_string())?;
    }
    tmp.flush().map_err(|e| e.to_string())?;
    let file = tmp.path().to_str().ok_or("Ruta temporal no válida")?;
    let mut args = vec!["apply"];
    if !discard {
        args.push("--cached");
    }
    if discard || staged {
        args.push("--reverse");
    }
    args.extend(["--recount", "--whitespace=nowarn", file]);
    stage_git(dir, &args)?;
    Ok(())
}
#[tauri::command]
pub async fn apply_hunk(dir: String, request: HunkRequest) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || hunk_inner(Path::new(&dir), request, false))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn discard_hunk(dir: String, request: HunkRequest) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || hunk_inner(Path::new(&dir), request, true))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod hunk_tests {
    use super::*;
    use std::{fs, process::Command};
    fn g(d: &Path, a: &[&str]) {
        assert!(
            Command::new("git")
                .args(a)
                .current_dir(d)
                .output()
                .unwrap()
                .status
                .success()
        );
    }
    #[test]
    fn stages_hunk_and_rejects_stale_header() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        g(d, &["init", "-q"]);
        g(d, &["config", "user.name", "Test"]);
        g(d, &["config", "user.email", "test@example.com"]);
        fs::write(d.join("a"), "old\n").unwrap();
        g(d, &["add", "a"]);
        g(d, &["commit", "-qm", "first"]);
        fs::write(d.join("a"), "new\n").unwrap();
        let diff = raw_diff(
            d,
            &DiffRequest {
                path: "a".into(),
                staged: Some(false),
            },
        )
        .unwrap();
        let header = diff
            .lines()
            .find(|l| l.starts_with("@@ "))
            .unwrap()
            .to_owned();
        let req = || HunkRequest {
            path: "a".into(),
            index: 0,
            header: header.clone(),
            staged: Some(false),
        };
        hunk_inner(d, req(), false).unwrap();
        assert!(
            stage_git(d, &["diff", "--cached"])
                .unwrap()
                .contains("+new")
        );
        assert!(hunk_inner(d, req(), false).is_err());
    }
}
#[cfg(test)]
mod encoding_tests {
    use super::*;
    use std::{fs, process::Command};
    fn g(d: &Path, args: &[&str]) {
        assert!(
            Command::new("git")
                .args(args)
                .current_dir(d)
                .output()
                .unwrap()
                .status
                .success()
        );
    }
    #[test]
    fn preserves_non_utf8_hunk_bytes() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        g(d, &["init", "-q"]);
        g(d, &["config", "user.name", "Test"]);
        g(d, &["config", "user.email", "test@example.com"]);
        fs::write(d.join("file.txt"), b"original\n").unwrap();
        g(d, &["add", "file.txt"]);
        g(d, &["commit", "-qm", "first"]);
        fs::write(d.join("file.txt"), b"changed-\xff\n").unwrap();
        let diff = raw_diff(
            d,
            &DiffRequest {
                path: "file.txt".into(),
                staged: Some(false),
            },
        )
        .unwrap();
        let header = diff
            .lines()
            .find(|line| line.starts_with("@@ "))
            .unwrap()
            .to_owned();
        hunk_inner(
            d,
            HunkRequest {
                path: "file.txt".into(),
                index: 0,
                header,
                staged: Some(false),
            },
            false,
        )
        .unwrap();
        let staged = crate::history::git_bytes_with_exit(
            d,
            &["show", ":file.txt"],
            Duration::from_secs(30),
            1024,
            false,
        )
        .unwrap();
        assert_eq!(staged, b"changed-\xff\n");
    }
}
#[cfg(test)]
mod parity_tests {
    use super::*;
    use std::{fs, process::Command};
    fn git(dir: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).into_owned()
    }
    #[test]
    fn stages_unstages_and_discards_individual_hunks_without_touching_other_changes() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        git(dir, &["init", "-q"]);
        git(dir, &["config", "user.name", "Test"]);
        git(dir, &["config", "user.email", "test@example.com"]);
        let original = (0..30).map(|i| format!("line {i}\n")).collect::<String>();
        fs::write(dir.join("file.txt"), &original).unwrap();
        git(dir, &["add", "file.txt"]);
        git(dir, &["commit", "-qm", "first"]);
        let changed = original
            .replace("line 1\n", "changed one\n")
            .replace("line 28\n", "changed two\n");
        fs::write(dir.join("file.txt"), &changed).unwrap();
        let patch = raw_diff(
            dir,
            &DiffRequest {
                path: "file.txt".into(),
                staged: Some(false),
            },
        )
        .unwrap();
        let first = patch
            .lines()
            .find(|line| line.starts_with("@@ "))
            .unwrap()
            .to_owned();
        hunk_inner(
            dir,
            HunkRequest {
                path: "file.txt".into(),
                index: 0,
                header: first.clone(),
                staged: Some(false),
            },
            false,
        )
        .unwrap();
        let staged = stage_git(dir, &["diff", "--cached"]).unwrap();
        assert!(staged.contains("changed one"));
        assert!(!staged.contains("changed two"));
        let working = raw_diff(
            dir,
            &DiffRequest {
                path: "file.txt".into(),
                staged: Some(false),
            },
        )
        .unwrap();
        assert!(working.contains("changed two"));
        hunk_inner(
            dir,
            HunkRequest {
                path: "file.txt".into(),
                index: 0,
                header: first,
                staged: Some(true),
            },
            false,
        )
        .unwrap();
        assert!(
            stage_git(dir, &["diff", "--cached", "--name-only"])
                .unwrap()
                .is_empty()
        );
        let patch = raw_diff(
            dir,
            &DiffRequest {
                path: "file.txt".into(),
                staged: Some(false),
            },
        )
        .unwrap();
        let header = patch
            .lines()
            .find(|line| line.starts_with("@@ "))
            .unwrap()
            .to_owned();
        hunk_inner(
            dir,
            HunkRequest {
                path: "file.txt".into(),
                index: 0,
                header,
                staged: Some(false),
            },
            true,
        )
        .unwrap();
        let result = fs::read_to_string(dir.join("file.txt"))
            .unwrap()
            .replace("\r\n", "\n");
        assert!(result.contains("line 1\n"));
        assert!(result.contains("changed two\n"));
    }
}
