import { Badge } from '@/components/ui/badge';
import type { CurseRow } from '@/lib/data/types';

function humanize(curseType: string): string {
  const words = curseType.toLowerCase().split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Stored curses, read-only. Analysis arrives with the Hex Scanner in a later release. */
export function CurseList({ curses }: { curses: CurseRow[] }) {
  if (curses.length === 0) return <p className="text-sm text-muted-foreground">No curses are stored for this corpse yet.</p>;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {curses.map((curse) => (
        <li key={curse.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
          <span className="font-medium">{humanize(curse.curseType)}</span>
          <span className="flex items-center gap-3">
            <Badge className="bg-curse text-curse-foreground">{curse.severity.split('_').join(' ')}</Badge>
            <span className="text-muted-foreground">line {curse.lineNumber}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}