export interface ConnectRequest {
  host: string;
  sshPort: number;
  sshUsername: string;
  sshPassword?: string;
  sshPrivateKey?: string;
  sshPassphrase?: string;
  ftpPort: number;
  ftpUsername: string;
  ftpPassword?: string;
  ftpPassive: boolean;
  ftpCharset: 'UTF-8' | 'Shift-JIS' | 'EUC-JP';
  enableSsh: boolean;
  enableFtp: boolean;
  enableLogging?: boolean;
  logTimestamp?: boolean;
}

export interface ConnectResponse {
  sessionId: string;
  sshConnected: boolean;
  ftpConnected: boolean;
  host: string;
  logFilePath?: string;
}

export interface SessionStatus {
  connected: boolean;
  sessionId?: string;
  sshConnected?: boolean;
  ftpConnected?: boolean;
  host?: string;
  sshPort?: number;
  sshUsername?: string;
  ftpPort?: number;
  ftpUsername?: string;
  ftpCharset?: string;
  logFilePath?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
  modTime: string;
  mode: string;
}

export interface FtpListResponse {
  path: string;
  entries: FileEntry[];
}

export interface SshListResponse {
  path: string;
  entries: FileEntry[];
}

export interface FilePreviewResponse {
  path: string;
  name: string;
  size: number;
  content: string;
  truncated: boolean;
}

export interface CommandHistoryItem {
  id: string;
  command: string;
  timestamp: number;
}

export interface StepRunState {
  active: boolean;
  lines: string[];
  currentIndex: number;
}

export interface PlaceholderParam {
  key: string;
  value: string;
  count: number;
}

export interface SessionTab {
  id: string; // sessionId
  title: string;
  status: SessionStatus;
  layout: 'split' | 'terminal' | 'explorer';
}

export interface SessionSummary {
  id: string;
  host: string;
  sshConnected: boolean;
  ftpConnected: boolean;
  sshPort: number;
  sshUsername: string;
  ftpPort: number;
  ftpUsername: string;
  ftpCharset: string;
  logFilePath?: string;
}

export interface LogInfo {
  name: string;
  path: string;
  size: number;
  modTime: string;
}

