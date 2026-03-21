import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/plugin-dialog';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { Folder, Note } from '../types';
import { api } from '../utils/api';
import { showToast } from './Toast';

interface NoteEditorProps {
  note: Note | null;
  folders: Folder[];
  onSave: (noteId: number, title: string, content: string, folderId: number | null) => Promise<Note>;
  onDelete: (noteId: number) => Promise<void>;
}

export interface NoteEditorHandle {
  flushSave: () => Promise<boolean>;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type ExportFormat = 'md' | 'txt' | 'json';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
turndownService.use(gfm);

function markdownToHtml(markdown: string): string {
  try {
    const html = marked.parse(markdown || '') as string;
    return html || '<p></p>';
  } catch {
    return `<p>${markdown || ''}</p>`;
  }
}

function htmlToMarkdown(html: string): string {
  const markdown = turndownService.turndown(html || '');
  return markdown.trimEnd();
}

function formatUpdatedAt(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

function isMacOS(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const platform = window.navigator.platform;
  return /Mac|Macintosh|Mac OS X/i.test(ua) || /Mac/i.test(platform);
}

function getFolderOptions(folders: Folder[]) {
  return [
    { id: null, name: '未分类', color: null as string | null },
    ...folders.map((folder) => ({ id: folder.id, name: folder.name, color: folder.color })),
  ];
}

export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { note, folders, onSave, onDelete },
  ref
) {
  const [title, setTitle] = useState(note?.title || '');
  const [markdownContent, setMarkdownContent] = useState(note?.content || '');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const saveTimeoutRef = useRef<number | null>(null);
  const savedTimeoutRef = useRef<number | null>(null);
  const folderOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const formatMenuRef = useRef<HTMLDivElement>(null);
  const lastSavedRef = useRef<{ title: string; content: string }>({ title: '', content: '' });
  const lastFinalTextRef = useRef('');
  const applyingRemoteContentRef = useRef(false);
  const speechSupported = isMacOS();
  const currentFolder = folders.find((folder) => folder.id === note?.folder_id) ?? null;
  const folderOptions = useMemo(() => getFolderOptions(folders), [folders]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
      }),
      Table.configure({
        resizable: false,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: markdownToHtml(note?.content || ''),
    onUpdate: ({ editor: nextEditor }) => {
      if (applyingRemoteContentRef.current) return;
      setMarkdownContent(htmlToMarkdown(nextEditor.getHTML()));
    },
    editorProps: {
      attributes: {
        class: 'editor-prosemirror',
      },
    },
  });

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    listen<string>('speech-partial', (event) => {
      setInterimText(event.payload);
    }).then((unlisten) => unlisteners.push(unlisten));

    listen<string>('speech-final', (event) => {
      const newText = event.payload;
      const prev = lastFinalTextRef.current;
      const delta = newText.startsWith(prev) ? newText.slice(prev.length) : newText;
      lastFinalTextRef.current = newText;
      if (delta && editor) {
        editor.chain().focus().insertContent(delta).run();
      }
      setInterimText('');
    }).then((unlisten) => unlisteners.push(unlisten));

