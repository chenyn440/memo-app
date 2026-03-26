export interface Note {
  id: number;
  title: string;
  content: string;
  folder_id: number | null;
  summary_history?: string;
  translations?: string; // JSON string, e.g. { "English": { "title": "...", "content": "..." } }
  created_at: string;
  updated_at: string;
}

export interface Folder {
  id: number;
  name: string;
  color: string;
  sort_order: number;
}

export interface Tag {
  id: number;
  name: string;
}

export interface NoteTag {
  note_id: number;
  tag_id: number;
}

export type PlanType = 'project' | 'event' | 'meeting';
export type PlanStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type PlanPriority = 'low' | 'medium' | 'high';

export interface Plan {
  id: number;
  name: string;
  plan_type: PlanType;
  created_at: string;
  updated_at: string;
}

export interface PlanItem {
  id: number;
  plan_id: number;
  title: string;
  item_type: 'task' | 'milestone' | 'risk' | 'meeting';
  status: PlanStatus;
  priority: PlanPriority;
  owner?: string | null;
  start_at?: string | null;
  due_at?: string | null;
  notes?: string | null;
  linked_note_id?: number | null;
  meeting_platform?: string | null;
  meeting_url?: string | null;
  meeting_id?: string | null;
  meeting_password?: string | null;
  meeting_attendees?: string | null;
  meeting_recording_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePlanInput {
  name: string;
  plan_type: PlanType;
}

export interface UpdatePlanInput extends CreatePlanInput {
  id: number;
}

export interface CreatePlanItemInput {
  plan_id: number;
  title: string;
  item_type: PlanItem['item_type'];
  status: PlanStatus;
  priority: PlanPriority;
  owner?: string;
  start_at?: string;
  due_at?: string;
  notes?: string;
  linked_note_id?: number;
  meeting_platform?: string;
  meeting_url?: string;
  meeting_id?: string;
  meeting_password?: string;
  meeting_attendees?: string;
  meeting_recording_url?: string;
}

export interface UpdatePlanItemInput {
  id: number;
  title: string;
  item_type: PlanItem['item_type'];
  status: PlanStatus;
  priority: PlanPriority;
  owner?: string;
  start_at?: string;
  due_at?: string;
  notes?: string;
  linked_note_id?: number;
  meeting_platform?: string;
  meeting_url?: string;
  meeting_id?: string;
  meeting_password?: string;
  meeting_attendees?: string;
  meeting_recording_url?: string;
}

export type MeetingState = 'idle' | 'in_progress' | 'ended';

export interface MeetingRoom {
  id: number;
  plan_item_id: number;
  room_code: string;
  room_name: string;
  state: MeetingState;
  started_at?: string | null;
  ended_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MeetingParticipant {
  id: number;
  room_id: number;
  user_name: string;
  is_online: boolean;
  joined_at: string;
  left_at?: string | null;
}

export interface MeetingPeer {
  id: number;
  room_id: number;
  peer_id: string;
  user_name: string;
  mic_on: boolean;
  camera_on: boolean;
  joined_at: string;
  last_seen_at: string;
}

export interface MeetingSignal {
  id: number;
  room_id: number;
  from_peer_id: string;
  to_peer_id: string;
  signal_type: 'offer' | 'answer' | 'ice' | 'chat';
  payload: string;
  created_at: string;
}

export interface JoinMeetingInput {
  room_id: number;
  user_name: string;
}
