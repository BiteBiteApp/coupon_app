import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/models/rating_admin_people_paging_models.dart';
import 'package:coupon_app/services/rating_admin_people_paging_service.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, Object?> _page(Object item) => <String, Object?>{
  'protocolVersion': pageProtocolVersion,
  'items': <Object?>[item],
  'pageSize': 50,
  'hasNext': false,
  'hasPrevious': false,
  'currentPageNumber': 1,
  'total': <String, Object?>{'state': 'exact', 'value': 1},
  'queryFingerprint': List<String>.filled(64, '0').join(),
  'snapshotTimestampMs': 1,
  'capabilities': <String, Object?>{
    'first': false,
    'previous': false,
    'numberedVisitedPages': true,
    'next': false,
    'last': false,
  },
};

Map<String, Object?> _user() => <String, Object?>{
  'uid': 'exact-user-id',
  'displayName': 'Duplicate Name',
  'email': 'user@example.test',
  'phoneNumber': '+13525550100',
  'claimedRestaurantNames': <Object?>['Alpha Cafe'],
  'hasMoreClaimedRestaurants': true,
  'hasRestaurantAccount': true,
  'hasBiteScoreOwnership': true,
  'isAdmin': false,
  'isEmailVerified': true,
  'restaurantAccountStatus': 'approved',
  'activityTags': <Object?>['Claims', 'Reviews'],
};

Map<String, Object?> _points() => <String, Object?>{
  'userId': 'exact-user-id',
  'displayName': 'Duplicate Name',
  'totalPoints': 12,
  'lastActivityAtMillis': null,
};

Map<String, Object?> _ledger() => <String, Object?>{
  'id': 'exact-ledger-id',
  'userId': 'exact-user-id',
  'pointsDelta': 1,
  'description': 'Added a dish',
  'dishId': 'dish-id',
  'dishName': 'Dish',
  'restaurantId': 'restaurant-id',
  'restaurantName': 'Restaurant',
  'restaurantCity': 'Orlando',
  'restaurantState': 'FL',
  'restaurantAddress': '1 Main St',
  'restaurantPhone': '+13525550100',
  'requestId': 'request-id',
  'reason': null,
  'createdAtMillis': 1,
};

Map<String, Object?> _usersPage({
  List<Object?> items = const <Object?>[],
  int pageNumber = 1,
  bool hasNext = false,
  bool hasPrevious = false,
  String? nextCursor,
  String? previousCursor,
  String? preparationState,
  String? fingerprint,
}) => <String, Object?>{
  'protocolVersion': pageProtocolVersion,
  'items': items,
  'pageSize': 50,
  'hasNext': hasNext,
  'hasPrevious': hasPrevious,
  'nextCursor': ?nextCursor,
  'previousCursor': ?previousCursor,
  'currentPageNumber': pageNumber,
  'total': <String, Object?>{'state': 'unknown'},
  'queryFingerprint': fingerprint ?? List<String>.filled(64, '0').join(),
  'snapshotTimestampMs': pageNumber,
  'capabilities': <String, Object?>{
    'first': pageNumber > 1,
    'previous': hasPrevious,
    'numberedVisitedPages': true,
    'next': hasNext,
    'last': false,
  },
  if (preparationState != null)
    'preparation': <String, Object?>{
      'state': preparationState,
      'completedUnits': 0,
    },
};

PagedRequest _request(
  Map<String, Object?> criteria, {
  PageDirection direction = PageDirection.first,
  String? cursor,
}) => PagedRequest(
  pageSize: 50,
  criteria: criteria,
  cursor: cursor,
  direction: direction,
  requestExactCount: true,
  clientRequestId: 'test-request',
);

