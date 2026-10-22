import { ResourceManager, QuotaExceededError } from "./resourceManager";

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

console.log("ResourceManager");
test("consume within quota succeeds and tracks usage", () => {
  const rm = new ResourceManager();
  rm.defineQuota("scheduler_ticks", "agent-1", 100);
  rm.consume("scheduler_ticks", "agent-1", 40);
  assert(rm.usage("scheduler_ticks", "agent-1").used === 40);
});

test("consuming beyond quota throws QuotaExceededError", () => {
  const rm = new ResourceManager();
  rm.defineQuota("scheduler_ticks", "agent-1", 100);
  rm.consume("scheduler_ticks", "agent-1", 90);
  try {
    rm.consume("scheduler_ticks", "agent-1", 20);
    throw new Error("should have thrown");
  } catch (e) {
    assert(e instanceof QuotaExceededError);
  }
});

test("release() frees up consumed quota", () => {
  const rm = new ResourceManager();
  rm.defineQuota("mem_arena_kb", "agent-1", 50);
  rm.consume("mem_arena_kb", "agent-1", 50);
  rm.release("mem_arena_kb", "agent-1", 20);
  assert(rm.usage("mem_arena_kb", "agent-1").used === 30);
  rm.consume("mem_arena_kb", "agent-1", 20); // should now fit
});

test("subjects without a defined quota are treated as unlimited but tracked", () => {
  const rm = new ResourceManager();
  rm.consume("api_calls", "agent-2", 5);
  assert(rm.usage("api_calls", "agent-2").used === 5);
  assert(rm.usage("api_calls", "agent-2").limit === Infinity);
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
