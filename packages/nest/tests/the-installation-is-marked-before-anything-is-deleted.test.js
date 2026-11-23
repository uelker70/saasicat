// The brake in front of a tenant's deletion (`SC-PRIV-021`): the database
// carries the identifier of its installation, which only the operator writes,
// and every process names the identifier of its own environment. A start that
// serves tenants and names none, or has nowhere to read the mark from, is
// refused; the service compares the two and writes the mark only as the
// identifier of the environment it runs in.
//
// The service is run over the in-memory port the platform ships for tests,
// which keeps the port's promise the way the database does: a mark lands where
// none stands, and a replacement only while the mark it read still stands.

import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AdminAuditService, InstallationMarkService, TenantBillingModule } from '../dist/index.js';
import {
    SaaSiCatConfigurationError,
    SaaSiCatModule,
    findViolations,
    storeSecretsInPlainText,
} from '../dist/platform/index.js';
import {
    FakeInstallationMarkRepository,
    FakeSubscriptionEndRepository,
} from '../dist/testing/index.js';
import { bootable, everythingOnOptions } from './helpers/operator-routes.js';
import { THIS_INSTALLATION, aHandWiredDeletion } from './helpers/installation-mark.js';
import { documentsIssued } from './helpers/installation-marks.js';
import { anExport } from './helpers/tenant-data-export.js';
import { noticeRecord, sendingPort } from './helpers/version-notices.js';

const INSTALLATION_RULES = new Set([
    'subscription-ends.requires-installation',
    'subscription-ends.requires-installation-marks',
]);

/**
 * The platform's options with `subscriptionEnds.deletion` as given — left out
 * where `deletion` is `undefined` — and the bundle's store of the mark kept or
 * not.
 */
function withDeletion(deletion, { bundleKeepsMarks = true } = {}) {
    const options = everythingOnOptions();
    const { installationMark, ...core } = options.persistence.core;
    const { deletion: _given, ...ends } = options.tenantBilling.subscriptionEnds;
    return {
        ...options,
        persistence: {
            ...options.persistence,
            core: bundleKeepsMarks ? { ...core, installationMark } : core,
        },
        tenantBilling: {
            ...options.tenantBilling,
            subscriptionEnds: deletion === undefined ? ends : { ...ends, deletion },
        },
    };
}

const violationsOf = (options) =>
    findViolations({ options, adapters: { secretSealer: storeSecretsInPlainText() } }).filter(
        (violation) => INSTALLATION_RULES.has(violation.id),
    );

