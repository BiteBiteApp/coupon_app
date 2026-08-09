import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/models/rating_admin_paging_models.dart';
import 'package:coupon_app/services/rating_admin_paging_service.dart';
import 'package:coupon_app/widgets/rating_admin_paged_dashboard.dart';

Map<String, Object?> restaurant(String id, String name) {
  return <String, Object?>{
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
    'ownerUserId': null,
    'linkedBiteSaverUid': null,
  };
}

Map<String, Object?> page({
  required List<Object?> items,
  required int pageSize,
  required int pageNumber,
  bool hasNext = false,
  bool hasPrevious = false,
}) {
  return <String, Object?>{
    'protocolVersion': pageProtocolVersion,
    'items': items,
    'pageSize': pageSize,
    'hasNext': hasNext,
    'hasPrevious': hasPrevious,
    if (hasNext) 'nextCursor': 'next-cursor',
    if (hasPrevious) 'previousCursor': 'previous-cursor',
    'currentPageNumber': pageNumber,
    'total': <String, Object?>{'state': 'exact', 'value': 51},
    'queryFingerprint': List<String>.filled(64, '0').join(),
    'snapshotTimestampMs': 1,
    'capabilities': <String, Object?>{
      'first': pageNumber > 1,
      'previous': hasPrevious,
      'numberedVisitedPages': true,
      'next': hasNext,
      'last': hasNext,
    },
  };
}

Widget host(Widget child, {double width = 390, double textScale = 1}) {
  return MaterialApp(
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: Scaffold(
      body: SizedBox(width: width, height: 900, child: child),
    ),
  );
}

void main() {
  test('migrated production widget has only paged read boundaries', () {
    final source = File(
      'lib/widgets/rating_admin_paged_dashboard.dart',
    ).readAsStringSync();
    for (final forbidden in <String>[
      'reviewsAdminStream(',
      'reportedReviewsAdminStream(',
      'reportedRestaurantsAdminStream(',
      'reportedDishesAdminStream(',
      'duplicateRestaurantReportsAdminStream(',
      'claimRequestsAdminStream(',
      'approvedOwnershipsAdminStream(',
      'loadRestaurantMergeCandidates(',
      'loadDishesForRestaurant(',
      'listInvites(',
      'Show 25 More',
    ]) {
      expect(source, isNot(contains(forbidden)), reason: forbidden);
    }
    expect(source, contains('PagedDirectoryView<'));
  });

  testWidgets('restaurant page replaces results and keeps active criteria', (
    tester,
  ) async {
    final calls = <Map<String, Object?>>[];
    final service = RatingAdminPagingService(
      functionsBoundary: (name, body) async {
        expect(name, 'searchRatingAdminRestaurantsPage');
        calls.add(body);
        final direction = body['direction'];
        return direction == 'forward'
            ? page(
                items: <Object?>[restaurant('restaurant-2', 'Second')],
                pageSize: 50,
                pageNumber: 2,
                hasPrevious: true,
              )
            : page(
                items: <Object?>[restaurant('restaurant-1', 'First')],
                pageSize: 50,
                pageNumber: 1,
                hasNext: true,
              );
      },
    );
    await tester.pumpWidget(
      host(
        RatingAdminRestaurantPagedView(
          service: service,
          onManageDishes: (_) {},
          onEditRestaurant: (_) async => false,
        ),
      ),
    );
    await tester.enterText(
      find.byKey(const ValueKey('rating-admin-location-field')),
      'Orlando',
    );
    await tester.ensureVisible(
      find.byKey(const ValueKey('rating-admin-search-button')),
    );
    await tester.tap(find.byKey(const ValueKey('rating-admin-search-button')));
    await tester.pumpAndSettle();
    expect(find.text('First'), findsOneWidget);
    expect(find.text('Second'), findsNothing);
    expect(
      find.textContaining('Current results: Nearby Radius'),
      findsOneWidget,
    );
    expect(find.text('Show 25 More'), findsNothing);

    await tester.enterText(
      find.byKey(const ValueKey('rating-admin-location-field')),
      'Draft location',
    );
    expect(
      find.textContaining('Current results: Nearby Radius • Orlando'),
      findsOneWidget,
    );

    await tester.ensureVisible(find.byKey(const ValueKey('pagination-next')));
    await tester.tap(find.byKey(const ValueKey('pagination-next')));
    await tester.pumpAndSettle();
    expect(calls.length, 2);
    expect(
      find.byKey(const ValueKey('rating-admin-result-restaurant-1')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('rating-admin-result-restaurant-2')),
      findsOneWidget,
    );
    expect(calls.last['cursor'], 'next-cursor');
  });

  testWidgets('dish view performs no page call without a restaurant', (
    tester,
  ) async {
    var calls = 0;
    final service = RatingAdminPagingService(
      functionsBoundary: (_, _) async {
        calls++;
        return page(items: const <Object?>[], pageSize: 50, pageNumber: 1);
      },
    );
    await tester.pumpWidget(
      host(
        RatingAdminDishPagedView(
          selectedRestaurant: null,
          service: service,
          onEditDish: (_) async => false,
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Choose a Restaurant First'), findsOneWidget);
    expect(calls, 0);
  });

  testWidgets('migrated restaurant controls are overflow-free at key widths', (
    tester,
  ) async {
    final service = RatingAdminPagingService(
      functionsBoundary: (_, _) async =>
          page(items: const <Object?>[], pageSize: 50, pageNumber: 1),
    );
    for (final width in <double>[320, 390, 1280]) {
      await tester.pumpWidget(
        host(
          RatingAdminRestaurantPagedView(
            service: service,
            onManageDishes: (_) {},
            onEditRestaurant: (_) async => false,
          ),
          width: width,
          textScale: width == 320 ? 2 : 1.5,
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull, reason: 'width $width');
      expect(
        find.byKey(const ValueKey('rating-admin-search-mode')),
        findsOneWidget,
      );
    }
  });

  testWidgets('pending claims use a 25-record server page', (tester) async {
    final requests = <Map<String, Object?>>[];
    final service = RatingAdminPagingService(
      functionsBoundary: (name, body) async {
        requests.add(body);
        expect(name, 'listRatingAdminQueuePage');
        return <String, Object?>{
          ...page(items: const <Object?>[], pageSize: 25, pageNumber: 1),
          'total': <String, Object?>{'state': 'exact', 'value': 0},
        };
      },
    );
    await tester.pumpWidget(
      host(
        RatingAdminQueuePagedView(
          kind: RatingAdminQueueKind.claims,
          service: service,
          onEditRestaurant: (_) async => false,
          onEditDish: (_) async => false,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(requests.single['pageSize'], 25);
    expect((requests.single['criteria'] as Map)['queueKind'], 'claims');
    expect(find.text('No Pending Claims'), findsOneWidget);
  });
}
