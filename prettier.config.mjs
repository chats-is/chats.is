/** @type {import("@ianvs/prettier-plugin-sort-imports").PrettierConfig} */
const config = {
  endOfLine: 'lf',
  semi: true,
  useTabs: false,
  singleQuote: true,
  arrowParens: 'avoid',
  tabWidth: 2,
  trailingComma: 'none',
  tailwindStylesheet: './src/styles.css',
  plugins: [
    '@ianvs/prettier-plugin-sort-imports',
    'prettier-plugin-tailwindcss'
  ],
  importOrder: [
    '^(react/(.*)$)|^(react$)',
    // The router and its server runtime sit where next/* used to: the
    // framework's own imports, ahead of everything from npm.
    '^(@tanstack/react-router(.*)$)|^(@tanstack/react-start(.*)$)',
    '<THIRD_PARTY_MODULES>',
    '',
    '^@/types',
    '^@/lib/(.*)$',
    '^@/hooks/(.*)$',
    '^@/server/(.*)$',
    '^@/components/ui/(.*)$',
    '^@/components/(.*)$',
    '^@/styles/(.*)$',
    '',
    '^[./]'
  ],
  importOrderParserPlugins: ['typescript', 'jsx', 'decorators-legacy']
};

export default config;
