// Which user made a request is decided in one place: `packages/nest/src/core/request-user.ts`,
// through the resolvers an application binds at the root of `SaaSiCatModule`, or `sub` and then
// `id` without one. A route that read `request.user.id` itself would answer the question by a rule
// of its own, and the same request would name one user to the second factor and another to the
// audit log.
//
// So no other source under `packages/nest/src` reads the user's identifying fields off a
// request's `user` — `sub`, `id`, `userId`, `email`, `sessionId` — nor the session header
// `x-session-id`. A read is `<anything>.user.<field>`, optional chains and parenthesised casts
// included, or `<name>.<field>` where `<name>` was taken from a `.user` or destructured as `user`
// in the same file. Read as syntax rather than text, so a comment naming the shape does not count;
// the files come from the directory, so a new one is covered unlisted.
//
// What this does not see, and stays a question for review: a read through a computed key
// (`user[field]`) or through a variable passed on to a helper in another file, and the fields an
// application reads for other questions — `role`, `platformRole`, `tenantId` — which have their
// own resolvers.

// @requirement SC-AUD-022 — One request names one user, on every route that records or checks who acted

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'packages', 'nest', 'src');
const THE_ONE_PLACE = join(SRC, 'core', 'request-user.ts');

/** The fields that say who a request's user is, or where it came from. */
const IDENTITY_FIELDS = new Set(['sub', 'id', 'userId', 'email', 'sessionId']);
const SESSION_HEADER = 'x-session-id';

function sourceFiles(dir = SRC, found = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, found);
        else if (entry.name.endsWith('.ts')) found.push(full);
    }
    return found;
}

/** `node` without the parentheses, casts and non-null assertions around it. */
function unwrapped(node) {
    let current = node;
    while (
        ts.isParenthesizedExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isNonNullExpression(current) ||
        ts.isTypeAssertionExpression(current) ||
        ts.isSatisfiesExpression(current)
    ) {
        current = current.expression;
    }
    return current;
}

const isUserAccess = (node) => ts.isPropertyAccessExpression(node) && node.name.text === 'user';

/** The names a file binds to a request's user: `x = <…>.user` and `{ user }` / `{ user: x }`. */
function namesBoundToAUser(file) {
    const names = new Set();
    const visit = (node) => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer &&
            isUserAccess(unwrapped(node.initializer))
        ) {
            names.add(node.name.text);
        }
        if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
            const key = node.propertyName ?? node.name;
            if (ts.isIdentifier(key) && key.text === 'user') names.add(node.name.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    return names;
}

/** Each place in `code` that reads who a request's user is, with its line and its text. */
function userReads(code) {
    const file = ts.createSourceFile(
        'code.ts',
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    );
    const boundToAUser = namesBoundToAUser(file);
    const found = [];
    const record = (node) => {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        found.push(`${line + 1}: ${node.getText(file)}`);
    };
    const visit = (node) => {
        if (ts.isPropertyAccessExpression(node) && IDENTITY_FIELDS.has(node.name.text)) {
            const receiver = unwrapped(node.expression);
            if (
                isUserAccess(receiver) ||
                (ts.isIdentifier(receiver) && boundToAUser.has(receiver.text))
            ) {
                record(node);
            }
        }
        if (ts.isStringLiteralLike(node) && node.text === SESSION_HEADER) record(node);
        ts.forEachChild(node, visit);
    };
    visit(file);
    return found;
}

describe('the user behind a request is read in one place', () => {
    test('the scan sees each shape a read takes', () => {
        const shapes = [
            'const a = request.user?.id;',
            'const a = req.user.sub;',
            'const a = (r as RequestLike).user?.userId ?? null;',
            'const a = request.user?.email;',
            'const a = request.user?.sessionId;',
            'const user = request.user; const a = user.id;',
            'const { user } = request; const a = user?.sub;',
            'const { user: who } = request; const a = who.email;',
            "const a = request.headers?.['x-session-id'];",
        ];
        for (const shape of shapes) assert.equal(userReads(shape).length, 1, shape);
    });

    test('and leaves alone what is not one', () => {
        const others = [
            '// request.user?.id is read in core/request-user.ts',
            'const a = request.user?.tenantId;',
            'const a = request.user?.role;',
            'const user = await repo.create(dto); const a = user.id;',
            'function f(user: { id: string }) { return user.id; }',
            'const a = invoice.id;',
        ];
        for (const other of others) assert.deepEqual(userReads(other), [], other);
    });

    test('only core/request-user.ts reads it', () => {
        const files = sourceFiles();
        assert.ok(files.includes(THE_ONE_PLACE), 'the one place exists');
        assert.ok(
            userReads(readFileSync(THE_ONE_PLACE, 'utf8')).length > 0,
            'the one place reads the user',
        );
        const elsewhere = files
            .filter((file) => file !== THE_ONE_PLACE)
            .flatMap((file) =>
                userReads(readFileSync(file, 'utf8')).map(
                    (read) => `${relative(ROOT, file)}:${read}`,
                ),
            );
        assert.deepEqual(elsewhere, []);
    });
});
