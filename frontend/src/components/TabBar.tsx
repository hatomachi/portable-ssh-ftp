import React, { useState, useRef, useEffect } from 'react';
import { 
  Terminal, 
  FolderTree, 
  Copy, 
  X, 
  Plus, 
  Plug, 
  Loader2,
  Check
} from 'lucide-react';
import type { SessionTab } from '../types';

interface TabBarProps {
  tabs: SessionTab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onDuplicateTab: (tabId: string) => void;
  onNewConnection: () => void;
  onRenameTab: (tabId: string, newTitle: string) => void;
  isDuplicating: boolean;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onDuplicateTab,
  onNewConnection,
  onRenameTab,
  isDuplicating,
}) => {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTabId]);

  if (tabs.length === 0) {
    return null;
  }

  const startRename = (tab: SessionTab, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTabId(tab.id);
    setEditingTitle(tab.title);
  };

  const handleRenameSubmit = (tabId: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed && trimmed !== '') {
      onRenameTab(tabId, trimmed);
    }
    setEditingTabId(null);
  };

  const handleKeyDown = (tabId: string, e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit(tabId);
    } else if (e.key === 'Escape') {
      setEditingTabId(null);
    }
  };

  return (
    <div className="h-9 bg-slate-950 border-b border-slate-800/80 px-2 flex items-center justify-between select-none overflow-hidden">
      {/* Scrollable Tabs List */}
      <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar flex-1 mr-2">
        {tabs.map((tab, idx) => {
          const isActive = tab.id === activeTabId;
          const isEditing = editingTabId === tab.id;
          const isSSH = Boolean(tab.status.sshConnected);

          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onDoubleClick={(e) => startRename(tab, e)}
              className={`group relative flex items-center space-x-1.5 h-7 px-2.5 rounded-t-md text-xs font-medium cursor-pointer transition-all duration-150 border-t-2 ${
                isActive
                  ? 'bg-slate-900 text-slate-100 border-sky-500 shadow-sm'
                  : 'bg-slate-950/60 text-slate-400 border-transparent hover:bg-slate-900/60 hover:text-slate-300'
              }`}
            >
              {/* Tab Type Icon */}
              <div className="shrink-0">
                {isSSH ? (
                  <Terminal className={`w-3.5 h-3.5 ${isActive ? 'text-sky-400' : 'text-slate-500'}`} />
                ) : (
                  <FolderTree className={`w-3.5 h-3.5 ${isActive ? 'text-blue-400' : 'text-slate-500'}`} />
                )}
              </div>

              {/* Title or Inline Edit Input */}
              {isEditing ? (
                <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={inputRef}
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(tab.id, e)}
                    onBlur={() => handleRenameSubmit(tab.id)}
                    className="w-24 px-1 py-0.5 bg-slate-800 text-slate-100 rounded text-xs outline-hidden ring-1 ring-sky-500 font-mono"
                  />
                  <button
                    onClick={() => handleRenameSubmit(tab.id)}
                    className="p-0.5 text-emerald-400 hover:text-emerald-300"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <span 
                  className="truncate max-w-[130px] font-mono tracking-tight"
                  title={`${tab.title} (${tab.status.host || ''}) - ダブルクリックで名前変更`}
                >
                  {tab.title}
                </span>
              )}

              {/* Tab Sequence Index Badge */}
              <span className={`text-[10px] px-1 rounded font-mono ${
                isActive ? 'bg-slate-800 text-slate-400' : 'text-slate-600'
              }`}>
                #{idx + 1}
              </span>

              {/* Action Buttons (Duplicate & Close) */}
              <div className="flex items-center space-x-0.5 ml-1 opacity-60 group-hover:opacity-100 transition-opacity">
                {/* Duplicate Tab Icon */}
                <button
                  type="button"
                  title="このセッションを複製"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicateTab(tab.id);
                  }}
                  disabled={isDuplicating}
                  className="p-0.5 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800/80 transition-colors"
                >
                  <Copy className="w-3 h-3" />
                </button>

                {/* Close Tab Icon */}
                <button
                  type="button"
                  title="タブを閉じる (切断)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="p-0.5 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800/80 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}

        {/* Quick Duplicate Current Active Session (+) */}
        <button
          type="button"
          onClick={() => onDuplicateTab(activeTabId)}
          disabled={isDuplicating || !activeTabId}
          title="現在のセッションを複製して新規タブを開く"
          className="flex items-center space-x-1 h-6 px-2 rounded bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-sky-400 text-xs border border-slate-800 transition-all hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
        >
          {isDuplicating ? (
            <Loader2 className="w-3 h-3 animate-spin text-sky-400" />
          ) : (
            <Plus className="w-3 h-3 text-sky-400" />
          )}
          <span className="text-[11px] font-medium hidden sm:inline">複製</span>
        </button>
      </div>

      {/* Right Action: New Connection Button */}
      <div className="shrink-0 flex items-center space-x-1.5 border-l border-slate-800 pl-2">
        <button
          type="button"
          onClick={onNewConnection}
          title="新規ホストへ接続"
          className="flex items-center space-x-1 h-6 px-2 rounded bg-slate-850 hover:bg-slate-800 text-slate-300 hover:text-white text-xs border border-slate-700/60 transition-colors"
        >
          <Plug className="w-3 h-3 text-emerald-400" />
          <span className="text-[11px]">別ホスト接続</span>
        </button>
      </div>
    </div>
  );
};
