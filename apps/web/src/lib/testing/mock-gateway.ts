// A scripted LlmGateway for the route tests. Test-only: no production module imports this file.
import type { LlmGateway, ProviderCall, ProviderOutcome } from '@/lib/llm/generate';
import type { OutcomeStep } from './arbitraries';

export interface RecordedCall {
  target: 'primary' | 'fallback';
  instructions: string;
  prompt: string;
  timeoutMs: number;
  maxOutputTokens: number;
  /** The gateway never receives tools, so this is always empty. It is recorded to assert exactly that. */
  tools: readonly unknown[];
  deadlineAborted: boolean;
}

export class MockGateway implements LlmGateway {
  readonly calls: RecordedCall[] = [];
  readonly fallbackAvailable: boolean;
  private readonly script: Array<ProviderOutcome<unknown>>;
  private readonly timeline: string[];

  constructor(script: Array<ProviderOutcome<unknown>>, options: { fallbackAvailable?: boolean; timeline?: string[] } = {}) {
    this.script = [...script];
    this.fallbackAvailable = options.fallbackAvailable ?? false;
    this.timeline = options.timeline ?? [];
  }

  async generate<T>(call: ProviderCall<T>): Promise<ProviderOutcome<T>> {
    this.calls.push({
      target: call.target,
      instructions: call.instructions,
      prompt: call.prompt,
      timeoutMs: call.timeoutMs,
      maxOutputTokens: call.maxOutputTokens,
      tools: [],
      deadlineAborted: call.deadline.aborted,
    });
    this.timeline.push('provider');
    // An exhausted script behaves like a provider that keeps failing.
    return (this.script.shift() ?? { kind: 'provider-error' }) as ProviderOutcome<T>;
  }
}

/** Maps a generated step to a gateway outcome. `ok` carries the value the test wants the model to return. */
export function outcomeFor(step: OutcomeStep, value: unknown = undefined): ProviderOutcome<unknown> {
  switch (step) {
    case 'ok':
      return { kind: 'ok', value };
    case 'deadline':
      return { kind: 'aborted', reason: 'deadline' };
    case 'disconnect':
      return { kind: 'aborted', reason: 'disconnect' };
    case 'invalid-output':
    case 'provider-error':
    case 'timeout':
    case 'auth':
      return { kind: step };
  }
}
