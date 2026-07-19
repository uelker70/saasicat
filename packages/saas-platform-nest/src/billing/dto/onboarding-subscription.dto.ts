import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

// CompleteOnboardingSubscriptionDto — Auswahl aus dem Onboarding-Konfigurator,
// die der Tenant beim Abschluss der Schritt-3-Konfiguration absendet.
//
// Plan- und Cycle-IDs werden als String validiert (kein hartes Enum), weil
// der Plattform-Service gegen den Konsumenten-PlanCatalog prüft. Promo-Code
// ist optional; wenn gesetzt, versucht der Service eine atomare Einlösung
// nach dem Plan-Wechsel.

const PLAN_OR_CYCLE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const PROMO_CODE_PATTERN = /^[A-Z0-9_-]{4,32}$/i;

export class CompleteOnboardingSubscriptionDto {
    @IsString()
    @Matches(PLAN_OR_CYCLE_PATTERN, { message: 'plan muss SCREAMING_SNAKE_CASE sein' })
    plan!: string;

    @IsString()
    @Matches(PLAN_OR_CYCLE_PATTERN, {
        message: 'billingCycle muss SCREAMING_SNAKE_CASE sein (z. B. MONTHLY, YEARLY)',
    })
    billingCycle!: string;

    @IsOptional()
    @IsString()
    @Matches(PROMO_CODE_PATTERN, {
        message: 'promoCode muss aus A–Z, 0–9, "-", "_" bestehen (4–32 Zeichen)',
    })
    promoCode?: string;

    /**
     * Optional — UUIDs der BundleVersions, die gleich mit dem Plan
     * gebucht werden sollen (P11.7.3). Pro Bundle wird die Plattform-
     * Default-Mindestlaufzeit (12 Monate) gesetzt. Bundles werden
     * **nach** dem Plan-Wechsel best-effort hinzugefügt — Fehler beim
     * einzelnen Bundle (z. B. inkompatibel mit dem gewählten Plan)
     * landen als Warning in der Response, ohne den Plan-Wechsel
     * zurückzurollen.
     */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10)
    @IsUUID('all', { each: true })
    bundleVersionIds?: string[];
}
