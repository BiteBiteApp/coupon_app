import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Restaurant trusted lifecycle metadata', () {
    test(
      'parses trusted metadata and preserves document ID apart from UID',
      () {
        final validatedAt = Timestamp.fromDate(DateTime.utc(2026, 7, 23));
        final restaurant = Restaurant.fromFirestore(
          <String, dynamic>{
            Restaurant.fieldUid: 'canonical-owner',
            Restaurant.fieldName: 'River Grill',
            Restaurant.fieldCity: 'Crystal River',
            Restaurant.fieldState: 'FL',
            Restaurant.fieldZipCode: '34428',
            Restaurant.fieldStreetAddress: '1 Main Street',
            Restaurant.fieldLatitude: 28.8517,
            Restaurant.fieldLongitude: -82.487,
            Restaurant.fieldProfileVersion: 4,
            Restaurant.fieldLocationVersion: 2,
            Restaurant.fieldFormattedAddress:
                '1 Main Street, Crystal River, FL 34428, USA',
            Restaurant.fieldAddressFingerprint: _fingerprint('a'),
            Restaurant.fieldLocationValidatedAt: validatedAt,
            Restaurant.fieldLocationSource: 'google_geocoding',
            'lastProfileRequestFingerprint': 'must-not-be-exposed',
          },
          documentId: 'actual-firestore-document',
          coupons: const [],
        );

        expect(restaurant.documentId, 'actual-firestore-document');
        expect(restaurant.uid, 'canonical-owner');
        expect(restaurant.profileVersion, 4);
        expect(restaurant.locationVersion, 2);
        expect(
          restaurant.formattedAddress,
          '1 Main Street, Crystal River, FL 34428, USA',
        );
        expect(restaurant.locationValidatedAt, validatedAt.toDate());
        expect(restaurant.locationSource, 'google_geocoding');
        expect(restaurant.hasTrustedSearchableLocation, isTrue);
      },
    );

    test('legacy and malformed versions normalize conservatively to zero', () {
      final legacy = Restaurant.fromFirestore(
        const <String, dynamic>{},
        coupons: const [],
      );
      final malformed = Restaurant.fromFirestore(<String, dynamic>{
        Restaurant.fieldProfileVersion: -1,
        Restaurant.fieldLocationVersion: '2',
      }, coupons: const []);

      expect(legacy.profileVersion, 0);
      expect(legacy.locationVersion, 0);
      expect(malformed.profileVersion, 0);
      expect(malformed.locationVersion, 0);
      expect(legacy.hasTrustedSearchableLocation, isFalse);
    });

    test(
      'saved address matching accepts client-normalized whitespace and state',
      () {
        final restaurant = Restaurant.fromFirestore(
          _trustedData(),
          coupons: const [],
        );

        expect(
          restaurant.matchesStructuredAddress(
            streetAddress: ' 1   Main Street ',
            city: ' Crystal   River ',
            state: ' fl ',
            zipCode: ' 34428 ',
          ),
          isTrue,
        );
        expect(
          restaurant.matchesStructuredAddress(
            streetAddress: '2 Main Street',
            city: 'Crystal River',
            state: 'FL',
            zipCode: '34428',
          ),
          isFalse,
        );
      },
    );

    for (final scenario in <({String name, Map<String, dynamic> changes})>[
      (name: 'missing latitude', changes: {Restaurant.fieldLatitude: null}),
      (name: 'missing longitude', changes: {Restaurant.fieldLongitude: null}),
      (
        name: 'nonfinite latitude',
        changes: {Restaurant.fieldLatitude: double.nan},
      ),
      (
        name: 'nonfinite longitude',
        changes: {Restaurant.fieldLongitude: double.infinity},
      ),
      (name: 'out-of-range latitude', changes: {Restaurant.fieldLatitude: 91}),
      (
        name: 'out-of-range longitude',
        changes: {Restaurant.fieldLongitude: -181},
      ),
      (
        name: 'exact origin',
        changes: {Restaurant.fieldLatitude: 0, Restaurant.fieldLongitude: 0},
      ),
      (
        name: 'missing fingerprint',
        changes: {Restaurant.fieldAddressFingerprint: null},
      ),
      (
        name: 'malformed fingerprint',
        changes: {Restaurant.fieldAddressFingerprint: 'not-a-fingerprint'},
      ),
      (
        name: 'untrusted source',
        changes: {Restaurant.fieldLocationSource: 'client'},
      ),
      (name: 'missing version', changes: {Restaurant.fieldLocationVersion: 0}),
      (
        name: 'missing timestamp',
        changes: {Restaurant.fieldLocationValidatedAt: null},
      ),
    ]) {
      test('${scenario.name} is not trusted-search ready', () {
        final restaurant = Restaurant.fromFirestore(
          <String, dynamic>{..._trustedData(), ...scenario.changes},
          documentId: 'restaurant-doc',
          coupons: const [],
        );

        expect(restaurant.hasTrustedSearchableLocation, isFalse);
      });
    }
  });
}

Map<String, dynamic> _trustedData() {
  return <String, dynamic>{
    Restaurant.fieldName: 'River Grill',
    Restaurant.fieldStreetAddress: '1 Main Street',
    Restaurant.fieldCity: 'Crystal River',
    Restaurant.fieldState: 'FL',
    Restaurant.fieldZipCode: '34428',
    Restaurant.fieldLatitude: 28.8517,
    Restaurant.fieldLongitude: -82.487,
    Restaurant.fieldAddressFingerprint: _fingerprint('b'),
    Restaurant.fieldLocationVersion: 1,
    Restaurant.fieldLocationValidatedAt: Timestamp.fromDate(
      DateTime.utc(2026, 7, 23),
    ),
    Restaurant.fieldLocationSource: 'google_geocoding',
  };
}

String _fingerprint(String character) =>
    List<String>.filled(64, character).join();
