// Promotion — time-controlled, catalog-side price promotion.
//
// Separate from `PromoCode` (redeemable checkout voucher): a promotion
// overrides the pricing-page price automatically. `requiresCoupon = true`
// couples it to existing `PromoCode` codes.
//
// The pure functions `promoStatus` / `pickActivePromo` / `applyPromo` are
// shared by the public catalog backend and the UI preview.

/** Promotion type. */
export type PromotionType = 'percent' | 'amount' | 'intro' | 'freeMonths';

/** Billing cycle for which the promotion applies. */
export type PromotionBillingCycle = 'monthly' | 'yearly' | 'both';

/** Derived time status (from validFrom/validTo + today). */
export type PromotionStatus = 'scheduled' | 'active' | 'expired';

/** Target type of a promotion. Missing/undefined means legacy `PLAN`. */
export type PromotionTargetType = 'PLAN' | 'BUNDLE' | 'OFFER';

/**
 * Type-dependent promotion value:
 * - `percent`/`amount` → number
 * - `intro` → `{ price, months }`
 * - `freeMonths` → number (count of free months)
 */
export type PromotionValue = number | { price: number; months: number };

/** Locale-specific promotion texts. */
export interface PromotionI18nFields {
    badge?: string;
    fineprint?: string;
}

/** `{ 'de': { badge, fineprint }, 'en': { … } }`. */
export type PromotionI18n = Record<string, PromotionI18nFields>;

/** Wire format of a `promotions` row. */
export interface PromotionRow {
    id: string;
    /** Internal label (not public). */
    internalLabel: string;
    type: PromotionType;
    value: PromotionValue;
    /** Plan keys the promotion applies to. */
    appliesTo: string[];
    /** Target type of the keys in `appliesTo`. Missing = PLAN. */
    targetType?: PromotionTargetType;
    billingCycle: PromotionBillingCycle;
    /** ISO date. */
    validFrom: string;
    validTo: string;
    /** On overlap, the highest value wins. */
    priority: number;
    /** Language restriction; null = all locales. */
    onlyLocales: string[] | null;
    requiresCoupon: boolean;
    /** Referenced `PromoCode` codes (only relevant when requiresCoupon). */
    codes: string[];
    /** UI accent color (timeline/ribbon). */
    color: string;
    i18n: PromotionI18n;
    createdAt: string;
    updatedAt: string;
}

export interface CreatePromotionData {
    internalLabel: string;
    type: PromotionType;
    value: PromotionValue;
    appliesTo?: string[];
    targetType?: PromotionTargetType;
    billingCycle?: PromotionBillingCycle;
    validFrom: string;
    validTo: string;
    priority?: number;
    onlyLocales?: string[] | null;
    requiresCoupon?: boolean;
    codes?: string[];
    color?: string;
    i18n?: PromotionI18n;
}

export interface UpdatePromotionData {
    internalLabel?: string;
    type?: PromotionType;
    value?: PromotionValue;
    appliesTo?: string[];
    targetType?: PromotionTargetType;
    billingCycle?: PromotionBillingCycle;
    validFrom?: string;
    validTo?: string;
    priority?: number;
    onlyLocales?: string[] | null;
    requiresCoupon?: boolean;
    codes?: string[];
    color?: string;
    i18n?: PromotionI18n;
}

// =============================================================================
// Pure functions — shared between the public catalog backend and UI preview
// =============================================================================

/** Time status of a promotion relative to `today` (default: now). */
export function promoStatus(
    promo: Pick<PromotionRow, 'validFrom' | 'validTo'>,
    today: Date = new Date(),
): PromotionStatus {
    const from = new Date(promo.validFrom);
    const to = new Date(`${promo.validTo}T23:59:59`);
    if (today < from) return 'scheduled';
    if (today > to) return 'expired';
    return 'active';
}

/**
 * Selects **exactly one** applicable promotion for plan + locale + cycle:
 * filtered on `appliesTo`, `billingCycle`, `onlyLocales`, status `active`,
 * `!requiresCoupon`; if several, the highest `priority` wins.
 */
