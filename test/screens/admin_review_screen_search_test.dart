import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/admin_restaurant_link_record.dart';
import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/screens/admin_review_screen.dart';
import 'package:coupon_app/services/admin_link_generation_service.dart';
import 'package:coupon_app/services/restaurant_invite_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'initial state preserves pending queue and performs no general search',
    (tester) async {
      var searchCalls = 0;
      var pendingListened = false;
      final pendingController =
          StreamController<List<AdminCouponAccountRecord>>(
            onListen: () => pendingListened = true,
          );
      addTearDown(pendingController.close);

      await _pumpScreen(
        tester,
        pendingAccounts: pendingController.stream,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async {
              searchCalls += 1;
              return _result();
            },
      );
      pendingController.add([
        _pendingAccount(
          documentId: 'pending-without-location',
          actionId: 'pending-owner-uid',
          name: 'Pending Without Geohash',
        ),
      ]);
      await tester.pump();

      expect(pendingListened, isTrue);
      expect(searchCalls, 0);
      expect(find.text('Pending Applications'), findsOneWidget);
      expect(find.text('Pending Without Geohash'), findsOneWidget);
      expect(find.text('Find Restaurants'), findsOneWidget);
      expect(
        find.text(
          'Enter a ZIP code or City, ST to find coupon-side restaurant '
          'accounts.',
        ),
        findsNWidgets(2),
      );
      expect(find.text('View All Restaurants'), findsNothing);
    },
  );

  testWidgets('invalid location is rejected and typing does not search', (
    tester,
  ) async {
    var calls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async {
            calls += 1;
            return _result();
          },
    );

    await tester.enterText(_locationField, 'Crystal River');
    await tester.enterText(_restaurantNameField, 'River Grill');
    await tester.pump();
    expect(calls, 0);

    await _tapSearch(tester);
    expect(
      find.text('Enter a five-digit ZIP code or City, ST.'),
      findsOneWidget,
    );
    expect(calls, 0);
  });

  testWidgets('submits ZIP with only BiteSaver and default radius', (
    tester,
  ) async {
    String? location;
    String? name;
    int? radius;
    Set<AdminRestaurantLinkSource>? capturedSources;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async {
            location = locationQuery;
            name = restaurantName;
            radius = radiusMiles;
            capturedSources = sources;
            return _result();
          },
    );

    await tester.enterText(_locationField, '34428');
    await tester.enterText(_restaurantNameField, ' River Grill ');
    await _tapSearch(tester);
    await tester.pumpAndSettle();

    expect(location, '34428');
    expect(name, 'River Grill');
    expect(radius, 10);
    expect(capturedSources, {AdminRestaurantLinkSource.biteSaver});
    expect(
      tester.widget<TextFormField>(_locationField).controller?.text,
      '34428',
    );
    expect(
      tester.widget<TextFormField>(_restaurantNameField).controller?.text,
      ' River Grill ',
    );
  });

  testWidgets('submits City, ST and exposes every permitted radius', (
    tester,
  ) async {
    String? location;
    int? radius;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async {
            location = locationQuery;
            radius = radiusMiles;
            return _result();
          },
    );

    final radiusField = tester.widget<DropdownButton<int>>(
      find.descendant(
        of: find.byKey(const ValueKey('coupon-admin-radius-field')),
        matching: find.byType(DropdownButton<int>),
      ),
    );
    expect(
      radiusField.items?.map((item) => item.value),
      AdminLinkGenerationService.radiusOptionsMiles,
    );

    await tester.enterText(_locationField, 'Crystal River, FL');
    await tester.tap(find.byKey(const ValueKey('coupon-admin-radius-field')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('50 miles').last);
    await tester.pumpAndSettle();
    await _tapSearch(tester);
    await tester.pumpAndSettle();

    expect(location, 'Crystal River, FL');
    expect(radius, 50);
  });

  testWidgets('Enter submits once and loading prevents duplicate submissions', (
    tester,
  ) async {
    final completer = Completer<AdminRestaurantLinkSearchResult>();
    var calls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) {
            calls += 1;
            return completer.future;
          },
    );

    await tester.enterText(_locationField, '34428');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    expect(calls, 1);
    final searchButton = find.byKey(
      const ValueKey('coupon-admin-search-button'),
    );
    expect(tester.widget<FilledButton>(searchButton).onPressed, isNull);
    await tester.tap(searchButton, warnIfMissed: false);
    await tester.pump();
    expect(calls, 1);

    completer.complete(_result());
    await tester.pumpAndSettle();
    expect(calls, 1);
  });

  testWidgets(
    'shows 25, reveals returned remainder, and resets on new search',
    (tester) async {
      var calls = 0;
      final records = List.generate(
        50,
        (index) => _biteSaverRecord(
          documentId: 'document-$index',
          actionId: 'owner-$index',
          name: 'Restaurant $index',
        ),
      );
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async {
              calls += 1;
              return _result(records: records);
            },
      );

      await _submitSearch(tester);
      expect(_resultCards(), findsNWidgets(25));
      expect(
        find.text('Showing 25 of 50 returned restaurants.'),
        findsOneWidget,
      );
      expect(find.text('Show 25 More'), findsOneWidget);

      final showMore = find.byKey(
        const ValueKey('coupon-admin-show-more-button'),
      );
      await _scrollToWidget(tester, showMore);
      await tester.tap(showMore);
      await tester.pump();
      expect(_resultCards(), findsNWidgets(50));
      expect(find.text('Show 25 More'), findsNothing);

      await _tapSearch(tester);
      await tester.pumpAndSettle();
      expect(calls, 2);
      expect(_resultCards(), findsNWidgets(25));
      expect(find.text('Show 25 More'), findsOneWidget);
    },
  );

  testWidgets('shows exact truncation, no-results, and controlled errors', (
    tester,
  ) async {
    var mode = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async {
            mode += 1;
            if (mode == 1) {
              return _result(truncated: true);
            }
            throw StateError('private provider payload');
          },
    );

    await _submitSearch(tester);
    expect(
      find.text(
        'Results were limited. Narrow the radius or add a restaurant name to '
        'refine the search.',
      ),
      findsOneWidget,
    );
    expect(
      find.text(
        'No matching coupon-side restaurants were found within this search '
        'area.',
      ),
      findsOneWidget,
    );

    await _tapSearch(tester);
    await tester.pumpAndSettle();
    expect(
      find.text('Could not search restaurants right now. Please try again.'),
      findsOneWidget,
    );
    expect(find.textContaining('private provider payload'), findsNothing);
  });

  testWidgets('filters BiteScore records and avoids pending duplication', (
    tester,
  ) async {
    await _pumpScreen(
      tester,
      pendingAccounts: Stream.value([
        _pendingAccount(
          documentId: 'pending-document',
          actionId: 'pending-owner',
          name: 'Pending Duplicate',
        ),
      ]),
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteSaverRecord(
                documentId: 'pending-document',
                actionId: 'pending-owner',
                name: 'Pending Duplicate',
              ),
              _biteSaverRecord(
                documentId: 'coupon-document',
                actionId: 'coupon-owner',
                name: 'Coupon Result',
              ),
              _biteScoreRecord(),
            ],
          ),
    );

    await _submitSearch(tester);
    expect(find.text('Pending Duplicate'), findsOneWidget);
    expect(find.text('Coupon Result'), findsOneWidget);
    expect(find.text('Rating Result'), findsNothing);
    expect(find.text('BiteScore'), findsNothing);
    expect(_resultCards(), findsOneWidget);
  });

  testWidgets('actions preserve document and canonical action identities', (
    tester,
  ) async {
    final approved = <String>[];
    final rejected = <String>[];
    final loaded = <String>[];
    final edited = <String>[];
    final invited = <String>[];
    final deleted = <String>[];
    final record = _biteSaverRecord(
      documentId: 'firestore-document',
      actionId: 'canonical-owner-uid',
      name: 'Identity Cafe',
    );
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(records: [record]),
      approveAccount: (documentId) async => approved.add(documentId),
      rejectAccount: (documentId) async => rejected.add(documentId),
      loadAccount: (documentId) async {
        loaded.add(documentId);
        return _accountData(
          actionId: 'canonical-owner-uid',
          name: 'Identity Cafe',
        );
      },
      editAccount:
          ({required context, required documentId, required data}) async {
            edited.add(documentId);
            return true;
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
            invited.add(restaurantId);
            return _invite();
          },
      deleteAccount: (documentId) async => deleted.add(documentId),
    );
    await _submitSearch(tester);

    await _tapAction(tester, 'biteSaver:firestore-document:approve');
    await _tapAction(tester, 'biteSaver:firestore-document:reject');
    await _tapAction(tester, 'biteSaver:firestore-document:edit');
    expect(loaded, ['firestore-document']);
    expect(edited, ['firestore-document']);
    expect(find.text('Identity Cafe'), findsOneWidget);

    await _tapAction(tester, 'biteSaver:firestore-document:invite');
    expect(invited, ['canonical-owner-uid']);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();

    await _tapAction(tester, 'biteSaver:firestore-document:delete');
    expect(find.text('Delete Restaurant'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle();

    expect(approved, ['firestore-document']);
    expect(rejected, ['firestore-document']);
    expect(deleted, ['firestore-document']);
    expect(find.text('Identity Cafe'), findsNothing);
  });

  testWidgets('selected full-document load failure is controlled', (
    tester,
  ) async {
    var loads = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteSaverRecord(
                documentId: 'missing-document',
                actionId: 'owner',
              ),
            ],
          ),
      loadAccount: (documentId) async {
        loads += 1;
        throw StateError('private Firestore details');
      },
    );
    await _submitSearch(tester);
    await _tapAction(tester, 'biteSaver:missing-document:edit');

    expect(loads, 1);
    expect(
      find.text('Could not load the restaurant account right now.'),
      findsOneWidget,
    );
    expect(find.textContaining('private Firestore details'), findsNothing);
  });

  testWidgets('coupon loading is expansion-only, per-account, and cached', (
    tester,
  ) async {
    final couponLoads = <String>[];
    await _pumpScreen(
      tester,
      pendingAccounts: Stream.value([
        _pendingAccount(
          documentId: 'pending-document',
          actionId: 'pending-owner',
          name: 'Pending Cafe',
        ),
      ]),
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteSaverRecord(
                documentId: 'search-one',
                actionId: 'owner-one',
                name: 'Search One',
              ),
              _biteSaverRecord(
                documentId: 'search-two',
                actionId: 'owner-two',
                name: 'Search Two',
              ),
            ],
          ),
      loadCoupons: (documentId) async {
        couponLoads.add(documentId);
        return [_coupon(documentId)];
      },
    );

    expect(couponLoads, isEmpty);
    await _submitSearch(tester);
    expect(couponLoads, isEmpty);

    final firstCard = find.byKey(const ValueKey('biteSaver:search-one'));
    final firstCoupons = find.descendant(
      of: firstCard,
      matching: find.text('Coupons'),
    );
    await _scrollToWidget(tester, firstCoupons);
    await tester.tap(firstCoupons);
    await tester.pumpAndSettle();
    expect(couponLoads, ['search-one']);
    expect(find.text('Coupon for search-one'), findsOneWidget);

    await tester.tap(firstCoupons);
    await tester.pumpAndSettle();
    await tester.tap(firstCoupons);
    await tester.pumpAndSettle();
    expect(couponLoads, ['search-one']);
    expect(couponLoads, isNot(contains('pending-document')));
    expect(couponLoads, isNot(contains('search-two')));
  });

  testWidgets('pending coupon expansion is lazy and errors are controlled', (
    tester,
  ) async {
    var calls = 0;
    await _pumpScreen(
      tester,
      pendingAccounts: Stream.value([
        _pendingAccount(
          documentId: 'pending-error',
          actionId: 'owner',
          name: 'Pending Error Cafe',
        ),
      ]),
      loadCoupons: (documentId) async {
        calls += 1;
        throw StateError('private coupon payload');
      },
    );

    expect(calls, 0);
    final pendingCard = find.byKey(const ValueKey('pending:pending-error'));
    final coupons = find.descendant(
      of: pendingCard,
      matching: find.text('Coupons'),
    );
    await tester.ensureVisible(coupons);
    await tester.tap(coupons);
    await tester.pumpAndSettle();
    expect(calls, 1);
    expect(find.text('Could not load coupons right now.'), findsOneWidget);
    expect(find.textContaining('private coupon payload'), findsNothing);
  });

  testWidgets('responsive layouts remain overflow-free', (tester) async {
    final scenarios = <({Size size, double scale})>[
      (size: const Size(320, 900), scale: 2),
      (size: const Size(900, 420), scale: 1.2),
      (size: const Size(1440, 1000), scale: 1),
    ];

    for (final scenario in scenarios) {
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = scenario.size;
      await _pumpScreen(
        tester,
        textScale: scenario.scale,
        configureView: false,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: [
                _biteSaverRecord(
                  documentId: 'responsive-document',
                  actionId: 'responsive-owner',
                  name: 'Responsive Restaurant With A Long Name',
                ),
              ],
            ),
      );
      expect(
        tester.takeException(),
        isNull,
        reason: '${scenario.size} initial layout',
      );
      await _scrollToLocationField(tester);
      final searchControlsException = tester.takeException();
      if (searchControlsException != null) {
        fail(
          '${scenario.size} search controls\n'
          '$searchControlsException',
        );
      }
      await _submitSearch(tester);
      expect(
        tester.takeException(),
        isNull,
        reason: '${scenario.size} result actions',
      );
    }
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
}

