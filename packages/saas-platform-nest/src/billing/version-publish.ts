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
            'changeNote is required when publishing a version.',
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
        throw new PublishValidationError('NOT_FOUND', `PlanVersion ${draftId} not found`);
    }
    if (draft.publishedAt !== null) {
        throw new PublishValidationError(
            'ALREADY_PUBLISHED',
            `PlanVersion ${draftId} has already been published.`,
        );
    }
    if (!draft.baseVersionId) {
        throw new PublishValidationError(
            'NO_BASE_VERSION',
            `Draft ${draftId} has no baseVersion — probably a manually created v1 that may only be published via a migration.`,
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
            `baseVersion ${baseId} no longer exists.`,
        );
    }
    if (base.supersededAt !== null) {
        throw new PublishValidationError(
            'BASE_SUPERSEDED',
            `The draft is based on a superseded version (${planContext}). ` +
                `Rebase the draft onto the current live version, or create a new one.`,
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
            `Draft ${draftId} has meanwhile been published by another adminht.`,
        );
    }
}
