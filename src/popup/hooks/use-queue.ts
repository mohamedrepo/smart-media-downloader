import { useEffect, useState } from 'react';
import type { DownloadProgress, DownloadTask } from '../../types';

/**
 * Live queue subscription: initial snapshot via GET_QUEUE, then streaming
 * updates via QUEUE_UPDATED / PROGRESS_UPDATE broadcasts. The popup is a
 * pure observer — the background service worker owns all real state.
 */
export function useQueue(): {
  tasks: DownloadTask[];
  progress: Map<string, DownloadProgress>;
} {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [progress, setProgress] = useState<Map<string, DownloadProgress>>(
    () => new Map(),
  );

  useEffect(() => {
    let alive = true;

    const loadInitial = (): void => {
      chrome.runtime
        .sendMessage({ type: 'GET_QUEUE' })
        .then((res: unknown) => {
          if (!alive || !res || !(res as { ok?: boolean }).ok) return;
          const tasksPayload = (res as { tasks?: DownloadTask[] }).tasks ?? [];
          setTasks(tasksPayload);
        })
        .catch(() => undefined);
    };
    loadInitial();

    const onMessage = (msg: unknown): void => {
      if (typeof msg !== 'object' || msg === null) return;
      const m = msg as { type?: string; payload?: unknown };
      if (m.type === 'QUEUE_UPDATED') {
        const payload = m.payload as { tasks?: DownloadTask[] } | undefined;
        if (payload?.tasks) setTasks(payload.tasks);
      } else if (m.type === 'PROGRESS_UPDATE') {
        const p = m.payload as DownloadProgress;
        setProgress((prev) => new Map(prev).set(p.taskId, p));
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    // Refresh snapshot when the popup re-gains focus.
    const onFocus = (): void => loadInitial();
    window.addEventListener('focus', onFocus);

    return () => {
      alive = false;
      chrome.runtime.onMessage.removeListener(onMessage);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return { tasks, progress };
}
