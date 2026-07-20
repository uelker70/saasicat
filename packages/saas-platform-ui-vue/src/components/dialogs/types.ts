// Geteilte Types fuer Plattform-Dialoge. Aus den .vue-Files extrahiert,
// weil vue-tsc kein `type X from "...vue"` unterstuetzt.

export interface PilotCreatePayload {
    tenant: { name: string; slug?: string; legalForm?: string; vatId?: string };
    admin: {
        email: string;
        firstName: string;
        lastName: string;
        initialPassword?: string;
    };
    pilot: { plan: string; note?: string; endsAt?: string };
}

export interface PilotCreateResult {
    slug: string;
    /** Wenn vom Server generiertes Initial-Passwort, hier mitliefern. */
    initialPassword?: string;
}

/** Bearbeiten einer bestehenden Pilot-Subscription (Plan, Enddatum, Notiz). */
export interface PilotEditPayload {
    /** Optional — nur die gesetzten Felder werden geändert. */
    plan?: string;
    /** `null` löscht das Enddatum (offene Pilotphase). */
    endsAt?: string | null;
    /** `null` oder leer löscht die Notiz. */
    note?: string | null;
}

export interface PilotEditResult {
    slug: string;
    changed?: string[];
}

/**
 * Mandanten-spezifisches Vokabular für die Pilot-Dialoge. Die Plattform
 * liefert neutrale Defaults ("Mandant"); Konsumenten überschreiben mit
 * ihrer Domänensprache (z. B. "Verein" oder "Händler").
 */
export interface PilotCopy {
    /** Untertitel der Mandant-Sektion im Create-Dialog. */
    tenantSubtitle?: string;
    /** Label des Namensfelds, z. B. "Vereinsname" / "Firmenname". */
    tenantNameLabel?: string;
    /** Placeholder für den Mandantennamen. */
    tenantNamePlaceholder?: string;
    /** Placeholder für den Slug. */
    slugPlaceholder?: string;
    /** Placeholder für die Initial-Admin-E-Mail. */
    adminEmailPlaceholder?: string;
    /** Placeholder für die interne Notiz (Create + Edit). */
    notePlaceholder?: string;
}

/** Neutrale, mandantenagnostische Defaults für {@link PilotCopy}. */
export const DEFAULT_PILOT_COPY: Required<PilotCopy> = {
    tenantSubtitle: 'Stammdaten des Mandanten',
    tenantNameLabel: 'Name des Mandanten',
    tenantNamePlaceholder: 'z. B. Muster GmbH',
    slugPlaceholder: 'muster-mandant',
    adminEmailPlaceholder: 'admin@example.com',
    notePlaceholder: 'z. B. Sales-Pilot · Demo-Zugang',
};

export type PromoCodeValueType = 'PERCENT' | 'ABSOLUTE';
export type PromoCodeDurationType = 'ONCE' | 'MONTHS' | 'BILLING_CYCLES';

export interface PromoCodeCreatePayload {
    code: string;
    valueType: PromoCodeValueType;
    value: number;
    durationType: PromoCodeDurationType;
    durationValue: number | null;
    maxRedemptions: number | null;
    validFrom: string | null;
    validUntil: string | null;
    /** Plan-Keys, auf die der Code anwendbar ist. Leer = alle Pläne. */
    appliesToPlans?: string[];
    /** Optional: Filter auf MONTHLY/YEARLY-Subscriptions. */
    appliesToBilling?: 'MONTHLY' | 'YEARLY';
    /** Nur einlösbar für Neukunden. */
    firstTimeCustomersOnly?: boolean;
    /** Minimaler Plan-Brutto-Betrag, ab dem der Code wirkt. */
    minimumPlanAmountGross?: number;
    /** Erlaubt 0-€-Rechnungen (sonst capped der Rabatt auf 100% des Betrags). */
    allowZeroInvoice?: boolean;
    /** Buchungskonto für Rabatt-Erlös-Minderung (App-spezifisch). */
    revenueDeductionAccount?: string;
    campaignTag?: string;
    description?: string;
}

/** Plan-Option für den Plan-Picker im PromoCodeCreateDialog. */
export interface PromoCodePlanOption {
    /** Plan-Key wie er ans Backend geht (z. B. 'BASIC'). */
    key: string;
    /** Anzeige-Label (z. B. 'Basic'). */
    label: string;
    /** Optionaler Akzent für den Plan-Chip; Fallback Neutral-Grau. */
    color?: string;
}

/**
 * PATCH-Payload — alle Felder optional, nur die explizit gesetzten
 * werden ans Backend gesendet (Whitelist auf Server-Seite). `code` ist
 * nicht in der Liste, weil er nach Anlage stabil bleibt.
 */
export interface PromoCodeUpdatePayload {
    status?: 'ACTIVE' | 'PAUSED';
    valueType?: PromoCodeValueType;
    value?: number;
    durationType?: PromoCodeDurationType;
    durationValue?: number | null;
    maxRedemptions?: number | null;
    validFrom?: string | null;
    validUntil?: string | null;
    appliesToPlans?: string[];
    appliesToBilling?: 'MONTHLY' | 'YEARLY' | null;
    firstTimeCustomersOnly?: boolean;
    minimumPlanAmountGross?: number | null;
    allowZeroInvoice?: boolean;
    description?: string | null;
    campaignTag?: string | null;
    revenueDeductionAccount?: string | null;
}
