/**
 * Runtime messaging router.
 *
 * Maps typed RuntimeMessage requests from popup/options to background
 * services and returns structured responses. Broadcasting (QUEUE_UPDATED /
 * PROGRESS_UPDATE) lives in the queue manager; this module only handles
 * request/response.
 */

import type { RuntimeMessage } from '../types';
import { Logger } from '../utils/logger';
import { loadSettings, saveSettings } from '../utils/storage';
import type { DownloadManager } from './download-manager';
import type { QueueManager } from './queue-manager';

const log = new Logger('messaging');

export interface MessageServices {
  queue: QueueManager;
  downloads: DownloadManager;
}

interface EnqueuePayload {
  media: import('../types').MediaInfo;
  format: import('../types').MediaFormat;
  connections: number;
  subtitleLanguages: string[];
  subtitleFormat: import('../types').SubtitleFormat;
}

type Response =
  | { ok: true }
  | { ok: true; pong: number }
  | { ok: true; tasks: import('../types').DownloadTask[] }
  | { ok: false; error: string };

export function registerMessageRouter(services: MessageServices): void {
  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse): boolean => {
      void handle(message, services)
        .then(sendResponse)
        .catch((err: unknown) => {
          log.error('handler failed', err);
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          } satisfies Response);
        });
      return true; // async response
    },
  );
}

async function handle(
  raw: unknown,
  services: MessageServices,
): Promise<Response> {
  const msg = raw as Partial<RuntimeMessage>;
  switch (msg?.type) {
    case 'PING':
      return { ok: true, pong: Date.now() };

    case 'GET_QUEUE':
      return { ok: true, tasks: await services.queue.snapshot() };

    case 'TASK_CONTROL': {
      const { taskId, action } = msg.payload!;
      log.info('task control', action, taskId);
      if (action === 'pause') await services.queue.pause(taskId);
      else if (action === 'resume') await services.queue.resume(taskId);
      else if (action === 'cancel') await services.queue.cancel(taskId);
      else if (action === 'retry') await services.queue.retry(taskId);
      else if (action === 'remove') await services.queue.remove(taskId);
      return { ok: true };
    }

    case 'REORDER_QUEUE': {
      await services.queue.reorder(msg.payload!.orderedIds);
      return { ok: true };
    }

    case 'ENQUEUE_DOWNLOAD': {
      const payload = msg.payload as EnqueuePayload;
      const task = await services.downloads.createFromEnqueue(
        payload.media,
        payload.format,
        payload.connections,
        payload.subtitleLanguages,
        payload.subtitleFormat,
      );
      return { ok: true, tasks: [task] };
    }

    case 'UPDATE_SETTINGS': {
      const next = await saveSettings(msg.payload!);
      services.queue.applySettings(next);
      return { ok: true };
    }

    case 'RESCAN_ACTIVE_TAB': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) {
        await chrome.tabs.sendMessage(tab.id, { type: 'RESCAN' }).catch(() => undefined);
      }
      return { ok: true };
    }

    case 'PAGE_MEDIA_DETECTED': {
      // Content-script detections are cached by the popup via direct
      // message flow; background only logs when detailed logging is on.
      void loadSettings(); // refresh logging flag opportunistically
      log.debug('page media detected');
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown message type: ${String(msg?.type)}` };
  }
}
