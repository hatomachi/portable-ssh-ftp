import type { Terminal as XTerm } from '@xterm/xterm';
import { extractLastCommandAndOutput, stripAnsi } from './terminalEvidence';
import type { AIFileItem } from '../types';

interface SessionContextRecord {
  currentPath?: string;
  files?: AIFileItem[];
  termRef?: XTerm | null;
}

const registry: Record<string, SessionContextRecord> = {};

export function updateExplorerContext(sessionId: string, path: string, entries: any[] = []) {
  if (!registry[sessionId]) {
    registry[sessionId] = {};
  }
  registry[sessionId].currentPath = path;
  registry[sessionId].files = entries.map((e) => ({
    name: e.name,
    size: e.size || 0,
    isDir: Boolean(e.isDir),
    modTime: e.modTime,
  }));
}

export function registerTerminalInstance(sessionId: string, term: XTerm | null) {
  if (!registry[sessionId]) {
    registry[sessionId] = {};
  }
  registry[sessionId].termRef = term;
}

export function unregisterTerminalInstance(sessionId: string) {
  if (registry[sessionId]) {
    registry[sessionId].termRef = null;
  }
}

/**
 * Extracts recent terminal text for AI context.
 * Prioritizes user selection, then last command and output, followed by trailing buffer lines.
 */
export function getRecentTerminalOutput(sessionId: string, maxLines = 80): string {
  const record = registry[sessionId];
  if (!record || !record.termRef) {
    return '';
  }

  const term = record.termRef;

  // 1. If user has active selection, return that
  const selection = term.getSelection();
  if (selection && selection.trim().length > 0) {
    return `[ユーザー選択範囲]:\n${stripAnsi(selection).trim()}`;
  }

  // 2. Try last command and output
  const lastCmd = extractLastCommandAndOutput(term);

  // 3. Extract recent buffer lines from bottom
  const buffer = term.buffer.active;
  const totalLines = buffer.length;
  const startLine = Math.max(0, totalLines - maxLines);

  const rawLines: string[] = [];
  for (let i = startLine; i < totalLines; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;
    rawLines.push(line.translateToString(true));
  }

  const recentBufferText = stripAnsi(rawLines.join('\n')).trimEnd();

  if (lastCmd && lastCmd.length > 20) {
    return `【直前のコマンドと出力】\n${lastCmd}\n\n【ターミナル直近バッファ】\n${recentBufferText}`;
  }

  return recentBufferText;
}

export function getSessionAiContext(sessionId: string): {
  currentPath: string;
  files: AIFileItem[];
  terminalRecentOutput: string;
} {
  const record = registry[sessionId];
  return {
    currentPath: record?.currentPath || '',
    files: record?.files || [],
    terminalRecentOutput: getRecentTerminalOutput(sessionId),
  };
}
