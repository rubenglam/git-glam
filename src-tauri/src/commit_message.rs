use crate::history::git;
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State};
struct Run {
    cancelled: AtomicBool,
    child: Mutex<Option<Child>>,
}
#[derive(Default)]
pub struct MessageRuns(Mutex<HashMap<String, Arc<Run>>>);
const SYSTEM: &str = "Eres un generador de mensajes de commit. Recibes un diff de git por la entrada estándar. Responde SOLO con el mensaje de commit en formato Conventional Commits (tipo(ámbito opcional): resumen en imperativo, máximo 72 caracteres), opcionalmente seguido de una línea en blanco y un cuerpo breve. Sin comillas, sin bloques de código, sin explicaciones. Escribe el mensaje en inglés.";
fn changes(dir: &Path) -> Result<String, String> {
    let run = |args: &[&str]| git(dir, args, Duration::from_secs(60), 16 * 1024 * 1024);
    let staged = !run(&["diff", "--cached", "--name-only", "-z"])?.is_empty();
    let mut args = vec!["-c", "core.quotepath=false", "diff"];
    args.push(if staged { "--cached" } else { "HEAD" });
    args.extend([
        "--no-ext-diff",
        "--no-textconv",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--stat",
        "--patch",
    ]);
    let diff = run(&args).unwrap_or_default();
    let untracked = if staged {
        String::new()
    } else {
        run(&["ls-files", "--others", "--exclude-standard"])?
            .lines()
            .map(|s| format!("Nuevo archivo: {s}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let text = [diff, untracked]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if text.trim().is_empty() {
        return Err("No hay cambios para describir".into());
    }
    let mut result: String = text.chars().take(12000).collect();
    if text.chars().count() > 12000 {
        result.push_str("\n[…recortado]");
    }
    Ok(result)
}
fn generate(dir: &str, model: &str, run: Arc<Run>, program: &Path) -> Result<String, String> {
    let input = changes(Path::new(dir))?;
    if run.cancelled.load(Ordering::SeqCst) {
        return Err("Generación cancelada".into());
    }
    let mut command = Command::new(program);
    command
        .args([
            "-p",
            "--model",
            model,
            "--tools",
            "",
            "--no-session-persistence",
            "--system-prompt",
            SYSTEM,
        ])
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("No se encontró la CLI «claude» o no se pudo iniciar: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("No se pudo iniciar Claude")?;
    let stdout = child.stdout.take().ok_or("No se pudo iniciar Claude")?;
    let stderr = child.stderr.take().ok_or("No se pudo iniciar Claude")?;
    {
        let mut guard = run.child.lock().map_err(|e| e.to_string())?;
        if run.cancelled.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Generación cancelada".into());
        }
        *guard = Some(child);
    }
    thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
    });
    let read = |mut source: Box<dyn Read + Send>| {
        thread::spawn(move || {
            let mut buffer = [0; 8192];
            let mut output = Vec::new();
            while let Ok(n) = source.read(&mut buffer) {
                if n == 0 {
                    break;
                }
                let remain = (1024usize * 1024).saturating_sub(output.len());
                output.extend_from_slice(&buffer[..n.min(remain)]);
            }
            String::from_utf8_lossy(&output).into_owned()
        })
    };
    let out = read(Box::new(stdout));
    let err = read(Box::new(stderr));
    let start = Instant::now();
    let status = loop {
        let mut guard = run.child.lock().map_err(|e| e.to_string())?;
        let child = guard.as_mut().ok_or("Proceso no disponible")?;
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if run.cancelled.load(Ordering::SeqCst) || start.elapsed() > Duration::from_secs(60) {
            let _ = child.kill();
            let _ = child.wait();
            drop(guard);
            let _ = out.join();
            let _ = err.join();
            return Err(if run.cancelled.load(Ordering::SeqCst) {
                "Generación cancelada"
            } else {
                "La generación ha tardado demasiado"
            }
            .into());
        }
        drop(guard);
        thread::sleep(Duration::from_millis(50));
    };
    let text = out.join().unwrap_or_default();
    let error = err.join().unwrap_or_default();
    if run.cancelled.load(Ordering::SeqCst) {
        return Err("Generación cancelada".into());
    }
    if !status.success() {
        return Err(if error.trim().is_empty() {
            format!("claude terminó con {status}")
        } else {
            error.trim().into()
        });
    }
    let text = text.trim();
    let text = if let Some(after) = text.strip_prefix("```") {
        after
            .split_once('\n')
            .map(|(_, v)| v)
            .unwrap_or(after)
            .trim_end_matches("```")
            .trim()
    } else {
        text
    };
    if text.is_empty() {
        Err("La IA no devolvió ningún mensaje".into())
    } else {
        Ok(text.into())
    }
}
#[tauri::command]
pub async fn generate_message(app: AppHandle, dir: String, id: String) -> Result<String, String> {
    if !(6..=64).contains(&id.len())
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("Identificador no válido".into());
    }
    let model = crate::settings::commit_model(&app)?;
    let run = Arc::new(Run {
        cancelled: AtomicBool::new(false),
        child: Mutex::new(None),
    });
    {
        let runs = app.state::<MessageRuns>();
        let mut m = runs.0.lock().map_err(|e| e.to_string())?;
        if m.contains_key(&id) {
            return Err("Generación ya iniciada".into());
        }
        m.insert(id.clone(), run.clone());
    }
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = generate(&dir, &model, run, Path::new("claude"));
        if let Ok(mut m) = app_clone.state::<MessageRuns>().0.lock() {
            m.remove(&id);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn cancel_message(runs: State<'_, MessageRuns>, id: String) -> Result<(), String> {
    if let Some(run) = runs.0.lock().map_err(|e| e.to_string())?.get(&id) {
        run.cancelled.store(true, Ordering::SeqCst);
        if let Some(child) = run.child.lock().map_err(|e| e.to_string())?.as_mut() {
            let _ = child.kill();
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn collects_untracked_changes_and_rejects_empty() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        assert!(
            Command::new("git")
                .args(["init", "-q"])
                .current_dir(d)
                .status()
                .unwrap()
                .success()
        );
        assert!(changes(d).is_err());
        fs::write(d.join("new.txt"), "hello").unwrap();
        assert!(changes(d).unwrap().contains("Nuevo archivo: new.txt"));
    }
}
#[cfg(test)]
mod process_tests {
    use super::*;
    use std::fs;
    #[test]
    fn executes_mock_generator_and_returns_message() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        fs::create_dir(&repo).unwrap();
        assert!(
            Command::new("git")
                .args(["init", "-q"])
                .current_dir(&repo)
                .status()
                .unwrap()
                .success()
        );
        fs::write(repo.join("new.txt"), "hello").unwrap();
        let source = temp.path().join("mock.rs");
        let binary = temp
            .path()
            .join(if cfg!(windows) { "mock.exe" } else { "mock" });
        fs::write(&source,r#"use std::io::Read; fn main() { let mut s=String::new(); std::io::stdin().read_to_string(&mut s).unwrap(); assert!(s.contains("Nuevo archivo: new.txt")); print!("```text\nfeat: add sample\n```"); }"#).unwrap();
        assert!(
            Command::new("rustc")
                .arg(&source)
                .arg("-o")
                .arg(&binary)
                .status()
                .unwrap()
                .success()
        );
        let run = Arc::new(Run {
            cancelled: AtomicBool::new(false),
            child: Mutex::new(None),
        });
        let message = generate(repo.to_str().unwrap(), "test-model", run, &binary).unwrap();
        assert_eq!(message, "feat: add sample");
    }
}
