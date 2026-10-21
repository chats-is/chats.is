import { useEffect, useRef, useState, type RefObject } from 'react';
import { useSystemSettings } from '@/contexts/system-settings-context';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient
} from '@tanstack/react-query';
import { Copy, Loader2, Pencil, SquareSparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { mutating } from '@/lib/mutation';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import {
  createPrompt,
  deletePrompt as deletePromptFn,
  promptQueries,
  updatePrompt,
  type listPrompts
} from '@/server/functions/prompt';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  GalleryCardSkeletons,
  GalleryGridSkeleton
} from '@/components/gallery-skeleton';
import { ImageUpload } from '@/components/image-upload';
import { ModelSelect } from '@/components/model-select';
import { PromptCard } from '@/components/prompt-card';
import {
  PromptPresetFields,
  type PromptPreset
} from '@/components/prompt-preset-fields';

type MyPrompt = Awaited<ReturnType<typeof listPrompts>>[number];

type PromptFormData = {
  name: string;
  content: string;
  image: string;
  // A comma-separated string of free-text labels.
  tags: string;
  preset: PromptPreset;
};

const EMPTY_FORM: PromptFormData = {
  name: '',
  content: '',
  image: '',
  tags: '',
  preset: { type: 'chat', needsReference: false, modelId: null }
};

const parseList = (value: string) =>
  value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

const joinList = (value?: string[] | null) => (value ?? []).join(', ');

/** One row of the widest grid, so a page on its way reads as a row of cards. */
const NEXT_PAGE_PLACEHOLDER_CARDS = 4;

/** Your own prompt library — add, edit and delete. Everything you save here
 *  is private to you; sharing a prompt with everyone else is an admin action
 *  done from the console. `search` and `createRequestId` come from the
 *  shared toolbar above: a request id (rather than a callback) because it
 *  changes only when the Add Prompt button is actually clicked, so this can
 *  open the dialog from a plain effect instead of exposing an imperative API.
 *  `scrollRef` is the page's own scroll container — this tab is only ever
 *  mounted while it is the active one, so unlike Trending it doesn't need an
 *  `active` flag to gate the scroll listener. */
