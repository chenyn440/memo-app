import { create } from 'zustand';
import { Note, Folder, Tag } from '../types';

type Theme = 'light' | 'dark' | 'system';
export type NotesView = 'all' | 'folder' | 'search' | 'folder-search';

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
}

const getInitialTheme = (): Theme => {
  const saved = localStorage.getItem('memo-theme');
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  return 'system';
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
}));
