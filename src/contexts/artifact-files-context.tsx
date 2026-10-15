import { createContext } from 'react';

import { type ArtifactFile } from '@/types';

/**
 * The files an artifact on this page can read with `window.fs.readFile`: the
 * ones the user attached in its chat. A page that shows artifacts says which
 * — the chat, a shared chat, a shared artifact — and the previews read it.
 */
export const ArtifactFilesContext = createContext<ArtifactFile[]>([]);
