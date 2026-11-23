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
// The mark also says how the installation operates: as a test, whose documents
// are all marked as tests, or live. It belongs to the data, so a replacement
// keeps it unless the operator names another, and a database nobody marked is
// live. Once the installation has issued a document, the mark says the
// operation its documents recorded and no other (`SC-AUD-023`); where the
// documents cannot be read, nothing shows that none exists, and the operation
// is not changed. The documents are read before the mark is written: a first
// document issued between the two is not seen here, and the next start that
// issues invoices refuses the mark that disagrees with it.
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
    type ContractConfirmationRepository,
    INSTALLATION_ERROR_CODES,
    type InstallationMark,
    type InstallationMarkPort,
    type InstallationMarkVerdict,
    type InstallationOperation,
    type InstallationStatus,
    type RlsBypassPort,
    type SubscriptionInvoiceRepository,
    installationMarkVerdict,
    installationOperationOf,
    installationStatus,
} from '@saasicat/core';

import { AdminAuditService } from '../../admin/admin-audit.service.js';
import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { actorTagOf } from '../../core/web-audit.js';
import { codedError } from '../../errors/coded-error.js';
import { CONTRACT_CONFIRMATION_REPOSITORY_TOKEN } from '../confirmations/contract-confirmation.tokens.js';
import { SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN } from '../invoices/subscription-invoice.tokens.js';
import {
    INSTALLATION_IDENTIFIER_TOKEN,
    INSTALLATION_MARK_PORT_TOKEN,
} from '../tenant-billing.tokens.js';
import { issuedOperationsIn, operationOtherThan } from './issued-document-operations.js';

/** What marking the database came to. */
export type InstallationMarkOutcome =
    /** The database was unmarked, and carries this mark now. */
    | { readonly kind: 'marked'; readonly mark: InstallationMark }
    /** The database carried this environment's mark already; nothing was written. */
    | { readonly kind: 'already-marked'; readonly mark: InstallationMark }
    /** Another installation's mark was replaced with this one. */
    | { readonly kind: 'replaced'; readonly mark: InstallationMark }
    /** This environment's mark stood, and now says another operation than `from`. */
    | {
          readonly kind: 'operation-changed';
          readonly mark: InstallationMark;
          readonly from: InstallationOperation;
      };

/** What a mark is written with beside its identifier. */
export interface InstallationMarkWriteOptions {
    /**
     * How the installation operates. Left out, a new mark is live and a mark
     * that stands keeps its operation.
     */
    readonly operation?: InstallationOperation;
}

/** What the audit log names a mark under. */
const AUDITED_ENTITY = 'InstallationMark';

/**
 * What an audit entry of a mark records: the identifier marked and its
 * operation, or the identifier or the operation replaced and its successor.
 */
