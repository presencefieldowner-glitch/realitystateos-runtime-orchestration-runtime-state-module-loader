import { loadSettings, envOverrides, resolveSecretRefs, DEFAULT_SETTINGS } from "./config";
import { HealthValidation } from "./healthValidation";
import { RecoveryManager } from "./recoveryManager";
import { StartupPipeline, buildRuntime } from "./startupPipeline";
import { KernelModule } from "../../002_KERNEL/ModuleLoader/dist/moduleLoader";
import { FakeClock } from "../../002_KERNEL/SystemClock/dist/systemClock";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const r = fn();
    if (r instanceof Promise) {
      r.then(
        () => {
          passed++;
          console.log(`  ok  - ${name}`);
        },
        (e) => {
          failed++;
          console.log(`FAIL - ${name}`);
          console.log(`       ${(e as Error).message}`);
        }
      );
    } else {
      passed++;
      console.log(`  ok  - ${name}`);
    }
  } catch (e) {
    failed++;
    console.log(`FAIL - ${name}`);
    console.log(`       ${(e as Error).message}`);
  }
}

function assert(cond: boolean, msg = "assertion failed"): void {
  if (!cond) throw new Error(msg);
}

async function asyncTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL - ${name}`);
    console.log(`       ${(e as Error).message}`);
  }
}

function fakeModule(name: string, opts: { failInit?: boolean; dependencies?: string[] } = {}): KernelModule {
  return {
    name,
    dependencies: opts.dependencies ?? [],
    init: () => {
      if (opts.failInit) throw new Error(`${name} init failed`);
    },
    start: () => {},
    stop: () => {},
  };
}

async function main() {
  console.log("config");
  test("loadSettings returns compiled-in defaults with zero config present", () => {
    const settings = loadSettings({ env: {} });
    assert((settings.bootstrap as any).recovery_mode === "rollback");
    assert((settings.kernel as any).max_agents === 64);
  });

  test("envOverrides parses RSOS_<SECTION>_<KEY> into a nested table", () => {
    const overrides = envOverrides({ RSOS_KERNEL_MAX_AGENTS: "128", IRRELEVANT: "x" });
    assert((overrides.kernel as any).max_agents === 128);
    assert(Object.keys(overrides).length === 1);
  });

  test("loadSettings applies env override on top of defaults", () => {
    const settings = loadSettings({ env: { RSOS_SYSTEM_ENVIRONMENT: "production" } });
    assert((settings.system as any).environment === "production");
    assert((settings.system as any).timezone === "UTC");
  });

  test("loadSettings applies CLI flags with highest precedence", () => {
    const settings = loadSettings({
      env: { RSOS_SYSTEM_ENVIRONMENT: "production" },
      cliFlags: { system: { environment: "staging" } },
    });
    assert((settings.system as any).environment === "staging");
  });

  test("resolveSecretRefs resolves env: references, leaves unresolved refs intact", () => {
    process.env.TEST_DB_URL = "postgres://real";
    const resolved = resolveSecretRefs({ storage: { postgres_url: "env:TEST_DB_URL" } }) as any;
    assert(resolved.storage.postgres_url === "postgres://real");
    const unresolved = resolveSecretRefs({ x: "env:NEVER_SET_XYZ" }) as any;
    assert(unresolved.x === "env:NEVER_SET_XYZ");
  });

  test("DEFAULT_SETTINGS covers every documented top-level section", () => {
    for (const section of [
      "system", "kernel", "bootstrap", "verified_bus", "storage",
      "security", "presence", "intelligence", "interface", "operations",
    ]) {
      assert(section in DEFAULT_SETTINGS, `missing section: ${section}`);
    }
  });

  console.log("HealthValidation");
  await asyncTest("runAll reports overall healthy when every check passes", async () => {
    const health = new HealthValidation();
    health.register("a", () => true);
    health.register("b", () => true);
    const report = await health.runAll();
    assert(report.healthy === true);
    assert(report.checks.length === 2);
  });

  await asyncTest("runAll retries a failing check up to the retry budget", async () => {
    const health = new HealthValidation();
    let calls = 0;
    health.register("flaky", () => {
      calls++;
      return calls >= 3;
    });
    const report = await health.runAll(2);
    assert(report.healthy === true);
    assert(report.checks[0].attempts === 3);
  });

  await asyncTest("runAll reports unhealthy after exhausting retries", async () => {
    const health = new HealthValidation();
    health.register("always_fails", () => false);
    const report = await health.runAll(2);
    assert(report.healthy === false);
    assert(report.checks[0].attempts === 3);
  });

  console.log("RecoveryManager");
  test("rollback restores last-known-good when a snapshot exists", () => {
    const rm = new RecoveryManager({ configSnapshot: {}, moduleVersion: "v1" });
    const outcome = rm.recover("rollback", "boot timed out");
    assert(outcome.action === "rolled_back");
  });

  test("rollback halts when no snapshot exists yet", () => {
    const rm = new RecoveryManager();
    const outcome = rm.recover("rollback", "first boot ever, nothing to roll back to");
    assert(outcome.action === "halted");
  });

  test("safe-mode and halt map to their documented actions", () => {
    const rm = new RecoveryManager();
    assert(rm.recover("safe-mode", "x").action === "entered_safe_mode");
    assert(rm.recover("halt", "x").action === "halted");
  });

  console.log("StartupPipeline");
  await asyncTest("boot() succeeds and marks last-known-good when health checks pass", async () => {
    const runtime = buildRuntime({
      configDefaults: { environment: "development" },
      clock: new FakeClock(),
    });
    const health = new HealthValidation();
    health.register("always_ok", () => true);
    const recovery = new RecoveryManager();
    const pipeline = new StartupPipeline(runtime, health, recovery, {
      bootTimeoutSeconds: 0,
      healthCheckRetries: 0,
      recoveryMode: "rollback",
    });
    const result = await pipeline.boot([fakeModule("a")]);
    assert(result.status === "booted");
    assert(result.health.healthy === true);
  });

  await asyncTest("boot() recovers (safe-mode) when a module fails to init", async () => {
    const runtime = buildRuntime({
      configDefaults: { environment: "development" },
      clock: new FakeClock(),
    });
    const health = new HealthValidation();
    const recovery = new RecoveryManager();
    const pipeline = new StartupPipeline(runtime, health, recovery, {
      bootTimeoutSeconds: 0,
      healthCheckRetries: 0,
      recoveryMode: "safe-mode",
    });
    const result = await pipeline.boot([fakeModule("broken", { failInit: true })]);
    assert(result.status === "recovered");
    assert(result.recovery?.action === "entered_safe_mode");
  });

  await asyncTest("boot() halts when a health check fails and recovery_mode is halt", async () => {
    const runtime = buildRuntime({
      configDefaults: { environment: "development" },
      clock: new FakeClock(),
    });
    const health = new HealthValidation();
    health.register("never_ready", () => false);
    const recovery = new RecoveryManager();
    const pipeline = new StartupPipeline(runtime, health, recovery, {
      bootTimeoutSeconds: 0,
      healthCheckRetries: 0,
      recoveryMode: "halt",
    });
    const result = await pipeline.boot([fakeModule("a")]);
    assert(result.status === "halted");
  });

  await new Promise((r) => setTimeout(r, 10));
  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
