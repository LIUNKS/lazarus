import { SeverityGlyph } from '@/components/stages/severity-glyph';
import { countSourceLines } from '@/lib/stages/scanner-view';
import { cn } from '@/lib/utils';

/**
 * Read-only code view (a stone slab) with line numbers starting at 1.
 * The code is rendered as text children only, so it can never be interpreted as markup.
 *
 * - `label` is the accessible name of the region, so two views on one page have distinct names.
 * - `idPrefix` makes each line id `<idPrefix>-line-N`. With the default `source` the ids are the anchors of the curse links.
 * - `markedLines` are the lines that have a curse: they get a crimson marker and the hidden text "Curse on this line", so the
 *   marker is never conveyed by color alone. `severityByLine` adds the glyph of the severity in the margin.
 * - `tone="verified"` tints the slab emerald (the resurrected code).
 */
export function CodeView({
  code,
  label = 'Original source code',
  idPrefix = 'source',
  markedLines,
  severityByLine,
  tone = 'default',
}: {
  code: string;
  label?: string;
  idPrefix?: string;
  markedLines?: ReadonlySet<number>;
  severityByLine?: ReadonlyMap<number, string>;
  tone?: 'default' | 'verified';
}) {
  // A trailing newline ends the last line; it does not start another one. `countSourceLines` holds that rule.
  const lines = code.split('\n').slice(0, countSourceLines(code));

  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        'overflow-x-auto rounded-md border py-4 font-mono text-sm shadow-[inset_0_1px_0_rgb(236_228_212/0.04),inset_0_0_60px_rgb(0_0_0/0.6)]',
        tone === 'verified' ? 'border-verified/35 bg-[#0d1512]' : 'border-border bg-[#100e15]',
      )}
    >
      <ol className="min-w-max leading-6">
        {lines.map((line, index) => {
          const number = index + 1;
          const marked = markedLines?.has(number) === true;
          const severity = severityByLine?.get(number);
          return (
            <li
              key={index}
              id={`${idPrefix}-line-${number}`}
              className={marked ? 'flex border-l-[3px] border-curse bg-curse/10' : 'flex border-l-[3px] border-transparent'}
            >
              <span aria-hidden="true" className="w-11 shrink-0 pr-4 text-right text-muted-foreground select-none">
                {number}
              </span>
              {marked ? <span className="sr-only">Curse on this line</span> : null}
              {/* order-first puts the margin glyph before the line number without moving the hidden text away from it in the DOM. */}
              <span aria-hidden="true" className="order-first flex w-7 shrink-0 items-center justify-center text-curse-text select-none">
                {marked && severity !== undefined ? <SeverityGlyph severity={severity} className="size-3.5" /> : null}
              </span>
              <code className="pr-4 whitespace-pre">{line === '' ? ' ' : line}</code>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
