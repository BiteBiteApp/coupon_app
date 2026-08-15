import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/models/coupon_admin_paging_models.dart';
import 'package:coupon_app/screens/admin_review_screen.dart';
import 'package:coupon_app/services/coupon_admin_paging_service.dart';
import 'package:coupon_app/services/restaurant_account_service.dart';
import 'package:coupon_app/services/restaurant_invite_service.dart';

Map<String, Object?> _page(
  List<Map<String, Object?>> items, {
  int pageSize = 50,
  int currentPage = 1,
  int? exactTotal,
  bool hasNext = false,
  bool hasPrevious = false,
  String? nextCursor,
  String? previousCursor,
  Map<String, Object?>? preparation,
}) => <String, Object?>{
  'protocolVersion': pageProtocolVersion,
  'items': items,
  'pageSize': pageSize,
  'hasNext': hasNext,
  'hasPrevious': hasPrevious,
  'nextCursor': ?nextCursor,
  'previousCursor': ?previousCursor,
  'currentPageNumber': currentPage,
  'total': exactTotal == null
      ? const <String, Object?>{'state': 'unknown'}
      : <String, Object?>{'state': 'exact', 'value': exactTotal},
  'queryFingerprint': 'b' * 64,
  'snapshotTimestampMs': 1786200000000,
  'capabilities': <String, Object?>{
    'first': currentPage > 1,
    'previous': hasPrevious,
    'numberedVisitedPages': true,
    'next': hasNext,
    'last': false,
  },
  'preparation': ?preparation,
};

Map<String, Object?> _restaurant(
  String id, {
  String? name,
  String? actionId,
  String? uid,
  bool adminHidden = false,
}) => <String, Object?>{
  'source': 'biteSaver',
  'documentId': id,
  'actionId': actionId ?? uid ?? 'uid-$id',
  'restaurantName': name ?? 'Restaurant $id',
  'streetAddress': '1 Main Street',
  'city': 'Inverness',
  'state': 'FL',
  'zipCode': '34450',
  'phone': '5550100',
  'website': 'https://example.test',
  'latitude': 28.85,
  'longitude': -82.49,
  'distanceMiles': null,
  'approvalStatus': 'approved',
  'couponApplicationSubmitted': true,
  'adminHidden': adminHidden,
  'uid': uid ?? 'uid-$id',
  'linkedBiteScoreRestaurantId': null,
};

Map<String, Object?> _pending(String id) => <String, Object?>{
  'id': id,
  'kind': 'pendingApplications',
  'restaurantName': 'Pending $id',
  'uid': 'uid-$id',
  'email': 'admin@example.test',
  'phone': '5550100',
  'applicantPhone': '5550101',
  'streetAddress': '2 Queue Way',
  'city': 'Inverness',
  'state': 'FL',
  'zipCode': '34450',
  'website': 'https://example.test',
  'latitude': 28.85,
  'longitude': -82.49,
  'approvalStatus': 'pending',
  'couponApplicationSubmitted': true,
  'profileVersion': 2,
  'createdAtMillis': 1,
  'updatedAtMillis': 2,
};

Map<String, Object?> _nameChange(String id) => <String, Object?>{
  'id': id,
  'kind': 'nameChanges',
  'userId': 'uid-$id',
  'currentRestaurantName': 'Old Name',
  'requestedRestaurantName': 'New Name',
  'status': 'pending',
  'createdAtMillis': 1,
};

Map<String, Object?> _report(String id) => <String, Object?>{
  'id': id,
  'kind': 'openReports',
  'reportType': 'Coupon report',
  'restaurantName': 'Restaurant',
  'couponTitle': 'Coupon',
  'restaurantId': 'restaurant-one',
  'couponId': 'coupon-one',
  'reason': 'Incorrect details',
  'note': 'Please review',
  'reporterUid': 'reporter',
  'status': 'open',
  'createdAtMillis': 1,
};

Map<String, Object?> _coupon(String id, String title) => <String, Object?>{
  'id': id,
  'title': title,
  'restaurant': 'Restaurant',
  'expires': 'Soon',
  'startTimeMillis': null,
  'endTimeMillis': null,
  'usageRule': 'Once per customer',
  'couponNumber': '001',
  'isProximityOnly': false,
  'proximityRadiusMiles': null,
  'details': null,
  'imageUrl': null,
  'createdAtMillis': 1,
  'updatedAtMillis': 2,
};

