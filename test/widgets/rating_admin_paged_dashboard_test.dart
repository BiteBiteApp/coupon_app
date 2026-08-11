import 'dart:async';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/models/rating_admin_paging_models.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/services/rating_admin_paging_service.dart';
import 'package:coupon_app/services/restaurant_invite_service.dart';
import 'package:coupon_app/widgets/rating_admin_paged_dashboard.dart';

Map<String, Object?> restaurant(
  String id,
  String name, {
  bool isClaimed = false,
  String? ownerUserId,
}) {
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
    'isClaimed': isClaimed,
    'ownerUserId': ownerUserId,
    'linkedBiteSaverUid': null,
    'restaurantWriteRevision': 4,
  };
}

Map<String, Object?> nestedBiteScoreRestaurant(
  String id,
  String name, {
  bool isClaimed = false,
  String? ownerUserId,
}) {
  return <String, Object?>{
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
    'ownerUserId': ownerUserId,
    'isClaimed': isClaimed,
    'isActive': true,
    'createdAtMillis': null,
    'updatedAtMillis': null,
    'restaurantWriteRevision': 4,
  };
}

Map<String, Object?> restaurantQueueItem(
  RatingAdminQueueKind kind,
  String restaurantId,
) {
  return <String, Object?>{
    'kind': kind.wireName,
    'id': 'report-${kind.wireName}',
    'reportId': 'report-${kind.wireName}',
    'restaurantId': restaurantId,
    'restaurantName': 'Handoff Restaurant',
    'reportingUserId': 'reporter-1',
    'reason': 'duplicate',
    'status': 'pending',
    'createdAtMillis': null,
    'updatedAtMillis': null,
    'restaurant': nestedBiteScoreRestaurant(restaurantId, 'Handoff Restaurant'),
  };
}

Map<String, Object?> claimedRestaurantItem(String restaurantId) {
  return <String, Object?>{
    'kind': RatingAdminDirectoryKind.claimedRestaurants.wireName,
    'id': restaurantId,
    'restaurant': nestedBiteScoreRestaurant(
      restaurantId,
      'Claimed Handoff Restaurant',
      isClaimed: true,
      ownerUserId: 'owner-1',
    ),
    'approvedClaim': null,
  };
}

