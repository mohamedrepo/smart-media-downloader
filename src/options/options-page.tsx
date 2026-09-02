import { useEffect, useState } from 'react';
import type { AppSettings, QualityPreference, SubtitleFormat } from '../types';
import { loadSettings, resetSettings, saveSettings } from '../utils/storage';
import { LanguageCodeInput } from './language-code-input';

const CONNECTION_CHOICES = [1, 2, 4, 8, 16] as const;

/**
 * Full settings page: Downloads / Quality / Subtitles / Advanced.
 * Every change persists immediately via chrome.storage.local.
 */
export default function OptionsPage(): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedTimer, setSavedTimer] = useState<number | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  const update = (patch: Partial<AppSettings>): void => {
    void saveSettings(patch).then((next) => {
      setSettings(next);
      setSaved(true);
      if (savedTimer !== null) window.clearTimeout(savedTimer);
      setSavedTimer(window.setTimeout(() => setSaved(false), 1200));
    });
  };

  if (!settings) {
    return <div className="p-8 text-sm text-slate-500">Loading settings…</div>;
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Smart Media Downloader</h1>
          <p className="mt-1 text-sm text-slate-500">
            Changes are saved automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void resetSettings().then(setSettings)}
          className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
        >
          Restore defaults
        </button>
      </header>

      <Section title="Downloads">
        <TextField
          label="Default download folder"
          hint="Subfolder inside your browser's default Downloads directory."
          value={settings.downloadFolder}
          onChange={(v) => update({ downloadFolder: v })}
        />
        <SelectField
          label="Maximum simultaneous downloads"
          value={String(settings.maxSimultaneousDownloads)}
          options={[1, 2, 3, 4, 5].map(String)}
          onChange={(v) => update({ maxSimultaneousDownloads: Number(v) })}
        />
        <SelectField
          label="Default number of connections"
          value={String(settings.defaultConnections)}
          options={CONNECTION_CHOICES.map(String)}
          hint="Parallel byte-range connections for servers that support them."
          onChange={(v) => update({ defaultConnections: Number(v) })}
        />
        <ToggleField
          label="Automatically start downloads"
          checked={settings.autoStart}
          onChange={(v) => update({ autoStart: v })}
        />
        <ToggleField
          label="Overwrite existing files"
          hint="Off: a number suffix is added instead (file (1).mp4)."
          checked={settings.overwriteExisting}
          onChange={(v) => update({ overwriteExisting: v })}
        />
      </Section>

      <Section title="Quality">
        <SelectField
          label="Quality preference"
          value={settings.qualityPreference}
          options={['ask', 'highest', '1080p', '720p', 'smallest']}
          optionLabels={{
            ask: 'Always ask',
            highest: 'Prefer highest quality',
            '1080p': 'Prefer 1080p',
            '720p': 'Prefer 720p',
            smallest: 'Prefer smallest file',
          }}
          onChange={(v) => update({ qualityPreference: v as QualityPreference })}
        />
      </Section>

      <Section title="Subtitles">
        <LanguageCodeInput
          label="Preferred subtitle language"
          value={settings.preferredSubtitleLanguage}
          onChange={(v) => update({ preferredSubtitleLanguage: v })}
        />
        <SelectField
          label="Preferred subtitle format"
          value={settings.preferredSubtitleFormat}
          options={['srt', 'vtt']}
          optionLabels={{ srt: 'SRT', vtt: 'VTT' }}
          onChange={(v) => update({ preferredSubtitleFormat: v as SubtitleFormat })}
        />
        <ToggleField
          label="Automatically download selected language"
          hint="Downloads subtitles together with the media when tracks are exposed."
          checked={settings.autoDownloadSubtitles}
          onChange={(v) => update({ autoDownloadSubtitles: v })}
        />
      </Section>

      <Section title="Advanced">
        <ToggleField
          label="Enable detailed logging"
          hint="Debug output to the extension service worker console."
          checked={settings.detailedLogging}
          onChange={(v) => update({ detailedLogging: v })}
        />
        <ToggleField
          label="Retry failed downloads"
          checked={settings.retryFailed}
          onChange={(v) => update({ retryFailed: v })}
        />
        <NumberField
          label="Maximum retry count"
          min={0}
          max={10}
          value={settings.maxRetries}
          onChange={(v) => update({ maxRetries: v })}
        />
        <NumberField
          label="Chunk size (MB)"
          min={1}
          max={64}
          value={settings.chunkSizeMB}
          hint="Minimum split granularity for multi-connection downloads."
          onChange={(v) => update({ chunkSizeMB: v })}
        />
        <NumberField
          label="Connection timeout (seconds)"
          min={5}
          max={300}
          value={settings.connectionTimeoutSeconds}
          onChange={(v) => update({ connectionTimeoutSeconds: v })}
        />
      </Section>

      {saved && (
        <p className="fixed bottom-4 right-4 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow">
          Saved ✓
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="mb-5 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function FieldShell({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function TextField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  return (
    <FieldShell label={label} hint={hint}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-56 rounded border border-slate-300 px-3 py-1.5 text-sm"
      />
    </FieldShell>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}): React.ReactElement {
  return (
    <FieldShell label={label} hint={hint}>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) =>
          onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))
        }
        className="w-24 rounded border border-slate-300 px-3 py-1.5 text-sm"
      />
    </FieldShell>
  );
}

function SelectField({
  label,
  hint,
  value,
  options,
  optionLabels,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: string[];
  optionLabels?: Record<string, string>;
  onChange: (v: string) => void;
}): React.ReactElement {
  return (
    <FieldShell label={label} hint={hint}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-56 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {optionLabels?.[opt] ?? opt}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

function ToggleField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <FieldShell label={label} hint={hint}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={
          'relative h-6 w-11 rounded-full transition-colors ' +
          (checked ? 'bg-emerald-500' : 'bg-slate-300')
        }
      >
        <span
          className={
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ' +
            (checked ? 'left-[22px]' : 'left-0.5')
          }
        />
      </button>
    </FieldShell>
  );
}
