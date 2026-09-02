import * as React from 'react'
import { useParams, useRouter } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { useChats } from '@/hooks/use-chats'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface ClearHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ClearHistoryDialog({
  open,
  onOpenChange,
}: ClearHistoryDialogProps) {
  const { clearChats } = useChats()
  const router = useRouter()
  const params = useParams({ strict: false })
  const [isPending, startTransition] = React.useTransition()

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete your chat history and remove your data
            from our servers.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={(e) => {
              e.preventDefault()
              startTransition(async () => {
                try {
                  await clearChats()
                  toast.success('All chat deleted', { duration: 2000 })
                  if (params.chatId) {
                    router.navigate({ to: '/' })
                  }
                  onOpenChange(false)
                } catch (err: any) {
                  toast.error(err.message)
                }
              })
            }}
          >
            {isPending ? (
              <>
                <Loader2 className="animate-spin" />
                Deleting...
              </>
            ) : (
              <>Delete</>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
