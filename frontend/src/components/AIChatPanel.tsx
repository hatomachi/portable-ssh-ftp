import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bot,
  Sparkles,
  Send,
  Terminal as TerminalIcon,
  Copy,
  Check,
  RotateCcw,
  X,
  AlertTriangle,
  FolderTree,
  FileCode,
  Loader2,
  CornerDownLeft,
  ShieldCheck,
  Cpu,
  Trash2,
  Search,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  BookOpen,
  Plus,
  History,
  Edit3,
  Save,
} from 'lucide-react';
import type { AIChatMessage, AIInspectLog, AIStatusResponse, SessionStatus, AISessionSummary, AIKnowledgeResponse } from '../types';
import { getAIStatus, askAIChat, listAISessions, getAISessionMessages, deleteAISession, getAIKnowledge, saveAIKnowledge } from '../api/client';
import { getSessionAiContext } from '../utils/aiContextManager';

interface AIChatPanelProps {
  sessionId: string;
  sessionStatus?: SessionStatus;
  isOpen: boolean;
  onClose: () => void;
}

const STORAGE_KEY_PREFIX = 'portable_ssh_ai_chat_';
const ALLOWED_COMMANDS_KEY = 'portable_ssh_allowed_inspect_commands';

const DEFAULT_ALLOWED_COMMANDS = [
  'ls', 'cat', 'head', 'tail', 'grep', 'wc', 'stat',
  'df', 'free', 'uptime', 'uname', 'date',
  'ps', 'systemctl',
  'ss', 'which', 'ip',
];

const PRESET_COMMANDS = [
  { cmd: 'ls', desc: 'ファイル一覧', group: '基本' },
  { cmd: 'cat', desc: 'ファイル閲覧', group: '基本' },
  { cmd: 'head', desc: '先頭行確認', group: '基本' },
  { cmd: 'tail', desc: '末尾行確認', group: '基本' },
  { cmd: 'grep', desc: '文字列・ログ検索', group: '基本' },
  { cmd: 'wc', desc: '行数・件数カウント', group: '基本' },
  { cmd: 'stat', desc: 'ファイル属性詳細', group: '基本' },
  { cmd: 'df', desc: 'ディスク容量', group: 'リソース' },
  { cmd: 'free', desc: 'メモリ状況', group: 'リソース' },
  { cmd: 'uptime', desc: '稼働時間/負荷', group: 'リソース' },
  { cmd: 'uname', desc: 'OS/カーネル情報', group: 'リソース' },
  { cmd: 'date', desc: '現在時刻/TZ確認', group: 'リソース' },
  { cmd: 'ps', desc: 'プロセス一覧', group: 'プロセス' },
  { cmd: 'systemctl', desc: 'サービス状態確認', group: 'プロセス' },
  { cmd: 'ss', desc: 'ポート・通信確認', group: 'ネット' },
  { cmd: 'which', desc: 'コマンド存在確認', group: 'ネット' },
  { cmd: 'ip', desc: 'IP/NIC状態確認', group: 'ネット' },
];

const QUICK_PROMPTS = [
  { label: '📁 カレント調査', prompt: 'カレントディレクトリのファイル一覧を確認し、構成の概要と次に調べるべき推奨コマンドを教えて。' },
  { label: '🔍 巨大ファイルTop10', prompt: 'カレントディレクトリ配下で容量を圧迫しているファイルやディレクトリを上位10件見つける安全なコマンドを作って。' },
  { label: '⚠️ 直前エラー解説', prompt: '直前のターミナル出力に出ているエラーの原因を解説し、復旧・確認するためのコマンドを提示して。' },
  { label: '💡 概念: cron vs timer', prompt: 'Linuxのcronとsystemdタイマーの仕組みの違いや、どちらを使うべきかの判断基準を教えて。' },
  { label: '📊 サーバー負荷確認', prompt: 'CPU、メモリ、ディスク使用量、および高負荷プロセスを確認するコマンドを提示して。' },
  { label: '🔌 ポート・通信調査', prompt: 'LISTENしているポートと、特定のポートを使っているプロセスを調査するコマンドを作って。' },
];

