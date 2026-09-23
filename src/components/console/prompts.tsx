import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { uploadFile } from '@/lib/api';
import { mutating } from '@/lib/mutation';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useEditRecord } from '@/hooks/use-edit-record';
import { useSearchFilter } from '@/hooks/use-search-filter';
import { modelQueries } from '@/server/functions/model';
import {
  adminCreatePrompt,
  adminDeletePrompt,
  adminGetPrompt,
  adminUpdatePrompt,
  promptQueries,
  type adminListPrompts
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
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
import { ModelStatusBadge } from '@/components/console/model-status';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import { promptTableInput } from '@/components/console/table-filters';
import {
  ConsoleFilters,
  ConsoleSearch,
  ConsoleToolbar
} from '@/components/console/toolbar';

type AdminPrompt = Awaited<ReturnType<typeof adminListPrompts>>['rows'][number];
/** What the edit form is filled from: the prompt as read when it opens. */
type EditablePrompt = NonNullable<Awaited<ReturnType<typeof adminGetPrompt>>>;

const promptSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  content: z.string().trim().min(1, 'Content is required'),
  image: z.string().max(500),
  tags: z.string(),
  providers: z.string(),
  models: z.array(z.string())
});

type PromptForm = z.infer<typeof promptSchema>;

const EMPTY_FORM: PromptForm = {
  name: '',
  content: '',
  image: '',
  tags: '',
  providers: '',
  models: []
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
      cell: ({ row }) =>
        row.original.tags?.length ? (
          <div className="flex flex-wrap gap-1">
            {row.original.tags.map(tag => (
              <Badge
                key={tag}
                variant="secondary"
                className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
              >
                {tag}
              </Badge>
            ))}
          </div>
        ) : null
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
        <Badge variant="secondary">{row.original.visibility}</Badge>
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
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => ctx.edit(row.original)}
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
                onClick={() => ctx.remove(row.original)}
              >
                <Trash2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete Prompt</TooltipContent>
          </Tooltip>
        </>
      )
    })
  ]);

/** Stands in for the row actions, which a placeholder row can never call. */
const noop = () => {};

/**
 * The page while its first rows are on their way.
 *
 * Built from the same column defs the table uses, so the header is the real one
 * and only the rows stand in. Exported as a component rather than as the column
 * list itself: a module that exports anything but components loses Fast Refresh
 * for everything in it.
 *
 * The actions are empty because they cannot fire — a placeholder row has no
 * record to act on, and the cells that would call them are bars.
 */
export function PromptsPending() {
  return (
    <ConsoleTableSkeleton
      columns={promptColumns({ modelName: () => '', edit: noop, remove: noop })}
    />
  );
}

export default function PromptsPage() {
  const { user } = useCurrentUser();

  const [isOpen, setIsOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<EditablePrompt | null>(
    null
  );
  const [deletePrompt, setDeletePrompt] = useState<AdminPrompt | null>(null);
  const [search, setSearch] = useSearchFilter('q', '');
  const [page, setPage] = useSearchFilter('page', 1);

  const queryClient = useQueryClient();
  const { data, isLoading, isPlaceholderData } = useQuery(
    promptQueries.adminList(promptTableInput({ q: search, page }))
  );
  const { data: models } = useQuery(modelQueries.forSelect());

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

  const [defaults, setDefaults] = useState(EMPTY_FORM);

  const form = useAppForm({
    defaultValues: defaults,
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
        models: value.models.length > 0 ? value.models : null
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

  const openFor = (prompt: EditablePrompt | null) => {
    setEditingPrompt(prompt);
    const values = prompt
      ? {
          name: prompt.name,
          content: prompt.content,
          image: prompt.image || '',
          tags: joinList(prompt.tags),
          providers: joinList(prompt.providers),
          models: prompt.models || []
        }
      : EMPTY_FORM;
    setDefaults(values);
    form.reset(values);
    setIsOpen(true);
  };

  // Editing opens the form on the row as the table shows it, held, and fills
  // it again from the prompt as read now — then it can be typed in.
  const record = useEditRecord(
    id => adminGetPrompt({ data: { id } }),
    'prompt',
    () => setIsOpen(false)
  );
  // Every way out of the dialog: a read still out for it is no longer wanted.
  const close = () => {
    record.cancel();
    setIsOpen(false);
  };
  const openEdit = async (shown: AdminPrompt) => {
    openFor(shown);
    const prompt = await record.load(shown.id);
    if (prompt) openFor(prompt);
  };

  const columns = useMemo(
    () => promptColumns({ modelName, edit: openEdit, remove: setDeletePrompt }),
    [models]
  );

  return (
    <div className="space-y-6">
      <ConsoleToolbar>
        <ConsoleFilters>
          <ConsoleSearch
            placeholder="Search by name or content"
            value={search}
            onChange={setSearch}
          />
        </ConsoleFilters>

        <Dialog
          open={isOpen}
          onOpenChange={open => (open ? setIsOpen(true) : close())}
        >
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={() => openFor(null)}>
              <Plus className="size-4" />
              Add Prompt
            </Button>
          </DialogTrigger>
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
              <fieldset
                disabled={record.isLoading}
                className="-mx-6 max-h-[60vh] min-w-0 space-y-3.5 overflow-y-auto px-6"
              >
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
                              <span className="truncate">{model.name}</span>
                              <ModelStatusBadge status={model.status} />
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
              </fieldset>

              <div className="flex justify-end gap-2">
                <form.Subscribe selector={state => state.isSubmitting}>
                  {isSubmitting => (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={close}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                  )}
                </form.Subscribe>
                <form.AppForm>
                  <form.SubmitButton disabled={record.isLoading}>
                    {editingPrompt ? 'Save Changes' : 'Create'}
                  </form.SubmitButton>
                </form.AppForm>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </ConsoleToolbar>

      <DataTable
        columns={columns}
        data={isLoading ? undefined : data?.rows}
        className="overflow-x-auto"
        tableClassName="min-w-[820px]"
        empty={
          search
            ? 'No prompts match the current filter.'
            : 'No prompts yet. Add the first one.'
        }
        pending={isPlaceholderData}
        pagination={
          data && {
            page: data.page,
            pageSize: data.pageSize,
            total: data.total,
            onPageChange: setPage
          }
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
