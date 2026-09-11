import { Link } from '@tanstack/react-router';

import { useAppName } from '@/lib/head';

export function SidebarHeader() {
  const appName = useAppName();

  return (
    <Link
      to="/"
      className="flex items-center gap-2 px-4 py-3 text-lg font-medium"
    >
      <img src="/favicon.svg" alt="Logo" className="size-7" />
      <span>{appName}</span>
    </Link>
  );
}
