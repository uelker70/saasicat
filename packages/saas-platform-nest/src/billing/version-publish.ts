// Pure-function building blocks for PlanVersion publish workflows.
//
// Consumers orchestrate the write (Prisma `$transaction`,
// `updateMany` optimistic lock, audit log) — the platform provides the
// **validation pure functions** defined here, which check the
// preconditions before every publish operation.

/** Generic shape of a PlanVersion snapshot for publish validation. */
export interface PublishablePlanVersion {
    id: string;
    publishedAt: Date | null;
    supersededAt: Date | null;
    baseVersionId: string | null;
}

/**
 * Structured publish error — the consumer maps it to the appropriate HTTP
 * status code (NestJS: 400 / 404 / 409).
 */
export class PublishValidationError extends Error {
    constructor(
        public readonly code:
            | 'CHANGE_NOTE_REQUIRED'
            | 'NOT_FOUND'
            | 'ALREADY_PUBLISHED'
            | 'NO_BASE_VERSION'
            | 'BASE_NOT_FOUND'
            | 'BASE_SUPERSEDED'
            | 'OPTIMISTIC_LOCK_CONFLICT',
        message: string,
    ) {
        super(message);
        this.name = 'PublishValidationError';
    }
}

/**
 * Checks the `changeNote` requirement. Throws `CHANGE_NOTE_REQUIRED` if empty /
 * only whitespace.
 */
export function assertChangeNote(changeNote: string | null | undefined): string {
    const trimmed = (changeNote ?? '').trim();
    if (trimmed.length === 0) {
        throw new PublishValidationError(
            'CHANGE_NOTE_REQUIRED',
            'changeNote ist Pflicht beim Veröffentlichen einer Version.',
        );
    }
    return trimmed;
}

/**
 * Checks the preconditions a draft must satisfy before it may be published:
 *
 *   - Exists (otherwise NOT_FOUND)
 *   - `publishedAt` is null (otherwise ALREADY_PUBLISHED)
 *   - `baseVersionId` is set (otherwise NO_BASE_VERSION)
 *
 * If `base` is passed, it additionally checks:
 *   - `base.supersededAt` is null (otherwise BASE_SUPERSEDED)
 *
 * `null` for `base` means "base lookup performed separately but not
 * found" → BASE_NOT_FOUND.
 */
export function assertDraftPublishable(
    draft: PublishablePlanVersion | null,
    draftId: string,
): asserts draft is PublishablePlanVersion {
    if (!draft) {
        throw new PublishValidationError('NOT_FOUND', `PlanVersion ${draftId} nicht gefunden`);
    }
    if (draft.publishedAt !== null) {
        throw new PublishValidationError(
            'ALREADY_PUBLISHED',
            `PlanVersion ${draftId} ist bereits veröffentlicht.`,
        );
    }
    if (!draft.baseVersionId) {
        throw new PublishValidationError(
            'NO_BASE_VERSION',
            `Draft ${draftId} hat keine baseVersion — wahrscheinlich manuell angelegtes v1, das nur per Migration veröffentlicht werden darf.`,
        );
    }
}

/**
 * Checks that the base version the draft diffs against is still
 * available (not superseded).
 */
export function assertBaseVersionFresh(
    base: PublishablePlanVersion | null,
    baseId: string,
    planContext: string,
): asserts base is PublishablePlanVersion {
    if (!base) {
        throw new PublishValidationError(
            'BASE_NOT_FOUND',
            `baseVersion ${baseId} nicht mehr vorhanden.`,
        );
    }
    if (base.supersededAt !== null) {
        throw new PublishValidationError(
            'BASE_SUPERSEDED',
            `Draft basiert auf einer abgelösten Version (${planContext}). ` +
                `Bitte den Draft gegen die aktuelle Live-Version rebasen oder neu anlegen.`,
        );
    }
}

/**
 * Checks the result of the optimistic-lock update (`updateMany WHERE
 * publishedAt IS NULL`): exactly 1 row expected. Otherwise a
 * concurrent admin has already published the draft.
 */
export function assertOptimisticLockHeld(updateCount: number, draftId: string): void {
    if (updateCount !== 1) {
        throw new PublishValidationError(
            'OPTIMISTIC_LOCK_CONFLICT',
            `Draft ${draftId} wurde zwischenzeitlich von einem anderen Admin veröffentlicht.`,
        );
    }
}
