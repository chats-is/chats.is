import { useEffect, useState } from 'react';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { Moon, Play, Square, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

import { type ChatMessage } from '@/types';
import { pageTitle } from '@/lib/head';
import { Button } from '@/components/ui/button';
import { Message } from '@/components/message';

/**
 * Every kind of thing a reply's text can hold, drawn by the chat's own message
 * component, to see how each one looks — and, replayed a few characters at a
 * time, how it looks while it streams. For development only: a build for
 * production answers it with the page that is not found.
 */
export const Route = createFileRoute('/dev/markdown')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Markdown preview') }]
  }),
  component: MarkdownPreviewPage
});

type Part = ChatMessage['parts'][number];

const FENCE = '```';

const text = (value: string): Part => ({
  type: 'text',
  text: value,
  state: 'done'
});

const source = (url: string, title: string): Part => ({
  type: 'source-url',
  sourceId: url,
  url,
  title
});

const SAMPLES: Array<{ name: string; parts: Part[] }> = [
  {
    name: 'Headings and inline styles',
    parts: [
      text(String.raw`# Heading 1
## Heading 2
### Heading 3
#### Heading 4

A paragraph with **bold**, *italic*, ***bold italic***, ~~strikethrough~~, ${'`inline code`'}, a [link](https://example.com), and a bare address: https://example.com/a/very/long/path/that/should/wrap/somewhere/rather/than/overflow?query=string&more=values.

A second paragraph, after a blank line.
A line after a single line break, in the same paragraph.`)
    ]
  },
  {
    name: 'Lists',
    parts: [
      text(String.raw`- Unordered item
- Another item
  - Nested item
  - Another nested item
    - Third level
- Back to the top

1. Ordered item
2. Another item
   1. Nested ordered
   2. Another nested
3. Third item

- [x] A task that is done
- [ ] A task that is not

1. **A step with a title.** Then the text that explains it, long enough to run onto a second line so the hanging indent shows.
2. **Another step.**

   A second paragraph inside the same item.`)
    ]
  },
  {
    name: 'Chinese, with bold beside punctuation',
    parts: [
      text(String.raw`这是一段中文，其中有**粗体**，也有*斜体*和${'`行内代码`'}。中英文混排时 English words 和数字 123 之间的间距。

**“引号里的粗体”**后面紧跟文字。

**加粗的标题：**后面是说明。

这句话以**粗体结尾。**

价格是**4,138 美元/盎司**（约合人民币）。

1. **第一步：**打开设置。
2. **第二步：**选择模型。`)
    ]
  },
  {
    name: 'Blockquotes',
    parts: [
      text(String.raw`> A quoted paragraph.
>
> A second quoted paragraph, with **bold** inside.

> "A quotation that carries its own quotation marks."

> Outer quote
> > Nested quote`)
    ]
  },
  {
    name: 'Code',
    parts: [
      text(`Inline: run ${'`pnpm install`'} first, then ${'`pnpm dev`'}.

${FENCE}ts
interface User {
  id: string;
  name: string;
}

export async function getUser(id: string): Promise<User | null> {
  const response = await fetch(\`/api/users/\${id}\`);
  return response.ok ? response.json() : null;
}
${FENCE}

${FENCE}python
def fibonacci(n: int) -> list[int]:
    seq = [0, 1]
    while len(seq) < n:
        seq.append(seq[-1] + seq[-2])
    return seq[:n]
${FENCE}

${FENCE}bash
curl -X POST https://api.example.com/v1/items -H "Content-Type: application/json" -d '{"name": "a very long line of shell that should scroll sideways rather than wrap"}'
${FENCE}

${FENCE}json
{ "name": "chats.is", "private": true, "scripts": { "dev": "vite dev" } }
${FENCE}

${FENCE}
A block with no language.
${FENCE}`)
    ]
  },
  {
    name: 'Tables',
    parts: [
      text(String.raw`| Model | Provider | Context | Price |
| :--- | :---: | ---: | ---: |
| gpt-5.4-mini | OpenAI | 400K | $0.25 |
| claude-sonnet-4-6 | Anthropic | 1M | $3.00 |
| gemini-3.8-flash | Google | 1M | $0.30 |

A wide table:

| Date | Open | High | Low | Close | Volume | Change | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-13 | 4,099.10 | 4,121.80 | 4,080.25 | 4,104.20 | 182,340 | +0.42% | Steady before the data release |
| 2026-10-14 | 4,104.20 | 4,162.00 | 4,098.70 | 4,148.10 | 240,115 | +1.07% | Rose on a weaker dollar and rate-cut hopes |`)
    ]
  },
  {
    name: 'Mathematics',
    parts: [
      text(String.raw`Inline with dollars: $E = mc^2$, and $\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$.

Inline with LaTeX delimiters: \(a^2 + b^2 = c^2\).

A display block with dollars:

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

A display block with LaTeX delimiters:

\[
f(x) = \begin{cases} x^2 & x \ge 0 \\ -x & x < 0 \end{cases}
\]

A formula on one line, straight after a line of text:
$$P_{\text{CNY/g}} = \frac{P_{\text{USD/oz}} \times E}{31.1035}$$

The same with LaTeX delimiters:

\[ E = mc^2 \]`)
    ]
  },
  {
    name: 'Dollar amounts',
    parts: [
      text(String.raw`国际现货金价约为 **$4,138.40美元/盎司**（美元计价），今日上涨$33.90。

It costs $5 and the deluxe one $10.

Prices range from $5-$10, or $1,200 for the bundle.

A formula beside an amount: $x^2$ costs $3.`)
    ]
  },
  {
    name: 'Footnotes, rules, images and HTML',
    parts: [
      text(String.raw`A sentence with a footnote.[^1]

---

![The app's icon](/favicon.png)

<details><summary>HTML a model wrote</summary>Hidden text</details> and <kbd>Ctrl</kbd> + <kbd>C</kbd>.

Emoji: 🎉 ✅ 🚀

[^1]: The footnote's text.`)
    ]
  },
  {
    name: 'Mermaid diagrams',
    parts: [
      text(`${FENCE}mermaid
flowchart LR
  A[用户发送消息] --> B{模型能否搜索?}
  B -- 能 --> C[用自己的搜索]
  B -- 不能 --> D[交给搜索模型]
  C --> E[回复和来源]
  D --> E
${FENCE}

${FENCE}mermaid
sequenceDiagram
  participant U as User
  participant S as Server
  participant P as Provider
  U->>S: POST /api/chat
  S->>P: stream request
  P-->>S: text deltas
  S-->>U: SSE stream
${FENCE}`)
    ]
  },
  {
    name: 'A cited answer, cut where its citations fall',
    parts: [
      { type: 'step-start' },
      text('今日（2026年10月15日）'),
      text('国际金价约为每盎司 **$4,138** 美元'),
      source('https://www.kitco.com/charts/gold', 'Gold Price Today'),
      text('，'),
      text('美元兑人民币汇率约为 **6.6915**'),
      source(
        'https://www.xe.com/currencyconverter/convert/?Amount=1&From=USD&To=CNY',
        'USD to CNY Exchange Rate'
      ),
      text('。')
    ]
  },
  {
    name: 'Reasoning, then the answer',
    parts: [
      {
        type: 'reasoning',
        text: String.raw`The user asks for the area. With radius $r = 3$, the area is $\pi r^2$.

| r | area |
| --- | --- |
| 3 | 28.27 |`,
        state: 'done'
      },
      text(
        String.raw`The area of a circle of radius 3 is $\pi \cdot 3^2 \approx 28.27$.`
      )
    ]
  },
  {
    name: 'A whole answer',
    parts: [
      text(`## 如何在 React 中防抖输入

防抖（debounce）让函数在**停止触发一段时间后**才执行，适合搜索框这类场景。

### 实现

${FENCE}tsx
import { useEffect, useState } from 'react';

export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
${FENCE}

### 对比

| 方式 | 何时执行 | 适合 |
| --- | --- | --- |
| 防抖 | 停止触发后 | 搜索、表单校验 |
| 节流 | 固定间隔 | 滚动、拖拽 |

> **注意：**${'`delay`'} 太短起不到作用，太长又显得迟钝，一般取 200–500 ms。

要点：

1. 每次 ${'`value`'} 变化都会清掉上一个定时器；
2. 组件卸载时也要清理；
3. 复杂度为 $O(1)$，费用约 $0.00。`)
    ]
  }
];

