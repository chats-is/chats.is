import * as React from 'react'

export interface useCopyToClipboardProps {
  timeout?: number
}

export function useCopyToClipboard({
  timeout = 2000,
}: useCopyToClipboardProps = {}) {
  const [isCopied, setIsCopied] = React.useState<boolean>(false)

  const copyToClipboard = React.useCallback(
    async (value: string) => {
      if (typeof window === 'undefined') return
      if (!value) return
      if (!navigator.clipboard?.writeText) return

      try {
        await navigator.clipboard.writeText(value)
        setIsCopied(true)
        if (typeof timeout === 'number') {
          setTimeout(() => setIsCopied(false), timeout)
        }
      } catch {
        setIsCopied(false)
      }
    },
    [timeout],
  )

  return { isCopied, copyToClipboard }
}
