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

const WEB_LOCAL_AUTH_KEY = 'web_local_auth_v1';
const WEB_LOCAL_ACTIVE_ACCOUNT_KEY = 'web_local_active_account_v1';
const WEB_LOCAL_DATA_PREFIX = 'web_local_data_v1';

interface WebLocalAuthUser {
  account: string;
  password: string;
}

interface WebLocalAuthState {
  users: WebLocalAuthUser[];
}

interface WebLocalDataState {
  notes: Note[];
  folders: Folder[];
  tags: Tag[];
  noteTags: Array<{ note_id: number; tag_id: number }>;
  plans: Plan[];
  planItems: PlanItem[];
  meetingRooms: MeetingRoom[];
  meetingParticipants: MeetingParticipant[];
  counters: {
    note: number;
    folder: number;
    tag: number;
    plan: number;
    planItem: number;
    meetingRoom: number;
    meetingParticipant: number;
  };
}

const nowIso = () => new Date().toISOString();

const safeParseJson = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const loadWebLocalAuth = (): WebLocalAuthState => {
  if (typeof window === 'undefined') return { users: [] };
  return safeParseJson<WebLocalAuthState>(window.localStorage.getItem(WEB_LOCAL_AUTH_KEY), { users: [] });
};

const saveWebLocalAuth = (state: WebLocalAuthState) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(WEB_LOCAL_AUTH_KEY, JSON.stringify(state));
};

