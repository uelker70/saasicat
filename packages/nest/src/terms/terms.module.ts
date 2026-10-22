// TermsModule — the archive of the operator's terms, and the start that fills
// it from `config/saas.yaml#terms` (`SC-CFG-038`).
//
// Global, like the settings record it sits beside: tenant billing reads the
// archive when it mails a contract's confirmation, and does not import this
// module.

import {
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type { TermsArchivePort } from '@saasicat/core';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { TermsArchiveCheck } from './terms-archive.check.js';
import { TERMS_ARCHIVE_TOKEN } from './terms.tokens.js';

export interface TermsModuleOptions {
    /**
     * Where the versions are kept; the persistence bundle's
     * `core.termsArchive` by default. Without one, a file that names terms
     * refuses the start.
     */
    archive?: ProviderSpec<TermsArchivePort>;
    /** Modules the archive's provider resolves its dependencies from. */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

@Module({})
export class TermsModule {
    static forRoot(options: TermsModuleOptions = {}): DynamicModule {
        const archive: Provider = options.archive
            ? asProvider(TERMS_ARCHIVE_TOKEN, options.archive)
            : { provide: TERMS_ARCHIVE_TOKEN, useValue: null };
        return {
            module: TermsModule,
            global: true,
            imports: options.imports ?? [],
            providers: [archive, TermsArchiveCheck],
            // The check too: the contract service refuses terms it cannot
            // find archived by it, wherever the contract modules are wired.
            exports: [TERMS_ARCHIVE_TOKEN, TermsArchiveCheck],
        };
    }
}
