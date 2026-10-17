# Linux package, execution unverified

No Docker, Podman, Lima, Colima, QEMU or Multipass executable, or common Docker,
Podman Desktop, UTM or OrbStack installation was found on this macOS host on
2026-10-17. Nothing was installed or rented, no remote CI was used, and no Linux
image was pulled, built, run or pushed. The actual environment prerequisite is a
local Linux/amd64 engine (or explicitly identified emulation) with enough space
for the retained synthetic SQL/emulator fixtures. Native Linux and emulation must
be reported separately.

The Dockerfile pins the official Node24.21.0 Debian bookworm-slim linux/amd64
manifest and a separate official Python3.12.13 Bookworm build stage. The build
stage receives the pinned Node binary, npm and required C++ runtime, plus the exact
Python provider/guard modules used by the cross-language contracts. Missing Python
fails those tests; no cross-language test is skipped. `runtime-source.json` records
the observed public manifests and official
Node archive SHA256. Those are source inputs, not a built image hash or an
executed binary measurement. Dependencies install from package-lock with scripts
disabled. The image builds the actual functions source and runs only injected
cloud contracts. Its default command is a no-credential dry run. No production
index is started and no deployment command is included.

From repository root on a suitable local engine:

```sh
docker build --platform=linux/amd64 -f tool/postgis_staging/linux/Dockerfile -t bitestar-postgis-readiness:local .
docker image inspect bitestar-postgis-readiness:local
docker run --rm --network=none bitestar-postgis-readiness:local
```

Retain full build/test output, actual image ID, OS/CPU/native-or-emulated status,
`node --version`, V8 version, executable SHA256 and flags. Do not push the image.
The existing numerical serving guard still rejects Linux; no build-time or
runtime flag bypass was added.

Next, provision only disposable local PostgreSQL/PostGIS and Firestore/Auth
emulators using the existing synthetic fixture contracts. The numerical diagnostic
expects PostgreSQL on127.0.0.1:55441, database `bsgate0_linux`, role `bsgate0` in the
same local network namespace. The role and fixed loopback restrictions are the
existing local candidate boundary. `node numerical-diagnostics.cjs` evaluates the
actual SQL lower-bound expression for318 branch/boundary pairs and1,512 radius-edge
vectors, and records actual SQL/runtime hashes. It is a diagnostic, not universal
proof or serving authorization. It neither calls the guarded serving selector nor
modifies the guard. Retain the prior exact-rational source audit and reconcile its
V8 polynomial source/rounding assumptions with this exact Linux build and CPU.

Only after that review can a separate narrow change add a qualified Linux tuple.
Then execute the actual matching/order, source, query, snapshot, cleanup and
native HTTP/Flutter rendered suites with the existing local synthetic fixtures.
Exercise acquisition/query deadlines, process restart, lost connections and
credential-independent recovery. Freeze the precise image tested. Managed Cloud
SQL PostGIS/server patch versions and hosted CPU/network behavior still need the
small separately approved hosted compatibility gate; a local Linux PASS cannot
claim hosted equivalence.

Current status: source package prepared; Linux build, numerical proof, real SQL,
pool recovery and rendered-consumer execution all **UNVERIFIED**. The original
macOS Gate0 evidence and runtime whitelist remain unchanged.
