import { cosmiconfig } from "cosmiconfig";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import yaml from "js-yaml";

export interface ProviderConfig {
  apiKey?: string;
  rpmLimit?: number;
  baseUrl?: string;
}

export interface ModelsConfig {
  default: string;
  longContext: string;
  codeEdit: string;
  subAgent: string;
}

export interface CostConfig {
  maxPerSessionCents: number;
  warnAtCents: number;
  preferFreeModels: boolean;
}

export interface PermissionsConfig {
  defaultMode: "default" | "acceptEdits" | "plan" | "dontAsk";
  alwaysAllow: string[];
  alwaysDeny: string[];
}

export interface SupercodeConfig {
  version: number;
  models: ModelsConfig;
  providers: {
    gemini?: ProviderConfig;
    openai?: ProviderConfig;
    openrouter?: ProviderConfig;
  };
  costs: CostConfig;
  permissions: PermissionsConfig;
  telemetry: { enabled: boolean };
}

const DEFAULT_CONFIG: SupercodeConfig = {
  version: 1,
  models: {
    default: "gemini-2.5-flash",
    longContext: "gemini-2.5-pro",
    codeEdit: "codex-latest",
    subAgent: "gemini-2.5-flash",
  },
  providers: {
    gemini: { rpmLimit: 60 },
    openai: {},
    openrouter: { baseUrl: "https://openrouter.ai/api/v1" },
  },
  costs: {
    maxPerSessionCents: 50,
    warnAtCents: 10,
    preferFreeModels: true,
  },
  permissions: {
    defaultMode: "default",
    alwaysAllow: ["Read", "Glob", "Grep", "TodoRead", "TodoWrite"],
    alwaysDeny: [],
  },
  telemetry: { enabled: false },
};

function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.startsWith("$") ? process.env[obj.slice(1)] ?? undefined : obj;
  }
  if (Array.isArray(obj)) return obj.map(resolveEnvVars);
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k,
        resolveEnvVars(v),
      ])
    );
  }
  return obj;
}

export function loadConfig(): SupercodeConfig {
  const configPath = join(homedir(), ".supercode", "config.yaml");
  let fileConfig: Partial<SupercodeConfig> = {};

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      fileConfig = resolveEnvVars(yaml.load(raw)) as Partial<SupercodeConfig>;
    } catch {
      // silently fall back to defaults
    }
  }

  // Layer env vars on top
  const config: SupercodeConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    providers: {
      gemini: {
        ...DEFAULT_CONFIG.providers.gemini,
        ...fileConfig.providers?.gemini,
        apiKey:
          process.env.GEMINI_API_KEY ??
          fileConfig.providers?.gemini?.apiKey,
      },
      openai: {
        ...DEFAULT_CONFIG.providers.openai,
        ...fileConfig.providers?.openai,
        apiKey:
          process.env.OPENAI_API_KEY ??
          fileConfig.providers?.openai?.apiKey,
      },
      openrouter: {
        ...DEFAULT_CONFIG.providers.openrouter,
        ...fileConfig.providers?.openrouter,
        apiKey:
          process.env.OPENROUTER_API_KEY ??
          fileConfig.providers?.openrouter?.apiKey,
        baseUrl:
          process.env.OPENROUTER_BASE_URL ??
          fileConfig.providers?.openrouter?.baseUrl ??
          "https://openrouter.ai/api/v1",
      },
    },
    models: {
      ...DEFAULT_CONFIG.models,
      ...fileConfig.models,
    },
    costs: {
      ...DEFAULT_CONFIG.costs,
      ...fileConfig.costs,
    },
    permissions: {
      ...DEFAULT_CONFIG.permissions,
      ...fileConfig.permissions,
    },
  };

  return config;
}
