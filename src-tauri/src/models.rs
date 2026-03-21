use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub folder_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Folder {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateNoteInput {
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub folder_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateNoteInput {
    pub id: i64,
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub folder_id: Option<i64>,
}
