/**
 * RealityStateOS — Bootstrap / StartupPipeline
 * Backs `rsos boot`: load config -> boot the Kernel with a given module set
 * -> run health checks -> ready, or hand off to RecoveryManager on failure.
 * Uses the Kernel's own KernelRuntime/ModuleLoader (002) — Bootstrap does
 * not reimplement module loading, only sequences it with health/recovery.
 */
import { KernelRuntime, KernelRuntimeOptions } from "../../002_KERNEL/Runtime/dist/runtime";
import { KernelModule } from "../../002_KERNEL/ModuleLoader/dist/moduleLoader";
import { ConfigSchema } from "../../002_KERNEL/ConfigurationEngine/dist/configurationEngine";
import { HealthValidation, HealthReport } from "./healthValidation";
import { RecoveryManager, RecoveryMode, RecoveryOutcome } from "./recoveryManager";

export type BootStatus = "booted" | "recovered" | "halted";

export interface BootResult {
  status: BootStatus;
  health: HealthReport;
  recovery?: RecoveryOutcome;
  durationMs: number;
}

export class BootTimeoutError extends Error {
  constructor(timeoutSeconds: number) {
    super(`boot did not complete within ${timeoutSeconds}s`);
  }
}

export class StartupPipeline<T extends ConfigSchema> {
  constructor(
    private readonly runtime: KernelRuntime<T>,
    private readonly health: HealthValidation,
    private readonly recovery: RecoveryManager,
    private readonly options: { bootTimeoutSeconds: number; healthCheckRetries: number; recoveryMode: RecoveryMode }
  ) {}

  async boot(modules: KernelModule[]): Promise<BootResult> {
    const started = this.runtime.clock.now();

    const timeoutMs = this.options.bootTimeoutSeconds * 1000;
    const bootPromise = this.runtime.boot(modules);
    const timeoutPromise = new Promise<never>((_, reject) => {
      this.runtime.clock.schedule(
        () => reject(new BootTimeoutError(this.options.bootTimeoutSeconds)),
        timeoutMs
      );
    });

    try {
      await Promise.race([bootPromise, timeoutMs > 0 ? timeoutPromise : bootPromise]);
    } catch (e) {
      const outcome = this.recovery.recover(this.options.recoveryMode, (e as Error).message);
      return {
        status: outcome.action === "halted" ? "halted" : "recovered",
        health: { healthy: false, checks: [] },
        recovery: outcome,
        durationMs: this.runtime.clock.now() - started,
      };
    }

    const health = await this.health.runAll(this.options.healthCheckRetries);
    const durationMs = this.runtime.clock.now() - started;

    if (!health.healthy) {
      const outcome = this.recovery.recover(
        this.options.recoveryMode,
        `health checks failed: ${health.checks.filter((c) => !c.healthy).map((c) => c.name).join(", ")}`
      );
      return {
        status: outcome.action === "halted" ? "halted" : "recovered",
        health,
        recovery: outcome,
        durationMs,
      };
    }

    this.recovery.recordLastKnownGood({
      configSnapshot: this.runtime.config.all(),
      moduleVersion: modules.map((m) => m.name).join(","),
    });

    return { status: "booted", health, durationMs };
  }

  async shutdown(): Promise<void> {
    await this.runtime.shutdown();
  }
}

export function buildRuntime<T extends ConfigSchema>(
  options: KernelRuntimeOptions<T>
): KernelRuntime<T> {
  return new KernelRuntime(options);
}
