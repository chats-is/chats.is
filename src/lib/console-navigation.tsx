import {
  Banknote,
  CalendarCheck,
  CircleDollarSign,
  Cpu,
  CreditCard,
  Gauge,
  LayoutGrid,
  Logs,
  Percent,
  Settings,
  Sparkles,
  Tickets,
  Users,
  Zap
} from 'lucide-react';

export const ConsoleNavigation = {
  navMain: [
    {
      title: 'Overview',
      url: '/console',
      icon: LayoutGrid
    },
    {
      title: 'Usage',
      url: '/console/usage',
      icon: Logs
    },
    {
      title: 'Providers',
      url: '/console/providers',
      icon: Zap
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
      icon: Sparkles
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
      icon: CreditCard
    },
    {
      title: 'Subscriptions',
      url: '/console/subscriptions',
      icon: CalendarCheck
    },
    {
      title: 'Payments',
      url: '/console/payments',
      icon: Banknote
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
