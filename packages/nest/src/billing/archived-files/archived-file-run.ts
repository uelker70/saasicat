// The way a file the platform owes somebody is made and sent, whatever it is
// the file of — an invoice's document (`SC-AUD-019`) or a contract's
// confirmation (`SC-AUD-016`).
//
// A run renders the file, has it checked where its subject's rules ask for
// that, records the file's checksum, archives the file and records the
// archive's confirmation. Until then the subject waits for its file — neither
// sent nor offered — and the next run tries again. A file the archive already
// holds is the one that was made, and the record follows it; where it holds
// none, nothing has been handed out, so a rendering that differs from the
// recorded one — a renderer updated in between — takes its place, with both
// checksums in the audit log. An archived file is then mailed — claimed first,
// so of several instances one sends it — and handed out again only after it
// is checked against the recorded checksum.
//
// What cannot go on yet is held rather than guessed at: a file refused, a
// subscriber without an invoice email, an archived file that no longer matches
// its checksum. Each is logged on every run and written to the audit log once
// per process.

import { createHash } from 'node:crypto';
import type { Logger } from '@nestjs/common';
import {
    isPersistenceRefusal,
    type InvoiceDocument,
    type NewInvoiceRendering,
} from '@saasicat/core';

import { type AdminAuditService, platformJobActor } from '../../admin/admin-audit.service.js';
import { TimeoutError, withTimeout } from '../../core/with-timeout.js';
import { AuditedOnce } from '../invoices/audited-once.js';

/** How many subjects one page of a run reads. */
const PAGE_SIZE = 100;

/**
 * How long the application may take to render one file, or to send one, before
 * the attempt counts as failed. Both are the application's code, and a run
 * waiting on either for good would make no file after it.
 */
export const ARCHIVED_FILE_TIMEOUT_MS = 60_000;

/**
 * How long a run's claim on a file's mail holds. Longer than an attempt may
 * take, so a second instance does not send the file while the first still
 * waits for the application to answer.
 */
export const ARCHIVED_FILE_DELIVERY_LEASE_MS = 15 * 60_000;

/** What is recorded of a file before it is archived. */
export type FileRendering = NewInvoiceRendering;

/** Where a subject's file stands, as far as a run reads it. */
export interface FileState {
    checksum: string;
    archivedAt: Date | null;
}

/** A file as the archive keeps it. */
export interface KeptFile extends InvoiceDocument {
    /** SHA-256 of `content`, lower-case hex. */
    checksum: string;
    archivedAt: Date;
}

/**
 * Where each subject's file stands, keyed by the subject's id: the guarded
 * writes the ports of an invoice's document and of a contract's confirmation
 * both make.
 */
export interface FileMarks {
    find(id: string): Promise<FileState | null>;
    recordRendering(id: string, rendering: FileRendering): Promise<unknown>;
    /** `null` where the recorded checksum is another by now, or the file is archived. */
    replaceRendering(id: string, rendering: FileRendering, replaced: string): Promise<unknown>;
    markArchived(id: string, at: Date, checksum: string): Promise<boolean>;
    claimDelivery(id: string, at: Date, staleBefore: Date): Promise<boolean>;
    markDelivered(
        id: string,
        delivery: { claimedAt: Date; at: Date; to: string },
    ): Promise<boolean>;
    releaseDelivery(id: string, claimedAt: Date): Promise<void>;
    listAwaitingArchive(page: { limit: number; after?: string }): Promise<string[]>;
    listAwaitingDelivery(page: { limit: number; after?: string }): Promise<string[]>;
}

/** The archive of the files, keyed by the subject's id. */
export interface FileArchive {
    store(id: string, file: KeptFile): Promise<void>;
    read(id: string): Promise<KeptFile | null>;
}

/** The values a hold names, which the administration words in the operator's language. */
export type HoldParams = Readonly<Record<string, string | readonly string[]>>;

/**
 * What holds a file or its mail back: the coded refusal where there is one,
 * which the administration words in the operator's language.
 */
export interface FileHold {
    code?: string;
    params: HoldParams;
}

/** Thrown inside one subject's step to hold it; never leaves a run. */
export class Held extends Error {
    constructor(readonly hold: FileHold) {
        super(hold.code);
    }
}

/**
 * What every audit entry about a subject names beside the hold. A type rather
 * than an interface, so it is the record of changes the audit log takes.
 */
export type AuditedSubject = {
    tenantId: string;
    subscriberId: string;
    /** The invoice number, where the subject has one. */
    number?: string;
};

