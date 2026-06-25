'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Code2,
  Download,
  File,
  FileText,
  Image as ImageIcon,
  LibraryBig,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Table,
  X
} from 'lucide-react';

import { Artifact } from '@/types';
import { artifactKindFromType, type ArtifactKind } from '@/lib/artifact';
import { getArtifactLanguageLabel } from '@/lib/code-language';
import { downloadArtifact, downloadFileFromUrl } from '@/lib/download';
import { formatMediaTime } from '@/lib/utils';
import type { LibraryItem } from '@/server/api/routers/library';
import { api } from '@/trpc/react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ChatHeader } from '@/components/chat-header';

/** Hover corner actions — uniform across all card kinds: download and
 *  open-chat side by side at the top-right. `dark` for image/video overlays. */
function CardActions({
  chatId,
  onDownload,
  dark
}: {
  chatId: string | null;
  onDownload?: () => void;
  dark?: boolean;
}) {
  // Solid backgrounds — no translucency over the card content.
  const buttonClass = dark
    ? 'rounded-full bg-black p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-neutral-700'
    : 'rounded-full border bg-background p-1.5 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-foreground';

  return (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
      {onDownload && (
        <button
          type="button"
          title="Download"
          onClick={event => {
            event.stopPropagation();
            onDownload();
          }}
          className={buttonClass}
        >
          <Download className="size-3.5" />
        </button>
      )}
      {chatId && (
        <Link
          href={`/chat/${chatId}`}
          title="Open chat"
          className={buttonClass}
        >
          <MessageSquare className="size-3.5" />
        </Link>
      )}
    </div>
  );
}

/** Hover title strip along the bottom edge of image/video cards. */
function CardTitle({ title }: { title?: string }) {
  if (!title) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
      <span className="line-clamp-2 text-xs text-white">{title}</span>
    </div>
  );
}

/** Fullscreen preview dialog for image/video cards (Library-local). */
function LibraryLightbox({
  type,
  src,
  alt,
  trigger
}: {
  type: 'image' | 'video';
  src: string;
  alt?: string;
  trigger: React.ReactNode;
}) {
  const title = alt || (type === 'image' ? 'Image preview' : 'Video preview');

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="block w-auto max-w-[95vw] border-0 bg-transparent p-0 shadow-none sm:max-w-[90vw]"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {type === 'image' ? (
          <img
            src={src}
            alt={title}
            className="mx-auto max-h-[90vh] w-auto max-w-full rounded-lg object-contain"
          />
        ) : (
          <video
            src={src}
            controls
            autoPlay
            className="mx-auto max-h-[90vh] w-auto max-w-full rounded-lg"
          />
        )}
        <DialogClose className="absolute top-3 right-3 z-10 rounded-full bg-black/50 p-1.5 text-white transition-colors hover:bg-black/70 focus:outline-none">
          <X className="size-5" />
          <span className="sr-only">Close</span>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

const ARTIFACT_KIND_META: Record<
  ArtifactKind,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  text: { label: 'Text', icon: FileText },
  code: { label: 'Code', icon: Code2 },
  sheet: { label: 'Sheet', icon: Table },
  image: { label: 'Image', icon: ImageIcon },
  file: { label: 'File', icon: File }
};

/** Large content preview filling the artifact card (Library-local). */
function ArtifactCardPreview({ artifact }: { artifact: Artifact }) {
  const kind = artifactKindFromType(artifact.type);

  if (kind === 'image' && artifact.fileUrl) {
    return (
      <img
        className="h-full w-full rounded-md object-cover"
        src={artifact.fileUrl}
        alt={artifact.title}
      />
    );
  }
  if (kind === 'file') {
    if (artifact.fileUrl && artifact.mimeType?.startsWith('image/')) {
      return (
        <img
          className="h-full w-full rounded-md object-cover"
          src={artifact.fileUrl}
          alt={artifact.title}
        />
      );
    }
    return (
      <div className="text-xs text-muted-foreground">
        {artifact.fileName ||
          (artifact.fileUrl ? 'File' : 'File URL unavailable')}
      </div>
    );
  }
  if (kind === 'sheet') {
    try {
      const rows = JSON.parse(artifact.content ?? '[]');
      if (Array.isArray(rows)) {
        return (
          <div className="text-xs text-muted-foreground">
            {rows.length} rows
          </div>
        );
      }
    } catch {}
    // Content may be truncated for the preview — fall back to a neutral label.
    return <div className="text-xs text-muted-foreground">Sheet data</div>;
  }
  if (kind === 'code') {
    return (
      <pre className="line-clamp-[14] overflow-hidden font-mono text-xs whitespace-pre-wrap text-muted-foreground">
        {artifact.content ?? ''}
      </pre>
    );
  }
  // text / markdown
  return (
    <div className="line-clamp-[14] text-xs text-muted-foreground">
      {artifact.content ?? ''}
    </div>
  );
}

