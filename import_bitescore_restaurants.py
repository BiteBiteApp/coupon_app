import csv
import re
import requests
import firebase_admin
from firebase_admin import credentials, firestore

# ---------- CHANGE THESE 3 LINES ----------
GOOGLE_API_KEY = "AIzaSyB0MBT1CVdu4kZLQ8rsWDk8m44RFoe6r2o"
FIREBASE_KEY_PATH = "C:/Users/sakar/Desktop/24 trailer/App Data/VS Code app stuff/coupon_app/firebase-key.json"
CSV_FILE = "C:/Users/sakar/Desktop/24 trailer/App Data/VS Code app stuff/coupon_app/restaurants.csv"
# -----------------------------------------

cred = credentials.Certificate(FIREBASE_KEY_PATH)
firebase_admin.initialize_app(cred)
db = firestore.client()


def parse_city_state_zip(address: str):
    city = ""
    state = ""
    zip_code = ""

    parts = [p.strip() for p in address.split(",") if p.strip()]

    if len(parts) >= 3:
        city = parts[-2]

    last_part = parts[-1] if parts else ""
    match = re.search(r"\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b", last_part)
    if match:
        state = match.group(1)
        zip_code = match.group(2)

    return city, state, zip_code


def get_place_details(place_id):
    url = "https://maps.googleapis.com/maps/api/place/details/json"
    params = {
        "place_id": place_id,
        "fields": "name,formatted_address,geometry,website,formatted_phone_number",
        "key": GOOGLE_API_KEY,
    }

    res = requests.get(url, params=params, timeout=20)
    data = res.json()

    if "result" not in data:
        print(f"Skipped {place_id}: {data.get('status')}")
        return None

    result = data["result"]
    address = result.get("formatted_address", "")
    city, state, zip_code = parse_city_state_zip(address)

    return {
        "name": result.get("name", ""),
        "address": address,
        "city": city,
        "state": state,
        "zipCode": zip_code,
        "website": result.get("website", ""),
        "phone": result.get("formatted_phone_number", ""),
        "lat": result["geometry"]["location"]["lat"],
        "lng": result["geometry"]["location"]["lng"],
    }


def upload_restaurants():
    with open(CSV_FILE, newline="", encoding="utf-8-sig") as csvfile:
        reader = csv.DictReader(csvfile)

        for row in reader:
            place_id = (row.get("Place ID") or row.get("place_id") or "").strip()

            if not place_id:
                continue

            details = get_place_details(place_id)
            if not details:
                continue

            doc_ref = db.collection("bitescore_restaurants").document(place_id)

            doc_ref.set(
                {
                    "id": place_id,
                    "placeId": place_id,
                    "name": details["name"],
                    "normalizedName": details["name"].strip().lower(),
                    "address": details["address"],
                    "streetAddress": details["address"],
                    "city": details["city"],
                    "state": details["state"],
                    "zip": details["zipCode"],
                    "zipCode": details["zipCode"],
                    "website": details["website"],
                    "phone": details["phone"],
                    "location": firestore.GeoPoint(details["lat"], details["lng"]),
                    "latitude": details["lat"],
                    "longitude": details["lng"],
                    "active": True,
                    "isActive": True,
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                },
                merge=True,
            )

            print(f"Uploaded: {details['name']}")

    print("DONE")


if __name__ == "__main__":
    upload_restaurants()