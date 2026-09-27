// `<app> contracts refresh`, as an operator runs it: first to see what would
// change, then with `--apply` to write it — and `<app> doctor` telling them
// that there is something to look at.
//
// The refresh itself is `@saasicat/nest`'s and tested there. Here it is stood
// in for, so that a test can tell what the command asked for, which mode it
// passed, what it printed and which exit code a script sees.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    ContractFeaturesDoctorCheck,
    ContractRefreshCliFlow,
    ContractsCommands,
    ContractsRefreshCommand,
} from '../dist/index.js';
import { cliErrorOf, printed, recordingContext } from './helpers/operator-cli.js';

function preview(overrides = {}) {
    return {
        contractId: 'c-1',
        tenantId: 't-1',
        vocabulary: { unknown: ['ATLAS'], missing: ['ATLAS_AES'] },
        features: { added: ['ATLAS_AES'], removed: ['ATLAS'] },
        quotas: [],
        money: [],
        changes: true,
        refusal: null,
        ...overrides,
    };
}

function setUp({ previews = [preview()], outcomes = null, unreadable = [] } = {}) {
    const calls = [];
    const refresh = {
        async preview(selection, mode) {
            calls.push(['preview', selection, mode]);
            return previews;
        },
        async apply(selection, mode, actor) {
            calls.push(['apply', selection, mode, actor.email]);
            return outcomes ?? previews.map((p) => ({ ...p, successorId: 'c-9', moved: false }));
        },
        async inspect() {
            calls.push(['inspect']);
            return { inForce: previews.length + unreadable.length, stale: previews, unreadable };
        },
    };
    const ctx = recordingContext();
    return { ctx, calls, refresh, flow: new ContractRefreshCliFlow(ctx, refresh) };
}

// @requirement SC-ENTL-023 — An operator carries a changed vocabulary into running contracts, seeing it first
describe('the preview is the command, and the write is the second one', () => {
    test('without --apply it previews, asks who is asking, and asks for no confirmation', async () => {
        const { flow, calls, ctx } = setUp();

        await flow.preview({ all: true });

        assert.deepEqual(calls, [['preview', {}, 'features']]);
        assert.deepEqual(ctx.asked, ['identity', 'super-admin']);
    });

    test('--apply writes, after the confirmation production asks for', async () => {
        const { flow, calls, ctx } = setUp();

        await flow.apply({ contract: ['c-1'], yes: true });

        assert.deepEqual(calls, [
            ['apply', { contractIds: ['c-1'] }, 'features', 'ops@example.com'],
        ]);
        assert.deepEqual(ctx.asked, ['identity', 'super-admin', 'confirmed with --yes']);
    });

    test('--full asks for a full re-freeze', async () => {
        const { flow, calls } = setUp();

        await flow.preview({ all: true, full: true });

        assert.equal(calls[0][2], 'full');
    });

    test('a selection is required, and only one kind of it — refused before anything is read', async () => {
        const { flow, calls } = setUp();

        const none = await cliErrorOf(() => flow.preview({}));
        const both = await cliErrorOf(() => flow.apply({ all: true, contract: ['c-1'] }));

        assert.equal(none.code, 'CONTRACT_SELECTION_REQUIRED');
        assert.equal(both.code, 'CONTRACT_SELECTION_AMBIGUOUS');
        assert.equal(none.exitCode, 1);
        assert.deepEqual(calls, []);
    });
});