/** Card-sized large audio player: big central play control + seek bar. */
function LibraryAudioPlayer({ src, title }: { src: string; title?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleSeek = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      const bar = progressRef.current;
      if (!audio || !bar || !duration) return;
      const rect = bar.getBoundingClientRect();
      const ratio = (event.clientX - rect.left) / rect.width;
      const next = Math.min(Math.max(ratio, 0), 1) * duration;
      audio.currentTime = next;
      setCurrentTime(next);
    },
    [duration]
  );

  return (
    <div className="relative flex h-full w-full flex-col px-2">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={event => setDuration(event.currentTarget.duration)}
        onEnded={event => {
          // Back to the 0 state once playback finishes.
          event.currentTarget.currentTime = 0;
          setCurrentTime(0);
          setIsPlaying(false);
        }}
      />
      {/* Title along the top edge; the play control sits at the exact card
          center; the seek bar hugs the bottom edge. */}
      {title && (
        <span className="line-clamp-2 px-6 pt-1 text-center text-xs text-muted-foreground">
          {title}
        </span>
      )}
      <button
        type="button"
        onClick={togglePlay}
        className="absolute top-1/2 left-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
      >
        {isPlaying ? (
          <Pause className="size-7 fill-current" />
        ) : (
          <Play className="ml-1 size-7 fill-current" />
        )}
        <span className="sr-only">{isPlaying ? 'Pause' : 'Play'}</span>
      </button>
      <div className="mt-auto w-full">
        <div
          ref={progressRef}
          onClick={handleSeek}
          className="h-1.5 w-full cursor-pointer rounded-full bg-muted-foreground/20"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{
              width:
                Number.isFinite(duration) && duration > 0
                  ? `${(currentTime / duration) * 100}%`
                  : '0%'
            }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
          <span>{formatMediaTime(currentTime)}</span>
          <span>{formatMediaTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

function LibraryCard({ item }: { item: LibraryItem }) {
  const router = useRouter();
  const utils = api.useUtils();

  const handleArtifactDownload = async (id: string) => {
    // The feed carries a truncated preview; download needs the full body.
    const full = await utils.artifact.get.fetch({ id });
    if (full) downloadArtifact(full);
  };

  if (item.type === 'artifact') {
    const { artifact } = item;
    const kind = artifactKindFromType(artifact.type);
    const meta = ARTIFACT_KIND_META[kind];
    const Icon = meta.icon;
    const languageLabel =
      kind === 'code' || kind === 'text'
        ? getArtifactLanguageLabel(artifact)
        : '';

    return (
      <div className="group relative aspect-square">
        <div
          role="button"
          tabIndex={0}
          className="flex h-full w-full flex-col rounded-lg border bg-background px-3 py-2.5 text-left transition hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden"
          onClick={() => item.chatId && router.push(`/chat/${item.chatId}`)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              if (item.chatId) router.push(`/chat/${item.chatId}`);
            }
          }}
        >
          <div className="flex items-center gap-2">
            <Icon className="size-4" />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="truncate text-sm font-medium">
                {artifact.title}
              </div>
              <div className="shrink-0 text-xs text-muted-foreground">
                {languageLabel || meta.label}
              </div>
            </div>
          </div>
          <div className="mt-2 min-h-0 flex-1 overflow-hidden">
            <ArtifactCardPreview artifact={artifact} />
          </div>
        </div>
        <CardActions
          chatId={item.chatId}
          onDownload={() => void handleArtifactDownload(item.artifact.id)}
        />
      </div>
    );
  }

  if (item.kind === 'image') {
    return (
      <div className="group relative overflow-hidden rounded-lg border">
        <LibraryLightbox
          type="image"
          src={item.url}
          alt={item.title}
          trigger={
            <img
              src={item.url}
              alt={item.title || 'Generated image'}
              loading="lazy"
              className="aspect-square w-full cursor-zoom-in object-cover transition-transform group-hover:scale-105"
            />
          }
        />
        <CardTitle title={item.title} />
        <CardActions
          chatId={item.chatId}
          onDownload={() => downloadFileFromUrl(item.url)}
          dark
        />
      </div>
    );
  }

  if (item.kind === 'video') {
    return (
      <div className="group relative overflow-hidden rounded-lg border">
        <LibraryLightbox
          type="video"
          src={item.url}
          alt={item.title}
          trigger={
            <div className="relative cursor-pointer">
              <video
                src={item.url}
                preload="metadata"
                muted
                playsInline
                className="aspect-square w-full object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="rounded-full bg-black/50 p-3 text-white">
                  <Play className="size-5 fill-current" />
                </span>
              </div>
            </div>
          }
        />
        <CardTitle title={item.title} />
        <CardActions
          chatId={item.chatId}
          onDownload={() => downloadFileFromUrl(item.url)}
          dark
        />
      </div>
    );
  }

  // Audio — card-sized large player.
  return (
    <div className="group relative flex aspect-square flex-col rounded-lg border bg-muted/30 p-3">
      <LibraryAudioPlayer src={item.url} title={item.title} />
      <CardActions
        chatId={item.chatId}
        onDownload={() => downloadFileFromUrl(item.url)}
      />
    </div>
  );
}

export function LibraryView() {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    api.library.list.useInfiniteQuery(
      { limit: 24 },
      {
        getNextPageParam: page => page.nextCursor,
        // Refocusing would serially replay every loaded page — not worth it
        // for an archive view.
        refetchOnWindowFocus: false,
        staleTime: 60_000
      }
    );

  const items = data?.pages.flatMap(page => page.items) ?? [];

  return (
    <div className="flex size-full flex-col">
      <ChatHeader title="Library" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl p-4">
          {isLoading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="aspect-square rounded-lg" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
              <LibraryBig className="size-12 opacity-50" />
              <p className="text-sm">
                Media and artifacts you generate in chats will appear here.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {items.map(item => (
                  <LibraryCard key={`${item.type}-${item.id}`} item={item} />
                ))}
              </div>
              {hasNextPage && (
                <div className="mt-6 mb-3 flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="gap-2"
                  >
                    {isFetchingNextPage && (
                      <Loader2 className="size-4 animate-spin" />
                    )}
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
