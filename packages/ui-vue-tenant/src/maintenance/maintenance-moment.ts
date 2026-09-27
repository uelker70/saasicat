// A moment of a maintenance window, as a tenant reads it: in their own zone,
// with the zone named, because the operator who announced it may sit in
// another one (`SC-OPS-011`).

/** `Fri, 2 Oct, 22:00 CEST`, in the reader's language and zone; empty for none. */
export function maintenanceMoment(iso: string | null, locale: string): string {
    if (!iso) return '';
    const moment = new Date(iso);
    if (Number.isNaN(moment.getTime())) return '';
    return moment.toLocaleString(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
    });
}
