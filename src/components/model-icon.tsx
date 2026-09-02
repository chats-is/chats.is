import { lazy, Suspense } from 'react';
import { ClientOnly } from '@tanstack/react-router';

import { cn } from '@/lib/utils';

interface ModelIconProps {
  image?: string | null;
  className?: string;
}

/**
 * The icon set ships as directory imports, which Node's ES module resolver
 * refuses — importing it while rendering on the server throws, and React then
 * drops the whole page to the client. So it is loaded in the browser only.
 *
 * Only the branch that needs it waits: an image given as a URL, and the empty
 * case, still render on the server, which is the common path.
 */
const LobeIcon = lazy(() => import('@/components/model-icon-lobe'));

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
    return (
      <ClientOnly fallback={<span className={cn('size-5', className)} />}>
        <Suspense fallback={<span className={cn('size-5', className)} />}>
          <LobeIcon image={image} className={className} />
        </Suspense>
      </ClientOnly>
    );
  }

  // 3. Default Provider Icon
  // Per user request, do not show default icons if no image is provided.
  return null;
};
