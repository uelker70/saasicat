// The pilot data shapes: a row, and the payloads and results of the two writes.
//
// In `client/` rather than beside the page, because the RESOURCE answers with
// these shapes and the client layer may not read a page or an `internal/`
// folder. `internal/dialogs/types.ts` re-exports them, so the pages and dialogs that
// already import from there keep working.

/**
 * A pilot as the list renders it.
 *
 * Here rather than in `PilotsPage.vue` because the pilots RESOURCE answers with
 * it, and `client/` may not read a page. The index signature stays: the app
 * serves this route, so it may carry fields the platform does not name.
 */
export interface PilotRow {
    id: string;
    tenant: { id: string; slug: string; name: string };
    plan: string;
    /**
     * The day picked as the pilot's end, as an ISO moment at that day's UTC
     * midnight — what `new Date(endsAt)` makes of the `YYYY-MM-DD` the dialogs
     * send. The pages show the day it begins with, in every zone (`SC-ADM-048`).
     */
    pilotEndsAt: string | null;
    pilotNote: string | null;
    grantedBy: string | null;
    grantedAt?: string | null;
    [extra: string]: unknown;
}

export interface PilotCreatePayload {
    tenant: { name: string; slug?: string; legalForm?: string; vatId?: string };
    admin: {
        email: string;
        firstName: string;
        lastName: string;
        initialPassword?: string;
    };
    /** `endsAt` is the day picked as the pilot's end, `YYYY-MM-DD`. */
    pilot: { plan: string; note?: string; endsAt?: string };
}

export interface PilotCreateResult {
    slug: string;
    /** If the server generated an initial password, include it here. */
    initialPassword?: string;
}

/** Edit an existing pilot subscription (plan, end date, note). */
export interface PilotEditPayload {
    /** Optional — only the fields that are set get changed. */
    plan?: string;
    /** The day picked as the end, `YYYY-MM-DD`; `null` clears it (open-ended pilot phase). */
    endsAt?: string | null;
    /** `null` or empty clears the note. */
    note?: string | null;
}

export interface PilotEditResult {
    slug: string;
    changed?: string[];
}
