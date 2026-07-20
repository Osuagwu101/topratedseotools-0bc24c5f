/**
 * Minimal in-memory mock of the Supabase JS client surface used by
 * `handlePaystackWebhook`. Supports only the query chains actually invoked:
 *   from(table).insert(row).select(...).maybeSingle()
 *   from(table).select(cols).eq(col,val).maybeSingle()
 *   from(table).update(patch).eq(col,val).in(col,vals).select().maybeSingle()
 *   from(table).update(patch).eq(col,val).neq(col,val)
 *
 * Unique constraints enforced per-table by column name.
 * Not a general-purpose mock — just enough for these tests.
 */
import { randomUUID } from "crypto";

type Row = Record<string, any>;
type Filter = { kind: "eq" | "neq" | "in"; col: string; val: any };

export interface MockDbOptions {
  uniqueColumns?: Record<string, string[]>; // table -> unique column names
}

export class MockDb {
  tables: Record<string, Row[]> = {};
  uniqueColumns: Record<string, string[]>;

  constructor(opts: MockDbOptions = {}) {
    this.uniqueColumns = opts.uniqueColumns ?? {};
  }

  seed(table: string, rows: Row[]) {
    this.tables[table] = (this.tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
  }

  all(table: string): Row[] {
    return this.tables[table] ?? [];
  }

  from(table: string) {
    this.tables[table] ??= [];
    return new QueryBuilder(this, table);
  }
}

type Mode =
  | { kind: "select"; cols: string }
  | { kind: "insert"; row: Row; returning?: string }
  | { kind: "update"; patch: Row; returning?: string };

class QueryBuilder {
  private filters: Filter[] = [];
  private mode: Mode | null = null;

  constructor(
    private db: MockDb,
    private table: string,
  ) {}

  select(cols = "*") {
    if (!this.mode) this.mode = { kind: "select", cols };
    else (this.mode as any).returning = cols;
    return this;
  }
  insert(row: Row) {
    this.mode = { kind: "insert", row };
    return this;
  }
  update(patch: Row) {
    this.mode = { kind: "update", patch };
    return this;
  }
  eq(col: string, val: any) {
    this.filters.push({ kind: "eq", col, val });
    return this;
  }
  neq(col: string, val: any) {
    this.filters.push({ kind: "neq", col, val });
    return this;
  }
  in(col: string, vals: any[]) {
    this.filters.push({ kind: "in", col, val: vals });
    return this;
  }

  private matches(row: Row): boolean {
    for (const f of this.filters) {
      if (f.kind === "eq" && row[f.col] !== f.val) return false;
      if (f.kind === "neq" && row[f.col] === f.val) return false;
      if (f.kind === "in" && !(f.val as any[]).includes(row[f.col])) return false;
    }
    return true;
  }

  private async run(): Promise<{ data: any; error: any }> {
    const rows = this.db.tables[this.table] ?? [];
    if (!this.mode) return { data: null, error: null };

    if (this.mode.kind === "insert") {
      const uniq = this.db.uniqueColumns[this.table] ?? [];
      for (const col of uniq) {
        if (
          this.mode.row[col] !== undefined &&
          rows.some((r) => r[col] === this.mode!.row[col] as any)
        ) {
          return {
            data: null,
            error: { message: `duplicate key on ${col}`, code: "23505" },
          };
        }
      }
      const newRow = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        processing_attempts: 0,
        ...this.mode.row,
      };
      rows.push(newRow);
      return { data: { ...newRow }, error: null };
    }

    if (this.mode.kind === "update") {
      const patch = this.mode.patch;
      const matched: Row[] = [];
      for (const row of rows) {
        if (this.matches(row)) {
          Object.assign(row, patch);
          matched.push(row);
        }
      }
      return {
        data: matched.length > 0 ? { ...matched[0] } : null,
        error: null,
      };
    }

    // select
    const matched = rows.filter((r) => this.matches(r)).map((r) => ({ ...r }));
    return { data: matched[0] ?? null, error: null };
  }

  async maybeSingle() {
    return this.run();
  }
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: (v: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>,
    onrejected?: (r: any) => TResult2 | PromiseLike<TResult2>,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled as any, onrejected);
  }
}
