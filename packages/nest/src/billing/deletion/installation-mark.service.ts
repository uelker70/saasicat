// The mark a database carries as its installation's own (`SC-PRIV-021`).
//
// A tenant's deletion erases what nobody can bring back, and the process that
// runs it finds its database through a connection string. So before anything
// is deleted the process compares the identifier its environment names with
// the mark of the database, and deletes only where both say the same. Nothing
// writes the mark on its own: the operator does, from the command line, and
// only as the identifier of the environment the command runs in — a mark
// naming another environment would hold every deletion here from then on.
//
// Everything that decides lives here; the port only makes each write
// conditional on what stands.

import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
    Optional,
} from '@nestjs/common';
import {
    type AdminActor,
    INSTALLATION_ERROR_CODES,
    type InstallationMark,
    type InstallationMarkPort,
    type InstallationMarkVerdict,
    installationMarkVerdict,
} from '@saasicat/core';

import { AdminAuditService } from '../../admin/admin-audit.service.js';
import { actorTagOf } from '../../core/web-audit.js';
import { codedError } from '../../errors/coded-error.js';
import {
    INSTALLATION_IDENTIFIER_TOKEN,
    INSTALLATION_MARK_PORT_TOKEN,
} from '../tenant-billing.tokens.js';

/** What marking the database came to. */
export type InstallationMarkOutcome =
    /** The database was unmarked, and carries this mark now. */
    | { readonly kind: 'marked'; readonly mark: InstallationMark }
    /** The database carried this environment's mark already; nothing was written. */
    | { readonly kind: 'already-marked'; readonly mark: InstallationMark }
    /** Another installation's mark was replaced with this one. */
    | { readonly kind: 'replaced'; readonly mark: InstallationMark };

/** What the audit log names a mark under. */
const AUDITED_ENTITY = 'InstallationMark';

/** What an audit entry of a mark records: the identifier marked, or the one replaced and its successor. */
type AuditedMarkChange = { identifier: string } | { from: string; to: string };

@Injectable()
export class InstallationMarkService {
    private readonly logger = new Logger('SaaSiCat.InstallationMark');
    /**
     * The write this process is making, so that the next one waits for it. Two
     * marks made at once in one process would otherwise both read nothing,
     * both write, and both find their own mark standing — the same identifier,
     * the same operator and the same millisecond — and each would say and
     * audit that it marked the database.
     */
    private writing: Promise<unknown> = Promise.resolve();

    constructor(
        @Inject(INSTALLATION_MARK_PORT_TOKEN) private readonly marks: InstallationMarkPort,
        @Inject(INSTALLATION_IDENTIFIER_TOKEN) private readonly environment: string,
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
    ) {}

    /** Whether the database belongs to the environment this process runs in. */
    async verdict(): Promise<InstallationMarkVerdict> {
        return installationMarkVerdict(this.environment, await this.marks.find());
    }

    /**
     * Marks the database as this environment's installation where nothing
     * marks it. Refused where `identifier` is not this environment's, and where
     * another installation's mark stands.
     */
    async mark(identifier: string, actor: AdminActor): Promise<InstallationMarkOutcome> {
        this.refuseAnotherEnvironments(identifier);
        return this.oneAtATime(async () => {
            const standing = await this.marks.find();
            if (standing === null) return this.markUnmarked(identifier, actor, markedOtherwise);
            if (standing.identifier === identifier)
                return { kind: 'already-marked', mark: standing };
            throw markedOtherwise(standing);
        });
    }

    /**
     * Replaces another installation's mark with this environment's, as after
     * restoring a backup into another environment; marks where nothing does.
     * Refused where `identifier` is not this environment's, and where the mark
     * changes between reading and replacing it.
     */
    async replace(identifier: string, actor: AdminActor): Promise<InstallationMarkOutcome> {
        this.refuseAnotherEnvironments(identifier);
        return this.oneAtATime(async () => {
            const standing = await this.marks.find();
            if (standing === null) return this.markUnmarked(identifier, actor, markMoved);
            if (standing.identifier === identifier)
                return { kind: 'already-marked', mark: standing };
            const replaced = await this.marks.replace(
                standing.identifier,
                this.markOf(identifier, actor),
            );
            if (replaced === null) throw markMoved();
            await this.record(actor, 'INSTALLATION_MARK_REPLACED', identifier, {
                from: standing.identifier,
                to: identifier,
            });
            return { kind: 'replaced', mark: replaced };
        });
    }

    /**
     * Writes the mark where none stood when it was read. What stands after the
     * write is the mark written only where it is the same in every field;
     * otherwise somebody else marked first, with this identifier or another.
     */
    private async markUnmarked(
        identifier: string,
        actor: AdminActor,
        refusal: (standing: InstallationMark) => Error,
    ): Promise<InstallationMarkOutcome> {
        const written = this.markOf(identifier, actor);
        const standing = await this.marks.markIfUnmarked(written);
        if (standing.identifier !== identifier) throw refusal(standing);
        if (!sameMark(standing, written)) return { kind: 'already-marked', mark: standing };
        await this.record(actor, 'INSTALLATION_MARKED', identifier, { identifier });
        return { kind: 'marked', mark: standing };
    }

    private refuseAnotherEnvironments(identifier: string): void {
        if (identifier === this.environment) return;
        throw new BadRequestException(
            codedError(INSTALLATION_ERROR_CODES.INSTALLATION_IDENTIFIER_NOT_THIS_ENVIRONMENTS, {
                given: identifier,
                environment: this.environment,
            }),
        );
    }

    private markOf(identifier: string, actor: AdminActor): InstallationMark {
        return { identifier, markedAt: new Date(), markedBy: actorTagOf(actor) };
    }

    private oneAtATime<T>(write: () => Promise<T>): Promise<T> {
        const turn = this.writing.then(write, write);
        this.writing = turn.catch(() => undefined);
        return turn;
    }

    /** Best effort: the mark stands whether or not its record could be written (`SC-AUD-004`). */
    private async record(
        actor: AdminActor,
        action: string,
        identifier: string,
        changes: AuditedMarkChange,
    ): Promise<void> {
        if (!this.audit) return;
        try {
            await this.audit.log({
                actor,
                entity: AUDITED_ENTITY,
                entityId: identifier,
                action,
                changes,
            });
        } catch (error) {
            this.logger.error(
                `The audit record of ${action} for installation ${identifier} could not be ` +
                    'written; the mark itself was written.',
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}

function sameMark(a: InstallationMark, b: InstallationMark): boolean {
    return (
        a.identifier === b.identifier &&
        a.markedBy === b.markedBy &&
        a.markedAt.getTime() === b.markedAt.getTime()
    );
}

function markedOtherwise(standing: InstallationMark): Error {
    return new ConflictException(
        codedError(INSTALLATION_ERROR_CODES.INSTALLATION_MARKED_OTHERWISE, {
            marked: standing.identifier,
        }),
    );
}

function markMoved(): Error {
    return new ConflictException(codedError(INSTALLATION_ERROR_CODES.INSTALLATION_MARK_MOVED));
}
