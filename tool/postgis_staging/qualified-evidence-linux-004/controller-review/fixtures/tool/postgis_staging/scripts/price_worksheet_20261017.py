"""Dated source-only estimate. No credentials, provider clients or network calls."""
from decimal import Decimal
from pathlib import Path
import json

RATE_FILE = Path(__file__).resolve().parents[1] / "pricing-2026-10-17.json"


def worksheet():
    source = json.loads(RATE_FILE.read_text())
    rate = {key: Decimal(value["usd"]) for key, value in source["rates"].items()}
    items = []

    def add(name, units, key, assumption):
        amount = Decimal(str(units)) * rate[key]
        items.append({"item": name, "units": str(units), "rateKey": key,
                      "usd": str(amount), "assumption": assumption})

    # Same original 4CPU/16GiB Enterprise scenario:48h zonal +24h HA.
    add("SQL vCPU", 4 * 96, "sqlCpuHour", "48 zonal +24 HA hours; HA requires later Gate3 approval")
    add("SQL memory", 16 * 96, "sqlMemoryGiBHour", "16GiB; same96 effective zonal hours")
    add("SQL zonal SSD", 100 * 48, "sqlSsdGiBHour", "100GiB; no auto-resize")
    add("SQL HA SSD", 100 * 24, "sqlHaSsdGiBHour", "100GiB; conditional24h HA")
    add("SQL backups and retained exposure", 300 * (72 + 72), "sqlBackupGiBHour",
        "Conservative3x100GiB over full72h plus3days after deletion; no final/on-demand backup assumed")
    add("SQL PITR/log allowance", 100 * 72, "sqlBackupGiBHour",
        "Conservative100GiB charged-equivalent allowance for1-day PITR; actual managed log billing/storage must be checked")
    add("Search app CPU", 4 * 72 * 3600, "runCpuSecond", "Upper all4instances busy full72h; minInstances0")
    add("Search app memory", 4 * 72 * 3600, "runMemoryGiBSecond", "1GiB/instance; same billable duration")
    add("Search HTTP requests", 1, "runMillionRequests", "All1million attempts, including failed/retried transports")
    add("Ingestion/control CPU planning allowance", 400000, "runCpuSecond",
        "Assumed400k billable seconds, NOT measured; reserve each batch using Gate1/2 calibration before expansion")
    add("Ingestion/control memory planning allowance", 400000, "runMemoryGiBSecond", "1GiB; same assumed400k seconds")
    add("Load runner CPU", 21600, "runJobCpuSecond", "One1CPU job; six active hours, bounded600s invocations")
    add("Load runner memory", 21600, "runJobMemoryGiBSecond", "One1GiB job; six active hours")
    add("Firestore reads", 2000, "firestoreRead100k",
        "200million total billable read units INCLUDING index-entry batches, minimum queries, retries and authority reads")
    add("Firestore writes", 400, "firestoreWrite100k", "40million total including projection/outbox/head/enrollment/control")
    add("Firestore deletes", 300, "firestoreDelete100k", "30million incl TTL/cleanup; no free named-database quota assumed")
    add("Firestore document+index storage", 100 * 72, "firestoreStorageGiBHour",
        "100GiB assumed combined documents, indexes and metadata for72h; measure actual growth before load")
    add("Firestore retained storage exposure", 100 * 24, "firestoreStorageGiBHour",
        "One additional day deletion/reconciliation contingency; not a retention promise")
    add("North America Internet egress", 50, "networkInternetGiB", "Assumed50GiB; destination-limited estimate")
    add("Cross-zone private transfer", 200, "networkCrossZoneGiB", "Assumed200GiB; same-region Direct VPC; no NAT/connector VM")
    add("Logging", 10, "logIngestGiB", "10GiB; no free allotment credit; <=30day storage included")
    add("Artifact Registry retained image", 2 * 240, "artifactGiBHour", "2GiB for72h +7days; builds local; no hosted build")
    add("Snapshot evidence retention", 5 * 240, "gcsGiBHour", "5GiB for72h +7days; existing proposal, no new retention promise")
    add("Snapshot possible soft-delete exposure", 5 * 168, "gcsGiBHour", "Additional7days if provider soft-delete policy applies; verify before approval")
    add("GCS controller/snapshot writes", 100, "gcsClassA1000", "100k assumed operations including CAS, failed/retried requests")
    add("GCS controller/snapshot reads", 1000, "gcsClassB1000", "1million assumed reads including repeated verification/pruning")
    add("Independent control internal steps", 432, "workflowInternal1000", "Once/minute for72h, up to100 internal steps per check including polls/retries")
    add("Control external steps", 10, "workflowExternal1000", "10k assumed external steps/alert calls")
    add("Scheduler", Decimal(3) / 31, "schedulerJob31Days", "One job, three days; paused jobs still charged; no free credit")
    allowances = {"network/destination and API-accounting uncertainty": "7",
                  "alerts, trigger delivery, storage metadata, scanning and retained-charge uncertainty": "15"}
    modeled = sum(Decimal(item["usd"]) for item in items) + sum(Decimal(x) for x in allowances.values())
    historical = Decimal("255.54")
    total = modeled + Decimal("30")
    return {"checkedDate": source["checkedDate"], "region": "us-central1", "currency": "USD",
            "noDiscountCreditsOrTaxAssumed": True, "ratesVerifiedFromOfficialPublicPages": True,
            "actualAccountPricesAndUsageVerified": False, "paidRunAuthorized": False,
            "items": items, "explicitUnpricedAllowancesUsd": allowances,
            "modeledUsd": str(modeled.quantize(Decimal("0.01"))), "cleanupReserveUsd": "30.00",
            "modeledPlusReserveUsd": str(total.quantize(Decimal("0.01"))),
            "historical20261002PlusReserveUsd": str(historical),
            "changeFromRoundedHistoricalUsd": str((total - historical).quantize(Decimal("0.01"))),
            "planningCeilingUsd": "300.00", "earlyOwnerCheckpointUsd": "100.00",
            "verdict": "PLANNING ONLY; independent reservations, owner checkpoint and actual billing calibration required",
            "idleAndCleanup": "SQL billed throughout72h even idle; app min0; cleanup30 reserved separately. Deleted SQL is not proof all backups/logs/artifacts are unbilled.",
            "conditionalCosts": "No second SQL instance, NAT, VPC connector VM, paid CI, remote build, extra backups or minimum Run instances included; any change needs a new itemized forecast and approval.",
            "notAGuaranteedMaximum": "Unmeasured ingestion/runtime and retained-service costs can exceed assumptions. Gates stop before reservation/checkpoint limits; provider alerts/caps do not guarantee the overall ceiling."}


if __name__ == "__main__":
    print(json.dumps(worksheet(), indent=2))
