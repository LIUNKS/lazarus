import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// From test/support/, ../../ is the package root and ../../../../ is the Workspace_Root.
export const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
export const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
export const distEntry = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
export const distLib = fileURLToPath(new URL('../../dist/lib.js', import.meta.url));

/** Fails with a clear message (never skips) when the build output is missing. */
export function requireBuild(): void {
  if (!existsSync(distEntry)) {
    throw new Error('dist/index.js is missing. Run: pnpm exec turbo run build --filter=@lazarus/mcp-curse-scanner');
  }
}
