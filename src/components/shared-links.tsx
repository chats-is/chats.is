import { useState } from 'react'
import { format } from 'date-fns'
import { Link, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { useSharedLinks } from '@/hooks/use-shared-links'
import { Button } from '@/components/ui/button'

const LIMIT = 5

export function SharedLinks() {
  const [page, setPage] = useState(0)
  const [isDeleting, setIsDeleting] = useState<Set<string>>(new Set())
  const { sharedLinks, isLoading, deleteSharedLink } = useSharedLinks(
    page,
    LIMIT,
  )

  const handlePrevious = () => {
    if (page > 0) {
      setPage((prev) => prev - 1)
    }
  }

  const handleNext = () => {
    if (sharedLinks && sharedLinks.length === LIMIT) {
      setPage((prev) => prev + 1)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      setIsDeleting((prev) => new Set(prev).add(id))
      await deleteSharedLink(id)
      toast.success('Shared link deleted', { duration: 2000 })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setIsDeleting((prev) => {
        const newSet = new Set(prev)
        newSet.delete(id)
        return newSet
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {sharedLinks?.length ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[640px] table-auto">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left text-sm font-medium">Name</th>
                <th className="w-60 p-3 text-left text-sm font-medium">
                  Date shared
                </th>
                <th className="w-12 p-3 text-right" />
              </tr>
            </thead>
            <tbody>
              {sharedLinks.map((sharedLink) => (
                <tr key={sharedLink.id} className="border-b">
                  <td className="p-3">
                    <a
                      href={`/share/${sharedLink.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center text-blue-500 hover:underline"
                    >
                      <Link className="mr-1 size-4" />
                      <span className="truncate">{sharedLink.chat?.title}</span>
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
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-4 text-center text-muted-foreground">
          No shared links found
        </div>
      )}

      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={handlePrevious}
          disabled={page === 0 || isDeleting.size > 0}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          onClick={handleNext}
          disabled={
            (sharedLinks && sharedLinks.length < LIMIT) || isDeleting.size > 0
          }
        >
          Next
        </Button>
      </div>
    </div>
  )
}
