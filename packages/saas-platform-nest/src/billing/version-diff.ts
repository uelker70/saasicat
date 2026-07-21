// Re-export of the diff classification functions from
// `@saasicat/types`. Since M3.4-vfx the pure functions have been moved
// to types so that the UI package can also use them without a NestJS
// dependency (e.g. BundlesPage's diff preview modal).
//
// Existing imports from `@saasicat/nest/billing` remain
// compatible unchanged.

export { classifyBundleVersionDiff, classifyPlanDiff } from '@saasicat/types';
export type {
    BundleVersionFields,
    ChangeDirection,
    DiffResult,
    PlanVersionFields,
    VersionChange,
    VersionChangeDirection,
} from '@saasicat/types';
