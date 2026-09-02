import { useMemo, useState } from 'react';
import { toc } from '@lobehub/icons';
import { Check } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { ModelIcon } from '@/components/model-icon';

type IconPickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
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
  disabled
}: IconPickerProps) {
  const [iconSearch, setIconSearch] = useState('');

  const filteredIcons = useMemo(() => {
    const query = iconSearch.trim().toLowerCase();
    if (!query) return ICON_LIST;
    return ICON_LIST.filter(icon => {
      return (
        icon.value.toLowerCase().includes(query) ||
        icon.id.toLowerCase().includes(query) ||
        icon.title.toLowerCase().includes(query)
      );
    });
  }, [iconSearch]);

  return (
    <div className="rounded-md border shadow-sm">
      <Input
        placeholder="Search icons..."
        value={iconSearch}
        onChange={e => setIconSearch(e.target.value)}
        disabled={disabled}
        className="border-0 shadow-none focus-visible:ring-0"
      />
      <div className="mx-3 h-px bg-border" />
      <div className="mt-2 grid max-h-28 grid-cols-6 gap-2 overflow-auto p-3">
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
