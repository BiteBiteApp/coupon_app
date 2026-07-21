import contextlib
import importlib.util
import io
import math
import os
from pathlib import Path
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
        self.assertIs(document["updatedAt"], server_timestamp)
        for field in ("hours", "businessHours", "openingHours"):
            self.assertNotIn(field, document)


if __name__ == "__main__":
    unittest.main()
