mod db;
mod models;
mod commands;
mod speech;

use std::sync::Mutex;
use rusqlite::Connection;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<Connection>,
}

pub struct SpeechState {
    pub process: Mutex<Option<speech::SpeechProcess>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;
            let db_path = app_dir.join("memo.db");
            let conn = db::init_db(db_path)?;
            app.manage(AppState {
                db: Mutex::new(conn),
            });
            app.manage(SpeechState {
                process: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_notes,
            commands::create_note,
            commands::update_note,
            commands::delete_note,
            commands::search_notes,
            commands::get_folders,
            commands::create_folder,
            commands::delete_folder,
            commands::rename_folder,
            commands::reorder_folders,
            commands::get_notes_by_folder,
            commands::get_tags,
            commands::create_tag,
            commands::delete_tag,
            commands::get_note_tags,
            commands::add_tag_to_note,
            commands::remove_tag_from_note,
            commands::get_notes_by_tag,
            commands::export_note,
            commands::save_image,
            commands::load_image,
            speech::start_speech,
            speech::stop_speech,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