/** The audit actions a kind of file writes, one for each thing that befalls it. */
export interface FileActions {
    /** The file is held back before it is archived. */
    held: string;
    /** A rendering took the place of the one recorded. */
    rerendered: string;
    /** The archived file no longer matches its checksum. */
    mismatch: string;
    /** The mail is held back, such as for a subscriber without an invoice email. */
    deliveryHeld: string;
    /** The mail did not take the file. */
    deliveryFailed: string;
}

/** What one kind of file is: its subject, its ports, and how its runs speak of it. */
export interface ArchivedFileKind<S> {
    /** The job the audit entries are written under: `job:platform:<job>`. */
    job: string;
    /** The audit entity of a subject, `SubscriptionInvoice` or `SubscriptionContract`. */
    entity: string;
    logger: Logger;
    /** The file in a sentence about an id alone: `the document of invoice <id>`. */
    fileOfId(id: string): string;
    /** The subject in a sentence: `invoice AHP-2026-000001`, `the confirmation of contract c-1`. */
    nameOf(subject: S): string;
    idOf(subject: S): string;
    auditOf(subject: S): AuditedSubject;
    load(id: string): Promise<S | null>;
    render(subject: S): Promise<InvoiceDocument>;
    /** Throws a `Held` where the subject's rules refuse the file. */
    check(subject: S, file: InvoiceDocument): Promise<void>;
    /** Where its mail goes; `null` where nowhere is known. */
    recipient(subject: S): Promise<string | null>;
    send(subject: S, to: string, file: InvoiceDocument): Promise<void>;
    marks: FileMarks;
    archive: FileArchive;
    /** The refusal codes: a file other than the recorded one, one that does not match, no address. */
    codes: { changed: string; mismatch: string; noAddress: string };
    actions: FileActions;
    /** What a hold of the file itself names, such as `{ invoiceId }`. */
    fileParams(subject: S): HoldParams;
    /** What a hold of the mail for want of an address names. */
    addressParams(subject: S): HoldParams;
    audit: AdminAuditService | null;
}

/** What an archiving run did. */
export interface ArchivingRun {
    archived: number;
    /** Subjects whose file is held back; each is tried again by the next run. */
    held: number;
    /** Subjects whose file failed for another reason; each is tried again by the next run. */
    failed: number;
}

/** What a mailing run did. */
export interface MailingRun {
    delivered: number;
    /** Subjects whose file cannot be mailed yet, such as to a subscriber without an invoice email. */
    held: number;
    /** Subjects whose file the mail port did not take; each is tried again by the next run. */
    failed: number;
}

/** What a download finds: the archived file, or why there is none to hand out. */
export type HandedOut<S> =
    | { kind: 'unknown' }
    | { kind: 'waiting'; subject: S }
    | { kind: 'mismatch'; subject: S }
    | { kind: 'file'; subject: S; file: InvoiceDocument };

/** SHA-256 of a file, lower-case hex, as its record keeps it. */
export function fileChecksum(content: Uint8Array): string {
    return createHash('sha256').update(content).digest('hex');
}

function renderingOf(file: InvoiceDocument, renderedAt: Date): FileRendering {
    return {
        checksum: fileChecksum(file.content),
        mediaType: file.mediaType,
        fileName: file.fileName,
        size: file.content.byteLength,
        renderedAt,
    };
}

