import type React from 'react';
import * as LobeIcons from '@lobehub/icons';

import { cn } from '@/lib/utils';

/**
 * Resolves a provider's icon by name. Kept in its own module so the icon set
 * is only ever reached from the browser — see model-icon.tsx.
 */
export default function LobeIcon({
  image,
  className
}: {
  image: string;
  className?: string;
}) {
  // Direct match (e.g. "Google")
  if (image in LobeIcons) {
    const Icon = LobeIcons[
      image as keyof typeof LobeIcons
    ] as React.ElementType;
    return <Icon className={cn('size-5', className)} />;
  }

  // Dot notation (e.g. "Gemini.Color" -> LobeIcons.Gemini.Color)
  if (image.includes('.')) {
    const [iconName, variant] = image.split('.');
    if (iconName in LobeIcons) {
      const IconComponent = LobeIcons[
        iconName as keyof typeof LobeIcons
      ] as any;
      if (IconComponent && IconComponent[variant]) {
        const VariantIcon = IconComponent[variant] as React.ElementType;
        return <VariantIcon className={cn('size-5', className)} />;
      }
    }
  }

  return null;
}
