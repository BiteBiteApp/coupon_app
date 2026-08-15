import 'dart:async';
import 'dart:io';

import 'package:coupon_app/models/admin_restaurant_link_record.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/models/rating_admin_paging_models.dart';
import 'package:coupon_app/models/rating_destructive_operation_models.dart';
import 'package:coupon_app/services/rating_admin_paging_service.dart';
import 'package:coupon_app/services/rating_destructive_operations_service.dart';
import 'package:coupon_app/widgets/owner_dish_merge_dialog.dart';
import 'package:coupon_app/widgets/rating_admin_paged_dashboard.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const String _operationId =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

Map<String, Object?> _summary(String operation, {bool complete = false}) =>
    <String, Object?>{
      'contractVersion': ratingDestructiveSummaryContractVersion,
      'accepted': true,
      'operationId': _operationId,
      'operation': operation,
      'status': complete ? 'complete' : 'active',
      'progressCategory': complete ? 'complete' : 'starting',
      'processing': !complete,
      'complete': complete,
      'retryable': false,
      'manualReviewRequired': false,
      'messageCategory': complete ? 'accepted_complete' : 'accepted_processing',
      'processedCount': complete ? 1 : 0,
      'phaseProcessedCount': complete ? 1 : 0,
      'createdAtMs': 1786406400000,
      'updatedAtMs': 1786406401000,
    };

Map<String, Object?> _page({
  required List<Object?> items,
  required int pageSize,
}) => <String, Object?>{
  'protocolVersion': pageProtocolVersion,
  'items': items,
  'pageSize': pageSize,
  'hasNext': false,
  'hasPrevious': false,
  'currentPageNumber': 1,
  'total': <String, Object?>{'state': 'exact', 'value': items.length},
  'queryFingerprint': '0' * 64,
  'snapshotTimestampMs': 1786406400000,
  'capabilities': const <String, Object?>{
    'first': false,
    'previous': false,
    'numberedVisitedPages': true,
    'next': false,
    'last': false,
  },
};

Map<String, Object?> _restaurantRecord(
  String id,
  String name, {
  int revision = 4,
}) => <String, Object?>{
  'source': 'biteScore',
  'documentId': id,
  'actionId': id,
  'restaurantName': name,
  'streetAddress': '1 Main St',
  'city': 'Orlando',
  'state': 'FL',
  'zipCode': '32801',
  'phone': '',
  'website': '',
  'latitude': 28.5,
  'longitude': -81.3,
  'distanceMiles': null,
  'isActive': true,
  'isClaimed': false,
  'claimAvailable': true,
  'claimStateValid': true,
  'ownerUserId': null,
  'linkedBiteSaverUid': null,
  'restaurantWriteRevision': revision,
};

Map<String, Object?> _nestedRestaurant(
  String id,
  String name, {
  int revision = 4,
}) => <String, Object?>{
  'id': id,
  'name': name,
  'normalizedName': name.toLowerCase(),
  'address': '1 Main St',
  'city': 'Orlando',
  'state': 'FL',
  'zipCode': '32801',
  'latitude': 28.5,
  'longitude': -81.3,
  'phone': null,
  'website': null,
  'ownerUserId': null,
  'isClaimed': false,
  'isActive': true,
  'createdAtMillis': null,
  'updatedAtMillis': null,
  'restaurantWriteRevision': revision,
};

Map<String, Object?> _dishRecord(String id, String restaurantId) =>
    <String, Object?>{
      'id': id,
      'restaurantId': restaurantId,
      'restaurantName': 'Dish Restaurant',
      'name': 'Reported Dish',
      'normalizedName': 'reported dish',
      'category': null,
      'subcategory': null,
      'categoryManualKeywords': null,
      'categoryTags': const <String>[],
      'priceLabel': null,
      'primaryImageUrl': null,
      'primaryImageId': null,
      'imageCount': 0,
      'isActive': true,
      'mergedIntoDishId': null,
      'createdAtMillis': null,
      'updatedAtMillis': null,
    };

Map<String, Object?> _restaurantReport(String restaurantId) =>
    <String, Object?>{
      'kind': RatingAdminQueueKind.restaurantReports.wireName,
      'id': 'restaurant-report-1',
      'reportId': 'restaurant-report-1',
      'restaurantId': restaurantId,
      'restaurantName': 'Reported Restaurant',
      'reportingUserId': 'reporter-1',
      'reason': 'duplicate',
      'status': 'pending',
      'createdAtMillis': null,
      'updatedAtMillis': null,
      'restaurant': _nestedRestaurant(
        restaurantId,
        'Reported Restaurant',
        revision: 17,
      ),
    };

