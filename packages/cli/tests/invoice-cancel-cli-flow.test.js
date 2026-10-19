// `<app> invoices cancel`, as an operator runs it: first to see what the
// cancellation would write, then with `--apply` to write it, with the second
// factor and, against production, a confirmation.
//
// The cancellation itself is `@saasicat/nest`'s and tested there. Here it is
// stood in for, so that a test can tell what the command asked for, what it
// passed on, what it recorded in the audit log, what it printed and which exit
// code a script sees.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    ConflictException,
    InternalServerErrorException,
    NotFoundException,
    UnprocessableEntityException,
} from '@nestjs/common';

import { InvoiceCancelCliFlow, InvoicesCancelCommand, InvoicesCommands } from '../dist/index.js';
import { cliErrorOf, printed, recordingContext } from './helpers/operator-cli.js';

const OPTIONS = {
    tenant: 'acme',
    invoice: 'AHP-2026-000123',
    reason: 'The billing address was wrong.',
};

const CANCELLED = {
    cancellation: {
        id: 'cancellation-1',
        cancelledInvoiceId: 'invoice-1',
        reason: OPTIONS.reason,
        correctedSubscriber: { city: { previous: 'Hamburg', corrected: 'Bremen' } },
        deliverTo: null,
    },
    cancellationInvoice: {
        number: 'AHP-2026-000140',
        tenantId: 't1',
        correction: { kind: 'cancellation', of: { number: 'AHP-2026-000123' } },
    },
    replacement: { number: 'AHP-2026-000141', paidOnIssue: 0 },
    credits: [],
    withdrawnCollections: 0,
};

function setUp({ refusal = null, numbered = 'invoice-1' } = {}) {
    const calls = [];
    const tenants = {
        async getTenantDetail(slug) {
            calls.push(['tenant', slug]);
            if (slug !== 'acme') throw new NotFoundException({ code: 'TENANT_NOT_FOUND' });
            return { id: 't1', slug };
        },
    };
    const cancellations = {
        async invoiceIdNumbered(tenantId, number) {
            calls.push(['numbered', tenantId, number]);
            return numbered;
        },
        async preview(tenantId, invoiceId, request) {
            calls.push(['preview', tenantId, invoiceId, request]);
            if (refusal) throw refusal;
            return {
                cancelled: {
                    number: OPTIONS.invoice,
                    currency: 'EUR',
                    subscriber: { legalName: 'Müller & Söhne GmbH' },
                },
                cancellation: { totalGross: 58.31, currency: 'EUR', issueDate: '2026-03-20' },
                replacement: { totalGross: 58.31, currency: 'EUR', issueDate: '2026-03-20' },
                movedIn: 58.31,
                credited: 0,
                reason: request.reason,
                deliverTo: request.deliverTo,
            };
        },
        async cancel(tenantId, invoiceId, request, cancelledBy) {
            calls.push(['cancel', tenantId, invoiceId, request, cancelledBy]);
            if (refusal) throw refusal;
            return CANCELLED;
        },
    };
    const ctx = recordingContext();
    return { ctx, calls, flow: new InvoiceCancelCliFlow(ctx, tenants, cancellations) };
}