export function MyPrompts({
  search,
  tag,
  onTag,
  createRequestId,
  scrollRef
}: {
  search: string;
  /** The tag the page is narrowed to; `onTag` is a card's tag being picked. */
  tag?: string;
  onTag: (tag: string) => void;
  createRequestId: number;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const { copyToClipboard } = useCopyToClipboard();
  // The models a prompt here may preset: those on offer to the user.
  const settings = useSystemSettings();
  const presetModels = [
    ...settings.chatModels,
    ...settings.imageModels,
    ...settings.videoModels,
    ...settings.ttsModels,
    ...settings.sttModels
  ];
  const queryClient = useQueryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState<PromptFormData>(EMPTY_FORM);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery(
      promptQueries.listInfinite({
        limit: 24,
        search: debouncedSearch || undefined,
        tag
      })
    );

  useInfiniteScroll(scrollRef, {
    enabled: !!hasNextPage && !isFetchingNextPage && !isLoading,
    onLoadMore: fetchNextPage
  });

  const myPrompts = data?.pages.flat() ?? [];

  const resetForm = () => {
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setIsUploadingImage(false);
  };

  const closeDialog = () => {
    setIsOpen(false);
    resetForm();
  };

  const invalidatePrompts = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: promptQueries.key.listInfinite()
      }),
      queryClient.invalidateQueries({ queryKey: promptQueries.key.usable() }),
      queryClient.invalidateQueries({
        queryKey: promptQueries.key.usableInfinite()
      })
    ]);
  };

  const createMutation = useMutation({
    mutationFn: mutating(createPrompt),
    onSuccess: async () => {
      await invalidatePrompts();
      closeDialog();
      toast.success('Prompt saved');
    },
    onError: error => toast.error(error.message)
  });

  const updateMutation = useMutation({
    mutationFn: mutating(updatePrompt),
    onSuccess: async () => {
      await invalidatePrompts();
      closeDialog();
      toast.success('Prompt updated');
    },
    onError: error => toast.error(error.message)
  });

  const deleteMutation = useMutation({
    mutationFn: mutating(deletePromptFn),
    onSuccess: async () => {
      await invalidatePrompts();
      setDeleteId(null);
      toast.success('Prompt deleted');
    },
    onError: error => toast.error(error.message)
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isFormBusy = isSubmitting || isUploadingImage;

  const deletePrompt = myPrompts.find(prompt => prompt.id === deleteId) ?? null;

  // The Add Prompt button lives in the shared toolbar above, so it opens
  // this dialog by bumping a request id rather than calling a handler here
  // directly. Compared against the id this instance last saw — initialized
  // to the id it mounted with — rather than a fixed "0 means unset": leaving
  // the tab unmounts this component, so a plain "id changed since last
  // render" would misfire on every remount, reopening the dialog for a click
  // from a previous visit to this tab.
  const lastCreateRequestId = useRef(createRequestId);
  useEffect(() => {
    if (createRequestId === lastCreateRequestId.current) return;
    lastCreateRequestId.current = createRequestId;
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setIsUploadingImage(false);
    setIsOpen(true);
  }, [createRequestId]);

  const handleEdit = (prompt: MyPrompt) => {
    setEditingId(prompt.id);
    setFormData({
      name: prompt.name,
      content: prompt.content,
      image: prompt.image || '',
      tags: joinList(prompt.tags),
      preset: {
        type: prompt.type,
        needsReference: prompt.needsReference,
        modelId: prompt.modelId
      }
    });
    setIsOpen(true);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const name = formData.name.trim();
    const content = formData.content.trim();

    if (!name || !content) {
      toast.error('Name and content are required');
      return;
    }

    const tags = parseList(formData.tags);
    // No visibility field: prompts added here are always private to you. The
    // server enforces this too, so this is only ever a UI-level shortcut.
    const payload = {
      name,
      content,
      image: formData.image || null,
      tags: tags.length > 0 ? tags : null,
      ...formData.preset
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload });
      return;
    }

    createMutation.mutate(payload);
  };

  if (isLoading) {
    return <GalleryGridSkeleton />;
  }

  return (
    <div className="flex flex-col">
      {myPrompts.length === 0 && !isFetchingNextPage ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
          <SquareSparkles className="size-12 opacity-50" />
          <p className="text-sm">
            {debouncedSearch || tag
              ? 'No prompts match your search.'
              : 'No prompts yet. Add your first prompt to get started.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {myPrompts.map(prompt => (
            <PromptCard
              key={prompt.id}
              prompt={prompt}
              activeTag={tag}
              onTag={onTag}
              actions={[
                {
                  label: 'Copy',
                  icon: Copy,
                  onClick: () => copyToClipboard(prompt.content)
                },
                {
                  label: 'Edit',
                  icon: Pencil,
                  onClick: () => handleEdit(prompt)
                },
                {
                  label: 'Delete',
                  icon: Trash2,
                  onClick: () => setDeleteId(prompt.id)
                }
              ]}
            />
          ))}
          {/* The page being fetched, in the grid it is joining. */}
          {isFetchingNextPage && (
            <GalleryCardSkeletons count={NEXT_PAGE_PLACEHOLDER_CARDS} />
          )}
        </div>
      )}

      <Dialog
        open={isOpen}
        onOpenChange={open => {
          if (!open) {
            if (isFormBusy) return;
            closeDialog();
            return;
          }
          setIsOpen(true);
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit Prompt' : 'Add Prompt'}
            </DialogTitle>
            <DialogDescription>
              Manage your prompt. It stays private to you.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {/* The words on the left, with room to write them; what the
                prompt presets on the right. One column on a phone. */}
            <div className="-mx-6 grid max-h-[70vh] gap-x-6 gap-y-3.5 overflow-y-auto px-6 md:grid-cols-2">
              <div className="min-w-0 space-y-3.5">
                <div className="space-y-2">
                  <Label htmlFor="prompt-name">Name</Label>
                  <Input
                    id="prompt-name"
                    value={formData.name}
                    onChange={e =>
                      setFormData(current => ({
                        ...current,
                        name: e.target.value
                      }))
                    }
                    placeholder="Research prompt"
                    required
                    disabled={isFormBusy}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="prompt-tags">Tags</Label>
                  <Input
                    id="prompt-tags"
                    value={formData.tags}
                    onChange={e =>
                      setFormData(current => ({
                        ...current,
                        tags: e.target.value
                      }))
                    }
                    placeholder="writing, english"
                    disabled={isFormBusy}
                  />
                  <p className="text-xs text-muted-foreground">
                    Comma-separated.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="prompt-content">Content</Label>
                  <Textarea
                    id="prompt-content"
                    value={formData.content}
                    onChange={e =>
                      setFormData(current => ({
                        ...current,
                        content: e.target.value
                      }))
                    }
                    rows={6}
                    placeholder="Rewrite this draft to sound more concise and confident..."
                    // About sixteen lines to start; it grows with what is
                    // written, then scrolls.
                    className="max-h-[50vh] min-h-80"
                    required
                    disabled={isFormBusy}
                  />
                </div>
              </div>

              <div className="min-w-0 space-y-3.5">
                <PromptPresetFields
                  models={presetModels}
                  renderModel={groups => (
                    <ModelSelect
                      groups={groups.map(group => ({
                        label: group.label,
                        models: presetModels.filter(group.can)
                      }))}
                      value={formData.preset.modelId}
                      onValueChange={modelId =>
                        setFormData(current => ({
                          ...current,
                          preset: { ...current.preset, modelId }
                        }))
                      }
                      empty
                      disabled={isFormBusy}
                      className="w-full"
                    />
                  )}
                  value={formData.preset}
                  onChange={preset =>
                    setFormData(current => ({ ...current, preset }))
                  }
                  disabled={isFormBusy}
                />

                <ImageUpload
                  type="prompts"
                  label="Image"
                  hint="JPEG, PNG, GIF or WebP, up to 5MB."
                  value={formData.image}
                  onChange={image =>
                    setFormData(current => ({ ...current, image }))
                  }
                  onUploadingChange={setIsUploadingImage}
                  disabled={isFormBusy}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeDialog}
                disabled={isFormBusy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isFormBusy}>
                {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                {editingId ? 'Save Changes' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteId}
        onOpenChange={open => {
          if (!open && !deleteMutation.isPending) {
            setDeleteId(null);
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Prompt</AlertDialogTitle>
            <AlertDialogDescription>
              {deletePrompt
                ? `Delete "${deletePrompt.name}" from your prompt library?`
                : 'Delete this prompt from your prompt library?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={event => {
                event.preventDefault();
                if (deleteId) {
                  deleteMutation.mutate({ id: deleteId });
                }
              }}
            >
              {deleteMutation.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
