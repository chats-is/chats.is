import React from 'react';
import * as LobeIcons from '@lobehub/icons';

import { cn } from '@/lib/utils';

interface ModelIconProps {
  image?: string | null;
  className?: string;
}

export const ModelIcon = ({ image, className }: ModelIconProps) => {
  // 1. Model/Provider Image (URL / Base64)
  if (
    image &&
    (image.startsWith('http') ||
      image.startsWith('data:') ||
      image.startsWith('/') ||
      image.startsWith('blob:'))
  ) {
    return (
      <img
        src={image}
        alt=""
        className={cn('size-5 object-contain', className)}
      />
    );
  }

  // 2. LobeHub Icon
  if (image) {
    // 2a. Direct match (e.g. "Google")
    if (image in LobeIcons) {
      const Icon = LobeIcons[
        image as keyof typeof LobeIcons
      ] as React.ElementType;
      return <Icon className={cn('size-5', className)} />;
    }

    // 2b. Dot notation (e.g. "Gemini.Color" -> LobeIcons.Gemini.Color)
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
  }

  // 3. Default Provider Icon
  // Per user request, do not show default icons if no image is provided.
  return null;
};
