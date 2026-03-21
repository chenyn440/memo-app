import { useEffect, useRef } from 'react';
import { useStore } from './store/useStore';
import { api } from './utils/api';
import { NoteItem } from './components/NoteItem';
import { NoteEditor, type NoteEditorHandle } from './components/NoteEditor';
import { SearchBar } from './components/SearchBar';
import { FolderList } from './components/FolderList';
import { ToastContainer, showToast } from './components/Toast';
import './App.css';

function getNotesView(folderId: number | null, query: string) {
  const hasQuery = query.trim().length > 0;
  if (folderId !== null && hasQuery) return 'folder-search' as const;
  if (folderId !== null) return 'folder' as const;
  if (hasQuery) return 'search' as const;
  return 'all' as const;
}

function noteMatchesQuery(title: string, content: string, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return title.toLowerCase().includes(normalized) || content.toLowerCase().includes(normalized);
}

function ThemeToggle() {
  const { theme, setTheme } = useStore();

  const cycleTheme = () => {
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(next);
  };

  return (
    <button
      className="theme-toggle"
      onClick={cycleTheme}
      title={`主题: ${theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统'}`}
    >
      {theme === 'light' && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      )}
      {theme === 'dark' && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
      {theme === 'system' && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
      )}
    </button>
  );
}

function App() {
  const { notes, setNotes, folders, selectedNote, setSelectedNote, selectedFolderId,
          setCurrentView, theme,
          folderPanelCollapsed, sidebarCollapsed,
          setFolderPanelCollapsed, setSidebarCollapsed, searchQuery } = useStore();
  const editorRef = useRef<NoteEditorHandle>(null);
  const previousFolderIdRef = useRef<number | null>(selectedFolderId);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    const folderChanged = previousFolderIdRef.current !== selectedFolderId;
    previousFolderIdRef.current = selectedFolderId;
    void refreshVisibleNotes(undefined, folderChanged);
  }, [selectedFolderId, searchQuery]);

  const refreshVisibleNotes = async (
    preferredSelectedId?: number | null,
    selectFirstOnFolderChange = false
  ) => {
    const nextView = getNotesView(selectedFolderId, searchQuery);
    setCurrentView(nextView);

    try {
      const trimmedQuery = searchQuery.trim();
      let data;

      if (selectedFolderId !== null && trimmedQuery) {
        const folderNotes = await api.getNotesByFolder(selectedFolderId);
        data = folderNotes.filter((note) => noteMatchesQuery(note.title, note.content, trimmedQuery));
      } else if (selectedFolderId !== null) {
        data = await api.getNotesByFolder(selectedFolderId);
      } else if (trimmedQuery) {
        data = await api.searchNotes(trimmedQuery);
      } else {
        data = await api.getNotes();
      }

      setNotes(data);
      setSelectedNote((prev) => {
        if (preferredSelectedId !== undefined) {
          return data.find((note) => note.id === preferredSelectedId) ?? null;
        }
        if (selectFirstOnFolderChange) {
          return data[0] ?? null;
        }
        if (!prev) return null;
        return data.find((note) => note.id === prev.id) ?? null;
      });
    } catch (error) {
      console.error('Failed to load notes:', error);
      showToast('加载笔记失败', 'error');
    }
  };

  const handleSearch = (query: string) => {
    setCurrentView(getNotesView(selectedFolderId, query));
  };

  const handleFilterByFolder = (folderId: number | null) => {
    setCurrentView(getNotesView(folderId, searchQuery));
  };

  const handleCreateNote = async () => {
    const saved = await editorRef.current?.flushSave();
    if (saved === false) return;

    try {
      const newNote = await api.createNote('新笔记', '', selectedFolderId ?? undefined);
      await refreshVisibleNotes(newNote.id);
    } catch (error) {
      console.error('Failed to create note:', error);
    }
  };

  const handleSaveNote = async (noteId: number, title: string, content: string, folderId: number | null) => {
    try {
      console.log('Saving note:', {
        id: noteId,
        title,
        contentLength: content.length,
        folderId
      });
      const updated = await api.updateNote(
        noteId,
        title,
        content,
        folderId ?? undefined
      );
      console.log('Note saved successfully:', updated);
      const remainsVisible =
        (selectedFolderId === null || updated.folder_id === selectedFolderId) &&
        noteMatchesQuery(updated.title, updated.content, searchQuery);
      await refreshVisibleNotes(remainsVisible ? updated.id : null);
      return updated;
    } catch (error) {
      console.error('Failed to save note - Full error:', error);
      console.error('Error type:', typeof error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      throw error;
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    const deletedIndex = notes.findIndex((note) => note.id === noteId);
    const nextNotes = notes.filter((note) => note.id !== noteId);
    const nextSelectedNote =
      deletedIndex === -1
        ? null
        : nextNotes[deletedIndex] ?? nextNotes[deletedIndex - 1] ?? null;

    await api.deleteNote(noteId);
    setNotes(nextNotes);
    setSelectedNote((prev) => (prev?.id === noteId ? nextSelectedNote : prev));
  };

  const handleSelectNote = async (note: typeof notes[number]) => {
    if (selectedNote?.id === note.id) return;
    const saved = await editorRef.current?.flushSave();
    if (saved === false) {
      showToast('当前笔记保存失败，已阻止切换', 'error');
      return;
    }
    setSelectedNote(note);
  };

  return (
    <>
      <ToastContainer />
      <div className="app-layout">
        <div className={`folder-panel${folderPanelCollapsed ? ' collapsed' : ''}`}>
          <FolderList onSelectFolder={handleFilterByFolder} />
        </div>
        <button
          className="panel-toggle-btn"
          onClick={() => setFolderPanelCollapsed(!folderPanelCollapsed)}
          title={folderPanelCollapsed ? '展开文件夹' : '折叠文件夹'}
        >
          {folderPanelCollapsed ? '›' : '‹'}
        </button>

        <div className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
          <div className="sidebar-header">
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'center' }}>
              <button onClick={handleCreateNote} className="btn-create-note" style={{ marginBottom: 0 }}>
                + 新建笔记
              </button>
              <ThemeToggle />
            </div>
            <SearchBar onSearch={handleSearch} />
          </div>
          <div className="note-list">
            {notes.map((note) => (
              <NoteItem
                key={note.id}
                note={note}
                isSelected={selectedNote?.id === note.id}
                onClick={() => void handleSelectNote(note)}
              />
            ))}
          </div>
        </div>
        <button
          className="panel-toggle-btn"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? '展开笔记列表' : '折叠笔记列表'}
        >
          {sidebarCollapsed ? '›' : '‹'}
        </button>

        <div style={{ flex: 1 }}>
          <NoteEditor
            ref={editorRef}
            note={selectedNote}
            folders={folders}
            onSave={handleSaveNote}
            onDelete={handleDeleteNote}
          />
        </div>
      </div>
    </>
  );
}

export default App;
