import contextlib
import importlib.util
import io
import math
import os
from pathlib import Path
import sys
import tempfile
import types
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


class _Snapshot:
    def __init__(self, data=None):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return None if self._data is None else dict(self._data)


class _Document:
    def __init__(self, document_id, data=None):
        self.id = document_id
        self.data = data
        self.writes = []

    def get(self, transaction=None):
        return _Snapshot(self.data)

    def set(self, data, merge):
        self.writes.append((data, merge))
        self.data = {**(self.data or {}), **data} if merge else dict(data)


class _Collection:
    def __init__(self, existing=None):
        self.documents = {
            document_id: _Document(document_id, data)
            for document_id, data in (existing or {}).items()
        }

    def document(self, document_id):
        self.documents.setdefault(document_id, _Document(document_id))
        return self.documents[document_id]


class _Transaction:
    @staticmethod
    def set(document_reference, data, merge):
        document_reference.set(data, merge)


class _Database:
    def __init__(self, existing=None):
        self.collection_names = []
        self.transaction_runs = 0
        self.target = _Collection(existing)

    def collection(self, name):
        self.collection_names.append(name)
        return self.target

    def run_transaction(self, operation):
        self.transaction_runs += 1
        return operation(_Transaction())


class _PlaceResponse:
    @staticmethod
    def json():
        return {
            "result": {
                "name": "Imported Cafe",
                "formatted_address": "1 Main St, Crystal River, FL 34428, USA",
                "geometry": {"location": {"lat": 28.8517, "lng": -82.487}},
            }
        }


def _import_details():
    return {
        "name": "Imported Cafe",
        "address": "1 Main St, Crystal River, FL 34428, USA",
        "city": "Crystal River",
        "state": "FL",
        "zipCode": "34428",
        "website": "",
        "phone": "",
        "latitude": 28.8517,
        "longitude": -82.487,
    }


