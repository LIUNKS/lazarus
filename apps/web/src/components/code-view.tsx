/**
 * Read-only source view with line numbers starting at 1.
 * The code is rendered as text children only, so it can never be interpreted as markup.
 */
export function CodeView({ code }: { code: string }) {
  const lines = code.split('\n');
  // A trailing newline ends the last line; it does not start another one.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();

  return (
    <div
      role="region"
      aria-label="Original source code"
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-border bg-card font-mono text-sm"
    >
      <ol className="min-w-max py-3">
        {lines.map((line, index) => (
          <li key={index} className="flex">
            <span aria-hidden="true" className="w-14 shrink-0 pr-4 text-right text-muted-foreground select-none">
              {index + 1}
            </span>
            <code className="pr-4 whitespace-pre">{line === '' ? ' ' : line}</code>
          </li>
        ))}
      </ol>
    </div>
  );
}