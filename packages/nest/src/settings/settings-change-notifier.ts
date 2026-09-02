// Tells the people named in the file that its settings changed.
//
// The record inside the application is unconditional — `AppliedSettingsRecorder`
// writes it whether or not anybody is mailed. Mail is the addition, never the
// substitute: an address list that silently swallowed the notice because nobody
// wired a port would be worse than having neither, so an installation that
// names addresses and binds no port is told so at boot, once.
//
// The text is for the operator, in English like every other diagnostic the
// platform writes (`SC-LANG-010`): one language is what makes it searchable.

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    type AppliedSettingsValues,
    diffSettings,
    type EmailPort,
    type PlanCatalog,
    type SettingsChangeRecord,
} from '@saasicat/core';

import { PLAN_CATALOG_TOKEN } from '../billing/plan-catalog.module.js';
import { EMAIL_PORT_TOKEN } from '../core/email.tokens.js';

/**
 * How long one send may take before it is logged as failed and the next
 * address is tried. An adapter with no timeout of its own — a raw socket to an
 * unreachable host — would otherwise hold the sequence for as long as the OS
 * lets it.
 */
const MAIL_SEND_TIMEOUT_MS = 30_000;

/** `promise`, or a rejection naming `to` once `ms` have passed without an answer. */
function withinTime<T>(promise: Promise<T>, ms: number, to: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`no answer from the email port within ${ms} ms for ${to}`)),
            ms,
        );
        timer.unref();
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            },
        );
    });
}

/** What one boot's notification amounted to. */
export type NotificationOutcome =
    | { kind: 'nobody-to-tell' }
    | { kind: 'no-email-port'; addresses: readonly string[] }
    | { kind: 'sent'; addresses: readonly string[]; failed: readonly string[] };

@Injectable()
export class SettingsChangeNotifier {
    private readonly logger = new Logger(SettingsChangeNotifier.name);

    constructor(
        @Inject(PLAN_CATALOG_TOKEN) private readonly catalog: PlanCatalog,
        @Optional() @Inject(EMAIL_PORT_TOKEN) private readonly email: EmailPort | null = null,
    ) {}

    /** The addresses `config/saas.yaml` names under `notifications.settingsChanged`. */
    get addresses(): readonly string[] {
        return this.catalog.notifications?.settingsChanged ?? [];
    }

    /**
     * Which of the two it is, said once at boot — and only where the question
     * arises. An installation naming nobody asked for in-app only, and a line
     * about it would be a warning at a correct configuration.
     */
    reportModeAtBoot(): void {
        if (this.addresses.length === 0) return;
        if (this.email) {
            this.logger.log(
                `Settings changes are mailed to ${this.addresses.length} address(es) from ` +
                    'config/saas.yaml#notifications.settingsChanged, and recorded in the application.',
            );
            return;
        }
        this.logger.warn(
            `config/saas.yaml#notifications.settingsChanged names ${this.addresses.length} ` +
                'address(es), but no email port is bound (`adapters.email`). Changes are recorded ' +
                'in the application only; nobody is mailed.',
        );
    }

    /**
     * Mails everybody the change concerns: the addresses the file names now,
     * and — when the list itself is what moved — the ones it named before. An
     * address taken off the list is told that once; otherwise whoever can edit
     * the file could point the channel elsewhere and the people it pointed at
     * would go quiet without a word, which is the failure this exists to
     * prevent. Never throws: a mail that fails is logged.
     */
    async notify(change: SettingsChangeRecord): Promise<NotificationOutcome> {
        const addresses = recipientsOf(this.addresses, change.previous);
        if (addresses.length === 0) return { kind: 'nobody-to-tell' };
        if (!this.email) return { kind: 'no-email-port', addresses };

        const message = describeChange(this.catalog.app.name, change);
        const failed: string[] = [];
        for (const to of addresses) {
            try {
                await withinTime(this.email.send({ to, ...message }), MAIL_SEND_TIMEOUT_MS, to);
            } catch (error) {
                failed.push(to);
                this.logger.error(
                    `The settings-change mail to ${to} could not be sent; the change is recorded ` +
                        'in the application regardless.',
                    error instanceof Error ? error.stack : String(error),
                );
            }
        }
        return { kind: 'sent', addresses, failed };
    }
}

/** The running list first, then whoever the previous configuration named and this one does not. */
function recipientsOf(
    running: readonly string[],
    previous: AppliedSettingsValues,
): readonly string[] {
    return [...new Set([...running, ...addressListIn(previous)])];
}

/**
 * `notifications.settingsChanged` as a recorded subtree carries it. The row
 * is data the platform wrote from a validated catalogue, but it is read back
 * from a store, so its shape is checked rather than assumed.
 */
function addressListIn(settings: AppliedSettingsValues): readonly string[] {
    const notifications = settings.notifications;
    if (typeof notifications !== 'object' || notifications === null) return [];
    const list: unknown = (notifications as { settingsChanged?: unknown }).settingsChanged;
    return Array.isArray(list) ? list.filter((a): a is string => typeof a === 'string') : [];
}

/** The mail, as plain text: what moved, from which file, and when it was noticed. */
export function describeChange(
    appName: string,
    change: SettingsChangeRecord,
): { subject: string; text: string } {
    const lines = diffSettings(change.previous, change.current).map(
        (d) => `  ${d.path}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`,
    );
    return {
        subject: `[${appName}] The configuration changed at the last start`,
        text: [
            `${appName} started at ${change.noticedAt.toISOString()} and found its settings changed`,
            `since the previous start. The new values are running. What moved:`,
            '',
            ...lines,
            '',
            `Source: ${change.source}`,
            'The change is recorded in the administration under Settings until somebody acknowledges it.',
        ].join('\n'),
    };
}
