-- =============================================================================
-- SaaSiCat 1.0 — every contract names the subscriber it is concluded with.
-- =============================================================================
--
-- A tenant is where the application keeps a customer's data; the subscriber is
-- the party the contract is with (ADR 0012). This file brings an installation
-- that has contracts to that model. Run it BEFORE `db push`, like the other
-- files in this directory:
--
--   psql "$DATABASE_URL" -f 1.0-a-contract-names-its-subscriber.postgres.sql
--
-- What it does, in two transactions:
--
--   1. Creates `subscribers`, `subscriber_tenants` and `subscriber_corrections`
--      and adds `subscriberId`, `subscriberSnapshot`, `issuerSnapshot` and
--      `partiesMigrated` to `subscription_contracts`, nullable, exactly as the
--      shipped fragments declare them otherwise. Nothing depends on these yet,
--      so they stay when the second transaction stops.
--
--   The second transaction does the rest, or nothing:
--
--   2. Gives every tenant that has a subscription or a contract and no live
--      subscriber one of its own, marked `migrated`, numbered from 10001 in the
--      order the tenants first appear.
--   3. Attaches every contract to its tenant's subscriber and copies the
--      subscriber onto it, with `partiesMigrated` set: the copy is made now,
--      not when the contract was concluded, and is never presented as what was
--      agreed. No issuer is copied — this file cannot read `config/saas.yaml`.
--   4. Makes `subscriberId` and `subscriberSnapshot` required.
--
-- Where the legal name comes from. SaaSiCat keeps no master data of its own
-- about a tenant; the application does, in its own table. This file finds that
-- table through the foreign key the application declared on
-- `subscriptions."tenantId"` — or, where there is none, on
-- `subscription_contracts."tenantId"` — and takes the tenant's `name` column as
-- the subscriber's legal name. It stops, naming what it found, when there is no
-- such foreign key, when that table has no `name` column, or when a tenant has
-- no row there or an empty name: a subscriber named after an identifier is
-- worse than a migration that did not run. The tables from step 1 are in place
-- by then, and `docs/guides/upgrade-to-1.0.md` shows the statement that creates
-- those subscribers by hand before this file runs again.
--
-- The prefix. A customer number keeps the prefix it was assigned with, and this
-- file cannot read `subscribers.customerNumberPrefix` from `config/saas.yaml`
-- either. Set it for the session to number the migrated subscribers the way the
-- installation numbers new ones:
--
--   psql "$DATABASE_URL" -c "SET saasicat.customer_number_prefix = 'K-'" \
--        -f 1.0-a-contract-names-its-subscriber.postgres.sql
--
-- Without it they carry the number alone. A value the configuration would
-- refuse stops the migration.
--
-- Row-level security. Where `subscription_contracts` or `subscriptions` has it
-- and this role would see only some of their rows, the file stops before it
-- creates a subscriber: run it as a role that bypasses row-level security.
--
-- Safe to run again: every object is created only where it is missing, a
-- tenant that has a live subscriber gets no second one, a contract that names a
-- subscriber is not touched, and the numbering is moved only while it has never
-- handed out a number. On a database created from
-- `reference-schema.postgres.sql` the whole file does nothing at all.

BEGIN;

-- 1. The tables and columns, as the fragments declare them ----------------------

