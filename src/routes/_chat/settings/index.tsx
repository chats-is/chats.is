import { createFileRoute, redirect } from '@tanstack/react-router';

/** Settings has no landing page of its own; General is the first panel. */
export const Route = createFileRoute('/_chat/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/general' });
  }
});
