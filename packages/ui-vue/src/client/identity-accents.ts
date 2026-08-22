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
 * How much of the accent survives when the accent becomes TEXT.
 *
 * The remainder comes from `--sa-color-fg-heading`, which is near-black in the
 * light theme and near-white in the dark one. So a single expression darkens
 * the accent in one theme and lightens it in the other, which is the same move
 * `--sa-color-accent-strong` makes for the brand.
 *
 * It is not the brand's 82 %, and the difference is the point. The brand is one
 * curated colour, checked by a person against both surfaces. This helper's
 * input is uncontrolled: a plan's stored hex, a consumer's `planAccents`, a
 * colour an operator picked out of a swatch. A share tuned for one colour is
 * not a bound over all of them, and 82 % measurably is not one — three of the
 * six colours the promotion editor itself stores stay under 3:1 on a raised
 * dark card (2.81 to 2.98), and a light brand pick such as lime-400 only
 * reaches 2.03:1 on a raised light one.
 *
 * At half, every colour in sRGB stays at or above 3.3:1 in light and 3.7:1 in
 * dark, both extremes being the degenerate accents — an accent that already IS
 * the theme's own extreme cannot be pushed further from the surface, so pure
 * white decides the light bound and pure black the dark one. That is a bound
 * over the whole cube rather than over a sample, which is what an uncontrolled
 * input needs. `theme-role-contrast` measures it and fails if this share rises.
 */
const READABLE_ACCENT_SHARE = 50;

/**
 * The three-part chip style every one of these sites was hand-rolling: a wash
 * of the accent, a readable rendering of the accent as text, a firmer edge.
 *
 * `color-mix()` rather than the `accent + '15'` string concatenation it
 * replaces. That trick only worked on a six-digit hex — it silently produced
 * garbage for `rgb()`, for a named colour and for anything a consumer might
 * reasonably pass — and it could never have worked for a `var()`, which is why
 * these palettes could not follow the theme in the first place.
 *
 * The text is a mix rather than the accent itself. A `var(--sa-color-identity-N)`
 * would not need that — the ramp has a value per theme, so it already suits both
 * surfaces. A concrete hex has one value for both, and a concrete hex is what
 * reaches here from a stored plan colour or from a consumer's `planAccents`; on
 * whichever theme it lands nearest the surface it fades into its own wash.
 *
 * Callers may still override any of the three. `PromoCodeDialogFields` replaces
 * the border with the plan's undiluted colour, and `PlanDiffCard` takes only the
 * wash and the edge — an inline style beats the class beneath it, which is how
 * the chip kept its own unreadable foreground through a fix applied to the
 * selected-state rules around it.
 */
export function identityChipStyle(accent: string): Record<string, string> {
    return {
        background: `color-mix(in srgb, ${accent} 8%, transparent)`,
        color: `color-mix(in srgb, ${accent} ${READABLE_ACCENT_SHARE}%, var(--sa-color-fg-heading))`,
        borderColor: `color-mix(in srgb, ${accent} 20%, transparent)`,
    };
}
