/**
 * RealityStateOS — Bootstrap / HealthValidation
 * Backs `rsos doctor` and `rsos status`: a registry of named health checks
 * run during boot (and on demand) with bounded retries, per
 * settings.md's `bootstrap.health_check_retries`.
 */

export type HealthCheckFn = () => boolean | Promise<boolean>;

export interface HealthCheckResult {
  name: string;
  healthy: boolean;
  attempts: number;
}

export interface HealthReport {
  healthy: boolean;
  checks: HealthCheckResult[];
}

export class HealthValidation {
  private checks = new Map<string, HealthCheckFn>();

  register(name: string, check: HealthCheckFn): void {
    this.checks.set(name, check);
  }

  unregister(name: string): void {
    this.checks.delete(name);
  }

  async runAll(retries = 0): Promise<HealthReport> {
    const results: HealthCheckResult[] = [];
    for (const [name, check] of this.checks) {
      let attempts = 0;
      let healthy = false;
      do {
        attempts++;
        try {
          healthy = await check();
        } catch {
          healthy = false;
        }
      } while (!healthy && attempts <= retries);
      results.push({ name, healthy, attempts });
    }
    return { healthy: results.every((r) => r.healthy), checks: results };
  }
}
