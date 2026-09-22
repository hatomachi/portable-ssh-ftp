import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Folder, 
  FolderPlus, 
  Upload, 
  RefreshCw, 
  ArrowUp, 
  Download, 
  Trash2, 
  File, 
  ChevronRight, 
  HardDrive, 
  AlertCircle, 
  Copy, 
  Check, 
  Terminal as TerminalIcon, 
  Eye, 
  Edit3,
  ArrowUpDown, 
  ArrowUp as ArrowUpSort, 
  ArrowDown as ArrowDownSort, 
  CornerDownRight 
} from 'lucide-react';
import type { FileEntry, FileReadResponse } from '../types';
import { 
  listFtpFiles, 
  getFtpPwd, 
  getDownloadUrl, 
  uploadFtpFile, 
  deleteFtpItem, 
  createFtpDir, 
  fetchSshFiles, 
  readRemoteFile,
  uploadSshFile,
  getSshDownloadUrl
} from '../api/client';
import { FileEditorModal } from './FileEditorModal';
import { updateExplorerContext } from '../utils/aiContextManager';

interface RemoteExplorerProps {
  sessionId: string;
  sshConnected?: boolean;
  ftpConnected?: boolean;
  onSendToTerminal?: (text: string) => void;
}

type SortField = 'name' | 'size' | 'modTime';
type SortOrder = 'asc' | 'desc';