def _upload_single(database, place_id="place-stable-1"):
    with tempfile.TemporaryDirectory() as directory:
        csv_path = Path(directory) / "restaurants.csv"
        csv_path.write_text(f"Place ID\n{place_id}\n", encoding="utf-8")
        return importer.upload_restaurants(
            csv_path,
            "fake-api-key",
            database,
            lambda latitude, longitude: (latitude, longitude),
            "server-timestamp",
            http_get=lambda *args, **kwargs: _PlaceResponse(),
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
        self.assertEqual(document["restaurantWriteRevision"], 0)
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
                return {
                    "createdAt": "preserved-created-at",
                    "restaurantWriteRevision": 7,
                }

        class Document:
            def __init__(self, document_id):
                self.id = document_id
                self.writes = []

            @staticmethod
            def get(transaction=None):
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

            @staticmethod
            def run_transaction(operation):
                return operation(_Transaction())

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
        self.assertEqual(payload["restaurantWriteRevision"], 8)

    def test_unchanged_existing_document_is_not_written_or_incremented(self):
        existing = importer.build_restaurant_document(
            "place-stable-1",
            _import_details(),
            lambda latitude, longitude: (latitude, longitude),
            "old-server-timestamp",
            created_at="preserved-created-at",
            restaurant_write_revision=4,
        )
        database = _Database({"place-stable-1": existing})

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            summary = _upload_single(database)

        self.assertEqual(summary, {"validated": 1, "written": 0, "skipped": 0})
        document = database.target.documents["place-stable-1"]
        self.assertEqual(document.writes, [])
        self.assertEqual(document.data["restaurantWriteRevision"], 4)
        self.assertEqual(database.transaction_runs, 1)
        self.assertIn("Unchanged: Imported Cafe", output.getvalue())

    def test_transaction_retry_does_not_double_increment(self):
        class RetryDatabase(_Database):
            def run_transaction(self, operation):
                self.transaction_runs += 1

                class NoCommitTransaction:
                    @staticmethod
                    def set(document_reference, data, merge):
                        return None

                operation(NoCommitTransaction())
                return operation(_Transaction())

        existing = importer.build_restaurant_document(
            "place-stable-1",
            {**_import_details(), "phone": "old-phone"},
            lambda latitude, longitude: (latitude, longitude),
            "old-server-timestamp",
            created_at="preserved-created-at",
            restaurant_write_revision=7,
        )
        database = RetryDatabase({"place-stable-1": existing})

        with contextlib.redirect_stdout(io.StringIO()):
            summary = _upload_single(database)

        document = database.target.documents["place-stable-1"]
        self.assertEqual(summary, {"validated": 1, "written": 1, "skipped": 0})
        self.assertEqual(database.transaction_runs, 1)
        self.assertEqual(len(document.writes), 1)
        self.assertEqual(document.data["restaurantWriteRevision"], 8)

    def test_production_firebase_admin_transaction_adapter_is_used_locally(self):
        existing = importer.build_restaurant_document(
            "place-stable-1",
            {**_import_details(), "phone": "old-phone"},
            lambda latitude, longitude: (latitude, longitude),
            "old-server-timestamp",
            created_at="preserved-created-at",
            restaurant_write_revision=3,
        )
        document = _Document("place-stable-1", existing)
        transaction = _Transaction()

        class ProductionDatabase:
            def __init__(self):
                self.transaction_calls = 0

            def transaction(self):
                self.transaction_calls += 1
                return transaction

        database = ProductionDatabase()
        decorator_operations = []
        invoked_transactions = []
        firestore_module = types.ModuleType("firebase_admin.firestore")

        def transactional(operation):
            decorator_operations.append(operation)

            def invoke(transaction_argument):
                invoked_transactions.append(transaction_argument)
                return operation(transaction_argument)

            return invoke

        firestore_module.transactional = transactional
        firebase_admin_module = types.ModuleType("firebase_admin")
        firebase_admin_module.firestore = firestore_module

        with mock.patch.dict(
            sys.modules,
            {
                "firebase_admin": firebase_admin_module,
                "firebase_admin.firestore": firestore_module,
            },
        ):
            write_result, payload = (
                importer._write_imported_restaurant_transactionally(
                    database,
                    document,
                    "place-stable-1",
                    _import_details(),
                    lambda latitude, longitude: (latitude, longitude),
                    "server-timestamp",
                )
            )

        self.assertEqual(write_result, "written")
        self.assertEqual(payload["restaurantWriteRevision"], 4)
        self.assertEqual(database.transaction_calls, 1)
        self.assertEqual(len(decorator_operations), 1)
        self.assertEqual(invoked_transactions, [transaction])
        self.assertEqual(len(document.writes), 1)
        self.assertEqual(document.data["restaurantWriteRevision"], 4)

    def test_existing_revision_must_be_present_and_valid(self):
        malformed_revisions = (
            mock.sentinel.missing,
            None,
            True,
            -1,
            1.5,
            "1",
            importer.MAXIMUM_SAFE_RESTAURANT_WRITE_REVISION + 1,
        )
        for revision in malformed_revisions:
            with self.subTest(revision=revision):
                existing = {"createdAt": "preserved-created-at"}
                if revision is not mock.sentinel.missing:
                    existing["restaurantWriteRevision"] = revision
                database = _Database({"place-stable-1": existing})

                with contextlib.redirect_stdout(io.StringIO()):
                    summary = _upload_single(database)

                self.assertEqual(
                    summary,
                    {"validated": 0, "written": 0, "skipped": 1},
                )
                self.assertEqual(
                    database.target.documents["place-stable-1"].writes,
                    [],
                )

    def test_revision_failures_do_not_log_restaurant_identity_or_value(self):
        private_place_id = "private-place-id-canary"
        private_revision = "private-revision-canary"
        database = _Database(
            {
                private_place_id: {
                    "createdAt": "preserved-created-at",
                    "restaurantWriteRevision": private_revision,
                }
            }
        )

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            summary = _upload_single(database, place_id=private_place_id)

        self.assertEqual(summary, {"validated": 0, "written": 0, "skipped": 1})
        self.assertNotIn(private_place_id, output.getvalue())
        self.assertNotIn(private_revision, output.getvalue())

    def test_changed_document_at_maximum_revision_fails_without_writing(self):
        database = _Database(
            {
                "place-stable-1": {
                    "createdAt": "preserved-created-at",
                    "restaurantWriteRevision": (
                        importer.MAXIMUM_SAFE_RESTAURANT_WRITE_REVISION
                    ),
                }
            }
        )

        with contextlib.redirect_stdout(io.StringIO()):
            summary = _upload_single(database)

        self.assertEqual(summary, {"validated": 0, "written": 0, "skipped": 1})
        self.assertEqual(database.target.documents["place-stable-1"].writes, [])

    def test_place_id_header_precedence_and_new_revision_zero_are_preserved(self):
        database = _Database()
        http_place_ids = []

        def fake_http_get(*args, **kwargs):
            http_place_ids.append(kwargs["params"]["place_id"])
            return _PlaceResponse()

        with tempfile.TemporaryDirectory() as directory:
            csv_path = Path(directory) / "restaurants.csv"
            csv_path.write_text(
                "Place ID,place_id\nplace-preferred,place-fallback\n",
                encoding="utf-8",
            )
            summary = importer.upload_restaurants(
                csv_path,
                "fake-api-key",
                database,
                lambda latitude, longitude: (latitude, longitude),
                "server-timestamp",
                http_get=fake_http_get,
            )

        self.assertEqual(summary, {"validated": 1, "written": 1, "skipped": 0})
        self.assertEqual(http_place_ids, ["place-preferred"])
        self.assertNotIn("place-fallback", database.target.documents)
        payload, merge = database.target.documents["place-preferred"].writes[0]
        self.assertTrue(merge)
        self.assertEqual(payload["id"], "place-preferred")
        self.assertEqual(payload["placeId"], "place-preferred")
        self.assertEqual(payload["restaurantWriteRevision"], 0)

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
            with mock.patch.object(
                importer,
                "build_restaurant_document",
                wraps=importer.build_restaurant_document,
            ) as build_document:
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
        self.assertEqual(
            build_document.call_args.kwargs["restaurant_write_revision"],
            0,
        )
        self.assertIn("Validated: Dry Run Cafe", output.getvalue())

    def test_importer_never_targets_private_search_indexes(self):
        source = Path(importer.__file__).read_text(encoding="utf-8")
        self.assertNotIn("restaurant_search_index", source)
        self.assertNotIn("dish_search_index", source)
        self.assertNotIn("bitesaver_offer_index", source)


if __name__ == "__main__":
    unittest.main()
