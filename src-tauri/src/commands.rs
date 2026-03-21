use crate::models::{Note, Folder, Tag, CreateNoteInput, UpdateNoteInput};
use crate::AppState;
use tauri::{State, Manager};
use std::fs;
use base64::Engine;
use serde_json::json;

#[tauri::command]
pub fn get_notes(state: State<AppState>) -> Result<Vec<Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, content, folder_id, created_at, updated_at FROM notes ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                folder_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
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
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_note(input: UpdateNoteInput, state: State<AppState>) -> Result<Note, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE notes SET title = ?1, content = ?2, folder_id = ?3, updated_at = ?4 WHERE id = ?5",
        (&input.title, &input.content, &input.folder_id, &now, &input.id),
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, title, content, folder_id, created_at, updated_at FROM notes WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let note = stmt
        .query_row([input.id], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                folder_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
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
            "SELECT n.id, n.title, n.content, n.folder_id, n.created_at, n.updated_at
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
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
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
        .prepare("SELECT id, title, content, folder_id, created_at, updated_at FROM notes WHERE folder_id = ?1 ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map([folder_id], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                folder_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
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
        .prepare("SELECT n.id, n.title, n.content, n.folder_id, n.created_at, n.updated_at FROM notes n INNER JOIN note_tags nt ON n.id = nt.note_id WHERE nt.tag_id = ?1 ORDER BY n.updated_at DESC")
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map([tag_id], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                folder_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
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
        .prepare("SELECT id, title, content, folder_id, created_at, updated_at FROM notes WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let note = stmt
        .query_row([note_id], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                folder_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
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
