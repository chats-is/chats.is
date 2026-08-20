import { redirect } from 'next/navigation';

// The settings sections are pages behind a nav; /console/settings itself is
// just the entry point.
export default function SettingsPage() {
  redirect('/console/settings/general');
}
