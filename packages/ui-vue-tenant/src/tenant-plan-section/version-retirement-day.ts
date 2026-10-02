/**
 * A calendar day (`YYYY-MM-DD`) as an instant a date formatter can be handed.
 *
 * The formatter is the application's, and it reads an instant in the viewer's
 * zone: midnight UTC is the day before anywhere west of Greenwich. Noon UTC is
 * the same calendar day in every zone within twelve hours of it.
 */
export function dayAsInstant(day: string): string {
    return `${day}T12:00:00.000Z`;
}