final Finder _locationField = find.byKey(
  const ValueKey('coupon-admin-location-field'),
);
final Finder _restaurantNameField = find.byKey(
  const ValueKey('coupon-admin-restaurant-name-field'),
);

Future<void> _pumpScreen(
  WidgetTester tester, {
  AdminCouponRestaurantSearchCallback? search,
  Stream<List<AdminCouponAccountRecord>>? pendingAccounts,
  AdminCouponAccountLoader? loadAccount,
  AdminCouponAccountAction? approveAccount,
  AdminCouponAccountAction? rejectAccount,
  AdminCouponAccountAction? deleteAccount,
  AdminCouponLoader? loadCoupons,
  AdminCouponDeleteAction? deleteCoupon,
  AdminCouponEditAction? editAccount,
  AdminCouponInviteAction? createCouponInvite,
  double textScale = 1,
  bool configureView = true,
}) async {
  if (configureView) {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1000, 1000);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }
  await tester.pumpWidget(
    MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: Scaffold(
        body: AdminReviewScreen(
          pendingAccountsStream:
              pendingAccounts ??
              Stream<List<AdminCouponAccountRecord>>.value(const []),
          nameChangeRequestsStream:
              const Stream<QuerySnapshot<Map<String, dynamic>>>.empty(),
          reportsStream:
              const Stream<QuerySnapshot<Map<String, dynamic>>>.empty(),
          searchRestaurants: search ?? _emptySearch,
          loadAccount:
              loadAccount ??
              (documentId) async =>
                  _accountData(actionId: documentId, name: 'Loaded Restaurant'),
          approveAccount: approveAccount ?? (documentId) async {},
          rejectAccount: rejectAccount ?? (documentId) async {},
          deleteAccount: deleteAccount ?? (documentId) async {},
          loadCoupons: loadCoupons ?? (documentId) async => const [],
          deleteCoupon:
              deleteCoupon ??
              ({required documentId, required couponId}) async {},
          editAccount:
              editAccount ??
              ({required context, required documentId, required data}) async =>
                  false,
          createCouponInvite:
              createCouponInvite ??
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
              }) async => _invite(),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

Future<AdminRestaurantLinkSearchResult> _emptySearch({
  required String locationQuery,
  required int radiusMiles,
  required String? restaurantName,
  required Set<AdminRestaurantLinkSource> sources,
}) async => _result();

Future<void> _tapSearch(WidgetTester tester) async {
  final searchButton = find.byKey(const ValueKey('coupon-admin-search-button'));
  tester.state<ScrollableState>(_verticalScrollable()).position.jumpTo(0);
  await tester.pump();
  await _scrollToWidget(tester, searchButton);
  await tester.tap(searchButton);
  await tester.pump();
}

Future<void> _submitSearch(
  WidgetTester tester, {
  String location = '34428',
}) async {
  await tester.enterText(_locationField, location);
  await _tapSearch(tester);
  await tester.pumpAndSettle();
}

Future<void> _scrollToLocationField(WidgetTester tester) async {
  await _scrollToWidget(tester, _locationField);
}

Future<void> _scrollToWidget(WidgetTester tester, Finder target) async {
  final scrollable = _verticalScrollable();
  final viewHeight =
      tester.view.physicalSize.height / tester.view.devicePixelRatio;

  for (var attempt = 0; attempt < 40; attempt += 1) {
    if (target.evaluate().isNotEmpty) {
      final rect = tester.getRect(target.first);
      if (rect.top >= 0 && rect.bottom <= viewHeight) {
        return;
      }
      await tester.drag(scrollable, Offset(0, rect.top < 0 ? 500 : -500));
    } else {
      await tester.drag(scrollable, const Offset(0, -500));
    }
    await tester.pump();
  }
  expect(target, findsWidgets);
}

Finder _verticalScrollable() {
  return find
      .byWidgetPredicate(
        (widget) =>
            widget is Scrollable && widget.axisDirection == AxisDirection.down,
      )
      .first;
}

Future<void> _tapAction(WidgetTester tester, String key) async {
  final action = find.byKey(ValueKey(key));
  await tester.ensureVisible(action);
  await tester.tap(action);
  await tester.pumpAndSettle();
}

Finder _resultCards() {
  return find.byWidgetPredicate((widget) {
    final key = widget.key;
    return widget is Card &&
        key is ValueKey<String> &&
        key.value.startsWith('biteSaver:');
  });
}

AdminCouponAccountRecord _pendingAccount({
  required String documentId,
  required String actionId,
  required String name,
}) {
  return AdminCouponAccountRecord(
    documentId: documentId,
    data: _accountData(actionId: actionId, name: name),
  );
}

Map<String, dynamic> _accountData({
  required String actionId,
  required String name,
}) {
  return <String, dynamic>{
    Restaurant.fieldUid: actionId,
    Restaurant.fieldName: name,
    Restaurant.fieldEmail: 'owner@example.com',
    Restaurant.fieldApprovalStatus: 'pending',
    'couponApplicationSubmitted': true,
  };
}

AdminRestaurantLinkSearchResult _result({
  List<AdminRestaurantLinkRecord> records = const [],
  bool truncated = false,
}) {
  return AdminRestaurantLinkSearchResult(
    searchCenter: const AdminRestaurantSearchCenter(
      latitude: 28.8517,
      longitude: -82.487,
      displayName: 'Crystal River, FL',
    ),
    radiusMiles: 10,
    results: records,
    resultsMayBeTruncated: truncated,
    returnedCount: records.length,
    queriedSources: const [AdminRestaurantLinkSource.biteSaver],
  );
}

AdminRestaurantLinkRecord _biteSaverRecord({
  required String documentId,
  required String actionId,
  String name = 'Coupon Result',
}) {
  return AdminRestaurantLinkRecord(
    source: AdminRestaurantLinkSource.biteSaver,
    documentId: documentId,
    actionId: actionId,
    restaurantName: name,
    streetAddress: '1 Main Street',
    city: 'Crystal River',
    state: 'FL',
    zipCode: '34428',
    phone: '555-0100',
    website: 'https://example.com',
    latitude: 28.8517,
    longitude: -82.487,
    distanceMiles: 1.5,
    approvalStatus: 'pending',
    couponApplicationSubmitted: true,
    uid: actionId,
  );
}

AdminRestaurantLinkRecord _biteScoreRecord() {
  return const AdminRestaurantLinkRecord(
    source: AdminRestaurantLinkSource.biteScore,
    documentId: 'rating-document',
    actionId: 'rating-document',
    restaurantName: 'Rating Result',
    streetAddress: '2 Main Street',
    city: 'Crystal River',
    state: 'FL',
    zipCode: '34428',
    phone: '555-0200',
    website: 'https://rating.example.com',
    latitude: 28.8517,
    longitude: -82.487,
    distanceMiles: 2,
    isActive: true,
    isClaimed: false,
  );
}

Coupon _coupon(String documentId) {
  return Coupon(
    id: 'coupon-$documentId',
    restaurant: documentId,
    title: 'Coupon for $documentId',
    distance: '',
    expires: 'Limited time',
    usageRule: Coupon.defaultUsageRule,
  );
}

RestaurantInviteCreationResult _invite() {
  return const RestaurantInviteCreationResult(
    inviteId: 'invite-id',
    token: 'test-token',
    inviteUrl: 'https://example.test/invite/test-token',
    expiresAt: null,
  );
}
