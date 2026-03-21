import { Note } from '../types';

interface NoteItemProps {
  note: Note;
  isSelected: boolean;
  onClick: () => void;
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;
  if (diffDay < 7) return `${diffDay}天前`;

  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (date.getFullYear() === now.getFullYear()) {
    return `${month}月${day}日`;
  }
  return `${date.getFullYear()}/${month}/${day}`;
}

export function NoteItem({ note, isSelected, onClick }: NoteItemProps) {
  return (
    <div
      onClick={onClick}
      className={`note-item ${isSelected ? 'selected' : ''}`}
    >
      <div className="note-item-header">
        <h3 className="note-item-title">{note.title}</h3>
        <span className="note-item-date">{formatRelativeDate(note.updated_at)}</span>
      </div>
      <p className="note-item-preview">
        {note.content || '\u00A0'}
      </p>
    </div>
  );
}
