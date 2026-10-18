#!/bin/bash
set -euo pipefail
[[ "$(cat "$PGDATA/PG_VERSION")" == "18" ]]
gosu postgres pg_ctl -D "$PGDATA" -l /tmp/bs-postgres.log -o "-p 55441 -c listen_addresses=127.0.0.1 -c max_connections=40" -w start
stop_fixture() { gosu postgres pg_ctl -D "$PGDATA" -m fast -w stop; exit 0; }
trap stop_fixture TERM INT
while true; do sleep 1 & wait $! || true; done
