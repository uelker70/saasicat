export interface EffectiveLimitsSnapshot {
    plan: string;
    quotas: Record<string, number>;
    features: string[];
}
