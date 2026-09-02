import { createMiddleware, createStart } from '@tanstack/react-start';

import { withRequestScope } from '@/lib/request-cache';

/**
 * One scope per request, so the settings a request consults are read once and
 * then shared by everything below — the system prompt, the title model, the
 * default quota.
 */
const requestScope = createMiddleware({ type: 'request' }).server(({ next }) =>
  withRequestScope(() => next())
);

export const startInstance = createStart(() => ({
  requestMiddleware: [requestScope]
}));
