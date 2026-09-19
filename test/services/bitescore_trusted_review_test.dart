import 'dart:convert';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> reviewData([Map<String, dynamic> overrides = const {}]) =>
    {
      'id': 'review-1',
      'dishId': 'dish-1',
      'restaurantId': 'restaurant-1',
      'userId': 'user-1',
      'overallImpression': 8.0,
      'tastinessScore': 7.0,
      'qualityScore': 9.0,
      'valueScore': 6.0,
      'overallBiteScore': 78.0,
      'headline': 'Good',
      'notes': 'Fresh and tasty',
      'createdAtMillis': 1700000000000,
      'updatedAtMillis': 1700000001000,
      ...overrides,
    };

void main() {
  tearDown(() => CustomerBiteScoreRuntime.testEnabled = null);

  test(
    'bounded creation matching finds the exact name beyond the old ZIP preview',
    () {
      final rows = <Map<String, dynamic>>[
        for (var i = 0; i < 35; i++)
          {'zipCode': '12345', 'normalizedName': 'other$i'},
        {'zipCode': '12345', 'normalizedName': 'requested'},
      ];
      CustomerBiteScoreRuntime.testEnabled = true;
      final query =
          BiteScoreService.restaurantCreationLookup(
                _FixtureQuery(rows),
                zipCode: '12345',
                normalizedName: 'requested',
              )
              as _FixtureQuery;
      expect(query.rows, [
        {'zipCode': '12345', 'normalizedName': 'requested'},
      ]);
      expect(query.maximum, 1);
      CustomerBiteScoreRuntime.testEnabled = false;
      final legacy =
          BiteScoreService.restaurantCreationLookup(
                _FixtureQuery(rows),
                zipCode: '12345',
                normalizedName: 'requested',
              )
              as _FixtureQuery;
      expect(legacy.rows, hasLength(20));
    },
  );

  test(
    'bounded dish creation existence and name lookup ignore inactive and merged modern data',
    () {
      CustomerBiteScoreRuntime.testEnabled = true;
      final rows = <Map<String, dynamic>>[
        {
          'restaurantId': 'r',
          'normalizedName': 'pizza',
          'isActive': false,
          'mergedIntoDishId': null,
        },
        {
          'restaurantId': 'r',
          'normalizedName': 'pizza',
          'isActive': true,
          'mergedIntoDishId': 'other',
        },
        {
          'restaurantId': 'r',
          'normalizedName': 'pizza',
          'isActive': true,
          'mergedIntoDishId': null,
        },
        {
          'restaurantId': 'r',
          'normalizedName': 'pizza',
          'isActive': true,
          'mergedIntoDishId': null,
        },
      ];
      final query =
          BiteScoreService.dishCreationLookup(
                _FixtureQuery(rows),
                restaurantId: 'r',
                normalizedName: 'pizza',
              )
              as _FixtureQuery;
      expect(query.rows, hasLength(1));
      expect(query.rows.single['mergedIntoDishId'], isNull);
      expect(query.rows.single['isActive'], true);
      expect(query.maximum, 1);
    },
  );

  test(
    'force-create distinct dish bypasses existing-name lookup only after opt-in',
    () async {
      var calls = 0;
      Future<List<String>> load() async {
        calls++;
        return ['existing-dish'];
      }

      CustomerBiteScoreRuntime.testEnabled = true;
      expect(
        await BiteScoreService.loadDishCreationCandidates(
          allowExistingMatch: false,
          load: load,
        ),
        isEmpty,
      );
      expect(calls, 0);
      expect(
        await BiteScoreService.loadDishCreationCandidates(
          allowExistingMatch: true,
          load: load,
        ),
        ['existing-dish'],
      );
      CustomerBiteScoreRuntime.testEnabled = false;
      expect(
        await BiteScoreService.loadDishCreationCandidates(
          allowExistingMatch: false,
          load: load,
        ),
        ['existing-dish'],
      );
      expect(calls, 2);
    },
  );

  test(
    'new trusted review identity matches dish and restaurant creation provenance',
    () {
      CustomerBiteScoreRuntime.testEnabled = true;
      final fixtures =
          jsonDecode(
                File(
                  'test/fixtures/bitescore_trusted_review_identity_v1.json',
                ).readAsStringSync(),
              )
              as List;
      for (final fixture in fixtures) {
        final dish = BiteScoreService.dishCreationProvenanceFieldsForTesting(
          createdByUserId: fixture['userId'] as String,
          dishId: fixture['dishId'] as String,
          restaurantId: 'restaurant-1',
        );
        expect(dish['createdFromReviewId'], fixture['reviewId']);
        final restaurant =
            BiteScoreService.restaurantCreationProvenanceFieldsForTesting(
              createdByUserId: fixture['userId'] as String,
              createdFromDishId: fixture['dishId'] as String,
              createdFromReviewId: dish['createdFromReviewId'] as String,
            );
        expect(restaurant['createdFromReviewId'], fixture['reviewId']);
      }
      CustomerBiteScoreRuntime.testEnabled = false;
      expect(
        BiteScoreService.dishCreationProvenanceFieldsForTesting(
          createdByUserId: 'user-1',
          dishId: 'dish-1',
          restaurantId: 'restaurant-1',
        )['createdFromReviewId'],
        'dish-1_user-1',
      );
    },
  );
  test(
    'dish detail applies the established public review visibility contract',
    () {
      for (final flags in [
        {'isPublic': false},
        {'isHidden': true},
        {'hidden': true},
        {'deleted': true},
        {'rejected': true},
        {'status': 'deleted'},
        {'status': 'hidden'},
        {'status': 'rejected'},
      ]) {
        expect(
          BiteScoreService.publicDishReviewFromFirestore(
            reviewData(flags),
            documentId: 'review-1',
          ),
          isNull,
          reason: flags.toString(),
        );
      }
      for (final flags in [
        <String, dynamic>{},
        {'isPublic': true},
        {'status': 'published'},
        {'hidden': false},
      ]) {
        expect(
          BiteScoreService.publicDishReviewFromFirestore(
            reviewData(flags),
            documentId: 'review-1',
          )?.id,
          'review-1',
        );
      }
    },
  );

  Future<void> saveWith(
    Future<Object?> Function(String, Map<String, Object?>) transport,
  ) async {
    final saved = await BiteScoreService.saveReviewWithTrustedAggregate(
      dishId: 'dish-1',
      restaurantId: 'restaurant-1',
      userId: 'user-1',
      headline: 'Good',
      notes: 'Fresh and tasty',
      overallImpression: 8,
      tastinessScore: 7,
      qualityScore: 9,
      valueScore: 6,
      transport: transport,
    );
    expect(saved.id, 'review-1');
    expect(saved.overallBiteScore, 78);
    expect(saved.createdAt?.millisecondsSinceEpoch, 1700000000000);
  }

  test(
    'trusted save sends only review inputs and consumes authoritative result',
    () async {
      await saveWith((name, request) async {
        expect(name, 'saveCustomerBiteScoreReview');
        expect(request['dishId'], 'dish-1');
        expect(request['restaurantId'], 'restaurant-1');
        expect(request['expectedUserId'], 'user-1');
        expect(request, isNot(contains('userId')));
        expect(request, isNot(contains('overallBiteScore')));
        expect(request, isNot(contains('ratingCount')));
        return {'schemaVersion': 1, 'review': reviewData()};
      });
    },
  );

  test(
    'trusted response rejects cross-dish, cross-user and normalized identities',
    () async {
      for (final overrides in [
        {'dishId': 'dish-2'},
        {'restaurantId': 'restaurant-2'},
        {'userId': 'user-2'},
        {'id': ' review-1 '},
      ]) {
        await expectLater(
          saveWith(
            (_, _) async => {
              'schemaVersion': 1,
              'review': reviewData(overrides),
            },
          ),
          throwsStateError,
        );
      }
    },
  );

  test('trusted save failure propagates without a raw-read fallback', () async {
    var calls = 0;
    await expectLater(
      saveWith((_, _) async {
        calls++;
        throw StateError('Unavailable');
      }),
      throwsStateError,
    );
    expect(calls, 1);
  });
}

class _FixtureQuery implements Query<Map<String, dynamic>> {
  final List<Map<String, dynamic>> rows;
  final int? maximum;
  _FixtureQuery(this.rows, [this.maximum]);

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #where) {
      final field = invocation.positionalArguments.single as String;
      final isNull = invocation.namedArguments[#isNull] == true;
      final expected = isNull ? null : invocation.namedArguments[#isEqualTo];
      return _FixtureQuery(
        rows
            .where((row) => row.containsKey(field) && row[field] == expected)
            .toList(),
        maximum,
      );
    }
    if (invocation.memberName == #limit) {
      final limit = invocation.positionalArguments.single as int;
      return _FixtureQuery(rows.take(limit).toList(), limit);
    }
    return super.noSuchMethod(invocation);
  }
}
