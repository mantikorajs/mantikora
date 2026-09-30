/**
 * PoC measurement hooks, called by the native bench panel (see poc/RESULTS.md).
 * Not part of the renderer.
 */
export interface BenchTarget {
  tick(): void;
}

export function installBench(target: BenchTarget): void {
  (globalThis as { __mantikoraBench?: unknown }).__mantikoraBench = {
    /** M3: 60 updates per second, plus 100 ms of blocked JS every second. */
    stress(durationMs = 30_000): void {
      const tick = setInterval(() => target.tick(), 1000 / 60);
      const block = setInterval(() => {
        const until = performance.now() + 100;
        while (performance.now() < until) {
          // busy-wait: the JS thread is blocked, native frames must keep coming
        }
      }, 1000);
      setTimeout(() => {
        clearInterval(tick);
        clearInterval(block);
      }, durationMs);
    },
  };
}
