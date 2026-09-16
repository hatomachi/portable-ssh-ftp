import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { ConnectModal } from './components/ConnectModal';
import { Terminal } from './components/Terminal';
import { FtpBrowser } from './components/FtpBrowser';
import type { SessionStatus, ConnectRequest } from './types';
import { connectSession, disconnectSession, getStatus } from './api/client';
import { Terminal as TerminalIcon, FolderTree, Plug, Shield } from 'lucide-react';

export const App: React.FC = () => {
  const [status, setStatus] = useState<SessionStatus>({ connected: false });
  const [layout, setLayout] = useState<'split' | 'terminal' | 'ftp'>('split');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Check current backend status on mount
  useEffect(() => {
    getStatus()
      .then((s) => {
        setStatus(s);
        if (!s.connected) {
          setIsModalOpen(true);
        }
      })
      .catch(() => {
        setIsModalOpen(true);
      });
  }, []);

  const handleConnect = async (req: ConnectRequest) => {
    setIsConnecting(true);
    try {
      const res = await connectSession(req);
      setStatus({
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
      });
      // Adjust layout based on connected protocols
      if (res.sshConnected && !res.ftpConnected) {
        setLayout('terminal');
      } else if (!res.sshConnected && res.ftpConnected) {
        setLayout('ftp');
      } else {
        setLayout('split');
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (status.sessionId) {
      try {
        await disconnectSession(status.sessionId);
      } catch {
        // ignore
      }
    }
    setStatus({ connected: false });
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      <Header
        status={status}
        layout={layout}
        onLayoutChange={setLayout}
        onOpenConnect={() => setIsModalOpen(true)}
        onDisconnect={handleDisconnect}
        isConnecting={isConnecting}
      />

      {/* Main Content Area */}
      <main className="flex-1 relative overflow-hidden flex">
        {status.connected && status.sessionId ? (
          <div className="w-full h-full flex">
            {/* FTP Pane */}
            {(layout === 'split' || layout === 'ftp') && status.ftpConnected && (
              <div className={`h-full ${layout === 'split' ? 'w-1/2 min-w-[320px]' : 'w-full'}`}>
                <FtpBrowser sessionId={status.sessionId} />
              </div>
            )}

            {/* SSH Terminal Pane */}
            {(layout === 'split' || layout === 'terminal') && status.sshConnected && (
              <div className={`h-full ${layout === 'split' ? 'flex-1 min-w-[320px]' : 'w-full'}`}>
                <Terminal sessionId={status.sessionId} />
              </div>
            )}
          </div>
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
    </div>
  );
};

export default App;
