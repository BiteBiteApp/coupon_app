#!/bin/zsh
set -eu
export BS_PERF_SOURCE="$PWD/baseline-source"
export BS_PERF_OBSERVER="$PWD/observer.cjs"
export BS_POSTGIS_FLUTTER_TIMINGS="$PWD/trace-heavy-operations.jsonl"
export BS_PERF_RUN=traceheavy
export BS_PERF_OUTPUT="$PWD/trace-heavy-native.json"
export BS_PERF_NOW=2026-10-19T23:00:00Z
export BS_PERF_SQL_WAITS="$PWD/trace-heavy-sql-waits.json"
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8088
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
NODE=/Users/colesmart/.codex/reports/BS-NATIONWIDE-SEARCH-READ-MODEL-PROOF-001-20261001-123527-EDT/runtime/node
$NODE sql-waits.cjs > trace-heavy-sql-waits.log 2>&1 &
SAMPLER_PID=$!
trap 'kill -TERM $SAMPLER_PID 2>/dev/null || true' EXIT
BS_PERF_CPU_PROFILE="$PWD/trace-heavy.cpuprofile" $NODE native-probe.cjs > trace-heavy-native.log 2>&1
kill -TERM $SAMPLER_PID
wait $SAMPLER_PID
trap - EXIT
