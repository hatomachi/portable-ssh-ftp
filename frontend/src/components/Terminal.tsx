import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Copy, Trash2, Check, FileCode, AlertTriangle, RefreshCw, Loader2, Upload } from 'lucide-react';
import { CommandBar } from './CommandBar';
import { extractLastCommandAndOutput, formatAsMarkdownCodeBlock } from '../utils/terminalEvidence';
import { reconnectSession, uploadSshFile } from '../api/client';

interface TerminalProps {
  sessionId: string;
  isActive?: boolean;
  logFilePath?: string;
}

export const Terminal: React.FC<TerminalProps> = ({ sessionId, isActive = true, logFilePath }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isActiveRef = useRef(isActive);
  const [copied, setCopied] = useState(false);
  const [evidenceCopied, setEvidenceCopied] = useState(false);
  const [logPathCopied, setLogPathCopied] = useState(false);
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(true);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [targetDir, setTargetDir] = useState<string>('.');

  // Track active explorer path for terminal uploads
  useEffect(() => {
    const handleExplorerPath = (e: Event) => {
      const ce = e as CustomEvent<{ sessionId: string; path: string }>;
      if (ce.detail?.sessionId === sessionId && ce.detail?.path) {
        setTargetDir(ce.detail.path);
      }
    };
    window.addEventListener('explorer:path', handleExplorerPath);
    return () => {
      window.removeEventListener('explorer:path', handleExplorerPath);
    };
  }, [sessionId]);

  const handleTerminalDrop = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const dest = targetDir || '.';
    setUploadStatus(`${files.length} 個のファイルをアップロード中...`);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadStatus(`アップロード中 (${i + 1}/${files.length}): ${file.name}`);
        const res = await uploadSshFile(sessionId, dest, file);
        if (xtermRef.current) {
          xtermRef.current.writeln(`\r\n\x1b[38;5;78m✔ [SCP/SFTP] アップロード完了: ${file.name} -> ${res.path}\x1b[0m\r\n`);
        }
      }
      window.dispatchEvent(new CustomEvent('explorer:refresh', { detail: { sessionId } }));
    } catch (err: any) {
      if (xtermRef.current) {
        xtermRef.current.writeln(`\r\n\x1b[38;5;203m❌ [SCP/SFTP] アップロード失敗: ${err.message || err}\x1b[0m\r\n`);
      }
    } finally {
      setUploadStatus(null);
    }
  };

  const copyLastCommandMarkdown = useCallback(() => {
    if (!xtermRef.current) return;
    const extracted = extractLastCommandAndOutput(xtermRef.current);
    if (!extracted) return;
    const markdown = formatAsMarkdownCodeBlock(extracted, 'bash');
    navigator.clipboard.writeText(markdown);
    setEvidenceCopied(true);
    setTimeout(() => setEvidenceCopied(false), 2000);
  }, []);

  const copyAllText = useCallback(() => {
    if (!xtermRef.current) return;
    const term = xtermRef.current;
    term.selectAll();
    const text = term.getSelection();
    term.clearSelection();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleCopyLogPath = useCallback(() => {
    if (logFilePath) {
      navigator.clipboard.writeText(logFilePath);
      setLogPathCopied(true);
      setTimeout(() => setLogPathCopied(false), 2000);
    }
  }, [logFilePath]);

  const connectWebSocket = useCallback((term: XTerm) => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/terminal?sessionId=${encodeURIComponent(sessionId)}&cols=${term.cols}&rows=${term.rows}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      term.writeln('\x1b[38;5;75m⚡ SSH Terminal Connected\x1b[0m\r\n');
      setIsDisconnected(false);
      setIsReconnecting(false);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      } else {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      term.writeln('\r\n\x1b[38;5;203m🔌 SSH Terminal Disconnected\x1b[0m\r\n');
      setIsDisconnected(true);
      setIsReconnecting(false);
    };

    ws.onerror = () => {
      term.writeln('\r\n\x1b[38;5;196m❌ Terminal WebSocket Error\x1b[0m\r\n');
      setIsDisconnected(true);
      setIsReconnecting(false);
    };

    return ws;
  }, [sessionId]);

  const handleReconnect = useCallback(async () => {
    if (isReconnecting || !xtermRef.current) return;
    setIsReconnecting(true);
    const term = xtermRef.current;
    term.writeln('\r\n\x1b[38;5;220m🔄 Reconnecting to SSH server...\x1b[0m');

    try {
      await reconnectSession(sessionId);
      connectWebSocket(term);
      window.dispatchEvent(new CustomEvent('session:reconnected', { detail: { sessionId } }));
    } catch (err: any) {
      term.writeln(`\r\n\x1b[38;5;196m❌ Reconnection failed: ${err.message || err}\x1b[0m\r\n`);
      setIsReconnecting(false);
    }
  }, [sessionId, isReconnecting, connectWebSocket]);

  useEffect(() => {
    isActiveRef.current = isActive;
    if (isActive && fitAddonRef.current) {
      try {
        fitAddonRef.current.fit();
        if (xtermRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            cols: xtermRef.current.cols,
            rows: xtermRef.current.rows,
          }));
        }
        xtermRef.current?.focus();
      } catch {
        // ignore
      }
    }
  }, [isActive]);

  useEffect(() => {
    if (!containerRef.current || !sessionId) return;

    // Initialize xterm.js
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: '"Cascadia Code", "Fira Code", Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#090d16',
        foreground: '#f8fafc',
        cursor: '#38bdf8',
        selectionBackground: '#0284c780',
        black: '#1e293b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#38bdf8',
        white: '#f1f5f9',
        brightBlack: '#475569',
        brightRed: '#ef4444',
        brightGreen: '#22c55e',
        brightYellow: '#eab308',
        brightBlue: '#3b82f6',
        brightMagenta: '#a855f7',
        brightCyan: '#06b6d4',
        brightWhite: '#ffffff',
      },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect WebSocket
    connectWebSocket(term);

    // User input forward to WebSocket
    term.onData((data) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(new TextEncoder().encode(data));
      }
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        sendResize(term.cols, term.rows);
      } catch {
        // ignore resize errors
      }
    });
    resizeObserver.observe(containerRef.current);

    function sendResize(cols: number, rows: number) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    }

    // Custom event listener for external input (e.g. RemoteExplorer "cd <path>", FilePreview "cat <file>")
    const handleTerminalSend = (e: Event) => {
      if (!isActiveRef.current) return;
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(new TextEncoder().encode(customEvent.detail));
        term.focus();
      }
    };
    window.addEventListener('terminal:send', handleTerminalSend);

    // Global keyboard shortcuts:
    // - Ctrl+J / Cmd+J: toggle CommandBar
    // - Ctrl+Shift+C / Cmd+Shift+C: copy last command & output as Markdown
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (!isActiveRef.current) return;
      if (e.key === 'j' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setIsCommandBarOpen((prev) => !prev);
        return;
      }
      if ((e.key === 'C' || e.code === 'KeyC') && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        copyLastCommandMarkdown();
        return;
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);

    return () => {
      window.removeEventListener('terminal:send', handleTerminalSend);
      window.removeEventListener('keydown', handleGlobalKeyDown);
      resizeObserver.disconnect();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      term.dispose();
      xtermRef.current = null;
    };
  }, [sessionId, copyLastCommandMarkdown, connectWebSocket]);

  const clearScreen = () => {
    if (xtermRef.current) {
      xtermRef.current.clear();
    }
  };

  const handleSendCommand = (command: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(new TextEncoder().encode(command));
    }
  };

  return (
    <div 
      className="flex flex-col h-full w-full bg-[#090d16] relative overflow-hidden select-none"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleTerminalDrop(e.dataTransfer.files);
      }}
    >
      {/* Terminal Drag & Drop Upload Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-30 bg-emerald-950/85 border-2 border-dashed border-emerald-400 flex flex-col items-center justify-center pointer-events-none backdrop-blur-xs">
          <Upload className="w-12 h-12 text-emerald-400 animate-bounce mb-2" />
          <span className="text-sm font-semibold text-emerald-200">
            ここにドロップして SCP/SFTP アップロード
          </span>
          <span className="text-xs text-emerald-300/80 font-mono mt-1">
            宛先: {targetDir || '.'}
          </span>
        </div>
      )}

      {/* Terminal Uploading Notification Banner */}
      {uploadStatus && (
        <div className="absolute top-2 left-4 right-4 z-40 bg-emerald-950/95 border border-emerald-500 rounded-lg px-3 py-2 text-xs text-emerald-200 flex items-center space-x-2 shadow-xl animate-pulse">
          <RefreshCw className="w-4 h-4 animate-spin text-emerald-400 shrink-0" />
          <span className="font-mono flex-1 truncate">{uploadStatus}</span>
        </div>
      )}
      {/* Disconnection Warning & Reconnect Banner */}
      {isDisconnected && (
        <div className="absolute top-2 left-4 z-20 flex items-center space-x-2.5 bg-amber-950/95 border border-amber-600/70 px-3 py-1.5 rounded-lg shadow-xl backdrop-blur-md text-amber-200 text-xs animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
          <span className="font-medium">接続が切断されました（画面ログは保持されています）</span>
          <button
            onClick={handleReconnect}
            disabled={isReconnecting}
            className="ml-2 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded flex items-center space-x-1.5 transition-all active:scale-95 disabled:opacity-50 cursor-pointer shadow"
            title="保存された設定でSSHに再接続します"
          >
            {isReconnecting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>再接続中...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                <span>再接続</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Mini toolbar inside terminal */}
      <div className="absolute top-2 right-4 z-10 flex items-center space-x-1.5 bg-slate-900/90 backdrop-blur-xs px-2 py-1 rounded-lg border border-slate-800 opacity-60 hover:opacity-100 transition-opacity text-xs shadow-md">
        {/* Logging indicator badge */}
        {logFilePath && (
          <button
            onClick={handleCopyLogPath}
            title={`セッションログ保存中 (クリックでパスコピー): ${logFilePath}`}
            className="mr-1 px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-800/60 text-emerald-400 hover:bg-emerald-900/70 transition-colors flex items-center space-x-1 text-[10px]"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
            </span>
            <span className="font-mono truncate max-w-[130px]">
              {logPathCopied ? 'パスコピー済!' : logFilePath.replace(/^logs\//, '')}
            </span>
          </button>
        )}

        {/* Copy Last Command & Output as Markdown (Warp-like block copy) */}
        <button
          onClick={copyLastCommandMarkdown}
          title="直前コマンドと出力をMarkdownでコピー (Ctrl+Shift+C / テキスト選択時は選択範囲をコピー)"
          className="px-2 py-1 rounded bg-sky-950/60 text-sky-400 hover:bg-sky-900/70 border border-sky-800/60 transition-colors flex items-center space-x-1 font-medium"
        >
          {evidenceCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <FileCode className="w-3.5 h-3.5" />}
          <span className="text-[10px]">
            {evidenceCopied ? 'MDコピー完了!' : '直前出力をMDコピー'}
          </span>
        </button>

        {/* Copy All Raw Text */}
        <button
          onClick={copyAllText}
          title="画面ログ全体をクリップボードにコピー"
          className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors flex items-center space-x-1"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span className="text-[10px]">{copied ? '完了' : '全コピー'}</span>
        </button>

        {/* Clear screen */}
        <button
          onClick={clearScreen}
          title="画面クリア"
          className="p-1 rounded text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Terminal Display Container */}
      <div ref={containerRef} className="flex-1 w-full min-h-0 p-2" />

      {/* Safe Command Bar at Bottom */}
      <CommandBar
        onSend={handleSendCommand}
        isOpen={isCommandBarOpen}
        onToggle={() => setIsCommandBarOpen((prev) => !prev)}
      />
    </div>
  );
};
