import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
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
import { aiService, type RAGAnswerResult } from '../utils/ai';
import { useStore } from '../store/useStore';
import { showToast } from './Toast';

interface NoteEditorProps {
  note: Note | null;
  folders: Folder[];
  onSave: (noteId: number, title: string, content: string, folderId: number | null, summaryHistory?: string, translations?: string) => Promise<Note>;
  onDelete: (noteId: number) => Promise<void>;
}

export interface NoteEditorHandle {
  flushSave: () => Promise<boolean>;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type ExportFormat = 'md' | 'txt' | 'json';
type TranslationEntry = {
  title: string;
  content: string;
  sourceFingerprint?: string;
};
type TranslationMap = Record<string, TranslationEntry>;

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

type WebSpeechRecognitionCtor = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getWebSpeechRecognitionCtor(): WebSpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as WebSpeechRecognitionCtor | null;
}

function getFolderOptions(folders: Folder[]) {
  return [
    { id: null, name: '未分类', color: null as string | null },
    ...folders.map((folder) => ({ id: folder.id, name: folder.name, color: folder.color })),
  ];
}

function computeSourceFingerprint(title: string, content: string): string {
  const source = `${title}\n${content}`;
  let hash = 5381;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) + hash) ^ source.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function parseTranslations(raw: string | undefined, fallbackTitle: string): TranslationMap {
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    parsed = {};
  }
  if (!parsed || typeof parsed !== 'object') return {};

  const result: TranslationMap = {};
  for (const [language, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') {
      result[language] = { title: fallbackTitle, content: value };
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const next = value as { title?: unknown; content?: unknown; sourceFingerprint?: unknown };
    result[language] = {
      title: typeof next.title === 'string' ? next.title : fallbackTitle,
      content: typeof next.content === 'string' ? next.content : '',
      sourceFingerprint: typeof next.sourceFingerprint === 'string' ? next.sourceFingerprint : undefined,
    };
  }
  return result;
}

