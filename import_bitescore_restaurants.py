"""Future-safe Google Places importer for the BiteScore restaurant catalog.

This module is intentionally import-safe: Google and Firebase clients are only
loaded and initialized from ``main`` or explicitly invoked runtime functions.
"""

from __future__ import annotations

import argparse
import csv
import math
import os
import re
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


TARGET_COLLECTION = "bitescore_restaurants"
GOOGLE_MAPS_API_KEY_ENV = "GOOGLE_MAPS_API_KEY"
DEFAULT_FIREBASE_KEY_PATH = Path("secrets/firebase-key.json")

# Must match functions/src/restaurant_geo_helpers.ts and GeoFire's explicit
# 10-character Base32 contract.
GEOHASH_PRECISION = 10
GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"


def valid_restaurant_coordinates(
    latitude: object,
    longitude: object,
) -> tuple[float, float] | None:
    if (
        isinstance(latitude, bool)
        or isinstance(longitude, bool)
        or not isinstance(latitude, (int, float))
        or not isinstance(longitude, (int, float))
    ):
        return None

    normalized_latitude = float(latitude)
    normalized_longitude = float(longitude)
    if (
        not math.isfinite(normalized_latitude)
        or not math.isfinite(normalized_longitude)
        or normalized_latitude < -90
        or normalized_latitude > 90
        or normalized_longitude < -180
        or normalized_longitude > 180
        or (normalized_latitude == 0 and normalized_longitude == 0)
    ):
        return None

    return normalized_latitude, normalized_longitude


def canonical_restaurant_geohash(
    latitude: object,
    longitude: object,
) -> str:
    coordinates = valid_restaurant_coordinates(latitude, longitude)
    if coordinates is None:
        raise ValueError("Valid restaurant coordinates are required.")

    latitude_range = [-90.0, 90.0]
    longitude_range = [-180.0, 180.0]
    geohash: list[str] = []
    hash_value = 0
    bits = 0
    use_longitude = True

    while len(geohash) < GEOHASH_PRECISION:
        value = coordinates[1] if use_longitude else coordinates[0]
        value_range = longitude_range if use_longitude else latitude_range
        midpoint = (value_range[0] + value_range[1]) / 2
        if value > midpoint:
            hash_value = (hash_value << 1) + 1
            value_range[0] = midpoint
        else:
            hash_value <<= 1
            value_range[1] = midpoint

        use_longitude = not use_longitude
        if bits < 4:
            bits += 1
        else:
            geohash.append(GEOHASH_BASE32[hash_value])
            hash_value = 0
            bits = 0

    return "".join(geohash)


def require_google_maps_api_key(
    environ: Mapping[str, str] | None = None,
) -> str:
    environment = os.environ if environ is None else environ
    api_key = environment.get(GOOGLE_MAPS_API_KEY_ENV, "").strip()
    if not api_key:
        raise RuntimeError(
            f"Set {GOOGLE_MAPS_API_KEY_ENV} before running the importer."
        )
    return api_key


def parse_city_state_zip(address: str) -> tuple[str, str, str]:
    city = ""
    state = ""
    zip_code = ""

    parts = [part.strip() for part in address.split(",") if part.strip()]
    if len(parts) >= 3:
        city = parts[-2]

    last_part = parts[-1] if parts else ""
    match = re.search(r"\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b", last_part)
    if match:
        state = match.group(1)
        zip_code = match.group(2)

    return city, state, zip_code


