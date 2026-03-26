import { useEffect, useRef, useState } from 'react';
import { useStore } from './store/useStore';
import { api } from './utils/api';
import { NoteItem } from './components/NoteItem';
import { NoteEditor, type NoteEditorHandle } from './components/NoteEditor';
import { SearchBar } from './components/SearchBar';
import { FolderList } from './components/FolderList';
import { PlannerPanel } from './components/PlannerPanel';
import { MeetingRoomPanel } from './components/MeetingRoomPanel';
import { ToastContainer, showToast } from './components/Toast';
import type { MeetingRoom, Plan, PlanItem } from './types';
import './App.css';

const PLAN_TYPE_LABELS: Record<Plan['plan_type'], string> = {
  project: '项目',
  event: '事件',
  meeting: '会议',
};

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
  const [appMode, setAppMode] = useState<'notes' | 'plans'>('notes');
  const [plannerPlans, setPlannerPlans] = useState<Plan[]>([]);
  const [plannerSelectedPlanId, setPlannerSelectedPlanId] = useState<number | null>(null);
  const [activeMeeting, setActiveMeeting] = useState<{ item: PlanItem; room: MeetingRoom; token: string } | null>(null);
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

  const handleSaveNote = async (noteId: number, title: string, content: string, folderId: number | null, summaryHistory?: string, translations?: string) => {
    try {
      console.log('Saving note:', {
        id: noteId,
        title,
        contentLength: content.length,
        folderId,
        hasSummaryHistory: !!summaryHistory,
        hasTranslations: !!translations
      });
      const updated = await api.updateNote(
        noteId, title, content, folderId ?? undefined, summaryHistory, translations
      );

      // 1. Directly update the notes array in the store with the fresh data
      setNotes(prevNotes => {
        const index = prevNotes.findIndex(n => n.id === updated.id);
        if (index !== -1) {
          const newNotes = [...prevNotes];
          newNotes[index] = updated;
          // Re-sort to reflect updated_at changes
          return newNotes.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        }
        return prevNotes; // Should not happen for an update to an existing note
      });

      // 2. Update the selected note in store with the fresh data from DB
      // This is crucial to propagate the latest translations back to NoteEditor immediately
      setSelectedNote(updated); 

      // 3. Only trigger a full list refresh if the note's visibility or folder status changed
      const remainsVisible =
        (selectedFolderId === null || updated.folder_id === selectedFolderId) &&
        noteMatchesQuery(updated.title, updated.content, searchQuery);

      if (!remainsVisible) {
        // If the note is no longer visible in the current view, we might need a full refresh
        // e.g., if it moved out of the current folder filter
        await refreshVisibleNotes(undefined);
      }
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

  const handleDeletePlanFromSidebar = async (planId: number) => {
    try {
      await api.deletePlan(planId);
      const plans = await api.getPlans();
      setPlannerPlans(plans);
      if (plannerSelectedPlanId === planId) {
        setPlannerSelectedPlanId(plans[0]?.id ?? null);
      }
      showToast('已删除计划', 'success');
    } catch (error) {
      console.error('Failed to delete plan from sidebar:', error);
      showToast('删除计划失败', 'error');
    }
  };

  const handleEndMeeting = async () => {
    if (!activeMeeting) return;
    const meeting = activeMeeting;
    setActiveMeeting(null);
    try {
      await api.endMeetingRoom(meeting.room.id);
      showToast('会议已结束', 'success');
    } catch (error) {
      console.error('Failed to end meeting:', error);
      showToast('结束会议失败', 'error');
    }
  };

  const inMeeting = appMode === 'plans' && !!activeMeeting;

  return (
    <>
      <ToastContainer />
      <div className="app-layout">
        {!inMeeting && (
          <>
            <div className={`folder-panel${folderPanelCollapsed || appMode === 'plans' ? ' collapsed' : ''}`}>
              <FolderList onSelectFolder={handleFilterByFolder} />
            </div>
            <button
              className="panel-toggle-btn"
              onClick={() => setFolderPanelCollapsed(!folderPanelCollapsed)}
              title={folderPanelCollapsed || appMode === 'plans' ? '展开文件夹' : '折叠文件夹'}
              disabled={appMode === 'plans'}
            >
              {folderPanelCollapsed || appMode === 'plans' ? '›' : '‹'}
            </button>
          </>
        )}

        {!inMeeting && (
          <>
            <div className={`sidebar${appMode === 'notes' ? (sidebarCollapsed ? ' collapsed' : '') : ''}`}>
            <div className="sidebar-header">
              <div className="mode-tabs">
                <button
                  className="mode-tab-btn"
                  data-active={appMode === 'notes'}
                  onClick={() => setAppMode('notes')}
                >
                  笔记
                </button>
                <button
                  className="mode-tab-btn"
                  data-active={appMode === 'plans'}
                  onClick={() => setAppMode('plans')}
                >
                  计划
                </button>
              </div>
              {appMode === 'notes' ? (
                <>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'center' }}>
                    <button onClick={handleCreateNote} className="btn-create-note" style={{ marginBottom: 0 }}>
                      + 新建笔记
                    </button>
                    <ThemeToggle />
                  </div>
                  <SearchBar onSearch={handleSearch} />
                </>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px', alignItems: 'center' }}>
                  <ThemeToggle />
                </div>
              )}
            </div>
            {appMode === 'notes' ? (
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
            ) : (
              <div className="note-list">
                {plannerPlans.map((plan) => (
                  <div key={plan.id} className="planner-sidebar-item">
                    <button
                      className="planner-sidebar-btn"
                      onClick={() => setPlannerSelectedPlanId(plan.id)}
                      data-active={plannerSelectedPlanId === plan.id}
                    >
                    <div style={{ fontWeight: 600 }}>{plan.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{PLAN_TYPE_LABELS[plan.plan_type] ?? plan.plan_type}</div>
                    </button>
                    <button
                      className="planner-sidebar-delete-btn"
                      onClick={() => void handleDeletePlanFromSidebar(plan.id)}
                      title="删除计划"
                      aria-label="删除计划"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M4 7H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M9 7V5C9 4.44772 9.44772 4 10 4H14C14.5523 4 15 4.44772 15 5V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M18 7L17.3 18.2C17.2368 19.2109 16.3985 20 15.3857 20H8.61426C7.60146 20 6.76317 19.2109 6.69998 18.2L6 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M10 11V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M14 11V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            </div>
            <button
              className="panel-toggle-btn"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={appMode === 'plans' ? '计划模式下固定显示菜单' : (sidebarCollapsed ? '展开笔记列表' : '折叠笔记列表')}
              disabled={appMode === 'plans'}
            >
              {appMode === 'plans' ? '‹' : (sidebarCollapsed ? '›' : '‹')}
            </button>
          </>
        )}

        <div style={{ flex: 1 }}>
          {appMode === 'notes' ? (
            <NoteEditor
              ref={editorRef}
              note={selectedNote}
              folders={folders}
              onSave={handleSaveNote}
              onDelete={handleDeleteNote}
            />
          ) : (
            activeMeeting ? (
              <MeetingRoomPanel
                room={activeMeeting.room}
                token={activeMeeting.token}
                onBack={() => void handleEndMeeting()}
                onEnd={() => void handleEndMeeting()}
              />
            ) : (
              <PlannerPanel
                notes={notes}
                onSwitchToNotes={() => setAppMode('notes')}
                onStartMeeting={(ctx) => setActiveMeeting(ctx)}
                hidePlanSidebar
                selectedPlanId={plannerSelectedPlanId}
                onSelectedPlanIdChange={setPlannerSelectedPlanId}
                onPlansLoaded={setPlannerPlans}
                onOpenNote={(noteId) => {
                  const target = notes.find((n) => n.id === noteId);
                  if (!target) return;
                  setSelectedNote(target);
                  setAppMode('notes');
                }}
              />
            )
          )}
        </div>
      </div>
    </>
  );
}

export default App;
