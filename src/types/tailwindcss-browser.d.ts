// `@tailwindcss/browser` ships a side-effect-only browser bundle without type
// declarations. We import it for its side effect (it scans the document and
// injects Tailwind utilities), so an empty module declaration is enough.
declare module '@tailwindcss/browser';
