export type {
    EmailHistoryStatus,
    EmailHistoryRow,
    EmailHistoryDetail,
    EmailHistoryFilter,
    EmailHistoryListResult,
    EmailHistoryResendResult,
} from '../../client/resources/email-history.types.ts';

// Types of the shared EmailHistoryPage (platform email history) — deliberately
// extracted from the `.vue` so consumers can import them as regular TS types
// (a named type import directly from a `.vue` is not resolved through the
// `*.vue` module shim, but it is from this `.ts`; re-exported via the package
// index).
