// The start archives the version of the operator's terms `config/saas.yaml`
// names, once, and refuses a different file under a version already archived
// (`SC-CFG-038`): a contract records the version (`SC-AUD-016`), and the
// subscriber is owed that file as it was when the contract was concluded.
// Archived before any request is served, so no contract records a version the
// archive does not hold.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import {
    SETTINGS_ERROR_CODES,
    TERMS_MEDIA_TYPE,
    TERMS_VERSION_PATTERN,
    isPdf,
    isPersistenceRefusal,
    type PlanCatalogSettings,
    type TermsArchivePort,
} from '@saasicat/core';

import { PLAN_CATALOG_SETTINGS_TOKEN } from '../billing/plan-catalog.module.js';
import { SETTINGS_SOURCE_TOKEN } from '../settings/settings.tokens.js';
import { TERMS_ARCHIVE_TOKEN } from './terms.tokens.js';

@Injectable()
export class TermsArchiveCheck implements OnModuleInit {
    private readonly logger = new Logger(TermsArchiveCheck.name);

    constructor(
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: Pick<PlanCatalogSettings, 'terms'>,
        // The absolute path of `config/saas.yaml`, or the sentence saying the
        // settings were handed in as code.
        @Inject(SETTINGS_SOURCE_TOKEN)
        private readonly source: string,
        @Optional()
        @Inject(TERMS_ARCHIVE_TOKEN)
        private readonly archive: TermsArchivePort | null = null,
    ) {}

    async onModuleInit(): Promise<void> {
        const problem = await this.archived(new Date());
        if (problem) throw new Error(`Terms cannot start:\n- ${problem}`);
    }

    /**
     * Archives the terms the file names where their version is not archived
     * yet, at `now`; why it cannot, or `null` where they stand archived — or
     * where the file names none.
     */
    async archived(now: Date): Promise<string | null> {
        const terms = this.settings.terms;
        if (!terms) return null;
        if (!TERMS_VERSION_PATTERN.test(terms.version)) {
            return (
                `terms.version is ${JSON.stringify(terms.version)}, and a version is called by ` +
                "letters, digits, '.', '-' and '_', at most 32 characters."
            );
        }
        const path = this.pathOf(terms.file);
        if (!path) {
            return (
                `terms.file names ${terms.file} relative to config/saas.yaml, and the settings ` +
                'were handed in as code: name the PDF by an absolute path.'
            );
        }
        let content: Uint8Array;
        try {
            content = new Uint8Array(await readFile(path));
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return `terms.file names ${path}, which cannot be read (${reason}): put the PDF of version ${terms.version} there.`;
        }
        if (!isPdf(content)) {
            return `terms.file names ${path}, which is no PDF: the terms are kept as one.`;
        }
        if (!this.archive) {
            return (
                'config/saas.yaml names terms, and nothing archives them: adopt ' +
                'prisma-fragments/25-terms.prisma, which persistence.core.termsArchive keeps, ' +
                'or pass adapters.termsArchive.'
            );
        }
        const unprotected = await this.archive.protectionProblem();
        if (unprotected) return unprotected;
        const checksum = createHash('sha256').update(content).digest('hex');
        try {
            const kept = await this.archive.read(terms.version);
            if (kept?.checksum === checksum) return null;
            await this.archive.store({
                version: terms.version,
                checksum,
                mediaType: TERMS_MEDIA_TYPE,
                fileName: basename(path),
                content,
                archivedAt: now,
            });
        } catch (err) {
            if (
                isPersistenceRefusal(err) &&
                err.code === SETTINGS_ERROR_CODES.TERMS_VERSION_CHANGED
            ) {
                return (
                    `version ${terms.version} of the terms was archived with another file than ` +
                    `${path}: a changed file is a new version — name one in config/saas.yaml.`
                );
            }
            throw err;
        }
        this.logger.log(
            `Version ${terms.version} of the terms archived from ${path} (${checksum}).`,
        );
        return null;
    }

    /**
     * `file` as the start reads it: as it stands where it is absolute, else
     * beside `config/saas.yaml`; `null` where it is relative and the settings
     * came from code, so there is no file to stand beside.
     */
    private pathOf(file: string): string | null {
        if (isAbsolute(file)) return file;
        if (!isAbsolute(this.source)) return null;
        return resolve(dirname(this.source), file);
    }
}
