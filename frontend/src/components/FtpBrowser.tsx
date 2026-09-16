import React, { useState, useEffect, useRef } from 'react';
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
  AlertCircle
} from 'lucide-react';
import type { FileEntry } from '../types';
import { 
  listFtpFiles, 
  getFtpPwd, 
  getDownloadUrl, 
  uploadFtpFile, 
  deleteFtpItem, 
  createFtpDir 
} from '../api/client';

interface FtpBrowserProps {
  sessionId: string;
}

export const FtpBrowser: React.FC<FtpBrowserProps> = ({ sessionId }) => {
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDirName, setNewDirName] = useState('');
  const [isCreatingDir, setIsCreatingDir] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = async (targetPath: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listFtpFiles(sessionId, targetPath);
      // Sort: folders first, then files
      const sorted = [...data.entries].sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(sorted);
      setCurrentPath(data.path || targetPath);
    } catch (err: any) {
      setError(err.message || 'ディレクトリの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (sessionId) {
      // Get initial working directory or start at root
      getFtpPwd(sessionId)
        .then((pwd) => fetchFiles(pwd || '/'))
        .catch(() => fetchFiles('/'));
    }
  }, [sessionId]);

  const handleNavigate = (path: string) => {
    fetchFiles(path);
  };

  const handleGoUp = () => {
    if (currentPath === '/' || currentPath === '.') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parent = '/' + parts.join('/');
    fetchFiles(parent || '/');
  };

  const handleItemDoubleClick = (item: FileEntry) => {
    if (item.isDir) {
      handleNavigate(item.path);
    } else {
      // Trigger download
      window.open(getDownloadUrl(sessionId, item.path), '_blank');
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsLoading(true);
    setError(null);
    try {
      for (let i = 0; i < files.length; i++) {
        await uploadFtpFile(sessionId, currentPath, files[i]);
      }
      await fetchFiles(currentPath);
    } catch (err: any) {
      setError(err.message || 'アップロードに失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (item: FileEntry) => {
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

  const handleCreateDir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDirName.trim()) return;

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

  const pathParts = currentPath.split('/').filter(Boolean);

  return (
    <div 
      className="flex flex-col h-full w-full bg-slate-950 border-r border-slate-800 relative select-none"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFileUpload(e.dataTransfer.files);
      }}
    >
      {/* Drag & drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-30 bg-sky-950/80 border-2 border-dashed border-sky-400 flex flex-col items-center justify-center pointer-events-none backdrop-blur-xs">
          <Upload className="w-12 h-12 text-sky-400 animate-bounce mb-2" />
          <span className="text-sm font-semibold text-sky-200">ここにファイルをドロップしてアップロード</span>
        </div>
      )}

      {/* Top Toolbar */}
      <div className="h-10 px-3 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between space-x-2 text-xs">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center space-x-1 overflow-x-auto py-1 flex-1">
          <button
            onClick={handleGoUp}
            disabled={currentPath === '/' || currentPath === '.'}
            title="親フォルダへ移動"
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ArrowUp className="w-4 h-4" />
          </button>

          <button
            onClick={() => handleNavigate('/')}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 font-mono"
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
                  className="px-1.5 py-0.5 rounded text-slate-300 hover:text-sky-300 hover:bg-slate-800 font-mono truncate max-w-[120px]"
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
          <button
            onClick={() => setIsCreatingDir(true)}
            title="新規フォルダ作成"
            className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <FolderPlus className="w-4 h-4" />
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            title="ファイルをアップロード"
            className="p-1.5 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition-colors"
          >
            <Upload className="w-4 h-4" />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => handleFileUpload(e.target.files)}
            className="hidden"
            multiple
          />

          <button
            onClick={() => fetchFiles(currentPath)}
            title="再読み込み"
            className={`p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors ${
              isLoading ? 'animate-spin text-sky-400' : ''
            }`}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* New Directory Input Box */}
      {isCreatingDir && (
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

      {/* File List Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left text-xs text-slate-300 border-collapse">
          <thead className="sticky top-0 bg-slate-900 text-slate-400 border-b border-slate-800 text-[11px]">
            <tr>
              <th className="py-2 px-3 font-medium">名前</th>
              <th className="py-2 px-3 font-medium w-24 text-right">サイズ</th>
              <th className="py-2 px-3 font-medium w-36 text-right">更新日時</th>
              <th className="py-2 px-3 font-medium w-16 text-center">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900/60 font-mono">
            {entries.length === 0 && !isLoading && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-slate-500">
                  フォルダは空です（ファイルをドラッグ＆ドロップしてアップロード可能）
                </td>
              </tr>
            )}

            {entries.map((item) => (
              <tr
                key={item.path}
                onDoubleClick={() => handleItemDoubleClick(item)}
                className="hover:bg-slate-900/60 transition-colors group cursor-pointer"
              >
                <td className="py-1.5 px-3 flex items-center space-x-2 truncate">
                  {item.isDir ? (
                    <Folder className="w-4 h-4 text-sky-400 shrink-0" />
                  ) : (
                    <File className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <span className={`truncate ${item.isDir ? 'font-medium text-slate-200' : 'text-slate-300'}`}>
                    {item.name}
                  </span>
                </td>
                <td className="py-1.5 px-3 text-right text-slate-400 text-[11px]">
                  {item.isDir ? '-' : formatBytes(item.size)}
                </td>
                <td className="py-1.5 px-3 text-right text-slate-500 text-[11px]">
                  {formatTime(item.modTime)}
                </td>
                <td className="py-1.5 px-3 text-center">
                  <div className="flex items-center justify-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!item.isDir && (
                      <a
                        href={getDownloadUrl(sessionId, item.path)}
                        download={item.name}
                        title="ダウンロード"
                        className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item);
                      }}
                      title="削除"
                      className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer Info */}
      <div className="h-6 px-3 border-t border-slate-800 bg-slate-900/40 flex items-center justify-between text-[11px] text-slate-500">
        <span>{entries.length} 項目</span>
        <span className="truncate max-w-xs">{currentPath}</span>
      </div>
    </div>
  );
};
