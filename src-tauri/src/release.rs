//! Dev-only release helpers: inspect the pending changes and run `pnpm release` from the app.
//! Every command refuses to run in packaged builds.
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};
use tauri::Emitter;

static RUNNING: AtomicBool = AtomicBool::new(false);

fn root() -> Result<PathBuf, String> {
    if !cfg!(debug_assertions) {
        return Err("Publicar versiones solo está disponible en desarrollo".into());
    }
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "No se encontró la carpeta del proyecto".into())
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    crate::history::git(root, args, Duration::from_secs(20), 4 * 1024 * 1024)
}

fn valid_version(version: &str) -> bool {
    let parts: Vec<&str> = version.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.len() < 7 && p.bytes().all(|b| b.is_ascii_digit()))
}

#[tauri::command]
pub async fn release_info() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root()?;
        let tags = git(&root, &["tag", "--sort=-version:refname"])?;
        let last_tag = tags.lines().map(str::trim).find(|t| !t.is_empty());
        let range = last_tag.map_or("HEAD".to_string(), |t| format!("{t}..HEAD"));
        let commits: Vec<String> = git(&root, &["log", &range, "--no-merges", "--format=%s"])?
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(str::to_string)
            .collect();
        let dirty = !git(&root, &["status", "--porcelain"])?.trim().is_empty();
        let branch = git(&root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
        Ok(json!({
            "version": env!("CARGO_PKG_VERSION"),
            "lastTag": last_tag,
            "commits": commits,
            "dirty": dirty,
            "branch": branch.trim(),
            "running": RUNNING.load(Ordering::SeqCst),
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Starts `pnpm release <version> --publish` (plus `--skip-bump` to keep the version files as they are) and streams its output as `release:log` / `release:done`.
#[tauri::command]
pub fn release_run(app: tauri::AppHandle, version: String, skip_bump: Option<bool>) -> Result<(), String> {
    let root = root()?;
    if !valid_version(&version) {
        return Err("La versión debe tener el formato x.y.z".into());
    }
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err("Ya hay una publicación en curso".into());
    }
    let mut command = Command::new("cmd");
    command.args(["/C", "pnpm", "release", &version, "--publish"]);
    if skip_bump.unwrap_or(false) {
        command.arg("--skip-bump");
    }
    command
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            RUNNING.store(false, Ordering::SeqCst);
            return Err(format!("No se pudo iniciar pnpm: {e}"));
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    thread::spawn(move || {
        let pipe = |reader: Option<Box<dyn std::io::Read + Send>>, app: tauri::AppHandle| {
            thread::spawn(move || {
                if let Some(reader) = reader {
                    for line in BufReader::new(reader).lines().map_while(Result::ok) {
                        let _ = app.emit("release:log", json!([line]));
                    }
                }
            })
        };
        let out = pipe(stdout.map(|s| Box::new(s) as _), app.clone());
        let err = pipe(stderr.map(|s| Box::new(s) as _), app.clone());
        let status = child.wait();
        let _ = out.join();
        let _ = err.join();
        RUNNING.store(false, Ordering::SeqCst);
        let payload = match status {
            Ok(s) if s.success() => json!({ "ok": true }),
            Ok(s) => json!({ "ok": false, "error": format!("pnpm release terminó con {s}") }),
            Err(e) => json!({ "ok": false, "error": e.to_string() }),
        };
        let _ = app.emit("release:done", json!([payload]));
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::valid_version;

    #[test]
    fn accepts_only_plain_semver() {
        assert!(valid_version("0.3.2"));
        assert!(!valid_version("1.0"));
        assert!(!valid_version("1.0.0-beta"));
        assert!(!valid_version("1.0.0 & calc"));
        assert!(!valid_version("1..0"));
    }
}
