import { countSourceLines } from '@/lib/stages/scanner-view';

/**
 * Read-only code view with line numbers starting at 1.
 * The code is rendered as text children only, so it can never be interpreted as markup.
 *
 * - `label` is the accessible name of the region, so two views on one page have distinct names.
 * - `idPrefix` makes each line id `<idPrefix>-line-N`. With the default `source` the ids are the anchors of the curse links.
 * - `markedLines` are the lines that have a curse: they get a crimson marker and the hidden text "Curse on this line", so the
 *   marker is never conveyed by color alone.
 */
export function CodeView({
  code,
  label = 'Original source code',
  idPrefix = 'source',
  markedLines,
}: {
  code: string;
  label?: string;
  idPrefix?: string;
  markedLines?: ReadonlySet<number>;
}) {
  // A trailing newline ends the last line; it does not start another one. `countSourceLines` holds that rule.
  const lines = code.split('\n').slice(0, countSourceLines(code));

  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-border bg-card font-mono text-sm"
    >
      <ol className="min-w-max py-3">
        {lines.map((line, index) => {
          const number = index + 1;
          const marked = markedLines?.has(number) === true;
          return (
            <li
              key={index}
              id={`${idPrefix}-line-${number}`}
              className={marked ? 'flex border-l-2 border-curse bg-curse/10' : 'flex border-l-2 border-transparent'}
            >
              <span aria-hidden="true" className="w-14 shrink-0 pr-4 text-right text-muted-foreground select-none">
                {number}
              </span>
              {marked ? <span className="sr-only">Curse on this line</span> : null}
              <code className="pr-4 whitespace-pre">{line === '' ? ' ' : line}</code>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
