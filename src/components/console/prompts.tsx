import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { uploadFile } from '@/lib/api';
import { mutating } from '@/lib/mutation';
import { useCurrentUser } from '@/hooks/use-current-user';
import { modelQueries } from '@/server/fn/model';
import {
  adminCreatePrompt,
  adminDeletePrompt,
  adminListPrompts,
  adminUpdatePrompt,
  promptQueries
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
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

type AdminPrompt = Awaited<ReturnType<typeof adminListPrompts>>[number];
type Visibility = 'private' | 'public';

type PromptFormData = {
  name: string;
  content: string;
  image: string;
  tags: string;
  providers: string;
  models: string[];
  visibility: Visibility;
};

// Admin-created prompts default to public (available to all users).
const EMPTY_FORM: PromptFormData = {
  name: '',
  content: '',
  image: '',
  tags: '',
  providers: '',
  models: [],
  visibility: 'public'
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

export default function PromptsPage() {
  const { user } = useCurrentUser();

  const [isOpen, setIsOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<AdminPrompt | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<AdminPrompt | null>(null);
  const [search, setSearch] = useState('');
  const [formData, setFormData] = useState<PromptFormData>(EMPTY_FORM);

  const queryClient = useQueryClient();
  const { data: prompts, isLoading } = useQuery(promptQueries.adminList());
  const { data: models } = useQuery(modelQueries.list());

  const modelName = (modelId: string) =>
    models?.find(m => m.modelId === modelId)?.name ?? modelId;

  const resetForm = () => {
    setEditingPrompt(null);
    setFormData(EMPTY_FORM);
  };

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: promptQueries.key.adminList()
      }),
      queryClient.invalidateQueries({
        queryKey: promptQueries.key.listUsable()
      })
    ]);

  const adminCreateMutation = useMutation({
    mutationFn: mutating(adminCreatePrompt),
    onSuccess: async () => {
      await invalidate();
      setIsOpen(false);
      resetForm();
      toast.success('Prompt created');
    },
    onError: error => toast.error(error.message)
  });

  const adminUpdateMutation = useMutation({
    mutationFn: mutating(adminUpdatePrompt),
    onSuccess: async () => {
      await invalidate();
      setIsOpen(false);
      resetForm();
      toast.success('Prompt updated');
    },
    onError: error => toast.error(error.message)
  });

  const adminDeleteMutation = useMutation({
    mutationFn: mutating(adminDeletePrompt),
    onSuccess: async () => {
      await invalidate();
      setDeletePrompt(null);
      toast.success('Prompt deleted');
    },
    onError: error => toast.error(error.message)
  });

  const isPending =
    adminCreateMutation.isPending || adminUpdateMutation.isPending;

  const filteredPrompts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return prompts ?? [];
    return (prompts ?? []).filter(
      prompt =>
        prompt.name.toLowerCase().includes(keyword) ||
        prompt.content.toLowerCase().includes(keyword)
    );
  }, [prompts, search]);

  const handleEdit = (prompt: AdminPrompt) => {
    setEditingPrompt(prompt);
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

  const handleSubmit = (e: React.FormEvent) => {
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

    if (editingPrompt) {
      adminUpdateMutation.mutate({ id: editingPrompt.id, ...payload });
    } else {
      adminCreateMutation.mutate(payload);
    }
  };

  const toggleModel = (modelId: string) => {
    setFormData(current => ({
      ...current,
      models: current.models.includes(modelId)
        ? current.models.filter(item => item !== modelId)
        : [...current.models, modelId]
    }));
  };

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or content"
            className="pl-9"
          />
        </div>

        <Dialog
          open={isOpen}
          onOpenChange={open => {
            setIsOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger
            render={
              <Button className="gap-2" onClick={resetForm}>
                <Plus className="size-4" />
                Add Prompt
              </Button>
            }
          />
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingPrompt ? 'Edit Prompt' : 'Add Prompt'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div className="-mx-6 max-h-[60vh] space-y-3.5 overflow-y-auto px-6">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={e =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="Research prompt"
                    required
                    disabled={isPending}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="content">Content</Label>
                  <Textarea
                    id="content"
                    value={formData.content}
                    onChange={e =>
                      setFormData({ ...formData, content: e.target.value })
                    }
                    rows={6}
                    placeholder="Rewrite this draft to sound more concise..."
                    required
                    disabled={isPending}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="tags">Tags</Label>
                    <Input
                      id="tags"
                      value={formData.tags}
                      onChange={e =>
                        setFormData({ ...formData, tags: e.target.value })
                      }
                      placeholder="writing, english"
                      disabled={isPending}
                    />
                    <p className="text-xs text-muted-foreground">
                      Comma-separated. Used for filtering.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="providers">Providers</Label>
                    <Input
                      id="providers"
                      value={formData.providers}
                      onChange={e =>
                        setFormData({ ...formData, providers: e.target.value })
                      }
                      placeholder="openai, anthropic"
                      disabled={isPending}
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
                            disabled={isPending}
                          />
                          <span>{model.name}</span>
                        </label>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No models.
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Target models — used for filtering.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Image</Label>
                  <div className="flex items-start gap-4">
                    {formData.image ? (
                      <div className="relative">
                        <img
                          src={formData.image}
                          alt="Preview"
                          className="size-24 rounded border object-cover"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setFormData({ ...formData, image: '' })
                          }
                          className="absolute -top-2 -right-2 rounded-full bg-destructive p-1 text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                          disabled={isPending}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex size-24 cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-muted-foreground/25 hover:border-muted-foreground/50">
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/gif,image/webp"
                          className="hidden"
                          disabled={isPending}
                          onChange={async e => {
                            const file = e.target.files?.[0];
                            if (!file) return;

                            if (!user?.id) {
                              toast.error('Please sign in again to upload');
                              return;
                            }

                            const result = await uploadFile(file, {
                              userId: user.id,
                              type: 'prompts'
                            });
                            if ('error' in result) {
                              toast.error(result.error || 'Upload failed');
                              return;
                            }
                            setFormData({ ...formData, image: result.url });
                          }}
                        />
                        <Plus className="size-6 text-muted-foreground" />
                        <span className="mt-1 text-xs text-muted-foreground">
                          Upload
                        </span>
                      </label>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Max 5MB. Supports JPEG, PNG, GIF, WebP.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="visibility">Visibility</Label>
                  <Select
                    value={formData.visibility}
                    onValueChange={value =>
                      setFormData({
                        ...formData,
                        visibility: value as Visibility
                      })
                    }
                    disabled={isPending}
                  >
                    <SelectTrigger id="visibility">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">
                        Public — visible to all users
                      </SelectItem>
                      <SelectItem value="private">
                        Private — only the owner
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsOpen(false);
                    resetForm();
                  }}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending} className="gap-2">
                  {isPending && <Loader2 className="size-4 animate-spin" />}
                  {editingPrompt ? 'Save Changes' : 'Create'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[820px]">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="w-20 p-3 text-left text-sm font-medium">Image</th>
              <th className="p-3 text-left text-sm font-medium">Name</th>
              <th className="p-3 text-left text-sm font-medium">Owner</th>
              <th className="p-3 text-left text-sm font-medium">Tags</th>
              <th className="p-3 text-left text-sm font-medium">Models</th>
              <th className="w-24 p-3 text-left text-sm font-medium">
                Visibility
              </th>
              <th className="w-24 p-3 text-right text-sm font-medium">
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
                <td className="p-3 text-sm text-muted-foreground">
                  {prompt.user?.name || prompt.user?.email || '—'}
                </td>
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
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(prompt)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <TooltipContent>Edit Prompt</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeletePrompt(prompt)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      }
                    />
                    <TooltipContent>Delete Prompt</TooltipContent>
                  </Tooltip>
                </td>
              </tr>
            ))}

            {filteredPrompts.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="p-6 text-center text-muted-foreground"
                >
                  {prompts?.length
                    ? 'No prompts match the current filter.'
                    : 'No prompts yet. Add the first one.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AlertDialog
        open={!!deletePrompt}
        onOpenChange={open => {
          if (!open && !adminDeleteMutation.isPending) setDeletePrompt(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Prompt</AlertDialogTitle>
            <AlertDialogDescription>
              {deletePrompt
                ? `Delete "${deletePrompt.name}"?`
                : 'Delete this prompt?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={adminDeleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={adminDeleteMutation.isPending}
              onClick={event => {
                event.preventDefault();
                if (deletePrompt) {
                  adminDeleteMutation.mutate({ id: deletePrompt.id });
                }
              }}
            >
              {adminDeleteMutation.isPending && (
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
