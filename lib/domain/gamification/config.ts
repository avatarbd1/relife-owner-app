import type {
  GamificationRole,
  NormalizedScorePolicy,
} from "@/lib/domain/gamification/rules";

export interface RoleScoreConfig extends NormalizedScorePolicy {
  scale: 100;
  targets: Record<string, number>;
}

export interface RewardRankConfig {
  rank1: number;
  rank2: number;
  rank3: number;
  participation: number;
}

export interface BonusTierConfig {
  key: string;
  min: number;
  max: number;
  bonus: number;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finiteNonNegative(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function parseNumericMap(value: unknown): Record<string, number> | null {
  const object = objectValue(value);
  if (!object) return null;
  const parsed: Record<string, number> = {};
  for (const [key, raw] of Object.entries(object)) {
    const number = finiteNonNegative(raw);
    if (number === null) return null;
    parsed[key] = number;
  }
  return parsed;
}

export function roleConfigKey(role: GamificationRole): string {
  return `score.role.${role.toLowerCase()}`;
}

/**
 * Parses Owner-controlled role scoring config. Invalid/missing config fails
 * closed by returning null; scoring callers must not substitute invented rules.
 */
export function parseRoleScoreConfig(
  configs: Record<string, unknown>,
  role: GamificationRole
): RoleScoreConfig | null {
  const raw = objectValue(configs[roleConfigKey(role)]);
  if (!raw) return null;
  if (raw.enabled !== true) return null;
  if (Number(raw.scale) !== 100) return null;

  const weights = parseNumericMap(raw.weights);
  const targets = parseNumericMap(raw.targets) || {};
  if (!weights || Object.keys(weights).length === 0) return null;

  const weightTotal = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (Math.abs(weightTotal - 1) > 0.0001) return null;

  return {
    role,
    enabled: true,
    scale: 100,
    weights,
    targets,
  };
}

export function parseRewardRankConfig(
  configs: Record<string, unknown>
): RewardRankConfig | null {
  const raw = objectValue(configs["reward.weekly_rank"]);
  if (!raw) return null;
  const rank1 = finiteNonNegative(raw.rank_1);
  const rank2 = finiteNonNegative(raw.rank_2);
  const rank3 = finiteNonNegative(raw.rank_3);
  const participation = finiteNonNegative(raw.participation);
  if (
    rank1 === null ||
    rank2 === null ||
    rank3 === null ||
    participation === null
  ) {
    return null;
  }
  return { rank1, rank2, rank3, participation };
}

export function parseBonusTiers(
  configs: Record<string, unknown>
): BonusTierConfig[] | null {
  const raw = objectValue(configs["bonus.tiers"]);
  if (!raw || !Array.isArray(raw.tiers)) return null;

  const tiers: BonusTierConfig[] = [];
  for (const item of raw.tiers) {
    const row = objectValue(item);
    if (!row) return null;
    const key = String(row.key || "").trim();
    const min = finiteNonNegative(row.min);
    const max = finiteNonNegative(row.max);
    const bonus = finiteNonNegative(row.bonus);
    if (!key || min === null || max === null || bonus === null || min > max || max > 100) {
      return null;
    }
    tiers.push({ key, min, max, bonus });
  }

  return tiers.length > 0 ? tiers : null;
}