/** Tenant billing wired by hand, with the ends of subscriptions kept and `deletion` as given. */
const wiredByHand = (deletion) =>
    TenantBillingModule.forRoot({
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

// @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
describe("the identifier of this process's environment, which a start serving tenants names", () => {
    test('left out, not given or not an identifier, the start is refused, naming the option, its source and the command', () => {
        const refused = [
            ['no deletion', undefined],
            ['no installation', {}],
            ['undefined, as an unset variable reads', { installation: undefined }],
            ['empty', { installation: '' }],
            ['a space in front', { installation: ' prod' }],
            ['a space behind', { installation: 'prod ' }],
            ['a slash', { installation: 'prod/eu' }],
            ['not a string', { installation: 42 }],
            ['too long', { installation: 'a'.repeat(65) }],
        ];
        for (const [what, deletion] of refused) {
            const [violation, ...more] = violationsOf(withDeletion(deletion));
            assert.deepEqual(more, [], what);
            assert.equal(violation?.id, 'subscription-ends.requires-installation', what);
            const message = String(violation.message);
            assert.ok(
                message.includes('`tenantBilling.subscriptionEnds.deletion.installation`'),
                `${what}: ${message}`,
            );
            assert.ok(message.includes('process.env'), `${what}: ${message}`);
            assert.ok(message.includes('installation mark'), `${what}: ${message}`);
        }
    });

    test('says what is wrong with the value, without repeating it', () => {
        const messageOf = (deletion) => String(violationsOf(withDeletion(deletion))[0]?.message);
        assert.match(messageOf({ installation: undefined }), /is missing/);
        assert.match(messageOf({ installation: '   ' }), /is blank/);
        assert.match(messageOf({ installation: 'a'.repeat(65) }), /longer than 64 characters/);
        const spaced = messageOf({ installation: ' secret-looking' });
        assert.match(spaced, /letters, digits/);
        assert.ok(!spaced.includes('secret-looking'), spaced);
    });

    test('an identifier is enough, as long as the rules allow', () => {
        for (const installation of ['prod', 'prod-eu.1_a', 'a'.repeat(64)]) {
            assert.deepEqual(violationsOf(withDeletion({ installation })), [], installation);
        }
    });

    test('with nowhere to read the mark from, the start is refused, naming both places', () => {
        const [violation, ...more] = violationsOf(
            withDeletion({ installation: 'prod' }, { bundleKeepsMarks: false }),
        );
        assert.deepEqual(more, []);
        assert.equal(violation?.id, 'subscription-ends.requires-installation-marks');
        const message = String(violation.message);
        assert.ok(message.includes('`tenantBilling.subscriptionEnds.deletion.marks`'), message);
        assert.ok(message.includes('`persistence.core.installationMark`'), message);
    });

    test("the bundle's store of the mark, or one named, is enough", () => {
        assert.deepEqual(
            violationsOf(
                withDeletion(
                    { installation: 'prod', marks: new FakeInstallationMarkRepository() },
                    { bundleKeepsMarks: false },
                ),
            ),
            [],
        );
    });

    test('without tenant billing, nothing is asked for', () => {
        const { tenantBilling: _off, ...options } = withDeletion(undefined, {
            bundleKeepsMarks: false,
        });
        assert.deepEqual(violationsOf(options), []);
    });

    test('the start itself is refused, not a later run', () => {
        assert.throws(
            () => SaaSiCatModule.forRoot(withDeletion({ installation: undefined })),
            (error) =>
                error instanceof SaaSiCatConfigurationError &&
                error.violations.some(
                    (violation) => violation.id === 'subscription-ends.requires-installation',
                ),
        );
    });

    test('tenant billing wired by hand is refused the same way', () => {
        assert.throws(
            () => wiredByHand(undefined),
            /TenantBillingModule: `subscriptionEnds\.deletion\.installation` is missing.*installation mark/,
        );
        assert.throws(
            () =>
                wiredByHand({ installation: ' prod', marks: new FakeInstallationMarkRepository() }),
            /TenantBillingModule: `subscriptionEnds\.deletion\.installation` is not an installation identifier/,
        );
        assert.throws(
            () => wiredByHand({ installation: 'prod' }),
            /TenantBillingModule: `subscriptionEnds\.deletion\.marks` is missing/,
        );
        assert.doesNotThrow(() => wiredByHand({ ...aHandWiredDeletion(), installation: 'prod' }));
    });

    test('a start that serves tenants compares with the identifier its environment names', async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [SaaSiCatModule.forRoot(bootable(everythingOnOptions()))],
        }).compile();
        const service = moduleRef.get(InstallationMarkService, { strict: false });
        // Every port of the bootable fixture answers `null`: nobody marked it.
        assert.deepEqual(await service.verdict(), {
            kind: 'unmarked',
            expected: THIS_INSTALLATION,
        });
        await moduleRef.close();
    });
});

const NOW = new Date('2026-11-15T10:00:00.000Z');
const OPERATOR = { userId: 'u-1', email: 'ops@example.com', source: 'cli', context: 'host-1' };
const OPERATOR_TAG = 'cli:ops@example.com:host-1';

/** A mark as somebody else left it. */
const standing = (identifier, testOperation = false) => ({
    identifier,
    testOperation,
    markedAt: new Date('2026-01-01T00:00:00.000Z'),
    markedBy: 'cli:other@example.com:host-0',
});

function setUp(environment, marks = new FakeInstallationMarkRepository()) {
    const audited = [];
    const audit = new AdminAuditService({ write: async (entry) => void audited.push(entry) });
    // No document was issued, so the operation may change.
    const { invoices, confirmations } = documentsIssued();
    return {
        marks,
        audited,
        service: new InstallationMarkService(marks, environment, audit, invoices, confirmations),
    };
}

