import { create } from 'zustand';
import { Note, Folder, Tag } from '../types';

type Theme = 'light' | 'dark' | 'system';
export type NotesView = 'all' | 'folder' | 'search' | 'folder-search';

interface AIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  embeddingModel: string;
}

interface AppState {
  notes: Note[];
  folders: Folder[];
  tags: Tag[];
  selectedNote: Note | null;
  selectedFolderId: number | null;
  currentView: NotesView;
  searchQuery: string;
  theme: Theme;
  folderPanelCollapsed: boolean;
  sidebarCollapsed: boolean;
  aiConfig: AIConfig;
  currentLanguage: string;
  setNotes: (notes: Note[] | ((prev: Note[]) => Note[])) => void;
  setFolders: (folders: Folder[] | ((prev: Folder[]) => Folder[])) => void;
  setTags: (tags: Tag[] | ((prev: Tag[]) => Tag[])) => void;
  setSelectedNote: (note: Note | null | ((prev: Note | null) => Note | null)) => void;
  setSelectedFolderId: (folderId: number | null) => void;
  setCurrentView: (view: NotesView) => void;
  setSearchQuery: (query: string) => void;
  setTheme: (theme: Theme) => void;
  setFolderPanelCollapsed: (v: boolean) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setAIConfig: (config: Partial<AIConfig>) => void;
  setCurrentLanguage: (lang: string) => void;
}

const getInitialTheme = (): Theme => {
  const saved = localStorage.getItem('memo-theme');
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  return 'system';
};

const getInitialAIConfig = (): AIConfig => {
  const defaults: AIConfig = {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    embeddingModel: '',
  };
  const saved = localStorage.getItem('memo-ai-config');
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as Partial<AIConfig>;
      return {
        ...defaults,
        ...parsed,
      };
    } catch (e) {
      console.error('Failed to parse AI config', e);
    }
  }
  return defaults;
};

export const useStore = create<AppState>((set) => ({
  notes: [],
  folders: [],
  tags: [],
  selectedNote: null,
  selectedFolderId: null,
  currentView: 'all',
  searchQuery: '',
  theme: getInitialTheme(),
  folderPanelCollapsed: false,
  sidebarCollapsed: false,
  aiConfig: getInitialAIConfig(),
  currentLanguage: 'Original',
  setNotes: (notes) => set((state) => ({
    notes: typeof notes === 'function' ? notes(state.notes) : notes,
  })),
  setFolders: (folders) => set((state) => ({
    folders: typeof folders === 'function' ? folders(state.folders) : folders,
  })),
  setTags: (tags) => set((state) => ({
    tags: typeof tags === 'function' ? tags(state.tags) : tags,
  })),
  setSelectedNote: (note) => set((state) => ({
    selectedNote: typeof note === 'function' ? note(state.selectedNote) : note,
  })),
  setSelectedFolderId: (folderId) => set({ selectedFolderId: folderId }),
  setCurrentView: (view) => set({ currentView: view }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setTheme: (theme) => {
    localStorage.setItem('memo-theme', theme);
    set({ theme });
  },
  setFolderPanelCollapsed: (v) => set({ folderPanelCollapsed: v }),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setAIConfig: (config) => set((state) => {
    const newConfig = { ...state.aiConfig, ...config };
    localStorage.setItem('memo-ai-config', JSON.stringify(newConfig));
    return { aiConfig: newConfig };
  }),
  setCurrentLanguage: (lang) => set({ currentLanguage: lang }),
}));
