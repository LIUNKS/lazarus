import { rmSync } from 'node:fs';

// Removes dist/ before a build so stale files never survive a rename.
rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
