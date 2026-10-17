"""One approved staging run, durable CAS intents and independent safety ticks.

No timers, credential lookup, I/O, or cloud calls at import. Public methods are
explicit execution operations. Tests inject fake clocks and local transports.
"""
import copy
import json
import os
from pathlib import Path
import subprocess

from cloud_provider import ProviderError, canonical, configuration_bytes
from guard import Rejected, digest, launch, need, number, permit, project_check, watchdog

IMMUTABLE = ('runId', 'projectId', 'configDigest', 'candidateDigest', 'firstBillableAt', 'deadline')


class SignedApproval:
    """Bounded offline Node Ed25519 verifier; trusted public keys are a separate file."""
    def __init__(self, config, envelope, node, verifier, trusted_keys, clock):
        configuration_bytes(config)
        self.config, self.envelope = copy.deepcopy(config), copy.deepcopy(envelope)
        self.node, self.verifier, self.trusted_keys = map(Path, (node, verifier, trusted_keys))
        self.clock = clock
        for item in (self.node, self.verifier, self.trusted_keys):
            need(item.is_absolute() and item.is_file(), 'missing explicit verifier dependency')

    def verify(self, gate=1, cleanup=False):
        project_check(self.config)
        expected = {key: self.config[key] for key in ('projectId', 'projectNumber', 'runId', 'candidateDigest')}
        expected.update(configDigest=digest(self.config), gate=gate,
                        purpose='cleanup' if cleanup else 'execute', nowMs=int(self.clock() * 1000))
        # No inherited Node preload flags, shell, stdin trust keys or credentials.
        env = {'PATH': os.defpath}
        result = subprocess.run([str(self.node), str(self.verifier), str(self.trusted_keys)],
            input=canonical({'approval': self.envelope, 'expected': expected}),
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5, env=env)
        need(result.returncode == 0 and len(result.stdout) < 32768, 'execution approval rejected')
        response = json.loads(result.stdout)
        need(response.get('verified') is True, 'execution approval rejected')
        claims = response['claims']
        # The legacy pure guards consume this verified view, never a raw boolean.
        return {'approved': True, 'ownerApprovalReference': self.envelope['keyId'],
                'runId': claims['runId'], 'projectId': claims['projectId'],
                'configDigest': claims['configDigest'], 'candidateDigest': claims['candidateDigest'],
                'validUntil': claims['validUntilMs'] / 1000,
                'cleanupUntil': claims['cleanupUntilMs'] / 1000,
                'approvedGates': claims['allowedGates'],
                'costCheckpointUsd': claims.get('costCheckpointUsd'),
                'supervisedControlBootstrap': self.config['provider'].get('supervisedControlBootstrap') is True}


