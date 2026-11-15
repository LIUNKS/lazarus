// PreToolUse guard for file writes (used by .kiro/hooks/guard-sensitive-writes.json).
// Reads the hook payload from stdin and applies five rules:
//   1. Deny edits to an existing Flyway migration (migrations are immutable once created).
//   2. Ask before touching .env files (except .env.example) or pnpm-lock.yaml.
//   3. Deny `NEXT_PUBLIC_` variants of server-only secrets anywhere under apps/web/src.
//   4. Deny server-only secret names in client code (components/ or files with "use client").
//   5. Ask before writing a banned claim ("100%", "mathematical proof", ...) into user-facing code or docs.
// Exit 0 allows, exit 0 with a JSON decision asks, exit 2 blocks (stderr is shown to the agent).

import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const PATH_KEYS = /^(path|file_?path|target_?file|file)$/i;
const CONTENT_KEYS = /^(text|content|new_?str|file_?text)$/i;
const SERVER_SECRET = /\b(SUPABASE_SERVICE_ROLE_KEY|GROQ_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|FLYWAY_[A-Z_]+)\b/;
const PUBLIC_SECRET = /NEXT_PUBLIC_(SUPABASE_SERVICE_ROLE_KEY|GROQ_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|FLYWAY_[A-Z_]+)/;
const USE_CLIENT = /^\s*['"]use client['"]/m;
// Same list as db/seed/generate-seed.ts and db/tests/seed.test.ts.
const BANNED_CLAIMS = /100%|mathematical proof|mathematically proven|guaranteed/i;

function collect(node, paths, contents) {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, paths, contents);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string') {
      if (PATH_KEYS.test(key)) paths.push(value);
      else if (CONTENT_KEYS.test(key)) contents.push(value);
    } else {
      collect(value, paths, contents);
    }
  }
}

function deny(message) {
  process.stderr.write(`Blocked by guard-write: ${message}\n`);
  process.exit(2);
}

function ask(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: reason } }));
  process.exit(0);
}

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

const paths = [];
const contents = [];
collect(payload, paths, contents);
const text = contents.join('\n');
const root = process.cwd();

for (const target of paths) {
  const absolute = resolve(root, target);
  const rel = relative(root, absolute).split('\\').join('/');
  if (rel.startsWith('..')) continue;

  if (/^db\/migrations\/V\d+__.+\.sql$/.test(rel) && existsSync(absolute)) {
    deny(`${rel} already exists. Flyway migrations are immutable; add a new V<N>__description.sql instead.`);
  }

  if (/(^|\/)\.env(\.(?!example$)[\w.-]+)?$/.test(rel)) {
    ask(`${rel} can hold real secrets. Confirm the edit, and never put values in .env.example.`);
  }

  if (rel === 'pnpm-lock.yaml') {
    ask('pnpm-lock.yaml is the source of truth for versions. Prefer `pnpm add`/`pnpm install` over manual edits.');
  }

  if (rel.startsWith('apps/web/src/')) {
    if (PUBLIC_SECRET.test(text)) {
      deny(`${rel} exposes a server-only secret through a NEXT_PUBLIC_ variable.`);
    }
    const isTest = /\.test\.tsx?$/.test(rel);
    const onDisk = existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';
    const isClientFile = rel.startsWith('apps/web/src/components/') || USE_CLIENT.test(text) || USE_CLIENT.test(onDisk);
    if (!isTest && isClientFile && SERVER_SECRET.test(text)) {
      deny(`${rel} is client code and must not reference server-only secrets (service role key, LLM keys, FLYWAY_*).`);
    }
  }

  // Product wording: results are empirical evidence, never a proof. Test files hold the phrases as data and are exempt.
  const isUserFacing = (rel.startsWith('apps/web/src/') || rel.startsWith('docs/') || rel === 'README.md') && !/\.test\.tsx?$/.test(rel);
  if (isUserFacing && BANNED_CLAIMS.test(text)) {
    ask(`${rel} contains a banned claim (100%, mathematical proof, mathematically proven, guaranteed). Use empirical wording with the exact run count.`);
  }
}

process.exit(0);
