use crate::history::git;
use serde_json::{Value, json};
use std::{path::Path, time::Duration};
fn valid_hash(hash: &str) -> bool {
    (40..=64).contains(&hash.len()) && hash.bytes().all(|b| b.is_ascii_hexdigit())
}
fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    git(dir, args, Duration::from_secs(15), 16 * 1024 * 1024)
}
fn diff_inner(dir: &Path, hash: &str, files: bool) -> Result<Value, String> {
    if !valid_hash(hash) {
        return Err("Commit no válido".into());
    }
    let mut args = vec![
        "-c",
        "core.quotepath=false",
        "show",
        "--format=",
        "--no-ext-diff",
        "--no-textconv",
    ];
    if files {
        args.extend(["--no-renames", "--numstat", "-z"])
    } else {
        args.extend(["--src-prefix=a/", "--dst-prefix=b/", "--stat", "--patch"])
    }
    args.extend(["--first-parent", hash, "--"]);
    let mut output = run(dir, &args)?;
    let parents = run(dir, &["rev-list", "--parents", "-n", "1", hash]).unwrap_or_default();
    let fields: Vec<_> = parents.split_whitespace().collect();
    if fields.len() >= 4 {
        let mut extra = vec![
            "-c",
            "core.quotepath=false",
            "show",
            "--format=",
            "--no-ext-diff",
            "--no-textconv",
            "--src-prefix=a/",
            "--dst-prefix=b/",
        ];
        if files {
            extra.extend(["--no-renames", "--numstat", "-z"])
        } else {
            extra.extend(["--stat", "--patch"])
        }
        extra.extend([fields[3], "--"]);
        output.push_str(&run(dir, &extra)?);
    }
    if !files {
        return Ok(json!(output));
    }
    let entries:Vec<_>=output.split('\0').map(|s|s.strip_prefix('\n').unwrap_or(s)).filter(|s|!s.is_empty()).filter_map(|entry|{let mut f=entry.splitn(3,'\t');let a=f.next()?;let d=f.next()?;let path=f.next()?;let binary=a=="-"||d=="-";Some(json!({"path":path,"added":if binary{0}else{a.parse::<u64>().unwrap_or(0)},"deleted":if binary{0}else{d.parse::<u64>().unwrap_or(0)},"binary":binary}))}).collect();
    Ok(json!(entries))
}
#[tauri::command]
pub async fn commit_diff(dir: String, hash: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || diff_inner(Path::new(&dir), &hash, false))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn commit_files(dir: String, hash: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || diff_inner(Path::new(&dir), &hash, true))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Command};
    fn g(d: &Path, a: &[&str]) -> String {
        let o = Command::new("git").args(a).current_dir(d).output().unwrap();
        assert!(o.status.success());
        String::from_utf8_lossy(&o.stdout).trim().to_owned()
    }
    #[test]
    fn returns_diff_and_file_stats() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        g(d, &["init", "-q"]);
        g(d, &["config", "user.name", "Test"]);
        g(d, &["config", "user.email", "test@example.com"]);
        fs::write(d.join("a.txt"), "hello\n").unwrap();
        g(d, &["add", "a.txt"]);
        g(d, &["commit", "-qm", "first"]);
        let h = g(d, &["rev-parse", "HEAD"]);
        assert!(
            diff_inner(d, &h, false)
                .unwrap()
                .as_str()
                .unwrap()
                .contains("+hello")
        );
        let files = diff_inner(d, &h, true).unwrap();
        assert_eq!(files[0]["path"], "a.txt");
        assert_eq!(files[0]["added"], 1);
    }
}
#[cfg(test)]
mod stash_diff_tests {
    use super::*;
    use std::{fs, process::Command};
    fn g(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_owned()
    }
    #[test]
    fn stash_diff_includes_untracked_files() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        g(dir, &["init", "-q"]);
        g(dir, &["config", "user.name", "Test"]);
        g(dir, &["config", "user.email", "test@example.com"]);
        fs::write(dir.join("tracked.txt"), "original\n").unwrap();
        g(dir, &["add", "tracked.txt"]);
        g(dir, &["commit", "-qm", "first"]);
        fs::write(dir.join("tracked.txt"), "changed\n").unwrap();
        fs::write(dir.join("new.txt"), "untracked\n").unwrap();
        g(dir, &["stash", "push", "--include-untracked"]);
        let hash = g(dir, &["rev-parse", "refs/stash"]);
        let text = diff_inner(dir, &hash, false).unwrap();
        assert!(text.as_str().unwrap().contains("+untracked"));
        let files = diff_inner(dir, &hash, true).unwrap();
        let files = files.as_array().unwrap();
        assert!(files.iter().any(|v| v["path"] == "new.txt"));
        assert!(files.iter().any(|v| v["path"] == "tracked.txt"));
        assert!(diff_inner(dir, "--invalid", false).is_err());
    }
}
