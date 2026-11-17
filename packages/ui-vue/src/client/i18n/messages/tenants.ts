// translation-catalogue: the German half of this file is German on purpose.
import { defineMessages } from '../define.js';

export const tenantsMessages = defineMessages(
    {
        // Terms shared by the list, the detail page and the subscriptions table.
        tenant: 'Mandant',
        plan: 'Plan',
        list: {
            title: 'Mandanten',
            searchPlaceholder: 'Slug oder Name …',
            allStatuses: 'Alle Aktiv-Status',
            allPlans: 'Alle Pläne',
            columnUsage: 'Verbrauch',
            columnCreatedAt: 'Angelegt',
            suspended: 'Suspendiert',
            readOnly: 'Nur lesen',
            beingDeleted: 'Wird gelöscht',
            empty: 'Keine Mandanten mit diesen Filtern.',
        },
        detail: {
            backToList: 'Mandanten-Liste',
            slug: 'Slug',
            masterData: 'Stammdaten',
            pilot: 'Pilot',
            trialEnd: 'Trial-Ende',
            pilotEnd: 'Pilot-Ende',
            vatId: 'USt-IdNr.',
            usage: 'Verbrauch',
            users: 'User',
            userEmail: 'E-Mail',
            userRole: 'Rolle',
            userLastLogin: 'Letzter Login',
            access: 'Zugang',
            accessOpen: 'Nicht eingeschränkt.',
            accessSince: 'seit {day}',
            accessSuspended: 'Vom Betreiber gesperrt',
            accessOverdue: 'Am Stichtag nicht bezahlt',
            accessOverdueUnnamed: 'Eine Rechnung, am Stichtag nicht bezahlt',
            accessEnded: 'Abonnement beendet',
            accessDeleting: 'Löschung läuft',
            accessNote: 'Notiz: {note}',
            accessDeletesOn: 'Daten werden am {day} gelöscht',
            accessExportDownload: 'Export heruntergeladen am {day} von {by}',
            accessExportNone: 'Der Export wurde noch nicht heruntergeladen.',
            // Where the tenant's deletion stands, on its page and in its
            // subscriber's record alike (`SC-ADM-058`).
            deletion: {
                title: 'Löschung',
                states: {
                    scheduled: 'Vorgesehen',
                    due: 'Fällig',
                    halted: 'Angehalten',
                    running: 'Läuft',
                    retrying: 'Wird wiederholt',
                    deleted: 'Gelöscht',
                },
                scheduled: 'Die Daten des Mandanten werden am {day} gelöscht.',
                wouldBeHeld: 'Wäre heute der Löschtag, würde die Löschung angehalten:',
                due: 'Fällig seit {day}. Der nächste Lauf beginnt die Löschung.',
                haltedDue: 'Fällig seit {day}, angehalten:',
                haltedBegun: 'Begonnen am {moment}, angehalten:',
                running: 'Läuft seit {moment}; {erased} von {total} Speichern gelöscht.',
                retrying:
                    'Begonnen am {moment}; gescheiterte Versuche bisher: {attempts}. Der nächste Lauf versucht es erneut.',
                deleted: 'Gelöscht am {moment}.',
                lastFailure:
                    'Zuletzt am {moment}: Speicher „{store}“, Schritt „{step}“, Code „{code}“.',
                lastFailureNoStore: 'Zuletzt am {moment}: Schritt „{step}“, Code „{code}“.',
                reasons: {
                    'installation-unmarked':
                        'Die Datenbank ist nicht als Installation „{expected}“ markiert. Soll in ihr gelöscht werden: „installation mark {expected}“ in der Kommandozeile der Anwendung.',
                    'installation-differs':
                        'Die Datenbank ist als Installation „{marked}“ markiert, dieser Prozess läuft als „{expected}“. Ist es die Datenbank von „{expected}“, etwa nach dem Zurückspielen einer Sicherung: „installation mark {expected} --replace“ in der Kommandozeile der Anwendung.',
                    'no-subscriber':
                        'Der Mandant hat keinen Vertragspartner, bei dem das Protokoll der Löschung bleibt.',
                    'contract-runs-past-end':
                        'Ein Vertrag des Mandanten läuft über das Ende seines Abonnements hinaus.',
                    'commercial-record-lost':
                        'Speicher „{store}“ hat Teile des kaufmännischen Datensatzes mitgenommen ({lost}). Kein weiterer Speicher löscht, bis ein Mensch entscheidet.',
                },
                commercialRecordLostNoStore:
                    'Teile des kaufmännischen Datensatzes fehlen ({lost}). Kein weiterer Speicher löscht, bis ein Mensch entscheidet.',
                lostPart: '{part} {before} → {after}',
                steps: {
                    count: 'Zählen',
                    erase: 'Löschen',
                    guard: 'Prüfen des kaufmännischen Datensatzes',
                    close: 'Abschließen',
                },
                failures: {
                    timeout: 'Der Speicher hat nicht rechtzeitig geantwortet.',
                    'invalid-counts':
                        'Der Speicher hat keine gültige Zählung gemeldet. Das löst sich nicht von selbst: Der Löscher der Anwendung muss korrigiert werden.',
                    'stores-changed':
                        'Die Anwendung meldet andere Speicher als beim Beginn der Löschung. Das löst sich nicht von selbst: Die Löscherliste der Anwendung muss wieder dieselben Speicher nennen.',
                    'tenant-id-invalid':
                        'Die Mandanten-ID darf keinem Speicher übergeben werden; das Server-Log nennt den Grund.',
                    unknown: 'Der Fehler nannte keinen Code; das Server-Log nennt ihn.',
                },
                parts: {
                    subscriber: 'Vertragspartner',
                    contracts: 'Verträge',
                    charges: 'Buchungen',
                    invoices: 'Rechnungen',
                    payments: 'Zahlungen',
                    credits: 'Gutschriften',
                },
            },
        },
        actions: {
            confirmTitle: 'Aktion bestätigen',
            leadAction: 'Aktion',
            leadForTenant: 'für Tenant',
            typedSlugHint: 'Bestätige durch Eintippen des Slugs',
            slugMismatch: 'Muss exakt „{slug}“ sein',
            extendUntilLabel: 'Verlängern bis (Datum)',
            dateFutureError: 'Bitte ein Datum in der Zukunft wählen.',
            reasonLabel: 'Grund (Pflicht für Audit-Log, mindestens 5 Zeichen)',
            reasonError: 'Bitte einen Grund mit mindestens 5 Zeichen angeben.',
            mfaDescription: '{action} — Tenant „{tenant}". TOTP-Code aus Authenticator eingeben.',
            successNotify: '{action}: erfolgreich.',
        },
        subscriptions: {
            title: 'Abonnements',
            subtitle: 'Der aktuelle Stand je Mandant, wie die Anwendung ihn führt.',
            subtitleWithRegister:
                'Der aktuelle Stand je Mandant, wie die Anwendung ihn führt. Jeden abgeschlossenen Vertrag, auch früherer Vertragspartner und gelöschter Mandanten, zeigt die Seite „Verträge“.',
            columnEndsAt: 'Endet',
        },
        draft: {
            planModules: '{count} Basis-Module',
        },
    },
    {
        tenant: 'Tenant',
        plan: 'Plan',
        list: {
            title: 'Tenants',
            searchPlaceholder: 'Slug or name …',
            allStatuses: 'All active states',
            allPlans: 'All plans',
            columnUsage: 'Usage',
            columnCreatedAt: 'Created',
            suspended: 'Suspended',
            readOnly: 'Read-only',
            beingDeleted: 'Being deleted',
            empty: 'No tenants match these filters.',
        },
        detail: {
            backToList: 'Tenant list',
            slug: 'Slug',
            masterData: 'Master data',
            pilot: 'Pilot',
            trialEnd: 'Trial end',
            pilotEnd: 'Pilot end',
            vatId: 'VAT ID',
            usage: 'Usage',
            users: 'Users',
            userEmail: 'Email',
            userRole: 'Role',
            userLastLogin: 'Last login',
            access: 'Access',
            accessOpen: 'Not held back.',
            accessSince: 'since {day}',
            accessSuspended: 'Suspended by the operator',
            accessOverdue: 'Unpaid on its due date',
            accessOverdueUnnamed: 'An invoice unpaid on its due date',
            accessEnded: 'Subscription ended',
            accessDeleting: 'Deletion under way',
            accessNote: 'Note: {note}',
            accessDeletesOn: 'Data is deleted on {day}',
            accessExportDownload: 'Export downloaded on {day} by {by}',
            accessExportNone: 'The export has not been downloaded yet.',
            deletion: {
                title: 'Deletion',
                states: {
                    scheduled: 'Scheduled',
                    due: 'Due',
                    halted: 'Halted',
                    running: 'Under way',
                    retrying: 'Being retried',
                    deleted: 'Deleted',
                },
                scheduled: "The tenant's data is deleted on {day}.",
                wouldBeHeld: 'Were the deletion day today, the deletion would be halted:',
                due: 'Due since {day}. The next run begins the deletion.',
                haltedDue: 'Due since {day}, halted:',
                haltedBegun: 'Begun on {moment}, halted:',
                running: 'Under way since {moment}; {erased} of {total} stores erased.',
                retrying:
                    'Begun on {moment}; failed attempts so far: {attempts}. The next run tries again.',
                deleted: 'Deleted on {moment}.',
                lastFailure: 'Last, on {moment}: store “{store}”, step “{step}”, code “{code}”.',
                lastFailureNoStore: 'Last, on {moment}: step “{step}”, code “{code}”.',
                reasons: {
                    'installation-unmarked':
                        "The database is not marked as installation “{expected}”. Once it is the one to delete in: “installation mark {expected}” on the application's command line.",
                    'installation-differs':
                        "The database is marked as installation “{marked}”, and this process runs as “{expected}”. Where it is the database of “{expected}”, as after restoring a backup: “installation mark {expected} --replace” on the application's command line.",
                    'no-subscriber':
                        'The tenant has no subscriber to keep the record of its deletion with.',
                    'contract-runs-past-end':
                        'A contract of the tenant runs past the end of its subscription.',
                    'commercial-record-lost':
                        'Store “{store}” took parts of the commercial record with it ({lost}). No further store erases until a person decides.',
                },
                commercialRecordLostNoStore:
                    'Parts of the commercial record are missing ({lost}). No further store erases until a person decides.',
                lostPart: '{part} {before} → {after}',
                steps: {
                    count: 'Counting',
                    erase: 'Erasing',
                    guard: 'Checking the commercial record',
                    close: 'Closing',
                },
                failures: {
                    timeout: 'The store did not answer in time.',
                    'invalid-counts':
                        "The store reported no valid count. This does not pass by itself: the application's eraser has to be fixed.",
                    'stores-changed':
                        "The application lists other stores than the deletion began with. This does not pass by itself: the application's list of erasers has to name the same stores again.",
                    'tenant-id-invalid':
                        'The tenant identifier may not be handed to a store; the server log says why.',
                    unknown: 'The failure carried no code; the server log names it.',
                },
                parts: {
                    subscriber: 'Subscriber',
                    contracts: 'Contracts',
                    charges: 'Charges',
                    invoices: 'Invoices',
                    payments: 'Payments',
                    credits: 'Credits',
                },
            },
        },
        actions: {
            confirmTitle: 'Confirm action',
            leadAction: 'Action',
            leadForTenant: 'for tenant',
            typedSlugHint: 'Confirm by typing the slug',
            slugMismatch: 'Must be exactly “{slug}”',
            extendUntilLabel: 'Extend until (date)',
            dateFutureError: 'Please pick a date in the future.',
            reasonLabel: 'Reason (required for the audit log, at least 5 characters)',
            reasonError: 'Please enter a reason with at least 5 characters.',
            mfaDescription:
                '{action} — tenant “{tenant}”. Enter the TOTP code from your authenticator.',
            successNotify: '{action}: succeeded.',
        },
        subscriptions: {
            title: 'Subscriptions',
            subtitle: 'The current state per tenant, as the application keeps it.',
            subtitleWithRegister:
                "The current state per tenant, as the application keeps it. Every contract concluded, former subscribers' and deleted tenants' included, is on the Contracts page.",
            columnEndsAt: 'Ends',
        },
        draft: {
            planModules: '{count} base modules',
        },
    },
);
