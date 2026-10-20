import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  AudioLines,
  Code2,
  Download,
  FileText,
  Image as ImageIcon,
  LibraryBig,
  MessageSquare,
  Pause,
  Play,
  Search,
  Share2,
  Table,
  Video,
  X
} from 'lucide-react';
import { toast } from 'sonner';

import { type Artifact } from '@/types';
import { artifactKindFromType, type ArtifactKind } from '@/lib/artifact';
import { getArtifactLanguageLabel } from '@/lib/code-language';
import { downloadArtifact, downloadFileFromUrl } from '@/lib/download';
import { formatMediaTime } from '@/lib/utils';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { artifactQueries } from '@/server/functions/artifact';
import { libraryQueries, type LibraryItem } from '@/server/functions/library';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ChatHeader } from '@/components/chat-header';
import { GalleryCard, type GalleryCardAction } from '@/components/gallery-card';
import {
  GalleryCardSkeletons,
  GalleryGridSkeleton
} from '@/components/gallery-skeleton';

/** A card's actions, the same for every kind: for an artifact shared on its
 *  own, its link to copy; a download; and the chat it came from. */
function useCardActions({
  chatId,
  shareId,
  onDownload
}: {
  chatId: string | null;
  shareId?: string | null;
  onDownload: () => void;
}): GalleryCardAction[] {
  const router = useRouter();
  const { copyToClipboard } = useCopyToClipboard();
  return [
    ...(shareId
      ? [
          {
            label: 'Copy share link',
            icon: Share2,
            onClick: async () => {
              const link = new URL(window.location.origin);
              link.pathname = `/artifact/${shareId}`;
              await copyToClipboard(link.toString());
              toast.success('Share link copied to clipboard', {
                duration: 2000
              });
            }
          }
        ]
      : []),
    { label: 'Download', icon: Download, onClick: onDownload },
    ...(chatId
      ? [
          {
            label: 'Open',
            icon: MessageSquare,
            onClick: () =>
              void router.navigate({
                to: '/chat/$chatId',
                params: { chatId }
              })
          }
        ]
      : [])
  ];
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
  trigger: React.ReactElement;
}) {
  const title = alt || (type === 'image' ? 'Image preview' : 'Video preview');

  return (
    <Dialog>
      {/* The trigger is whatever the caller hands over — an image, a tile —
          so it is rendered as the trigger rather than wrapped in a button. */}
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
  sheet: { label: 'Sheet', icon: Table }
};

/** Large content preview filling the artifact card (Library-local), faded
 *  out along the bottom where the card cuts it off. */
function ArtifactCardPreview({ artifact }: { artifact: Artifact }) {
  const kind = artifactKindFromType(artifact.type);

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
      <pre className="h-full overflow-hidden mask-b-from-75% font-mono text-xs whitespace-pre-wrap text-muted-foreground">
        {artifact.content ?? ''}
      </pre>
    );
  }
  // text / markdown
  return (
    <div className="h-full overflow-hidden mask-b-from-75% text-xs text-muted-foreground">
      {artifact.content ?? ''}
    </div>
  );
}