export function pickActivePromo(
    promotions: PromotionRow[],
    targetKey: string,
    locale: string,
    cycle: 'monthly' | 'yearly',
    today: Date = new Date(),
    targetType: PromotionTargetType = 'PLAN',
): PromotionRow | null {
    const matches = promotions
        .filter((p) => (p.targetType ?? 'PLAN') === targetType)
        .filter((p) => p.appliesTo.includes(targetKey))
        .filter((p) => p.billingCycle === 'both' || p.billingCycle === cycle)
        .filter((p) => !p.onlyLocales || p.onlyLocales.includes(locale))
        .filter((p) => !p.requiresCoupon)
        .filter((p) => promoStatus(p, today) === 'active')
        .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return matches[0] ?? null;
}

/** Result of `applyPromo` — type-dependent price projection. */
export type PromotionResult =
    | { kind: 'percent'; discounted: number; original: number; pct: number }
    | { kind: 'amount'; discounted: number; original: number; saved: number }
    | { kind: 'intro'; discounted: number; original: number; months: number }
    | { kind: 'free'; discounted: number; original: number; months: number };

/**
 * Applies the promotion math to a base price, or `null` where the promotion
 * takes nothing off it.
 *
 * The discounted price stays between 0 and the base price, whatever the
 * promotion states: a promotion lowers the price of what it is on and nothing
 * else. Creating one refuses a value no price could make sense of, but whether
 * an intro price or an amount fits depends on the price it meets — which
 * differs per plan and rhythm and moves when a new version is published — so
 * the bound is held here, where every place that resolves a promotion reads it:
 * the public catalogue, a checkout offer, the operator's preview.
 */
export function applyPromo(
    promo: PromotionRow | null,
    basePrice: number | null,
): PromotionResult | null {
    const result = boundedPromo(promo, basePrice);
    return result && result.discounted < result.original ? result : null;
}

function boundedPromo(
    promo: PromotionRow | null,
    basePrice: number | null,
): PromotionResult | null {
    if (!promo || basePrice === null || basePrice === undefined) return null;
    if (promo.type === 'percent' && typeof promo.value === 'number') {
        const pct = withinBounds(promo.value, 100);
        return {
            kind: 'percent',
            discounted: Math.round(basePrice * (100 - pct)) / 100,
            original: basePrice,
            pct,
        };
    }
    if (promo.type === 'amount' && typeof promo.value === 'number') {
        const saved = withinBounds(promo.value, basePrice);
        return {
            kind: 'amount',
            discounted: Math.round((basePrice - saved) * 100) / 100,
            original: basePrice,
            saved,
        };
    }
    if (promo.type === 'intro' && typeof promo.value === 'object' && promo.value !== null) {
        return {
            kind: 'intro',
            discounted: withinBounds(promo.value.price, basePrice),
            original: basePrice,
            months: promo.value.months,
        };
    }
    if (promo.type === 'freeMonths' && typeof promo.value === 'number') {
        return { kind: 'free', discounted: 0, original: basePrice, months: promo.value };
    }
    return null;
}

function withinBounds(value: number, upper: number): number {
    return Math.min(Math.max(value, 0), Math.max(upper, 0));
}

/** A promotion on a price, and what it makes of that price. */
export interface PromotionOnPrice {
    promotion: PromotionRow;
    result: PromotionResult;
}

/**
 * The promotion a price carries: the one `pickActivePromo` selects for the key,
 * language and rhythm, where `applyPromo` finds that it lowers the price at
 * all — or `null`.
 *
 * One question, asked the same way by every place that shows or charges a
 * promotion: the public catalogue, a checkout offer, and the operator's
 * preview. A promotion that lowers nothing is no promotion there, so it carries
 * no badge and takes nothing off.
 */
export function promotionOnPrice(
    promotions: PromotionRow[],
    targetKey: string,
    locale: string,
    cycle: 'monthly' | 'yearly',
    basePrice: number | null,
    today: Date = new Date(),
    targetType: PromotionTargetType = 'PLAN',
): PromotionOnPrice | null {
    const promotion = pickActivePromo(promotions, targetKey, locale, cycle, today, targetType);
    const result = applyPromo(promotion, basePrice);
    return promotion && result ? { promotion, result } : null;
}
