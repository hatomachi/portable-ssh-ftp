import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Copy, Trash2, Check } from 'lucide-react';
import { CommandBar } from './CommandBar';

interface TerminalProps {
  sessionId: string;
  isActive?: boolean;
}

export const Terminal: React.FC<TerminalProps> = ({ sessionId, isActive = true }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isActiveRef = useRef(isActive);
  const [copied, setCopied] = useState(false);
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(true);

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
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/terminal?sessionId=${encodeURIComponent(sessionId)}&cols=${term.cols}&rows=${term.rows}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      term.writeln('\x1b[38;5;75m⚡ SSH Terminal Connected\x1b[0m\r\n');
      sendResize(term.cols, term.rows);
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
    };

    ws.onerror = () => {
      term.writeln('\r\n\x1b[38;5;196m❌ Terminal WebSocket Error\x1b[0m\r\n');
    };

    // User input forward to WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
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
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    }

    // Custom event listener for external input (e.g. RemoteExplorer "cd <path>", FilePreview "cat <file>")
    const handleTerminalSend = (e: Event) => {
      if (!isActiveRef.current) return;
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail && ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(customEvent.detail));
        term.focus();
      }
    };
    window.addEventListener('terminal:send', handleTerminalSend);

    // Global shortcut Ctrl+J / Cmd+J to toggle CommandBar
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (!isActiveRef.current) return;
      if (e.key === 'j' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setIsCommandBarOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);

    return () => {
      window.removeEventListener('terminal:send', handleTerminalSend);
      window.removeEventListener('keydown', handleGlobalKeyDown);
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      xtermRef.current = null;
      wsRef.current = null;
    };
  }, [sessionId]);

  const copyAllText = () => {
    if (!xtermRef.current) return;
    const term = xtermRef.current;
    term.selectAll();
    const text = term.getSelection();
    term.clearSelection();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
    <div className="flex flex-col h-full w-full bg-[#090d16] relative overflow-hidden">
      {/* Mini toolbar inside terminal */}
      <div className="absolute top-2 right-4 z-10 flex items-center space-x-1.5 bg-slate-900/80 backdrop-blur-xs p-1 rounded border border-slate-800 opacity-40 hover:opacity-100 transition-opacity text-xs">
        <button
          onClick={copyAllText}
          title="全ログをクリップボードにコピー（エビデンス取得）"
          className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition-colors flex items-center space-x-1"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span className="text-[10px]">{copied ? 'コピー完了' : 'ログ全コピー'}</span>
        </button>
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