Map<String, Object?> _invite(String id) => <String, Object?>{
  'id': id,
  'type': 'coupon_invite',
  'side': 'coupon',
  'status': 'revoked',
  'restaurantId': 'restaurant-one',
  'pendingRestaurantKey': '',
  'restaurantName': 'Invite Restaurant',
  'createdByEmail': 'admin@example.test',
  'createdAtMillis': 1,
  'expiresAtMillis': 2,
  'usedAtMillis': null,
  'revokedAtMillis': 2,
  'maxUses': 1,
  'useCount': 0,
};

class _Backend {
  final List<(String, Map<String, Object?>)> calls =
      <(String, Map<String, Object?>)>[];
  Future<Object?> Function(String, Map<String, Object?>)? custom;

  Future<Object?> call(String name, Map<String, Object?> request) async {
    calls.add((name, Map<String, Object?>.from(request)));
    if (custom != null) return custom!(name, request);
    if (name == 'listCouponAdminQueuePage') {
      final criteria = request['criteria']! as Map;
      return switch (criteria['queueKind']) {
        'pendingApplications' => _page(
          <Map<String, Object?>>[_pending('one')],
          pageSize: 25,
          exactTotal: 1,
        ),
        'nameChanges' => _page(
          <Map<String, Object?>>[_nameChange('one')],
          pageSize: 25,
          exactTotal: 1,
        ),
        _ => _page(
          <Map<String, Object?>>[_report('one')],
          pageSize: 25,
          exactTotal: 1,
        ),
      };
    }
    if (name == 'listCouponAdminCouponsPage') {
      return _page(
        <Map<String, Object?>>[_coupon('one', 'Coupon One')],
        pageSize: 25,
        exactTotal: 1,
      );
    }
    if (name == 'listCouponAdminInviteHistoryPage') {
      return _page(<Map<String, Object?>>[_invite('one')], exactTotal: 1);
    }
    return _page(<Map<String, Object?>>[_restaurant('one')], exactTotal: 1);
  }
}

