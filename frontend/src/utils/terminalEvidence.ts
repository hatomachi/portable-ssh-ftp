import type { Terminal } from '@xterm/xterm';

// Regex to strip ANSI escape sequences
export const ANSI_REGEX = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

// Patterns to detect common Unix/Linux/Windows shell prompt lines
export const PROMPT_PATTERNS = [
  // "[root@server /etc]# cmd" or "user@host:~$ cmd"
  /\[?[\w.-]+@[\w.-]+[^$#%>\]\n]*[\]$#%>]/,
  // "(env) user@host:~$ cmd"
  /\([^)]+\)\s*[\w.-]+@[\w.-]+/,
  // "bash-5.1$ cmd", "sh-4.4# cmd", "zsh-5.8% cmd"
  /(?:bash|sh|zsh)-[\d.]+[#$]/,
  // Windows PowerShell "PS C:\Users> cmd"
  /PS [A-Z]:\\[^>]*>/,
  // Generic prompt symbols at line start or after space: "$ cmd", "# cmd", "> cmd", "% cmd"
  /(?:^|\s)[$#%>]\s+/,
];

/**
 * Checks whether a given line looks like a shell prompt.
 */
export function isPromptLine(line: string): boolean {
  const clean = stripAnsi(line).trimEnd();
  return PROMPT_PATTERNS.some((pattern) => pattern.test(clean));
}

/**
 * Extracts the last executed command and its output from an xterm.js instance.
 * If user has text selected in the terminal, returns the selected text.
 */
export function extractLastCommandAndOutput(term: Terminal): string {
  // 1. If user has active selection, prioritize it
  const selection = term.getSelection();
  if (selection && selection.trim().length > 0) {
    return stripAnsi(selection).trim();
  }

  const buffer = term.buffer.active;
  const totalLines = buffer.length;

  // Extract all non-empty lines from buffer with line indices
  const lines: { text: string; index: number }[] = [];
  for (let i = 0; i < totalLines; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const rawText = line.translateToString(true);
    const cleanText = stripAnsi(rawText);
    lines.push({ text: cleanText, index: i });
  }

  // Find the last non-empty line
  let lastNonEmptyIdx = lines.length - 1;
  while (lastNonEmptyIdx >= 0 && lines[lastNonEmptyIdx].text.trim() === '') {
    lastNonEmptyIdx--;
  }

  if (lastNonEmptyIdx < 0) {
    return '';
  }

  // Find the prompt positions scanning backwards from bottom
  let currentPromptIdx = -1;
  let previousPromptIdx = -1;

  for (let i = lastNonEmptyIdx; i >= 0; i--) {
    if (isPromptLine(lines[i].text)) {
      if (currentPromptIdx === -1) {
        currentPromptIdx = i;
      } else {
        previousPromptIdx = i;
        break; // Found the previous prompt!
      }
    }
  }

  let extractedLines: string[] = [];

  if (previousPromptIdx !== -1) {
    // We found both the current waiting prompt and the command prompt before it.
    // Range is from previousPromptIdx to currentPromptIdx - 1
    const endIdx = currentPromptIdx > previousPromptIdx ? currentPromptIdx : lastNonEmptyIdx + 1;
    for (let i = previousPromptIdx; i < endIdx; i++) {
      extractedLines.push(lines[i].text);
    }
  } else if (currentPromptIdx !== -1) {
    // Only one prompt found (e.g. command is currently running or only one command run)
    // If current prompt is near the bottom, take lines above it; otherwise take lines from current prompt downwards
    if (currentPromptIdx === lastNonEmptyIdx) {
      // Prompt is at bottom, look upwards for output
      const start = Math.max(0, currentPromptIdx - 50);
      for (let i = start; i < currentPromptIdx; i++) {
        extractedLines.push(lines[i].text);
      }
    } else {
      for (let i = currentPromptIdx; i <= lastNonEmptyIdx; i++) {
        extractedLines.push(lines[i].text);
      }
    }
  } else {
    // Fallback: take recent non-empty lines (up to 50 lines)
    const start = Math.max(0, lastNonEmptyIdx - 50);
    for (let i = start; i <= lastNonEmptyIdx; i++) {
      extractedLines.push(lines[i].text);
    }
  }

  // Clean trailing blank lines
  while (extractedLines.length > 0 && extractedLines[extractedLines.length - 1].trim() === '') {
    extractedLines.pop();
  }

  return extractedLines.join('\n').trim();
}

/**
 * Formats terminal text into a Markdown fenced code block.
 */
export function formatAsMarkdownCodeBlock(content: string, language = 'bash'): string {
  const trimmed = content.trim();
  if (!trimmed) return '';
  return `\`\`\`${language}\n${trimmed}\n\`\`\``;
}
