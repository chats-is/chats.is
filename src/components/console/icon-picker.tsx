import { lazy, Suspense } from 'react';
import { ClientOnly } from '@tanstack/react-router';

import { Input } from '@/components/ui/input';

type IconPickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** What to search for on open — usually a word out of the model's own id. */
  initialSearch?: string;
};

/**
 * The catalogue comes from the same icon package as ModelIcon, and carries the
 * same restriction: its directory imports cannot be resolved while rendering
 * on the server. Loaded in the browser, behind the field it fills in.
 */
const IconPickerList = lazy(
  () => import('@/components/console/icon-picker-list')
);

/**
 * The word to search the icon catalogue for when the picker opens.
 *
 * A model id is a name and a version — `grok-4.6`, `gpt-image-1` — and only
 * the name half is ever an icon. Taking the first run of letters gets it, and
 * gets nothing useful for an id that starts with a number, which the picker
 * treats as no guess at all.
 */
export function iconSearchSeed(identity: string): string {
  return identity.match(/[a-zA-Z]+/)?.[0] ?? '';
}

export function IconPicker(props: IconPickerProps) {
  return (
    <ClientOnly fallback={<Input value={props.value} disabled readOnly />}>
      <Suspense fallback={<Input value={props.value} disabled readOnly />}>
        <IconPickerList {...props} />
      </Suspense>
    </ClientOnly>
  );
}
