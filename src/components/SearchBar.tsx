import { useRef } from 'react';
import { useStore } from '../store/useStore';

interface SearchBarProps {
  onSearch: (query: string) => void;
}

export function SearchBar({ onSearch }: SearchBarProps) {
  const { searchQuery, setSearchQuery } = useStore();
  const timerRef = useRef<number | null>(null);

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onSearch(value);
    }, 300);
  };

  return (
    <input
      type="text"
      value={searchQuery}
      onChange={(e) => handleSearch(e.target.value)}
      placeholder="搜索笔记..."
      className="search-input"
    />
  );
}
