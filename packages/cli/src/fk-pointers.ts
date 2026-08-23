// Enabling the foreign keys the fragments cannot name.
//
// The platform models carry `tenantId` and `userId` columns, but the
// `@relation` lines to the app's own `Tenant` and `User` are shipped commented
// out — the fragments do not know what those models are called, or whether they
// exist at all.
//
// So `schema apply` leaves them commented and the quickstart says "briefly
// review schema.prisma to check whether FK pointers need to be enabled
// manually". That is a manual step in an otherwise automated command, and it is
// the second one on the list that gets forgotten: nothing fails without it. The
// columns are there, the queries work, and referential integrity is simply
// absent until someone deletes a tenant.
//
// `--tenant-model` / `--user-model` say what they are called, and these
// functions enable them.

/** A commented-out relation line, and what it points at. */
export interface FkPointer {
    /** 0-based line index in the schema. */
    readonly line: number;
    /** The model the relation targets, as the fragment names it. */
    readonly target: 'Tenant' | 'User';
    /** The model the line lives in — the other side of the relation. */
    readonly model: string;
    /** The line as it stands, still commented. */
    readonly text: string;
}

/**
 * Matches ` // tenant Tenant @relation(...)` and its `?` / spacing variants.
 *
 * Anchored on the whole line rather than searched for, because a fragment's
 * prose comments mention `@relation` too — `01-subscription.prisma:16` is a
 * sentence about the convention, and uncommenting it would produce a syntax
 * error in the consumer's schema.
 */
const POINTER = /^(\s*)\/\/\s*(\w+)(\s+)(Tenant|User)(\??)(\s+)(@relation\(.*\))\s*$/;

/** Every commented-out FK pointer in `schema`, with the model it sits in. */
export function findFkPointers(schema: string): FkPointer[] {
    const found: FkPointer[] = [];
    let model = '';
    schema.split('\n').forEach((text, line) => {
        const opening = /^model\s+(\w+)\s*\{/.exec(text);
        if (opening) model = opening[1]!;
        const match = POINTER.exec(text);
        if (match) found.push({ line, target: match[4] as 'Tenant' | 'User', model, text });
    });
    return found;
}

/** The name of a named relation (`@relation("AuditLogUser", …)`), or null. */
export function relationNameOf(relationAttribute: string): string | null {
    const match = /@relation\(\s*"([^"]+)"/.exec(relationAttribute);
    return match ? match[1]! : null;
}

/**
 * Escapes a value that is about to be interpolated into a `RegExp`.
 *
 * The model names come from `--tenant-model` / `--user-model`, so a
 * command-line argument reaches a regular expression — `js/regex-injection`.
 * On the CLI path it is not reachable: `resolveFkPointers` calls
 * `assertModelsExist` first and exits non-zero, so by the time a pattern is
 * built the value is a model name the schema declares.
 *
 * That argument is true and does not hold the property. These functions are
 * part of the package surface — `src/index.ts` re-exports the module, and a
 * consumer CLI can call `enableFkPointers` or `hasBackRelation` with a name
 * nothing validated. `.*` then matches any model block and reports a
 * back-relation that is not there; a value with nested quantifiers backtracks
 * against the whole schema. Escaping puts the guarantee in the function that
 * needs it instead of two calls away in another file.
 */
