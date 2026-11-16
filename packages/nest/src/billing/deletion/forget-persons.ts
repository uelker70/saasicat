// What a deleted tenant's rows say of who acted (`SC-PRIV-023`): the rows the
// platform keeps of a tenant beyond its deletion stay, since the deletion
// record reads its days from them, but each names the role somebody acted in
// rather than who it was. Planned here from the rows as read; the run writes
// the plan in the transaction that closes the deletion.

import {
    actorRoleOf,
    type SubscriptionEnd,
    type SubscriptionEndAnnouncement,
    type SubscriptionEndPort,
    type TenantAccessHold,
    type TenantAccessHoldPort,
    type TenantExportDownload,
} from '@saasicat/core';

/** The rows of one tenant that outlive its deletion and name who acted. */
export interface RowsNamingActors {
    readonly holds: readonly TenantAccessHold[];
    readonly ends: readonly SubscriptionEnd[];
    readonly announcements: readonly SubscriptionEndAnnouncement[];
    readonly downloads: readonly TenantExportDownload[];
}

/** What each row is to name instead, as the ports' `replaceActors` take it. */
export interface RolesInsteadOfPersons {
    readonly holds: Parameters<TenantAccessHoldPort['replaceActors']>[0];
    readonly ends: Parameters<SubscriptionEndPort['replaceActors']>[0];
}

/** The roles the rows of a deleted tenant name in place of persons, every row named. */
export function rolesInsteadOfPersons(rows: RowsNamingActors): RolesInsteadOfPersons {
    return {
        holds: rows.holds.map((hold) => ({
            id: hold.id,
            recordedBy: actorRoleOf(
                hold.recordedBy,
                hold.kind === 'suspended' ? 'hold.recordedBy.suspended' : 'hold.recordedBy.other',
            ),
            liftedBy: hold.liftedBy === null ? null : actorRoleOf(hold.liftedBy, 'hold.liftedBy'),
        })),
        ends: {
            ends: rows.ends.map((end) => ({
                id: end.id,
                recordedBy: actorRoleOf(end.recordedBy, 'end.recordedBy'),
            })),
            announcements: rows.announcements.map((announced) => ({
                id: announced.id,
                announcedBy: actorRoleOf(announced.announcedBy, 'announcement.announcedBy'),
            })),
            downloads: rows.downloads.map((download) => {
                // The user id is no tag; it goes with the role of the tag beside it.
                const role = actorRoleOf(download.downloadedBy, 'download.downloadedBy');
                return { id: download.id, downloadedBy: role, downloadedByUserId: role };
            }),
        },
    };
}
