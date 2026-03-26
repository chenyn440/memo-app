use crate::models::{
    Note, Folder, Tag, CreateNoteInput, UpdateNoteInput,
    Plan, PlanItem, CreatePlanInput, UpdatePlanInput, CreatePlanItemInput, UpdatePlanItemInput,
    MeetingRoom, MeetingParticipant, MeetingPeer, MeetingSignal
};
use crate::AppState;
use tauri::{State, Manager};
use std::fs;
use base64::Engine;
use serde_json::json;
use rusqlite::params;

fn validate_optional_url(value: Option<&str>, field_name: &str) -> Result<(), String> {
    if let Some(raw) = value {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Ok(());
        }
        if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
            return Err(format!("{field_name} 必须是有效的 http/https 链接"));
        }
    }
    Ok(())
}

fn map_meeting_room_row(row: &rusqlite::Row<'_>) -> Result<MeetingRoom, rusqlite::Error> {
    Ok(MeetingRoom {
        id: row.get(0)?,
        plan_item_id: row.get(1)?,
        room_code: row.get(2)?,
        room_name: row.get(3)?,
        state: row.get(4)?,
        started_at: row.get(5)?,
        ended_at: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn map_meeting_participant_row(row: &rusqlite::Row<'_>) -> Result<MeetingParticipant, rusqlite::Error> {
    let is_online: i64 = row.get(3)?;
    Ok(MeetingParticipant {
        id: row.get(0)?,
        room_id: row.get(1)?,
        user_name: row.get(2)?,
        is_online: is_online == 1,
        joined_at: row.get(4)?,
        left_at: row.get(5)?,
    })
}

fn map_meeting_peer_row(row: &rusqlite::Row<'_>) -> Result<MeetingPeer, rusqlite::Error> {
    let mic_on: i64 = row.get(4)?;
    let camera_on: i64 = row.get(5)?;
    Ok(MeetingPeer {
        id: row.get(0)?,
        room_id: row.get(1)?,
        peer_id: row.get(2)?,
        user_name: row.get(3)?,
        mic_on: mic_on == 1,
        camera_on: camera_on == 1,
        joined_at: row.get(6)?,
        last_seen_at: row.get(7)?,
    })
}

fn map_meeting_signal_row(row: &rusqlite::Row<'_>) -> Result<MeetingSignal, rusqlite::Error> {
    Ok(MeetingSignal {
        id: row.get(0)?,
        room_id: row.get(1)?,
        from_peer_id: row.get(2)?,
        to_peer_id: row.get(3)?,
        signal_type: row.get(4)?,
        payload: row.get(5)?,
        created_at: row.get(6)?,
    })
}

#[tauri::command]
pub fn get_notes(state: State<AppState>) -> Result<Vec<Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, content, folder_id, summary_history, translations, created_at, updated_at FROM notes ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                folder_id: row.get(3)?,
                summary_history: row.get(4)?,
                translations: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(notes)
}

#[tauri::command]
pub fn create_note(input: CreateNoteInput, state: State<AppState>) -> Result<Note, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO notes (title, content, folder_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        (&input.title, &input.content, &input.folder_id, &now, &now),
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    Ok(Note {
        id,
        title: input.title,
        content: input.content,
        folder_id: input.folder_id,
        summary_history: Some("[]".to_string()),
        translations: None,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_note(input: UpdateNoteInput, state: State<AppState>) -> Result<Note, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE notes SET title = ?1, content = ?2, folder_id = ?3, summary_history = ?4, translations = ?5, updated_at = ?6 WHERE id = ?7",
        (&input.title, &input.content, &input.folder_id, &input.summary_history, &input.translations, &now, &input.id),
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, title, content, folder_id, summary_history, translations, created_at, updated_at FROM notes WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let note = stmt
        .query_row([input.id], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                folder_id: row.get(3)?,
                summary_history: row.get(4)?,
                translations: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(note)
}

#[tauri::command]
pub fn delete_note(id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM notes WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn search_notes(query: String, state: State<AppState>) -> Result<Vec<Note>, String> {
    if query.trim().is_empty() {
        return get_notes(state);
    }

    let conn = state.db.lock().map_err(|e| e.to_string())?;

    // Build FTS5 query: quote each word and add * for prefix matching
    let fts_query = query
        .trim()
        .split_whitespace()
        .map(|word| format!("\"{}\"*", word.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ");

    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.title, n.content, n.folder_id, n.summary_history, n.translations, n.created_at, n.updated_at
             FROM notes_fts f
             JOIN notes n ON n.id = f.rowid
             WHERE notes_fts MATCH ?1
             ORDER BY f.rank"
        )
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map([&fts_query], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                folder_id: row.get(3)?,
                summary_history: row.get(4)?,
                translations: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(notes)
}

#[tauri::command]
pub fn get_folders(state: State<AppState>) -> Result<Vec<Folder>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, color, sort_order FROM folders ORDER BY sort_order ASC, id ASC")
        .map_err(|e| e.to_string())?;

    let folders = stmt
        .query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                sort_order: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(folders)
}

#[tauri::command]
pub fn get_notes_by_folder(folder_id: i64, state: State<AppState>) -> Result<Vec<Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, content, folder_id, summary_history, translations, created_at, updated_at FROM notes WHERE folder_id = ?1 ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map([folder_id], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                folder_id: row.get(3)?,
                summary_history: row.get(4)?,
                translations: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(notes)
}

#[tauri::command]
pub fn create_folder(name: String, color: String, state: State<AppState>) -> Result<Folder, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let next_sort_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM folders",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO folders (name, color, sort_order) VALUES (?1, ?2, ?3)",
        (&name, &color, &next_sort_order),
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    Ok(Folder {
        id,
        name,
        color,
        sort_order: next_sort_order,
    })
}

#[tauri::command]
pub fn delete_folder(id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let note_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM notes WHERE folder_id = ?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if note_count > 0 {
        return Err("文件夹非空，无法删除".to_string());
    }

    conn.execute("DELETE FROM folders WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn rename_folder(id: i64, name: String, state: State<AppState>) -> Result<Folder, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("文件夹名称不能为空".to_string());
    }

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let affected = conn
        .execute("UPDATE folders SET name = ?1 WHERE id = ?2", (trimmed, id))
        .map_err(|e| e.to_string())?;

    if affected == 0 {
        return Err("文件夹不存在".to_string());
    }

    let mut stmt = conn
        .prepare("SELECT id, name, color, sort_order FROM folders WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let folder = stmt
        .query_row([id], |row| {
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                sort_order: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(folder)
}

#[tauri::command]
pub fn reorder_folders(folder_ids: Vec<i64>, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("BEGIN IMMEDIATE TRANSACTION", [])
        .map_err(|e| e.to_string())?;

    for (idx, folder_id) in folder_ids.iter().enumerate() {
        let affected = conn
            .execute(
                "UPDATE folders SET sort_order = ?1 WHERE id = ?2",
                ((idx as i64) + 1, folder_id),
            )
            .map_err(|e| {
                let _ = conn.execute("ROLLBACK", []);
                e.to_string()
            })?;

        if affected == 0 {
            let _ = conn.execute("ROLLBACK", []);
            return Err(format!("Folder not found: {}", folder_id));
        }
    }

    conn.execute("COMMIT", []).map_err(|e| {
        let _ = conn.execute("ROLLBACK", []);
        e.to_string()
    })?;

    Ok(())
}

#[tauri::command]
pub fn get_tags(state: State<AppState>) -> Result<Vec<Tag>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name FROM tags")
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tags)
}

#[tauri::command]
pub fn create_tag(name: String, state: State<AppState>) -> Result<Tag, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    conn.execute("INSERT INTO tags (name) VALUES (?1)", [&name])
        .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    Ok(Tag { id, name })
}

#[tauri::command]
pub fn delete_tag(id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tags WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_note_tags(note_id: i64, state: State<AppState>) -> Result<Vec<Tag>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT t.id, t.name FROM tags t INNER JOIN note_tags nt ON t.id = nt.tag_id WHERE nt.note_id = ?1")
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([note_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tags)
}

#[tauri::command]
pub fn add_tag_to_note(note_id: i64, tag_id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?1, ?2)",
        (note_id, tag_id),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_tag_from_note(note_id: i64, tag_id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM note_tags WHERE note_id = ?1 AND tag_id = ?2",
        (note_id, tag_id),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_notes_by_tag(tag_id: i64, state: State<AppState>) -> Result<Vec<Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT n.id, n.title, n.content, n.folder_id, n.summary_history, n.translations, n.created_at, n.updated_at FROM notes n INNER JOIN note_tags nt ON n.id = nt.note_id WHERE nt.tag_id = ?1 ORDER BY n.updated_at DESC")
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map([tag_id], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                folder_id: row.get(3)?,
                summary_history: row.get(4)?,
                translations: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(notes)
}

fn strip_markdown_links(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut i = 0usize;

    while i < chars.len() {
        if chars[i] == '[' {
            let mut close_bracket = None;
            let mut close_paren = None;
            let mut j = i + 1;
            while j < chars.len() {
                if chars[j] == ']' && j + 1 < chars.len() && chars[j + 1] == '(' {
                    close_bracket = Some(j);
                    let mut k = j + 2;
                    while k < chars.len() {
                        if chars[k] == ')' {
                            close_paren = Some(k);
                            break;
                        }
                        k += 1;
                    }
                    break;
                }
                j += 1;
            }

            if let (Some(end_text), Some(end_link)) = (close_bracket, close_paren) {
                for ch in &chars[(i + 1)..end_text] {
                    out.push(*ch);
                }
                i = end_link + 1;
                continue;
            }
        }

        if chars[i] == '!' && i + 1 < chars.len() && chars[i + 1] == '[' {
            i += 1;
            continue;
        }

        out.push(chars[i]);
        i += 1;
    }

    out
}

fn markdown_to_plain_text(markdown: &str) -> String {
    markdown
        .lines()
        .map(|line| {
            let trimmed = line.trim_start();
            let mut normalized = if trimmed.starts_with('#') {
                trimmed.trim_start_matches('#').trim_start().to_string()
            } else if trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ") {
                trimmed[2..].to_string()
            } else {
                let mut idx = 0usize;
                let bytes = trimmed.as_bytes();
                while idx < bytes.len() && bytes[idx].is_ascii_digit() {
                    idx += 1;
                }
                if idx > 0 && idx + 1 < bytes.len() && bytes[idx] == b'.' && bytes[idx + 1] == b' ' {
                    trimmed[(idx + 2)..].to_string()
                } else {
                    trimmed.to_string()
                }
            };

            normalized = strip_markdown_links(&normalized);
            normalized
                .replace("**", "")
                .replace("__", "")
                .replace("~~", "")
                .replace('`', "")
                .replace('>', "")
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

#[tauri::command]
pub fn export_note(note_id: i64, format: String, output_path: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, content, folder_id, summary_history, translations, created_at, updated_at FROM notes WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let note = stmt
        .query_row([note_id], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                folder_id: row.get(3)?,
                summary_history: row.get(4)?,
                translations: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let normalized_format = format.trim().to_lowercase();
    let payload = match normalized_format.as_str() {
        "md" => note.content.clone(),
        "txt" => markdown_to_plain_text(&note.content),
        "json" => serde_json::to_string_pretty(&json!({
            "id": note.id,
            "title": note.title,
            "content": note.content,
            "folder_id": note.folder_id,
            "summary_history": note.summary_history,
            "created_at": note.created_at,
            "updated_at": note.updated_at
        }))
        .map_err(|e| e.to_string())?,
        _ => return Err("不支持的导出格式".to_string()),
    };

    fs::write(&output_path, payload).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_image(base64_data: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    // Get app data directory
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let images_dir = app_dir.join("images");

    // Create images directory if it doesn't exist
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    // Generate unique filename
    let timestamp = chrono::Utc::now().timestamp_millis();
    let filename = format!("image_{}.png", timestamp);
    let file_path = images_dir.join(&filename);

    // Decode base64 and save file
    let image_data = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| e.to_string())?;
    fs::write(&file_path, image_data).map_err(|e| e.to_string())?;

    // Return relative path for markdown
    Ok(format!("images/{}", filename))
}

#[tauri::command]
pub fn load_image(path: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let file_path = app_dir.join(&path);

    // Prevent path traversal: ensure resolved path is within app_data_dir
    let canonical_app_dir = app_dir.canonicalize().map_err(|e| e.to_string())?;
    let canonical_file = file_path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_file.starts_with(&canonical_app_dir) {
        return Err("Access denied".to_string());
    }

    let image_data = fs::read(&canonical_file).map_err(|e| e.to_string())?;
    let base64_str = base64::engine::general_purpose::STANDARD.encode(&image_data);
    Ok(format!("data:image/png;base64,{}", base64_str))
}

#[tauri::command]
pub fn get_plans(state: State<AppState>) -> Result<Vec<Plan>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, plan_type, created_at, updated_at FROM plans ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;

    let data = stmt
        .query_map([], |row| {
            Ok(Plan {
                id: row.get(0)?,
                name: row.get(1)?,
                plan_type: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(data)
}

#[tauri::command]
pub fn create_plan(input: CreatePlanInput, state: State<AppState>) -> Result<Plan, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO plans (name, plan_type, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        (&input.name, &input.plan_type, &now, &now),
    )
    .map_err(|e| e.to_string())?;

    Ok(Plan {
        id: conn.last_insert_rowid(),
        name: input.name,
        plan_type: input.plan_type,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_plan(input: UpdatePlanInput, state: State<AppState>) -> Result<Plan, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let affected = conn
        .execute(
            "UPDATE plans SET name = ?1, plan_type = ?2, updated_at = ?3 WHERE id = ?4",
            (&input.name, &input.plan_type, &now, &input.id),
        )
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("计划不存在".to_string());
    }

    Ok(Plan {
        id: input.id,
        name: input.name,
        plan_type: input.plan_type,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn delete_plan(id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM plans WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_plan_items(plan_id: i64, state: State<AppState>) -> Result<Vec<PlanItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, plan_id, title, item_type, status, priority, owner, start_at, due_at, notes, linked_note_id, meeting_platform, meeting_url, meeting_id, meeting_password, meeting_attendees, meeting_recording_url, created_at, updated_at FROM plan_items WHERE plan_id = ?1 ORDER BY CASE status WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'done' THEN 2 ELSE 3 END, COALESCE(due_at, '9999-12-31T23:59:59Z') ASC, updated_at DESC")
        .map_err(|e| e.to_string())?;

    let data = stmt
        .query_map([plan_id], |row| {
            Ok(PlanItem {
                id: row.get(0)?,
                plan_id: row.get(1)?,
                title: row.get(2)?,
                item_type: row.get(3)?,
                status: row.get(4)?,
                priority: row.get(5)?,
                owner: row.get(6)?,
                start_at: row.get(7)?,
                due_at: row.get(8)?,
                notes: row.get(9)?,
                linked_note_id: row.get(10)?,
                meeting_platform: row.get(11)?,
                meeting_url: row.get(12)?,
                meeting_id: row.get(13)?,
                meeting_password: row.get(14)?,
                meeting_attendees: row.get(15)?,
                meeting_recording_url: row.get(16)?,
                created_at: row.get(17)?,
                updated_at: row.get(18)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(data)
}

#[tauri::command]
pub fn get_plan_items_by_date_range(start: String, end: String, state: State<AppState>) -> Result<Vec<PlanItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, plan_id, title, item_type, status, priority, owner, start_at, due_at, notes, linked_note_id, meeting_platform, meeting_url, meeting_id, meeting_password, meeting_attendees, meeting_recording_url, created_at, updated_at FROM plan_items WHERE ((start_at IS NOT NULL AND start_at BETWEEN ?1 AND ?2) OR (due_at IS NOT NULL AND due_at BETWEEN ?1 AND ?2)) ORDER BY COALESCE(start_at, due_at) ASC")
        .map_err(|e| e.to_string())?;

    let data = stmt
        .query_map([&start, &end], |row| {
            Ok(PlanItem {
                id: row.get(0)?,
                plan_id: row.get(1)?,
                title: row.get(2)?,
                item_type: row.get(3)?,
                status: row.get(4)?,
                priority: row.get(5)?,
                owner: row.get(6)?,
                start_at: row.get(7)?,
                due_at: row.get(8)?,
                notes: row.get(9)?,
                linked_note_id: row.get(10)?,
                meeting_platform: row.get(11)?,
                meeting_url: row.get(12)?,
                meeting_id: row.get(13)?,
                meeting_password: row.get(14)?,
                meeting_attendees: row.get(15)?,
                meeting_recording_url: row.get(16)?,
                created_at: row.get(17)?,
                updated_at: row.get(18)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(data)
}

#[tauri::command]
pub fn create_plan_item(input: CreatePlanItemInput, state: State<AppState>) -> Result<PlanItem, String> {
    validate_optional_url(input.meeting_url.as_deref(), "会议链接")?;
    validate_optional_url(input.meeting_recording_url.as_deref(), "录制链接")?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO plan_items (plan_id, title, item_type, status, priority, owner, start_at, due_at, notes, linked_note_id, meeting_platform, meeting_url, meeting_id, meeting_password, meeting_attendees, meeting_recording_url, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        params![
            &input.plan_id,
            &input.title,
            &input.item_type,
            &input.status,
            &input.priority,
            &input.owner,
            &input.start_at,
            &input.due_at,
            &input.notes,
            &input.linked_note_id,
            &input.meeting_platform,
            &input.meeting_url,
            &input.meeting_id,
            &input.meeting_password,
            &input.meeting_attendees,
            &input.meeting_recording_url,
            &now,
            &now
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(PlanItem {
        id: conn.last_insert_rowid(),
        plan_id: input.plan_id,
        title: input.title,
        item_type: input.item_type,
        status: input.status,
        priority: input.priority,
        owner: input.owner,
        start_at: input.start_at,
        due_at: input.due_at,
        notes: input.notes,
        linked_note_id: input.linked_note_id,
        meeting_platform: input.meeting_platform,
        meeting_url: input.meeting_url,
        meeting_id: input.meeting_id,
        meeting_password: input.meeting_password,
        meeting_attendees: input.meeting_attendees,
        meeting_recording_url: input.meeting_recording_url,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_plan_item(input: UpdatePlanItemInput, state: State<AppState>) -> Result<PlanItem, String> {
    validate_optional_url(input.meeting_url.as_deref(), "会议链接")?;
    validate_optional_url(input.meeting_recording_url.as_deref(), "录制链接")?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let affected = conn.execute(
        "UPDATE plan_items SET title = ?1, item_type = ?2, status = ?3, priority = ?4, owner = ?5, start_at = ?6, due_at = ?7, notes = ?8, linked_note_id = ?9, meeting_platform = ?10, meeting_url = ?11, meeting_id = ?12, meeting_password = ?13, meeting_attendees = ?14, meeting_recording_url = ?15, updated_at = ?16 WHERE id = ?17",
        params![
            &input.title,
            &input.item_type,
            &input.status,
            &input.priority,
            &input.owner,
            &input.start_at,
            &input.due_at,
            &input.notes,
            &input.linked_note_id,
            &input.meeting_platform,
            &input.meeting_url,
            &input.meeting_id,
            &input.meeting_password,
            &input.meeting_attendees,
            &input.meeting_recording_url,
            &now,
            &input.id
        ],
    )
    .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("计划项不存在".to_string());
    }

    let mut stmt = conn
        .prepare("SELECT id, plan_id, title, item_type, status, priority, owner, start_at, due_at, notes, linked_note_id, meeting_platform, meeting_url, meeting_id, meeting_password, meeting_attendees, meeting_recording_url, created_at, updated_at FROM plan_items WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let row = stmt
        .query_row([input.id], |r| {
            Ok(PlanItem {
                id: r.get(0)?,
                plan_id: r.get(1)?,
                title: r.get(2)?,
                item_type: r.get(3)?,
                status: r.get(4)?,
                priority: r.get(5)?,
                owner: r.get(6)?,
                start_at: r.get(7)?,
                due_at: r.get(8)?,
                notes: r.get(9)?,
                linked_note_id: r.get(10)?,
                meeting_platform: r.get(11)?,
                meeting_url: r.get(12)?,
                meeting_id: r.get(13)?,
                meeting_password: r.get(14)?,
                meeting_attendees: r.get(15)?,
                meeting_recording_url: r.get(16)?,
                created_at: r.get(17)?,
                updated_at: r.get(18)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(row)
}

#[tauri::command]
pub fn delete_plan_item(id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM plan_items WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_or_create_meeting_room(plan_item_id: i64, room_name: String, state: State<AppState>) -> Result<MeetingRoom, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, plan_item_id, room_code, room_name, state, started_at, ended_at, created_at, updated_at FROM meeting_rooms WHERE plan_item_id = ?1")
        .map_err(|e| e.to_string())?;

    if let Ok(room) = stmt.query_row([plan_item_id], map_meeting_room_row) {
        return Ok(room);
    }

    let now = chrono::Utc::now().to_rfc3339();
    let room_code = format!("room-{}-{}", plan_item_id, chrono::Utc::now().timestamp());
    conn.execute(
        "INSERT INTO meeting_rooms (plan_item_id, room_code, room_name, state, created_at, updated_at) VALUES (?1, ?2, ?3, 'idle', ?4, ?5)",
        (&plan_item_id, &room_code, &room_name, &now, &now),
    )
    .map_err(|e| e.to_string())?;

    Ok(MeetingRoom {
        id: conn.last_insert_rowid(),
        plan_item_id,
        room_code,
        room_name,
        state: "idle".to_string(),
        started_at: None,
        ended_at: None,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn get_meeting_room(room_id: i64, state: State<AppState>) -> Result<MeetingRoom, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, plan_item_id, room_code, room_name, state, started_at, ended_at, created_at, updated_at FROM meeting_rooms WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    stmt.query_row([room_id], map_meeting_room_row)
        .map_err(|_| "会议房间不存在".to_string())
}

#[tauri::command]
pub fn get_meeting_room_by_code(room_code: String, state: State<AppState>) -> Result<MeetingRoom, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, plan_item_id, room_code, room_name, state, started_at, ended_at, created_at, updated_at FROM meeting_rooms WHERE room_code = ?1")
        .map_err(|e| e.to_string())?;

    stmt.query_row([room_code], map_meeting_room_row)
        .map_err(|_| "会议房间不存在".to_string())
}

#[tauri::command]
pub fn start_meeting_room(room_id: i64, state: State<AppState>) -> Result<MeetingRoom, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let affected = conn
        .execute(
            "UPDATE meeting_rooms SET state = 'in_progress', started_at = COALESCE(started_at, ?1), ended_at = NULL, updated_at = ?2 WHERE id = ?3",
            (&now, &now, &room_id),
        )
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("会议房间不存在".to_string());
    }
    let mut stmt = conn
        .prepare("SELECT id, plan_item_id, room_code, room_name, state, started_at, ended_at, created_at, updated_at FROM meeting_rooms WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    stmt.query_row([room_id], map_meeting_room_row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn end_meeting_room(room_id: i64, state: State<AppState>) -> Result<MeetingRoom, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let affected = conn
        .execute(
            "UPDATE meeting_rooms SET state = 'ended', ended_at = ?1, updated_at = ?2 WHERE id = ?3",
            (&now, &now, &room_id),
        )
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("会议房间不存在".to_string());
    }
    let mut stmt = conn
        .prepare("SELECT id, plan_item_id, room_code, room_name, state, started_at, ended_at, created_at, updated_at FROM meeting_rooms WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    stmt.query_row([room_id], map_meeting_room_row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn issue_meeting_token(room_id: i64, user_name: String, state: State<AppState>) -> Result<String, String> {
    let _room = get_meeting_room(room_id, state)?;
    let payload = format!(
        "{{\"room_id\":{},\"user\":\"{}\",\"issued_at\":\"{}\"}}",
        room_id,
        user_name.replace('"', ""),
        chrono::Utc::now().to_rfc3339()
    );
    Ok(base64::engine::general_purpose::STANDARD.encode(payload))
}

#[tauri::command]
pub fn join_meeting_room(room_id: i64, user_name: String, state: State<AppState>) -> Result<Vec<MeetingParticipant>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let trimmed_user = user_name.trim();
    if trimmed_user.is_empty() {
        return Err("用户名不能为空".to_string());
    }

    conn.execute(
        "UPDATE meeting_participants SET is_online = 0, left_at = ?1 WHERE room_id = ?2 AND user_name = ?3 AND is_online = 1",
        (&now, &room_id, &trimmed_user),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO meeting_participants (room_id, user_name, is_online, joined_at) VALUES (?1, ?2, 1, ?3)",
        (&room_id, &trimmed_user, &now),
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, room_id, user_name, is_online, joined_at, left_at FROM meeting_participants WHERE room_id = ?1 AND is_online = 1 ORDER BY joined_at ASC")
        .map_err(|e| e.to_string())?;
    let participants = stmt
        .query_map([room_id], map_meeting_participant_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(participants)
}

#[tauri::command]
pub fn leave_meeting_room(room_id: i64, user_name: String, state: State<AppState>) -> Result<Vec<MeetingParticipant>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let trimmed_user = user_name.trim();
    if trimmed_user.is_empty() {
        return Err("用户名不能为空".to_string());
    }

    conn.execute(
        "UPDATE meeting_participants SET is_online = 0, left_at = ?1 WHERE room_id = ?2 AND user_name = ?3 AND is_online = 1",
        (&now, &room_id, &trimmed_user),
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, room_id, user_name, is_online, joined_at, left_at FROM meeting_participants WHERE room_id = ?1 AND is_online = 1 ORDER BY joined_at ASC")
        .map_err(|e| e.to_string())?;
    let participants = stmt
        .query_map([room_id], map_meeting_participant_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(participants)
}

#[tauri::command]
pub fn list_meeting_participants(room_id: i64, state: State<AppState>) -> Result<Vec<MeetingParticipant>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, room_id, user_name, is_online, joined_at, left_at FROM meeting_participants WHERE room_id = ?1 AND is_online = 1 ORDER BY joined_at ASC")
        .map_err(|e| e.to_string())?;
    let participants = stmt
        .query_map([room_id], map_meeting_participant_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(participants)
}

#[tauri::command]
pub fn upsert_meeting_peer(
    room_id: i64,
    peer_id: String,
    user_name: String,
    mic_on: bool,
    camera_on: bool,
    state: State<AppState>
) -> Result<MeetingPeer, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let trimmed_peer_id = peer_id.trim();
    let trimmed_user = user_name.trim();
    if trimmed_peer_id.is_empty() || trimmed_user.is_empty() {
        return Err("peer_id 和 user_name 不能为空".to_string());
    }

    conn.execute(
        "INSERT INTO meeting_peers (room_id, peer_id, user_name, mic_on, camera_on, joined_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(peer_id) DO UPDATE SET
           room_id = excluded.room_id,
           user_name = excluded.user_name,
           mic_on = excluded.mic_on,
           camera_on = excluded.camera_on,
           last_seen_at = excluded.last_seen_at",
        (&room_id, &trimmed_peer_id, &trimmed_user, &(if mic_on { 1 } else { 0 }), &(if camera_on { 1 } else { 0 }), &now),
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, room_id, peer_id, user_name, mic_on, camera_on, joined_at, last_seen_at FROM meeting_peers WHERE peer_id = ?1")
        .map_err(|e| e.to_string())?;
    stmt.query_row([trimmed_peer_id], map_meeting_peer_row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_meeting_peers(room_id: i64, state: State<AppState>) -> Result<Vec<MeetingPeer>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now();
    let stale_before = (now - chrono::Duration::seconds(20)).to_rfc3339();

    conn.execute(
        "DELETE FROM meeting_peers WHERE room_id = ?1 AND last_seen_at < ?2",
        (&room_id, &stale_before),
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, room_id, peer_id, user_name, mic_on, camera_on, joined_at, last_seen_at FROM meeting_peers WHERE room_id = ?1 ORDER BY joined_at ASC")
        .map_err(|e| e.to_string())?;
    let peers = stmt
        .query_map([room_id], map_meeting_peer_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(peers)
}

#[tauri::command]
pub fn leave_meeting_peer(room_id: i64, peer_id: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM meeting_peers WHERE room_id = ?1 AND peer_id = ?2",
        (&room_id, &peer_id),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn publish_meeting_signal(
    room_id: i64,
    from_peer_id: String,
    to_peer_id: String,
    signal_type: String,
    payload: String,
    state: State<AppState>,
) -> Result<MeetingSignal, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let from_peer_id = from_peer_id.trim();
    let to_peer_id = to_peer_id.trim();
    let signal_type = signal_type.trim();
    if from_peer_id.is_empty() || to_peer_id.is_empty() || signal_type.is_empty() {
        return Err("信令参数不能为空".to_string());
    }
    conn.execute(
        "INSERT INTO meeting_signals (room_id, from_peer_id, to_peer_id, signal_type, payload, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (&room_id, &from_peer_id, &to_peer_id, &signal_type, &payload, &now),
    )
    .map_err(|e| e.to_string())?;
    let inserted_id = conn.last_insert_rowid();
    let mut stmt = conn
        .prepare("SELECT id, room_id, from_peer_id, to_peer_id, signal_type, payload, created_at FROM meeting_signals WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    stmt.query_row([inserted_id], map_meeting_signal_row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pull_meeting_signals(room_id: i64, to_peer_id: String, since_id: i64, state: State<AppState>) -> Result<Vec<MeetingSignal>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now();
    let stale_before = (now - chrono::Duration::minutes(10)).to_rfc3339();
    conn.execute(
        "DELETE FROM meeting_signals WHERE room_id = ?1 AND created_at < ?2",
        (&room_id, &stale_before),
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, room_id, from_peer_id, to_peer_id, signal_type, payload, created_at
             FROM meeting_signals
             WHERE room_id = ?1 AND to_peer_id = ?2 AND id > ?3
             ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;
    let signals = stmt
        .query_map(params![room_id, to_peer_id, since_id], map_meeting_signal_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(signals)
}
