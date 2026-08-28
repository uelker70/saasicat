// Default i18n map for the tenant plan section. Consumers override individual
// keys via the `i18n` prop or pass their own map through (build a vue-i18n
// resolver on top of this shape). The map that a component falls back to is
// picked from the active SuperAdmin locale via
// `defaultTenantPlanSectionI18n()`.

import { ERROR_MESSAGES_DE, ERROR_MESSAGES_EN } from '@saasicat/core';
import type { SaLocale } from '@saasicat/ui-vue';

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
    wizardDeferredLead: string;
    wizardDeferredBody: string;
    wizardDeferredAlternative: string;
    wizardDeferredKeepYearly: string;
    wizardDeferredAcknowledge: string;
    wizardDowngradeLead: string;
    wizardDowngradeLeadQuotasOnly: string;
    wizardDowngradeBody: string;
    wizardDowngradeAcknowledge: string;
    wizardCycleChangeLead: string;
    wizardCycleChangeBody: string;
    wizardCycleChangeAcknowledge: string;
    cancelSubscriptionButton: string;
    canceledHeading: string;
    canceledUntil: string;
    canceledUnchanged: string;
    endedHeading: string;
    endedOn: string;
    cancelConfirmTitle: string;
    cancelConfirmBody: string;
    cancelConfirmLate: string;
    cancelConfirmAction: string;
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
    bundlesPerYear: string;
    /** Legend for the rhythm choice above the bundle cards. */
    bundleCycleLegend: string;
    /** Badge on a bundle that carries no price in the chosen rhythm. */
    bundleNotPricedForCycle: string;
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
    bundlePreviewFirstPeriodLabel: string;
    bundlePreviewEndsWithPlanLabel: string;
    bundlePreviewEndsWithPlanNote: string;
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
    /**
     * Texts for the coded blockers and warnings a plan-change preview returns,
     * keyed by `BILLING_ERROR_CODES`. Sits here rather than in a prop of its
     * own so that an app translating this map translates its blockers in the
     * same breath: labels and blockers can no longer come from two different
     * languages, because they come from one object.
     *
     * A partial map is enough — `resolveErrorMessage` falls back through the
     * shipped English catalogue to the `message` the backend sent, so an
     * untranslated code renders English prose rather than a blank line.
     */
    issueMessages: Partial<Record<string, string>>;
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
    wizardDeferredLead: 'Sie profitieren erst ab {date} von {plan}.',
    wizardDeferredBody:
        'Ihr laufender Jahresvertrag bleibt bis zum {date} unverändert. Neue Funktionen und Kontingente stehen Ihnen bis dahin nicht zur Verfügung — der Wechsel wird erst nach Ablauf der Mindestlaufzeit wirksam.',
    wizardDeferredAlternative:
        'Wenn Sie sofort profitieren möchten, behalten Sie den Jahresvertrag: Der Wechsel wird dann heute wirksam und anteilig für das laufende Jahr abgerechnet.',
    wizardDeferredKeepYearly: 'Jahresvertrag behalten und sofort wechseln',
    wizardDeferredAcknowledge: 'Ich habe verstanden, dass der Wechsel erst am {date} wirksam wird.',
    wizardDowngradeLead: 'Ab {date} stehen Ihnen {count} Funktion(en) nicht mehr zur Verfügung.',
    wizardDowngradeLeadQuotasOnly: 'Ab {date} gelten die geringeren Kontingente von {plan}.',
    wizardDowngradeBody:
        'Ihr aktueller Vertrag läuft unverändert bis zum {date} — bis dahin ändert sich nichts. Ihre Daten bleiben erhalten und werden nicht gelöscht; ein späteres Upgrade schaltet sie wieder frei.',
    wizardDowngradeAcknowledge: 'Ich habe verstanden, was ab {date} entfällt.',
    wizardCycleChangeLead: 'Die Umstellung auf {cycle} wird erst zum {date} wirksam.',
    wizardCycleChangeBody:
        'Bis zum {date} bleibt alles unverändert — gleicher Plan, gleiche Kontingente, gleicher Preis. Ab dann gilt der neue Zahlungsrhythmus, und damit beginnt eine neue Mindestlaufzeit.',
    wizardCycleChangeAcknowledge:
        'Ich habe verstanden, dass die Umstellung erst am {date} wirksam wird.',
    cancelSubscriptionButton: 'Abonnement kündigen',
    canceledHeading: 'Gekündigt.',
    canceledUntil: 'Ihr Abonnement läuft unverändert bis zum',
    canceledUnchanged: 'Bis dahin ändert sich nichts an Ihrem Zugang.',
    endedHeading: 'Beendet.',
    endedOn: 'Ihr Abonnement ist beendet seit dem',
    cancelConfirmTitle: 'Abonnement kündigen?',
    cancelConfirmBody:
        'Ihr Abonnement läuft danach unverändert weiter bis zum {date} — Funktionen, Kontingente und Abrechnung bleiben bis dahin gleich.',
    cancelConfirmLate:
        'Die Kündigungsfrist für die laufende Periode ist am {deadline} abgelaufen. Die Kündigung wird deshalb erst zum {date} wirksam.',
    cancelConfirmAction: 'Zum {date} kündigen',
    usageTitle: 'Verbrauch',
    featuresOverviewTitle: 'Leistungsumfang',
    featuresActive: 'Enthalten',
    featuresLocked: 'Nicht enthalten',
    bundlesStoreTitle: 'Bundles',
    bundlesBookedTitle: 'Gebuchte Bundles',
    bundlesAvailableTitle: 'Verfügbare Bundles',
    bundlesAvailableEmpty: 'Aktuell sind keine zusätzlichen Bundles verfügbar.',
    bundlesPerMonth: 'netto/Monat',
    bundlesPerYear: 'netto/Jahr',
    bundleCycleLegend: 'Abrechnung der Zusatzpakete',
    bundleNotPricedForCycle: 'In diesem Rhythmus nicht erhältlich',
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
    bundlePreviewFirstPeriodLabel: 'Erste Abrechnungsperiode bis',
    bundlePreviewEndsWithPlanLabel: 'Endet mit dem Tarif am',
    bundlePreviewEndsWithPlanNote:
        'Das Bundle läuft im Takt des Tarifs und endet mit ihm — ohne eigene Kündigung. Endet der Tarif vorzeitig, wird die angebrochene Periode nicht erstattet.',
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
    issueMessages: ERROR_MESSAGES_DE,
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
    wizardDeferredLead: 'You benefit from {plan} on {date}, not before.',
    wizardDeferredBody:
        'Your running yearly contract stays unchanged until {date}. New features and quotas are not available to you before then — the change takes effect once the minimum term ends.',
    wizardDeferredAlternative:
        'To benefit immediately, keep the yearly cycle: the change then takes effect today and is billed pro rata for the running year.',
    wizardDeferredKeepYearly: 'Keep yearly and switch today',
    wizardDeferredAcknowledge: 'I understand that the change takes effect on {date}.',
    wizardDowngradeLead: 'From {date} you no longer have {count} feature(s).',
    wizardDowngradeLeadQuotasOnly: 'From {date} the smaller quotas of {plan} apply.',
    wizardDowngradeBody:
        'Your current contract runs unchanged until {date} — nothing changes before then. Your data is kept and never deleted; upgrading again unlocks it.',
    wizardDowngradeAcknowledge: 'I understand what falls away on {date}.',
    wizardCycleChangeLead: 'Switching to {cycle} takes effect on {date}, not before.',
    wizardCycleChangeBody:
        'Nothing changes until {date} — same plan, same quotas, same price. From then the new billing rhythm applies, and with it a fresh minimum term.',
    wizardCycleChangeAcknowledge: 'I understand that the switch takes effect on {date}.',
    cancelSubscriptionButton: 'Cancel subscription',
    canceledHeading: 'Cancelled.',
    canceledUntil: 'Your subscription runs unchanged until',
    canceledUnchanged: 'Nothing about your access changes before then.',
    endedHeading: 'Ended.',
    endedOn: 'Your subscription ended on',
    cancelConfirmTitle: 'Cancel subscription?',
    cancelConfirmBody:
        'Your subscription then runs unchanged until {date} — features, quotas and billing stay the same until then.',
    cancelConfirmLate:
        'The notice period for the running term ended on {deadline}, so the cancellation takes effect on {date} instead.',
    cancelConfirmAction: 'Cancel as of {date}',
    usageTitle: 'Usage',
    featuresOverviewTitle: 'Features',
    featuresActive: 'Included',
    featuresLocked: 'Not included',
    bundlesStoreTitle: 'Bundles',
    bundlesBookedTitle: 'Booked bundles',
    bundlesAvailableTitle: 'Available bundles',
    bundlesAvailableEmpty: 'There are currently no additional bundles available.',
    bundlesPerMonth: 'net/month',
    bundlesPerYear: 'net/year',
    bundleCycleLegend: 'Billing for add-ons',
    bundleNotPricedForCycle: 'Not available in this rhythm',
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
    bundlePreviewFirstPeriodLabel: 'First billing period until',
    bundlePreviewEndsWithPlanLabel: 'Ends with the plan on',
    bundlePreviewEndsWithPlanNote:
        'The bundle runs in step with the plan and ends with it — no separate cancellation. If the plan ends early, the period it is in is not refunded.',
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
    issueMessages: ERROR_MESSAGES_EN,
};

