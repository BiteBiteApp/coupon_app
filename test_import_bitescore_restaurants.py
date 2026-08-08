import contextlib
import importlib.util
import io
import math
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import import_bitescore_restaurants as importer


CANONICAL_FIXTURES = (
    (37.4219999, -122.0840575, "9q9hvumngq"),
    (51.5074, -0.1278, "gcpvj0duq5"),
    (-33.8688, 151.2093, "r3gx2f77bn"),
    (0.0001, -0.0001, "ebpbpbpbtd"),
    (-0.0001, 0.0001, "kpbpbpbp6m"),
    (90, 180, "zzzzzzzzzz"),
    (-90, -180, "0000000000"),
)


class ImportBiteScoreRestaurantsTest(unittest.TestCase):
    def test_known_coordinates_match_functions_geohashes(self):
        self.assertEqual(importer.GEOHASH_PRECISION, 10)
        for latitude, longitude, expected in CANONICAL_FIXTURES:
            with self.subTest(latitude=latitude, longitude=longitude):
                self.assertEqual(
                    importer.canonical_restaurant_geohash(latitude, longitude),
                    expected,
                )

    def test_invalid_coordinates_are_rejected(self):
        invalid_values = (
            (None, -82),
            (28, None),
            ("28", -82),
            (28, "-82"),
            (math.nan, -82),
            (28, math.inf),
            (-90.01, -82),
            (90.01, -82),
            (28, -180.01),
            (28, 180.01),
            (0, 0),
        )
        for latitude, longitude in invalid_values:
            with self.subTest(latitude=latitude, longitude=longitude):
                self.assertIsNone(
                    importer.valid_restaurant_coordinates(latitude, longitude)
                )
                with self.assertRaises(ValueError):
                    importer.canonical_restaurant_geohash(latitude, longitude)

        self.assertEqual(
            importer.valid_restaurant_coordinates(0.0001, -0.0001),
            (0.0001, -0.0001),
        )
        self.assertEqual(
            importer.valid_restaurant_coordinates(-90, -180),
            (-90.0, -180.0),
        )
        self.assertEqual(
            importer.valid_restaurant_coordinates(90, 180),
            (90.0, 180.0),
        )

    def test_missing_environment_key_fails_safely(self):
        with mock.patch.dict(os.environ):
            os.environ.pop(importer.GOOGLE_MAPS_API_KEY_ENV, None)
            with self.assertRaisesRegex(
                RuntimeError,
                importer.GOOGLE_MAPS_API_KEY_ENV,
            ):
                importer.require_google_maps_api_key()

    def test_importing_module_does_not_execute_importer(self):
        module_path = Path(importer.__file__).resolve()
        spec = importlib.util.spec_from_file_location(
            "import_bitescore_restaurants_import_safety_test",
            module_path,
        )
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        imported_module = importlib.util.module_from_spec(spec)
        output = io.StringIO()

        with contextlib.redirect_stdout(output):
            spec.loader.exec_module(imported_module)

        self.assertEqual(output.getvalue(), "")
        self.assertTrue(callable(imported_module.main))

    def test_target_collection_is_bitescore_only(self):
        self.assertEqual(importer.TARGET_COLLECTION, "bitescore_restaurants")
        self.assertNotEqual(importer.TARGET_COLLECTION, "restaurant_accounts")

    def test_document_contains_geohash_but_no_restaurant_hours(self):
        server_timestamp = object()
        document = importer.build_restaurant_document(
            "place-123",
            {
                "name": "Example Restaurant",
                "address": "1 Main St, Example, FL 34450",
                "city": "Example",
                "state": "FL",
                "zipCode": "34450",
                "website": "https://example.com",
                "phone": "555-0100",
                "latitude": 28.8517,
                "longitude": -82.487,
            },
            lambda latitude, longitude: (latitude, longitude),
            server_timestamp,
        )

        self.assertEqual(document["placeId"], "place-123")
        self.assertEqual(document["geohash"], "djjk4uqc3d")
        self.assertEqual(document["location"], (28.8517, -82.487))
        self.assertEqual(
            document["sourceSchemaVersion"],
            importer.SOURCE_SCHEMA_VERSION,
        )
        self.assertIs(document["createdAt"], server_timestamp)
        self.assertIs(document["updatedAt"], server_timestamp)
        self.assertTrue(document["isActive"])
        self.assertFalse(document["isClaimed"])
        for field in ("hours", "businessHours", "openingHours"):
            self.assertNotIn(field, document)

    def test_zip_state_city_and_name_contract_is_canonical(self):
        self.assertEqual(importer.normalize_zip5("34450"), "34450")
        self.assertEqual(importer.normalize_zip5("34450-1234"), "34450")
        self.assertEqual(importer.normalize_zip5("00501"), "00501")
        self.assertEqual(importer.normalize_zip5(""), "")
        with self.assertRaisesRegex(ValueError, "ZIP"):
            importer.normalize_zip5("3445")

        self.assertEqual(importer.normalize_state_code(" fl "), "FL")
        with self.assertRaisesRegex(ValueError, "state"):
            importer.normalize_state_code("ZZ")
        self.assertEqual(importer.normalize_city("  Crystal   River "), "Crystal River")
        with self.assertRaisesRegex(ValueError, "city"):
            importer.normalize_city(" ")
        self.assertEqual(importer.normalize_restaurant_name("  A   Cafe "), "A Cafe")

    def test_us_formatted_address_parsing_handles_country_and_zip4(self):
        self.assertEqual(
            importer.parse_city_state_zip(
                "1 Main St, Crystal River, fl 34428-1234, USA"
            ),
            ("Crystal River", "FL", "34428"),
        )

    def test_document_rejects_malformed_canonical_source_fields(self):
        base = {
            "name": "Example Restaurant",
            "address": "1 Main St, Example, FL 34450",
            "city": "Example",
            "state": "FL",
            "zipCode": "34450",
            "latitude": 28.8517,
            "longitude": -82.487,
        }
        for overrides, message in (
            ({"name": ""}, "name"),
            ({"city": ""}, "city"),
            ({"state": "ZZ"}, "state"),
            ({"zipCode": "bad"}, "ZIP"),
            ({"latitude": 999}, "coordinates"),
        ):
            with self.subTest(overrides=overrides):
                with self.assertRaisesRegex(ValueError, message):
                    importer.build_restaurant_document(
                        "place-123",
                        {**base, **overrides},
                        lambda latitude, longitude: (latitude, longitude),
                        object(),
                    )

    def test_stable_place_identity_and_existing_created_at_are_preserved(self):
        class Snapshot:
            exists = True

            @staticmethod
            def to_dict():
                return {"createdAt": "preserved-created-at"}

        class Document:
            def __init__(self, document_id):
                self.id = document_id
                self.writes = []

            @staticmethod
            def get():
                return Snapshot()

            def set(self, data, merge):
                self.writes.append((data, merge))

        class Collection:
            def __init__(self):
                self.documents = {}

            def document(self, document_id):
                self.documents.setdefault(document_id, Document(document_id))
                return self.documents[document_id]

        class Database:
            def __init__(self):
                self.collection_names = []
                self.target = Collection()

            def collection(self, name):
                self.collection_names.append(name)
                return self.target

        class Response:
            @staticmethod
            def json():
                return {
                    "result": {
                        "name": "Imported Cafe",
                        "formatted_address":
                            "1 Main St, Crystal River, FL 34428, USA",
                        "geometry": {
                            "location": {"lat": 28.8517, "lng": -82.487}
                        },
                    }
                }

        database = Database()
        with tempfile.TemporaryDirectory() as directory:
            csv_path = Path(directory) / "restaurants.csv"
            csv_path.write_text("Place ID\nplace-stable-1\n", encoding="utf-8")
            summary = importer.upload_restaurants(
                csv_path,
                "fake-api-key",
                database,
                lambda latitude, longitude: (latitude, longitude),
                "server-timestamp",
                http_get=lambda *args, **kwargs: Response(),
            )

        self.assertEqual(summary, {"validated": 1, "written": 1, "skipped": 0})
        self.assertEqual(database.collection_names, [importer.TARGET_COLLECTION])
        document = database.target.documents["place-stable-1"]
        self.assertEqual(document.id, "place-stable-1")
        self.assertEqual(len(document.writes), 1)
        payload, merge = document.writes[0]
        self.assertTrue(merge)
        self.assertEqual(payload["id"], "place-stable-1")
        self.assertEqual(payload["placeId"], "place-stable-1")
        self.assertEqual(payload["createdAt"], "preserved-created-at")
        self.assertEqual(payload["updatedAt"], "server-timestamp")

    def test_dry_run_uses_fake_http_and_performs_no_firestore_access(self):
        class NoFirestore:
            @staticmethod
            def collection(_name):
                raise AssertionError("dry-run must not access Firestore")

        class Response:
            @staticmethod
            def json():
                return {
                    "result": {
                        "name": "Dry Run Cafe",
                        "formatted_address":
                            "1 Main St, Crystal River, FL 34428, USA",
                        "geometry": {
                            "location": {"lat": 28.8517, "lng": -82.487}
                        },
                    }
                }

        http_calls = []

        def fake_http_get(*args, **kwargs):
            http_calls.append((args, kwargs))
            return Response()

        with tempfile.TemporaryDirectory() as directory:
            csv_path = Path(directory) / "restaurants.csv"
            csv_path.write_text("Place ID\nplace-dry-run\n", encoding="utf-8")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                summary = importer.upload_restaurants(
                    csv_path,
                    "fake-api-key",
                    NoFirestore(),
                    lambda latitude, longitude: (latitude, longitude),
                    "server-timestamp",
                    http_get=fake_http_get,
                    dry_run=True,
                )

        self.assertEqual(summary, {"validated": 1, "written": 0, "skipped": 0})
        self.assertEqual(len(http_calls), 1)
        self.assertIn("Validated: Dry Run Cafe", output.getvalue())

    def test_importer_never_targets_private_search_indexes(self):
        source = Path(importer.__file__).read_text(encoding="utf-8")
        self.assertNotIn("restaurant_search_index", source)
        self.assertNotIn("dish_search_index", source)
        self.assertNotIn("bitesaver_offer_index", source)


if __name__ == "__main__":
    unittest.main()
