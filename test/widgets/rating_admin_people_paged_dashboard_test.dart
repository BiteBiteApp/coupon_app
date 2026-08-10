import 'dart:async';
import 'dart:io';

import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/models/rating_admin_people_paging_models.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/services/rating_admin_people_paging_service.dart';
import 'package:coupon_app/widgets/rating_admin_people_paged_dashboard.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, Object?> user(
  String uid,
  String name, {
  bool more = false,
  bool admin = false,
}) => <String, Object?>{
  'uid': uid,
  'displayName': name,
  'email': '$uid@example.test',
  'phoneNumber': '+13525550100',
  'claimedRestaurantNames': <Object?>['Alpha Cafe'],
  'hasMoreClaimedRestaurants': more,
  'hasRestaurantAccount': true,
  'hasBiteScoreOwnership': true,
  'isAdmin': admin,
  'isEmailVerified': true,
  'restaurantAccountStatus': 'approved',
  'activityTags': <Object?>['Claims', 'Reviews'],
};

Map<String, Object?> points(String uid, String name, int total) =>
    <String, Object?>{
      'userId': uid,
      'displayName': name,
      'totalPoints': total,
      'lastActivityAtMillis': null,
    };

Map<String, Object?> ledger(String id, String uid) => <String, Object?>{
  'id': id,
  'userId': uid,
  'pointsDelta': 1,
  'description': 'Ledger $id',
  'dishId': 'dish-$id',
  'dishName': 'Dish $id',
  'restaurantId': 'restaurant-$id',
  'restaurantName': 'Restaurant $id',
  'restaurantCity': 'Orlando',
  'restaurantState': 'FL',
  'restaurantAddress': '1 Main St',
  'restaurantPhone': '+13525550100',
  'requestId': 'request-$id',
  'reason': null,
  'createdAtMillis': 1,
};

Map<String, Object?> page({
  required List<Object?> items,
  int pageNumber = 1,
  int total = 1,
  bool hasNext = false,
  bool hasPrevious = false,
  bool unknownTotal = false,
}) => <String, Object?>{
  'protocolVersion': pageProtocolVersion,
  'items': items,
  'pageSize': 50,
  'hasNext': hasNext,
  'hasPrevious': hasPrevious,
  if (hasNext) 'nextCursor': 'next-$pageNumber',
  if (hasPrevious) 'previousCursor': 'previous-$pageNumber',
  'currentPageNumber': pageNumber,
  'total': unknownTotal
      ? <String, Object?>{'state': 'unknown'}
      : <String, Object?>{'state': 'exact', 'value': total},
  'queryFingerprint': List<String>.filled(64, '0').join(),
  'snapshotTimestampMs': 1,
  'capabilities': <String, Object?>{
    'first': pageNumber > 1,
    'previous': hasPrevious,
    'numberedVisitedPages': true,
    'next': hasNext,
    'last': !unknownTotal && hasNext,
  },
};

Map<String, Object?> preparingUsersPage({
  required List<Object?> items,
  required String nextCursor,
  int pageNumber = 1,
  bool hasPrevious = false,
}) => <String, Object?>{
  ...page(
    items: items,
    pageNumber: pageNumber,
    hasNext: true,
    hasPrevious: hasPrevious,
    unknownTotal: true,
  ),
  'nextCursor': nextCursor,
  'preparation': <String, Object?>{
    'state': 'preparing',
    'completedUnits': 0,
    'message': 'Preparing claimed User results…',
  },
};

Map<String, Object?> readyUsersPage({
  required int pageNumber,
  bool hasNext = false,
}) => <String, Object?>{
  ...page(
    items: const <Object?>[],
    pageNumber: pageNumber,
    hasNext: hasNext,
    unknownTotal: true,
  ),
  'preparation': <String, Object?>{'state': 'ready', 'completedUnits': 0},
};

Widget host(Widget child, {double width = 390, double scale = 1}) {
  return MaterialApp(
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(scale)),
      child: child!,
    ),
    home: Scaffold(
      body: SizedBox(width: width, child: child),
    ),
  );
}

Future<void> selectUserMode(
  WidgetTester tester,
  RatingAdminUserSearchMode mode,
) async {
  final dropdown = tester.widget<DropdownButton<RatingAdminUserSearchMode>>(
    find.byKey(const ValueKey<String>('rating-admin-user-search-mode')),
  );
  dropdown.onChanged!(mode);
  await tester.pumpAndSettle();
}

