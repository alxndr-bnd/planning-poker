import { defineConfig } from "vitest/config";

// Run the suite in a single worker (no file-level parallelism).
//
// vitest 4's default forks pool spins up one worker per CPU; on a cold transform
// cache they all run esbuild on the TS sources at once, starve the CPU, and miss the
// pool's worker-handshake deadline — the run then dies with
// "[vitest-pool-runner]: Timeout waiting for worker to respond" and reports
// "no tests / N errors". It's load/timing dependent, so it flakes (a warm second run
// usually passes), which is exactly what you don't want from a release gate.
//
// The suite is small (10 files / 45 tests, a few seconds of actual test time), so
// sequential execution costs little and makes the gate fully deterministic. Verified:
// 3/3 green cold runs with this on, vs ~50% cold-run failures without it.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
