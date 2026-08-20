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

/** Every commented-out FK pointer in `schema`. */
export function findFkPointers(schema: string): FkPointer[] {
    const found: FkPointer[] = [];
    schema.split('\n').forEach((text, line) => {
        const match = POINTER.exec(text);
        if (match) found.push({ line, target: match[4] as 'Tenant' | 'User', text });
    });
    return found;
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

    for (const pointer of findFkPointers(schema)) {
        const model = pointer.target === 'Tenant' ? models.tenant : models.user;
        if (!model) {
            skipped.push({ line: pointer.line, target: pointer.target });
            continue;
        }
        const match = POINTER.exec(pointer.text)!;
        const [, indent, field, gap1, , optional, gap2, relation] = match;
        // The gaps are preserved so the column alignment the fragment author
        // chose survives; Prisma's formatter would redo it, and a consumer who
        // does not run it should still get a readable file.
        lines[pointer.line] = `${indent}${field}${gap1}${model}${optional}${gap2}${relation}`;
        enabled.push({ line: pointer.line, model });
    }

    return { schema: lines.join('\n'), enabled, skipped };
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
