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
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(folder_id) REFERENCES folders(id)
        )",
        [],
    )?;

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
