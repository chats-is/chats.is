import { Fragment, type ReactNode } from 'react';

import { type ModelCapability } from '@/types';
import { CAPABILITIES, MEDIA_KIND_LABELS } from '@/lib/constant';
import { fitsMediaKind, promptMediaKinds } from '@/lib/prompt';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** What a prompt presets, as the form holds it. */
export type PromptPreset = {
  type: ModelCapability;
  needsReference: boolean;
  modelId: string | null;
};

/** What each type makes. */
const TYPE_HINTS: Record<ModelCapability, string> = {
  chat: 'A chat reply.',
  image: 'Makes or edits an image.',
  video: 'Makes a video, from an image, or edits one.',
  audio: 'Speaks text aloud, or transcribes audio.'
};

/** What a reference is for each type, as it is asked for. */
const REFERENCE_HINTS: Record<ModelCapability, string> = {
  chat: 'A file must be added before trying it.',
  image: 'A reference image must be added before trying it.',
  video: 'A reference image or video must be added before trying it.',
  audio: 'A reference audio file must be added before trying it.'
};

/**
 * What a prompt presets: what it is for, whether it needs a reference, and
 * the model it is tried on by default — one of those its type and reference
 * call for, or none. Nothing else is preset; the rest is chosen when it is
 * tried. Each side brings its own models and its own control for picking
 * one: `models` are those it may preset — every model in the console, the
 * ones on offer to them in a user's library — and `renderModel` draws the
 * control over the groups they fall into.
 */
export function PromptPresetFields<
  TModel extends Parameters<typeof fitsMediaKind>[1] & { modelId: string }
>({
  models,
  renderModel,
  value,
  onChange,
  disabled
}: {
  models: TModel[];
  renderModel: (
    groups: Array<{ label: string; can: (model: TModel) => boolean }>
  ) => ReactNode;
  value: PromptPreset;
  onChange: (next: PromptPreset) => void;
  disabled?: boolean;
}) {
  // A chat prompt's models are the chat's; a media prompt's, those of the
  // entries of the media generation settings its type and reference call for.
  const groups = (type: ModelCapability, needsReference: boolean) =>
    (type === 'chat'
      ? [
          {
            label: 'Chat',
            can: (model: TModel) => model.capability === 'chat'
          }
        ]
      : promptMediaKinds(type, needsReference).map(kind => ({
          label: MEDIA_KIND_LABELS[kind],
          can: (model: TModel) => fitsMediaKind(kind, model)
        }))
    ).filter(group => models.some(group.can));
  // A reference only where some model works from one; a chat model always
  // takes a file.
  const referenceOffered = (type: ModelCapability) =>
    type === 'chat' || groups(type, true).length > 0;

  // A preset the new type or reference does not call for goes.
  const change = (type: ModelCapability, needsReference: boolean) => {
    const kept = groups(type, needsReference).some(group =>
      models.some(model => model.modelId === value.modelId && group.can(model))
    );
    onChange({ type, needsReference, modelId: kept ? value.modelId : null });
  };
  const modelGroups = groups(value.type, value.needsReference);

  return (
    <div className="space-y-3.5">
      <div className="space-y-2">
        <Label>Type</Label>
        <div
          role="radiogroup"
          aria-label="Type"
          className="flex flex-wrap gap-1.5"
        >
          {CAPABILITIES.map(({ value: type, label }) => {
            const on = value.type === type;
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                onClick={() =>
                  change(type, value.needsReference && referenceOffered(type))
                }
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50',
                  on
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {TYPE_HINTS[value.type]}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Switch
            id="prompt-reference"
            checked={value.needsReference}
            onCheckedChange={on => change(value.type, on)}
            disabled={disabled || !referenceOffered(value.type)}
          />
          <Label htmlFor="prompt-reference">Reference</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          {value.needsReference
            ? REFERENCE_HINTS[value.type]
            : 'Can be tried straight away.'}
        </p>
      </div>

      {modelGroups.length > 0 && (
        <div className="space-y-2">
          <Label>Model</Label>
          {/* Its items change with the type and the reference; mounted
              afresh, so the trigger shows the model chosen with them, not a
              blank left from the list it was last opened on. */}
          <Fragment key={`${value.type}-${value.needsReference}`}>
            {renderModel(modelGroups)}
          </Fragment>
          <p className="text-xs text-muted-foreground">
            Optional. Another model can be picked when trying it.
          </p>
        </div>
      )}
    </div>
  );
}
