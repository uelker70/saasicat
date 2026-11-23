// An installation's operation is fixed with its first document: once an
// invoice has been issued or a contract confirmation rendered, the mark says
// the operation those documents recorded and no other. `installation mark`
// refuses to move it elsewhere — and, where the documents cannot be read,
// refuses to move it at all, since then nothing shows that none exists — and a
// start that issues invoices refuses where the documents recorded another
// operation than the mark says, or both.
//
// The command through `InstallationMarkService` over the in-memory store of
// the mark the platform ships for tests; the start through the whole platform
// as `SaaSiCatModule.forRoot` starts it with invoices on.

import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import { AdminAuditService, InstallationMarkService, TenantBillingModule } from '../dist/index.js';
import { SaaSiCatModule } from '../dist/platform/index.js';
import {
    FakeInstallationMarkRepository,
    FakeSubscriptionEndRepository,
} from '../dist/testing/index.js';
import { THIS_INSTALLATION, aHandWiredDeletion } from './helpers/installation-mark.js';
import { documentsIssued, marked } from './helpers/installation-marks.js';
import {
    confirmationsMadeIn,
    invoicesIssuedIn,
    invoicingPlatform as installation,
    refusal,
    started,
    wiredInvoices,
} from './helpers/invoicing-platform.js';
import { bootable, everythingOnOptions, withoutInvoicing } from './helpers/operator-routes.js';
import { anExport } from './helpers/tenant-data-export.js';
import { noticeRecord, sendingPort } from './helpers/version-notices.js';

const NOW = new Date('2026-11-23T10:00:00.000Z');
const OPERATOR = { userId: 'u-1', email: 'ops@example.com', source: 'cli', context: 'host-1' };

/** The ports `InstallationMarkService` is built from, by their keys in the global registry. */
const SERVICE_READS = [
    Symbol.for('saasicat/nest/InstallationMarkPort'),
    Symbol.for('saasicat/nest/InstallationIdentifier'),
    Symbol.for('saasicat/nest/SubscriptionInvoiceRepository'),
    Symbol.for('saasicat/nest/ContractConfirmationRepository'),
];

/** A mark as the operator left it earlier. */
const standing = (identifier, testOperation) => ({
    identifier,
    testOperation,
    markedAt: new Date('2026-01-01T00:00:00.000Z'),
    markedBy: 'cli:other@example.com:host-0',
});

/**
 * The service in the environment `INT`, on a database marked as `mark` where
 * one is given, over the stores of `documents` as `documentsIssued` builds
 * them — or none at all where `documents` is `null` — and the bypass frame
 * `bypass` where one is given.
 */
async function setUp({ mark = null, documents = documentsIssued(), bypass = null } = {}) {
    const marks = new FakeInstallationMarkRepository();
    if (mark) await marks.markIfUnmarked(mark);
    const audited = [];
    const audit = new AdminAuditService({ write: async (entry) => void audited.push(entry) });
    const service = new InstallationMarkService(
        marks,
        'INT',
        audit,
        documents?.invoices ?? null,
        documents?.confirmations ?? null,
        bypass,
    );
    return { marks, audited, service };
}

/** The status and coded body of what `fn` threw. */
async function refusalOf(fn) {
    try {
        await fn();
    } catch (error) {
        const body = error.getResponse?.();
        return { status: error.getStatus?.(), code: body?.code, params: body?.params };
    }
    assert.fail('expected a refusal');
}

beforeEach(() => {
    mock.timers.enable({ apis: ['Date'], now: NOW });
});

afterEach(() => {
    mock.restoreAll();
    mock.timers.reset();
});

