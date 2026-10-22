/**
 * RealityStateOS — Bootstrap / LayeredConfig
 * Implements RFC-0004 (settings.md) precedence order: CLI flags > env vars
 * (RSOS_<SECTION>_<KEY>) > instance config file (TOML) > compiled-in module
 * defaults. Every setting has a default, so the system boots with zero
 * config present, per the spec's Rules section.
 */
import { readFileSync, existsSync } from "fs";
import { parse as parseToml } from "smol-toml";

export type TomlTable = Record<string, unknown>;

export const DEFAULT_SETTINGS: TomlTable = {
  system: { node_id: "", environment: "development", log_level: "info", timezone: "UTC" },
  kernel: {
    max_agents: 64,
    max_threads_per_agent: 4,
    scheduler: "preemptive",
    resource_quota_cpu_pct: 80,
    resource_quota_mem_mb: 4096,
  },
  bootstrap: { boot_timeout_seconds: 30, health_check_retries: 3, recovery_mode: "rollback" },
  verified_bus: { consensus_mode: "raft", event_retention_days: 365, max_throughput_eps: 10000 },
  storage: {
    postgres_url: "env:DATABASE_URL",
    graph_backend: "postgres-age",
    vector_backend: "pgvector",
    cache_backend: "redis",
    backup_schedule_cron: "0 3 * * *",
    backup_retention_days: 30,
  },
  security: {
    signature_algorithm: "ed25519",
    require_mfa: true,
    session_ttl_minutes: 60,
    password_min_length: 12,
    allowed_auth_methods: ["passkey", "oauth", "password"],
  },
  presence: { confidence_decay_half_life_minutes: 30, min_confidence_to_mark_present: 0.6 },
  intelligence: {
    default_llm_provider: "anthropic",
    max_plan_steps: 25,
    require_approval_for: ["payment", "delete", "external_send"],
  },
  interface: {
    rest_port: 8080,
    graphql_port: 8081,
    websocket_port: 8082,
    cors_allowed_origins: ["*"],
  },
  operations: { metrics_backend: "prometheus", tracing_enabled: true, audit_log_retention_days: 730 },
};

function deepMerge(base: TomlTable, override: TomlTable): TomlTable {
  const out: TomlTable = { ...base };
  for (const key of Object.keys(override)) {
    const bv = base[key];
    const ov = override[key];
    if (
      bv && ov &&
      typeof bv === "object" && !Array.isArray(bv) &&
      typeof ov === "object" && !Array.isArray(ov)
    ) {
      out[key] = deepMerge(bv as TomlTable, ov as TomlTable);
    } else {
      out[key] = ov;
    }
  }
  return out;
}

/** Resolve `env:VAR_NAME` secret references, per settings.md — secrets are
 * never stored directly in config files. */
export function resolveSecretRefs(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("env:")) {
    const varName = value.slice(4);
    return process.env[varName] ?? value;
  }
  if (Array.isArray(value)) return value.map(resolveSecretRefs);
  if (value && typeof value === "object") {
    const out: TomlTable = {};
    for (const [k, v] of Object.entries(value as TomlTable)) out[k] = resolveSecretRefs(v);
    return out;
  }
  return value;
}

/** Parse `RSOS_<SECTION>_<KEY>=value` environment variables into a nested table. */
export function envOverrides(env: NodeJS.ProcessEnv = process.env): TomlTable {
  const out: TomlTable = {};
  const prefix = "RSOS_";
  for (const [key, raw] of Object.entries(env)) {
    if (!key.startsWith(prefix) || raw === undefined) continue;
    const rest = key.slice(prefix.length).toLowerCase();
    const sepIdx = rest.indexOf("_");
    if (sepIdx === -1) continue;
    const section = rest.slice(0, sepIdx);
    const field = rest.slice(sepIdx + 1);
    const sectionTable = (out[section] as TomlTable) ?? {};
    sectionTable[field] = coerce(raw);
    out[section] = sectionTable;
  }
  return out;
}

function coerce(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && !isNaN(Number(raw))) return Number(raw);
  return raw;
}

export interface LoadOptions {
  configFilePath?: string;
  cliFlags?: TomlTable;
  env?: NodeJS.ProcessEnv;
}

/** Resolve final settings per the documented precedence order (highest wins):
 * 1. CLI flags, 2. env vars, 3. instance config file, 4. compiled-in defaults. */
export function loadSettings(options: LoadOptions = {}): TomlTable {
  let resolved = DEFAULT_SETTINGS;

  if (options.configFilePath && existsSync(options.configFilePath)) {
    const raw = readFileSync(options.configFilePath, "utf-8");
    resolved = deepMerge(resolved, parseToml(raw) as TomlTable);
  }

  resolved = deepMerge(resolved, envOverrides(options.env ?? process.env));

  if (options.cliFlags) {
    resolved = deepMerge(resolved, options.cliFlags);
  }

  return resolveSecretRefs(resolved) as TomlTable;
}