/** How many characters a replay reveals at each step, and how often. */
const STREAM_STEP = 3;
const STREAM_INTERVAL_MS = 40;

function MarkdownPreviewPage() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur">
        <h1 className="text-sm font-medium">Markdown preview</h1>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          {/* Which one shows is the stylesheet's to say: the theme is not
              known while the page is drawn on the server. */}
          <Sun className="hidden dark:block" />
          <Moon className="dark:hidden" />
          <span className="sr-only">Switch theme</span>
        </Button>
      </header>
      <main className="mx-auto w-full max-w-4xl space-y-10 px-4 py-8">
        {SAMPLES.map(sample => (
          <Sample key={sample.name} name={sample.name} parts={sample.parts} />
        ))}
      </main>
    </div>
  );
}

/** One sample, drawn as a finished reply, or replayed as one streaming in. */
function Sample({ name, parts }: { name: string; parts: Part[] }) {
  // How many characters of its text the replay has revealed; none while it
  // is not replaying.
  const [revealed, setRevealed] = useState<number | null>(null);
  const total = parts.reduce(
    (sum, part) =>
      sum +
      (part.type === 'text' || part.type === 'reasoning'
        ? part.text.length
        : 0),
    0
  );

  useEffect(() => {
    if (revealed === null) return;
    if (revealed >= total) {
      setRevealed(null);
      return;
    }
    const timer = setTimeout(
      () => setRevealed(revealed + STREAM_STEP),
      STREAM_INTERVAL_MS
    );
    return () => clearTimeout(timer);
  }, [revealed, total]);

  const streaming = revealed !== null;
  const message: ChatMessage = {
    id: name,
    role: 'assistant',
    parts: streaming ? cutParts(parts, revealed) : parts
  };

  return (
    <section className="scroll-mt-16">
      <div className="mb-3 flex items-center justify-between border-b pb-2">
        <h2 className="font-mono text-xs text-muted-foreground">{name}</h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setRevealed(streaming ? null : 0)}
        >
          {streaming ? <Square /> : <Play />}
          {streaming ? 'Stop' : 'Stream'}
        </Button>
      </div>
      <Message
        message={message}
        status={streaming ? 'streaming' : 'ready'}
        isLastMessage
        isReadonly
      >
        {null}
      </Message>
    </section>
  );
}

/** The parts as they stand once so many characters of their text have
 *  arrived: those before whole, the one being written cut and streaming, and
 *  none after it. */
function cutParts(parts: Part[], revealed: number): Part[] {
  const cut: Part[] = [];
  let left = revealed;
  for (const part of parts) {
    if (part.type !== 'text' && part.type !== 'reasoning') {
      cut.push(part);
      continue;
    }
    if (left >= part.text.length) {
      cut.push(part);
      left -= part.text.length;
      continue;
    }
    cut.push({ ...part, text: part.text.slice(0, left), state: 'streaming' });
    break;
  }
  return cut;
}
