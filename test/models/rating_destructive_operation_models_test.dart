import 'package:coupon_app/models/rating_destructive_operation_models.dart';
import 'package:flutter_test/flutter_test.dart';

const String operationId =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

Map<String, Object?> summaryJson({
  String operation = 'restaurantMerge',
  String status = 'active',
  String progressCategory = 'moving_data',
  bool accepted = true,
  bool processing = true,
  bool complete = false,
  bool retryable = false,
  bool manualReviewRequired = false,
}) {
  return <String, Object?>{
    'contractVersion': ratingDestructiveSummaryContractVersion,
    'accepted': accepted,
    'operationId': operationId,
    'operation': operation,
    'status': status,
    'progressCategory': progressCategory,
    'processing': processing,
    'complete': complete,
    'retryable': retryable,
    'manualReviewRequired': manualReviewRequired,
    'messageCategory': 'accepted_processing',
    'processedCount': 12,
    'phaseProcessedCount': 3,
    'createdAtMs': 1786406400000,
    'updatedAtMs': 1786406401000,
  };
}

Map<String, Object?> adminRecordJson({
  String operation = 'restaurantMerge',
  String status = 'active',
  String progressCategory = 'moving_data',
  String phaseCategory = 'moving_data',
  bool complete = false,
  bool retryable = false,
  bool manualReviewRequired = false,
}) {
  return <String, Object?>{
    'operationId': operationId,
    'operation': operation,
    'status': status,
    'progressCategory': progressCategory,
    'phaseCategory': phaseCategory,
    'processedCount': 12,
    'phaseProcessedCount': 3,
    'createdAtMs': 1786406400000,
    'updatedAtMs': 1786406401000,
    'sourceRestaurantId':
        operation == 'restaurantMerge' || operation == 'restaurantDelete'
        ? 'restaurant-source'
        : null,
    'sourceRestaurantName':
        operation == 'restaurantMerge' || operation == 'restaurantDelete'
        ? 'Source Restaurant'
        : null,
    'targetRestaurantId': operation == 'restaurantMerge'
        ? 'restaurant-target'
        : null,
    'targetRestaurantName': operation == 'restaurantMerge'
        ? 'Target Restaurant'
        : null,
    'sourceDishId': operation == 'dishMerge' || operation == 'dishDelete'
        ? 'dish-source'
        : null,
    'sourceDishName': operation == 'dishMerge' || operation == 'dishDelete'
        ? 'Source Dish'
        : null,
    'targetDishId': operation == 'dishMerge' ? 'dish-target' : null,
    'targetDishName': operation == 'dishMerge' ? 'Target Dish' : null,
    'complete': complete,
    'retryable': retryable,
    'manualReviewRequired': manualReviewRequired,
    'messageCategory': 'current_status',
  };
}

