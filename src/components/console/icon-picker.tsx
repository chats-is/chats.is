import { lazy, Suspense } from 'react';
import { ClientOnly } from '@tanstack/react-router';

import { Input } from '@/components/ui/input';

type IconPickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

/**
 * The catalogue comes from the same icon package as ModelIcon, and carries the
 * same restriction: its directory imports cannot be resolved while rendering
 * on the server. Loaded in the browser, behind the field it fills in.
 */
const IconPickerList = lazy(
  () => import('@/components/console/icon-picker-list')
);

export function IconPicker(props: IconPickerProps) {
  return (
    <ClientOnly fallback={<Input value={props.value} disabled readOnly />}>
      <Suspense fallback={<Input value={props.value} disabled readOnly />}>
        <IconPickerList {...props} />
      </Suspense>
    </ClientOnly>
  );
}
