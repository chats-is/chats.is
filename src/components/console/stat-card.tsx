import { Card, CardContent } from '@/components/ui/card';

/** One figure in a card: what it is, the figure, and a line under it. */
export function StatCard({
  title,
  value,
  sub
}: {
  title: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <Card className="py-0">
      <CardContent className="space-y-1 p-4">
        <div className="text-sm font-medium text-muted-foreground">{title}</div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