// @requirement SC-PRIC-091 — An issued invoice is never edited; a cancellation invoice corrects it
describe('the preview is the command, and the cancellation the second one', () => {
    test('without --apply it previews the tenant’s invoice so numbered, and asks for neither factor nor confirmation', async () => {
        const { flow, calls, ctx } = setUp();

        await flow.preview(OPTIONS);

        assert.deepEqual(calls, [
            ['tenant', 'acme'],
            ['numbered', 't1', OPTIONS.invoice],
            [
                'preview',
                't1',
                'invoice-1',
                { reason: OPTIONS.reason, corrections: {}, deliverTo: null },
            ],
        ]);
        assert.deepEqual(ctx.asked, ['identity', 'super-admin']);
    });

    // @requirement SC-ADM-019 — Early deletion, cancelling an invoice and joining a subscriber need a second factor
    test('with --apply it asks for the second factor and the confirmation, cancels as the operator and records it', async () => {
        const { flow, calls, ctx } = setUp();

        await flow.apply({ ...OPTIONS, yes: true });

        assert.deepEqual(ctx.asked, [
            'identity',
            'super-admin',
            'second factor of user-ops',
            'confirmed with --yes',
            'audit',
        ]);
        assert.deepEqual(calls.at(-1), [
            'cancel',
            't1',
            'invoice-1',
            { reason: OPTIONS.reason, corrections: {}, deliverTo: null },
            'cli:ops@example.com:deploy-host',
        ]);
        assert.deepEqual(ctx.logged, [
            {
                identity: {
                    email: 'ops@example.com',
                    host: 'deploy-host',
                    actor: 'cli:ops@example.com:deploy-host',
                },
                userId: 'user-ops',
                entity: 'SubscriptionInvoice',
                entityId: 'invoice-1',
                action: 'SUBSCRIPTION_INVOICE_CANCELLED',
                changes: {
                    tenantId: 't1',
                    number: 'AHP-2026-000123',
                    cancellationNumber: 'AHP-2026-000140',
                    replacementNumber: 'AHP-2026-000141',
                    reason: OPTIONS.reason,
                    corrected: ['city'],
                    deliverToGiven: false,
                    paidOnIssue: 0,
                    credited: 0,
                    withdrawnCollections: 0,
                },
            },
        ]);
    });

    test('passes the corrections and the address on as typed, a correction left empty clearing its detail', async () => {
        const { flow, calls } = setUp();

        await flow.preview({
            ...OPTIONS,
            correct: ['city=Bremen', 'addressLine2='],
            deliverTo: 'accounts@acme.example',
        });

        assert.deepEqual(calls.at(-1)[3], {
            reason: OPTIONS.reason,
            corrections: { city: 'Bremen', addressLine2: null },
            deliverTo: 'accounts@acme.example',
        });
    });
});

describe('what the command refuses', () => {
    for (const [flag, options] of [
        ['--tenant', { ...OPTIONS, tenant: undefined }],
        ['--invoice', { ...OPTIONS, invoice: undefined }],
        ['--reason', { ...OPTIONS, reason: '  ' }],
    ]) {
        test(`without ${flag}, cancelling nothing`, async () => {
            const { flow, calls } = setUp();

            const error = await cliErrorOf(() => flow.apply(options));

            assert.deepEqual([error.code, error.exitCode], ['MISSING_FLAG', 1]);
            assert.ok(error.message.startsWith(flag), error.message);
            assert.deepEqual(
                calls.filter(([what]) => what === 'cancel'),
                [],
            );
        });
    }

    for (const [why, correct] of [
        ['a field it does not know', 'email=x@acme.example'],
        ['no equals sign', 'Bremen'],
        ['no field before it', '=Bremen'],
    ]) {
        test(`a correction with ${why}`, async () => {
            const { flow } = setUp();

            const error = await cliErrorOf(() => flow.preview({ ...OPTIONS, correct: [correct] }));

            assert.deepEqual([error.code, error.exitCode], ['INVOICE_CORRECTION_INVALID', 1]);
        });
    }

    test('a tenant it does not know, with the platform’s code', async () => {
        const { flow } = setUp();

        const error = await cliErrorOf(() => flow.preview({ ...OPTIONS, tenant: 'nobody' }));

        assert.deepEqual([error.code, error.exitCode], ['TENANT_NOT_FOUND', 1]);
    });

    test('a number the tenant has no invoice under, asking no second factor', async () => {
        const { flow, ctx } = setUp({ numbered: null });

        const error = await cliErrorOf(() => flow.apply(OPTIONS));

        assert.deepEqual([error.code, error.exitCode], ['SUBSCRIPTION_INVOICE_NOT_FOUND', 1]);
        assert.ok(!ctx.asked.some((each) => each.startsWith('second factor')));
    });

    test('an invoice cancelled already with exit code 6, and records nothing', async () => {
        const { flow, ctx } = setUp({
            refusal: new ConflictException({
                code: 'SUBSCRIPTION_INVOICE_ALREADY_CANCELLED',
                message: 'Invoice AHP-2026-000123 is cancelled already.',
            }),
        });

        const error = await cliErrorOf(() => flow.apply({ ...OPTIONS, yes: true }));

        assert.deepEqual(
            [error.code, error.exitCode, error.message],
            [
                'SUBSCRIPTION_INVOICE_ALREADY_CANCELLED',
                6,
                'Invoice AHP-2026-000123 is cancelled already.',
            ],
        );
        assert.deepEqual(ctx.logged, []);
    });

    test('every other refusal with exit code 1 and the platform’s sentence', async () => {
        const { flow } = setUp({
            refusal: new UnprocessableEntityException({
                code: 'SUBSCRIPTION_INVOICE_NO_DELIVERY_ADDRESS',
                message: "The subscriber's record holds no invoice email.",
            }),
        });

        const error = await cliErrorOf(() => flow.preview(OPTIONS));

        assert.deepEqual(
            [error.code, error.exitCode],
            ['SUBSCRIPTION_INVOICE_NO_DELIVERY_ADDRESS', 1],
        );
    });

    for (const [why, failure] of [
        ['a failure of the platform itself', new Error('the database went away')],
        ['a server error', new InternalServerErrorException('the database went away')],
    ]) {
        test(`${why} is not turned into a refusal`, async () => {
            const { flow } = setUp({ refusal: failure });

            await assert.rejects(flow.preview(OPTIONS), (error) => error === failure);
        });
    }
});

