// The plugin ships no types of its own: it adds GitHub-flavoured Markdown —
// tables, strikethrough, task lists — to a Turndown service.
declare module '@joplin/turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  export const gfm: TurndownService.Plugin;
}
