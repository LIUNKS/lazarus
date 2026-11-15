import type { ReactNode } from 'react';
import { parseSpecMarkdown, type InlineSegment, type SpecBlock } from '@/lib/stages/spec-markdown';

type ListBlock = Extract<SpecBlock, { kind: 'criterion' | 'item' }>;

function isListBlock(block: SpecBlock): block is ListBlock {
  return block.kind === 'criterion' || block.kind === 'item';
}

/** A numbered line starts or continues a numbered list. A bulleted line does so for a bulleted list. */
function isOrdered(block: ListBlock): boolean {
  return block.number !== null;
}

function Segments({ segments }: { segments: readonly InlineSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'code') {
          return (
            <code key={index} className="rounded bg-muted px-1 font-mono text-[0.85em]">
              {segment.text}
            </code>
          );
        }
        if (segment.kind === 'keyword') return <strong key={index}>{segment.text}</strong>;
        return segment.text;
      })}
    </>
  );
}

const HEADINGS = {
  1: 'h4',
  2: 'h5',
  3: 'h6',
} as const;

/**
 * Renders the restricted text of `requirements_md` and `design_md`. Every stored string is a React text child, so markup in
 * the text is shown as characters. Headings start at `h4`, because the section heading is the `h2` of the page and the
 * panel labels are `h3`.
 */
export function SpecMarkdown({ source }: { source: string }) {
  const blocks = parseSpecMarkdown(source);
  const rendered: ReactNode[] = [];
  for (let index = 0; index < blocks.length; ) {
    const block = blocks[index]!;
    if (isListBlock(block)) {
      // Consecutive lines of the same list type go into one list.
      const ordered = isOrdered(block);
      const run: ListBlock[] = [];
      while (index < blocks.length) {
        const next = blocks[index]!;
        if (!isListBlock(next) || isOrdered(next) !== ordered) break;
        run.push(next);
        index += 1;
      }
      const items = run.map((item, position) => (
        <li key={position} value={item.number ?? undefined}>
          <Segments segments={item.segments} />
        </li>
      ));
      rendered.push(
        ordered ? (
          <ol key={rendered.length} className="list-decimal space-y-1 pl-6">
            {items}
          </ol>
        ) : (
          <ul key={rendered.length} className="list-disc space-y-1 pl-6">
            {items}
          </ul>
        ),
      );
      continue;
    }
    index += 1;
    if (block.kind === 'heading') {
      const Heading = HEADINGS[block.level];
      rendered.push(
        <Heading key={rendered.length} className="font-semibold">
          {block.text}
        </Heading>,
      );
    } else if (block.kind === 'paragraph') {
      rendered.push(
        <p key={rendered.length}>
          <Segments segments={block.segments} />
        </p>,
      );
    } else if (block.kind === 'code') {
      rendered.push(
        <pre key={rendered.length} tabIndex={0} className="overflow-x-auto rounded-lg border border-border bg-card p-3 font-mono text-sm">
          <code>{block.lines.join('\n')}</code>
        </pre>,
      );
    }
  }
  return <div className="space-y-3 text-sm">{rendered}</div>;
}
