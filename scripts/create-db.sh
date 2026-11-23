#!/usr/bin/env bash
# Creates the sidequest database and its own login role on a local Postgres.
# Run it once, in your own terminal: it asks for your Postgres admin password,
# which never leaves psql. The app's password is generated here and saved to .env.
#
#   bash scripts/create-db.sh            # admin user defaults to "postgres"
#   PGADMIN=me PSQL=/path/to/psql bash scripts/create-db.sh
set -euo pipefail

cd "$(dirname "$0")/.."

ROLE=sidequest
DB=sidequest
HOST=${PGHOST:-localhost}
PORT=${PGPORT:-5432}
ADMIN=${PGADMIN:-postgres}

# Find psql: $PSQL, then PATH, then the default Windows install location.
if [ -z "${PSQL:-}" ]; then
  if command -v psql >/dev/null 2>&1; then
    PSQL=psql
  else
    PSQL=$(ls "/c/Program Files/PostgreSQL/"*/bin/psql.exe 2>/dev/null | sort -V | tail -1 || true)
  fi
fi
if [ -z "${PSQL:-}" ]; then
  echo "psql not found. Install PostgreSQL, or use Docker: docker compose up -d" >&2
  exit 1
fi

# Reuse the password already in .env, or generate a new one.
if [ -f .env ] && grep -q '^DATABASE_URL=' .env; then
  PW=$(sed -n 's#^DATABASE_URL=postgres://[^:]*:\([^@]*\)@.*#\1#p' .env)
  echo "Using the password already in .env"
else
  PW=$(node -e "process.stdout.write(require('crypto').randomBytes(18).toString('base64url'))")
  [ -f .env ] || cp .env.example .env
  tmp=$(mktemp)
  grep -v '^DATABASE_URL=' .env > "$tmp" || true
  echo "DATABASE_URL=postgres://$ROLE:$PW@$HOST:$PORT/$DB" >> "$tmp"
  mv "$tmp" .env
  echo "Wrote DATABASE_URL to .env"
fi

echo "Connecting as $ADMIN@$HOST:$PORT (psql will ask for the admin password)..."
"$PSQL" -h "$HOST" -p "$PORT" -U "$ADMIN" -d postgres -v ON_ERROR_STOP=1 -v pw="$PW" -q <<SQL
SELECT format('CREATE ROLE $ROLE LOGIN PASSWORD %L', :'pw')
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$ROLE') \gexec
SELECT format('ALTER ROLE $ROLE LOGIN PASSWORD %L', :'pw') \gexec
SELECT 'CREATE DATABASE $DB OWNER $ROLE'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB') \gexec
SQL

echo "Done: database '$DB' with role '$ROLE' is ready."
