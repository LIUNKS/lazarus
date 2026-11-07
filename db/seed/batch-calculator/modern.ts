export interface BatchJob {
  a: number;
  b: number;
  op: string;
}

export interface BatchInput {
  jobs: BatchJob[];
}

export interface BatchOutput {
  results: Array<number | null>;
  failures: number;
}

const BATCH_SIZE = 3;

function applyOperator(op: string, a: number, b: number): number | null {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return a / b;
    case '%':
      return a % b;
    default:
      return null;
  }
}

export function calculateBatch(input: BatchInput): BatchOutput {
  const results: Array<number | null> = [];
  let failures = 0;

  for (let index = 0; index < BATCH_SIZE; index += 1) {
    const job: BatchJob | undefined = input.jobs[index];
    const value = job === undefined ? null : applyOperator(job.op, job.a, job.b);
    if (value === null) failures += 1;
    results.push(value);
  }

  return { results, failures };
}
