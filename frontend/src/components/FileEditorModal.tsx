import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  X, 
  Copy, 
  Check, 
  FileText, 
  AlertTriangle, 
  Terminal as TerminalIcon, 
  WrapText,
  Download,
  Save,
  Edit3,
  Eye,
  ShieldCheck,
  RotateCcw,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import type { FileReadResponse, LineEnding } from '../types';
import { saveRemoteFile } from '../api/client';

interface FileEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileData: FileReadResponse | null;
  isLoading: boolean;
  error: string | null;
  sessionId: string;
  protocol: 'ssh' | 'ftp';
  onSendToTerminal?: (cmd: string) => void;
  downloadUrl?: string;
  onSaved?: () => void;
}

export const FileEditorModal: React.FC<FileEditorModalProps> = ({
  isOpen,
  onClose,
  fileData,
  isLoading,
  error,
  sessionId,
  protocol,
  onSendToTerminal,
  downloadUrl,
  onSaved,
}) => {
  // Tabs: 'preview' or 'edit'
  const [activeTab, setActiveTab] = useState<'preview' | 'edit'>('preview');

  // Content state
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const isDirty = useMemo(() => content !== originalContent, [content, originalContent]);

  // Guard states: Line Ending & Encoding & Backup
  const [lineEnding, setLineEnding] = useState<LineEnding>('LF');
  const [charset, setCharset] = useState<string>('UTF-8');
  const [createBackup, setCreateBackup] = useState<boolean>(true);

  // Editor states
  const [wordWrap, setWordWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Confirmation & status dialogs
  const [showDiffConfirm, setShowDiffConfirm] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<{ path: string; backupPath?: string } | null>(null);

  // Reset states when fileData changes or modal opens
  useEffect(() => {
    if (fileData) {
      const initial = fileData.content || '';
      setContent(initial);
      setOriginalContent(initial);
      setCharset(fileData.charset || 'UTF-8');
      
      // Determine default line ending: preserve original if known, otherwise default to LF
      if (fileData.lineEnding === 'CRLF') {
        setLineEnding('CRLF');
      } else {
        setLineEnding('LF');
      }

      // If editable, default to preview first, but user can easily switch
      setActiveTab('preview');
      setSaveError(null);
      setSaveSuccessNotice(null);
      setShowDiffConfirm(false);
      setShowDiscardConfirm(false);
    }
  }, [fileData, isOpen]);

  // Handle Ctrl+S / Cmd+S in edit mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeTab === 'edit' && isDirty && fileData?.editable) {
          setShowDiffConfirm(true);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleRequestClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeTab, isDirty, fileData]);

  if (!isOpen) return null;

  const handleRequestClose = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTerminalCat = () => {
    if (!fileData?.path || !onSendToTerminal) return;
    onSendToTerminal(`cat "${fileData.path}"\r`);
  };

  const handleTerminalTail = () => {
    if (!fileData?.path || !onSendToTerminal) return;
    onSendToTerminal(`tail -n 100 -f "${fileData.path}"\r`);
  };

  // Tab key indents in textarea
  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const spaces = '  '; // 2 spaces

      const newContent = content.substring(0, start) + spaces + content.substring(end);
      setContent(newContent);

      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + spaces.length;
      }, 0);
    }
  };

  // Update cursor position line & col
  const handleCursorMove = () => {
    if (!textareaRef.current) return;
    const pos = textareaRef.current.selectionStart;
    const textBefore = content.substring(0, pos);
    const lines = textBefore.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    setCursorPos({ line, col });
  };

  // Save execution
  const executeSave = async () => {
    if (!fileData) return;
    setIsSaving(true);
    setSaveError(null);

    try {
      const res = await saveRemoteFile(sessionId, protocol, {
        path: fileData.path,
        content,
        lineEnding,
        charset,
        createBackup,
      });

      // Update original content to reflect saved state
      setOriginalContent(content);
      setShowDiffConfirm(false);
      setSaveSuccessNotice({
        path: res.path,
        backupPath: res.backupPath,
      });

      // Notify parent to refresh file list
      if (onSaved) onSaved();
      window.dispatchEvent(new CustomEvent('explorer:refresh', { detail: { sessionId } }));

      // Auto dismiss success notice after 5 seconds
      setTimeout(() => {
        setSaveSuccessNotice(null);
      }, 5000);
    } catch (err: any) {
      setSaveError(err.message || '保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // Calculate simple diff metrics
  const diffMetrics = useMemo(() => {
    const origLines = originalContent ? originalContent.split('\n') : [];
    const newLines = content ? content.split('\n') : [];
    let added = 0;
    let modified = 0;
    let deleted = 0;

    const maxLen = Math.max(origLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (i >= origLines.length) {
        added++;
      } else if (i >= newLines.length) {
        deleted++;
      } else if (origLines[i] !== newLines[i]) {
        modified++;
      }
    }

    return { origLines: origLines.length, newLines: newLines.length, added, modified, deleted };
  }, [originalContent, content]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const previewLines = content ? content.split('\n') : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 select-none animate-fade-in">
      <div 
        className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl flex flex-col w-full max-w-5xl h-[90vh] max-h-[900px] overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-14 px-4 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3 truncate mr-3">
            <div className={`p-1.5 rounded border ${
              activeTab === 'edit'
                ? 'bg-amber-950/60 border-amber-800/50 text-amber-400' 
                : 'bg-sky-950/60 border-sky-800/40 text-sky-400'
            }`}>
              {activeTab === 'edit' ? <Edit3 className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
            </div>

            <div className="truncate">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-slate-200 text-sm font-mono truncate">
                  {fileData?.name || 'ファイル'}
                </span>

                {isDirty && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-700/60 text-[10px] font-semibold flex items-center space-x-1 animate-pulse">
                    <span>未保存の変更あり</span>
                  </span>
                )}

                {fileData && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-mono">
                    {formatBytes(fileData.size)}
                  </span>
                )}

                {fileData?.truncated && (
                  <span className="flex items-center space-x-1 px-2 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/50 text-[10px] font-medium">
                    <AlertTriangle className="w-3 h-3" />
                    <span>先頭プレビュー (2MB超・編集不可)</span>
                  </span>
                )}

                {fileData?.isBinary && (
                  <span className="flex items-center space-x-1 px-2 py-0.5 rounded bg-red-950/60 text-red-300 border border-red-800/50 text-[10px] font-medium">
                    <AlertCircle className="w-3 h-3" />
                    <span>バイナリファイル (編集不可)</span>
                  </span>
                )}
              </div>

              <p className="text-[11px] text-slate-500 font-mono truncate max-w-xl">
                {fileData?.path || ''}
              </p>
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg p-0.5 mr-2">
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
                activeTab === 'preview'
                  ? 'bg-slate-800 text-sky-300 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>プレビュー</span>
            </button>
            <button
              onClick={() => {
                if (fileData?.editable) {
                  setActiveTab('edit');
                }
              }}
              disabled={!fileData?.editable}
              title={!fileData?.editable ? (fileData?.readonlyReason || '編集できません') : '編集モードに切り替え'}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
                activeTab === 'edit'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : fileData?.editable
                    ? 'text-slate-400 hover:text-amber-300'
                    : 'text-slate-600 cursor-not-allowed'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>編集</span>
            </button>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center space-x-2 shrink-0">
            {/* Word wrap toggle */}
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
            </button>

            {/* Copy button */}
            <button
              onClick={handleCopy}
              disabled={!content}
              title="内容をクリップボードにコピー"
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

            {/* Save Button (in edit mode) */}
            {activeTab === 'edit' && fileData?.editable && (
              <button
                onClick={() => setShowDiffConfirm(true)}
                disabled={!isDirty || isSaving}
                title={isDirty ? "変更を保存 (Ctrl+S)" : "変更はありません"}
                className="px-3 py-1.5 rounded text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-sm transition-all flex items-center space-x-1.5 disabled:opacity-40 disabled:hover:bg-emerald-600"
              >
                <Save className="w-3.5 h-3.5" />
                <span>保存</span>
                <span className="text-[10px] opacity-75 hidden sm:inline">(Ctrl+S)</span>
              </button>
            )}

            {/* Download */}
            {downloadUrl && fileData && (
              <a
                href={downloadUrl}
                download={fileData.name}
                title="ローカルにダウンロード"
                className="px-2.5 py-1.5 rounded text-xs bg-sky-950/70 hover:bg-sky-900/80 text-sky-300 border border-sky-800/60 transition-colors flex items-center space-x-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium hidden md:inline">ダウンロード</span>
              </a>
            )}

            {/* Terminal integration */}
            {onSendToTerminal && fileData?.path && (
              <div className="hidden lg:flex items-center space-x-1 pl-1 border-l border-slate-800">
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

            {/* Close Button */}
            <button
              onClick={handleRequestClose}
              className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors ml-2"
              title="閉じる (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Guard & Status Notification Banner */}
        {saveSuccessNotice && (
          <div className="px-4 py-2 bg-emerald-950/90 border-b border-emerald-700/60 text-emerald-200 text-xs flex items-center justify-between animate-fade-in">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>ファイルを正常に保存しました。</span>
              {saveSuccessNotice.backupPath && (
                <span className="font-mono text-emerald-300 text-[11px] bg-emerald-900/60 px-2 py-0.5 rounded border border-emerald-700/40">
                  バックアップ作成: {saveSuccessNotice.backupPath}
                </span>
              )}
            </div>
            <button 
              onClick={() => setSaveSuccessNotice(null)}
              className="text-emerald-400 hover:text-emerald-200 text-sm font-bold"
            >
              ×
            </button>
          </div>
        )}

        {/* Warning if line endings were mixed */}
        {fileData?.lineEnding === 'Mixed' && activeTab === 'edit' && (
          <div className="px-4 py-1.5 bg-amber-950/70 border-b border-amber-800/60 text-amber-200 text-xs flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                元ファイルの改行コードが混在（Mixed: LF/CRLF）しています。Linux環境での安全のため、保存時に「LF」への統一を推奨します。
              </span>
            </div>
            <button
              onClick={() => setLineEnding('LF')}
              className="px-2 py-0.5 rounded bg-amber-800/70 hover:bg-amber-700 text-amber-100 text-[11px] font-medium transition-colors"
            >
              LFに統一
            </button>
          </div>
        )}

        {/* Guard Toolbar in Edit Mode: Line Ending & Encoding selectors */}
        {activeTab === 'edit' && (
          <div className="h-9 px-4 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between text-xs text-slate-400">
            <div className="flex items-center space-x-4">
              {/* Line Ending selector */}
              <div className="flex items-center space-x-1.5">
                <span className="text-[11px] text-slate-500 font-medium">改行コードガード:</span>
                <select
                  value={lineEnding}
                  onChange={(e) => setLineEnding(e.target.value as LineEnding)}
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-hidden focus:border-sky-500 font-mono"
                >
                  <option value="LF">LF (\n, Linux/Unix推奨)</option>
                  <option value="CRLF">CRLF (\r\n, Windows)</option>
                  <option value="preserve">元コード維持</option>
                </select>
                <span className="text-[10px] text-slate-500 font-mono">
                  (元: {fileData?.lineEnding || '不明'})
                </span>
              </div>

              {/* Charset selector */}
              <div className="flex items-center space-x-1.5">
                <span className="text-[11px] text-slate-500 font-medium">文字コード:</span>
                <select
                  value={charset}
                  onChange={(e) => setCharset(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-hidden focus:border-sky-500 font-mono"
                >
                  <option value="UTF-8">UTF-8</option>
                  <option value="Shift-JIS">Shift-JIS</option>
                  <option value="EUC-JP">EUC-JP</option>
                </select>
              </div>

              {/* Backup toggle */}
              <label className="flex items-center space-x-1.5 cursor-pointer select-none text-[11px]">
                <input
                  type="checkbox"
                  checked={createBackup}
                  onChange={(e) => setCreateBackup(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-0 w-3.5 h-3.5"
                />
                <span className="text-slate-300">保存時リモートバックアップ (.bak) 作成</span>
              </label>
            </div>

            {/* Revert changes button */}
            {isDirty && (
              <button
                onClick={() => {
                  if (window.confirm('編集内容を破棄し、読み込み直後の状態に戻しますか？')) {
                    setContent(originalContent);
                  }
                }}
                className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition-colors"
                title="編集内容をリセット"
              >
                <RotateCcw className="w-3 h-3" />
                <span>元に戻す</span>
              </button>
            )}
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-hidden relative flex flex-col bg-[#070b12]">
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

          {!isLoading && !error && (
            <>
              {/* Preview Mode */}
              {activeTab === 'preview' && (
                <div className="flex-1 overflow-auto p-4 text-xs font-mono text-slate-200 select-text">
                  <div className={`table w-full ${wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}>
                    {previewLines.map((line, idx) => (
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
                </div>
              )}

              {/* Edit Mode */}
              {activeTab === 'edit' && (
                <div className="flex-1 relative flex overflow-hidden">
                  {/* Line Numbers gutter */}
                  <div className="w-12 bg-slate-950/80 border-r border-slate-800/80 py-4 px-2 select-none text-right font-mono text-xs text-slate-600 shrink-0 overflow-hidden">
                    {previewLines.map((_, idx) => (
                      <div key={idx} className="leading-[20px] h-[20px]">
                        {idx + 1}
                      </div>
                    ))}
                  </div>

                  {/* Textarea Editor */}
                  <div className="flex-1 relative overflow-hidden">
                    <textarea
                      ref={textareaRef}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      onKeyDown={handleTextareaKeyDown}
                      onClick={handleCursorMove}
                      onKeyUp={handleCursorMove}
                      spellCheck={false}
                      className={`w-full h-full p-4 bg-transparent text-slate-100 font-mono text-xs focus:outline-hidden resize-none leading-[20px] ${
                        wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre overflow-x-auto'
                      }`}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="h-8 px-4 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between text-[11px] text-slate-500 shrink-0 select-none">
          <div className="flex items-center space-x-3">
            <span>{previewLines.length} 行</span>
            <span>{content.length} 文字</span>
            {activeTab === 'edit' && (
              <>
                <span className="text-slate-700">|</span>
                <span className="font-mono text-slate-400">行 {cursorPos.line}, 列 {cursorPos.col}</span>
              </>
            )}
            <span className="text-slate-700">|</span>
            <span className="font-mono text-sky-400/90">{lineEnding}</span>
            <span className="text-slate-700">|</span>
            <span className="font-mono text-slate-400">{charset}</span>
          </div>

          <div className="flex items-center space-x-3">
            {isDirty && (
              <span className="text-amber-400 font-medium">● 未保存の変更あり</span>
            )}
            <span>{fileData ? formatBytes(content.length) : ''}</span>
          </div>
        </div>

        {/* ---------------------------------------------------- */}
        {/* Safety Guard: Diff & Confirmation Modal before Saving */}
        {/* ---------------------------------------------------- */}
        {showDiffConfirm && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-6 animate-fade-in">
            <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-emerald-950/80 rounded-lg border border-emerald-700/60 text-emerald-400">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 text-sm">保存前の安全確認 (Safety Guard)</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    リモートファイルへの書き込み内容とガード設定を確認してください
                  </p>
                </div>
              </div>

              {saveError && (
                <div className="p-3 bg-red-950/80 border border-red-800/80 rounded-lg text-red-200 text-xs">
                  {saveError}
                </div>
              )}

              {/* Summary Table */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-2.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">対象パス:</span>
                  <span className="font-mono text-slate-200 truncate max-w-xs" title={fileData?.path}>
                    {fileData?.path}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-400">改行コード:</span>
                  <div className="flex items-center space-x-1.5 font-mono">
                    <span className="text-slate-500">元: {fileData?.lineEnding || 'LF'}</span>
                    <span className="text-slate-600">→</span>
                    <span className="px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 font-bold border border-sky-800/60">
                      {lineEnding}
                    </span>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-400">文字コード:</span>
                  <span className="font-mono text-slate-200 font-semibold">{charset}</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-400">変更行サマリー:</span>
                  <div className="flex items-center space-x-2 font-mono text-[11px]">
                    {diffMetrics.modified > 0 && (
                      <span className="text-amber-400 font-medium">{diffMetrics.modified} 行変更</span>
                    )}
                    {diffMetrics.added > 0 && (
                      <span className="text-emerald-400 font-medium">+{diffMetrics.added} 行追加</span>
                    )}
                    {diffMetrics.deleted > 0 && (
                      <span className="text-red-400 font-medium">-{diffMetrics.deleted} 行削除</span>
                    )}
                    {diffMetrics.modified === 0 && diffMetrics.added === 0 && diffMetrics.deleted === 0 && (
                      <span className="text-slate-400">行内容の変更なし</span>
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-slate-400">自動バックアップ:</span>
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createBackup}
                      onChange={(e) => setCreateBackup(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0 w-3.5 h-3.5"
                    />
                    <span className="font-mono text-[11px] text-emerald-300">
                      {createBackup ? '作成する (.bak)' : '作成しない (非推奨)'}
                    </span>
                  </label>
                </div>
              </div>

              {/* Confirmation Buttons */}
              <div className="flex items-center justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDiffConfirm(false)}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={executeSave}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition-all flex items-center space-x-2 disabled:opacity-50"
                >
                  {isSaving ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>書き込み中...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>保存を実行する</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* Safety Guard: Discard Changes Confirmation Modal */}
        {/* ---------------------------------------------------- */}
        {showDiscardConfirm && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-6 animate-fade-in">
            <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-sm w-full p-5 space-y-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-amber-950/80 rounded-lg border border-amber-700/60 text-amber-400">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-100 text-sm">未保存の変更があります</h3>
                  <p className="text-xs text-slate-400 mt-0.5">保存せずに閉じますか？</p>
                </div>
              </div>

              <p className="text-xs text-slate-300 bg-slate-950 p-3 rounded-lg border border-slate-800 leading-relaxed">
                編集した内容は保存されません。破棄してエディタを閉じますか？
              </p>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  onClick={() => setShowDiscardConfirm(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  編集を続ける
                </button>
                <button
                  onClick={() => {
                    setShowDiscardConfirm(false);
                    onClose();
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors"
                >
                  破棄して閉じる
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
