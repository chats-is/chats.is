import { ReactNode } from 'react';

interface EmptyScreenProps {
  icon: ReactNode;
  text: string;
}

export function EmptyScreen({ icon, text }: EmptyScreenProps) {
  return (
    <div className="flex w-full items-center justify-center pb-6">
      <div className="text-center text-muted-foreground">
        {icon}
        <p className="text-lg font-medium lg:text-2xl">{text}</p>
      </div>
    </div>
  );
}
