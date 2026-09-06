import { Link } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';

/** What an address that matches no route shows. */
export function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-background p-6 text-center">
      <h1 className="text-6xl font-bold text-foreground">404</h1>
      <h2 className="text-3xl text-foreground">Not Found</h2>
      <p className="text-muted-foreground">
        Sorry, the page you are looking for does not exist.
      </p>
      <Button variant="ghost" className="mt-4" asChild>
        <Link to="/">Return home</Link>
      </Button>
    </div>
  );
}