void main() {
  group('Rating destructive summary protocol', () {
    test('parses the exact active contract and exposes safe feedback', () {
      final summary = RatingDestructiveOperationSummary.fromJson(summaryJson());

      expect(summary.operationId, operationId);
      expect(summary.operation, RatingDestructiveOperation.restaurantMerge);
      expect(summary.status, RatingDestructiveStatus.active);
      expect(
        summary.progressCategory,
        RatingDestructiveProgressCategory.movingData,
      );
      expect(summary.processedCount, 12);
      expect(summary.phaseProcessedCount, 3);
      expect(summary.feedbackMessage, contains('started'));
    });

    test('rejects every missing and extra top-level field', () {
      final valid = summaryJson();
      for (final key in valid.keys.toList()) {
        final missing = Map<String, Object?>.from(valid)..remove(key);
        expect(
          () => RatingDestructiveOperationSummary.fromJson(missing),
          throwsA(isA<RatingDestructiveProtocolException>()),
          reason: 'missing $key',
        );
      }

      expect(
        () => RatingDestructiveOperationSummary.fromJson(
          Map<String, Object?>.from(valid)..['privatePhase'] = 'hidden',
        ),
        throwsA(isA<RatingDestructiveProtocolException>()),
      );
    });

    test('rejects contradictory flags, progress, and timestamps', () {
      final contradictions = <Map<String, Object?>>[
        summaryJson()..['complete'] = true,
        summaryJson()..['retryable'] = true,
        summaryJson()..['manualReviewRequired'] = true,
        summaryJson()..['processing'] = false,
        summaryJson(
          status: 'complete',
          progressCategory: 'moving_data',
          processing: false,
          complete: true,
        ),
        summaryJson(
          status: 'retryable',
          progressCategory: 'moving_data',
          retryable: true,
        ),
        summaryJson(
          status: 'manual_review_required',
          progressCategory: 'moving_data',
          processing: false,
          manualReviewRequired: true,
        ),
        summaryJson()..['updatedAtMs'] = 1786406399999,
      ];

      for (final value in contradictions) {
        expect(
          () => RatingDestructiveOperationSummary.fromJson(value),
          throwsA(isA<RatingDestructiveProtocolException>()),
        );
      }
    });

    test('rejects unknown enum values and unsafe identities/counts', () {
      for (final mutation in <void Function(Map<String, Object?>)>[
        (value) => value['operation'] = 'unknown',
        (value) => value['status'] = 'queued',
        (value) => value['progressCategory'] = 'private_phase',
        (value) => value['messageCategory'] = 'raw_failure',
        (value) => value['operationId'] = '../operation',
        (value) => value['operationId'] = 'A' * 64,
        (value) => value['operationId'] = 'a' * 63,
        (value) => value['operationId'] = 'g' * 64,
        (value) => value['processedCount'] = -1,
        (value) => value['createdAtMs'] = 1.5,
      ]) {
        final value = summaryJson();
        mutation(value);
        expect(
          () => RatingDestructiveOperationSummary.fromJson(value),
          throwsA(isA<RatingDestructiveProtocolException>()),
        );
      }
    });
  });

  group('Rating Admin operation record protocol', () {
    test('parses all four exact public identity projections', () {
      final expectedLabels = <String, List<String>>{
        'restaurantMerge': <String>[
          'Source: Source Restaurant (restaurant-source)',
          'Target: Target Restaurant (restaurant-target)',
        ],
        'restaurantDelete': <String>[
          'Restaurant: Source Restaurant (restaurant-source)',
        ],
        'dishMerge': <String>[
          'Source: Source Dish (dish-source)',
          'Target: Target Dish (dish-target)',
        ],
        'dishDelete': <String>['Dish: Source Dish (dish-source)'],
      };
      for (final entry in expectedLabels.entries) {
        final record = RatingAdminDestructiveOperationRecord.fromJson(
          adminRecordJson(operation: entry.key),
        );
        expect(record.operation.wireName, entry.key);
        expect(record.identityLabels, entry.value);
      }
    });

    test(
      'rejects missing, extra, contradictory, and leaked identity fields',
      () {
        final valid = adminRecordJson();
        final missing = Map<String, Object?>.from(valid)
          ..remove('phaseCategory');
        final extra = Map<String, Object?>.from(valid)
          ..['failureReason'] = 'private';
        final contradictory = Map<String, Object?>.from(valid)
          ..['status'] = 'complete';
        final identityLeak = Map<String, Object?>.from(valid)
          ..['sourceDishId'] = 'dish-private';
        final oldExtraFieldShape = adminRecordJson(operation: 'dishMerge')
          ..['restaurantId'] = 'restaurant-private'
          ..['restaurantName'] = 'Private Restaurant';
        final unpairedPrivateName = adminRecordJson(operation: 'dishDelete')
          ..['targetRestaurantName'] = 'PRIVATE ROLE NAME CANARY';

        for (final value in <Map<String, Object?>>[
          missing,
          extra,
          contradictory,
          identityLeak,
          oldExtraFieldShape,
          unpairedPrivateName,
        ]) {
          expect(
            () => RatingAdminDestructiveOperationRecord.fromJson(value),
            throwsA(isA<RatingDestructiveProtocolException>()),
          );
        }
      },
    );

    test('requires operation-specific distinct identities', () {
      final sameRestaurants = adminRecordJson()
        ..['targetRestaurantId'] = 'restaurant-source';
      final sameDishes = adminRecordJson(operation: 'dishMerge')
        ..['targetDishId'] = 'dish-source';

      for (final value in <Map<String, Object?>>[sameRestaurants, sameDishes]) {
        expect(
          () => RatingAdminDestructiveOperationRecord.fromJson(value),
          throwsA(isA<RatingDestructiveProtocolException>()),
        );
      }
    });

    test('does not retain the mutable raw response map', () {
      final raw = adminRecordJson(operation: 'dishMerge');
      final record = RatingAdminDestructiveOperationRecord.fromJson(raw);

      raw
        ..['sourceDishId'] = 'mutated-private-id'
        ..['sourceDishName'] = 'Mutated Private Name';

      expect(record.sourceDishId, 'dish-source');
      expect(record.sourceDishName, 'Source Dish');
      expect(record.identityLabels.join(' '), isNot(contains('mutated')));
    });
  });
}
