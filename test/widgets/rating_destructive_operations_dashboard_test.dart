import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/models/rating_destructive_operation_models.dart';
import 'package:coupon_app/services/rating_destructive_operations_service.dart';
import 'package:coupon_app/widgets/rating_destructive_operations_dashboard.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const String pageOneOperationId =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const String pageTwoOperationId =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const String responsiveOperationId =
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

Map<String, Object?> recordJson({
  required String operationId,
  required String operation,
  String progressCategory = 'moving_data',
  String phaseCategory = 'moving_data',
  bool namesAvailable = true,
  bool duplicateNames = false,
}) => <String, Object?>{
  'operationId': operationId,
  'operation': operation,
  'status': 'active',
  'progressCategory': progressCategory,
  'phaseCategory': phaseCategory,
  'processedCount': 3,
  'phaseProcessedCount': 1,
  'createdAtMs': 1786406400000,
  'updatedAtMs': 1786406401000,
  'sourceRestaurantId':
      operation == 'restaurantMerge' || operation == 'restaurantDelete'
      ? 'restaurant-a'
      : null,
  'sourceRestaurantName':
      namesAvailable &&
          (operation == 'restaurantMerge' || operation == 'restaurantDelete')
      ? duplicateNames
            ? 'Duplicate Restaurant'
            : 'Alpha'
      : null,
  'targetRestaurantId': operation == 'restaurantMerge' ? 'restaurant-b' : null,
  'targetRestaurantName': namesAvailable && operation == 'restaurantMerge'
      ? duplicateNames
            ? 'Duplicate Restaurant'
            : 'Beta'
      : null,
  'sourceDishId': operation == 'dishMerge' || operation == 'dishDelete'
      ? 'dish-a'
      : null,
  'sourceDishName':
      namesAvailable && (operation == 'dishMerge' || operation == 'dishDelete')
      ? duplicateNames
            ? 'Duplicate Dish'
            : operation == 'dishMerge'
            ? 'Source Dish'
            : 'Special Dish'
      : null,
  'targetDishId': operation == 'dishMerge' ? 'dish-b' : null,
  'targetDishName': namesAvailable && operation == 'dishMerge'
      ? duplicateNames
            ? 'Duplicate Dish'
            : 'Target Dish'
      : null,
  'complete': false,
  'retryable': false,
  'manualReviewRequired': false,
  'messageCategory': 'current_status',
};

Map<String, Object?> summaryJson({
  required String operationId,
  required String operation,
  String progressCategory = 'moving_data',
}) => <String, Object?>{
  'contractVersion': ratingDestructiveSummaryContractVersion,
  'accepted': false,
  'operationId': operationId,
  'operation': operation,
  'status': 'active',
  'progressCategory': progressCategory,
  'processing': true,
  'complete': false,
  'retryable': false,
  'manualReviewRequired': false,
  'messageCategory': 'current_status',
  'processedCount': 3,
  'phaseProcessedCount': 1,
  'createdAtMs': 1786406400000,
  'updatedAtMs': 1786406401000,
};

Map<String, Object?> pageJson({
  required int pageNumber,
  required Map<String, Object?> item,
  required bool hasNext,
  required bool hasPrevious,
}) => <String, Object?>{
  'protocolVersion': pageProtocolVersion,
  'items': <Object?>[item],
  'pageSize': ratingDestructiveAdminPageSize,
  'hasNext': hasNext,
  'hasPrevious': hasPrevious,
  if (hasNext) 'nextCursor': 'page-2-cursor',
  if (hasPrevious) 'previousCursor': 'page-1-cursor',
  'currentPageNumber': pageNumber,
  'total': <String, Object?>{'state': 'exact', 'value': 26},
  'queryFingerprint': List<String>.filled(64, 'b').join(),
  'snapshotTimestampMs': 1786406401000,
  'capabilities': <String, Object?>{
    'first': pageNumber > 1,
    'previous': hasPrevious,
    'numberedVisitedPages': true,
    'next': hasNext,
    'last': hasNext,
  },
};

Widget host(Widget child, {double width = 390, double height = 560}) {
  return MaterialApp(
    home: Scaffold(
      body: SizedBox(width: width, height: height, child: child),
    ),
  );
}

