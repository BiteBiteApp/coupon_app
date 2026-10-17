# Durable snapshot adapter — readiness finish 002

This is source preparation with local contract tests. No Cloud Storage bucket,
object, permission or retention policy was created or changed.

`functions/src/postgis_snapshot_gcs.ts` implements the regional flat-namespace
Cloud Storage JSON API. A separately signed execution document binds the exact
project/number, run, candidate, one snapshot ID, prefix, bucket creation timestamp,
service account and total byte limit. The default adapter obtains credentials only
on an explicit approved operation; construction/import/dry-run is inert. Provider
requests use HTTPS, no redirects, refreshed ADC tokens, bounded response sizes and
a 15-second deadline. Errors expose no provider bodies or credential details.

Objects are created with `ifGenerationMatch=0`, an MD5 provider check and SHA-256
content checks. A lost response is reconciled by reading the exact object and
verifying its generation, metadata and bytes; a conflict is never overwritten.
Ordered JSONL chunks contain at most 500 rows or 8 MiB, with 128 KiB row and 20,000 chunk
bounds. The final manifest is published last, binds all chunk generations, sizes,
digests, row boundaries, source fence and full snapshot digest, and is reread before
validation finishes. An interrupted upload has no complete manifest. Permission
errors and timeouts are failures, not absence. Replaced terminal generations are
rejected even when bytes happen to match.

The existing source recovery validator checks actual remote bytes, every row,
global order, exact source fence/count/XOR and the final manifest before journal
acknowledgment or pruning. Hosted restore requires both the branded approved
PRIVATE/IAM SQL pool for the configured restore database and the genuine GCS store
bound to the same configuration and snapshot. Search remains unavailable until the
existing restore publication gate completes. Local generic file restore keeps its
original demo database/loopback restrictions.

`publishHostedPostgisSnapshot` streams bounded SQL pages from one repeatable-read
publication directly to the store; it uses no runner filesystem. Slow uploads can
exceed the SQL idle transaction timeout and abort safely. Partial immutable objects
remain chargeable and must be reconciled by the same reserved job, never treated as
recovery coverage. `restoreHostedPostgisSnapshot` restores one bounded page using
the existing durable progress contract. Neither helper deploys or provisions.

Configuration under `hosted.snapshot` is exactly:

```json
{
  "bucket": "OWNER_APPROVED_BUCKET",
  "bucketCreatedAt": "OWNER_VERIFIED_PROVIDER_CREATION_TIME",
  "prefix": "runs/OWNER_APPROVED_RUN/snapshots/",
  "snapshotId": "OWNER_APPROVED_SNAPSHOT_ID",
  "serviceAccountEmail": "OWNER_APPROVED_SERVICE_ACCOUNT",
  "maxSnapshotBytes": 5368709120
}
```

These placeholders are deliberately invalid. The byte allowance includes the
terminal manifest; the uploader reserves 8 MiB of that limit for it. The existing
5 GiB evidence ceiling also covers partial objects. This implementation permits one
snapshot ID in that signed configuration, so another snapshot/configuration must
receive a fresh cost/storage reservation before approval. Operators must include
existing snapshots/partials in aggregate storage accounting. No automatic bucket
creation, deletion, lifecycle or new retention promise is part of this adapter.

For future Gate1, approve only object-create/get permissions for the exact prefix
and bucket metadata access for the exact bucket; separate cleanup authority must
use recorded generations. Verify the attached service account, bucket project and
creation receipt, absence of unexpected holds/versioning/soft-delete exposure,
network access to the storage API, lost-response behavior and real provider bytes.
Those are hosted-only checks and have not been performed.

Local evidence: 15 injected-transport/security tests, plus two real Firestore emulator
and PostgreSQL recovery scenarios. Each exports 546 real projection rows, verifies
the snapshot before pruning old journal events, deletes the original database,
restores in 8 bounded pages with an interrupted-worker resume, then replays a later
edit. The GCS scenario also removes all local export files before restore and uses
simulated JSON API objects. This proves the adapter contract with real SQL recovery,
not actual Google storage durability, login or managed-service recovery.

Provider references checked 2026-10-17:
[request preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions),
[object upload](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert),
[exact object reads](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/get).