type AuditedMarkChange =
    { identifier: string; operation: InstallationOperation } | { from: string; to: string };

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
        // The documents the installation issued, which fix its operation:
        // bound where invoices are issued, or from the stores
        // `subscriptionEnds.deletion.documents` names.
        @Optional()
        @Inject(SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN)
        private readonly invoices: Pick<
            SubscriptionInvoiceRepository,
            'issuedOperations'
        > | null = null,
        @Optional()
        @Inject(CONTRACT_CONFIRMATION_REPOSITORY_TOKEN)
        private readonly confirmations: Pick<
            ContractConfirmationRepository,
            'recordedOperations'
        > | null = null,
        // The documents are the installation's, not a tenant's.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {}

    /** Whether the database belongs to the environment this process runs in. */
    async verdict(): Promise<InstallationMarkVerdict> {
        return installationMarkVerdict(this.environment, await this.marks.find());
    }

    /** The verdict, and how the installation operates: live where nobody marked it. */
    async status(): Promise<InstallationStatus> {
        return installationStatus(this.environment, await this.marks.find());
    }

    /**
     * Marks the database as this environment's installation where nothing
     * marks it, and changes the operation of this environment's mark where
     * `options` names another. Refused where `identifier` is not this
     * environment's, and where another installation's mark stands.
     */
    async mark(
        identifier: string,
        actor: AdminActor,
        options: InstallationMarkWriteOptions = {},
    ): Promise<InstallationMarkOutcome> {
        this.refuseAnotherEnvironments(identifier);
        return this.oneAtATime(async () => {
            const standing = await this.marks.find();
            if (standing === null) {
                return this.markUnmarked(identifier, actor, options, markedOtherwise);
            }
            if (standing.identifier !== identifier) throw markedOtherwise(standing);
            return this.keepOrChangeOperation(standing, actor, options);
        });
    }

    /**
     * Replaces another installation's mark with this environment's, as after
     * restoring a backup into another environment; marks where nothing does.
     * The operation that stands is kept unless `options` names another.
     * Refused where `identifier` is not this environment's, and where the mark
     * changes between reading and replacing it.
     */
    async replace(
        identifier: string,
        actor: AdminActor,
        options: InstallationMarkWriteOptions = {},
    ): Promise<InstallationMarkOutcome> {
        this.refuseAnotherEnvironments(identifier);
        return this.oneAtATime(async () => {
            const standing = await this.marks.find();
            if (standing === null) return this.markUnmarked(identifier, actor, options, markMoved);
            if (standing.identifier === identifier) {
                return this.keepOrChangeOperation(standing, actor, options);
            }
            const from = installationOperationOf(standing);
            const to = options.operation ?? from;
            await this.refuseAnotherOperationThanIssued(from, to);
            const replaced = await this.marks.replace(standing, this.markOf(identifier, actor, to));
            if (replaced === null) throw markMoved();
            await this.record(actor, 'INSTALLATION_MARK_REPLACED', identifier, {
                from: standing.identifier,
                to: identifier,
            });
            if (to !== from) {
                await this.record(actor, 'INSTALLATION_OPERATION_CHANGED', identifier, {
                    from,
                    to,
                });
            }
            return { kind: 'replaced', mark: replaced };
        });
    }

    /**
     * This environment's mark stands: nothing is written where `options`
     * names no operation or the one that stands, otherwise the operation is
     * changed — guarded on the mark as read, so a change somebody made a
     * moment earlier is refused rather than overwritten.
     */
    private async keepOrChangeOperation(
        standing: InstallationMark,
        actor: AdminActor,
        options: InstallationMarkWriteOptions,
    ): Promise<InstallationMarkOutcome> {
        const from = installationOperationOf(standing);
        const to = options.operation ?? from;
        if (to === from) return { kind: 'already-marked', mark: standing };
        await this.refuseAnotherOperationThanIssued(from, to);
        const changed = await this.marks.replace(
            standing,
            this.markOf(standing.identifier, actor, to),
        );
        if (changed === null) throw markMoved();
        await this.record(actor, 'INSTALLATION_OPERATION_CHANGED', standing.identifier, {
            from,
            to,
        });
        return { kind: 'operation-changed', mark: changed, from };
    }

    /**
     * Writes the mark where none stood when it was read. What stands after the
     * write is the mark written only where it is the same in every field;
     * otherwise somebody else marked first, with this identifier or another.
     */
    private async markUnmarked(
        identifier: string,
        actor: AdminActor,
        options: InstallationMarkWriteOptions,
        refusal: (standing: InstallationMark) => Error,
    ): Promise<InstallationMarkOutcome> {
        const operation = options.operation ?? 'live';
        // A database nobody marked is live.
        await this.refuseAnotherOperationThanIssued('live', operation);
        const written = this.markOf(identifier, actor, operation);
        const standing = await this.marks.markIfUnmarked(written);
        if (standing.identifier !== identifier) throw refusal(standing);
        if (!sameMark(standing, written)) return { kind: 'already-marked', mark: standing };
        await this.record(actor, 'INSTALLATION_MARKED', identifier, { identifier, operation });
        return { kind: 'marked', mark: standing };
    }

    /**
     * Refuses a mark saying `to` where the installation has issued a document
     * in the other operation, and a change from `standing` where the documents
     * cannot be read. A mark that keeps the operation standing is written all
     * the same then: a database marked as before is no more than it was.
     */
    private async refuseAnotherOperationThanIssued(
        standing: InstallationOperation,
        to: InstallationOperation,
    ): Promise<void> {
        if (!this.invoices || !this.confirmations) {
            if (to === standing) return;
            throw new ConflictException(
                codedError(INSTALLATION_ERROR_CODES.INSTALLATION_DOCUMENTS_NOT_READABLE, {
                    standing,
                    requested: to,
                }),
            );
        }
        const issued = await issuedOperationsIn(
            { invoices: this.invoices, confirmations: this.confirmations },
            this.rlsBypass,
        );
        const other = operationOtherThan(to);
        if (!issued[other]) return;
        throw new ConflictException(
            codedError(INSTALLATION_ERROR_CODES.INSTALLATION_OPERATION_FIXED, {
                issued: other,
                requested: to,
            }),
        );
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

    private markOf(
        identifier: string,
        actor: AdminActor,
        operation: InstallationOperation,
    ): InstallationMark {
        return {
            identifier,
            testOperation: operation === 'test',
            markedAt: new Date(),
            markedBy: actorTagOf(actor),
        };
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
        a.testOperation === b.testOperation &&
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
