// Pure-Function-Bausteine für PlanVersion-Publish-Workflows.
//
// Konsumenten orchestrieren das Schreiben (Prisma-`$transaction`,
// `updateMany`-Optimistic-Lock, Audit-Log) — die Plattform liefert die
// hier definierten **Validierungs-Pure-Functions**, die vor jeder Publish-
// Operation die Vorbedingungen prüfen.
//
// Spec: yada-services/handoff/superadmin/UMSETZUNGSPLAN.md §3.2 (1.7).
//        autohauspro/handoff/saas/ROADMAP_PLANS_AND_ENTITLEMENT.md §4.

/** Generische Form eines PlanVersion-Snapshots zur Publish-Validierung. */
export interface PublishablePlanVersion {
    id: string;
    publishedAt: Date | null;
    supersededAt: Date | null;
    baseVersionId: string | null;
}

/**
 * Strukturierter Publish-Fehler — Konsument mappt auf den passenden HTTP-
 * Statuscode (NestJS: 400 / 404 / 409).
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
 * Prüft `changeNote`-Pflicht. Wirft `CHANGE_NOTE_REQUIRED`, wenn leer/nur
 * Whitespace.
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
 * Prüft die Vorbedingungen, die ein Draft erfüllen muss, bevor er publiziert
 * werden darf:
 *
 *   - Existiert (sonst NOT_FOUND)
 *   - `publishedAt` ist null (sonst ALREADY_PUBLISHED)
 *   - `baseVersionId` ist gesetzt (sonst NO_BASE_VERSION)
 *
 * Wenn `base` übergeben wird, wird zusätzlich geprüft:
 *   - `base.supersededAt` ist null (sonst BASE_SUPERSEDED)
 *
 * `null` für `base` bedeutet „base-Lookup separat ausgeführt, aber nicht
 * gefunden" → BASE_NOT_FOUND.
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
 * Prüft, dass die Base-Version, gegen die der Draft diff'tet, noch
 * verfügbar (nicht abgelöst) ist.
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
 * Prüft das Ergebnis des Optimistic-Lock-Updates (`updateMany WHERE
 * publishedAt IS NULL`): exakt 1 Row erwartet. Anderweitig hat ein
 * paralleler Admin den Draft schon publiziert.
 */
export function assertOptimisticLockHeld(updateCount: number, draftId: string): void {
    if (updateCount !== 1) {
        throw new PublishValidationError(
            'OPTIMISTIC_LOCK_CONFLICT',
            `Draft ${draftId} wurde zwischenzeitlich von einem anderen Admin veröffentlicht.`,
        );
    }
}
