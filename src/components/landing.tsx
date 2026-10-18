import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  FileText,
  GitBranch,
  Globe,
  LibraryBig,
  Link2,
  Play,
  Plus,
  ShieldCheck,
  SquareSparkles,
  type LucideIcon
} from 'lucide-react';

import { useAppName } from '@/lib/head';
import { cn } from '@/lib/utils';
import { ModelIcon } from '@/components/model-icon';
import { useOpenPlans } from '@/components/plans-dialog';
import { useOpenLogin } from '@/components/site-dialogs';
import { usePlansOnSale } from '@/components/site-layout';

/** The one colour the front page adds to the theme's own. */
const ACCENT = 'text-blue-600 dark:text-blue-400';

/** What a visitor might ask first, shown under the composer's picture. */
const SUGGESTIONS = [
  'Write a cover letter',
  'Make an image of a lighthouse',
  'Build a to-do app',
  'Summarise this PDF'
];

/** The newest model of each maker the app reaches, as the page shows them
 *  off — a picture, so written here and brought up to date by hand. */
const MODELS = [
  { name: 'GPT-6.1 Sol', maker: 'OpenAI', icon: 'OpenAI' },
  { name: 'Claude Opus 5.5', maker: 'Anthropic', icon: 'Claude.Color' },
  { name: 'Gemini 4 Argon', maker: 'Google', icon: 'Gemini.Color' },
  { name: 'Grok 4.7', maker: 'xAI', icon: 'Grok' },
  { name: 'DeepSeek V4 Pro', maker: 'DeepSeek', icon: 'DeepSeek.Color' }
];

/**
 * Whether the page may move: not until it runs in a browser — the server
 * draws the still first frame — and never for a reader who asked their
 * system for less motion.
 */
function useMotion(): boolean {
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMotion(!query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return motion;
}

/** A count that goes up every `ms`, while `running`. */
function useTick(ms: number, running: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTick(n => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms, running]);
  return tick;
}

type Typing = {
  line: number;
  length: number;
  phase: 'type' | 'hold' | 'erase';
};

/**
 * Lines typed out one after another, as if someone were writing them: a
 * character at a time, a pause on the whole line, then gone quicker than it
 * came, and the next.
 */
function useTypewriter(lines: readonly string[], running: boolean) {
  const [typing, setTyping] = useState<Typing>({
    line: 0,
    length: 0,
    phase: 'type'
  });

  useEffect(() => {
    if (!running) return;
    const { line, length, phase } = typing;
    const full = lines[line].length;
    const [delay, next]: [number, Typing] =
      phase === 'type'
        ? length < full
          ? [45, { line, length: length + 1, phase }]
          : [1800, { line, length, phase: 'hold' }]
        : phase === 'hold'
          ? [0, { line, length, phase: 'erase' }]
          : length > 0
            ? [18, { line, length: length - 1, phase }]
            : [
                300,
                { line: (line + 1) % lines.length, length: 0, phase: 'type' }
              ];
    const timer = setTimeout(() => setTyping(next), delay);
    return () => clearTimeout(timer);
  }, [typing, running, lines]);

  return {
    text: lines[typing.line].slice(0, typing.length),
    line: typing.line,
    done: typing.phase === 'hold'
  };
}

/** Everything else the app does, a line each. */
const MORE: Array<{ icon: LucideIcon; title: string; description: string }> = [
  {
    icon: AudioLines,
    title: 'Voice',
    description: 'Hear any answer read aloud, and turn recordings into text.'
  },
  {
    icon: Globe,
    title: 'Web search',
    description:
      'Get answers drawn from current results on the web, with their sources.'
  },
  {
    icon: FileText,
    title: 'Files and documents',
    description:
      'Attach images, PDFs and documents, and ask about what is in them.'
  },
  {
    icon: GitBranch,
    title: 'Branching',
    description:
      'Edit a message or try another answer without losing the first.'
  },
  {
    icon: Link2,
    title: 'Share links',
    description: 'Share a chat or an artifact with anyone, by a link.'
  },
  {
    icon: LibraryBig,
    title: 'Library',
    description: 'Every image, video and recording you make, kept in one place.'
  },
  {
    icon: SquareSparkles,
    title: 'Saved prompts',
    description: 'Keep the prompts you use often, and start from them.'
  },
  {
    icon: ShieldCheck,
    title: 'Always answering',
    description: 'When one provider is down, another takes over the same model.'
  }
];

/**
 * The front page, as a visitor who is not signed in sees `/`: what the app
 * does and the way in. The writing is the page's own; the installation's
 * name is the only thing it takes from the console.
 */
