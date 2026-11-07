import tseslint from 'typescript-eslint';

// Shared lint baseline. Workspace packages can import this config or rely on the root run.
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/.next/**',
      'coverage/**',
      // Legacy sample sources are intentionally written in ES3/ES5 with known curses.
      'db/seed/**/legacy.js',
      'db/seed/**/test-code.js',
      'packages/**/test/fixtures/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
