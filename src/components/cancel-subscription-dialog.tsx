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
 * The confirmation before a subscription is canceled, for the user and for
 * an admin: it does not renew, the plan stays until what was paid for runs
 * out, and the subscription ends then. The user can resubscribe until then;
 * what an admin cancels, the user cannot. One whose renewal is unpaid has
 * nothing paid for left, and is ended instead.
 */
export function CancelSubscriptionDialog({
  open,
  onOpenChange,
  planName,
  periodEnd,
  byAdmin = false,
  ends = false,
  onConfirm
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planName: string;
  periodEnd: Date | string;
  /** Canceled by an admin, which the user cannot undo. */
  byAdmin?: boolean;
  /** Ended instead: what was paid for has run out, its renewal unpaid. */
  ends?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
          <AlertDialogDescription>
            {ends ? (
              `${planName} ends, and is not charged again.`
            ) : (
              <>
                {planName} stays active until{' '}
                <LocalTime value={periodEnd} precision="day" />, then the
                subscription ends. It does not renew and is not charged again
                {byAdmin
                  ? ', and the user cannot resubscribe it.'
                  : ', and can be resubscribed until then.'}
              </>
            )}
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
