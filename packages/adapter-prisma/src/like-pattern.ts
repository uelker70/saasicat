/**
 * A value that matches only itself inside a `contains`, `startsWith` or
 * `endsWith` filter.
 *
 * Prisma hands those values to PostgreSQL's `LIKE` as they are, so `%` and `_`
 * in them are wildcards there: a search for `BLACK_25` also finds `BLACKX25`,
 * and an address with an underscore finds the one with any character in its
 * place. The backslash is PostgreSQL's escape character, and escaped here too.
 */
export function literalInLike(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
}
