/**
 * MV3 background service worker — entry point.
 *
 * MV3 service workers are event-driven and short-lived: Chrome starts the
 * worker for events (messages, downloads callbacks, alarms) and may
 * terminate it after ~30s of inactivity. Long-running work therefore:
 *   - persists all state in IndexedDB (not memory),
 *   - resumes tasks from persisted chunk state when re-woken,
 *   - never relies on module-level variables for correctness.
 *
 * On every worker start we re-queue tasks that were mid-flight when the
 * previous worker died (their chunk progress survives in IndexedDB).
 */

import { initLogging, Logger } from '../utils/logger';
import { loadSettings } from '../utils/storage';
import { QueueManager } from './queue-manager';
import { DownloadManager } from './download-manager';
import { registerMessageRouter } from './messaging';
import type { AppSettings } from '../types';

const log = new Logger('sw');

const queue = new QueueManager();
const downloads = new DownloadManager(queue);

void (async () => {
  await initLogging();
  const settings: AppSettings = await loadSettings();
  await queue.init(settings);
  log.info('service worker initialized');
})();

chrome.runtime.onInstalled.addListener((details) => {
  log.info('extension installed', details.reason);
});

registerMessageRouter({ queue, downloads });
