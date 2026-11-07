import { defineConfig } from 'vitest/config';

// Base Vitest configuration that workspace packages extend with `mergeConfig`.
export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: false,
  },
});
