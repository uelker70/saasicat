-- @saasicat/adapter-drizzle 1.0 — a redemption's moment, converted to UTC.
--
-- For an installation on @saasicat/adapter-drizzle whose database session runs
-- outside UTC, and for no other. The canonical columns are `timestamp` without
-- a time zone. Before this version the adapter left `redeemedAt` to the
-- database's `now()`, which stored the session's wall time, while it wrote a
-- contract's `createdAt` itself, in UTC. The contract freeze compares the two
-- to decide whether a redeemed code still belongs in a contract, so a
-- redemption hours off lets an old code be recorded — and its discount start —
-- again.
--
-- Run it once, in a session with the zone the application's sessions use —
-- check `SHOW TimeZone` through the application's connection — after the last
-- instance of the old version has stopped and before the first instance of the
-- new one starts. The old version keeps writing wall time, which a marked
-- column no longer converts; the new version writes UTC, which this would move.
-- In a rolling deployment, pause onboarding for the step. An installation on
-- @saasicat/adapter-prisma does not run it — there both columns come from the
-- same clock — and neither does one whose older rows were written by it.
--
-- Converting a wall time is exact except in the hour a zone repeats when its
-- clocks go back: that hour happened twice, and PostgreSQL picks one of the
-- two, so a redemption written in it can stay an hour off.
--
-- Safe to run again: the column is marked when it is converted, a marked column
-- is left alone, and the table is locked for the step, so a second run at the
-- same time waits and then finds the mark. A session whose zone is UTC all
-- year converts nothing and marks nothing, so a run in UTC by mistake does not
-- stand in the way of the right one. A database without the table is left as
-- it is.

DO $$
DECLARE
    session_zone text := current_setting('TimeZone');
    marker constant text := 'saasicat: redeemedAt is written in UTC';
    column_number smallint;
BEGIN
    IF to_regclass('promo_code_redemptions') IS NULL THEN
        RAISE NOTICE 'There is no promo_code_redemptions table: nothing to convert.';
        RETURN;
    END IF;
    -- A zone whose wall time is UTC's in winter and in summer converts nothing.
    IF (timestamptz '2026-01-15 12:00:00+00' AT TIME ZONE session_zone) = timestamp '2026-01-15 12:00:00'
       AND (timestamptz '2026-07-15 12:00:00+00' AT TIME ZONE session_zone) = timestamp '2026-07-15 12:00:00' THEN
        RAISE NOTICE 'This session is in %, which is UTC: nothing to convert, and the column is not marked. Run it in the zone the application''s sessions use.', session_zone;
        RETURN;
    END IF;
    LOCK TABLE promo_code_redemptions IN SHARE ROW EXCLUSIVE MODE;
    SELECT attnum INTO column_number
      FROM pg_attribute
     WHERE attrelid = 'promo_code_redemptions'::regclass AND attname = 'redeemedAt';
    IF col_description('promo_code_redemptions'::regclass, column_number) = marker THEN
        RAISE NOTICE 'redeemedAt was converted before: nothing to do.';
        RETURN;
    END IF;
    UPDATE promo_code_redemptions
       SET "redeemedAt" = ("redeemedAt" AT TIME ZONE session_zone) AT TIME ZONE 'UTC';
    EXECUTE format('COMMENT ON COLUMN promo_code_redemptions.%I IS %L', 'redeemedAt', marker);
    RAISE NOTICE 'redeemedAt converted from % to UTC.', session_zone;
END $$;