describe('the commands', () => {
    test('print the preview, and what the cancellation wrote with --apply', async () => {
        const { flow } = setUp();
        const command = new InvoicesCancelCommand(flow);

        const previewed = await printed(command, OPTIONS);
        const applied = await printed(command, { ...OPTIONS, apply: true, yes: true });

        assert.match(
            previewed,
            /Invoice AHP-2026-000123 of Müller & Söhne GmbH would be cancelled/,
        );
        assert.match(previewed, /Run again with --apply/);
        assert.match(applied, /Cancelled by AHP-2026-000140, replaced by AHP-2026-000141\./);
    });

    test('print JSON with -o json', async () => {
        const { flow } = setUp();

        const answered = JSON.parse(
            await printed(new InvoicesCancelCommand(flow), {
                ...OPTIONS,
                apply: true,
                output: 'json',
            }),
        );

        assert.equal(answered.replacement.number, 'AHP-2026-000141');
    });

    test('every option reads what was typed', () => {
        const command = new InvoicesCancelCommand(setUp().flow);

        assert.deepEqual(
            [
                command.parseTenant('acme'),
                command.parseInvoice('AHP-2026-000123'),
                command.parseReason('why'),
                command.parseCorrect('postalCode=28195', ['city=Bremen']),
                command.parseDeliverTo('accounts@acme.example'),
                command.parseApply(),
                command.parseOutput('json'),
            ],
            [
                'acme',
                'AHP-2026-000123',
                'why',
                ['city=Bremen', 'postalCode=28195'],
                'accounts@acme.example',
                true,
                'json',
            ],
        );
    });

    test('`invoices` alone names its sub-command and exits 2', async () => {
        const exit = process.exit;
        const writes = [];
        const write = process.stderr.write;
        let code = null;
        process.exit = (value) => {
            code = value;
        };
        process.stderr.write = (chunk) => {
            writes.push(String(chunk));
            return true;
        };
        try {
            await new InvoicesCommands().run();
        } finally {
            process.exit = exit;
            process.stderr.write = write;
        }

        assert.deepEqual([code, writes.join('')], [2, 'Specify a sub-command: cancel.\n']);
    });
});
