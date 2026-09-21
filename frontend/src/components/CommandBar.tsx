import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play,
  SkipForward,
  RotateCcw,
  X,
  Send,
  History,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Trash2,
  Copy,
  Check,
  Variable,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import type { CommandHistoryItem, StepRunState } from '../types';

interface CommandBarProps {
  onSend: (command: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

const STORAGE_KEY = 'portable_ssh_cmd_history';
const MAX_HISTORY = 30;

// Dangerous command patterns to alert user before execution
const DANGEROUS_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive\s+--force)\s+[/~*]/i,
  /\b(mkfs|fdisk|parted)\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/sd[a-z]/i,
  /\b(shutdown|reboot|poweroff|init\s+[06])\b/i,
  /\b(drop\s+(database|table)|truncate\s+table)\b/i,
  /\bkill\s+-9\s+-1\b/i,
  /\bchmod\s+(-R\s+)?777\s+\//i,
];

export const CommandBar: React.FC<CommandBarProps> = ({ onSend, isOpen, onToggle }) => {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<CommandHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [showParams, setShowParams] = useState(false);

  // Step run state
  const [stepState, setStepState] = useState<StepRunState>({
    active: false,
    lines: [],
    currentIndex: 0,
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  // Load history from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch {
      // ignore storage error
    }
  }, []);

  // Save history to localStorage
  const saveToHistory = (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    setHistory((prev) => {
      const filtered = prev.filter((item) => item.command !== trimmed);
      const next: CommandHistoryItem[] = [
        { id: Date.now().toString(), command: trimmed, timestamp: Date.now() },
        ...filtered,
      ].slice(0, MAX_HISTORY);

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setShowHistory(false);
  };

  // Close history dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    if (showHistory) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showHistory]);

  // Compute command lines
  const lines = useMemo(() => {
    return input
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }, [input]);

  const rawLineCount = input.split(/\r?\n/).length;

  // Check for dangerous commands
  const dangerousMatch = useMemo(() => {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(input)) {
        return true;
      }
    }
    return false;
  }, [input]);

  // Extract placeholder parameters: {{PARAM}}, <PARAM>, ${PARAM}
  const placeholders = useMemo(() => {
    const found = new Set<string>();
    // Pattern 1: {{PARAM}}
    const p1 = /\{\{([a-zA-Z0-9_.-]+)\}\}/g;
    let m;
    while ((m = p1.exec(input)) !== null) {
      found.add(m[1]);
    }
    // Pattern 2: <PARAM> (uppercase identifiers min 2 chars)
    const p2 = /<([A-Z0-9_]{2,})>/g;
    while ((m = p2.exec(input)) !== null) {
      found.add(m[1]);
    }
    // Pattern 3: ${PARAM}
    const p3 = /\$\{([a-zA-Z0-9_]+)\}/g;
    while ((m = p3.exec(input)) !== null) {
      found.add(m[1]);
    }

    return Array.from(found);
  }, [input]);

  // Automatically open params panel if placeholders exist and user hasn't toggled
  useEffect(() => {
    if (placeholders.length > 0) {
      setShowParams(true);
    }
  }, [placeholders.length]);

  // Replace placeholders in the input
  const handleApplyParams = () => {
    let replaced = input;
    for (const [key, val] of Object.entries(paramValues)) {
      if (val.trim() === '') continue;
      // Replace {{key}}, <key>, ${key}
      const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      replaced = replaced.replace(new RegExp(`\\{\\{${esc}\\}\\}`, 'g'), val);
      replaced = replaced.replace(new RegExp(`<${esc}>`, 'g'), val);
      replaced = replaced.replace(new RegExp(`\\$\\{${esc}\\}`, 'g'), val);
    }
    setInput(replaced);
  };

  // Copy text to clipboard
  const handleCopy = () => {
    if (!input) return;
    navigator.clipboard.writeText(input);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Direct Send (All)
  const handleSendAll = () => {
    if (!input.trim()) return;

    // If dangerous or multiple lines, prompt confirmation
    if ((dangerousMatch || lines.length > 1) && !showConfirmModal) {
      setShowConfirmModal(true);
      return;
    }

    executeSendAll();
  };

  const executeSendAll = () => {
    setShowConfirmModal(false);
    saveToHistory(input);

    // Send lines to terminal
    // For single command: command + \r
    // For multiple lines: execute line by line with \r
    if (lines.length === 1) {
      onSend(lines[0] + '\r');
    } else {
      // Send multiple lines
      lines.forEach((line) => {
        onSend(line + '\r');
      });
    }

    setInput('');
  };

  // Step Run Actions
  const handleStartStepRun = () => {
    if (lines.length === 0) return;
    setStepState({
      active: true,
      lines: lines,
      currentIndex: 0,
    });
  };

  const handleStepSendNext = () => {
    if (stepState.currentIndex >= stepState.lines.length) return;

    const currentLine = stepState.lines[stepState.currentIndex];
    onSend(currentLine + '\r');
    saveToHistory(currentLine);

    const nextIndex = stepState.currentIndex + 1;
    setStepState((prev) => ({
      ...prev,
      currentIndex: nextIndex,
    }));
  };

  const handleStepSkip = () => {
    if (stepState.currentIndex >= stepState.lines.length) return;
    setStepState((prev) => ({
      ...prev,
      currentIndex: prev.currentIndex + 1,
    }));
  };

  const handleStepReset = () => {
    setStepState((prev) => ({
      ...prev,
      currentIndex: 0,
    }));
  };

  const handleStepExit = () => {
    setStepState({
      active: false,
      lines: [],
      currentIndex: 0,
    });
  };

  // Keyboard shortcut handler for textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (stepState.active) {
        handleStepSendNext();
      } else {
        handleSendAll();
      }
    } else if (e.key === 'Escape') {
      if (stepState.active) {
        handleStepExit();
      }
    }
  };

  return (
    <div className="flex flex-col bg-slate-900 border-t border-slate-800 shadow-2xl relative z-20 select-none">
      {/* Top Bar / Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950/80 border-b border-slate-800 text-xs">
        <div className="flex items-center space-x-2">
          <button
            onClick={onToggle}
            className="flex items-center space-x-1.5 font-medium text-slate-300 hover:text-sky-400 transition-colors cursor-pointer"
            title="開閉トグル (Ctrl+J / Cmd+J)"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
            <span className="font-semibold tracking-wide">セーフティ・コマンドバー</span>
            <span className="text-[10px] text-slate-500 font-mono">Ctrl+J</span>
            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronUp className="w-3.5 h-3.5 text-slate-400" />}
          </button>

          {/* Status Badges */}
          {input.trim() && (
            <div className="flex items-center space-x-1.5 ml-2">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${lines.length > 1 ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60' : 'bg-slate-800 text-slate-300'}`}>
                {rawLineCount} 行 ({lines.length} コマンド)
              </span>

              {dangerousMatch && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-950/90 text-red-300 border border-red-800/80 flex items-center space-x-1 animate-pulse">
                  <AlertTriangle className="w-3 h-3 text-red-400" />
                  <span>危険コマンド検知</span>
                </span>
              )}

              {placeholders.length > 0 && (
                <button
                  onClick={() => setShowParams(!showParams)}
                  className={`px-1.5 py-0.5 rounded text-[10px] flex items-center space-x-1 transition-colors cursor-pointer ${showParams ? 'bg-sky-900/60 text-sky-300 border border-sky-700' : 'bg-slate-800 text-slate-400 hover:text-sky-300'}`}
                >
                  <Variable className="w-3 h-3" />
                  <span>変数 {placeholders.length} 件</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right action icons */}
        <div className="flex items-center space-x-2">
          {/* History Button & Dropdown */}
          <div className="relative" ref={historyRef}>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition-colors cursor-pointer flex items-center space-x-1 ${showHistory ? 'text-sky-400 bg-slate-800' : ''}`}
              title="コマンド送信履歴"
            >
              <History className="w-3.5 h-3.5" />
              <span className="text-[10px]">履歴</span>
            </button>

            {showHistory && (
              <div className="absolute right-0 bottom-7 w-80 max-h-64 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-2 z-50 flex flex-col text-xs">
                <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-800 font-medium text-slate-300">
                  <span>過去の送信履歴 ({history.length})</span>
                  {history.length > 0 && (
                    <button
                      onClick={clearHistory}
                      className="text-[10px] text-red-400 hover:underline cursor-pointer"
                    >
                      全クリア
                    </button>
                  )}
                </div>

                <div className="overflow-y-auto flex-1 space-y-1 pr-1">
                  {history.length === 0 ? (
                    <div className="text-center py-4 text-slate-500 text-[11px]">履歴はありません</div>
                  ) : (
                    history.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => {
                          setInput(item.command);
                          setShowHistory(false);
                          if (!isOpen) onToggle();
                        }}
                        className="p-1.5 rounded bg-slate-950/60 hover:bg-sky-950/50 border border-slate-800/80 hover:border-sky-800 text-slate-300 hover:text-sky-200 font-mono text-[11px] truncate cursor-pointer transition-colors"
                        title={item.command}
                      >
                        {item.command}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick Copy */}
          {input && (
            <button
              onClick={handleCopy}
              className="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors cursor-pointer"
              title="入力をコピー"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* Clear Input */}
          {input && (
            <button
              onClick={() => {
                setInput('');
                handleStepExit();
              }}
              className="p-1 rounded text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition-colors cursor-pointer"
              title="入力をクリア"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Expanded Area */}
      {isOpen && (
        <div className="p-2 space-y-2">
          {/* Dangerous Alert Box */}
          {dangerousMatch && (
            <div className="px-2.5 py-1.5 rounded bg-red-950/60 border border-red-800/60 text-red-200 text-xs flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>
                <strong>警告:</strong> 破壊的操作または再起動/停止の可能性があるコマンドが検出されました。本番機への送信前に引数・対象を再度ご確認ください。
              </span>
            </div>
          )}

          {/* Parameter Replacement Panel */}
          {showParams && placeholders.length > 0 && (
            <div className="p-2 rounded bg-slate-950/60 border border-sky-900/40 text-xs space-y-1.5">
              <div className="flex items-center justify-between font-medium text-sky-400">
                <div className="flex items-center space-x-1.5">
                  <Variable className="w-3.5 h-3.5" />
                  <span>パラメータ自動置換</span>
                </div>
                <button
                  onClick={handleApplyParams}
                  className="px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-medium transition-colors cursor-pointer"
                >
                  置換を適用
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                {placeholders.map((ph) => (
                  <div key={ph} className="flex items-center space-x-1.5 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                    <span className="font-mono text-slate-400 text-[11px] shrink-0">{ph}:</span>
                    <input
                      type="text"
                      placeholder={`値を入力...`}
                      value={paramValues[ph] || ''}
                      onChange={(e) => setParamValues({ ...paramValues, [ph]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleApplyParams();
                      }}
                      className="w-full bg-transparent border-none text-slate-100 font-mono text-xs focus:outline-hidden"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step Run Mode Active Bar */}
          {stepState.active ? (
            <div className="p-2 rounded bg-sky-950/40 border border-sky-800/60 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 rounded bg-sky-600 text-white font-semibold text-[11px]">
                    Step Run
                  </span>
                  <span className="text-sky-300 font-medium font-mono">
                    Step {Math.min(stepState.currentIndex + 1, stepState.lines.length)} / {stepState.lines.length}
                  </span>
                </div>

                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={handleStepReset}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] flex items-center space-x-1 transition-colors cursor-pointer"
                    title="最初からやり直す"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>最初へ</span>
                  </button>
                  <button
                    onClick={handleStepExit}
                    className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
                    title="ステップ実行を終了"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Step Sequence Display */}
              <div className="space-y-1 font-mono text-xs max-h-36 overflow-y-auto">
                {stepState.lines.map((line, idx) => {
                  const isPast = idx < stepState.currentIndex;
                  const isCurrent = idx === stepState.currentIndex;

                  return (
                    <div
                      key={idx}
                      className={`px-2 py-1 rounded flex items-center justify-between border ${
                        isCurrent
                          ? 'bg-sky-900/60 border-sky-600 text-white font-semibold'
                          : isPast
                          ? 'bg-slate-950/40 border-slate-900 text-slate-500'
                          : 'bg-slate-950/60 border-slate-800/80 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center space-x-2 truncate">
                        <span className="w-5 text-[10px] text-slate-500 select-none">{idx + 1}.</span>
                        <span className="truncate">{line}</span>
                      </div>

                      <div className="shrink-0 ml-2">
                        {isPast && (
                          <span className="text-[10px] text-emerald-400 font-sans flex items-center space-x-0.5">
                            <Check className="w-3 h-3" />
                            <span>済</span>
                          </span>
                        )}
                        {isCurrent && (
                          <span className="text-[10px] text-sky-400 font-sans font-normal animate-pulse">
                            送信待ち
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Step Run Controls */}
              <div className="flex items-center justify-between pt-1 border-t border-sky-900/40">
                <span className="text-[11px] text-slate-400">
                  {stepState.currentIndex >= stepState.lines.length
                    ? 'すべてのステップの送信が完了しました 🎉'
                    : 'ターミナル出力を確認しながら、1行ずつ安全に送信してください'}
                </span>

                <div className="flex items-center space-x-2">
                  {stepState.currentIndex < stepState.lines.length && (
                    <button
                      onClick={handleStepSkip}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1 transition-colors cursor-pointer"
                      title="この行を実行せずに次へ進む"
                    >
                      <SkipForward className="w-3 h-3" />
                      <span>スキップ</span>
                    </button>
                  )}

                  {stepState.currentIndex < stepState.lines.length ? (
                    <button
                      onClick={handleStepSendNext}
                      className="px-3.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs flex items-center space-x-1.5 shadow-md shadow-sky-950/40 transition-colors cursor-pointer"
                      title="現在の行をターミナルに送信 (Ctrl+Enter)"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>この行を送信 (Ctrl+Enter)</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleStepExit}
                      className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors cursor-pointer"
                    >
                      完了して通常モードに戻る
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Normal Multi-line Editor */
            <div className="space-y-2">
              <div className="relative rounded-lg border border-slate-700 bg-[#070b13] focus-within:border-sky-500 transition-colors">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={Math.min(Math.max(rawLineCount, 2), 6)}
                  placeholder="コマンドを入力または貼り付け（改行を含んでいても勝手に実行されません。Ctrl+Enter で送信）..."
                  className="w-full bg-transparent p-2 text-xs font-mono text-slate-100 placeholder-slate-500 resize-none focus:outline-hidden leading-relaxed"
                />
              </div>

              {/* Bottom Execution Action Bar */}
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-slate-500 flex items-center space-x-3">
                  <span>Enter: 改行</span>
                  <span>Ctrl+Enter: 送信</span>
                  {lines.length > 1 && (
                    <span className="text-amber-400/90 font-medium">
                      複数行のコマンドです。ステップ実行で1行ずつ確認しながら流せます。
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  {/* Step Run button (visible when multiple commands exist) */}
                  {lines.length > 1 && (
                    <button
                      onClick={handleStartStepRun}
                      className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-sky-300 font-medium text-xs flex items-center space-x-1.5 border border-slate-700 hover:border-sky-700 transition-all cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>1行ずつステップ実行 ({lines.length}行)</span>
                    </button>
                  )}

                  {/* Send All button */}
                  <button
                    onClick={handleSendAll}
                    disabled={!input.trim()}
                    className={`px-4 py-1.5 rounded-md font-medium text-xs flex items-center space-x-1.5 shadow-md transition-all cursor-pointer ${
                      !input.trim()
                        ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                        : dangerousMatch
                        ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-950/40'
                        : lines.length > 1
                        ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-950/40'
                        : 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-950/40'
                    }`}
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{lines.length > 1 ? '一括送信' : '送信 (実行)'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal for Multi-line or Dangerous Commands */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-text">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-4 shadow-2xl space-y-3">
            <div className="flex items-center space-x-2 text-amber-400 font-semibold text-sm">
              <AlertTriangle className="w-5 h-5" />
              <span>コマンド送信の最終確認</span>
            </div>

            {dangerousMatch && (
              <div className="p-2.5 rounded bg-red-950/80 border border-red-800 text-red-200 text-xs space-y-1">
                <div className="font-bold flex items-center space-x-1">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span>危険なコマンドが検出されています！</span>
                </div>
                <p>ファイル削除・停止・権限変更などの破壊的操作が含まれます。実行対象環境に間違いはありませんか？</p>
              </div>
            )}

            <div className="text-xs text-slate-300">
              以下の <strong className="text-white font-mono">{lines.length} 行</strong> のコマンドをターミナルに送信します。
            </div>

            <div className="max-h-48 overflow-y-auto p-2 bg-slate-950 rounded border border-slate-800 font-mono text-xs text-slate-200 space-y-1">
              {lines.map((l, i) => (
                <div key={i} className="flex items-start space-x-2">
                  <span className="text-slate-600 select-none w-4">{i + 1}.</span>
                  <span className="break-all">{l}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors cursor-pointer"
              >
                キャンセル
              </button>
              <button
                onClick={executeSendAll}
                className={`px-4 py-1.5 rounded font-medium text-xs text-white shadow-md transition-colors cursor-pointer ${
                  dangerousMatch ? 'bg-red-600 hover:bg-red-500' : 'bg-sky-600 hover:bg-sky-500'
                }`}
              >
                送信を実行する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
