import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { uploadFile } from '@/lib/api';
import { mutating } from '@/lib/mutation';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useSearchFilter } from '@/hooks/use-search-filter';
import { modelQueries } from '@/server/fn/model';
import {
  adminCreatePrompt,
  adminDeletePrompt,
  adminUpdatePrompt,
  promptQueries,
  type adminListPrompts
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
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { useAppForm } from '@/components/app-form';
import {
  createAppColumnHelper,
  DataTable
} from '@/components/console/data-table';

type AdminPrompt = Awaited<ReturnType<typeof adminListPrompts>>[number];

const promptSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  content: z.string().trim().min(1, 'Content is required'),
  image: z.string(),
  tags: z.string(),
  providers: z.string(),
  models: z.array(z.string()),
  visibility: z.enum(['private', 'public'])
});

type PromptForm = z.infer<typeof promptSchema>;

// Admin-created prompts default to public (available to all users).
const EMPTY_FORM: PromptForm = {
  name: '',
  content: '',
  image: '',
  tags: '',
  providers: '',
  models: [],
  visibility: 'public'
};

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public — visible to all users' },
  { value: 'private', label: 'Private — only the owner' }
];

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

const helper = createAppColumnHelper<AdminPrompt>();

const promptColumns = (ctx: {
  modelName: (modelId: string) => string;
  edit: (prompt: AdminPrompt) => void;
  remove: (prompt: AdminPrompt) => void;
}) =>
  helper.columns([
    helper.display({
      id: 'image',
      header: 'Image',
      meta: { headClassName: 'w-20' },
      cell: ({ row }) =>
        row.original.image ? (
          <img
            src={row.original.image}
            alt=""
            className="size-8 rounded border object-cover"
          />
        ) : (
          <div className="size-8 rounded border bg-muted" />
        )
    }),
    helper.accessor('name', { header: 'Name' }),
    helper.accessor(row => row.user?.name || row.user?.email, {
      id: 'owner',
      header: 'Owner',
      meta: { cellClassName: 'text-sm text-muted-foreground' },
      cell: ({ row }) =>
        row.original.user?.name || row.original.user?.email || '—'
    }),
    helper.accessor('tags', {
      header: 'Tags',
      cell: ({ row }) => (
        <LabelBadges
          values={row.original.tags}
          className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
        />
      )
    }),
    helper.accessor('models', {
      header: 'Models',
      cell: ({ row }) => (
        <LabelBadges
          values={row.original.models?.map(ctx.modelName)}
          className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300"
        />
      )
    }),
    helper.accessor('visibility', {
      header: 'Visibility',
      meta: { headClassName: 'w-24' },
      cell: ({ row }) => (
        <span className="rounded bg-muted px-2 py-1 text-xs">
          {row.original.visibility}
        </span>
      )
    }),
    helper.display({
      id: 'actions',
      header: 'Actions',
      meta: {
        align: 'right',
        headClassName: 'w-24',
        cellClassName: 'whitespace-nowrap'
      },
      cell: ({ row }) => (
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => ctx.edit(row.original)}
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
                  onClick={() => ctx.remove(row.original)}
                >
                  <Trash2 className="size-4" />
                </Button>
              }
            />
            <TooltipContent>Delete Prompt</TooltipContent>
          </Tooltip>
        </>
      )
    })
  ]);