def get_place_details(
    place_id: str,
    api_key: str,
    http_get: Callable[..., Any] | None = None,
) -> dict[str, object] | None:
    if http_get is None:
        import requests

        http_get = requests.get

    response = http_get(
        "https://maps.googleapis.com/maps/api/place/details/json",
        params={
            "place_id": place_id,
            "fields": (
                "name,formatted_address,geometry,website,"
                "formatted_phone_number"
            ),
            "key": api_key,
        },
        timeout=20,
    )
    data = response.json()
    result = data.get("result")
    if not isinstance(result, dict):
        print(f"Skipped {place_id}: {data.get('status')}")
        return None

    geometry = result.get("geometry")
    raw_location = geometry.get("location") if isinstance(geometry, dict) else None
    latitude = raw_location.get("lat") if isinstance(raw_location, dict) else None
    longitude = raw_location.get("lng") if isinstance(raw_location, dict) else None
    coordinates = valid_restaurant_coordinates(latitude, longitude)
    if coordinates is None:
        print(f"Skipped {place_id}: invalid or missing Google coordinates")
        return None

    address = str(result.get("formatted_address") or "")
    city, state, zip_code = parse_city_state_zip(address)
    return {
        "name": str(result.get("name") or ""),
        "address": address,
        "city": city,
        "state": state,
        "zipCode": zip_code,
        "website": str(result.get("website") or ""),
        "phone": str(result.get("formatted_phone_number") or ""),
        "latitude": coordinates[0],
        "longitude": coordinates[1],
    }


def build_restaurant_document(
    place_id: str,
    details: Mapping[str, object],
    geo_point_factory: Callable[[float, float], object],
    server_timestamp: object,
) -> dict[str, object]:
    coordinates = valid_restaurant_coordinates(
        details.get("latitude"),
        details.get("longitude"),
    )
    if coordinates is None:
        raise ValueError("Valid Google-provided restaurant coordinates are required.")

    name = str(details.get("name") or "")
    address = str(details.get("address") or "")
    latitude, longitude = coordinates
    return {
        "id": place_id,
        "placeId": place_id,
        "name": name,
        "normalizedName": name.strip().lower(),
        "address": address,
        "streetAddress": address,
        "city": str(details.get("city") or ""),
        "state": str(details.get("state") or ""),
        "zip": str(details.get("zipCode") or ""),
        "zipCode": str(details.get("zipCode") or ""),
        "website": str(details.get("website") or ""),
        "phone": str(details.get("phone") or ""),
        "location": geo_point_factory(latitude, longitude),
        "latitude": latitude,
        "longitude": longitude,
        "active": True,
        "isActive": True,
        "geohash": canonical_restaurant_geohash(latitude, longitude),
        "updatedAt": server_timestamp,
    }


def upload_restaurants(
    csv_file: Path,
    api_key: str,
    database: Any,
    geo_point_factory: Callable[[float, float], object],
    server_timestamp: object,
    http_get: Callable[..., Any] | None = None,
) -> None:
    with csv_file.open(newline="", encoding="utf-8-sig") as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            place_id = (row.get("Place ID") or row.get("place_id") or "").strip()
            if not place_id:
                continue

            details = get_place_details(place_id, api_key, http_get=http_get)
            if details is None:
                continue

            document = build_restaurant_document(
                place_id,
                details,
                geo_point_factory,
                server_timestamp,
            )
            database.collection(TARGET_COLLECTION).document(place_id).set(
                document,
                merge=True,
            )
            print(f"Uploaded: {details['name']}")

    print("DONE")


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import Google Places restaurants into the BiteScore catalog.",
    )
    parser.add_argument("csv_file", type=Path, help="CSV containing Google Place IDs")
    parser.add_argument(
        "--firebase-key",
        type=Path,
        default=DEFAULT_FIREBASE_KEY_PATH,
        help="Firebase Admin service-account JSON path",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> None:
    args = _parse_args(argv)
    api_key = require_google_maps_api_key()
    csv_file = args.csv_file.expanduser().resolve()
    firebase_key = args.firebase_key.expanduser().resolve()
    if not csv_file.is_file():
        raise FileNotFoundError(f"CSV file not found: {csv_file}")
    if not firebase_key.is_file():
        raise FileNotFoundError(f"Firebase key file not found: {firebase_key}")

    import firebase_admin
    from firebase_admin import credentials, firestore

    credential = credentials.Certificate(firebase_key)
    firebase_admin.initialize_app(credential)
    upload_restaurants(
        csv_file,
        api_key,
        firestore.client(),
        firestore.GeoPoint,
        firestore.SERVER_TIMESTAMP,
    )


if __name__ == "__main__":
    main()
