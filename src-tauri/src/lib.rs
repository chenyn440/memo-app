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
            commands::get_plans,
            commands::create_plan,
            commands::update_plan,
            commands::delete_plan,
            commands::get_plan_items,
            commands::get_plan_items_by_date_range,
            commands::create_plan_item,
            commands::update_plan_item,
            commands::delete_plan_item,
            commands::get_or_create_meeting_room,
            commands::get_meeting_room,
            commands::get_meeting_room_by_code,
            commands::start_meeting_room,
            commands::end_meeting_room,
            commands::issue_meeting_token,
            commands::join_meeting_room,
            commands::leave_meeting_room,
            commands::list_meeting_participants,
            commands::upsert_meeting_peer,
            commands::list_meeting_peers,
            commands::leave_meeting_peer,
            commands::publish_meeting_signal,
            commands::pull_meeting_signals,
            speech::start_speech,
            speech::stop_speech,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
