/**
 * The part of the system prompt this app writes itself.
 *
 * It carries the facts only the running request knows — which model answered,
 * who serves it, when and where the user is — and the conventions that come
 * from this app's own renderer rather than from anyone's preference: Markdown
 * through `remark-gfm`, mathematics through KaTeX.
 *
 * Built here, not filled from a template: a fact that is not known is left
 * out rather than left blank — "served by ." is worse than saying nothing of
 * who serves the model. What an admin writes in the console, and what a
 * model carries of its own, is appended verbatim afterwards; those are prose
 * written by people, not templates.
 */
export function buildBaseSystemPrompt(facts: {
  modelId: string;
  provider?: string | null;
  datetime: string;
  language?: string | null;
}): string {
  const provider = facts.provider?.trim();
  const language = facts.language?.trim();

  return [
    `You are a helpful assistant powered by ${facts.modelId}, a large language model${provider ? ` served by ${provider}` : ''}.`,
    `Current time: ${facts.datetime}`,
    language ? `User language: ${language}` : null,
    '',
    'Answer in the language the user writes in.',
    'Format with Markdown: headings, lists, tables, and fenced code blocks with a language tag.',
    'Write inline mathematics as \\(x^2\\) and display mathematics as $$e=mc^2$$.',
    'Be direct. Skip preamble and restatement of the question.',
    'When you are unsure or lack the information, say so instead of guessing.'
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
