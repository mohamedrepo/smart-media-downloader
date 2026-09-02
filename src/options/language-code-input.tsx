import { useState } from 'react';

/**
 * Small BCP-47-ish language code input with a datalist of common languages.
 */
const COMMON = [
  ['en', 'English'],
  ['ar', 'Arabic'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ru', 'Russian'],
  ['zh', 'Chinese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['hi', 'Hindi'],
  ['tr', 'Turkish'],
];

export function LanguageCodeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  const [internal, setInternal] = useState<string | null>(null);
  const shown = internal ?? value;
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="mt-0.5 text-xs text-slate-400">
          Language code (e.g. "en", "ar", "fr"). Used when the site exposes no label.
        </p>
      </div>
      <div className="shrink-0">
        <input
          type="text"
          list="smd-common-languages"
          value={shown}
          onChange={(e) => {
            setInternal(e.target.value);
            const cleaned = e.target.value.trim().toLowerCase();
            if (/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(cleaned)) {
              onChange(cleaned);
            }
          }}
          className="w-40 rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        <datalist id="smd-common-languages">
          {COMMON.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </datalist>
      </div>
    </div>
  );
}
