import nextVitals from 'eslint-config-next/core-web-vitals';
import rootConfig from '../../eslint.config.mjs';

const config = [
  ...rootConfig,
  ...nextVitals,
  // The app uses only the App Router, so the Pages Router link rule does not apply.
  { rules: { '@next/next/no-html-link-for-pages': 'off' } },
  { ignores: ['.next*/**', 'next-env.d.ts', 'tsconfig.build-test.json'] },
];

export default config;