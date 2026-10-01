import { Link } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';

/** The user a row belongs to: their name, as a link to them. A user since
 *  deleted is the email the row kept. */
export function UserCell({
  user,
  email
}: {
  user: { id: string; name: string; email: string } | null;
  email?: string;
}) {
  if (!user) {
    return (
      <span className="block truncate" title={email || undefined}>
        {email || 'Deleted user'}
      </span>
    );
  }
  return (
    <Link
      to="/console/users/$userId"
      params={{ userId: user.id }}
      title={user.email}
      className="group inline-flex max-w-full items-center gap-1 font-medium hover:text-primary"
    >
      <span className="truncate underline-offset-4 group-hover:underline">
        {user.name || user.email}
      </span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
    </Link>
  );
}
