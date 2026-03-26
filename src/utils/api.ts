import { invoke } from '@tauri-apps/api/core';
import {
  Note, Folder, Tag, Plan, PlanItem, MeetingParticipant, MeetingPeer, MeetingRoom, MeetingSignal,
  CreatePlanInput, UpdatePlanInput, CreatePlanItemInput, UpdatePlanItemInput
} from '../types';

const MEETING_SIGNAL_SERVER_KEY = 'meeting_signal_server_url';

const normalizeSignalServerUrl = (url: string): string => {
  const trimmed = url.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
};

const getSignalServerUrl = (): string => {
  if (typeof window === 'undefined') return '';
  const fromStorage = window.localStorage.getItem(MEETING_SIGNAL_SERVER_KEY) ?? '';
  if (fromStorage.trim()) return normalizeSignalServerUrl(fromStorage);
  const fromEnv = (import.meta as any)?.env?.VITE_MEETING_SIGNAL_SERVER_URL ?? '';
  return normalizeSignalServerUrl(String(fromEnv));
};

const setSignalServerUrl = (url: string): string => {
  const normalized = normalizeSignalServerUrl(url);
  if (typeof window !== 'undefined') {
    if (normalized) {
      window.localStorage.setItem(MEETING_SIGNAL_SERVER_KEY, normalized);
    } else {
      window.localStorage.removeItem(MEETING_SIGNAL_SERVER_KEY);
    }
  }
  return normalized;
};

const remoteRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const base = getSignalServerUrl();
  if (!base) {
    throw new Error('未配置远程信令服务地址');
  }
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `远程信令请求失败(${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
};

const ensureLocalRoomId = (roomIdOrKey: number | string): number => {
  if (typeof roomIdOrKey === 'number') return roomIdOrKey;
  throw new Error('本地信令模式需要数字 roomId；远程模式请配置远程信令服务地址');
};

export const api = {
  getMeetingSignalServerUrl: () => getSignalServerUrl(),
  setMeetingSignalServerUrl: (url: string) => setSignalServerUrl(url),

  getNotes: () => invoke<Note[]>('get_notes'),

  createNote: (title: string, content: string, folderId?: number) =>
    invoke<Note>('create_note', {
      input: { title, content, folder_id: folderId },
    }),

  updateNote: (id: number, title: string, content: string, folderId?: number, summaryHistory?: string, translations?: string) =>
    invoke<Note>('update_note', {
      input: { id, title, content, folder_id: folderId, summary_history: summaryHistory, translations },
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

  getPlans: () => invoke<Plan[]>('get_plans'),

  createPlan: (input: CreatePlanInput) => invoke<Plan>('create_plan', { input }),

  updatePlan: (input: UpdatePlanInput) => invoke<Plan>('update_plan', { input }),

  deletePlan: (id: number) => invoke('delete_plan', { id }),

  getPlanItems: (planId: number) => invoke<PlanItem[]>('get_plan_items', { planId }),

  getPlanItemsByDateRange: (start: string, end: string) =>
    invoke<PlanItem[]>('get_plan_items_by_date_range', { start, end }),

  createPlanItem: (input: CreatePlanItemInput) => invoke<PlanItem>('create_plan_item', { input }),

  updatePlanItem: (input: UpdatePlanItemInput) => invoke<PlanItem>('update_plan_item', { input }),

  deletePlanItem: (id: number) => invoke('delete_plan_item', { id }),

  getOrCreateMeetingRoom: (planItemId: number, roomName: string) =>
    invoke<MeetingRoom>('get_or_create_meeting_room', { planItemId, roomName }),

  getMeetingRoom: (roomId: number) => invoke<MeetingRoom>('get_meeting_room', { roomId }),

  startMeetingRoom: (roomId: number) => invoke<MeetingRoom>('start_meeting_room', { roomId }),

  endMeetingRoom: (roomId: number) => invoke<MeetingRoom>('end_meeting_room', { roomId }),

  issueMeetingToken: (roomId: number, userName: string) =>
    invoke<string>('issue_meeting_token', { roomId, userName }),

  joinMeetingRoom: (roomId: number, userName: string) =>
    invoke<MeetingParticipant[]>('join_meeting_room', { roomId, userName }),

  leaveMeetingRoom: (roomId: number, userName: string) =>
    invoke<MeetingParticipant[]>('leave_meeting_room', { roomId, userName }),

  listMeetingParticipants: (roomId: number) =>
    invoke<MeetingParticipant[]>('list_meeting_participants', { roomId }),

  upsertMeetingPeer: (
    roomIdOrKey: number | string,
    peerId: string,
    userName: string,
    micOn: boolean,
    cameraOn: boolean
  ) => {
    const signalServer = getSignalServerUrl();
    if (signalServer) {
      return remoteRequest<MeetingPeer>(`/v1/rooms/${encodeURIComponent(String(roomIdOrKey))}/peers/upsert`, {
        method: 'POST',
        body: JSON.stringify({
          peer_id: peerId,
          user_name: userName,
          mic_on: micOn,
          camera_on: cameraOn,
        }),
      });
    }
    const roomId = ensureLocalRoomId(roomIdOrKey);
    return invoke<MeetingPeer>('upsert_meeting_peer', { roomId, peerId, userName, micOn, cameraOn });
  },

  listMeetingPeers: (roomIdOrKey: number | string) => {
    const signalServer = getSignalServerUrl();
    if (signalServer) {
      return remoteRequest<MeetingPeer[]>(`/v1/rooms/${encodeURIComponent(String(roomIdOrKey))}/peers`);
    }
    const roomId = ensureLocalRoomId(roomIdOrKey);
    return invoke<MeetingPeer[]>('list_meeting_peers', { roomId });
  },

  leaveMeetingPeer: (roomIdOrKey: number | string, peerId: string) => {
    const signalServer = getSignalServerUrl();
    if (signalServer) {
      return remoteRequest<void>(`/v1/rooms/${encodeURIComponent(String(roomIdOrKey))}/peers/${encodeURIComponent(peerId)}`, {
        method: 'DELETE',
      });
    }
    const roomId = ensureLocalRoomId(roomIdOrKey);
    return invoke<void>('leave_meeting_peer', { roomId, peerId });
  },

  publishMeetingSignal: (
    roomIdOrKey: number | string,
    fromPeerId: string,
    toPeerId: string,
    signalType: 'offer' | 'answer' | 'ice',
    payload: string
  ) => {
    const signalServer = getSignalServerUrl();
    if (signalServer) {
      return remoteRequest<MeetingSignal>(`/v1/rooms/${encodeURIComponent(String(roomIdOrKey))}/signals`, {
        method: 'POST',
        body: JSON.stringify({
          from_peer_id: fromPeerId,
          to_peer_id: toPeerId,
          signal_type: signalType,
          payload,
        }),
      });
    }
    const roomId = ensureLocalRoomId(roomIdOrKey);
    return invoke<MeetingSignal>('publish_meeting_signal', {
      roomId,
      fromPeerId,
      toPeerId,
      signalType,
      payload,
    });
  },

  pullMeetingSignals: (roomIdOrKey: number | string, toPeerId: string, sinceId: number) => {
    const signalServer = getSignalServerUrl();
    if (signalServer) {
      const params = new URLSearchParams({
        to_peer_id: toPeerId,
        since_id: String(sinceId),
      });
      return remoteRequest<MeetingSignal[]>(`/v1/rooms/${encodeURIComponent(String(roomIdOrKey))}/signals?${params.toString()}`);
    }
    const roomId = ensureLocalRoomId(roomIdOrKey);
    return invoke<MeetingSignal[]>('pull_meeting_signals', { roomId, toPeerId, sinceId });
  },
};
