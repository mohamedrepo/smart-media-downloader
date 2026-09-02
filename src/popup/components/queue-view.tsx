import type { DownloadProgress, DownloadTask } from '../../types';
import { formatBytes, formatEta, formatSpeed } from '../../utils/format';

/**
 * Full queue view: active downloads with per-connection progress bars,
 * waiting tasks, completed, and failed — matching the spec's layout.
 */
export function QueueView({
  tasks,
  progress,
  onControl,
}: {
  tasks: DownloadTask[];
  progress: Map<string, DownloadProgress>;
  onControl: (taskId: string, action: 'pause' | 'resume' | 'cancel' | 'retry' | 'remove') => void;
}): React.ReactElement | null {
  if (tasks.length === 0) {
    return (
      <div className="border-t border-slate-800 px-4 py-3 text-center text-[11px] text-slate-500">
        No downloads yet. Detected media appears above.
      </div>
    );
  }
  const active = tasks.filter((t) => t.state === 'active' || t.state === 'queued' || t.state === 'paused');
  const completed = tasks.filter((t) => t.state === 'completed');
  const failed = tasks.filter((t) => t.state === 'failed' || t.state === 'cancelled');

  return (
    <div className="border-t border-slate-800">
      {active.length > 0 && (
        <div className="px-4 pt-3">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Active downloads
          </h3>
          <div className="space-y-3">
            {active.map((task) => (
              <ActiveRow key={task.id} task={task} progress={progress.get(task.id)} onControl={onControl} />
            ))}
          </div>
        </div>
      )}
      {completed.length > 0 && (
        <div className="px-4 pt-3">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Completed
          </h3>
          {completed.map((task) => (
            <div key={task.id} className="flex items-center justify-between py-1 text-xs text-slate-300">
              <span className="truncate">
                <span className="mr-1 text-emerald-400">✓</span>
                {task.filename}
              </span>
              <button
                type="button"
                onClick={() => onControl(task.id, 'remove')}
                className="ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      {failed.length > 0 && (
        <div className="px-4 py-3">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Failed
          </h3>
          {failed.map((task) => (
            <div key={task.id} className="py-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="truncate text-slate-300">
                  <span className="mr-1 text-red-400">✗</span>
                  {task.filename}
                </span>
                <span className="ml-2 flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onControl(task.id, 'retry')}
                    className="rounded px-1.5 py-0.5 text-[10px] text-sky-400 hover:bg-slate-800"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => onControl(task.id, 'remove')}
                    className="rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-800"
                  >
                    Remove
                  </button>
                </span>
              </div>
              {task.error && (
                <p className="mt-0.5 text-[10px] leading-snug text-red-300/80">{task.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActiveRow({
  task,
  progress,
  onControl,
}: {
  task: DownloadTask;
  progress?: DownloadProgress;
  onControl: QueueControl;
}): React.ReactElement {
  const percent =
    progress?.percent ??
    (task.totalBytes ? Math.min(100, (task.bytesDownloaded / task.totalBytes) * 100) : 0);
  const paused = task.state === 'paused';
  const waiting = task.state === 'queued';

  return (
    <div className="rounded bg-surface-raised p-2.5">
      <div className="flex items-center justify-between text-xs text-slate-200">
        <span className="truncate font-medium">{task.filename}</span>
        <span className="ml-2 flex shrink-0 gap-1">
          {paused ? (
            <SmallButton label="Resume" onClick={() => onControl(task.id, 'resume')} />
          ) : (
            !waiting && <SmallButton label="Pause" onClick={() => onControl(task.id, 'pause')} />
          )}
          <SmallButton label="Cancel" onClick={() => onControl(task.id, 'cancel')} />
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-700">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      {waiting ? (
        <p className="mt-1 text-[10px] text-slate-500">Waiting…</p>
      ) : (
        <>
          <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
            <span>
              {formatBytes(task.bytesDownloaded)} / {formatBytes(task.totalBytes)} ·{' '}
              {percent.toFixed(0)}%
            </span>
            <span>
              {progress ? `${formatSpeed(progress.speedBps)} · ${progress.activeConnections} conn · ETA ${formatEta(progress.etaSeconds)}` : ''}
            </span>
          </div>
          {progress && progress.chunkProgress.length > 1 && (
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
              {progress.chunkProgress.map((chunk) => (
                <div key={chunk.index} className="flex items-center gap-1.5 text-[9px] text-slate-500">
                  <span className="w-8 shrink-0">#{chunk.index + 1}</span>
                  <div className="h-1 flex-1 overflow-hidden rounded bg-slate-700">
                    <div
                      className={
                        'h-full ' +
                        (chunk.status === 'done'
                          ? 'bg-emerald-500'
                          : chunk.status === 'failed'
                            ? 'bg-red-500'
                            : 'bg-accent')
                      }
                      style={{ width: `${chunk.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

type QueueControl = (taskId: string, action: 'pause' | 'resume' | 'cancel' | 'retry' | 'remove') => void;

function SmallButton({ label, onClick }: { label: string; onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-700 hover:text-slate-100"
    >
      {label}
    </button>
  );
}
