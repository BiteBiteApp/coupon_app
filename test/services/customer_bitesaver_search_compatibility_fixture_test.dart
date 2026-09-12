import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/services/bitesaver_location_search.dart';
import 'package:flutter_test/flutter_test.dart';

const String _fixturePath =
    'test/fixtures/customer_bitesaver_search_compatibility_v1.json';

Map<String, dynamic> _record(Object? value) {
  return Map<String, dynamic>.from(value! as Map);
}

List<Map<String, dynamic>> _records(Object? value) {
  return (value! as List<dynamic>).map(_record).toList(growable: false);
}

double _number(Object? value) => (value! as num).toDouble();

Restaurant _restaurantForLocationCase(Map<String, dynamic> fixture) {
  return Restaurant(
    documentId: fixture['id']! as String,
    name: 'Fixture Restaurant',
    distance: Restaurant.defaultDistanceLabel,
    city: fixture['restaurantCity']! as String,
    state: fixture['restaurantState']! as String,
    zipCode: fixture['restaurantZipCode']! as String,
    latitude: 42,
    longitude: -72,
    coupons: const [],
  );
}

Restaurant _restaurantForDistanceCase(Map<String, dynamic> fixture) {
  return Restaurant(
    documentId: fixture['id']! as String,
    name: 'Fixture Restaurant',
    distance: Restaurant.defaultDistanceLabel,
    city: 'Fixture City',
    state: 'FL',
    zipCode: '34461',
    latitude: _number(fixture['candidateLatitude']),
    longitude: _number(fixture['candidateLongitude']),
    coupons: const [],
  );
}

