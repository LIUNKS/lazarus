import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A Gate that failed to load once must not answer SANDBOX_UNAVAILABLE for the rest of the process.
const createGate = vi.fn();

vi.mock('./sandbox', () => ({ createGate: (...args: unknown[]) => createGate(...args) }));

beforeEach(() => {
  vi.stubEnv('LAZARUS_SANDBOX_KILL_SWITCH', '0');
});

afterEach(() => {
  vi.unstubAllEnvs();
  createGate.mockReset();
  vi.resetModules();
});

describe('verification gate after a load failure', () => {
  it('R6.7 drops a rejected Gate so the next request loads it again', async () => {
    const { getVerificationGate } = await import('./gate');
    const live = { acquire: vi.fn() };
    createGate.mockImplementationOnce(() => Promise.reject(new Error('load failed'))).mockImplementationOnce(() => Promise.resolve(live));

    await expect(getVerificationGate()).rejects.toThrow('load failed');
    expect(await getVerificationGate()).toBe(live);
    expect(createGate).toHaveBeenCalledTimes(2);
    // A Gate that loaded is kept for the process.
    expect(await getVerificationGate()).toBe(live);
    expect(createGate).toHaveBeenCalledTimes(2);
  });

  it('R6.7 marks the rejection as handled when no request awaits the Gate', async () => {
    const { getVerificationGate } = await import('./gate');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      createGate.mockImplementationOnce(() => Promise.reject(new Error('load failed')));
      getVerificationGate();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
