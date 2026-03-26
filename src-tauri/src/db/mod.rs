use rusqlite::{Connection, Result};
use std::path::PathBuf;

pub fn init_db(db_path: PathBuf) -> Result<Connection> {
    let conn = Connection::open(db_path)?;

    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    // Migrate categories -> folders with idempotent guards.
    let has_categories: bool = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='categories'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;
    let has_folders: bool = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='folders'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;
    let notes_has_category_id: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name = 'category_id'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;
    let notes_has_folder_id: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name = 'folder_id'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;

    if has_categories && !has_folders {
        conn.execute_batch("ALTER TABLE categories RENAME TO folders;")?;
    } else if has_categories && has_folders {
        // Legacy databases may contain both tables after interrupted upgrades.
        conn.execute(
            "INSERT OR IGNORE INTO folders (id, name, color)
             SELECT id, name, color FROM categories",
            [],
        )?;
    }

    if notes_has_category_id && !notes_has_folder_id {
        conn.execute_batch("ALTER TABLE notes RENAME COLUMN category_id TO folder_id;")?;
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )?;

    let has_sort_order: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('folders') WHERE name = 'sort_order'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;

    if !has_sort_order {
        conn.execute(
            "ALTER TABLE folders ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    conn.execute(
        "UPDATE folders SET sort_order = id WHERE sort_order = 0",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            folder_id INTEGER,
            summary_history TEXT DEFAULT '[]',
            translations TEXT DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(folder_id) REFERENCES folders(id)
        )",
        [],
    )?;

    let has_summary_history: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name = 'summary_history'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;

    if !has_summary_history {
        conn.execute(
            "ALTER TABLE notes ADD COLUMN summary_history TEXT DEFAULT '[]'",
            [],
        )?;
    }

    let has_translations: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name = 'translations'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;

    if !has_translations {
        conn.execute(
            "ALTER TABLE notes ADD COLUMN translations TEXT DEFAULT '{}'",
            [],
        )?;
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS note_tags (
            note_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY(note_id, tag_id),
            FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE,
            FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            title, content, content=notes, content_rowid=id
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            plan_type TEXT NOT NULL DEFAULT 'project',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS plan_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            item_type TEXT NOT NULL DEFAULT 'task',
            status TEXT NOT NULL DEFAULT 'todo',
            priority TEXT NOT NULL DEFAULT 'medium',
            owner TEXT,
            start_at TEXT,
            due_at TEXT,
            notes TEXT,
            linked_note_id INTEGER,
            meeting_platform TEXT,
            meeting_url TEXT,
            meeting_id TEXT,
            meeting_password TEXT,
            meeting_attendees TEXT,
            meeting_recording_url TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE,
            FOREIGN KEY(linked_note_id) REFERENCES notes(id) ON DELETE SET NULL
        )",
        [],
    )?;

    let plan_items_has_meeting_platform: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('plan_items') WHERE name = 'meeting_platform'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;
    if !plan_items_has_meeting_platform {
        conn.execute("ALTER TABLE plan_items ADD COLUMN meeting_platform TEXT", [])?;
    }

    let plan_items_has_meeting_url: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('plan_items') WHERE name = 'meeting_url'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;
    if !plan_items_has_meeting_url {
        conn.execute("ALTER TABLE plan_items ADD COLUMN meeting_url TEXT", [])?;
    }

    let plan_items_has_meeting_id: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('plan_items') WHERE name = 'meeting_id'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;
    if !plan_items_has_meeting_id {
        conn.execute("ALTER TABLE plan_items ADD COLUMN meeting_id TEXT", [])?;
    }

    let plan_items_has_meeting_password: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('plan_items') WHERE name = 'meeting_password'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;
    if !plan_items_has_meeting_password {
        conn.execute("ALTER TABLE plan_items ADD COLUMN meeting_password TEXT", [])?;
    }

    let plan_items_has_meeting_attendees: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('plan_items') WHERE name = 'meeting_attendees'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;
    if !plan_items_has_meeting_attendees {
        conn.execute("ALTER TABLE plan_items ADD COLUMN meeting_attendees TEXT", [])?;
    }

    let plan_items_has_meeting_recording_url: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('plan_items') WHERE name = 'meeting_recording_url'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;
    if !plan_items_has_meeting_recording_url {
        conn.execute("ALTER TABLE plan_items ADD COLUMN meeting_recording_url TEXT", [])?;
    }

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_items_plan_id ON plan_items(plan_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_items_status ON plan_items(status)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_items_due_at ON plan_items(due_at)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_items_type ON plan_items(item_type)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS meeting_rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_item_id INTEGER NOT NULL UNIQUE,
            room_code TEXT NOT NULL UNIQUE,
            room_name TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'idle',
            started_at TEXT,
            ended_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(plan_item_id) REFERENCES plan_items(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_meeting_rooms_plan_item_id ON meeting_rooms(plan_item_id)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS meeting_participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            user_name TEXT NOT NULL,
            is_online INTEGER NOT NULL DEFAULT 1,
            joined_at TEXT NOT NULL,
            left_at TEXT,
            FOREIGN KEY(room_id) REFERENCES meeting_rooms(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_meeting_participants_room_id ON meeting_participants(room_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_meeting_participants_online ON meeting_participants(room_id, is_online)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS meeting_peers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            peer_id TEXT NOT NULL UNIQUE,
            user_name TEXT NOT NULL,
            mic_on INTEGER NOT NULL DEFAULT 1,
            camera_on INTEGER NOT NULL DEFAULT 1,
            joined_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            FOREIGN KEY(room_id) REFERENCES meeting_rooms(id) ON DELETE CASCADE
        )",
        [],
    )?;
    let meeting_peers_has_mic_on: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('meeting_peers') WHERE name = 'mic_on'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;
    if !meeting_peers_has_mic_on {
        conn.execute("ALTER TABLE meeting_peers ADD COLUMN mic_on INTEGER NOT NULL DEFAULT 1", [])?;
    }
    let meeting_peers_has_camera_on: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('meeting_peers') WHERE name = 'camera_on'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;
    if !meeting_peers_has_camera_on {
        conn.execute("ALTER TABLE meeting_peers ADD COLUMN camera_on INTEGER NOT NULL DEFAULT 1", [])?;
    }
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_meeting_peers_room_id ON meeting_peers(room_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_meeting_peers_last_seen ON meeting_peers(last_seen_at)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS meeting_signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            from_peer_id TEXT NOT NULL,
            to_peer_id TEXT NOT NULL,
            signal_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(room_id) REFERENCES meeting_rooms(id) ON DELETE CASCADE
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_meeting_signals_room_to_id ON meeting_signals(room_id, to_peer_id, id)",
        [],
    )?;

    // 创建触发器以保持 FTS 索引同步（先删除旧的，确保使用正确语法）
    conn.execute("DROP TRIGGER IF EXISTS notes_ai", [])?;
    conn.execute("DROP TRIGGER IF EXISTS notes_ad", [])?;
    conn.execute("DROP TRIGGER IF EXISTS notes_au", [])?;

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
            INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
        END",
        [],
    )?;

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
        END",
        [],
    )?;

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
            INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
        END",
        [],
    )?;

    // Rebuild FTS index for existing data
    conn.execute("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')", [])?;

    Ok(conn)
}
