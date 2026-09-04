import {
  createFormHook,
  createFormHookContexts,
  useStore
} from '@tanstack/react-form';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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

  // Base UI's trigger renders the value, not the selected item's content, so
  // it needs the value-to-label mapping handed to it.
  const items = Object.fromEntries(options.map(o => [o.value, o.label]));
  const chosen = options.some(o => o.value === field.state.value)
    ? field.state.value
    : null;

  return (
    <FieldShell
      label={label}
      hint={hint}
      htmlFor={field.name}
      error={error}
      className={fieldClassName}
    >
      <Select
        items={items}
        // `null`, not `''`: an unset select is one with nothing chosen, not
        // one holding an empty value of its own. A value that no longer names
        // an option counts as unset too — otherwise the trigger renders blank
        // with no hint that anything was ever chosen.
        value={chosen}
        onValueChange={value => {
          if (value !== null) field.handleChange(value);
        }}
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
      disabled={!canSubmit || isSubmitting}
      className="gap-2"
      {...props}
    >
      {isSubmitting && <Loader2 className="size-4 animate-spin" />}
      {children}
    </Button>
  );
}

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, TextareaField, SelectField, SwitchField },
  formComponents: { SubmitButton }
});
