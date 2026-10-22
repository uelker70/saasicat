import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { ArchivedTermsVersion, TermsArchivePort, TermsVersionToArchive } from '@saasicat/core';
import {
    termsArchiveProtectionProblem,
    termsVersionChanged,
    toArchivedTermsVersion,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { termsVersions } from './schema.js';
import { triggerNamesOf } from './trigger-names.js';

/**
 * `TermsArchivePort` against `terms_versions`: one file per version of the
 * terms, written once. The table's triggers refuse every update, delete and
 * truncate (`1.0-the-terms-are-a-version-and-a-file.postgres.sql`), so nothing
 * here changes a version once it is stored.
 */
@Injectable()
export class DrizzleTermsArchive implements TermsArchivePort {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async store(terms: TermsVersionToArchive): Promise<void> {
        // `ON CONFLICT DO NOTHING` on the version: a file stored before stays,
        // and the one handed over now is compared with it by its checksum.
        const written = await this.db
            .insert(termsVersions)
            .values({
                version: terms.version,
                checksum: terms.checksum,
                mediaType: terms.mediaType,
                fileName: terms.fileName,
                content: terms.content,
                archivedAt: terms.archivedAt,
            })
            .onConflictDoNothing({ target: termsVersions.version })
            .returning({ version: termsVersions.version });
        if (written.length > 0) return;
        const [stored] = await this.db
            .select({ checksum: termsVersions.checksum })
            .from(termsVersions)
            .where(eq(termsVersions.version, terms.version))
            .limit(1);
        if (stored && stored.checksum !== terms.checksum) {
            throw termsVersionChanged(terms.version, stored.checksum, terms.checksum);
        }
    }

    async read(version: string): Promise<ArchivedTermsVersion | null> {
        const [row] = await this.db
            .select()
            .from(termsVersions)
            .where(eq(termsVersions.version, version))
            .limit(1);
        return row ? toArchivedTermsVersion(row) : null;
    }

    async protectionProblem(): Promise<string | null> {
        // Enabled is `O`, as triggers fire by default, or `A`, always; `D` is
        // disabled, and `R` fires only in a session that replicates.
        const result: unknown = await this.db.execute(sql`
            SELECT tgname::text AS "name" FROM pg_trigger
             WHERE tgrelid = to_regclass('terms_versions')
               AND tgenabled IN ('O', 'A')`);
        return termsArchiveProtectionProblem(triggerNamesOf(result));
    }
}
