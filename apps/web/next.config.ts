import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Next.js reads .env files from the project directory (apps/web). The repository keeps one set of
// files at the root, so load them here. The last argument (forceReload) is required: without it the
// call is ignored because Next.js has already loaded the project environment once.
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnvConfig(path.resolve(here, '../..'), process.env.NODE_ENV !== 'production', console, true);

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  // NEXT_DIST_DIR lets the built-output test build into a temporary directory.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // The built-output test builds with a copy of tsconfig.json so Next.js never rewrites the real one.
  typescript: { tsconfigPath: process.env.NEXT_TSCONFIG_PATH ?? 'tsconfig.json' },
  // The static gate of POST /api/reincarnate type-checks generated code in memory and reads the ES library
  // declaration files of the `typescript` package at run time. Next.js file tracing cannot see those reads,
  // so the deployed output would miss them and every check would fail. The compiler itself stays external
  // (serverExternalPackages already lists `typescript` by default). lib.dom is deliberately not included.
  outputFileTracingIncludes: {
    '/api/reincarnate': ['./node_modules/typescript/lib/lib.es*.d.ts', './node_modules/typescript/lib/lib.decorators*.d.ts'],
    // POST /api/verify (08-live-verification-api): the Sandbox_Runner starts Workers from files in its dist/worker/
    // directory, found at run time through import.meta.url, which file tracing cannot see.
    // The route loads the runner with an import that the bundler does not follow (see lib/verification/sandbox.ts), so
    // tracing also misses the package.json files that Node.js needs to resolve the packages and every runtime
    // dependency of the runner. A sample run loads all of them: the runner, the Verifier, fast-check with pure-rand, and
    // the TypeScript compiler with the ES library files the Verifier reads. The paths go through the pnpm links of each
    // package, so they keep working when a version changes.
    '/api/verify': [
      './node_modules/@lazarus/sandbox-runner/package.json',
      './node_modules/@lazarus/sandbox-runner/dist/**/*.js',
      './node_modules/@lazarus/sandbox-runner/node_modules/@lazarus/pbt-verifier/package.json',
      './node_modules/@lazarus/sandbox-runner/node_modules/@lazarus/pbt-verifier/dist/**/*.js',
      './node_modules/@lazarus/sandbox-runner/node_modules/fast-check/package.json',
      './node_modules/@lazarus/sandbox-runner/node_modules/fast-check/lib/**/*.js',
      // pnpm links pure-rand next to fast-check inside the store, not below it.
      '../../node_modules/.pnpm/fast-check@*/node_modules/pure-rand/package.json',
      '../../node_modules/.pnpm/fast-check@*/node_modules/pure-rand/lib/**/*.js',
      // pure-rand is a CommonJS package whose ESM build is marked by lib/esm/package.json ({"type":"module"}), and
      // fast-check marks its CommonJS build the same way in lib/cjs/package.json. Without these markers Node.js reads
      // the files in the wrong module format, and the import fails with a SyntaxError ("does not provide an export
      // named ..."). That was the SANDBOX_UNAVAILABLE of POST /api/verify on Vercel.
      '../../node_modules/.pnpm/fast-check@*/node_modules/pure-rand/lib/**/package.json',
      './node_modules/@lazarus/sandbox-runner/node_modules/fast-check/lib/**/package.json',
      './node_modules/@lazarus/sandbox-runner/node_modules/@lazarus/pbt-verifier/node_modules/fast-check/package.json',
      './node_modules/@lazarus/sandbox-runner/node_modules/@lazarus/pbt-verifier/node_modules/typescript/package.json',
      './node_modules/@lazarus/sandbox-runner/node_modules/@lazarus/pbt-verifier/node_modules/typescript/lib/typescript.js',
      './node_modules/@lazarus/sandbox-runner/node_modules/@lazarus/pbt-verifier/node_modules/typescript/lib/lib.es*.d.ts',
      './node_modules/@lazarus/sandbox-runner/node_modules/@lazarus/pbt-verifier/node_modules/typescript/lib/lib.decorators*.d.ts',
    ],
  },
  // The Sandbox_Runner locates its worker files relative to its own module, so it must run from node_modules as
  // built, not bundled (a bundler cannot resolve the worker directory URL).
  serverExternalPackages: ['@lazarus/sandbox-runner'],
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // Every response that can depend on the session is private and never cached by a shared cache.
        source: '/((?!_next/static|_next/image).*)',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ];
  },
};

export default config;