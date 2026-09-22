export class AnalysisDeadlineError extends Error {
  readonly statusCode = 503;
  readonly reasonCode = 'analysis_deadline_exceeded';

  constructor() {
    super(
      'Analysis stopped before the hosting timeout because verification did not finish in time. No incomplete slip or booking code was created.',
    );
    this.name = 'AnalysisDeadlineError';
  }
}

export function assertBeforeDeadline(deadlineAt?: number): void {
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) throw new AnalysisDeadlineError();
}

export async function beforeDeadline<T>(promise: Promise<T>, deadlineAt?: number): Promise<T> {
  if (deadlineAt === undefined) return promise;
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new AnalysisDeadlineError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new AnalysisDeadlineError()), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
  deadlineAt?: number,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, values.length)) },
    async () => {
      while (true) {
        assertBeforeDeadline(deadlineAt);
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        results[index] = await beforeDeadline(operation(values[index]!, index), deadlineAt);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
