import { KernelRuntime } from "./runtime";
import { KernelModule } from "../../ModuleLoader/dist/moduleLoader";
import { ServiceRegistry } from "../../ServiceRegistry/dist/serviceRegistry";
import { FakeClock } from "../../SystemClock/dist/systemClock";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
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

function assert(cond: boolean, msg = "assertion failed"): void {
  if (!cond) throw new Error(msg);
}

function makeModule(name: string, dependencies: string[] = []): KernelModule {
  return {
    name,
    dependencies,
    init: (_registry: ServiceRegistry) => {},
    start: () => {},
    stop: () => {},
  };
}

async function main() {
  console.log("Runtime (KernelRuntime)");

  await test("core services are pre-registered on the ServiceRegistry", () => {
    const rt = new KernelRuntime({ configDefaults: { nodeId: "n1" } });
    assert(rt.registry.resolve("metrics") === rt.metrics);
    assert(rt.registry.resolve("clock") === rt.clock);
  });

  await test("boot() loads modules and updates metrics", async () => {
    const rt = new KernelRuntime({ configDefaults: { nodeId: "n1" } });
    await rt.boot([makeModule("A"), makeModule("B", ["A"])]);
    const snap = rt.snapshot();
    assert(snap.loadOrder.join(",") === "A,B");
    assert(snap.metrics.gauges["modules.loaded"] === 2);
    assert(snap.metrics.counters["modules.started"] === 2);
  });

  await test("a FakeClock can be injected for deterministic tests", () => {
    const fake = new FakeClock();
    const rt = new KernelRuntime({ configDefaults: { nodeId: "n1" }, clock: fake });
    assert(rt.clock === fake);
  });

  await test("config is accessible and respects overrides", () => {
    const rt = new KernelRuntime({
      configDefaults: { nodeId: "default" },
      configOverrides: { nodeId: "override" },
    });
    assert(rt.config.get("nodeId") === "override");
  });

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
