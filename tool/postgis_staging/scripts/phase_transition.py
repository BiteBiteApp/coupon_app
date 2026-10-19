"""One explicit diagnostic -> serving CAS; no cloud/credential work at import."""
import copy
import re
from guard import digest, need
from cloud_provider import configuration_bytes, GoogleResources, _verified_sql_phase_context


def restore_verified_phase_context(controller, state):
    """Reverify persisted authorization at its original transition instant.

    Current execution/cleanup approval is checked separately by Controller._read.
    This does not extend either approval's or the resource's current lifetime.
    """
    history = state.get('phaseHistory')
    need(state.get('phaseSequence') == 1 and state.get('activePhase') == 'serving' and isinstance(history, list) and len(history) == 1,
         'invalid immutable serving phase history')
    prior = history[0]; previous = prior['configuration']; archived = prior['state']; at = prior['transitionedAtMs']
    need(previous.get('phase') == 'diagnostic' and archived.get('activePhase') == 'diagnostic' and
         archived['configDigest'] == digest(previous) and archived['candidateDigest'] == previous['candidateDigest'] and
         all(archived[k] == state[k] for k in ('runId','projectId','firstBillableAt','deadline')) and
         type(at) is int and at <= int(controller.clock() * 1000), 'phase history identity/time mismatch')
    expected = {'purpose':'phase-transition', 'projectId':controller.config['projectId'], 'projectNumber':controller.config['projectNumber'],
        'runId':state['runId'], 'priorCandidateDigest':archived['candidateDigest'], 'priorConfigDigest':archived['configDigest'],
        'nextCandidateDigest':state['candidateDigest'], 'nextConfigDigest':state['configDigest'],
        'nextApprovalDigest':digest(controller.approval.envelope), 'evidenceDigest':state['phaseEvidenceDigest'],
        'firstBillableAtMs':int(state['firstBillableAt']*1000), 'deadlineMs':int(state['deadline']*1000),
        'fromPhase':'diagnostic', 'toPhase':'serving', 'sequence':1, 'nowMs':at}
    claims = controller.approval.verify_claims(prior['transitionApproval'], expected)
    need(claims == prior['transitionClaims'], 'persisted phase claims changed')
    controller.resources.bind_phase_context(_verified_sql_phase_context(controller.config, claims, at))


