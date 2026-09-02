import { createFileRoute, redirect } from '@tanstack/react-router';

// The settings sections are pages behind a nav; /console/settings itself is
// just the entry point.
export const Route = createFileRoute('/console/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/console/settings/general' });
  }
});
