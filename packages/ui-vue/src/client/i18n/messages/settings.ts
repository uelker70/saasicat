// translation-catalogue: the German half of this file is German on purpose.
import { defineMessages } from '../define.js';

export const settingsMessages = defineMessages(
    {
        title: 'Einstellungen',
        subtitle: 'Was diese Installation ausführt — und seit wann.',
        applied: {
            title: 'Angewendete Konfiguration',
            appliedAt: 'Angewendet am',
            source: 'Quelle',
            fingerprint: 'Fingerabdruck',
            notRecorded:
                'Diese Installation zeichnet nicht auf, wann ihre Konfiguration angewendet wurde: der Persistenz-Adapter liefert keinen `core.appliedSettings`-Port. Die Werte unten sind die laufenden.',
            recordStale:
                'Der Datensatz beschreibt eine frühere Konfiguration — der Start konnte ihn nicht schreiben. Die Werte unten sind die laufenden; siehe das Boot-Log.',
            readOnly:
                'Nur lesen. Diese Werte leben in der Datei; eine Änderung dort greift beim nächsten Start.',
        },
        changes: {
            title: 'Änderungen zwischen zwei Starts',
            empty: 'Kein Start hat die Einstellungen verändert vorgefunden.',
            noticedAt: 'Bemerkt am',
            leaf: 'Einstellung',
            before: 'Vorher',
            after: 'Nachher',
            absent: '— nicht gesetzt —',
            acknowledge: 'Als gesehen markieren',
            acknowledgedBy: 'Gesehen von {who} am {when}',
            open: 'Ungesehen',
            acknowledged: 'Gesehen',
        },
        values: {
            title: 'Laufende Werte',
            value: 'Wert',
        },
        loadFailed: 'Die Einstellungen konnten nicht geladen werden.',
        acknowledgeFailed: 'Die Änderung konnte nicht als gesehen markiert werden.',
    },
    {
        title: 'Settings',
        subtitle: 'What this installation is running on — and since when.',
        applied: {
            title: 'Applied configuration',
            appliedAt: 'Applied at',
            source: 'Source',
            fingerprint: 'Fingerprint',
            notRecorded:
                'This installation does not record when its configuration was applied: the persistence adapter provides no `core.appliedSettings` port. The values below are the running ones.',
            recordStale:
                'The record describes an earlier configuration — the start could not write it. The values below are the running ones; see the boot log.',
            readOnly:
                'Read-only. These values live in the file; a change there takes effect at the next start.',
        },
        changes: {
            title: 'Changes between two starts',
            empty: 'No start has found the settings changed.',
            noticedAt: 'Noticed at',
            leaf: 'Setting',
            before: 'Before',
            after: 'After',
            absent: '— not set —',
            acknowledge: 'Mark as seen',
            acknowledgedBy: 'Seen by {who} on {when}',
            open: 'Unseen',
            acknowledged: 'Seen',
        },
        values: {
            title: 'Running values',
            value: 'Value',
        },
        loadFailed: 'The settings could not be loaded.',
        acknowledgeFailed: 'The change could not be marked as seen.',
    },
);
