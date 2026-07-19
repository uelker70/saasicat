// Re-Export der Diff-Klassifikations-Funktionen aus
// `@saasicat/types`. Die Pure Functions sind seit M3.4-vfx
// nach types verschoben, damit auch das UI-Paket sie ohne NestJS-Dependency
// nutzen kann (z. B. BundlesPage's Diff-Preview-Modal).
//
// Bestandsimporte aus `@saasicat/nest/billing` bleiben
// unverändert kompatibel.
//
// Spec: yada-services/handoff/superadmin/SPEC.md §6 + SPEC_V2.md §7

export { classifyBundleVersionDiff, classifyPlanDiff } from '@saasicat/types';
export type {
    BundleVersionFields,
    ChangeDirection,
    DiffResult,
    PlanVersionFields,
    VersionChange,
    VersionChangeDirection,
} from '@saasicat/types';
