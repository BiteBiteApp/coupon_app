# Hosted staging source preparation

Run BS-BITESTAR-POSTGIS-READINESS-FINISH-002, 2026-10-17. These adapters are source
prepared and tested using injected providers and loopback HTTP. No Cloud SQL
login, IAM grant, cloud client, deployment, secret read, image execution or paid
resource was exercised. The earlier frozen local Gate 0 remains valid. Linux
execution and hosted Gate 1 remain separate outstanding qualifications.

The default production index and existing demo/loopback runtime are unchanged.
`postgis_hosted_entrypoint.ts` is a separate explicit Cloud Run command. Import and
`--dry-run` do not initialize credentials. `--execute` first verifies the exact
configuration and Ed25519 approval, checks the existing numerical runtime guard,
then reads explicitly mounted isolated keys and creates provider clients. Linux
is intentionally still rejected by that guard; building an image cannot qualify
it. No default app, ambient project or password fallback is selected.

`hosted.example.json` is deliberately incomplete and unapproved. Merge its hosted
section with the original staging limits and the separate provider/snapshot
sections into one document. Use printable ASCII and safe integers; fractional
cost proposals must be conservatively rounded upward. Complete the approved
provider request bodies before signing. The canonical digest recursively sorts
all keys, including numeric-looking keys. Do not embed the configuration digest
inside that same document. The signed claims bind project ID/number, run, exact
candidate/configuration digests, gates and absolute validity. Trust keys are a
separate immutable operator input; neither approval nor configuration supplies
its own trust key. Cleanup authority ends at a separately signed bounded time and
cannot create a SQL pool or authorize ordinary execution after approval expiry.

`render-service.cjs CONFIG` writes a Cloud Run v2 descriptor to stdout only. It
requires an immutable image and exact pinned secret versions, keeps one CPU/1GiB,
min0/max4 instances, concurrency4, 30-second platform timeout, and the approved
Direct VPC network/subnet. Public transport invocation is explicit in this
proposal because browser and guest Firebase callable clients do not carry Cloud
Run IAM invoker tokens. Firebase JWT verification and existing native authority
remain inside the application. This descriptor is not an IAM action or approval
to expose anything. The future owner must approve that isolated ingress choice.

The callable HTTP transport validates one `data` envelope, a 512KiB request bound,
8MiB response bound, verified Firebase project/audience/issuer, optional verified
App Check (required only if the signed configuration enables it), and exact HTTPS
browser origins with bounded preflight headers. User/admin fields in the body or
extra identity headers never establish identity. Four in-flight handlers bound
admission. Responses time out after25 seconds; a late SDK operation retains its
admission slot until it settles. It cannot admit an unlimited set of replacement
operations. SDK operations are not falsely described as cancelled. HTTP shutdown
force-closes remaining connections after two seconds. Unexpected errors expose
only the safe callable error envelope. [Firebase callable protocol](https://firebase.google.com/docs/functions/callable-reference).

The connector is pinned to `@google-cloud/cloud-sql-connector`1.12.1. All existing
package versions remain unchanged. It always requests PRIVATE IP and automatic
IAM database authentication, providing its authenticated TLS stream directly to
pg8.16.3. No host/password/TLS-disable override is accepted. The pool has four
connections, 2s acquisition, 5s server statement, 5.5s driver query, 10s idle and
idle-transaction bounds, and a50-minute connection lifetime. A real identity query
checks database and IAM username before returning the branded pool. Initial
connector setup waits at most10s; a late successful setup is closed. A failed
first metadata refresh with an explicit instance name has no socket or refresh
interval; it is not passed to the pinned SDK's `close()` rejection-cache bug.
Successful pools close both driver and connector; errored leases are destroyed.
Automatic ephemeral credential refresh remains the SDK's responsibility and
requires a real Gate1 expiry/refresh/failure drill. Local injected tests prove the
adapter contract, not a managed login or the provider SDK's internal fault paths.
[Official connector](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector).

The future application identity must be the configured service account. It needs
Cloud SQL Client/connect and Cloud SQL Instance User/login access in the isolated
project. Create the corresponding IAM database user separately, using the service
account email without `.gserviceaccount.com` as the PostgreSQL username. Database
CONNECT, schema USAGE, and exact derived-table/sequence privileges are separate SQL
grants; installing extensions/creating the schema belongs to the explicitly
approved bootstrap identity. Do not grant production database access. A restore
uses the separately named fresh database in the same approved instance. The
private pool brand verifies exact configuration, database, schema and current
execution approval before hosted snapshot operations.
[Cloud SQL IAM login requirements](https://docs.cloud.google.com/sql/docs/postgres/iam-logins).

The connector does not create a route. Provision Private Services Access for the
approved SQL VPC, no public SQL IP, Cloud SQL IAM authentication enabled, and
Cloud Run Direct VPC egress on the approved same-region subnet. Allow provider API
HTTPS443 and connector traffic3307 as required; provide approved Google API egress.
Workload identity, database user, routing, APIs, exact Secret Manager versions,
Firestore named-database grants and App Check setup are future prerequisites,
not actions performed here. [Cloud Run SQL connectivity](https://docs.cloud.google.com/sql/docs/postgres/connect-run),
[Direct VPC egress](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc).

Before Gate1, exercise real encrypted IAM login and credential rotation, revoked
login, unavailable private route, pool recovery, instance restart, exact native
HTTP/browser identity behavior, pipeline source enrollment/delivery, and bounded
snapshot restore. Record actual server/extension/runtime versions and the image
actually run. Do not infer these results from local transport tests.