// @requirement SC-AUD-023 — An installation's operation is fixed with its first document
describe('installation mark, once the installation has issued a document', () => {
    test('changes the operation while no document exists', async () => {
        const { marks, service } = await setUp({ mark: standing('INT', false) });

        const outcome = await service.mark('INT', OPERATOR, { operation: 'test' });

        assert.equal(outcome.kind, 'operation-changed');
        assert.equal((await marks.find()).testOperation, true);
    });

    test('refuses another operation once an invoice exists, naming both, and writes nothing', async () => {
        const { marks, audited, service } = await setUp({
            mark: standing('INT', false),
            documents: documentsIssued({ invoices: [false] }),
        });

        const refused = await refusalOf(() => service.mark('INT', OPERATOR, { operation: 'test' }));

        assert.deepEqual(refused, {
            status: 409,
            code: 'INSTALLATION_OPERATION_FIXED',
            params: { issued: 'live', requested: 'test' },
        });
        assert.deepEqual(await marks.find(), standing('INT', false));
        assert.deepEqual(audited, []);
    });

    test('refuses it where only a confirmation was rendered', async () => {
        const { marks, service } = await setUp({
            mark: standing('INT', true),
            documents: documentsIssued({ confirmations: [true] }),
        });

        const refused = await refusalOf(() => service.mark('INT', OPERATOR, { operation: 'live' }));

        assert.equal(refused.code, 'INSTALLATION_OPERATION_FIXED');
        assert.deepEqual(refused.params, { issued: 'test', requested: 'live' });
        assert.equal((await marks.find()).testOperation, true);
    });

    test('marks with the operation the documents recorded, and with it alone', async () => {
        const kept = await setUp({
            mark: standing('INT', true),
            documents: documentsIssued({ invoices: [true], confirmations: [true] }),
        });
        for (const options of [{ operation: 'test' }, {}]) {
            const outcome = await kept.service.mark('INT', OPERATOR, options);
            assert.equal(outcome.kind, 'already-marked');
        }

        // Unmarked is live, and the documents were issued live.
        const unmarked = await setUp({ documents: documentsIssued({ invoices: [false] }) });
        const refused = await refusalOf(() =>
            unmarked.service.mark('INT', OPERATOR, { operation: 'test' }),
        );
        assert.deepEqual(refused.params, { issued: 'live', requested: 'test' });
        assert.equal(await unmarked.marks.find(), null);
        const outcome = await unmarked.service.mark('INT', OPERATOR);
        assert.equal(outcome.kind, 'marked');
        assert.equal(outcome.mark.testOperation, false);
    });

    test('--replace with the operation that stands goes ahead, with another it is refused', async () => {
        const restored = await setUp({
            mark: standing('PROD', true),
            documents: documentsIssued({ invoices: [true] }),
        });

        const replaced = await restored.service.replace('INT', OPERATOR);
        assert.equal(replaced.kind, 'replaced');
        assert.equal(replaced.mark.testOperation, true);
        const same = await restored.service.replace('INT', OPERATOR, { operation: 'test' });
        assert.equal(same.kind, 'already-marked');
        const refused = await refusalOf(() =>
            restored.service.replace('INT', OPERATOR, { operation: 'live' }),
        );
        assert.deepEqual(refused.params, { issued: 'test', requested: 'live' });

        const copied = await setUp({
            mark: standing('PROD', false),
            documents: documentsIssued({ invoices: [false] }),
        });
        const turned = await refusalOf(() =>
            copied.service.replace('INT', OPERATOR, { operation: 'test' }),
        );
        assert.equal(turned.code, 'INSTALLATION_OPERATION_FIXED');
        assert.deepEqual(await copied.marks.find(), standing('PROD', false));
        assert.deepEqual(copied.audited, []);
    });

    test('moves a mark that says another operation to the one its documents recorded', async () => {
        const { marks, service } = await setUp({
            mark: standing('INT', false),
            documents: documentsIssued({ invoices: [true], confirmations: [true] }),
        });

        const outcome = await service.mark('INT', OPERATOR, { operation: 'test' });

        assert.equal(outcome.kind, 'operation-changed');
        assert.equal((await marks.find()).testOperation, true);
    });

    test('refuses either operation where the documents recorded both', async () => {
        const { marks, service } = await setUp({
            mark: standing('INT', false),
            documents: documentsIssued({ invoices: [false], confirmations: [true] }),
        });

        const refused = await refusalOf(() => service.mark('INT', OPERATOR, { operation: 'test' }));

        assert.deepEqual(refused.params, { issued: 'live', requested: 'test' });
        assert.deepEqual(await marks.find(), standing('INT', false));
    });

    test('refuses any change where a store of the documents cannot be read, and marks as it stands', async () => {
        const { invoices, confirmations } = documentsIssued();
        for (const [what, documents] of [
            ['neither', null],
            ['the confirmations alone', { confirmations }],
            ['the invoices alone', { invoices }],
        ]) {
            const { marks, audited, service } = await setUp({
                mark: standing('INT', false),
                documents,
            });

            const refused = await refusalOf(() =>
                service.mark('INT', OPERATOR, { operation: 'test' }),
            );

            assert.deepEqual(
                refused,
                {
                    status: 409,
                    code: 'INSTALLATION_DOCUMENTS_NOT_READABLE',
                    params: { standing: 'live', requested: 'test' },
                },
                what,
            );
            assert.deepEqual(await marks.find(), standing('INT', false), what);
            assert.deepEqual(audited, [], what);
            assert.equal((await service.mark('INT', OPERATOR)).kind, 'already-marked', what);
        }
        const fresh = await setUp({ documents: null });
        assert.equal((await fresh.service.mark('INT', OPERATOR)).kind, 'marked');
    });

    test("reads every tenant's documents, inside the bypass frame", async () => {
        let lifted = false;
        const bypass = {
            async runWithBypass(read) {
                lifted = true;
                try {
                    return await read();
                } finally {
                    lifted = false;
                }
            },
        };
        // Row-level security hides every tenant's documents outside the frame.
        const hidden = documentsIssued();
        const seen = documentsIssued({ invoices: [false] });
        const documents = {
            invoices: {
                issuedOperations: () => (lifted ? seen : hidden).invoices.issuedOperations(),
            },
            confirmations: hidden.confirmations,
        };
        const { service } = await setUp({ mark: standing('INT', false), documents, bypass });

        const refused = await refusalOf(() => service.mark('INT', OPERATOR, { operation: 'test' }));

        assert.equal(refused.code, 'INSTALLATION_OPERATION_FIXED');
    });
});