const makeLocalToken = (account: string): string => `local_${account}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const localRegisterWithPassword = (account: string, password: string): { access_token: string; refresh_token?: string } => {
  const normalizedAccount = account.trim();
  const normalizedPassword = password.trim();
  if (!normalizedAccount || !normalizedPassword) {
    throw new Error('account and password are required');
  }
  const state = loadWebLocalAuth();
  const existed = state.users.find((item) => item.account === normalizedAccount);
  if (existed) {
    throw new Error('account already exists');
  }
  state.users.push({ account: normalizedAccount, password: normalizedPassword });
  saveWebLocalAuth(state);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(WEB_LOCAL_ACTIVE_ACCOUNT_KEY, normalizedAccount);
  }
  return { access_token: makeLocalToken(normalizedAccount) };
};

const localLoginWithPassword = (account: string, password: string): { access_token: string; refresh_token?: string } => {
  const normalizedAccount = account.trim();
  const normalizedPassword = password.trim();
  if (!normalizedAccount || !normalizedPassword) {
    throw new Error('account and password are required');
  }
  const state = loadWebLocalAuth();
  const matched = state.users.find((item) => item.account === normalizedAccount && item.password === normalizedPassword);
  if (!matched) {
    throw new Error('invalid account or password');
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(WEB_LOCAL_ACTIVE_ACCOUNT_KEY, normalizedAccount);
  }
  return { access_token: makeLocalToken(normalizedAccount) };
};

const getWebLocalDataKey = (): string => {
  if (typeof window === 'undefined') return `${WEB_LOCAL_DATA_PREFIX}_default`;
  const account = (window.localStorage.getItem(WEB_LOCAL_ACTIVE_ACCOUNT_KEY) || '').trim();
  const scope = account || getWebAuthToken().trim() || 'anonymous';
  const normalized = scope.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return `${WEB_LOCAL_DATA_PREFIX}_${normalized || 'anonymous'}`;
};

const emptyWebLocalData = (): WebLocalDataState => ({
  notes: [],
  folders: [],
  tags: [],
  noteTags: [],
  plans: [],
  planItems: [],
  meetingRooms: [],
  meetingParticipants: [],
  counters: {
    note: 0,
    folder: 0,
    tag: 0,
    plan: 0,
    planItem: 0,
    meetingRoom: 0,
    meetingParticipant: 0,
  },
});

const loadWebLocalData = (): WebLocalDataState => {
  if (typeof window === 'undefined') return emptyWebLocalData();
  return safeParseJson<WebLocalDataState>(window.localStorage.getItem(getWebLocalDataKey()), emptyWebLocalData());
};

const saveWebLocalData = (data: WebLocalDataState) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getWebLocalDataKey(), JSON.stringify(data));
};

const nextLocalId = (data: WebLocalDataState, key: keyof WebLocalDataState['counters']): number => {
  data.counters[key] += 1;
  return data.counters[key];
};

const statusRank = (status: string): number => {
  if (status === 'todo') return 0;
  if (status === 'in_progress') return 1;
  if (status === 'done') return 2;
  return 3;
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
  registerWithPassword: async (account: string, password: string) => {
    if (isTauriRuntime()) {
      return localRegisterWithPassword(account, password);
    }
    try {
      return await webRequest<{ access_token: string; refresh_token?: string }>('/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ account, password }),
      });
    } catch {
      return localRegisterWithPassword(account, password);
    }
  },
  loginWithPassword: async (account: string, password: string) => {
    if (isTauriRuntime()) {
      return localLoginWithPassword(account, password);
    }
    try {
      return await webRequest<{ access_token: string; refresh_token?: string }>('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ account, password }),
      });
    } catch {
      return localLoginWithPassword(account, password);
    }
  },
  logoutWeb: () => {
    setWebAuthToken('');
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(WEB_LOCAL_ACTIVE_ACCOUNT_KEY);
    }
  },

  getMeetingSignalServerUrl: () => getSignalServerUrl(),
  setMeetingSignalServerUrl: (url: string) => setSignalServerUrl(url),

  getNotes: () => {
    if (!isTauriRuntime()) {
      const data = loadWebLocalData();
      const notes = [...data.notes].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
      return Promise.resolve(notes);
    }
    return invoke<Note[]>('get_notes');
  },

  createNote: (title: string, content: string, folderId?: number) =>
    !isTauriRuntime()
      ? (() => {
        const data = loadWebLocalData();
        const now = nowIso();
        const note: Note = {
          id: nextLocalId(data, 'note'),
          title,
          content,
          folder_id: folderId ?? null,
          created_at: now,
          updated_at: now,
          summary_history: '',
          translations: '',
        };
        data.notes.push(note);
        saveWebLocalData(data);
        return Promise.resolve(note);
      })()
      : invoke<Note>('create_note', {
        input: { title, content, folder_id: folderId },
      }),

  updateNote: (id: number, title: string, content: string, folderId?: number, summaryHistory?: string, translations?: string) =>
    !isTauriRuntime()
      ? (() => {
        const data = loadWebLocalData();
        const idx = data.notes.findIndex((item) => item.id === id);
        if (idx < 0) return Promise.reject(new Error('note not found'));
        const updated: Note = {
          ...data.notes[idx],
          title,
          content,
          folder_id: folderId ?? null,
          summary_history: summaryHistory,
          translations,
          updated_at: nowIso(),
        };
        data.notes[idx] = updated;
        saveWebLocalData(data);
        return Promise.resolve(updated);
      })()
      : invoke<Note>('update_note', {
        input: { id, title, content, folder_id: folderId, summary_history: summaryHistory, translations },
      }),

  deleteNote: (id: number) => {
    if (!isTauriRuntime()) {
      const data = loadWebLocalData();
      data.notes = data.notes.filter((item) => item.id !== id);
      data.noteTags = data.noteTags.filter((item) => item.note_id !== id);
      saveWebLocalData(data);
      return Promise.resolve();
    }
    return invoke('delete_note', { id });
  },

  searchNotes: (query: string) => {
    if (!isTauriRuntime()) {
      const data = loadWebLocalData();
      const keyword = query.trim().toLowerCase();
      const notes = !keyword
        ? [...data.notes]
        : data.notes.filter((item) =>
          item.title.toLowerCase().includes(keyword) || item.content.toLowerCase().includes(keyword));
      return Promise.resolve(notes.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)));
    }
    return invoke<Note[]>('search_notes', { query });
  },

  getFolders: () => {
    if (!isTauriRuntime()) {
      const data = loadWebLocalData();
      return Promise.resolve([...data.folders].sort((a, b) => a.sort_order - b.sort_order));
    }
    return invoke<Folder[]>('get_folders');
  },

  createFolder: (name: string, color: string) =>
    !isTauriRuntime()
      ? (() => {
        const data = loadWebLocalData();
        const folder: Folder = {
          id: nextLocalId(data, 'folder'),
          name,
          color,
          sort_order: data.folders.length,
        };
        data.folders.push(folder);
        saveWebLocalData(data);
        return Promise.resolve(folder);
      })()
      : invoke<Folder>('create_folder', { name, color }),

  deleteFolder: (id: number) => {
    if (!isTauriRuntime()) {
      const data = loadWebLocalData();
      data.folders = data.folders.filter((item) => item.id !== id);
      data.notes = data.notes.map((note) => note.folder_id === id ? { ...note, folder_id: null, updated_at: nowIso() } : note);
      saveWebLocalData(data);
      return Promise.resolve();
    }
    return invoke('delete_folder', { id });
  },

  renameFolder: (id: number, name: string) =>
    !isTauriRuntime()
      ? (() => {
        const data = loadWebLocalData();
        const idx = data.folders.findIndex((item) => item.id === id);
        if (idx < 0) return Promise.reject(new Error('folder not found'));
        const folder = { ...data.folders[idx], name };
        data.folders[idx] = folder;
        saveWebLocalData(data);
        return Promise.resolve(folder);
      })()
      : invoke<Folder>('rename_folder', { id, name }),

  reorderFolders: (folderIds: number[]) =>
    !isTauriRuntime()
      ? (() => {
        const data = loadWebLocalData();
        const orderMap = new Map<number, number>();
        folderIds.forEach((id, index) => orderMap.set(id, index));
        data.folders = data.folders
          .map((folder, idx) => ({ ...folder, sort_order: orderMap.get(folder.id) ?? (folderIds.length + idx) }))
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((folder, idx) => ({ ...folder, sort_order: idx }));
        saveWebLocalData(data);
        return Promise.resolve();
      })()
      : invoke('reorder_folders', { folderIds }),

  getNotesByFolder: (folderId: number) =>
    !isTauriRuntime()
      ? (() => {
        const data = loadWebLocalData();
        return Promise.resolve(data.notes.filter((item) => item.folder_id === folderId));
      })()
      : invoke<Note[]>('get_notes_by_folder', { folderId }),

  getTags: () => {
    if (!isTauriRuntime()) {
      const data = loadWebLocalData();
      return Promise.resolve([...data.tags]);
    }
    return invoke<Tag[]>('get_tags');
  },

  createTag: (name: string) => !isTauriRuntime()
    ? (() => {
      const data = loadWebLocalData();
      const existed = data.tags.find((item) => item.name === name);
      if (existed) return Promise.resolve(existed);
      const tag: Tag = { id: nextLocalId(data, 'tag'), name };
      data.tags.push(tag);
      saveWebLocalData(data);
      return Promise.resolve(tag);
    })()
    : invoke<Tag>('create_tag', { name }),

  deleteTag: (id: number) => !isTauriRuntime()
    ? (() => {
      const data = loadWebLocalData();
      data.tags = data.tags.filter((item) => item.id !== id);
      data.noteTags = data.noteTags.filter((item) => item.tag_id !== id);
      saveWebLocalData(data);
      return Promise.resolve();
    })()
    : invoke('delete_tag', { id }),

  getNoteTags: (noteId: number) => !isTauriRuntime()
    ? (() => {
      const data = loadWebLocalData();
      const tagIds = new Set(data.noteTags.filter((item) => item.note_id === noteId).map((item) => item.tag_id));
      return Promise.resolve(data.tags.filter((tag) => tagIds.has(tag.id)));
    })()
    : invoke<Tag[]>('get_note_tags', { noteId }),

  addTagToNote: (noteId: number, tagId: number) =>
    !isTauriRuntime()
      ? (() => {
        const data = loadWebLocalData();
        const existed = data.noteTags.some((item) => item.note_id === noteId && item.tag_id === tagId);
        if (!existed) data.noteTags.push({ note_id: noteId, tag_id: tagId });
        saveWebLocalData(data);
        return Promise.resolve();
      })()
      : invoke('add_tag_to_note', { noteId, tagId }),

  removeTagFromNote: (noteId: number, tagId: number) =>
    !isTauriRuntime()
      ? (() => {
        const data = loadWebLocalData();
        data.noteTags = data.noteTags.filter((item) => !(item.note_id === noteId && item.tag_id === tagId));
        saveWebLocalData(data);
        return Promise.resolve();
      })()
      : invoke('remove_tag_from_note', { noteId, tagId }),

  getNotesByTag: (tagId: number) => !isTauriRuntime()
    ? (() => {
      const data = loadWebLocalData();
      const noteIds = new Set(data.noteTags.filter((item) => item.tag_id === tagId).map((item) => item.note_id));
      return Promise.resolve(data.notes.filter((note) => noteIds.has(note.id)));
    })()
    : invoke<Note[]>('get_notes_by_tag', { tagId }),

  exportNote: (noteId: number, format: 'md' | 'txt' | 'json', outputPath: string) =>
    invoke('export_note', { noteId, format, outputPath }),

  saveImage: (base64Data: string) => invoke<string>('save_image', { base64Data }),

  loadImage: (path: string) => invoke<string>('load_image', { path }),

  startSpeech: () => invoke('start_speech'),

  stopSpeech: () => invoke('stop_speech'),

  getPlans: () => !isTauriRuntime()
    ? (() => {
      const data = loadWebLocalData();
      return Promise.resolve([...data.plans].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)));
    })()
    : invoke<Plan[]>('get_plans'),

  createPlan: (input: CreatePlanInput) => !isTauriRuntime()
    ? (() => {
      const data = loadWebLocalData();
      const now = nowIso();
      const plan: Plan = {
        id: nextLocalId(data, 'plan'),
        name: input.name,
        plan_type: input.plan_type,
        created_at: now,
        updated_at: now,
      };
      data.plans.push(plan);
      saveWebLocalData(data);
      return Promise.resolve(plan);
    })()
    : invoke<Plan>('create_plan', { input }),

  updatePlan: (input: UpdatePlanInput) => !isTauriRuntime()
    ? (() => {
      const data = loadWebLocalData();
      const idx = data.plans.findIndex((item) => item.id === input.id);
      if (idx < 0) return Promise.reject(new Error('plan not found'));
      const updated: Plan = { ...data.plans[idx], name: input.name, plan_type: input.plan_type, updated_at: nowIso() };
      data.plans[idx] = updated;
      saveWebLocalData(data);
      return Promise.resolve(updated);
    })()
    : invoke<Plan>('update_plan', { input }),

  deletePlan: (id: number) => !isTauriRuntime()
    ? (() => {
      const data = loadWebLocalData();
      data.plans = data.plans.filter((item) => item.id !== id);
      data.planItems = data.planItems.filter((item) => item.plan_id !== id);
      saveWebLocalData(data);
      return Promise.resolve();
    })()
    : invoke('delete_plan', { id }),

  getPlanItems: (planId: number) => !isTauriRuntime()
    ? (() => {
      const data = loadWebLocalData();
      const items = data.planItems
        .filter((item) => item.plan_id === planId)
        .sort((a, b) => {
          const rankDiff = statusRank(a.status) - statusRank(b.status);
          if (rankDiff !== 0) return rankDiff;
          const dueA = a.due_at ? Date.parse(a.due_at) : Number.MAX_SAFE_INTEGER;
          const dueB = b.due_at ? Date.parse(b.due_at) : Number.MAX_SAFE_INTEGER;
          if (dueA !== dueB) return dueA - dueB;
          return Date.parse(b.updated_at) - Date.parse(a.updated_at);
        });
      return Promise.resolve(items);
    })()
    : invoke<PlanItem[]>('get_plan_items', { planId }),

  getPlanItemsByDateRange: (start: string, end: string) =>
    !isTauriRuntime()
      ? (() => {
        const data = loadWebLocalData();
        const startMs = Date.parse(start);
        const endMs = Date.parse(end);
        const items = data.planItems
          .filter((item) => {
            const startAt = item.start_at ? Date.parse(item.start_at) : NaN;
            const dueAt = item.due_at ? Date.parse(item.due_at) : NaN;
            return (Number.isFinite(startAt) && startAt >= startMs && startAt <= endMs)
              || (Number.isFinite(dueAt) && dueAt >= startMs && dueAt <= endMs);
          })
          .sort((a, b) => {
            const ta = Date.parse(a.start_at || a.due_at || a.created_at);
            const tb = Date.parse(b.start_at || b.due_at || b.created_at);
            return ta - tb;
          });
        return Promise.resolve(items);
      })()
      : invoke<PlanItem[]>('get_plan_items_by_date_range', { start, end }),

  createPlanItem: (input: CreatePlanItemInput) => !isTauriRuntime()
    ? (() => {
      const data = loadWebLocalData();
      const now = nowIso();
      const item: PlanItem = {
        id: nextLocalId(data, 'planItem'),
        plan_id: input.plan_id,
        title: input.title,
        item_type: input.item_type,
        status: input.status,
        priority: input.priority,
        owner: input.owner ?? null,
        start_at: input.start_at ?? null,
        due_at: input.due_at ?? null,
        notes: input.notes ?? null,
        linked_note_id: input.linked_note_id ?? null,
        meeting_platform: input.meeting_platform ?? null,
        meeting_url: input.meeting_url ?? null,
        meeting_id: input.meeting_id ?? null,
        meeting_password: input.meeting_password ?? null,
        meeting_attendees: input.meeting_attendees ?? null,
        meeting_recording_url: input.meeting_recording_url ?? null,
        created_at: now,
        updated_at: now,
      };
      data.planItems.push(item);
      saveWebLocalData(data);
      return Promise.resolve(item);
    })()
    : invoke<PlanItem>('create_plan_item', { input }),

  updatePlanItem: (input: UpdatePlanItemInput) => !isTauriRuntime()
    ? (() => {
      const data = loadWebLocalData();
      const idx = data.planItems.findIndex((item) => item.id === input.id);
      if (idx < 0) return Promise.reject(new Error('plan item not found'));
      const prev = data.planItems[idx];
      const updated: PlanItem = {
        ...prev,
        title: input.title,
        item_type: input.item_type,
        status: input.status,
        priority: input.priority,
        owner: input.owner ?? null,
        start_at: input.start_at ?? null,
        due_at: input.due_at ?? null,
        notes: input.notes ?? null,
        linked_note_id: input.linked_note_id ?? null,
        meeting_platform: input.meeting_platform ?? null,
        meeting_url: input.meeting_url ?? null,
        meeting_id: input.meeting_id ?? null,
        meeting_password: input.meeting_password ?? null,
        meeting_attendees: input.meeting_attendees ?? null,
        meeting_recording_url: input.meeting_recording_url ?? null,
        updated_at: nowIso(),
      };
      data.planItems[idx] = updated;
      saveWebLocalData(data);
      return Promise.resolve(updated);
    })()
    : invoke<PlanItem>('update_plan_item', { input }),

  deletePlanItem: (id: number) => !isTauriRuntime()
    ? (() => {
      const data = loadWebLocalData();
      data.planItems = data.planItems.filter((item) => item.id !== id);
      saveWebLocalData(data);
      return Promise.resolve();
    })()
    : invoke('delete_plan_item', { id }),

  getOrCreateMeetingRoom: (planItemId: number, roomName: string) =>
    !isTauriRuntime()
      ? (() => {
        const data = loadWebLocalData();
        const existed = data.meetingRooms.find((item) => item.plan_item_id === planItemId);
        if (existed) return Promise.resolve(existed);
        const now = nowIso();
        const room: MeetingRoom = {
          id: nextLocalId(data, 'meetingRoom'),
          plan_item_id: planItemId,
          room_code: `room-${planItemId}-${Math.floor(Date.now() / 1000)}`,
          room_name: roomName,
          state: 'idle',
          started_at: null,
          ended_at: null,
          created_at: now,
          updated_at: now,
        };
        data.meetingRooms.push(room);
        saveWebLocalData(data);
        return Promise.resolve(room);
      })()
      : invoke<MeetingRoom>('get_or_create_meeting_room', { planItemId, roomName }),

  getMeetingRoom: (roomId: number) => !isTauriRuntime()
    ? (() => {
      const data = loadWebLocalData();
      const room = data.meetingRooms.find((item) => item.id === roomId);
      if (!room) return Promise.reject(new Error('meeting room not found'));
      return Promise.resolve(room);
    })()
    : invoke<MeetingRoom>('get_meeting_room', { roomId }),

  startMeetingRoom: (roomId: number) => !isTauriRuntime()
    ? (() => {
      const data = loadWebLocalData();
      const idx = data.meetingRooms.findIndex((item) => item.id === roomId);
      if (idx < 0) return Promise.reject(new Error('meeting room not found'));
      const now = nowIso();
      const updated: MeetingRoom = { ...data.meetingRooms[idx], state: 'in_progress', started_at: now, updated_at: now };
      data.meetingRooms[idx] = updated;
      saveWebLocalData(data);
      return Promise.resolve(updated);
    })()
    : invoke<MeetingRoom>('start_meeting_room', { roomId }),

  endMeetingRoom: (roomId: number) => !isTauriRuntime()
    ? (() => {
      const data = loadWebLocalData();
      const idx = data.meetingRooms.findIndex((item) => item.id === roomId);
      if (idx < 0) return Promise.reject(new Error('meeting room not found'));
      const now = nowIso();
      const updated: MeetingRoom = { ...data.meetingRooms[idx], state: 'ended', ended_at: now, updated_at: now };
      data.meetingRooms[idx] = updated;
      saveWebLocalData(data);
      return Promise.resolve(updated);
    })()
    : invoke<MeetingRoom>('end_meeting_room', { roomId }),

  issueMeetingToken: (roomId: number, userName: string) =>
    !isTauriRuntime()
      ? Promise.resolve(`local_meeting_${roomId}_${userName}_${Date.now().toString(36)}`)
      : invoke<string>('issue_meeting_token', { roomId, userName }),

  joinMeetingRoom: (roomId: number, userName: string) =>
    !isTauriRuntime()
      ? (() => {
        const data = loadWebLocalData();
        const idx = data.meetingParticipants.findIndex((item) => item.room_id === roomId && item.user_name === userName);
        const now = nowIso();
        if (idx >= 0) {
          data.meetingParticipants[idx] = { ...data.meetingParticipants[idx], is_online: true, left_at: null };
        } else {
          data.meetingParticipants.push({
            id: nextLocalId(data, 'meetingParticipant'),
            room_id: roomId,
            user_name: userName,
            is_online: true,
            joined_at: now,
            left_at: null,
          });
        }
        saveWebLocalData(data);
        return Promise.resolve(data.meetingParticipants.filter((item) => item.room_id === roomId));
      })()
      : invoke<MeetingParticipant[]>('join_meeting_room', { roomId, userName }),

  leaveMeetingRoom: (roomId: number, userName: string) =>
    !isTauriRuntime()
      ? (() => {
        const data = loadWebLocalData();
        const now = nowIso();
        data.meetingParticipants = data.meetingParticipants.map((item) =>
          item.room_id === roomId && item.user_name === userName
            ? { ...item, is_online: false, left_at: now }
            : item
        );
        saveWebLocalData(data);
        return Promise.resolve(data.meetingParticipants.filter((item) => item.room_id === roomId));
      })()
      : invoke<MeetingParticipant[]>('leave_meeting_room', { roomId, userName }),

  listMeetingParticipants: (roomId: number) =>
    !isTauriRuntime()
      ? (() => {
        const data = loadWebLocalData();
        return Promise.resolve(data.meetingParticipants.filter((item) => item.room_id === roomId));
      })()
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
