# Provider controller preparation — readiness-finish-002

This is source preparation dated 2026-10-17. No provider credentials were
obtained, resource created, cloud request executed, Scheduler enabled, or real
resource clock started. Local tests inject deterministic transports and fake
clocks; the cryptographic test invokes the real offline Node verifier with an
ephemeral signing key. They do not establish Google Cloud behavior.

The preceding Gate 0 remains qualified for its frozen v3 bytes. These new
modules require the new candidate manifest and the separate future Gate 1.
The original `config/staging.json` and previous manifests remain unchanged.

## Executable source and its boundary

`scripts/provider_entrypoint.py` defaults to a no-I/O dry run. Explicit execute
mode verifies the Ed25519 approval before constructing credentials or making
provider requests. The trusted public-key map is a separate absolute file;
the approval cannot supply trust keys. The Node subprocess receives no inherited
`NODE_OPTIONS`, shell or credentials. The deployment must pin its image and
protect the binary, verifier and trust-root input as operator-controlled code.

`cloud_provider.py` contains actual HTTPS REST adapters, not response fixtures:
GCS generation-CAS ledger reads/writes; Cloud SQL create/get/settingsVersion
stop/delete/operation polling; Cloud Run service/job create/get/etag deletion;
single-attempt job execution and etag cancellation; Firestore database
create/get/etag deletion; bounded Pub/Sub alert publication. Requests use exact
allowlisted hosts and project paths, no redirects or automatic retries, 15-second
timeouts and bounded responses. Lazy metadata authentication independently checks
the runtime project ID, project number and exact controller/watchdog service
account before obtaining a short-lived access token. No ADC or password fallback
exists. This metadata path is for the later managed runtime, not a local laptop.

`cloud_controller.py` supplies durable singleton CAS ownership, reservations,
single-attempt mutation intents, immutable start/deadline, separate signed $100
checkpoint, gate evidence, heartbeats, bounded polling and independent safety
ticks. A create or job-run response lost after the intent was committed never
causes another create/run. The retained intent and reservation require exact
resource/operation reconciliation. A crash between intent persistence and POST
also remains unresolved; there is deliberately no automatic refund or replay.
The watchdog itself reconciles sent creates without receipts, adopts known
operations, persists asynchronous cancellation/deletion operations, polls them
across invocations, then verifies exact absence. It stops mutating resources
whose absence was already recorded. This call chain does not require the main
runner to restart. Bounded CLI summaries expose pending versus unknown/refused
outcomes; unresolved resources or failed alert publication exit nonzero so the
independent job-failure monitor can observe them.

The control store is the exact object `runs/<runId>/control.json` in one approved
bucket. Every read/write verifies that bucket's project number, uses an exact
generation, and refuses 403, malformed content or unknown outcomes. No resource
listing can broaden the approved plan. The only bounded listing is up to 50
executions of an exact owned job to cancel unfinished work; an extra page is a
supervised reconciliation condition. Job cancellation must be observed complete
before requesting deletion. No response or deletion operation acceptance is
treated as proof of absence. Exact GET 404 is required; retained charges remain
unreconciled even then.

No general cloud manager is included. Project/API/IAM/network setup, registry,
control/config/trust buckets, notification channels, Scheduler and Workflows are
an explicit, future supervised bootstrap. Their exact descriptors/inventory must
be approved together with the workload. The controller does not self-provision
its own authority, mutate IAM, send email, create identities or delete its own
control plane. Those retained items remain in the final reconciliation inventory.

## Full signed configuration

Merge the disabled `config/provider.example.json` provider section and the hosted
adapter sections into a full configuration derived from the existing staging
limits. Do not execute either incomplete example. The complete document has
`projectId`, decimal-string `projectNumber`, exact singleton `allowedProjectIds`,
`runId`, `candidateDigest`, `gate`, `syntheticOnly:true`, and `region:us-central1`.
All fields are bound by the common `configDigest`; the document itself contains
no digest or signature field. Canonical data is printable ASCII, safe integers,
arrays/plain objects, booleans/null, bounded to 20 levels and 256 KiB. Fractional
costs must be rounded conservatively upward in the configuration.

Required provider values include exact control/config/trust bucket names, exact
control object, immutable control-image digest, four distinct least-privilege
service identities, exact control job/workflow/Scheduler names, Pub/Sub topic,
and at least two owner-approved Monitoring channel names. Trust roots are stored
separately from the configuration/approval. Future access policies must make
those inputs immutable to workload, controller and watchdog identities. A signed
approval is not proof that IAM, recipient delivery or shutdown works.
This limited composition requires preexisting, owner-approved control/config/trust
and independent evidence buckets. The snapshot signature binds the evidence
bucket's actual creation timestamp, which cannot be known before an unknown
bucket is created. Verify those existing metadata values before freezing the full
configuration. Include their allocated setup, holding and retained costs in the
worksheet. Creating new storage instead needs a separately approved bootstrap
receipt anchored to the same original start; no such bootstrap occurs here.

