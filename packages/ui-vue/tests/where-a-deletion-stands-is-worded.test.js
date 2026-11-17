// Where a tenant's deletion stands, in the catalogue's words: the state for its
// pill, what the state says with its day or moment, every reason that holds the
// deletion with what it names, the last failure with its code, and what the
// subscriber's record keeps of it. The platform decides the state
// (`tenantDeletionStatusOf` in core); these only word it, with the page's own
// way of writing a day, a moment and a size.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { COMMERCIAL_RECORD_FIELDS, TENANT_DELETION_PLATFORM_FAILURE_CODES } from '@saasicat/core';

import {
    SA_MESSAGES,
    TENANT_DELETION_STATE_TONE,
    formatFileSize,
    tenantDeletionRecordWording,
    tenantDeletionWording,
} from '../dist/index.js';

const EN = SA_MESSAGES.en.tenants.detail.deletion;
const DE = SA_MESSAGES.de.tenants.detail.deletion;
const RECORD_EN = { deletion: EN, record: SA_MESSAGES.en.subscribers.record.deletions };
const WRITE = {
    day: (day) => `[${day}]`,
    moment: (iso) => `<${iso}>`,
    size: (bytes) => `${bytes} B`,
};

const DAY = '2026-12-01';
const STARTED = '2026-11-30T23:15:00.000Z';
const FAILED = '2026-11-30T23:38:00.000Z';

const COMMERCIAL = {
    subscriber: 1,
    contracts: 2,
    charges: 9,
    invoices: 3,
    payments: 3,
    credits: 0,
};

/** A record of a begun deletion, every part empty unless `overrides` says otherwise. */
function recordOf(overrides = {}) {
    return {
        exportOfferedFrom: '2026-10-31T09:00:00.000Z',
        exportBlockedBySuspension: false,
        announcedOn: null,
        keep: [],
        stores: [],
        commercialBefore: null,
        commercialAfter: null,
        startedAt: STARTED,
        closedAt: null,
        attempts: 0,
        lastFailure: null,
        reminders: [],
        downloads: [],
        ...overrides,
    };
}

function deletionOf(status, record = null) {
    return { tenantId: 't-1', status, record };
}

const UNMARKED = { reason: 'installation-unmarked', expected: 'ahp-prod' };
const DIFFERS = { reason: 'installation-differs', expected: 'ahp-prod', marked: 'ahp-staging' };
const NO_SUBSCRIBER = { reason: 'no-subscriber' };
const CONTRACT = { reason: 'contract-runs-past-end' };

const UNMARKED_EN =
    "The database is not marked as installation “ahp-prod”. Once it is the one to delete in: “installation mark ahp-prod” on the application's command line.";
const NO_SUBSCRIBER_EN = 'The tenant has no subscriber to keep the record of its deletion with.';
const CONTRACT_EN = 'A contract of the tenant runs past the end of its subscription.';

// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
describe('where a deletion stands, by state', () => {
    test('scheduled, with nothing that would hold it, names its day', () => {
        const wording = tenantDeletionWording(
            deletionOf({ kind: 'scheduled', deletesOn: DAY, wouldBeHeldBy: [] }),
            EN,
            WRITE,
        );

        assert.deepEqual(wording, {
            label: 'Scheduled',
            lines: ["The tenant's data is deleted on [2026-12-01]."],
            reasons: [],
        });
    });

    test('due names the day it has been due since', () => {
        const wording = tenantDeletionWording(
            deletionOf({ kind: 'due', deletesOn: DAY }),
            EN,
            WRITE,
        );

        assert.deepEqual(wording, {
            label: 'Due',
            lines: ['Due since [2026-12-01]. The next run begins the deletion.'],
            reasons: [],
        });
    });

    test('under way names when it began and how many stores have erased', () => {
        const wording = tenantDeletionWording(
            deletionOf(
                {
                    kind: 'running',
                    deletesOn: DAY,
                    startedAt: STARTED,
                    storesErased: 1,
                    storesTotal: 2,
                    lastFailure: null,
                },
                recordOf(),
            ),
            EN,
            WRITE,
        );

        assert.deepEqual(wording, {
            label: 'Under way',
            lines: [`Under way since <${STARTED}>; 1 of 2 stores erased.`],
            reasons: [],
        });
    });

    test('under way past a store that did not answer names the failure and explains it', () => {
        const lastFailure = { step: 'erase', store: 'files', code: 'timeout', at: FAILED };

        const wording = tenantDeletionWording(
            deletionOf(
                {
                    kind: 'running',
                    deletesOn: DAY,
                    startedAt: STARTED,
                    storesErased: 0,
                    storesTotal: 2,
                    lastFailure,
                },
                recordOf({ lastFailure, attempts: 1 }),
            ),
            EN,
            WRITE,
        );

        assert.deepEqual(wording.lines, [
            `Under way since <${STARTED}>; 0 of 2 stores erased.`,
            `Last, on <${FAILED}>: store “files”, step “Erasing”, code “timeout”.`,
            'The store did not answer in time.',
        ]);
    });

    test("retried after an application's failure names the attempts and the code as it was kept", () => {
        const lastFailure = { step: 'erase', store: 'files', code: 'ECONNRESET', at: FAILED };

        const wording = tenantDeletionWording(
            deletionOf(
                {
                    kind: 'retrying',
                    deletesOn: DAY,
                    startedAt: STARTED,
                    attempts: 3,
                    lastFailure,
                },
                recordOf({ lastFailure, attempts: 3 }),
            ),
            EN,
            WRITE,
        );

        assert.deepEqual(wording, {
            label: 'Being retried',
            lines: [
                `Begun on <${STARTED}>; failed attempts so far: 3. The next run tries again.`,
                `Last, on <${FAILED}>: store “files”, step “Erasing”, code “ECONNRESET”.`,
            ],
            reasons: [],
        });
    });

    test('retried because the stores changed says that it does not pass by itself, and what to do', () => {
        const lastFailure = { step: 'count', store: null, code: 'stores-changed', at: FAILED };

        const wording = tenantDeletionWording(
            deletionOf(
                {
                    kind: 'retrying',
                    deletesOn: DAY,
                    startedAt: STARTED,
                    attempts: 1,
                    lastFailure,
                },
                recordOf({ lastFailure, attempts: 1 }),
            ),
            EN,
            WRITE,
        );

        assert.deepEqual(wording.lines.slice(1), [
            `Last, on <${FAILED}>: step “Counting”, code “stores-changed”.`,
            "The application lists other stores than the deletion began with. This does not pass by itself: the application's list of erasers has to name the same stores again.",
        ]);
    });

    test('deleted names the moment it closed', () => {
        const closedAt = '2026-11-30T23:41:00.000Z';

        const wording = tenantDeletionWording(
            deletionOf({ kind: 'deleted', deletesOn: DAY, closedAt }, recordOf({ closedAt })),
            EN,
            WRITE,
        );

        assert.deepEqual(wording, {
            label: 'Deleted',
            lines: [`Deleted on <${closedAt}>.`],
            reasons: [],
        });
    });

    test('every state has a label in both languages and a tone, and none says another state', () => {
        const kinds = Object.keys(TENANT_DELETION_STATE_TONE);
        assert.deepEqual(kinds.toSorted(), [
            'deleted',
            'due',
            'halted',
            'retrying',
            'running',
            'scheduled',
        ]);
        for (const messages of [EN, DE]) {
            const labels = kinds.map((kind) => messages.states[kind]);
            assert.ok(labels.every((label) => typeof label === 'string' && label !== ''));
            assert.equal(new Set(labels).size, kinds.length);
        }
    });
});

// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
// @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
describe('every reason that holds a deletion, with what it names', () => {
    test('a deletion due on an unmarked database says how to mark it, with its identifier', () => {
        const wording = tenantDeletionWording(
            deletionOf({ kind: 'halted', deletesOn: DAY, heldBy: [UNMARKED] }),
            EN,
            WRITE,
        );

        assert.deepEqual(wording, {
            label: 'Halted',
            lines: ['Due since [2026-12-01], halted:'],
            reasons: [UNMARKED_EN],
        });
    });

    test('a database marked as another installation names both identifiers', () => {
        const wording = tenantDeletionWording(
            deletionOf({ kind: 'halted', deletesOn: DAY, heldBy: [DIFFERS] }),
            EN,
            WRITE,
        );

        assert.deepEqual(wording.reasons, [
            "The database is marked as installation “ahp-staging”, and this process runs as “ahp-prod”. Where it is the database of “ahp-prod”, as after restoring a backup: “installation mark ahp-prod --replace” on the application's command line.",
        ]);
    });

    test('three reasons at once are three sentences, in the order the run asks them', () => {
        const wording = tenantDeletionWording(
            deletionOf({
                kind: 'halted',
                deletesOn: DAY,
                heldBy: [UNMARKED, NO_SUBSCRIBER, CONTRACT],
            }),
            EN,
            WRITE,
        );

        assert.deepEqual(wording.reasons, [UNMARKED_EN, NO_SUBSCRIBER_EN, CONTRACT_EN]);
    });

    test('before its day, what would hold it is the forecast, said as one', () => {
        const wording = tenantDeletionWording(
            deletionOf({ kind: 'scheduled', deletesOn: DAY, wouldBeHeldBy: [UNMARKED, CONTRACT] }),
            EN,
            WRITE,
        );

        assert.deepEqual(wording, {
            label: 'Scheduled',
            lines: [
                "The tenant's data is deleted on [2026-12-01].",
                'Were the deletion day today, the deletion would be halted:',
            ],
            reasons: [UNMARKED_EN, CONTRACT_EN],
        });
    });

    test('a store that took part of the commercial record is named, with each part before and after', () => {
        const status = {
            kind: 'halted',
            deletesOn: DAY,
            heldBy: [
                {
                    reason: 'commercial-record-lost',
                    store: 'notes-data',
                    lost: ['invoices', 'payments'],
                },
            ],
        };
        const record = recordOf({
            commercialBefore: COMMERCIAL,
            commercialAfter: { ...COMMERCIAL, invoices: 2, payments: 1 },
        });

        const wording = tenantDeletionWording(deletionOf(status, record), EN, WRITE);

        assert.deepEqual(wording, {
            label: 'Halted',
            lines: [`Begun on <${STARTED}>, halted:`],
            reasons: [
                'Store “notes-data” took parts of the commercial record with it (Invoices 3 → 2, Payments 3 → 1). No further store erases until a person decides.',
            ],
        });
    });

    test('a commercial record found short with no store to lay it at says so without one', () => {
        const status = {
            kind: 'halted',
            deletesOn: DAY,
            heldBy: [{ reason: 'commercial-record-lost', store: null, lost: ['invoices'] }],
        };
        const record = recordOf({
            commercialBefore: COMMERCIAL,
            commercialAfter: { ...COMMERCIAL, invoices: 2 },
        });

        const wording = tenantDeletionWording(deletionOf(status, record), EN, WRITE);

        assert.deepEqual(wording.reasons, [
            'Parts of the commercial record are missing (Invoices 3 → 2). No further store erases until a person decides.',
        ]);
    });

    test('in German, the same reason in German, with the same identifier', () => {
        const wording = tenantDeletionWording(
            deletionOf({ kind: 'halted', deletesOn: DAY, heldBy: [UNMARKED] }),
            DE,
            WRITE,
        );

        assert.deepEqual(wording, {
            label: 'Angehalten',
            lines: ['Fällig seit [2026-12-01], angehalten:'],
            reasons: [
                'Die Datenbank ist nicht als Installation „ahp-prod“ markiert. Soll in ihr gelöscht werden: „installation mark ahp-prod“ in der Kommandozeile der Anwendung.',
            ],
        });
    });
});

// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
describe('a failure the platform found itself', () => {
    for (const code of TENANT_DELETION_PLATFORM_FAILURE_CODES) {
        test(`${code} is explained in both languages, after the code`, () => {
            const lastFailure = { step: 'count', store: 'files', code, at: FAILED };
            const status = {
                kind: 'retrying',
                deletesOn: DAY,
                startedAt: STARTED,
                attempts: 1,
                lastFailure,
            };

            for (const messages of [EN, DE]) {
                const { lines } = tenantDeletionWording(
                    deletionOf(status, recordOf({ lastFailure })),
                    messages,
                    WRITE,
                );
                assert.equal(lines.length, 3);
                assert.ok(lines[1].includes(`${code}`));
                assert.equal(lines[2], messages.failures[code]);
            }
        });
    }
});

// @requirement SC-PRIV-024 — A tenant is deleted only after its full export was offered in the read-only period
describe("what the subscriber's record keeps of a deletion", () => {
    test('the export: offered since when, whether a suspension kept it, and whether the day was told', () => {
        const told = tenantDeletionRecordWording(
            recordOf({ exportBlockedBySuspension: true, announcedOn: '2026-10-31' }),
            RECORD_EN,
            WRITE,
        );
        const untold = tenantDeletionRecordWording(recordOf(), RECORD_EN, WRITE);

        assert.deepEqual(told.export, [
            'Export offered since <2026-10-31T09:00:00.000Z>.',
            'A suspension kept the export from being taken for a while.',
            'Deletion day announced on [2026-10-31].',
        ]);
        assert.deepEqual(untold.export, [
            'Export offered since <2026-10-31T09:00:00.000Z>.',
            'No suspension kept the export from being taken.',
            'The deletion day was not announced.',
        ]);
    });

    test('each store in the order it erases in, with its counts as kept and what it has done', () => {
        const stores = [
            {
                store: 'files',
                position: 0,
                countedAt: '2026-11-30T23:15:00.000Z',
                counts: [{ category: 'files', count: 1204 }],
                erasedAt: '2026-11-30T23:38:00.000Z',
            },
            {
                store: 'notes-data',
                position: 1,
                countedAt: '2026-11-30T23:16:00.000Z',
                counts: [
                    { category: 'notes', count: 3812 },
                    { category: 'audit', count: 210 },
                    { category: 'users', count: 7 },
                ],
                erasedAt: null,
            },
            { store: 'search', position: 2, countedAt: null, counts: [], erasedAt: null },
        ];

        const { stores: rows } = tenantDeletionRecordWording(
            recordOf({ stores }),
            RECORD_EN,
            WRITE,
        );

        assert.deepEqual(rows, [
            {
                store: 'files',
                counted: 'Counted on <2026-11-30T23:15:00.000Z>',
                erased: 'Confirmed on <2026-11-30T23:38:00.000Z>',
                counts: [{ category: 'files', count: 1204 }],
            },
            {
                store: 'notes-data',
                counted: 'Counted on <2026-11-30T23:16:00.000Z>',
                erased: 'Not confirmed yet',
                counts: [
                    { category: 'notes', count: 3812 },
                    { category: 'audit', count: 210 },
                    { category: 'users', count: 7 },
                ],
            },
            {
                store: 'search',
                counted: 'Not counted yet',
                erased: 'Not confirmed yet',
                counts: [],
            },
        ]);
    });

    test('the commercial record, every part before and after, the ones that fell marked', () => {
        const { commercial } = tenantDeletionRecordWording(
            recordOf({
                commercialBefore: COMMERCIAL,
                commercialAfter: { ...COMMERCIAL, invoices: 2, charges: 10 },
            }),
            RECORD_EN,
            WRITE,
        );

        assert.deepEqual(
            commercial.map(({ part }) => part),
            ['Subscriber', 'Contracts', 'Charges', 'Invoices', 'Payments', 'Credits'],
        );
        assert.equal(commercial.length, COMMERCIAL_RECORD_FIELDS.length);
        assert.deepEqual(commercial[2], { part: 'Charges', before: 9, after: 10, lost: false });
        assert.deepEqual(commercial[3], { part: 'Invoices', before: 3, after: 2, lost: true });
    });

    test('a commercial record not counted yet has every part, and no number', () => {
        const { commercial } = tenantDeletionRecordWording(recordOf(), RECORD_EN, WRITE);

        assert.deepEqual(commercial[0], {
            part: 'Subscriber',
            before: null,
            after: null,
            lost: false,
        });
    });

    test('each reminder with its lead time, how many it reached, or that it reached nobody or was not delivered', () => {
        const reminders = [
            {
                daysBefore: 30,
                createdAt: '2026-11-01T06:00:00.000Z',
                deliveredAt: '2026-11-01T06:01:00.000Z',
                recipientCount: 2,
                channel: 'email',
            },
            {
                daysBefore: 7,
                createdAt: '2026-11-24T06:00:00.000Z',
                deliveredAt: '2026-11-24T06:01:00.000Z',
                recipientCount: 0,
                channel: 'email',
            },
            {
                daysBefore: 1,
                createdAt: '2026-11-30T06:00:00.000Z',
                deliveredAt: null,
                recipientCount: null,
                channel: null,
            },
        ];

        const { reminders: rows } = tenantDeletionRecordWording(
            recordOf({ reminders }),
            RECORD_EN,
            WRITE,
        );

        assert.deepEqual(rows, [
            {
                daysBefore: 30,
                recorded: '<2026-11-01T06:00:00.000Z>',
                delivered: '<2026-11-01T06:01:00.000Z>',
                channel: 'email',
                recipients: '2',
            },
            {
                daysBefore: 7,
                recorded: '<2026-11-24T06:00:00.000Z>',
                delivered: '<2026-11-24T06:01:00.000Z>',
                channel: 'email',
                recipients: 'Nobody',
            },
            {
                daysBefore: 1,
                recorded: '<2026-11-30T06:00:00.000Z>',
                delivered: 'Not delivered',
                channel: null,
                recipients: null,
            },
        ]);
    });

    test('each download with its moment, its size and the role that took it, in words', () => {
        const downloads = [
            { at: '2026-11-03T10:00:00.000Z', size: 48_000_000, by: 'tenant-admin' },
            { at: '2026-11-04T10:00:00.000Z', size: 1_000, by: 'operator' },
        ];

        const english = tenantDeletionRecordWording(recordOf({ downloads }), RECORD_EN, WRITE);
        const german = tenantDeletionRecordWording(
            recordOf({ downloads }),
            { deletion: DE, record: SA_MESSAGES.de.subscribers.record.deletions },
            WRITE,
        );

        assert.deepEqual(english.downloads, [
            { at: '<2026-11-03T10:00:00.000Z>', size: '48000000 B', by: 'Tenant administrator' },
            { at: '<2026-11-04T10:00:00.000Z>', size: '1000 B', by: 'Operator' },
        ]);
        assert.deepEqual(
            german.downloads.map(({ by }) => by),
            ['Mandanten-Administrator', 'Betreiber'],
        );
    });
});

describe('the size of a file, as the reader writes it', () => {
    for (const [bytes, locale, written] of [
        [0, 'en', '0 byte'],
        [999, 'en', '999 byte'],
        [1_000, 'en', '1 kB'],
        [1_234, 'en', '1.2 kB'],
        [1_234, 'de', '1,2 kB'],
        [48_000_000, 'en', '48 MB'],
        [999_999_999, 'en', '1 GB'],
        [2_500_000_000, 'de', '2,5 GB'],
    ]) {
        test(`${bytes} bytes in ${locale} is ${written}`, () => {
            // The locale data puts a no-break space before some units and not
            // others; which one is not what is measured here.
            assert.equal(formatFileSize(bytes, locale).replaceAll('\u00a0', ' '), written);
        });
    }
});
