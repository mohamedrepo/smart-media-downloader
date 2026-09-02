/**
 * Typed chrome.storage.local wrapper for extension settings.
 *
 * Settings are stored under a single "settings" key and always merged over
 * DEFAULT_SETTINGS so that adding new fields in future versions never
 * breaks existing installs.
 */

import {
  DEFAULT_SETTINGS,
  type AppSettings,
} from '../types';
import { setDetailedLogging } from './logger';

const SETTINGS_KEY = 'settings';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/** Merge a partial settings object, dropping unknown/unsafe keys. */
function sanitizePatch(patch: unknown): Partial<AppSettings> {
  if (!isPlainObject(patch)) return {};
  const clean: Partial<AppSettings> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>) {
    if (key in patch) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (clean as any)[key] = (patch as Record<string, unknown>)[key];
    }
  }
  return clean;
}

/** Load settings merged over defaults. */
export async function loadSettings(): Promise<AppSettings> {
  const result = (await chrome.storage.local.get(SETTINGS_KEY)) as {
    settings?: Partial<AppSettings>;
  };
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...sanitizePatch(result.settings),
  };
  setDetailedLogging(merged.detailedLogging);
  return merged;
}

/** Persist a patch over current settings and return the merged result. */
export async function saveSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await loadSettings();
  const next: AppSettings = { ...current, ...sanitizePatch(patch) };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  setDetailedLogging(next.detailedLogging);
  return next;
}

/** Reset settings to defaults. */
export async function resetSettings(): Promise<AppSettings> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  setDetailedLogging(DEFAULT_SETTINGS.detailedLogging);
  return { ...DEFAULT_SETTINGS };
}
