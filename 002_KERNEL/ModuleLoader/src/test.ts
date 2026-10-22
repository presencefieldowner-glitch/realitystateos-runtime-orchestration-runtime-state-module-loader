import { ModuleLoader, KernelModule, CircularDependencyError } from "./moduleLoader";
import { ServiceRegistry } from "../../ServiceRegistry/dist/serviceRegistry";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void): Promise<void> | void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result
        .then(() => {
          passed++;
          console.log(`  ok  - ${name}`);
        })
        .catch((e) => {
          failed++;
          console.log(`FAIL - ${name}`);
          console.log(`       ${(e as Error).message}`);
        });
    }
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

function makeModule(name: string, dependencies: string[], calls: string[]): KernelModule {
  return {
    name,
    dependencies,
    init: (_registry: ServiceRegistry) => {
      calls.push(`${name}.init`);
    },
    start: () => {
      calls.push(`${name}.start`);
    },
    stop: () => {
      calls.push(`${name}.stop`);
    },
  };
}

async function main() {
  console.log("ModuleLoader");

  await test("loads modules in dependency order (deps init before dependents)", async () => {
    const calls: string[] = [];
    const a = makeModule("A", [], calls);
    const b = makeModule("B", ["A"], calls);
    const loader = new ModuleLoader();
    await loader.load([b, a]); // intentionally out of order
    assert(loader.getLoadOrder().indexOf("A") < loader.getLoadOrder().indexOf("B"));
    assert(calls.indexOf("A.init") < calls.indexOf("B.init"));
  });

  await test("start() runs after all modules are initialized", async () => {
    const calls: string[] = [];
    const a = makeModule("A", [], calls);
    const b = makeModule("B", ["A"], calls);
    const loader = new ModuleLoader();
    await loader.load([a, b]);
    assert(calls.indexOf("B.init") < calls.indexOf("A.start"));
  });

  await test("shutdown() stops modules in reverse load order", async () => {
    const calls: string[] = [];
    const a = makeModule("A", [], calls);
    const b = makeModule("B", ["A"], calls);
    const loader = new ModuleLoader();
    await loader.load([a, b]);
    await loader.shutdown();
    assert(calls.indexOf("B.stop") < calls.indexOf("A.stop"));
  });

  await test("circular dependencies are detected and rejected", async () => {
    const calls: string[] = [];
    const a = makeModule("A", ["B"], calls);
    const b = makeModule("B", ["A"], calls);
    const loader = new ModuleLoader();
    try {
      await loader.load([a, b]);
      throw new Error("should have thrown");
    } catch (e) {
      assert(e instanceof CircularDependencyError);
    }
  });

  await test("loaded modules are resolvable via the ServiceRegistry", async () => {
    const calls: string[] = [];
    const a = makeModule("A", [], calls);
    const loader = new ModuleLoader();
    await loader.load([a]);
    assert(loader.getRegistry().resolve("A") === a);
  });

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
