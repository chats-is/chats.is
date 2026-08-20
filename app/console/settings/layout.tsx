import { ConsoleSettingsNav } from '@/components/console/settings-nav';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="flex flex-col gap-0 lg:flex-row">
      <ConsoleSettingsNav />
      <div className="min-w-0 flex-1 lg:pl-8">{children}</div>
    </div>
  );
}
