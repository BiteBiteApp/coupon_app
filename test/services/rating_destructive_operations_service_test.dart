import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/models/rating_destructive_operation_models.dart';
import 'package:coupon_app/services/rating_destructive_operations_service.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_test/flutter_test.dart';

const String _operationId =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const String _differentOperationId =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

Map<String, Object?> summaryJson(
  String operation, {
  String id = _operationId,
}) => <String, Object?>{
  'contractVersion': ratingDestructiveSummaryContractVersion,
  'accepted': true,
  'operationId': id,
  'operation': operation,
  'status': 'active',
  'progressCategory': 'starting',
  'processing': true,
  'complete': false,
  'retryable': false,
  'manualReviewRequired': false,
  'messageCategory': 'accepted_processing',
  'processedCount': 0,
  'phaseProcessedCount': 0,
  'createdAtMs': 1786406400000,
  'updatedAtMs': 1786406400000,
};

Map<String, Object?> adminRecordJson({
  String operation = 'dishDelete',
  String id = _operationId,
}) => <String, Object?>{
  'operationId': id,
  'operation': operation,
  'status': 'active',
  'progressCategory': 'starting',
  'phaseCategory': 'starting',
  'processedCount': 0,
  'phaseProcessedCount': 0,
  'createdAtMs': 1786406400000,
  'updatedAtMs': 1786406400000,
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
  'complete': false,
  'retryable': false,
  'manualReviewRequired': false,
  'messageCategory': 'current_status',
};

Map<String, Object?> pageJson({List<Object?>? items}) => <String, Object?>{
  'protocolVersion': pageProtocolVersion,
  'items': items ?? <Object?>[adminRecordJson()],
  'pageSize': ratingDestructiveAdminPageSize,
  'hasNext': false,
  'hasPrevious': false,
  'currentPageNumber': 1,
  'total': <String, Object?>{'state': 'exact', 'value': items?.length ?? 1},
  'queryFingerprint': 'a' * 64,
  'snapshotTimestampMs': 1786406400000,
  'capabilities': <String, Object?>{
    'first': false,
    'previous': false,
    'numberedVisitedPages': true,
    'next': false,
    'last': false,
  },
};

