import React, { useState } from 'react';
import { 
  X, 
  Copy, 
  Check, 
  FileText, 
  AlertTriangle, 
  Terminal as TerminalIcon, 
  WrapText,
  Download
} from 'lucide-react';
import type { FilePreviewResponse } from '../types';

interface FilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  previewData: FilePreviewResponse | null;
  isLoading: boolean;
  error: string | null;
  onSendToTerminal?: (cmd: string) => void;
  downloadUrl?: string;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  isOpen,
  onClose,
  previewData,
  isLoading,
  error,
  onSendToTerminal,
  downloadUrl,
}) => {
  const [copied, setCopied] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (!previewData?.content) return;
    navigator.clipboard.writeText(previewData.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTerminalCat = () => {
    if (!previewData?.path || !onSendToTerminal) return;
    onSendToTerminal(`cat "${previewData.path}"\r`);
  };

  const handleTerminalTail = () => {
    if (!previewData?.path || !onSendToTerminal) return;
    onSendToTerminal(`tail -n 100 -f "${previewData.path}"\r`);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const lines = previewData?.content ? previewData.content.split('\n') : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none">
      <div 
        className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl flex flex-col w-full max-w-4xl h-[85vh] max-h-[800px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-14 px-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2.5 truncate mr-3">
            <div className="p-1.5 bg-sky-950/60 rounded border border-sky-800/40 text-sky-400">
              <FileText className="w-4 h-4" />
            </div>
            <div className="truncate">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-slate-200 text-sm font-mono truncate">
                  {previewData?.name || 'プレビュー'}
                </span>
                {previewData && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-mono">
                    {formatBytes(previewData.size)}
                  </span>
                )}
                {previewData?.truncated && (
                  <span className="flex items-center space-x-1 px-2 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/50 text-[10px] font-medium">
                    <AlertTriangle className="w-3 h-3" />
                    <span>先頭プレビュー (切り詰め)</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 font-mono truncate max-w-lg">
                {previewData?.path || ''}
              </p>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={() => setWordWrap(!wordWrap)}
              title={wordWrap ? '折り返しを解除' : '折り返しを有効化'}
              className={`p-1.5 rounded text-xs transition-colors flex items-center space-x-1 border ${
                wordWrap 
                  ? 'bg-slate-800 text-sky-400 border-slate-700' 
                  : 'text-slate-400 hover:text-slate-200 border-transparent'
              }`}
            >
              <WrapText className="w-4 h-4" />
              <span className="hidden sm:inline text-[11px]">折り返し</span>
            </button>

            <button
              onClick={handleCopy}
              disabled={!previewData?.content}
              title="プレビュー内容をクリップボードにコピー"
              className="px-2.5 py-1.5 rounded text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center space-x-1.5 disabled:opacity-40"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-medium text-[11px]">コピー完了</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[11px]">全コピー</span>
                </>
              )}
            </button>

            {downloadUrl && previewData && (
              <a
                href={downloadUrl}
                download={previewData.name}
                title="ローカルにダウンロード"
                className="px-2.5 py-1.5 rounded text-xs bg-sky-950/70 hover:bg-sky-900/80 text-sky-300 border border-sky-800/60 transition-colors flex items-center space-x-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium">ダウンロード</span>
              </a>
            )}

            {onSendToTerminal && previewData?.path && (
              <div className="hidden sm:flex items-center space-x-1 pl-1 border-l border-slate-800">
                <button
                  onClick={handleTerminalCat}
                  title="ターミナルで cat 実行"
                  className="p-1.5 rounded text-xs text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition-colors flex items-center space-x-1"
                >
                  <TerminalIcon className="w-3.5 h-3.5" />
                  <span className="text-[11px]">cat</span>
                </button>
                <button
                  onClick={handleTerminalTail}
                  title="ターミナルで tail -f 実行"
                  className="p-1.5 rounded text-xs text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors flex items-center space-x-1"
                >
                  <TerminalIcon className="w-3.5 h-3.5" />
                  <span className="text-[11px]">tail -f</span>
                </button>
              </div>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors ml-2"
              title="閉じる"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-auto bg-[#070b12] p-4 text-xs font-mono text-slate-200 select-text">
          {isLoading && (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-2">
              <div className="w-6 h-6 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
              <span>ファイルを読み込み中...</span>
            </div>
          )}

          {error && (
            <div className="m-4 p-4 rounded-lg bg-red-950/60 border border-red-800/60 text-red-300 text-xs">
              <p className="font-semibold mb-1">ファイル読み込みエラー</p>
              <p>{error}</p>
            </div>
          )}

          {!isLoading && !error && previewData && (
            <div className={`table w-full ${wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}>
              {lines.map((line, idx) => (
                <div key={idx} className="table-row hover:bg-slate-900/40">
                  <span className="table-cell select-none pr-4 text-right text-slate-600 w-12 shrink-0">
                    {idx + 1}
                  </span>
                  <span className="table-cell text-slate-300">
                    {line || ' '}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="h-8 px-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
          <span>{lines.length} 行</span>
          <span>{previewData ? `${formatBytes(previewData.size)} (先頭 ${formatBytes(previewData.content.length)} 取得)` : ''}</span>
        </div>
      </div>
    </div>
  );
};