BitescoreRestaurant completeRestaurant(
  String id, {
  int revision = 4,
  String profileMarker = 'current',
}) {
  return BitescoreRestaurant(
    id: id,
    name: 'Complete $profileMarker Restaurant',
    normalizedName: 'complete $profileMarker restaurant',
    address: '1 Main St',
    city: 'Orlando',
    state: 'FL',
    zipCode: '32801',
    location: const GeoPoint(28.5, -81.3),
    phone: '407-555-0100',
    website: 'https://example.test',
    bio: 'Distinctive $profileMarker biography',
    businessHours: const <RestaurantBusinessHours>[
      RestaurantBusinessHours(
        day: 'Monday',
        opensAt: '9:00 AM',
        closesAt: '5:00 PM',
        closed: false,
      ),
    ],
    cuisineTags: <String>['Distinctive $profileMarker cuisine'],
    restaurantWriteRevision: revision,
  );
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

Widget host(
  Widget child, {
  double width = 390,
  double height = 900,
  double textScale = 1,
}) {
  return MaterialApp(
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
}

Future<void> startRadiusSearch(
  WidgetTester tester,
  RatingAdminPagingService service, {
  String location = 'Orlando',
  double height = 900,
}) async {
  await tester.pumpWidget(
    host(
      RatingAdminRestaurantPagedView(
        service: service,
        onManageDishes: (_) {},
        onEditRestaurant: (_) async => false,
      ),
      height: height,
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

  testWidgets(
    'Rating results show authoritative IDs and copy only their raw values',
    (tester) async {
      final copied = <String>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
            if (call.method == 'Clipboard.setData') {
              copied.add(
                (call.arguments as Map<Object?, Object?>)['text']! as String,
              );
            }
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(SystemChannels.platform, null),
      );
      final service = RatingAdminPagingService(
        functionsBoundary: (_, _) async => page(
          items: <Object?>[
            restaurant(
              'RESTAURANT_DOC_123',
              'Duplicate Name',
              isClaimed: true,
              ownerUserId: 'OWNER_UID_789',
            ),
            restaurant(
              'UNCLAIMED_DOC_456',
              'Duplicate Name',
              ownerUserId: 'STALE_OWNER_MUST_NOT_RENDER',
            ),
          ],
          pageSize: 50,
          pageNumber: 1,
        ),
      );

      tester.view.physicalSize = const Size(390, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await startRadiusSearch(tester, service);
      await tester.pumpAndSettle();

      expect(find.text('Duplicate Name'), findsOneWidget);
      expect(find.text('Restaurant ID: RESTAURANT_DOC_123'), findsOneWidget);
      expect(find.text('Owner UID: OWNER_UID_789'), findsOneWidget);
      expect(find.textContaining('Revision'), findsNothing);
      expect(find.byTooltip('Copy Restaurant ID'), findsOneWidget);
      expect(find.byTooltip('Copy Owner UID'), findsOneWidget);

      final restaurantCopy = find.byKey(
        const ValueKey('rating-admin-copy-restaurant-id-RESTAURANT_DOC_123'),
      );
      final restaurantCopyButton = tester.widget<IconButton>(restaurantCopy);
      expect(restaurantCopyButton.onPressed, isNotNull);
      expect(tester.getSize(restaurantCopy).width, greaterThanOrEqualTo(48));
      expect(tester.getSize(restaurantCopy).height, greaterThanOrEqualTo(48));
      restaurantCopyButton.onPressed!();
      await tester.pumpAndSettle();
      expect(copied.last, 'RESTAURANT_DOC_123');
      expect(find.text('Restaurant ID copied.'), findsOneWidget);
      tester
          .state<ScaffoldMessengerState>(find.byType(ScaffoldMessenger))
          .clearSnackBars();
      await tester.pumpAndSettle();

      final ownerCopy = find.byKey(
        const ValueKey('rating-admin-copy-owner-uid-RESTAURANT_DOC_123'),
      );
      tester.widget<IconButton>(ownerCopy).onPressed!();
      await tester.pumpAndSettle();
      expect(copied.last, 'OWNER_UID_789');
      expect(find.text('Owner UID copied.'), findsOneWidget);

      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('rating-admin-result-UNCLAIMED_DOC_456')),
        400,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('Duplicate Name'), findsNWidgets(2));
      expect(find.text('Restaurant ID: UNCLAIMED_DOC_456'), findsOneWidget);
      expect(find.textContaining('STALE_OWNER_MUST_NOT_RENDER'), findsNothing);
      expect(
        find.byKey(
          const ValueKey('rating-admin-copy-owner-uid-UNCLAIMED_DOC_456'),
        ),
        findsNothing,
      );
    },
  );

  testWidgets('Rating result actions retain Firestore document identity', (
    tester,
  ) async {
    const documentId = 'RESTAURANT_ACTION_DOC';
    final service = RatingAdminPagingService(
      functionsBoundary: (_, _) async => page(
        items: <Object?>[restaurant(documentId, 'Action Restaurant')],
        pageSize: 50,
        pageNumber: 1,
      ),
    );
    String? loadedId;
    String? editedId;
    String? managedId;
    String? invitedId;
    String? deletedId;

    tester.view.physicalSize = const Size(390, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      host(
        RatingAdminRestaurantPagedView(
          service: service,
          onManageDishes: (record) => managedId = record.documentId,
          loadRestaurant: (id) async {
            loadedId = id;
            return const BitescoreRestaurant(
              id: documentId,
              name: 'Action Restaurant',
              normalizedName: 'action restaurant',
              address: '1 Main St',
              city: 'Orlando',
              state: 'FL',
              zipCode: '32801',
              location: GeoPoint(28.5, -81.3),
              restaurantWriteRevision: 0,
            );
          },
          onEditRestaurant: (restaurant) async {
            editedId = restaurant.id;
            return false;
          },
          createClaimInvite: ({required restaurantId}) async {
            invitedId = restaurantId;
            return const RestaurantInviteCreationResult(
              inviteId: 'invite',
              token: 'token',
              inviteUrl: 'https://example.test/invite',
              expiresAt: null,
            );
          },
          deleteRestaurant: (id) async => deletedId = id,
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

    tester
        .widget<OutlinedButton>(
          find.widgetWithText(OutlinedButton, 'Manage Dishes'),
        )
        .onPressed!();
    expect(managedId, documentId);

    tester
        .widget<OutlinedButton>(find.widgetWithText(OutlinedButton, 'Edit'))
        .onPressed!();
    await tester.pumpAndSettle();
    expect(loadedId, documentId);
    expect(editedId, documentId);

    tester
        .widget<OutlinedButton>(
          find.widgetWithText(OutlinedButton, 'Create Claim Invite'),
        )
        .onPressed!();
    await tester.pumpAndSettle();
    expect(invitedId, documentId);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();

    tester
        .widget<OutlinedButton>(find.widgetWithText(OutlinedButton, 'Delete'))
        .onPressed!();
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle();
    expect(deletedId, documentId);
  });

  testWidgets('migrated restaurant controls are overflow-free at key widths', (
    tester,
  ) async {
    final longId = 'RESTAURANT_${'R' * 80}';
    final service = RatingAdminPagingService(
      functionsBoundary: (_, _) async => page(
        items: <Object?>[
          restaurant(
            longId,
            'Responsive Restaurant',
            isClaimed: true,
            ownerUserId: 'OWNER_${'U' * 80}',
          ),
        ],
        pageSize: 50,
        pageNumber: 1,
      ),
    );
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    for (final width in <double>[320, 390, 1280]) {
      tester.view.physicalSize = Size(width, 1000);
      await tester.pumpWidget(
        host(
          RatingAdminRestaurantPagedView(
            service: service,
            onManageDishes: (_) {},
            onEditRestaurant: (_) async => false,
          ),
          width: width,
          height: 1000,
          textScale: width == 320 ? 2 : 1.5,
        ),
      );
      await tester.enterText(
        find.byKey(const ValueKey('rating-admin-location-field')),
        'Orlando',
      );
      await tester.ensureVisible(
        find.byKey(const ValueKey('rating-admin-search-button')),
      );
      await tester.tap(
        find.byKey(const ValueKey('rating-admin-search-button')),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'width $width');
      expect(
        find.byKey(ValueKey('rating-admin-copy-restaurant-id-$longId')),
        findsOneWidget,
      );
      await tester.ensureVisible(
        find.byKey(ValueKey('rating-admin-copy-restaurant-id-$longId')),
      );
      expect(tester.takeException(), isNull, reason: 'width $width');
      expect(find.text('Manage Dishes'), findsOneWidget);
    }
  });

  testWidgets(
    'reported and duplicate edits rehydrate complete restaurant profiles',
    (tester) async {
      for (final kind in <RatingAdminQueueKind>[
        RatingAdminQueueKind.restaurantReports,
        RatingAdminQueueKind.duplicateRestaurantReports,
      ]) {
        final restaurantId = 'restaurant-${kind.wireName}';
        final fullRestaurant = completeRestaurant(restaurantId);
        final loadedIds = <String>[];
        var pageCalls = 0;
        BitescoreRestaurant? editedRestaurant;
        final service = RatingAdminPagingService(
          functionsBoundary: (name, body) async {
            pageCalls++;
            expect(name, 'listRatingAdminQueuePage');
            expect((body['criteria'] as Map)['queueKind'], kind.wireName);
            return page(
              items: <Object?>[restaurantQueueItem(kind, restaurantId)],
              pageSize: 25,
              pageNumber: 1,
            );
          },
        );

        await tester.pumpWidget(
          host(
            RatingAdminQueuePagedView(
              key: ValueKey('revision-handoff-${kind.wireName}'),
              kind: kind,
              service: service,
              loadRestaurant: (id) async {
                loadedIds.add(id);
                return fullRestaurant;
              },
              onEditRestaurant: (restaurant) async {
                editedRestaurant = restaurant;
                return false;
              },
              onEditDish: (_) async => false,
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.textContaining('Revision'), findsNothing);
        await tester.tap(
          find.widgetWithText(OutlinedButton, 'Edit Restaurant'),
        );
        await tester.pumpAndSettle();

        expect(loadedIds, <String>[restaurantId]);
        expect(pageCalls, 1);
        expect(editedRestaurant, same(fullRestaurant));
        expect(editedRestaurant?.id, restaurantId);
        expect(editedRestaurant?.restaurantWriteRevision, 4);
        expect(editedRestaurant?.bio, 'Distinctive current biography');
        expect(editedRestaurant?.businessHours, hasLength(1));
        expect(editedRestaurant?.businessHours.single.day, 'Monday');
        expect(editedRestaurant?.cuisineTags, <String>[
          'Distinctive current cuisine',
        ]);

        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
      }
    },
  );

  testWidgets('queue edit accepts a fresher complete restaurant revision', (
    tester,
  ) async {
    const restaurantId = 'fresher-revision-restaurant';
    final fullRestaurant = completeRestaurant(
      restaurantId,
      revision: 5,
      profileMarker: 'revision-five',
    );
    BitescoreRestaurant? editedRestaurant;
    final service = RatingAdminPagingService(
      functionsBoundary: (_, _) async => page(
        items: <Object?>[
          restaurantQueueItem(
            RatingAdminQueueKind.restaurantReports,
            restaurantId,
          ),
        ],
        pageSize: 25,
        pageNumber: 1,
      ),
    );

    await tester.pumpWidget(
      host(
        RatingAdminQueuePagedView(
          kind: RatingAdminQueueKind.restaurantReports,
          service: service,
          loadRestaurant: (_) async => fullRestaurant,
          onEditRestaurant: (restaurant) async {
            editedRestaurant = restaurant;
            return false;
          },
          onEditDish: (_) async => false,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(OutlinedButton, 'Edit Restaurant'));
    await tester.pumpAndSettle();

    expect(editedRestaurant, same(fullRestaurant));
    expect(editedRestaurant?.restaurantWriteRevision, 5);
    expect(editedRestaurant?.bio, 'Distinctive revision-five biography');
    expect(editedRestaurant?.cuisineTags, <String>[
      'Distinctive revision-five cuisine',
    ]);
  });

  testWidgets('queue edit fails closed when the restaurant is missing', (
    tester,
  ) async {
    const restaurantId = 'missing-restaurant';
    var loadCalls = 0;
    var editorCalls = 0;
    final service = RatingAdminPagingService(
      functionsBoundary: (_, _) async => page(
        items: <Object?>[
          restaurantQueueItem(
            RatingAdminQueueKind.restaurantReports,
            restaurantId,
          ),
        ],
        pageSize: 25,
        pageNumber: 1,
      ),
    );

    await tester.pumpWidget(
      host(
        RatingAdminQueuePagedView(
          kind: RatingAdminQueueKind.restaurantReports,
          service: service,
          loadRestaurant: (id) async {
            expect(id, restaurantId);
            loadCalls++;
            return null;
          },
          onEditRestaurant: (_) async {
            editorCalls++;
            return false;
          },
          onEditDish: (_) async => false,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(OutlinedButton, 'Edit Restaurant'));
    await tester.pumpAndSettle();

    expect(loadCalls, 1);
    expect(editorCalls, 0);
    expect(
      find.text('This restaurant is no longer available.'),
      findsOneWidget,
    );
    expect(
      find.widgetWithText(OutlinedButton, 'Edit Restaurant'),
      findsOneWidget,
    );
  });

  testWidgets('queue edit fails closed on restaurant identity mismatch', (
    tester,
  ) async {
    const requestedId = 'requested-restaurant';
    final loadedIds = <String>[];
    var editorCalls = 0;
    final service = RatingAdminPagingService(
      functionsBoundary: (_, _) async => page(
        items: <Object?>[
          restaurantQueueItem(
            RatingAdminQueueKind.duplicateRestaurantReports,
            requestedId,
          ),
        ],
        pageSize: 25,
        pageNumber: 1,
      ),
    );

    await tester.pumpWidget(
      host(
        RatingAdminQueuePagedView(
          kind: RatingAdminQueueKind.duplicateRestaurantReports,
          service: service,
          loadRestaurant: (id) async {
            loadedIds.add(id);
            return completeRestaurant('different-restaurant');
          },
          onEditRestaurant: (_) async {
            editorCalls++;
            return false;
          },
          onEditDish: (_) async => false,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(OutlinedButton, 'Edit Restaurant'));
    await tester.pumpAndSettle();

    expect(loadedIds, <String>[requestedId]);
    expect(editorCalls, 0);
    expect(
      find.text('This restaurant is no longer available.'),
      findsOneWidget,
    );
  });

  testWidgets('queue edit does nothing when disposed during the exact load', (
    tester,
  ) async {
    const restaurantId = 'disposed-restaurant';
    final loadCompleter = Completer<BitescoreRestaurant?>();
    var loadCalls = 0;
    var editorCalls = 0;
    final service = RatingAdminPagingService(
      functionsBoundary: (_, _) async => page(
        items: <Object?>[
          restaurantQueueItem(
            RatingAdminQueueKind.restaurantReports,
            restaurantId,
          ),
        ],
        pageSize: 25,
        pageNumber: 1,
      ),
    );

    await tester.pumpWidget(
      host(
        RatingAdminQueuePagedView(
          kind: RatingAdminQueueKind.restaurantReports,
          service: service,
          loadRestaurant: (_) {
            loadCalls++;
            return loadCompleter.future;
          },
          onEditRestaurant: (_) async {
            editorCalls++;
            return false;
          },
          onEditDish: (_) async => false,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(OutlinedButton, 'Edit Restaurant'));
    await tester.pump();
    expect(loadCalls, 1);

    await tester.pumpWidget(const SizedBox.shrink());
    loadCompleter.complete(completeRestaurant(restaurantId));
    await tester.pumpAndSettle();

    expect(editorCalls, 0);
    expect(find.byType(SnackBar), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('queue edit suppresses duplicate taps during the exact load', (
    tester,
  ) async {
    const restaurantId = 'duplicate-tap-restaurant';
    final loadCompleter = Completer<BitescoreRestaurant?>();
    var loadCalls = 0;
    var editorCalls = 0;
    final service = RatingAdminPagingService(
      functionsBoundary: (_, _) async => page(
        items: <Object?>[
          restaurantQueueItem(
            RatingAdminQueueKind.restaurantReports,
            restaurantId,
          ),
        ],
        pageSize: 25,
        pageNumber: 1,
      ),
    );

    await tester.pumpWidget(
      host(
        RatingAdminQueuePagedView(
          kind: RatingAdminQueueKind.restaurantReports,
          service: service,
          loadRestaurant: (_) {
            loadCalls++;
            return loadCompleter.future;
          },
          onEditRestaurant: (_) async {
            editorCalls++;
            return false;
          },
          onEditDish: (_) async => false,
        ),
      ),
    );
    await tester.pumpAndSettle();

    final editButton = find.widgetWithText(OutlinedButton, 'Edit Restaurant');
    await tester.tap(editButton);
    await tester.tap(editButton);
    await tester.pump();
    expect(loadCalls, 1);

    loadCompleter.complete(completeRestaurant(restaurantId));
    await tester.pumpAndSettle();

    expect(loadCalls, 1);
    expect(editorCalls, 1);
  });

  testWidgets(
    'claimed page preserves revision on the restaurant used by unclaim',
    (tester) async {
      const restaurantId = 'claimed-revision-restaurant';
      BitescoreRestaurant? viewedRestaurant;
      final service = RatingAdminPagingService(
        functionsBoundary: (name, body) async {
          expect(name, 'listRatingAdminDirectoryPage');
          expect(
            (body['criteria'] as Map)['directoryKind'],
            RatingAdminDirectoryKind.claimedRestaurants.wireName,
          );
          return page(
            items: <Object?>[claimedRestaurantItem(restaurantId)],
            pageSize: 50,
            pageNumber: 1,
          );
        },
      );

      await tester.pumpWidget(
        host(
          RatingAdminClaimedRestaurantsPagedView(
            service: service,
            onViewRestaurant: (restaurant) async {
              viewedRestaurant = restaurant;
            },
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('Revision'), findsNothing);
      expect(find.byTooltip('Remove owner'), findsOneWidget);
      await tester.tap(find.byTooltip('View restaurant'));
      await tester.pump();
      expect(viewedRestaurant?.id, restaurantId);
      expect(viewedRestaurant?.restaurantWriteRevision, 4);

      final source = File(
        'lib/widgets/rating_admin_paged_dashboard.dart',
      ).readAsStringSync();
      expect(
        source,
        contains(
          'BiteScoreService.unclaimRestaurantAsAdmin(record.restaurant)',
        ),
      );
    },
  );

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
