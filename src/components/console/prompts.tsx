import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { modelCapabilitySchema } from '@/types/model';
import { CAPABILITIES } from '@/lib/constant';
import { mutating } from '@/lib/mutation';
import { useEditRecord } from '@/hooks/use-edit-record';
import { useSearchFilter } from '@/hooks/use-search-filter';
import {
  modelQueries,
  type listModelsForSelect
} from '@/server/functions/model';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
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
import { ModelStatusName } from '@/components/console/model-status';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import { promptTableInput } from '@/components/console/table-filters';
import {
  ConsoleFilters,
  ConsoleSearch,
  ConsoleToolbar
} from '@/components/console/toolbar';
import { ImageUpload } from '@/components/image-upload';
import { PromptPresetFields } from '@/components/prompt-preset-fields';

type AdminPrompt = Awaited<ReturnType<typeof adminListPrompts>>['rows'][number];
/** What the edit form is filled from: the prompt as read when it opens. */
type EditablePrompt = NonNullable<Awaited<ReturnType<typeof adminGetPrompt>>>;

const promptSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  content: z.string().trim().min(1, 'Content is required'),
  image: z.string().max(500),
  tags: z.string(),
  preset: z.object({
    type: modelCapabilitySchema,
    needsReference: z.boolean(),
    modelId: z.string().nullable()
  })
});

type PromptForm = z.infer<typeof promptSchema>;

const EMPTY_FORM: PromptForm = {
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

/** Every model, as the console's selectors have them: with why it will not
 *  answer, where it will not. */
type ConsoleModel = Awaited<ReturnType<typeof listModelsForSelect>>[number];

/** The model a prompt is tried on by default, whether it answers, and what
 *  the prompt is for. */
const PresetModel = ({
  model,
  prompt
}: {
  model: ConsoleModel | undefined;
  prompt: Pick<AdminPrompt, 'modelId' | 'type' | 'needsReference'>;
}) => {
  const kind = `${CAPABILITIES.find(({ value }) => value === prompt.type)?.label}${prompt.needsReference ? ' · Reference' : ''}`;
  if (!prompt.modelId) {
    return <span className="text-sm text-muted-foreground">{kind}</span>;
  }
  return (
    <div className="min-w-0">
      {model ? (
        <ModelStatusName status={model.status} className="max-w-full">
          {model.name}
        </ModelStatusName>
      ) : (
        <div className="truncate">{prompt.modelId}</div>
      )}
      <div className="truncate text-xs text-muted-foreground">{kind}</div>
    </div>
  );
};

const helper = createAppColumnHelper<AdminPrompt>();

const promptColumns = (ctx: {
  model: (modelId: string | null) => ConsoleModel | undefined;
  edit: (prompt: AdminPrompt) => void;
  remove: (prompt: AdminPrompt) => void;
}) =>
  helper.columns([
    helper.display({
      id: 'image',
      header: '',
      meta: { align: 'center', headClassName: 'w-16 min-w-16' },
      cell: ({ row }) =>
        row.original.image ? (
          <img
            src={row.original.image}
            alt=""
            className="mx-auto block size-8 rounded border object-cover"
          />
        ) : (
          <div className="mx-auto size-8 rounded border bg-muted" />
        )
    }),
    helper.accessor('name', { header: 'Name' }),
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
    helper.accessor('modelId', {
      header: 'Model',
      cell: ({ row }) => (
        <PresetModel
          model={ctx.model(row.original.modelId)}
          prompt={row.original}
        />
      )
    }),
    helper.accessor(row => row.user?.name || row.user?.email, {
      id: 'owner',
      header: 'Owner',
      meta: { cellClassName: 'text-sm text-muted-foreground' },
      cell: ({ row }) =>
        row.original.user?.name || row.original.user?.email || '—'
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
      columns={promptColumns({
        model: () => undefined,
        edit: noop,
        remove: noop
      })}
    />
  );
}

export default function PromptsPage() {
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
  const { data: models = [] } = useQuery(modelQueries.forSelect());
  const model = (modelId: string | null) =>
    models.find(each => each.modelId === modelId);

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
      const payload = {
        name: value.name.trim(),
        content: value.content.trim(),
        image: value.image || null,
        tags: tags.length > 0 ? tags : null,
        ...value.preset
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
          preset: {
            type: prompt.type,
            needsReference: prompt.needsReference,
            modelId: prompt.modelId
          }
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
    () => promptColumns({ model, edit: openEdit, remove: setDeletePrompt }),
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
          <DialogContent className="sm:max-w-3xl">
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
              {/* The words on the left, with room to write them; what the
                  prompt presets on the right. One column on a phone. */}
              <fieldset
                disabled={record.isLoading}
                className="-mx-6 grid max-h-[70vh] min-w-0 gap-x-6 gap-y-3.5 overflow-y-auto px-6 md:grid-cols-2"
              >
                <div className="min-w-0 space-y-3.5">
                  <form.AppField name="name">
                    {field => (
                      <field.TextField
                        label="Name"
                        placeholder="Research prompt"
                      />
                    )}
                  </form.AppField>

                  <form.AppField name="tags">
                    {field => (
                      <field.TextField
                        label="Tags"
                        placeholder="writing, english"
                        hint="Comma-separated."
                      />
                    )}
                  </form.AppField>

                  <form.AppField name="content">
                    {field => (
                      <field.TextareaField
                        label="Content"
                        rows={6}
                        placeholder="Rewrite this draft to sound more concise..."
                        // About sixteen lines to start; it grows with what is
                        // written, then scrolls.
                        className="max-h-[50vh] min-h-80"
                      />
                    )}
                  </form.AppField>
                </div>

                <div className="min-w-0 space-y-3.5">
                  <form.Field name="preset">
                    {field => (
                      <PromptPresetFields
                        models={models}
                        renderModel={groups => (
                          <form.AppField name="preset.modelId">
                            {modelField => (
                              <modelField.ModelField
                                models={models}
                                groups={groups}
                                empty
                              />
                            )}
                          </form.AppField>
                        )}
                        value={field.state.value}
                        onChange={field.handleChange}
                        disabled={record.isLoading}
                      />
                    )}
                  </form.Field>

                  <form.Field name="image">
                    {field => (
                      <ImageUpload
                        type="prompts"
                        label="Image"
                        hint="JPEG, PNG, GIF or WebP, up to 5MB."
                        value={field.state.value}
                        onChange={field.handleChange}
                      />
                    )}
                  </form.Field>
                </div>
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
