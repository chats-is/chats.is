import { CreditCard } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A payment method's brand as a small card-shaped mark: Visa, Mastercard,
 * American Express, Discover, JCB, UnionPay, Diners Club and PayPal drawn
 * in their colours; any other a plain card.
 */
export function PaymentMethodIcon({
  brand,
  className
}: {
  /** The brand as the processor names it: `visa`, `mastercard`, `amex`,
   *  `american_express`, `paypal`, … */
  brand: string | null;
  className?: string;
}) {
  const key = (brand ?? '').toLowerCase().replace(/[\s_-]/g, '');
  const mark = MARKS[ALIASES[key] ?? key];
  return (
    <span
      className={cn(
        'inline-flex h-6 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border bg-white',
        className
      )}
      aria-label={brand ?? 'Card'}
      role="img"
    >
      {mark ?? <CreditCard className="size-4 text-muted-foreground" />}
    </span>
  );
}

const ALIASES: Record<string, string> = {
  americanexpress: 'amex',
  diners: 'dinersclub',
  union: 'unionpay',
  master: 'mastercard'
};

const MARKS: Record<string, React.ReactNode> = {
  visa: (
    <svg viewBox="0 0 36 24" className="size-full">
      <text
        x="18"
        y="16.5"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="11"
        fontStyle="italic"
        fontWeight="900"
        fill="#1A1F71"
      >
        VISA
      </text>
    </svg>
  ),
  mastercard: (
    <svg viewBox="0 0 36 24" className="size-full">
      <circle cx="14.5" cy="12" r="7" fill="#EB001B" />
      <circle cx="21.5" cy="12" r="7" fill="#F79E1B" />
      <path d="M18 6.1a7 7 0 0 1 0 11.8a7 7 0 0 1 0-11.8z" fill="#FF5F00" />
    </svg>
  ),
  amex: (
    <svg viewBox="0 0 36 24" className="size-full">
      <rect width="36" height="24" fill="#2E77BC" />
      <text
        x="18"
        y="15.5"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="8.5"
        fontWeight="900"
        fill="#fff"
      >
        AMEX
      </text>
    </svg>
  ),
  discover: (
    <svg viewBox="0 0 36 24" className="size-full">
      <text
        x="4"
        y="14.5"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="6"
        fontWeight="700"
        fill="#231F20"
      >
        DISC
      </text>
      <circle cx="22" cy="12.3" r="3" fill="#F48024" />
      <text
        x="25.5"
        y="14.5"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="6"
        fontWeight="700"
        fill="#231F20"
      >
        VER
      </text>
    </svg>
  ),
  jcb: (
    <svg viewBox="0 0 36 24" className="size-full">
      <rect x="6" y="5" width="8" height="14" rx="2" fill="#0E4C96" />
      <rect x="14" y="5" width="8" height="14" rx="2" fill="#E21836" />
      <rect x="22" y="5" width="8" height="14" rx="2" fill="#007B40" />
      <text
        x="18"
        y="14.2"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="6"
        fontWeight="900"
        fill="#fff"
      >
        JCB
      </text>
    </svg>
  ),
  unionpay: (
    <svg viewBox="0 0 36 24" className="size-full">
      <path d="M7 5h8l-3 14H4z" fill="#E21836" />
      <path d="M14 5h8l-3 14h-8z" fill="#00447C" />
      <path d="M21 5h9l-3 14h-9z" fill="#007B84" />
    </svg>
  ),
  dinersclub: (
    <svg viewBox="0 0 36 24" className="size-full">
      <circle cx="18" cy="12" r="7.5" fill="#0079BE" />
      <circle cx="18" cy="12" r="5" fill="#fff" />
      <rect x="16.8" y="7" width="2.4" height="10" fill="#0079BE" />
    </svg>
  ),
  paypal: (
    <svg viewBox="0 0 36 24" className="size-full">
      <text
        x="18"
        y="15.5"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="8"
        fontStyle="italic"
        fontWeight="900"
      >
        <tspan fill="#003087">Pay</tspan>
        <tspan fill="#009CDE">Pal</tspan>
      </text>
    </svg>
  )
};
