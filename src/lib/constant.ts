import { type MediaToolName } from '@/types/chat-tools';
import { type ModelCapability } from '@/types/model';

/**
 * Provider types for the console
 */
export const ProviderTypes = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'google', label: 'Google AI' },
  { value: 'vertex', label: 'Google Vertex AI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'bedrock', label: 'AWS Bedrock' },
  { value: 'xai', label: 'xAI' },
  { value: 'deepseek', label: 'DeepSeek' }
] as const;

/**
 * Model and prompt capabilities
 */
export const CAPABILITIES = [
  { value: 'chat', label: 'Chat' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' }
] satisfies Array<{ value: ModelCapability; label: string }>;

/**
 * Image size labels mapping
 */
export const ImageSizeLabels: Record<string, string> = {
  auto: 'Auto',
  '256x256': 'Small Square (256x256)',
  '512x512': 'Medium Square (512x512)',
  '1024x1024': 'Large Square (1024x1024)',
  '512': '512px',
  '1K': '1K',
  '2K': '2K',
  '4K': '4K',
  '1536x1024': 'Landscape (1536x1024)',
  '1024x1536': 'Portrait (1024x1536)',
  '1792x1024': 'Landscape (1792x1024)',
  '1024x1792': 'Portrait (1024x1792)'
};

/**
 * Aspect ratio labels mapping
 */
export const AspectRatioLabels: Record<string, string> = {
  auto: 'Auto',
  '1:1': 'Square (1:1)',
  '1:4': 'Ultra Portrait (1:4)',
  '1:8': 'Ultra Portrait (1:8)',
  '2:3': 'Portrait (2:3)',
  '3:2': 'Landscape (3:2)',
  '3:4': 'Portrait (3:4)',
  '4:1': 'Ultra Landscape (4:1)',
  '4:3': 'Landscape (4:3)',
  '4:5': 'Portrait (4:5)',
  '5:4': 'Landscape (5:4)',
  '8:1': 'Ultra Landscape (8:1)',
  '9:16': 'Portrait (9:16)',
  '16:9': 'Landscape (16:9)',
  '21:9': 'Ultrawide (21:9)'
};

/**
 * Video resolution labels mapping
 */
export const VideoResolutionLabels: Record<string, string> = {
  auto: 'Auto',
  '480p': '480p (SD)',
  '720p': '720p (HD)',
  '1080p': '1080p (Full HD)',
  '4k': '4K (Ultra HD)'
};

/**
 * Vertex AI model ID mapping (Anthropic model ID -> Vertex AI model ID)
 */
export const VertexAIModels: Record<string, string> = {
  'claude-sonnet-4-5': 'claude-sonnet-4-5@20250929',
  'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5@20250929',
  'claude-opus-4-5': 'claude-opus-4-5@20251101',
  'claude-opus-4-5-20251101': 'claude-opus-4-5@20251101',
  'claude-haiku-4-5': 'claude-haiku-4-5@20251001',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5@20251001',
  'claude-opus-4-1': 'claude-opus-4-1@20250805',
  'claude-opus-4-1-20250805': 'claude-opus-4-1@20250805',
  'claude-sonnet-4-0': 'claude-sonnet-4@20250514',
  'claude-sonnet-4-20250514': 'claude-sonnet-4@20250514',
  'claude-opus-4-0': 'claude-opus-4@20250514',
  'claude-opus-4-20250514': 'claude-opus-4@20250514'
};

/**
 * AWS Bedrock model ID mapping (Anthropic model ID -> Bedrock model ID)
 */
export const BedrockModels: Record<string, string> = {
  'claude-opus-4-6': 'anthropic.claude-opus-4-6-v1',
  'claude-sonnet-4-6': 'anthropic.claude-sonnet-4-6',
  'claude-sonnet-4-5': 'anthropic.claude-sonnet-4-5-20250929-v1:0',
  'claude-sonnet-4-5-20250929': 'anthropic.claude-sonnet-4-5-20250929-v1:0',
  'claude-opus-4-5': 'anthropic.claude-opus-4-5-20251101-v1:0',
  'claude-opus-4-5-20251101': 'anthropic.claude-opus-4-5-20251101-v1:0',
  'claude-haiku-4-5': 'anthropic.claude-haiku-4-5-20251001-v1:0',
  'claude-haiku-4-5-20251001': 'anthropic.claude-haiku-4-5-20251001-v1:0',
  'claude-opus-4-1': 'anthropic.claude-opus-4-1-20250805-v1:0',
  'claude-opus-4-1-20250805': 'anthropic.claude-opus-4-1-20250805-v1:0',
  'claude-sonnet-4-0': 'anthropic.claude-sonnet-4-20250514-v1:0',
  'claude-sonnet-4-20250514': 'anthropic.claude-sonnet-4-20250514-v1:0',
  'claude-opus-4-0': 'anthropic.claude-opus-4-20250514-v1:0',
  'claude-opus-4-20250514': 'anthropic.claude-opus-4-20250514-v1:0'
};

/** Media tool names plus transcription (separate output shape, same prompt). */
export type ChatMediaToolName =
  MediaToolName | 'transcribe_audio' | 'edit_video';

const MediaToolDescriptions: Record<ChatMediaToolName, string> = {
  generate_image:
    '- generate_image: create a new image from a text description. Use when the user asks for a picture, illustration, photo, logo, or any visual.',
  edit_image:
    "- edit_image: modify an existing image from this conversation (a user upload or a previously generated image). Pass that image's URL as `imageUrl` and describe the change in `prompt`.",
  generate_video:
    '- generate_video: create a short video from a text description, or animate an image from this conversation by passing its URL as `imageUrl`.',
  edit_video:
    "- edit_video: modify an existing video from this conversation (a user upload or a previously generated one) — use this whenever the user asks to change a video that already exists, never generate_video. Pass that video's URL as `videoUrl` and describe the change in `prompt`. Length, aspect ratio and resolution are inherited from the source.",
  text_to_speech:
    '- text_to_speech: convert text to spoken audio (e.g. "read this aloud", "say this"). Pass the exact final text to speak — write it out first if it needs composing.',
  transcribe_audio:
    "- transcribe_audio: transcribe an audio file from this conversation to text (speech-to-text). Pass that audio's URL as `audioUrl`. Use when the user asks what an audio says or to transcribe/translate it."
};

export function buildMediaToolsSystemPrompt(
  tools: ChatMediaToolName[]
): string {
  if (tools.length === 0) return '';
  return [
    'You also have media generation tools:',
    ...tools.map(name => MediaToolDescriptions[name]),
    '',
    "When the user's wording implies a format, map it to one of the values listed in the tool description (e.g. portrait/竖版 → 9:16, square → 1:1, HD/高清 → a higher resolution, a stated length → the closest duration) and pass it; otherwise omit those fields and the defaults apply.",
    '',
    'The generated media renders automatically in the chat from the tool result — do NOT create an artifact for it, and do NOT print the raw URL or embed it in markdown. After the tool returns, add one short sentence describing the result. A transcript is not displayed, so write it out yourself — quote what was said, then answer whatever was asked about it. If the tool returns an error, nothing about it is shown to the user, so tell them yourself: one plain sentence saying what could not be done, and where there is an obvious next step (trying again, wording it differently, asking for a different kind of media) offer it. Say it in your own words — do not quote the error, name the model, or mention settings pages. Do not retry the tool on your own.'
  ].join('\n');
}

export const ArtifactSystemPrompt = [
  'Use the create_artifact tool for substantial, self-contained, reusable content: code files, runnable React UIs, full documents, data tables, or generated media. Do NOT use it for short snippets, brief explanations, or conversational replies — keep those inline in the chat.',
  '',
  'Always set a concise, descriptive `title` (2–6 words) — it labels the artifact in the canvas and the artifact switcher.',
  '',
  'Choose `type`:',
  '- code: source code. Set `language` (e.g. tsx, ts, python, sql).',
  '- markdown / html / text: rendered or plain documents.',
  '- json: structured data; an array of row objects (or arrays) renders as a table.',
  '- image / file: generated media — provide `fileUrl` and `mimeType` (plus `fileName`/`size` when known).',
  '',
  'For non-file types, always put the COMPLETE content in `content`. Never truncate or use placeholders like "// rest unchanged". Each create_artifact call produces a separate artifact; to revise something, create a new artifact with the full updated content.',
  '',
  'Live Preview is available for html, markdown, SVG (type code, language svg), and React/TS code. To make React/TS code previewable, follow this contract exactly:',
  '- Use type "code" with `language` one of react/tsx/jsx/typescript/javascript.',
  '- The entry/root file MUST `export default` the root React component — that default export is what Preview renders.',
  '- Every code artifact must set an exact relative `fileName`; name the entry file index.tsx.',
  '- Any file containing JSX must use a .tsx or .jsx fileName.',
  '- Keep it to ONE self-contained file: put every component/helper in this single artifact and do not import sibling files (other artifacts are not in scope).',
  '- Allowed package imports: react, react-dom, react-dom/client, lucide-react, framer-motion, recharts, clsx, class-variance-authority. No Next.js APIs, server code, env vars, remote assets, or any other npm package.',
  '- Styling: Tailwind utility classes work (a Tailwind v4 runtime is bundled into the preview), and inline styles or a <style> tag also work. CSS-file imports do NOT apply at runtime.',
  '',
  'HTML artifacts (type "html") must be a single self-contained document; inline <style>/<script> are fine. Preview runs sandboxed with no access to the host page.'
].join('\n');
