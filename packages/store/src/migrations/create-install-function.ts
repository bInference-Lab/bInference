import { BinferenceError } from "@binference/core";
import type { PostgresMigration } from "./postgres-migration.js";

/** Each install's migrations, written into the function that creates an install's schemas. */
export interface InstallMigrations {
  readonly engine: readonly PostgresMigration[];
  readonly agent: readonly PostgresMigration[];
}

const bodyTag = "$create_install$";

function literal(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function steps(migrations: readonly PostgresMigration[]): string {
  for (const migration of migrations) {
    if (migration.sql.includes(bodyTag)) {
      throw new BinferenceError({
        code: "store.migration_order",
        message: `Migration ${migration.name} holds ${bodyTag}, which ends the install function's body; write its SQL without it.`,
      });
    }
  }
  return `ARRAY[${migrations.map((migration) => literal(migration.sql)).join(",\n")}]::text[]`;
}

/**
 * The SQL that creates or replaces `<shared>.create_install(install_id)` (database spec, section
 * 6.6): a `SECURITY DEFINER` function, run by the role that owns the shared schema, that takes an
 * `ins_` id, refuses when either of the install's schemas exists, and otherwise creates
 * `engine_<digits>` and `agent_<digits>`, applies every migration in each, version by version,
 * and inserts the install's own lease row free: an empty agent id, no worker, fence 1 and
 * `expires_at` 0 (decision 0418). Nobody may run it until a grant names them. The migrations are written into the function, so it
 * is replaced whenever they change.
 */
export function createInstallFunctionSql(sharedSchema: string, plans: InstallMigrations): string {
  const shared = `"${sharedSchema}"`;
  return `
CREATE OR REPLACE FUNCTION ${shared}.create_install(install_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS ${bodyTag}
DECLARE
  digits text;
  part text;
  target text;
  migrations text[];
  version integer;
BEGIN
  IF install_id IS NULL OR install_id !~
    '^ins_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'create_install takes an ins_ id, not %', install_id USING ERRCODE = '22023';
  END IF;
  digits := replace(substr(install_id, 5), '-', '');
  IF EXISTS (SELECT FROM pg_namespace WHERE nspname IN ('engine_' || digits, 'agent_' || digits)) THEN
    RAISE EXCEPTION 'the schemas of install % exist', install_id USING ERRCODE = '42P06';
  END IF;
  FOREACH part IN ARRAY ARRAY['engine', 'agent'] LOOP
    target := part || '_' || digits;
    migrations := CASE part
      WHEN 'engine' THEN ${steps(plans.engine)}
      ELSE ${steps(plans.agent)}
    END;
    EXECUTE format('CREATE SCHEMA %I', target);
    PERFORM set_config('search_path', format('%I, %I', target, ${literal(sharedSchema)}), true);
    FOR version IN 1 .. coalesce(array_length(migrations, 1), 0) LOOP
      EXECUTE migrations[version];
      EXECUTE format(
        'INSERT INTO %I.meta (key, value) VALUES (''schema_version'', $1) '
          'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        target
      ) USING version::text;
    END LOOP;
  END LOOP;
  INSERT INTO ${shared}.agent_leases (install_id, agent_id, fence, expires_at)
    VALUES (create_install.install_id, '', 1, 0);
END
${bodyTag};

REVOKE ALL ON FUNCTION ${shared}.create_install(text) FROM PUBLIC;
`;
}
