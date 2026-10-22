/**
 * RealityStateOS — Bootstrap / RecoveryManager
 * When StartupPipeline health checks fail, decides what happens next per
 * settings.md's `bootstrap.recovery_mode`: rollback | safe-mode | halt.
 */

export type RecoveryMode = "rollback" | "safe-mode" | "halt";

export interface RecoveryOutcome {
  mode: RecoveryMode;
  action: "rolled_back" | "entered_safe_mode" | "halted";
  detail: string;
}

export class UnknownRecoveryModeError extends Error {
  constructor(mode: string) {
    super(`unknown recovery_mode: "${mode}" (expected rollback | safe-mode | halt)`);
  }
}

export interface LastKnownGood {
  configSnapshot: Record<string, unknown>;
  moduleVersion: string;
}

export class RecoveryManager {
  constructor(private lastKnownGood?: LastKnownGood) {}

  recover(mode: RecoveryMode, reason: string): RecoveryOutcome {
    switch (mode) {
      case "rollback":
        if (!this.lastKnownGood) {
          return {
            mode,
            action: "halted",
            detail: `rollback requested but no last-known-good snapshot exists; halting instead (${reason})`,
          };
        }
        return {
          mode,
          action: "rolled_back",
          detail: `restored last-known-good config (module ${this.lastKnownGood.moduleVersion}) after: ${reason}`,
        };
      case "safe-mode":
        return {
          mode,
          action: "entered_safe_mode",
          detail: `booting with non-essential modules disabled after: ${reason}`,
        };
      case "halt":
        return { mode, action: "halted", detail: `boot halted after: ${reason}` };
      default:
        throw new UnknownRecoveryModeError(mode);
    }
  }

  recordLastKnownGood(snapshot: LastKnownGood): void {
    this.lastKnownGood = snapshot;
  }
}
