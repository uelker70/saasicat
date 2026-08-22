// Runs the rule table and reports everything at once.
//
// The one behavioural difference from the fifteen throws this replaces: an
// application with five missing bindings is told about five, in one error,
// instead of being told about one, restarted, and told about the next. Nothing
// else changes — the same configurations pass and the same ones fail.

import { PLATFORM_RULES, type PlatformConfiguration, type PlatformRule } from './rules.js';

export interface PlatformViolation {
    readonly id: string;
    readonly message: string;
    readonly docs: string;
}

/** Every rule that applies to this configuration and is not satisfied by it. */
export function findViolations(
    configuration: PlatformConfiguration,
    rules: readonly PlatformRule[] = PLATFORM_RULES,
): PlatformViolation[] {
    const violations: PlatformViolation[] = [];
    for (const rule of rules) {
        if (!rule.when(configuration)) continue;
        if (rule.assert(configuration)) continue;
        violations.push({
            id: rule.id,
            message: typeof rule.message === 'string' ? rule.message : rule.message(configuration),
            docs: rule.docs,
        });
    }
    return violations;
}

/**
 * The error a misconfigured application boots into.
 *
 * Carries the violations as data as well as prose: a consumer's own boot
 * diagnostics can group them, and the rule ids are stable enough to assert on.
 */
export class SaaSiCatConfigurationError extends Error {
    constructor(readonly violations: readonly PlatformViolation[]) {
        super(formatViolations(violations));
        this.name = 'SaaSiCatConfigurationError';
    }
}

function formatViolations(violations: readonly PlatformViolation[]): string {
    const heading =
        violations.length === 1
            ? 'SaaSiCatModule.forRoot: 1 configuration problem:'
            : `SaaSiCatModule.forRoot: ${violations.length} configuration problems:`;
    const body = violations
        .map((v, index) => `  ${index + 1}. [${v.id}] ${v.message}\n     → ${v.docs}`)
        .join('\n');
    return `${heading}\n${body}`;
}

/**
 * Throws once, naming every problem, or returns.
 *
 * A single violation from a rule that owns a typed error raises that error
 * instead of the aggregate — see `PlatformRule.error` for why that is the
 * whole of the previous behaviour rather than part of it.
 */
export function assertConfiguration(
    configuration: PlatformConfiguration,
    rules: readonly PlatformRule[] = PLATFORM_RULES,
): void {
    const violations = findViolations(configuration, rules);
    if (violations.length === 0) return;
    if (violations.length === 1) {
        const rule = rules.find((r) => r.id === violations[0]!.id);
        if (rule?.error) throw rule.error(configuration);
    }
    throw new SaaSiCatConfigurationError(violations);
}
