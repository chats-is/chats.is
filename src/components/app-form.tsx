import {
  createFormHook,
  createFormHookContexts,
  useStore
} from '@tanstack/react-form';
import { CircleDashed, Loader2 } from 'lucide-react';

import { type ModelStatus } from '@/types/model';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ModelStatusName } from '@/components/console/model-status-name';
import { ModelIcon } from '@/components/model-icon';

/**
 * The app's form kit.
 *
 * Every field below owns its own label, error line and disabled-while-saving
 * behaviour, so a form is a list of fields and a submit button rather than a
 * `useState` object with a hand-written `onChange` per input.
 *
 * Bind a form with `useAppForm`, then reach the fields through `form.AppField`:
 *
 *     <form.AppField name="name">
 *       {field => <field.TextField label="Name" placeholder="Pro" />}
 *     </form.AppField>
 */

const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

/** Whichever of `onChange`/`onSubmit` fired, as a line of text. */
function errorText(errors: Array<unknown>): string | null {
  const first = errors.find(Boolean);
  if (!first) return null;
  if (typeof first === 'string') return first;
  const message = (first as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}

/** True while the form is submitting — every field disables itself then. */
function useIsSubmitting(): boolean {
  const field = useFieldContext<unknown>();
  return useStore(field.form.store, state => state.isSubmitting);
}

function FieldShell({
  label,
  hint,
  htmlFor,
  error,
  className,
  children
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor: string;
  error: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {/* The hint is the field's own explanation; it stays put when an error
          appears underneath it so the layout does not jump. */}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** A single-line text input. `prefix` puts a fixed glyph inside the field. */
function TextField({
  label,
  hint,
  prefix,
  fieldClassName,
  className,
  ...props
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  prefix?: string;
  fieldClassName?: string;
} & Omit<
  React.ComponentProps<typeof Input>,
  'value' | 'onChange' | 'onBlur' | 'id'
>) {
  const field = useFieldContext<string>();
  const isSubmitting = useIsSubmitting();
  const error = field.state.meta.isTouched
    ? errorText(field.state.meta.errors)
    : null;

  const input = (
    <Input
      id={field.name}
      // `?? ''`: a field can be asked to render before its value is set, and
      // an undefined value would hand React an uncontrolled input.
      value={field.state.value ?? ''}
      onChange={e => field.handleChange(e.target.value)}
      onBlur={field.handleBlur}
      aria-invalid={!!error}
      disabled={props.disabled ?? isSubmitting}
      className={cn(prefix && 'pl-7', className)}
      {...props}
    />
  );

  return (
    <FieldShell
      label={label}
      hint={hint}
      htmlFor={field.name}
      error={error}
      className={fieldClassName}
    >
      {prefix ? (
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
            {prefix}
          </span>
          {input}
        </div>
      ) : (
        input
      )}
    </FieldShell>
  );
}

function TextareaField({
  label,
  hint,
  fieldClassName,
  ...props
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  fieldClassName?: string;
} & Omit<
  React.ComponentProps<typeof Textarea>,
  'value' | 'onChange' | 'onBlur' | 'id'
>) {
  const field = useFieldContext<string>();
  const isSubmitting = useIsSubmitting();
  const error = field.state.meta.isTouched
    ? errorText(field.state.meta.errors)
    : null;

  return (
    <FieldShell
      label={label}
      hint={hint}
      htmlFor={field.name}
      error={error}
      className={fieldClassName}
    >
      <Textarea
        id={field.name}
        value={field.state.value ?? ''}
        onChange={e => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={!!error}
        disabled={props.disabled ?? isSubmitting}
        {...props}
      />
    </FieldShell>
  );
}

/** One option of a `SelectField`. `label` is what the closed trigger shows. */
export type SelectFieldOption = {
  value: string;
  label: string;
  /** Richer content for the open list — an icon beside the label, say. */
  node?: React.ReactNode;
  /** Offered but not choosable — already taken elsewhere, say. */
  disabled?: boolean;
};

function SelectField({
  label,
  hint,
  options,
  placeholder,
  fieldClassName,
  className,
  disabled,
  triggerContent
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  options: Array<SelectFieldOption>;
  placeholder?: string;
  fieldClassName?: string;
  className?: string;
  disabled?: boolean;
  /** Replaces the trigger's text, for a trigger that shows more than a label. */
  triggerContent?: React.ReactNode;
}) {
  const field = useFieldContext<string>();
  const isSubmitting = useIsSubmitting();
  const error = field.state.meta.isTouched
    ? errorText(field.state.meta.errors)
    : null;

  const chosen = options.some(o => o.value === field.state.value)
    ? field.state.value
    : undefined;

  return (
    <FieldShell
      label={label}
      hint={hint}
      htmlFor={field.name}
      error={error}
      className={fieldClassName}
    >
      {/* Wrapped: Radix puts a hidden native select beside the trigger, and
          the shell's vertical rhythm would otherwise count it as a second
          control and leave a gap under the field. */}
      <div>
        <Select
          // `undefined`, not `''`: Radix keeps the empty string for clearing a
          // select back to its placeholder, so it cannot also stand for a
          // value. A value that no longer names an option counts as unset
          // too — otherwise the trigger renders blank with no hint that
          // anything was ever chosen.
          value={chosen}
          onValueChange={value => field.handleChange(value)}
          disabled={disabled ?? isSubmitting}
        >
          <SelectTrigger
            id={field.name}
            aria-invalid={!!error}
            className={cn('w-full', className)}
          >
            {triggerContent ?? <SelectValue placeholder={placeholder} />}
          </SelectTrigger>
          <SelectContent>
            {options.map(option => (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.node ?? option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </FieldShell>
  );
}

/** What a `ModelField` shows of a model, as the console's model list has
 *  it: its id and name, whether it answers, and its own mark or else its
 *  providers', in the order a call reaches them. */
type ModelFieldModel = {
  modelId: string;
  name: string;
  status: ModelStatus;
  image?: string | null;
  providers?: Array<{ provider: { image: string | null } | null }>;
};

/** Radix will not take an empty string as an item's value. */
const NO_MODEL = '__none__';

/** No model, as the console's selectors say none: a mark in the place a
 *  model's sits, and the word. */
const noModel = (
  <span className="flex items-center gap-2 text-muted-foreground">
    <CircleDashed className="size-4" />
    None
  </span>
);

/** A model's mark: its own, else that of the provider a call reaches first —
 *  as the chat's model menus show one. */
const modelImage = (model: ModelFieldModel) =>
  model.image || model.providers?.[0]?.provider?.image || null;

/**
 * A model, picked from every model there is. The ones that cannot answer are
 * offered too, named as the console names them (`ModelStatusName`): a model
 * is often chosen here before it is switched on, and a choice already
 * pointing at one that has stopped answering has to keep saying so. `models`
 * are the console's, as the page has read them; `groups` say which of them
 * the job can use, each named only beside another; `empty` offers None, for
 * no model at all, which is kept as null.
 */
function ModelField<TModel extends ModelFieldModel>({
  label,
  hint,
  models,
  groups,
  empty,
  disabled,
  className
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  models: TModel[];
  /** The models a job can use, under its name. */
  groups: Array<{ label: string; can: (model: TModel) => boolean }>;
  empty?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const field = useFieldContext<string | null>();
  const isSubmitting = useIsSubmitting();
  const error = field.state.meta.isTouched
    ? errorText(field.state.meta.errors)
    : null;

  const listed = groups
    .map(group => ({ label: group.label, models: models.filter(group.can) }))
    .filter(group => group.models.length > 0);
  const none = listed.length === 0;
  const selected = listed
    .flatMap(group => group.models)
    .find(model => model.modelId === field.state.value);
  // A value that names no model on the list reads as none chosen, as it does
  // in `SelectField`.
  const chosen = selected ? selected.modelId : empty ? NO_MODEL : undefined;

  return (
    <FieldShell
      label={label}
      hint={hint}
      htmlFor={field.name}
      error={error}
      className={className}
    >
      <div>
        <Select
          value={chosen}
          onValueChange={value =>
            field.handleChange(value === NO_MODEL ? null : value)
          }
          disabled={(disabled ?? isSubmitting) || none}
        >
          <SelectTrigger
            id={field.name}
            aria-invalid={!!error}
            className="w-full"
          >
            {/* The chosen model's mark and name, on one line: the list's
                second line, its id, would not fit the trigger. */}
            <SelectValue
              placeholder={none ? 'No available models' : 'Select model'}
            >
              {chosen === NO_MODEL && noModel}
              {selected && (
                <span className="flex items-center gap-2">
                  <ModelIcon image={modelImage(selected)} className="size-4" />
                  <ModelStatusName status={selected.status}>
                    {selected.name}
                  </ModelStatusName>
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {empty && <SelectItem value={NO_MODEL}>{noModel}</SelectItem>}
            {listed.map(group => (
              <SelectGroup key={group.label}>
                {listed.length > 1 && <SelectLabel>{group.label}</SelectLabel>}
                {group.models.map(model => (
                  <SelectItem key={model.modelId} value={model.modelId}>
                    <span className="flex items-start gap-2">
                      {/* A slot of its own, so a model with no mark starts
                          its name where the others do. */}
                      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                        <ModelIcon
                          image={modelImage(model)}
                          className="size-4"
                        />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        {/* On one line, the mark beside the name: the list
                            is as wide as its widest name, not the id under
                            it. */}
                        <ModelStatusName
                          status={model.status}
                          className="whitespace-nowrap"
                        >
                          {model.name}
                        </ModelStatusName>
                        <span
                          className={cn(
                            'truncate text-xs text-muted-foreground',
                            model.status !== 'available' && 'line-through'
                          )}
                        >
                          {model.modelId}
                        </span>
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
    </FieldShell>
  );
}

/** A labelled on/off switch, laid out on one line. */
function SwitchField({
  label,
  className,
  disabled
}: {
  label: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const field = useFieldContext<boolean>();
  const isSubmitting = useIsSubmitting();

  return (
    <div className={cn('flex items-center space-x-2', className)}>
      <Switch
        id={field.name}
        checked={field.state.value}
        onCheckedChange={checked => field.handleChange(checked)}
        disabled={disabled ?? isSubmitting}
      />
      <Label htmlFor={field.name}>{label}</Label>
    </div>
  );
}

/**
 * The submit button. Disabled until the form is valid and while it is saving,
 * so a form never needs to thread a mutation's `isPending` down to it.
 */
function SubmitButton({
  children,
  disabled,
  ...props
}: React.ComponentProps<typeof Button>) {
  const form = useFormContext();
  // Selected one at a time: the store compares by identity, so a selector
  // returning a fresh array would re-render this on every keystroke.
  const canSubmit = useStore(form.store, state => state.canSubmit);
  const isSubmitting = useStore(form.store, state => state.isSubmitting);

  return (
    <Button
      type="submit"
      // A reason of the caller's own — the form is still being filled, say —
      // adds to the form's, and neither overrides the other.
      disabled={disabled || !canSubmit || isSubmitting}
      className="gap-2"
      {...props}
    >
      {isSubmitting && <Loader2 className="size-4 animate-spin" />}
      {children}
    </Button>
  );
}

/**
 * A form bound to `useAppForm` re-applies its options on every render, and
 * that includes putting `defaultValues` back over the current values whenever
 * the two differ and nothing has been typed yet. So `form.reset(record)` alone
 * does not survive: the state change that opens a dialog is itself the next
 * render, and the record is gone before it is seen.
 *
 * Where a form is opened on a record, hold those values in state and pass them
 * as `defaultValues` as well as resetting to them. The option and the values
 * are then the same object, and there is nothing left to put back.
 */
export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    TextareaField,
    SelectField,
    ModelField,
    SwitchField
  },
  formComponents: { SubmitButton }
});
