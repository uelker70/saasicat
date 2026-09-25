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
-- Run it once, in a session with the zone the application's sessions use (the
-- database's default, unless the application sets one), BEFORE the new version
-- starts: a redemption the new version writes is already in UTC, and this
-- would move it too. An installation on @saasicat/adapter-prisma does not run
-- it: there both columns come from the same clock.
--
-- Safe to run again: the column is marked when it is converted, and a marked
-- column is left alone. A database without the table, or one whose session is
-- in UTC, is only marked.

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
