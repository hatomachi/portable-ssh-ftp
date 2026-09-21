import React, { useState, useEffect } from 'react';
import { 
  X, 
  Terminal, 
  FolderTree, 
  Lock, 
  Server, 
  Eye, 
  EyeOff, 
  UploadCloud,
  FileText
} from 'lucide-react';
import type { ConnectRequest } from '../types';

interface ConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (req: ConnectRequest) => Promise<void>;
}

const STORAGE_KEY = 'portable_ssh_ftp_last_config';

export const ConnectModal: React.FC<ConnectModalProps> = ({
  isOpen,
  onClose,
  onConnect,
}) => {
  const [host, setHost] = useState('');
  
  // SSH settings
  const [enableSsh, setEnableSsh] = useState(true);
  const [sshPort, setSshPort] = useState(22);
  const [sshUsername, setSshUsername] = useState('');
  const [sshAuthType, setSshAuthType] = useState<'password' | 'key'>('password');
  const [sshPassword, setSshPassword] = useState('');
  const [sshPrivateKey, setSshPrivateKey] = useState('');
  const [sshPassphrase, setSshPassphrase] = useState('');
  
  // FTP settings
  const [enableFtp, setEnableFtp] = useState(true);
  const [ftpPort, setFtpPort] = useState(21);
  const [ftpUsername, setFtpUsername] = useState('');
  const [ftpPassword, setFtpPassword] = useState('');
  const [ftpPassive, setFtpPassive] = useState(true);
  const [ftpCharset, setFtpCharset] = useState<'UTF-8' | 'Shift-JIS' | 'EUC-JP'>('Shift-JIS');

  // Evidence & Logging settings
  const [enableLogging, setEnableLogging] = useState(true);
  const [logTimestamp, setLogTimestamp] = useState(true);

  // Shared credential helper
  const [syncCredentials, setSyncCredentials] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load saved config
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        setHost(data.host || '');
        setSshPort(data.sshPort || 22);
        setSshUsername(data.sshUsername || '');
        setEnableSsh(data.enableSsh ?? true);
        setFtpPort(data.ftpPort || 21);
        setFtpUsername(data.ftpUsername || '');
        setFtpPassive(data.ftpPassive ?? true);
        setFtpCharset(data.ftpCharset || 'Shift-JIS');
        setEnableFtp(data.enableFtp ?? true);
        setEnableLogging(data.enableLogging ?? true);
        setLogTimestamp(data.logTimestamp ?? true);
      }
    } catch {
      // ignore
    }
  }, []);

  if (!isOpen) return null;

  const handleSshUserChange = (val: string) => {
    setSshUsername(val);
    if (syncCredentials) {
      setFtpUsername(val);
    }
  };

  const handleSshPassChange = (val: string) => {
    setSshPassword(val);
    if (syncCredentials) {
      setFtpPassword(val);
    }
  };

  const handleKeyFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setSshPrivateKey((event.target?.result as string) || '');
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!host.trim()) {
      setError('ホスト名を入力してください');
      return;
    }
    if (!enableSsh && !enableFtp) {
      setError('SSHまたはFTPの少なくとも一方を有効にしてください');
      return;
    }

    setIsLoading(true);
    setError(null);

    const payload: ConnectRequest = {
      host: host.trim(),
      sshPort: Number(sshPort),
      sshUsername: sshUsername.trim(),
      sshPassword,
      sshPrivateKey: sshAuthType === 'key' ? sshPrivateKey : undefined,
      sshPassphrase: sshAuthType === 'key' ? sshPassphrase : undefined,
      ftpPort: Number(ftpPort),
      ftpUsername: ftpUsername.trim(),
      ftpPassword,
      ftpPassive,
      ftpCharset,
      enableSsh,
      enableFtp,
      enableLogging,
      logTimestamp,
    };

    try {
      await onConnect(payload);
      // Save settings (excluding sensitive keys/passwords)
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        host: payload.host,
        sshPort: payload.sshPort,
        sshUsername: payload.sshUsername,
        enableSsh: payload.enableSsh,
        ftpPort: payload.ftpPort,
        ftpUsername: payload.ftpUsername,
        ftpPassive: payload.ftpPassive,
        ftpCharset: payload.ftpCharset,
        enableFtp: payload.enableFtp,
        enableLogging: payload.enableLogging,
        logTimestamp: payload.logTimestamp,
      }));
      onClose();
    } catch (err: any) {
      setError(err.message || '接続に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center space-x-2">
            <Server className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">サーバー接続設定</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-red-950/50 border border-red-800/50 rounded-lg text-red-300 text-xs">
              {error}
            </div>
          )}

          {/* Common Host */}
          <div>
            <label className="block text-slate-300 font-medium mb-1">
              接続先ホスト名 / IPアドレス <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <Server className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.100 または example.com"
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-100 focus:outline-hidden focus:border-sky-500 font-mono text-xs"
              />
            </div>
          </div>

          {/* Sync switch */}
          <div className="flex items-center justify-between px-3 py-2 bg-slate-950/60 rounded-lg border border-slate-800/80">
            <span className="text-slate-300">ユーザー名・パスワードをSSH/FTP間で自動同期</span>
            <input
              type="checkbox"
              checked={syncCredentials}
              onChange={(e) => setSyncCredentials(e.target.checked)}
              className="rounded accent-sky-500"
            />
          </div>

          {/* 2-Column layout: SSH & FTP */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* SSH Settings Box */}
            <div className={`p-4 rounded-xl border transition-colors ${
              enableSsh ? 'bg-slate-950/40 border-slate-800' : 'bg-slate-950/10 border-slate-900 opacity-60'
            }`}>
              <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800/80">
                <div className="flex items-center space-x-1.5 text-emerald-400 font-medium">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>SSH ターミナル設定</span>
                </div>
                <label className="flex items-center space-x-1 text-[11px] cursor-pointer text-slate-400">
                  <input
                    type="checkbox"
                    checked={enableSsh}
                    onChange={(e) => setEnableSsh(e.target.checked)}
                    className="rounded accent-emerald-500"
                  />
                  <span>有効</span>
                </label>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-slate-400 mb-1">ユーザー名</label>
                    <input
                      type="text"
                      disabled={!enableSsh}
                      value={sshUsername}
                      onChange={(e) => handleSshUserChange(e.target.value)}
                      placeholder="root"
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 focus:outline-hidden focus:border-emerald-500 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">ポート</label>
                    <input
                      type="number"
                      disabled={!enableSsh}
                      value={sshPort}
                      onChange={(e) => setSshPort(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 focus:outline-hidden focus:border-emerald-500 font-mono text-xs"
                    />
                  </div>
                </div>

                {/* Auth Method */}
                <div>
                  <label className="block text-slate-400 mb-1">認証方式</label>
                  <div className="flex bg-slate-900 p-0.5 rounded border border-slate-800">
                    <button
                      type="button"
                      disabled={!enableSsh}
                      onClick={() => setSshAuthType('password')}
                      className={`flex-1 py-1 rounded text-center transition-colors ${
                        sshAuthType === 'password' ? 'bg-emerald-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      パスワード
                    </button>
                    <button
                      type="button"
                      disabled={!enableSsh}
                      onClick={() => setSshAuthType('key')}
                      className={`flex-1 py-1 rounded text-center transition-colors ${
                        sshAuthType === 'key' ? 'bg-emerald-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      秘密鍵
                    </button>
                  </div>
                </div>

                {sshAuthType === 'password' ? (
                  <div>
                    <label className="block text-slate-400 mb-1">パスワード</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        disabled={!enableSsh}
                        value={sshPassword}
                        onChange={(e) => handleSshPassChange(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-slate-900 border border-slate-800 rounded pl-2.5 pr-8 py-1.5 text-slate-100 focus:outline-hidden focus:border-emerald-500 font-mono text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2 top-2 text-slate-500 hover:text-slate-300"
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-slate-400">秘密鍵 (OpenSSH / RSA)</label>
                        <label className="cursor-pointer text-[10px] text-emerald-400 hover:underline flex items-center space-x-1">
                          <UploadCloud className="w-3 h-3" />
                          <span>ファイル選択</span>
                          <input
                            type="file"
                            className="hidden"
                            onChange={handleKeyFileUpload}
                          />
                        </label>
                      </div>
                      <textarea
                        rows={3}
                        disabled={!enableSsh}
                        value={sshPrivateKey}
                        onChange={(e) => setSshPrivateKey(e.target.value)}
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
                        className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-slate-100 focus:outline-hidden focus:border-emerald-500 font-mono text-[10px] leading-tight"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">秘密鍵パスフレーズ（任意）</label>
                      <input
                        type="password"
                        disabled={!enableSsh}
                        value={sshPassphrase}
                        onChange={(e) => setSshPassphrase(e.target.value)}
                        placeholder="暗号化鍵の場合のみ入力"
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 focus:outline-hidden focus:border-emerald-500 font-mono text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* FTP Settings Box */}
            <div className={`p-4 rounded-xl border transition-colors ${
              enableFtp ? 'bg-slate-950/40 border-slate-800' : 'bg-slate-950/10 border-slate-900 opacity-60'
            }`}>
              <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800/80">
                <div className="flex items-center space-x-1.5 text-blue-400 font-medium">
                  <FolderTree className="w-3.5 h-3.5" />
                  <span>FTP ファイルマネージャー設定</span>
                </div>
                <label className="flex items-center space-x-1 text-[11px] cursor-pointer text-slate-400">
                  <input
                    type="checkbox"
                    checked={enableFtp}
                    onChange={(e) => setEnableFtp(e.target.checked)}
                    className="rounded accent-blue-500"
                  />
                  <span>有効</span>
                </label>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-slate-400 mb-1">ユーザー名</label>
                    <input
                      type="text"
                      disabled={!enableFtp}
                      value={ftpUsername}
                      onChange={(e) => setFtpUsername(e.target.value)}
                      placeholder="ftpuser"
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 focus:outline-hidden focus:border-blue-500 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">ポート</label>
                    <input
                      type="number"
                      disabled={!enableFtp}
                      value={ftpPort}
                      onChange={(e) => setFtpPort(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 focus:outline-hidden focus:border-blue-500 font-mono text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">パスワード</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    disabled={!enableFtp}
                    value={ftpPassword}
                    onChange={(e) => setFtpPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 focus:outline-hidden focus:border-blue-500 font-mono text-xs"
                  />
                </div>

                {/* Charset selector (FFFTP equivalent feature) */}
                <div>
                  <label className="block text-slate-400 mb-1">ファイル名文字コード (FFFTP互換)</label>
                  <select
                    disabled={!enableFtp}
                    value={ftpCharset}
                    onChange={(e) => setFtpCharset(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 focus:outline-hidden focus:border-blue-500 text-xs"
                  >
                    <option value="Shift-JIS">Shift-JIS (Windows・レガシー日本語サーバー推奨)</option>
                    <option value="UTF-8">UTF-8 (モダンLinuxサーバー推奨)</option>
                    <option value="EUC-JP">EUC-JP (Solaris / 旧UNIXサーバー)</option>
                  </select>
                </div>

                {/* PASV mode */}
                <div className="flex items-center space-x-2 pt-1">
                  <input
                    type="checkbox"
                    id="ftpPassive"
                    disabled={!enableFtp}
                    checked={ftpPassive}
                    onChange={(e) => setFtpPassive(e.target.checked)}
                    className="rounded accent-blue-500"
                  />
                  <label htmlFor="ftpPassive" className="text-slate-300 text-[11px] cursor-pointer">
                    PASV（パッシブモード）を使用する（推奨）
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Evidence & Logging Settings Box */}
          <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-slate-200 font-medium">
                <FileText className="w-4 h-4 text-amber-400" />
                <span>エビデンス ＆ 自動ロギング設定</span>
              </div>
              <label className="flex items-center space-x-1.5 text-[11px] cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={enableLogging}
                  onChange={(e) => setEnableLogging(e.target.checked)}
                  className="rounded accent-amber-500"
                />
                <span>ターミナル全入出力を logs/ に自動保存</span>
              </label>
            </div>
            {enableLogging && (
              <div className="flex items-center justify-between pl-6 pt-1.5 text-slate-400 text-[11px] border-t border-slate-900">
                <span>行頭にタイムスタンプ [YYYY-MM-DD HH:mm:ss] を付与する（エビデンス用）</span>
                <label className="flex items-center space-x-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={logTimestamp}
                    onChange={(e) => setLogTimestamp(e.target.checked)}
                    className="rounded accent-amber-500"
                  />
                  <span className="text-slate-300">有効</span>
                </label>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-slate-800 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors font-medium text-xs"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-5 py-2 rounded-lg bg-sky-600 text-white hover:bg-sky-500 shadow-md font-medium text-xs transition-colors disabled:opacity-50 flex items-center space-x-1.5"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{isLoading ? '接続中...' : '接続を開始する'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
