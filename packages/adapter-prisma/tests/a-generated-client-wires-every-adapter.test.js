import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import * as shipped from '../dist/index.js';
import { generatePrismaClient } from './integration/database.js';

// A client Prisma generates from the shipped fragments types an enum column as
// that enum's members and a `Json` column as its own JSON input, and its
// delegate methods are generic over those shapes. Every shipped adapter has to
// take such a client as it is: an integrator who wires one by hand would
// otherwise cast the client, which switches the type check off exactly where a
// renamed column should be caught.
//
// The client is generated here from the composed fragments, the adapters are
// read off the package's exports, and the wiring is compiled against the
// shipped declarations — what an integrator's build sees.

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

/** Every class the package exports under the `Prisma` prefix. */
const ADAPTERS = Object.entries(shipped)
    .filter(
        ([name, value]) =>
            name.startsWith('Prisma') &&
            typeof value === 'function' &&
            Function.prototype.toString.call(value).startsWith('class'),
    )
    .map(([name]) => name)
    .sort();

/**
 * The wiring: the generated client assigned to the two shapes every adapter
 * picks its delegates from, and to each adapter's first constructor argument
 * where that is an object — an adapter whose first argument is a setting, or
 * none, takes no client.
 */
function wiring(clientDirectory, extra = '') {
    return [
        `import type { PrismaClient } from ${JSON.stringify(join(clientDirectory, 'index.js'))};`,
        `import * as shipped from ${JSON.stringify(DIST)};`,
        `import type { PrismaLike, PrismaTxLike } from ${JSON.stringify(DIST)};`,
        'declare const client: PrismaClient;',
        'type ClientOf<C> = C extends abstract new (...args: infer A) => unknown',
        '    ? A[0] extends object ? A[0] : unknown',
        '    : unknown;',
        'export const whole: PrismaLike = client;',
        'export const inTransaction: PrismaTxLike = client;',
        ...ADAPTERS.map(
            (name) => `export const ${name}: ClientOf<typeof shipped.${name}> = client;`,
        ),
        extra,
    ].join('\n');
}

/**
 * The adapters that take `unknown` and cast it inside, so this test compares
 * nothing for them — and `PrismaRlsBypass`, which takes a setting, not a
 * client. Named, so that an adapter joining them fails here rather than
 * passing unchecked; the list only shrinks, as one of them gets a shape.
 */
const COMPARED_WITH_NOTHING = [
    'PrismaBundleVersionRetirementRepository',
    'PrismaFeatureWithdrawalRepository',
    'PrismaInvoiceArchive',
    'PrismaMaintenanceWindowRepository',
    'PrismaPaymentEventLog',
    'PrismaRlsBypass',
    'PrismaSubscriptionNoticeRepository',
    'PrismaVersionRetirementRepository',
];

/** The wiring compiled against the shipped declarations. */
function compiled(directory, source) {
    const file = join(directory, 'wiring.ts');
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
    return { program, source: program.getSourceFile(file) };
}

/** The adapters whose first constructor argument the wiring resolves to `unknown`. */
function takingAnything(directory, source) {
    const { program, source: file } = compiled(directory, source);
    const checker = program.getTypeChecker();
    return file.statements
        .filter(ts.isVariableStatement)
        .flatMap((statement) => statement.declarationList.declarations)
        .filter((declaration) => ADAPTERS.includes(declaration.name.getText(file)))
        .filter(
            (declaration) =>
                checker.getTypeAtLocation(declaration.name).flags & ts.TypeFlags.Unknown,
        )
        .map((declaration) => declaration.name.getText(file))
        .sort();
}

/** Each diagnostic with the line it stands on, so a failure names the adapter. */
function diagnosticsOf(directory, source) {
    const { program } = compiled(directory, source);
    return ts.getPreEmitDiagnostics(program).map((d) => {
        const where = d.file
            ? d.file.text.split('\n')[d.file.getLineAndCharacterOfPosition(d.start ?? 0).line]
            : '';
        return `${where.trim()} — ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
    });
}

// @requirement SC-COMP-020 — Every shipped adapter takes the client Prisma generates from the shipped fragments
describe('a client Prisma generates from the shipped fragments', () => {
    const clientDirectory = generatePrismaClient('a-generated-client-wires-every-adapter');
    const workDirectory = dirname(clientDirectory);

    test('there are adapters to wire', () => {
        assert.ok(ADAPTERS.includes('PrismaPromoCodeRepository'), ADAPTERS.join(', '));
    });

    test('is taken by every shipped adapter, and by both client shapes, without a cast', () => {
        assert.deepEqual(diagnosticsOf(workDirectory, wiring(clientDirectory)), []);
    });

    test('compares every adapter with it, except the ones named for taking anything', () => {
        assert.deepEqual(
            takingAnything(workDirectory, wiring(clientDirectory)),
            COMPARED_WITH_NOTHING,
        );
    });

    test('accepts in a JSON column whatever the generated client accepts there', () => {
        // The assignments above run one way: a client wider than a shape fits
        // it. Here the other way: every JSON input Prisma takes — a member left
        // undefined, a value with `toJSON()` — has to be one the shapes take.
        const json = [
            `import type { Prisma } from ${JSON.stringify(join(clientDirectory, 'index.js'))};`,
            `import type { PrismaLike } from ${JSON.stringify(DIST)};`,
            "type ShapeJson = Parameters<PrismaLike['auditLog']['create']>[0]['data']['changes'];",
            'declare const theirs: Prisma.InputJsonValue;',
            'export const asTheShapeTakesIt: ShapeJson = theirs;',
        ].join('\n');
        assert.deepEqual(diagnosticsOf(workDirectory, json), []);
    });

    test('the check sees an enum member the generated client does not have', () => {
        // Without this, an empty list could mean the compiler never read the
        // generated declarations, and every assignment above was to `any`.
        const wrongMember = diagnosticsOf(
            workDirectory,
            wiring(
                clientDirectory,
                "export const wrong: Parameters<PrismaClient['promoCode']['count']>[0] = { where: { status: 'NOT_A_STATUS' } };",
            ),
        );
        assert.ok(
            wrongMember.some((message) => message.includes('NOT_A_STATUS')),
            wrongMember.join('\n') || 'no diagnostic at all',
        );
    });
});
