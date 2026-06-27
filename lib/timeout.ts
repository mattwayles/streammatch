/**
 * Race a promise against a timeout. Clears the timer on settle and swallows the
 * loser's eventual rejection, so a settled race never leaks an unhandled promise
 * rejection (which would crash the serverless function and surface as a 502).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${name} exceeded ${ms}ms timeout`)),
      ms,
    );
  });
  timeout.catch(() => {});
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
