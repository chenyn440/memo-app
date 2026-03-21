import { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { showToast } from './Toast';
import { useStore } from '../store/useStore';

interface FolderListProps {
  onSelectFolder: (folderId: number | null) => void;
}

export function FolderList({ onSelectFolder }: FolderListProps) {
  const [showInput, setShowInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#5A9E6F');
  const [folderCounts, setFolderCounts] = useState<Record<number, number>>({});
  const [totalCount, setTotalCount] = useState(0);
  const [openMenuFolderId, setOpenMenuFolderId] = useState<number | null>(null);
  const [openSortSubmenuFolderId, setOpenSortSubmenuFolderId] = useState<number | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<number | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const { folders, setFolders, selectedFolderId, setSelectedFolderId, selectedNote } = useStore();

  useEffect(() => {
    loadFolders();
    void loadCounts();
  }, []);

  useEffect(() => {
    void loadCounts();
  }, [selectedNote?.id, folders.length]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!listRef.current) return;
      if (event.target instanceof Node && listRef.current.contains(event.target)) return;
      setOpenMenuFolderId(null);
      setOpenSortSubmenuFolderId(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const loadFolders = async () => {
    try {
      const data = await api.getFolders();
      setFolders(data);
    } catch (error) {
      console.error('Failed to load folders:', error);
      showToast('加载文件夹失败', 'error');
    }
  };

  const loadCounts = async () => {
    try {
      const allNotes = await api.getNotes();
      const nextCounts: Record<number, number> = {};
      for (const note of allNotes) {
        if (note.folder_id === null) continue;
        nextCounts[note.folder_id] = (nextCounts[note.folder_id] || 0) + 1;
      }
      setFolderCounts(nextCounts);
      setTotalCount(allNotes.length);
    } catch (error) {
      console.error('Failed to load folder counts:', error);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      const folder = await api.createFolder(newFolderName, newFolderColor);
      setFolders([...folders, folder]);
      setNewFolderName('');
      setNewFolderColor('#5A9E6F');
      setShowInput(false);
    } catch (error) {
      console.error('Failed to create folder:', error);
      showToast('创建文件夹失败', 'error');
    }
  };

  const handleSelectFolder = (folderId: number | null) => {
    setSelectedFolderId(folderId);
    onSelectFolder(folderId);
  };

  const handleDeleteFolder = async (folderId: number) => {
    try {
      await api.deleteFolder(folderId);
      setFolders((prev) => prev.filter((folder) => folder.id !== folderId));
      setFolderCounts((prev) => {
        const next = { ...prev };
        delete next[folderId];
        return next;
      });

      if (selectedFolderId === folderId) {
        handleSelectFolder(null);
      }
    } catch (error) {
      console.error('Failed to delete folder:', error);
      const message = typeof error === 'string' ? error : '删除文件夹失败';
      showToast(message, 'error');
    }
  };

  const handleRenameFolder = async (folderId: number) => {
    const nextName = editingFolderName.trim();
    if (!nextName) {
      showToast('文件夹名称不能为空', 'error');
      return;
    }

    try {
      const updated = await api.renameFolder(folderId, nextName);
      setFolders((prev) =>
        prev.map((folder) => (folder.id === folderId ? { ...folder, name: updated.name } : folder))
      );
      setEditingFolderId(null);
      setEditingFolderName('');
    } catch (error) {
      console.error('Failed to rename folder:', error);
      const message = typeof error === 'string' ? error : '重命名失败';
      showToast(message, 'error');
    }
  };

  const handleMoveFolder = async (folderId: number, direction: 'up' | 'down') => {
    const sourceIndex = folders.findIndex((folder) => folder.id === folderId);
    if (sourceIndex === -1) return;

    const targetIndex = direction === 'up' ? sourceIndex - 1 : sourceIndex + 1;
    if (targetIndex < 0 || targetIndex >= folders.length) return;

    const previous = folders;
    const next = [...previous];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);

    setFolders(next);
    setOpenMenuFolderId(null);
    setOpenSortSubmenuFolderId(null);

    try {
      await api.reorderFolders(next.map((folder) => folder.id));
    } catch (error) {
      console.error('Failed to reorder folders:', error);
      setFolders(previous);
      const message = typeof error === 'string' ? error : '文件夹排序失败';
      showToast(message, 'error');
    }
  };

  const colors = ['#5A9E6F', '#5A8DB8', '#B87B5A', '#C75450', '#9B7BB8', '#8C7E74'];

  const renderFolderRow = (folder: typeof folders[number], count: number) => {
    const isSelected = selectedFolderId === folder.id;
    const isMenuOpen = openMenuFolderId === folder.id;
    const isSortOpen = openSortSubmenuFolderId === folder.id;
    const isEditing = editingFolderId === folder.id;
    const index = folders.findIndex((item) => item.id === folder.id);
    const canMoveUp = index > 0;
    const canMoveDown = index >= 0 && index < folders.length - 1;

    return (
      <div key={folder.id} className={`folder-item-wrap${isMenuOpen ? ' menu-open' : ''}`}>
        <div
          className={`folder-item${isSelected ? ' active' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => handleSelectFolder(folder.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleSelectFolder(folder.id);
            }
          }}
        >
          <span
            className="folder-item-dot"
            style={{ backgroundColor: folder.color }}
          />
          {isEditing ? (
            <input
              className="folder-item-rename-input"
              value={editingFolderName}
              autoFocus
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setEditingFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleRenameFolder(folder.id);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setEditingFolderId(null);
                  setEditingFolderName('');
                }
              }}
              onBlur={() => {
                void handleRenameFolder(folder.id);
              }}
            />
          ) : (
            <span className="folder-item-name">{folder.name}</span>
          )}
          <div className="folder-item-action">
            <button
              type="button"
              className={`folder-item-action-trigger${isMenuOpen ? ' active' : ''}`}
              aria-label={`打开 ${folder.name} 操作菜单`}
              title="文件夹操作"
              onClick={(event) => {
                event.stopPropagation();
                setOpenMenuFolderId((prev) => (prev === folder.id ? null : folder.id));
                setOpenSortSubmenuFolderId(null);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="6" r="1.7" fill="currentColor" />
                <circle cx="12" cy="12" r="1.7" fill="currentColor" />
                <circle cx="12" cy="18" r="1.7" fill="currentColor" />
              </svg>
            </button>
            {isMenuOpen && (
              <div
                className="folder-action-menu"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="folder-action-menu-item"
                  onClick={() => {
                    setEditingFolderId(folder.id);
                    setEditingFolderName(folder.name);
                    setOpenMenuFolderId(null);
                    setOpenSortSubmenuFolderId(null);
                  }}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className={`folder-action-menu-item${isSortOpen ? ' open' : ''}`}
                  onClick={() => {
                    setOpenSortSubmenuFolderId((prev) => (prev === folder.id ? null : folder.id));
                  }}
                >
                  排序
                </button>
                {isSortOpen && (
                  <div className="folder-action-submenu">
                    <button
                      type="button"
                      className="folder-action-menu-item"
                      disabled={!canMoveUp}
                      onClick={() => void handleMoveFolder(folder.id, 'up')}
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      className="folder-action-menu-item"
                      disabled={!canMoveDown}
                      onClick={() => void handleMoveFolder(folder.id, 'down')}
                    >
                      下移
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="folder-action-menu-item danger"
                  onClick={() => {
                    setOpenMenuFolderId(null);
                    setOpenSortSubmenuFolderId(null);
                    void handleDeleteFolder(folder.id);
                  }}
                >
                  删除
                </button>
              </div>
            )}
          </div>
          <span className="folder-item-count">{count}</span>
        </div>
      </div>
    );
  };

  return (
    <div
      className="folder-list"
      ref={listRef}
      onClick={() => {
        setOpenMenuFolderId(null);
        setOpenSortSubmenuFolderId(null);
      }}
    >
      <div className="folder-list-header">
        <div>
          <div className="folder-list-title">文件夹</div>
          <div className="folder-list-subtitle">按分组浏览笔记</div>
        </div>
        <button
          className="folder-add-btn"
          onClick={() => setShowInput(!showInput)}
          title={showInput ? '收起新建文件夹' : '新建文件夹'}
          aria-label={showInput ? '收起新建文件夹' : '新建文件夹'}
        >
          {showInput ? '-' : '+'}
        </button>
      </div>

      <div className="folder-rail">
        <div className="folder-items">
          <div className="folder-item-wrap">
            <div
              className={`folder-item${selectedFolderId === null ? ' active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => handleSelectFolder(null)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleSelectFolder(null);
                }
              }}
            >
              <span className="folder-item-dot folder-item-dot-all" />
              <span className="folder-item-name">全部笔记</span>
              <span className="folder-item-action-placeholder" aria-hidden="true" />
              <span className="folder-item-count">{totalCount}</span>
            </div>
          </div>

          {folders.map((folder) => renderFolderRow(folder, folderCounts[folder.id] || 0))}
        </div>
      </div>

      <div className={`folder-create-wrap${showInput ? ' open' : ''}`}>
        <div className="folder-create">
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            placeholder="文件夹名称"
            className="folder-create-input"
            autoFocus={showInput}
          />
          <div className="folder-create-colors">
            {colors.map((color) => (
              <button
                key={color}
                onClick={() => setNewFolderColor(color)}
                className={`folder-color-btn${newFolderColor === color ? ' selected' : ''}`}
                style={{ backgroundColor: color }}
                aria-label={`选择颜色 ${color}`}
              />
            ))}
          </div>
          <div className="folder-create-actions">
            <button onClick={handleCreateFolder} className="folder-create-confirm">
              创建
            </button>
            <button
              onClick={() => {
                setShowInput(false);
                setNewFolderName('');
                setNewFolderColor('#5A9E6F');
              }}
              className="folder-create-cancel"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
