import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient
} from '@tanstack/react-query';
import { Copy, Loader2, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { uploadFile } from '@/lib/api';
import { mutating } from '@/lib/mutation';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useCurrentUser } from '@/hooks/use-current-user';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

type MyPrompt = Awaited<ReturnType<typeof listPrompts>>[number];

type PromptFormData = {
  name: string;
  content: string;
  image: string;
  // A comma-separated string of free-text labels.
  tags: string;
};

const EMPTY_FORM: PromptFormData = {
  name: '',
  content: '',
  image: '',
  tags: ''
};

const parseList = (value: string) =>
  value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

const joinList = (value?: string[] | null) => (value ?? []).join(', ');

const LabelBadges = ({
  values,
  className
}: {
  values?: string[] | null;
  className: string;
}) => {
  if (!values?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {values.map(value => (
        <span key={value} className={className}>
          {value}
        </span>
      ))}
    </div>
  );
};

const PromptThumbnail = ({
  content,
  image,
  name
}: {
  content: string;
  image?: string | null;
  name: string;
}) => {
  if (image) {
    return (
      <img
        src={image}
        alt={name}
        className="size-12 rounded-md border object-cover"
      />
    );
  }

  return (
    <div className="flex size-12 items-start overflow-hidden rounded-md border bg-muted p-1">
      <p className="line-clamp-4 text-[9px] leading-3 whitespace-pre-wrap text-muted-foreground">
        {content}
      </p>
    </div>
  );
};

/** Rows in the table's own shape — the initial load, and the page being
 *  fetched as it joins the rows already on screen. */
const MY_PROMPTS_SKELETON_ROWS = 5;
const NEXT_PAGE_PLACEHOLDER_ROWS = 3;

function MyPromptsSkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="border-b last:border-b-0">
          <td className="p-3">
            <Skeleton className="size-8 rounded" />
          </td>
          <td className="p-3">
            <Skeleton className="h-4 w-32" />
          </td>
          <td className="p-3">
            <Skeleton className="h-4 w-20" />
          </td>
          <td className="p-3">
            <Skeleton className="ml-auto h-4 w-16" />
          </td>
        </tr>
      ))}
    </>
  );
}

function MyPromptsSkeleton() {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="w-20 p-3 text-left text-sm font-medium">Image</th>
            <th className="p-3 text-left text-sm font-medium">Name</th>
            <th className="p-3 text-left text-sm font-medium">Tags</th>
            <th className="w-28 p-3 text-right text-sm font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          <MyPromptsSkeletonRows count={MY_PROMPTS_SKELETON_ROWS} />
        </tbody>
      </table>
    </div>
  );
}

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
  createRequestId,
  scrollRef
}: {
  search: string;
  createRequestId: number;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const { copyToClipboard } = useCopyToClipboard();
  const queryClient = useQueryClient();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { user } = useCurrentUser();

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
        search: debouncedSearch || undefined
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
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
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
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
    setIsOpen(true);
  }, [createRequestId]);

  const handleEdit = (prompt: MyPrompt) => {
    setEditingId(prompt.id);
    setFormData({
      name: prompt.name,
      content: prompt.content,
      image: prompt.image || '',
      tags: joinList(prompt.tags)
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
    // Providers/models aren't offered here either — nothing in the app
    // filters or targets by them, so asking for a choice with no effect
    // would only slow down adding a prompt.
    const payload = {
      name,
      content,
      image: formData.image || null,
      tags: tags.length > 0 ? tags : null
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload });
      return;
    }

    createMutation.mutate(payload);
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be 5MB or smaller');
      e.target.value = '';
      return;
    }

    if (!user?.id) {
      toast.error('Please sign in again to upload');
      return;
    }

    setIsUploadingImage(true);

    try {
      const result = await uploadFile(file, {
        userId: user.id,
        type: 'prompts'
      });

      if ('error' in result) {
        toast.error(result.error || 'Upload failed');
        return;
      }

      setFormData(current => ({ ...current, image: result.url }));
    } finally {
      setIsUploadingImage(false);
      e.target.value = '';
    }
  };

  if (isLoading) {
    return <MyPromptsSkeleton />;
  }

  return (
    <div className="flex flex-col">
      <div className="space-y-4">
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="w-20 p-3 text-left text-sm font-medium">
                  Image
                </th>
                <th className="p-3 text-left text-sm font-medium">Name</th>
                <th className="p-3 text-left text-sm font-medium">Tags</th>
                <th className="w-28 p-3 text-right text-sm font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {myPrompts.map(prompt => (
                <tr
                  key={prompt.id}
                  className="border-b transition-colors hover:bg-muted/30"
                >
                  <td className="p-3">
                    {prompt.image ? (
                      <img
                        src={prompt.image}
                        alt=""
                        className="size-8 rounded border object-cover"
                      />
                    ) : (
                      <div className="size-8 rounded border bg-muted" />
                    )}
                  </td>
                  <td className="p-3">{prompt.name}</td>
                  <td className="p-3">
                    <LabelBadges
                      values={prompt.tags}
                      className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    />
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(prompt.content)}
                        >
                          <Copy className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy Prompt</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(prompt)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit Prompt</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(prompt.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete Prompt</TooltipContent>
                    </Tooltip>
                  </td>
                </tr>
              ))}

              {/* The page being fetched, in the table it is joining. */}
              {isFetchingNextPage && (
                <MyPromptsSkeletonRows count={NEXT_PAGE_PLACEHOLDER_ROWS} />
              )}

              {!isFetchingNextPage && myPrompts.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="p-6 text-center text-muted-foreground"
                  >
                    {debouncedSearch
                      ? 'No prompts match your search.'
                      : 'No prompts yet. Add your first prompt to get started.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit Prompt' : 'Add Prompt'}
            </DialogTitle>
            <DialogDescription>
              Manage your prompt. It stays private to you.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div className="-mx-6 max-h-[60vh] space-y-3.5 overflow-y-auto px-6">
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
                  Comma-separated, shown as labels in your prompt list.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Image</Label>
                <div className="flex items-center gap-3">
                  <PromptThumbnail
                    name={formData.name || 'Prompt image'}
                    image={formData.image}
                    content={formData.content || 'Preview'}
                  />
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    className="hidden"
                    disabled={isFormBusy}
                    onChange={handleImageChange}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={isFormBusy}
                    >
                      {isUploadingImage && (
                        <Loader2 className="size-4 animate-spin" />
                      )}
                      {formData.image ? 'Replace image' : 'Upload image'}
                    </Button>
                    {formData.image && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setFormData(current => ({
                            ...current,
                            image: ''
                          }))
                        }
                        disabled={isFormBusy}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  JPEG, PNG, GIF or WebP, up to 5MB.
                </p>
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
