import copy
import json
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from freeze import freeze, verify
from guard import Rejected, digest, owned_resource, permit, watchdog
from ledger import LocalLedger
import test_guard


class Controls(unittest.TestCase):
    def setUp(self):
        baseline = test_guard.Safety()
        baseline.setUp()
        self.c, self.a, self.s, self.r = baseline.c, baseline.a, baseline.s, baseline.r
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'ledger.sqlite'

    def ledger(self):
        ledger = LocalLedger(self.path)
        self.addCleanup(ledger.close)
        return ledger

    def running(self):
        ledger = self.ledger()
        ledger.create(self.c, self.a, 1000)
        ledger.compare_and_set(1, lambda state: {**state, 'status': 'running'})
        return ledger

    def test_restart_retains_original_clock_and_cost(self):
        ledger = self.running()
        result = ledger.reserve(self.c, self.a, self.r, 1010)
        reopened = self.ledger()
        self.assertEqual(reopened.read(), {'version': result['version'], 'state': result['state']})
        with self.assertRaises(Rejected):
            reopened.create(self.c, self.a, 2000)
        self.assertEqual(reopened.read()['state']['firstBillableAt'], 1000)

    def test_exact_replay_never_runs_twice(self):
        ledger = self.running()
        first = ledger.reserve(self.c, self.a, self.r, 1010)
        replay = ledger.reserve(self.c, self.a, self.r, 1011)
        self.assertTrue(first['executeAllowed'])
        self.assertFalse(replay['executeAllowed'])
        self.assertEqual(first['state']['costUpper'], replay['state']['costUpper'])
        changed = {**self.r, 'costUpper': 2}
        with self.assertRaises(Rejected):
            ledger.reserve(self.c, self.a, changed, 1011)

    def test_concurrent_duplicate_reservations_have_one_winner(self):
        self.running()
        def reserve(_):
            ledger = LocalLedger(self.path)
            try:
                return ledger.reserve(self.c, self.a, self.r, 1010)
            finally:
                ledger.close()
        with ThreadPoolExecutor(max_workers=4) as workers:
            results = list(workers.map(reserve, range(4)))
        self.assertEqual(sum(result['executeAllowed'] for result in results), 1)
        self.assertEqual(self.ledger().read()['state']['counts']['requests'], 1)

    def test_atomic_transition_failure_rolls_back(self):
        ledger = self.running()
        before = ledger.read()
        def failure(state):
            state['costUpper'] = 99
            raise RuntimeError('interrupted before durable commit')
        with self.assertRaises(RuntimeError):
            ledger.compare_and_set(before['version'], failure)
        self.assertEqual(ledger.read(), before)

    def test_stale_generation_and_mutated_deadline_rejected(self):
        ledger = self.running()
        with self.assertRaises(Rejected):
            ledger.compare_and_set(1, lambda state: state)
        def reset(state):
            state['deadline'] += 1
            return state
        with self.assertRaises(Rejected):
            ledger.compare_and_set(2, reset)
        self.assertEqual(ledger.read()['state']['deadline'], 260200)

    def test_early_100_checkpoint_cannot_be_crossed(self):
        self.s['costUpper'] = 99
        with self.assertRaisesRegex(Rejected, '\\$100 checkpoint'):
            permit(self.c, self.a, self.s, self.r, 1010)
        keys = ('runId', 'configDigest', 'candidateDigest', 'firstBillableAt', 'deadline')
        self.s['earlyApprovalReceipt'] = {key: self.s[key] for key in keys}
        self.s['earlyApprovalReceipt'].update(ownerApprovalReference='MOCK ONLY', approvedBeyondUsd=100)
        self.assertEqual(permit(self.c, self.a, self.s, self.r, 1010)['costUpper'], 100)
        self.s['earlyApprovalReceipt']['deadline'] += 1
        with self.assertRaises(Rejected):
            permit(self.c, self.a, self.s, self.r, 1010)

    def test_early_checkpoint_includes_indirect_forecast_at_boundary(self):
        self.r.update(costUpper=0, remainingHoldUpper=0, delayedChargeUpper=0)
        for liability in ('remainingHoldUpper', 'delayedChargeUpper', 'cleanupReserveUsd'):
            with self.subTest(liability=liability):
                config, request = copy.deepcopy(self.c), copy.deepcopy(self.r)
                config['cleanupReserveUsd'] = 0
                self.s['costUpper'] = 99
                if liability == 'cleanupReserveUsd':
                    config[liability] = 1
                else:
                    request[liability] = 1
                approval = {**self.a, 'configDigest': digest(config)}
                state = {**self.s, 'configDigest': digest(config)}
                with self.assertRaisesRegex(Rejected, '\\$100 checkpoint'):
                    permit(config, approval, state, request, 1010)
                state['costUpper'] = 98.99
                self.assertEqual(permit(config, approval, state, request, 1010)['costUpper'], 98.99)

    def test_future_heartbeat_pauses_independent_watchdog(self):
        self.s['heartbeatAt'] = 1011
        self.assertEqual(watchdog(self.c, self.s, 1010), 'pause-load-stop-sql-and-alert')
        with self.assertRaises(Rejected):
            permit(self.c, self.a, self.s, self.r, 1010)

    def test_receipt_cannot_substitute_other_resource_incarnation(self):
        resource = {'kind': 'sql.instance', 'id': 'bs-db', 'uid': 'first', 'createTime': 1000, 'disposable': True}
        self.c['resources'] = [resource]
        replacement = {**resource, 'uid': 'replacement'}
        observed = {**replacement, 'projectId': self.c['projectId'], 'runId': self.c['runId']}
        with self.assertRaises(Rejected):
            owned_resource(self.c, replacement, observed)

    def test_lifetime_and_connections_and_missing_alert_stop_launch(self):
        for change in ('lifetime', 'connections', 'alert'):
            with self.subTest(change=change):
                config = copy.deepcopy(self.c)
                if change == 'lifetime':
                    config['lifetimeSeconds'] = 259201
                elif change == 'connections':
                    config['application']['poolPerInstance'] = 8
                else:
                    config['alertRecipients'] = []
                approval = {**self.a, 'configDigest': digest(config)}
                with self.assertRaises(Rejected):
                    self.ledger().create(config, approval, 1000)

    def test_bounded_unreconciled_metadata(self):
        self.s['reservationIds'] = [str(i) for i in range(self.c['maxOutstandingReservations'])]
        with self.assertRaises(Rejected):
            permit(self.c, self.a, self.s, self.r, 1010)

    def test_source_freeze_detects_post_qualification_edits(self):
        root = Path(self.temp.name)
        (root / 'source.ts').write_text('public source')
        manifest = root / 'manifest.json'
        manifest.write_text(json.dumps(freeze(root, ['source.ts'])))
        verify(root, manifest)
        (root / 'source.ts').write_text('later edit')
        with self.assertRaises(Rejected):
            verify(root, manifest)

    def test_source_freeze_rejects_credentials_and_escape(self):
        root = Path(self.temp.name)
        (root / '.env').write_text('synthetic test')
        for path in ['../outside.ts', str(root / '.env'), '.env']:
            with self.subTest(path=path), self.assertRaises(Rejected):
                freeze(root, [path])

    def guard_cli_fixture(self):
        root = Path(self.temp.name) / 'repository'
        package = root / 'tool' / 'postgis_staging'
        scripts = package / 'scripts'
        scripts.mkdir(parents=True)
        for name in ('guard.py', 'freeze.py'):
            (scripts / name).write_bytes((Path(__file__).parent / name).read_bytes())
        (package / 'config').mkdir()
        (package / 'config' / 'staging.json').write_text('{}')
        (root / 'source.ts').write_text('synthetic qualified source')
        manifest = package / 'candidate-manifest.v3.json'
        manifest.write_text(json.dumps(freeze(root, ['source.ts'])))
        return scripts / 'guard.py', package, manifest

    def run_guard_cli(self, script, *arguments):
        return subprocess.run([sys.executable, str(script), *map(str, arguments)],
                              capture_output=True, text=True, check=False)

    def test_guard_explicit_manifest_ignores_stale_default_and_newer_names(self):
        script, package, manifest = self.guard_cli_fixture()
        (package / 'candidate-manifest.json').write_text('obsolete manifest')
        (package / 'candidate-manifest.v99.json').write_text('unqualified newer name')
        result = self.run_guard_cli(script, '--manifest', manifest)
        self.assertEqual(result.returncode, 0, result.stderr)
        response = json.loads(result.stdout)
        self.assertTrue(response['candidateVerified'])
        self.assertFalse(response['cloudReady'])
        self.assertEqual(response['candidateDigest'], json.loads(manifest.read_text())['candidateDigest'])

    def test_guard_selected_tampered_manifest_cannot_fall_back(self):
        script, package, manifest = self.guard_cli_fixture()
        (package / 'candidate-manifest.json').write_bytes(manifest.read_bytes())
        changed = json.loads(manifest.read_text())
        changed['sha256']['source.ts'] = '0' * 64
        manifest.write_text(json.dumps(changed))
        result = self.run_guard_cli(script, '--manifest', manifest)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('candidate changed after freeze', result.stderr)

    def test_guard_no_manifest_keeps_original_default(self):
        script, package, manifest = self.guard_cli_fixture()
        (package / 'candidate-manifest.json').write_bytes(manifest.read_bytes())
        manifest.write_text('newer names are never chosen implicitly')
        result = self.run_guard_cli(script)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['candidateVerified'])

    def test_guard_selected_valid_manifest_never_enables_execute(self):
        script, _, manifest = self.guard_cli_fixture()
        result = self.run_guard_cli(script, '--manifest', manifest, '--mode', 'execute')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('NO CLOUD EXECUTOR IN THIS PACKAGE', result.stderr)


if __name__ == '__main__':
    unittest.main()
