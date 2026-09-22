import type { 
  ConnectRequest, 
  ConnectResponse, 
  SessionStatus, 
  FtpListResponse, 
  SshListResponse, 
  FilePreviewResponse,
  SessionSummary,
  ConnectionProfile
} from '../types';

const API_BASE = '/api';

export async function connectSession(req: ConnectRequest): Promise<ConnectResponse> {
  const res = await fetch(`${API_BASE}/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to connect');
  }
  return data;
}

export async function disconnectSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/disconnect?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to disconnect');
  }
}

export async function getStatus(sessionId?: string): Promise<SessionStatus> {
  const url = sessionId 
    ? `${API_BASE}/status?sessionId=${encodeURIComponent(sessionId)}` 
    : `${API_BASE}/status`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Failed to get status');
  }
  return res.json();
}

export async function listFtpFiles(sessionId: string, path: string): Promise<FtpListResponse> {
  const res = await fetch(`${API_BASE}/ftp/list?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to list directory');
  }
  return data;
}

export async function getFtpPwd(sessionId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/ftp/pwd?sessionId=${encodeURIComponent(sessionId)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to get current directory');
  }
  return data.pwd;
}

export async function changeFtpDir(sessionId: string, path: string): Promise<string> {
  const res = await fetch(`${API_BASE}/ftp/cd?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to change directory');
  }
  return data.pwd;
}

export function getDownloadUrl(sessionId: string, path: string): string {
  return `${API_BASE}/ftp/download?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`;
}

export async function uploadFtpFile(sessionId: string, targetDir: string, file: File): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('dir', targetDir);

  const res = await fetch(`${API_BASE}/ftp/upload?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    body: formData,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to upload file');
  }
}

export async function deleteFtpItem(sessionId: string, path: string, isDir: boolean): Promise<void> {
  const res = await fetch(
    `${API_BASE}/ftp/delete?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}&isDir=${isDir}`,
    { method: 'DELETE' }
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to delete item');
  }
}

export async function createFtpDir(sessionId: string, path: string): Promise<void> {
  const res = await fetch(`${API_BASE}/ftp/mkdir?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to create directory');
  }
}

export async function fetchSshFiles(sessionId: string, path: string = ''): Promise<SshListResponse> {
  const res = await fetch(`${API_BASE}/ssh/files?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to list remote directory');
  }
  return data;
}

export async function viewSshFile(sessionId: string, path: string, maxBytes: number = 65536): Promise<FilePreviewResponse> {
  const res = await fetch(`${API_BASE}/ssh/file/view?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}&maxBytes=${maxBytes}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to read file preview');
  }
  return data;
}

export function getSshDownloadUrl(sessionId: string, path: string): string {
  return `${API_BASE}/ssh/download?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`;
}

export async function uploadSshFile(sessionId: string, targetDir: string, file: File): Promise<{ status: string; path: string; name: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('dir', targetDir);

  const res = await fetch(`${API_BASE}/ssh/upload?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    body: formData,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to upload file via SSH');
  }
  return data;
}

export async function duplicateSession(sessionId: string): Promise<ConnectResponse> {
  const res = await fetch(`${API_BASE}/session/${encodeURIComponent(sessionId)}/duplicate`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to duplicate session');
  }
  return data;
}

export async function reconnectSession(sessionId: string): Promise<ConnectResponse> {
  const res = await fetch(`${API_BASE}/session/${encodeURIComponent(sessionId)}/reconnect`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to reconnect session');
  }
  return data;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const res = await fetch(`${API_BASE}/sessions`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to list sessions');
  }
  return data.sessions || [];
}

export async function listProfiles(): Promise<ConnectionProfile[]> {
  const res = await fetch(`${API_BASE}/profiles`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to list profiles');
  }
  return data.profiles || [];
}

export async function saveProfile(profile: Partial<ConnectionProfile>): Promise<ConnectionProfile> {
  const res = await fetch(`${API_BASE}/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to save profile');
  }
  return data.profile;
}

export async function deleteProfile(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/profiles?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to delete profile');
  }
}

export async function sendHeartbeat(): Promise<void> {
  await fetch(`${API_BASE}/heartbeat`, { method: 'POST' }).catch(() => {});
}

export function sendShutdownBeacon(): void {
  if (navigator.sendBeacon) {
    navigator.sendBeacon(`${API_BASE}/shutdown-beacon`);
  } else {
    fetch(`${API_BASE}/shutdown-beacon`, { method: 'POST', keepalive: true }).catch(() => {});
  }
}

export async function requestShutdown(): Promise<void> {
  await fetch(`${API_BASE}/shutdown`, { method: 'POST' }).catch(() => {});
}


