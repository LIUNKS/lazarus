import path from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared.ts';

export default mergeConfig(
  shared,
  defineConfig({
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        // The real `server-only` package throws outside a React Server environment.
        'server-only': path.resolve(import.meta.dirname, 'test/stubs/server-only.ts'),
      },
    },
    test: {
      include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts'],
      setupFiles: ['test/setup/guards.ts'],
      testTimeout: 30_000,
    },
  }),
);