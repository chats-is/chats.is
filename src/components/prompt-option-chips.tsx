import { AUTO_OPTION, MEDIA_OPTION_LABELS } from '@/lib/constant';
import { optionLabel, type MediaOptionKey } from '@/lib/media-settings';
import { cn } from '@/lib/utils';
import { OptionShapeIcon } from '@/components/media-settings-menu';

/**
 * A model's options as rows of pills, one picked in each — the rows the media
 * generation settings offer for it (`optionRows`).
 */
export function PromptOptionChips({
  rows,
  values,
  onChange
}: {
  rows: Array<{ key: MediaOptionKey; allowed: string[] }>;
  values: Partial<Record<MediaOptionKey, string>>;
  onChange: (key: MediaOptionKey, value: string) => void;
}) {
  return (
    <div className="space-y-3">
      {rows.map(row => (
        <div key={row.key} className="space-y-1.5">
          <p className="text-sm text-muted-foreground">
            {MEDIA_OPTION_LABELS[row.key]}
          </p>
          <div
            role="radiogroup"
            aria-label={MEDIA_OPTION_LABELS[row.key]}
            className="flex flex-wrap gap-1.5"
          >
            {row.allowed.map(value => {
              const on = (values[row.key] ?? AUTO_OPTION) === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onChange(row.key, value)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                    on
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <OptionShapeIcon
                    optionKey={row.key}
                    value={value}
                    className="size-3.5 shrink-0"
                  />
                  {optionLabel(row.key, value)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
