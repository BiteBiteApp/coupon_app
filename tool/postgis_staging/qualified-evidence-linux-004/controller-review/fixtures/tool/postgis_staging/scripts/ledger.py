"""Durable LOCAL staging-control qualification adapter; no cloud access.

The same transition functions are usable behind a later generation-CAS cloud
store. This SQLite adapter proves restart/concurrent-reservation behavior on one
host; it does not claim distributed Google Cloud control-plane qualification.
"""
import copy
import json
import sqlite3
from contextlib import contextmanager

from guard import Rejected, digest, launch, need, permit


class LocalLedger:
    def __init__(self, path):
        self.db = sqlite3.connect(str(path), timeout=5, isolation_level=None)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS run (
                id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL,
                state TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reservation (
                id TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
                state_version INTEGER NOT NULL
            );
        ''')

    def close(self):
        self.db.close()

    @contextmanager
    def transaction(self):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            yield
            self.db.execute('COMMIT')
        except BaseException:
            self.db.execute('ROLLBACK')
            raise

    def read(self):
        row = self.db.execute('SELECT version,state FROM run WHERE id=1').fetchone()
        return None if row is None else {'version': row[0], 'state': json.loads(row[1])}

    def create(self, config, approval, now):
        with self.transaction():
            previous = self.read()
            state = launch(config, approval, previous, now)
            self.db.execute('INSERT INTO run VALUES (1,1,?)', (json.dumps(state),))
        return {'version': 1, 'state': state}

    def compare_and_set(self, expected_version, transition):
        with self.transaction():
            current = self.read()
            need(current is not None and current['version'] == expected_version, 'stale ledger generation')
            state = transition(copy.deepcopy(current['state']))
            # A controller restart, pause, config change or cleanup cannot reset time.
            for key in ('runId', 'projectId', 'configDigest', 'candidateDigest', 'firstBillableAt', 'deadline'):
                need(state.get(key) == current['state'][key], 'immutable ledger field changed: ' + key)
            version = current['version'] + 1
            self.db.execute('UPDATE run SET version=?,state=? WHERE id=1', (version, json.dumps(state)))
        return {'version': version, 'state': state}

    def reserve(self, config, approval, request, now):
        with self.transaction():
            current = self.read()
            need(current is not None, 'run not created')
            old = self.db.execute('SELECT request_hash FROM reservation WHERE id=?', (request['reservationId'],)).fetchone()
            if old is not None:
                need(old[0] == digest(request), 'conflicting reservation replay')
                # A replay only confirms accounting. It never authorizes re-execution.
                return {**current, 'alreadyReserved': True, 'executeAllowed': False}
            state = permit(config, approval, current['state'], request, now)
            version = current['version'] + 1
            self.db.execute('UPDATE run SET version=?,state=? WHERE id=1', (version, json.dumps(state)))
            self.db.execute('INSERT INTO reservation VALUES (?,?,?)', (request['reservationId'], digest(request), version))
        return {'version': version, 'state': state, 'alreadyReserved': False, 'executeAllowed': True}
