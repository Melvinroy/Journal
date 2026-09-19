export async function withAuthTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Read-only recovery for a newly issued token rejected by a validator's clock.
 * Never use this for writes or order requests. The server still validates both reads.
 */
export async function readWithClockRetry<T extends { error: { message: string } | null }>(
  read: () => PromiseLike<T>,
  current: () => boolean,
  wait: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 1100)),
): Promise<T> {
  const result = await read();
  if (!current() || !/JWT issued at future/i.test(result.error?.message ?? "")) return result;
  await wait();
  return current() ? await read() : result;
}
