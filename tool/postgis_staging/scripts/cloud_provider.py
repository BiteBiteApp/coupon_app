"""Explicit Google REST adapters. Import/construction performs no network or ADC.

All I/O uses an injected transport; HttpsTransport is the real bounded adapter.
The controller supplies verified approval before constructing it. The explicit
entrypoint executes only after approval. See PROVIDER-GATE1.md.
"""
import copy
import json
import re
import urllib.error
import urllib.parse
import urllib.request

from guard import Rejected, digest, need, project_check


class ProviderError(RuntimeError):
    def __init__(self, status, message='Provider operation failed; reconcile before retry.'):
        self.status = status
        super().__init__(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def configuration_bytes(value):
    """The exact restricted canonical document accepted by the Node verifier."""
    def check(item, depth=0):
        need(depth <= 20, 'configuration nesting exceeds bound')
        if item is None or isinstance(item, bool): return
        if isinstance(item, int):
            need(abs(item) <= 9007199254740991, 'unsafe configuration integer'); return
        if isinstance(item, str):
            need(all(32 <= ord(c) <= 126 for c in item), 'configuration must be printable ASCII'); return
        if isinstance(item, list):
            for child in item: check(child, depth + 1)
            return
        need(isinstance(item, dict), 'unsupported configuration value')
        for key, child in item.items():
            need(isinstance(key, str) and key, 'configuration key must be a nonempty string')
            check(key, depth + 1); check(child, depth + 1)
    check(value)
    result = canonical(value)
    need(len(result) <= 256 * 1024, 'configuration exceeds bound')
    return result


class HttpsTransport:
    """No ambient credentials, redirects, retries, or token logging."""
    def __init__(self, token_supplier, authorize):
        self.token_supplier, self.authorize = token_supplier, authorize

    def request(self, method, url, body=None):
        self.authorize()
        parsed = urllib.parse.urlsplit(url)
        need(parsed.scheme == 'https' and parsed.hostname in {
            'storage.googleapis.com', 'sqladmin.googleapis.com',
            'run.googleapis.com', 'firestore.googleapis.com',
            'pubsub.googleapis.com'}, 'unapproved provider host')
        need(parsed.username is None and parsed.port in (None, 443), 'invalid provider endpoint')
        token = self.token_supplier()
        need(isinstance(token, str) and token and not re.search(r'\s', token), 'invalid access token')
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        request = urllib.request.Request(url, data=None if body is None else canonical(body),
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method=method)
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
                need(len(raw) <= 2 * 1024 * 1024, 'provider response exceeds bound')
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            raise ProviderError(error.code) from None
        except (OSError, ValueError):
            raise ProviderError(None, 'Unknown provider outcome; reconcile before retry.') from None


class GcsControlStore:
    """One exact object, generation-CAS, version-specific read; never lists."""
    def __init__(self, config, transport):
        project_check(config)
        self.config, self.transport = copy.deepcopy(config), transport
        provider = config['provider']
        bucket, name = provider['controlBucket'], provider['controlObject']
        need(re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,220}[a-z0-9]', bucket), 'invalid control bucket')
        need(name == 'runs/' + config['runId'] + '/control.json', 'wrong singleton control object')
        self.bucket, self.name = bucket, name
        self.url = 'https://storage.googleapis.com/storage/v1/b/' + bucket + '/o/' + urllib.parse.quote(name, safe='')

    def check_bucket(self):
        data = self.transport.request('GET', 'https://storage.googleapis.com/storage/v1/b/' + self.bucket)
        need(str(data.get('projectNumber')) == str(self.config['projectNumber']), 'control bucket project mismatch')

    def read(self):
        self.check_bucket()
        try:
            meta = self.transport.request('GET', self.url)
        except ProviderError as error:
            if error.status == 404:
                return None
            raise
        generation = meta.get('generation')
        need(isinstance(generation, str) and generation.isdigit(), 'invalid control generation')
        state = self.transport.request('GET', self.url + '?alt=media&generation=' + generation)
        need(isinstance(state, dict), 'invalid control state')
        return {'generation': generation, 'state': state}

    def write(self, expected_generation, state):
        self.check_bucket()
        need(expected_generation == '0' or (isinstance(expected_generation, str) and expected_generation.isdigit()), 'invalid CAS generation')
        need(len(canonical(state)) <= 1024 * 1024, 'control state exceeds bound')
        query = urllib.parse.urlencode({'uploadType': 'media', 'name': self.name,
                                      'ifGenerationMatch': expected_generation})
        result = self.transport.request('POST', 'https://storage.googleapis.com/upload/storage/v1/b/' + self.bucket + '/o?' + query, state)
        need(isinstance(result.get('generation'), str) and result['generation'].isdigit(), 'missing write generation; reconcile')
        return {'generation': result['generation'], 'state': copy.deepcopy(state)}


class GoogleResources:
    """Exact create/get/stop/delete/poll calls for the four workload kinds."""
    KINDS = {'sql.instance', 'run.service', 'run.job', 'firestore.database'}

    def __init__(self, config, transport):
        project_check(config)
        self.config, self.transport = copy.deepcopy(config), transport

    def spec(self, resource):
        need(resource in self.config['provider']['resources'], 'unapproved resource specification')
        need(resource.get('kind') in self.KINDS and resource.get('disposable') is True, 'invalid resource kind')
        need(re.fullmatch(r'[a-z][a-z0-9-]{1,61}[a-z0-9]', resource.get('id', '')), 'invalid exact resource id')
        return resource

    def url(self, resource):
        self.spec(resource)
        project, kind, ident = self.config['projectId'], resource['kind'], resource['id']
        if kind == 'sql.instance':
            return f'https://sqladmin.googleapis.com/sql/v1beta4/projects/{project}/instances/{ident}'
        if kind == 'firestore.database':
            return f'https://firestore.googleapis.com/v1/projects/{project}/databases/{ident}'
        collection = 'services' if kind == 'run.service' else 'jobs'
        return f'https://run.googleapis.com/v2/projects/{project}/locations/{self.config["region"]}/{collection}/{ident}'

    def get(self, resource):
        try:
            return self.transport.request('GET', self.url(resource))
        except ProviderError as error:
            if error.status == 404:
                return None
            raise

    def labels(self):
        return {'bs-run': self.config['runId'], 'bs-candidate-a': self.config['candidateDigest'][:32],
                'bs-candidate-b': self.config['candidateDigest'][32:]}

    def create(self, resource):
        url = self.url(resource)
        body = copy.deepcopy(resource['body'])
        if resource['kind'] == 'sql.instance':
            need(body.get('name') == resource['id'], 'SQL create name mismatch')
            settings = body.get('settings', {})
            need(settings.get('userLabels') == self.labels(), 'SQL create ownership labels missing')
            need(body.get('region') == self.config['region'] and body.get('databaseVersion') == 'POSTGRES_18', 'SQL plan mismatch')
            need(settings.get('tier') == 'db-custom-4-16384' and settings.get('dataDiskSizeGb') == '100' and
                 settings.get('storageAutoResize') is False and settings.get('availabilityType') == 'ZONAL' and
                 settings.get('edition') == 'ENTERPRISE' and settings.get('dataDiskType') == 'PD_SSD' and
                 settings.get('deletionProtectionEnabled') is False, 'SQL capacity exceeds initial plan')
            backup = settings.get('backupConfiguration', {})
            need(backup.get('enabled') is True and backup.get('pointInTimeRecoveryEnabled') is True and
                 backup.get('transactionLogRetentionDays') == 1 and
                 backup.get('backupRetentionSettings') == {'retainedBackups':3,'retentionUnit':'COUNT'} and
                 settings.get('retainBackupsOnDelete') is False and settings.get('finalBackupConfig', {}).get('enabled') is False,
                 'SQL retained backup plan mismatch')
            ip = settings.get('ipConfiguration', {})
            need(ip.get('ipv4Enabled') is False and ip.get('sslMode') == 'ENCRYPTED_ONLY' and
                 isinstance(ip.get('privateNetwork'), str) and ip['privateNetwork'].startswith('projects/' + self.config['projectId'] + '/global/networks/'),
                 'SQL private encrypted network required')
            return self.transport.request('POST', url.rsplit('/', 1)[0], body)
        if resource['kind'] == 'firestore.database':
            need(body.get('name') == url.split('/v1/')[1], 'Firestore create name mismatch')
            need(resource['id'] == 'search-qualification' and body.get('locationId') == self.config['region'] and
                 body.get('type') == 'FIRESTORE_NATIVE', 'Firestore regional named synthetic database required')
            return self.transport.request('POST', url.rsplit('/', 1)[0] + '?' + urllib.parse.urlencode({'databaseId': resource['id']}), body)
        need(body.get('labels') == self.labels(), 'Run create ownership labels missing')
        hosted = self.config['hosted']
        if resource['kind'] == 'run.job':
            template = body.get('template', {})
            task = template.get('template', {})
            need(template.get('labels') == self.labels() and template.get('taskCount') == 1 and
                 template.get('parallelism') == 1 and task.get('maxRetries') == 0 and
                 re.fullmatch(r'[1-9][0-9]*s', task.get('timeout', '')) and
                 int(task['timeout'][:-1]) <= 600, 'unbounded/unlabeled job template')
            image, service_account = self.config['provider']['loadImageDigest'], self.config['provider']['loadServiceAccount']
            need(service_account == hosted['sql']['serviceAccountEmail'] and image == hosted['imageDigest'],
                 'job SQL principal/image must match approved hosted composition')
            if isinstance(hosted.get('snapshot'), dict):
                need(hosted['snapshot'].get('serviceAccountEmail') == service_account, 'job snapshot principal mismatch')
        else:
            template = body.get('template', {})
            scaling = template.get('scaling', {})
            need(scaling.get('minInstanceCount') == 0 and type(scaling.get('maxInstanceCount')) is int and
                 1 <= scaling['maxInstanceCount'] <= 4 and template.get('maxInstanceRequestConcurrency') == 4 and
                 template.get('timeout') == '30s' and body.get('scaling') is None, 'unbounded service template')
            task = template
            image, service_account = hosted['imageDigest'], hosted['sql']['serviceAccountEmail']
        need(isinstance(service_account, str) and service_account.endswith('@' + self.config['projectId'] + '.iam.gserviceaccount.com') and
             task.get('serviceAccount') == service_account, 'Run service account mismatch')
        need(isinstance(image, str) and re.fullmatch(re.escape('us-central1-docker.pkg.dev/' + self.config['projectId'] + '/') + r'[a-z0-9/_.-]+@sha256:[0-9a-f]{64}', image), 'immutable isolated image required')
        containers = task.get('containers', [])
        need(len(containers) == 1 and containers[0].get('image') == image and
             containers[0].get('resources', {}).get('limits') == {'cpu':'1','memory':'1Gi'}, 'Run compute/image exceeds plan')
        network = {'egress':'PRIVATE_RANGES_ONLY','networkInterfaces':[{
            'network':'projects/' + self.config['projectId'] + '/global/networks/' + hosted['network'],
            'subnetwork':'projects/' + self.config['projectId'] + '/regions/' + self.config['region'] + '/subnetworks/' + hosted['subnet']}]}
        need(task.get('vpcAccess') == network, 'Run private route mismatch')
        key = 'serviceId' if resource['kind'] == 'run.service' else 'jobId'
        return self.transport.request('POST', url.rsplit('/', 1)[0] + '?' + urllib.parse.urlencode({key: resource['id']}), body)

    def identity(self, resource, observed):
        need(isinstance(observed, dict), 'resource absent; no ownership receipt')
        kind = resource['kind']
        if kind == 'sql.instance':
            need(observed.get('project') == self.config['projectId'] and observed.get('name') == resource['id'], 'SQL target mismatch')
            labels = observed.get('settings', {}).get('userLabels')
            uid = observed.get('createTime')
        else:
            version = '/v1/' if kind == 'firestore.database' else '/v2/'
            need(observed.get('name') == self.url(resource).split(version)[1], 'provider target mismatch')
            labels, uid = observed.get('labels'), observed.get('uid')
        if kind != 'firestore.database':
            need(labels == self.labels(), 'resource run/candidate mismatch')
        need(isinstance(uid, str) and uid and isinstance(observed.get('createTime'), str), 'missing resource incarnation')
        return {'kind': kind, 'id': resource['id'], 'uid': uid, 'createTime': observed['createTime']}

    def owned(self, resource, receipt):
        observed = self.get(resource)
        if observed is None:
            return None
        need(self.identity(resource, observed) == receipt, 'replacement resource: action refused')
        return observed

    def stop_sql(self, resource, receipt):
        need(resource['kind'] == 'sql.instance', 'SQL stop only')
        observed = self.owned(resource, receipt)
        if observed is None:
            return None
        settings = observed.get('settings', {})
        need(isinstance(settings.get('settingsVersion'), str), 'missing SQL settings precondition')
        return self.transport.request('PATCH', self.url(resource), {'settings': {
            'activationPolicy': 'NEVER', 'settingsVersion': settings['settingsVersion']}})

    def run_job(self, resource, receipt):
        need(resource['kind'] == 'run.job', 'job run only')
        observed = self.owned(resource, receipt)
        need(observed is not None and isinstance(observed.get('etag'), str), 'owned job etag required')
        def matches(expected, actual):
            if isinstance(expected, dict):
                return isinstance(actual, dict) and all(key in actual and matches(value, actual[key]) for key,value in expected.items())
            if isinstance(expected, list):
                return isinstance(actual, list) and len(expected) == len(actual) and all(matches(x,y) for x,y in zip(expected,actual))
            return type(expected) is type(actual) and expected == actual
        need(matches(resource['body']['template'], observed.get('template')), 'job specification changed after approval')
        # No caller-controlled overrides, environment, image or arguments.
        return self.transport.request('POST', self.url(resource) + ':run', {'etag': observed['etag']})

    def cancel_job_executions(self, resource, receipt):
        need(resource['kind'] == 'run.job', 'job cancellation only')
        need(self.owned(resource, receipt) is not None, 'owned job absent; reconcile executions')
        response = self.transport.request('GET', self.url(resource) + '/executions?pageSize=50')
        rows = response.get('executions', [])
        need(isinstance(rows, list) and len(rows) <= 50 and not response.get('nextPageToken'),
             'execution listing exceeds bound; supervised reconciliation required')
        parent = self.url(resource).split('/v2/')[1]
        operations = []
        for row in rows:
            name = row.get('name', '')
            need(name.startswith(parent + '/executions/') and
                 re.fullmatch(r'[a-z0-9-]+', name[len(parent + '/executions/'):]) and
                 row.get('job') == parent and row.get('labels') == self.labels() and
                 isinstance(row.get('uid'), str) and row.get('uid') and row.get('etag'),
                 'execution identity mismatch')
            if row.get('completionTime'): continue
            # Etag applies to this observed execution incarnation, never name only.
            operations.append(self.transport.request('POST', 'https://run.googleapis.com/v2/' + name + ':cancel', {'etag': row['etag']}))
        return {'pending': bool(operations), 'operations': operations}

    def job_execution(self, resource, receipt, sent_at):
        """Reconcile the sole approved run, never infer completion from run LRO."""
        need(resource['kind'] == 'run.job' and self.owned(resource, receipt) is not None, 'owned job required')
        response = self.transport.request('GET', self.url(resource) + '/executions?pageSize=50')
        rows = response.get('executions', [])
        need(isinstance(rows,list) and len(rows) <= 50 and not response.get('nextPageToken'), 'execution listing exceeds bound')
        parent = self.url(resource).split('/v2/')[1]
        from datetime import datetime
        matches = []
        for row in rows:
            name = row.get('name', '')
            need(name.startswith(parent + '/executions/') and re.fullmatch(r'[a-z0-9-]+', name[len(parent + '/executions/'):]) and
                 row.get('job') == parent and row.get('labels') == self.labels() and row.get('uid') and row.get('createTime'), 'execution identity mismatch')
            created = datetime.fromisoformat(row['createTime'].replace('Z','+00:00')).timestamp()
            if created >= sent_at - 5: matches.append(row)
        need(len(matches) <= 1, 'unexpected duplicate execution; admission remains blocked')
        if not matches: return {'state':'unknown'}
        row = matches[0]
        return {'state':'completed' if row.get('completionTime') else 'pending',
            'uid':row['uid'],'name':row['name'],'createTime':row['createTime'],
            'failed':bool(row.get('failedCount',0) or row.get('cancelledCount',0))}

    def delete(self, resource, receipt):
        observed = self.owned(resource, receipt)
        if observed is None:
            return None
        if resource['kind'] == 'sql.instance':
            # SQL Admin does not expose an atomic incarnation precondition.
            policy = self.config['provider'].get('sqlExclusiveDeletion', {})
            need(policy.get('approved') is True and policy.get('singleUseNames') is True and
                 policy.get('exclusiveControllerOwnership') is True and policy.get('ownerApprovalReference'),
                 'SQL delete requires separate exclusive single-use-name approval; stop and supervise')
            return self.transport.request('DELETE', self.url(resource) + '?enableFinalBackup=false')
        etag = observed.get('etag')
        need(isinstance(etag, str) and etag, 'missing atomic deletion precondition')
        return self.transport.request('DELETE', self.url(resource) + '?' + urllib.parse.urlencode({'etag': etag}))

    def poll(self, resource, operation):
        name = operation.get('name')
        need(isinstance(name, str), 'missing provider operation identity')
        if resource['kind'] == 'sql.instance':
            need(re.fullmatch(r'[A-Za-z0-9_-]{1,200}', name), 'invalid SQL operation')
            url = f'https://sqladmin.googleapis.com/sql/v1beta4/projects/{self.config["projectId"]}/operations/{name}'
        else:
            prefix = (f'projects/{self.config["projectId"]}/databases/{resource["id"]}/operations/'
                      if resource['kind'] == 'firestore.database' else
                      f'projects/{self.config["projectId"]}/locations/{self.config["region"]}/operations/')
            need(name.startswith(prefix) and re.fullmatch(r'[A-Za-z0-9_-]{1,200}', name[len(prefix):]), 'wrong operation target')
            host = 'firestore.googleapis.com/v1/' if resource['kind'] == 'firestore.database' else 'run.googleapis.com/v2/'
            url = 'https://' + host + name
        result = self.transport.request('GET', url)
        need(not result.get('error'), 'provider operation failed')
        done = result.get('status') == 'DONE' if resource['kind'] == 'sql.instance' else result.get('done') is True
        return done

    def alert(self, summary):
        topic = self.config['provider']['alertTopic']
        need(re.fullmatch(r'projects/' + re.escape(self.config['projectId']) + r'/topics/[A-Za-z][A-Za-z0-9_-]{2,200}', topic), 'wrong alert topic')
        import base64
        # Fixed bounded safety metadata only; never provider body, token or data.
        body = {'runId': self.config['runId'], 'candidateDigest': self.config['candidateDigest'], 'event': summary}
        return self.transport.request('POST', 'https://pubsub.googleapis.com/v1/' + topic + ':publish',
            {'messages': [{'data': base64.b64encode(canonical(body)).decode()}]})
