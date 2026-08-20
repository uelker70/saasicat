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
 * Whether `owner` already declares the opposite side of this relation.
 *
 * Prisma relations have two sides. Enabling `tenant Tenant @relation(...)` on
 * `AuditLog` without `auditLogs AuditLog[]` on `Tenant` produces a schema
 * Prisma refuses with P1012 — and the first version of this did exactly that
 * to the project's own example app, which carries back-relations for
 * subscriptions and promo redemptions but none for the audit log.
 *
 * The relation NAME is part of the question, not a detail. `AuditLog.user`
 * carries `@relation("AuditLogUser", …)` because a model can point at `User`
 * more than once; an unnamed `auditLogs AuditLog[]` does not pair with it, and
 * a check that accepted any list of the right type would have reported that
 * schema as fine. It was written that way first, and Prisma said otherwise.
 */
export function hasBackRelation(
    schema: string,
    model: string,
    owner: string,
    relationName: string | null,
): boolean {
    const block = new RegExp(`(^|\\n)model\\s+${owner}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm').exec(schema);
    if (!block) return false;

    const candidates = [...block[2]!.matchAll(new RegExp(`^\\s*\\w+\\s+${model}\\[\\].*$`, 'gm'))];
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
        if (!hasBackRelation(schema, pointer.model, model, relationName)) {
            needsBackRelation.push({
                line: pointer.line,
                owner: model,
                suggestion:
                    `${lowerFirst(pointer.model)}s ${pointer.model}[]` +
                    (relationName ? ` @relation("${relationName}")` : ''),
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
