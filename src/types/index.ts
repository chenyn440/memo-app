export interface Note {
  id: number;
  title: string;
  content: string;
  folder_id: number | null;
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
