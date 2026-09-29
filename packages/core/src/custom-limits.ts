import type { FeatureKey, QuotaKey } from './plan-catalog.types.js';
import { readQuotaRecord, readQuotaValue } from './quota-value.js';

/**
 * A tenant's own limits beside its plan — a negotiated contract, a pilot.
 * `quotas[key]` replaces the plan's value for that quota, `-1` meaning
 * unlimited; `features` adds to the plan's. Stored as JSON in
 * `subscriptions.customLimits`.
 */
export interface CustomLimits {
    quotas?: Record<QuotaKey, number>;
    features?: FeatureKey[];
}

/**
 * The keys a stored `customLimits` value is read by. The normative admin API
 * schema (`CustomLimits` in `@saasicat/spec`) is held to the same list.
 */
export const CUSTOM_LIMITS_KEYS = ['quotas', 'features'] as const;

/** What a stored `customLimits` value gave, and what in it went unread. */
export interface ReadCustomLimits {
    limits: CustomLimits | null;
    /**
     * The parts of the stored value the platform does not read — a key it does
     * not know, or a `quotas`/`features` of the wrong kind. Empty when every
     * part was read.
     */
    unread: string[];
}

const NOT_AN_OBJECT = '(the value is not an object)';

/**
 * Reads a stored `customLimits` value the way the platform applies it.
 *
 * A shape the platform does not read is reported rather than refused: the
 * tenant keeps its plan's limits and goes on working, as a limit nothing can
 * count does not block anybody (`SC-ENTL-010`), and the caller says out loud
 * which limits were not applied. Quotas go through `readQuotaRecord`, the one
 * reading of a quota in JSON.
 */
export function readCustomLimits(value: unknown): ReadCustomLimits {
    if (value === null || value === undefined) return { limits: null, unread: [] };
    if (typeof value !== 'object' || Array.isArray(value)) {
        return { limits: null, unread: [NOT_AN_OBJECT] };
    }
    const limits: CustomLimits = {};
    const unread: string[] = [];
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (key === 'quotas' && isRecord(entry)) {
            // An unreadable value still counts as unlimited, as a plan's does —
            // and is named, since that is the one reading nobody asked for.
            limits.quotas = readQuotaRecord(entry);
            for (const [quota, amount] of Object.entries(entry)) {
                if (readQuotaValue(amount) === null) unread.push(`quotas.${quota}`);
            }
        } else if (key === 'features' && isFeatureList(entry)) {
            limits.features = [...entry];
        } else {
            unread.push(key);
        }
    }
    return { limits, unread };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFeatureList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Reads stored limits for an adapter, and reports what went unread once per
 * subscription — every entitlement read passes through here, so reporting on
 * each would bury the one line an operator needs under thousands.
 */
export function customLimitsReader(
    report: (line: string) => void,
): (subscriptionId: string, stored: unknown) => CustomLimits | null {
    const reported = new Set<string>();
    return (subscriptionId, stored) => {
        const { limits, unread } = readCustomLimits(stored);
        if (unread.length > 0 && !reported.has(subscriptionId)) {
            reported.add(subscriptionId);
            report(
                `Subscription ${subscriptionId}: customLimits carries ${unread.join(', ')}, which ` +
                    'the platform does not read, so these limits are not applied. It reads ' +
                    '{ quotas: { <quotaKey>: number }, features: string[] } (CustomLimits in ' +
                    '@saasicat/core).',
            );
        }
        return limits;
    };
}
