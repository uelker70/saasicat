// An application that serves tenants cannot start without the port that hands
// over a tenant's export (`subscription-ends.requires-export`), without the
// identifier of the environment it runs in (`subscription-ends.requires-installation`),
// without its erasers and its report of what a tenant keeps
// (`subscription-ends.requires-erasers`, `subscription-ends.requires-keep-report`),
// nor without the port its notices go through (`subscription-notices.requires-port`),
// so its types ask for them as well: an integrator upgrading learns it from the build,
// not from the first start. The start refusals stay for code the compiler did
// not check.
//
// The configuration is compiled against the shipped declarations — what an
// integrator's build sees.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

/** The diagnostics of `body`, compiled beside the options type it names. */
function diagnosticsOf(body) {
    const directory = mkdtempSync(join(tmpdir(), 'saasicat-serving-types-'));
    try {
        const file = join(directory, 'wiring.ts');
        writeFileSync(
            file,
            [
                `import type { SaaSiCatTenantBillingOptions } from ${JSON.stringify(DIST)};`,
                "declare const rest: Omit<SaaSiCatTenantBillingOptions, 'subscriptionEnds' | 'notices'>;",
                "declare const exportPort: SaaSiCatTenantBillingOptions['subscriptionEnds']['export'];",
                "declare const deletion: SaaSiCatTenantBillingOptions['subscriptionEnds']['deletion'];",
                'declare const fromTheEnvironment: string | undefined;',
                "declare const erasers: SaaSiCatTenantBillingOptions['subscriptionEnds']['deletion']['erasers'];",
                "declare const keep: SaaSiCatTenantBillingOptions['subscriptionEnds']['deletion']['keep'];",
                "declare const noticePort: NonNullable<SaaSiCatTenantBillingOptions['notices']>['port'];",
                "declare const ends: SaaSiCatTenantBillingOptions['subscriptionEnds'];",
                "declare const notices: NonNullable<SaaSiCatTenantBillingOptions['notices']>;",
                body,
            ].join('\n'),
        );
        const program = ts.createProgram([file], {
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.NodeNext,
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            experimentalDecorators: true,
        });
        return ts
            .getPreEmitDiagnostics(program)
            .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

describe('the options of an application that serves tenants', () => {
    test('compile with the export port given', () => {
        assert.deepEqual(
            diagnosticsOf(
                'export const options: SaaSiCatTenantBillingOptions = { ...rest, notices, subscriptionEnds: { export: exportPort, deletion } };',
            ),
            [],
        );
    });

    test('do not compile without the ends of subscriptions named', () => {
        const diagnostics = diagnosticsOf(
            'export const options: SaaSiCatTenantBillingOptions = { ...rest, notices };',
        );
        assert.equal(diagnostics.length, 1, diagnostics.join('\n'));
        assert.match(diagnostics[0], /subscriptionEnds/);
    });

    test('do not compile with the ends named and the export port left out', () => {
        const diagnostics = diagnosticsOf(
            'export const options: SaaSiCatTenantBillingOptions = { ...rest, notices, subscriptionEnds: { deletion } };',
        );
        assert.equal(diagnostics.length, 1, diagnostics.join('\n'));
        assert.match(diagnostics[0], /'export'/);
    });

    // @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
    test("compile with the environment's identifier passed as the environment gives it", () => {
        assert.deepEqual(
            diagnosticsOf(
                'export const options: SaaSiCatTenantBillingOptions = { ...rest, notices, subscriptionEnds: { export: exportPort, deletion: { installation: fromTheEnvironment, erasers, keep } } };',
            ),
            [],
        );
    });

    // @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
    test('do not compile with the ends named and the deletion left out', () => {
        const diagnostics = diagnosticsOf(
            'export const options: SaaSiCatTenantBillingOptions = { ...rest, notices, subscriptionEnds: { export: exportPort } };',
        );
        assert.equal(diagnostics.length, 1, diagnostics.join('\n'));
        assert.match(diagnostics[0], /'deletion'/);
    });

    // @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
    test("do not compile with the deletion named and the environment's identifier left out", () => {
        const diagnostics = diagnosticsOf(
            'export const options: SaaSiCatTenantBillingOptions = { ...rest, notices, subscriptionEnds: { export: exportPort, deletion: { erasers, keep } } };',
        );
        assert.equal(diagnostics.length, 1, diagnostics.join('\n'));
        assert.match(diagnostics[0], /'installation'/);
    });

    // @requirement SC-PRIV-022 — A tenant is erased by the application's stores, after it was told what to keep
    test('do not compile with the deletion named and the erasers or the report of what is kept left out', () => {
        for (const [given, missing] of [
            ['keep', 'erasers'],
            ['erasers', 'keep'],
        ]) {
            const diagnostics = diagnosticsOf(
                `export const options: SaaSiCatTenantBillingOptions = { ...rest, notices, subscriptionEnds: { export: exportPort, deletion: { installation: fromTheEnvironment, ${given} } } };`,
            );
            assert.equal(diagnostics.length, 1, diagnostics.join('\n'));
            assert.ok(diagnostics[0].includes(`'${missing}'`), diagnostics[0]);
        }
    });

    // @requirement SC-PRIV-020 — A tenant's administrator takes its full export, from the platform or the application
    test('compile with the declaration that the application delivers the export itself', () => {
        assert.deepEqual(
            diagnosticsOf(
                "export const options: SaaSiCatTenantBillingOptions = { ...rest, notices, subscriptionEnds: { export: { deliveredBy: 'application' }, deletion } };",
            ),
            [],
        );
    });

    // @requirement SC-PRIV-020 — A tenant's administrator takes its full export, from the platform or the application
    test('do not compile with a declaration naming anybody else as delivering it', () => {
        const diagnostics = diagnosticsOf(
            "export const options: SaaSiCatTenantBillingOptions = { ...rest, notices, subscriptionEnds: { export: { deliveredBy: 'platform' }, deletion } };",
        );
        assert.equal(diagnostics.length, 1, diagnostics.join('\n'));
        assert.match(diagnostics[0], /'"platform"' is not assignable to type '"application"'/);
    });

    test('compile with the notice port given, and no record of their own', () => {
        assert.deepEqual(
            diagnosticsOf(
                'export const options: SaaSiCatTenantBillingOptions = { ...rest, subscriptionEnds: ends, notices: { port: noticePort } };',
            ),
            [],
        );
    });

    test('do not compile without the notices named', () => {
        const diagnostics = diagnosticsOf(
            'export const options: SaaSiCatTenantBillingOptions = { ...rest, subscriptionEnds: ends };',
        );
        assert.equal(diagnostics.length, 1, diagnostics.join('\n'));
        assert.match(diagnostics[0], /notices/);
    });

    test('do not compile with the notices named and the port left out', () => {
        const diagnostics = diagnosticsOf(
            'export const options: SaaSiCatTenantBillingOptions = { ...rest, subscriptionEnds: ends, notices: {} };',
        );
        assert.equal(diagnostics.length, 1, diagnostics.join('\n'));
        assert.match(diagnostics[0], /'port'/);
    });

    test('do not compile with the notice port given to the version notices', () => {
        const diagnostics = diagnosticsOf(
            'export const options: SaaSiCatTenantBillingOptions = { ...rest, subscriptionEnds: ends, notices, versionNotices: { port: noticePort } };',
        );
        assert.equal(diagnostics.length, 1, diagnostics.join('\n'));
        assert.match(diagnostics[0], /'port'/);
    });
});
