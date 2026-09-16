import React from 'react';
import { 
  Terminal, 
  FolderTree, 
  Columns, 
  Plug, 
  Unplug, 
  ShieldCheck 
} from 'lucide-react';
import type { SessionStatus } from '../types';

interface HeaderProps {
  status: SessionStatus;
  layout: 'split' | 'terminal' | 'ftp';
  onLayoutChange: (layout: 'split' | 'terminal' | 'ftp') => void;
  onOpenConnect: () => void;
  onDisconnect: () => void;
  isConnecting: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  layout,
  onLayoutChange,
  onOpenConnect,
  onDisconnect,
  isConnecting,
}) => {
  return (
    <header className="h-12 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between select-none">
      {/* Brand & Connection Info */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2 font-bold text-sky-400 text-sm tracking-wide">
          <div className="p-1 bg-sky-950/60 rounded border border-sky-800/40">
            <Terminal className="w-4 h-4 text-sky-400" />
          </div>
          <span>Portable SSH &amp; FTP</span>
        </div>

        {status.connected && status.host ? (
          <div className="flex items-center space-x-2 pl-3 border-l border-slate-800 text-xs">
            <span className="font-mono text-slate-300 font-medium px-2 py-0.5 rounded bg-slate-800">
              {status.host}
            </span>

            {/* SSH Badge */}
            <div className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
              status.sshConnected 
                ? 'bg-emerald-950/50 text-emerald-400 border-emerald-800/50' 
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}>
              <Terminal className="w-3 h-3" />
              <span>SSH:{status.sshPort || 22}</span>
            </div>

            {/* FTP Badge */}
            <div className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
              status.ftpConnected 
                ? 'bg-blue-950/50 text-blue-400 border-blue-800/50' 
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}>
              <FolderTree className="w-3 h-3" />
              <span>FTP:{status.ftpPort || 21}</span>
              {status.ftpCharset && (
                <span className="ml-1 px-1 bg-blue-900/50 rounded text-[9px] uppercase tracking-wider">
                  {status.ftpCharset}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="pl-3 border-l border-slate-800 flex items-center text-xs text-slate-400 space-x-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>未接続 (ポータブル動作中)</span>
          </div>
        )}
      </div>

      {/* Controls & Action Buttons */}
      <div className="flex items-center space-x-2">
        {/* Layout Switcher (when connected) */}
        {status.connected && (
          <div className="flex items-center bg-slate-800/80 p-0.5 rounded border border-slate-700/60 mr-2">
            <button
              title="2ペイン分割 (左右)"
              onClick={() => onLayoutChange('split')}
              className={`p-1 rounded text-xs transition-colors ${
                layout === 'split' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
            </button>
            <button
              title="FTPマネージャー最大化"
              onClick={() => onLayoutChange('ftp')}
              className={`p-1 rounded text-xs transition-colors ${
                layout === 'ftp' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5" />
            </button>
            <button
              title="SSHターミナル最大化"
              onClick={() => onLayoutChange('terminal')}
              className={`p-1 rounded text-xs transition-colors ${
                layout === 'terminal' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Connect / Disconnect Buttons */}
        {status.connected ? (
          <button
            onClick={onDisconnect}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-medium bg-red-950/40 text-red-400 border border-red-800/40 hover:bg-red-900/50 hover:text-red-300 transition-colors"
          >
            <Unplug className="w-3.5 h-3.5" />
            <span>切断</span>
          </button>
        ) : (
          <button
            onClick={onOpenConnect}
            disabled={isConnecting}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-medium bg-sky-600 text-white hover:bg-sky-500 shadow-sm transition-colors disabled:opacity-50"
          >
            <Plug className="w-3.5 h-3.5" />
            <span>{isConnecting ? '接続中...' : '接続設定'}</span>
          </button>
        )}
      </div>
    </header>
  );
};