const InspectLogAccordion: React.FC<{ logs: AIInspectLog[] }> = ({ logs }) => {
  const [isOpen, setIsOpen] = useState(false);
  if (!logs || logs.length === 0) return null;

  const blockedCount = logs.filter((l) => l.blocked).length;

  return (
    <div className="mb-2.5 rounded-lg border border-slate-700/80 bg-slate-950/70 overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-2.5 py-1.5 flex items-center justify-between text-left hover:bg-slate-800/60 transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center space-x-1.5 text-sky-400 font-medium text-[11px]">
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span>{logs.length}件の自律環境調査を実行しました</span>
          {blockedCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-950/80 border border-amber-800 text-amber-300">
              {blockedCount}件ブロック
            </span>
          )}
        </div>
        <div className="text-slate-400">
          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </div>
      </button>

      {isOpen && (
        <div className="p-2 space-y-2 border-t border-slate-800 bg-slate-950 text-[11px]">
          {logs.map((log, idx) => (
            <div key={idx} className="rounded border border-slate-800 bg-slate-900/80 p-2 space-y-1">
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="text-sky-300 font-semibold truncate">$ {log.command}</span>
                {log.duration && <span className="text-slate-500 shrink-0 ml-2">{log.duration}</span>}
              </div>

              {log.reason && (
                <div className="text-[10px] text-slate-400 font-sans">
                  目的: {log.reason}
                </div>
              )}

              {log.blocked ? (
                <div className="flex items-start space-x-1 text-amber-300 text-[10px] bg-amber-950/50 p-1.5 rounded border border-amber-800/60">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-amber-400" />
                  <span>安全ガードレールによりブロック: {log.error}</span>
                </div>
              ) : log.error ? (
                <div className="text-rose-300 text-[10px] bg-rose-950/50 p-1.5 rounded border border-rose-800/60">
                  エラー: {log.error}
                </div>
              ) : (
                <pre className="p-1.5 rounded bg-slate-950 text-slate-300 font-mono text-[10px] max-h-32 overflow-y-auto whitespace-pre-wrap leading-tight">
                  {log.output || '(出力なし)'}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const AIChatPanel: React.FC<AIChatPanelProps> = ({
  sessionId,
  sessionStatus,
  isOpen,
  onClose,
}) => {
  const [status, setStatus] = useState<AIStatusResponse | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [includeContext, setIncludeContext] = useState(true);
  const [autoInspect, setAutoInspect] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sentToBarId, setSentToBarId] = useState<string | null>(null);
  const [executedId, setExecutedId] = useState<string | null>(null);

  const [allowedCommands, setAllowedCommands] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(ALLOWED_COMMANDS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_ALLOWED_COMMANDS;
  });
  const [showCommandSettings, setShowCommandSettings] = useState(false);
  const [customCommandInput, setCustomCommandInput] = useState('');

  const saveAllowedCommands = (cmds: string[]) => {
    setAllowedCommands(cmds);
    try {
      localStorage.setItem(ALLOWED_COMMANDS_KEY, JSON.stringify(cmds));
    } catch {}
  };

  const toggleCommand = (cmd: string) => {
    if (allowedCommands.includes(cmd)) {
      saveAllowedCommands(allowedCommands.filter((c) => c !== cmd));
    } else {
      saveAllowedCommands([...allowedCommands, cmd]);
    }
  };

  const handleAddCustomCommand = () => {
    const trimmed = customCommandInput.trim().toLowerCase();
    if (!trimmed) return;
    const parts = trimmed.split(/[\s,]+/).filter(Boolean);
    const newSet = new Set([...allowedCommands, ...parts]);
    saveAllowedCommands(Array.from(newSet));
    setCustomCommandInput('');
  };

  const isSshAvailable = Boolean(sessionStatus?.sshConnected);

  const hostKey = sessionStatus?.host
    ? (sessionStatus.sshUsername ? `${sessionStatus.sshUsername}@${sessionStatus.host}` : sessionStatus.host)
    : (sessionId ? `session_${sessionId.slice(0, 8)}` : 'default_host');

  // AI Session Management
  const [aiSessionId, setAiSessionId] = useState<string>('');
  const [aiSessions, setAiSessions] = useState<AISessionSummary[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [showSessionMenu, setShowSessionMenu] = useState(false);

  // Host Knowledge (CLAUDE.md) Modal
  const [showKnowledgeModal, setShowKnowledgeModal] = useState(false);
  const [knowledge, setKnowledge] = useState<AIKnowledgeResponse | null>(null);
  const [knowledgeContent, setKnowledgeContent] = useState('');
  const [isEditingKnowledge, setIsEditingKnowledge] = useState(false);
  const [isSavingKnowledge, setIsSavingKnowledge] = useState(false);
  const [copiedWorkspacePath, setCopiedWorkspacePath] = useState(false);

  // Live context preview
  const [currentContext, setCurrentContext] = useState<{
    currentPath: string;
    fileCount: number;
    terminalLines: number;
  }>({ currentPath: '', fileCount: 0, terminalLines: 0 });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load chat history from localStorage
  useEffect(() => {
    if (!sessionId) return;
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
      if (saved) {
        setMessages(JSON.parse(saved));
      } else {
        setMessages([]);
      }
    } catch {
      setMessages([]);
    }
  }, [sessionId]);

  // Save chat history
  const saveMessages = (msgs: AIChatMessage[]) => {
    setMessages(msgs);
    if (!sessionId) return;
    try {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${sessionId}`, JSON.stringify(msgs));
    } catch {
      // ignore
    }
  };

  // Fetch host AI sessions
  const fetchSessions = useCallback(async () => {
    if (!sessionId && !sessionStatus?.host) return;
    setIsLoadingSessions(true);
    try {
      const res = await listAISessions(hostKey, sessionId);
      setAiSessions(res.sessions || []);
    } catch (err) {
      console.warn('Failed to load AI sessions:', err);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [hostKey, sessionId, sessionStatus?.host]);

  const handleSelectSession = async (sId: string) => {
    try {
      const msgs = await getAISessionMessages(sId, hostKey);
      setMessages(msgs);
      setAiSessionId(sId);
      setShowSessionMenu(false);
    } catch (err: any) {
      alert('セッションの読み込みに失敗しました: ' + (err.message || err));
    }
  };

  const handleNewSession = () => {
    setAiSessionId('');
    setMessages([]);
    setShowSessionMenu(false);
  };

  const handleDeleteSession = async (sId: string) => {
    if (!window.confirm('このセッションを削除しますか？')) return;
    try {
      await deleteAISession(sId, hostKey);
      if (sId === aiSessionId) {
        handleNewSession();
      }
      fetchSessions();
    } catch (err: any) {
      alert('セッションの削除に失敗しました: ' + (err.message || err));
    }
  };

  const handleOpenKnowledge = async () => {
    try {
      const res = await getAIKnowledge(hostKey, sessionId);
      setKnowledge(res);
      setKnowledgeContent(res.content);
      setIsEditingKnowledge(false);
      setShowKnowledgeModal(true);
    } catch (err: any) {
      alert('ナレッジの読み込みに失敗しました: ' + (err.message || err));
    }
  };

  const handleSaveKnowledge = async () => {
    setIsSavingKnowledge(true);
    try {
      await saveAIKnowledge(hostKey, knowledgeContent);
      setKnowledge((prev) => prev ? { ...prev, content: knowledgeContent } : null);
      setIsEditingKnowledge(false);
    } catch (err: any) {
      alert('ナレッジの保存に失敗しました: ' + (err.message || err));
    } finally {
      setIsSavingKnowledge(false);
    }
  };

  // Check AI CLI status on mount & when opened
  const checkStatus = useCallback(async () => {
    setIsCheckingStatus(true);
    try {
      const res = await getAIStatus();
      setStatus(res);
    } catch (err: any) {
      setStatus({
        available: false,
        error: err.message || 'AIステータスの確認に失敗しました',
      });
    } finally {
      setIsCheckingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      checkStatus();
      fetchSessions();
    }
  }, [isOpen, checkStatus, fetchSessions]);

  // Refresh context info when opened or active session changes
  const refreshContextPreview = useCallback(() => {
    if (!sessionId) return;
    const ctx = getSessionAiContext(sessionId);
    const lineCount = ctx.terminalRecentOutput ? ctx.terminalRecentOutput.split('\n').length : 0;
    setCurrentContext({
      currentPath: ctx.currentPath || '/',
      fileCount: ctx.files.length,
      terminalLines: lineCount,
    });
  }, [sessionId]);

  useEffect(() => {
    if (isOpen) {
      refreshContextPreview();
      const timer = setInterval(refreshContextPreview, 3000);
      return () => clearInterval(timer);
    }
  }, [isOpen, refreshContextPreview]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isLoading]);

  // Auto focus input
  useEffect(() => {
    if (isOpen && status?.available) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 150);
    }
  }, [isOpen, status?.available]);

  const handleSend = async (customPrompt?: string) => {
    const promptToSend = (customPrompt || input).trim();
    if (!promptToSend || isLoading || !status?.available) return;

    const userMessage: AIChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: promptToSend,
      timestamp: Date.now(),
    };

    const nextMessages = [...messages, userMessage];
    saveMessages(nextMessages);
    setInput('');
    setIsLoading(true);

    try {
      // Build context if enabled
      let aiContext: any = {
        sessionId,
        host: sessionStatus?.host || '',
        user: sessionStatus?.sshUsername || '',
        isRoot: sessionStatus?.sshUsername === 'root',
      };

      if (includeContext) {
        const live = getSessionAiContext(sessionId);
        aiContext = {
          ...aiContext,
          currentDir: live.currentPath,
          files: live.files,
          terminalRecentOutput: live.terminalRecentOutput,
        };
      }

      // Pass last 6 messages as conversation history
      const recentHistory = nextMessages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      aiContext.history = recentHistory;

      const res = await askAIChat({
        prompt: promptToSend,
        context: aiContext,
        autoInspect: autoInspect && isSshAvailable,
        allowedCommands: autoInspect ? allowedCommands : undefined,
        sessionId: aiSessionId || undefined,
        hostKey,
        isResume: Boolean(aiSessionId),
      });

      if (res.sessionId && res.sessionId !== aiSessionId) {
        setAiSessionId(res.sessionId);
      }
      fetchSessions();

      const assistantMessage: AIChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: res.reply,
        commands: res.commands || [],
        inspectLogs: res.inspectLogs || [],
        timestamp: Date.now(),
      };

      saveMessages([...nextMessages, assistantMessage]);
    } catch (err: any) {
      const errorMessage: AIChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `❌ エラーが発生しました: ${err.message || err}`,
        timestamp: Date.now(),
      };
      saveMessages([...nextMessages, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSendToCommandBar = (cmd: string, id: string) => {
    window.dispatchEvent(
      new CustomEvent('commandbar:set', {
        detail: { command: cmd, open: true },
      })
    );
    setSentToBarId(id);
    setTimeout(() => setSentToBarId(null), 2000);
  };

  const handleExecuteInTerminal = (cmd: string, id: string) => {
    window.dispatchEvent(
      new CustomEvent('terminal:send', {
        detail: cmd.endsWith('\n') ? cmd : cmd + '\n',
      })
    );
    setExecutedId(id);
    setTimeout(() => setExecutedId(null), 2000);
  };

  const handleCopyCommand = (cmd: string, id: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClearHistory = () => {
    if (window.confirm('チャット履歴をクリアしますか？')) {
      saveMessages([]);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="flex flex-col h-full w-[420px] bg-slate-900 border-l border-slate-800 shadow-2xl z-20 select-none animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="h-12 px-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 backdrop-blur-xs">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-sky-950/60 border border-sky-800/50 text-sky-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="font-semibold text-xs text-slate-100">AI Copilot</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-900/40 text-sky-300 font-mono border border-sky-800/40">
                Claude CLI
              </span>
            </div>
            {status?.available && (
              <div className="text-[10px] text-emerald-400 flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>{status.version || 'Connected'}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={checkStatus}
            disabled={isCheckingStatus}
            title="Claude CLIの接続状態を再確認"
            className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isCheckingStatus ? 'animate-spin' : ''}`} />
          </button>
          {messages.length > 0 && (
            <button
              onClick={handleClearHistory}
              title="会話履歴をクリア"
              className="p-1.5 rounded text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            title="閉じる"
            className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Session & Host Knowledge Bar */}
      <div className="px-3 py-1.5 border-b border-slate-800/80 bg-slate-950/70 flex items-center justify-between text-xs">
        {/* Session Dropdown Trigger */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowSessionMenu(!showSessionMenu)}
            className="flex items-center space-x-1.5 px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700/60 text-[11px] max-w-[210px] transition-colors"
            title="過去セッションの切り替え・再開"
          >
            <History className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="truncate">
              {aiSessions.find((s) => s.id === aiSessionId)?.title || (aiSessionId ? `セッション ${aiSessionId.slice(0, 8)}` : '新しいチャット')}
            </span>
            <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
          </button>

          {/* Sessions Dropdown Menu */}
          {showSessionMenu && (
            <div className="absolute left-0 top-full mt-1 w-72 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-50 overflow-hidden text-[11px]">
              <div className="p-2 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
                <span className="font-semibold text-slate-300">過去セッション</span>
                <button
                  type="button"
                  onClick={handleNewSession}
                  className="flex items-center space-x-1 px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium text-[10px] transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  <span>新規チャット</span>
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto divide-y divide-slate-800/60">
                {isLoadingSessions ? (
                  <div className="p-3 text-center text-slate-500 flex items-center justify-center space-x-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                    <span>履歴を読み込み中...</span>
                  </div>
                ) : aiSessions.length === 0 ? (
                  <div className="p-3 text-center text-slate-500 text-[11px]">
                    保存された過去セッションはありません
                  </div>
                ) : (
                  aiSessions.map((s) => (
                    <div
                      key={s.id}
                      className={`flex items-center justify-between p-2 hover:bg-slate-800/60 cursor-pointer transition-colors ${
                        s.id === aiSessionId ? 'bg-sky-950/40 border-l-2 border-sky-400' : ''
                      }`}
                      onClick={() => handleSelectSession(s.id)}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="text-slate-200 font-medium truncate" title={s.title}>
                          {s.title}
                        </div>
                        <div className="text-[10px] text-slate-500 flex items-center space-x-2 mt-0.5">
                          <span>{new Date(s.updatedAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          <span>• {s.messageCount} 件</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSession(s.id);
                        }}
                        className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-700/60 transition-colors"
                        title="セッションを削除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center space-x-1.5">
          <button
            type="button"
            onClick={handleOpenKnowledge}
            className="flex items-center space-x-1 px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-800 text-emerald-300 border border-slate-700/60 text-[11px] transition-colors"
            title="ホスト運用ナレッジ (CLAUDE.md) を確認・編集"
          >
            <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
            <span>ナレッジ</span>
          </button>

          <button
            type="button"
            onClick={handleNewSession}
            className="p-1 rounded bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/60 transition-colors"
            title="新しいチャットを開始"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Context Chips Bar */}
      <div className="px-3 py-2 bg-slate-950/40 border-b border-slate-800/60 text-[11px] flex flex-col space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-slate-400 text-[10px] font-medium flex items-center space-x-1">
            <Cpu className="w-3 h-3 text-sky-400" />
            <span>自動注入コンテキスト (画面連動)</span>
          </span>
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1">
              <label
                title={isSshAvailable ? '安全な読み取りコマンド(ls, cat等)で裏SSH自律調査を行います (Native MCP)' : 'SSH接続時のみ利用可能です'}
                className={`flex items-center space-x-1 text-[10px] ${
                  isSshAvailable ? 'text-sky-300 hover:text-sky-200 cursor-pointer' : 'text-slate-600 cursor-not-allowed'
                }`}
              >
                <input
                  type="checkbox"
                  checked={autoInspect && isSshAvailable}
                  disabled={!isSshAvailable}
                  onChange={(e) => setAutoInspect(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-0 w-3 h-3 disabled:opacity-30"
                />
                <span className="flex items-center space-x-1">
                  <Search className="w-3 h-3 text-sky-400" />
                  <span>自律調査 (MCP)</span>
                  {autoInspect && isSshAvailable && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title="MCPサーバー待機中" />
                  )}
                </span>
              </label>
              <button
                type="button"
                onClick={() => setShowCommandSettings(true)}
                title={`MCP許可コマンド設定 (${allowedCommands.length}件許可中)`}
                className="p-1 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800/80 transition-colors"
              >
                <SlidersHorizontal className="w-3 h-3 text-slate-400 hover:text-sky-300" />
              </button>
            </div>

            <label className="flex items-center space-x-1 text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={includeContext}
                onChange={(e) => setIncludeContext(e.target.checked)}
                className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-0 w-3 h-3"
              />
              <span>コンテキスト</span>
            </label>
          </div>
        </div>

        {includeContext && (
          <div className="flex flex-wrap gap-1.5 items-center">
            {/* Current Path & Files */}
            <div
              title={`カレントディレクトリ: ${currentContext.currentPath} (${currentContext.fileCount} 件)`}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800/70 border border-slate-700/60 text-slate-300 max-w-[200px] truncate"
            >
              <FolderTree className="w-3 h-3 text-amber-400 shrink-0" />
              <span className="truncate">{currentContext.currentPath || '/'}</span>
              <span className="text-[9px] text-slate-500 shrink-0">({currentContext.fileCount})</span>
            </div>

            {/* Terminal Recent Buffer */}
            <div
              title={`直近ログ/直前コマンド出力: 約 ${currentContext.terminalLines} 行連動中`}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800/70 border border-slate-700/60 text-slate-300"
            >
              <TerminalIcon className="w-3 h-3 text-sky-400 shrink-0" />
              <span>ログ({currentContext.terminalLines}行)</span>
            </div>

            {/* Host info */}
            {sessionStatus?.host && (
              <div
                title={`接続先: ${sessionStatus.sshUsername || 'user'}@${sessionStatus.host}`}
                className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800/70 border border-slate-700/60 text-slate-400 max-w-[120px] truncate"
              >
                <span className="truncate">{sessionStatus.host}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Chat Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs select-text">
        {/* If CLI is not available */}
        {status && !status.available && (
          <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-200 space-y-3">
            <div className="flex items-start space-x-2">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-amber-300 text-xs mb-1">
                  Claude CLI が検出されませんでした
                </h4>
                <p className="text-[11px] text-amber-200/80 leading-relaxed">
                  本機能はオプション機能です。ローカルマシンに Claude Code CLI がインストールされている環境でのみ利用できます。
                </p>
              </div>
            </div>

            <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800 text-[11px] font-mono text-slate-300">
              <p className="text-slate-500 text-[10px] mb-1"># インストールコマンド (Node.js環境):</p>
              npm install -g @anthropic-ai/claude-code
            </div>

            <button
              onClick={checkStatus}
              disabled={isCheckingStatus}
              className="w-full py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium text-[11px] transition-colors flex items-center justify-center space-x-1"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isCheckingStatus ? 'animate-spin' : ''}`} />
              <span>インストール状況を再確認する</span>
            </button>
          </div>
        )}

        {/* Initial Welcome & Quick Prompts */}
        {messages.length === 0 && status?.available && (
          <div className="flex flex-col items-center justify-center py-6 text-center space-y-3">
            <div className="w-10 h-10 rounded-xl bg-sky-950/60 border border-sky-800/40 flex items-center justify-center text-sky-400">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-200 text-xs">AI 本番操作アシスタント</h3>
              <p className="text-[11px] text-slate-400 max-w-[280px] mt-1 leading-relaxed">
                カレントフォルダや直近ログを見ながら、目的に応じた安全なコマンドスニペットを作成します。
              </p>
            </div>

            {/* Quick Prompt Cards */}
            <div className="w-full space-y-1.5 pt-2 text-left">
              <span className="text-[10px] text-slate-400 font-medium px-1">おすすめの指示:</span>
              {QUICK_PROMPTS.map((qp, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(qp.prompt)}
                  disabled={isLoading}
                  className="w-full text-left p-2 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-sky-700/60 text-slate-300 hover:text-white transition-all text-[11px] flex items-center justify-between group"
                >
                  <span className="font-medium text-slate-200 group-hover:text-sky-300">{qp.label}</span>
                  <CornerDownLeft className="w-3 h-3 text-slate-500 group-hover:text-sky-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages List */}
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1`}>
              <div className="flex items-center space-x-1.5 text-[10px] text-slate-400 px-1">
                <span>{isUser ? 'あなた' : 'Claude'}</span>
                <span>•</span>
                <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>

              <div
                className={`max-w-[95%] rounded-xl p-3 leading-relaxed whitespace-pre-wrap ${
                  isUser
                    ? 'bg-sky-600 text-white rounded-tr-xs'
                    : 'bg-slate-800/80 text-slate-200 border border-slate-700/60 rounded-tl-xs'
                }`}
              >
                {!isUser && msg.inspectLogs && msg.inspectLogs.length > 0 && (
                  <InspectLogAccordion logs={msg.inspectLogs} />
                )}

                {msg.content}

                {/* Commands extracted from assistant response */}
                {msg.commands && msg.commands.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <span className="text-[10px] text-sky-400 font-semibold uppercase tracking-wider flex items-center space-x-1">
                      <FileCode className="w-3 h-3" />
                      <span>提案されたコマンドスニペット:</span>
                    </span>

                    {msg.commands.map((cmd, cIdx) => {
                      const snippetId = `${msg.id}_${cIdx}`;
                      const isSent = sentToBarId === snippetId;
                      const isExec = executedId === snippetId;
                      const isCopied = copiedId === snippetId;

                      return (
                        <div
                          key={cIdx}
                          className="rounded-lg bg-slate-950 border border-slate-800 overflow-hidden shadow-sm"
                        >
                          {/* Danger warning banner if applicable */}
                          {cmd.isDangerous && (
                            <div className="px-2.5 py-1 bg-amber-950/60 border-b border-amber-800/50 flex items-center space-x-1.5 text-amber-300 text-[10px]">
                              <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                              <span>注意: 破壊的・システム変更コマンドの可能性があります</span>
                            </div>
                          )}

                          {/* Command code block */}
                          <div className="p-2 font-mono text-[11px] text-sky-300 bg-slate-950/80 overflow-x-auto whitespace-pre-wrap select-all">
                            {cmd.command}
                          </div>

                          {/* Action Toolbar */}
                          <div className="px-2 py-1.5 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-[10px]">
                            {/* Send to Command Bar button (PRIMARY) */}
                            <button
                              onClick={() => handleSendToCommandBar(cmd.command, snippetId)}
                              title="セーフティ・コマンドバーに流し込み、パラメータ確認・1行ステップ実行"
                              className="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium flex items-center space-x-1 transition-colors shadow-xs"
                            >
                              {isSent ? <Check className="w-3 h-3 text-emerald-300" /> : <ShieldCheck className="w-3 h-3" />}
                              <span>{isSent ? 'コマンドバーへ投入済!' : 'コマンドバーへ送る'}</span>
                            </button>

                            <div className="flex items-center space-x-1">
                              {/* Direct Execute */}
                              <button
                                onClick={() => handleExecuteInTerminal(cmd.command, snippetId)}
                                title="ターミナルへ直接送信してEnter実行"
                                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors flex items-center space-x-1"
                              >
                                {isExec ? <Check className="w-3 h-3 text-emerald-400" /> : <TerminalIcon className="w-3 h-3 text-emerald-400" />}
                                <span>{isExec ? '送信済' : '即実行'}</span>
                              </button>

                              {/* Copy */}
                              <button
                                onClick={() => handleCopyCommand(cmd.command, snippetId)}
                                title="クリップボードにコピー"
                                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                              >
                                {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center space-x-2 text-slate-400 p-2">
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
            <span className="text-[11px]">
              {autoInspect && isSshAvailable
                ? '裏SSH自律環境調査 & Claude回答を生成中...'
                : 'Claude CLI (claude -p) で回答を生成中...'}
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/90 backdrop-blur-xs">
        <div className="relative rounded-xl border border-slate-700 bg-slate-950 focus-within:border-sky-500 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading || !status?.available}
            placeholder={
              status?.available
                ? 'Claudeに指示を入力 (例: エラーログ集計、巨大ファイル検索) ...'
                : 'Claude CLIをセットアップしてください'
            }
            rows={2}
            className="w-full resize-none bg-transparent p-2.5 pr-10 text-xs text-slate-100 placeholder-slate-500 focus:outline-none disabled:opacity-50"
          />

          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading || !status?.available}
            title="送信 (Enter / 改行はShift+Enter)"
            className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40 disabled:hover:bg-sky-600 transition-colors"
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>

        <div className="flex items-center justify-between text-[10px] text-slate-400 px-1 pt-1.5">
          <span>Enter で送信 / Shift+Enter で改行</span>
          {messages.length > 0 && (
            <button
              onClick={() => handleSend(QUICK_PROMPTS[2].prompt)}
              className="hover:text-sky-400 transition-colors"
            >
              直前エラーの調査
            </button>
          )}
        </div>
      </div>

      {/* Allowed Commands Setting Modal */}
      {showCommandSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-4 space-y-3.5 text-xs text-slate-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center space-x-2 text-sky-400 font-semibold text-xs">
                <SlidersHorizontal className="w-4 h-4" />
                <span>AI自律調査 許可コマンド設定</span>
              </div>
              <button
                onClick={() => setShowCommandSettings(false)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              AI（Claude）がリモートサーバーを裏で自律調査する際に、実行を許可する安全な読み取りコマンドを選択・追加してください。
            </p>

            {/* Presets */}
            <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto p-1 border border-slate-800/80 rounded-lg bg-slate-950/40">
              {PRESET_COMMANDS.map((item) => {
                const checked = allowedCommands.includes(item.cmd);
                return (
                  <label
                    key={item.cmd}
                    className={`flex items-center space-x-2 p-1.5 rounded border transition-colors cursor-pointer text-[11px] ${
                      checked
                        ? 'bg-sky-950/50 border-sky-700/60 text-sky-200'
                        : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCommand(item.cmd)}
                      className="rounded bg-slate-800 border-slate-700 text-sky-500 focus:ring-0 w-3.5 h-3.5"
                    />
                    <span className="font-mono text-[10px] text-sky-300 font-semibold">{item.cmd}</span>
                    <span className="text-[9px] text-slate-500 truncate">({item.desc})</span>
                  </label>
                );
              })}
            </div>

            {/* Custom Input */}
            <div className="space-y-1.5 pt-1">
              <label className="text-[10px] text-slate-400 font-medium">カスタム追加コマンド (カンマ区切り):</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={customCommandInput}
                  onChange={(e) => setCustomCommandInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomCommand();
                    }
                  }}
                  placeholder="例: who, hostname, ip"
                  className="flex-1 px-2.5 py-1 rounded bg-slate-950 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500 font-mono"
                />
                <button
                  type="button"
                  onClick={handleAddCustomCommand}
                  className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                >
                  追加
                </button>
              </div>
            </div>

            {/* Status Summary */}
            <div className="text-[10px] text-slate-400 bg-slate-950/60 p-2 rounded border border-slate-800 break-words leading-relaxed font-mono">
              <span className="text-slate-500 font-sans">現在許可 ({allowedCommands.length}件): </span>
              {allowedCommands.join(', ')}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => saveAllowedCommands(DEFAULT_ALLOWED_COMMANDS)}
                className="text-[10px] text-slate-400 hover:text-amber-400 underline transition-colors"
              >
                デフォルトに戻す
              </button>
              <button
                type="button"
                onClick={() => setShowCommandSettings(false)}
                className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition-colors"
              >
                設定完了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Host Knowledge (CLAUDE.md) Modal */}
      {showKnowledgeModal && knowledge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-xl w-full flex flex-col max-h-[85vh] overflow-hidden text-xs text-slate-200 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
              <div className="flex items-center space-x-2">
                <BookOpen className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold text-sm text-slate-100">ホスト運用ナレッジ (CLAUDE.md)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowKnowledgeModal(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Subheader (Path info) */}
            <div className="px-4 py-2 bg-slate-950 border-b border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 font-mono">
              <span className="truncate" title={knowledge.workspacePath}>📁 {knowledge.workspacePath}/CLAUDE.md</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(knowledge.workspacePath);
                  setCopiedWorkspacePath(true);
                  setTimeout(() => setCopiedWorkspacePath(false), 2000);
                }}
                className="ml-2 text-sky-400 hover:text-sky-300 shrink-0 font-sans"
              >
                {copiedWorkspacePath ? 'コピー完了!' : 'パスをコピー'}
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 flex-1 overflow-y-auto">
              {isEditingKnowledge ? (
                <textarea
                  value={knowledgeContent}
                  onChange={(e) => setKnowledgeContent(e.target.value)}
                  className="w-full h-80 p-3 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono text-xs focus:outline-hidden focus:border-emerald-500 leading-relaxed resize-none"
                  placeholder="ホスト運用ナレッジ（サーバー用途、サービスポート、注意点など）を入力..."
                />
              ) : (
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-slate-300 font-sans text-xs whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto select-text">
                  {knowledge.content || '(ナレッジが空です。「編集」ボタンからホスト情報を記載できます)'}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between">
              <span className="text-[10px] text-slate-500 hidden sm:inline">
                Claude Code はこのフォルダの CLAUDE.md を自律参照して応答します
              </span>
              <div className="flex items-center space-x-2 ml-auto">
                {isEditingKnowledge ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsEditingKnowledge(false)}
                      className="px-3 py-1.5 rounded text-xs text-slate-300 hover:bg-slate-800"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveKnowledge}
                      disabled={isSavingKnowledge}
                      className="px-3 py-1.5 rounded text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center space-x-1"
                    >
                      {isSavingKnowledge ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      <span>保存</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setKnowledgeContent(knowledge.content);
                      setIsEditingKnowledge(true);
                    }}
                    className="px-3 py-1.5 rounded text-xs bg-sky-600 hover:bg-sky-500 text-white font-medium flex items-center space-x-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>ナレッジを編集</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