/** `text` with its first letter in upper case, to start a sentence with a name. */
function sentence(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

export class ArchivedFileRun<S> {
    private readonly audited = new AuditedOnce();
    private readonly timeoutMs = ARCHIVED_FILE_TIMEOUT_MS;

    constructor(private readonly kind: ArchivedFileKind<S>) {}

    /** Renders, checks and archives the file of every subject still waiting for one. */
    async archiveDue(now: Date): Promise<ArchivingRun> {
        const run: ArchivingRun = { archived: 0, held: 0, failed: 0 };
        await this.eachPage(
            (page) => this.kind.marks.listAwaitingArchive(page),
            async (id) => {
                const outcome = await this.archiveOne(id, now).catch((error: unknown) =>
                    this.failed(id, error),
                );
                run[outcome] += 1;
            },
        );
        return run;
    }

    /**
     * Mails every archived file not yet handed to the mail and held by no
     * other run. Each is claimed at the moment it is taken on, by the clock,
     * since the claim is read against those of other instances.
     */
    async deliverDue(): Promise<MailingRun> {
        const run: MailingRun = { delivered: 0, held: 0, failed: 0 };
        await this.eachPage(
            (page) => this.kind.marks.listAwaitingDelivery(page),
            async (id) => {
                const outcome = await this.deliverOne(id).catch((error: unknown) =>
                    this.failed(id, error),
                );
                if (outcome) run[outcome] += 1;
            },
        );
        return run;
    }

    /**
     * The archived file of `id` after checking it against the checksum
     * recorded when it was rendered — or why there is none: no such subject,
     * one that waits for its file, or a file that does not match, which is
     * written to the audit log for the operator.
     */
    async handOut(id: string): Promise<HandedOut<S>> {
        const subject = await this.kind.load(id);
        if (!subject) return { kind: 'unknown' };
        const state = await this.kind.marks.find(id);
        if (!state?.archivedAt) return { kind: 'waiting', subject };
        const file = await this.matching(id, state.checksum);
        if (!file) {
            await this.recordHold(subject, this.kind.actions.mismatch, {
                code: this.kind.codes.mismatch,
                params: this.kind.fileParams(subject),
            });
            return { kind: 'mismatch', subject };
        }
        return { kind: 'file', subject, file };
    }

    /** Runs `write`, turning the refusal of a file other than the recorded one into a hold. */
    async refusalHeld<T>(write: () => Promise<T>): Promise<T> {
        try {
            return await write();
        } catch (error) {
            if (isPersistenceRefusal(error) && error.code === this.kind.codes.changed) {
                const params = Object.fromEntries(
                    Object.entries(error.params ?? {}).map(([key, value]) => [key, String(value)]),
                );
                throw new Held({ code: error.code, params });
            }
            throw error;
        }
    }

    private async archiveOne(id: string, now: Date): Promise<keyof ArchivingRun> {
        const subject = await this.kind.load(id);
        if (!subject) return this.failed(id, new Error(`${this.kind.fileOfId(id)} has no subject`));
        try {
            const recorded = await this.kind.marks.find(id);
            const kept = await this.kind.archive.read(id);
            if (kept) return await this.confirmKept(subject, recorded, kept, now);
            const file = await withTimeout(() => this.kind.render(subject), this.timeoutMs);
            await this.kind.check(subject, file);
            const rendering = renderingOf(file, now);
            if (!recorded) {
                await this.refusalHeld(() => this.kind.marks.recordRendering(id, rendering));
            } else if (recorded.checksum !== rendering.checksum) {
                await this.replaceRendering(subject, rendering, recorded.checksum);
            }
            await this.refusalHeld(() =>
                this.kind.archive.store(id, {
                    ...file,
                    checksum: rendering.checksum,
                    archivedAt: now,
                }),
            );
            return await this.confirmArchived(subject, now, rendering.checksum);
        } catch (error) {
            if (!(error instanceof Held)) return this.failed(id, error);
            await this.recordHold(subject, this.kind.actions.held, error.hold);
            return 'held';
        }
    }

    /**
     * Confirms the file the archive already holds — an attempt interrupted
     * after the archive took it, or one another run made — as the one that was
     * made. The archive keeps what it was given, so the record follows it
     * rather than the renderer, which may have changed since. A file that does
     * not match its own checksum is held for the operator; one the record
     * names otherwise is checked first, since it was not the rendering this
     * run saw pass.
     */
    private async confirmKept(
        subject: S,
        recorded: FileState | null,
        kept: KeptFile,
        now: Date,
    ): Promise<keyof ArchivingRun> {
        if (fileChecksum(kept.content) !== kept.checksum) {
            throw new Held({
                code: this.kind.codes.mismatch,
                params: this.kind.fileParams(subject),
            });
        }
        if (recorded?.checksum !== kept.checksum) {
            await this.kind.check(subject, kept);
            const rendering = renderingOf(kept, kept.archivedAt);
            const id = this.kind.idOf(subject);
            if (!recorded) {
                await this.refusalHeld(() => this.kind.marks.recordRendering(id, rendering));
            } else {
                await this.replaceRendering(subject, rendering, recorded.checksum);
            }
        }
        return this.confirmArchived(subject, now, kept.checksum);
    }

    /**
     * Records the archive's confirmation of the file `checksum` names. A run
     * counts a file as archived only where this write is its own: where
     * another run confirmed it first, or changed the record in between, this
     * one says so and leaves the next run to find where it stands.
     */
    private async confirmArchived(
        subject: S,
        now: Date,
        checksum: string,
    ): Promise<keyof ArchivingRun> {
        if (await this.kind.marks.markArchived(this.kind.idOf(subject), now, checksum)) {
            return 'archived';
        }
        this.kind.logger.warn(
            `${sentence(this.kind.nameOf(subject))} was not confirmed as archived by this run: ` +
                'another run confirmed it or changed its record meanwhile. The next run finds ' +
                'where it stands.',
        );
        return 'failed';
    }

    /**
     * Records `rendering` in place of the one recorded with `replaced`, while
     * nothing is archived. The audit entry naming both is written first: a
     * replacement nobody could read of afterwards is the one thing this must
     * not make, so where the entry cannot be written the run fails and the next
     * one tries again. Another run that replaced the rendering in between
     * leaves this one to try again too.
     */
    private async replaceRendering(
        subject: S,
        rendering: FileRendering,
        replaced: string,
    ): Promise<void> {
        await this.kind.audit?.log({
            actor: platformJobActor(this.kind.job),
            entity: this.kind.entity,
            entityId: this.kind.idOf(subject),
            action: this.kind.actions.rerendered,
            changes: {
                ...this.kind.auditOf(subject),
                params: { recorded: replaced, rendered: rendering.checksum },
            },
        });
        const id = this.kind.idOf(subject);
        if (!(await this.kind.marks.replaceRendering(id, rendering, replaced))) {
            throw new Error(
                `The rendering recorded for ${this.kind.nameOf(subject)} changed while it was ` +
                    'replaced.',
            );
        }
    }

    /** What mailing one file came to; `null` where another run holds it. */
    private async deliverOne(id: string): Promise<keyof MailingRun | null> {
        const subject = await this.kind.load(id);
        const state = subject && (await this.kind.marks.find(id));
        if (!subject || !state) {
            return this.failed(id, new Error(`${this.kind.fileOfId(id)} was not found`));
        }
        const to = await this.kind.recipient(subject);
        if (!to) {
            await this.recordHold(subject, this.kind.actions.deliveryHeld, {
                code: this.kind.codes.noAddress,
                params: this.kind.addressParams(subject),
            });
            return 'held';
        }
        const file = await this.matching(id, state.checksum);
        if (!file) {
            await this.recordHold(subject, this.kind.actions.mismatch, {
                code: this.kind.codes.mismatch,
                params: this.kind.fileParams(subject),
            });
            return 'held';
        }
        // Stamped with the moment it is taken, not with the start of the run: a
        // run that takes longer than the lease would otherwise take claims that
        // every other instance already reads as abandoned.
        const claimedAt = new Date();
        const staleBefore = new Date(claimedAt.getTime() - ARCHIVED_FILE_DELIVERY_LEASE_MS);
        if (!(await this.kind.marks.claimDelivery(id, claimedAt, staleBefore))) return null;

        // A port that throws before it returns a promise fails like one that
        // rejects, rather than escaping the run with its claim still held.
        const sending = new Promise<void>((resolve) => resolve(this.kind.send(subject, to, file)));
        try {
            await withTimeout(() => sending, this.timeoutMs);
        } catch (error) {
            if (error instanceof TimeoutError) {
                this.settleLate(sending, subject, claimedAt, to);
            } else {
                await this.deliveryFailed(subject, claimedAt, to, error);
            }
            return 'failed';
        }
        await this.recordDelivered(subject, claimedAt, to);
        return 'delivered';
    }

    /**
     * A mail that has not answered in time may still go out, so its claim is
     * not let go: no other run sends the file while the answer is awaited. A
     * late success is recorded, a late failure lets the claim go for the next
     * run. An answer later than the lease comes after another run may have
     * sent the file again.
     */
    private settleLate(sending: Promise<void>, subject: S, claimedAt: Date, to: string): void {
        this.kind.logger.warn(
            `The mail did not answer within ${this.timeoutMs} ms for ` +
                `${this.kind.nameOf(subject)}; it stays held while the answer is awaited.`,
        );
        void sending.then(
            () => this.recordDelivered(subject, claimedAt, to),
            (error: unknown) => this.deliveryFailed(subject, claimedAt, to, error),
        );
    }

    /**
     * Shows the operator a mail that was not sent, and lets the claim go for
     * the next run. The address stays on the subscriber's record, and is taken
     * out of the reason the mail gave — in the audit entry and in the log
     * alike — which a mail server often words with the recipient in it. A
     * claim that cannot be let go is not lost — it goes stale and is taken on
     * then — so that failure is logged, not thrown.
     */
    private async deliveryFailed(
        subject: S,
        claimedAt: Date,
        to: string,
        error: unknown,
    ): Promise<void> {
        const name = this.kind.nameOf(subject);
        this.kind.logger.error(
            `${sentence(name)} was not mailed; the next run tries again.`,
            withoutAddress(
                error instanceof Error ? (error.stack ?? error.message) : String(error),
                to,
            ),
        );
        await this.recordHold(subject, this.kind.actions.deliveryFailed, {
            params: { reason: withoutAddress(errorMessageOf(error), to) },
        });
        try {
            await this.kind.marks.releaseDelivery(this.kind.idOf(subject), claimedAt);
        } catch (releaseError) {
            this.kind.logger.error(
                `The mail of ${name} could not be let go; it is tried again once its claim ` +
                    'goes stale.',
                releaseError instanceof Error ? releaseError.stack : String(releaseError),
            );
        }
    }

    /**
     * Records a file the mail has taken. It went out whatever happens here, so
     * a failure to record it is not let go for another attempt: it is logged,
     * and the run goes on to the next subject.
     */
    private async recordDelivered(subject: S, claimedAt: Date, to: string): Promise<void> {
        const name = sentence(this.kind.nameOf(subject));
        try {
            const recorded = await this.kind.marks.markDelivered(this.kind.idOf(subject), {
                claimedAt,
                at: new Date(),
                to,
            });
            if (!recorded) {
                this.kind.logger.warn(
                    `${name} was mailed, but its claim had gone stale and another run took it ` +
                        'on; the subscriber may receive it twice.',
                );
            }
        } catch (error) {
            this.kind.logger.error(
                `${name} was mailed, but recording it failed; once its claim goes stale the ` +
                    'subscriber may receive it again.',
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    /**
     * The archived file of `id` where it matches `checksum`; `null` where it
     * is missing or does not.
     */
    private async matching(id: string, checksum: string): Promise<InvoiceDocument | null> {
        const archived = await this.kind.archive.read(id);
        if (!archived) return null;
        if (archived.checksum !== checksum) return null;
        if (fileChecksum(archived.content) !== checksum) return null;
        return {
            content: archived.content,
            mediaType: archived.mediaType,
            fileName: archived.fileName,
        };
    }

    private async eachPage(
        list: (page: { limit: number; after?: string }) => Promise<string[]>,
        each: (id: string) => Promise<void>,
    ): Promise<void> {
        let after: string | undefined;
        for (;;) {
            const page = await list({ limit: PAGE_SIZE, after });
            for (const id of page) await each(id);
            if (page.length < PAGE_SIZE) return;
            after = page.at(-1);
        }
    }

    private failed(id: string, error: unknown): 'failed' {
        this.kind.logger.error(
            `${sentence(this.kind.fileOfId(id))} could not be handled; the next run tries again.`,
            error instanceof Error ? error.stack : String(error),
        );
        return 'failed';
    }

    /** Logs a hold on every run, and writes it to the audit log once per process. */
    async recordHold(subject: S, action: string, hold: FileHold): Promise<void> {
        const name = sentence(this.kind.nameOf(subject));
        this.kind.logger.warn(
            `${name}: ${action} ${hold.code ?? ''} ${JSON.stringify(hold.params)}. ` +
                'The next run tries again.',
        );
        const id = this.kind.idOf(subject);
        await this.audited.record(`${id}|${action}|${hold.code ?? ''}`, async () => {
            const changes: AuditedSubject & { code?: string; params: HoldParams } = {
                ...this.kind.auditOf(subject),
                params: hold.params,
            };
            if (hold.code) changes.code = hold.code;
            try {
                await this.kind.audit?.log({
                    actor: platformJobActor(this.kind.job),
                    entity: this.kind.entity,
                    entityId: id,
                    action,
                    changes,
                });
                return true;
            } catch (error) {
                // The hold stands either way; the lost record of it is said loudly.
                this.kind.logger.error(
                    `Writing the audit entry ${action} for ${this.kind.nameOf(subject)} failed.`,
                    error instanceof Error ? error.stack : String(error),
                );
                return false;
            }
        });
    }
}

function errorMessageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * `message` with every occurrence of `address` in it, whatever its case,
 * replaced. Each window of the message is compared on its own rather than the
 * whole message lower-cased at once: a letter such as `İ` lower-cases into two
 * code units, and the positions found in the lower-cased copy would no longer
 * be the message's.
 */
function withoutAddress(message: string, address: string): string {
    const sought = address.toLowerCase();
    if (sought === '') return message;
    let kept = '';
    let from = 0;
    let at = 0;
    while (at + address.length <= message.length) {
        if (message.slice(at, at + address.length).toLowerCase() !== sought) {
            at += 1;
            continue;
        }
        kept += `${message.slice(from, at)}[invoice email]`;
        at += address.length;
        from = at;
    }
    return kept + message.slice(from);
}
