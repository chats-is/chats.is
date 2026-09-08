/**
 * The part of the system prompt this app writes itself.
 *
 * It carries the facts only the running request knows — which model answered,
 * who serves it, when and where the user is — and the conventions that come
 * from this app's own renderer rather than from anyone's preference: Markdown
 * through `remark-gfm`, mathematics through KaTeX.
 *
 * Placeholders are filled only here. What an admin writes in the console, and
 * what a model carries of its own, is appended verbatim — a `{modelId}` typed
 * into either is a literal brace, because those are prose written by people,
 * not templates, and a half-substituted prompt is worse than a plain one.
 */
export const BASE_SYSTEM_PROMPT = `You are a helpful assistant powered by {modelId}, a large language model served by {provider}.
Current time: {datetime}
User language: {language}

Answer in the language the user writes in.
Format with Markdown: headings, lists, tables, and fenced code blocks with a language tag.
Write inline mathematics as \\(x^2\\) and display mathematics as $$e=mc^2$$.
Be direct. Skip preamble and restatement of the question.
When you are unsure or lack the information, say so instead of guessing.`;
