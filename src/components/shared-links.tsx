import { useState } from 'react';
import { format } from 'date-fns';
import { Link, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { useSharedLinks } from '@/hooks/use-shared-links';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const LIMIT = 5;

/** Stands in for the table and pager below, in their own shape, while it
 *  loads — including the pager, so the real one arriving doesn't shift the
 *  page underneath it. */
function SharedLinksSkeleton() {
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full min-w-[640px] table-fixed">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-3 text-left text-sm font-medium">Name</th>
              <th className="w-60 p-3 text-left text-sm font-medium">
                Date shared
              </th>
              <th className="w-14 p-3 text-right" />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: LIMIT }).map((_, i) => (
              <tr key={i} className="border-b last:border-b-0">
                <td className="p-3">
                  <Skeleton className="h-4 w-40" />
                </td>
                <td className="p-3">
                  <Skeleton className="h-4 w-24" />
                </td>
                <td className="p-3 text-right">
                  <Skeleton className="ml-auto size-7 rounded-md" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between">
        <Skeleton className="h-9 w-20 rounded-full" />
        <Skeleton className="h-9 w-16 rounded-full" />
      </div>
    </div>
  );
}

export function SharedLinks() {
  const [page, setPage] = useState(0);
  const [isDeleting, setIsDeleting] = useState<Set<string>>(new Set());
  const { sharedLinks, isLoading, deleteSharedLink } = useSharedLinks(
    page,
    LIMIT
  );

  const handlePrevious = () => {
    if (page > 0) {
      setPage(prev => prev - 1);
    }
  };

  const handleNext = () => {
    if (sharedLinks && sharedLinks.length === LIMIT) {
      setPage(prev => prev + 1);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setIsDeleting(prev => new Set(prev).add(id));
      await deleteSharedLink(id);
      toast.success('Shared link deleted', { duration: 2000 });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsDeleting(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  // A page worth showing Previous for (we're not on the first one) or Next
  // for (this page is full, so there may be another) — omitted entirely
  // rather than shown disabled, so an empty page doesn't sit under a
  // pointless row of buttons neither can ever use.
  const showPrevious = page > 0;
  const showNext = sharedLinks?.length === LIMIT;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Shared Links</h1>
        <p className="text-sm text-muted-foreground">
          Conversations you've shared — anyone with the link can open them.
        </p>
      </div>

      {isLoading ? (
        <SharedLinksSkeleton />
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[640px] table-fixed">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left text-sm font-medium">Name</th>
                  <th className="w-60 p-3 text-left text-sm font-medium">
                    Date shared
                  </th>
                  <th className="w-14 p-3 text-right" />
                </tr>
              </thead>
              <tbody>
                {sharedLinks?.length ? (
                  sharedLinks.map(sharedLink => (
                    <tr key={sharedLink.id} className="border-b">
                      <td className="p-3">
                        <a
                          href={`/share/${sharedLink.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-w-0 items-center text-blue-500 hover:underline"
                        >
                          <Link className="mr-1 size-4 shrink-0" />
                          <span className="truncate">
                            {sharedLink.chat?.title}
                          </span>
                        </a>
                      </td>
                      <td className="p-3">
                        {format(sharedLink.createdAt, 'MMMM d, yyyy')}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => handleDelete(sharedLink.id)}
                          disabled={isDeleting.has(sharedLink.id)}
                          title="Delete"
                        >
                          {isDeleting.has(sharedLink.id) ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={3}
                      className="p-6 text-center text-muted-foreground"
                    >
                      No shared links found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {(showPrevious || showNext) && (
            <div
              className={cn(
                'flex',
                showPrevious && showNext
                  ? 'justify-between'
                  : showNext
                    ? 'justify-end'
                    : 'justify-start'
              )}
            >
              {showPrevious && (
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={handlePrevious}
                  disabled={isDeleting.size > 0}
                >
                  Previous
                </Button>
              )}
              {showNext && (
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={handleNext}
                  disabled={isDeleting.size > 0}
                >
                  Next
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
