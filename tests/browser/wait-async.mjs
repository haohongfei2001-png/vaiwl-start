/** Await asynchronous browser predicates until their resolved value is truthy.
 * page.waitForFunction in the pinned runner can treat a Promise as truthy;
 * false inside that Promise must not prematurely complete an API-state wait.
 */
export async function waitForAsync(page, predicate, arg, options = {}) {
  const timeout = options.timeout ?? 30000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw Error('Invalid async wait timeout');
  let stopped = false, timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { stopped = true; reject(Error(`Asynchronous browser condition not satisfied within ${timeout} ms`)); }, timeout);
  });
  try {
    return await Promise.race([expired, (async () => {
      while (!stopped) {
        const value = await page.evaluate(predicate, arg);
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    })()]);
  } finally { stopped = true; clearTimeout(timer); }
}
