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
import { LocalTime } from '@/components/local-time';

/**
 * The confirmation before a subscription is cancelled, for the user and for
 * an admin: the plan stays until what was paid for runs out, and the
 * subscription is canceled then. The user can resubscribe until then; what
 * an admin cancels, the user cannot.
 */
export function CancelSubscriptionDialog({
  open,
  onOpenChange,
  planName,
  expiresAt,
  byAdmin = false,
  onConfirm
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planName: string;
  expiresAt: Date | string;
  /** Cancelled by an admin, which the user cannot undo. */
  byAdmin?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
          <AlertDialogDescription>
            {planName} stays active until{' '}
            <LocalTime value={expiresAt} precision="day" />, then the
            subscription is canceled. It does not renew and is not charged again
            {byAdmin
              ? ', and the user cannot resubscribe it.'
              : ', and can be resubscribed until then.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep subscription</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Cancel subscription
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
