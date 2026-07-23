// Default i18n map for the tenant plan section. Consumers override individual
// keys via the `i18n` prop or pass their own map through (build a vue-i18n
// resolver on top of this shape). The map that a component falls back to is
// picked from the active SuperAdmin locale via
// `defaultTenantPlanSectionI18n()`.

import type { SaLocale } from '../client/i18n/locale.js';

export interface TenantPlanSectionI18n {
    sectionTitle: string;
    sectionSubtitle: string;
    loading: string;
    noSubscription: string;
    activePlan: string;
    cycleMonthly: string;
    cycleYearly: string;
    statusActive: string;
    statusTrial: string;
    statusPastDue: string;
    statusCanceled: string;
    statusPendingSales: string;
    trialEndsAt: string;
    pilotEndsAt: string;
    nextBillingDate: string;
    pendingChange: string;
    changeFromTo: string;
    changeEffectiveAt: string;
    changePlanButton: string;
    cancelSubscriptionButton: string;
    usageTitle: string;
    /** #18 — feature / scope-of-services matrix (included + locked). */
    featuresOverviewTitle: string;
    featuresActive: string;
    featuresLocked: string;
    /** #15 — bundle store (booked + available bundles). */
    bundlesStoreTitle: string;
    bundlesBookedTitle: string;
    bundlesAvailableTitle: string;
    bundlesAvailableEmpty: string;
    bundlesPerMonth: string;
    bundleBookAction: string;
    bundleBookInProgress: string;
    bundleCancelAction: string;
    bundleReactivateAction: string;
    bundleReactivateConfirmTitle: string;
    bundleReactivateConfirmBody: string;
    bundleCanceledAt: string;
    bundleMinimumTermUntil: string;
    bundleIncludesLabel: string;
    bundleAlreadyBooked: string;
    bundleIncompatible: string;
    /** #37/#61 — requires graying-out + booking/cancellation preview. */
    bundleMissingRequires: string;
    bundlePreviewAddTitle: string;
    bundlePreviewCancelTitle: string;
    bundlePreviewLoading: string;
    bundlePreviewProrationTitle: string;
    bundlePreviewProratedNow: string;
    bundlePreviewProrationDays: string;
    bundlePreviewNextPeriod: string;
    bundlePreviewTrialNote: string;
    bundlePreviewNoPrice: string;
    bundlePreviewMinimumTermLabel: string;
    bundlePreviewMinimumTermMonths: string;
    bundlePreviewMinimumTermNone: string;
    bundlePreviewRedundantTitle: string;
    bundlePreviewRedundantCoveredByPlan: string;
    bundlePreviewRedundantCoveredByBundle: string;
    bundlePreviewMissingRequiresTitle: string;
    bundlePreviewBlockersTitle: string;
    bundlePreviewWarningsTitle: string;
    bundlePreviewEffectiveAt: string;
    bundlePreviewSavings: string;
    bundlePreviewConfirmAdd: string;
    bundlePreviewConfirmCancel: string;
    bundlePreviewInProgress: string;
    bundlePreviewClose: string;
    pendingVersionTitle: string;
    pendingVersionChipNonRegressive: string;
    pendingVersionChipRegressive: string;
    pendingVersionEffectiveAt: string;
    pendingVersionAcceptAction: string;
    pendingVersionAcceptInProgress: string;
    pendingVersionAcceptedAt: string;
    wizardTitle: string;
    wizardClose: string;
    wizardCurrent: string;
    wizardBadgeCurrent: string;
    wizardBadgePopular: string;
    wizardPriceUnitMonthly: string;
    wizardPriceUnitYearly: string;
    wizardPriceOnRequest: string;
    wizardStepChoose: string;
    wizardStepChooseIntro: string;
    wizardStepPreview: string;
    wizardStepConfirm: string;
    wizardNext: string;
    wizardBack: string;
    wizardPreviewLoading: string;
    wizardEffectiveAtLabel: string;
    wizardEffectiveImmediate: string;
    wizardProrationTitle: string;
    wizardProrationLine: string;
    wizardProrationDays: string;
    wizardLimitsTitle: string;
    wizardLimitsUsed: string;
    wizardLimitsCurrent: string;
    wizardLimitsTarget: string;
    wizardFeaturesGained: string;
    wizardFeaturesLost: string;
    wizardBlockersTitle: string;
    wizardConfirmImmediate: string;
    wizardConfirmScheduled: string;
    wizardConfirmAction: string;
    wizardConfirmInProgress: string;
    /** #17 — price overview in the confirm step. */
    wizardConfirmPriceTitle: string;
    wizardConfirmProratedNow: string;
    wizardConfirmRecurringNext: string;
    wizardConfirmRecurringFrom: string;
    wizardConfirmPerCycleMonthly: string;
    wizardConfirmPerCycleYearly: string;
    /** #17 — trial case in the confirm step (nothing due during the trial). */
    wizardConfirmTrialNote: string;
    wizardConfirmRecurringTrialEnd: string;
    wizardChangeTypeUpgrade: string;
    wizardChangeTypeDowngrade: string;
    wizardChangeTypeCycle: string;
    wizardChangeTypeNoop: string;
    /** P11.4: read-only display of the package snapshot. */
    packageSnapshotTitle: string;
    packageSnapshotSubtitle: string;
    packageSnapshotCapturedAt: string;
    packageSnapshotOfferRef: string;
    packageSnapshotPlanLabel: string;
    packageSnapshotPlanVersionLabel: string;
    packageSnapshotCycleLabel: string;
    packageSnapshotBundlesLabel: string;
    packageSnapshotBundlesEmpty: string;
    packageSnapshotPriceMonthly: string;
    packageSnapshotPriceYearly: string;
    packageSnapshotPriceTotal: string;
    packageSnapshotNone: string;
    packageSnapshotShowRaw: string;
    packageSnapshotHideRaw: string;
    /** Inline error prefix (`Fehler: …`). */
    errorLabel: string;
    /** Tenant self-service page "Meine Bundles" (MySubscriptionBundlesPage). */
    myBundlesTitle: string;
    myBundlesSubtitle: string;
    myBundlesEmptyPrefix: string;
    myBundlesEmptySuffix: string;
    myBundlesBookedSince: string;
    myBundlesCanceledAt: string;
    myBundlesRunsUntil: string;
    myBundlesCancelInProgress: string;
    myBundlesBookInProgress: string;
    myBundlesCancelConfirm: string;
    myBundlesStatusCanceledPending: string;
    myBundlesStatusEnded: string;
    myBundlesAddBundleLabel: string;
    myBundlesAddSelectPlaceholder: string;
    myBundlesPricePerMonthShort: string;
    myBundlesHiddenIncompatible: string;
    myBundlesBundleVersionIdLabel: string;
    myBundlesBundleVersionIdPlaceholder: string;
    myBundlesMinimumTermLabel: string;
    myBundlesMinimumTermPlaceholder: string;
}

