// Maintenance windows: announcing one, locking the application for it, and
// letting tenants back in.
//
// Everything that decides lives here; the port only makes each write
// conditional on what was read, and the controllers, the guard and the command
// line only translate. Two readers ask this service a different question:
//
//   - every request, through the guard: is the lock on? Asked per request, so
//     the answer is kept for `MAINTENANCE_STATE_MAX_AGE_SECONDS` rather than
//     read from the database each time.
//   - the operator, through the administration or the command line: what is
//     open, and what came before? Read fresh, because an operator who just
//     locked has to see the lock.
//
// The lock begins and ends only when somebody says so. The announced times are
// what tenants are told; they never start or end the lock (`SC-OPS-014`).

import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import {
    type AdminActor,
    MAINTENANCE_ERROR_CODES,
    MAINTENANCE_MESSAGE_MAX_LENGTH,
    MAINTENANCE_STATE_MAX_AGE_SECONDS,
    type MaintenanceNotificationPort,
    type MaintenanceOverview,
    type MaintenanceStatusView,
    type MaintenanceWindowChanges,
    type MaintenanceWindowEvent,
    type MaintenanceWindowPort,
    type MaintenanceWindowRecord,
    type MaintenanceWindowStage,
    maintenanceStatusOf,
    maintenanceWindowStatusOf,
    maintenanceWindowViewOf,
} from '@saasicat/core';

import { AdminAuditService } from '../admin/admin-audit.service.js';
import { actorTagOf } from '../core/web-audit.js';
import { withTimeout } from '../core/with-timeout.js';
import { codedError } from '../errors/coded-error.js';
import {
    MAINTENANCE_NOTIFICATION_PORT_TOKEN,
    MAINTENANCE_WINDOW_PORT_TOKEN,
} from './maintenance.tokens.js';

/** How many windows the administration is shown. */
const RECENT_WINDOWS = 20;

/**
 * How often an operator's action reads the window again after a write found it
 * moved on. The only race worth a second look is a lock landing between the
 * read and the write; a third attempt would be two operators taking turns.
 */
const ATTEMPTS = 2;

/** How long the application's notification may take before it is logged as failed. */
const NOTIFICATION_TIMEOUT_MS = 30_000;

const MAX_AGE_MS = MAINTENANCE_STATE_MAX_AGE_SECONDS * 1000;

/** A question this process put to the database: its place in line, and when. */
interface Question {
    order: number;
    at: number;
}

/** What an operator announces. */
export interface MaintenanceAnnouncement {
    startsAt: Date;
    endsAt: Date;
    message?: string | null;
}

/** What an operator moves on an open window; what is left out stays. */
export interface MaintenanceWindowRevision {
    startsAt?: Date;
    endsAt?: Date;
    /** `null` takes the message away. */
    message?: string | null;
}

/** What an operator locks with. */
export interface MaintenanceLockRequest {
    /**
     * The window the operator means. Left out, the lock takes the open window
     * — or opens one, locked at once, where none is open.
     */
    windowId?: string;
    /** The expected end, where the lock should state one. */
    endsAt?: Date;
    message?: string | null;
}

export interface MaintenanceLockOutcome {
    window: MaintenanceWindowRecord;
    /** The lock already held; nothing was changed (`SC-OPS-007`). */
    alreadyLocked: boolean;
}

export interface MaintenanceUnlockOutcome {
    /** The window the unlock ended, or the open one it left alone. */
    window: MaintenanceWindowRecord | null;
    /** Whether a lock held and was ended by this call. */
    wasLocked: boolean;
}

@Injectable()
export class MaintenanceService {
    private readonly logger = new Logger('SaaSiCat.Maintenance');
    /**
     * The open window as this process last learned it, dated from when it asked
     * rather than from when the answer arrived. The database may have answered
     * from any moment in between, and a later date would keep a lock unseen for
     * longer than `MAINTENANCE_STATE_MAX_AGE_SECONDS` — past the moment
     * `maintenance on` returns and the migration starts.
     */
    private known: { window: MaintenanceWindowRecord | null; asked: Question } | null = null;
    /** How many questions this process has asked, so that answers are kept in the order asked. */
    private questions = 0;
    /** One read at a time: a burst of requests after the answer aged asks once. */
    private reading: Promise<MaintenanceWindowRecord | null> | null = null;
    /** Whether the last read failed, so a failing database is logged once, not per request. */
    private readFailing = false;