/** Default map for the given UI locale — fallback layer under the `i18n` prop. */
export function defaultTenantPlanSectionI18n(locale: SaLocale): TenantPlanSectionI18n {
    return locale === 'en' ? DEFAULT_I18N_EN : DEFAULT_I18N_DE;
}

/**
 * The strings `PlanChangeWizard` takes.
 *
 * A projection of `TenantPlanSectionI18n` with the `wizard` prefix dropped, so
 * the wizard's own template reads `i18n.stepChoose` rather than
 * `i18n.wizardStepChoose`.
 */
export interface PlanChangeWizardI18n {
    title: string;
    close: string;
    currentLabel: string;
    cycleMonthly: string;
    cycleYearly: string;
    badgeCurrent: string;
    badgePopular: string;
    priceUnitMonthly: string;
    priceUnitYearly: string;
    priceOnRequest: string;
    stepChoose: string;
    stepChooseIntro: string;
    stepPreview: string;
    stepConfirm: string;
    next: string;
    back: string;
    previewLoading: string;
    effectiveAtLabel: string;
    effectiveImmediate: string;
    prorationTitle: string;
    prorationLine: string;
    prorationDays: string;
    limitsTitle: string;
    limitsUsed: string;
    limitsCurrent: string;
    limitsTarget: string;
    featuresGained: string;
    featuresLost: string;
    blockersTitle: string;
    confirmImmediate: string;
    confirmScheduled: string;
    deferredLead: string;
    deferredBody: string;
    deferredAlternative: string;
    deferredKeepYearly: string;
    deferredAcknowledge: string;
    downgradeLead: string;
    downgradeLeadQuotasOnly: string;
    downgradeBody: string;
    downgradeAcknowledge: string;
    cycleChangeLead: string;
    cycleChangeBody: string;
    cycleChangeAcknowledge: string;
    confirmAction: string;
    confirmInProgress: string;
    confirmPriceTitle: string;
    confirmProratedNow: string;
    confirmRecurringNext: string;
    confirmRecurringFrom: string;
    perCycleMonthly: string;
    perCycleYearly: string;
    confirmTrialNote: string;
    confirmRecurringTrialEnd: string;
    changeTypeUpgrade: string;
    changeTypeDowngrade: string;
    changeTypeCycle: string;
    changeTypeNoop: string;
    /** See `TenantPlanSectionI18n.issueMessages`. */
    issueMessages: Partial<Record<string, string>>;
}

