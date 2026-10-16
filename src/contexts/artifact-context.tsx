import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from 'react';

import { type Artifact, type ArtifactType } from '@/types';
import { artifactKindFromType, type ArtifactKind } from '@/lib/artifact';

export type { ArtifactKind };

export type ArtifactState = {
  id: string;
  chatId: string;
  messageId?: string | null;
  title: string;
  type: Artifact['type'];
  kind: ArtifactKind;
  content: string;
  language?: string | null;
  fileName?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  /** Whether its content is still arriving. */
  status: 'streaming' | 'idle';
  /** Being changed by the reply under way — shown as source until it is
   *  over, though each change arrives whole. */
  editing?: boolean;
};

type DataStreamPart = {
  type: string;
  data: any;
};

type ArtifactContextValue = {
  artifacts: Record<string, ArtifactState>;
  activeId: string | null;
  isPanelOpen: boolean;
  openArtifact: (id: string) => void;
  setPanelOpen: (open: boolean) => void;
  upsertArtifact: (artifact: ArtifactState) => void;
  setArtifactsFromServer: (
    artifacts: Artifact[],
    options?: {
      preserveStreamingForChatId?: string | null;
    }
  ) => void;
  handleStreamPart: (part: DataStreamPart, chatId: string) => void;
  /** Ends what a reply left as being written, once the reply is over. */
  settleArtifacts: (chatId: string) => void;
};

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

const getDataArtifactId = (data: unknown): string | null => {
  if (typeof data === 'object' && data && 'id' in data) {
    const id = (data as { id?: unknown }).id;
    return typeof id === 'string' && id ? id : null;
  }

  return null;
};

const toStateFromArtifact = (artifact: Artifact): ArtifactState => ({
  id: artifact.id,
  chatId: artifact.chatId,
  title: artifact.title,
  type: artifact.type,
  kind: artifactKindFromType(artifact.type),
  content: artifact.content ?? '',
  language: artifact.language ?? null,
  fileName: artifact.fileName ?? null,
  createdAt: artifact.createdAt ? new Date(artifact.createdAt) : new Date(),
  updatedAt: artifact.updatedAt ? new Date(artifact.updatedAt) : new Date(),
  status: 'idle',
  messageId: artifact.messageId ?? null
});

const mergeArtifactState = (
  previous: ArtifactState | undefined,
  next: Partial<ArtifactState> & Pick<ArtifactState, 'id'>
): ArtifactState => ({
  id: next.id,
  chatId: next.chatId ?? previous?.chatId ?? '',
  title: next.title ?? previous?.title ?? 'Untitled',
  type: next.type ?? previous?.type ?? 'text',
  kind: next.kind ?? previous?.kind ?? 'text',
  content: next.content ?? previous?.content ?? '',
  language: next.language ?? previous?.language ?? null,
  fileName: next.fileName ?? previous?.fileName ?? null,
  createdAt: next.createdAt ?? previous?.createdAt ?? new Date(),
  updatedAt: next.updatedAt ?? previous?.updatedAt ?? new Date(),
  status: next.status ?? previous?.status ?? 'idle',
  editing: next.editing ?? previous?.editing,
  messageId: next.messageId ?? previous?.messageId ?? null
});