    constructor(
        @Inject(MAINTENANCE_WINDOW_PORT_TOKEN) private readonly windows: MaintenanceWindowPort,
        @Optional()
        @Inject(MAINTENANCE_NOTIFICATION_PORT_TOKEN)
        private readonly notifications: MaintenanceNotificationPort | null = null,
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
    ) {}

    // -----------------------------------------------------------------
    // Asked on every request
    // -----------------------------------------------------------------

    /**
     * The open window as this process knows it — at most
     * `MAINTENANCE_STATE_MAX_AGE_SECONDS` old when it says nothing is locked.
     * An answer that arrives older than that is asked again rather than acted
     * on, so a database that cannot answer in time keeps a request waiting
     * instead of admitting it on a reply that may predate a lock. A lock is
     * acted on however old: it errs on the side of the migration.
     *
     * A read that fails leaves the last answer standing: a lock known to hold
     * is not dropped because the database missed one question, and a process
     * that never read one lets requests through, whose own queries then meet
     * the same database.
     */
    async openWindow(): Promise<MaintenanceWindowRecord | null> {
        if (this.known && Date.now() - this.known.asked.at < MAX_AGE_MS) return this.known.window;
        this.reading ??= this.readOpen().finally(() => {
            this.reading = null;
        });
        return this.reading;
    }

    /**
     * Whether the application is locked for maintenance. What an application's
     * own scheduled job asks before it runs, and skips its run on `true`.
     */
    async isLocked(): Promise<boolean> {
        const open = await this.openWindow();
        return open !== null && maintenanceWindowStatusOf(open) === 'locked';
    }

    /** What a tenant's page is told. */
    async status(): Promise<MaintenanceStatusView> {
        return maintenanceStatusOf(await this.openWindow(), new Date());
    }

    // -----------------------------------------------------------------
    // Asked by the operator
    // -----------------------------------------------------------------

    /** The open window and the ones before it, read fresh. */
    async overview(): Promise<MaintenanceOverview> {
        const [open, recent] = await Promise.all([
            this.findOpenAndRemember(),
            this.windows.listRecent(RECENT_WINDOWS),
        ]);
        const now = new Date();
        return {
            open: open ? maintenanceWindowViewOf(open, now) : null,
            recent: recent.map((window) => maintenanceWindowViewOf(window, now)),
            takesEffectWithinSeconds: MAINTENANCE_STATE_MAX_AGE_SECONDS,
        };
    }

    /** Announces a window. Refused while another one is open. */
    async announce(
        announcement: MaintenanceAnnouncement,
        actor: AdminActor,
    ): Promise<MaintenanceWindowRecord> {
        const now = new Date();
        assertTimes(announcement.startsAt, announcement.endsAt, now);
        const asked = this.ask();
        const opened = await this.windows.open({
            startsAt: announcement.startsAt,
            endsAt: announcement.endsAt,
            message: messageOf(announcement.message) ?? null,
            createdAt: now,
            createdBy: actorTagOf(actor),
            lockedAt: null,
            lockedBy: null,
        });
        if (!opened) {
            throw new ConflictException(
                codedError(MAINTENANCE_ERROR_CODES.MAINTENANCE_WINDOW_ALREADY_OPEN),
            );
        }
        this.remember(opened, asked);
        await this.record(actor, opened, 'MAINTENANCE_WINDOW_ANNOUNCE', {
            startsAt: opened.startsAt?.toISOString(),
            endsAt: opened.endsAt?.toISOString(),
            message: opened.message,
        });
        this.notify({ kind: 'announced', window: opened });
        return opened;
    }