// @requirement SC-ENTL-023 — An operator carries a changed vocabulary into running contracts, seeing it first
describe('what it prints and which exit code a script sees', () => {
    test('a preview names each change and says that nothing was written', async () => {
        const { flow } = setUp({
            previews: [
                preview(),
                preview({
                    contractId: 'c-2',
                    features: { added: [], removed: [] },
                    quotas: [{ key: 'users', before: 10, after: 5 }],
                    money: [{ field: 'priceSnapshot.totalNet', before: 49, after: 59 }],
                    refusal: { code: 'MONEY_WOULD_CHANGE' },
                }),
                preview({
                    contractId: 'c-3',
                    features: { added: [], removed: [] },
                    changes: false,
                    vocabulary: { unknown: [], missing: [] },
                }),
            ],
        });

        const text = flow.format(await flow.preview({ all: true }), false);

        assert.match(text, /Contract c-1 \(tenant t-1\)\n {2}features: \+ATLAS_AES -ATLAS/);
        assert.match(text, /keys the application no longer knows: ATLAS/);
        assert.match(text, /granted today and missing: ATLAS_AES/);
        assert.match(text, /would be written/);
        assert.match(text, /quota users: 10 -> 5/);
        assert.match(text, /priceSnapshot\.totalNet: 49 -> 59/);
        assert.match(text, /left as it is: a re-freeze would charge differently/);
        assert.match(text, /Contract c-3 \(tenant t-1\)\n {2}unchanged/);
        assert.match(
            text,
            /3 contract\(s\): 1 would change, 1 left as they are, 1 unchanged\. Nothing was written/,
        );
    });

    test('an apply that wrote everything exits 0 and names the successor', async () => {
        const { flow } = setUp();

        const outcomes = await flow.apply({ all: true, yes: true });

        assert.equal(flow.exitCodeOf(outcomes), 0);
        assert.match(
            flow.format(outcomes, true),
            /written as c-9; the contract it replaces is kept/,
        );
    });

    test('one contract refused or moved makes the exit code 6, after the others were written', async () => {
        const written = { ...preview(), successorId: 'c-9', moved: false };
        const refused = {
            ...preview({ contractId: 'c-2', refusal: { code: 'MONEY_WOULD_CHANGE' } }),
            successorId: null,
            moved: false,
        };
        const moved = { ...preview({ contractId: 'c-3' }), successorId: null, moved: true };
        const { flow } = setUp({ outcomes: [written, refused, moved] });

        const outcomes = await flow.apply({ all: true, yes: true });

        assert.equal(flow.exitCodeOf(outcomes), 6);
        assert.match(
            flow.format(outcomes, true),
            /changed while its successor was written; run the command again/,
        );
        assert.match(
            flow.format(outcomes, true),
            /3 contract\(s\): 1 written, 2 left as they are, 0 unchanged\./,
        );
    });

    test('the command runs the preview without --apply and the write with it, and sets the exit code', async () => {
        const { flow, calls } = setUp({
            outcomes: [
                {
                    ...preview({ refusal: { code: 'NOT_IN_FORCE' } }),
                    successorId: null,
                    moved: false,
                },
            ],
        });
        const command = new ContractsRefreshCommand(flow);
        const exitCode = process.exitCode;
        try {
            assert.match(await printed(command, { all: true }), /Nothing was written/);
            assert.equal(process.exitCode, exitCode, 'a preview sets no exit code');
            assert.match(
                await printed(command, { all: true, apply: true, yes: true }),
                /no such contract is in force/,
            );
            assert.equal(process.exitCode, 6);
        } finally {
            process.exitCode = exitCode;
        }
        assert.deepEqual(
            calls.map(([what]) => what),
            ['preview', 'apply'],
        );
    });

    test('--contract repeats, and --output json prints the results as they are', async () => {
        const { flow } = setUp();
        const command = new ContractsRefreshCommand(flow);

        assert.deepEqual(command.parseContract('c-2', command.parseContract('c-1')), [
            'c-1',
            'c-2',
        ]);
        const json = JSON.parse(await printed(command, { all: true, output: 'json' }));
        assert.equal(json[0].contractId, 'c-1');
        assert.ok(new ContractsCommands() instanceof ContractsCommands);
    });
});

// @requirement SC-ENTL-022 — An operator is told which running contracts hold a feature vocabulary left behind
describe('`<app> doctor` about the contracts in force', () => {
    test('without frozen contracts there is nothing to look at', async () => {
        const result = await new ContractFeaturesDoctorCheck(null).run();
        assert.equal(result.severity, 'ok');
    });

    test('contracts on today’s vocabulary pass', async () => {
        const { refresh } = setUp({ previews: [] });
        const result = await new ContractFeaturesDoctorCheck(refresh).run();
        assert.equal(result.severity, 'ok');
        assert.match(result.message, /^0 contract\(s\) in force/);
    });

    test('a contract behind is a warning that names it, its keys, and the command to look further', async () => {
        const { refresh } = setUp();
        const result = await new ContractFeaturesDoctorCheck(refresh).run();
        assert.equal(result.severity, 'warning');
        assert.match(result.message, /c-1 \(tenant t-1: unknown ATLAS; missing ATLAS_AES\)/);
        assert.match(result.message, /contracts refresh --all/);
        assert.deepEqual(result.details.contracts, [
            { id: 'c-1', tenantId: 't-1', unknown: ['ATLAS'], missing: ['ATLAS_AES'] },
        ]);
    });

    test('it names five and counts the rest', async () => {
        const previews = Array.from({ length: 7 }, (_, i) => preview({ contractId: `c-${i + 1}` }));
        const { refresh } = setUp({ previews });
        const result = await new ContractFeaturesDoctorCheck(refresh).run();
        assert.match(result.message, /c-5 \(tenant/);
        assert.doesNotMatch(result.message, /c-6 \(tenant/);
        assert.match(result.message, /and 2 more/);
        assert.equal(result.details.contracts.length, 7);
    });

    test('a contract that could not be compared is a warning with its reason, never a pass', async () => {
        const { refresh } = setUp({
            previews: [],
            unreadable: [
                preview({ contractId: 'c-7', refusal: { code: 'NO_SUBSCRIPTION' } }),
                preview({
                    contractId: 'c-8',
                    refusal: { code: 'REFUSED', reason: "add-on version 'bv-x' cannot be read" },
                }),
            ],
        });
        const result = await new ContractFeaturesDoctorCheck(refresh).run();
        assert.equal(result.severity, 'warning');
        assert.match(result.message, /2 contract\(s\) in force could not be compared/);
        assert.match(result.message, /c-7 \(tenant t-1: its tenant has no subscription\)/);
        assert.match(result.message, /c-8 \(tenant t-1: add-on version 'bv-x' cannot be read\)/);
        assert.doesNotMatch(result.message, /each granting/);
        assert.deepEqual(
            result.details.unreadable.map((contract) => contract.id),
            ['c-7', 'c-8'],
        );
    });

    test('contracts that cannot be read are an error', async () => {
        const result = await new ContractFeaturesDoctorCheck({
            inspect: async () => {
                throw new Error('connection refused');
            },
        }).run();
        assert.equal(result.severity, 'error');
        assert.match(result.message, /cannot be read: connection refused/);
    });
});
