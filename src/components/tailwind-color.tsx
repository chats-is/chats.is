import { cn } from '@/lib/utils';

export function TailwindColor() {
  if (process.env.NODE_ENV === 'production') return null;

  const colors = [
    'bg-background',
    'bg-foreground',
    'bg-primary',
    'bg-primary-foreground',
    'bg-secondary',
    'bg-secondary-foreground',
    'bg-muted',
    'bg-muted-foreground',
    'bg-accent',
    'bg-accent-foreground',
    'bg-destructive',
    'bg-border',
    'bg-input',
    'bg-ring'
  ];

  return (
    <div className="fixed right-1 bottom-8 z-50 flex flex-col items-end">
      {colors.map(color => (
        <div
          key={color}
          className={cn(
            'mb-px flex items-center justify-center px-1 text-xs',
            color
          )}
        >
          <span className="text-white mix-blend-difference">
            {color.replace('bg-', '')}
          </span>
        </div>
      ))}
    </div>
  );
}