`provider.firstBillableAtMs` is fixed in the signed plan **before the first paid
bootstrap action**, including control setup or registry upload. It is a
conservative start, not an invented actual-provider creation timestamp. Ledger
initialization must occur within 900 seconds of that start. Restart always reads
the original ledger and cannot renew the start, 72-hour deadline or approval.
If setup cannot finish in that window, stop and reconcile that run; do not reset
its clock. No value has been assigned for a real run in this repository.

Each `provider.resources` entry contains exact `kind`, `id`, `disposable:true`,
provider `body`, and a `createReservation`. A load job additionally has a
`runReservation`. Reservations include unique `reservationId`, gate, all five
operation-count upper bounds, `activeSeconds`, `costUpper`, `remainingHoldUpper`
and `delayedChargeUpper`. Callers must submit the exact signed reservation.
Its cost must include the conservative maximum lifetime/holding liability from
the current worksheet; zero is not an estimate for a billable resource. The
guard enforces aggregate limits, but cannot validate a price assumption against
an unobserved future bill. Hold/delayed upper bounds persist monotonically and
cleanup always reserves at least $30. No refund path exists. The $100 checkpoint
uses the whole forecast, including those liabilities and cleanup. Crossing it
needs a distinct valid signed approval with `costCheckpointUsd:100`; the
initial approval alone cannot automatically continue the run.
Before any provider I/O, the initial signature must also authorize Gate 5 cleanup
through the original deadline plus a bounded two-hour reconciliation horizon.
Execute approval may expire sooner; cleanup cannot extend the resource lifetime.

Workload bounds remain 72 hours, six active load hours, $300 forecast, 24 SQL
connections, four application instances, all original operation/storage caps,
and at most 1,000 reservations. Jobs use one task, parallelism one, zero retries,
and at most 600 seconds per explicitly reserved run. This bounded implementation
requires that full runtime to fit inside the signed execute-approval window as
well as the original resource deadline; a delayed hosted job rechecks its full
600-second platform window before opening credentials or resources. This plan
permits one run per exact job entry; additional batches require separately named,
approved entries, not replaying a completed run. It does not prepare an unlimited
load scheduler. SQL starts zonal with the original four-core/16-GiB, 100-GiB
fixed-storage configuration. Standard backups retain three, PITR one day; final
backup and retain-on-delete are disabled. No on-demand backup adapter exists.
Provider-retained backup behavior and charges still need live reconciliation.
Only one source/load/recovery job may be pending across the whole run. Before the
next job, `job-status` must reconcile the exact execution incarnation and actual
completion timestamp; a successful job-run API operation is insufficient. This
preserves the eight reserved SQL connections (primary four plus restore four),
the 24-connection aggregate ceiling and the sole-writer fixture boundary. Unknown
or failed execution evidence remains visible; terminal failure is not a gate PASS.

The approved Cloud Run service body has min instances zero, max four, concurrency
four and 30-second timeout. Job execution template labels must carry the same
run and candidate halves as the parent job, so execution cancellation checks the
actual child identity. Use the hosted adapter generator for application network,
token and browser settings; this controller does not alter those contracts.

## Provider identity limitation

Cloud Run and Firestore deletion use the observed etag. SQL stopping uses the
observed `settingsVersion`. SQL Admin deletion has no UID/etag/settingsVersion
delete precondition. Therefore a matching name, labels and recorded create time
are **not** described as an atomic SQL deletion guarantee.

Automatic SQL delete fails closed unless the full signed configuration separately
approves `sqlExclusiveDeletion`: `approved:true`, `singleUseNames:true`,
`exclusiveControllerOwnership:true`, and an owner approval reference. The future
Gate 1 must verify that only the controller can replace/delete that disposable
instance name and that nobody reuses it. This is an operational/IAM prerequisite,
not an IAM change made here. Without it the watchdog conditionally stops SQL and
requires supervised deletion. The provider's time-of-check/time-of-use limitation
remains explicit even when that prerequisite is approved.

