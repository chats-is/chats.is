import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import type { Artifact, ArtifactType } from '@/types';
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
  url?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  size?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
  status: 'streaming' | 'done' | 'idle';
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
  url: artifact.fileUrl ?? null,
  fileName: artifact.fileName ?? null,
  mimeType: artifact.mimeType ?? null,
  size: artifact.size ?? null,
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
  url: next.url ?? previous?.url ?? null,
  fileName: next.fileName ?? previous?.fileName ?? null,
  mimeType: next.mimeType ?? previous?.mimeType ?? null,
  size: next.size ?? previous?.size ?? null,
  createdAt: next.createdAt ?? previous?.createdAt ?? new Date(),
  updatedAt: next.updatedAt ?? previous?.updatedAt ?? new Date(),
  status: next.status ?? previous?.status ?? 'idle',
  messageId: next.messageId ?? previous?.messageId ?? null
});

export function ArtifactProvider({ children }: { children: React.ReactNode }) {
  const [artifacts, setArtifacts] = useState<Record<string, ArtifactState>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const currentMessageIdRef = useRef<string | null>(null);
  const doneTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {}
  );

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

  const scheduleIdleStatus = useCallback((id: string) => {
    if (doneTimersRef.current[id]) {
      clearTimeout(doneTimersRef.current[id]);
    }

    doneTimersRef.current[id] = setTimeout(() => {
      setArtifacts(prev => {
        const artifact = prev[id];
        if (!artifact || artifact.status !== 'done') {
          return prev;
        }

        return {
          ...prev,
          [id]: mergeArtifactState(artifact, {
            id,
            status: 'idle'
          })
        };
      });
      delete doneTimersRef.current[id];
    }, 1800);
  }, []);

  useEffect(() => {
    return () => {
      Object.values(doneTimersRef.current).forEach(clearTimeout);
    };
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
              prevArtifact?.status === 'streaming' ||
              prevArtifact?.status === 'done'
                ? mergeArtifactState(nextArtifact, {
                    id: artifact.id,
                    status: prevArtifact.status
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
            artifact.status === 'streaming' &&
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

      if (type === 'data-artifact' && data?.artifact) {
        const artifact = toStateFromArtifact(data.artifact);
        setArtifacts(prev => ({
          ...prev,
          [artifact.id]: mergeArtifactState(artifact, {
            id: artifact.id,
            status:
              prev[artifact.id]?.status === 'streaming' ||
              prev[artifact.id]?.status === 'done'
                ? prev[artifact.id]?.status
                : artifact.status
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
        if (doneTimersRef.current[id]) {
          clearTimeout(doneTimersRef.current[id]);
          delete doneTimersRef.current[id];
        }
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
            status: 'done'
          })
        }));
        scheduleIdleStatus(id);
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
              status: data.status ?? 'streaming'
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
              status: data.status ?? 'streaming'
            })
          };
        });
        return;
      }

      if (type === 'data-imageDelta' && data) {
        if (!data.id || !data.artifactType) return;
        const id = data.id;
        setArtifacts(prev => ({
          ...prev,
          [id]: mergeArtifactState(prev[id], {
            id,
            chatId,
            messageId: currentMessageIdRef.current,
            title: data.title,
            type: data.artifactType,
            kind: 'image',
            url: data.url ?? prev[id]?.url ?? null,
            status: data.status ?? 'streaming'
          })
        }));
        return;
      }

      if (type === 'data-fileDelta' && data) {
        if (!data.id || !data.artifactType) return;
        const id = data.id;
        setArtifacts(prev => ({
          ...prev,
          [id]: mergeArtifactState(prev[id], {
            id,
            chatId,
            messageId: currentMessageIdRef.current,
            title: data.title,
            type: data.artifactType,
            kind: 'file',
            url: data.url ?? prev[id]?.url ?? null,
            fileName: data.fileName ?? prev[id]?.fileName ?? null,
            mimeType: data.mimeType ?? prev[id]?.mimeType ?? null,
            size: data.size ?? prev[id]?.size ?? null,
            status: data.status ?? 'streaming'
          })
        }));
      }
    },
    [scheduleIdleStatus, upsertArtifact]
  );

  const value = useMemo(
    () => ({
      artifacts,
      activeId,
      isPanelOpen,
      openArtifact,
      setPanelOpen,
      upsertArtifact,
      setArtifactsFromServer,
      handleStreamPart
    }),
    [
      artifacts,
      activeId,
      isPanelOpen,
      openArtifact,
      setPanelOpen,
      upsertArtifact,
      setArtifactsFromServer,
      handleStreamPart
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
