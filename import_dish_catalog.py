import csv
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore

CSV_FILE = r"starter_dish_catalog.csv"
FIREBASE_KEY_PATH = r"secrets/firebase-key.json"

cred = credentials.Certificate(FIREBASE_KEY_PATH)
firebase_admin.initialize_app(cred)
db = firestore.client()

with open(CSV_FILE, newline="", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    count = 0
    for row in reader:
        normalized_name = (row.get("normalizedName") or "").strip()
        canonical_name = (row.get("canonicalName") or "").strip()
        if not normalized_name or not canonical_name:
            continue

        aliases = [a.strip() for a in (row.get("aliases") or "").split("|") if a.strip()]
        cuisine_tags = [c.strip() for c in (row.get("cuisineTags") or "").split("|") if c.strip()]
        is_active = str(row.get("isActive", "true")).strip().lower() == "true"

        doc = {
            "canonicalName": canonical_name,
            "normalizedName": normalized_name,
            "aliases": aliases,
            "category": (row.get("category") or "").strip(),
            "cuisineTags": cuisine_tags,
            "isActive": is_active,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }

        ref = db.collection("dish_catalog").document(normalized_name)
        if not ref.get().exists:
            doc["createdAt"] = firestore.SERVER_TIMESTAMP

        ref.set(doc, merge=True)
        count += 1

print(f"Done. Uploaded/updated {count} dish catalog items.")