export const RemoteExplorer: React.FC<RemoteExplorerProps> = ({
  sessionId,
  sshConnected = false,
  ftpConnected = false,
  onSendToTerminal,
}) => {
  // Protocol mode: prefer SSH if available, otherwise FTP
  const [mode, setMode] = useState<'ssh' | 'ftp'>(() => {
    if (sshConnected) return 'ssh';
    if (ftpConnected) return 'ftp';
    return 'ssh';
  });

  // Current paths per mode
  const [sshPath, setSshPath] = useState<string>('');
  const [ftpPath, setFtpPath] = useState<string>('/');
  const currentPath = mode === 'ssh' ? sshPath : ftpPath;

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sorting
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Upload & Drag drop
  const [newDirName, setNewDirName] = useState('');
  const [isCreatingDir, setIsCreatingDir] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [uploadingStatus, setUploadingStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Copy path feedback
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // File editor & preview modal
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [fileData, setFileData] = useState<FileReadResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Compact layout detection for narrow widths (< 380px)
  const explorerRootRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    if (!explorerRootRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsCompact(entry.contentRect.width < 380);
      }
    });
    ro.observe(explorerRootRef.current);
    return () => ro.disconnect();
  }, []);

  // Send input to terminal helper
  const sendToTerminal = (text: string) => {
    if (onSendToTerminal) {
      onSendToTerminal(text);
    } else {
      window.dispatchEvent(new CustomEvent('terminal:send', { detail: text }));
    }
  };

  // Sync mode when connections change
  useEffect(() => {
    if (mode === 'ssh' && !sshConnected && ftpConnected) {
      setMode('ftp');
    } else if (mode === 'ftp' && !ftpConnected && sshConnected) {
      setMode('ssh');
    }
  }, [sshConnected, ftpConnected, mode]);

  // Fetch files
  const fetchFiles = async (targetPath: string, protocolMode: 'ssh' | 'ftp' = mode) => {
    setIsLoading(true);
    setError(null);
    try {
      if (protocolMode === 'ssh') {
        const data = await fetchSshFiles(sessionId, targetPath);
        const entries = data.entries || [];
        setEntries(entries);
        const resolved = data.path || targetPath;
        setSshPath(resolved);
        window.dispatchEvent(new CustomEvent('explorer:path', { detail: { sessionId, path: resolved } }));
        updateExplorerContext(sessionId, resolved, entries);
      } else {
        const data = await listFtpFiles(sessionId, targetPath);
        const entries = data.entries || [];
        setEntries(entries);
        const resolved = data.path || targetPath;
        setFtpPath(resolved);
        window.dispatchEvent(new CustomEvent('explorer:path', { detail: { sessionId, path: resolved } }));
        updateExplorerContext(sessionId, resolved, entries);
      }
    } catch (err: any) {
      setError(err.message || 'ファイル一覧の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load or mode switch
  useEffect(() => {
    if (!sessionId) return;
    if (mode === 'ssh' && sshConnected) {
      fetchFiles(sshPath, 'ssh');
    } else if (mode === 'ftp' && ftpConnected) {
      if (!ftpPath || ftpPath === '/') {
        getFtpPwd(sessionId)
          .then((pwd) => fetchFiles(pwd || '/', 'ftp'))
          .catch(() => fetchFiles('/', 'ftp'));
      } else {
        fetchFiles(ftpPath, 'ftp');
      }
    }
  }, [sessionId, mode]);

  // Listen for session reconnected or external refresh (e.g. terminal drop)
  useEffect(() => {
    const handleReconnected = (e: Event) => {
      const customEvent = e as CustomEvent<{ sessionId: string }>;
      if (customEvent.detail?.sessionId === sessionId) {
        if (mode === 'ssh') {
          fetchFiles(sshPath, 'ssh');
        } else if (mode === 'ftp') {
          fetchFiles(ftpPath, 'ftp');
        }
      }
    };
    const handleRefresh = (e: Event) => {
      const customEvent = e as CustomEvent<{ sessionId?: string }>;
      if (!customEvent.detail?.sessionId || customEvent.detail.sessionId === sessionId) {
        fetchFiles(currentPath, mode);
      }
    };

    window.addEventListener('session:reconnected', handleReconnected);
    window.addEventListener('explorer:refresh', handleRefresh);
    return () => {
      window.removeEventListener('session:reconnected', handleReconnected);
      window.removeEventListener('explorer:refresh', handleRefresh);
    };
  }, [sessionId, mode, sshPath, ftpPath, currentPath]);

  // Navigate
  const handleNavigate = (path: string) => {
    fetchFiles(path, mode);
  };

  const handleGoUp = () => {
    if (!currentPath || currentPath === '/' || currentPath === '.') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parent = '/' + parts.join('/');
    handleNavigate(parent || '/');
  };

  // Sort entries: directories always first, then by field
  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;

      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      } else if (sortField === 'size') {
        cmp = a.size - b.size;
      } else if (sortField === 'modTime') {
        const timeA = new Date(a.modTime).getTime() || 0;
        const timeB = new Date(b.modTime).getTime() || 0;
        cmp = timeA - timeB;
      }

      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [entries, sortField, sortOrder]);

  const handleSortToggle = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Open File for Preview & Editing
  const handleOpenFile = async (item: FileEntry) => {
    if (item.isDir) return;
    setFileModalOpen(true);
    setFileLoading(true);
    setFileError(null);
    setFileData(null);

    try {
      const data = await readRemoteFile(sessionId, item.path, mode);
      setFileData(data);
    } catch (err: any) {
      setFileError(err.message || 'ファイルの読み込みに失敗しました');
    } finally {
      setFileLoading(false);
    }
  };

  const handleItemDoubleClick = (item: FileEntry) => {
    if (item.isDir) {
      handleNavigate(item.path);
    } else {
      handleOpenFile(item);
    }
  };

  // Copy path
  const handleCopyPath = (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  // Insert path to terminal
  const handleInsertPathToTerminal = (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    sendToTerminal(`"${path}" `);
  };

  // Send cd command to terminal
  const handleCdToDirectory = (targetDir: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    sendToTerminal(`cd "${targetDir}"\r`);
  };

  // File Upload (SSH & FTP)
  const handleFileUpload = async (files: FileList | null, destinationDir?: string) => {
    if (!files || files.length === 0) return;
    const targetDir = destinationDir || currentPath || '.';
    setIsLoading(true);
    setError(null);
    setUploadingStatus(`${files.length} 個のファイルをアップロード中...`);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadingStatus(`アップロード中 (${i + 1}/${files.length}): ${file.name}`);
        if (mode === 'ssh') {
          await uploadSshFile(sessionId, targetDir, file);
        } else {
          await uploadFtpFile(sessionId, targetDir, file);
        }
      }
      await fetchFiles(currentPath);
    } catch (err: any) {
      setError(err.message || 'アップロードに失敗しました');
    } finally {
      setIsLoading(false);
      setUploadingStatus(null);
      setDragOverFolder(null);
    }
  };

  // FTP Delete
  const handleDelete = async (item: FileEntry, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const confirmMsg = item.isDir 
      ? `フォルダ「${item.name}」とその中身を削除しますか？` 
      : `ファイル「${item.name}」を削除しますか？`;
    if (!window.confirm(confirmMsg)) return;

    setIsLoading(true);
    setError(null);
    try {
      await deleteFtpItem(sessionId, item.path, item.isDir);
      await fetchFiles(currentPath);
    } catch (err: any) {
      setError(err.message || '削除に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  // FTP Mkdir
  const handleCreateDir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDirName.trim() || mode !== 'ftp') return;

    setIsLoading(true);
    setError(null);
    try {
      const target = currentPath === '/' 
        ? `/${newDirName.trim()}` 
        : `${currentPath}/${newDirName.trim()}`;
      await createFtpDir(sessionId, target);
      setNewDirName('');
      setIsCreatingDir(false);
      await fetchFiles(currentPath);
    } catch (err: any) {
      setError(err.message || 'フォルダ作成に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatTime = (timeStr: string): string => {
    if (!timeStr) return '-';
    try {
      const d = new Date(timeStr);
      if (isNaN(d.getTime())) return timeStr;
      return d.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return timeStr;
    }
  };

  const pathParts = currentPath ? currentPath.split('/').filter(Boolean) : [];

  return (
    <div 
      ref={explorerRootRef}
      className="flex flex-col h-full w-full bg-slate-950 border-r border-slate-800 relative select-none"
      onDragOver={(e) => { 
        e.preventDefault(); 
        setIsDragging(true); 
      }}
      onDragLeave={(e) => {
        // Only set isDragging false if leaving the container
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragging(false);
          setDragOverFolder(null);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        setDragOverFolder(null);
        handleFileUpload(e.dataTransfer.files, currentPath);
      }}
    >
      {/* Drag & drop overlay (SSH & FTP) */}
      {isDragging && !dragOverFolder && (
        <div className="absolute inset-0 z-30 bg-sky-950/85 border-2 border-dashed border-sky-400 flex flex-col items-center justify-center pointer-events-none backdrop-blur-xs">
          <Upload className="w-12 h-12 text-sky-400 animate-bounce mb-2" />
          <span className="text-sm font-semibold text-sky-200">
            ここにドロップして {mode === 'ssh' ? 'SCP/SFTP' : 'FTP'} アップロード
          </span>
          <span className="text-xs text-sky-300/80 font-mono mt-1">
            宛先: {currentPath || '/'}
          </span>
        </div>
      )}

      {/* Uploading progress notification banner */}
      {uploadingStatus && (
        <div className="absolute top-2 left-3 right-3 z-40 bg-sky-950/90 border border-sky-600 rounded-lg px-3 py-2 text-xs text-sky-200 flex items-center space-x-2 shadow-lg animate-pulse">
          <RefreshCw className="w-4 h-4 animate-spin text-sky-400 shrink-0" />
          <span className="font-mono flex-1 truncate">{uploadingStatus}</span>
        </div>
      )}

      {/* Protocol Mode Switcher (if both SSH and FTP are active) */}
      {sshConnected && ftpConnected && (
        <div className="h-8 px-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setMode('ssh')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center space-x-1.5 transition-colors ${
                mode === 'ssh' 
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <TerminalIcon className="w-3 h-3 text-emerald-400" />
              <span>{isCompact ? 'SSH' : 'SSH Explorer'}</span>
            </button>
            <button
              onClick={() => setMode('ftp')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center space-x-1.5 transition-colors ${
                mode === 'ftp' 
                  ? 'bg-blue-950 text-blue-300 border border-blue-800/60' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <HardDrive className="w-3 h-3 text-blue-400" />
              <span>{isCompact ? 'FTP' : 'FTP Explorer'}</span>
            </button>
          </div>
          {!isCompact && (
            <span className="text-[10px] text-slate-500 font-mono">
              {mode === 'ssh' ? 'SSH (Port 22)' : 'FTP (Port 21)'}
            </span>
          )}
        </div>
      )}

      {/* Top Toolbar */}
      <div className="h-10 px-2.5 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between space-x-1.5 text-xs">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center space-x-1 overflow-x-auto py-1 flex-1 min-w-0">
          <button
            onClick={handleGoUp}
            disabled={!currentPath || currentPath === '/' || currentPath === '.'}
            title="親フォルダへ移動"
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent shrink-0"
          >
            <ArrowUp className="w-4 h-4" />
          </button>

          <button
            onClick={() => handleNavigate('/')}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 font-mono shrink-0"
            title="ルートディレクトリへ移動"
          >
            <HardDrive className="w-3.5 h-3.5 text-slate-400" />
            <span>/</span>
          </button>

          {pathParts.map((part, index) => {
            const subPath = '/' + pathParts.slice(0, index + 1).join('/');
            return (
              <React.Fragment key={subPath}>
                <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
                <button
                  onClick={() => handleNavigate(subPath)}
                  className={`px-1.5 py-0.5 rounded text-slate-300 hover:text-sky-300 hover:bg-slate-800 font-mono truncate ${
                    isCompact ? 'max-w-[70px]' : 'max-w-[120px]'
                  }`}
                  title={part}
                >
                  {part}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="flex items-center space-x-1 shrink-0">
          {/* Quick Terminal cd to current path */}
          {sshConnected && currentPath && (
            <button
              onClick={() => handleCdToDirectory(currentPath)}
              title="ターミナルでこのディレクトリへ移動 (cd)"
              className="p-1.5 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors flex items-center space-x-1"
            >
              <CornerDownRight className="w-3.5 h-3.5 text-emerald-400" />
              <span className={`${isCompact ? 'hidden' : 'hidden lg:inline'} text-[10px] text-emerald-400 font-mono`}>cd</span>
            </button>
          )}

          {/* Copy current path */}
          {currentPath && (
            <button
              onClick={(e) => handleCopyPath(currentPath, e)}
              title="現在のパスをコピー"
              className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              {copiedPath === currentPath ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* FTP specific: Create folder */}
          {mode === 'ftp' && (
            <button
              onClick={() => setIsCreatingDir(true)}
              title="新規フォルダ作成"
              className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          )}

          {/* Upload button (SSH & FTP) */}
          <button
            onClick={() => fileInputRef.current?.click()}
            title={mode === 'ssh' ? "ローカルファイルをSCP/SFTPアップロード" : "ローカルファイルをFTPアップロード"}
            className="p-1.5 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition-colors flex items-center space-x-1"
          >
            <Upload className="w-4 h-4" />
            <span className={`${isCompact ? 'hidden' : 'hidden sm:inline'} text-[10px] text-sky-400 font-medium`}>Upload</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => handleFileUpload(e.target.files, currentPath)}
            className="hidden"
            multiple
          />

          {/* Refresh button */}
          <button
            onClick={() => fetchFiles(currentPath, mode)}
            title="再読み込み"
            className={`p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors ${
              isLoading ? 'animate-spin text-sky-400' : ''
            }`}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* New Directory Input Box (FTP) */}
      {isCreatingDir && mode === 'ftp' && (
        <form onSubmit={handleCreateDir} className="p-2 border-b border-slate-800 bg-slate-900/90 flex items-center space-x-2 text-xs">
          <FolderPlus className="w-4 h-4 text-sky-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={newDirName}
            onChange={(e) => setNewDirName(e.target.value)}
            placeholder="新しいフォルダ名"
            className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 focus:outline-hidden focus:border-sky-500 font-mono text-xs"
          />
          <button
            type="submit"
            className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded font-medium text-xs"
          >
            作成
          </button>
          <button
            type="button"
            onClick={() => { setIsCreatingDir(false); setNewDirName(''); }}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs"
          >
            キャンセル
          </button>
        </form>
      )}

      {/* Error alert */}
      {error && (
        <div className="m-2 p-2.5 bg-red-950/60 border border-red-800/60 rounded text-red-300 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          <span className="flex-1 truncate">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200">×</button>
        </div>
      )}

      {/* File List Table with Sorting */}
      <div className="flex-1 overflow-y-auto overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-300 border-collapse">
          <thead className="sticky top-0 bg-slate-900 text-slate-400 border-b border-slate-800 text-[11px] select-none">
            <tr>
              <th 
                className="py-2 px-3 font-medium cursor-pointer hover:text-slate-200"
                onClick={() => handleSortToggle('name')}
              >
                <div className="flex items-center space-x-1">
                  <span>名前</span>
                  {sortField === 'name' ? (
                    sortOrder === 'asc' ? <ArrowUpSort className="w-3 h-3 text-sky-400" /> : <ArrowDownSort className="w-3 h-3 text-sky-400" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-slate-600" />
                  )}
                </div>
              </th>
              <th 
                className={`py-2 ${isCompact ? 'px-2 w-16' : 'px-3 w-24'} font-medium text-right cursor-pointer hover:text-slate-200`}
                onClick={() => handleSortToggle('size')}
              >
                <div className="flex items-center justify-end space-x-1">
                  <span>サイズ</span>
                  {sortField === 'size' ? (
                    sortOrder === 'asc' ? <ArrowUpSort className="w-3 h-3 text-sky-400" /> : <ArrowDownSort className="w-3 h-3 text-sky-400" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-slate-600" />
                  )}
                </div>
              </th>
              {!isCompact && (
                <th 
                  className="py-2 px-3 font-medium w-36 text-right cursor-pointer hover:text-slate-200"
                  onClick={() => handleSortToggle('modTime')}
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>更新日時</span>
                    {sortField === 'modTime' ? (
                      sortOrder === 'asc' ? <ArrowUpSort className="w-3 h-3 text-sky-400" /> : <ArrowDownSort className="w-3 h-3 text-sky-400" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 text-slate-600" />
                    )}
                  </div>
                </th>
              )}
              <th className={`py-2 ${isCompact ? 'px-1.5 w-16' : 'px-3 w-24'} font-medium text-center`}>操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900/60 font-mono">
            {sortedEntries.length === 0 && !isLoading && (
              <tr>
                <td colSpan={isCompact ? 3 : 4} className="py-8 text-center text-slate-500">
                  {mode === 'ftp' ? 'フォルダは空です（ファイルをドロップしてアップロード可能）' : 'ディレクトリは空です'}
                </td>
              </tr>
            )}

            {sortedEntries.map((item) => {
              const isItemCopied = copiedPath === item.path;
              const isFolderDropTarget = dragOverFolder === item.path;

              return (
                <tr
                  key={item.path}
                  onDoubleClick={() => handleItemDoubleClick(item)}
                  onDragOver={(e) => {
                    if (item.isDir) {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverFolder(item.path);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (item.isDir) {
                      e.stopPropagation();
                      if (dragOverFolder === item.path) {
                        setDragOverFolder(null);
                      }
                    }
                  }}
                  onDrop={(e) => {
                    if (item.isDir) {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverFolder(null);
                      setIsDragging(false);
                      handleFileUpload(e.dataTransfer.files, item.path);
                    }
                  }}
                  className={`transition-colors group cursor-pointer ${
                    isFolderDropTarget 
                      ? 'bg-sky-900/80 ring-2 ring-sky-400 text-sky-200 font-semibold' 
                      : 'hover:bg-slate-900/60'
                  }`}
                >
                  <td className="py-1.5 px-3 flex items-center space-x-2 truncate">
                    {item.isDir ? (
                      <Folder className={`w-4 h-4 shrink-0 ${isFolderDropTarget ? 'text-sky-300 animate-pulse' : 'text-sky-400'}`} />
                    ) : (
                      <File className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <span 
                      className={`truncate ${item.isDir ? 'font-medium text-slate-200' : 'text-slate-300'}`}
                      title={item.name}
                    >
                      {item.name}
                    </span>
                  </td>
                  <td className={`py-1.5 ${isCompact ? 'px-2' : 'px-3'} text-right text-slate-400 text-[11px] whitespace-nowrap`}>
                    {item.isDir ? '-' : formatBytes(item.size)}
                  </td>
                  {!isCompact && (
                    <td className="py-1.5 px-3 text-right text-slate-500 text-[11px] whitespace-nowrap">
                      {formatTime(item.modTime)}
                    </td>
                  )}
                  <td className={`py-1.5 ${isCompact ? 'px-1.5' : 'px-3'} text-center`}>
                    <div className="flex items-center justify-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* Copy Path */}
                      <button
                        onClick={(e) => handleCopyPath(item.path, e)}
                        title="パスをコピー"
                        className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                      >
                        {isItemCopied ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {/* Insert path to terminal */}
                      {sshConnected && (
                        <button
                          onClick={(e) => handleInsertPathToTerminal(item.path, e)}
                          title="ターミナルへパス挿入"
                          className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800"
                        >
                          <TerminalIcon className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* cd to directory in terminal */}
                      {sshConnected && item.isDir && (
                        <button
                          onClick={(e) => handleCdToDirectory(item.path, e)}
                          title="ここで cd"
                          className="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-800"
                        >
                          <CornerDownRight className="w-3.5 h-3.5 text-emerald-400" />
                        </button>
                      )}

                      {/* View & Edit for files */}
                      {!item.isDir && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleOpenFile(item); }}
                            title="編集 / プレビュー"
                            className="p-1 rounded text-slate-400 hover:text-amber-400 hover:bg-slate-800"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {!isCompact && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleOpenFile(item); }}
                              title="プレビュー"
                              className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      )}

                      {/* Download (SSH & FTP) */}
                      {!item.isDir && (
                        <a
                          href={mode === 'ssh' ? getSshDownloadUrl(sessionId, item.path) : getDownloadUrl(sessionId, item.path)}
                          download={item.name}
                          title={mode === 'ssh' ? "ローカルへダウンロード (SCP/SFTP)" : "ローカルへダウンロード (FTP)"}
                          className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      )}

                      {/* Delete for FTP */}
                      {mode === 'ftp' && (
                        <button
                          onClick={(e) => handleDelete(item, e)}
                          title="削除"
                          className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Info */}
      <div className="h-6 px-3 border-t border-slate-800 bg-slate-900/40 flex items-center justify-between text-[11px] text-slate-500">
        <div className="flex items-center space-x-2 shrink-0">
          <span>{entries.length} 項目</span>
          <span className="text-slate-700">|</span>
          <span className="font-mono text-slate-400">{mode.toUpperCase()}</span>
        </div>
        <span className={`truncate ${isCompact ? 'max-w-[120px]' : 'max-w-xs'} font-mono`}>{currentPath || '/'}</span>
      </div>

      {/* File Editor & Preview Modal with Safety Guards */}
      <FileEditorModal
        isOpen={fileModalOpen}
        onClose={() => setFileModalOpen(false)}
        fileData={fileData}
        isLoading={fileLoading}
        error={fileError}
        sessionId={sessionId}
        protocol={mode}
        onSendToTerminal={sendToTerminal}
        downloadUrl={fileData?.path ? (mode === 'ssh' ? getSshDownloadUrl(sessionId, fileData.path) : getDownloadUrl(sessionId, fileData.path)) : undefined}
        onSaved={() => fetchFiles(currentPath, mode)}
      />
    </div>
  );
};
