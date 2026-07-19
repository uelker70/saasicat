// PlanRow — Wire-Format für die Plan-Stamm-Tabelle (SPEC_V2 §11.1 M6).
//
// Plan ist die fachliche Identität eines Tarifs (STARTER, STANDARD,
// PROFESSIONAL). Die kaufbaren Felder (Pricing, Features, Quotas) liegen
// auf `PlanVersionRow` — Plan-Stamm hat nur Identität + UI-Sortierung +
// Soft-Delete.
//
// Konventionen:
//  - `planKey` ist die fachliche Plan-Identität (eindeutig pro
//    `projectKey`); historisch der Wert, der in `PlanVersion.planId` und
//    `Subscription.plan` steht.
//  - `deletedAt` aktiviert Soft-Delete: gelöschte Pläne bleiben für Bestand-
//    Subscriptions wirksam (Vertragsschutz P1), werden im UI aber gefiltert.
//
// Der Plan-Stamm referenziert PlanVersion **nicht** per FK — die Bindung
// ist weich (PlanVersion.planId === Plan.planKey), bis der Importer in
// M6.7 hart verbindet. Damit bleibt der Greenfield-Cutover ohne
// Migration-Zwang.

export interface PlanRow {
    id: string;
    projectKey: string;
    planKey: string;
    label: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

/**
 * Felder, die beim Anlegen eines neuen Plan-Stamms gesetzt werden müssen.
 * `id`, `createdAt`, `updatedAt`, `deletedAt` werden vom Repository vergeben.
 * PlanVersion-spezifische Felder (Features, Quotas, Pricing) gehören in eine
 * separate `PlanVersion`-Anlage (folgt in M6 Pack 2).
 */
export interface CreatePlanData {
    projectKey: string;
    planKey: string;
    label: string;
    description?: string | null;
    icon?: string | null;
    sortOrder?: number;
}

/**
 * Felder, die am Plan-Stamm geändert werden dürfen. `planKey` und
 * `projectKey` sind absichtlich nicht hier — Stamm-Identität ist immutable;
 * wer sie ändern will, legt einen neuen Plan an und retired den alten.
 */
export interface UpdatePlanData {
    label?: string;
    description?: string | null;
    icon?: string | null;
    sortOrder?: number;
}
