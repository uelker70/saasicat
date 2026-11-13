import type { Logger } from '@nestjs/common';

/**
 * One step of a scheduled run. A step that fails is said in `logger` and holds
 * up none of the steps after it; the next run tries it again. Undefined where
 * it failed, or where there was nothing to run.
 */
export async function runStep<T>(
    logger: Logger,
    name: string,
    run: () => Promise<T> | undefined,
): Promise<T | undefined> {
    try {
        return await run();
    } catch (error) {
        logger.error(
            `${name}: the step failed; the next run tries again.`,
            error instanceof Error ? error.stack : String(error),
        );
        return undefined;
    }
}
