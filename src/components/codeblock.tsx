import { lazy, memo, Suspense } from 'react';
import { Check, Copy } from 'lucide-react';

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { Button } from '@/components/ui/button';

const CodeEditor = lazy(() =>
  import('@/components/code-editor').then(mod => ({ default: mod.CodeEditor }))
);

interface CodeBlockProps {
  language: string;
  value: string;
  showHeader?: boolean;
  wrapLongLines?: boolean;
  autoScrollToBottom?: boolean;
  bordered?: boolean;
  showLineNumbers?: boolean;
}

const CodeBlock = memo(
  ({
    language,
    value,
    showHeader = true,
    wrapLongLines = false,
    autoScrollToBottom = false,
    bordered = true,
    showLineNumbers = true
  }: CodeBlockProps) => {
    const { isCopied, copyToClipboard } = useCopyToClipboard();

    const onCopy = async () => {
      if (isCopied) return;
      await copyToClipboard(value);
    };

    return (
      <div
        className={
          bordered
            ? 'relative w-full overflow-hidden rounded-lg border bg-background'
            : 'relative w-full'
        }
      >
        {showHeader && (
          <div className="flex w-full items-center justify-between bg-[#FAFAFA] pr-px pl-3 dark:bg-[#282C34]">
            <span className="text-xs text-muted-foreground lowercase">
              {language}
            </span>
            <div className="flex items-center">
              <Button
                variant="link"
                size="icon"
                className="text-muted-foreground hover:text-muted-foreground/60"
                onClick={onCopy}
              >
                {isCopied ? <Check /> : <Copy />}
                <span className="sr-only">Copy code</span>
              </Button>
            </div>
          </div>
        )}
        <Suspense
          fallback={
            <pre className="min-h-24 p-4 font-mono text-sm wrap-break-word whitespace-pre-wrap text-muted-foreground">
              {value}
            </pre>
          }
        >
          <CodeEditor
            language={language}
            value={value}
            wrapLongLines={wrapLongLines}
            autoScrollToBottom={autoScrollToBottom}
            showLineNumbers={showLineNumbers}
          />
        </Suspense>
      </div>
    );
  }
);
CodeBlock.displayName = 'CodeBlock';

export { CodeBlock };