// @requirement SC-AUD-023 — An installation's operation is fixed with its first document
describe('where the command reads the documents from', () => {
    test("an installation without invoices reads them from the persistence bundle's stores", async () => {
        const options = bootable(withoutInvoicing(everythingOnOptions()));
        const { invoices, confirmations } = documentsIssued({ confirmations: [false] });
        options.persistence.core.installationMark = new FakeInstallationMarkRepository();
        options.persistence.core.rlsBypass = { runWithBypass: (read) => read() };
        options.persistence.entitlement.subscriptionInvoiceRepository = invoices;
        options.persistence.entitlement.contractConfirmationRepository = confirmations;
        const moduleRef = await Test.createTestingModule({
            imports: [SaaSiCatModule.forRoot(options)],
        }).compile();
        const service = moduleRef.get(InstallationMarkService, { strict: false });

        const refused = await refusalOf(() =>
            service.mark(THIS_INSTALLATION, OPERATOR, { operation: 'test' }),
        );

        assert.deepEqual(refused.params, { issued: 'live', requested: 'test' });
        await moduleRef.close();
    });

    test('tenant billing wired by hand reads the stores its deletion names, and refuses without them', async () => {
        // The providers the module binds for the service, compiled alone: the
        // rest of tenant billing needs the catalogue, which is not the subject.
        const serviceOf = async (deletion) => {
            const { providers } = TenantBillingModule.forRoot({
                authGuards: [class Guard {}],
                subscriptionUsagePort: {},
                usageSnapshotPort: {},
                subscriptionWritePort: {},
                notices: { port: sendingPort(), record: noticeRecord() },
                subscriptionEnds: {
                    store: new FakeSubscriptionEndRepository(),
                    export: anExport(),
                    deletion,
                },
            });
            const moduleRef = await Test.createTestingModule({
                providers: providers.filter(
                    (provider) =>
                        provider === InstallationMarkService ||
                        SERVICE_READS.includes(provider.provide),
                ),
            }).compile();
            return moduleRef.get(InstallationMarkService);
        };

        const named = await serviceOf({
            ...aHandWiredDeletion(),
            documents: documentsIssued({ invoices: [true] }),
        });
        const fixed = await refusalOf(() => named.mark(THIS_INSTALLATION, OPERATOR));
        assert.equal(fixed.code, 'INSTALLATION_OPERATION_FIXED');
        assert.deepEqual(fixed.params, { issued: 'test', requested: 'live' });

        const unnamed = await serviceOf(aHandWiredDeletion());
        const unread = await refusalOf(() =>
            unnamed.mark(THIS_INSTALLATION, OPERATOR, { operation: 'test' }),
        );
        assert.equal(unread.code, 'INSTALLATION_DOCUMENTS_NOT_READABLE');
    });
});

/** The platform with invoices on, its mark saying `testOperation` (`null`: unmarked), and documents as given. */
async function issuing(testOperation, { invoices = [], confirmations = [] } = {}) {
    const options = installation({
        invoices: wiredInvoices({ invoiceRepository: invoicesIssuedIn(...invoices) }),
    });
    options.persistence.core.installationMark = await marked(testOperation);
    options.persistence.entitlement.contractConfirmationRepository = confirmationsMadeIn(
        ...confirmations,
    );
    return options;
}

// @requirement SC-AUD-023 — An installation's operation is fixed with its first document
describe('a start that issues invoices', () => {
    test('goes on where the documents recorded the operation the mark says', async () => {
        for (const options of [
            await issuing(true, { invoices: [true, true], confirmations: [true] }),
            await issuing(false, { invoices: [false], confirmations: [false] }),
            await issuing(null, { invoices: [false] }),
        ]) {
            const moduleRef = await started(options);
            await moduleRef.close();
        }
    });

    test('goes on while no document exists, whatever the mark says', async () => {
        for (const testOperation of [true, false, null]) {
            const moduleRef = await started(await issuing(testOperation));
            await moduleRef.close();
        }
    });

    test('is refused where the invoices recorded another operation than the mark, naming both', async () => {
        const message = await refusal(await issuing(null, { invoices: [true] }));

        assert.match(message, /^Invoices cannot start:\n- /);
        assert.match(message, /mark says a live operation/);
        assert.match(message, /issued in a test operation/);
        assert.match(message, /installation mark <identifier> --operation test/);
    });

    test('is refused where only the confirmations recorded another', async () => {
        const message = await refusal(await issuing(true, { confirmations: [false] }));

        assert.match(message, /mark says a test operation/);
        assert.match(message, /issued in a live operation/);
    });

    test('is refused where the documents recorded both, naming both', async () => {
        const message = await refusal(
            await issuing(true, { invoices: [true], confirmations: [false] }),
        );

        assert.match(message, /both in a test operation and in a live one/);
        assert.match(message, /mark says a test operation/);
    });
});