void main() {
  test(
    'uses the six exact callable names and exact public request maps',
    () async {
      final calls = <(String, Map<String, Object?>)>[];
      final service = RatingDestructiveOperationsService(
        requestIdGenerator: () => 'request-fixed',
        functionsBoundary: (name, request) async {
          calls.add((name, Map<String, Object?>.from(request)));
          final operation = switch (name) {
            'startRatingRestaurantMerge' => 'restaurantMerge',
            'startRatingRestaurantDelete' => 'restaurantDelete',
            'startRatingDishMerge' => 'dishMerge',
            'startRatingDishDelete' => 'dishDelete',
            'getRatingDestructiveOperationStatus' => 'dishDelete',
            _ => throw StateError('Unexpected callable $name'),
          };
          final result = summaryJson(operation);
          if (name == 'getRatingDestructiveOperationStatus') {
            result['accepted'] = false;
            result['messageCategory'] = 'current_status';
          }
          return result;
        },
      );

      await service.startRestaurantMerge(
        sourceRestaurantId: 'restaurant-source',
        targetRestaurantId: 'restaurant-target',
        expectedSourceRestaurantRevision: 4,
        expectedTargetRestaurantRevision: 9,
      );
      await service.startRestaurantDelete(
        restaurantId: 'restaurant-delete',
        expectedRestaurantRevision: 11,
      );
      await service.startDishMerge(
        sourceDishId: 'dish-source',
        targetDishId: 'dish-target',
      );
      await service.startDishDelete(dishId: 'dish-delete');
      await service.getOperationStatus(_operationId);

      final expected = <(String, Map<String, Object?>)>[
        (
          'startRatingRestaurantMerge',
          <String, Object?>{
            'contractVersion': ratingDestructiveCallableContractVersion,
            'sourceRestaurantId': 'restaurant-source',
            'targetRestaurantId': 'restaurant-target',
            'expectedSourceRestaurantRevision': 4,
            'expectedTargetRestaurantRevision': 9,
            'clientRequestId': 'request-fixed',
          },
        ),
        (
          'startRatingRestaurantDelete',
          <String, Object?>{
            'contractVersion': ratingDestructiveCallableContractVersion,
            'restaurantId': 'restaurant-delete',
            'expectedRestaurantRevision': 11,
            'clientRequestId': 'request-fixed',
          },
        ),
        (
          'startRatingDishMerge',
          <String, Object?>{
            'contractVersion': ratingDestructiveCallableContractVersion,
            'sourceDishId': 'dish-source',
            'targetDishId': 'dish-target',
            'clientRequestId': 'request-fixed',
          },
        ),
        (
          'startRatingDishDelete',
          <String, Object?>{
            'contractVersion': ratingDestructiveCallableContractVersion,
            'dishId': 'dish-delete',
            'clientRequestId': 'request-fixed',
          },
        ),
        (
          'getRatingDestructiveOperationStatus',
          <String, Object?>{
            'contractVersion': ratingDestructiveCallableContractVersion,
            'operationId': _operationId,
            'clientRequestId': 'request-fixed',
          },
        ),
      ];
      expect(calls.map((call) => call.$1), expected.map((call) => call.$1));
      for (var index = 0; index < calls.length; index += 1) {
        expect(calls[index].$2, expected[index].$2);
      }
    },
  );

  test(
    'uses the exact admin page callable and preserves page protocol',
    () async {
      late String callableName;
      late Map<String, Object?> wireRequest;
      final service = RatingDestructiveOperationsService(
        functionsBoundary: (name, request) async {
          callableName = name;
          wireRequest = Map<String, Object?>.from(request);
          return pageJson();
        },
      );
      final request = PagedRequest(
        pageSize: ratingDestructiveAdminPageSize,
        criteria: RatingDestructiveOperationsService.adminOperationsCriteria,
        direction: PageDirection.forward,
        cursor: 'safe-cursor',
        requestExactCount: true,
        clientRequestId: 'page-request-1',
      );

      final page = await service.loadAdminOperationsPage(request);

      expect(callableName, 'listRatingAdminDestructiveOperationsPage');
      expect(wireRequest, request.toJson());
      expect(wireRequest['criteria'], <String, Object?>{'scope': 'all'});
      expect(wireRequest['pageSize'], 25);
      expect(wireRequest['requestExactCount'], isTrue);
      expect(page.items.single.operationId, _operationId);
      expect(page.total?.exactValue, 1);
    },
  );

  test(
    'strict service parser accepts the four new identity shapes together',
    () async {
      const operations = <String>[
        'restaurantMerge',
        'restaurantDelete',
        'dishMerge',
        'dishDelete',
      ];
      final service = RatingDestructiveOperationsService(
        functionsBoundary: (name, request) async => pageJson(
          items: <Object?>[
            for (var index = 0; index < operations.length; index += 1)
              adminRecordJson(
                operation: operations[index],
                id: String.fromCharCode(97 + index) * 64,
              ),
          ],
        ),
      );
      final request = PagedRequest(
        pageSize: ratingDestructiveAdminPageSize,
        criteria: RatingDestructiveOperationsService.adminOperationsCriteria,
        direction: PageDirection.first,
        requestExactCount: true,
        clientRequestId: 'mixed-page-request',
      );

      final page = await service.loadAdminOperationsPage(request);

      expect(page.items.map((record) => record.operation.wireName), operations);
      expect(page.items, hasLength(4));
      expect(page.items[0].sourceRestaurantName, 'Source Restaurant');
      expect(page.items[0].targetRestaurantName, 'Target Restaurant');
      expect(page.items[2].sourceDishName, 'Source Dish');
      expect(page.items[2].targetDishName, 'Target Dish');
      expect(page.items[3].identityLabels, <String>[
        'Dish: Source Dish (dish-source)',
      ]);
    },
  );

  test('rejects unsafe local inputs before crossing the boundary', () async {
    var calls = 0;
    final service = RatingDestructiveOperationsService(
      requestIdGenerator: () => 'request-fixed',
      functionsBoundary: (name, request) async {
        calls += 1;
        return summaryJson('dishMerge');
      },
    );

    expect(
      () => service.startDishMerge(sourceDishId: 'same', targetDishId: 'same'),
      throwsA(
        isA<RatingDestructiveOperationsException>().having(
          (error) => error.kind,
          'kind',
          RatingDestructiveFailureKind.invalidRequest,
        ),
      ),
    );
    expect(
      () => service.startRestaurantDelete(
        restaurantId: '../unsafe',
        expectedRestaurantRevision: 1,
      ),
      throwsA(isA<RatingDestructiveOperationsException>()),
    );
    expect(
      () => service.startRestaurantDelete(
        restaurantId: 'restaurant-1',
        expectedRestaurantRevision: -1,
      ),
      throwsA(isA<RatingDestructiveOperationsException>()),
    );
    expect(calls, 0);
  });

  test(
    'rejects an invalid generated request identity before calling',
    () async {
      var calls = 0;
      final service = RatingDestructiveOperationsService(
        requestIdGenerator: () => 'not safe!',
        functionsBoundary: (name, request) async {
          calls += 1;
          return summaryJson('dishDelete');
        },
      );

      expect(
        () => service.startDishDelete(dishId: 'dish-1'),
        throwsA(isA<RatingDestructiveOperationsException>()),
      );
      expect(calls, 0);
    },
  );

  test('maps malformed summary and page responses to unavailable', () async {
    final malformedSummary = RatingDestructiveOperationsService(
      functionsBoundary: (name, request) async => <String, Object?>{
        ...summaryJson('dishDelete'),
        'privateCursor': 'must-not-pass',
      },
    );
    await expectLater(
      malformedSummary.startDishDelete(dishId: 'dish-1'),
      throwsA(
        isA<RatingDestructiveOperationsException>().having(
          (error) => error.kind,
          'kind',
          RatingDestructiveFailureKind.unavailable,
        ),
      ),
    );

    final malformedPage = RatingDestructiveOperationsService(
      functionsBoundary: (name, request) async => <String, Object?>{
        ...pageJson(),
        'items': <Object?>[
          <String, Object?>{
            ...adminRecordJson(),
            'restaurantId': 'private-context-restaurant',
            'restaurantName': 'PRIVATE CONTEXT RESTAURANT CANARY',
          },
        ],
      },
    );
    final request = PagedRequest(
      pageSize: ratingDestructiveAdminPageSize,
      criteria: RatingDestructiveOperationsService.adminOperationsCriteria,
      direction: PageDirection.first,
      requestExactCount: true,
      clientRequestId: 'page-request-1',
    );
    await expectLater(
      malformedPage.loadAdminOperationsPage(request),
      throwsA(
        isA<RatingDestructiveOperationsException>().having(
          (error) => error.kind,
          'kind',
          RatingDestructiveFailureKind.unavailable,
        ),
      ),
    );
  });

  test(
    'rejects mismatched start operation and status operation identity',
    () async {
      final wrongOperation = RatingDestructiveOperationsService(
        functionsBoundary: (name, request) async =>
            summaryJson('restaurantMerge'),
      );
      await expectLater(
        wrongOperation.startDishDelete(dishId: 'dish-1'),
        throwsA(
          isA<RatingDestructiveOperationsException>().having(
            (error) => error.kind,
            'kind',
            RatingDestructiveFailureKind.unavailable,
          ),
        ),
      );

      final wrongStatusId = RatingDestructiveOperationsService(
        functionsBoundary: (name, request) async =>
            summaryJson('dishDelete', id: _differentOperationId),
      );
      await expectLater(
        wrongStatusId.getOperationStatus(_operationId),
        throwsA(
          isA<RatingDestructiveOperationsException>().having(
            (error) => error.kind,
            'kind',
            RatingDestructiveFailureKind.unavailable,
          ),
        ),
      );
    },
  );

  test('rejects malformed status operation IDs before crossing boundary', () {
    var calls = 0;
    final service = RatingDestructiveOperationsService(
      functionsBoundary: (name, request) async {
        calls += 1;
        return summaryJson('dishDelete');
      },
    );

    for (final invalid in <String>[
      'operation-1',
      'A' * 64,
      'a' * 63,
      'g' * 64,
    ]) {
      expect(
        () => service.getOperationStatus(invalid),
        throwsA(
          isA<RatingDestructiveOperationsException>().having(
            (error) => error.kind,
            'kind',
            RatingDestructiveFailureKind.invalidRequest,
          ),
        ),
      );
    }
    expect(calls, 0);
  });

  test(
    'maps aborted stale revisions without broad failed-precondition mapping',
    () async {
      // ignore: invalid_use_of_protected_member
      final staleRevision = FirebaseFunctionsException(
        code: 'aborted',
        message: 'Revision changed.',
      );
      // ignore: invalid_use_of_protected_member
      final otherPrecondition = FirebaseFunctionsException(
        code: 'failed-precondition',
        message: 'A different precondition failed.',
      );
      // ignore: invalid_use_of_protected_member
      final alreadyProcessing = FirebaseFunctionsException(
        code: 'failed-precondition',
        message: 'Already processing.',
        details: const <String, Object?>{
          'messageCategory': 'already_processing',
        },
      );

      Future<RatingDestructiveOperationsException> mapped(
        FirebaseFunctionsException failure,
      ) async {
        final service = RatingDestructiveOperationsService(
          functionsBoundary: (name, request) async => throw failure,
        );
        try {
          await service.startDishDelete(dishId: 'dish-1');
        } on RatingDestructiveOperationsException catch (error) {
          return error;
        }
        throw StateError('Expected a mapped failure.');
      }

      expect(
        (await mapped(staleRevision)).kind,
        RatingDestructiveFailureKind.staleData,
      );
      expect(
        (await mapped(otherPrecondition)).kind,
        RatingDestructiveFailureKind.unavailable,
      );
      expect(
        (await mapped(alreadyProcessing)).kind,
        RatingDestructiveFailureKind.alreadyProcessing,
      );
    },
  );

  test('rejects page requests outside the exact bounded contract', () async {
    var calls = 0;
    final service = RatingDestructiveOperationsService(
      functionsBoundary: (name, request) async {
        calls += 1;
        return pageJson();
      },
    );

    for (final request in <PagedRequest>[
      PagedRequest(
        pageSize: 24,
        criteria: RatingDestructiveOperationsService.adminOperationsCriteria,
        direction: PageDirection.first,
        requestExactCount: true,
        clientRequestId: 'page-1',
      ),
      PagedRequest(
        pageSize: 25,
        criteria: const <String, Object?>{'scope': 'mine'},
        direction: PageDirection.first,
        requestExactCount: true,
        clientRequestId: 'page-2',
      ),
      PagedRequest(
        pageSize: 25,
        criteria: RatingDestructiveOperationsService.adminOperationsCriteria,
        direction: PageDirection.first,
        requestExactCount: false,
        clientRequestId: 'page-3',
      ),
    ]) {
      await expectLater(
        service.loadAdminOperationsPage(request),
        throwsA(isA<RatingDestructiveOperationsException>()),
      );
    }
    expect(calls, 0);
  });
}
