/**
 * RealityStateOS — Kernel / ModuleLoader
 * Loads a set of KernelModules in dependency order (topological sort),
 * calling init() then start() on each in order, and stop() in reverse order
 * on shutdown. Uses ServiceRegistry so modules can resolve each other by
 * name, and EventDispatcher to announce lifecycle events.
 */
import { ServiceRegistry } from "../../ServiceRegistry/dist/serviceRegistry";
import { EventDispatcher } from "../../EventDispatcher/dist/eventDispatcher";

export interface KernelModule {
  name: string;
  dependencies: string[];
  init(registry: ServiceRegistry): void | Promise<void>;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}

export class CircularDependencyError extends Error {
  constructor(cycle: string[]) {
    super(`circular dependency detected: ${cycle.join(" -> ")}`);
  }
}

export class ModuleLoader {
  private loadOrder: KernelModule[] = [];

  constructor(
    private readonly registry: ServiceRegistry = new ServiceRegistry(),
    private readonly events: EventDispatcher = new EventDispatcher()
  ) {}

  private topologicalSort(modules: KernelModule[]): KernelModule[] {
    const byName = new Map(modules.map((m) => [m.name, m]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const ordered: KernelModule[] = [];

    const visit = (mod: KernelModule, path: string[]): void => {
      if (visited.has(mod.name)) return;
      if (visiting.has(mod.name)) {
        throw new CircularDependencyError([...path, mod.name]);
      }
      visiting.add(mod.name);
      for (const depName of mod.dependencies) {
        const dep = byName.get(depName);
        if (dep) visit(dep, [...path, mod.name]);
      }
      visiting.delete(mod.name);
      visited.add(mod.name);
      ordered.push(mod);
    };

    for (const mod of modules) visit(mod, []);
    return ordered;
  }

  async load(modules: KernelModule[]): Promise<void> {
    this.loadOrder = this.topologicalSort(modules);
    for (const mod of this.loadOrder) {
      await mod.init(this.registry);
      this.registry.replace(mod.name, mod);
      this.events.emit("module.initialized", mod.name);
    }
    for (const mod of this.loadOrder) {
      await mod.start();
      this.events.emit("module.started", mod.name);
    }
  }

  async shutdown(): Promise<void> {
    for (const mod of [...this.loadOrder].reverse()) {
      await mod.stop();
      this.events.emit("module.stopped", mod.name);
    }
  }

  getLoadOrder(): string[] {
    return this.loadOrder.map((m) => m.name);
  }

  getRegistry(): ServiceRegistry {
    return this.registry;
  }

  getEvents(): EventDispatcher {
    return this.events;
  }
}
