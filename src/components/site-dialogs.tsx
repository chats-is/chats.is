import { createContext, useCallback, useContext, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { authQueries } from '@/server/functions/auth';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { LoginForm } from '@/components/login-form';

const OpenLogin = createContext<(() => void) | null>(null);

/**
 * Signing in over the site's pages, rather than on a page of its own. It
 * lands where the sign-in page does without a place to return to: the app.
 */
export function LoginDialogProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const openLogin = useCallback(() => setOpen(true), []);
  const { data: methods } = useQuery({
    ...authQueries.signInMethods(),
    enabled: open
  });

  return (
    <OpenLogin.Provider value={openLogin}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-[20px] p-8 sm:max-w-[420px]">
          {/* The form names itself on screen; this names the dialog to a
              screen reader. */}
          <DialogTitle className="sr-only">Sign in</DialogTitle>
          {methods ? (
            <LoginForm {...methods} redirectTo="/" />
          ) : (
            <div className="space-y-4">
              <Skeleton className="mx-auto h-7 w-56" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </OpenLogin.Provider>
  );
}

/** How a page of the site opens the sign-in dialog. */
export function useOpenLogin() {
  const openLogin = useContext(OpenLogin);
  if (!openLogin) {
    throw new Error('useOpenLogin is used outside LoginDialogProvider');
  }
  return openLogin;
}