def transition_to_serving(controller, next_config, next_approval, envelope, evidence_digest):
    """Teardown/recreate only. Never reinterpret old resource ownership labels.

    All prior ledger records remain archived. Liabilities, reservation IDs,
    counters and the original clock stay in the same control object. This does
    not approve bootstrap/notification policy exceptions or retained-cost refunds.
    """
    from cloud_controller import Controller
    need(not controller.cleanup_only, 'watchdog cannot transition admission')
    configuration_bytes(next_config)
    old_config = controller.config
    diagnostic = old_config.get('hosted', {}).get('nativeDiagnostic', {})
    need(old_config.get('phase') == 'diagnostic' and next_config.get('phase') == 'serving' and
         diagnostic.get('action') == 'numerical-only' and diagnostic.get('protocolVersion') == 'bitestar.postgis-native-diagnostic.v1' and
         not old_config.get('hosted', {}).get('jobs') and
         not any(r['kind'] == 'run.service' for r in old_config['provider']['resources']) and
         any(r['kind'] == 'run.job' and r['id'] == diagnostic.get('id') for r in old_config['provider']['resources']) and
         not next_config.get('hosted', {}).get('nativeDiagnostic'), 'actual diagnostic-to-serving configuration required')
    # Every policy/cap/control identity remains byte-identical. Only the signed
    # serving candidate, hosted settings and finite workload resource plan change.
    for key in set(old_config) | set(next_config):
        if key not in ('candidateDigest', 'hosted', 'provider', 'phase'):
            need(old_config.get(key) == next_config.get(key), 'phase policy changed: ' + key)
    for key in set(old_config['provider']) | set(next_config['provider']):
        if key not in ('resources', 'loadImageDigest', 'sqlExclusiveDeletion'):
            need(old_config['provider'].get(key) == next_config['provider'].get(key), 'phase control identity/policy changed: ' + key)
    old_policy, next_policy = old_config['provider'].get('sqlExclusiveDeletion', {}), next_config['provider'].get('sqlExclusiveDeletion', {})
    need({k:v for k,v in old_policy.items() if k not in ('evidence','evidenceDigest')} ==
         {k:v for k,v in next_policy.items() if k not in ('evidence','evidenceDigest')}, 'phase SQL exclusivity policy weakened or changed')
    need(next_config['candidateDigest'] != old_config['candidateDigest'] and digest(next_config) != digest(old_config), 'phase requires a separately qualified candidate')
    need(re.fullmatch(r'[0-9a-f]{64}', evidence_digest), 'reviewed phase evidence digest required')
    # Same immutable public trust file and verifier. New untrusted input cannot
    # choose a new key map, alternate executable, project or control object.
    for key in ('node', 'verifier', 'trusted_keys'):
        need(getattr(next_approval, key) == getattr(controller.approval, key), 'phase trust roots changed')
    Controller(next_config, next_approval, controller.store, controller.resources, controller.clock)
    current = controller._read(); state = current['state']
    need(state.get('phaseSequence', 0) == 0 and not state.get('phaseHistory') and state.get('activePhase') == 'diagnostic',
         'phase transition replay/out of order or prior phase is not diagnostic')
    need(state['status'] in ('paused', 'tearing-down') and state['controlsVerified'] is True,
         'phase requires paused admission and existing control proof')
    need(controller.clock() < state['deadline'] - old_config['teardownLeadSeconds'], 'phase deadline exhausted')
    expected = {'purpose':'phase-transition', 'projectId':old_config['projectId'], 'projectNumber':old_config['projectNumber'],
        'runId':old_config['runId'], 'priorCandidateDigest':state['candidateDigest'], 'priorConfigDigest':state['configDigest'],
        'nextCandidateDigest':next_config['candidateDigest'], 'nextConfigDigest':digest(next_config),
        'nextApprovalDigest':digest(next_approval.envelope), 'evidenceDigest':evidence_digest,
        'firstBillableAtMs':int(state['firstBillableAt'] * 1000), 'deadlineMs':int(state['deadline'] * 1000),
        'fromPhase':'diagnostic', 'toPhase':'serving', 'sequence':1, 'nowMs':int(controller.clock() * 1000)}
    claims = controller.approval.verify_claims(envelope, expected)
    next_resources = GoogleResources(next_config, controller.resources.transport)
    next_resources.bind_phase_context(_verified_sql_phase_context(next_config, claims, expected['nowMs']))
    for resource in next_config['provider']['resources']:
        if resource['kind'] == 'sql.instance':
            # The refreshed evidence must qualify automatic cleanup now. There
            # is no implicit downgrade to an ineligible supervised resource.
            next_resources.sql_exclusivity_evidence(resource, expected['nowMs'])
    old_keys = {r['kind'] + '/' + r['id'] for r in old_config['provider']['resources']}
    new_keys = {r['kind'] + '/' + r['id'] for r in next_config['provider']['resources']}
    need(not old_keys & new_keys and len(old_keys | new_keys) <= 12, 'phase requires fresh bounded single-use resource names')
    need(all(not values for field in ('cleanupPending', 'cleanupCancellationPending') for values in state.get(field, {}).values()),
         'phase has pending provider operations')
    for resource in old_config['provider']['resources']:
        key = resource['kind'] + '/' + resource['id']
        intent = state['intents'].get(key)
        receipt = state['receipts'].get(key)
        if intent and intent['phase'] != 'reserved':
            need(receipt is not None and state.get('absent', {}).get(key, {}).get('receipt') == receipt,
                 'phase requires exact recorded owned absence')
            need(controller.resources.owned(resource, receipt) is None, 'phase resource reappeared')
        else:
            need(controller.resources.get(resource) is None, 'phase resource has unexplained presence')
        run = state.get('jobRuns', {}).get(key)
        need(run is None or run['phase'] == 'completed' or state.get('cleanupExecutionsQuiescent', {}).get(key) == receipt,
             'phase execution is unresolved')
    # CAS uses the read generation; a concurrent old worker cannot publish over
    # this transition. A lost CAS reply is reconciled with the next config, never
    # replayed as a fresh run. History is deliberately not copied recursively.
    updated = copy.deepcopy(state)
    archived = {key: copy.deepcopy(value) for key, value in state.items() if key != 'phaseHistory'}
    updated['phaseHistory'] = [{'sequence':0, 'phase':'diagnostic', 'configuration':copy.deepcopy(old_config),
        'state':archived, 'transitionApproval':copy.deepcopy(envelope), 'transitionClaims':claims,
        'transitionedAtMs':expected['nowMs']}]
    for key in ('intents', 'receipts', 'operations', 'polls', 'absent', 'jobRuns', 'jobRunHistory', 'lastPollAt'):
        updated[key] = {}
    for key in list(updated):
        if key.startswith('cleanup') or key == 'sqlDeletionEligibility': updated.pop(key)
    updated.update(configDigest=digest(next_config), candidateDigest=next_config['candidateDigest'], phaseSequence=1,
        activePhase='serving', status='phase-awaiting-controls', controlsVerified=False, phaseEvidenceDigest=evidence_digest,
        completedGates=[0], gateEvidence={})
    # Candidate-specific qualification never transfers to rebuilt bytes. Prior
    # gates remain in history; the serving candidate must pass its own gates.
    # Root identity and clock are immutable even in the only sanctioned digest CAS.
    for key in ('runId', 'projectId', 'firstBillableAt', 'deadline', 'costUpper', 'remainingHoldUpper', 'delayedChargeUpper',
                'counts', 'activeSeconds', 'reservationIds', 'reservationDigests', 'phaseUsed'):
        need(updated.get(key) == state.get(key), 'phase changed cumulative ledger: ' + key)
    return controller.store.write(current['generation'], updated)
