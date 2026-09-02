import * as React from 'react'
import { ThemeProvider, type ThemeProviderProps } from 'next-themes'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

export function Providers({ children, ...props }: ThemeProviderProps) {
  return (
    <ThemeProvider {...props}>
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster position="top-center" />
    </ThemeProvider>
  )
}
