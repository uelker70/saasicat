// The identifier an installation marks its database with (`SC-PRIV-021`).
//
// A tenant's deletion erases data nobody can bring back, and the process that
// runs it reads its database from a connection string. A process meant for
// staging, started against a restored copy of production's database, would
// delete production's tenants on production's days. So the database carries
// the identifier of the installation it belongs to — set by the operator with
// a command, never by a start — and every process names the identifier of its
// own environment. A deletion runs only where the two are the same.
//
// The brake holds against a process meant for another environment. A process
// whose environment was copied from production, identifier included, passes
// it: the identifier is a name, not a secret.

/** The longest identifier an installation can be marked with. */
export const INSTALLATION_IDENTIFIER_MAX_LENGTH = 64;

// One quantifier on one class, so no input can be split across the pattern in
// more than one way: it is asked of text from the environment.
const INSTALLATION_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * How an installation operates, as an operator names it. In a `test`
 * operation every document the installation issues is marked as a test, so
 * that none is taken for a real one; a `live` one issues real documents.
 */
export const INSTALLATION_OPERATIONS = ['test', 'live'] as const;

/** How an installation operates: `test` or `live`. */
export type InstallationOperation = (typeof INSTALLATION_OPERATIONS)[number];

/**
 * The mark a database carries: which installation it belongs to, how it
 * operates, since when and by whom.
 */
export interface InstallationMark {
    readonly identifier: string;
    /**
     * Whether the installation is a test operation. A mark written without
     * saying so is live, as the column default writes it: a test operation is
     * always the operator's deliberate step.
     */
    readonly testOperation: boolean;
    readonly markedAt: Date;
    /** As the audit log tags an actor: `cli:<email>:<host>`. */
    readonly markedBy: string;
}

/** What is wrong with a value given as an installation identifier. */
export type InstallationIdentifierProblem =
    'missing' | 'not-a-string' | 'blank' | 'too-long' | 'characters';

/**
 * What is wrong with `value` as an installation identifier, or `null` where it
 * is one. Nothing is trimmed or folded: a value with a space around it is
 * refused rather than read as the value without, since two identifiers that
 * differ only there would otherwise count as the same installation.
 */
export function installationIdentifierProblem(
    value: unknown,
): InstallationIdentifierProblem | null {
    if (value === undefined || value === null) return 'missing';
    if (typeof value !== 'string') return 'not-a-string';
    if (value.trim() === '') return 'blank';
    if (value.length > INSTALLATION_IDENTIFIER_MAX_LENGTH) return 'too-long';
    if (!INSTALLATION_IDENTIFIER_PATTERN.test(value)) return 'characters';
    return null;
}

/** Whether the database belongs to the environment a process runs in. */
export type InstallationMarkVerdict =
    | { readonly kind: 'matches'; readonly identifier: string }
    /** Nobody marked the database yet: nothing is deleted until somebody does. */
    | { readonly kind: 'unmarked'; readonly expected: string }
    | { readonly kind: 'differs'; readonly expected: string; readonly marked: string };

/**
 * Compares the identifier this environment names with the mark the database
 * carries. Exactly: `PROD` is not `prod`.
 */
export function installationMarkVerdict(
    expected: string,
    mark: Pick<InstallationMark, 'identifier'> | null,
): InstallationMarkVerdict {
    if (mark === null) return { kind: 'unmarked', expected };
    if (mark.identifier === expected) return { kind: 'matches', identifier: expected };
    return { kind: 'differs', expected, marked: mark.identifier };
}

/**
 * How a database marked so operates. One nobody marked is live: the operation
 * is a property of the mark, and without one nothing says the installation is
 * a test.
 */
export function installationOperationOf(
    mark: Pick<InstallationMark, 'testOperation'> | null,
): InstallationOperation {
    return mark?.testOperation === true ? 'test' : 'live';
}

/**
 * What `installation status` and the doctor say of a database: whether it
 * belongs to this environment, and how it operates.
 */
export type InstallationStatus = InstallationMarkVerdict & {
    readonly operation: InstallationOperation;
};

/** The verdict on `mark` against `expected`, with the operation the mark says. */
export function installationStatus(
    expected: string,
    mark: Pick<InstallationMark, 'identifier' | 'testOperation'> | null,
): InstallationStatus {
    return { ...installationMarkVerdict(expected, mark), operation: installationOperationOf(mark) };
}