    listen('speech-stopped', () => {
      setIsListening(false);
      setInterimText('');
      lastFinalTextRef.current = '';
    }).then((unlisten) => unlisteners.push(unlisten));

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [editor]);

  const toggleSpeech = useCallback(async () => {
    if (!speechSupported) {
      showToast('语音输入仅支持 macOS', 'info');
      return;
    }

    if (isListening) {
      try {
        await api.stopSpeech();
      } catch (e) {
        console.error('Failed to stop speech:', e);
      }
      setIsListening(false);
      setInterimText('');
      return;
    }

    try {
      lastFinalTextRef.current = '';
      await api.startSpeech();
      setIsListening(true);
    } catch (e: any) {
      console.error('Failed to start speech:', e);
      showToast('语音识别启动失败: ' + (e?.message || e), 'error');
    }
  }, [isListening, speechSupported]);

  useEffect(() => {
    setTitle(note?.title || '');
    setMarkdownContent(note?.content || '');
    setSaveStatus('idle');
    setFolderMenuOpen(false);
    setExportMenuOpen(false);
    setFormatMenuOpen(false);
    lastSavedRef.current = { title: note?.title || '', content: note?.content || '' };
    if (editor) {
      applyingRemoteContentRef.current = true;
      editor.commands.setContent(markdownToHtml(note?.content || ''), { emitUpdate: false });
      window.setTimeout(() => {
        applyingRemoteContentRef.current = false;
      }, 0);
    }
  }, [note?.id, editor]);

  useEffect(() => {
    if (!folderMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!folderMenuRef.current?.contains(event.target as Node)) {
        setFolderMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [folderMenuOpen]);

  useEffect(() => {
    if (!exportMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExportMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!formatMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!formatMenuRef.current?.contains(event.target as Node)) {
        setFormatMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFormatMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [formatMenuOpen]);

  useEffect(() => {
    if (!folderMenuOpen) return;
    const selectedIndex = folderOptions.findIndex((option) => option.id === (note?.folder_id ?? null));
    const targetIndex = selectedIndex >= 0 ? selectedIndex : 0;
    window.setTimeout(() => {
      folderOptionRefs.current[targetIndex]?.focus();
    }, 0);
  }, [folderMenuOpen, folderOptions, note?.folder_id]);

  const performSave = useCallback(async (
    nextTitle: string,
    nextContent: string,
    nextFolderId: number | null = note?.folder_id ?? null
  ) => {
    if (!note) return true;
    if (
      nextTitle === lastSavedRef.current.title &&
      nextContent === lastSavedRef.current.content &&
      nextFolderId === (note.folder_id ?? null)
    ) {
      return true;
    }

    if (!nextTitle.trim() && !nextContent.trim()) return true;

    setSaveStatus('saving');
    try {
      const updated = await onSave(note.id, nextTitle, nextContent, nextFolderId);
      lastSavedRef.current = { title: updated.title, content: updated.content };
      setTitle(updated.title);
      setMarkdownContent(updated.content);
      const shouldSyncEditorContent = updated.content !== nextContent;
      if (editor && shouldSyncEditorContent) {
        applyingRemoteContentRef.current = true;
        editor.commands.setContent(markdownToHtml(updated.content || ''), { emitUpdate: false });
        window.setTimeout(() => {
          applyingRemoteContentRef.current = false;
        }, 0);
      }
      setSaveStatus('saved');
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = window.setTimeout(() => setSaveStatus('idle'), 2000);
      return true;
    } catch (error) {
      console.error('Save failed:', error);
      setSaveStatus('error');
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = window.setTimeout(() => setSaveStatus('idle'), 3000);
      showToast('保存失败，请重试', 'error');
      return false;
    }
  }, [note, onSave, editor]);

  useImperativeHandle(ref, () => ({
    flushSave: () => performSave(title, markdownContent, note?.folder_id ?? null),
  }), [performSave, title, markdownContent, note?.folder_id]);

  useEffect(() => {
    if (!note) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (title === lastSavedRef.current.title && markdownContent === lastSavedRef.current.content) return;
    if (!title.trim() && !markdownContent.trim()) return;

    saveTimeoutRef.current = window.setTimeout(async () => {
      if (title === lastSavedRef.current.title && markdownContent === lastSavedRef.current.content) return;
      await performSave(title, markdownContent, note.folder_id ?? null);
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [title, markdownContent, note, performSave]);

  const handleFolderChange = async (folderIdValue: string) => {
    if (!note) return;
    const nextFolderId = folderIdValue === '' ? null : Number(folderIdValue);
    const saved = await performSave(title, markdownContent, nextFolderId);
    if (!saved) return;
    setFolderMenuOpen(false);
    showToast('笔记已移动到新文件夹', 'success');
  };

  const handleFolderTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setFolderMenuOpen(true);
    }
    if (e.key === 'Escape') {
      setFolderMenuOpen(false);
    }
  };

  const handleFolderOptionKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
    optionId: number | null
  ) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setFolderMenuOpen(false);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = (index + 1) % folderOptions.length;
      folderOptionRefs.current[nextIndex]?.focus();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const nextIndex = (index - 1 + folderOptions.length) % folderOptions.length;
      folderOptionRefs.current[nextIndex]?.focus();
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void handleFolderChange(optionId === null ? '' : String(optionId));
    }
  };

  const handleDelete = async () => {
    if (!note || isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete(note.id);
    } catch (error) {
      console.error('Delete failed:', error);
      showToast('删除笔记失败', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const run = (fn: (ed: NonNullable<typeof editor>) => void) => {
    if (!editor) return;
    fn(editor);
  };

  const runFormatAction = (fn: (ed: NonNullable<typeof editor>) => void) => {
    run(fn);
    setFormatMenuOpen(false);
  };

  const sanitizeFileName = (value: string) => {
    const normalized = value.trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ');
    return normalized || '未命名笔记';
  };

  const getExportLabel = (format: ExportFormat) => {
    if (format === 'md') return 'Markdown';
    if (format === 'txt') return 'TXT';
    return 'JSON';
  };

  const handleExport = async (format: ExportFormat) => {
    if (!note) return;
    const saved = await performSave(title, markdownContent, note.folder_id ?? null);
    if (!saved) {
      showToast('导出前保存失败，请重试', 'error');
      return;
    }

    const fileName = sanitizeFileName(title || note.title || '');
    const path = await save({
      defaultPath: `${fileName}.${format}`,
      filters: [{ name: getExportLabel(format), extensions: [format] }],
    });

    if (!path || Array.isArray(path)) {
      setExportMenuOpen(false);
      return;
    }

    try {
      await api.exportNote(note.id, format, path);
      showToast(`已导出为 ${getExportLabel(format)}`, 'success');
    } catch (error) {
      console.error('Export failed:', error);
      showToast('导出失败，请重试', 'error');
    } finally {
      setExportMenuOpen(false);
    }
  };

  if (!note && !title && !markdownContent) {
    return <div className="editor-empty">选择一个笔记或创建新笔记</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="editor-header">
        <div className="editor-title-group">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题"
            className="editor-title-input"
          />
          {note && (
            <div className="editor-meta-row">
              <div className="editor-updated-at" title={`最后修改：${formatUpdatedAt(note.updated_at)}`}>
                最后修改：{formatUpdatedAt(note.updated_at)}
              </div>
              <div className="editor-folder-meta" ref={folderMenuRef}>
                <span className="editor-folder-label">归档</span>
                <button
                  type="button"
                  className={`editor-folder-trigger${folderMenuOpen ? ' open' : ''}`}
                  onClick={() => setFolderMenuOpen((open) => !open)}
                  onKeyDown={handleFolderTriggerKeyDown}
                  aria-haspopup="menu"
                  aria-expanded={folderMenuOpen}
                >
                  <span className="editor-folder-trigger-text">
                    {currentFolder?.name ?? '未分类'}
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="editor-folder-trigger-icon">
                    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {folderMenuOpen && (
                  <div className="editor-folder-menu" role="menu">
                    {folderOptions.map((option, index) => (
                      <button
                        key={option.id ?? 'none'}
                        type="button"
                        ref={(el) => {
                          folderOptionRefs.current[index] = el;
                        }}
                        className={`editor-folder-option${note.folder_id === option.id ? ' active' : ''}`}
                        onClick={() => void handleFolderChange(option.id === null ? '' : String(option.id))}
                        onKeyDown={(e) => handleFolderOptionKeyDown(e, index, option.id)}
                      >
                        <span
                          className={`editor-folder-option-dot${option.id === null ? ' neutral' : ''}`}
                          style={option.color ? { backgroundColor: option.color } : undefined}
                        />
                        {option.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="editor-actions">
          <span
            className="editor-save-status"
            style={{
              color: saveStatus === 'error' ? 'var(--color-error)' : 'var(--color-text-muted)',
              opacity: saveStatus === 'idle' ? 0 : 1,
            }}
          >
            {saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存' : saveStatus === 'error' ? '保存失败' : '已保存'}
          </span>
          <div className="editor-export-wrap" ref={exportMenuRef}>
            <button
              type="button"
              className={`editor-export-trigger${exportMenuOpen ? ' open' : ''}`}
              onClick={() => setExportMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
            >
              导出
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {exportMenuOpen && (
              <div className="editor-export-menu" role="menu">
                <button type="button" className="editor-export-item" onClick={() => void handleExport('md')}>
                  导出为 Markdown (.md)
                </button>
                <button type="button" className="editor-export-item" onClick={() => void handleExport('txt')}>
                  导出为 文本 (.txt)
                </button>
                <button type="button" className="editor-export-item" onClick={() => void handleExport('json')}>
                  导出为 JSON (.json)
                </button>
              </div>
            )}
          </div>
          <div className="editor-format-wrap" ref={formatMenuRef}>
            <button
              type="button"
              className={`editor-format-trigger${formatMenuOpen ? ' open' : ''}`}
              onClick={() => setFormatMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={formatMenuOpen}
            >
              格式
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {formatMenuOpen && (
              <div className="editor-format-menu" role="menu">
                <button type="button" className={`editor-format-item${editor?.isActive('heading', { level: 1 }) ? ' active' : ''}`} onClick={() => runFormatAction((ed) => ed.chain().focus().toggleHeading({ level: 1 }).run())}>标题 1</button>
                <button type="button" className={`editor-format-item${editor?.isActive('heading', { level: 2 }) ? ' active' : ''}`} onClick={() => runFormatAction((ed) => ed.chain().focus().toggleHeading({ level: 2 }).run())}>标题 2</button>
                <button type="button" className={`editor-format-item${editor?.isActive('bold') ? ' active' : ''}`} onClick={() => runFormatAction((ed) => ed.chain().focus().toggleBold().run())}>加粗</button>
                <button type="button" className={`editor-format-item${editor?.isActive('italic') ? ' active' : ''}`} onClick={() => runFormatAction((ed) => ed.chain().focus().toggleItalic().run())}>斜体</button>
                <button type="button" className={`editor-format-item${editor?.isActive('bulletList') ? ' active' : ''}`} onClick={() => runFormatAction((ed) => ed.chain().focus().toggleBulletList().run())}>无序列表</button>
                <button type="button" className={`editor-format-item${editor?.isActive('orderedList') ? ' active' : ''}`} onClick={() => runFormatAction((ed) => ed.chain().focus().toggleOrderedList().run())}>有序列表</button>
                <button type="button" className="editor-format-item" onClick={() => runFormatAction((ed) => ed.chain().focus().insertContent('- [ ] ').run())}>待办列表</button>
                <button type="button" className={`editor-format-item${editor?.isActive('blockquote') ? ' active' : ''}`} onClick={() => runFormatAction((ed) => ed.chain().focus().toggleBlockquote().run())}>引用</button>
                <button type="button" className={`editor-format-item${editor?.isActive('codeBlock') ? ' active' : ''}`} onClick={() => runFormatAction((ed) => ed.chain().focus().toggleCodeBlock().run())}>代码块</button>
                <button type="button" className="editor-format-item" onClick={() => runFormatAction((ed) => ed.chain().focus().setHorizontalRule().run())}>分割线</button>
                <div className="editor-format-divider" />
                <button type="button" className={`editor-format-item${editor?.isActive('table') ? ' active' : ''}`} onClick={() => runFormatAction((ed) => ed.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run())}>插入表格</button>
                <button
                  type="button"
                  className="editor-format-item"
                  disabled={!editor?.can().chain().focus().deleteRow().run()}
                  onClick={() => runFormatAction((ed) => ed.chain().focus().deleteRow().run())}
                >
                  删除当前行
                </button>
                <button
                  type="button"
                  className="editor-format-item"
                  disabled={!editor?.can().chain().focus().deleteColumn().run()}
                  onClick={() => runFormatAction((ed) => ed.chain().focus().deleteColumn().run())}
                >
                  删除当前列
                </button>
                <button
                  type="button"
                  className="editor-format-item danger"
                  disabled={!editor?.can().chain().focus().deleteTable().run()}
                  onClick={() => runFormatAction((ed) => ed.chain().focus().deleteTable().run())}
                >
                  删除表格
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="editor-icon-btn editor-delete-btn"
            onClick={() => void handleDelete()}
            disabled={isDeleting}
            title={isDeleting ? '删除中...' : '删除笔记'}
            aria-label={isDeleting ? '删除中' : '删除笔记'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M3 6H21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M8 6V4C8 3.44772 8.44772 3 9 3H15C15.5523 3 16 3.44772 16 4V6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M19 6L18.133 18.142C18.0582 19.1893 17.1863 20 16.1363 20H7.86372C6.81371 20 5.94184 19.1893 5.867 18.142L5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M10 11V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M14 11V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          {speechSupported && (
            <button
              onClick={toggleSpeech}
              title={isListening ? '停止语音输入' : '语音输入'}
              className={`editor-icon-btn speech-btn ${isListening ? 'listening' : 'idle'}`}
              aria-label={isListening ? '停止语音输入' : '语音输入'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M5 11C5 14.866 8.134 18 12 18C15.866 18 19 14.866 19 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <path d="M12 18V22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {speechSupported && isListening && interimText && (
        <div className="speech-interim">{interimText}</div>
      )}

      <div className="editor-content">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});
