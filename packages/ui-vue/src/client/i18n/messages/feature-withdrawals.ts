// translation-catalogue: the German half of this file is German on purpose.
import { defineMessages } from '../define.js';

export const featureWithdrawalsMessages = defineMessages(
    {
        title: 'Zurückgezogene Features',
        subtitle:
            'Ein Feature allen nehmen, die es haben, wenn ein äußerer Grund es wegnimmt — ein abgeschalteter Dienst, ein geändertes Gesetz.',
        withdraw: 'Feature zurückziehen',
        loadFailed: 'Die Rückzüge konnten nicht geladen werden.',
        empty: 'Noch kein Feature zurückgezogen.',
        emptyHint:
            'Ab dem genannten Datum gewährt die Plattform das Feature niemandem mehr. Wer es hat, wird sofort informiert, zahlt ab dann die genannte Minderung weniger und darf sofort kündigen, solange es fehlt.',
        listTitle: 'Rückzüge',
        columns: {
            feature: 'Feature',
            reason: 'Grund',
            effectiveFrom: 'Zurückgezogen ab',
            liftedFrom: 'Wieder gewährt ab',
            status: 'Status',
            progress: 'Erreicht',
        },
        status: {
            announced: 'Angekündigt',
            inEffect: 'Zurückgezogen',
            lifted: 'Aufgehoben',
        },
        progress: '{reached} Abonnements, {told} informiert, {endedAtOnce} sofort beendet',
        lift: 'Aufheben',
        dialog: {
            title: 'Feature zurückziehen',
            intro: 'Ab dem Datum gewährt die Plattform das Feature niemandem mehr — gleich, welcher Plan, welches Zusatzpaket oder welcher Vertrag es gewährt. Wer es hat, wird sofort informiert.',
            feature: 'Feature',
            effectiveFrom: 'Zurückgezogen ab',
            effectiveFromHint: 'Leer lassen, um es sofort zurückzuziehen. Zeiten in {zone}.',
            reason: 'Grund — so lesen ihn die Abonnenten',
            reachedTitle: 'Erreicht {count} Abonnements',
            nothingReached:
                'Gerade hat niemand dieses Feature. Wer während des Rückzugs abschließt, sieht es vorher als nicht verfügbar gekennzeichnet.',
            specialTerms:
                '{count} davon haben das Feature nur über Sonderkonditionen: Sie werden informiert und dürfen sofort kündigen; eine Minderung gilt dort nicht von selbst.',
            endingBefore: '{count} Abonnements enden vor dem Datum und werden nicht informiert.',
            reductionsTitle: 'Minderungen',
            reductionsIntro:
                'Netto, je ganzem Zeitraum des Rhythmus. Ohne Betrag wird die Zeile nicht gemindert.',
            target: '{label} ({key}), {cycle}',
            targetLines: '{lines} Zeilen, niedrigster Preis {price}',
            priceUnknown: 'unbekannt',
            amount: 'Minderung netto',
            problems: {
                notAnAmount: 'Bitte einen Betrag eingeben.',
                notPositive: 'Die Minderung muss größer als 0 sein.',
                tooPrecise: 'Höchstens auf den Cent genau.',
                exceedsPrice: 'Höchstens {price}, der niedrigste Preis, den sie mindert.',
            },
            blockers: {
                FEATURE_WITHDRAWAL_OPEN:
                    '{featureKey} ist bereits zurückgezogen, und dieser Rückzug ist nicht aufgehoben. Erst aufheben, dann einen weiteren ankündigen.',
                FEATURE_WITHDRAWAL_OVERLAPS:
                    '{featureKey} ist bis zum {date} zurückgezogen. Ein weiterer Rückzug kann frühestens an diesem Tag beginnen.',
            },
            announce: 'Zurückziehen',
            done: 'Zurückgezogen. Die Liste zeigt, wie viele Abonnements es erreicht und wie viele davon informiert sind.',
            previewChanged:
                'Die erreichten Abonnements haben sich seit der Anzeige geändert. Die Vorschau zeigt jetzt den aktuellen Stand.',
            mfa: 'Zweiter Faktor, um {feature} zurückzuziehen',
        },
        liftDialog: {
            title: 'Rückzug aufheben',
            intro: 'Ab dem Datum wird {feature} wieder gewährt; die Minderung und das Recht, sofort zu kündigen, enden. Jedes erreichte Abonnement, das noch läuft, wird informiert.',
            liftedFrom: 'Wieder gewährt ab',
            liftedFromHint: 'Leer lassen, um ihn sofort aufzuheben. Zeiten in {zone}.',
            submit: 'Aufheben',
            done: 'Rückzug aufgehoben.',
            mfa: 'Zweiter Faktor, um den Rückzug von {feature} aufzuheben',
        },
    },
    {
        title: 'Withdrawn features',
        subtitle:
            'Take a feature from everybody who holds it when a reason outside the platform takes it away — a service switched off, a law changed.',
        withdraw: 'Withdraw a feature',
        loadFailed: 'The withdrawals could not be loaded.',
        empty: 'No feature withdrawn yet.',
        emptyHint:
            'From the date named, the platform grants the feature to nobody. Whoever holds it is told at once, pays less by the reduction named from then on, and may end at once for as long as it is missing.',
        listTitle: 'Withdrawals',
        columns: {
            feature: 'Feature',
            reason: 'Reason',
            effectiveFrom: 'Withdrawn from',
            liftedFrom: 'Granted again from',
            status: 'Status',
            progress: 'Reached',
        },
        status: {
            announced: 'Announced',
            inEffect: 'Withdrawn',
            lifted: 'Lifted',
        },
        progress: '{reached} subscriptions, {told} told, {endedAtOnce} ended at once',
        lift: 'Lift',
        dialog: {
            title: 'Withdraw a feature',
            intro: 'From the date, the platform grants the feature to nobody — whichever plan, add-on or contract grants it. Whoever holds it is told at once.',
            feature: 'Feature',
            effectiveFrom: 'Withdrawn from',
            effectiveFromHint: 'Leave empty to withdraw it at once. Times in {zone}.',
            reason: 'Reason — as the subscribers read it',
            reachedTitle: 'Reaches {count} subscriptions',
            nothingReached:
                'Nobody holds this feature right now. Whoever concludes while it is withdrawn sees it marked as unavailable first.',
            specialTerms:
                '{count} of them hold the feature through special terms only: they are told and may end at once; no reduction applies there by itself.',
            endingBefore: '{count} subscriptions end before the date and are not told.',
            reductionsTitle: 'Reductions',
            reductionsIntro:
                'Net, per whole period of the rhythm. A line without an amount is not reduced.',
            target: '{label} ({key}), {cycle}',
            targetLines: '{lines} lines, lowest price {price}',
            priceUnknown: 'unknown',
            amount: 'Reduction, net',
            problems: {
                notAnAmount: 'Enter an amount.',
                notPositive: 'The reduction has to be more than 0.',
                tooPrecise: 'To the cent at most.',
                exceedsPrice: 'At most {price}, the lowest price it reduces.',
            },
            blockers: {
                FEATURE_WITHDRAWAL_OPEN:
                    '{featureKey} is withdrawn already, and that withdrawal is not lifted. Lift it before announcing another.',
                FEATURE_WITHDRAWAL_OVERLAPS:
                    '{featureKey} is withdrawn until {date}. Another withdrawal can begin on that date at the earliest.',
            },
            announce: 'Withdraw',
            done: 'Withdrawn. The list shows how many subscriptions it reached and how many of them were told.',
            previewChanged:
                'The subscriptions it reaches changed since they were shown. The preview now shows them as they stand.',
            mfa: 'Second factor to withdraw {feature}',
        },
        liftDialog: {
            title: 'Lift the withdrawal',
            intro: 'From the date, {feature} is granted again; the reduction and the right to end at once end. Every subscription it reached that still runs is told.',
            liftedFrom: 'Granted again from',
            liftedFromHint: 'Leave empty to lift it at once. Times in {zone}.',
            submit: 'Lift',
            done: 'Withdrawal lifted.',
            mfa: 'Second factor to lift the withdrawal of {feature}',
        },
    },
);