export default function PromptsPage() {
  const { user } = useCurrentUser();

  const [isOpen, setIsOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<AdminPrompt | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<AdminPrompt | null>(null);
  const [search, setSearch] = useSearchFilter('q', '');

  const queryClient = useQueryClient();
  const { data: prompts, isLoading } = useQuery(promptQueries.adminList());
  const { data: models } = useQuery(modelQueries.list());

  const modelName = (modelId: string) =>
    models?.find(m => m.modelId === modelId)?.name ?? modelId;

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: promptQueries.key.adminList()
      }),
      queryClient.invalidateQueries({
        queryKey: promptQueries.key.usable()
      })
    ]);

  const adminCreateMutation = useMutation({
    mutationFn: mutating(adminCreatePrompt),
    onSuccess: async () => {
      await invalidate();
      toast.success('Prompt created');
    }
  });

  const adminUpdateMutation = useMutation({
    mutationFn: mutating(adminUpdatePrompt),
    onSuccess: async () => {
      await invalidate();
      toast.success('Prompt updated');
    }
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

  const form = useAppForm({
    defaultValues: EMPTY_FORM,
    validators: { onChange: promptSchema },
    onSubmit: async ({ value }) => {
      const tags = parseList(value.tags);
      const providers = parseList(value.providers);
      const payload = {
        name: value.name.trim(),
        content: value.content.trim(),
        image: value.image || null,
        tags: tags.length > 0 ? tags : null,
        providers: providers.length > 0 ? providers : null,
        models: value.models.length > 0 ? value.models : null,
        visibility: value.visibility
      };

      try {
        if (editingPrompt) {
          await adminUpdateMutation.mutateAsync({
            id: editingPrompt.id,
            ...payload
          });
        } else {
          await adminCreateMutation.mutateAsync(payload);
        }
        setIsOpen(false);
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  });

  const openFor = (prompt: AdminPrompt | null) => {
    setEditingPrompt(prompt);
    form.reset(
      prompt
        ? {
            name: prompt.name,
            content: prompt.content,
            image: prompt.image || '',
            tags: joinList(prompt.tags),
            providers: joinList(prompt.providers),
            models: prompt.models || [],
            visibility: prompt.visibility
          }
        : EMPTY_FORM
    );
    setIsOpen(true);
  };

  const filteredPrompts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return prompts ?? [];
    return (prompts ?? []).filter(
      prompt =>
        prompt.name.toLowerCase().includes(keyword) ||
        prompt.content.toLowerCase().includes(keyword)
    );
  }, [prompts, search]);

  const columns = useMemo(
    () => promptColumns({ modelName, edit: openFor, remove: setDeletePrompt }),
    [models]
  );

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

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger
            render={
              <Button className="gap-2" onClick={() => openFor(null)}>
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
            <form
              onSubmit={e => {
                e.preventDefault();
                form.handleSubmit();
              }}
              className="space-y-3.5"
            >
              <div className="-mx-6 max-h-[60vh] space-y-3.5 overflow-y-auto px-6">
                <form.AppField name="name">
                  {field => (
                    <field.TextField
                      label="Name"
                      placeholder="Research prompt"
                    />
                  )}
                </form.AppField>

                <form.AppField name="content">
                  {field => (
                    <field.TextareaField
                      label="Content"
                      rows={6}
                      placeholder="Rewrite this draft to sound more concise..."
                    />
                  )}
                </form.AppField>

                <div className="grid gap-3 sm:grid-cols-2">
                  <form.AppField name="tags">
                    {field => (
                      <field.TextField
                        label="Tags"
                        placeholder="writing, english"
                        hint="Comma-separated. Used for filtering."
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="providers">
                    {field => (
                      <field.TextField
                        label="Providers"
                        placeholder="openai, anthropic"
                        hint="Comma-separated labels (display only)."
                      />
                    )}
                  </form.AppField>
                </div>

                <form.Field name="models" mode="array">
                  {field => (
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
                                checked={field.state.value.includes(
                                  model.modelId
                                )}
                                onCheckedChange={() =>
                                  field.handleChange(current =>
                                    current.includes(model.modelId)
                                      ? current.filter(
                                          item => item !== model.modelId
                                        )
                                      : [...current, model.modelId]
                                  )
                                }
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
                  )}
                </form.Field>

                <form.Field name="image">
                  {field => (
                    <div className="space-y-2">
                      <Label>Image</Label>
                      <div className="flex items-start gap-4">
                        {field.state.value ? (
                          <div className="relative">
                            <img
                              src={field.state.value}
                              alt="Preview"
                              className="size-24 rounded border object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => field.handleChange('')}
                              className="absolute -top-2 -right-2 rounded-full bg-destructive p-1 text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
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
                                field.handleChange(result.url);
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
                  )}
                </form.Field>

                <form.AppField name="visibility">
                  {field => (
                    <field.SelectField
                      label="Visibility"
                      options={VISIBILITY_OPTIONS}
                    />
                  )}
                </form.AppField>
              </div>

              <div className="flex justify-end gap-2">
                <form.Subscribe selector={state => state.isSubmitting}>
                  {isSubmitting => (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsOpen(false)}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                  )}
                </form.Subscribe>
                <form.AppForm>
                  <form.SubmitButton>
                    {editingPrompt ? 'Save Changes' : 'Create'}
                  </form.SubmitButton>
                </form.AppForm>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <DataTable
        columns={columns}
        data={filteredPrompts}
        className="overflow-x-auto"
        tableClassName="min-w-[820px]"
        empty={
          prompts?.length
            ? 'No prompts match the current filter.'
            : 'No prompts yet. Add the first one.'
        }
      />

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
