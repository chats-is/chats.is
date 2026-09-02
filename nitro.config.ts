import { defineConfig } from 'nitro/config';

export default defineConfig({
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
