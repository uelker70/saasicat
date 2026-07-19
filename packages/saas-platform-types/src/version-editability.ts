// Editierbarkeits-Regel für versionierte Catalog-Einträge — Pure Function.
//
// Single-Source-of-Truth für die Frage „darf das SuperAdmin-UI den Editor
// für diese Version öffnen?". Sowohl Services (Plan-/Bundle-)
// als auch UI-Komponenten konsumieren diesen Helper, damit Backend-Gate
// und Frontend-Button-Disabling deckungsgleich bleiben.
//
// Hintergrund: Bis SPEC_V2 §11.1 M6 Pack 2c galt „publishedAt !== null →
// immutable" (Vertragsschutz P1/P4). Diese harte Regel verhindert aber
// auch nachträgliche Korrekturen an Versionen, die zwar published, aber
// noch nicht aktiv und noch nicht verkauft sind — der typische Fall, wenn
// ein Future-Release vorgezogen wurde und der Preis noch justiert werden
// muss. Die aufgeweichte Regel:
//
//   editable === true wenn
//     publishedAt === null                            (= Draft, klassisch)
//   oder
//     publishedAt !== null
//     && supersededAt === null                        (nicht von Nachfolger abgelöst)
//     && isLatestInChain                              (höchste Versions-Nummer)
//     && (subscriptionCount ?? 1) === 0               (keine Subscription bindet sie)
//     && validFrom in der Zukunft                     (noch keine neuen Buchungen möglich)
//
// `subscriptionCount === undefined` wird defensiv als „nicht-leer"
// interpretiert — Adapter, die das Feld nicht setzen, halten die Version
// eingefroren (fail-closed).

import type { VersionedEntityBase } from './subscription.types.js';

/** Warum eine Version editierbar ist (für UI-Badges + Audit-Logs). */
export type VersionEditableReason = 'draft' | 'pre-active';

export interface VersionEditability {
    editable: boolean;
    reason: VersionEditableReason | null;
}

/**
 * Entscheidet, ob eine versionierte Catalog-Entity gerade editiert werden
 * darf. `now` ist parametrisiert, damit Tests deterministisch sein können
 * und Services denselben Zeitpunkt für Listen-Annotation + Mutation-Gate
 * benutzen.
 */
export function isVersionEditable(
    v: VersionedEntityBase,
    now: Date = new Date(),
): VersionEditability {
    if (v.publishedAt === null) {
        return { editable: true, reason: 'draft' };
    }
    if (v.supersededAt !== null) {
        return { editable: false, reason: null };
    }
    if (v.isLatestInChain !== true) {
        return { editable: false, reason: null };
    }
    if ((v.subscriptionCount ?? 1) > 0) {
        return { editable: false, reason: null };
    }
    if (v.validFrom === null) {
        return { editable: false, reason: null };
    }
    const from = new Date(v.validFrom);
    if (Number.isNaN(from.getTime())) {
        return { editable: false, reason: null };
    }
    if (from.getTime() <= now.getTime()) {
        return { editable: false, reason: null };
    }
    return { editable: true, reason: 'pre-active' };
}
