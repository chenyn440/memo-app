import { invoke } from '@tauri-apps/api/core';
import { Note, Folder, Tag } from '../types';

export const api = {
  getNotes: () => invoke<Note[]>('get_notes'),

  createNote: (title: string, content: string, folderId?: number) =>
    invoke<Note>('create_note', {
      input: { title, content, folder_id: folderId },
    }),

  updateNote: (id: number, title: string, content: string, folderId?: number) =>
    invoke<Note>('update_note', {
      input: { id, title, content, folder_id: folderId },
    }),

  deleteNote: (id: number) => invoke('delete_note', { id }),

  searchNotes: (query: string) => invoke<Note[]>('search_notes', { query }),

  getFolders: () => invoke<Folder[]>('get_folders'),

  createFolder: (name: string, color: string) =>
    invoke<Folder>('create_folder', { name, color }),

  deleteFolder: (id: number) => invoke('delete_folder', { id }),

  renameFolder: (id: number, name: string) =>
    invoke<Folder>('rename_folder', { id, name }),

  reorderFolders: (folderIds: number[]) =>
    invoke('reorder_folders', { folderIds }),

  getNotesByFolder: (folderId: number) =>
    invoke<Note[]>('get_notes_by_folder', { folderId }),

  getTags: () => invoke<Tag[]>('get_tags'),

  createTag: (name: string) => invoke<Tag>('create_tag', { name }),

  deleteTag: (id: number) => invoke('delete_tag', { id }),

  getNoteTags: (noteId: number) => invoke<Tag[]>('get_note_tags', { noteId }),

  addTagToNote: (noteId: number, tagId: number) =>
    invoke('add_tag_to_note', { noteId, tagId }),

  removeTagFromNote: (noteId: number, tagId: number) =>
    invoke('remove_tag_from_note', { noteId, tagId }),

  getNotesByTag: (tagId: number) => invoke<Note[]>('get_notes_by_tag', { tagId }),

  exportNote: (noteId: number, format: 'md' | 'txt' | 'json', outputPath: string) =>
    invoke('export_note', { noteId, format, outputPath }),

  saveImage: (base64Data: string) => invoke<string>('save_image', { base64Data }),

  loadImage: (path: string) => invoke<string>('load_image', { path }),

  startSpeech: () => invoke('start_speech'),

  stopSpeech: () => invoke('stop_speech'),
};