void main() {
  late Map<String, dynamic> fixtures;

  setUpAll(() {
    fixtures =
        jsonDecode(File(_fixturePath).readAsStringSync())
            as Map<String, dynamic>;
  });

  test('fixture and Dart helper versions are identical', () {
    expect(
      fixtures['contractVersion'],
      BiteSaverLocationSearch.compatibilityContractVersion,
    );
    expect(
      fixtures['normalizerVersion'],
      BiteSaverLocationSearch.searchNormalizerVersion,
    );
    expect(
      fixtures['matcherVersion'],
      BiteSaverLocationSearch.searchMatcherVersion,
    );
  });

  test('all 50 states and DC canonicalize from names and abbreviations', () {
    final states = _records(fixtures['supportedStates']);
    expect(states, hasLength(51));

    final fixtureCodes = states
        .map((state) => state['code']! as String)
        .toSet();
    expect(fixtureCodes, BiteSaverLocationSearch.supportedUsStateCodes);

    for (final state in states) {
      final name = state['name']! as String;
      final code = state['code']! as String;
      final spacedName = name.toUpperCase().replaceAll(' ', '   ');
      for (final input in <String>[
        name,
        name.toLowerCase(),
        '  $spacedName  ',
        code,
        ' ${code.toLowerCase()} ',
      ]) {
        expect(
          BiteSaverLocationSearch.canonicalUsStateCode(input),
          code,
          reason: '$name from "$input"',
        );
      }
    }
  });

  test('unknown state text and territories remain unsupported', () {
    for (final state in fixtures['unknownStates']! as List<dynamic>) {
      expect(
        BiteSaverLocationSearch.canonicalUsStateCode(state! as String),
        isNull,
        reason: state,
      );
    }
  });

  test('fixture exact-location preferences remain geographic preferences', () {
    for (final fixture in _records(fixtures['locationPreferenceCases'])) {
      final result = BiteSaverLocationSearch.eligibleRestaurant(
        restaurant: _restaurantForLocationCase(fixture),
        centerLatitude: 42,
        centerLongitude: -72,
        radiusMiles: 30,
        typedQuery: fixture['typedQuery']! as String,
        distanceCalculator: (_, _, _, _) => 1,
      );

      expect(result, isNotNull, reason: fixture['id']);
      expect(
        result?.exactLocationPreference,
        fixture['expectedPreference'],
        reason: fixture['id'],
      );
    }
  });

  test('current BiteSaver ASCII matcher normalization is frozen', () {
    for (final fixture in _records(fixtures['normalizationCases'])) {
      expect(
        BiteSaverLocationSearch.normalizeCompatibilitySearchText(
          fixture['input']! as String,
        ),
        fixture['expected'],
        reason: fixture['id'],
      );
    }
  });

  test('current contiguous-substring matching corpus behavior is frozen', () {
    for (final fixture in _records(fixtures['matchingCases'])) {
      expect(
        BiteSaverLocationSearch.matchesCompatibilitySearch(
          query: fixture['query']! as String,
          searchableFields: (fixture['searchableFields']! as List<dynamic>)
              .cast<String>(),
        ),
        fixture['expectedMatch'],
        reason: fixture['id'],
      );
    }
  });

  test('shared request text limits and UTF-16 validation match Functions', () {
    expect(BiteSaverLocationSearch.maximumSearchScalars, 200);
    expect(BiteSaverLocationSearch.maximumSearchUtf8Bytes, 800);

    for (final fixture in _records(fixtures['requestLengthCases'])) {
      final value = List<String>.filled(
        fixture['length']! as int,
        fixture['character']! as String,
      ).join();
      expect(
        BiteSaverLocationSearch.isValidCompatibilitySearchText(value),
        fixture['expectedValid'],
        reason: fixture['id'],
      );
    }

    expect(
      BiteSaverLocationSearch.isValidCompatibilitySearchText(
        List<String>.filled(200, '😀').join(),
      ),
      isTrue,
    );
    expect(
      BiteSaverLocationSearch.isValidCompatibilitySearchText(
        List<String>.filled(201, '😀').join(),
      ),
      isFalse,
    );

    for (final fixture in _records(fixtures['requestValidationCases'])) {
      final input = fixture['input']! as String;
      final expected = fixture['expectedValid']! as bool;
      expect(
        BiteSaverLocationSearch.hasWellFormedCompatibilityUtf16(input),
        expected,
        reason: fixture['id'],
      );
      expect(
        BiteSaverLocationSearch.isValidCompatibilitySearchText(input),
        expected,
        reason: fixture['id'],
      );
    }
  });

  test('legacy timestamp strings freeze Dart DateTime.tryParse grammar', () {
    for (final fixture in _records(fixtures['legacyDateTimeStringCases'])) {
      final input = (fixture['input']! as String).trim();
      expect(
        DateTime.tryParse(input) != null,
        fixture['expectedValid'],
        reason: fixture['id'],
      );
    }
  });

  test('shared exact restaurant ordering matches Dart UTF-16 ordering', () {
    for (final fixture in _records(fixtures['orderingCases'])) {
      final candidates = _records(fixture['candidates']);
      candidates.sort((left, right) {
        final leftExact = left['exactLocationPreference']! as bool;
        final rightExact = right['exactLocationPreference']! as bool;
        if (leftExact != rightExact) {
          return leftExact ? -1 : 1;
        }
        final distanceComparison =
            (leftExact ? 0.0 : _number(left['distanceMiles'])).compareTo(
              rightExact ? 0.0 : _number(right['distanceMiles']),
            );
        if (distanceComparison != 0) {
          return distanceComparison;
        }
        final nameComparison = (left['name']! as String)
            .toLowerCase()
            .compareTo((right['name']! as String).toLowerCase());
        if (nameComparison != 0) {
          return nameComparison;
        }
        return (left['id']! as String).compareTo(right['id']! as String);
      });
      expect(
        candidates.map((candidate) => candidate['id']).toList(),
        (fixture['expectedOrder']! as List<dynamic>).cast<String>(),
        reason: fixture['id'],
      );
    }
  });

  test('Haversine constants and supported radii match the shared contract', () {
    final contract = _record(fixtures['distanceContract']);
    expect(
      BiteSaverLocationSearch.compatibilityEarthRadiusMeters,
      _number(contract['earthRadiusMeters']),
    );
    expect(
      BiteSaverLocationSearch.metersPerMile,
      _number(contract['metersPerMile']),
    );
    expect(
      (fixtures['supportedRadiiMiles']! as List<dynamic>).cast<num>().toSet(),
      <num>{1, 3, 5, 10, 15, 20, 30},
    );
  });

  test('every shared radius comparison is exactly inclusive', () {
    final contract = _record(fixtures['distanceContract']);
    for (final fixture in _records(contract['eligibilityCases'])) {
      final result = BiteSaverLocationSearch.eligibleRestaurant(
        restaurant: Restaurant(
          documentId: fixture['id']! as String,
          name: 'Fixture Restaurant',
          distance: Restaurant.defaultDistanceLabel,
          city: 'Fixture City',
          state: 'FL',
          zipCode: '34461',
          latitude: 28.5,
          longitude: -81.3,
          coupons: const [],
        ),
        centerLatitude: 28.5,
        centerLongitude: -81.3,
        radiusMiles: _number(fixture['radiusMiles']),
        typedQuery: '',
        distanceCalculator: (_, _, _, _) => _number(fixture['distanceMiles']),
      );
      expect(
        result != null,
        fixture['expectedEligible'],
        reason: fixture['id'],
      );
    }
  });

  test('exact distances and inclusive eligibility match shared goldens', () {
    final contract = _record(fixtures['distanceContract']);
    final toleranceMiles = _number(contract['toleranceMiles']);

    for (final fixture in _records(contract['cases'])) {
      final centerLatitude = _number(fixture['centerLatitude']);
      final centerLongitude = _number(fixture['centerLongitude']);
      final candidateLatitude = _number(fixture['candidateLatitude']);
      final candidateLongitude = _number(fixture['candidateLongitude']);
      final expectedDistance = _number(fixture['expectedDistanceMiles']);
      final expectedEligible = fixture['expectedEligible']! as bool;

      final distance = BiteSaverLocationSearch.exactDistanceMiles(
        centerLatitude: centerLatitude,
        centerLongitude: centerLongitude,
        candidateLatitude: candidateLatitude,
        candidateLongitude: candidateLongitude,
      );
      expect(distance, isNotNull, reason: fixture['id']);
      expect(
        distance!,
        closeTo(expectedDistance, toleranceMiles),
        reason: fixture['id'],
      );

      final result = BiteSaverLocationSearch.eligibleRestaurant(
        restaurant: _restaurantForDistanceCase(fixture),
        centerLatitude: centerLatitude,
        centerLongitude: centerLongitude,
        radiusMiles: _number(fixture['radiusMiles']),
        typedQuery: '',
      );
      expect(result != null, expectedEligible, reason: fixture['id']);
      if (result != null) {
        expect(
          result.distanceMiles,
          closeTo(expectedDistance, toleranceMiles),
          reason: fixture['id'],
        );
      }
    }
  });

  test('coordinate validity fixtures fail closed', () {
    for (final fixture in _records(fixtures['coordinateValidityCases'])) {
      final latitude = fixture['latitude'];
      final longitude = fixture['longitude'];
      final actual = latitude is num && longitude is num
          ? BiteSaverLocationSearch.hasValidCoordinates(
              latitude.toDouble(),
              longitude.toDouble(),
            )
          : false;
      expect(actual, fixture['expectedValid'], reason: fixture['id']);
    }
  });
}
