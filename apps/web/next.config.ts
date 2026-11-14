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
  },
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