/**
 * Scoped logger for the extension.
 *
 * Debug-level output is suppressed unless "Detailed Logging" is enabled in
 * settings (chrome.storage.local key "settings" -> detailedLogging). The
 * flag is cached with a lightweight refresh; all other levels always print
 * so real failures are never silently dropped.
 */

import type { AppSettings } from '../types';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let detailedLogging = false;
let settingsLoaded = false;

/** Preload the detailedLogging flag (best-effort, never throws). */
export async function initLogging(): Promise<void> {
  try {
    const result = (await chrome.storage.local.get('settings')) as {
      settings?: Partial<AppSettings>;
    };
    detailedLogging = result.settings?.detailedLogging === true;
    settingsLoaded = true;
  } catch {
    settingsLoaded = false;
  }
}

/** React to live settings changes (called from the settings service). */
export function setDetailedLogging(enabled: boolean): void {
  detailedLogging = enabled;
  settingsLoaded = true;
}

function emit(level: LogLevel, scope: string, args: unknown[]): void {
  if (level === 'debug' && (!settingsLoaded || !detailedLogging)) return;
  const prefix = `[SMD:${scope}]`;
  const fn =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log;
  fn(prefix, ...args);
}

export class Logger {
  constructor(private readonly scope: string) {}

  debug(...args: unknown[]): void {
    emit('debug', this.scope, args);
  }

  info(...args: unknown[]): void {
    emit('info', this.scope, args);
  }

  warn(...args: unknown[]): void {
    emit('warn', this.scope, args);
  }

  error(...args: unknown[]): void {
    emit('error', this.scope, args);
  }
}
