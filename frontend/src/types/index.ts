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
}

export interface ConnectResponse {
  sessionId: string;
  sshConnected: boolean;
  ftpConnected: boolean;
  host: string;
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
