// The one categorical palette, and the one way to tint from it.
//
// Five components used to carry their own six-colour ramp of hex literals —
// `PlanList` and `PlanMatrix` byte for byte identical, `tenants/format.ts`
// silently different (the same plan got one colour on the plans page and
// another on the tenants page), `PromoCodesPage`, `MarketingPromotionsTab` and
// `discovery-ui.ts` each with a third opinion. Every one of them was applied
// through a `:style` binding, so none of them followed the theme: the plan mark
// measured 2.96:1 on a dark surface and was carried as a named contrast
// exception because there was no role to point it at.
//
// There is now one ramp, it lives in the theme, and it has a value per theme.
//
// A consumer may still hand in its own colours — `planAccents` is a public prop
// and takes any CSS colour. That keeps working because every helper here mixes
// rather than concatenates: `#7c3aed` + `'15'` needs a hex, and
// `color-mix(in srgb, X 8%, transparent)` needs only a colour, which a
// `var(--sa-color-identity-2)` also is.

/**
 * The categorical ramp, in the order an unnamed series should walk it.
 *
 * Seven entries, six of them hues plus the neutral. Long enough that a realistic
 * plan list does not wrap, short enough that the colours stay tellable apart —
 * a longer ramp is not a better one, it is a wheel of near-neighbours.
 */
export const IDENTITY_ACCENTS: readonly string[] = [
    'var(--sa-color-identity-1)',
    'var(--sa-color-identity-2)',
    'var(--sa-color-identity-3)',
    'var(--sa-color-identity-4)',
    'var(--sa-color-identity-5)',
    'var(--sa-color-identity-6)',
];

/**
 * The same ramp as concrete colours, for values that are STORED rather than
 * painted.
 *
 * A promotion's colour is data: the operator picks it, it goes over the wire,
 * a database column holds it, and `CreatePromotionDto` caps it at 16
 * characters. `var(--sa-color-identity-1)` is 28 and would fail validation on
 * every create — which is exactly what happened when the swatches above were
 * pointed at the token form. A token is paint; this is a value.
 *
 * These are the LIGHT theme's values, because a stored colour has to mean one
 * thing wherever it is later rendered. `identity-accents-match-theme.test.js`
 * binds each one to its role, so the two halves of the ramp cannot drift.
 */
export const IDENTITY_ACCENT_VALUES: readonly string[] = [
    '#1d4ed8',
    '#6d28d9',
    '#047857',
    '#b45309',
    '#0369a1',
    '#b91c1c',
];

/** The stored counterpart of `IDENTITY_NEUTRAL`. */
export const IDENTITY_NEUTRAL_VALUE = '#64748b';

/** For "no identity yet", and for the entry tier that should stay quiet. */
export const IDENTITY_NEUTRAL = 'var(--sa-color-identity-neutral)';

/**
 * The accent for the nth member of a series, wrapping when the series is longer
 * than the ramp.
 *
 * A negative or non-finite index yields the neutral rather than throwing:
 * callers derive it from `findIndex`, which answers -1 for "not in the list",
 * and a missing row is exactly the "no identity yet" case.
 */
export function identityAccentAt(index: number): string {
    if (!Number.isFinite(index) || index < 0) return IDENTITY_NEUTRAL;
    return IDENTITY_ACCENTS[Math.floor(index) % IDENTITY_ACCENTS.length]!;
}

/**
 * The stable accent for a well-known key, so the standard plan tiers look the
 * same on every screen that draws them.
 *
 * The tiers below are the ones the three former maps agreed on. `STARTER` and
 * `BASIC` share the neutral because both are the entry tier — the earlier maps
 * gave them two different greys, which said "these differ" about two things
 * that do not.
 */
const WELL_KNOWN: Readonly<Record<string, string>> = {
    STARTER: IDENTITY_NEUTRAL,
    BASIC: IDENTITY_NEUTRAL,
    STANDARD: 'var(--sa-color-identity-1)',
    PRO: 'var(--sa-color-identity-2)',
    PROFESSIONAL: 'var(--sa-color-identity-2)',
    BUSINESS: 'var(--sa-color-identity-5)',
    ENTERPRISE: 'var(--sa-color-identity-3)',
};

/**
 * The accent for a key, in the order the product decides it.
 *
 * 1. what the consumer supplied, because it is their brand;
 * 2. the well-known tier, so `ENTERPRISE` is the same colour everywhere;
 * 3. the ramp position, so an unknown key still gets a stable colour;
 * 4. the neutral.
 */
export function identityAccentFor(
    key: string,
    overrides: Readonly<Record<string, string>> = {},
    index = -1,
): string {
    return overrides[key] ?? WELL_KNOWN[key] ?? identityAccentAt(index);
}

/**
 * The three-part chip style every one of these sites was hand-rolling: a wash
 * of the accent, the accent as text, a firmer edge of it.
 *
 * `color-mix()` rather than the `accent + '15'` string concatenation it
 * replaces. That trick only worked on a six-digit hex — it silently produced
 * garbage for `rgb()`, for a named colour and for anything a consumer might
 * reasonably pass — and it could never have worked for a `var()`, which is why
 * these palettes could not follow the theme in the first place.
 */
export function identityChipStyle(accent: string): Record<string, string> {
    return {
        background: `color-mix(in srgb, ${accent} 8%, transparent)`,
        color: accent,
        borderColor: `color-mix(in srgb, ${accent} 20%, transparent)`,
    };
}