class Controller:
    def __init__(self, config, approval, store, resources, clock, cleanup_only=False):
        configuration_bytes(config)
        project_check(config)
        need(config['provider'].get('enabled') is True, 'provider execution disabled')
        need(config['region'] == 'us-central1', 'unapproved region')
        need(isinstance(config['provider']['resources'], list) and 0 < len(config['provider']['resources']) <= 12,
             'bounded exact resource plan required')
        ceilings = {'approvedForecastUsd': 300, 'activeLoadSeconds': 21600,
            'lifetimeSeconds': 259200, 'maxSearchStorageGiB': 100,
            'maxEvidenceStorageGiB': 5, 'maxArtifactStorageGiB': 2,
            'maxOutstandingReservations': 1000, 'bootstrapAllowanceUsd': 5}
        for key, maximum in ceilings.items():
            need(number(config.get(key)) and 0 < config[key] <= maximum, 'fixed ceiling exceeded: ' + key)
        need(config['cleanupReserveUsd'] >= 30 and config['earlyApprovalCheckpointUsd'] == 100,
             'cleanup/checkpoint reserve weakened')
        for key, maximum in {'requests':1000000, 'usefulPages':100000, 'reads':200000000,
                             'writes':40000000, 'deletes':30000000}.items():
            need(type(config['caps'].get(key)) is int and 0 <= config['caps'][key] <= maximum, 'operation ceiling exceeded')
        specs = config['provider']['resources']
        need(len({(r['kind'], r['id']) for r in specs}) == len(specs), 'duplicate resource plan')
        self.config, self.approval, self.store = copy.deepcopy(config), approval, store
        self.resources, self.clock = resources, clock
        self.cleanup_only = cleanup_only
        self.approval.verify(5 if cleanup_only else 1, cleanup_only)  # Before any token lookup.
        cleanup = self.approval.verify(5, True)
        need(5 in cleanup['approvedGates'] and number(cleanup.get('cleanupUntil')) and
             cleanup['cleanupUntil'] >= config['provider']['firstBillableAtMs'] / 1000 + config['lifetimeSeconds'] + 7200,
             'signed cleanup authority must cover original deadline and bounded reconciliation')

    def _read(self, cleanup=False):
        need(not self.cleanup_only or cleanup, 'watchdog cannot admit paid work')
        self.approval.verify(5 if cleanup else 1, cleanup)
        current = self.store.read()
        need(current is not None, 'no durable staging run')
        state = current['state']
        for key in ('projectId', 'runId', 'candidateDigest'):
            need(state.get(key) == self.config[key], 'wrong durable run ' + key)
        need(state.get('configDigest') == digest(self.config), 'wrong durable config')
        need(state['firstBillableAt'] == self.config['provider']['firstBillableAtMs'] / 1000, 'signed original start changed')
        need(state['deadline'] == state['firstBillableAt'] + self.config['lifetimeSeconds'], 'reset deadline')
        need(state.get('schemaVersion') == 1 and isinstance(state.get('intents'), dict), 'invalid controller state')
        return current

    def _cas(self, current, state):
        for key in IMMUTABLE:
            need(state.get(key) == current['state'].get(key), 'immutable control field ' + key)
        return self.store.write(current['generation'], state)

    def start(self):
        need(not self.cleanup_only, 'watchdog cannot start a run')
        approved = self.approval.verify()
        # Fixed in the signed plan BEFORE any bootstrap deployment. This also
        # counts control-plane setup time, never the time of a later CAS retry.
        started = self.config['provider']['firstBillableAtMs'] / 1000
        need(number(started) and started <= self.clock(), 'missing/future bootstrap start')
        prior = self.store.read()
        if prior is not None:
            return self._read()
        need(self.clock() - started < self.config['bootstrapMaximumSeconds'], 'bootstrap initialization window expired')
        proposed = launch(self.config, approved, None, started)
        proposed.update(schemaVersion=1, intents={}, receipts={}, operations={}, polls={},
                        absent={}, alertReceipts=[], reservationDigests={})
        try:
            return self.store.write('0', proposed)
        except ProviderError as error:
            if error.status not in (None, 409, 412):
                raise
            current = self._read()
            need(current['state']['firstBillableAt'] <= started, 'unreconciled initial create')
            return current

    def confirm_controls(self, receipt):
        from guard import confirm_controls
        current = self._read()
        state = copy.deepcopy(current['state'])
        # The supervised shutdown drill may have paused bootstrap admission.
        if state['status'] == 'paused' and state.get('bootstrapDeadline') and not state['controlsVerified']:
            need(bool(state['absent']), 'shutdown drill has no verified owned absence')
            state['status'] = 'supervised-bootstrap'
        updated = confirm_controls(self.config, self.approval.verify(), state, receipt, self.clock())
        return self._cas(current, updated)

    def complete_gate(self, gate, evidence_digest):
        import re
        self.approval.verify(gate)
        current = self._read(); state = copy.deepcopy(current['state'])
        need(gate in (1, 2, 3, 4) and all(g in state['completedGates'] for g in range(gate)), 'out-of-order gate')
        need(state['controlsVerified'] and state['status'] == 'running' and re.fullmatch(r'[0-9a-f]{64}', evidence_digest), 'gate proof missing')
        if gate not in state['completedGates']: state['completedGates'].append(gate)
        prior = state.setdefault('gateEvidence', {}).get(str(gate))
        need(prior in (None, evidence_digest), 'gate evidence changed')
        state['gateEvidence'][str(gate)] = evidence_digest
        return self._cas(current, state)

    def begin_work(self):
        current = self._read()
        need(current['state']['status'] == 'provisioning' and current['state']['controlsVerified'] is True,
             'actual alert/shutdown proof required')
        state = copy.deepcopy(current['state']); state['status'] = 'running'
        return self._cas(current, state)

    def confirm_early_checkpoint(self, separate_approval):
        approved = separate_approval.verify()
        need(approved.get('costCheckpointUsd') == 100 and
             digest(separate_approval.envelope) != digest(self.approval.envelope),
             'new signed owner $100 checkpoint required')
        current = self._read(); state = copy.deepcopy(current['state'])
        for key in ('runId', 'projectId', 'candidateDigest', 'configDigest'):
            need(approved[key] == state[key], 'checkpoint approval identity mismatch')
        state['earlyApprovalReceipt'] = {key: state[key] for key in IMMUTABLE}
        state['earlyApprovalReceipt'].update(approvedBeyondUsd=100,
            ownerApprovalReference=approved['ownerApprovalReference'] + ':' + digest(separate_approval.envelope))
        return self._cas(current, state)

    def reserve_create(self, resource, request):
        self.resources.spec(resource)
        need(request == resource.get('createReservation'), 'create reservation differs from signed cost plan')
        approved = self.approval.verify(request['gate'])
        current = self._read(); state = current['state']
        key = resource['kind'] + '/' + resource['id']
        old = state['intents'].get(key)
        if old is not None:
            need(old['resourceDigest'] == digest(resource) and old['requestDigest'] == digest(request), 'conflicting create replay')
            return {'executeAllowed': False, 'reconcileRequired': True}
        bootstrap = state['status'] == 'supervised-bootstrap'
        admission = copy.deepcopy(state)
        if bootstrap:
            need(request['gate'] == 1 and approved['supervisedControlBootstrap'] is True and
                 self.clock() < state['bootstrapDeadline'], 'supervised bootstrap expired')
            need(state.get('bootstrapSpent', 0) + request['costUpper'] <= self.config['bootstrapAllowanceUsd'], 'bootstrap allowance exhausted')
            admission.update(status='running', controlsVerified=True)
        updated = self._permit(approved, admission, request)
        if bootstrap:
            updated.update(status='supervised-bootstrap', controlsVerified=False,
                           bootstrapSpent=state.get('bootstrapSpent', 0) + request['costUpper'],
                           costUpper=state['costUpper'])  # Already reserved the full $5 before bootstrap.
            updated['phaseUsed']['1'] = state['phaseUsed']['1']  # Same prepaid bootstrap liability.
        updated['intents'][key] = {'resourceDigest': digest(resource), 'requestDigest': digest(request),
                                   'phase': 'reserved', 'reservationId': request['reservationId']}
        updated['reservationDigests'][request['reservationId']] = digest(request)
        self._cas(current, updated)
        return {'executeAllowed': True, 'reconcileRequired': False}

    def _permit(self, approved, state, request):
        conservative = copy.deepcopy(request)
        # Holding and delayed-charge liabilities cannot disappear because the next
        # caller supplies a smaller estimate. No automatic refunds are implemented.
        for key in ('remainingHoldUpper', 'delayedChargeUpper'):
            need(number(request.get(key)), 'missing conservative liability')
            conservative[key] = max(request[key], state.get(key, 0))
        updated = permit(self.config, approved, state, conservative, self.clock())
        for key in ('remainingHoldUpper', 'delayedChargeUpper'): updated[key] = conservative[key]
        return updated

    def create_once(self, resource):
        """CAS the one allowed attempt before sending. Lost responses never replay."""
        current = self._read(); state = copy.deepcopy(current['state'])
        key = resource['kind'] + '/' + resource['id']
        intent = state['intents'].get(key)
        need(intent is not None and intent['resourceDigest'] == digest(resource), 'unreserved create')
        need(state['status'] in ('running', 'supervised-bootstrap') and self.clock() < state['deadline'], 'inactive run')
        if state['status'] == 'supervised-bootstrap':
            need(self.clock() < state['bootstrapDeadline'], 'bootstrap expired')
        if intent['phase'] != 'reserved':
            return self.reconcile_create(resource)
        need(self.resources.get(resource) is None, 'resource already exists; never adopt by name')
        intent['phase'] = 'sent'; intent['sentAt'] = self.clock()
        self.approval.verify(resource['createReservation']['gate'])
        need(number(state.get('heartbeatAt')) and 0 <= self.clock() - state['heartbeatAt'] <= self.config['heartbeatMaxAgeSeconds'], 'stale accounting before create')
        need(self.clock() < state['deadline'] - self.config['teardownLeadSeconds'], 'teardown margin reached')
        self._cas(current, state)  # On conflict, no resource call is made.
        try:
            operation = self.resources.create(resource)
        except ProviderError:
            # Unknown/permission/validation outcomes retain reservation and intent.
            raise
        current = self._read(); state = copy.deepcopy(current['state'])
        state['operations'][key] = operation
        self._cas(current, state)
        return self.reconcile_create(resource)

    def reconcile_create(self, resource, cleanup=False):
        current = self._read(cleanup); state = copy.deepcopy(current['state'])
        key = resource['kind'] + '/' + resource['id']
        intent = state['intents'].get(key)
        need(intent is not None and intent['phase'] in ('sent', 'observed') and intent['resourceDigest'] == digest(resource), 'no create intent')
        observed = self.resources.get(resource)
        if observed is None:
            return {'state': 'unknown', 'executeAllowed': False}  # No response is not permission to retry.
        receipt = self.resources.identity(resource, observed)
        # Creation follows a prior verified absence and exactly one durable attempt.
        # Firestore lacks labels, so it additionally needs createTime after the intent.
        from datetime import datetime
        created_at = datetime.fromisoformat(receipt['createTime'].replace('Z', '+00:00')).timestamp()
        need(intent['sentAt'] - 5 <= created_at <= self.clock() + 5, 'creation time outside owned attempt')
        existing = state['receipts'].get(key)
        need(existing is None or existing == receipt, 'resource incarnation changed')
        state['receipts'][key] = receipt; state['intents'][key]['phase'] = 'observed'
        self._cas(current, state)
        return {'state': 'observed', 'receipt': receipt}

    def run_job_once(self, resource, request):
        self.resources.spec(resource)
        need(resource['kind'] == 'run.job', 'job only')
        need(request == resource.get('runReservation'), 'job reservation differs from signed cost plan')
        current = self._read(); state = current['state']
        key = resource['kind'] + '/' + resource['id']
        old = state.get('jobRuns', {}).get(key)
        if old is not None:
            need(old['requestDigest'] == digest(request), 'conflicting job retry')
            return {'state': 'reconcile-required', 'executionRepeated': False}
        need(all(item['phase'] == 'completed' for item in state.get('jobRuns', {}).values()),
             'another job is pending; shared eight-connection reserve and sole-writer boundary')
        receipt = state['receipts'].get(key)
        need(receipt is not None, 'unowned job')
        template = resource['body']['template']
        task = template['template']
        timeout = task.get('timeout', '')
        need(template.get('taskCount') == 1 and template.get('parallelism') == 1 and
             task.get('maxRetries') == 0 and timeout.endswith('s') and timeout[:-1].isdigit(), 'unbounded job')
        duration = int(timeout[:-1])
        need(0 < duration <= 600 and request['activeSeconds'] >= duration and
             self.clock() + duration <= state['deadline'] - self.config['teardownLeadSeconds'], 'job duration unreserved')
        approved = self.approval.verify(request['gate'])
        need(self.clock() + duration <= approved['validUntil'], 'job duration exceeds signed execution window')
        state = self._permit(approved, state, request)
        state.setdefault('jobRuns', {})[key] = {'requestDigest': digest(request), 'sentAt': self.clock(), 'phase': 'sent'}
        self._cas(current, state)  # Reserve and record single attempt before POST.
        operation = self.resources.run_job(resource, receipt)
        fresh = self._read(); state = copy.deepcopy(fresh['state'])
        state['operations'][key] = operation
        self._cas(fresh, state)
        return {'state': 'requested', 'executionRepeated': False}

    def reconcile_job_execution(self, resource):
        current = self._read(); state = copy.deepcopy(current['state'])
        key = resource['kind'] + '/' + resource['id']
        run = state.get('jobRuns', {}).get(key)
        need(run is not None and key in state['receipts'], 'missing exact job attempt')
        if run['phase'] == 'completed':
            return {'state':'completed','failed':run['execution']['failed']}
        count = run.get('reconcileCount',0)
        need(count < 120 and self.clock() - run.get('lastReconcileAt',-1000000) >= 5, 'job reconciliation bound/pacing')
        run.update(reconcileCount=count+1,lastReconcileAt=self.clock())
        self._cas(current,state)
        result = self.resources.job_execution(resource,state['receipts'][key],run['sentAt'])
        if result['state'] == 'unknown': return result
        prior = run.get('execution')
        need(prior is None or all(prior[k] == result[k] for k in ('uid','name','createTime')), 'execution incarnation changed')
        current = self._read(); state = copy.deepcopy(current['state'])
        state['jobRuns'][key]['execution'] = result
        if result['state'] == 'completed': state['jobRuns'][key]['phase'] = 'completed'
        self._cas(current,state)
        return {'state':result['state'],'failed':result['failed']}

    def poll_once(self, resource, cleanup=False):
        current = self._read(cleanup); state = copy.deepcopy(current['state'])
        key = resource['kind'] + '/' + resource['id']
        count = state['polls'].get(key, 0)
        need(count < 120, 'provider polling bound reached; supervised reconciliation required')
        last = state.get('lastPollAt', {}).get(key)
        need(last is None or self.clock() - last >= 5, 'provider polling too frequent')
        operation = state['operations'].get(key)
        need(operation is not None, 'unknown provider operation; reconcile exact resource')
        state['polls'][key] = count + 1
        state.setdefault('lastPollAt', {})[key] = self.clock()
        self._cas(current, state)
        return {'done': self.resources.poll(resource, operation), 'nextPollAfterSeconds': 5}

    def heartbeat(self, active_seconds, observed_cost_upper, observed_counts, storage_gib):
        current = self._read(); state = copy.deepcopy(current['state'])
        need(number(active_seconds) and state['activeSeconds'] <= active_seconds <= self.config['activeLoadSeconds'], 'invalid active-load accounting')
        need(number(observed_cost_upper) and state['costUpper'] <= observed_cost_upper <= self.config['approvedForecastUsd'], 'invalid cost accounting')
        need(set(observed_counts) == set(self.config['caps']), 'missing operation accounting')
        for key, maximum in self.config['caps'].items():
            need(type(observed_counts[key]) is int and state['counts'][key] <= observed_counts[key] <= maximum, 'operation cap reached')
        need(number(storage_gib) and storage_gib <= self.config['maxSearchStorageGiB'], 'storage cap reached')
        state.update(activeSeconds=active_seconds, costUpper=observed_cost_upper,
                     counts=observed_counts, heartbeatAt=self.clock())
        return self._cas(current, state)

    def _cleanup_resource_tick(self, resource, teardown):
        """One bounded asynchronous reconciliation step, independent of main runner."""
        key = resource['kind'] + '/' + resource['id']
        current = self._read(cleanup=True); state = current['state']
        if key in state['absent']: return 'absence-previously-verified'
        receipt = state['receipts'].get(key)
        if receipt is None:
            intent = state['intents'].get(key)
            if intent is None or intent['phase'] == 'reserved': return 'no-create-sent'
            result = self.reconcile_create(resource, cleanup=True)
            if result['state'] != 'observed': return 'create-outcome-unresolved'
            current = self._read(cleanup=True); state = current['state']
            receipt = state['receipts'][key]
        prior_operation = state['operations'].get(key)
        if prior_operation is not None and state.get('cleanupAdoptedOperation', {}).get(key) != digest(prior_operation):
            state = copy.deepcopy(state)
            state.setdefault('cleanupAdoptedOperation', {})[key] = digest(prior_operation)
            state.setdefault('cleanupPending', {}).setdefault(key, []).append(prior_operation)
            self._cas(current, state)
            current = self._read(cleanup=True); state = current['state']
        # Persisted operation queue includes lost-main create/run responses and
        # all known cleanup/cancellation operations. Poll one per invocation.
        pending = state.get('cleanupPending', {}).get(key, [])
        if pending:
            state = copy.deepcopy(state)
            polls = state.setdefault('cleanupPolls', {}).get(key, 0)
            need(polls < 120, 'cleanup polling bound; supervised reconciliation required')
            state['cleanupPolls'][key] = polls + 1
            self._cas(current, state)
            done = self.resources.poll(resource, pending[0])
            if not done: return 'provider-operation-pending'
            current = self._read(cleanup=True); state = copy.deepcopy(current['state'])
            state['cleanupPending'][key] = pending[1:]
            self._cas(current, state)
            return 'provider-operation-completed-recheck-required'
        current = self._read(cleanup=True); state = copy.deepcopy(current['state'])
        reads = state.setdefault('cleanupReads', {}).get(key, 0)
        need(reads < 120, 'absence reconciliation bound; supervised reconciliation required')
        state['cleanupReads'][key] = reads + 1
        self._cas(current, state)
        observed = self.resources.owned(resource, receipt)
        if observed is None:
            current = self._read(cleanup=True); state = copy.deepcopy(current['state'])
            state['absent'][key] = {'verifiedAt':self.clock(),'receipt':receipt}
            self._cas(current, state)
            return 'absence-verified-retained-charges-unreconciled'
        if resource['kind'] == 'firestore.database' and not teardown: return 'retained-while-paused'
        if resource['kind'] == 'sql.instance' and observed.get('settings', {}).get('activationPolicy') == 'NEVER' and not teardown:
            return 'sql-stopped-storage-charges-remain'
        current = self._read(cleanup=True); state = copy.deepcopy(current['state'])
        attempts = state.setdefault('cleanupAttempts', {}).get(key, 0)
        need(attempts < 3, 'cleanup retry bound; supervised reconciliation required')
        state['cleanupAttempts'][key] = attempts + 1
        state.setdefault('cleanupLastAt', {})[key] = self.clock()
        self._cas(current, state)  # Before any mutation, even if its reply is lost.
        operations = []
        if resource['kind'] == 'sql.instance':
            if observed.get('settings', {}).get('activationPolicy') == 'NEVER':
                operation = self.resources.delete(resource, receipt)
            else: operation = self.resources.stop_sql(resource, receipt)
        elif resource['kind'] == 'run.job':
            cancelled = self.resources.cancel_job_executions(resource, receipt)
            operations = cancelled['operations']
            operation = None if cancelled['pending'] else self.resources.delete(resource, receipt)
        else:
            operation = self.resources.delete(resource, receipt)
        if operation is not None: operations.append(operation)
        current = self._read(cleanup=True); state = copy.deepcopy(current['state'])
        state.setdefault('cleanupPending', {})[key] = operations
        self._cas(current, state)
        return 'mutation-requested-absence-unproven'

    def safety_tick(self):
        """Independent bounded invocation; no caller heartbeat or resource arguments."""
        current = self._read(cleanup=True); state = copy.deepcopy(current['state'])
        need(self.clock() - state.get('lastSafetyAt', -1000000) >= 60, 'duplicate watchdog invocation')
        state['lastSafetyAt'] = self.clock()
        self._cas(current, state)
        current = self._read(cleanup=True); state = copy.deepcopy(current['state'])
        action = watchdog(self.config, state, self.clock())
        if (state['status'] == 'supervised-bootstrap' and self.clock() < state['bootstrapDeadline'] and
            number(state.get('heartbeatAt')) and 0 <= self.clock() - state['heartbeatAt'] <= self.config['heartbeatMaxAgeSeconds']):
            action = 'observe'
        forecast = state['costUpper'] + state.get('remainingHoldUpper', 0) + state.get('delayedChargeUpper', 0) + self.config['cleanupReserveUsd']
        early = state.get('earlyApprovalReceipt', {})
        checkpoint_ok = early.get('approvedBeyondUsd') == 100 and all(early.get(k) == state[k] for k in IMMUTABLE)
        if action == 'observe' and (forecast > self.config['approvedForecastUsd'] or
            (forecast >= 100 and not checkpoint_ok) or state['activeSeconds'] >= self.config['activeLoadSeconds']):
            action = 'pause-load-stop-sql-and-alert'
        if action == 'observe':
            return {'action': action}
        state['status'] = 'tearing-down' if action.startswith('stop-load-export') else 'paused'
        self._cas(current, state)  # Stops new create/load admission before actions.
        outcomes = []
        for resource in self.config['provider']['resources']:
            key = resource['kind'] + '/' + resource['id']
            try:
                outcome = self._cleanup_resource_tick(resource, state['status'] == 'tearing-down')
                outcomes.append({'resource':key,'state':outcome})
            except (ProviderError, Rejected):
                outcomes.append({'resource': key, 'state': 'unknown-or-refused'})
        # Pub/Sub acceptance is an attempt, never a claim of recipient delivery.
        try:
            self.resources.alert(action)
            alert = 'publish-accepted-delivery-unproven'
        except (ProviderError, Rejected):
            alert = 'publish-failed-delivery-unproven'
        return {'action': action, 'resources': outcomes, 'alert': alert}

    def delete_owned(self, resource):
        current = self._read(cleanup=True)
        need(current['state']['status'] in ('paused', 'tearing-down'), 'cleanup requires paused admission')
        key = resource['kind'] + '/' + resource['id']
        receipt = current['state']['receipts'].get(key)
        need(receipt is not None, 'no exact ownership receipt')
        state = copy.deepcopy(current['state'])
        attempts = state.setdefault('cleanupAttempts', {}).get(key, 0)
        need(attempts < 3, 'cleanup retry bound; supervised reconciliation required')
        state['cleanupAttempts'][key] = attempts + 1
        self._cas(current, state)
        if resource['kind'] == 'run.job':
            cancellation = self.resources.cancel_job_executions(resource, receipt)
            need(not cancellation['pending'], 'execution cancellation pending; job absence unproven')
        operation = self.resources.delete(resource, receipt)
        fresh = self._read(cleanup=True); state = copy.deepcopy(fresh['state'])
        if operation is not None:
            state['operations'][key] = operation
        self._cas(fresh, state)
        return {'deletionRequested': True, 'absenceVerified': False}

    def verify_absence(self, resource):
        current = self._read(cleanup=True); state = copy.deepcopy(current['state'])
        key = resource['kind'] + '/' + resource['id']
        need(key in state['receipts'], 'no ownership receipt')
        # Permission errors, timeouts, malformed bodies propagate, never become gone.
        observed = self.resources.owned(resource, state['receipts'][key])
        if observed is not None:
            return {'absent': False}
        state['absent'][key] = {'verifiedAt': self.clock(), 'receipt': state['receipts'][key]}
        self._cas(current, state)
        return {'absent': True, 'retainedChargesReconciled': False}
