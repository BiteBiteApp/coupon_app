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

Map<String, Object?> preparingRadiusPage({
  required String nextCursor,
  int completedUnits = 1,
  int totalUnits = 2,
}) {
  return <String, Object?>{
    'protocolVersion': pageProtocolVersion,
    'items': const <Object?>[],
    'pageSize': 50,
    'hasNext': true,
    'hasPrevious': false,
    'nextCursor': nextCursor,
    'currentPageNumber': 1,
    'total': <String, Object?>{'state': 'unknown'},
    'queryFingerprint': List<String>.filled(64, '0').join(),
    'snapshotTimestampMs': 1,
    'capabilities': <String, Object?>{
      'first': false,
      'previous': false,
      'numberedVisitedPages': true,
      'next': true,
      'last': false,
    },
    'preparation': <String, Object?>{
      'state': 'preparing',
      'completedUnits': completedUnits,
      'totalUnits': totalUnits,
      'message': 'Preparing complete nearby results…',
    },
  };
}

Map<String, Object?> readyRadiusPage(String id, String name) {
  return <String, Object?>{
    ...page(
      items: <Object?>[restaurant(id, name)],
      pageSize: 50,
      pageNumber: 1,
    ),
    'total': <String, Object?>{'state': 'exact', 'value': 1},
    'preparation': <String, Object?>{
      'state': 'ready',
      'completedUnits': 2,
      'totalUnits': 2,
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

Future<void> startRadiusSearch(
  WidgetTester tester,
  RatingAdminPagingService service, {
  String location = 'Orlando',
}) async {
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
    location,
  );
  await tester.ensureVisible(
    find.byKey(const ValueKey('rating-admin-search-button')),
  );
  await tester.tap(find.byKey(const ValueKey('rating-admin-search-button')));
  await tester.pump();
}

Future<void> pumpThreeSeconds(WidgetTester tester) async {
  for (var cycle = 0; cycle < 4; cycle++) {
    await tester.pump(const Duration(milliseconds: 750));
  }
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

  testWidgets('radius transport failure stops automatic continuation', (
    tester,
  ) async {
    var calls = 0;
    final service = RatingAdminPagingService(
      functionsBoundary: (name, body) async {
        expect(name, 'searchRatingAdminRestaurantsPage');
        calls++;
        if (calls == 1) {
          return preparingRadiusPage(nextCursor: 'preparing-cursor');
        }
        throw const RatingAdminPagingException(
          'The nearby restaurant page could not be loaded.',
        );
      },
    );

    await startRadiusSearch(tester, service);
    expect(calls, 1);
    await tester.pump(const Duration(milliseconds: 750));
    await tester.pump();
    expect(calls, 2);

    await pumpThreeSeconds(tester);

    expect(calls, 2);
    expect(
      find.byKey(const ValueKey('paged-directory-inline-error')),
      findsOneWidget,
    );
    expect(find.text('Retry'), findsOneWidget);
    expect(find.text('No Restaurants'), findsOneWidget);
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('expired radius session stops automatic continuation', (
    tester,
  ) async {
    var calls = 0;
    final service = RatingAdminPagingService(
      functionsBoundary: (_, _) async {
        calls++;
        if (calls == 1) {
          return preparingRadiusPage(nextCursor: 'expiring-cursor');
        }
        throw const RatingAdminPagingException(
          'The nearby restaurant search session is unavailable or expired.',
        );
      },
    );

    await startRadiusSearch(tester, service);
    await tester.pump(const Duration(milliseconds: 750));
    await tester.pump();
    await pumpThreeSeconds(tester);

    expect(calls, 2);
    expect(
      find.byKey(const ValueKey('paged-directory-inline-error')),
      findsOneWidget,
    );
    expect(find.text('Retry'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('rating-admin-result-expired-ready')),
      findsNothing,
    );
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('manual Retry makes one fresh continuation and reaches ready', (
    tester,
  ) async {
    var calls = 0;
    final service = RatingAdminPagingService(
      functionsBoundary: (_, _) async {
        calls++;
        return switch (calls) {
          1 => preparingRadiusPage(nextCursor: 'retry-cursor'),
          2 => throw const RatingAdminPagingException(
            'The nearby restaurant page could not be loaded.',
          ),
          3 => readyRadiusPage('retry-ready', 'Retry Ready'),
          _ => throw StateError('Unexpected extra continuation.'),
        };
      },
    );

    await startRadiusSearch(tester, service);
    await tester.pump(const Duration(milliseconds: 750));
    await tester.pump();
    expect(calls, 2);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    await pumpThreeSeconds(tester);

    expect(calls, 3);
    expect(
      find.byKey(const ValueKey('rating-admin-result-retry-ready')),
      findsOneWidget,
    );
    expect(find.text('Retry Ready'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('paged-directory-inline-error')),
      findsNothing,
    );
  });

  testWidgets('new criteria fence a failed radius preparation loop', (
    tester,
  ) async {
    final requests = <Map<String, Object?>>[];
    final service = RatingAdminPagingService(
      functionsBoundary: (_, body) async {
        requests.add(body);
        final criteria = body['criteria']! as Map;
        if (criteria['locationQuery'] == 'Orlando') {
          if (requests.length == 1) {
            return preparingRadiusPage(nextCursor: 'old-cursor');
          }
          throw const RatingAdminPagingException(
            'The old nearby page could not be loaded.',
          );
        }
        return readyRadiusPage('tampa-ready', 'Tampa Ready');
      },
    );

    await startRadiusSearch(tester, service);
    await tester.pump(const Duration(milliseconds: 750));
    await tester.pump();
    expect(requests.length, 2);

    await tester.enterText(
      find.byKey(const ValueKey('rating-admin-location-field')),
      'Tampa',
    );
    await tester.ensureVisible(
      find.byKey(const ValueKey('rating-admin-search-button')),
    );
    final searchButton = tester.widget<FilledButton>(
      find.byKey(const ValueKey('rating-admin-search-button')),
    );
    expect(searchButton.onPressed, isNotNull);
    searchButton.onPressed!();
    await tester.pumpAndSettle();
    await pumpThreeSeconds(tester);

    expect(requests.length, 3);
    expect(
      requests.where((request) {
        final criteria = request['criteria']! as Map;
        return criteria['locationQuery'] == 'Orlando';
      }).length,
      2,
    );
    expect(
      find.byKey(const ValueKey('rating-admin-result-tampa-ready')),
      findsOneWidget,
    );
    expect(find.text('Tampa Ready'), findsOneWidget);
    expect(
      find.textContaining('Current results: Nearby Radius • Tampa'),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('paged-directory-inline-error')),
      findsNothing,
    );
  });

  testWidgets('successful radius preparation remains sequential and bounded', (
    tester,
  ) async {
    final requests = <Map<String, Object?>>[];
    final service = RatingAdminPagingService(
      functionsBoundary: (_, body) async {
        requests.add(body);
        return switch (requests.length) {
          1 => preparingRadiusPage(nextCursor: 'success-cursor-1'),
          2 => preparingRadiusPage(
            nextCursor: 'success-cursor-2',
            completedUnits: 2,
            totalUnits: 3,
          ),
          3 => readyRadiusPage('success-ready', 'Success Ready'),
          _ => throw StateError('Unexpected extra continuation.'),
        };
      },
    );

    await startRadiusSearch(tester, service);
    await tester.pump(const Duration(milliseconds: 750));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 750));
    await tester.pump();
    await pumpThreeSeconds(tester);

    expect(requests.length, 3);
    expect(requests.map((request) => request['direction']), <Object?>[
      'first',
      'forward',
      'forward',
    ]);
    expect(requests[1]['cursor'], 'success-cursor-1');
    expect(requests[2]['cursor'], 'success-cursor-2');
    expect(
      find.byKey(const ValueKey('rating-admin-result-success-ready')),
      findsOneWidget,
    );
    expect(find.text('Success Ready'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('paged-directory-inline-error')),
      findsNothing,
    );
  });

  testWidgets('disposing the radius view cancels its scheduled continuation', (
    tester,
  ) async {
    var calls = 0;
    final service = RatingAdminPagingService(
      functionsBoundary: (_, _) async {
        calls++;
        return preparingRadiusPage(nextCursor: 'dispose-cursor');
      },
    );

    await startRadiusSearch(tester, service);
    expect(calls, 1);
    await tester.pumpWidget(const SizedBox.shrink());
    await pumpThreeSeconds(tester);

    expect(calls, 1);
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
