import { Link } from '@tanstack/react-router';

import { useAppName } from '@/lib/head';
import { Logo } from '@/components/logo';

export function SidebarHeader() {
  const appName = useAppName();

  return (
    <Link
      to="/"
      className="flex items-center gap-2 px-4 py-3 text-lg font-medium"
    >
      <Logo label="Logo" />
      <span>{appName}</span>
    </Link>
  );
}
