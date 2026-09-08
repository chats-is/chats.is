import { useMemo, useState } from 'react';
import { toc } from '@lobehub/icons';
import { Check, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { ModelIcon } from '@/components/model-icon';

type IconPickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** What to search for on open — usually a word out of the model's own id. */
  initialSearch?: string;
};

const ICON_LIST = (
  toc as Array<{
    id: string;
    title?: string;
    fullTitle?: string;
    group?: string;
    param?: { hasColor?: boolean };
  }>
)
  .flatMap(icon => {
    const title = icon.fullTitle || icon.title || icon.id;
    const items = [
      {
        value: icon.id,
        title,
        id: icon.id
      }
    ];
    if (icon.param?.hasColor) {
      items.push({
        value: `${icon.id}.Color`,
        title: `${title} Color`,
        id: icon.id
      });
    }
    return items;
  })
  .sort((a, b) => a.title.localeCompare(b.title));

export default function IconPickerList({
  value,
  onChange,
  disabled,
  initialSearch
}: IconPickerProps) {
  // Seeded rather than empty: the picker opens inside a model's own form, so
  // the icons worth seeing first are the ones named after it. The seed only
  // survives until the first keystroke, which is what `touched` marks.
  const [iconSearch, setIconSearch] = useState(initialSearch ?? '');
  const [touched, setTouched] = useState(false);

  const filteredIcons = useMemo(() => {
    const query = iconSearch.trim().toLowerCase();
    if (!query) return ICON_LIST;
    const matches = ICON_LIST.filter(icon => {
      return (
        icon.value.toLowerCase().includes(query) ||
        icon.id.toLowerCase().includes(query) ||
        icon.title.toLowerCase().includes(query)
      );
    });
    // A guess that matches nothing should not look like an empty catalogue.
    return matches.length === 0 && !touched ? ICON_LIST : matches;
  }, [iconSearch, touched]);

  return (
    <div className="overflow-hidden">
      <div className="relative">
        <Input
          placeholder="Search icons..."
          value={iconSearch}
          onChange={e => {
            setTouched(true);
            setIconSearch(e.target.value);
          }}
          disabled={disabled}
          className="border-0 pr-9 shadow-none focus-visible:ring-0"
        />
        {iconSearch && (
          // The search arrives already filled in, so the way back to the whole
          // catalogue has to be one click rather than nine backspaces.
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setTouched(true);
              setIconSearch('');
            }}
            disabled={disabled}
            className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="mx-3 h-px bg-border" />
      {/* Three rows then scroll: 3 × 2.5rem of button, 2 × 0.5rem of gap and
          the 1.5rem this container pads with come to exactly 10rem. */}
      <div className="grid max-h-40 grid-cols-8 gap-2 overflow-y-auto p-3">
        {filteredIcons.map(icon => (
          <button
            key={icon.value}
            type="button"
            className={`relative flex items-center justify-center rounded-md p-2 transition-colors hover:bg-muted/50 ${
              value === icon.value ? 'bg-muted/60' : ''
            }`}
            onClick={() => onChange(icon.value)}
            title={icon.title}
            disabled={disabled}
          >
            <ModelIcon image={icon.value} className="size-6" />
            {value === icon.value && (
              <span className="absolute right-1 bottom-1 inline-flex size-3 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-2.5" />
              </span>
            )}
          </button>
        ))}
      </div>
      {filteredIcons.length === 0 && (
        <div className="py-6 text-center text-xs text-muted-foreground">
          No icons found.
        </div>
      )}
    </div>
  );
}