    /**
     * Moves an open window, or changes its message. A locked window keeps its
     * start — the lock began when it began — and may still move its expected
     * end, which is what an operator does once a migration runs long.
     */
    async reschedule(
        id: string,
        revision: MaintenanceWindowRevision,
        actor: AdminActor,
    ): Promise<MaintenanceWindowRecord> {
        const message = messageOf(revision.message);
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            const open = await this.findOpenWith(id);
            const stage = stageOf(open);
            const changes: MaintenanceWindowChanges = {};
            const now = new Date();
            const movesStart =
                revision.startsAt !== undefined && !sameMoment(revision.startsAt, open.startsAt);
            const movesEnd =
                revision.endsAt !== undefined && !sameMoment(revision.endsAt, open.endsAt);
            if (stage === 'locked') {
                if (movesStart) {
                    throw new ConflictException(
                        codedError(MAINTENANCE_ERROR_CODES.MAINTENANCE_WINDOW_LOCKED),
                    );
                }
                if (movesEnd && revision.endsAt) {
                    assertEndAhead(revision.endsAt, now);
                    changes.endsAt = revision.endsAt;
                }
            } else if (movesStart || movesEnd) {
                const startsAt = revision.startsAt ?? open.startsAt ?? now;
                const endsAt = revision.endsAt ?? open.endsAt ?? now;
                assertTimes(startsAt, endsAt, now);
                if (movesStart) changes.startsAt = revision.startsAt;
                if (movesEnd) changes.endsAt = revision.endsAt;
            }
            if (message !== undefined && message !== open.message) changes.message = message;
            // A form saved as it was is not a move: the application would
            // otherwise tell every tenant that a window moved which did not.
            if (Object.keys(changes).length === 0) return open;

            const asked = this.ask();
            const moved = await this.windows.update(open.id, stage, changes);
            if (!moved) continue;
            this.remember(moved, asked);
            await this.record(actor, moved, 'MAINTENANCE_WINDOW_RESCHEDULE', {
                before: revisionOf(open),
                after: revisionOf(moved),
            });
            this.notify({ kind: 'rescheduled', window: moved, previous: open });
            return moved;
        }
        throw new NotFoundException(
            codedError(MAINTENANCE_ERROR_CODES.MAINTENANCE_WINDOW_NOT_OPEN),
        );
    }

    /** Calls off an announced window. A locked one is ended by unlocking it. */
    async cancel(id: string, actor: AdminActor): Promise<MaintenanceWindowRecord> {
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            const open = await this.findOpenWith(id);
            if (stageOf(open) === 'locked') {
                throw new ConflictException(
                    codedError(MAINTENANCE_ERROR_CODES.MAINTENANCE_WINDOW_LOCKED),
                );
            }
            const asked = this.ask();
            const cancelled = await this.windows.update(open.id, 'announced', {
                endedAt: new Date(),
                endedBy: actorTagOf(actor),
            });
            if (!cancelled) continue;
            this.remember(null, asked);
            await this.record(actor, cancelled, 'MAINTENANCE_WINDOW_CANCEL');
            this.notify({ kind: 'cancelled', window: cancelled });
            return cancelled;
        }
        throw new NotFoundException(
            codedError(MAINTENANCE_ERROR_CODES.MAINTENANCE_WINDOW_NOT_OPEN),
        );
    }

    /**
     * Locks the application: the open window, or a new one locked at once where
     * none is open. Locking what is already locked changes nothing and says so.
     */
    async lock(
        request: MaintenanceLockRequest,
        actor: AdminActor,
    ): Promise<MaintenanceLockOutcome> {
        const now = new Date();
        if (request.endsAt !== undefined) assertEndAhead(request.endsAt, now);
        const message = messageOf(request.message);
        const tag = actorTagOf(actor);
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            const open = await this.findOpenAndRemember();
            if (request.windowId !== undefined && open?.id !== request.windowId) {
                throw new NotFoundException(
                    codedError(MAINTENANCE_ERROR_CODES.MAINTENANCE_WINDOW_NOT_OPEN),
                );
            }
            if (open && stageOf(open) === 'locked') return { window: open, alreadyLocked: true };
            const asked = this.ask();
            const locked = open
                ? await this.windows.update(open.id, 'announced', {
                      lockedAt: now,
                      lockedBy: tag,
                      ...(request.endsAt === undefined ? {} : { endsAt: request.endsAt }),
                      ...(message === undefined ? {} : { message }),
                  })
                : await this.windows.open({
                      startsAt: null,
                      endsAt: request.endsAt ?? null,
                      message: message ?? null,
                      createdAt: now,
                      createdBy: tag,
                      lockedAt: now,
                      lockedBy: tag,
                  });
            if (!locked) continue;
            this.remember(locked, asked);
            await this.record(actor, locked, 'MAINTENANCE_LOCK', {
                endsAt: locked.endsAt?.toISOString() ?? null,
                announced: locked.startsAt !== null,
            });
            return { window: locked, alreadyLocked: false };
        }
        throw new ConflictException(
            codedError(MAINTENANCE_ERROR_CODES.MAINTENANCE_WINDOW_ALREADY_OPEN),
        );
    }

    /**
     * Lets tenants back in by ending the locked window. Where nothing is
     * locked it changes nothing and says so — an announced window is left as
     * it is, because unlocking is not cancelling.
     */
    async unlock(
        request: { windowId?: string },
        actor: AdminActor,
    ): Promise<MaintenanceUnlockOutcome> {
        const open = await this.findOpenAndRemember();
        if (request.windowId !== undefined && open?.id !== request.windowId) {
            throw new NotFoundException(
                codedError(MAINTENANCE_ERROR_CODES.MAINTENANCE_WINDOW_NOT_OPEN),
            );
        }
        if (!open || stageOf(open) !== 'locked') return { window: open, wasLocked: false };
        const asked = this.ask();
        // Bound to the lock this call read, and not retried against whatever is
        // open next: a write that finds it no longer locked means another unlock
        // ended it first, and the window open by now may be a lock a later deploy
        // took for its own migration.
        const ended = await this.windows.update(open.id, 'locked', {
            endedAt: new Date(),
            endedBy: actorTagOf(actor),
        });
        if (!ended) {
            await this.findOpenAndRemember();
            return { window: null, wasLocked: false };
        }
        this.remember(null, asked);
        await this.record(actor, ended, 'MAINTENANCE_UNLOCK', {
            lockedAt: ended.lockedAt?.toISOString() ?? null,
        });
        return { window: ended, wasLocked: true };
    }

    // -----------------------------------------------------------------

    private async readOpen(): Promise<MaintenanceWindowRecord | null> {
        try {
            let window = await this.findOpenAndRemember();
            while (this.heldTooLongToLetThrough()) window = await this.findOpenAndRemember();
            if (this.readFailing) {
                this.readFailing = false;
                this.logger.log('The maintenance lock can be read again.');
            }
            // A later question may have been answered while this one was on its
            // way — an operator's lock on this process, say. The requests waiting
            // on this read are decided on that answer, not on the older one.
            return this.known ? this.known.window : window;
        } catch (error) {
            if (!this.readFailing) {
                this.readFailing = true;
                this.logger.error(
                    'The maintenance lock could not be read; requests are decided on what was ' +
                        `known before (${this.known?.window ? 'a window is open' : 'nothing is open'}). ` +
                        'Is `maintenance_windows` in the database? It is created by ' +
                        '`@saasicat/spec/sql/1.0-maintenance-windows-are-kept.postgres.sql`.',
                    error instanceof Error ? error.stack : String(error),
                );
            }
            return this.known?.window ?? null;
        }
    }

    /**
     * Whether what this process holds says nothing is locked, and was asked for
     * too long ago to act on — the lock may have committed, and
     * `maintenance on` returned, while the answer was on its way.
     */
    private heldTooLongToLetThrough(): boolean {
        if (!this.known) return false;
        const { window, asked } = this.known;
        if (window !== null && maintenanceWindowStatusOf(window) === 'locked') return false;
        return Date.now() - asked.at >= MAX_AGE_MS;
    }

    /** The open window, read now and remembered as of the moment it was asked for. */
    private async findOpenAndRemember(): Promise<MaintenanceWindowRecord | null> {
        const asked = this.ask();
        const open = await this.windows.findOpen();
        this.remember(open, asked);
        return open;
    }

    /** Takes the next place in line, before a question goes to the database. */
    private ask(): Question {
        this.questions += 1;
        return { order: this.questions, at: Date.now() };
    }

    /**
     * What this process knows from now on — unless it already holds the answer
     * to a question asked later, which an earlier answer arriving late must not
     * undo.
     */
    private remember(window: MaintenanceWindowRecord | null, asked: Question): void {
        if (this.known && this.known.asked.order > asked.order) return;
        this.known = { window, asked };
    }

    /** The open window if it has `id`; refused otherwise. */
    private async findOpenWith(id: string): Promise<MaintenanceWindowRecord> {
        const open = await this.findOpenAndRemember();
        if (!open || open.id !== id) {
            throw new NotFoundException(
                codedError(MAINTENANCE_ERROR_CODES.MAINTENANCE_WINDOW_NOT_OPEN),
            );
        }
        return open;
    }

    /** Best effort: the action stands whether or not its record could be written (`SC-AUD-004`). */
    private async record(
        actor: AdminActor,
        window: MaintenanceWindowRecord,
        action: string,
        changes?: Record<string, unknown>,
    ): Promise<void> {
        if (!this.audit) return;
        try {
            await this.audit.log({
                actor,
                entity: 'MaintenanceWindow',
                entityId: window.id,
                action,
                changes,
            });
        } catch (error) {
            this.logger.error(
                `The audit record of ${action} for window ${window.id} could not be written; ` +
                    'the action itself was carried out.',
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    /**
     * Tells the application, without the operator waiting on it: a mail to
     * every tenant can take minutes, and the window is recorded either way.
     */
    private notify(event: MaintenanceWindowEvent): void {
        const notifications = this.notifications;
        if (!notifications) return;
        withTimeout(() => notifications.windowChanged(event), NOTIFICATION_TIMEOUT_MS).catch(
            (error: unknown) => {
                this.logger.error(
                    `The application was not told that window ${event.window.id} was ${event.kind}; ` +
                        'the window stands as recorded.',
                    error instanceof Error ? error.stack : String(error),
                );
            },
        );
    }
}

/** Whether two moments are the same, a missing one being none. */
function sameMoment(a: Date, b: Date | null): boolean {
    return b !== null && a.getTime() === b.getTime();
}

/** The stage of an open window. */
function stageOf(window: MaintenanceWindowRecord): MaintenanceWindowStage {
    return window.lockedAt ? 'locked' : 'announced';
}

/** An announced window ends after it starts, and in the future. */
function assertTimes(startsAt: Date, endsAt: Date, now: Date): void {
    if (endsAt.getTime() <= startsAt.getTime()) {
        throw new BadRequestException(
            codedError(MAINTENANCE_ERROR_CODES.MAINTENANCE_WINDOW_END_NOT_AFTER_START),
        );
    }
    assertEndAhead(endsAt, now);
}

function assertEndAhead(endsAt: Date, now: Date): void {
    if (endsAt.getTime() <= now.getTime()) {
        throw new BadRequestException(
            codedError(MAINTENANCE_ERROR_CODES.MAINTENANCE_WINDOW_END_IN_PAST),
        );
    }
}

/**
 * The message as it is kept: trimmed, and none where nothing is left.
 * `undefined` stays `undefined` — "leave it as it is".
 */
function messageOf(message: string | null | undefined): string | null | undefined {
    if (message === undefined || message === null) return message;
    const trimmed = message.trim();
    if (trimmed.length > MAINTENANCE_MESSAGE_MAX_LENGTH) {
        throw new BadRequestException(
            codedError(MAINTENANCE_ERROR_CODES.MAINTENANCE_MESSAGE_TOO_LONG, {
                max: MAINTENANCE_MESSAGE_MAX_LENGTH,
            }),
        );
    }
    return trimmed === '' ? null : trimmed;
}

/** What a reschedule changes, for the audit record. */
function revisionOf(window: MaintenanceWindowRecord): Record<string, unknown> {
    return {
        startsAt: window.startsAt?.toISOString() ?? null,
        endsAt: window.endsAt?.toISOString() ?? null,
        message: window.message,
    };
}
