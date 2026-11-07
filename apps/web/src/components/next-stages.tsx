import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const STAGES = [
  { name: 'Hex Scanner', detail: 'Deterministic curse diagnostics.' },
  { name: 'Séance Chamber', detail: 'Extraction of the logic into specs.' },
  { name: 'Laboratory', detail: 'Reincarnation and property-based proof of life.' },
] as const;

/** Placeholder for the stages that arrive in a later release. It contains no control that starts an analysis. */
export function NextStages() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Next stages</CardTitle>
        <CardDescription>These stages arrive in a later release.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3 sm:grid-cols-3">
          {STAGES.map((stage) => (
            <li key={stage.name} className="rounded-lg border border-dashed border-border p-3 text-sm">
              <p className="font-medium">{stage.name}</p>
              <p className="text-muted-foreground">{stage.detail}</p>
              <p className="mt-2 text-xs text-muted-foreground">Coming soon</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}