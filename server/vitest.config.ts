import { defineConfig } from "vitest/config";

// Test files run in parallel, one worker per CPU (SERBITO-551).
//
// History: under vitest 4 the suite ran in one worker (`fileParallelism: false`). On a
// cold transform cache all workers ran esbuild at once and missed the pool's
// worker-handshake deadline ("[vitest-pool-runner]: Timeout waiting for worker to
// respond"). vitest 5 waits 60 s for a worker to start, so that failure is gone.
// Verified when re-enabled: 20/20 green cold runs (transform cache deleted before each
// run) at a load average of 11–32, about 8 s wall instead of 30–43 s serial.
//
// Every test file is safe to run next to another one: servers listen on port 0,
// temp files go to mkdtemp dirs, and module state is per file (isolate below).
// A new test must keep that: no fixed port, no shared file outside a mkdtemp dir.
export default defineConfig({
  test: {
    fileParallelism: true,
    // 5 s (the default) is too tight when files share the CPU: the sitemap test runs
    // ~140 git calls and took 5.2 s in a parallel pre-commit run. A hang still fails.
    testTimeout: 20_000,
    // Fresh modules per test file: tests set env and module state (rooms, analytics
    // gates) and must not leak into the next file. Set explicitly — when it is left at
    // the default, vitest prints an "isolate: false is faster" hint on every run.
    isolate: true,
  },
});
