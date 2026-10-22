/**
 * RealityStateOS — Kernel / ResourceManager
 * Accounting/quota tracking for logical resources (scheduler ticks consumed,
 * memory-arena budget, API call rate, etc.) per subject. This is bookkeeping,
 * NOT real OS-level resource enforcement (no cgroups/ulimits in a sandboxed
 * Node runtime) — real enforcement is a native/Rust-port concern.
 */

export class QuotaExceededError extends Error {
  constructor(resource: string, subject: string, requested: number, available: number) {
    super(
      `subject '${subject}' requested ${requested} of resource '${resource}' but only ${available} available`
    );
  }
}

interface QuotaState {
  limit: number;
  used: number;
}

export class ResourceManager {
  // key: `${resource}:${subject}`
  private quotas = new Map<string, QuotaState>();

  private key(resource: string, subject: string): string {
    return `${resource}:${subject}`;
  }

  defineQuota(resource: string, subject: string, limit: number): void {
    this.quotas.set(this.key(resource, subject), { limit, used: 0 });
  }

  consume(resource: string, subject: string, amount: number): void {
    const key = this.key(resource, subject);
    const state = this.quotas.get(key);
    if (!state) {
      // No quota defined for this subject — treat as unlimited, but still track usage.
      this.quotas.set(key, { limit: Infinity, used: amount });
      return;
    }
    const available = state.limit - state.used;
    if (amount > available) {
      throw new QuotaExceededError(resource, subject, amount, available);
    }
    state.used += amount;
  }

  release(resource: string, subject: string, amount: number): void {
    const state = this.quotas.get(this.key(resource, subject));
    if (!state) return;
    state.used = Math.max(0, state.used - amount);
  }

  usage(resource: string, subject: string): { used: number; limit: number } {
    const state = this.quotas.get(this.key(resource, subject)) ?? { used: 0, limit: Infinity };
    return { used: state.used, limit: state.limit };
  }
}