/** Card-sized large audio player: big central play control + seek bar. */
function LibraryAudioPlayer({ src }: { src: string }) {
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
    // A control of its own, over the card's button. Not positioned itself, so
    // the play control is centred on the card, not on what its title leaves.
    <div className="pointer-events-auto flex h-full w-full flex-col">
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
      {/* The play control sits at the card's centre; the seek bar hugs the
          bottom edge. */}
      <button
        type="button"
        onClick={togglePlay}
        className="absolute top-1/2 left-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
      >
        {isPlaying ? (
          <Pause className="size-7 fill-current" />
        ) : (
          // Nudged right by as much as the triangle's weight sits left.
          <Play className="ml-0.5 size-7 fill-current" />
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
  const queryClient = useQueryClient();

  const handleArtifactDownload = async (id: string) => {
    // The feed carries a truncated preview; download needs the full body.
    const full = await queryClient.fetchQuery(artifactQueries.get({ id }));
    if (full) downloadArtifact(full);
  };

  const actions = useCardActions({
    chatId: item.chatId,
    shareId: item.type === 'artifact' ? item.shareId : null,
    onDownload: () =>
      item.type === 'artifact'
        ? void handleArtifactDownload(item.artifact.id)
        : downloadFileFromUrl(item.url)
  });

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
      <GalleryCard
        icon={<Icon />}
        title={artifact.title}
        titleNote={languageLabel || meta.label}
        actions={actions}
        onOpen={
          item.chatId
            ? () =>
                void router.navigate({
                  to: '/chat/$chatId',
                  params: { chatId: item.chatId! }
                })
            : undefined
        }
      >
        <ArtifactCardPreview artifact={artifact} />
      </GalleryCard>
    );
  }

  if (item.kind === 'image') {
    return (
      <GalleryCard
        icon={<ImageIcon />}
        title={item.title || 'Image'}
        actions={actions}
        wrapOpen={button => (
          <LibraryLightbox
            type="image"
            src={item.url}
            alt={item.title}
            trigger={button}
          />
        )}
        media={
          <img
            src={item.url}
            alt={item.title || 'Generated image'}
            loading="lazy"
            className="size-full object-cover transition-transform group-hover:scale-105"
          />
        }
      />
    );
  }

  if (item.kind === 'video') {
    return (
      <GalleryCard
        icon={<Video />}
        title={item.title || 'Video'}
        actions={actions}
        wrapOpen={button => (
          <LibraryLightbox
            type="video"
            src={item.url}
            alt={item.title}
            trigger={button}
          />
        )}
        media={
          <>
            <video
              src={item.url}
              preload="metadata"
              muted
              playsInline
              className="size-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-full bg-black/50 p-3 text-white">
                <Play className="size-5 fill-current" />
              </span>
            </span>
          </>
        }
      />
    );
  }

  // Audio — a card-sized player, which is itself the control.
  return (
    <GalleryCard
      icon={<AudioLines />}
      title={item.title || 'Audio'}
      actions={actions}
    >
      <LibraryAudioPlayer src={item.url} />
    </GalleryCard>
  );
}

/** One row of the widest grid, so a page on its way reads as a row of cards. */
const NEXT_PAGE_PLACEHOLDER_CARDS = 4;

export function LibraryView() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');

  // Debounced: a term is part of the query key, so every keystroke would
  // otherwise start its own page-one request.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      ...libraryQueries.list({
        limit: 24,
        search: debouncedSearch || undefined
      }),
      getNextPageParam: page => page.nextCursor
    });

  useInfiniteScroll(scrollRef, {
    enabled: !!hasNextPage && !isFetchingNextPage && !isLoading,
    onLoadMore: fetchNextPage
  });

  const items = data?.pages.flatMap(page => page.items) ?? [];

  return (
    <div className="flex size-full flex-col">
      <ChatHeader title="Library" />
      {/* Named so the router can be told, in `scrollToTopSelectors`, that this
          gallery opens at the top. Without an id it identifies a scroller by
          its position in the DOM, and the other gallery's sits in exactly the
          same place — the two would read as one element. */}
      <div
        ref={scrollRef}
        data-scroll-restoration-id="library"
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or content"
              className="rounded-full pl-9"
            />
          </div>

          {isLoading ? (
            <GalleryGridSkeleton />
          ) : items.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
              <LibraryBig className="size-12 opacity-50" />
              <p className="text-sm">
                {debouncedSearch
                  ? 'No items match your search.'
                  : 'Media and artifacts you generate in chats will appear here.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {items.map(item => (
                <LibraryCard key={`${item.type}-${item.id}`} item={item} />
              ))}
              {/* The page being fetched, in the grid it is joining. */}
              {isFetchingNextPage && (
                <GalleryCardSkeletons count={NEXT_PAGE_PLACEHOLDER_CARDS} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
