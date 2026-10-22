import { Inject, Injectable } from '@nestjs/common';
import type {
    ArchivedTermsVersion,
    CanonicalTermsVersionRow,
    TermsArchivePort,
    TermsVersionToArchive,
} from '@saasicat/core';
import {
    termsArchiveProtectionProblem,
    termsVersionChanged,
    toArchivedTermsVersion,
} from '@saasicat/core';
import {
    PRISMA_CLIENT_TOKEN,
    type PrismaModelDelegateLike,
    type PrismaTxLike,
} from './prisma-client-token.js';

/** Narrow view of the client: the one delegate the archive writes and reads, and the catalogue. */
interface TermsPrisma extends Pick<PrismaTxLike, '$queryRaw'> {
    termsVersion: PrismaModelDelegateLike<CanonicalTermsVersionRow>;
}

/** Root-client fields used directly: the archive's delegate and the raw query. */
interface TermsArchiveClient extends Pick<PrismaTxLike, '$queryRaw'> {
    termsVersion: unknown;
}

/**
 * `TermsArchivePort` against `terms_versions`: one file per version of the
 * terms, written once. The table's triggers refuse every update, delete and
 * truncate (`1.0-the-terms-are-a-version-and-a-file.postgres.sql`), so nothing
 * here changes a version once it is stored.
 */
@Injectable()
export class PrismaTermsArchive implements TermsArchivePort {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: TermsArchiveClient) {}

    private get db(): TermsPrisma {
        // SAFETY: `termsVersion` is the delegate of fragment 25's model, whose
        // rows are `CanonicalTermsVersionRow`; the client is typed only as far
        // as a generated one is checked against it.
        return this.prisma as TermsPrisma;
    }

    async store(terms: TermsVersionToArchive): Promise<void> {
        // `ON CONFLICT DO NOTHING` on the version: a file stored before stays,
        // and the one handed over now is compared with it by its checksum.
        const written = await this.db.termsVersion.createManyAndReturn({
            data: [
                {
                    version: terms.version,
                    checksum: terms.checksum,
                    mediaType: terms.mediaType,
                    fileName: terms.fileName,
                    content: terms.content,
                    archivedAt: terms.archivedAt,
                },
            ],
            skipDuplicates: true,
            select: { version: true },
        });
        if (written.length > 0) return;
        const stored = await this.db.termsVersion.findUnique({
            where: { version: terms.version },
            select: { checksum: true },
        });
        if (stored && stored.checksum !== terms.checksum) {
            throw termsVersionChanged(terms.version, stored.checksum, terms.checksum);
        }
    }

    async read(version: string): Promise<ArchivedTermsVersion | null> {
        const row = await this.db.termsVersion.findUnique({ where: { version } });
        return row ? toArchivedTermsVersion(row) : null;
    }

    async protectionProblem(): Promise<string | null> {
        // Enabled is `O`, as triggers fire by default, or `A`, always; `D` is
        // disabled, and `R` fires only in a session that replicates.
        // SAFETY: the query selects one text column under the alias `name`.
        const rows = (await this.db.$queryRaw`
            SELECT tgname::text AS "name" FROM pg_trigger
             WHERE tgrelid = to_regclass('terms_versions')
               AND tgenabled IN ('O', 'A')`) as Array<{ name: string }>;
        return termsArchiveProtectionProblem(rows.map((row) => row.name));
    }
}
