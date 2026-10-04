/** Whether the runtime knows `timeZone` as an IANA zone, such as `Europe/Berlin`. */
export function knowsTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone });
        return true;
    } catch {
        return false;
    }
}
