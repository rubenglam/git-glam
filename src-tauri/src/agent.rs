use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};
struct Run {
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
}
#[derive(Default)]
pub struct AgentRuns(Mutex<HashMap<String, Run>>);
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRequest {
    id: String,
    prompt: String,
    session_id: Option<String>,
    mode: Option<String>,
    model: Option<String>,
    effort: Option<String>,
}
fn valid_id(id: &str, min: usize) -> bool {
    (min..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn parse(line: &str) -> Option<Value> {
    let data: Value = serde_json::from_str(line).ok()?;
    match data["type"].as_str()? {
        "system" if data["subtype"] == "init" && data["session_id"].is_string() => {
            Some(json!({"type":"session","sessionId":data["session_id"]}))
        }
        "stream_event"
            if data["event"]["type"] == "content_block_delta"
                && data["event"]["delta"]["type"] == "text_delta" =>
        {
            Some(json!({"type":"delta","text":data["event"]["delta"]["text"]}))
        }
        "assistant" => {
            let tools:Vec<_>=data["message"]["content"].as_array().map(|v|v.iter().filter(|p|p["type"]=="tool_use").map(|p|{let input=&p["input"];json!({"name":p["name"],"detail":input["file_path"].as_str().or_else(||input["pattern"].as_str()).or_else(||input["command"].as_str()).or_else(||input["path"].as_str()).unwrap_or("")})}).collect()).unwrap_or_default();
            let usage = &data["message"]["usage"];
            let tokens = [
                "input_tokens",
                "cache_read_input_tokens",
                "cache_creation_input_tokens",
            ]
            .iter()
            .map(|k| usage[*k].as_u64().unwrap_or(0))
            .sum::<u64>();
            if tools.is_empty() && tokens == 0 {
                None
            } else {
                let mut v = json!({"type":"tools","tools":tools});
                if tokens > 0 {
                    v["tokens"] = json!(tokens)
                }
                Some(v)
            }
        }
        "result" => {
            let window = data["modelUsage"]
                .as_object()
                .and_then(|o| o.values().next())
                .and_then(|m| m["contextWindow"].as_u64());
            let mut v = json!({"type":"done","text":data["result"].as_str().unwrap_or(""),"error":data["is_error"]==true,"sessionId":data["session_id"]});
            if let Some(w) = window {
                v["contextWindow"] = json!(w)
            }
            Some(v)
        }
        _ => None,
    }
}
#[tauri::command]
pub fn agent_send(
    app: AppHandle,
    runs: State<'_, AgentRuns>,
    dir: String,
    request: AgentRequest,
) -> Result<String, String> {
    if dir.is_empty() || !Path::new(&dir).is_dir() {
        return Err("Repositorio no válido".into());
    }
    if !valid_id(&request.id, 6) {
        return Err("Identificador no válido".into());
    }
    if request.prompt.trim().is_empty() || request.prompt.chars().count() > 20000 {
        return Err("Escribe un prompt válido".into());
    }
    if request.session_id.as_ref().is_some_and(|s| !valid_id(s, 8)) {
        return Err("Sesión no válida".into());
    }
    let mut guard = runs.0.lock().map_err(|e| e.to_string())?;
    if guard.contains_key(&request.id) {
        return Err("Generación ya iniciada".into());
    }
    let mut args = vec![
        "-p".to_string(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
    ];
    if request.mode.as_deref() == Some("edit") {
        args.extend(["--permission-mode".into(), "acceptEdits".into()]);
    } else {
        args.extend([
            "--permission-mode".into(),
            "default".into(),
            "--allowed-tools".into(),
            "Read".into(),
            "Grep".into(),
            "Glob".into(),
        ]);
    }
    if let Some(model) = request.model.filter(|m| {
        [
            "claude-fable-5-1",
            "claude-opus-5-5",
            "claude-sonnet-5-5",
            "claude-haiku-5-5",
        ]
        .contains(&m.as_str())
    }) {
        args.extend(["--model".into(), model]);
    }
    if let Some(effort) = request
        .effort
        .filter(|m| ["low", "medium", "high", "xhigh", "max"].contains(&m.as_str()))
    {
        args.extend(["--effort".into(), effort]);
    }
    if let Some(session) = request.session_id {
        args.extend(["--resume".into(), session]);
    }
    let mut command = Command::new("claude");
    command
        .args(args)
        .current_dir(&dir)
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
        .map_err(|e| format!("No se pudo iniciar la CLI «claude»: {e}"))?;
    let mut input = child.stdin.take().ok_or("No se pudo iniciar el agente")?;
    let stdout = child.stdout.take().ok_or("No se pudo iniciar el agente")?;
    let mut stderr = child.stderr.take().ok_or("No se pudo iniciar el agente")?;
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    guard.insert(
        request.id.clone(),
        Run {
            child: child.clone(),
            cancelled: cancelled.clone(),
        },
    );
    drop(guard);
    let id = request.id.clone();
    let prompt = request.prompt;
    thread::spawn(move || {
        let _ = input.write_all(prompt.as_bytes());
    });
    let worker_app = app.clone();
    let worker_id = id.clone();
    thread::spawn(move || {
        let err = thread::spawn(move || {
            let mut bytes = Vec::new();
            let mut chunk = [0u8; 8192];
            while let Ok(n) = stderr.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                let remaining = (1024usize * 1024).saturating_sub(bytes.len());
                bytes.extend_from_slice(&chunk[..n.min(remaining)]);
            }
            String::from_utf8_lossy(&bytes).trim().to_owned()
        });
        let mut done = false;
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if let Some(event) = parse(&line) {
                        done |= event["type"] == "done";
                        let _ = worker_app.emit("agent:event", json!([worker_id, event]));
                    }
                }
                Err(_) => break,
            }
        }
        let status = loop {
            let result = child
                .lock()
                .ok()
                .and_then(|mut c| c.try_wait().ok())
                .flatten();
            if let Some(status) = result {
                break status;
            }
            thread::sleep(Duration::from_millis(50));
        };
        let error = err.join().unwrap_or_default();
        if !done {
            let event = if cancelled.load(Ordering::SeqCst) {
                json!({"type":"done","cancelled":true,"text":""})
            } else if status.success() {
                json!({"type":"done","text":""})
            } else {
                json!({"type":"done","error":true,"text":if error.is_empty(){format!("claude terminó con {status}")}else{error}})
            };
            let _ = worker_app.emit("agent:event", json!([worker_id, event]));
        }
        if let Ok(mut runs) = tauri::Manager::state::<AgentRuns>(&worker_app).0.lock() {
            runs.remove(&worker_id);
        }
    });
    Ok(id)
}
#[tauri::command]
pub fn agent_cancel(runs: State<'_, AgentRuns>, id: String) -> Result<(), String> {
    if let Some(run) = runs.0.lock().map_err(|e| e.to_string())?.get(&id) {
        run.cancelled.store(true, Ordering::SeqCst);
        run.child
            .lock()
            .map_err(|e| e.to_string())?
            .kill()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_stream_events_and_rejects_invalid_ids() {
        assert_eq!(parse(r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}}"#).unwrap()["text"],"hi");
        assert_eq!(
            parse(r#"{"type":"result","result":"ok","is_error":false}"#).unwrap()["type"],
            "done"
        );
        assert!(!valid_id("../../bad", 6));
    }
}
#[cfg(test)]
mod stream_tests {
    use super::*;
    #[test]
    fn translates_sessions_tools_usage_and_results() {
        let init = parse(r#"{"type":"system","subtype":"init","session_id":"session-1"}"#).unwrap();
        assert_eq!(init["sessionId"], "session-1");
        let tool=parse(r#"{"type":"assistant","message":{"usage":{"input_tokens":5,"cache_read_input_tokens":2},"content":[{"type":"tool_use","name":"Read","input":{"file_path":"src/a.rs"}}]}}"#).unwrap();
        assert_eq!(tool["tokens"], 7);
        assert_eq!(tool["tools"][0]["detail"], "src/a.rs");
        let done=parse(r#"{"type":"result","result":"done","is_error":false,"session_id":"session-1","modelUsage":{"model":{"contextWindow":200000}}}"#).unwrap();
        assert_eq!(done["text"], "done");
        assert_eq!(done["contextWindow"], 200000);
        assert!(parse("not json").is_none());
    }
}
