// translation-catalogue: the German half of this file is German on purpose.
import { defineMessages } from '../define.js';

export const bundlesMessages = defineMessages(
    {
        // Field labels and units shared by the create panel, the inline editor
        // and the publish dialog.
        fields: {
            masterData: 'Stammdaten',
            label: 'Label',
            quotas: 'Quotas',
            monthlyPrice: 'Monatspreis',
            yearlyPrice: 'Jahrespreis',
            perMonthUnit: '€/Mo',
            perYearUnit: '€/Jahr',
            validFrom: 'Gültig ab',
            validUntil: 'Gültig bis',
            validUntilOpen: 'offen',
            planCompat: 'Kompatibel mit Plänen',
        },
        validation: {
            validFromRequired: 'Gültig ab ist Pflicht.',
            validUntilAfterValidFrom: 'Gültig bis muss nach Gültig ab liegen.',
            monthlyPriceFormat: 'Monatspreis: Dezimal mit max. 2 Nachkommastellen.',
            yearlyPriceFormat: 'Jahrespreis: Dezimal mit max. 2 Nachkommastellen.',
        },
        // BundlesPage — banners, confirms and toasts of the page shell.
        page: {
            loadError: 'Fehler beim Laden: {message}',
            emptyBefore: 'Noch keine Bundles angelegt. Über',
            emptyAfter:
                'einen Bundle-Stamm anlegen, dann Features & Quotas in einer Draft-Version kuratieren.',
            strictWarnings: '{count} Strict-Mode-Warnung(en) bei letzter Operation',
            confirmSoftDeleteTitle: 'Bundle soft-löschen?',
            confirmSoftDelete:
                'Bundle „{label}“ soft-löschen? Alle {versions} Version(en) verschwinden aus der Verwaltung. Bereits verkaufte Bestände bleiben durch die published BundleVersions geschützt.',
            confirmDiscardVersionTitle: 'Draft-Version verwerfen?',
            confirmDiscardVersion:
                'Diese Draft-Version verwerfen? Der bearbeitete Inhalt geht verloren und lässt sich nicht wiederherstellen.',
        },
        header: {
            title: 'Bundles',
            subtitle:
                'Produktgruppen aus Features & Quotas — verwendet in Plänen. Bundles werden im SuperAdmin kuratiert.',
            displayLocale: 'Anzeige-Sprache',
            newBundle: 'Neues Bundle',
        },
        filter: {
            all: 'Alle Status',
            onSale: 'Im Verkauf',
            scheduled: 'Mit geplanter Version',
            draft: 'Drafts',
            offSale: 'Nicht mehr im Verkauf',
            retired: 'Gelöscht',
        },
        kpis: {
            total: 'Bundles gesamt',
            totalSub: '{onSale} im Verkauf · {scheduled} mit geplanter Version',
            scheduled: 'Geplante Versionen',
            scheduledSub: 'ab ihrem ersten Tag im Verkauf',
            drafts: 'Offene Drafts',
            draftsSub: '{count} Bundle(s) ohne Publish',
            translated: 'Mit Übersetzung',
            translatedSub: '{count} aktive Sprache(n) im Projekt',
        },
        list: {
            translationCount: '{count} Übersetzung(en)',
            emptyNoMatch: 'Keine Bundles entsprechen der Suche.',
        },
        // Where a BundleVersion / a bundle stem stands. The label is the sale
        // state (`common.versionSale`); a deleted bundle has its own. Its key
        // stays `retired`, which an app's `i18n.overrides` may name.
        status: {
            draft: {
                tooltip: 'Noch nicht veröffentlicht — frei editierbar',
            },
            onSale: {
                tooltip: 'Wird verkauft · read-only (laufende Verträge)',
            },
            scheduled: {
                tooltip: 'Ab ihrem ersten Tag im Verkauf · bis dahin frei editierbar',
            },
            offSale: {
                tooltip: 'Wird nicht mehr verkauft · Bestand bleibt',
            },
            retired: {
                label: 'Gelöscht',
                tooltip: 'Das Add-on wurde gelöscht und kann nicht mehr gebucht werden',
            },
        },
        // BundleDetailPanel — master data + translations of the open bundle.
        detail: {
            translations: 'Übersetzungen',
            languageCount: '{count} Sprache(n)',
            noTranslatableLocales:
                'Keine weiteren Sprachen aktiv — werden im Marketing-Catalog aktiviert.',
            fallbackFromDe: 'Fallback aus DE',
            labelPlaceholder: 'Label (Fallback: „{label}“)',
            descriptionPlaceholder: 'Beschreibung (Fallback aus DE)',
            save: 'Stammdaten & Übersetzungen speichern',
            noVersion:
                'Noch keine Version. Lege eine neue Version an, um Features, Quotas & Pricing zu kuratieren.',
            publishVersion: 'Diese Version publishen',
            unsavedChanges: 'Ungespeicherte Änderungen',
            softDelete: 'Bundle soft-deleten',
        },
        // BundleCreatePanel — inline wizard for a new bundle (root + v1 draft).
        create: {
            title: 'Neues Bundle anlegen',
            subtitle:
                'Features & Quotas zu einem Add-On bündeln — bepreist und kompatibel mit ausgewählten Plänen.',
            masterDataHint: 'Sichtbarer Name + technischer Key.',
            labelPlaceholder: 'z. B. Communication Pro',
            bundleKey: 'Bundle-Key',
            bundleKeyHint: 'API-stabil · wird aus dem Label erzeugt',
            errorKeyFormat: 'Nur A-Z, 0-9, Underscore; muss mit Buchstabe beginnen.',
            errorKeyExists: 'Dieser Bundle-Key existiert bereits.',
            descriptionPlaceholder: 'z. B. Kampagnen, WhatsApp und Korrespondenz.',
            sectionPricing: 'v1 · Pricing & Gültigkeit',
            pricingHint: 'Monats- & Jahrespreis sowie Datum, ab dem das Bundle verkaufbar wird.',
            validFromImmediate: '✓ Bundle ist nach Anlage sofort live und verkaufbar.',
            validFromScheduled: '⏳ Geplant — wird ab {date} verkaufbar.',
            validFromHint: 'Pflicht beim Publish — kann auch nach Anlage gesetzt werden.',
            planCompatHint:
                'Mit welchen Plänen darf dieses Bundle als Add-On gebucht werden? Überschneidungen werden direkt markiert.',
            sectionFeatures: 'Features im Bundle',
            selectedOfTotal: '{selected} von {total} ausgewählt',
            quotasOptional: 'optional',
            quotasHint: 'Quotas, die das Bundle on top des Plans setzt.',
            overlapWarningOne: '⚠ Überschneidung mit {count} Plan — bitte prüfen',
            overlapWarningMany: '⚠ Überschneidung mit {count} Plänen — bitte prüfen',
            summaryFeatureOne: 'Feature',
            summaryFeatureMany: 'Features',
            summaryQuotaOne: 'Quota',
            summaryQuotaMany: 'Quotas',
            summaryPlanCompat: 'Plan-Kompat.',
            submitting: 'Lege an …',
            submit: 'Bundle anlegen',
        },
        // BundleVersionStrip — tab bar across all versions of a bundle.
        versionStrip: {
            label: 'Versionen',
            perMonth: '/ Mo',
            addVersion: 'Neue Version',
            addTooltip: 'Neue, zukünftige Version anlegen',
            addDisabledTooltip:
                'Bundle hat bereits eine Draft-Version — erst publishen oder verwerfen',
        },
        // BundleStatusBanner — one sentence per lifecycle status; the version
        // number and the status word stay bold in the markup, so the sentence
        // is split around them.
        statusBanner: {
            onSaleTail: 'wird aktuell als Add-On angeboten.',
            onSaleWarning:
                'Inhalt & Preis sind read-only (laufende Verträge). Für Änderungen eine neue Version anlegen.',
            scheduledOk: 'Frei editierbar bis dahin.',
            offSaleTail: 'wird nicht mehr angeboten, Bestand bleibt für Abrechnung erhalten.',
            draftTail: 'noch nicht published, frei editierbar.',
            discardTooltip: 'Geplante Version verwerfen',
            retireAction: 'Stilllegen…',
            retireTitle: 'Version für laufende Buchungen stilllegen',
            retiredChip: 'Stillgelegt → v{version}',
            retiredTitle: 'Angekündigt am {date} von {by}',
            retirementsUnreadable: 'Die Stilllegungen konnten nicht gelesen werden: {error}',
        },
        // BundleRetireDialog — retiring an add-on version for the bookings on
        // it, onto the add-on's version on sale.
        retireDialog: {
            title: 'v{version} stilllegen',
            intro: 'Die Buchungen von {bundleKey} v{version} laufen auf der Version weiter, die gerade im Verkauf ist — jeweils zum ersten Ende ihres Abrechnungszeitraums, das mindestens drei Monate nach der Zustellung ihrer Ankündigung liegt. Bis dahin können sie ohne Mindestlaufzeit gekündigt werden. Jedes betroffene Abonnement wird benachrichtigt.',
            noVersionOnSale:
                '{bundleKey} hat keine Version im Verkauf, auf der die Buchungen weiterlaufen könnten. Veröffentliche zuerst eine.',
            replacement: 'Ersatz: {bundleKey} v{version}',
            priceChange: '{from} → {to}',
            notSold: 'nicht angeboten',
            pricesNote:
                'Listenpreise. Wo ein Plan einen eigenen Preis für das Add-on hat, erfährt die Buchung diesen.',
            otherChanges: 'Dazu {count} Änderungen an Features oder Kontingenten.',
            reachedTitle: 'Erreicht {count} Buchungen',
            dateRow: '{count} wechseln am {date} — ohne Mindestlaufzeit kündbar bis {lastDay}',
            skippedTitle: 'Nicht erreicht',
            skipped: {
                ended: '{count} beendet',
                cancelledBefore: '{count} gekündigt, die Kündigung wirkt vorher',
                noTerm: '{count} ohne erkennbaren Abrechnungszeitraum',
                alreadyTold:
                    '{count} schon durch eine frühere Stilllegung dieser Version benachrichtigt',
            },
            blockers: {
                BUNDLE_RETIREMENT_VERSION_ON_SALE:
                    'v{version} von {bundleKey} ist noch im Verkauf. Veröffentliche die Version, die sie ersetzt, und lege diese still, sobald ihr Verkauf geendet hat — damit sie nach der Ankündigung niemand mehr bucht.',
                BUNDLE_RETIREMENT_REPLACEMENT_NOT_ON_SALE:
                    'v{version} von {bundleKey} ist nicht im Verkauf, Buchungen können darauf nicht weiterlaufen.',
                BUNDLE_RETIREMENT_REPLACEMENT_OF_ANOTHER_BUNDLE:
                    'Der Ersatz ist eine Version von {replacementBundleKey}, nicht von {bundleKey}. Eine Buchung läuft auf einer Version ihres eigenen Add-ons weiter.',
                BUNDLE_RETIREMENT_REPLACEMENT_CANNOT_RUN:
                    '{count} dieser Buchungen laufen neben einem Plan, neben dem v{version} von {bundleKey} nicht laufen kann — sie können darauf nicht weiterlaufen.',
                BUNDLE_RETIREMENT_NOTHING_AFFECTED:
                    'Keine laufende Buchung ist auf v{version} von {bundleKey} — es gibt niemanden zu benachrichtigen.',
                RETIREMENT_WITHIN_TWELVE_MONTHS:
                    '{count} dieser Buchungen gehören zu Abonnements, die in den letzten zwölf Monaten schon von einer Stilllegung erreicht wurden. Ein Abonnement wird höchstens einmal im Jahr erreicht.',
            },
            announce: 'Ankündigen',
            mfa: 'v{version} von {bundleKey} für laufende Buchungen stilllegen.',
            previewChanged:
                'Die erreichten Buchungen haben sich geändert. Bitte die aktualisierte Vorschau prüfen und erneut ankündigen.',
            done: 'Angekündigt. {told} Buchungen benachrichtigt, {failed} werden beim nächsten Lauf erneut versucht.',
        },
        // BundleVersionInlineEditor — features/quotas/pricing of one version.
        editor: {
            overlapOne:
                'Plan mit Überschneidung — Features/Quotas dieses Bundles sind im Plan bereits enthalten. Bitte vor Publish bereinigen.',
            overlapMany:
                'Pläne mit Überschneidung — Features/Quotas dieses Bundles sind im Plan bereits enthalten. Bitte vor Publish bereinigen.',
            sectionFeatures: 'Features',
            sectionPricing: 'Pricing',
            pricingHint: 'Bundle-Preis · zusätzlich zum Plan',
            yearlyEquivalent: '≈ {amount} €/Mo bei Jahresbuchung',
            savings: '{percent} % sparen',
            validityHint: 'validUntil automatisch (Auto-Sukzession)',
            validUntilHint: 'wird beim Publish einer Nachfolge-Version automatisch gesetzt',
            sectionMarketing: 'Marketing',
            marketed: 'Im Public-Catalog vermarkten',
            sectionChangeNote: 'Change-Note',
            changeNoteRequired: 'Pflicht beim Publish',
            changeNotePlaceholder: 'z. B. Add WhatsApp + Preisanpassung +4 €',
            selectedCount: '{count} ausgewählt',
            saveTooltip: 'Änderungen speichern',
            saveVersion: 'Version speichern',
            saveDisabledTooltip: 'Form ist invalide oder unverändert',
        },
        // BundlePlanCompatPicker — plans this bundle may be booked with.
        featuresEditor: {
            empty: 'Keine Features im Discovery-Snapshot.',
            overlapTooltip: 'Feature ist im kompatiblen Plan bereits enthalten — Doppel-Berechnung',
            removeTooltip: 'Aus Bundle entfernen',
            addTooltip: 'In Bundle aufnehmen',
        },
        quotasEditor: {
            empty: 'Keine Quotas im Discovery-Snapshot.',
            removeTooltip: 'Quota entfernen',
            addTooltip: 'Quota aufnehmen',
        },
        filterBar: {
            searchPlaceholder: 'Bundle-Key oder Label suchen …',
        },
        compatPicker: {
            hint: 'Pläne, mit denen dieses Bundle als Add-On gebucht werden kann. Features/Quotas, die der Plan bereits enthält, werden als Überschneidung markiert (Doppel-Berechnung).',
            lockedTooltip: 'Live-Version ist read-only',
            removeTooltip: 'Plan-Kompatibilität entfernen',
            addTooltip: 'Plan-Kompatibilität setzen',
            overlapHead: '⚠ Überschneidung',
            overlapFeatures: 'Features:',
            overlapQuotas: 'Quotas:',
            empty: 'Keine Pläne vorhanden — der Plan-Stamm muss zuerst angelegt werden.',
            summaryOne:
                'Plan mit Überschneidung — Features/Quotas dieses Bundles sind im Plan bereits enthalten. Vor Publish entweder das Bundle oder den Plan bereinigen.',
            summaryMany:
                'Pläne mit Überschneidung — Features/Quotas dieses Bundles sind im Plan bereits enthalten. Vor Publish entweder das Bundle oder den Plan bereinigen.',
        },
        // BundleVersionPublishDialog — publish confirmation incl. diff review.
        publishDialog: {
            title: 'BundleVersion publishen',
            bundleLabel: 'Bundle',
            loadingDiff: 'Diff zur Vorgänger-Version wird geladen …',
            strictWarnings: '{count} Strict-Mode-Warnung(en)',
            allowZeroPrice: 'Preis 0,00 bewusst zulassen (kostenloses Bundle)',
            allowZeroPriceHint:
                'Standard: Publish mit explizitem Preis 0,00 wird blockiert (Seed-Schutz).',
            changesVs: 'Änderungen gegenüber',
            noPrevious: '— keine Vorgänger-Version (Erst-Veröffentlichung)',
            noChanges: 'Keine Änderungen — die Versionen sind inhaltlich gleich.',
            regressionTitle: 'Regressive Änderung erkannt.',
            regressionBody:
                'Diese Version entfernt Features, senkt Quotas oder erhöht Preise. Vertragsschutz P3 (SPEC.md §6) verlangt Bestand-Opt-in. Publish erfordert deinen ausdrücklichen',
            regressionBodySuffix: '-Confirm.',
            forceRegressive: 'Trotzdem publishen',
            confirm: 'Publishen',
            confirmRegressive: 'Regressiv publishen',
            mfaDescription: 'Version v{version} von Bundle {bundleKey} publishen.',
        },
    },
    {
        fields: {
            masterData: 'Master data',
            label: 'Label',
            quotas: 'Quotas',
            monthlyPrice: 'Monthly price',
            yearlyPrice: 'Yearly price',
            perMonthUnit: '€/mo',
            perYearUnit: '€/yr',
            validFrom: 'Valid from',
            validUntil: 'Valid until',
            validUntilOpen: 'open',
            planCompat: 'Compatible with plans',
        },
        validation: {
            validFromRequired: '"Valid from" is required.',
            validUntilAfterValidFrom: '"Valid until" must be after "valid from".',
            monthlyPriceFormat: 'Monthly price: decimal with at most 2 decimal places.',
            yearlyPriceFormat: 'Yearly price: decimal with at most 2 decimal places.',
        },
        page: {
            loadError: 'Failed to load: {message}',
            emptyBefore: 'No bundles created yet. Use',
            emptyAfter:
                'to create a bundle master record, then curate features & quotas in a draft version.',
            strictWarnings: '{count} strict mode warning(s) in the last operation',
            confirmSoftDeleteTitle: 'Soft-delete bundle?',
            confirmSoftDelete:
                'Soft-delete bundle "{label}"? All {versions} version(s) leave the administration. Contracts already sold stay protected by the published bundle versions.',
            confirmDiscardVersionTitle: 'Discard draft version?',
            confirmDiscardVersion:
                'Discard this draft version? The edited content is lost and cannot be restored.',
        },
        header: {
            title: 'Bundles',
            subtitle:
                'Product groups made of features & quotas — used in plans. Bundles are curated in the SuperAdmin.',
            displayLocale: 'Display language',
            newBundle: 'New bundle',
        },
        filter: {
            all: 'All statuses',
            onSale: 'On sale',
            scheduled: 'With scheduled version',
            draft: 'Drafts',
            offSale: 'Off sale',
            retired: 'Deleted',
        },
        kpis: {
            total: 'Bundles total',
            totalSub: '{onSale} on sale · {scheduled} with a scheduled version',
            scheduled: 'Scheduled versions',
            scheduledSub: 'on sale from their first day',
            drafts: 'Open drafts',
            draftsSub: '{count} bundle(s) without a publish',
            translated: 'With translation',
            translatedSub: '{count} active language(s) in the project',
        },
        list: {
            translationCount: '{count} translation(s)',
            emptyNoMatch: 'No bundles match the search.',
        },
        status: {
            draft: {
                tooltip: 'Not published yet — freely editable',
            },
            onSale: {
                tooltip: 'On sale · read-only (running contracts)',
            },
            scheduled: {
                tooltip: 'On sale from its first day · freely editable until then',
            },
            offSale: {
                tooltip: 'No longer on sale · existing contracts remain',
            },
            retired: {
                label: 'Deleted',
                tooltip: 'The add-on was deleted and can no longer be booked',
            },
        },
        detail: {
            translations: 'Translations',
            languageCount: '{count} language(s)',
            noTranslatableLocales:
                'No further languages active — they are enabled in the marketing catalog.',
            fallbackFromDe: 'Fallback from DE',
            labelPlaceholder: 'Label (fallback: "{label}")',
            descriptionPlaceholder: 'Description (fallback from DE)',
            save: 'Save master data & translations',
            noVersion: 'No version yet. Create a new version to curate features, quotas & pricing.',
            publishVersion: 'Publish this version',
            unsavedChanges: 'Unsaved changes',
            softDelete: 'Soft-delete bundle',
        },
        create: {
            title: 'Create new bundle',
            subtitle:
                'Bundle features & quotas into an add-on — priced and compatible with selected plans.',
            masterDataHint: 'Visible name + technical key.',
            labelPlaceholder: 'e.g. Communication Pro',
            bundleKey: 'Bundle key',
            bundleKeyHint: 'API-stable · derived from the label',
            errorKeyFormat: 'Only A-Z, 0-9, underscore; must start with a letter.',
            errorKeyExists: 'This bundle key already exists.',
            descriptionPlaceholder: 'e.g. Campaigns, WhatsApp and correspondence.',
            sectionPricing: 'v1 · pricing & validity',
            pricingHint:
                'Monthly & yearly price plus the date from which the bundle becomes sellable.',
            validFromImmediate: '✓ The bundle is live and sellable right after creation.',
            validFromScheduled: '⏳ Scheduled — becomes sellable on {date}.',
            validFromHint: 'Required when publishing — can also be set after creation.',
            planCompatHint:
                'Which plans may this bundle be booked with as an add-on? Overlaps are flagged right away.',
            sectionFeatures: 'Features in the bundle',
            selectedOfTotal: '{selected} of {total} selected',
            quotasOptional: 'optional',
            quotasHint: 'Quotas the bundle adds on top of the plan.',
            overlapWarningOne: '⚠ Overlap with {count} plan — please review',
            overlapWarningMany: '⚠ Overlap with {count} plans — please review',
            summaryFeatureOne: 'feature',
            summaryFeatureMany: 'features',
            summaryQuotaOne: 'quota',
            summaryQuotaMany: 'quotas',
            summaryPlanCompat: 'plan compat.',
            submitting: 'Creating …',
            submit: 'Create bundle',
        },
        versionStrip: {
            label: 'Versions',
            perMonth: '/ mo',
            addVersion: 'New version',
            addTooltip: 'Create a new, future version',
            addDisabledTooltip: 'Bundle already has a draft version — publish or discard it first',
        },
        statusBanner: {
            onSaleTail: 'currently offered as an add-on.',
            onSaleWarning:
                'Content & price are read-only (running contracts). Create a new version to make changes.',
            scheduledOk: 'Freely editable until then.',
            offSaleTail: 'no longer offered, existing contracts remain for billing.',
            draftTail: 'not published yet, freely editable.',
            discardTooltip: 'Discard scheduled version',
            retireAction: 'Retire…',
            retireTitle: 'Retire this version for running bookings',
            retiredChip: 'Retired → v{version}',
            retiredTitle: 'Announced on {date} by {by}',
            retirementsUnreadable: 'The retirements could not be read: {error}',
        },
        retireDialog: {
            title: 'Retire v{version}',
            intro: 'The bookings of {bundleKey} v{version} continue on the version on sale now, each at the first end of its billing period at least three months after its notice reached it. Until then they may be cancelled without their minimum term. Every subscription it reaches is told.',
            noVersionOnSale:
                '{bundleKey} has no version on sale for the bookings to continue on. Publish one first.',
            replacement: 'Replacement: {bundleKey} v{version}',
            priceChange: '{from} → {to}',
            notSold: 'not sold',
            pricesNote:
                'List prices. Where a plan sets a price of its own for the add-on, the booking is told that one.',
            otherChanges: 'Plus {count} changes to features or quotas.',
            reachedTitle: 'Reaches {count} bookings',
            dateRow: '{count} move on {date} — may cancel without the minimum term until {lastDay}',
            skippedTitle: 'Not reached',
            skipped: {
                ended: '{count} ended',
                cancelledBefore: '{count} cancelled, landing before then',
                noTerm: '{count} without a billing period to count from',
                alreadyTold: '{count} already told by an earlier retirement of this version',
            },
            blockers: {
                BUNDLE_RETIREMENT_VERSION_ON_SALE:
                    'v{version} of {bundleKey} is still on sale. Publish the version that replaces it, and retire this one once its sale has ended, so nobody books it after the announcement.',
                BUNDLE_RETIREMENT_REPLACEMENT_NOT_ON_SALE:
                    'v{version} of {bundleKey} is not on sale, so bookings cannot continue on it.',
                BUNDLE_RETIREMENT_REPLACEMENT_OF_ANOTHER_BUNDLE:
                    'The replacement is a version of {replacementBundleKey}, not of {bundleKey}. A booking continues on a version of its own add-on.',
                BUNDLE_RETIREMENT_REPLACEMENT_CANNOT_RUN:
                    '{count} of these bookings run beside a plan that v{version} of {bundleKey} cannot run beside, so they cannot continue on it.',
                BUNDLE_RETIREMENT_NOTHING_AFFECTED:
                    'No running booking is on v{version} of {bundleKey}, so there is nobody to tell.',
                RETIREMENT_WITHIN_TWELVE_MONTHS:
                    '{count} of these bookings belong to subscriptions reached by a retirement within the last twelve months. A subscription is reached at most once a year.',
            },
            announce: 'Announce',
            mfa: 'Retire v{version} of {bundleKey} for running bookings.',
            previewChanged:
                'The bookings it reaches have changed. Check the updated preview and announce again.',
            done: 'Announced. {told} bookings told, {failed} to be tried again by the next run.',
        },
        editor: {
            overlapOne:
                'plan with an overlap — features/quotas of this bundle are already contained in the plan. Please clean up before publishing.',
            overlapMany:
                'plans with an overlap — features/quotas of this bundle are already contained in the plan. Please clean up before publishing.',
            sectionFeatures: 'Features',
            sectionPricing: 'Pricing',
            pricingHint: 'Bundle price · on top of the plan',
            yearlyEquivalent: '≈ {amount} €/mo when booked yearly',
            savings: 'save {percent} %',
            validityHint: 'validUntil automatic (auto succession)',
            validUntilHint: 'set automatically when a successor version is published',
            sectionMarketing: 'Marketing',
            marketed: 'Market in the public catalog',
            sectionChangeNote: 'Change note',
            changeNoteRequired: 'Required when publishing',
            changeNotePlaceholder: 'e.g. Add WhatsApp + price adjustment +4 €',
            selectedCount: '{count} selected',
            saveTooltip: 'Save changes',
            saveVersion: 'Save version',
            saveDisabledTooltip: 'Form is invalid or unchanged',
        },
        featuresEditor: {
            empty: 'No features in the discovery snapshot.',
            overlapTooltip: 'Feature is already included in the compatible plan — double counting',
            removeTooltip: 'Remove from bundle',
            addTooltip: 'Add to bundle',
        },
        quotasEditor: {
            empty: 'No quotas in the discovery snapshot.',
            removeTooltip: 'Remove quota',
            addTooltip: 'Add quota',
        },
        filterBar: {
            searchPlaceholder: 'Search bundle key or label …',
        },
        compatPicker: {
            hint: 'Plans this bundle can be booked with as an add-on. Features/quotas the plan already contains are flagged as an overlap (double counting).',
            lockedTooltip: 'Live version is read-only',
            removeTooltip: 'Remove plan compatibility',
            addTooltip: 'Set plan compatibility',
            overlapHead: '⚠ Overlap',
            overlapFeatures: 'Features:',
            overlapQuotas: 'Quotas:',
            empty: 'No plans available — the plan master record has to be created first.',
            summaryOne:
                'plan with an overlap — features/quotas of this bundle are already contained in the plan. Clean up either the bundle or the plan before publishing.',
            summaryMany:
                'plans with an overlap — features/quotas of this bundle are already contained in the plan. Clean up either the bundle or the plan before publishing.',
        },
        publishDialog: {
            title: 'Publish bundle version',
            bundleLabel: 'Bundle',
            loadingDiff: 'Loading the diff against the previous version …',
            strictWarnings: '{count} strict mode warning(s)',
            allowZeroPrice: 'Deliberately allow price 0.00 (free bundle)',
            allowZeroPriceHint:
                'Default: publishing with an explicit price of 0.00 is blocked (seed protection).',
            changesVs: 'Changes compared to',
            noPrevious: '— no previous version (first publication)',
            noChanges: 'No changes — the versions are identical in content.',
            regressionTitle: 'Regressive change detected.',
            regressionBody:
                'This version removes features, lowers quotas or increases prices. Contract protection P3 (SPEC.md §6) requires an opt-in from existing contracts. Publishing requires your explicit',
            regressionBodySuffix: ' confirmation.',
            forceRegressive: 'Publish anyway',
            confirm: 'Publish',
            confirmRegressive: 'Publish regressively',
            mfaDescription: 'Publish version v{version} of bundle {bundleKey}.',
        },
    },
);