export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { note, folders, onSave, onDelete },
  ref
) {
  const [title, setTitle] = useState(note?.title || '');
  const [markdownContent, setMarkdownContent] = useState(note?.content || '');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isListening, setIsListening] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [summaryHistoryOpen, setSummaryHistoryOpen] = useState(false);
  const [qaModalOpen, setQaModalOpen] = useState(false);
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaResult, setQaResult] = useState<RAGAnswerResult | null>(null);
  const [qaSourceNotes, setQaSourceNotes] = useState<Record<number, Note>>({});
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [translateModalOpen, setTranslateModalOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  
  const saveTimeoutRef = useRef<number | null>(null);
  const savedTimeoutRef = useRef<number | null>(null);
  const folderOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const formatMenuRef = useRef<HTMLDivElement>(null);
  
  const lastSavedRef = useRef<{ title: string; content: string }>({ title: '', content: '' });
  const applyingRemoteContentRef = useRef(false);
  const latestTranslationsRef = useRef<string>(note?.translations || '{}');
  const webSpeechRecognitionRef = useRef<InstanceType<WebSpeechRecognitionCtor> | null>(null);
  const webSpeechLastFinalRef = useRef('');
  const webSpeechPendingInterimRef = useRef('');
  const webSpeechInterimTimerRef = useRef<number | null>(null);
  const { aiConfig, setAIConfig, currentLanguage, setCurrentLanguage, setSelectedNote } = useStore();
  const tauriRuntime = api.isTauriRuntime();
  const webSpeechCtor = tauriRuntime ? null : getWebSpeechRecognitionCtor();
  const speechSupported = tauriRuntime || Boolean(webSpeechCtor);
  const folderOptions = getFolderOptions(folders);
  const currentFolder = folderOptions.find((opt) => opt.id === (note?.folder_id ?? null)) ?? folderOptions[0];
  const noteSourceFingerprint = note ? computeSourceFingerprint(note.title, note.content) : '';
  const translationsMap = parseTranslations(latestTranslationsRef.current, note?.title || '');
  
  // CRITICAL: Reset Ref ONLY when note ID changes. This ensures a clean state when switching between notes.
  useEffect(() => {
    if (note) {
      latestTranslationsRef.current = note.translations || '{}'; // Initialize ref from incoming note
      setCurrentLanguage('Original'); // Reset current language when a new note is selected
    } else {
      // If no note is selected, clear translations ref and current language
      latestTranslationsRef.current = '{}';
      setCurrentLanguage('Original');
    }
  }, [note?.id, setCurrentLanguage, note?.translations]); // Add note?.translations to ensure ref updates if only translations change for same note ID

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2] } }),
      Table.configure({ resizable: false }),
      TableRow, TableHeader, TableCell,
    ],
    content: markdownToHtml(markdownContent || ''), // Initial content
    onUpdate: ({ editor: nextEditor }) => {
      if (applyingRemoteContentRef.current) return;
      setMarkdownContent(htmlToMarkdown(nextEditor.getHTML()));
    },
    editorProps: { attributes: { class: 'editor-prosemirror' } },
  }); // Keep a stable editor instance; content changes are applied via setContent when note/language switches.

  const performSave = useCallback(async (
    nextTitle: string,
    nextContent: string,
    nextFolderId: number | null = note?.folder_id ?? null,
    nextSummaryHistory: string = note?.summary_history ?? '[]'
  ) => {
    if (!note) return true;

    if (nextTitle === lastSavedRef.current.title && nextContent === lastSavedRef.current.content) {
      // Also check folder and other fields if needed, but primary check is title/content
      if (nextFolderId === (note.folder_id ?? null) && 
          nextSummaryHistory === (note.summary_history ?? '[]')) { // Check only non-translation fields for now
        // Compare current JSON string with the Ref
        if (latestTranslationsRef.current === (note.translations || '{}')) {
          return true; // No changes, skip save
        }
      }
    }

    if (!nextTitle.trim() && !nextContent.trim()) return true;

    let finalTranslations = latestTranslationsRef.current || '{}'; // Always start with the latest known translations

    if (currentLanguage === 'Original') {
      // Original updates should only mark existing translations stale instead of overwriting.
      const nextSourceFingerprint = computeSourceFingerprint(nextTitle, nextContent);
      const previousSourceFingerprint = computeSourceFingerprint(note.title, note.content);
      const translations = parseTranslations(finalTranslations, note.title);
      if (nextSourceFingerprint !== previousSourceFingerprint) {
        Object.values(translations).forEach((entry) => {
          if (!entry.sourceFingerprint) {
            entry.sourceFingerprint = previousSourceFingerprint;
          }
        });
      }
      finalTranslations = JSON.stringify(translations);
    } else {
      const translations = parseTranslations(finalTranslations, note.title);
      const previous = translations[currentLanguage];
      translations[currentLanguage] = {
        title: nextTitle,
        content: nextContent,
        sourceFingerprint: previous?.sourceFingerprint,
      };
      finalTranslations = JSON.stringify(translations);
    }
    
    // Update Ref AFTER processing, before sending to backend
    latestTranslationsRef.current = finalTranslations;

    setSaveStatus('saving');
    try {
    const titleToSave = currentLanguage === 'Original' ? nextTitle : note.title;
    const contentToSave = currentLanguage === 'Original' ? nextContent : note.content;
    const updatedNote = await onSave(note.id, titleToSave, contentToSave, nextFolderId, nextSummaryHistory, finalTranslations);

    latestTranslationsRef.current = updatedNote.translations || '{}'; // CRITICAL: Update ref with confirmed backend data
    lastSavedRef.current = { title: nextTitle, content: nextContent }; // Update last saved state
    setSaveStatus('saved');
    if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    savedTimeoutRef.current = window.setTimeout(() => setSaveStatus('idle'), 2000);
      return true;
    } catch (error) {
      setSaveStatus('error');
      showToast('保存失败', 'error');
      return false;
    }
  }, [note, onSave, currentLanguage]);

  useImperativeHandle(ref, () => ({
    flushSave: () => performSave(title, markdownContent, note?.folder_id ?? null, note?.summary_history ?? '[]'),
  }), [performSave, title, markdownContent, note?.folder_id, note?.summary_history]);

  useEffect(() => {
    if (!note) return;
    if (title === lastSavedRef.current.title && markdownContent === lastSavedRef.current.content) return;
    
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = window.setTimeout(async () => {
      if (title === lastSavedRef.current.title && markdownContent === lastSavedRef.current.content) return;
      await performSave(title, markdownContent, note.folder_id ?? null, note.summary_history ?? '[]');
    }, 1200);

    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [title, markdownContent, note?.id, performSave]);

  useEffect(() => {
    if (!note) {
      setTitle(''); setMarkdownContent('');
      if (editor) editor.commands.setContent('');
      return;
    }

    let displayContent = note.content;
    let displayTitle = note.title;
    
    if (currentLanguage !== 'Original') {
      const translations = parseTranslations(latestTranslationsRef.current, note.title);
      const data = translations[currentLanguage];
      if (data) {
        displayTitle = data.title || note.title;
        displayContent = data.content || note.content;
      }
    }

    setTitle(displayTitle || '');
    setMarkdownContent(displayContent || '');
    setSaveStatus('idle');
    setLanguageMenuOpen(false);
    
    if (editor) {
      applyingRemoteContentRef.current = true;
      editor.commands.setContent(markdownToHtml(displayContent || ''), { emitUpdate: false });
      window.setTimeout(() => {
        lastSavedRef.current = { title: displayTitle || '', content: displayContent || '' };
        applyingRemoteContentRef.current = false;
      }, 50);
    }
  }, [note?.id, editor, currentLanguage]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (moreMenuOpen && !moreMenuRef.current?.contains(target)) setMoreMenuOpen(false);
      if (languageMenuOpen && !languageMenuRef.current?.contains(target)) setLanguageMenuOpen(false);
      if (formatMenuOpen && !formatMenuRef.current?.contains(target)) setFormatMenuOpen(false);
      if (folderMenuOpen && !folderMenuRef.current?.contains(target)) setFolderMenuOpen(false);
      if (aiConfigOpen && !(event.target as HTMLElement).closest('.ai-config-modal-content')) setAiConfigOpen(false);
      if (translateModalOpen && !(event.target as HTMLElement).closest('.translate-modal-content')) setTranslateModalOpen(false);
      if (qaModalOpen && !(event.target as HTMLElement).closest('.qa-modal-content')) setQaModalOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [moreMenuOpen, languageMenuOpen, formatMenuOpen, folderMenuOpen, aiConfigOpen, translateModalOpen, qaModalOpen]);

  const runFormat = (fn: (ed: any) => void) => { if (editor) { fn(editor); setFormatMenuOpen(false); } };

  const handleSummarize = async () => {
    if (!note || !markdownContent.trim()) return;
    if (!aiConfig.apiKey) { setAiConfigOpen(true); showToast('请配置 API Key', 'info'); return; }
    setIsSummarizing(true);
    try {
      const summary = await aiService.summarize(markdownContent, aiConfig);
      const history = JSON.parse(note.summary_history || '[]');
      const updatedHistory = JSON.stringify([{ time: new Date().toLocaleString(), text: summary }, ...history]);
      await onSave(note.id, title, note.content, note.folder_id ?? null, updatedHistory, latestTranslationsRef.current);
      setSummaryHistoryOpen(true);
      showToast('总结生成成功', 'success');
    } catch { showToast('总结失败', 'error'); } finally { setIsSummarizing(false); }
  };

  const handleTranslate = async (targetLanguage: string) => {
    if (!note || !markdownContent.trim()) return;
    if (!aiConfig.apiKey) { setAiConfigOpen(true); showToast('请配置 API Key', 'info'); return; }
    setIsTranslating(true); setTranslateModalOpen(false);
    showToast(`正在翻译为 ${targetLanguage}...`, 'info');
    try {
      const sourceContent = note.content;
      const translatedContent = await aiService.translateNote(sourceContent, targetLanguage, aiConfig);
      const translations = parseTranslations(latestTranslationsRef.current, note.title);
      translations[targetLanguage] = {
        title: note.title,
        content: translatedContent,
        sourceFingerprint: computeSourceFingerprint(note.title, note.content),
      };
      const updatedTranslations = JSON.stringify(translations);
      const savedNote = await onSave(
        note.id,
        note.title,
        note.content,
        note.folder_id ?? null,
        note.summary_history ?? '[]',
        updatedTranslations
      );
      latestTranslationsRef.current = savedNote.translations || '{}'; // CRITICAL: Update ref with confirmed backend data

      setCurrentLanguage(targetLanguage);
      showToast(`已翻译为 ${targetLanguage}`, 'success');
    } catch { showToast('翻译失败', 'error'); } finally { setIsTranslating(false); }
  };

  const handleAskQuestion = async () => {
    const query = qaQuestion.trim();
    if (!query) {
      showToast('请输入问题', 'info');
      return;
    }
    if (!aiConfig.apiKey) {
      setAiConfigOpen(true);
      showToast('请先配置 API Key', 'info');
      return;
    }

    setIsAsking(true);
    try {
      const [allNotes, keywordNotes] = await Promise.all([
        api.getNotes(),
        api.searchNotes(query),
      ]);
      const sourceMap: Record<number, Note> = {};
      allNotes.forEach((item) => {
        sourceMap[item.id] = item;
      });
      setQaSourceNotes(sourceMap);

      const result = await aiService.answerWithRAG(
        query,
        allNotes,
        keywordNotes.map((n) => n.id),
        aiConfig
      );
      setQaResult(result);
    } catch (error: any) {
      console.error('RAG QA failed:', error);
      setQaResult(null);
      showToast(error?.message || '问答失败', 'error');
    } finally {
      setIsAsking(false);
    }
  };

  const handleOpenQAModal = () => {
    setQaModalOpen(true);
    setQaResult(null);
    setQaQuestion('');
  };

  const handleJumpToCitation = async (noteId: number) => {
    const target = qaSourceNotes[noteId] || (await api.getNotes()).find((n) => n.id === noteId);
    if (!target) {
      showToast('未找到引用笔记', 'error');
      return;
    }
    setCurrentLanguage('Original');
    setSelectedNote(target);
    setQaModalOpen(false);
  };

  const handleExport = async (format: ExportFormat) => {
    if (!note) return;
    const fileName = (title || '未命名').replace(/[\\/:*?"<>|]/g, '_');
    const path = await save({ defaultPath: `${fileName}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (!path || Array.isArray(path)) return;
    try {
      await api.exportNote(note.id, format, path);
      showToast('导出成功', 'success');
    } catch (error) { showToast('导出失败', 'error'); }
  };

  const handleDelete = async () => {
    if (!note || isDeleting) return;
    setIsDeleting(true);
    try { await onDelete(note.id); } catch { showToast('删除失败', 'error'); } finally { setIsDeleting(false); }
  };

  const stopWebSpeech = useCallback(() => {
    if (webSpeechInterimTimerRef.current) {
      window.clearTimeout(webSpeechInterimTimerRef.current);
      webSpeechInterimTimerRef.current = null;
    }
    const current = webSpeechRecognitionRef.current;
    if (!current) return;
    current.onresult = null;
    current.onerror = null;
    current.onend = null;
    try {
      current.stop();
    } catch {
      // ignore
    }
    webSpeechRecognitionRef.current = null;
  }, []);

  const startWebSpeech = useCallback(() => {
    if (!webSpeechCtor) throw new Error('当前浏览器不支持语音识别');
    if (!editor) throw new Error('编辑器未就绪');
    stopWebSpeech();
    const recognition = new webSpeechCtor();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    const commitText = (raw: string) => {
      const text = String(raw || '').trim();
      if (!text) return;
      if (text === webSpeechLastFinalRef.current) return;
      webSpeechLastFinalRef.current = text;
      editor.chain().focus().insertContent(text).run();
    };
    const scheduleInterimCommit = (raw: string) => {
      const text = String(raw || '').trim();
      if (!text) return;
      webSpeechPendingInterimRef.current = text;
      if (webSpeechInterimTimerRef.current) {
        window.clearTimeout(webSpeechInterimTimerRef.current);
      }
      webSpeechInterimTimerRef.current = window.setTimeout(() => {
        if (webSpeechPendingInterimRef.current) {
          commitText(webSpeechPendingInterimRef.current);
          webSpeechPendingInterimRef.current = '';
        }
        webSpeechInterimTimerRef.current = null;
      }, 1200);
    };
    recognition.onresult = (event: any) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = String(result?.[0]?.transcript || '').trim();
        if (!text) continue;
        if (result.isFinal) finalText += text;
        else interimText += text;
      }
      const normalized = finalText.trim();
      if (normalized) {
        if (webSpeechInterimTimerRef.current) {
          window.clearTimeout(webSpeechInterimTimerRef.current);
          webSpeechInterimTimerRef.current = null;
        }
        webSpeechPendingInterimRef.current = '';
        commitText(normalized);
        return;
      }
      if (interimText.trim()) {
        scheduleInterimCommit(interimText);
      }
    };
    recognition.onerror = (event: any) => {
      if (webSpeechPendingInterimRef.current) {
        commitText(webSpeechPendingInterimRef.current);
        webSpeechPendingInterimRef.current = '';
      }
      const code = String(event?.error || '');
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        showToast('麦克风权限被拒绝', 'error');
      } else if (code === 'audio-capture') {
        showToast('未检测到可用麦克风', 'error');
      } else if (code === 'no-speech') {
        showToast('未检测到语音输入', 'info');
      } else {
        showToast('语音识别失败', 'error');
      }
      webSpeechRecognitionRef.current = null;
      setIsListening(false);
    };
    recognition.onend = () => {
      if (webSpeechPendingInterimRef.current) {
        commitText(webSpeechPendingInterimRef.current);
        webSpeechPendingInterimRef.current = '';
      }
      webSpeechRecognitionRef.current = null;
      setIsListening(false);
    };
    recognition.start();
    webSpeechRecognitionRef.current = recognition;
    webSpeechLastFinalRef.current = '';
    webSpeechPendingInterimRef.current = '';
    setIsListening(true);
  }, [editor, stopWebSpeech, webSpeechCtor]);

  const toggleSpeech = async () => {
    if (!speechSupported) { showToast('当前环境不支持语音输入', 'info'); return; }
    try {
      if (isListening) {
        if (tauriRuntime) await api.stopSpeech();
        else stopWebSpeech();
        setIsListening(false);
      } else if (tauriRuntime) {
        await api.startSpeech();
        setIsListening(true);
      } else {
        startWebSpeech();
      }
    } catch (error: any) {
      showToast(error?.message || '语音启动失败', 'error');
      if (!tauriRuntime) stopWebSpeech();
      setIsListening(false);
    }
  };

  useEffect(() => {
    if (!isListening) return;
    if (tauriRuntime) {
      void api.stopSpeech().catch(() => {}).finally(() => setIsListening(false));
    } else {
      stopWebSpeech();
      setIsListening(false);
    }
  }, [note?.id]);

  useEffect(() => () => {
    if (tauriRuntime) {
      void api.stopSpeech().catch(() => {});
    } else {
      stopWebSpeech();
    }
  }, [stopWebSpeech, tauriRuntime]);

  const handleFolderChange = async (folderIdValue: string) => {
    if (!note) return;
    const nextFolderId = folderIdValue === '' ? null : Number(folderIdValue);
    await performSave(title, markdownContent, nextFolderId, note.summary_history);
    setFolderMenuOpen(false);
  };

  const handleFolderTriggerKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); setFolderMenuOpen(true); } };

  if (!note && !title && !markdownContent) return <div className="editor-empty">选择一个笔记或创建新笔记</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="editor-header">
        <div className="editor-title-group">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" className="editor-title-input" />
          {note && (
            <div className="editor-meta-row">
              <div className="editor-updated-at">最后修改：{formatUpdatedAt(note.updated_at)}</div>
              <div className="editor-folder-meta" ref={folderMenuRef}>
                <span className="editor-folder-label">归档</span>
                <button type="button" className={`editor-folder-trigger${folderMenuOpen ? ' open' : ''}`} onClick={() => setFolderMenuOpen(!folderMenuOpen)} onKeyDown={handleFolderTriggerKeyDown}>
                  <span className="editor-folder-trigger-text">{currentFolder?.name ?? '未分类'}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                {folderMenuOpen && (
                  <div className="editor-folder-menu">
                    {folderOptions.map((opt: { id: number | null; name: string; color: string | null }, idx: number) => (
                      <button key={opt.id ?? 'none'} type="button" ref={(el) => { folderOptionRefs.current[idx] = el; }} className={`editor-folder-option${note.folder_id === opt.id ? ' active' : ''}`} onClick={() => handleFolderChange(opt.id === null ? '' : String(opt.id))}>
                        <span className={`editor-folder-option-dot${opt.id === null ? ' neutral' : ''}`} style={opt.color ? { backgroundColor: opt.color } : undefined} />
                        {opt.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="editor-actions">
          <span className="editor-save-status" style={{ opacity: saveStatus === 'idle' ? 0 : 1, color: saveStatus === 'error' ? 'var(--color-error)' : 'var(--color-text-muted)' }}>
            {saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存' : '已保存'}
          </span>
          <div className="ai-group" style={{ display: 'flex', gap: '4px', background: 'rgba(184, 123, 90, 0.05)', padding: '2px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-light)' }}>
            <button onClick={handleSummarize} disabled={isSummarizing || !markdownContent.trim()} className={`editor-icon-btn ai-summary-btn ${isSummarizing ? 'loading' : ''}`} title="智能总结" style={{ border: 'none', background: 'transparent' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className={isSummarizing ? 'spin' : ''}><path d="M12 3a9 9 0 1 0 9 9 1 1 0 1 0-2 0 7 7 0 1 1-7-7 1 1 0 0 0 0-2z" fill="currentColor" /><path d="M12 7a5 5 0 1 0 5 5 1 1 0 1 0-2 0 3 3 0 1 1-3-3 1 1 0 0 0 0-2z" fill="currentColor" /></svg>
            </button>
            <button 
              onClick={() => setTranslateModalOpen(true)} 
              className={`editor-icon-btn ${isTranslating ? 'loading' : ''}`} 
              title={isTranslating ? '正在翻译...' : '翻译'} 
              disabled={isTranslating || !markdownContent.trim()}
              style={{ border: 'none', background: 'transparent' }}
            >
              {isTranslating ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="spin">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M8 5L4 9L8 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M4 9H13C17.4183 9 21 12.5817 21 17C21 17.5523 20.5523 18 20 18H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
            </button>
            <div className="language-selector" ref={languageMenuRef} style={{ position: 'relative' }}>
              <button onClick={() => setLanguageMenuOpen(!languageMenuOpen)} style={{ padding: '4px 8px', height: '28px', minWidth: '60px', fontSize: '11px', background: 'transparent', border: 'none', color: currentLanguage === 'Original' ? 'var(--color-text-secondary)' : 'var(--color-primary)', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px' }}>
                {currentLanguage === 'Original' ? '原文' : currentLanguage}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" /></svg>
              </button>
              {languageMenuOpen && (
                <div className="editor-export-menu" style={{ minWidth: '126px', left: 0, top: '100%' }}>
                  <button className="editor-export-item" onClick={() => { setCurrentLanguage('Original'); setLanguageMenuOpen(false); }}>原文</button>
                  {Object.keys(translationsMap).map((language) => {
                    const entry = translationsMap[language];
                    const stale = !!entry.sourceFingerprint && entry.sourceFingerprint !== noteSourceFingerprint;
                    return (
                      <div key={language} className="translation-menu-row">
                        <button
                          className="editor-export-item translation-menu-language"
                          onClick={() => {
                            setCurrentLanguage(language);
                            setLanguageMenuOpen(false);
                          }}
                        >
                          <span>{language}</span>
                        </button>
                        {stale && (
                          <button
                            className="translation-stale-badge"
                            title="更新该语种译文"
                            onClick={(event) => {
                              event.stopPropagation();
                              setLanguageMenuOpen(false);
                              void handleTranslate(language);
                            }}
                            disabled={isTranslating}
                          >
                            更新
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          
          <div className="format-menu-container" ref={formatMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className={`editor-export-trigger${formatMenuOpen ? ' open' : ''}`}
              onClick={() => setFormatMenuOpen(!formatMenuOpen)}
              style={{ minWidth: '70px', height: '32px' }}
            >
              格式
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {formatMenuOpen && (
              <div className="editor-export-menu" style={{ right: 0, top: '100%', minWidth: '160px', zIndex: 50 }}>
                <button className={`editor-export-item${editor?.isActive('paragraph') ? ' active' : ''}`} onClick={() => runFormat(e => e.chain().focus().setParagraph().run())}>正文</button>
                <div className="editor-format-divider" />
                <button className={`editor-export-item${editor?.isActive('heading', { level: 1 }) ? ' active' : ''}`} onClick={() => runFormat(e => e.chain().focus().toggleHeading({ level: 1 }).run())}>大标题 (H1)</button>
                <button className={`editor-export-item${editor?.isActive('heading', { level: 2 }) ? ' active' : ''}`} onClick={() => runFormat(e => e.chain().focus().toggleHeading({ level: 2 }).run())}>中标题 (H2)</button>
                <button className={`editor-export-item${editor?.isActive('bold') ? ' active' : ''}`} onClick={() => runFormat(e => e.chain().focus().toggleBold().run())}>加粗</button>
                <button className={`editor-export-item${editor?.isActive('italic') ? ' active' : ''}`} onClick={() => runFormat(e => e.chain().focus().toggleItalic().run())}>斜体</button>
                <button className={`editor-export-item${editor?.isActive('bulletList') ? ' active' : ''}`} onClick={() => runFormat(e => e.chain().focus().toggleBulletList().run())}>无序列表</button>
                <button className={`editor-export-item${editor?.isActive('orderedList') ? ' active' : ''}`} onClick={() => runFormat(e => e.chain().focus().toggleOrderedList().run())}>有序列表</button>
                <button className="editor-export-item" onClick={() => runFormat(e => e.chain().focus().insertContent('- [ ] ').run())}>待办列表</button>
                <button className={`editor-export-item${editor?.isActive('blockquote') ? ' active' : ''}`} onClick={() => runFormat(e => e.chain().focus().toggleBlockquote().run())}>引用</button>
                <button className={`editor-export-item${editor?.isActive('codeBlock') ? ' active' : ''}`} onClick={() => runFormat(e => e.chain().focus().toggleCodeBlock().run())}>代码块</button>
                <div className="editor-format-divider" />
                <button className="editor-export-item" onClick={() => runFormat(e => e.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run())}>插入表格</button>
              </div>
            )}
          </div>

          <div className="more-menu-container" ref={moreMenuRef} style={{ position: 'relative' }}>
            <button onClick={() => setMoreMenuOpen(!moreMenuOpen)} className="editor-icon-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="6" r="1.5" fill="currentColor" /><circle cx="12" cy="18" r="1.5" fill="currentColor" /></svg></button>
            {moreMenuOpen && (
              <div className="editor-export-menu" style={{ right: 0, top: '100%', minWidth: '160px' }}>
                <button className="editor-export-item" onClick={() => { setSummaryHistoryOpen(true); setMoreMenuOpen(false); }}>历史总结</button>
                <button className="editor-export-item" onClick={() => handleExport('md')}>导出 MD</button>
                <button className="editor-export-item" onClick={() => handleExport('txt')}>导出 TXT</button>
                <button className="editor-export-item" onClick={() => { setAiConfigOpen(true); setMoreMenuOpen(false); }}>AI 设置</button>
                <button className="editor-export-item danger" onClick={handleDelete}>删除笔记</button>
              </div>
            )}
          </div>
          <div className="editor-side-actions">
            {speechSupported && <button onClick={toggleSpeech} className={`editor-icon-btn editor-speech-btn ${isListening ? 'listening' : ''}`}><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.8"/><path d="M5 11C5 14.866 8.134 18 12 18V22" stroke="currentColor" strokeWidth="1.8" /></svg></button>}
            <div className="editor-side-bottom">
              <button
                type="button"
                className="editor-icon-btn editor-qa-btn"
                onClick={handleOpenQAModal}
                title="笔记问答"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M8 10H16M8 14H13M5 19L6.2 15.4C5.4 14.4 5 13.2 5 12C5 8.69 8.13 6 12 6C15.87 6 19 8.69 19 12C19 15.31 15.87 18 12 18H5.8C5.53 18 5.27 18.07 5.05 18.2L5 19Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                className="editor-icon-btn editor-delete-btn"
                onClick={handleDelete}
                disabled={isDeleting}
                title={isDeleting ? '删除中...' : '删除笔记'}
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
          </div>
        </div>
      </div>
      <div className="editor-content-container" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div className="editor-content" style={{ flex: 1, overflow: 'auto' }}><EditorContent editor={editor} /></div>
        {summaryHistoryOpen && (
          <div className="summary-history-drawer">
            <div className="summary-history-header"><h4>历史总结</h4><button onClick={() => setSummaryHistoryOpen(false)}>×</button></div>
            <div className="summary-history-list">
              {(() => {
                let h: Array<{ time?: string; text?: string }> = [];
                try { h = JSON.parse(note?.summary_history || '[]'); } catch {}
                return h.map((item, i: number) => (
                  <div key={i} className="summary-history-item">
                    <div className="summary-history-time">{item.time}</div>
                    <div className="summary-history-text">{item.text}</div>
                    <button className="summary-history-insert" onClick={() => { if (editor) editor.chain().focus().insertContent(`\n\n> **总结：**\n> ${item.text}\n\n`).run(); }}>引用到正文</button>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}
      </div>
      {qaModalOpen && (
        <QAModal
          question={qaQuestion}
          onQuestionChange={setQaQuestion}
          onAsk={handleAskQuestion}
          isAsking={isAsking}
          result={qaResult}
          onClose={() => setQaModalOpen(false)}
          onJumpToCitation={handleJumpToCitation}
        />
      )}
      {translateModalOpen && <TranslateModal onClose={() => setTranslateModalOpen(false)} onTranslate={handleTranslate} isTranslating={isTranslating} />}
      {aiConfigOpen && (
        <div className="ai-config-modal"><div className="ai-config-modal-content">
          <h3>AI 配置</h3>
          <div className="ai-config-field"><label>API Key</label><input type="password" value={aiConfig.apiKey} onChange={(e) => setAIConfig({ apiKey: e.target.value })} /></div>
          <div className="ai-config-field"><label>Base URL</label><input type="text" value={aiConfig.baseUrl} onChange={(e) => setAIConfig({ baseUrl: e.target.value })} /></div>
          <div className="ai-config-field"><label>模型</label><input type="text" value={aiConfig.model} onChange={(e) => setAIConfig({ model: e.target.value })} /></div>
          <div className="ai-config-field"><label>Embedding 模型</label><input type="text" value={aiConfig.embeddingModel} onChange={(e) => setAIConfig({ embeddingModel: e.target.value })} /></div>
          <button onClick={() => setAiConfigOpen(false)}>完成</button>
        </div></div>
      )}
    </div>
  );
});

interface TranslateModalProps { onClose: () => void; onTranslate: (lang: string) => Promise<void>; isTranslating: boolean; }
interface QAModalProps {
  question: string;
  onQuestionChange: (value: string) => void;
  onAsk: () => Promise<void>;
  isAsking: boolean;
  result: RAGAnswerResult | null;
  onClose: () => void;
  onJumpToCitation: (noteId: number) => void;
}

const QAModal: React.FC<QAModalProps> = ({
  question,
  onQuestionChange,
  onAsk,
  isAsking,
  result,
  onClose,
  onJumpToCitation,
}) => (
  <div className="qa-modal">
    <div className="qa-modal-content">
      <div className="qa-modal-header">
        <h3>笔记全文问答</h3>
        <button className="qa-close-btn" onClick={onClose} disabled={isAsking} aria-label="关闭问答弹窗">×</button>
      </div>
      <p className="qa-subtitle">基于全库笔记检索后回答，并附引用片段。</p>
      <textarea
        className="qa-question-input"
        placeholder="例如：我最近几条笔记里，关于发布流程的关键风险有哪些？"
        value={question}
        onChange={(e) => onQuestionChange(e.target.value)}
      />
      <div className="qa-modal-actions">
        <button className="qa-btn-secondary" onClick={onClose} disabled={isAsking}>关闭</button>
        <button className="qa-btn-primary" onClick={() => void onAsk()} disabled={isAsking || !question.trim()}>
          {isAsking ? '检索中...' : '提问'}
        </button>
      </div>
      {result && (
        <div className="qa-result">
          <div className="qa-answer-card">
            <div className="qa-answer-label">回答</div>
            <div className="qa-answer">{result.answer}</div>
          </div>
          {result.citations.length > 0 && (
            <div className="qa-citations">
              <h4>引用片段</h4>
              {result.citations.map((item) => (
                <button
                  key={`${item.noteId}-${item.index}`}
                  className="qa-citation-item"
                  onClick={() => onJumpToCitation(item.noteId)}
                >
                  <div className="qa-citation-title">
                    <span>[{item.index}] {item.noteTitle}</span>
                    <span className="qa-citation-score">相关度 {item.score}</span>
                  </div>
                  <div className="qa-citation-snippet">{item.snippet}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  </div>
);

const TranslateModal: React.FC<TranslateModalProps> = ({ onClose, onTranslate, isTranslating }) => {
  const [selectedLanguage, setSelectedLanguage] = useState('English');
  const [customLanguage, setCustomLanguage] = useState('');
  const languages = ['English', '简体中文', '日语', '法语', '西班牙语', '德语'];

  const handleTranslateClick = async () => {
    const lang = selectedLanguage === 'Other' ? customLanguage.trim() : selectedLanguage;
    if (lang) {
      await onTranslate(lang);
      // onClose is called by onTranslate after toast message, to allow user to see toast first
    } else {
      showToast('请选择或输入目标语言', 'info');
    }
  };

  return (
    <div className="translate-modal"><div className="translate-modal-content">
      <h3>翻译笔记</h3>
      <div className="translate-language-options">
        {languages.map(l => (
          <button 
            key={l} 
            className={`translate-language-btn ${selectedLanguage === l ? 'active' : ''}`} 
            onClick={() => { setSelectedLanguage(l); setCustomLanguage(''); }}
            disabled={isTranslating}
          >
            {l}
          </button>
        ))}
        <button 
          className={`translate-language-btn ${selectedLanguage === 'Other' ? 'active' : ''}`} 
          onClick={() => setSelectedLanguage('Other')}
          disabled={isTranslating}
        >
          其他
        </button>
      </div>
      {selectedLanguage === 'Other' && <input type="text" value={customLanguage} onChange={(e) => setCustomLanguage(e.target.value)} placeholder="输入语种" className="translate-custom-input" disabled={isTranslating} />}
      <div className="translate-modal-actions">
        <button onClick={onClose} disabled={isTranslating}>取消</button>
        <button onClick={handleTranslateClick} disabled={isTranslating || (!selectedLanguage && !customLanguage.trim())}>
          {isTranslating ? '翻译中...' : '翻译'}
        </button>
      </div>
    </div></div>
  );
};
