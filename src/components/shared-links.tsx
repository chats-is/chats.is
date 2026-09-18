import { useState } from 'react';
import { format } from 'date-fns';
import { Link, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { useSharedLinks } from '@/hooks/use-shared-links';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LocalTablePagination } from '@/components/table-pagination';

/** Shorter than the console's tables: this one sits in a dialog, where a long
 *  page would scroll rather than fit. Also the skeleton's row count. */
const PAGE_SIZE = 5;

/** The rows, while the first page is on its way. The table's head and frame
 *  are real from the start, so only the body stands in — and at a full page of
 *  rows, so nothing moves when the real ones arrive. */
function PendingRows() {
  return (
    <>
      {Array.from({ length: PAGE_SIZE }).map((_, i) => (
        <tr key={i} className="border-b last:border-b-0">
          <td className="p-3">
            <Skeleton className="h-4 w-full max-w-40" />
          </td>
          <td className="p-3">
            <Skeleton className="h-4 w-full max-w-24" />
          </td>
          <td className="p-3 text-right">
            <Skeleton className="ml-auto size-7 rounded-md" />
          </td>
        </tr>
      ))}
    </>
  );
}

export function SharedLinks() {
  const [page, setPage] = useState(1);
  const [isDeleting, setIsDeleting] = useState<Set<string>>(new Set());
  const { sharedLinks, total, isLoading, isPending, deleteSharedLink } =
    useSharedLinks(page, PAGE_SIZE);

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

  // Deleting the last link on the last page leaves the pager past the end, so
  // step back rather than sitting on a page that no longer exists.
  const handleDeleteAndSettle = async (id: string) => {
    await handleDelete(id);
    if (sharedLinks?.length === 1 && page > 1) setPage(page - 1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Shared Links</h1>
        <p className="text-sm text-muted-foreground">
          Conversations you've shared — anyone with the link can open them.
        </p>
      </div>

      <div className="space-y-4">
        <div
          className={cn(
            'overflow-x-auto rounded-2xl border transition-opacity',
            // The rows stay put while the next page is fetched, but go quiet
            // and stop taking clicks — nothing is deleted that is about to be
            // replaced.
            isPending && 'pointer-events-none opacity-60'
          )}
        >
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
              {isLoading ? (
                <PendingRows />
              ) : sharedLinks?.length ? (
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
                        onClick={() => handleDeleteAndSettle(sharedLink.id)}
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

        <LocalTablePagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
