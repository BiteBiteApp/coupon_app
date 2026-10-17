"""Read-only consistency checks for the nonexecuting safety release package.

No network, deployment, emulator startup or provider access. This verifies
artifact wiring and source-default preservation, not live qualification.
"""

import hashlib
import json
import re
from pathlib import Path


PACKAGE = Path(__file__).resolve().parent
ROOT = PACKAGE.parents[1]
PROJECT = "coupon-app-29446"


def read(name):
    return json.loads((PACKAGE / name).read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check(value, message):
    if not value:
        raise ValueError(message)


def main():
    manifest = read("release-manifest.json")
    descriptor = read("candidate/execution-descriptor.json")
    terms = read("candidate/approved-terms.json")
    phases = read("candidate/runtime-phases.json")
    policies = read("candidate/policy-delta.json")
    indexes = read("candidate/index-field-deltas.json")
    iam = read("candidate/iam-proposals.json")
    contracts = read("candidate/qualification-contracts.json")["groups"]
    for path in PACKAGE.rglob("*.json"):
        json.loads(path.read_text())
    for name in ["release-manifest.json", "candidate/policy-delta.json"] + manifest["configurationFiles"]:
        check(read(name)["executionEnabled"] is False, f"execution enabled: {name}")
    for name in ["deploymentAuthorized", "activationAuthorized", "providerCallsAuthorized", "paidResourcesAuthorized"]:
        check(descriptor[name] is False, f"authority enabled: {name}")
    check(descriptor["commands"] == [], "descriptor contains commands")
    check(phases["productionWritesAuthorized"] is False, "runtime writes authorized")
    check(iam["productionMutationAuthorized"] is False, "IAM mutation authorized")
    check(terms["notAnAcceptanceReceipt"] is True, "candidate is not a receipt")
    canonical = ROOT / terms["canonicalTextPath"]
    check(sha(canonical) == terms["canonicalTextSha256"], "legal hash mismatch")
    check(terms["text"].encode() == canonical.read_bytes(), "legal byte mismatch")
    for key, path in [
        ("baseFirestoreSha256", "baselines/firestore-live.rules"),
        ("baseStorageSha256", "baselines/storage-live.rules"),
        ("firestoreSha256", "candidate/firestore.rules"),
        ("storageSha256", "candidate/storage.rules"),
    ]:
        check(sha(PACKAGE / path) == policies[key], f"policy hash mismatch: {path}")

    paused = phases["phases"]["enforcedPaused"]
    check(all(value["required"] is True for value in paused.values()), "paused enforcement absent")
    photo = paused["private_bitescore_runtime/photo_screening"]
    text = paused["private_bitescore_runtime/review_text"]
    check(photo["ownerRequired"] and not photo["enabled"] and not photo["ownerEnabled"], "unsafe photo pause")
    check(not text["processingEnabled"] and photo["cleanupEnabled"] and text["cleanupEnabled"], "unsafe text/cleanup pause")
    baseline = read("baselines/live-metadata.json")
    aggregation = next(row["result"]["value"] for row in baseline["runtime"] if row["path"].endswith("/aggregation"))
    check(phases["preserveLiveAggregation"] == aggregation, "aggregation changed")
    source_defaults = {
        "lib/services/bitescore_terms_service.dart": r"static const bool enabled = false;",
        "lib/services/registration_age_policy.dart": r"static const bool enabled = false;",
        "functions/src/bitescore_terms.ts": r"export const approvedBiteScoreTerms: ApprovedBiteScoreTerms \| null = null;",
        "functions/src/customer_bitescore_runtime.ts": r"export const reviewTextProviderWiringEnabled = false;",
    }
    for path, pattern in source_defaults.items():
        check(re.search(pattern, (ROOT / path).read_text()), f"source gate changed: {path}")
    check(len(descriptor["clientCandidate"]["futureSourceBindings"]) == 4, "missing future source gate")
    for binding in descriptor["clientCandidate"]["futureSourceBindings"]:
        check(binding["authorized"] is False and (ROOT / binding["path"]).is_file(), "invalid source proposal")

    index_fields = {(r["collectionGroup"], r["fieldPath"]) for r in indexes["fieldOverrides"]}
    check(index_fields == {
        ("private_bitescore_review_text", "expiresAt"),
        ("private_bitescore_review_text", "headline"),
        ("private_bitescore_review_text", "notes"),
        ("private_bitescore_review_text", "signal"),
        ("reviewer_safety_state", "targetUserId"),
        ("blocked_reviewers", "targetUserId"),
    }, "unexpected field overrides")
    check(indexes["indexes"] == [], "unexpected composite proposal")
    root_fields = json.loads((ROOT / "firestore.indexes.json").read_text())["fieldOverrides"]
    check(all(field in root_fields for field in indexes["fieldOverrides"]), "field delta differs from source")

    resources = manifest["functionResources"]
    exports = {row["export"] for row in resources}
    check(len(exports) == len(resources) == 53, "missing/duplicate export")
    for row in resources:
        options = row["candidateOptions"]
        check(row["resource"] == f"projects/{PROJECT}/locations/{options['region']}/functions/{row['export']}", "resource mismatch")
        for path in [row["exportSource"], row["wrapperSource"]] + row["implementationSources"]:
            check((ROOT / path).is_file(), f"missing source: {path}")
        check(row["export"] in (ROOT / row["exportSource"]).read_text(), f"missing export: {row['export']}")
        check(row["group"] in contracts, f"missing qualification group: {row['group']}")
        check(row["qualificationContract"] == "candidate/qualification-contracts.json#/groups/" + row["group"], "contract reference mismatch")
        check((PACKAGE / row["baseline"]["evidence"]).is_file(), "missing baseline evidence")
        if row["kind"] == "firestore-trigger":
            check(options["database"] == "(default)" and options["eventType"] == "google.cloud.firestore.document.v1.written", "trigger event mismatch")
            check("{" in options["document"], "missing document target")
        if row["kind"] == "storage-finalize":
            check(options["region"] == "us-east1" and options["bucket"] == PROJECT + ".firebasestorage.app", "finalizer scope mismatch")
        if row["kind"] == "schedule":
            check(options["schedulerResource"].endswith("firebase-schedule-" + row["export"] + "-" + options["region"]), "schedule scope mismatch")
    for contract in contracts.values():
        check(contract["evidence"] and contract["laterAuthorizedLiveAcceptance"] and contract["recovery"], "empty qualification contract")
        for path in contract["testFiles"]:
            check((ROOT / path).is_file(), f"missing relevant test: {path}")
    invokers = {row["export"]: row for row in iam["callableInvoker"] + iam["scheduleAndTriggerInvoker"]}
    check(set(invokers) == exports, "invoker set mismatch")
    for row in resources:
        options, binding = row["candidateOptions"], invokers[row["export"]]
        check(binding["role"] == "roles/run.invoker", "wrong invoker role")
        check(binding["scope"] == f"projects/{PROJECT}/locations/{options['region']}/services/{row['export'].lower()}", "invoker resource mismatch")
        expected = "allUsers" if row["kind"] == "callable" else "serviceAccount:" + options["runtimeServiceAccount"]
        check(binding["member"] == expected, "invoker principal mismatch")
    check(iam["existingServiceAgents"] == read("baselines/trigger-bindings.json")["serviceAgents"], "service-agent baseline mismatch")
    check("BEFORE" in descriptor["requiredReleaseOrder"][1], "missing pre-paid freeze")
    check("BEFORE" in manifest["ordering"][0]["actions"][0], "manifest missing pre-paid freeze")
    check("Ready metadata alone does not prove" in manifest["recovery"]["revisionProcedure"], "unqualified rollback assertion")
    check(manifest["policies"]["firestore"]["deployRootRules"] is False and manifest["policies"]["storage"]["deployRootRules"] is False, "blanket policy deployment")
    print(json.dumps({"status": "PASS", "exports": len(resources), "qualificationGroups": len(contracts), "candidatePolicyHashesVerified": True, "sourceDefaultsUnchanged": True, "networkOrProductionOperations": False}))


if __name__ == "__main__":
    main()