void main() {
  test('uses the exact three callable names and strict request maps', () async {
    final calls = <(String, Map<String, Object?>)>[];
    final service = RatingAdminPeoplePagingService(
      functionsBoundary: (name, request) async {
        calls.add((name, request));
        return switch (name) {
          'searchRatingAdminUsersPage' => _page(_user()),
          'listRatingAdminUserPointsPage' => _page(_points()),
          'listRatingAdminContributionLedgerPage' => _page(_ledger()),
          _ => throw StateError(name),
        };
      },
    );

    final users = await service.loadUsersPage(
      _request(<String, Object?>{'mode': 'uid', 'value': 'exact-user-id'}),
    );
    final points = await service.loadUserPointsPage(
      _request(<String, Object?>{'sort': 'mostPoints'}),
    );
    final ledger = await service.loadContributionLedgerPage(
      _request(<String, Object?>{'userId': 'exact-user-id'}),
    );

    expect(calls.map((call) => call.$1), <String>[
      'searchRatingAdminUsersPage',
      'listRatingAdminUserPointsPage',
      'listRatingAdminContributionLedgerPage',
    ]);
    expect(
      calls.every((call) => call.$2['protocolVersion'] == pageProtocolVersion),
      isTrue,
    );
    expect(users.items.single.uid, 'exact-user-id');
    expect(users.items.single.claimedRestaurantNames, <String>['Alpha Cafe']);
    expect(points.items.single.lastActivityAt, isNull);
    expect(ledger.items.single.id, 'exact-ledger-id');
    expect(ledger.items.single.description, 'Added a dish');
  });

  test(
    'claimed logical loader consumes preparation chunks and merges terminal metadata',
    () async {
      final calls = <Map<String, Object?>>[];
      final service = RatingAdminPeoplePagingService(
        functionsBoundary: (name, request) async {
          expect(name, 'searchRatingAdminUsersPage');
          calls.add(request);
          return switch (calls.length) {
            1 => _usersPage(
              items: <Object?>[_user()],
              pageNumber: 1,
              hasNext: true,
              hasPrevious: true,
              nextCursor: 'raw-continuation-1',
              previousCursor: 'logical-previous',
              preparationState: 'preparing',
            ),
            2 => _usersPage(
              pageNumber: 1,
              hasNext: true,
              nextCursor: 'raw-continuation-2',
              preparationState: 'preparing',
            ),
            3 => _usersPage(pageNumber: 2, preparationState: 'ready'),
            _ => throw StateError('Unexpected continuation request.'),
          };
        },
      );

      final result = await service.loadLogicalUsersPage(
        _request(
          <String, Object?>{'mode': 'claimedRestaurant', 'value': 'alpha'},
          direction: PageDirection.forward,
          cursor: 'logical-next',
        ),
        canContinue: () => true,
      );

      expect(calls, hasLength(3));
      expect(calls.map((call) => call['direction']), <Object?>[
        'forward',
        'forward',
        'forward',
      ]);
      expect(calls.map((call) => call['cursor']), <Object?>[
        'logical-next',
        'raw-continuation-1',
        'raw-continuation-2',
      ]);
      expect(calls[1]['clientRequestId'], 'test-request-continuation-1');
      expect(
        calls[2]['clientRequestId'],
        'test-request-continuation-1-continuation-2',
      );
      expect(result.items.single.uid, 'exact-user-id');
      expect(result.pageNumber?.currentPageNumber, 2);
      expect(result.hasNext, isFalse);
      expect(result.hasPrevious, isTrue);
      expect(result.previousCursor, 'logical-previous');
      expect(result.preparation, isNull);
      expect(result.capabilities.first, isTrue);
      expect(result.capabilities.previous, isTrue);
      expect(result.capabilities.next, isFalse);
    },
  );

  test('claimed continuation transport error stops the chain', () async {
    var calls = 0;
    final service = RatingAdminPeoplePagingService(
      functionsBoundary: (name, request) async {
        calls++;
        if (calls == 1) {
          return _usersPage(
            items: <Object?>[_user()],
            hasNext: true,
            nextCursor: 'transport-error-cursor',
            preparationState: 'preparing',
          );
        }
        throw StateError('bounded transport failure');
      },
    );

    await expectLater(
      service.loadLogicalUsersPage(
        _request(<String, Object?>{
          'mode': 'claimedRestaurant',
          'value': 'alpha',
        }),
        canContinue: () => true,
      ),
      throwsA(isA<RatingAdminPeoplePagingException>()),
    );
    expect(calls, 2);
    await Future<void>.delayed(Duration.zero);
    expect(calls, 2);
  });

  test('claimed continuation rejects a repeated opaque cursor', () async {
    var calls = 0;
    final service = RatingAdminPeoplePagingService(
      functionsBoundary: (name, request) async {
        calls++;
        return _usersPage(
          items: calls == 1 ? <Object?>[_user()] : const <Object?>[],
          hasNext: true,
          nextCursor: 'repeated-cursor',
          preparationState: 'preparing',
        );
      },
    );

    await expectLater(
      service.loadLogicalUsersPage(
        _request(<String, Object?>{
          'mode': 'claimedRestaurant',
          'value': 'alpha',
        }),
        canContinue: () => true,
      ),
      throwsA(
        isA<RatingAdminPeoplePagingException>().having(
          (error) => error.message,
          'message',
          contains('invalid continuation'),
        ),
      ),
    );
    expect(calls, 2);
  });

  test('claimed continuation stops when its generation is replaced', () async {
    var calls = 0;
    var guardChecks = 0;
    final service = RatingAdminPeoplePagingService(
      functionsBoundary: (name, request) async {
        calls++;
        return _usersPage(
          items: <Object?>[_user()],
          hasNext: true,
          nextCursor: 'cancelled-cursor',
          preparationState: 'preparing',
        );
      },
    );

    await expectLater(
      service.loadLogicalUsersPage(
        _request(<String, Object?>{
          'mode': 'claimedRestaurant',
          'value': 'alpha',
        }),
        canContinue: () => ++guardChecks == 1,
      ),
      throwsA(
        isA<RatingAdminPeoplePagingException>().having(
          (error) => error.message,
          'message',
          contains('replaced'),
        ),
      ),
    );
    expect(calls, 1);
    expect(guardChecks, 2);
  });

  test('criteria builders trim values and preserve the six explicit modes', () {
    expect(
      RatingAdminPeoplePagingService.usersCriteria(
        mode: RatingAdminUserSearchMode.viewAll,
      ),
      <String, Object?>{'mode': 'viewAll'},
    );
    for (final mode in RatingAdminUserSearchMode.values.skip(1)) {
      expect(
        RatingAdminPeoplePagingService.usersCriteria(
          mode: mode,
          value: '  value  ',
        ),
        <String, Object?>{'mode': mode.wireName, 'value': 'value'},
      );
    }
    expect(
      () => RatingAdminPeoplePagingService.usersCriteria(
        mode: RatingAdminUserSearchMode.email,
        value: ' ',
      ),
      throwsA(isA<RatingAdminPeoplePagingException>()),
    );
  });

  test('strict item whitelists reject unknown private fields', () async {
    for (final value in <(String, Map<String, Object?>)>[
      (
        'searchRatingAdminUsersPage',
        <String, Object?>{..._user(), 'passwordHash': 'private'},
      ),
      (
        'listRatingAdminUserPointsPage',
        <String, Object?>{..._points(), 'profile': <String, Object?>{}},
      ),
      (
        'listRatingAdminContributionLedgerPage',
        <String, Object?>{..._ledger(), 'oauthToken': 'private'},
      ),
    ]) {
      final service = RatingAdminPeoplePagingService(
        functionsBoundary: (name, request) async => _page(value.$2),
      );
      final operation = switch (value.$1) {
        'searchRatingAdminUsersPage' => service.loadUsersPage(
          _request(<String, Object?>{'mode': 'viewAll'}),
        ),
        'listRatingAdminUserPointsPage' => service.loadUserPointsPage(
          _request(<String, Object?>{'sort': 'mostPoints'}),
        ),
        _ => service.loadContributionLedgerPage(
          _request(<String, Object?>{'userId': 'exact-user-id'}),
        ),
      };
      await expectLater(
        operation,
        throwsA(isA<RatingAdminPeoplePagingException>()),
      );
    }
  });

  test(
    'ledger parser rejects every retired and private canary field',
    () async {
      for (final field in <String>[
        'actionType',
        'sourceKey',
        'status',
        'internalLedgerCanary',
      ]) {
        final service = RatingAdminPeoplePagingService(
          functionsBoundary: (name, request) async => _page(<String, Object?>{
            ..._ledger(),
            field: 'must-not-cross-callable-boundary',
          }),
        );
        await expectLater(
          service.loadContributionLedgerPage(
            _request(<String, Object?>{'userId': 'exact-user-id'}),
          ),
          throwsA(isA<RatingAdminPeoplePagingException>()),
          reason: field,
        );
      }
    },
  );

  test(
    'contradictory page capabilities fail closed without cursor decoding',
    () async {
      final invalid = _page(_user())
        ..['hasNext'] = true
        ..['nextCursor'] = 'opaque-cursor'
        ..['capabilities'] = <String, Object?>{
          'first': false,
          'previous': false,
          'numberedVisitedPages': true,
          'next': false,
          'last': false,
        };
      final service = RatingAdminPeoplePagingService(
        functionsBoundary: (name, request) async => invalid,
      );
      await expectLater(
        service.loadUsersPage(_request(<String, Object?>{'mode': 'viewAll'})),
        throwsA(isA<RatingAdminPeoplePagingException>()),
      );
    },
  );

  test('duplicate display names remain separate exact UIDs', () {
    final first = RatingAdminUserRecord.fromJson(_user());
    final second = RatingAdminUserRecord.fromJson(<String, Object?>{
      ..._user(),
      'uid': 'second-exact-id',
    });
    expect(first.displayName, second.displayName);
    expect(first.uid, isNot(second.uid));
  });
}
