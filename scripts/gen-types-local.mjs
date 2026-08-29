#!/usr/bin/env node
/**
 * Regenerate src/integrations/supabase/types.ts from a local Postgres that has
 * every migration applied.
 *
 * `bun run db:types` (the Supabase CLI) is the normal path and stays the source
 * of truth. This exists because the CLI reaches the database through a Docker
 * image, which is not always reachable — and being unable to regenerate types
 * after a migration would mean writing the whole data layer against `any`,
 * which is the problem the data layer exists to solve.
 *
 *   supabase/tests/run-local.sh            # apply migrations
 *   node scripts/gen-types-local.mjs       # regenerate
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

const CONN = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:55432/consflow_test";
const OUT = "src/integrations/supabase/types.ts";

const q = (sql) =>
  JSON.parse(
    execFileSync("psql", [CONN, "-Atqc", `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }).trim(),
  );

const enums = q(`
  select t.typname as name,
         array_agg(e.enumlabel order by e.enumsortorder) as values
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  group by t.typname order by t.typname
`);

const columns = q(`
  select c.relname as table_name,
         a.attname as column_name,
         a.attnum as ordinal,
         not a.attnotnull as is_nullable,
         format_type(a.atttypid, null) as data_type,
         t.typname as udt_name,
         t.typcategory as type_category,
         (select tt.typname from pg_type tt where tt.oid = t.typelem) as element_type,
         (a.atthasdef or a.attidentity <> '' or a.attgenerated <> '') as has_default,
         a.attgenerated <> '' as is_generated
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_type t on t.oid = a.atttypid
  where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  order by c.relname, a.attnum
`);

const fks = q(`
  select con.conname as name,
         c.relname as table_name,
         (select array_agg(att.attname order by k.ord)
            from unnest(con.conkey) with ordinality k(attnum, ord)
            join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
         ) as columns,
         fc.relname as referenced_relation,
         (select array_agg(att.attname order by k.ord)
            from unnest(con.confkey) with ordinality k(attnum, ord)
            join pg_attribute att on att.attrelid = con.confrelid and att.attnum = k.attnum
         ) as referenced_columns,
         exists (
           select 1 from pg_index i
           where i.indrelid = con.conrelid and i.indisunique
             and i.indnatts = array_length(con.conkey, 1)
             and i.indkey::int2[] @> con.conkey and con.conkey @> i.indkey::int2[]
         ) as is_one_to_one
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_class fc on fc.oid = con.confrelid
  join pg_namespace n on n.oid = c.relnamespace
  where con.contype = 'f' and n.nspname = 'public'
  order by c.relname, con.conname
`);

const functions = q(`
  select p.proname as name,
         pg_get_function_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as returns
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and pg_get_function_result(p.oid) <> 'trigger'
    and not exists (
      select 1 from pg_depend d
      where d.objid = p.oid and d.deptype = 'e'
    )
  order by p.proname
`);

const enumNames = new Set(enums.map((e) => e.name));

function tsType(col) {
  const { udt_name: udt, element_type: el } = col;
  if (enumNames.has(udt)) return `Database["public"]["Enums"]["${udt}"]`;
  if (udt.startsWith("_")) {
    const inner = tsType({ ...col, udt_name: el ?? udt.slice(1), element_type: null });
    return `${inner}[]`;
  }
  switch (udt) {
    case "bool":
      return "boolean";
    case "int2":
    case "int4":
    case "int8":
    case "float4":
    case "float8":
    case "numeric":
      return "number";
    case "json":
    case "jsonb":
      return "Json";
    case "tsvector":
      return "unknown";
    default:
      return "string";
  }
}

// PostgREST exposes SQL identifiers verbatim, so anything that is not a plain
// identifier has to stay quoted in the emitted type.
const key = (name) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : JSON.stringify(name));

const byTable = new Map();
for (const c of columns) {
  if (!byTable.has(c.table_name)) byTable.set(c.table_name, []);
  byTable.get(c.table_name).push(c);
}

const fksByTable = new Map();
for (const f of fks) {
  if (!fksByTable.has(f.table_name)) fksByTable.set(f.table_name, []);
  fksByTable.get(f.table_name).push(f);
}

const out = [];
out.push(
  "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];",
  "",
  "export type Database = {",
  "  // Allows to automatically instantiate createClient with right options",
  "  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)",
  "  __InternalSupabase: {",
  '    PostgrestVersion: "14.5";',
  "  };",
  "  public: {",
  "    Tables: {",
);

for (const table of [...byTable.keys()].sort()) {
  const cols = byTable.get(table);
  out.push(`      ${key(table)}: {`);

  const emit = (label, mode) => {
    out.push(`        ${label}: {`);
    for (const c of [...cols].sort((a, b) => a.column_name.localeCompare(b.column_name))) {
      const t = tsType(c);
      const nullable = c.is_nullable ? " | null" : "";
      let optional;
      if (mode === "row") optional = false;
      else if (mode === "update") optional = true;
      else optional = c.is_nullable || c.has_default;
      out.push(`          ${key(c.column_name)}${optional ? "?" : ""}: ${t}${nullable};`);
    }
    out.push("        };");
  };

  emit("Row", "row");
  emit("Insert", "insert");
  emit("Update", "update");

  const rels = fksByTable.get(table) ?? [];
  if (rels.length === 0) {
    out.push("        Relationships: [];");
  } else {
    out.push("        Relationships: [");
    for (const r of rels) {
      out.push(
        "          {",
        `            foreignKeyName: ${JSON.stringify(r.name)};`,
        `            columns: [${r.columns.map((c) => JSON.stringify(c)).join(", ")}];`,
        `            isOneToOne: ${r.is_one_to_one};`,
        `            referencedRelation: ${JSON.stringify(r.referenced_relation)};`,
        `            referencedColumns: [${r.referenced_columns.map((c) => JSON.stringify(c)).join(", ")}];`,
        "          },",
      );
    }
    out.push("        ];");
  }
  out.push("      };");
}

out.push("    };", "    Views: {", "      [_ in never]: never;", "    };", "    Functions: {");

const SQL_TO_TS = {
  boolean: "boolean",
  integer: "number",
  bigint: "number",
  numeric: "number",
  text: "string",
  uuid: "string",
  void: "undefined",
};
for (const f of functions) {
  const args = f.args
    ? f.args
        .split(", ")
        .filter(Boolean)
        .map((a) => {
          const [n, ...rest] = a.split(" ");
          const sql = rest.join(" ");
          const ts = enumNames.has(sql.replace(/^public\./, ""))
            ? `Database["public"]["Enums"]["${sql.replace(/^public\./, "")}"]`
            : (SQL_TO_TS[sql] ?? "unknown");
          return `${key(n)}: ${ts}`;
        })
    : [];
  const ret = f.returns.replace(/^SETOF /, "");
  const retTs = enumNames.has(ret.replace(/^public\./, ""))
    ? `Database["public"]["Enums"]["${ret.replace(/^public\./, "")}"]`
    : (SQL_TO_TS[ret] ?? "unknown");
  out.push(
    `      ${key(f.name)}: {`,
    args.length ? `        Args: { ${args.join("; ")} };` : "        Args: Record<PropertyKey, never>;",
    `        Returns: ${retTs}${f.returns.startsWith("SETOF ") ? "[]" : ""};`,
    "      };",
  );
}

out.push("    };", "    Enums: {");
for (const e of enums) {
  out.push(`      ${key(e.name)}: ${e.values.map((v) => JSON.stringify(v)).join(" | ")};`);
}
out.push("    };", "    CompositeTypes: {", "      [_ in never]: never;", "    };", "  };", "};", "");

// The helper types below Database are static Supabase boilerplate; keep the
// copy that is already in the repo rather than reimplementing it.
const existing = readFileSync(OUT, "utf8");
const boilerplateStart = existing.indexOf("type DatabaseWithoutInternals = Omit<Database,");
const constantsStart = existing.indexOf("export const Constants = {");
out.push(existing.slice(boilerplateStart, constantsStart).trimEnd(), "");

out.push("export const Constants = {", "  public: {", "    Enums: {");
for (const e of enums) {
  out.push(`      ${key(e.name)}: [${e.values.map((v) => JSON.stringify(v)).join(", ")}],`);
}
out.push("    },", "  },", "} as const;", "");

writeFileSync(OUT, out.join("\n"));
console.error(
  `${OUT}: ${byTable.size} tables, ${enums.length} enums, ${functions.length} functions`,
);
