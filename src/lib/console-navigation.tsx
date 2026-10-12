import {
  CalendarCheck,
  ChartLine,
  CircleDollarSign,
  Cpu,
  CreditCard,
  Gauge,
  LayoutGrid,
  Logs,
  Package,
  Percent,
  Plug,
  Settings,
  SquareSparkles,
  Tickets,
  Users
} from 'lucide-react';

export const ConsoleNavigation = {
  navMain: [
    {
      title: 'Overview',
      url: '/console',
      icon: LayoutGrid
    },
    {
      title: 'Revenue',
      url: '/console/revenue',
      icon: ChartLine
    },
    {
      title: 'Usage',
      url: '/console/usage',
      icon: Logs
    },
    {
      title: 'Providers',
      url: '/console/providers',
      icon: Plug
    },
    {
      title: 'Models',
      url: '/console/models',
      icon: Cpu
    },
    {
      title: 'Pricing',
      url: '/console/pricing',
      icon: CircleDollarSign
    },
    {
      title: 'Prompts',
      url: '/console/prompts',
      icon: SquareSparkles
    },
    {
      title: 'Quotas',
      url: '/console/quotas',
      icon: Gauge
    },
    {
      title: 'Tiers',
      url: '/console/tiers',
      icon: Percent
    },
    {
      title: 'Plans',
      url: '/console/plans',
      icon: Package
    },
    {
      title: 'Subscriptions',
      url: '/console/subscriptions',
      icon: CalendarCheck
    },
    {
      title: 'Payments',
      url: '/console/payments',
      icon: CreditCard
    },
    {
      title: 'Refund requests',
      url: '/console/refund-requests',
      icon: Tickets
    },
    {
      title: 'Users',
      url: '/console/users',
      icon: Users
    },
    {
      title: 'Settings',
      url: '/console/settings',
      icon: Settings
    }
  ]
};