DO $$
BEGIN
    IF to_regclass('subscription_contracts') IS NULL THEN
        RAISE NOTICE 'subscription_contracts is not present — nothing to migrate.';
        RETURN;  -- an installation that never adopted the contract fragment
    END IF;

    CREATE TABLE IF NOT EXISTS "subscribers" (
        "id" TEXT NOT NULL,
        "customerSequence" SERIAL NOT NULL,
        "customerNumberPrefix" TEXT NOT NULL DEFAULT '',
        "legalName" TEXT NOT NULL,
        "vatId" TEXT,
        "taxNumber" TEXT,
        "addressLine1" TEXT,
        "addressLine2" TEXT,
        "postalCode" TEXT,
        "city" TEXT,
        "country" TEXT,
        "invoiceEmail" TEXT,
        "migrated" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "subscribers_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "subscribers_customerSequence_key"
        ON "subscribers"("customerSequence");

    CREATE TABLE IF NOT EXISTS "subscriber_tenants" (
        "id" TEXT NOT NULL,
        "subscriberId" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "unlinkedAt" TIMESTAMP(3),
        CONSTRAINT "subscriber_tenants_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX IF NOT EXISTS "subscriber_tenants_tenantId_idx"
        ON "subscriber_tenants"("tenantId");
    CREATE INDEX IF NOT EXISTS "subscriber_tenants_subscriberId_idx"
        ON "subscriber_tenants"("subscriberId");
    CREATE UNIQUE INDEX IF NOT EXISTS subscriber_tenants_live_per_tenant
        ON subscriber_tenants ("tenantId") WHERE "unlinkedAt" IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS subscriber_tenants_live_per_subscriber
        ON subscriber_tenants ("subscriberId") WHERE "unlinkedAt" IS NULL;

    CREATE TABLE IF NOT EXISTS "subscriber_corrections" (
        "id" TEXT NOT NULL,
        "subscriberId" TEXT NOT NULL,
        "previous" JSONB NOT NULL,
        "corrected" JSONB NOT NULL,
        "reason" TEXT NOT NULL,
        "correctedBy" TEXT NOT NULL,
        "correctedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "subscriber_corrections_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX IF NOT EXISTS "subscriber_corrections_subscriberId_correctedAt_idx"
        ON "subscriber_corrections"("subscriberId", "correctedAt");

    ALTER TABLE "subscription_contracts" ADD COLUMN IF NOT EXISTS "subscriberId" TEXT;
    ALTER TABLE "subscription_contracts" ADD COLUMN IF NOT EXISTS "subscriberSnapshot" JSONB;
    ALTER TABLE "subscription_contracts" ADD COLUMN IF NOT EXISTS "issuerSnapshot" JSONB;
    ALTER TABLE "subscription_contracts"
        ADD COLUMN IF NOT EXISTS "partiesMigrated" BOOLEAN NOT NULL DEFAULT false;
    CREATE INDEX IF NOT EXISTS "subscription_contracts_subscriberId_idx"
        ON "subscription_contracts"("subscriberId");

    -- `ADD CONSTRAINT` has no `IF NOT EXISTS`, so each foreign key is added only
    -- where its name is not taken yet.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscriber_tenants')
           AND conname = 'subscriber_tenants_subscriberId_fkey'
    ) THEN
        ALTER TABLE "subscriber_tenants"
            ADD CONSTRAINT "subscriber_tenants_subscriberId_fkey"
            FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscriber_corrections')
           AND conname = 'subscriber_corrections_subscriberId_fkey'
    ) THEN
        ALTER TABLE "subscriber_corrections"
            ADD CONSTRAINT "subscriber_corrections_subscriberId_fkey"
            FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscription_contracts')
           AND conname = 'subscription_contracts_subscriberId_fkey'
    ) THEN
        ALTER TABLE "subscription_contracts"
            ADD CONSTRAINT "subscription_contracts_subscriberId_fkey"
            FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- The numbering starts at 10001, as `constraints.postgres.sql` has it, and
    -- is moved only while it has never handed out a number.
    ALTER SEQUENCE IF EXISTS "subscribers_customerSequence_seq" START WITH 10001;
    PERFORM setval(format('%I.%I', schemaname, sequencename)::regclass, 10001, false)
       FROM pg_sequences
      WHERE schemaname = current_schema()
        AND sequencename = 'subscribers_customerSequence_seq'
        AND last_value IS NULL;
END $$;

COMMIT;

BEGIN;

DO $$
DECLARE
    prefix text := coalesce(current_setting('saasicat.customer_number_prefix', true), '');
    hidden text[];
    tenant_table regclass;
    tenant_key text;
    unnamed text[];
    tenant record;
    new_subscriber text;
