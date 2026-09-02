import { toast } from 'sonner';

import { type Artifact } from '@/types';

/** Trigger a browser download for a remote file URL. */
export function downloadFileFromUrl(url: string, filename?: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || url.split('/').pop() || 'download';
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** Download an artifact: file artifacts via their URL, text artifacts as a
 *  generated file from the content. */
export function downloadArtifact(artifact: Artifact) {
  if (artifact.fileUrl) {
    downloadFileFromUrl(artifact.fileUrl, artifact.fileName || artifact.title);
    return;
  }

  if (!artifact.content) {
    toast.error('Nothing to download');
    return;
  }

  const extension =
    artifact.type === 'json'
      ? 'json'
      : artifact.type === 'html'
        ? 'html'
        : artifact.type === 'markdown'
          ? 'md'
          : artifact.language || 'txt';
  const blob = new Blob([artifact.content], {
    type: 'text/plain;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${artifact.title}.${extension}`.replace(/\s+/g, '-');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