/** The status and coded body of what `fn` threw. */
async function refusalOf(fn) {
    try {
        await fn();
    } catch (error) {
        const body = error.getResponse?.();
        return { status: error.getStatus?.(), code: body?.code, params: body?.params, error };
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

// @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
describe('whether the database belongs to this environment', () => {
    test('unmarked until the operator marks it', async () => {
        const { service } = setUp('prod');
        assert.deepEqual(await service.verdict(), { kind: 'unmarked', expected: 'prod' });
    });

    test('matches once it is marked as this environment', async () => {
        const { service } = setUp('prod');
        await service.mark('prod', OPERATOR);
        assert.deepEqual(await service.verdict(), { kind: 'matches', identifier: 'prod' });
    });

    test("differs where production's backup was restored into staging", async () => {
        const marks = new FakeInstallationMarkRepository();
        await marks.markIfUnmarked(standing('prod'));
        const { service } = setUp('staging', marks);
        assert.deepEqual(await service.verdict(), {
            kind: 'differs',
            expected: 'staging',
            marked: 'prod',
        });
    });
});

// @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
describe('marking the database', () => {
    test("is refused with any identifier but this environment's, and writes nothing", async () => {
        const { marks, audited, service } = setUp('prod');
        for (const act of [
            () => service.mark('staging', OPERATOR),
            () => service.replace('staging', OPERATOR),
            () => service.mark('PROD', OPERATOR),
        ]) {
            const refusal = await refusalOf(act);
            assert.equal(refusal.status, 400);
            assert.equal(refusal.code, 'INSTALLATION_IDENTIFIER_NOT_THIS_ENVIRONMENTS');
            assert.equal(refusal.params.environment, 'prod');
        }
        assert.deepEqual((await refusalOf(() => service.mark('staging', OPERATOR))).params, {
            given: 'staging',
            environment: 'prod',
        });
        assert.equal(await marks.find(), null);
        assert.deepEqual(audited, []);
    });

    test('writes the mark once, with when and by whom, and audits it once', async () => {
        const { marks, audited, service } = setUp('prod');

        const first = await service.mark('prod', OPERATOR);
        assert.deepEqual(first, {
            kind: 'marked',
            mark: {
                identifier: 'prod',
                testOperation: false,
                markedAt: NOW,
                markedBy: OPERATOR_TAG,
            },
        });

        mock.timers.tick(60_000);
        const second = await service.mark('prod', OPERATOR);
        assert.equal(second.kind, 'already-marked');
        assert.deepEqual(second.mark, first.mark, 'the first mark stands');

        assert.deepEqual(await marks.find(), first.mark);
        assert.deepEqual(
            audited.map((entry) => [entry.action, entry.entityId, entry.changes]),
            [
                [
                    'INSTALLATION_MARKED',
                    'prod',
                    { identifier: 'prod', operation: 'live', actor: OPERATOR_TAG },
                ],
            ],
        );
    });

    test('marking twice at once in one process lands once and audits once', async () => {
        const { audited, service } = setUp('prod');
        const outcomes = await Promise.all([
            service.mark('prod', OPERATOR),
            service.mark('prod', OPERATOR),
        ]);
        assert.deepEqual(outcomes.map((outcome) => outcome.kind).sort(), [
            'already-marked',
            'marked',
        ]);
        assert.equal(audited.length, 1);
    });

    test('marked as another installation, it is refused and names the mark that stands', async () => {
        const marks = new FakeInstallationMarkRepository();
        await marks.markIfUnmarked(standing('prod'));
        const { audited, service } = setUp('staging', marks);

        const refusal = await refusalOf(() => service.mark('staging', OPERATOR));
        assert.equal(refusal.status, 409);
        assert.equal(refusal.code, 'INSTALLATION_MARKED_OTHERWISE');
        assert.deepEqual(refusal.params, { marked: 'prod' });
        assert.deepEqual(await marks.find(), standing('prod'));
        assert.deepEqual(audited, []);
    });

    test('another installation marking between the read and the write is refused the same way', async () => {
        const marks = new FakeInstallationMarkRepository();
        // Nothing stands when the service reads; another process marks before it writes.
        mock.method(marks, 'find', async () => null);
        mock.method(marks, 'markIfUnmarked', async () => standing('other'));
        const { audited, service } = setUp('prod', marks);

        const refusal = await refusalOf(() => service.mark('prod', OPERATOR));
        assert.equal(refusal.code, 'INSTALLATION_MARKED_OTHERWISE');
        assert.deepEqual(refusal.params, { marked: 'other' });
        assert.deepEqual(audited, []);
    });

    test('the mark stands where the audit log cannot be written, and the failure is logged', async () => {
        const error = mock.method(Logger.prototype, 'error', () => undefined);
        const marks = new FakeInstallationMarkRepository();
        const audit = new AdminAuditService({
            write: async () => {
                throw new Error('the audit log is unreachable');
            },
        });
        const service = new InstallationMarkService(marks, 'prod', audit);

        assert.equal((await service.mark('prod', OPERATOR)).kind, 'marked');
        assert.equal((await marks.find())?.identifier, 'prod');
        assert.equal(error.mock.callCount(), 1);
        assert.match(String(error.mock.calls[0].arguments[0]), /INSTALLATION_MARKED/);
    });
});

// @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
describe("replacing the mark, as after restoring production's backup into staging", () => {
    async function restoredIntoStaging() {
        const marks = new FakeInstallationMarkRepository();
        await marks.markIfUnmarked(standing('prod'));
        return setUp('staging', marks);
    }

    test('replaces it with this environment, and audits the old and the new', async () => {
        const { marks, audited, service } = await restoredIntoStaging();

        const outcome = await service.replace('staging', OPERATOR);
        assert.deepEqual(outcome, {
            kind: 'replaced',
            mark: {
                identifier: 'staging',
                testOperation: false,
                markedAt: NOW,
                markedBy: OPERATOR_TAG,
            },
        });
        assert.deepEqual(await marks.find(), outcome.mark);
        assert.deepEqual(await service.verdict(), { kind: 'matches', identifier: 'staging' });
        assert.deepEqual(
            audited.map((entry) => [entry.action, entry.entityId, entry.changes]),
            [
                [
                    'INSTALLATION_MARK_REPLACED',
                    'staging',
                    { from: 'prod', to: 'staging', actor: OPERATOR_TAG },
                ],
            ],
        );
    });

    test('with nothing to replace, it marks', async () => {
        const { audited, service } = setUp('prod');
        const outcome = await service.replace('prod', OPERATOR);
        assert.equal(outcome.kind, 'marked');
        assert.deepEqual(
            audited.map((entry) => entry.action),
            ['INSTALLATION_MARKED'],
        );
    });

    test('where this environment stands already, it changes nothing', async () => {
        const marks = new FakeInstallationMarkRepository();
        await marks.markIfUnmarked(standing('prod'));
        const { audited, service } = setUp('prod', marks);

        const outcome = await service.replace('prod', OPERATOR);
        assert.deepEqual(outcome, { kind: 'already-marked', mark: standing('prod') });
        assert.deepEqual(audited, []);
    });

    test('a mark changed between the read and the write is refused, and nothing is written', async () => {
        const { marks, audited, service } = await restoredIntoStaging();
        mock.method(marks, 'replace', async () => null);

        const refusal = await refusalOf(() => service.replace('staging', OPERATOR));
        assert.equal(refusal.status, 409);
        assert.equal(refusal.code, 'INSTALLATION_MARK_MOVED');
        assert.deepEqual(await marks.find(), standing('prod'));
        assert.deepEqual(audited, []);
    });

    test('a mark set by another installation between the read and the write is refused as moved', async () => {
        const marks = new FakeInstallationMarkRepository();
        mock.method(marks, 'find', async () => null);
        mock.method(marks, 'markIfUnmarked', async () => standing('other'));
        const { audited, service } = setUp('prod', marks);

        const refusal = await refusalOf(() => service.replace('prod', OPERATOR));
        assert.equal(refusal.code, 'INSTALLATION_MARK_MOVED');
        assert.deepEqual(audited, []);
    });
});

describe('how the installation operates, said on its mark', () => {
    /** The actions audited, each with what it records. */
    const actions = (audited) => audited.map((entry) => [entry.action, entry.changes]);

    test('a new mark is live unless the operator says test', async () => {
        const live = setUp('PROD');
        const test = setUp('INT');

        const plain = await live.service.mark('PROD', OPERATOR);
        const marked = await test.service.mark('INT', OPERATOR, { operation: 'test' });

        assert.equal(plain.mark.testOperation, false);
        assert.equal(marked.kind, 'marked');
        assert.equal(marked.mark.testOperation, true);
        assert.equal((await test.marks.find()).testOperation, true);
        assert.deepEqual(actions(test.audited), [
            ['INSTALLATION_MARKED', { identifier: 'INT', operation: 'test', actor: OPERATOR_TAG }],
        ]);
    });

    test('the status names whose database it is and how it operates', async () => {
        const { service } = setUp('INT');
        assert.deepEqual(await service.status(), {
            kind: 'unmarked',
            expected: 'INT',
            operation: 'live',
        });

        await service.mark('INT', OPERATOR, { operation: 'test' });

        assert.deepEqual(await service.status(), {
            kind: 'matches',
            identifier: 'INT',
            operation: 'test',
        });
    });

    test('marking the same identifier with another operation changes it, and audits from and to', async () => {
        const marks = new FakeInstallationMarkRepository();
        await marks.markIfUnmarked(standing('INT'));
        const { audited, service } = setUp('INT', marks);

        const outcome = await service.mark('INT', OPERATOR, { operation: 'test' });

        assert.deepEqual(outcome, {
            kind: 'operation-changed',
            from: 'live',
            mark: { identifier: 'INT', testOperation: true, markedAt: NOW, markedBy: OPERATOR_TAG },
        });
        assert.deepEqual(await marks.find(), outcome.mark);
        assert.deepEqual(actions(audited), [
            ['INSTALLATION_OPERATION_CHANGED', { from: 'live', to: 'test', actor: OPERATOR_TAG }],
        ]);
    });

    test('marking with the operation that stands, or with none, writes nothing', async () => {
        const marks = new FakeInstallationMarkRepository();
        await marks.markIfUnmarked(standing('INT', true));
        const { audited, service } = setUp('INT', marks);

        for (const options of [{ operation: 'test' }, {}, undefined]) {
            const outcome = await service.mark('INT', OPERATOR, options);
            assert.deepEqual(outcome, { kind: 'already-marked', mark: standing('INT', true) });
        }
        assert.deepEqual(audited, []);
    });

    test('--replace without an operation keeps the one that stands, with it changes it', async () => {
        const kept = new FakeInstallationMarkRepository();
        await kept.markIfUnmarked(standing('PROD', true));
        const restored = setUp('INT', kept);

        const outcome = await restored.service.replace('INT', OPERATOR);

        assert.equal(outcome.kind, 'replaced');
        assert.equal(outcome.mark.identifier, 'INT');
        assert.equal(outcome.mark.testOperation, true, 'the operation belongs to the data');
        assert.deepEqual(actions(restored.audited), [
            ['INSTALLATION_MARK_REPLACED', { from: 'PROD', to: 'INT', actor: OPERATOR_TAG }],
        ]);

        const changed = new FakeInstallationMarkRepository();
        await changed.markIfUnmarked(standing('PROD'));
        const int = setUp('INT', changed);

        const turned = await int.service.replace('INT', OPERATOR, { operation: 'test' });

        assert.equal(turned.kind, 'replaced');
        assert.equal((await changed.find()).testOperation, true);
        assert.deepEqual(actions(int.audited), [
            ['INSTALLATION_MARK_REPLACED', { from: 'PROD', to: 'INT', actor: OPERATOR_TAG }],
            ['INSTALLATION_OPERATION_CHANGED', { from: 'live', to: 'test', actor: OPERATOR_TAG }],
        ]);
    });

    test('--replace on the same identifier changes the operation as marking does', async () => {
        const marks = new FakeInstallationMarkRepository();
        await marks.markIfUnmarked(standing('INT'));
        const { service } = setUp('INT', marks);

        const outcome = await service.replace('INT', OPERATOR, { operation: 'test' });

        assert.equal(outcome.kind, 'operation-changed');
        assert.equal((await marks.find()).testOperation, true);
    });

    test('an operation changed by somebody else between the read and the write is refused as moved', async () => {
        const marks = new FakeInstallationMarkRepository();
        await marks.markIfUnmarked(standing('INT'));
        const { audited, service } = setUp('INT', marks);
        // The service reads the mark live; another operator turns it to a test
        // operation before this write, which then lands on nothing.
        mock.method(marks, 'find', async () => standing('INT'));
        await marks.replace(standing('INT'), standing('INT', true));

        const refusal = await refusalOf(() => service.mark('INT', OPERATOR, { operation: 'test' }));

        assert.equal(refusal.status, 409);
        assert.equal(refusal.code, 'INSTALLATION_MARK_MOVED');
        assert.deepEqual(audited, []);
    });
});
