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

export type LineEnding = 'LF' | 'CRLF' | 'CR' | 'Mixed' | 'None' | 'preserve';

export interface FilePreviewResponse {
  path: string;
  name: string;
  size: number;
  content: string;
  truncated: boolean;
}

export interface FileReadResponse {
  path: string;
  name: string;
  size: number;
  content: string;
  lineEnding: LineEnding;
  charset: string;
  truncated: boolean;
  isBinary: boolean;
  editable: boolean;
  readonlyReason?: string;
}

export interface FileSaveRequest {
  path: string;
  content: string;
  lineEnding: LineEnding;
  charset?: string;
  createBackup: boolean;
}

export interface FileSaveResponse {
  status: string;
  path: string;
  backupPath?: string;
  size: number;
  lineEnding: LineEnding;
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

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  sshPort: number;
  sshUsername: string;
  sshAuthType: 'password' | 'key';
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
  enableLogging: boolean;
  logTimestamp: boolean;
  savePassword?: boolean;
  updatedAt?: string;
}


