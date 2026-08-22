export type {
    PlatformEmailProvider,
    PlatformEmailWriteInput,
    PlatformEmailTestInput,
    PlatformEmailTestResult,
} from '../../client/resources/platform-email.types.ts';

// Types of the shared PlatformEmailPage — deliberately extracted from the `.vue` so that
// consumers can import them as regular TS types. A named type import
// directly from a `.vue` is not resolved via the `*.vue` module shim (vue-tsc);
// from this `.ts` it is (re-exported via the package index).