/** German default strings — apps can override them selectively. */
export const DEFAULT_I18N_DE: TenantPlanSectionI18n = {
    sectionTitle: 'Paket & Verbrauch',
    sectionSubtitle: 'Aktuelles Paket, Verbrauch und Bundles.',
    loading: 'Lade …',
    noSubscription: 'Keine Subscription für diesen Mandanten gefunden.',
    activePlan: 'Aktuelles Paket',
    cycleMonthly: 'Monatlich',
    cycleYearly: 'Jährlich',
    statusActive: 'Aktiv',
    statusTrial: 'Testphase',
    statusPastDue: 'Zahlung überfällig',
    statusCanceled: 'Gekündigt',
    statusPendingSales: 'Vertrieb-Klärung',
    trialEndsAt: 'Testphase endet am',
    pilotEndsAt: 'Pilot endet am',
    nextBillingDate: 'Nächste Abrechnung',
    pendingChange: 'Ausstehender Plan-Wechsel',
    changeFromTo: 'Wechsel zu',
    changeEffectiveAt: 'wirksam ab',
    changePlanButton: 'Paket wechseln',
    cancelSubscriptionButton: 'Abonnement kündigen',
    usageTitle: 'Verbrauch',
    featuresOverviewTitle: 'Leistungsumfang',
    featuresActive: 'Enthalten',
    featuresLocked: 'Nicht enthalten',
    bundlesStoreTitle: 'Bundles',
    bundlesBookedTitle: 'Gebuchte Bundles',
    bundlesAvailableTitle: 'Verfügbare Bundles',
    bundlesAvailableEmpty: 'Aktuell sind keine zusätzlichen Bundles verfügbar.',
    bundlesPerMonth: 'netto/Monat',
    bundleBookAction: 'Bundle buchen',
    bundleBookInProgress: 'Buchung läuft …',
    bundleCancelAction: 'Kündigen',
    bundleReactivateAction: 'Reaktivieren',
    bundleReactivateConfirmTitle: 'Bundle reaktivieren',
    bundleReactivateConfirmBody:
        'Die Kündigung wird rückgängig gemacht. Das Bundle bleibt gebucht, läuft regulär weiter und wird wieder abgerechnet.',
    bundleCanceledAt: 'Gekündigt zum',
    bundleMinimumTermUntil: 'Mindestlaufzeit bis',
    bundleIncludesLabel: 'Enthält',
    bundleAlreadyBooked: 'Bereits gebucht',
    bundleIncompatible: 'Nicht kompatibel mit aktuellem Paket',
    bundleMissingRequires: 'Benötigt',
    bundlePreviewAddTitle: 'Bundle buchen',
    bundlePreviewCancelTitle: 'Bundle kündigen',
    bundlePreviewLoading: 'Vorschau wird berechnet …',
    bundlePreviewProrationTitle: 'Anteilige Abrechnung',
    bundlePreviewProratedNow: 'Heute anteilig fällig',
    bundlePreviewProrationDays: 'Tage',
    bundlePreviewNextPeriod: 'Regulär ab nächster Periode',
    bundlePreviewTrialNote:
        'Während der Testphase fällt nichts an — die Abrechnung beginnt mit der ersten bezahlten Periode.',
    bundlePreviewNoPrice: 'Für den aktuellen Abrechnungszyklus ist kein Listenpreis gepflegt.',
    bundlePreviewMinimumTermLabel: 'Mindestlaufzeit',
    bundlePreviewMinimumTermMonths: 'Monate, bis',
    bundlePreviewMinimumTermNone: 'Keine Mindestlaufzeit',
    bundlePreviewRedundantTitle: 'Bereits enthaltene Features (würden doppelt bezahlt)',
    bundlePreviewRedundantCoveredByPlan: 'bereits im Plan',
    bundlePreviewRedundantCoveredByBundle: 'bereits im Bundle',
    bundlePreviewMissingRequiresTitle: 'Fehlende Voraussetzungen',
    bundlePreviewBlockersTitle: 'Buchung nicht möglich',
    bundlePreviewWarningsTitle: 'Hinweise',
    bundlePreviewEffectiveAt: 'Kündigung wirksam zum',
    bundlePreviewSavings: 'Ersparnis pro Periode ab Wirksamkeit',
    bundlePreviewConfirmAdd: 'Kostenpflichtig buchen',
    bundlePreviewConfirmCancel: 'Kündigung bestätigen',
    bundlePreviewInProgress: 'Wird ausgeführt …',
    bundlePreviewClose: 'Abbrechen',
    pendingVersionTitle: 'Anstehende Plan-Änderung',
    pendingVersionChipNonRegressive: 'Verbessernd',
    pendingVersionChipRegressive: 'Bestätigung erforderlich',
    pendingVersionEffectiveAt: 'Wirksam ab',
    pendingVersionAcceptAction: 'Änderungen akzeptieren',
    pendingVersionAcceptInProgress: 'Akzeptiere …',
    pendingVersionAcceptedAt: 'Akzeptiert am',
    wizardTitle: 'Paket wechseln',
    wizardClose: 'Schließen',
    wizardCurrent: 'Aktuell',
    wizardBadgeCurrent: 'aktiv',
    wizardBadgePopular: 'beliebt',
    wizardPriceUnitMonthly: 'netto/Monat',
    wizardPriceUnitYearly: 'netto/Jahr',
    wizardPriceOnRequest: 'auf Anfrage',
    wizardStepChoose: 'Paket wählen',
    wizardStepChooseIntro:
        'Wähle dein Ziel-Paket und den Abrechnungszyklus. Im nächsten Schritt zeigen wir Verbrauchs-Check und Feature-Diff.',
    wizardStepPreview: 'Vorschau',
    wizardStepConfirm: 'Bestätigen',
    wizardNext: 'Weiter',
    wizardBack: 'Zurück',
    wizardPreviewLoading: 'Vorschau wird berechnet …',
    wizardEffectiveAtLabel: 'Wirksam ab',
    wizardEffectiveImmediate: 'Wirksam sofort',
    wizardProrationTitle: 'Anteilige Abrechnung',
    wizardProrationLine: 'Mehrbetrag bis Periodenende:',
    wizardProrationDays: 'Tage',
    wizardLimitsTitle: 'Limit-Vergleich',
    wizardLimitsUsed: 'Verbrauch',
    wizardLimitsCurrent: 'Aktuell',
    wizardLimitsTarget: 'Ziel',
    wizardFeaturesGained: 'Neu freigeschaltet',
    wizardFeaturesLost: 'Wegfallende Features',
    wizardBlockersTitle: 'Verhinderungs-Gründe',
    wizardConfirmImmediate: 'Der Wechsel wird sofort wirksam.',
    wizardConfirmScheduled: 'Der Wechsel wird wirksam zum',
    wizardConfirmAction: 'Wechsel bestätigen',
    wizardConfirmInProgress: 'Wechsel läuft …',
    wizardConfirmPriceTitle: 'Preisübersicht',
    wizardConfirmProratedNow: 'Heute anteilig fällig',
    wizardConfirmRecurringNext: 'Regulär ab nächster Periode',
    wizardConfirmRecurringFrom: 'Regulär fällig ab',
    wizardConfirmPerCycleMonthly: 'pro Monat',
    wizardConfirmPerCycleYearly: 'pro Jahr',
    wizardConfirmTrialNote: 'Während der Testphase fällt nichts an.',
    wizardConfirmRecurringTrialEnd: 'Regulär ab Ende der Testphase',
    wizardChangeTypeUpgrade: 'Upgrade',
    wizardChangeTypeDowngrade: 'Downgrade',
    wizardChangeTypeCycle: 'Zyklus-Wechsel',
    wizardChangeTypeNoop: 'Keine Änderung',
    packageSnapshotTitle: 'Gebuchtes Paket (Snapshot)',
    packageSnapshotSubtitle:
        'Schreibgeschützte Kopie des Pakets, wie es beim Abschluss vermarktet wurde.',
    packageSnapshotCapturedAt: 'Erfasst am',
    packageSnapshotOfferRef: 'Angebots-Referenz',
    packageSnapshotPlanLabel: 'Plan',
    packageSnapshotPlanVersionLabel: 'Plan-Version',
    packageSnapshotCycleLabel: 'Abrechnungszyklus',
    packageSnapshotBundlesLabel: 'Enthaltene Bundles',
    packageSnapshotBundlesEmpty: 'Keine Bundles im Paket.',
    packageSnapshotPriceMonthly: 'Preis monatlich',
    packageSnapshotPriceYearly: 'Preis jährlich',
    packageSnapshotPriceTotal: 'Gesamtpreis',
    packageSnapshotNone: 'Diese Subscription wurde nicht über ein Webseiten-Angebot abgeschlossen.',
    packageSnapshotShowRaw: 'Rohdaten anzeigen',
    packageSnapshotHideRaw: 'Rohdaten ausblenden',
    errorLabel: 'Fehler',
    myBundlesTitle: 'Meine Bundles',
    myBundlesSubtitle:
        'Eigenständig gebuchte Add-On-Pakete zu deinem Plan. Mindestlaufzeit + Kündigungs- Termin pro Bundle.',
    myBundlesEmptyPrefix: 'Du hast noch kein Bundle gebucht. Über',
    myBundlesEmptySuffix: 'kannst du dein Paket um zusätzliche Features & Quotas erweitern.',
    myBundlesBookedSince: 'Gebucht seit',
    myBundlesCanceledAt: 'Gekündigt am',
    myBundlesRunsUntil: 'läuft bis',
    myBundlesCancelInProgress: 'Kündige …',
    myBundlesBookInProgress: 'Buche …',
    myBundlesCancelConfirm:
        'Bundle wirklich kündigen? Die Kündigung wird zum nächstmöglichen Termin wirksam.',
    myBundlesStatusCanceledPending: 'Kündigung wirksam ab …',
    myBundlesStatusEnded: 'Beendet',
    myBundlesAddBundleLabel: 'Bundle',
    myBundlesAddSelectPlaceholder: '— bitte wählen —',
    myBundlesPricePerMonthShort: '€ / Mo',
    myBundlesHiddenIncompatible: 'weitere Bundle(s) ausgeblendet — nicht kompatibel mit Plan',
    myBundlesBundleVersionIdLabel: 'BundleVersion-ID',
    myBundlesBundleVersionIdPlaceholder: 'UUID der gewünschten Bundle-Version',
    myBundlesMinimumTermLabel: 'Mindestlaufzeit (Monate, optional)',
    myBundlesMinimumTermPlaceholder: 'Default: 12',
};