/**
 * Builds the wizard's strings from the section's.
 *
 * Here rather than inline in `TenantPlanSection.vue`, because the wizard is an
 * exported component: a consumer who mounts it directly would otherwise have to
 * reproduce all 44 keys of this mapping by hand, and a visual fixture had to do
 * exactly that before it moved.
 */
export function planChangeWizardI18n(i18n: TenantPlanSectionI18n): PlanChangeWizardI18n {
    return {
        title: i18n.wizardTitle,
        close: i18n.wizardClose,
        currentLabel: i18n.wizardCurrent,
        cycleMonthly: i18n.cycleMonthly,
        cycleYearly: i18n.cycleYearly,
        badgeCurrent: i18n.wizardBadgeCurrent,
        badgePopular: i18n.wizardBadgePopular,
        priceUnitMonthly: i18n.wizardPriceUnitMonthly,
        priceUnitYearly: i18n.wizardPriceUnitYearly,
        priceOnRequest: i18n.wizardPriceOnRequest,
        stepChoose: i18n.wizardStepChoose,
        stepChooseIntro: i18n.wizardStepChooseIntro,
        stepPreview: i18n.wizardStepPreview,
        stepConfirm: i18n.wizardStepConfirm,
        next: i18n.wizardNext,
        back: i18n.wizardBack,
        previewLoading: i18n.wizardPreviewLoading,
        effectiveAtLabel: i18n.wizardEffectiveAtLabel,
        effectiveImmediate: i18n.wizardEffectiveImmediate,
        prorationTitle: i18n.wizardProrationTitle,
        prorationLine: i18n.wizardProrationLine,
        prorationDays: i18n.wizardProrationDays,
        limitsTitle: i18n.wizardLimitsTitle,
        limitsUsed: i18n.wizardLimitsUsed,
        limitsCurrent: i18n.wizardLimitsCurrent,
        limitsTarget: i18n.wizardLimitsTarget,
        featuresGained: i18n.wizardFeaturesGained,
        featuresLost: i18n.wizardFeaturesLost,
        blockersTitle: i18n.wizardBlockersTitle,
        confirmImmediate: i18n.wizardConfirmImmediate,
        confirmScheduled: i18n.wizardConfirmScheduled,
        deferredLead: i18n.wizardDeferredLead,
        deferredBody: i18n.wizardDeferredBody,
        deferredAlternative: i18n.wizardDeferredAlternative,
        deferredKeepYearly: i18n.wizardDeferredKeepYearly,
        deferredAcknowledge: i18n.wizardDeferredAcknowledge,
        downgradeLead: i18n.wizardDowngradeLead,
        downgradeLeadQuotasOnly: i18n.wizardDowngradeLeadQuotasOnly,
        downgradeBody: i18n.wizardDowngradeBody,
        downgradeAcknowledge: i18n.wizardDowngradeAcknowledge,
        cycleChangeLead: i18n.wizardCycleChangeLead,
        cycleChangeBody: i18n.wizardCycleChangeBody,
        cycleChangeAcknowledge: i18n.wizardCycleChangeAcknowledge,
        confirmAction: i18n.wizardConfirmAction,
        confirmInProgress: i18n.wizardConfirmInProgress,
        confirmPriceTitle: i18n.wizardConfirmPriceTitle,
        confirmProratedNow: i18n.wizardConfirmProratedNow,
        confirmRecurringNext: i18n.wizardConfirmRecurringNext,
        confirmRecurringFrom: i18n.wizardConfirmRecurringFrom,
        perCycleMonthly: i18n.wizardConfirmPerCycleMonthly,
        perCycleYearly: i18n.wizardConfirmPerCycleYearly,
        confirmTrialNote: i18n.wizardConfirmTrialNote,
        confirmRecurringTrialEnd: i18n.wizardConfirmRecurringTrialEnd,
        changeTypeUpgrade: i18n.wizardChangeTypeUpgrade,
        changeTypeDowngrade: i18n.wizardChangeTypeDowngrade,
        changeTypeCycle: i18n.wizardChangeTypeCycle,
        changeTypeNoop: i18n.wizardChangeTypeNoop,
        issueMessages: i18n.issueMessages,
    };
}
