# 001_BOOTSTRAP — Status: Implemented (prototype/TypeScript stage)

Sequences system startup per `000_ARCHITECTURE/Specifications/settings.md` and `cli_commands.md`: load layered config, boot the Kernel (002) with a module set, run health checks, and hand off to recovery on failure — backing `rsos boot` / `rsos status` / `rsos doctor`.

| File | Provides |
|---|---|
| `config.ts` | `loadSettings()` — CLI flags > env vars (`RSOS_<SECTION>_<KEY>`) > TOML config file > compiled-in defaults, per RFC-0004. `env:VAR` secret references resolved at load, never stored inline. |
| `healthValidation.ts` | Named health-check registry with bounded retries (`bootstrap.health_check_retries`). |
| `recoveryManager.ts` | Maps a failed boot to `rollback` / `safe-mode` / `halt` per `bootstrap.recovery_mode`. |
| `startupPipeline.ts` | Orchestrates the above around Kernel's `KernelRuntime`/`ModuleLoader` (002) — Bootstrap does not reimplement module loading, only sequences it with a timeout, health checks, and recovery. |

Depends on `002_KERNEL` (Runtime, ModuleLoader, ConfigurationEngine, SystemClock) via compiled `dist/` imports, per the repo-wide convention.

## Known deviations from spec
- Config file parsing uses the `smol-toml` package rather than a hand-rolled TOML parser — this is real, general TOML, not a subset.
- `boot_timeout_seconds: 0` disables the timeout race (used by tests); any positive value races the real boot against a Kernel-clock-scheduled timeout.

Build/test: `npm install && npm test`.
