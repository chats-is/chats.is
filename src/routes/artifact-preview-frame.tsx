import { createFileRoute } from '@tanstack/react-router';

import { ArtifactPreviewFrameClient } from '@/components/artifacts/preview-frame-client';

export const Route = createFileRoute('/artifact-preview-frame')({
  component: ArtifactPreviewFrameClient
});