Future<void> _pumpScreen(
  WidgetTester tester,
  _Backend backend, {
  Size size = const Size(1000, 900),
  double textScale = 1,
  AdminCouponSetVisibilityAction? setRestaurantVisibility,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(
          size: size,
          textScaler: TextScaler.linear(textScale),
        ),
        child: Scaffold(
          body: AdminReviewScreen(
            pagingService: CouponAdminPagingService(
              functionsBoundary: backend.call,
            ),
            setRestaurantVisibility: setRestaurantVisibility,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _selectExactZipAndSearch(
  WidgetTester tester, {
  String zip = '34450',
}) async {
  final selector = tester
      .widget<SegmentedButton<CouponAdminRestaurantSearchMode>>(
        find.byKey(const ValueKey('coupon-admin-search-mode')),
      );
  selector.onSelectionChanged!(<CouponAdminRestaurantSearchMode>{
    CouponAdminRestaurantSearchMode.exactZip,
  });
  await tester.pump();
  await tester.enterText(
    find.byKey(const ValueKey('coupon-admin-location-field')),
    zip,
  );
  tester
      .widget<FilledButton>(
        find.byKey(const ValueKey('coupon-admin-search-button')),
      )
      .onPressed!();
  await tester.pumpAndSettle();
}

Future<void> _tapCoupons(WidgetTester tester) async {
  final finder = find.text('Coupons');
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('four Coupon Admin tabs render without any eager queue read', (
    tester,
  ) async {
    final backend = _Backend();
    await _pumpScreen(tester, backend);
    expect(find.text('Restaurants'), findsOneWidget);
    expect(find.text('Pending Applications'), findsOneWidget);
    expect(find.text('Name Changes'), findsOneWidget);
    expect(find.text('Reports'), findsOneWidget);
    expect(backend.calls, isEmpty);
  });

  testWidgets(
    'restaurant and coupon reads use only the paged callable boundary',
    (tester) async {
      final backend = _Backend();
      await _pumpScreen(tester, backend);
      await _selectExactZipAndSearch(tester);
      await _tapCoupons(tester);
      expect(
        backend.calls.map((call) => call.$1),
        containsAll(<String>[
          'searchCouponAdminRestaurantsPage',
          'listCouponAdminCouponsPage',
        ]),
      );
    },
  );

  testWidgets('Pending Applications lazily requests page one and exact count', (
    tester,
  ) async {
    final backend = _Backend();
    await _pumpScreen(tester, backend);
    await tester.tap(find.text('Pending Applications'));
    await tester.pumpAndSettle();
    expect(find.text('Pending one'), findsOneWidget);
    final call = backend.calls.single;
    expect(call.$1, 'listCouponAdminQueuePage');
    expect((call.$2['criteria']! as Map)['queueKind'], 'pendingApplications');
    expect(call.$2['pageSize'], 25);
    expect(find.textContaining('1 result • Page 1 of 1'), findsOneWidget);
    expect(find.text('Approve'), findsOneWidget);
    expect(find.text('Reject'), findsOneWidget);
    expect(find.text('Edit Restaurant'), findsOneWidget);
    expect(find.text('Create Invite'), findsOneWidget);
    expect(find.text('Delete Restaurant'), findsNothing);
    expect(
      find.text(
        'Delete this restaurant account and all of its coupons from BiteSaver?',
      ),
      findsNothing,
    );
  });

  testWidgets('Name Changes lazily uses its exact queue kind', (tester) async {
    final backend = _Backend();
    await _pumpScreen(tester, backend);
    await tester.tap(find.text('Name Changes'));
    await tester.pumpAndSettle();
    expect(find.text('Requested: New Name'), findsOneWidget);
    expect(
      (backend.calls.single.$2['criteria']! as Map)['queueKind'],
      'nameChanges',
    );
  });

  testWidgets('Reports lazily uses openReports and preserves details', (
    tester,
  ) async {
    final backend = _Backend();
    await _pumpScreen(tester, backend);
    await tester.tap(find.text('Reports'));
    await tester.pumpAndSettle();
    expect(find.text('Reason: Incorrect details'), findsOneWidget);
    expect(
      (backend.calls.single.$2['criteria']! as Map)['queueKind'],
      'openReports',
    );
  });

  testWidgets('search mode selector shows radius only for Nearby Radius', (
    tester,
  ) async {
    await _pumpScreen(tester, _Backend());
    expect(
      find.byKey(const ValueKey('coupon-admin-radius-field')),
      findsOneWidget,
    );
    await tester.tap(find.text('Exact ZIP'));
    await tester.pump();
    expect(
      find.byKey(const ValueKey('coupon-admin-radius-field')),
      findsNothing,
    );
    await tester.tap(find.text('Exact City'));
    await tester.pump();
    expect(find.text('City, ST'), findsOneWidget);
  });

  testWidgets('exact ZIP submits normalized server-page criteria', (
    tester,
  ) async {
    final backend = _Backend();
    await _pumpScreen(tester, backend);
    await _selectExactZipAndSearch(tester, zip: '01234-9999');
    final criteria = backend.calls.single.$2['criteria']! as Map;
    expect(criteria, <String, Object?>{'mode': 'exactZip', 'zipCode': '01234'});
    expect(find.text('Restaurant one'), findsOneWidget);
    expect(
      find.textContaining('Current search: Exact ZIP: 01234'),
      findsOneWidget,
    );
  });

  testWidgets('exact City rejects bare city without a call', (tester) async {
    final backend = _Backend();
    await _pumpScreen(tester, backend);
    await tester.tap(find.text('Exact City'));
    await tester.pump();
    await tester.enterText(
      find.byKey(const ValueKey('coupon-admin-location-field')),
      'Inverness',
    );
    await tester.tap(find.byKey(const ValueKey('coupon-admin-search-button')));
    await tester.pump();
    expect(find.text('Enter City, ST.'), findsOneWidget);
    expect(backend.calls, isEmpty);
  });

  testWidgets('nearby request includes location, radius, and optional name', (
    tester,
  ) async {
    final backend = _Backend();
    await _pumpScreen(tester, backend);
    await tester.enterText(
      find.byKey(const ValueKey('coupon-admin-location-field')),
      'Crystal River, FL',
    );
    await tester.enterText(
      find.byKey(const ValueKey('coupon-admin-restaurant-name-field')),
      'sub',
    );
    await tester.tap(find.byKey(const ValueKey('coupon-admin-search-button')));
    await tester.pumpAndSettle();
    expect(backend.calls.single.$2['criteria'], <String, Object?>{
      'mode': 'nearbyRadius',
      'locationQuery': 'Crystal River, FL',
      'radiusMiles': 10,
      'restaurantName': 'sub',
      'searchInstanceId': 1,
    });
  });

  testWidgets('refreshing nearby results creates a fresh bounded session', (
    tester,
  ) async {
    final backend = _Backend();
    await _pumpScreen(tester, backend);
    await tester.enterText(
      find.byKey(const ValueKey('coupon-admin-location-field')),
      'Crystal River, FL',
    );
    await tester.tap(find.byKey(const ValueKey('coupon-admin-search-button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('paged-directory-refresh')));
    await tester.pumpAndSettle();
    expect(backend.calls, hasLength(2));
    final first = backend.calls.first.$2['criteria']! as Map;
    final refreshed = backend.calls.last.$2['criteria']! as Map;
    expect(first['locationQuery'], 'Crystal River, FL');
    expect(refreshed['locationQuery'], 'Crystal River, FL');
    expect(first['searchInstanceId'], 1);
    expect(refreshed['searchInstanceId'], 2);
  });

  testWidgets(
    'refresh labels active criteria instead of an unsubmitted draft',
    (tester) async {
      final backend = _Backend();
      await _pumpScreen(tester, backend);
      await tester.enterText(
        find.byKey(const ValueKey('coupon-admin-location-field')),
        'Crystal River, FL',
      );
      await tester.tap(
        find.byKey(const ValueKey('coupon-admin-search-button')),
      );
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Current search: Nearby Radius: Crystal River, FL'),
        findsOneWidget,
      );

      await tester.tap(find.text('Exact ZIP'));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('paged-directory-refresh')));
      await tester.pumpAndSettle();

      expect(backend.calls, hasLength(2));
      expect(backend.calls.last.$2['criteria'], <String, Object?>{
        'mode': 'nearbyRadius',
        'locationQuery': 'Crystal River, FL',
        'radiusMiles': 10,
        'searchInstanceId': 2,
      });
      expect(
        find.textContaining('Current search: Nearby Radius: Crystal River, FL'),
        findsOneWidget,
      );
      expect(find.textContaining('Current search: Exact ZIP'), findsNothing);

      await tester.enterText(
        find.byKey(const ValueKey('coupon-admin-location-field')),
        '01234',
      );
      await tester.tap(
        find.byKey(const ValueKey('coupon-admin-search-button')),
      );
      await tester.pumpAndSettle();
      expect(backend.calls, hasLength(3));
      expect(backend.calls.last.$2['criteria'], <String, Object?>{
        'mode': 'exactZip',
        'zipCode': '01234',
      });
      expect(
        find.textContaining('Current search: Exact ZIP: 01234'),
        findsOneWidget,
      );
    },
  );

  testWidgets('Next replaces the restaurant page instead of appending', (
    tester,
  ) async {
    final backend = _Backend();
    backend.custom = (name, request) async {
      if (request['direction'] == 'first') {
        return _page(
          <Map<String, Object?>>[_restaurant('first', name: 'First Page')],
          exactTotal: 51,
          hasNext: true,
          nextCursor: 'next-one',
        );
      }
      return _page(
        <Map<String, Object?>>[_restaurant('second', name: 'Second Page')],
        currentPage: 2,
        exactTotal: 51,
        hasPrevious: true,
        previousCursor: 'previous-two',
      );
    };
    await _pumpScreen(tester, backend);
    await _selectExactZipAndSearch(tester);
    expect(find.text('First Page'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('pagination-next')));
    await tester.pumpAndSettle();
    expect(find.text('First Page'), findsNothing);
    expect(find.text('Second Page'), findsOneWidget);
  });

  testWidgets('Previous uses the opaque cursor and restores page one', (
    tester,
  ) async {
    final backend = _Backend();
    backend.custom = (name, request) async {
      final direction = request['direction'];
      if (direction == 'forward') {
        return _page(
          <Map<String, Object?>>[_restaurant('second', name: 'Second Page')],
          currentPage: 2,
          exactTotal: 51,
          hasPrevious: true,
          previousCursor: 'previous-two',
        );
      }
      return _page(
        <Map<String, Object?>>[_restaurant('first', name: 'First Page')],
        exactTotal: 51,
        hasNext: true,
        nextCursor: 'next-one',
      );
    };
    await _pumpScreen(tester, backend);
    await _selectExactZipAndSearch(tester);
    await tester.tap(find.byKey(const ValueKey('pagination-next')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('pagination-previous')));
    await tester.pumpAndSettle();
    expect(find.text('First Page'), findsOneWidget);
  });

  testWidgets('unknown total never fakes Page X of Y', (tester) async {
    final backend = _Backend();
    backend.custom = (name, request) async => _page(
      <Map<String, Object?>>[_restaurant('one')],
      hasNext: true,
      nextCursor: 'opaque',
    );
    await _pumpScreen(tester, backend);
    await _selectExactZipAndSearch(tester);
    expect(
      find.textContaining('Total unknown • Page 1 • 50 per page'),
      findsOneWidget,
    );
    expect(find.textContaining('Page 1 of'), findsNothing);
  });

  testWidgets(
    'radius preparation continues with a delay and shows only ready results',
    (tester) async {
      final backend = _Backend();
      var calls = 0;
      backend.custom = (name, request) async {
        calls += 1;
        if (calls == 1) {
          return _page(
            const <Map<String, Object?>>[],
            hasNext: true,
            nextCursor: 'preparation-cursor',
            preparation: const <String, Object?>{
              'state': 'preparing',
              'completedUnits': 4,
              'totalUnits': 9,
              'message': 'Preparing complete nearby results…',
            },
          );
        }
        return _page(
          <Map<String, Object?>>[
            _restaurant('ready', name: 'Ready Restaurant'),
          ],
          exactTotal: 1,
          preparation: const <String, Object?>{
            'state': 'ready',
            'completedUnits': 9,
            'totalUnits': 9,
          },
        );
      };
      await _pumpScreen(tester, backend);
      await tester.enterText(
        find.byKey(const ValueKey('coupon-admin-location-field')),
        'Center',
      );
      await tester.tap(
        find.byKey(const ValueKey('coupon-admin-search-button')),
      );
      await tester.pump();
      expect(
        find.byKey(const ValueKey('coupon-admin-radius-preparing')),
        findsOneWidget,
      );
      expect(find.text('Ready Restaurant'), findsNothing);
      await tester.pump(const Duration(milliseconds: 360));
      await tester.pumpAndSettle();
      expect(calls, 2);
      expect(find.text('Ready Restaurant'), findsOneWidget);
    },
  );

  testWidgets('a stale response cannot replace newer search criteria', (
    tester,
  ) async {
    final backend = _Backend();
    final first = Completer<Object?>();
    backend.custom = (name, request) {
      final zip = (request['criteria']! as Map)['zipCode'];
      if (zip == '11111') return first.future;
      return Future<Object?>.value(
        _page(<Map<String, Object?>>[
          _restaurant('new', name: 'New Search'),
        ], exactTotal: 1),
      );
    };
    await _pumpScreen(tester, backend);
    await tester.tap(find.text('Exact ZIP'));
    await tester.pump();
    final field = find.byKey(const ValueKey('coupon-admin-location-field'));
    await tester.enterText(field, '11111');
    await tester.tap(find.byKey(const ValueKey('coupon-admin-search-button')));
    await tester.pump();
    await tester.enterText(field, '22222');
    await tester.tap(find.byKey(const ValueKey('coupon-admin-search-button')));
    await tester.pumpAndSettle();
    expect(find.text('New Search'), findsOneWidget);
    first.complete(
      _page(<Map<String, Object?>>[
        _restaurant('old', name: 'Old Search'),
      ], exactTotal: 1),
    );
    await tester.pumpAndSettle();
    expect(find.text('New Search'), findsOneWidget);
    expect(find.text('Old Search'), findsNothing);
  });

  testWidgets('duplicate Search taps for identical criteria are suppressed', (
    tester,
  ) async {
    final backend = _Backend();
    final completion = Completer<Object?>();
    backend.custom = (name, request) => completion.future;
    await _pumpScreen(tester, backend);
    await tester.tap(find.text('Exact ZIP'));
    await tester.pump();
    await tester.enterText(
      find.byKey(const ValueKey('coupon-admin-location-field')),
      '34450',
    );
    final button = find.byKey(const ValueKey('coupon-admin-search-button'));
    await tester.tap(button);
    await tester.tap(button);
    await tester.pump();
    expect(backend.calls.length, 1);
    completion.complete(
      _page(<Map<String, Object?>>[_restaurant('one')], exactTotal: 1),
    );
    await tester.pumpAndSettle();
  });

  testWidgets('restaurant error offers Retry without changing criteria', (
    tester,
  ) async {
    final backend = _Backend();
    var calls = 0;
    backend.custom = (name, request) async {
      calls += 1;
      if (calls == 1) throw StateError('offline');
      return _page(<Map<String, Object?>>[
        _restaurant('retry', name: 'Retry Result'),
      ], exactTotal: 1);
    };
    await _pumpScreen(tester, backend);
    await _selectExactZipAndSearch(tester);
    expect(find.text('Retry'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('Retry Result'), findsOneWidget);
  });

  testWidgets('coupon expansion is lazy and scoped to its restaurant', (
    tester,
  ) async {
    final backend = _Backend();
    await _pumpScreen(tester, backend);
    await _selectExactZipAndSearch(tester);
    expect(
      backend.calls.where((call) => call.$1 == 'listCouponAdminCouponsPage'),
      isEmpty,
    );
    await _tapCoupons(tester);
    final couponCall = backend.calls.singleWhere(
      (call) => call.$1 == 'listCouponAdminCouponsPage',
    );
    expect((couponCall.$2['criteria']! as Map)['restaurantAccountId'], 'one');
    expect(find.text('Coupon One'), findsOneWidget);
  });

  testWidgets('coupon Next replaces the current 25-item page', (tester) async {
    final backend = _Backend();
    backend.custom = (name, request) async {
      if (name == 'searchCouponAdminRestaurantsPage') {
        return _page(<Map<String, Object?>>[_restaurant('one')], exactTotal: 1);
      }
      if (name == 'listCouponAdminCouponsPage' &&
          request['direction'] == 'first') {
        return _page(
          <Map<String, Object?>>[_coupon('first', 'First Coupon')],
          pageSize: 25,
          exactTotal: 26,
          hasNext: true,
          nextCursor: 'coupon-next',
        );
      }
      return _page(
        <Map<String, Object?>>[_coupon('second', 'Second Coupon')],
        pageSize: 25,
        currentPage: 2,
        exactTotal: 26,
        hasPrevious: true,
        previousCursor: 'coupon-previous',
      );
    };
    await _pumpScreen(tester, backend);
    await _selectExactZipAndSearch(tester);
    await _tapCoupons(tester);
    final next = find.byKey(const ValueKey('pagination-next'));
    await tester.ensureVisible(next);
    await tester.pumpAndSettle();
    await tester.tap(next);
    await tester.pumpAndSettle();
    expect(find.text('First Coupon'), findsNothing);
    expect(find.text('Second Coupon'), findsOneWidget);
  });

  testWidgets(
    'collapsing disposes coupon page state and expanding reloads page one',
    (tester) async {
      final backend = _Backend();
      await _pumpScreen(tester, backend);
      await _selectExactZipAndSearch(tester);
      await _tapCoupons(tester);
      await _tapCoupons(tester);
      await _tapCoupons(tester);
      expect(
        backend.calls
            .where((call) => call.$1 == 'listCouponAdminCouponsPage')
            .length,
        2,
      );
    },
  );

  testWidgets('Coupon invite manager uses paged Coupon-side history', (
    tester,
  ) async {
    final backend = _Backend();
    await _pumpScreen(tester, backend);
    await tester.tap(find.text('Pending Applications'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('coupon-admin-manage-invites')));
    await tester.pumpAndSettle();
    expect(find.text('Invite Restaurant'), findsOneWidget);
    final call = backend.calls.singleWhere(
      (call) => call.$1 == 'listCouponAdminInviteHistoryPage',
    );
    expect(call.$2['pageSize'], 50);
    expect(call.$2['criteria'], <String, Object?>{'side': 'coupon'});
  });

  testWidgets('local Show 25 More is absent from Coupon Admin', (tester) async {
    await _pumpScreen(tester, _Backend());
    expect(find.text('Show 25 More'), findsNothing);
    expect(
      find.byKey(const ValueKey('coupon-admin-show-more-button')),
      findsNothing,
    );
  });

  testWidgets(
    'Coupon results keep account and owner identity distinct and copy raw IDs',
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

      final backend = _Backend()
        ..custom = (name, request) async => _page(<Map<String, Object?>>[
          _restaurant(
            'ACCOUNT_DOC_123',
            name: 'Duplicate Name',
            actionId: 'OWNER_UID_456',
            uid: 'OWNER_UID_456',
          ),
          _restaurant(
            'EQUAL_ID_001',
            name: 'Duplicate Name',
            actionId: 'EQUAL_ID_001',
            uid: 'EQUAL_ID_001',
          ),
          <String, Object?>{
            ..._restaurant('ACCOUNT_WITHOUT_OWNER', name: 'Unowned Account'),
            'actionId': 'ACCOUNT_WITHOUT_OWNER',
            'uid': null,
          },
        ], exactTotal: 3);

      await _pumpScreen(tester, backend);
      await _selectExactZipAndSearch(tester);

      expect(find.text('Duplicate Name'), findsOneWidget);
      expect(find.text('Account ID: ACCOUNT_DOC_123'), findsOneWidget);
      expect(find.text('Owner UID: OWNER_UID_456'), findsOneWidget);
      expect(find.byTooltip('Copy Account ID'), findsOneWidget);
      expect(find.byTooltip('Copy Owner UID'), findsOneWidget);

      await tester.tap(
        find.byKey(
          const ValueKey('coupon-admin-copy-account-id-ACCOUNT_DOC_123'),
        ),
      );
      await tester.pump();
      expect(copied.last, 'ACCOUNT_DOC_123');
      expect(find.text('Account ID copied.'), findsOneWidget);
      tester
          .state<ScaffoldMessengerState>(find.byType(ScaffoldMessenger))
          .clearSnackBars();
      await tester.pumpAndSettle();

      await tester.tap(
        find.byKey(
          const ValueKey('coupon-admin-copy-owner-uid-ACCOUNT_DOC_123'),
        ),
      );
      await tester.pump();
      expect(copied.last, 'OWNER_UID_456');
      expect(find.text('Owner UID copied.'), findsOneWidget);

      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('biteSaver:EQUAL_ID_001')),
        400,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('Duplicate Name'), findsNWidgets(2));
      expect(find.text('Account ID: EQUAL_ID_001'), findsOneWidget);
      expect(find.text('Owner UID: EQUAL_ID_001'), findsOneWidget);

      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('biteSaver:ACCOUNT_WITHOUT_OWNER')),
        400,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('Owner UID: Not available'), findsOneWidget);
      expect(
        find.byKey(
          const ValueKey('coupon-admin-copy-owner-uid-ACCOUNT_WITHOUT_OWNER'),
        ),
        findsNothing,
      );
    },
  );

  testWidgets('Coupon result actions preserve identity and omit root deletion', (
    tester,
  ) async {
    final backend = _Backend()
      ..custom = (name, request) async => _page(<Map<String, Object?>>[
        _restaurant(
          'ACCOUNT_DOC_ACTION',
          actionId: 'OWNER_UID_ACTION',
          uid: 'OWNER_UID_ACTION',
        ),
      ], exactTotal: 1);
    String? loadedId;
    String? editedId;
    String? invitedId;

    tester.view.physicalSize = const Size(1000, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AdminReviewScreen(
            pagingService: CouponAdminPagingService(
              functionsBoundary: backend.call,
            ),
            loadAccount: (documentId) async {
              loadedId = documentId;
              return <String, dynamic>{'restaurantName': 'Action Restaurant'};
            },
            editAccount:
                ({required context, required documentId, required data}) async {
                  editedId = documentId;
                  return false;
                },
            createCouponInvite:
                ({
                  required restaurantId,
                  required restaurantName,
                  required streetAddress,
                  required city,
                  required state,
                  required zipCode,
                  required phone,
                  required website,
                  required latitude,
                  required longitude,
                }) async {
                  invitedId = restaurantId;
                  return const RestaurantInviteCreationResult(
                    inviteId: 'invite',
                    token: 'token',
                    inviteUrl: 'https://example.test/invite',
                    expiresAt: null,
                  );
                },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await _selectExactZipAndSearch(tester);

    await tester.ensureVisible(find.text('Edit Restaurant'));
    await tester.tap(find.text('Edit Restaurant'));
    await tester.pumpAndSettle();
    expect(loadedId, 'ACCOUNT_DOC_ACTION');
    expect(editedId, 'ACCOUNT_DOC_ACTION');

    await tester.ensureVisible(find.text('Create Invite'));
    await tester.tap(find.text('Create Invite'));
    await tester.pumpAndSettle();
    expect(invitedId, 'OWNER_UID_ACTION');
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();

    expect(find.text('Approve'), findsOneWidget);
    expect(find.text('Reject'), findsOneWidget);
    expect(find.text('Edit Restaurant'), findsOneWidget);
    expect(find.text('Create Invite'), findsOneWidget);
    expect(find.text('Delete Restaurant'), findsNothing);
    expect(
      find.text(
        'Delete this restaurant account and all of its coupons from BiteSaver?',
      ),
      findsNothing,
    );
  });

  testWidgets(
    'visible restaurant confirms narrow Hide while preserving data and billing',
    (tester) async {
      final calls = <(String, bool, bool)>[];
      final backend = _Backend();
      await _pumpScreen(
        tester,
        backend,
        setRestaurantVisibility:
            ({
              required documentId,
              required expectedAdminHidden,
              required adminHidden,
            }) async {
              calls.add((documentId, expectedAdminHidden, adminHidden));
            },
      );
      await _selectExactZipAndSearch(tester);

      expect(find.text('Hide from BiteSaver'), findsOneWidget);
      expect(find.text('Restore to BiteSaver'), findsNothing);
      expect(find.text('Hidden'), findsNothing);

      await tester.tap(find.text('Hide from BiteSaver'));
      await tester.pumpAndSettle();
      expect(
        find.text('Hide “Restaurant one” from BiteSaver?'),
        findsOneWidget,
      );
      expect(
        find.textContaining('coupon, daily-special, owner, and billing data'),
        findsOneWidget,
      );
      expect(
        find.textContaining(
          "does not cancel or change the restaurant's Stripe",
        ),
        findsOneWidget,
      );

      await tester.tap(find.text('Hide Restaurant'));
      await tester.pumpAndSettle();
      expect(calls, <(String, bool, bool)>[('one', false, true)]);
      expect(
        find.text('Restaurant one hidden from BiteSaver.'),
        findsOneWidget,
      );
      expect(
        backend.calls
            .where((call) => call.$1 == 'searchCouponAdminRestaurantsPage')
            .length,
        2,
      );
    },
  );

  testWidgets(
    'hidden restaurant remains discoverable and confirms eligibility-aware Restore',
    (tester) async {
      final calls = <(String, bool, bool)>[];
      final backend = _Backend()
        ..custom = (name, request) async => _page(<Map<String, Object?>>[
          _restaurant('hidden-one', adminHidden: true),
        ], exactTotal: 1);
      await _pumpScreen(
        tester,
        backend,
        setRestaurantVisibility:
            ({
              required documentId,
              required expectedAdminHidden,
              required adminHidden,
            }) async {
              calls.add((documentId, expectedAdminHidden, adminHidden));
            },
      );
      await _selectExactZipAndSearch(tester);

      expect(find.text('Restaurant hidden-one'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('coupon-admin-hidden-chip-hidden-one')),
        findsOneWidget,
      );
      expect(find.text('Restore to BiteSaver'), findsOneWidget);

      await tester.ensureVisible(find.text('Restore to BiteSaver'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Restore to BiteSaver'));
      await tester.pumpAndSettle();
      expect(
        find.text('Restore “Restaurant hidden-one” to BiteSaver?'),
        findsOneWidget,
      );
      expect(
        find.textContaining('subscription and publication requirements'),
        findsOneWidget,
      );
      await tester.tap(find.text('Restore Restaurant'));
      await tester.pumpAndSettle();

      expect(calls, <(String, bool, bool)>[('hidden-one', true, false)]);
      expect(
        find.text('Restaurant hidden-one restored to BiteSaver.'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'visibility mutation blocks duplicate taps and reports stale state',
    (tester) async {
      final mutation = Completer<void>();
      var calls = 0;
      final backend = _Backend();
      await _pumpScreen(
        tester,
        backend,
        setRestaurantVisibility:
            ({
              required documentId,
              required expectedAdminHidden,
              required adminHidden,
            }) {
              calls += 1;
              return mutation.future;
            },
      );
      await _selectExactZipAndSearch(tester);
      await tester.tap(find.text('Hide from BiteSaver'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Hide Restaurant'));
      await tester.pump();

      final disabled = tester.widget<OutlinedButton>(
        find.widgetWithText(OutlinedButton, 'Hide from BiteSaver'),
      );
      expect(disabled.onPressed, isNull);
      expect(calls, 1);
      mutation.completeError(
        const RestaurantAccountAdminVisibilityException(
          kind: RestaurantAccountAdminVisibilityFailureKind.staleState,
          message: 'Restaurant visibility changed. Refresh and try again.',
        ),
      );
      await tester.pumpAndSettle();
      expect(calls, 1);
      expect(
        find.text('Restaurant visibility changed. Refresh and try again.'),
        findsOneWidget,
      );
    },
  );

  for (final configuration in <(Size, double)>[
    (const Size(320, 900), 1),
    (const Size(390, 900), 1.5),
    (const Size(1280, 900), 2),
    (const Size(320, 1000), 2),
    (const Size(390, 900), 1),
    (const Size(1280, 900), 1.5),
  ]) {
    testWidgets(
      'paged surface has no overflow at ${configuration.$1.width}px and ${configuration.$2}x text',
      (tester) async {
        final longId = 'ACCOUNT_${'A' * 80}';
        final backend = _Backend()
          ..custom = (name, request) async => _page(<Map<String, Object?>>[
            _restaurant(
              longId,
              name: 'Responsive Restaurant',
              actionId: 'OWNER_${'B' * 80}',
              uid: 'OWNER_${'B' * 80}',
            ),
          ], exactTotal: 1);
        await _pumpScreen(
          tester,
          backend,
          size: configuration.$1,
          textScale: configuration.$2,
        );
        await _selectExactZipAndSearch(tester);
        expect(tester.takeException(), isNull);
        expect(
          find.byKey(ValueKey('coupon-admin-copy-account-id-$longId')),
          findsOneWidget,
        );
        await tester.ensureVisible(
          find.byKey(ValueKey('coupon-admin-copy-account-id-$longId')),
        );
        expect(tester.takeException(), isNull);
        expect(find.text('Edit Restaurant'), findsOneWidget);
      },
    );
  }
}