Future<void> selectPointsSort(
  WidgetTester tester,
  RatingAdminUserPointsSort sort,
) async {
  final dropdown = tester.widget<DropdownButton<RatingAdminUserPointsSort>>(
    find.byKey(const ValueKey<String>('rating-admin-user-points-sort')),
  );
  dropdown.onChanged!(sort);
  await tester.pumpAndSettle();
}

void main() {
  test('migrated production paths contain only paged callable loaders', () {
    final widgetSource = File(
      'lib/widgets/rating_admin_people_paged_dashboard.dart',
    ).readAsStringSync();
    for (final forbidden in <String>[
      'loadUsersForAdmin(',
      'loadUserPointSummaries(',
      'loadLedgerForAdmin(',
      "collection('user_profiles')",
      "collection('public_reviewer_profiles')",
      '.take(50)',
    ]) {
      expect(widgetSource, isNot(contains(forbidden)), reason: forbidden);
    }
    expect(widgetSource, contains('PagedDirectoryView<RatingAdminUserRecord>'));
    expect(
      widgetSource,
      contains('PagedDirectoryView<RatingAdminUserPointsRecord>'),
    );
    expect(
      widgetSource,
      contains('PagedDirectoryView<RatingAdminContributionLedgerRecord>'),
    );
    final screenSource = File(
      'lib/screens/bitescore_admin_screen.dart',
    ).readAsStringSync();
    expect(screenSource, contains('RatingAdminUsersPagedView('));
    expect(screenSource, contains('RatingAdminUserPointsPagedView('));
    for (final entryPoint in <String>[
      "Tab(text: 'Dish Suggestions')",
      "Tab(text: 'Restaurants')",
      "Tab(text: 'User Points')",
      'RatingAdminRestaurantPagedView(',
    ]) {
      expect(screenSource, contains(entryPoint));
    }
  });

  testWidgets(
    'Users loads View All lazily and replaces pages with exact navigation',
    (tester) async {
      final calls = <Map<String, Object?>>[];
      final service = RatingAdminPeoplePagingService(
        functionsBoundary: (name, request) async {
          expect(name, 'searchRatingAdminUsersPage');
          calls.add(request);
          return switch (request['direction']) {
            'forward' => page(
              items: <Object?>[user('user-2', 'Second Page')],
              pageNumber: 2,
              total: 51,
              hasPrevious: true,
            ),
            'backward' => page(
              items: <Object?>[user('user-1', 'First Page')],
              total: 51,
              hasNext: true,
            ),
            'last' => page(
              items: <Object?>[user('user-last', 'Last Page')],
              pageNumber: 2,
              total: 51,
              hasPrevious: true,
            ),
            _ => page(
              items: <Object?>[user('user-1', 'First Page')],
              total: 51,
              hasNext: true,
            ),
          };
        },
      );
      await tester.pumpWidget(
        host(RatingAdminUsersPagedView(service: service)),
      );
      expect(calls, hasLength(1));
      await tester.pumpAndSettle();
      expect(find.text('First Page'), findsOneWidget);
      expect(
        find.text('51 results • Page 1 of 2 • 50 per page'),
        findsOneWidget,
      );

      await tester.ensureVisible(
        find.byKey(const ValueKey<String>('pagination-next')),
      );
      await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
      await tester.pumpAndSettle();
      expect(find.text('First Page'), findsNothing);
      expect(find.text('Second Page'), findsOneWidget);

      await tester.ensureVisible(
        find.byKey(const ValueKey<String>('pagination-previous')),
      );
      await tester.tap(
        find.byKey(const ValueKey<String>('pagination-previous')),
      );
      await tester.pumpAndSettle();
      expect(find.text('First Page'), findsOneWidget);

      await tester.ensureVisible(
        find.byKey(const ValueKey<String>('pagination-last')),
      );
      await tester.tap(find.byKey(const ValueKey<String>('pagination-last')));
      await tester.pumpAndSettle();
      expect(find.text('Last Page'), findsOneWidget);

      final beforeRefresh = calls.length;
      await tester.tap(
        find.byKey(const ValueKey<String>('paged-directory-refresh')),
      );
      await tester.pumpAndSettle();
      expect(calls, hasLength(beforeRefresh + 1));
    },
  );

  testWidgets(
    'all six Users modes submit globally and draft criteria cannot relabel results',
    (tester) async {
      final criteria = <Map<String, Object?>>[];
      final service = RatingAdminPeoplePagingService(
        functionsBoundary: (name, request) async {
          criteria.add(Map<String, Object?>.from(request['criteria']! as Map));
          return page(
            items: <Object?>[
              user('server-uid', 'Server Controlled Result', more: true),
            ],
            unknownTotal:
                request['criteria'] is Map &&
                (request['criteria']! as Map)['mode'] == 'claimedRestaurant',
          );
        },
      );
      await tester.pumpWidget(
        host(RatingAdminUsersPagedView(service: service)),
      );
      await tester.pumpAndSettle();
      expect(criteria.single, <String, Object?>{'mode': 'viewAll'});

      for (final mode in RatingAdminUserSearchMode.values.skip(1)) {
        await selectUserMode(tester, mode);
        await tester.enterText(
          find.byKey(const ValueKey<String>('rating-admin-user-search-value')),
          'query-${mode.wireName}',
        );
        if (mode == RatingAdminUserSearchMode.email) {
          expect(find.textContaining('Showing: Email'), findsNothing);
        }
        await tester.tap(
          find.byKey(const ValueKey<String>('rating-admin-user-search-submit')),
        );
        await tester.pumpAndSettle();
        expect(criteria.last, <String, Object?>{
          'mode': mode.wireName,
          'value': 'query-${mode.wireName}',
        });
        expect(
          find.text('Showing: ${mode.label}: query-${mode.wireName}'),
          findsOneWidget,
        );
        expect(find.text('Server Controlled Result'), findsOneWidget);
      }

      expect(find.textContaining('+ more'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey<String>('rating-admin-user-search-clear')),
      );
      await tester.pumpAndSettle();
      expect(criteria.last, <String, Object?>{'mode': 'viewAll'});
      expect(find.text('Showing: View All'), findsOneWidget);
    },
  );

  testWidgets(
    'Users suppresses duplicate Search and ignores stale old criteria',
    (tester) async {
      final firstSearch = Completer<Object?>();
      var displayCalls = 0;
      final service = RatingAdminPeoplePagingService(
        functionsBoundary: (name, request) {
          final criteria = request['criteria']! as Map;
          if (criteria['mode'] == 'viewAll') {
            return Future<Object?>.value(
              page(items: <Object?>[user('initial', 'Initial')]),
            );
          }
          displayCalls += 1;
          if (criteria['value'] == 'old') return firstSearch.future;
          return Future<Object?>.value(
            page(items: <Object?>[user('new', 'New Result')]),
          );
        },
      );
      await tester.pumpWidget(
        host(RatingAdminUsersPagedView(service: service)),
      );
      await tester.pumpAndSettle();
      await selectUserMode(tester, RatingAdminUserSearchMode.displayName);
      final field = find.byKey(
        const ValueKey<String>('rating-admin-user-search-value'),
      );
      await tester.enterText(field, 'old');
      await tester.tap(
        find.byKey(const ValueKey<String>('rating-admin-user-search-submit')),
      );
      await tester.pump();
      await tester.tap(
        find.byKey(const ValueKey<String>('rating-admin-user-search-submit')),
        warnIfMissed: false,
      );
      expect(displayCalls, 1);

      await tester.enterText(field, 'new');
      firstSearch.complete(page(items: <Object?>[user('old', 'Old Result')]));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey<String>('rating-admin-user-search-submit')),
      );
      await tester.pumpAndSettle();
      expect(find.text('New Result'), findsOneWidget);
      expect(find.text('Old Result'), findsNothing);
    },
  );

  testWidgets(
    'claimed continuation error stops and Retry starts one fresh chain',
    (tester) async {
      var logicalNextCalls = 0;
      var continuationCalls = 0;
      final service = RatingAdminPeoplePagingService(
        functionsBoundary: (name, request) async {
          expect(name, 'searchRatingAdminUsersPage');
          final criteria = request['criteria']! as Map;
          if (criteria['mode'] == 'viewAll') {
            return page(items: <Object?>[user('initial', 'Initial')]);
          }
          if (request['direction'] == 'first') {
            return page(
              items: <Object?>[user('claimed-1', 'Claimed Page One')],
              hasNext: true,
              unknownTotal: true,
            );
          }
          final cursor = request['cursor'];
          if (cursor == 'next-1') {
            logicalNextCalls++;
            return preparingUsersPage(
              items: <Object?>[user('claimed-2', 'Claimed Page Two')],
              nextCursor: logicalNextCalls == 1
                  ? 'continuation-fail'
                  : 'continuation-retry',
              hasPrevious: true,
            );
          }
          continuationCalls++;
          if (cursor == 'continuation-fail') {
            throw StateError('bounded continuation failure');
          }
          expect(cursor, 'continuation-retry');
          return readyUsersPage(pageNumber: 2);
        },
      );

      await tester.pumpWidget(
        host(RatingAdminUsersPagedView(service: service)),
      );
      await tester.pumpAndSettle();
      await selectUserMode(tester, RatingAdminUserSearchMode.claimedRestaurant);
      await tester.enterText(
        find.byKey(const ValueKey<String>('rating-admin-user-search-value')),
        'river',
      );
      await tester.tap(
        find.byKey(const ValueKey<String>('rating-admin-user-search-submit')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Claimed Page One'), findsOneWidget);

      await tester.ensureVisible(
        find.byKey(const ValueKey<String>('pagination-next')),
      );
      await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
      await tester.pumpAndSettle();
      expect(logicalNextCalls, 1);
      expect(continuationCalls, 1);
      expect(find.text('Claimed Page One'), findsOneWidget);
      expect(find.text('Claimed Page Two'), findsNothing);
      expect(
        find.byKey(const ValueKey<String>('paged-directory-inline-error')),
        findsOneWidget,
      );
      expect(find.text('No matching user records found.'), findsNothing);

      final callsAtError = logicalNextCalls + continuationCalls;
      await tester.pump(const Duration(seconds: 3));
      expect(logicalNextCalls + continuationCalls, callsAtError);

      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();
      expect(logicalNextCalls, 2);
      expect(continuationCalls, 2);
      expect(find.text('Claimed Page One'), findsNothing);
      expect(find.text('Claimed Page Two'), findsOneWidget);
      expect(
        find.byKey(const ValueKey<String>('paged-directory-inline-error')),
        findsNothing,
      );
    },
  );

  testWidgets('claimed exhaustion retains page one without a fake Next page', (
    tester,
  ) async {
    var claimedCalls = 0;
    final service = RatingAdminPeoplePagingService(
      functionsBoundary: (name, request) async {
        expect(name, 'searchRatingAdminUsersPage');
        final criteria = request['criteria']! as Map;
        if (criteria['mode'] == 'viewAll') {
          return page(items: <Object?>[user('initial', 'Initial')]);
        }
        claimedCalls++;
        if (request['cursor'] == 'all-one-exhaustion') {
          return readyUsersPage(pageNumber: 1);
        }
        expect(request['direction'], 'first');
        return preparingUsersPage(
          items: <Object?>[user('only-owner', 'Only Claimed Owner')],
          nextCursor: 'all-one-exhaustion',
        );
      },
    );

    await tester.pumpWidget(host(RatingAdminUsersPagedView(service: service)));
    await tester.pumpAndSettle();
    await selectUserMode(tester, RatingAdminUserSearchMode.claimedRestaurant);
    await tester.enterText(
      find.byKey(const ValueKey<String>('rating-admin-user-search-value')),
      'river',
    );
    await tester.tap(
      find.byKey(const ValueKey<String>('rating-admin-user-search-submit')),
    );
    await tester.pumpAndSettle();

    expect(claimedCalls, 2);
    expect(find.text('Only Claimed Owner'), findsOneWidget);
    expect(find.text('Total unknown • Page 1 • 50 per page'), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('pagination-next')), findsNothing);
    expect(
      find.byKey(const ValueKey<String>('pagination-page-2')),
      findsNothing,
    );
  });

  testWidgets('new criteria cancel a delayed claimed continuation chain', (
    tester,
  ) async {
    final delayedOldPage = Completer<Object?>();
    var oldFollowCalls = 0;
    final service = RatingAdminPeoplePagingService(
      functionsBoundary: (name, request) {
        expect(name, 'searchRatingAdminUsersPage');
        final criteria = request['criteria']! as Map;
        if (criteria['mode'] == 'viewAll') {
          return Future<Object?>.value(
            page(items: <Object?>[user('initial', 'Initial')]),
          );
        }
        if (criteria['value'] == 'replacement') {
          return Future<Object?>.value(
            page(
              items: <Object?>[user('replacement', 'Replacement Result')],
              unknownTotal: true,
            ),
          );
        }
        if (request['cursor'] == 'old-follow') {
          oldFollowCalls++;
          return Future<Object?>.value(readyUsersPage(pageNumber: 2));
        }
        if (request['direction'] == 'forward') return delayedOldPage.future;
        return Future<Object?>.value(
          page(
            items: <Object?>[user('old-1', 'Old Claimed Page')],
            hasNext: true,
            unknownTotal: true,
          ),
        );
      },
    );

    await tester.pumpWidget(host(RatingAdminUsersPagedView(service: service)));
    await tester.pumpAndSettle();
    await selectUserMode(tester, RatingAdminUserSearchMode.claimedRestaurant);
    final searchField = find.byKey(
      const ValueKey<String>('rating-admin-user-search-value'),
    );
    await tester.enterText(searchField, 'old');
    await tester.tap(
      find.byKey(const ValueKey<String>('rating-admin-user-search-submit')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
    await tester.pump();

    await tester.enterText(searchField, 'replacement');
    await tester.tap(
      find.byKey(const ValueKey<String>('rating-admin-user-search-submit')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Replacement Result'), findsOneWidget);

    delayedOldPage.complete(
      preparingUsersPage(items: const <Object?>[], nextCursor: 'old-follow'),
    );
    await tester.pumpAndSettle();
    expect(oldFollowCalls, 0);
    expect(find.text('Replacement Result'), findsOneWidget);
    expect(find.text('Old Claimed Page'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('disposing Users cancels a delayed claimed continuation chain', (
    tester,
  ) async {
    final delayedPage = Completer<Object?>();
    var followCalls = 0;
    final service = RatingAdminPeoplePagingService(
      functionsBoundary: (name, request) {
        final criteria = request['criteria']! as Map;
        if (criteria['mode'] == 'viewAll') {
          return Future<Object?>.value(
            page(items: <Object?>[user('initial', 'Initial')]),
          );
        }
        if (request['cursor'] == 'dispose-follow') {
          followCalls++;
          return Future<Object?>.value(readyUsersPage(pageNumber: 2));
        }
        if (request['direction'] == 'forward') return delayedPage.future;
        return Future<Object?>.value(
          page(
            items: <Object?>[user('dispose-1', 'Dispose Page')],
            hasNext: true,
            unknownTotal: true,
          ),
        );
      },
    );

    await tester.pumpWidget(host(RatingAdminUsersPagedView(service: service)));
    await tester.pumpAndSettle();
    await selectUserMode(tester, RatingAdminUserSearchMode.claimedRestaurant);
    await tester.enterText(
      find.byKey(const ValueKey<String>('rating-admin-user-search-value')),
      'river',
    );
    await tester.tap(
      find.byKey(const ValueKey<String>('rating-admin-user-search-submit')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
    await tester.pump();

    await tester.pumpWidget(const SizedBox.shrink());
    delayedPage.complete(
      preparingUsersPage(
        items: const <Object?>[],
        nextCursor: 'dispose-follow',
      ),
    );
    await tester.pumpAndSettle();
    expect(followCalls, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Users preserves details and exact-UID deletion actions', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(800, 1000);
    addTearDown(tester.view.reset);
    BiteScoreAdminUserEntry? deleted;
    var usersCalls = 0;
    final service = RatingAdminPeoplePagingService(
      functionsBoundary: (name, request) async {
        usersCalls++;
        return page(
          items: <Object?>[
            user(
              'exact-action-uid',
              usersCalls == 1 ? 'Action User' : 'Refreshed Action User',
            ),
          ],
        );
      },
    );
    await tester.pumpWidget(
      host(
        RatingAdminUsersPagedView(
          service: service,
          deleteUserRecords: (user) async => deleted = user,
        ),
      ),
    );
    await tester.pumpAndSettle();
    final details = find.widgetWithIcon(IconButton, Icons.info_outline);
    await tester.ensureVisible(details);
    await tester.tap(details);
    await tester.pumpAndSettle();
    expect(find.textContaining('UID: exact-action-uid'), findsWidgets);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    final delete = find.widgetWithIcon(IconButton, Icons.delete_outline);
    await tester.ensureVisible(delete);
    await tester.tap(delete);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete Records'));
    await tester.pumpAndSettle();
    expect(deleted?.uid, 'exact-action-uid');
    expect(usersCalls, 2);
    expect(find.text('Action User'), findsNothing);
    expect(find.text('Refreshed Action User'), findsOneWidget);
  });

  testWidgets('delayed Delete cannot refresh replacement search criteria', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(800, 1000);
    addTearDown(tester.view.reset);
    final deletion = Completer<void>();
    final criteriaCalls = <Map<String, Object?>>[];
    BiteScoreAdminUserEntry? deleted;
    final service = RatingAdminPeoplePagingService(
      functionsBoundary: (name, request) async {
        final criteria = Map<String, Object?>.from(request['criteria']! as Map);
        criteriaCalls.add(criteria);
        if (criteria['mode'] == 'viewAll') {
          return page(items: <Object?>[user('delete-origin', 'Delete Origin')]);
        }
        return page(
          items: <Object?>[
            user('replacement-user', 'Replacement Search Result'),
          ],
        );
      },
    );

    await tester.pumpWidget(
      host(
        RatingAdminUsersPagedView(
          service: service,
          deleteUserRecords: (user) {
            deleted = user;
            return deletion.future;
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    final delete = find.widgetWithIcon(IconButton, Icons.delete_outline);
    await tester.ensureVisible(delete);
    await tester.tap(delete);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete Records'));
    await tester.pump();

    await selectUserMode(tester, RatingAdminUserSearchMode.displayName);
    await tester.enterText(
      find.byKey(const ValueKey<String>('rating-admin-user-search-value')),
      'replacement',
    );
    await tester.tap(
      find.byKey(const ValueKey<String>('rating-admin-user-search-submit')),
    );
    await tester.pumpAndSettle();
    final callsBeforeDeleteCompletes = criteriaCalls.length;
    expect(find.text('Replacement Search Result'), findsOneWidget);

    deletion.complete();
    await tester.pumpAndSettle();
    expect(deleted?.uid, 'delete-origin');
    expect(criteriaCalls, hasLength(callsBeforeDeleteCompletes));
    expect(
      criteriaCalls.where((criteria) => criteria['mode'] == 'displayName'),
      hasLength(1),
    );
    expect(find.text('Replacement Search Result'), findsOneWidget);
    expect(find.text('Delete Origin'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('disposing Users while Delete awaits prevents stale refresh', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(800, 1000);
    addTearDown(tester.view.reset);
    final deletion = Completer<void>();
    var usersCalls = 0;
    BiteScoreAdminUserEntry? deleted;
    final service = RatingAdminPeoplePagingService(
      functionsBoundary: (name, request) async {
        usersCalls++;
        return page(items: <Object?>[user('dispose-delete', 'Dispose Delete')]);
      },
    );

    await tester.pumpWidget(
      host(
        RatingAdminUsersPagedView(
          service: service,
          deleteUserRecords: (user) {
            deleted = user;
            return deletion.future;
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    final delete = find.widgetWithIcon(IconButton, Icons.delete_outline);
    await tester.ensureVisible(delete);
    await tester.tap(delete);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete Records'));
    await tester.pump();

    await tester.pumpWidget(const SizedBox.shrink());
    deletion.complete();
    await tester.pumpAndSettle();

    expect(deleted?.uid, 'dispose-delete');
    expect(usersCalls, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Users page error retries only the failed bounded request', (
    tester,
  ) async {
    var calls = 0;
    final service = RatingAdminPeoplePagingService(
      functionsBoundary: (name, request) async {
        calls += 1;
        if (calls == 1) throw StateError('bounded failure');
        return page(items: <Object?>[user('retry-user', 'Retry User')]);
      },
    );
    await tester.pumpWidget(host(RatingAdminUsersPagedView(service: service)));
    await tester.pumpAndSettle();
    expect(find.text('Try Again'), findsOneWidget);
    await tester.tap(find.text('Try Again'));
    await tester.pumpAndSettle();
    expect(find.text('Retry User'), findsOneWidget);
    expect(calls, 2);
  });

  testWidgets(
    'User Points is paged, all sorts reset page one, and pages replace',
    (tester) async {
      final calls = <Map<String, Object?>>[];
      final service = RatingAdminPeoplePagingService(
        functionsBoundary: (name, request) async {
          if (name != 'listRatingAdminUserPointsPage') {
            return page(items: const <Object?>[]);
          }
          calls.add(request);
          return switch (request['direction']) {
            'forward' => page(
              items: <Object?>[points('points-2', 'Points Page Two', 2)],
              pageNumber: 2,
              total: 51,
              hasPrevious: true,
            ),
            'backward' => page(
              items: <Object?>[points('points-1', 'Points Page One', 1)],
              total: 51,
              hasNext: true,
            ),
            'last' => page(
              items: <Object?>[points('points-last', 'Points Last', 3)],
              pageNumber: 2,
              total: 51,
              hasPrevious: true,
            ),
            _ => page(
              items: <Object?>[points('points-1', 'Points Page One', 1)],
              total: 51,
              hasNext: true,
            ),
          };
        },
      );
      await tester.pumpWidget(
        host(RatingAdminUserPointsPagedView(service: service)),
      );
      await tester.pumpAndSettle();
      expect(calls.single['criteria'], <String, Object?>{'sort': 'mostPoints'});
      await tester.ensureVisible(
        find.byKey(const ValueKey<String>('pagination-next')),
      );
      await tester.ensureVisible(
        find.byKey(const ValueKey<String>('pagination-next')),
      );
      await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
      await tester.pumpAndSettle();
      expect(find.text('Points Page One'), findsNothing);
      expect(find.text('Points Page Two'), findsOneWidget);
      await tester.ensureVisible(
        find.byKey(const ValueKey<String>('pagination-previous')),
      );
      await tester.tap(
        find.byKey(const ValueKey<String>('pagination-previous')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Points Page One'), findsOneWidget);
      await tester.ensureVisible(
        find.byKey(const ValueKey<String>('pagination-last')),
      );
      await tester.tap(find.byKey(const ValueKey<String>('pagination-last')));
      await tester.pumpAndSettle();
      expect(find.text('Points Last'), findsOneWidget);

      for (final sort in RatingAdminUserPointsSort.values.skip(1)) {
        await selectPointsSort(tester, sort);
        expect(calls.last['criteria'], <String, Object?>{
          'sort': sort.wireName,
        });
        expect(calls.last['direction'], 'first');
      }
    },
  );

  testWidgets(
    'ledger is lazy, user-scoped, paged, refreshable, and retains exact entry IDs',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(800, 1000);
      addTearDown(tester.view.reset);
      final ledgerCalls = <Map<String, Object?>>[];
      final service = RatingAdminPeoplePagingService(
        functionsBoundary: (name, request) async {
          if (name == 'listRatingAdminUserPointsPage') {
            return page(items: <Object?>[points('user-a', 'Points A', 5)]);
          }
          ledgerCalls.add(request);
          return switch (request['direction']) {
            'forward' => page(
              items: <Object?>[ledger('exact-entry-page-2', 'user-a')],
              pageNumber: 2,
              total: 51,
              hasPrevious: true,
            ),
            'backward' => page(
              items: <Object?>[ledger('exact-entry-page-1', 'user-a')],
              total: 51,
              hasNext: true,
            ),
            'last' => page(
              items: <Object?>[ledger('exact-entry-last', 'user-a')],
              pageNumber: 2,
              total: 51,
              hasPrevious: true,
            ),
            _ => page(
              items: <Object?>[ledger('exact-entry-page-1', 'user-a')],
              total: 51,
              hasNext: true,
            ),
          };
        },
      );
      await tester.pumpWidget(
        host(RatingAdminUserPointsPagedView(service: service)),
      );
      await tester.pumpAndSettle();
      expect(ledgerCalls, isEmpty);
      await tester.tap(find.text('Points A'));
      await tester.pumpAndSettle();
      expect(ledgerCalls.single['criteria'], <String, Object?>{
        'userId': 'user-a',
      });
      expect(
        find.byKey(
          const ValueKey<String>(
            'rating-admin-ledger-entry-exact-entry-page-1',
          ),
        ),
        findsOneWidget,
      );
      for (final privateCanary in <String>[
        'ledger-action-private-canary',
        'ledger-source-private-canary',
        'ledger-status-private-canary',
        'ledger-internal-private-canary',
      ]) {
        expect(find.textContaining(privateCanary), findsNothing);
      }
      await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
      await tester.pumpAndSettle();
      expect(find.text('Ledger exact-entry-page-1'), findsNothing);
      expect(find.text('Ledger exact-entry-page-2'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey<String>('pagination-previous')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Ledger exact-entry-page-1'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey<String>('pagination-last')));
      await tester.pumpAndSettle();
      expect(find.text('Ledger exact-entry-last'), findsOneWidget);
      final beforeRefresh = ledgerCalls.length;
      final refresh = find.descendant(
        of: find.byKey(const ValueKey<String>('rating-admin-ledger-user-a')),
        matching: find.byKey(const ValueKey<String>('paged-directory-refresh')),
      );
      await tester.ensureVisible(refresh);
      await tester.tap(refresh);
      await tester.pumpAndSettle();
      expect(ledgerCalls, hasLength(beforeRefresh + 1));
    },
  );

  testWidgets(
    'User Points and ledger errors each retry their bounded request',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(800, 1000);
      addTearDown(tester.view.reset);
      var pointsCalls = 0;
      var ledgerCalls = 0;
      final service = RatingAdminPeoplePagingService(
        functionsBoundary: (name, request) async {
          if (name == 'listRatingAdminUserPointsPage') {
            pointsCalls += 1;
            if (pointsCalls == 1) throw StateError('points failure');
            return page(
              items: <Object?>[points('retry-points', 'Retry Points', 3)],
            );
          }
          ledgerCalls += 1;
          if (ledgerCalls == 1) throw StateError('ledger failure');
          return page(items: <Object?>[ledger('retry-ledger', 'retry-points')]);
        },
      );
      await tester.pumpWidget(
        host(RatingAdminUserPointsPagedView(service: service)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Try Again'), findsOneWidget);
      await tester.tap(find.text('Try Again'));
      await tester.pumpAndSettle();
      expect(find.text('Retry Points'), findsOneWidget);
      await tester.tap(find.text('Retry Points'));
      await tester.pumpAndSettle();
      expect(find.text('Try Again'), findsOneWidget);
      await tester.tap(find.text('Try Again'));
      await tester.pumpAndSettle();
      expect(find.text('Ledger retry-ledger'), findsOneWidget);
      expect(pointsCalls, 2);
      expect(ledgerCalls, 2);
    },
  );

  testWidgets(
    'User A ledger cannot install under B and collapse invalidates stale work',
    (tester) async {
      final a = Completer<Object?>();
      final b = Completer<Object?>();
      final service = RatingAdminPeoplePagingService(
        functionsBoundary: (name, request) {
          if (name == 'listRatingAdminUserPointsPage') {
            return Future<Object?>.value(
              page(
                items: <Object?>[
                  points('user-b', 'Points B', 4),
                  points('user-a', 'Points A', 5),
                ],
                total: 2,
              ),
            );
          }
          final userId = (request['criteria']! as Map)['userId'];
          return userId == 'user-a' ? a.future : b.future;
        },
      );
      await tester.pumpWidget(
        host(RatingAdminUserPointsPagedView(service: service)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Points A'));
      await tester.pump();
      await tester.ensureVisible(find.text('Points B'));
      await tester.tap(find.text('Points B'));
      await tester.pump();
      a.complete(page(items: <Object?>[ledger('entry-a', 'user-a')]));
      await tester.pump();
      expect(find.text('Ledger entry-a'), findsNothing);
      await tester.tap(find.text('Points B'));
      await tester.pump();
      b.complete(page(items: <Object?>[ledger('entry-b', 'user-b')]));
      await tester.pumpAndSettle();
      expect(find.text('Ledger entry-a'), findsNothing);
      expect(find.text('Ledger entry-b'), findsNothing);
    },
  );

  testWidgets(
    'responsive people views have no overflow at required widths and scales',
    (tester) async {
      final service = RatingAdminPeoplePagingService(
        functionsBoundary: (name, request) async {
          if (name == 'searchRatingAdminUsersPage') {
            return page(
              items: <Object?>[
                user('responsive-user', 'Responsive User', more: true),
              ],
            );
          }
          if (name == 'listRatingAdminUserPointsPage') {
            return page(
              items: <Object?>[
                points('responsive-user', 'Responsive User', 12),
              ],
            );
          }
          return page(items: const <Object?>[]);
        },
      );
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      for (final width in <double>[320, 390, 1280]) {
        tester.view.physicalSize = Size(width, 1000);
        for (final scale in <double>[1, 1.5, 2]) {
          await tester.pumpWidget(
            host(
              RatingAdminUsersPagedView(service: service),
              width: width,
              scale: scale,
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: 'Users $width/$scale');
          await tester.pumpWidget(
            host(
              RatingAdminUserPointsPagedView(service: service),
              width: width,
              scale: scale,
            ),
          );
          await tester.pumpAndSettle();
          expect(
            tester.takeException(),
            isNull,
            reason: 'Points $width/$scale',
          );
        }
      }
    },
  );
}