void main() {
  testWidgets('loads lazily on activation with exact bounded page request', (
    tester,
  ) async {
    final calls = <(String, Map<String, Object?>)>[];
    final service = RatingDestructiveOperationsService(
      functionsBoundary: (name, request) async {
        calls.add((name, Map<String, Object?>.from(request)));
        return pageJson(
          pageNumber: 1,
          item: recordJson(
            operationId: pageOneOperationId,
            operation: 'restaurantMerge',
          ),
          hasNext: false,
          hasPrevious: false,
        );
      },
    );

    await tester.pumpWidget(
      host(
        RatingAdminDestructiveOperationsPagedView(
          isActive: false,
          service: service,
        ),
      ),
    );
    await tester.pump(const Duration(minutes: 5));
    expect(calls, isEmpty);

    await tester.pumpWidget(
      host(
        RatingAdminDestructiveOperationsPagedView(
          isActive: true,
          service: service,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(calls, hasLength(1));
    expect(calls.single.$1, 'listRatingAdminDestructiveOperationsPage');
    expect(calls.single.$2, <String, Object?>{
      'protocolVersion': pageProtocolVersion,
      'pageSize': 25,
      'criteria': <String, Object?>{'scope': 'all'},
      'direction': 'first',
      'requestExactCount': true,
      'clientRequestId': 'admin-page-0-1',
    });
    expect(find.text('Restaurant merge'), findsOneWidget);
    expect(find.textContaining(pageOneOperationId), findsWidgets);
  });

  testWidgets(
    'cards render only the four authorized operation identity roles',
    (tester) async {
      final fixtures = <(String, bool, bool, List<String>)>[
        (
          'restaurantMerge',
          true,
          true,
          <String>[
            'Source: Duplicate Restaurant (restaurant-a)',
            'Target: Duplicate Restaurant (restaurant-b)',
          ],
        ),
        (
          'restaurantDelete',
          true,
          false,
          <String>['Restaurant: Alpha (restaurant-a)'],
        ),
        (
          'dishMerge',
          false,
          false,
          <String>[
            'Source: Unavailable or deleted (dish-a)',
            'Target: Unavailable or deleted (dish-b)',
          ],
        ),
        ('dishDelete', true, false, <String>['Dish: Special Dish (dish-a)']),
      ];

      for (final fixture in fixtures) {
        final service = RatingDestructiveOperationsService(
          functionsBoundary: (name, request) async => pageJson(
            pageNumber: 1,
            item: recordJson(
              operationId: responsiveOperationId,
              operation: fixture.$1,
              namesAvailable: fixture.$2,
              duplicateNames: fixture.$3,
            ),
            hasNext: false,
            hasPrevious: false,
          ),
        );
        await tester.pumpWidget(
          host(
            RatingAdminDestructiveOperationsPagedView(
              key: ValueKey<String>('roles-${fixture.$1}'),
              isActive: true,
              service: service,
            ),
          ),
        );
        await tester.pumpAndSettle();

        for (final label in fixture.$4) {
          expect(find.text(label), findsOneWidget, reason: fixture.$1);
        }
        expect(find.textContaining('null'), findsNothing, reason: fixture.$1);
        if (fixture.$1 == 'dishMerge' || fixture.$1 == 'dishDelete') {
          expect(
            find.textContaining('Restaurant:'),
            findsNothing,
            reason: fixture.$1,
          );
        }
        expect(
          find.byKey(
            const ValueKey<String>(
              'rating-operation-view-status-$responsiveOperationId',
            ),
          ),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull, reason: fixture.$1);
      }
    },
  );

  testWidgets('next page replaces current page and manual refresh is bounded', (
    tester,
  ) async {
    final requests = <Map<String, Object?>>[];
    final service = RatingDestructiveOperationsService(
      functionsBoundary: (name, request) async {
        requests.add(Map<String, Object?>.from(request));
        if (request['direction'] == 'forward') {
          return pageJson(
            pageNumber: 2,
            item: recordJson(
              operationId: pageTwoOperationId,
              operation: 'dishDelete',
            ),
            hasNext: false,
            hasPrevious: true,
          );
        }
        return pageJson(
          pageNumber: 1,
          item: recordJson(
            operationId: pageOneOperationId,
            operation: 'restaurantMerge',
          ),
          hasNext: true,
          hasPrevious: false,
        );
      },
    );

    await tester.pumpWidget(
      host(
        RatingAdminDestructiveOperationsPagedView(
          isActive: true,
          service: service,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining(pageOneOperationId), findsWidgets);

    await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
    await tester.pumpAndSettle();
    expect(requests, hasLength(2));
    expect(requests.last['direction'], 'forward');
    expect(requests.last['cursor'], 'page-2-cursor');
    expect(find.textContaining(pageOneOperationId), findsNothing);
    expect(find.textContaining(pageTwoOperationId), findsWidgets);
    expect(find.text('Dish delete'), findsOneWidget);

    await tester.pump(const Duration(minutes: 5));
    expect(requests, hasLength(2), reason: 'The dashboard must never poll.');

    await tester.tap(
      find.byKey(const ValueKey<String>('paged-directory-refresh')),
    );
    await tester.pumpAndSettle();
    expect(requests, hasLength(3));
    expect(requests.last['direction'], 'forward');
    expect(requests.last['cursor'], 'page-2-cursor');
  });

  testWidgets('View Status loads once and opens reusable manual status', (
    tester,
  ) async {
    var pageCalls = 0;
    var statusCalls = 0;
    final service = RatingDestructiveOperationsService(
      functionsBoundary: (name, request) async {
        if (name == 'listRatingAdminDestructiveOperationsPage') {
          pageCalls += 1;
          return pageJson(
            pageNumber: 1,
            item: recordJson(
              operationId: pageOneOperationId,
              operation: 'dishDelete',
              progressCategory: 'moving_data',
              phaseCategory: 'cleaning_up',
            ),
            hasNext: false,
            hasPrevious: false,
          );
        }
        if (name == 'getRatingDestructiveOperationStatus') {
          statusCalls += 1;
          return summaryJson(
            operationId: pageOneOperationId,
            operation: 'dishDelete',
            progressCategory: 'rebuilding',
          );
        }
        throw StateError('Unexpected callable $name');
      },
    );

    await tester.pumpWidget(
      host(
        RatingAdminDestructiveOperationsPagedView(
          isActive: true,
          service: service,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Moving related data'), findsOneWidget);
    expect(find.text('Current step: Cleaning up related data'), findsOneWidget);
    final viewStatus = find.byKey(
      const ValueKey<String>(
        'rating-operation-view-status-$pageOneOperationId',
      ),
    );
    tester.widget<FilledButton>(viewStatus).onPressed!();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(pageCalls, 1);
    expect(statusCalls, 1);
    expect(
      find.byType(RatingAdminDestructiveOperationsPagedView),
      findsOneWidget,
    );
    expect(find.text('Operation ID: $pageOneOperationId'), findsNWidgets(2));
    expect(find.text('Moving related data'), findsOneWidget);
    expect(find.text('Rebuilding totals'), findsOneWidget);
    expect(find.text('Current step: Cleaning up related data'), findsOneWidget);
    expect(find.text('Refresh'), findsOneWidget);

    await tester.pump(const Duration(minutes: 5));
    expect(statusCalls, 1, reason: 'The opened dialog must not poll.');
  });

  testWidgets('operation cards remain usable at compact and wide widths', (
    tester,
  ) async {
    for (final width in <double>[320, 1180]) {
      final service = RatingDestructiveOperationsService(
        functionsBoundary: (name, request) async => pageJson(
          pageNumber: 1,
          item: recordJson(
            operationId: responsiveOperationId,
            operation: 'restaurantMerge',
          ),
          hasNext: false,
          hasPrevious: false,
        ),
      );
      await tester.pumpWidget(
        host(
          RatingAdminDestructiveOperationsPagedView(
            isActive: true,
            service: service,
          ),
          width: width,
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull, reason: 'width $width');
      final button = tester.widget<FilledButton>(
        find.byKey(
          const ValueKey<String>(
            'rating-operation-view-status-$responsiveOperationId',
          ),
        ),
      );
      expect(button.onPressed, isNotNull);
      expect(
        tester.getSize(find.byWidget(button)).height,
        greaterThanOrEqualTo(48),
      );
    }
  });
}
