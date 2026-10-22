/**
 * RealityStateOS — Kernel / Runtime
 * The single Kernel entry point: composes ServiceRegistry, EventDispatcher,
 * ModuleLoader, RuntimeMetrics, SystemClock, ConfigurationEngine, and
 * ResourceManager into one object. This is the TS-mechanical counterpart to
 * LakeTiticaca's Python `main.py` — the two are not bridged yet (that's a
 * 004_VERIFIED_BUS-level concern), but conceptually both are "the Kernel"
 * from their respective language runtimes.
 */
import { ServiceRegistry } from "../../ServiceRegistry/dist/serviceRegistry";
import { EventDispatcher } from "../../EventDispatcher/dist/eventDispatcher";
import { ModuleLoader, KernelModule } from "../../ModuleLoader/dist/moduleLoader";
import { RuntimeMetrics } from "../../RuntimeMetrics/dist/runtimeMetrics";
import { SystemClock, Clock } from "../../SystemClock/dist/systemClock";
import { ConfigurationEngine, ConfigSchema } from "../../ConfigurationEngine/dist/configurationEngine";
import { ResourceManager } from "../../ResourceManager/dist/resourceManager";

export interface KernelRuntimeOptions<T extends ConfigSchema> {
  configDefaults: T;
  configEnvPrefix?: string;
  configOverrides?: Partial<T>;
  clock?: Clock;
}

export class KernelRuntime<T extends ConfigSchema> {
  readonly registry: ServiceRegistry;
  readonly events: EventDispatcher;
  readonly loader: ModuleLoader;
  readonly metrics: RuntimeMetrics;
  readonly clock: Clock;
  readonly config: ConfigurationEngine<T>;
  readonly resources: ResourceManager;

  constructor(options: KernelRuntimeOptions<T>) {
    this.registry = new ServiceRegistry();
    this.events = new EventDispatcher();
    this.loader = new ModuleLoader(this.registry, this.events);
    this.metrics = new RuntimeMetrics();
    this.clock = options.clock ?? new SystemClock();
    this.config = new ConfigurationEngine(
      options.configDefaults,
      options.configEnvPrefix ?? "",
      options.configOverrides ?? {}
    );
    this.resources = new ResourceManager();

    this.registry.register("metrics", this.metrics);
    this.registry.register("clock", this.clock);
    this.registry.register("config", this.config);
    this.registry.register("resources", this.resources);

    this.events.on("module.started", () => this.metrics.increment("modules.started"));
  }

  async boot(modules: KernelModule[]): Promise<void> {
    await this.loader.load(modules);
    this.metrics.gauge("modules.loaded", modules.length);
  }

  async shutdown(): Promise<void> {
    await this.loader.shutdown();
  }

  snapshot(): { loadOrder: string[]; metrics: ReturnType<RuntimeMetrics["snapshot"]> } {
    return {
      loadOrder: this.loader.getLoadOrder(),
      metrics: this.metrics.snapshot(),
    };
  }
}
