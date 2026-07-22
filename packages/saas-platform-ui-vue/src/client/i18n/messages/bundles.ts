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
            validity: 'Gültigkeit',
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
            confirmSoftDelete:
                "Bundle '{bundleKey}' wirklich soft-deleten? Bestand bleibt durch published BundleVersions geschützt.",
            confirmDiscardVersion: 'Diese Draft-Version verwerfen? Der Inhalt geht verloren.',
        },
        header: {
            title: 'Bundles',
            subtitle:
                'Produktgruppen aus Features & Quotas — verwendet in Plänen. Bundles werden im SuperAdmin kuratiert.',
            displayLocale: 'Anzeige-Sprache',
            newBundle: 'Neues Bundle',
            reload: 'Liste neu laden',
        },
        filter: {
            all: 'Alle Status',
            live: 'Nur Live',
            scheduled: 'Mit geplanter Version',
            draft: 'Drafts',
            superseded: 'Abgelöste',
            retired: 'Retired',
        },
        kpis: {
            total: 'Bundles gesamt',
            totalSub: '{live} live · {scheduled} mit geplanter Version',
            scheduled: 'Geplante Versionen',
            scheduledSub: 'zukünftig aktiv · noch nicht verkaufbar',
            drafts: 'Offene Drafts',
            draftsSub: '{count} Bundle(s) ohne Publish',
            translated: 'Mit Übersetzung',
            translatedSub: '{count} aktive Sprache(n) im Projekt',
        },
        list: {
            translationCount: '{count} Übersetzung(en)',
            emptyNoMatch: 'Keine Bundles entsprechen der Suche.',
        },
        // Lifecycle status of a BundleVersion / of a bundle stem.
        status: {
            draft: {
                label: 'Draft',
                tooltip: 'Noch nicht veröffentlicht — frei editierbar',
            },
            live: {
                label: 'Live',
                tooltip: 'Aktive Version · verkaufbar · read-only (laufende Verträge)',
            },
            scheduled: {
                label: 'Geplant',
                tooltip: 'Zukünftig aktiv · noch nicht verkaufbar · frei editierbar',
            },
            superseded: {
                label: 'Abgelöst',
                tooltip: 'Durch neue Version ersetzt · Bestand bleibt',
            },
            retired: {
                label: 'Retired',
                tooltip: 'Bundle-Stamm wurde soft-deleted',
            },
        },
        // BundleDetailPanel — master data + translations of the open bundle.
        detail: {
            fieldIcon: 'Icon',
            fieldSortOrder: 'Sortier-Reihenfolge',
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
            descriptionPlaceholder:
                'z. B. Kampagnen, WhatsApp und Korrespondenz für aktive Vereine.',
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
            is: 'ist',
            live: 'live',
            liveTail: 'seit {date} — wird aktuell als Add-On angeboten.',
            liveWarning:
                'Inhalt & Preis sind read-only (laufende Verträge). Für Änderungen eine neue Version anlegen.',
            scheduled: 'geplant',
            scheduledTail: 'für {date} — wird ab dann verkaufbar.',
            scheduledOk: 'Frei editierbar bis dahin.',
            superseded: 'abgelöst',
            supersededTail:
                '({from} – {until}) — wird nicht mehr angeboten, Bestand bleibt für Abrechnung erhalten.',
            draft: 'Draft',
            draftTail: '— noch nicht published, frei editierbar.',
            discard: 'Verwerfen',
            discardTooltip: 'Geplante Version verwerfen',
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
            saveDisabledTooltip: 'Form ist invalide oder unverändert',
        },
        // BundlePlanCompatPicker — plans this bundle may be booked with.
        featuresEditor: {
            empty: 'Keine Features im Discovery-Snapshot.',
            fallbackGroup: 'Allgemein',
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
            validity: 'Validity',
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
            confirmSoftDelete:
                "Really soft-delete bundle '{bundleKey}'? Existing contracts stay protected by published bundle versions.",
            confirmDiscardVersion: 'Discard this draft version? Its content will be lost.',
        },
        header: {
            title: 'Bundles',
            subtitle:
                'Product groups made of features & quotas — used in plans. Bundles are curated in the SuperAdmin.',
            displayLocale: 'Display language',
            newBundle: 'New bundle',
            reload: 'Reload list',
        },
        filter: {
            all: 'All statuses',
            live: 'Live only',
            scheduled: 'With scheduled version',
            draft: 'Drafts',
            superseded: 'Superseded',
            retired: 'Retired',
        },
        kpis: {
            total: 'Bundles total',
            totalSub: '{live} live · {scheduled} with a scheduled version',
            scheduled: 'Scheduled versions',
            scheduledSub: 'active in the future · not sellable yet',
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
                label: 'Draft',
                tooltip: 'Not published yet — freely editable',
            },
            live: {
                label: 'Live',
                tooltip: 'Active version · sellable · read-only (running contracts)',
            },
            scheduled: {
                label: 'Scheduled',
                tooltip: 'Active in the future · not sellable yet · freely editable',
            },
            superseded: {
                label: 'Superseded',
                tooltip: 'Replaced by a newer version · existing contracts remain',
            },
            retired: {
                label: 'Retired',
                tooltip: 'Bundle master record was soft-deleted',
            },
        },
        detail: {
            fieldIcon: 'Icon',
            fieldSortOrder: 'Sort order',
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
            descriptionPlaceholder: 'e.g. Campaigns, WhatsApp and correspondence for active clubs.',
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
            is: 'is',
            live: 'live',
            liveTail: 'since {date} — currently offered as an add-on.',
            liveWarning:
                'Content & price are read-only (running contracts). Create a new version to make changes.',
            scheduled: 'scheduled',
            scheduledTail: 'for {date} — becomes sellable from then on.',
            scheduledOk: 'Freely editable until then.',
            superseded: 'superseded',
            supersededTail:
                '({from} – {until}) — no longer offered, existing contracts remain for billing.',
            draft: 'Draft',
            draftTail: '— not published yet, freely editable.',
            discard: 'Discard',
            discardTooltip: 'Discard scheduled version',
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
            saveDisabledTooltip: 'Form is invalid or unchanged',
        },
        featuresEditor: {
            empty: 'No features in the discovery snapshot.',
            fallbackGroup: 'General',
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
        },
    },
);
