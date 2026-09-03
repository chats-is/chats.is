//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config';

// The shared config registers the import plugin; borrow it rather than
// depending on the plugin directly, so the two cannot drift apart.
const importPlugin = tanstackConfig.find(block => block.plugins?.import)
  ?.plugins?.import;

export default [
  ...tanstackConfig,
  {
    // The import rules below are turned back on with options, which needs the
    // plugin named in the same block that names them.
    plugins: { import: importPlugin },
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
      // Defensive optional chaining and null checks that the type system says
      // are unreachable. They were written when the types were looser, and the
      // rule's judgement is not reliable for index access — an array element
      // reads as present whether or not it is there. Left as written.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // These two disagreed by default: one wanted type imports lifted to a
      // top-level `import type`, the other wanted every import from a module
      // merged into one statement. Fixing both at once produced an
      // `import type` with values inside it, which does not compile. Pointed
      // the same way, they agree and --fix is safe.
      'import/no-duplicates': ['error', { 'prefer-inline': true }],
      'import/consistent-type-specifier-style': ['error', 'prefer-inline']
    }
  },
  {
    // vitest's importOriginal is typed by an inline import(), which is how the
    // framework documents it — there is no named import to reach for.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' }
  },
  {
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      '.output/**',
      '.nitro/**',
      // Installed by the shadcn CLI and left exactly as installed — --fix must
      // not reformat what is not ours to change.
      'src/components/ui/**',
      'src/routeTree.gen.ts'
    ]
  }
];
