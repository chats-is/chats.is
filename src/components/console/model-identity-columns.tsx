import { type ModelCapability } from '@/types';
import { Badge } from '@/components/ui/badge';
import { type createAppColumnHelper } from '@/components/console/data-table';
import { ProviderBindings } from '@/components/console/provider-bindings';
import { ModelIcon } from '@/components/model-icon';

/** What a row has to carry to be named the way a model is named. */
type ModelLike = {
  image?: string | null;
  name: string;
  modelId: string;
  aliases?: string[] | null;
  capability: ModelCapability;
  providers?: Array<{
    id: string;
    isEnabled: boolean;
    providerModelId?: string | null;
    provider?: { name: string } | null;
  }> | null;
};

/**
 * The columns that say which model a row is: its icon; its name and what it
 * is for, over every id it answers to; and who serves it.
 *
 * The models and the pricing tables both open on these, and a model should
 * read the same in both — so they are defined here once, each at a fixed
 * width, and neither table can let its other columns push these about.
 */
export function modelIdentityColumns<T extends ModelLike>(
  helper: ReturnType<typeof createAppColumnHelper<T>>
) {
  return [
    helper.display({
      id: 'icon',
      header: 'Icon',
      meta: { headClassName: 'w-16' },
      cell: ({ row }) =>
        row.original.image ? (
          <ModelIcon image={row.original.image} className="size-8" />
        ) : (
          <div className="size-8 rounded border bg-muted" />
        )
    }),
    helper.display({
      id: 'name',
      header: 'Model',
      meta: { headClassName: 'w-80' },
      cell: ({ row }) => (
        <>
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.name}</span>
            <Badge variant="secondary">{row.original.capability}</Badge>
          </div>
          <div className="font-mono text-xs break-all text-muted-foreground">
            {[row.original.modelId, ...(row.original.aliases ?? [])].join(', ')}
          </div>
        </>
      )
    }),
    helper.display({
      id: 'provider',
      header: 'Providers',
      meta: { headClassName: 'w-60', cellClassName: 'text-sm' },
      cell: ({ row }) => (
        <ProviderBindings bindings={row.original.providers ?? []} />
      )
    })
  ];
}
