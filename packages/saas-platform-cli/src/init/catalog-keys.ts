// What the catalogue schema allows as a key — asked of the schema, not of a copy.
//
// `saasicat init` writes `config/saas.yaml`, and the platform validates that
// file against `plan-catalog.schema.json` on the first boot. Every rule the
// generator does not apply is a rule the integrator meets *after* every file is
// written and `app.module.ts` is patched.
//
// Three of them are in here, and each one produced a non-booting application:
//
//   - `projectKey` must match `^[a-z][a-z0-9-]{1,30}$`. `--project-key=x` — the
//     command's own documented example — is one character and fails it.
//   - a quota key must match `^[a-z][A-Za-z0-9]*$` under
//     `additionalProperties: false`, so `--quota=active-seats:Seat` is rejected
//     as an additional property. That was this package's own test fixture.
//   - `quotas` is required on every plan and carries `minProperties: 1`, so
//     `init` without `--quota` cannot produce a loadable catalogue at all.
//
// The rules are imported rather than restated: `@saasicat/spec` is the schema
// the loader reads (`billing/plan-catalog-loader.ts` imports the same object),
// so this cannot drift from it. A second copy of a regex would be the defect
// one level up.

import { planCatalogSchema } from '@saasicat/spec';

interface StringSchema {
    readonly pattern?: string;
}

interface PlanDefSchema {
    readonly required?: readonly string[];
    readonly properties?: {
        readonly quotas?: {
            readonly patternProperties?: Record<string, unknown>;
            readonly minProperties?: number;
        };
    };
}

interface CatalogSchema {
    readonly properties?: { readonly projectKey?: StringSchema };
    readonly $defs?: { readonly PlanDef?: PlanDefSchema };
}

const schema = planCatalogSchema as CatalogSchema;

/**
 * Refuses to guess when the schema does not say.
 *
 * Not a fallback value: guessing here reintroduces the copy this module exists
 * to avoid, and would quietly accept what the loader refuses.
 */
function required<T>(value: T | undefined, what: string): T {
    if (value === undefined) {
        throw new Error(
            `plan-catalog.schema.json declares no ${what} — @saasicat/spec and ` +
                '@saasicat/cli are out of step.',
        );
    }
    return value;
}

/** The pattern `plan-catalog.schema.json` puts on `projectKey`. */
export function projectKeyPattern(): RegExp {
    return new RegExp(required(schema.properties?.projectKey?.pattern, 'pattern for projectKey'));
}

/** The pattern it puts on the keys inside a plan's `quotas` object. */
export function quotaKeyPattern(): RegExp {
    const patterns = Object.keys(
        required(schema.$defs?.PlanDef?.properties?.quotas?.patternProperties, 'quota key pattern'),
    );
    if (patterns.length !== 1) {
        throw new Error(
            `plan-catalog.schema.json declares ${patterns.length} quota key patterns; ` +
                'this derivation can express one.',
        );
    }
    return new RegExp(patterns[0]!);
}

/** How many quotas a plan must declare — 1 today, and read rather than assumed. */
export function minimumQuotasPerPlan(): number {
    return required(schema.$defs?.PlanDef?.properties?.quotas?.minProperties, 'minProperties');
}

/**
 * Refuses a project key the platform will refuse, while nothing is written yet.
 *
 * The message carries the pattern rather than a prose paraphrase, because the
 * paraphrase is what goes stale.
 */
export function assertValidProjectKey(projectKey: string): void {
    const pattern = projectKeyPattern();
    if (pattern.test(projectKey)) return;
    throw new Error(
        `--project-key=${projectKey} is not a valid project key. ` +
            `It has to match ${pattern.source} — lower case, starting with a letter, ` +
            'at least two characters. The platform validates config/saas.yaml against ' +
            'the same pattern at boot, so this would fail after every file was written.',
    );
}

/** The same, for a quota key. `additionalProperties: false` makes it a hard rule. */
export function assertValidQuotaKey(quotaKey: string): void {
    const pattern = quotaKeyPattern();
    if (pattern.test(quotaKey)) return;
    throw new Error(
        `--quota=${quotaKey}:… is not a valid quota key. ` +
            `It has to match ${pattern.source} — lower camel case, no separators, so ` +
            "`activeSeats` rather than `active-seats` or `active_seats`. The plan's " +
            '`quotas` object forbids additional properties, so the platform rejects ' +
            'config/saas.yaml at boot otherwise.',
    );
}
