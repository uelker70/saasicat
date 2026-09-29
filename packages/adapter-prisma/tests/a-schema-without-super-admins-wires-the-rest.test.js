import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// An application that keeps its SuperAdmins in its own user table leaves the
// SuperAdmin fragment out — the fragment itself says so — and its generated
// client has no `superAdminUser` or `superAdminMfa`. The adapters that never
// touch those tables have to take such a client as it is: the alternative, a
// cast to the whole client type, switches the type check off exactly where a
// renamed column should be caught.
//
// Compiled with the TypeScript compiler against the shipped declarations, so
// what is checked is what a consumer's build sees.

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

const SOURCE = `
import {
    PrismaPromoCodeHoldRepository,
    PrismaPromoCodeRedemptionRepository,
    PrismaPromoCodeRepository,
    PrismaPromoCodeValidationLogRepository,
    PrismaPromoSubscriptionLookup,
    PrismaSubscriptionContractRepository,
    type PrismaLike,
} from ${JSON.stringify(DIST)};

type Delegates = Omit<PrismaLike, 'superAdminUser' | 'superAdminMfa' | '$transaction'> & {
    subscriptionContract: unknown;
    promoCodeHold: unknown;
};
declare const client: Delegates & {
    $transaction<T>(fn: (tx: Delegates) => Promise<T>): Promise<T>;
};

new PrismaSubscriptionContractRepository(client);
new PrismaPromoCodeRepository(client);
new PrismaPromoCodeRedemptionRepository(client);
new PrismaPromoCodeValidationLogRepository(client);
new PrismaPromoSubscriptionLookup(client);
new PrismaPromoCodeHoldRepository(client);
`;

function diagnosticsOf(source) {
    const dir = mkdtempSync(join(tmpdir(), 'saasicat-client-types-'));
    try {
        const file = join(dir, 'wiring.ts');
        writeFileSync(file, source);
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
            .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// @requirement SC-COMP-017 — An adapter asks only for the tables it uses
describe('a client from a schema without the SuperAdmin fragment', () => {
    test('is taken by every adapter that does not touch those tables, without a cast', () => {
        assert.deepEqual(diagnosticsOf(SOURCE), []);
    });

    test('the check sees a client that lacks what an adapter does use', () => {
        // Without this, an empty diagnostic list could mean the compiler never
        // resolved the declarations at all.
        const missingDelegate = SOURCE.replace(
            "'superAdminUser' | 'superAdminMfa' | '$transaction'",
            "'superAdminUser' | 'superAdminMfa' | '$transaction' | 'promoCode'",
        );
        const found = diagnosticsOf(missingDelegate);
        assert.ok(
            found.some((message) => message.includes('promoCode')),
            found.join('\n') || 'no diagnostic at all',
        );
    });
});