/** English default strings — mirror of {@link DEFAULT_I18N_DE}. */
export const DEFAULT_I18N_EN: TenantPlanSectionI18n = {
    sectionTitle: 'Plan & usage',
    sectionSubtitle: 'Current plan, usage and bundles.',
    loading: 'Loading …',
    noSubscription: 'No subscription found for this tenant.',
    activePlan: 'Current plan',
    cycleMonthly: 'Monthly',
    cycleYearly: 'Yearly',
    statusActive: 'Active',
    statusTrial: 'Trial',
    statusPastDue: 'Payment overdue',
    statusCanceled: 'Canceled',
    statusPendingSales: 'Sales review',
    trialEndsAt: 'Trial ends on',
    pilotEndsAt: 'Pilot ends on',
    nextBillingDate: 'Next billing date',
    pendingChange: 'Pending plan change',
    changeFromTo: 'Change to',
    changeEffectiveAt: 'effective as of',
    changePlanButton: 'Change plan',
    cancelSubscriptionButton: 'Cancel subscription',
    usageTitle: 'Usage',
    featuresOverviewTitle: 'Features',
    featuresActive: 'Included',
    featuresLocked: 'Not included',
    bundlesStoreTitle: 'Bundles',
    bundlesBookedTitle: 'Booked bundles',
    bundlesAvailableTitle: 'Available bundles',
    bundlesAvailableEmpty: 'There are currently no additional bundles available.',
    bundlesPerMonth: 'net/month',
    bundleBookAction: 'Book bundle',
    bundleBookInProgress: 'Booking …',
    bundleCancelAction: 'Cancel',
    bundleReactivateAction: 'Reactivate',
    bundleReactivateConfirmTitle: 'Reactivate bundle',
    bundleReactivateConfirmBody:
        'The cancellation will be reverted. The bundle stays booked, continues to run normally and will be billed again.',
    bundleCanceledAt: 'Canceled effective',
    bundleMinimumTermUntil: 'Minimum term until',
    bundleIncludesLabel: 'Includes',
    bundleAlreadyBooked: 'Already booked',
    bundleIncompatible: 'Not compatible with the current plan',
    bundleMissingRequires: 'Requires',
    bundlePreviewAddTitle: 'Book bundle',
    bundlePreviewCancelTitle: 'Cancel bundle',
    bundlePreviewLoading: 'Calculating preview …',
    bundlePreviewProrationTitle: 'Prorated billing',
    bundlePreviewProratedNow: 'Prorated amount due today',
    bundlePreviewProrationDays: 'days',
    bundlePreviewNextPeriod: 'Regular price from the next period',
    bundlePreviewTrialNote:
        'Nothing is charged during the trial — billing starts with the first paid period.',
    bundlePreviewNoPrice: 'No list price is configured for the current billing cycle.',
    bundlePreviewMinimumTermLabel: 'Minimum term',
    bundlePreviewMinimumTermMonths: 'months, until',
    bundlePreviewMinimumTermNone: 'No minimum term',
    bundlePreviewRedundantTitle: 'Features already included (would be paid for twice)',
    bundlePreviewRedundantCoveredByPlan: 'already in the plan',
    bundlePreviewRedundantCoveredByBundle: 'already in bundle',
    bundlePreviewMissingRequiresTitle: 'Missing prerequisites',
    bundlePreviewBlockersTitle: 'Booking not possible',
    bundlePreviewWarningsTitle: 'Notes',
    bundlePreviewEffectiveAt: 'Cancellation effective as of',
    bundlePreviewSavings: 'Savings per period once effective',
    bundlePreviewConfirmAdd: 'Book (chargeable)',
    bundlePreviewConfirmCancel: 'Confirm cancellation',
    bundlePreviewInProgress: 'Processing …',
    bundlePreviewClose: 'Cancel',
    pendingVersionTitle: 'Upcoming plan change',
    pendingVersionChipNonRegressive: 'Improvement',
    pendingVersionChipRegressive: 'Confirmation required',
    pendingVersionEffectiveAt: 'Effective as of',
    pendingVersionAcceptAction: 'Accept changes',
    pendingVersionAcceptInProgress: 'Accepting …',
    pendingVersionAcceptedAt: 'Accepted on',
    wizardTitle: 'Change plan',
    wizardClose: 'Close',
    wizardCurrent: 'Current',
    wizardBadgeCurrent: 'active',
    wizardBadgePopular: 'popular',
    wizardPriceUnitMonthly: 'net/month',
    wizardPriceUnitYearly: 'net/year',
    wizardPriceOnRequest: 'on request',
    wizardStepChoose: 'Choose plan',
    wizardStepChooseIntro:
        'Choose your target plan and the billing cycle. In the next step we show the usage check and the feature diff.',
    wizardStepPreview: 'Preview',
    wizardStepConfirm: 'Confirm',
    wizardNext: 'Next',
    wizardBack: 'Back',
    wizardPreviewLoading: 'Calculating preview …',
    wizardEffectiveAtLabel: 'Effective as of',
    wizardEffectiveImmediate: 'Effective immediately',
    wizardProrationTitle: 'Prorated billing',
    wizardProrationLine: 'Additional amount until the end of the period:',
    wizardProrationDays: 'days',
    wizardLimitsTitle: 'Limit comparison',
    wizardLimitsUsed: 'Usage',
    wizardLimitsCurrent: 'Current',
    wizardLimitsTarget: 'Target',
    wizardFeaturesGained: 'Newly unlocked',
    wizardFeaturesLost: 'Features you lose',
    wizardBlockersTitle: 'Blockers',
    wizardConfirmImmediate: 'The change takes effect immediately.',
    wizardConfirmScheduled: 'The change takes effect on',
    wizardConfirmAction: 'Confirm change',
    wizardConfirmInProgress: 'Changing …',
    wizardConfirmPriceTitle: 'Price overview',
    wizardConfirmProratedNow: 'Prorated amount due today',
    wizardConfirmRecurringNext: 'Regular price from the next period',
    wizardConfirmRecurringFrom: 'Regular price due from',
    wizardConfirmPerCycleMonthly: 'per month',
    wizardConfirmPerCycleYearly: 'per year',
    wizardConfirmTrialNote: 'Nothing is charged during the trial.',
    wizardConfirmRecurringTrialEnd: 'Regular price from the end of the trial',
    wizardChangeTypeUpgrade: 'Upgrade',
    wizardChangeTypeDowngrade: 'Downgrade',
    wizardChangeTypeCycle: 'Cycle change',
    wizardChangeTypeNoop: 'No change',
    packageSnapshotTitle: 'Booked plan (snapshot)',
    packageSnapshotSubtitle:
        'Read-only copy of the plan as it was marketed at the time of purchase.',
    packageSnapshotCapturedAt: 'Captured on',
    packageSnapshotOfferRef: 'Offer reference',
    packageSnapshotPlanLabel: 'Plan',
    packageSnapshotPlanVersionLabel: 'Plan version',
    packageSnapshotCycleLabel: 'Billing cycle',
    packageSnapshotBundlesLabel: 'Included bundles',
    packageSnapshotBundlesEmpty: 'No bundles in the plan.',
    packageSnapshotPriceMonthly: 'Monthly price',
    packageSnapshotPriceYearly: 'Yearly price',
    packageSnapshotPriceTotal: 'Total price',
    packageSnapshotNone: 'This subscription was not created through a website offer.',
    packageSnapshotShowRaw: 'Show raw data',
    packageSnapshotHideRaw: 'Hide raw data',
    errorLabel: 'Error',
    myBundlesTitle: 'My bundles',
    myBundlesSubtitle:
        'Add-on packages booked independently on top of your plan. Minimum term + cancellation date per bundle.',
    myBundlesEmptyPrefix: 'You have not booked a bundle yet. Use',
    myBundlesEmptySuffix: 'to extend your plan with additional features & quotas.',
    myBundlesBookedSince: 'Booked since',
    myBundlesCanceledAt: 'Canceled on',
    myBundlesRunsUntil: 'runs until',
    myBundlesCancelInProgress: 'Canceling …',
    myBundlesBookInProgress: 'Booking …',
    myBundlesCancelConfirm:
        'Really cancel this bundle? The cancellation takes effect on the next possible date.',
    myBundlesStatusCanceledPending: 'Cancellation effective as of …',
    myBundlesStatusEnded: 'Ended',
    myBundlesAddBundleLabel: 'Bundle',
    myBundlesAddSelectPlaceholder: '— please select —',
    myBundlesPricePerMonthShort: '€ / mo',
    myBundlesHiddenIncompatible: 'more bundle(s) hidden — not compatible with plan',
    myBundlesBundleVersionIdLabel: 'BundleVersion ID',
    myBundlesBundleVersionIdPlaceholder: 'UUID of the desired bundle version',
    myBundlesMinimumTermLabel: 'Minimum term (months, optional)',
    myBundlesMinimumTermPlaceholder: 'Default: 12',
};

/** Default map for the given UI locale — fallback layer under the `i18n` prop. */
export function defaultTenantPlanSectionI18n(locale: SaLocale): TenantPlanSectionI18n {
    return locale === 'en' ? DEFAULT_I18N_EN : DEFAULT_I18N_DE;
}
