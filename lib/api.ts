import { Attachment, Result } from '@/types';

export const createSpeech = async (
  modelId: string,
  /** Omitted when the user has picked none — the model's own default applies. */
  voice: string | undefined,
  text: string
) => {
  const res = await fetch('/api/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ modelId, voice, text })
  });

  if (!res.ok) {
    const result = await res.json();
    return { error: result.error } as Result;
  }

  const json = await res.json();
  return json as { audio: string };
};

export const uploadFile = async (
  file: File,
  type: 'avatar' | 'attachment' = 'attachment'
): Promise<Attachment | Result> => {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`/api/files/upload?type=${type}`, {
    method: 'POST',
    body: formData
  });

  if (!res.ok) {
    const result = await res.json();
    return { error: result.error } as Result;
  }

  const json = await res.json();
  return json as Attachment;
};

export const deleteFile = async (url: string) => {
  const res = await fetch(`/api/files?url=${encodeURIComponent(url)}`, {
    method: 'DELETE'
  });

  if (!res.ok) {
    const result = await res.json();
    return { error: result.error } as Result;
  }
};
