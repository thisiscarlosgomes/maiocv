/** One clock for every outbound fetch in a reply. After it, callers fall back. */
export const REPLY_FETCH_MS = 3_000;

/**
 * Share one deadline across every request. A fetch that ignores its abort
 * signal still loses the race, so a hung API cannot hold the reply.
 */
export function budgetFetch(fetchImpl: typeof fetch, budgetMs = REPLY_FETCH_MS): typeof fetch {
  const deadline = Date.now() + budgetMs;
  return async (input, init) => {
    const left = deadline - Date.now();
    if (left <= 0) throw Object.assign(new Error("fetch budget"), { name: "TimeoutError" });
    const budgetSignal = AbortSignal.timeout(left);
    const signal = init?.signal ? AbortSignal.any([init.signal, budgetSignal]) : budgetSignal;
    return await new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error("fetch budget"), { name: "TimeoutError" })), left);
      fetchImpl(input, { ...init, signal }).then(
        (response) => { clearTimeout(timer); resolve(response); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
  };
}