Map<String, Object?> _duplicateRestaurantReport(String restaurantId) =>
    <String, Object?>{
      'kind': RatingAdminQueueKind.duplicateRestaurantReports.wireName,
      'id': 'duplicate-report-1',
      'reportId': 'duplicate-report-1',
      'restaurantId': restaurantId,
      'restaurantName': 'Duplicate Restaurant',
      'reportingUserId': 'reporter-1',
      'reason': 'duplicate',
      'status': 'pending',
      'createdAtMillis': null,
      'updatedAtMillis': null,
      'restaurant': _nestedRestaurant(
        restaurantId,
        'Duplicate Restaurant',
        revision: 17,
      ),
    };

Widget _host(
  Widget child, {
  double width = 390,
  double height = 900,
  double textScale = 1,
}) => MaterialApp(
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(
      context,
    ).copyWith(textScaler: TextScaler.linear(textScale)),
    child: child!,
  ),
  home: Scaffold(
    body: SizedBox(width: width, height: height, child: child),
  ),
);

RatingDestructiveOperationsService _operationsService(
  Future<Object?> Function(String, Map<String, Object?>) boundary,
) => RatingDestructiveOperationsService(
  requestIdGenerator: () => 'fixed-request-id',
  functionsBoundary: boundary,
);

Future<void> _startRestaurantSearch(WidgetTester tester) async {
  await tester.enterText(
    find.byKey(const ValueKey('rating-admin-location-field')),
    'Orlando',
  );
  await tester.ensureVisible(
    find.byKey(const ValueKey('rating-admin-search-button')),
  );
  await tester.tap(find.byKey(const ValueKey('rating-admin-search-button')));
  await tester.pumpAndSettle();
}

