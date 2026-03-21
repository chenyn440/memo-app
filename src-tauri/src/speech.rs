use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use tauri::{Emitter, State};

use crate::SpeechState;

pub struct SpeechProcess {
    child: Child,
}

impl SpeechProcess {
    pub fn stop(&mut self) {
        if let Some(ref mut stdin) = self.child.stdin {
            let _ = stdin.write_all(b"STOP\n");
            let _ = stdin.flush();
        }
        // 等待进程自行退出（Swift 端收到 STOP 后会 exit(0)）
        let _ = self.child.wait();
    }
}

impl Drop for SpeechProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

fn find_speech_helper() -> Result<PathBuf, String> {
    // Development: look in CARGO_MANIFEST_DIR
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("speech_helper");
    if dev_path.exists() {
        return Ok(dev_path);
    }

    // Production: look next to the executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            let path = dir.join("speech_helper");
            if path.exists() {
                return Ok(path);
            }
            // macOS .app bundle: Contents/MacOS/../Resources/
            let resources_path = dir.join("../Resources/speech_helper");
            if resources_path.exists() {
                return Ok(resources_path);
            }
        }
    }

    Err("speech_helper binary not found".to_string())
}

#[tauri::command]
pub fn start_speech(
    app_handle: tauri::AppHandle,
    state: State<SpeechState>,
) -> Result<(), String> {
    let mut process_guard = state.process.lock().map_err(|e| e.to_string())?;

    // If already running, stop first
    if let Some(mut existing) = process_guard.take() {
        existing.stop();
    }

    let binary_path = find_speech_helper()?;

    let mut child = Command::new(&binary_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start speech helper: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    // Background thread to read stdout and emit events
    let app_for_stdout = app_handle.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    if text == "DONE" {
                        let _ = app_for_stdout.emit("speech-stopped", ());
                        break;
                    } else if let Some(partial) = text.strip_prefix("PARTIAL:") {
                        let _ = app_for_stdout.emit("speech-partial", partial.to_string());
                    } else if let Some(final_text) = text.strip_prefix("FINAL:") {
                        let _ = app_for_stdout.emit("speech-final", final_text.to_string());
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Background thread to read stderr for debugging
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(text) => eprintln!("[speech_helper] {}", text),
                Err(_) => break,
            }
        }
    });

    *process_guard = Some(SpeechProcess { child });

    Ok(())
}

#[tauri::command]
pub fn stop_speech(state: State<SpeechState>) -> Result<(), String> {
    let mut process_guard = state.process.lock().map_err(|e| e.to_string())?;

    if let Some(mut process) = process_guard.take() {
        process.stop();
        Ok(())
    } else {
        Ok(())
    }
}
