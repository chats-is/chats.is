import { defineConfig } from 'nitro/config';

export default defineConfig({
  // The artifact preview compiles TSX on the server, so it loads the
  // TypeScript compiler. That package is CommonJS and reaches for __filename,
  // which does not exist once it has been bundled into an ES module — so it is
  // left as a dependency and required at runtime instead.
  traceDeps: ['typescript'],
  vercel: {
    functions: {
      // A chat generation streams for as long as the model takes, and the
      // platform's default cuts it off well before that. This was stated per
      // route before; here it belongs to the function the whole app is served
      // by, so the longest thing it does sets the bound.
      maxDuration: 300
    }
  }
});
