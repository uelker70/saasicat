// Promotion — zeitgesteuerte, katalog-seitige Preis-Aktion (SPEC_V2 §9a).
//
// Getrennt von `PromoCode` (einlösbarer Checkout-Gutschein): eine Promotion
// überschreibt den Pricing-Page-Preis automatisch. `requiresCoupon = true`
// koppelt sie an bestehende `PromoCode`-Codes.
//
// Die Pure-Functions `promoStatus` / `pickActivePromo` / `applyPromo` werden
// vom Public-Catalog-Backend und von der UI-Vorschau gemeinsam genutzt.
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §9a

/** Aktions-Art. */
export type PromotionType = 'percent' | 'amount' | 'intro' | 'freeMonths';

/** Abrechnungs-Zyklus, für den die Promotion gilt. */
export type PromotionBillingCycle = 'monthly' | 'yearly' | 'both';

/** Abgeleiteter Zeit-Status (aus validFrom/validTo + heute). */
export type PromotionStatus = 'scheduled' | 'active' | 'expired';

/** Zieltyp einer Promotion. Fehlend/undefined bedeutet legacy `PLAN`. */
export type PromotionTargetType = 'PLAN' | 'BUNDLE' | 'OFFER';

/**
 * Typ-abhängiger Aktions-Wert:
 * - `percent`/`amount` → Zahl
 * - `intro` → `{ price, months }`
 * - `freeMonths` → Zahl (Anzahl Gratis-Monate)
 */
export type PromotionValue = number | { price: number; months: number };

/** Locale-spezifische Aktions-Texte. */
export interface PromotionI18nFields {
    badge?: string;
    fineprint?: string;
}

/** `{ 'de': { badge, fineprint }, 'en': { … } }`. */
export type PromotionI18n = Record<string, PromotionI18nFields>;

/** Wire-Format einer `promotions`-Row. */
export interface PromotionRow {
    id: string;
    projectKey: string;
    /** Interne Bezeichnung (nicht öffentlich). */
    internalLabel: string;
    type: PromotionType;
    value: PromotionValue;
    /** Plan-Keys, auf die die Aktion wirkt. */
    appliesTo: string[];
    /** Zieltyp der Keys in `appliesTo`. Fehlend = PLAN. */
    targetType?: PromotionTargetType;
    billingCycle: PromotionBillingCycle;
    /** ISO-Datum. */
    validFrom: string;
    validTo: string;
    /** Bei Überschneidung gewinnt der höchste Wert. */
    priority: number;
    /** Sprach-Beschränkung; null = alle Locales. */
    onlyLocales: string[] | null;
    requiresCoupon: boolean;
    /** Referenzierte `PromoCode`-Codes (nur bei requiresCoupon relevant). */
    codes: string[];
    /** UI-Akzentfarbe (Timeline/Ribbon). */
    color: string;
    i18n: PromotionI18n;
    createdAt: string;
    updatedAt: string;
}

export interface PromotionFilter {
    projectKey: string;
}

export interface CreatePromotionData {
    projectKey: string;
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
// Pure-Functions — geteilt zwischen Public-Catalog-Backend und UI-Vorschau
// =============================================================================

/** Zeit-Status einer Promotion relativ zu `today` (Default: jetzt). */
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
 * Wählt **genau eine** anwendbare Promotion für Plan + Locale + Zyklus:
 * gefiltert auf `appliesTo`, `billingCycle`, `onlyLocales`, Status `active`,
 * `!requiresCoupon`; bei mehreren gewinnt die höchste `priority`.
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

/** Ergebnis von `applyPromo` — typ-abhängige Preis-Projektion. */
export type PromotionResult =
    | { kind: 'percent'; discounted: number; original: number; pct: number }
    | { kind: 'amount'; discounted: number; original: number; saved: number }
    | { kind: 'intro'; discounted: number; original: number; months: number }
    | { kind: 'free'; discounted: number; original: number; months: number };

/** Wendet die Promotion-Mathematik auf einen Basispreis an. */
export function applyPromo(
    promo: PromotionRow | null,
    basePrice: number | null,
): PromotionResult | null {
    if (!promo || basePrice === null || basePrice === undefined) return null;
    if (promo.type === 'percent' && typeof promo.value === 'number') {
        return {
            kind: 'percent',
            discounted: Math.round(basePrice * (100 - promo.value)) / 100,
            original: basePrice,
            pct: promo.value,
        };
    }
    if (promo.type === 'amount' && typeof promo.value === 'number') {
        return {
            kind: 'amount',
            discounted: Math.max(0, basePrice - promo.value),
            original: basePrice,
            saved: promo.value,
        };
    }
    if (promo.type === 'intro' && typeof promo.value === 'object') {
        return {
            kind: 'intro',
            discounted: promo.value.price,
            original: basePrice,
            months: promo.value.months,
        };
    }
    if (promo.type === 'freeMonths' && typeof promo.value === 'number') {
        return { kind: 'free', discounted: 0, original: basePrice, months: promo.value };
    }
    return null;
}
