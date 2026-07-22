import 'dart:async';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/admin_restaurant_link_record.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/screens/bitescore_admin_screen.dart';
import 'package:coupon_app/services/admin_link_generation_service.dart';
import 'package:coupon_app/services/restaurant_invite_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('initial state performs no search and exposes bounded controls', (
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
            required biteScoreStatus,
          }) async {
            calls += 1;
            return _result();
          },
    );

    expect(calls, 0);
    expect(find.text('Find Restaurants'), findsNWidgets(2));
    expect(find.text('View All Restaurants'), findsNothing);
    expect(
      find.text(
        'Enter a ZIP code or City, ST to search. Valid location data is required.',
      ),
      findsOneWidget,
    );

    final radius = tester.widget<DropdownButton<int>>(
      find.descendant(
        of: find.byKey(const ValueKey('rating-admin-radius-field')),
        matching: find.byType(DropdownButton<int>),
      ),
    );
    expect(
      radius.items?.map((item) => item.value),
      AdminLinkGenerationService.radiusOptionsMiles,
    );

    final status = tester.widget<DropdownButton<AdminBiteScoreStatus>>(
      find.descendant(
        of: find.byKey(const ValueKey('rating-admin-status-field')),
        matching: find.byType(DropdownButton<AdminBiteScoreStatus>),
      ),
    );
    expect(status.value, AdminBiteScoreStatus.all);
    expect(status.items?.map((item) => item.value), [
      AdminBiteScoreStatus.all,
      AdminBiteScoreStatus.active,
      AdminBiteScoreStatus.inactive,
    ]);
  });

  testWidgets('typing does not search and invalid location is rejected', (
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
            required biteScoreStatus,
          }) async {
            calls += 1;
            return _result();
          },
    );

    await tester.enterText(_locationField, 'Crystal River');
    await tester.enterText(_nameField, 'River Grill');
    await tester.pump();
    expect(calls, 0);

    await _tapSearch(tester);
    expect(
      find.text('Enter a five-digit ZIP code or City, ST.'),
      findsOneWidget,
    );
    expect(calls, 0);
  });

  testWidgets('submits BiteScore-only criteria with explicit status mapping', (
    tester,
  ) async {
    final requests = <_CapturedSearch>[];
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required biteScoreStatus,
          }) async {
            requests.add(
              _CapturedSearch(
                locationQuery: locationQuery,
                radiusMiles: radiusMiles,
                restaurantName: restaurantName,
                sources: sources,
                status: biteScoreStatus,
              ),
            );
            return _result();
          },
    );

    await tester.enterText(_locationField, 'Crystal River, FL');
    await tester.enterText(_nameField, ' River Grill ');
    await _tapSearch(tester);
    await tester.pumpAndSettle();

    expect(requests.single.locationQuery, 'Crystal River, FL');
    expect(requests.single.radiusMiles, 10);
    expect(requests.single.restaurantName, 'River Grill');
    expect(requests.single.sources, {AdminRestaurantLinkSource.biteScore});
    expect(requests.single.status, AdminBiteScoreStatus.all);

    await _selectStatus(tester, 'Hidden');
    await _tapSearch(tester);
    await tester.pumpAndSettle();
    expect(requests.last.status, AdminBiteScoreStatus.inactive);

    await _selectStatus(tester, 'Active');
    await tester.tap(find.byKey(const ValueKey('rating-admin-radius-field')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('50 miles').last);
    await tester.pumpAndSettle();
    await _tapSearch(tester);
    await tester.pumpAndSettle();
    expect(requests.last.status, AdminBiteScoreStatus.active);
    expect(requests.last.radiusMiles, 50);
  });

  testWidgets('Enter submits once and loading prevents duplicates', (
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
            required biteScoreStatus,
          }) {
            calls += 1;
            return completer.future;
          },
    );

    await tester.enterText(_locationField, '34428');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    expect(calls, 1);
    final button = tester.widget<FilledButton>(_searchButton);
    expect(button.onPressed, isNull);
    await tester.tap(_searchButton, warnIfMissed: false);
    await tester.pump();
    expect(calls, 1);

    completer.complete(_result());
    await tester.pumpAndSettle();
    expect(calls, 1);
  });

  testWidgets('shows 25, reveals returned results locally, and resets', (
    tester,
  ) async {
    var calls = 0;
    final records = List.generate(
      50,
      (index) =>
          _record(documentId: 'document-$index', name: 'Restaurant $index'),
    );
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required biteScoreStatus,
          }) async {
            calls += 1;
            return _result(records: records, truncated: true);
          },
    );

    await _submitSearch(tester);
    expect(_resultCards(), findsNWidgets(25));
    expect(find.text('Showing 25 of 50 returned restaurants.'), findsOneWidget);
    expect(
      find.text(
        'Results were limited. Narrow the radius or add a restaurant name to refine the search.',
      ),
      findsOneWidget,
    );

    await _scrollToWidget(tester, _showMoreButton);
    await tester.tap(_showMoreButton);
    await tester.pump();
    expect(_resultCards(), findsNWidgets(50));
    expect(calls, 1);
    expect(_showMoreButton, findsNothing);

    await _tapSearch(tester);
    await tester.pumpAndSettle();
    expect(calls, 2);
    expect(_resultCards(), findsNWidgets(25));
  });

  testWidgets('cards show controlled fields and preserve actual action IDs', (
    tester,
  ) async {
    var searchCalls = 0;
    String? invitedId;
    String? deletedId;
    final record = _record(
      documentId: 'actual-firestore-document',
      actionId: 'stored-compatibility-id',
      name: 'Hidden River Grill',
      isActive: false,
      isClaimed: false,
    );
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required biteScoreStatus,
          }) async {
            searchCalls += 1;
            return _result(records: [record]);
          },
      createClaimInvite: ({required restaurantId}) async {
        invitedId = restaurantId;
        return const RestaurantInviteCreationResult(
          inviteId: 'test-invite',
          token: 'test-token',
          inviteUrl: 'https://example.test/invite',
          expiresAt: null,
        );
      },
      deleteRestaurant: (documentId) async {
        deletedId = documentId;
      },
    );

    await _submitSearch(tester);
    expect(find.text('Hidden River Grill'), findsOneWidget);
    expect(find.text('BiteScore'), findsOneWidget);
    expect(find.text('Hidden'), findsOneWidget);
    expect(find.text('Unclaimed'), findsOneWidget);
    expect(find.text('1 Main Street'), findsOneWidget);
    expect(find.text('Crystal River, FL, 34428'), findsOneWidget);
    expect(find.text('Website: https://example.test'), findsOneWidget);
    expect(find.textContaining('owner@example.com'), findsNothing);

    final inviteButton = find.widgetWithText(
      OutlinedButton,
      'Create Claim Invite',
    );
    await _scrollToWidget(tester, inviteButton);
    await tester.tap(inviteButton);
    await tester.pumpAndSettle();
    expect(invitedId, 'actual-firestore-document');
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();

    final deleteButton = find.widgetWithText(OutlinedButton, 'Delete');
    await _scrollToWidget(tester, deleteButton);
    await tester.tap(deleteButton);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle();

    expect(deletedId, 'actual-firestore-document');
    expect(searchCalls, 1);
    expect(_resultCards(), findsNothing);
  });

  testWidgets(
    'edit loads exactly one actual document and supports hidden state',
    (tester) async {
      String? loadedId;
      final record = _record(
        documentId: 'hidden-document',
        name: 'Hidden Cafe',
        isActive: false,
      );
      await _pumpScreen(
        tester,
        search: _fixedSearch([record]),
        loadRestaurant: (documentId) async {
          loadedId = documentId;
          return _restaurant(documentId: documentId, isActive: false);
        },
      );

      await _submitSearch(tester);
      final editButton = find.widgetWithText(OutlinedButton, 'Edit');
      await _scrollToWidget(tester, editButton);
      await tester.tap(editButton);
      await tester.pumpAndSettle();

      expect(loadedId, 'hidden-document');
      expect(find.text('Edit Restaurant'), findsOneWidget);
      expect(
        tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
        false,
      );
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(find.text('Hidden Cafe'), findsOneWidget);
      expect(
        tester.widget<TextFormField>(_locationField).controller?.text,
        '34428',
      );
    },
  );

  testWidgets('selected document load failures are controlled', (tester) async {
    final record = _record(documentId: 'missing-document');
    await _pumpScreen(
      tester,
      search: _fixedSearch([record]),
      loadRestaurant: (_) async => throw StateError('raw Firestore failure'),
    );

    await _submitSearch(tester);
    final editButton = find.widgetWithText(OutlinedButton, 'Edit');
    await _scrollToWidget(tester, editButton);
    await tester.tap(editButton);
    await tester.pumpAndSettle();

    expect(
      find.text('Could not load this restaurant right now. Please try again.'),
      findsOneWidget,
    );
    expect(find.textContaining('raw Firestore failure'), findsNothing);
    expect(find.text('River Grill'), findsOneWidget);
  });

  testWidgets('claimed restaurants cannot generate another invite', (
    tester,
  ) async {
    var inviteCalls = 0;
    await _pumpScreen(
      tester,
      search: _fixedSearch([
        _record(documentId: 'claimed-document', isClaimed: true),
      ]),
      createClaimInvite: ({required restaurantId}) async {
        inviteCalls += 1;
        throw StateError('must not be called');
      },
    );

    await _submitSearch(tester);
    final button = tester.widget<OutlinedButton>(
      find.widgetWithText(OutlinedButton, 'Already Claimed'),
    );
    expect(button.onPressed, isNull);
    expect(inviteCalls, 0);
  });

  testWidgets('Manage Dishes loads only the selected restaurant', (
    tester,
  ) async {
    final requestedIds = <String>[];
    final record = _record(
      documentId: 'selected-restaurant',
      name: 'Selected Cafe',
    );
    await _pumpScreen(
      tester,
      search: _fixedSearch([record]),
      loadDishes: (restaurantId) async {
        requestedIds.add(restaurantId);
        return [
          _dish(
            id: 'selected-dish',
            restaurantId: 'selected-restaurant',
            name: 'Selected Burger',
          ),
          _dish(
            id: 'other-dish',
            restaurantId: 'other-restaurant',
            name: 'Other Burger',
          ),
        ];
      },
    );

    await _submitSearch(tester);
    final manageButton = find.widgetWithText(OutlinedButton, 'Manage Dishes');
    await _scrollToWidget(tester, manageButton);
    await tester.tap(manageButton);
    await tester.pumpAndSettle();

    expect(requestedIds, ['selected-restaurant']);
    expect(find.text('Managing dishes for Selected Cafe'), findsOneWidget);
    expect(find.text('Selected Burger'), findsOneWidget);
    expect(find.text('Other Burger'), findsNothing);
    expect(find.byTooltip('Mark unavailable'), findsOneWidget);
    expect(find.byTooltip('Edit dish'), findsOneWidget);
    expect(find.byTooltip('Delete dish'), findsOneWidget);
  });

  testWidgets('Manage Dishes empty and error states are controlled', (
    tester,
  ) async {
    final record = _record(
      documentId: 'selected-restaurant',
      name: 'Selected Cafe',
    );
    await _pumpScreen(
      tester,
      search: _fixedSearch([record]),
      loadDishes: (_) async => const [],
    );
    await _submitSearch(tester);
    var manageButton = find.widgetWithText(OutlinedButton, 'Manage Dishes');
    await _scrollToWidget(tester, manageButton);
    await tester.tap(manageButton);
    await tester.pumpAndSettle();
    expect(find.text('No Dishes for Selected Cafe'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await _pumpScreen(
      tester,
      search: _fixedSearch([record]),
      loadDishes: (_) async => throw StateError('raw dish payload'),
    );
    await _submitSearch(tester);
    manageButton = find.widgetWithText(OutlinedButton, 'Manage Dishes');
    await _scrollToWidget(tester, manageButton);
    await tester.tap(manageButton);
    await tester.pumpAndSettle();
    expect(find.textContaining('BiteScore dishes'), findsOneWidget);
    expect(find.textContaining('raw dish payload'), findsNothing);
  });

  testWidgets('no-results and backend errors are controlled', (tester) async {
    var fail = false;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
            required biteScoreStatus,
          }) async {
            if (fail) {
              throw StateError('raw backend payload');
            }
            return _result();
          },
    );

    await _submitSearch(tester);
    expect(
      find.text(
        'No matching BiteScore restaurants were found within this search area.',
      ),
      findsOneWidget,
    );

    fail = true;
    await _tapSearch(tester);
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Could not search BiteScore restaurants right now. Please try again.',
      ),
      findsOneWidget,
    );
    expect(find.textContaining('raw backend payload'), findsNothing);
  });

  testWidgets('responsive layouts remain overflow-free', (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final sizes = <({Size size, double textScale})>[
      (size: const Size(320, 740), textScale: 1),
      (size: const Size(740, 360), textScale: 1),
      (size: const Size(1280, 900), textScale: 1),
      (size: const Size(390, 844), textScale: 2),
    ];

    for (final scenario in sizes) {
      tester.view.physicalSize = scenario.size;
      tester.view.devicePixelRatio = 1;
      await _pumpScreen(
        tester,
        textScale: scenario.textScale,
        search: _fixedSearch([_record(documentId: 'responsive')]),
        configureView: false,
      );
      await _submitSearch(tester);
      expect(tester.takeException(), isNull, reason: '${scenario.size}');
    }
  });

  test(
    'source contains no Rating load-all browser or all-dish subscription',
    () {
      final source = File(
        'lib/screens/bitescore_admin_screen.dart',
      ).readAsStringSync();
      expect(
        source,
        isNot(contains('BiteScoreService.restaurantsAdminStream()')),
      );
      expect(source, isNot(contains('BiteScoreService.dishesAdminStream()')));
      expect(source, isNot(contains("'View All Restaurants'")));
      expect(source, contains('BiteScoreService.loadDishesForRestaurant('));
      expect(source, contains('includeInactive: true'));

      final serviceSource = File(
        'lib/services/bitescore_service.dart',
      ).readAsStringSync();
      expect(
        serviceSource,
        contains(".where('restaurantId', isEqualTo: restaurantId)"),
      );
      expect(serviceSource, contains('restaurant?.copyWith(id: snapshot.id)'));
    },
  );
}

