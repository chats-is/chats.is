import { useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/trpc/react';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

type Role = 'strict' | 'standard' | 'flexible' | 'custom';

// 5h limit as a fraction of the weekly limit. Weekly is the anchor — admin
// enters a weekly budget and the role chooses how much of it a single 5h
// burst can consume. `custom` has no preset ratio — admin keeps whatever
// values are already stored, edits each separately.
const ROLE_RATIOS: Record<Exclude<Role, 'custom'>, number> = {
  strict: 0.1,
  standard: 0.15,
  flexible: 0.2
};

const ROLE_LABEL: Record<Role, string> = {
  strict: 'Strict (10%)',
  standard: 'Standard (15%)',
  flexible: 'Flexible (20%)',
  custom: 'Custom'
};

/** Tolerance for role detection. Anything within ±1% of a preset is "that". */
const ROLE_DETECT_TOLERANCE = 0.01;

type FormState = {
  name: string;
  description: string;
  role: Role;
  sevenDay: string;
  fiveHour: string; // editable only when role === 'custom'
  isUnlimited: boolean;
  allowedModelIds: string[];
};

const emptyForm: FormState = {
  name: '',
  description: '',
  role: 'standard',
  sevenDay: '',
  fiveHour: '',
  isUnlimited: false,
  allowedModelIds: []
};

/** Detect which role matches the stored fiveHour/sevenDay ratio. Returns 'custom'
 *  if no preset is within tolerance. Empty/zero sevenDay → 'standard' (default). */
const detectRole = (fiveHour: string | null, sevenDay: string | null): Role => {
  const f = Number(fiveHour);
  const w = Number(sevenDay);
  if (!Number.isFinite(w) || w <= 0) return 'standard';
  if (!Number.isFinite(f)) return 'standard';
  const ratio = f / w;
  for (const key of ['strict', 'standard', 'flexible'] as const) {
    if (Math.abs(ratio - ROLE_RATIOS[key]) < ROLE_DETECT_TOLERANCE) {
      return key;
    }
  }
  return 'custom';
};

const fmtLimit = (v: string | null | undefined) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
};