void main() {
  test('production UI cannot reach legacy synchronous destructive methods', () {
    final uiSource = <String>[
      ...Directory('lib/screens')
          .listSync()
          .whereType<File>()
          .where((file) => file.path.endsWith('.dart'))
          .map((file) => file.readAsStringSync()),
      ...Directory('lib/widgets')
          .listSync()
          .whereType<File>()
          .where((file) => file.path.endsWith('.dart'))
          .map((file) => file.readAsStringSync()),
    ].join('\n');
    for (final method in <String>[
      'mergeRestaurantsAsAdmin',
      'deleteRestaurantAsAdmin',
      'mergeDishesAsOwner',
      'deleteDishAsAdmin',
    ]) {
      expect(
        uiSource,
        isNot(matches(RegExp('BiteScoreService\\.$method\\s*\\('))),
        reason: method,
      );
    }

    final owner = File(
      'lib/widgets/owner_dish_merge_dialog.dart',
    ).readAsStringSync();
    expect(owner, contains("labelText: 'Duplicate dish'"));
    expect(owner, contains("labelText: 'Keep this dish'"));
    expect(
      owner,
      contains(
        'This keeps one dish visible and marks the duplicate dish unavailable.',
      ),
    );

    final admin = File(
      'lib/widgets/rating_admin_paged_dashboard.dart',
    ).readAsStringSync();
    expect(admin, contains("title: 'Confirm Merge'"));
    expect(admin, contains("'? The selected restaurant will survive.'"));
    expect(admin, contains('sourceRestaurantId: duplicate.id'));
    expect(admin, contains('targetRestaurantId: surviving.id'));
    expect(admin, contains('duplicate.restaurantWriteRevision'));
    expect(admin, contains('surviving.restaurantWriteRevision'));
    expect(admin, contains("title: 'Delete Restaurant'"));
    expect(admin, contains("' and its related dishes and reviews?'"));
    expect(admin, contains("title: 'Delete Dish'"));
    expect(
      RegExp(
        r'_operationsService\.startRestaurantDelete\(',
      ).allMatches(admin).length,
      greaterThanOrEqualTo(2),
      reason: 'Both directory and report restaurant deletes must be migrated.',
    );
    expect(
      RegExp(r'_operationsService\.startDishDelete\(').allMatches(admin).length,
      greaterThanOrEqualTo(2),
      reason: 'Both direct and reported dish deletes must be migrated.',
    );
  });

  testWidgets(
    'owner dish merge preserves source-to-target IDs and suppresses rapid taps',
    (tester) async {
      final calls = <(String, Map<String, Object?>)>[];
      final completion = Completer<Object?>();
      final service = _operationsService((name, request) {
        calls.add((name, Map<String, Object?>.from(request)));
        return completion.future;
      });
      const dishes = <BitescoreDish>[
        BitescoreDish(
          id: 'duplicate-dish-id',
          restaurantId: 'restaurant-1',
          restaurantName: 'Restaurant',
          name: 'Duplicate Dish',
          normalizedName: 'duplicate dish',
        ),
        BitescoreDish(
          id: 'surviving-dish-id',
          restaurantId: 'restaurant-1',
          restaurantName: 'Restaurant',
          name: 'Surviving Dish',
          normalizedName: 'surviving dish',
        ),
      ];

      await tester.pumpWidget(
        _host(
          OwnerDishMergeDialog(dishes: dishes, operationsService: service),
          width: 700,
        ),
      );
      final source = tester.widget<DropdownButtonFormField<String>>(
        find.byType(DropdownButtonFormField<String>).first,
      );
      source.onChanged!('duplicate-dish-id');
      await tester.pump();
      final target = tester.widget<DropdownButtonFormField<String>>(
        find.byType(DropdownButtonFormField<String>).last,
      );
      target.onChanged!('surviving-dish-id');
      await tester.pump();

      final merge = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Merge Dishes'),
      );
      merge.onPressed!();
      merge.onPressed!();
      await tester.pump();

      expect(calls, hasLength(1));
      expect(calls.single.$1, 'startRatingDishMerge');
      expect(calls.single.$2, <String, Object?>{
        'contractVersion': ratingDestructiveCallableContractVersion,
        'sourceDishId': 'duplicate-dish-id',
        'targetDishId': 'surviving-dish-id',
        'clientRequestId': 'fixed-request-id',
      });
      expect(find.text('Merging...'), findsOneWidget);

      completion.complete(_summary('dishMerge'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('owner merge stays overflow-free at narrow high text scales', (
    tester,
  ) async {
    const dishes = <BitescoreDish>[
      BitescoreDish(
        id: 'responsive-duplicate',
        restaurantId: 'restaurant-1',
        restaurantName: 'Restaurant',
        name: 'Very Long Duplicate Dish Name That Must Truncate',
        normalizedName: 'very long duplicate dish name that must truncate',
      ),
      BitescoreDish(
        id: 'responsive-survivor',
        restaurantId: 'restaurant-1',
        restaurantName: 'Restaurant',
        name: 'Very Long Surviving Dish Name That Must Truncate',
        normalizedName: 'very long surviving dish name that must truncate',
      ),
    ];
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    for (final width in <double>[320, 390]) {
      for (final scale in <double>[1.5, 2]) {
        tester.view.physicalSize = Size(width, 1200);
        await tester.pumpWidget(
          _host(
            const OwnerDishMergeDialog(dishes: dishes),
            width: width,
            height: 1200,
            textScale: scale,
          ),
        );
        final source = tester.widget<DropdownButtonFormField<String>>(
          find.byType(DropdownButtonFormField<String>).first,
        );
        source.onChanged!('responsive-duplicate');
        await tester.pump();
        final target = tester.widget<DropdownButtonFormField<String>>(
          find.byType(DropdownButtonFormField<String>).last,
        );
        target.onChanged!('responsive-survivor');
        await tester.pump();

        expect(
          tester.takeException(),
          isNull,
          reason: 'width $width, text scale $scale',
        );
        expect(find.text('Merge Dishes'), findsWidgets);
        await tester.pumpWidget(const SizedBox.shrink());
      }
    }
  });

  testWidgets(
    'restaurant directory delete sends exact ID and revision and refreshes only complete',
    (tester) async {
      tester.view.physicalSize = const Size(800, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var pageCalls = 0;
      final paging = RatingAdminPagingService(
        functionsBoundary: (_, _) async {
          pageCalls += 1;
          return _page(
            items: <Object?>[
              _restaurantRecord(
                'restaurant-delete-id',
                'Directory Restaurant',
                revision: 23,
              ),
            ],
            pageSize: 50,
          );
        },
      );
      final operationCalls = <(String, Map<String, Object?>)>[];
      final operations = _operationsService((name, request) async {
        operationCalls.add((name, Map<String, Object?>.from(request)));
        return _summary('restaurantDelete', complete: true);
      });

      await tester.pumpWidget(
        _host(
          RatingAdminRestaurantPagedView(
            service: paging,
            operationsService: operations,
            onManageDishes: (_) {},
            onEditRestaurant: (_) async => false,
          ),
        ),
      );
      await _startRestaurantSearch(tester);
      final deleteButton = find.widgetWithText(OutlinedButton, 'Delete');
      await tester.ensureVisible(deleteButton);
      await tester.tap(deleteButton);
      await tester.pumpAndSettle();
      expect(find.text('Delete Restaurant'), findsOneWidget);
      expect(
        find.text(
          'Delete Directory Restaurant and its related dishes and reviews?',
        ),
        findsOneWidget,
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
      await tester.pumpAndSettle();

      expect(operationCalls.single.$1, 'startRatingRestaurantDelete');
      expect(operationCalls.single.$2, <String, Object?>{
        'contractVersion': ratingDestructiveCallableContractVersion,
        'restaurantId': 'restaurant-delete-id',
        'expectedRestaurantRevision': 23,
        'clientRequestId': 'fixed-request-id',
      });
      expect(pageCalls, 2, reason: 'A complete operation refreshes once.');
      expect(find.text('Restaurant delete completed.'), findsOneWidget);
      expect(find.text('View Status'), findsOneWidget);
    },
  );

  testWidgets(
    'restaurant report delete remains processing and does not refresh early',
    (tester) async {
      var pageCalls = 0;
      final paging = RatingAdminPagingService(
        functionsBoundary: (_, _) async {
          pageCalls += 1;
          return _page(
            items: <Object?>[_restaurantReport('reported-restaurant-id')],
            pageSize: 25,
          );
        },
      );
      final operationCalls = <(String, Map<String, Object?>)>[];
      final operations = _operationsService((name, request) async {
        operationCalls.add((name, Map<String, Object?>.from(request)));
        return _summary('restaurantDelete');
      });

      await tester.pumpWidget(
        _host(
          RatingAdminQueuePagedView(
            kind: RatingAdminQueueKind.restaurantReports,
            service: paging,
            operationsService: operations,
            onEditRestaurant: (_) async => false,
            onEditDish: (_) async => false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Delete Restaurant'));
      await tester.pumpAndSettle();
      expect(find.text('Delete Reported Restaurant?'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
      await tester.pumpAndSettle();

      expect(operationCalls.single.$1, 'startRatingRestaurantDelete');
      expect(
        operationCalls.single.$2['restaurantId'],
        'reported-restaurant-id',
      );
      expect(operationCalls.single.$2['expectedRestaurantRevision'], 17);
      expect(pageCalls, 1, reason: 'Processing must not imply completion.');
      expect(
        find.text(
          'Restaurant delete started. BiteStar will continue processing.',
        ),
        findsOneWidget,
      );
      expect(find.text('View Status'), findsOneWidget);
    },
  );

  testWidgets(
    'duplicate restaurant merge preserves direction, revisions, and processing state',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var queuePageCalls = 0;
      var candidatePageCalls = 0;
      final paging = RatingAdminPagingService(
        functionsBoundary: (name, request) async {
          if (name == 'listRatingAdminQueuePage') {
            queuePageCalls += 1;
            expect(
              (request['criteria'] as Map)['queueKind'],
              RatingAdminQueueKind.duplicateRestaurantReports.wireName,
            );
            return _page(
              items: <Object?>[
                _duplicateRestaurantReport('duplicate-restaurant-id'),
              ],
              pageSize: 25,
            );
          }
          if (name == 'searchRatingAdminRestaurantsPage') {
            candidatePageCalls += 1;
            return _page(
              items: <Object?>[
                _restaurantRecord(
                  'surviving-restaurant-id',
                  'Surviving Restaurant',
                  revision: 29,
                ),
              ],
              pageSize: 50,
            );
          }
          throw StateError('Unexpected page callable $name.');
        },
      );
      const survivingRestaurant = BitescoreRestaurant(
        id: 'surviving-restaurant-id',
        name: 'Surviving Restaurant',
        normalizedName: 'surviving restaurant',
        address: '2 Main St',
        city: 'Orlando',
        state: 'FL',
        zipCode: '32801',
        location: GeoPoint(28.5, -81.3),
        restaurantWriteRevision: 29,
      );
      final loadedIds = <String>[];
      final operationCalls = <(String, Map<String, Object?>)>[];
      final operations = _operationsService((name, request) async {
        operationCalls.add((name, Map<String, Object?>.from(request)));
        return _summary('restaurantMerge');
      });

      await tester.pumpWidget(
        _host(
          RatingAdminQueuePagedView(
            kind: RatingAdminQueueKind.duplicateRestaurantReports,
            service: paging,
            operationsService: operations,
            loadRestaurant: (id) async {
              loadedIds.add(id);
              return survivingRestaurant;
            },
            onEditRestaurant: (_) async => false,
            onEditDish: (_) async => false,
          ),
          width: 1200,
          height: 1000,
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(OutlinedButton, 'Merge Into...'));
      await tester.pumpAndSettle();

      expect(find.text('Merge Duplicate Restaurant'), findsOneWidget);
      expect(
        find.text('Choose a surviving restaurant for Duplicate Restaurant.'),
        findsOneWidget,
      );
      final candidate = find.byKey(
        const ValueKey('merge-candidate-surviving-restaurant-id'),
      );
      expect(candidate, findsOneWidget);
      await tester.tap(
        find.descendant(
          of: candidate,
          matching: find.widgetWithText(FilledButton, 'Select'),
        ),
      );
      await tester.pumpAndSettle();

      expect(loadedIds, <String>['surviving-restaurant-id']);
      expect(find.text('Confirm Merge'), findsOneWidget);
      expect(
        find.text(
          'Merge Duplicate Restaurant into Surviving Restaurant? '
          'The selected restaurant will survive.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Merge'));
      await tester.pumpAndSettle();

      expect(operationCalls, hasLength(1));
      expect(operationCalls.single.$1, 'startRatingRestaurantMerge');
      expect(operationCalls.single.$2, <String, Object?>{
        'contractVersion': ratingDestructiveCallableContractVersion,
        'sourceRestaurantId': 'duplicate-restaurant-id',
        'targetRestaurantId': 'surviving-restaurant-id',
        'expectedSourceRestaurantRevision': 17,
        'expectedTargetRestaurantRevision': 29,
        'clientRequestId': 'fixed-request-id',
      });
      expect(queuePageCalls, 1, reason: 'Processing must not refresh early.');
      expect(candidatePageCalls, 1);
      expect(
        find.text(
          'Restaurant merge started. BiteStar will continue processing.',
        ),
        findsOneWidget,
      );
      expect(find.text('View Status'), findsOneWidget);
    },
  );

  testWidgets('direct dish delete is disposal-safe after the exact request', (
    tester,
  ) async {
    final paging = RatingAdminPagingService(
      functionsBoundary: (_, _) async => _page(
        items: <Object?>[_dishRecord('dish-delete-id', 'restaurant-1')],
        pageSize: 50,
      ),
    );
    final completion = Completer<Object?>();
    final operationCalls = <(String, Map<String, Object?>)>[];
    final operations = _operationsService((name, request) {
      operationCalls.add((name, Map<String, Object?>.from(request)));
      return completion.future;
    });
    const selectedRestaurant = AdminRestaurantLinkRecord(
      source: AdminRestaurantLinkSource.biteScore,
      documentId: 'restaurant-1',
      actionId: 'restaurant-1',
      restaurantName: 'Dish Restaurant',
      streetAddress: '1 Main St',
      city: 'Orlando',
      state: 'FL',
      zipCode: '32801',
      phone: '',
      website: '',
      latitude: 28.5,
      longitude: -81.3,
      distanceMiles: 0,
    );

    await tester.pumpWidget(
      _host(
        RatingAdminDishPagedView(
          selectedRestaurant: selectedRestaurant,
          service: paging,
          operationsService: operations,
          onEditDish: (_) async => false,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Delete dish'));
    await tester.pumpAndSettle();
    expect(find.text('Delete Reported Dish?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pump();
    expect(operationCalls.single.$1, 'startRatingDishDelete');
    expect(operationCalls.single.$2, <String, Object?>{
      'contractVersion': ratingDestructiveCallableContractVersion,
      'dishId': 'dish-delete-id',
      'clientRequestId': 'fixed-request-id',
    });

    await tester.pumpWidget(const SizedBox.shrink());
    completion.complete(_summary('dishDelete'));
    await tester.pumpAndSettle();
    expect(find.byType(SnackBar), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
