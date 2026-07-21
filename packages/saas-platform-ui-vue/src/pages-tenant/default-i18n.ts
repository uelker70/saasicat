// Default i18n map for the tenant plan section. Consumers override individual
// keys via the `i18n` prop or pass their own map through (build a vue-i18n
// resolver on top of this shape).

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
};
