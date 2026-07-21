// PlanRow — wire format for the plan stem table (SPEC_V2 §11.1 M6).
//
// Plan is the business identity of a tariff (STARTER, STANDARD,
// PROFESSIONAL). The purchasable fields (pricing, features, quotas) live on
// `PlanVersionRow` — the plan stem carries only identity + UI ordering +
// soft delete.
//
// Conventions:
//  - `planKey` is the business plan identity (unique per `projectKey`);
//    historically the value stored in `PlanVersion.planId` and
//    `Subscription.plan`.
//  - `deletedAt` activates soft delete: deleted plans stay effective for
//    existing subscriptions (contract protection P1) but are filtered out
//    in the UI.
//
// The plan stem does **not** reference PlanVersion via FK — the binding is
// soft (PlanVersion.planId === Plan.planKey) until the importer binds it
// hard in M6.7. This keeps the greenfield cutover free of forced migration.

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
 * Fields that must be set when creating a new plan stem. `id`, `createdAt`,
 * `updatedAt`, `deletedAt` are assigned by the repository. PlanVersion-specific
 * fields (features, quotas, pricing) belong in a separate `PlanVersion`
 * creation (follows in M6 Pack 2).
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
 * Fields that may be changed on the plan stem. `planKey` and `projectKey`
 * are deliberately not here — stem identity is immutable; whoever wants to
 * change it creates a new plan and retires the old one.
 */
export interface UpdatePlanData {
    label?: string;
    description?: string | null;
    icon?: string | null;
    sortOrder?: number;
}
