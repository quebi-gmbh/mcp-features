/** Minimal concurrency limiter (no deps). Caps how many async tasks run at once so a
 * bulk add of heavy files (e.g. PDFs being parsed/OCR'd) can't saturate the machine —
 * lightweight Markdown/JSONL indexing never needed this, PDF work does. */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    if (active >= max) return;
    const run = queue.shift();
    if (run) {
      active++;
      run();
    }
  };

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}
