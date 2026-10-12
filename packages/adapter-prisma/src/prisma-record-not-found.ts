/** Prisma's answer to an update or delete whose `where` matched no row (`P2025`). */
export function isRecordNotFound(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025';
}
