import React, { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  className?: string;
  initialValue?: string;
  debounceMs?: number;
}

const SearchBar: React.FC<SearchBarProps> = ({
  onSearch,
  placeholder = "Search movies...",
  className = "",
  initialValue = "",
  debounceMs = 300
}) => {
  const [query, setQuery] = useState(initialValue);
  const [isFocused, setIsFocused] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      onSearch(query);
    }, debounceMs);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, onSearch, debounceMs]);

  const handleClear = () => {
    setQuery('');
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (inputRef.current) {
        inputRef.current.blur();
      }
    }
  };

  return (
    <div className={`relative ${className}`}>
      <div
        className={`relative flex items-center bg-gray-800 rounded-lg transition-all duration-200 ${
          isFocused 
            ? 'ring-2 ring-blue-500 bg-gray-700' 
            : 'hover:bg-gray-700'
        }`}
      >
        <Search 
          size={20} 
          className="absolute left-3 text-gray-400 pointer-events-none" 
        />
        
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-3 bg-transparent text-white placeholder-gray-400 focus:outline-none"
          autoComplete="off"
          spellCheck="false"
        />
        
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-3 p-1 text-gray-400 hover:text-white transition-colors duration-200"
            type="button"
          >
            <X size={16} />
          </button>
        )}
      </div>
      
      {isFocused && query && (
        <div className="absolute top-full left-0 right-0 mt-1 text-xs text-gray-400 px-3">
          Press Enter to search or Escape to close
        </div>
      )}
    </div>
  );
};

export default SearchBar;