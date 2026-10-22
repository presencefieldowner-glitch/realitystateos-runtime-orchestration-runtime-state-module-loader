import { ConfigurationEngine, ConfigValidationError } from "./configurationEngine";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
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

console.log("ConfigurationEngine");
test("defaults are used when nothing overrides them", () => {
  const cfg = new ConfigurationEngine({ maxConcurrent: 4, nodeId: "local" });
  assert(cfg.get("maxConcurrent") === 4);
  assert(cfg.get("nodeId") === "local");
});

test("environment variables override defaults with correct type coercion", () => {
  process.env.KERNEL_MAXCONCURRENT = "8";
  const cfg = new ConfigurationEngine({ maxConcurrent: 4 }, "KERNEL_");
  assert(cfg.get("maxConcurrent") === 8, `expected 8, got ${cfg.get("maxConcurrent")}`);
  delete process.env.KERNEL_MAXCONCURRENT;
});

test("explicit overrides win over both defaults and env", () => {
  process.env.KERNEL_NODEID = "from-env";
  const cfg = new ConfigurationEngine({ nodeId: "default" }, "KERNEL_", { nodeId: "explicit" });
  assert(cfg.get("nodeId") === "explicit");
  delete process.env.KERNEL_NODEID;
});

test("validate() throws on missing required fields", () => {
  const cfg = new ConfigurationEngine({ secret: "" });
  try {
    cfg.validate(["secret"]);
    throw new Error("should have thrown");
  } catch (e) {
    assert(e instanceof ConfigValidationError);
  }
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
