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

export interface AIStatusResponse {
  available: boolean;
  version?: string;
  command?: string;
  error?: string;
}

export interface AIFileItem {
  name: string;
  size: number;
  isDir: boolean;
  modTime?: string;
}

export interface AICommandSnippet {
  command: string;
  description?: string;
  isDangerous: boolean;
}

export interface AIInspectLog {
  command: string;
  reason?: string;
  output: string;
  error?: string;
  duration?: string;
  blocked?: boolean;
}

export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  commands?: AICommandSnippet[];
  inspectLogs?: AIInspectLog[];
  timestamp: number;
}

export interface AIChatContext {
  sessionId?: string;
  host?: string;
  user?: string;
  isRoot?: boolean;
  currentDir?: string;
  files?: AIFileItem[];
  terminalRecentOutput?: string;
  history?: { role: string; content: string }[];
}

export interface AIChatRequest {
  prompt: string;
  context: AIChatContext;
  model?: string;
  autoInspect?: boolean;
  allowedCommands?: string[];
  sessionId?: string;
  hostKey?: string;
  isResume?: boolean;
}

export interface AIChatResponse {
  sessionId?: string;
  reply: string;
  commands: AICommandSnippet[];
  inspectLogs?: AIInspectLog[];
}

export interface AISessionSummary {
  id: string;
  title: string;
  hostKey: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface AIKnowledgeResponse {
  hostKey: string;
  workspacePath: string;
  content: string;
  updatedAt?: string;
}



