import { defineConfig, mergeConfig } from 'vitest/config';
import shared from './vitest.shared.ts';

// Root configuration: runs only the Foundation Verification_Suite.
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      include: ['db/tests/**/*.test.ts'],
      globalSetup: ['db/tests/support/global-setup.ts'],
      testTimeout: 120_000,
      hookTimeout: 180_000,
      fileParallelism: false,
    },
  }),
);