export default function QuotasPage() {
  const utils = api.useUtils();
  const { data: quotas, isLoading } = api.quota.list.useQuery();
  const { data: models } = api.model.list.useQuery();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const create = api.quota.create.useMutation({
    onSuccess: () => {
      utils.quota.list.invalidate();
      utils.quota.listForSelect.invalidate();
      setOpen(false);
      setForm(emptyForm);
      toast.success('Quota created');
    },
    onError: e => toast.error(e.message)
  });

  const update = api.quota.update.useMutation({
    onSuccess: () => {
      utils.quota.list.invalidate();
      utils.quota.listForSelect.invalidate();
      setOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      toast.success('Quota saved');
    },
    onError: e => toast.error(e.message)
  });

  const del = api.quota.delete.useMutation({
    onSuccess: () => {
      utils.quota.list.invalidate();
      utils.quota.listForSelect.invalidate();
      setDeleteId(null);
      toast.success('Quota deleted');
    },
    onError: e => toast.error(e.message)
  });

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setForm(emptyForm);
    }
  }, [open]);

  const fmtAmount = (v: string | null): string => {
    if (v === null || v === '') return '';
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    return n.toFixed(2);
  };

  const startEdit = (q: NonNullable<typeof quotas>[number]) => {
    setEditingId(q.id);
    setForm({
      name: q.name,
      description: q.description ?? '',
      role: detectRole(q.fiveHour, q.sevenDay),
      sevenDay: fmtAmount(q.sevenDay),
      fiveHour: fmtAmount(q.fiveHour),
      isUnlimited: q.isUnlimited,
      allowedModelIds: q.allowedModelIds ?? []
    });
    setOpen(true);
  };

  // Derived display value for the 5h field. When role is a preset, this is
  // computed from sevenDay × ratio. When role is 'custom', it's whatever admin
  // typed into form.fiveHour.
  const computed = useMemo(() => {
    const trimmed = form.sevenDay.trim();
    const w = trimmed === '' ? null : Number(trimmed);
    const sevenDay = w !== null && Number.isFinite(w) && w >= 0 ? w : null;

    let fiveHour: number | null;
    if (form.role === 'custom') {
      const fTrim = form.fiveHour.trim();
      const f = fTrim === '' ? null : Number(fTrim);
      fiveHour = f !== null && Number.isFinite(f) && f >= 0 ? f : null;
    } else {
      fiveHour = sevenDay !== null ? sevenDay * ROLE_RATIOS[form.role] : null;
    }
    return { fiveHour, sevenDay };
  }, [form.sevenDay, form.fiveHour, form.role]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.isUnlimited) {
      if (form.sevenDay.trim() === '') {
        toast.error('Weekly limit is required (or toggle Unlimited)');
        return;
      }
      if (computed.sevenDay === null || computed.sevenDay <= 0) {
        toast.error('Weekly limit must be a positive number');
        return;
      }
      if (
        form.role === 'custom' &&
        (computed.fiveHour === null || computed.fiveHour < 0)
      ) {
        toast.error('5-hour limit must be a non-negative number');
        return;
      }
    }
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      fiveHour: form.isUnlimited ? null : computed.fiveHour,
      sevenDay: form.isUnlimited ? null : computed.sevenDay,
      isUnlimited: form.isUnlimited,
      allowedModelIds: form.allowedModelIds
    };
    if (editingId) {
      update.mutate({ id: editingId, ...payload });
    } else {
      create.mutate(payload);
    }
  };

  const toggleModel = (modelId: string) => {
    setForm(prev => ({
      ...prev,
      allowedModelIds: prev.allowedModelIds.includes(modelId)
        ? prev.allowedModelIds.filter(id => id !== modelId)
        : [...prev.allowedModelIds, modelId]
    }));
  };

  const modelsByCapability = useMemo(() => {
    const groups: Record<string, NonNullable<typeof models>> = {};
    (models ?? []).forEach(m => {
      const cap = m.capability;
      if (!groups[cap]) groups[cap] = [];
      groups[cap].push(m);
    });
    return groups;
  }, [models]);

  const isPending = create.isPending || update.isPending;

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-4">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="size-4" />
              New Quota
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingId ? 'Edit Quota' : 'New Quota'}
              </DialogTitle>
              <DialogDescription>
                Configure usage caps and allowed models for this quota.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div className="-mx-6 max-h-[60vh] space-y-4 overflow-y-auto px-6">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Free, Pro, Team..."
                    required
                    disabled={isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description (optional)</Label>
                  <Textarea
                    value={form.description}
                    onChange={e =>
                      setForm({ ...form, description: e.target.value })
                    }
                    rows={2}
                    disabled={isPending}
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={form.isUnlimited}
                    onCheckedChange={c => setForm({ ...form, isUnlimited: c })}
                    disabled={isPending}
                  />
                  <Label>Unlimited</Label>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>Roles</Label>
                    <Select
                      value={form.role}
                      onValueChange={v => setForm({ ...form, role: v as Role })}
                      disabled={form.isUnlimited || isPending}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="strict">
                          {ROLE_LABEL.strict}
                        </SelectItem>
                        <SelectItem value="standard">
                          {ROLE_LABEL.standard}
                        </SelectItem>
                        <SelectItem value="flexible">
                          {ROLE_LABEL.flexible}
                        </SelectItem>
                        <SelectItem value="custom">
                          {ROLE_LABEL.custom}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Weekly</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                        $
                      </span>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={form.sevenDay}
                        onChange={e =>
                          setForm({ ...form, sevenDay: e.target.value })
                        }
                        disabled={form.isUnlimited || isPending}
                        required={!form.isUnlimited}
                        className="pl-7"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>5-hour</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                        $
                      </span>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        readOnly={form.role !== 'custom'}
                        tabIndex={form.role !== 'custom' ? -1 : 0}
                        value={
                          form.role === 'custom'
                            ? form.fiveHour
                            : computed.fiveHour === null
                              ? ''
                              : computed.fiveHour.toFixed(2)
                        }
                        onChange={
                          form.role === 'custom'
                            ? e =>
                                setForm({ ...form, fiveHour: e.target.value })
                            : undefined
                        }
                        disabled={form.isUnlimited || isPending}
                        className="pl-7"
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>
                    Allowed Models
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      If unchecked, all models are allowed.
                      {form.allowedModelIds.length > 0 &&
                        ` · ${form.allowedModelIds.length} selected`}
                    </span>
                  </Label>
                  <div className="max-h-64 overflow-auto rounded-md border p-3">
                    {Object.keys(modelsByCapability).length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        No models configured.
                      </div>
                    ) : (
                      Object.entries(modelsByCapability).map(([cap, items]) => (
                        <div key={cap} className="mb-3 last:mb-0">
                          <div className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
                            {cap}
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            {items.map(m => (
                              <label
                                key={m.id}
                                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted/40"
                              >
                                <Checkbox
                                  checked={form.allowedModelIds.includes(
                                    m.modelId
                                  )}
                                  onCheckedChange={() => toggleModel(m.modelId)}
                                />
                                <span className="truncate font-mono text-xs">
                                  {m.modelId}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending} className="gap-2">
                  {isPending && <Loader2 className="size-4 animate-spin" />}
                  {editingId ? 'Save Changes' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-3 text-left text-sm font-medium">Name</th>
              <th className="p-3 text-right text-sm font-medium">5h</th>
              <th className="p-3 text-right text-sm font-medium">Weekly</th>
              <th className="p-3 text-center text-sm font-medium">Models</th>
              <th className="w-24 p-3 text-right text-sm font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {quotas?.map(q => (
              <tr
                key={q.id}
                className="border-b transition-colors hover:bg-muted/30"
              >
                <td className="p-3">
                  <div className="font-medium">{q.name}</div>
                  {q.description && (
                    <div className="text-xs text-muted-foreground">
                      {q.description}
                    </div>
                  )}
                  {q.isUnlimited && (
                    <span className="mt-1 inline-block rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300">
                      Unlimited
                    </span>
                  )}
                </td>
                <td className="p-3 text-right font-mono text-sm">
                  {q.isUnlimited ? '∞' : fmtLimit(q.fiveHour)}
                </td>
                <td className="p-3 text-right font-mono text-sm">
                  {q.isUnlimited ? '∞' : fmtLimit(q.sevenDay)}
                </td>
                <td className="p-3 text-center text-sm">
                  {q.allowedModelIds.length === 0
                    ? 'All'
                    : `${q.allowedModelIds.length}`}
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEdit(q)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Edit</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={q.isDefault}
                        onClick={() => setDeleteId(q.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete</TooltipContent>
                  </Tooltip>
                </td>
              </tr>
            ))}
            {(!quotas || quotas.length === 0) && (
              <tr>
                <td
                  colSpan={5}
                  className="p-6 text-center text-muted-foreground"
                >
                  No quotas yet. Create one to start.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AlertDialog
        open={!!deleteId}
        onOpenChange={open => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Quota</AlertDialogTitle>
            <AlertDialogDescription>
              Plans referencing this quota will block the delete. Confirm?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && del.mutate({ id: deleteId })}
              disabled={del.isPending}
              variant="destructive"
              className="gap-2"
            >
              {del.isPending && <Loader2 className="size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