final Finder _locationField = find.byKey(
  const ValueKey('rating-admin-location-field'),
);
final Finder _nameField = find.byKey(
  const ValueKey('rating-admin-restaurant-name-field'),
);
final Finder _searchButton = find.byKey(
  const ValueKey('rating-admin-search-button'),
);
final Finder _showMoreButton = find.byKey(
  const ValueKey('rating-admin-show-more-button'),
);

Finder _resultCards() => find.byWidgetPredicate(
  (widget) =>
      widget.key is ValueKey<String> &&
      (widget.key! as ValueKey<String>).value.startsWith(
        'rating-admin-result-',
      ),
);

Future<void> _pumpScreen(
  WidgetTester tester, {
  required AdminBiteScoreRestaurantSearchCallback search,
  AdminBiteScoreRestaurantLoader? loadRestaurant,
  AdminBiteScoreRestaurantDeleteAction? deleteRestaurant,
  AdminBiteScoreInviteAction? createClaimInvite,
  AdminBiteScoreDishLoader? loadDishes,
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
        body: BiteScoreAdminScreen(
          searchRestaurants: search,
          loadRestaurant: loadRestaurant,
          deleteRestaurant: deleteRestaurant,
          createClaimInvite: createClaimInvite,
          loadRestaurantDishes: loadDishes,
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

Future<void> _tapSearch(WidgetTester tester) async {
  tester.state<ScrollableState>(_verticalScrollable()).position.jumpTo(0);
  await tester.pump();
  await _scrollToWidget(tester, _searchButton);
  await tester.tap(_searchButton);
  await tester.pump();
}

Future<void> _submitSearch(WidgetTester tester) async {
  await tester.enterText(_locationField, '34428');
  await _tapSearch(tester);
  await tester.pumpAndSettle();
}

Future<void> _selectStatus(WidgetTester tester, String label) async {
  final field = find.byKey(const ValueKey('rating-admin-status-field'));
  await _scrollToWidget(tester, field);
  await tester.tap(field);
  await tester.pumpAndSettle();
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

Future<void> _scrollToWidget(WidgetTester tester, Finder target) async {
  final scrollable = _verticalScrollable();
  final viewHeight =
      tester.view.physicalSize.height / tester.view.devicePixelRatio;

  for (var attempt = 0; attempt < 50; attempt += 1) {
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

AdminBiteScoreRestaurantSearchCallback _fixedSearch(
  List<AdminRestaurantLinkRecord> records,
) =>
    ({
      required locationQuery,
      required radiusMiles,
      required restaurantName,
      required sources,
      required biteScoreStatus,
    }) async => _result(records: records);

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
    queriedSources: const [AdminRestaurantLinkSource.biteScore],
  );
}

AdminRestaurantLinkRecord _record({
  required String documentId,
  String? actionId,
  String name = 'River Grill',
  bool isActive = true,
  bool isClaimed = false,
}) {
  return AdminRestaurantLinkRecord(
    source: AdminRestaurantLinkSource.biteScore,
    documentId: documentId,
    actionId: actionId ?? documentId,
    restaurantName: name,
    streetAddress: '1 Main Street',
    city: 'Crystal River',
    state: 'FL',
    zipCode: '34428',
    phone: '555-0100',
    website: 'https://example.test',
    latitude: 28.8517,
    longitude: -82.487,
    distanceMiles: 1.25,
    isActive: isActive,
    isClaimed: isClaimed,
    ownerUserId: 'private-owner-id',
    linkedBiteSaverUid: 'private-linked-id',
  );
}

BitescoreRestaurant _restaurant({
  required String documentId,
  required bool isActive,
}) {
  return BitescoreRestaurant(
    id: documentId,
    name: 'Hidden Cafe',
    normalizedName: 'hidden cafe',
    address: '1 Main Street',
    city: 'Crystal River',
    state: 'FL',
    zipCode: '34428',
    location: const GeoPoint(28.8517, -82.487),
    isActive: isActive,
  );
}

BitescoreDish _dish({
  required String id,
  required String restaurantId,
  required String name,
}) {
  return BitescoreDish(
    id: id,
    restaurantId: restaurantId,
    restaurantName: 'Selected Cafe',
    name: name,
    normalizedName: name.toLowerCase(),
  );
}

class _CapturedSearch {
  final String locationQuery;
  final int radiusMiles;
  final String? restaurantName;
  final Set<AdminRestaurantLinkSource> sources;
  final AdminBiteScoreStatus status;

  const _CapturedSearch({
    required this.locationQuery,
    required this.radiusMiles,
    required this.restaurantName,
    required this.sources,
    required this.status,
  });
}
