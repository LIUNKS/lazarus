// SessionStart hook (see .kiro/hooks/spec-status-on-start.json).
// Prints one line per spec with the task progress, so the agent starts every session knowing where the project stands.
// Output goes to stdout. The script never fails the session: any error ends in a silent exit 0.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SPECS_DIR = join(process.cwd(), '.kiro', 'specs');
const TASK_LINE = /^\s*- \[( |x|-)\](\*)?\s+(.*)$/;

function summarize(tasksPath) {
  let done = 0;
  let open = 0;
  let optional = 0;
  let inProgress = 0;
  let next = null;
  for (const line of readFileSync(tasksPath, 'utf8').split(/\r?\n/)) {
    const match = TASK_LINE.exec(line);
    if (!match) continue;
    const [, mark, star, title] = match;
    if (star) {
      if (mark !== 'x') optional += 1;
      continue;
    }
    if (mark === 'x') done += 1;
    else if (mark === '-') inProgress += 1;
    else {
      open += 1;
      if (next === null) next = title.trim().slice(0, 90);
    }
  }
  return { done, open, optional, inProgress, next };
}

try {
  if (!existsSync(SPECS_DIR)) process.exit(0);
  const lines = ['Lazarus spec status (from .kiro/specs/*/tasks.md; counts include sub-tasks):'];
  for (const entry of readdirSync(SPECS_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const tasksPath = join(SPECS_DIR, entry.name, 'tasks.md');
    if (!existsSync(tasksPath)) {
      lines.push(`- ${entry.name}: no tasks.md yet`);
      continue;
    }
    const s = summarize(tasksPath);
    const state = s.open === 0 && s.inProgress === 0 ? 'complete' : `${s.open} open`;
    const extras = [s.inProgress ? `${s.inProgress} in progress` : '', s.optional ? `${s.optional} optional left` : ''].filter(Boolean);
    const next = s.next ? ` | next: ${s.next}` : '';
    lines.push(`- ${entry.name}: ${s.done} done, ${state}${extras.length ? `, ${extras.join(', ')}` : ''}${next}`);
  }
  lines.push('Follow .kiro/steering/spec-execution.md when working on a spec task.');
  process.stdout.write(`${lines.join('\n')}\n`);
} catch {
  // Never block a session because of a status report.
}
process.exit(0);
