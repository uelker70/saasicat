/** No answer within the time allowed — which is not the same as a failure. */
export class TimeoutError extends Error {}

/**
 * `work`, or a rejection with a `TimeoutError` once `ms` have passed without an
 * answer.
 *
 * For a call into the application — a notification, a mail — that the platform
 * must not wait on forever. The timer does not keep the process alive, and an
 * answer that arrives late is not raised here; a caller that still wants it
 * keeps `work` and reads it there.
 */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new TimeoutError(`no answer within ${ms} ms`)), ms);
        timer.unref();
        work.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            },
        );
    });
}
