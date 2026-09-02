import * as React from 'react'
import { PanelLeft } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/ui/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function SidebarToggle({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar, open: isSidebarOpen } = useSidebar()

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn('size-9 [&_svg]:size-6', className)}
            onClick={toggleSidebar}
            {...props}
          >
            <PanelLeft />
            <span className="sr-only">Toggle Sidebar</span>
          </Button>
        }
      />
      <TooltipContent align="start">
        {isSidebarOpen ? 'Close Sidebar' : 'Open Sidebar'}
      </TooltipContent>
    </Tooltip>
  )
}
