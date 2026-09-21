/**
 * How a server function says the session is gone.
 *
 * It refuses with a bare 401, and the browser's side of the call turns a bare
 * refusal into an `Error` carrying the body — so the body is the only thing
 * that crosses, and it is named here for both ends to agree on.
 */
export const UNAUTHORIZED = 'Unauthorized';

export const isUnauthorized = (error: unknown) =>
  error instanceof Error && error.message === UNAUTHORIZED;