export function ArtifactProvider({ children }: { children: React.ReactNode }) {
  const [artifacts, setArtifacts] = useState<Record<string, ArtifactState>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const currentMessageIdRef = useRef<string | null>(null);

  const openArtifact = useCallback((id: string) => {
    setActiveId(id);
    setIsPanelOpen(true);
  }, []);

  const setPanelOpen = useCallback((open: boolean) => {
    setIsPanelOpen(open);
  }, []);

  const upsertArtifact = useCallback((artifact: ArtifactState) => {
    setArtifacts(prev => ({
      ...prev,
      [artifact.id]: mergeArtifactState(prev[artifact.id], artifact)
    }));
  }, []);

  const setArtifactsFromServer = useCallback(
    (
      list: Artifact[],
      options?: {
        preserveStreamingForChatId?: string | null;
      }
    ) => {
      setArtifacts(prev => {
        const next = list.reduce<Record<string, ArtifactState>>(
          (acc, artifact) => {
            const prevArtifact = prev[artifact.id];
            const nextArtifact = toStateFromArtifact(artifact);

            acc[artifact.id] =
              prevArtifact?.status === 'streaming' || prevArtifact?.editing
                ? mergeArtifactState(nextArtifact, {
                    id: artifact.id,
                    status: prevArtifact.status,
                    editing: prevArtifact.editing
                  })
                : nextArtifact;
            return acc;
          },
          {}
        );

        const preserveStreamingForChatId =
          options?.preserveStreamingForChatId ?? null;

        for (const [artifactId, artifact] of Object.entries(prev)) {
          if (
            preserveStreamingForChatId &&
            artifact.chatId === preserveStreamingForChatId &&
            (artifact.status === 'streaming' || artifact.editing) &&
            !next[artifactId]
          ) {
            next[artifactId] = artifact;
          }
        }

        return next;
      });
    },
    []
  );

  const handleStreamPart = useCallback(
    (part: DataStreamPart, chatId: string) => {
      if (!part?.type?.startsWith('data-')) return;
      const { type, data } = part;

      if (type === 'data-artifact' && data) {
        const artifact = toStateFromArtifact(data);
        setArtifacts(prev => ({
          ...prev,
          [artifact.id]: mergeArtifactState(artifact, {
            id: artifact.id,
            status:
              prev[artifact.id]?.status === 'streaming'
                ? 'streaming'
                : artifact.status,
            editing: prev[artifact.id]?.editing
          })
        }));
        return;
      }

      if (type === 'data-messageId') {
        const messageId = String(data ?? '');
        currentMessageIdRef.current = messageId || null;
        return;
      }

      if (type === 'data-id') {
        const id = String(data);
        if (!id) return;
        upsertArtifact({
          id,
          chatId,
          messageId: currentMessageIdRef.current,
          title: 'Untitled',
          type: 'text',
          kind: 'text',
          content: '',
          createdAt: new Date(),
          status: 'streaming'
        });
        setActiveId(id);
        setIsPanelOpen(true);
        return;
      }

      if (type === 'data-title') {
        const id = getDataArtifactId(data);
        if (!id) return;
        if (typeof data !== 'object' || !data || !('title' in data)) return;
        const title =
          typeof (data as { title?: unknown }).title === 'string' &&
          (data as { title?: string }).title
            ? (data as { title: string }).title
            : 'Untitled';
        setArtifacts(prev => ({
          ...prev,
          [id]: mergeArtifactState(prev[id], {
            id,
            chatId,
            messageId: currentMessageIdRef.current,
            title,
            status: 'streaming'
          })
        }));
        return;
      }

      if (type === 'data-kind') {
        const id = getDataArtifactId(data);
        if (!id) return;
        if (
          typeof data !== 'object' ||
          !data ||
          !('kind' in data) ||
          !('artifactType' in data)
        ) {
          return;
        }
        const kind = (data as { kind?: ArtifactKind }).kind;
        const artifactType = (data as { artifactType?: ArtifactType })
          .artifactType;
        if (!kind || !artifactType) return;
        setArtifacts(prev => ({
          ...prev,
          [id]: mergeArtifactState(prev[id], {
            id,
            chatId,
            messageId: currentMessageIdRef.current,
            type: artifactType,
            kind,
            status: 'streaming'
          })
        }));
        return;
      }

      if (type === 'data-clear') {
        const id = getDataArtifactId(data);
        if (!id) return;
        setArtifacts(prev => ({
          ...prev,
          [id]: mergeArtifactState(prev[id], {
            id,
            chatId,
            messageId: currentMessageIdRef.current,
            content: '',
            status: 'streaming'
          })
        }));
        return;
      }

      if (type === 'data-finish') {
        const id = getDataArtifactId(data);
        if (!id) return;
        setArtifacts(prev => ({
          ...prev,
          [id]: mergeArtifactState(prev[id], {
            id,
            chatId,
            messageId: currentMessageIdRef.current,
            status: 'idle'
          })
        }));
        return;
      }

      // An artifact the reply is changing: shown, as source, until the reply
      // is over (`settleArtifacts`); each change arrives as an artifact of
      // its own.
      if (type === 'data-editing' && data) {
        const { id } = data as { id: string };
        setArtifacts(prev =>
          prev[id] ? { ...prev, [id]: { ...prev[id], editing: true } } : prev
        );
        setActiveId(id);
        setIsPanelOpen(true);
        return;
      }

      // The call that streamed it failed, and the model is told why; the
      // artifact it makes next replaces this one, so this one goes.
      if (type === 'data-discard') {
        const id = getDataArtifactId(data);
        if (!id) return;
        setArtifacts(prev => {
          if (!prev[id]) return prev;
          const { [id]: _discarded, ...rest } = prev;
          return rest;
        });
        setActiveId(current => (current === id ? null : current));
        return;
      }

      if (type === 'data-textDelta' && data) {
        if (!data.id || !data.artifactType) return;
        const id = data.id;
        setArtifacts(prev => {
          const previous = prev[id];
          const nextContent =
            data.mode === 'replace'
              ? (data.delta ?? '')
              : (previous?.content ?? '') + (data.delta ?? '');
          return {
            ...prev,
            [id]: mergeArtifactState(previous, {
              id,
              chatId,
              messageId: currentMessageIdRef.current,
              title: data.title,
              type: data.artifactType,
              kind: artifactKindFromType(data.artifactType),
              content: nextContent,
              status: 'streaming'
            })
          };
        });
        return;
      }

      if (type === 'data-codeDelta' && data) {
        if (!data.id || !data.artifactType) return;
        const id = data.id;
        setArtifacts(prev => {
          const previous = prev[id];
          const nextContent =
            data.mode === 'replace'
              ? (data.delta ?? '')
              : (previous?.content ?? '') + (data.delta ?? '');
          return {
            ...prev,
            [id]: mergeArtifactState(previous, {
              id,
              chatId,
              messageId: currentMessageIdRef.current,
              title: data.title,
              type: data.artifactType,
              kind: artifactKindFromType(data.artifactType),
              content: nextContent,
              language: data.language ?? previous?.language ?? null,
              status: 'streaming'
            })
          };
        });
      }
    },
    [upsertArtifact]
  );

  // A reply over — finished, failed or stopped — is changing nothing, and
  // what it changed is shown as a preview. An artifact whose content was
  // still arriving was never made: its call did not finish, so nothing was
  // kept, and it goes — it was drawn as it streamed, and would stay, half
  // written and with no artifact behind it, until the page was reloaded.
  const settleArtifacts = useCallback((chatId: string) => {
    setArtifacts(prev => {
      const open = Object.values(prev).filter(
        artifact =>
          artifact.chatId === chatId &&
          (artifact.status === 'streaming' || artifact.editing)
      );
      if (open.length === 0) return prev;
      const next = { ...prev };
      for (const artifact of open) {
        if (artifact.status === 'streaming') delete next[artifact.id];
        else next[artifact.id] = { ...artifact, editing: false };
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      artifacts,
      activeId,
      isPanelOpen,
      openArtifact,
      setPanelOpen,
      upsertArtifact,
      setArtifactsFromServer,
      handleStreamPart,
      settleArtifacts
    }),
    [
      artifacts,
      activeId,
      isPanelOpen,
      openArtifact,
      setPanelOpen,
      upsertArtifact,
      setArtifactsFromServer,
      handleStreamPart,
      settleArtifacts
    ]
  );

  return (
    <ArtifactContext.Provider value={value}>
      {children}
    </ArtifactContext.Provider>
  );
}

export function useArtifact() {
  const ctx = useContext(ArtifactContext);
  if (!ctx) {
    throw new Error('useArtifact must be used within ArtifactProvider');
  }
  return ctx;
}
