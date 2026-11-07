import path from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared.ts';

export default mergeConfig(
  shared,
  defineConfig({
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    test: {
      include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts'],
      testTimeout: 30_000,
    },
  }),
);