import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { uploadFile } from '@/lib/api';
import { mutating } from '@/lib/mutation';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useCurrentUser } from '@/hooks/use-current-user';
import { modelQueries } from '@/server/fn/model';
import {
  createPrompt,
  deletePrompt as deletePromptFn,
  promptQueries,
  updatePrompt,
  type listPrompts
} from '@/server/fn/prompt';
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
import { Checkbox } from '@/components/ui/checkbox';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

type MyPrompt = Awaited<ReturnType<typeof listPrompts>>[number];
type Visibility = 'private' | 'public';

type PromptFormData = {
  name: string;
  content: string;
  image: string;
  // tags & providers are free-text labels entered as a comma-separated string.
  tags: string;
  providers: string;
  // models references real model ids.
  models: string[];
  visibility: Visibility;
};

const EMPTY_FORM: PromptFormData = {
  name: '',
  content: '',
  image: '',
  tags: '',
  providers: '',
  models: [],
  visibility: 'private'
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

export const UserPrompt = () => {
  const { copyToClipboard } = useCopyToClipboard();
  const queryClient = useQueryClient();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { user } = useCurrentUser();

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [formData, setFormData] = useState<PromptFormData>(EMPTY_FORM);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const { data: myPrompts, isLoading } = useQuery(promptQueries.list());
  const { data: models } = useQuery(modelQueries.list());

  const modelName = (modelId: string) =>
    models?.find(m => m.modelId === modelId)?.name ?? modelId;

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
      queryClient.invalidateQueries({ queryKey: promptQueries.key.list() }),
      queryClient.invalidateQueries({
        queryKey: promptQueries.key.usable()
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

  const filteredPrompts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return myPrompts ?? [];

    return (myPrompts ?? []).filter(
      prompt =>
        prompt.name.toLowerCase().includes(keyword) ||
        prompt.content.toLowerCase().includes(keyword)
    );
  }, [myPrompts, search]);

  const deletePrompt =
    myPrompts?.find(prompt => prompt.id === deleteId) ?? null;

  const handleCreate = () => {
    resetForm();
    setIsOpen(true);
  };

  const handleEdit = (prompt: MyPrompt) => {
    setEditingId(prompt.id);
    setFormData({
      name: prompt.name,
      content: prompt.content,
      image: prompt.image || '',
      tags: joinList(prompt.tags),
      providers: joinList(prompt.providers),
      models: prompt.models || [],
      visibility: prompt.visibility
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
    const providers = parseList(formData.providers);
    const payload = {
      name,
      content,
      image: formData.image || null,
      tags: tags.length > 0 ? tags : null,
      providers: providers.length > 0 ? providers : null,
      models: formData.models.length > 0 ? formData.models : null,
      visibility: formData.visibility
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload });
      return;
    }

    createMutation.mutate(payload);
  };

  const toggleModel = (modelId: string) => {
    setFormData(current => ({
      ...current,
      models: current.models.includes(modelId)
        ? current.models.filter(item => item !== modelId)
        : [...current.models, modelId]
    }));
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
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or content"
              className="pl-9"
            />
          </div>
          <Button className="gap-2" onClick={handleCreate}>
            <Plus className="size-4" />
            Add Prompt
          </Button>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="w-20 p-3 text-left text-sm font-medium">
                  Image
                </th>
                <th className="p-3 text-left text-sm font-medium">Name</th>
                <th className="p-3 text-left text-sm font-medium">Tags</th>
                <th className="p-3 text-left text-sm font-medium">Models</th>
                <th className="w-24 p-3 text-left text-sm font-medium">
                  Visibility
                </th>
                <th className="w-28 p-3 text-right text-sm font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredPrompts.map(prompt => (
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
                  <td className="p-3">
                    <LabelBadges
                      values={prompt.models?.map(modelName)}
                      className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300"
                    />
                  </td>
                  <td className="p-3">
                    <span className="rounded bg-muted px-2 py-1 text-xs">
                      {prompt.visibility}
                    </span>
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

              {filteredPrompts.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="p-6 text-center text-muted-foreground"
                  >
                    {myPrompts?.length
                      ? 'No prompts match the current filter.'
                      : 'No prompts configured. Add your first prompt to get started.'}
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
            <DialogDescription>Manage your prompt.</DialogDescription>
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

              <div className="grid gap-3 sm:grid-cols-2">
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
                    Comma-separated. Used for filtering.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prompt-providers">Providers</Label>
                  <Input
                    id="prompt-providers"
                    value={formData.providers}
                    onChange={e =>
                      setFormData(current => ({
                        ...current,
                        providers: e.target.value
                      }))
                    }
                    placeholder="openai, anthropic"
                    disabled={isFormBusy}
                  />
                  <p className="text-xs text-muted-foreground">
                    Comma-separated labels (display only).
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Models</Label>
                <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border p-2.5">
                  {models?.length ? (
                    models.map(model => (
                      <label
                        key={model.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={formData.models.includes(model.modelId)}
                          onCheckedChange={() => toggleModel(model.modelId)}
                          disabled={isFormBusy}
                        />
                        <span>{model.name}</span>
                      </label>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">No models.</p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Target models — used for filtering.
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
                  <div className="space-y-2">
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
                    <p className="text-xs text-muted-foreground">Max 5MB.</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-2.5">
                <div className="space-y-1">
                  <Label htmlFor="prompt-public">Public</Label>
                  <p className="text-xs text-muted-foreground">
                    {formData.visibility === 'public'
                      ? 'Visible to everyone in the prompt picker.'
                      : 'Only visible to you.'}
                  </p>
                </div>
                <Switch
                  id="prompt-public"
                  checked={formData.visibility === 'public'}
                  onCheckedChange={checked =>
                    setFormData(current => ({
                      ...current,
                      visibility: checked ? 'public' : 'private'
                    }))
                  }
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
};
