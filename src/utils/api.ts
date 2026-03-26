import { invoke } from '@tauri-apps/api/core';
import {
  Note, Folder, Tag, Plan, PlanItem, MeetingParticipant, MeetingPeer, MeetingRoom, MeetingSignal,
  CreatePlanInput, UpdatePlanInput, CreatePlanItemInput, UpdatePlanItemInput
} from '../types';

const MEETING_SIGNAL_SERVER_KEY = 'meeting_signal_server_url';
const DEFAULT_MEETING_SIGNAL_SERVER_URL = 'https://aiyn.cloud:8081';
const WEB_API_BASE_URL_KEY = 'web_api_base_url';
const WEB_AUTH_TOKEN_KEY = 'web_auth_token';
const DEFAULT_WEB_API_BASE_URL = '';

const isTauriRuntime = (): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
};

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
  if (String(fromEnv).trim()) {
    return normalizeSignalServerUrl(String(fromEnv));
  }
  return normalizeSignalServerUrl(DEFAULT_MEETING_SIGNAL_SERVER_URL);
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

const normalizeWebApiBaseUrl = (url: string): string => {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
};

const getWebApiBaseUrl = (): string => {
  if (typeof window === 'undefined') return '';
  const fromStorage = window.localStorage.getItem(WEB_API_BASE_URL_KEY) ?? '';
  if (fromStorage.trim()) return normalizeWebApiBaseUrl(fromStorage);
  const fromEnv = (import.meta as any)?.env?.VITE_WEB_API_BASE_URL ?? '';
  if (String(fromEnv).trim()) return normalizeWebApiBaseUrl(String(fromEnv));
  if (window.location?.origin) return normalizeWebApiBaseUrl(window.location.origin);
  return normalizeWebApiBaseUrl(DEFAULT_WEB_API_BASE_URL);
};

const setWebApiBaseUrl = (url: string): string => {
  const normalized = normalizeWebApiBaseUrl(url);
  if (typeof window !== 'undefined') {
    if (normalized) {
      window.localStorage.setItem(WEB_API_BASE_URL_KEY, normalized);
    } else {
      window.localStorage.removeItem(WEB_API_BASE_URL_KEY);
    }
  }
  return normalized;
};

const getWebAuthToken = (): string => {
  if (typeof window === 'undefined') return '';
  return (window.localStorage.getItem(WEB_AUTH_TOKEN_KEY) ?? '').trim();
};

const setWebAuthToken = (token: string) => {
  if (typeof window === 'undefined') return;
  const normalized = String(token || '').trim();
  if (normalized) {
    window.localStorage.setItem(WEB_AUTH_TOKEN_KEY, normalized);
  } else {
    window.localStorage.removeItem(WEB_AUTH_TOKEN_KEY);
  }
};

const webRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const base = getWebApiBaseUrl();
  if (!base) {
    throw new Error('未配置 Web API 服务地址（VITE_WEB_API_BASE_URL）');
  }
  const token = getWebAuthToken();
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Web API 请求失败(${response.status})`);
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
  isTauriRuntime: () => isTauriRuntime(),
  getWebApiBaseUrl: () => getWebApiBaseUrl(),
  setWebApiBaseUrl: (url: string) => setWebApiBaseUrl(url),
  getWebAuthToken: () => getWebAuthToken(),
  setWebAuthToken: (token: string) => setWebAuthToken(token),
  registerWithPassword: (account: string, password: string) => webRequest<{ access_token: string; refresh_token?: string }>('/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ account, password }),
  }),
  loginWithPassword: (account: string, password: string) => webRequest<{ access_token: string; refresh_token?: string }>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account, password }),
  }),
  logoutWeb: () => {
    setWebAuthToken('');
  },

  getMeetingSignalServerUrl: () => getSignalServerUrl(),
  setMeetingSignalServerUrl: (url: string) => setSignalServerUrl(url),

  getNotes: () => {
    if (!isTauriRuntime()) return webRequest<Note[]>('/v1/notes');
    return invoke<Note[]>('get_notes');
  },

  createNote: (title: string, content: string, folderId?: number) =>
    !isTauriRuntime()
      ? webRequest<Note>('/v1/notes', {
        method: 'POST',
        body: JSON.stringify({ title, content, folder_id: folderId ?? null }),
      })
      : invoke<Note>('create_note', {
        input: { title, content, folder_id: folderId },
      }),

  updateNote: (id: number, title: string, content: string, folderId?: number, summaryHistory?: string, translations?: string) =>
    !isTauriRuntime()
      ? webRequest<Note>(`/v1/notes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ id, title, content, folder_id: folderId ?? null, summary_history: summaryHistory, translations }),
      })
      : invoke<Note>('update_note', {
        input: { id, title, content, folder_id: folderId, summary_history: summaryHistory, translations },
      }),

  deleteNote: (id: number) => {
    if (!isTauriRuntime()) return webRequest<void>(`/v1/notes/${id}`, { method: 'DELETE' });
    return invoke('delete_note', { id });
  },

  searchNotes: (query: string) => {
    if (!isTauriRuntime()) return webRequest<Note[]>(`/v1/notes/search?q=${encodeURIComponent(query)}`);
    return invoke<Note[]>('search_notes', { query });
  },

  getFolders: () => {
    if (!isTauriRuntime()) return webRequest<Folder[]>('/v1/folders');
    return invoke<Folder[]>('get_folders');
  },

  createFolder: (name: string, color: string) =>
    !isTauriRuntime()
      ? webRequest<Folder>('/v1/folders', { method: 'POST', body: JSON.stringify({ name, color }) })
      : invoke<Folder>('create_folder', { name, color }),

  deleteFolder: (id: number) => {
    if (!isTauriRuntime()) return webRequest<void>(`/v1/folders/${id}`, { method: 'DELETE' });
    return invoke('delete_folder', { id });
  },

  renameFolder: (id: number, name: string) =>
    !isTauriRuntime()
      ? webRequest<Folder>(`/v1/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name }) })
      : invoke<Folder>('rename_folder', { id, name }),

  reorderFolders: (folderIds: number[]) =>
    !isTauriRuntime()
      ? webRequest<void>('/v1/folders/reorder', { method: 'POST', body: JSON.stringify({ folderIds }) })
      : invoke('reorder_folders', { folderIds }),

  getNotesByFolder: (folderId: number) =>
    !isTauriRuntime()
      ? webRequest<Note[]>(`/v1/folders/${folderId}/notes`)
      : invoke<Note[]>('get_notes_by_folder', { folderId }),

  getTags: () => {
    if (!isTauriRuntime()) return webRequest<Tag[]>('/v1/tags');
    return invoke<Tag[]>('get_tags');
  },

  createTag: (name: string) => !isTauriRuntime()
    ? webRequest<Tag>('/v1/tags', { method: 'POST', body: JSON.stringify({ name }) })
    : invoke<Tag>('create_tag', { name }),

  deleteTag: (id: number) => !isTauriRuntime()
    ? webRequest<void>(`/v1/tags/${id}`, { method: 'DELETE' })
    : invoke('delete_tag', { id }),

  getNoteTags: (noteId: number) => !isTauriRuntime()
    ? webRequest<Tag[]>(`/v1/notes/${noteId}/tags`)
    : invoke<Tag[]>('get_note_tags', { noteId }),

  addTagToNote: (noteId: number, tagId: number) =>
    !isTauriRuntime()
      ? webRequest<void>(`/v1/notes/${noteId}/tags/${tagId}`, { method: 'PUT' })
      : invoke('add_tag_to_note', { noteId, tagId }),

  removeTagFromNote: (noteId: number, tagId: number) =>
    !isTauriRuntime()
      ? webRequest<void>(`/v1/notes/${noteId}/tags/${tagId}`, { method: 'DELETE' })
      : invoke('remove_tag_from_note', { noteId, tagId }),

  getNotesByTag: (tagId: number) => !isTauriRuntime()
    ? webRequest<Note[]>(`/v1/tags/${tagId}/notes`)
    : invoke<Note[]>('get_notes_by_tag', { tagId }),

  exportNote: (noteId: number, format: 'md' | 'txt' | 'json', outputPath: string) =>
    invoke('export_note', { noteId, format, outputPath }),

  saveImage: (base64Data: string) => invoke<string>('save_image', { base64Data }),

  loadImage: (path: string) => invoke<string>('load_image', { path }),

  startSpeech: () => invoke('start_speech'),

  stopSpeech: () => invoke('stop_speech'),

  getPlans: () => !isTauriRuntime()
    ? webRequest<Plan[]>('/v1/plans')
    : invoke<Plan[]>('get_plans'),

  createPlan: (input: CreatePlanInput) => !isTauriRuntime()
    ? webRequest<Plan>('/v1/plans', { method: 'POST', body: JSON.stringify(input) })
    : invoke<Plan>('create_plan', { input }),

  updatePlan: (input: UpdatePlanInput) => !isTauriRuntime()
    ? webRequest<Plan>(`/v1/plans/${input.id}`, { method: 'PUT', body: JSON.stringify(input) })
    : invoke<Plan>('update_plan', { input }),

  deletePlan: (id: number) => !isTauriRuntime()
    ? webRequest<void>(`/v1/plans/${id}`, { method: 'DELETE' })
    : invoke('delete_plan', { id }),

  getPlanItems: (planId: number) => !isTauriRuntime()
    ? webRequest<PlanItem[]>(`/v1/plans/${planId}/items`)
    : invoke<PlanItem[]>('get_plan_items', { planId }),

  getPlanItemsByDateRange: (start: string, end: string) =>
    !isTauriRuntime()
      ? webRequest<PlanItem[]>(`/v1/plan-items/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
      : invoke<PlanItem[]>('get_plan_items_by_date_range', { start, end }),

  createPlanItem: (input: CreatePlanItemInput) => !isTauriRuntime()
    ? webRequest<PlanItem>('/v1/plan-items', { method: 'POST', body: JSON.stringify(input) })
    : invoke<PlanItem>('create_plan_item', { input }),

  updatePlanItem: (input: UpdatePlanItemInput) => !isTauriRuntime()
    ? webRequest<PlanItem>(`/v1/plan-items/${input.id}`, { method: 'PUT', body: JSON.stringify(input) })
    : invoke<PlanItem>('update_plan_item', { input }),

  deletePlanItem: (id: number) => !isTauriRuntime()
    ? webRequest<void>(`/v1/plan-items/${id}`, { method: 'DELETE' })
    : invoke('delete_plan_item', { id }),

  getOrCreateMeetingRoom: (planItemId: number, roomName: string) =>
    !isTauriRuntime()
      ? webRequest<MeetingRoom>('/v1/meetings/rooms/get-or-create', {
        method: 'POST',
        body: JSON.stringify({ plan_item_id: planItemId, room_name: roomName }),
      })
      : invoke<MeetingRoom>('get_or_create_meeting_room', { planItemId, roomName }),

  getMeetingRoom: (roomId: number) => !isTauriRuntime()
    ? webRequest<MeetingRoom>(`/v1/meetings/rooms/${roomId}`)
    : invoke<MeetingRoom>('get_meeting_room', { roomId }),

  startMeetingRoom: (roomId: number) => !isTauriRuntime()
    ? webRequest<MeetingRoom>(`/v1/meetings/rooms/${roomId}/start`, { method: 'POST' })
    : invoke<MeetingRoom>('start_meeting_room', { roomId }),

  endMeetingRoom: (roomId: number) => !isTauriRuntime()
    ? webRequest<MeetingRoom>(`/v1/meetings/rooms/${roomId}/end`, { method: 'POST' })
    : invoke<MeetingRoom>('end_meeting_room', { roomId }),

  issueMeetingToken: (roomId: number, userName: string) =>
    !isTauriRuntime()
      ? webRequest<string>(`/v1/meetings/rooms/${roomId}/token`, { method: 'POST', body: JSON.stringify({ user_name: userName }) })
      : invoke<string>('issue_meeting_token', { roomId, userName }),

  joinMeetingRoom: (roomId: number, userName: string) =>
    !isTauriRuntime()
      ? webRequest<MeetingParticipant[]>(`/v1/meetings/rooms/${roomId}/join`, { method: 'POST', body: JSON.stringify({ user_name: userName }) })
      : invoke<MeetingParticipant[]>('join_meeting_room', { roomId, userName }),

  leaveMeetingRoom: (roomId: number, userName: string) =>
    !isTauriRuntime()
      ? webRequest<MeetingParticipant[]>(`/v1/meetings/rooms/${roomId}/leave`, { method: 'POST', body: JSON.stringify({ user_name: userName }) })
      : invoke<MeetingParticipant[]>('leave_meeting_room', { roomId, userName }),

  listMeetingParticipants: (roomId: number) =>
    !isTauriRuntime()
      ? webRequest<MeetingParticipant[]>(`/v1/meetings/rooms/${roomId}/participants`)
      : invoke<MeetingParticipant[]>('list_meeting_participants', { roomId }),

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
    signalType: 'offer' | 'answer' | 'ice' | 'chat',
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