BEGIN
    IF to_regclass('subscription_contracts') IS NULL THEN
        RETURN;  -- said once already, by the first transaction
    END IF;

    -- A table under row-level security shows this role only the rows its
    -- policies allow. The migration would give subscribers to the tenants it
    -- can see, and then fail to make the link required for the contracts it
    -- could not — with a message about null values rather than about the role.
    SELECT array_agg(c.relname::text ORDER BY c.relname)
      INTO hidden
      FROM pg_class c
     WHERE c.oid IN (to_regclass('subscription_contracts'), to_regclass('subscriptions'))
       AND c.relrowsecurity
       AND (c.relforcerowsecurity OR NOT pg_has_role(current_user, c.relowner, 'MEMBER'))
       AND NOT EXISTS (
           SELECT 1 FROM pg_roles r
            WHERE r.rolname = current_user AND (r.rolsuper OR r.rolbypassrls)
       );
    IF hidden IS NOT NULL THEN
        RAISE EXCEPTION
            'Cannot see every row of % under row-level security as role %, so subscribers would '
            'be missing for the tenants it hides. Run this file as a role that bypasses '
            'row-level security. No subscriber was created.',
            array_to_string(hidden, ', '),
            current_user;
    END IF;

    IF prefix <> '' AND prefix !~ '^[A-Za-z0-9._/-]{1,16}$' THEN
        RAISE EXCEPTION
            'saasicat.customer_number_prefix is %, which config/saas.yaml would refuse: a prefix '
            'is 1 to 16 letters, digits, dots, slashes, hyphens or underscores. No subscriber '
            'was created.',
            quote_literal(prefix);
    END IF;

    -- 2. A subscriber for every tenant that has none ---------------------------

    -- The tenants in question, each with the moment it first appears, so the
    -- numbers follow the order the customers came in. Worked out once, because
    -- the refusal and the creation below have to agree about who is meant.
    CREATE TEMP TABLE _saasicat_tenants ON COMMIT DROP AS
    SELECT seen."tenantId" AS tenant_id, min(seen.at) AS first_seen, NULL::text AS legal_name
      FROM (
          SELECT "tenantId", "createdAt" AS at FROM "subscription_contracts"
      ) seen
     GROUP BY seen."tenantId";
    IF to_regclass('subscriptions') IS NOT NULL THEN
        INSERT INTO _saasicat_tenants (tenant_id, first_seen)
        SELECT s."tenantId", s."createdAt"
          FROM "subscriptions" s
         WHERE NOT EXISTS (SELECT 1 FROM _saasicat_tenants t WHERE t.tenant_id = s."tenantId");
        UPDATE _saasicat_tenants t
           SET first_seen = least(t.first_seen, s."createdAt")
          FROM "subscriptions" s
         WHERE s."tenantId" = t.tenant_id;
    END IF;
    DELETE FROM _saasicat_tenants t
     WHERE EXISTS (
         SELECT 1 FROM "subscriber_tenants" l
          WHERE l."tenantId" = t.tenant_id AND l."unlinkedAt" IS NULL
     );

    IF EXISTS (SELECT 1 FROM _saasicat_tenants) THEN
        -- The application's tenant table: the one a single-column foreign key on
        -- "tenantId" points at, from the subscriptions first.
        SELECT c.confrelid::regclass, referenced.attname
          INTO tenant_table, tenant_key
          FROM pg_constraint c
          JOIN pg_attribute referencing
            ON referencing.attrelid = c.conrelid AND referencing.attnum = c.conkey[1]
          JOIN pg_attribute referenced
            ON referenced.attrelid = c.confrelid AND referenced.attnum = c.confkey[1]
         WHERE c.contype = 'f'
           AND cardinality(c.conkey) = 1
           AND referencing.attname = 'tenantId'
           AND c.conrelid IN (to_regclass('subscriptions'), to_regclass('subscription_contracts'))
         ORDER BY c.conrelid = to_regclass('subscriptions') DESC, c.conname
         LIMIT 1;

        IF tenant_table IS NULL THEN
            RAISE EXCEPTION
                'Cannot create the subscribers of % tenant(s) (%): no foreign key on '
                'subscriptions."tenantId" or subscription_contracts."tenantId" names the '
                'application''s tenant table, so there is nowhere to read a legal name from. '
                'The tables are in place: create their subscribers as docs/guides/upgrade-to-1.0.md '
                'shows and run this file again. No subscriber was created.',
                (SELECT count(*) FROM _saasicat_tenants),
                (SELECT array_to_string((array_agg(tenant_id ORDER BY tenant_id))[1:10], ', ')
                   FROM _saasicat_tenants);
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_attribute
             WHERE attrelid = tenant_table
               AND attname = 'name'
               AND attnum > 0
               AND NOT attisdropped
        ) THEN
            RAISE EXCEPTION
                'Cannot create the subscribers of % tenant(s): their table % has no "name" column '
                'to take a legal name from. The tables are in place: create their subscribers as '
                'docs/guides/upgrade-to-1.0.md shows and run this file again. No subscriber was '
                'created.',
                (SELECT count(*) FROM _saasicat_tenants),
                tenant_table;
        END IF;

        EXECUTE format(
            'UPDATE _saasicat_tenants t SET legal_name = nullif(btrim(a."name"::text), '''') '
            'FROM %s a WHERE a.%I::text = t.tenant_id',
            tenant_table, tenant_key
        );

        SELECT array_agg(tenant_id ORDER BY tenant_id)
          INTO unnamed
          FROM _saasicat_tenants
         WHERE legal_name IS NULL;
        IF unnamed IS NOT NULL THEN
            RAISE EXCEPTION
                'Cannot create the subscribers of % tenant(s) (%): % has no row for them, or an '
                'empty name, and a subscriber is not named after an identifier. The tables are in '
                'place: create their subscribers as docs/guides/upgrade-to-1.0.md shows and run '
                'this file again. No subscriber was created.',
                array_length(unnamed, 1),
                array_to_string(unnamed[1:10], ', ')
                    || CASE WHEN array_length(unnamed, 1) > 10 THEN ', …' ELSE '' END,
                tenant_table;
        END IF;

        -- One at a time, in the order the tenants came in: the numbers are drawn
        -- in exactly that order, which a set-based insert does not promise.
        FOR tenant IN
            SELECT tenant_id, legal_name FROM _saasicat_tenants ORDER BY first_seen, tenant_id
        LOOP
            new_subscriber := gen_random_uuid()::text;
            INSERT INTO "subscribers"
                ("id", "customerNumberPrefix", "legalName", "migrated", "updatedAt")
            VALUES (new_subscriber, prefix, tenant.legal_name, true, CURRENT_TIMESTAMP);
            INSERT INTO "subscriber_tenants" ("id", "subscriberId", "tenantId")
            VALUES (gen_random_uuid()::text, new_subscriber, tenant.tenant_id);
        END LOOP;
    END IF;

    -- 3. Every contract names its tenant's subscriber -------------------------

    UPDATE "subscription_contracts" c
       SET "subscriberId" = s."id",
           "subscriberSnapshot" = jsonb_build_object(
               'customerNumber', s."customerNumberPrefix" || s."customerSequence",
               'legalName', s."legalName",
               'vatId', s."vatId",
               'taxNumber', s."taxNumber",
               'addressLine1', s."addressLine1",
               'addressLine2', s."addressLine2",
               'postalCode', s."postalCode",
               'city', s."city",
               'country', s."country"
           ),
           "partiesMigrated" = true
      FROM "subscriber_tenants" l
      JOIN "subscribers" s ON s."id" = l."subscriberId"
     WHERE l."tenantId" = c."tenantId"
       AND l."unlinkedAt" IS NULL
       AND c."subscriberId" IS NULL;

    -- 4. Required from here on -------------------------------------------------

    ALTER TABLE "subscription_contracts" ALTER COLUMN "subscriberId" SET NOT NULL;
    ALTER TABLE "subscription_contracts" ALTER COLUMN "subscriberSnapshot" SET NOT NULL;
END $$;

COMMIT;
