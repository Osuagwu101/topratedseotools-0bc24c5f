#!/usr/bin/env bash
# Optional: save the current rows of every application table as CSV files.
#
# Run this against the OLD database (the PG* connection variables must be set),
# then load the CSVs into the new project table by table, in the same order.
#
#   bash migrate/export-data.sh ./data-export
#
# Notes
# - Only tables in the `public` schema are exported. Login accounts live in the
#   `auth` schema and must be moved with Supabase's Auth Admin API instead.
# - Some tables hold credentials and payment records. Treat the output folder as
#   sensitive: keep it off shared drives and delete it once the move is done.

set -euo pipefail
OUT="${1:-./data-export}"
mkdir -p "$OUT"

# Parent tables first so foreign keys resolve on import.
TABLES=$(psql -At -c "
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name;
")

for t in $TABLES; do
  echo "exporting $t"
  psql -c "\copy (SELECT * FROM public.\"$t\") TO '$OUT/$t.csv' WITH CSV HEADER"
done

echo "done -> $OUT"
