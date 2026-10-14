import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import { devtools } from '@tanstack/devtools-vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig, type Plugin } from 'vite';

/**
 * The dev server's counterpart to the `/assets/**` rule in the Nitro config.
 *
 * The artifact preview frame is a page of this app, sandboxed to an opaque
 * origin — which the browser names `null` — and its scripts are modules, which
 * are not run without leave from where they came. In the build that leave is
 * given by a route rule; in development the scripts are served by Vite itself,
 * whose own list of allowed origins is switched off by the Nitro plugin, so it
 * is given here. Nothing the dev server hands out is a secret.
 *
 * To every read, not only the frame's. The page around the frame loads the
 * same modules first, with no Origin, and the browser keeps that copy and
 * hands it to the frame — which, finding no leave on it, runs nothing and
 * says nothing, and the preview never starts. The build's rule is on every
 * asset for the same reason.
 */
const sandboxMayLoadModules = (): Plugin => ({
  name: 'sandbox-may-load-modules',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        res.setHeader('access-control-allow-origin', '*');
      }
      next();
    });
  }
});

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    sandboxMayLoadModules(),
    devtools(),
    nitro(),
    tailwindcss(),
    tanstackStart(),
    viteReact()
  ]
});

export default config;
