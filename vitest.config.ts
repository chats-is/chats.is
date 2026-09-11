import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Resolve the project's `@/*` path alias from tsconfig.json (native in Vite 7+).
    tsconfigPaths: true
  },
  test: {
    // Node environment — these are server/logic unit tests, no DOM needed.
    environment: 'node',
    globals: true,
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.output', 'dist'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/server/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts']
    }
  }
});
