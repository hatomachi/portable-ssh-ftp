import React, { useState, useEffect, useMemo } from 'react';
import { Header } from './components/Header';
import { TabBar } from './components/TabBar';
import { ConnectModal } from './components/ConnectModal';
import { Terminal } from './components/Terminal';
import { RemoteExplorer } from './components/RemoteExplorer';
import type { SessionStatus, ConnectRequest, SessionTab } from './types';
import { connectSession, disconnectSession, duplicateSession, listSessions } from './api/client';
import { initLifecycle, exitApplication } from './utils/lifecycle';
import { Terminal as TerminalIcon, FolderTree, Plug, Shield, Power, AlertTriangle } from 'lucide-react';

export const App: React.FC = () => {
  const [tabs, setTabs] = useState<SessionTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isQuitModalOpen, setIsQuitModalOpen] = useState(false);
  const [isTerminated, setIsTerminated] = useState(false);

  // Initialize lifecycle (heartbeat & auto-shutdown)
  useEffect(() => {
    const cleanup = initLifecycle();
    return cleanup;
  }, []);

  // Check current backend status on mount
  useEffect(() => {
    listSessions()
      .then((sessions) => {
        if (sessions && sessions.length > 0) {
          const restoredTabs: SessionTab[] = sessions.map((s, idx) => ({
            id: s.id,
            title: `${s.host} (${idx + 1})`,
            status: {
              connected: true,
              sessionId: s.id,
              sshConnected: s.sshConnected,
              ftpConnected: s.ftpConnected,
              host: s.host,
              sshPort: s.sshPort,
              sshUsername: s.sshUsername,
              ftpPort: s.ftpPort,
              ftpUsername: s.ftpUsername,
              ftpCharset: s.ftpCharset,
              logFilePath: s.logFilePath,
            },
            layout: (!s.sshConnected && s.ftpConnected) ? 'explorer' : 'split',
          }));
          setTabs(restoredTabs);
          setActiveTabId(restoredTabs[0].id);
        } else {
          setIsModalOpen(true);
        }
      })
      .catch(() => {
        setIsModalOpen(true);
      });
  }, []);

  const activeTab = useMemo(() => {
    return tabs.find((t) => t.id === activeTabId) || tabs[0];
  }, [tabs, activeTabId]);

  const activeStatus: SessionStatus = activeTab ? activeTab.status : { connected: false };
  const activeLayout = activeTab ? activeTab.layout : 'split';

  const handleConnect = async (req: ConnectRequest) => {
    setIsConnecting(true);
    try {
      const res = await connectSession(req);
      const sameHostCount = tabs.filter((t) => t.status.host === req.host).length;
      const title = `${req.host} (${sameHostCount + 1})`;
      const newStatus: SessionStatus = {
        connected: true,
        sessionId: res.sessionId,
        sshConnected: res.sshConnected,
        ftpConnected: res.ftpConnected,
        host: res.host,
        sshPort: req.sshPort,
        sshUsername: req.sshUsername,
        ftpPort: req.ftpPort,
        ftpUsername: req.ftpUsername,
        ftpCharset: req.ftpCharset,
        logFilePath: res.logFilePath,
      };
      const newTab: SessionTab = {
        id: res.sessionId,
        title,
        status: newStatus,
        layout: (!res.sshConnected && res.ftpConnected) ? 'explorer' : 'split',
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(res.sessionId);
      setIsModalOpen(false);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDuplicateTab = async (sourceSessionId?: string) => {
    const sid = sourceSessionId || activeTabId;
    if (!sid) return;

    setIsDuplicating(true);
    try {
      const res = await duplicateSession(sid);
      const sourceTab = tabs.find((t) => t.id === sid) || activeTab;
      const host = res.host || sourceTab?.status.host || 'remote';
      const sameHostCount = tabs.filter((t) => t.status.host === host).length;
      const title = `${host} (${sameHostCount + 1})`;

      const newStatus: SessionStatus = {
        connected: true,
        sessionId: res.sessionId,
        sshConnected: res.sshConnected,
        ftpConnected: res.ftpConnected,
        host,
        sshPort: sourceTab?.status.sshPort,
        sshUsername: sourceTab?.status.sshUsername,
        ftpPort: sourceTab?.status.ftpPort,
        ftpUsername: sourceTab?.status.ftpUsername,
        ftpCharset: sourceTab?.status.ftpCharset,
        logFilePath: res.logFilePath,
      };

      const newTab: SessionTab = {
        id: res.sessionId,
        title,
        status: newStatus,
        layout: sourceTab?.layout || 'split',
      };

      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(res.sessionId);
    } catch (err: any) {
      alert(`セッション複製に失敗しました: ${err.message || err}`);
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleCloseTab = async (tabId: string) => {
    try {
      await disconnectSession(tabId);
    } catch {
      // ignore
    }

    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        if (remaining.length > 0) {
          const closedIdx = prev.findIndex((t) => t.id === tabId);
          const nextIdx = Math.max(0, closedIdx - 1);
          setActiveTabId(remaining[nextIdx]?.id || remaining[0].id);
        } else {
          setActiveTabId('');
        }
      }
      return remaining;
    });
  };

  const handleDisconnectCurrent = async () => {
    if (activeTabId) {
      await handleCloseTab(activeTabId);
    }
  };

  const handleRenameTab = (tabId: string, newTitle: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, title: newTitle } : t))
    );
  };

  const handleLayoutChange = (layout: 'split' | 'terminal' | 'explorer') => {
    if (!activeTabId) return;
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, layout } : t))
    );
  };

  const handleQuitApp = async () => {
    setIsQuitModalOpen(false);
    setIsTerminated(true);
    await exitApplication();
  };

  const hasTabs = tabs.length > 0;

  if (isTerminated) {
    return (
      <div className="flex flex-col items-center justify-center h-screen w-screen bg-slate-950 text-slate-100 font-sans p-6 text-center select-none">
        <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-4 text-slate-400">
          <Power className="w-8 h-8" />
        </div>
        <h1 className="text-xl font-bold text-slate-200 mb-2">Portable SSH &amp; FTP は終了しました</h1>
        <p className="text-sm text-slate-400 max-w-sm mb-6">
          バックエンドプロセスを停止しました。<br />
          このウィンドウまたはタブを閉じてください。
        </p>
        <button
          onClick={() => window.close()}
          className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
        >
          ウィンドウを閉じる
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      <Header
        status={activeStatus}
        layout={activeLayout}
        onLayoutChange={handleLayoutChange}
        onOpenConnect={() => setIsModalOpen(true)}
        onDisconnect={handleDisconnectCurrent}
        onQuit={() => setIsQuitModalOpen(true)}
        isConnecting={isConnecting}
      />

      {/* Tab Bar for Multi-session management */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={handleCloseTab}
        onDuplicateTab={handleDuplicateTab}
        onNewConnection={() => setIsModalOpen(true)}
        onRenameTab={handleRenameTab}
        isDuplicating={isDuplicating}
      />

      {/* Main Content Area */}
      <main className="flex-1 relative overflow-hidden flex flex-col">
        {hasTabs ? (
          tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const hasExplorer = Boolean(tab.status.sshConnected || tab.status.ftpConnected);
            const showExplorer = (tab.layout === 'split' || tab.layout === 'explorer') && hasExplorer;
            const showTerminal = (tab.layout === 'split' || tab.layout === 'terminal') && Boolean(tab.status.sshConnected);

            return (
              <div
                key={tab.id}
                className={`w-full h-full flex ${isActive ? '' : 'hidden'}`}
              >
                {/* Remote File Explorer Pane (SSH / FTP) */}
                {showExplorer && (
                  <div className={`h-full ${showTerminal ? 'w-1/2 min-w-[320px]' : 'w-full'}`}>
                    <RemoteExplorer
                      sessionId={tab.id}
                      sshConnected={tab.status.sshConnected}
                      ftpConnected={tab.status.ftpConnected}
                    />
                  </div>
                )}

                {/* SSH Terminal Pane */}
                {showTerminal && (
                  <div className={`h-full ${showExplorer ? 'flex-1 min-w-[320px]' : 'w-full'}`}>
                    <Terminal 
                      sessionId={tab.id} 
                      isActive={isActive}
                      logFilePath={tab.status.logFilePath}
                    />
                  </div>
                )}
              </div>
            );
          })
        ) : (
          /* Welcome & Idle Screen */
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(56,189,248,0.15),rgba(255,255,255,0))]">
            <div className="w-16 h-16 rounded-2xl bg-sky-950/60 border border-sky-800/40 flex items-center justify-center mb-6 shadow-xl shadow-sky-950/40">
              <TerminalIcon className="w-8 h-8 text-sky-400" />
            </div>

            <h1 className="text-2xl font-bold text-slate-100 mb-2">
              Portable SSH &amp; FTP
            </h1>
            <p className="text-sm text-slate-400 max-w-md mb-8">
              インストール不要・管理者権限不要で動く、閉域本番操作ホスト用モダン操作基盤。<br />
              同一画面でSSHターミナル操作とFTPファイル転送を統合します。
            </p>

            <div className="flex items-center space-x-3 mb-10">
              <button
                onClick={() => setIsModalOpen(true)}
                className="px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium text-sm shadow-lg shadow-sky-950/50 flex items-center space-x-2 transition-all hover:scale-105 active:scale-95"
              >
                <Plug className="w-4 h-4" />
                <span>新しい接続を開始する</span>
              </button>
            </div>

            {/* Feature Highlights */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl text-left text-xs">
              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80">
                <div className="flex items-center space-x-2 text-sky-400 font-semibold mb-1">
                  <Shield className="w-4 h-4" />
                  <span>完全ポータブル</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  レジストリ書き込み不要。単一exeを実行するだけでブラウザUIが即座に起動します。
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80">
                <div className="flex items-center space-x-2 text-emerald-400 font-semibold mb-1">
                  <TerminalIcon className="w-4 h-4" />
                  <span>安全なターミナル操作</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Ctrl+V安全ペースト、ワンクリックでの全ログ・エビデンスMarkdownコピーを完備。
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80">
                <div className="flex items-center space-x-2 text-blue-400 font-semibold mb-1">
                  <FolderTree className="w-4 h-4" />
                  <span>文字化け防止 (Shift-JIS)</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  FFFTP互換のShift-JIS/EUC-JP自動変換を搭載。日本語ファイル名も文字化けしません。
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Connect Dialog */}
      <ConnectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConnect={handleConnect}
      />

      {/* Quit Confirmation Dialog */}
      {isQuitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl max-w-sm w-full p-5 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-red-950/60 rounded-lg border border-red-800/40 text-red-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-100 text-sm">アプリケーションの終了</h3>
                <p className="text-xs text-slate-400 mt-0.5">Portable SSH &amp; FTP を終了しますか？</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 bg-slate-800/50 p-3 rounded-lg border border-slate-700/50 leading-relaxed">
              バックエンドプロセス（Go）を停止し、すべてのSSH/FTP接続を切断します。
            </p>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setIsQuitModalOpen(false)}
                className="px-3 py-1.5 rounded text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleQuitApp}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded text-xs font-medium bg-red-600 hover:bg-red-500 text-white shadow-sm transition-colors"
              >
                <Power className="w-3.5 h-3.5" />
                <span>終了する</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


export default App;
