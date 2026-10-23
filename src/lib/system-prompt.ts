/**
 * The part of the system prompt this app writes itself.
 *
 * It carries the facts only the running request knows — which model answered,
 * who serves it, what day it is where the user is — and the conventions that
 * come from this app's own renderer rather than from anyone's preference:
 * Markdown as GitHub writes it, mathematics through KaTeX.
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
  /** Today's date, not the time: the prompt is then the same all day, and a
   *  provider reads it from its cache; the time is the `get_current_time`
   *  tool's to tell. */
  date: string;
  language?: string | null;
}): string {
  const provider = facts.provider?.trim();
  const language = facts.language?.trim();

  return [
    `You are a helpful assistant powered by ${facts.modelId}, a large language model${provider ? ` served by ${provider}` : ''}.`,
    `Current date: ${facts.date}`,
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