/** Every metacharacter, the backslash included — the set the lint asks for. */
function escapeForRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The body of `model X { … }`, or null. */
function modelBody(schema: string, model: string): string | null {
    const name = escapeForRegExp(model);
    // `name` went through escapeForRegExp, which covers every metacharacter.
    // eslint-disable-next-line no-restricted-syntax
    const block = new RegExp(`(^|\\n)model\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm').exec(schema);
    return block ? block[2]! : null;
}

/**
 * Whether the foreign key is unique — which makes the relation 1:1, not 1:n.
 *
 * `Subscription.tenantId` carries `@unique`, so a tenant has at most one
 * subscription and the opposite field is `subscription Subscription?`, not a
 * list. The example app writes it exactly that way. A check that only knew
 * lists called that correct schema incomplete and told the consumer to add a
 * second, contradictory field.
 *
 * Measured, because the obvious guess is wrong: `prisma validate` 6.19.3
 * ACCEPTS `subscriptions Subscription[]` against a `@unique` foreign key. So
 * the list is not a build break — it is worse placed than that. The generated
 * client types the relation as a list the database can never hold more than
 * one of, and nothing says so until someone writes code for the second row.
 * Only the missing field is P1012.
 */
export function isOneToOne(schema: string, model: string, foreignKey: string): boolean {
    const body = modelBody(schema, model);
    if (!body) return false;
    // Escaped in full, see escapeForRegExp.
    // eslint-disable-next-line no-restricted-syntax
    return new RegExp(`^\\s*${escapeForRegExp(foreignKey)}\\s+\\S+.*@unique`, 'm').test(body);
}

/**
 * Whether `owner` already declares the opposite side of this relation.
 *
 * Prisma relations have two sides. Enabling `tenant Tenant @relation(...)` on
 * `AuditLog` without a matching field on `Tenant` produces a schema Prisma
 * refuses with P1012 — and the first version of this did exactly that to the
 * project's own example app.
 *
 * Two things are part of the question rather than details, and Prisma taught
 * each by refusing the result:
 *
 *   - The relation NAME. `AuditLog.user` carries `@relation("AuditLogUser", …)`
 *     because a model may point at `User` more than once, and an unnamed field
 *     does not pair with it.
 *   - The CARDINALITY. A unique foreign key makes the opposite side singular,
 *     and a check that only knew lists reported a correct schema as broken.
 */
export function hasBackRelation(
    schema: string,
    model: string,
    owner: string,
    relationName: string | null,
    singular = false,
): boolean {
    const body = modelBody(schema, owner);
    if (body === null) return false;

    const name = escapeForRegExp(model);
    const shape = singular ? `${name}\\??` : `${name}\\[\\]`;
    // `shape` is the escaped model name plus a literal suffix.
    // eslint-disable-next-line no-restricted-syntax
    const candidates = [...body.matchAll(new RegExp(`^\\s*\\w+\\s+${shape}(\\s.*)?$`, 'gm'))];
    return candidates.some((line) => relationNameOf(line[0]) === relationName);
}

export interface FkModelNames {
    /** What the app calls its tenant model, e.g. `Organization`. */
    tenant?: string;
    /** What the app calls its user model, e.g. `Account`. */
    user?: string;
}

export interface EnableFkResult {
    readonly schema: string;
    /** The pointers that were enabled, with the model each now names. */
    readonly enabled: ReadonlyArray<{ line: number; model: string }>;
    /**
     * Pointers left commented because the caller did not name that model.
     *
     * Reported rather than dropped: a schema half-wired for referential
     * integrity is worse than one that is not, because it looks finished.
     */
    readonly skipped: ReadonlyArray<{ line: number; target: string }>;
    /**
     * Pointers left commented because the app model has no opposite field, with
     * the line to add.
     *
     * Separate from `skipped`, because the answer is different: those need a
     * flag, these need one line in a model the tool must not edit on its own.
     */
    readonly needsBackRelation: ReadonlyArray<{
        line: number;
        owner: string;
        suggestion: string;
    }>;
}

/**
 * Uncomments the FK pointers and renames their target to the app's model.
 *
 * Only for targets the caller actually named. `--tenant-model` without
 * `--user-model` enables the tenant relations and leaves the user ones
 * commented, which is a real configuration: not every app has a `User` the
 * audit log should point at.
 */
export function enableFkPointers(schema: string, models: FkModelNames): EnableFkResult {
    const lines = schema.split('\n');
    const enabled: Array<{ line: number; model: string }> = [];
    const skipped: Array<{ line: number; target: string }> = [];
    const needsBackRelation: Array<{ line: number; owner: string; suggestion: string }> = [];

    for (const pointer of findFkPointers(schema)) {
        const model = pointer.target === 'Tenant' ? models.tenant : models.user;
        if (!model) {
            skipped.push({ line: pointer.line, target: pointer.target });
            continue;
        }
        // Both sides or neither: a one-sided relation is a schema Prisma
        // refuses, and refusing it here costs a message where refusing it there
        // costs a file the tool already changed.
        const match = POINTER.exec(pointer.text)!;
        const relationName = relationNameOf(match[7]!);
        // The foreign key this relation is built on decides the shape of the
        // other side: unique means one, so the opposite field is singular.
        const foreignKey = foreignKeyOf(match[7]!);
        const singular = foreignKey !== null && isOneToOne(schema, pointer.model, foreignKey);

        if (!hasBackRelation(schema, pointer.model, model, relationName, singular)) {
            needsBackRelation.push({
                line: pointer.line,
                owner: model,
                suggestion: backRelationSuggestion(pointer.model, relationName, singular),
            });
            continue;
        }
        const [, indent, field, gap1, , optional, gap2, relation] = match;
        // The gaps are preserved so the column alignment the fragment author
        // chose survives; Prisma's formatter would redo it, and a consumer who
        // does not run it should still get a readable file.
        lines[pointer.line] = `${indent}${field}${gap1}${model}${optional}${gap2}${relation}`;
        enabled.push({ line: pointer.line, model });
    }

    return { schema: lines.join('\n'), enabled, skipped, needsBackRelation };
}

const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);

/** The scalar this relation is built on — `fields: [tenantId]`. */
export function foreignKeyOf(relationAttribute: string): string | null {
    const match = /fields:\s*\[\s*(\w+)/.exec(relationAttribute);
    return match ? match[1]! : null;
}

/** The line to add to the owning model, in the shape Prisma will accept. */
function backRelationSuggestion(
    model: string,
    relationName: string | null,
    singular: boolean,
): string {
    const field = singular ? lowerFirst(model) : `${lowerFirst(model)}s`;
    const type = singular ? `${model}?` : `${model}[]`;
    return `${field} ${type}` + (relationName ? ` @relation("${relationName}")` : '');
}

/**
 * Refuses a model name the schema does not define.
 *
 * Without this the command would produce a schema that does not validate, and
 * the error would come from Prisma, about a line the consumer did not write.
 */
export function assertModelsExist(declaredModels: readonly string[], models: FkModelNames): void {
    const missing = Object.entries(models)
        .filter(([, name]) => name && !declaredModels.includes(name))
        .map(([role, name]) => `--${role}-model=${name}`);
    if (missing.length === 0) return;
    throw new Error(
        `${missing.join(', ')} — no such model in this schema. It declares: ` +
            `${declaredModels.slice().sort().join(', ')}.`,
    );
}