References checked 2026-10-17: [SQL delete](https://docs.cloud.google.com/sql/docs/postgres/admin-api/rest/v1beta4/instances/delete),
[SQL patch](https://docs.cloud.google.com/sql/docs/postgres/admin-api/rest/v1beta4/instances/patch),
[Run service delete](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/delete),
[Firestore delete](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases/delete),
[job run](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run),
[execution cancel](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs.executions/cancel),
[GCS preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions).

## Source-only package and future deployment inputs

`Controller.Dockerfile` pins official linux/amd64 Node 24.21.0 and Python 3.12.13
image manifests, copies only the controller and compiled offline verifier, and
uses a non-root runtime. Base metadata was read from the public official image
catalogue; no image was pulled, built, uploaded or executed here. The final image
digest and copied-library compatibility are unverified until a suitable local
Linux build. This control image does not grant a numerical runtime whitelist to
the search image. Build and test both images before considering Gate 1 readiness.

`render_provider_descriptors.py --config <complete.json>` only renders documents
to stdout. It emits actual Cloud Run v2 controller/watchdog job bodies, a
parameter-free Workflows body, the Scheduler HTTP target, and a watchdog-failure
Monitoring policy. The Scheduler descriptor specifies once per minute and zero
request retries; it is not enabled by rendering. The job uses zero retries and
the ledger deduplicates safety ticks for 60 seconds. Provider polling is at most
120 calls per resource with a minimum five-second interval. Cleanup has three
durable attempts per resource and then requires supervision. Job timeout or
unknown provider outcomes remain failures, not successful removal.

Future least-privilege permissions must be scoped to this isolated project and
exact resource names: controller create/get/patch/delete and workload-job run;
watchdog get/stop/delete/cancel without provisioning; exact control-object
read/create/update for both; read-only config/trust buckets; Pub/Sub publish;
Workflow identity may invoke only the watchdog job; Scheduler identity may invoke
only the workflow. The token identity must match its role. Provision no service
account key. The watchdog identity, workflow and Scheduler must remain independent
of the main runner. Monitoring must also alert if scheduling or workflow invocation
fails or stops; the rendered job-failure policy is one channel of this supervision,
not an assertion that silent Scheduler failure is automatically detected.

## Exact supervised Gate 1 drill (future authorization required)

1. Freeze the source candidate, locally qualified image digests, signed full
   configuration and separate trust map. Confirm isolated project ID/number,
   explicit recipients, network route, SQL IAM user/grants, budget worksheet,
   independent identities and permitted cleanup policy. Approve only Gates 1 and
   5 initially. Do not copy production data or use production identity authority.
2. Record the conservative start in the signed config before any billable setup.
   Under the separately approved $5/900-second bootstrap, create the exact control
   plane and inputs using reviewed descriptors. Start the controller once. Retain
   provider creation receipts, object generations and external approval evidence.
   No workload can bypass the supervised bootstrap deadline or reservation ceiling.
3. Use a small disposable probe resource from the signed plan. Supply its exact
   create reservation to the entrypoint `create` action. Observe the provider
   operation through bounded `poll`, verify incarnation, then exercise duplicate
   runner/restart and a deliberately lost reply. Record that no second create or
   job run occurs and the original deadline stays unchanged.
4. Deliver a real alert to both independent channels and collect recipient evidence.
   Pub/Sub message acceptance is insufficient. Stop the main runner and allow its
   heartbeat to become stale. Observe the independently scheduled watchdog pause
   admission, cancel the owned load execution, conditionally stop SQL, and request
   exact probe removal. Exercise denied permission/unknown response and a simulated
   replacement identity; none may be reported gone or deleted by name alone.
5. Use cleanup polling and exact absence reads. A Cloud Run job with an unfinished
   execution remains pending until cancellation completes. Record actual operation
   completion, exact GET absence, retained backups/storage/logs/artifacts and control
   infrastructure that still exists. Do not declare a zero bill or total teardown
   merely because SQL is absent. If SQL exclusivity cannot be demonstrated, perform
   supervised cleanup instead of automatic delete.
6. Within the original bootstrap deadline, submit `confirm-controls` only with the
   real run/config/start/deadline, delivered-alert evidence and observed-shutdown
   evidence digest. A paused bootstrap also needs a recorded exact owned absence.
   This is an explicit operator attestation, not synthetic proof inferred by code.
   `complete-gate` records the digest of reviewed evidence; it does not manufacture
   a PASS. No later gate can reserve work without all earlier gate receipts.
7. Exercise the separate hosted adapter checks: actual Cloud SQL encrypted IAM
   login/refresh, private routing, actual numerical/PostGIS compatibility, browser
   guest and authenticated transport, durable GCS snapshot/restore and safe pruning.
   These require later provider evidence; local transport contracts do not prove
   them. Before any larger investigation, obtain the separate gate approval and
   preserve the $100 checkpoint. Schedule verified snapshots before teardown;
   the watchdog stops admission/resources and does not silently claim it exported
   a final snapshot. Snapshot failure must not extend the resource deadline.
8. Teardown the exact workload before its original deadline. Keep independent
   safety controls until workload absence is verified, then explicitly remove
   approved control resources, Scheduler/Workflow, artifacts and retained storage
   according to the reconciliation inventory. Preserve nonsecret evidence outside
   disposable SQL. Reconcile delayed/retained charges and close reservations with
   provider truth. Do not restart this run to obtain another 72 hours.

For later execution, every invocation requires `--mode execute`, an exact config,
approval and separate trust-key file, explicit Node/verifier paths, and a selected
action. Supported explicit actions are start, create, run-job, job-status, poll, heartbeat,
confirm-controls, complete-gate, confirm-checkpoint, watchdog, cleanup-poll, delete
and absence. Resource requests contain only the exact kind/id and the signed
reservation; no runtime resource URL or identity is accepted. The default command
below is safe now and obtains no credentials:

```sh
python3 tool/postgis_staging/scripts/provider_entrypoint.py --config tool/postgis_staging/config/staging.json
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tool/postgis_staging/scripts -p 'test_cloud_controller.py' -v
```

Actual project, identities, recipients, first-billable timestamp, image digest,
SQL ownership policy and paid-run approval remain unset owner inputs. Paid-run
authorization is NOT GRANTED; hosted/provider/scale qualification is NOT PERFORMED.
