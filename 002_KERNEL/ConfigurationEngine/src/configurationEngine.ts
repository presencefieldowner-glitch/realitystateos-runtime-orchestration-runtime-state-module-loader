/**
 * RealityStateOS — Kernel / ConfigurationEngine
 * Layered configuration: defaults < environment variables < explicit
 * overrides passed at construction. ModuleLoader reads Kernel-wide config
 * through here rather than each module parsing process.env itself.
 */

export type ConfigValue = string | number | boolean;
export type ConfigSchema = Record<string, ConfigValue>;

export class ConfigValidationError extends Error {}

export class ConfigurationEngine<T extends ConfigSchema> {
  private readonly resolved: T;

  constructor(defaults: T, envPrefix = "", overrides: Partial<T> = {}) {
    const fromEnv: Partial<T> = {};
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const envKey = envPrefix + String(key).toUpperCase();
      const raw = process.env[envKey];
      if (raw === undefined) continue;
      const defaultValue = defaults[key];
      if (typeof defaultValue === "number") {
        (fromEnv[key] as unknown) = Number(raw);
      } else if (typeof defaultValue === "boolean") {
        (fromEnv[key] as unknown) = raw.toLowerCase() === "true";
      } else {
        (fromEnv[key] as unknown) = raw;
      }
    }
    this.resolved = { ...defaults, ...fromEnv, ...overrides };
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.resolved[key];
  }

  all(): Readonly<T> {
    return this.resolved;
  }

  validate(required: (keyof T)[]): void {
    for (const key of required) {
      const value = this.resolved[key];
      if (value === undefined || value === null || value === "") {
        throw new ConfigValidationError(`missing required config value: ${String(key)}`);
      }
    }
  }
}
