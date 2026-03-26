use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub folder_id: Option<i64>,
    pub summary_history: Option<String>,
    pub translations: Option<String>,
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
    #[serde(default)]
    pub summary_history: Option<String>,
    #[serde(default)]
    pub translations: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Plan {
    pub id: i64,
    pub name: String,
    pub plan_type: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlanItem {
    pub id: i64,
    pub plan_id: i64,
    pub title: String,
    pub item_type: String,
    pub status: String,
    pub priority: String,
    pub owner: Option<String>,
    pub start_at: Option<String>,
    pub due_at: Option<String>,
    pub notes: Option<String>,
    pub linked_note_id: Option<i64>,
    pub meeting_platform: Option<String>,
    pub meeting_url: Option<String>,
    pub meeting_id: Option<String>,
    pub meeting_password: Option<String>,
    pub meeting_attendees: Option<String>,
    pub meeting_recording_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreatePlanInput {
    pub name: String,
    #[serde(alias = "planType")]
    pub plan_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdatePlanInput {
    pub id: i64,
    pub name: String,
    #[serde(alias = "planType")]
    pub plan_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreatePlanItemInput {
    pub plan_id: i64,
    pub title: String,
    pub item_type: String,
    pub status: String,
    pub priority: String,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub start_at: Option<String>,
    #[serde(default)]
    pub due_at: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub linked_note_id: Option<i64>,
    #[serde(default)]
    pub meeting_platform: Option<String>,
    #[serde(default)]
    pub meeting_url: Option<String>,
    #[serde(default)]
    pub meeting_id: Option<String>,
    #[serde(default)]
    pub meeting_password: Option<String>,
    #[serde(default)]
    pub meeting_attendees: Option<String>,
    #[serde(default)]
    pub meeting_recording_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdatePlanItemInput {
    pub id: i64,
    pub title: String,
    pub item_type: String,
    pub status: String,
    pub priority: String,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub start_at: Option<String>,
    #[serde(default)]
    pub due_at: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub linked_note_id: Option<i64>,
    #[serde(default)]
    pub meeting_platform: Option<String>,
    #[serde(default)]
    pub meeting_url: Option<String>,
    #[serde(default)]
    pub meeting_id: Option<String>,
    #[serde(default)]
    pub meeting_password: Option<String>,
    #[serde(default)]
    pub meeting_attendees: Option<String>,
    #[serde(default)]
    pub meeting_recording_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingRoom {
    pub id: i64,
    pub plan_item_id: i64,
    pub room_code: String,
    pub room_name: String,
    pub state: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingParticipant {
    pub id: i64,
    pub room_id: i64,
    pub user_name: String,
    pub is_online: bool,
    pub joined_at: String,
    pub left_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingPeer {
    pub id: i64,
    pub room_id: i64,
    pub peer_id: String,
    pub user_name: String,
    pub mic_on: bool,
    pub camera_on: bool,
    pub joined_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingSignal {
    pub id: i64,
    pub room_id: i64,
    pub from_peer_id: String,
    pub to_peer_id: String,
    pub signal_type: String,
    pub payload: String,
    pub created_at: String,
}