export function Landing() {
  const appName = useAppName();
  const plans = usePlansOnSale();
  const openLogin = useOpenLogin();
  const motion = useMotion();
  const typed = useTypewriter(SUGGESTIONS, motion);
  const model = MODELS[typed.line % MODELS.length];
  // The front page is always drawn inside the site's frame, which holds it.
  const openPlans = useOpenPlans()!;

  return (
    <>
      <section className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 pt-20 pb-24 text-center sm:pt-24">
        <span className="text-sm text-muted-foreground">
          One assistant for words, code, images and video
        </span>
        <h1 className="max-w-4xl text-5xl font-semibold tracking-[-0.04em] sm:text-7xl">
          What will you <span className={ACCENT}>make</span> today?
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Chat with the leading AI models, then turn the answer into code you
          can run, an image, a video or a document — all in one place.
        </p>

        {/* A picture of the chat's composer, laid out as the real one is —
            the text, then attaching and the model on the left, sending on
            the right. It does nothing. */}
        <div
          aria-hidden
          className="mt-4 flex w-full max-w-3xl flex-col gap-5 rounded-3xl border bg-background p-4 text-left shadow-[0_24px_60px_rgba(0,0,0,0.08)]"
        >
          {/* The placeholder until the first line is being typed. */}
          <p className="min-h-[2.25rem] p-1 text-base sm:text-lg">
            {typed.text ? (
              <>
                {typed.text}
                <span className="ml-0.5 inline-block h-[1.1em] w-px translate-y-[0.15em] animate-pulse bg-foreground" />
              </>
            ) : (
              <span className="text-muted-foreground">
                Ask {appName} to write, build, draw or look something up…
              </span>
            )}
          </p>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-full border text-muted-foreground">
                <Plus className="size-4" />
              </span>
              <span className="flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium">
                {/* Keyed, so each model fades in as it takes over. */}
                <span
                  key={model.name}
                  className="flex animate-in items-center gap-2 duration-500 fade-in slide-in-from-bottom-1"
                >
                  <ModelIcon image={model.icon} className="size-4" />
                  {model.name}
                </span>
                <ChevronDown className="size-4 opacity-50" />
              </span>
            </div>
            <span
              className={cn(
                'flex size-9 items-center justify-center rounded-full bg-foreground text-background ring-0 ring-foreground/15 transition-[box-shadow] duration-300',
                typed.done && 'ring-4'
              )}
            >
              <ArrowUp className="size-4" />
            </span>
          </div>
        </div>

        <div className="flex max-w-3xl flex-wrap justify-center gap-2.5">
          {SUGGESTIONS.map(suggestion => (
            <span
              key={suggestion}
              className="rounded-full bg-muted px-3.5 py-2 text-sm text-muted-foreground"
            >
              {suggestion}
            </span>
          ))}
        </div>
      </section>

      <section className="bg-muted/50 py-24 sm:py-28">
        <div className="mx-auto flex max-w-6xl flex-col gap-24 px-4 sm:gap-28">
          <Feature
            eyebrow="Artifacts"
            title="See it while you build it."
            description="Code, documents and diagrams open beside the chat, with a live preview for React, HTML and SVG — and every change is kept as a version."
            visual={<ArtifactVisual />}
          />
          <Feature
            eyebrow="Image and video generation"
            title="Generate images and video."
            description="Describe what you want and get an image or a video. Edit an image you upload or one you made, turn a still image into a video, and change a video you already have."
            visual={<MediaVisual />}
            reverse
          />
          <Feature
            eyebrow="Leading AI models"
            title="The right model, mid-sentence."
            description="Chat with the leading models from OpenAI, Anthropic, Google, xAI and DeepSeek, and switch between them in the same conversation."
            visual={<ModelVisual />}
          />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-24 sm:py-28">
        <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {MORE.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex flex-col gap-2.5 border-t pt-6">
              <Icon className={cn('size-5', ACCENT)} />
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24 sm:pb-28">
        <div className="flex flex-col items-center gap-6 rounded-[28px] bg-foreground px-8 py-20 text-center text-background">
          <h2 className="max-w-3xl text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
            Start with {appName} today.
          </h2>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => openLogin()}
              className="rounded-full bg-background px-6 py-3.5 text-[15px] font-medium text-foreground"
            >
              Sign up for free
            </button>
            {plans && (
              <button
                type="button"
                onClick={openPlans}
                className="rounded-full border border-background/30 px-6 py-3.5 text-[15px]"
              >
                See plans
              </button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

/** A feature told in a sentence, beside a picture of it. */
function Feature({
  eyebrow,
  title,
  description,
  visual,
  reverse = false
}: {
  eyebrow: string;
  title: string;
  description: string;
  visual: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-12 lg:flex-row lg:gap-14',
        reverse && 'lg:flex-row-reverse'
      )}
    >
      <div className="flex w-full flex-col gap-4 lg:flex-1">
        <span className={cn('text-sm font-medium', ACCENT)}>{eyebrow}</span>
        <h2 className="text-4xl font-semibold tracking-[-0.03em] sm:text-[44px] sm:leading-[1.08]">
          {title}
        </h2>
        <p className="max-w-md text-[17px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="w-full lg:flex-[1.3]">{visual}</div>
    </div>
  );
}

/** A small component and its running preview, side by side. */
function ArtifactVisual() {
  const seconds = 42 + useTick(1000, useMotion());

  return (
    <div className="flex flex-col overflow-hidden rounded-[20px] border bg-background shadow-[0_20px_50px_rgba(0,0,0,0.06)] sm:flex-row">
      <pre className="flex-1 overflow-x-auto bg-zinc-950 p-6 font-mono text-[12.5px] leading-[1.8] text-zinc-300">
        <span className="text-sky-300">export default function</span> Timer()
        {' {\n'}
        {'  const [s, setS] = useState(0);\n'}
        {'  useEffect(() => {\n'}
        {'    const t = setInterval(\n'}
        {'      () => setS(x => x + 1), 1000);\n'}
        {'    return () => clearInterval(t);\n'}
        {'  }, []);\n'}
        {'  return <h1>{s}s</h1>;\n'}
        {'}'}
      </pre>
      <div className="flex flex-1 flex-col gap-3 p-6">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Timer.tsx</span>
          <span>Preview</span>
        </div>
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-2xl bg-muted/60 text-6xl font-semibold tracking-tight tabular-nums">
          {seconds}s
        </div>
      </div>
    </div>
  );
}

/** A request, the image it made and its edit — made with gpt-image-2 — and
 *  a video made from the image with grok-imagine-video-1.5. */
function MediaVisual() {
  // The video plays by itself, silent and looping — not for a reader who
  // asked for less motion, who sees its first frame.
  const motion = useMotion();
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (motion) void video.current?.play().catch(() => undefined);
    else video.current?.pause();
  }, [motion]);

  return (
    <div className="flex flex-col gap-3.5 rounded-[20px] border bg-background p-5 shadow-[0_20px_50px_rgba(0,0,0,0.06)]">
      <div className="self-end rounded-2xl bg-muted px-3.5 py-2.5 text-sm">
        A lighthouse at dusk, painted in watercolour
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <img
          src="/landing/lighthouse.jpg"
          alt="A lighthouse at dusk, painted in watercolour"
          loading="lazy"
          className="h-48 w-full rounded-2xl object-cover sm:min-w-0 sm:flex-1"
        />
        <div className="relative h-48 w-full overflow-hidden rounded-2xl sm:min-w-0 sm:flex-1">
          <img
            src="/landing/lighthouse-boat.jpg"
            alt="The same lighthouse, with a sailing boat added"
            loading="lazy"
            className="size-full object-cover"
          />
          <span className="absolute bottom-3 left-3 rounded-full bg-background/90 px-2.5 py-1 text-xs">
            Now add a boat
          </span>
        </div>
      </div>
      <div className="relative h-56 overflow-hidden rounded-2xl">
        <video
          ref={video}
          src="/landing/lighthouse.mp4"
          poster="/landing/lighthouse-video.jpg"
          muted
          loop
          playsInline
          preload="metadata"
          aria-label="The lighthouse at nightfall, its beam sweeping the sea"
          className="size-full object-cover"
        />
        <div className="absolute inset-x-3 bottom-3 flex items-center gap-2.5 rounded-xl bg-background/90 px-3 py-2 text-sm">
          <span className="flex size-7 items-center justify-center rounded-full bg-foreground text-background">
            <Play className="size-3 fill-current" />
          </span>
          The lighthouse, a slow pan at nightfall
        </div>
      </div>
    </div>
  );
}

/** The model menu, its choice moving down the newest models. */
function ModelVisual() {
  const active = useTick(2000, useMotion()) % MODELS.length;

  return (
    <div className="flex justify-center">
      <div className="flex w-full max-w-sm flex-col rounded-[18px] border bg-background p-2 text-sm shadow-[0_20px_50px_rgba(0,0,0,0.08)]">
        <div className="px-3 py-2.5 text-xs text-muted-foreground">
          Choose a model
        </div>
        {MODELS.map((model, index) => (
          <div
            key={model.name}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-3 transition-colors duration-300',
              index === active && 'bg-muted'
            )}
          >
            <ModelIcon image={model.icon} className="size-5" />
            <span className="font-medium">{model.name}</span>
            <span className="text-muted-foreground">{model.maker}</span>
            {index === active && (
              <Check
                className={cn('ml-auto size-4 animate-in fade-in', ACCENT)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
