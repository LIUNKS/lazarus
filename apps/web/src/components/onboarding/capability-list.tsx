import { capabilities, type LiveFlags } from '@/lib/onboarding/copy';

/** What a Member can do, from the limit constants and the server decisions for live verification. */
export function CapabilityList({ live }: { live: LiveFlags }) {
  return (
    <ul aria-label="What you can do after signing in" className="space-y-2 text-sm">
      {capabilities(live).map((item) => (
        <li key={item.lead} className="flex gap-2">
          <span aria-hidden="true" className="text-muted-foreground">
            ›
          </span>
          <span>
            <span className="font-medium">{item.lead}</span> <span className="text-muted-foreground">{item.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
