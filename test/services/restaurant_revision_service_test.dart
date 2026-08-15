import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/dish_rating_aggregate.dart';
import 'package:coupon_app/models/dish_review.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/services/restaurant_menu_service.dart';

String sourceSection(String source, String start, String end) {
  final startIndex = source.indexOf(start);
  final endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, greaterThanOrEqualTo(0), reason: start);
  expect(endIndex, greaterThan(startIndex), reason: end);
  return source.substring(startIndex, endIndex);
}

BitescoreRestaurant restaurant({
  String id = 'restaurant-1',
  String name = 'Root Kitchen',
  String phone = '555-0100',
  String city = 'Orlando',
  String state = 'FL',
  String zipCode = '32801',
  bool isActive = true,
  int revision = 4,
  DateTime? updatedAt,
}) => BitescoreRestaurant(
  id: id,
  name: name,
  normalizedName: name.toLowerCase(),
  address: '1 Main St',
  city: city,
  state: state,
  zipCode: zipCode,
  location: const GeoPoint(28.5, -81.3),
  phone: phone,
  cuisineTags: const <String>['American'],
  isActive: isActive,
  restaurantWriteRevision: revision,
  updatedAt: updatedAt,
);

BitescoreDish dish({
  String id = 'dish-1',
  String restaurantId = 'restaurant-1',
  bool isActive = true,
  String? mergedIntoDishId,
}) => BitescoreDish(
  id: id,
  restaurantId: restaurantId,
  restaurantName: 'Root Kitchen',
  name: 'House Burger',
  normalizedName: 'house burger',
  isActive: isActive,
  mergedIntoDishId: mergedIntoDishId,
);

DishReview review({
  String dishId = 'dish-1',
  String restaurantId = 'restaurant-1',
}) => DishReview(
  id: 'review-1',
  dishId: dishId,
  restaurantId: restaurantId,
  userId: 'reviewer-1',
  overallImpression: 8,
  overallBiteScore: 80,
);

BitescoreRestaurant parsedRestaurant({
  required String id,
  required String name,
  required Map<String, dynamic> activity,
  String city = 'Orlando',
  String state = 'FL',
}) {
  final data = <String, dynamic>{
    'name': name,
    'normalizedName': name.toLowerCase(),
    'address': '1 Main St',
    'city': city,
    'state': state,
    'zipCode': '32801',
    'location': const GeoPoint(28.5, -81.3),
    'restaurantWriteRevision': 4,
    ...activity,
  };
  return BitescoreRestaurant.tryFromFinderFirestore(data, fallbackId: id)!;
}

Map<String, dynamic> claimableRestaurantData({
  String id = 'restaurant-1',
  int revision = 4,
  Map<String, dynamic> fields = const <String, dynamic>{},
}) => <String, dynamic>{
  'id': id,
  'restaurantWriteRevision': revision,
  ...fields,
};

Map<String, dynamic> pendingClaimData({
  Object? id = 'claim-1',
  Object? restaurantId = 'restaurant-1',
  Object? requesterUserId = 'requester-1',
  Object? status = 'pending',
}) => <String, dynamic>{
  'id': id,
  'restaurantId': restaurantId,
  'restaurantName': 'Root Kitchen',
  'requesterUserId': requesterUserId,
  'claimantName': 'Claimant One',
  'email': 'claimant@example.com',
  'phone': '555-0101',
  'status': status,
};

TypeMatcher<ArgumentError> claimArgumentError(String message) =>
    isA<ArgumentError>().having((error) => error.message, 'message', message);

void main() {
  group('restaurant revision transaction guards', () {
    test('fresh expected revision advances exactly once', () {
      expect(
        BiteScoreService.nextExpectedRestaurantWriteRevisionForTesting(
          currentData: <String, dynamic>{'restaurantWriteRevision': 4},
          expectedRevision: 4,
        ),
        5,
      );
      expect(
        RestaurantMenuService.nextRestaurantWriteRevisionForTesting(
          currentData: <String, dynamic>{'restaurantWriteRevision': 4},
          expectedRevision: 4,
        ),
        5,
      );
    });

    test('stale full and partial action state fails refresh-required', () {
      for (final action in <int Function()>[
        () => BiteScoreService.nextExpectedRestaurantWriteRevisionForTesting(
          currentData: <String, dynamic>{'restaurantWriteRevision': 5},
          expectedRevision: 4,
        ),
        () => RestaurantMenuService.nextRestaurantWriteRevisionForTesting(
          currentData: <String, dynamic>{'restaurantWriteRevision': 5},
          expectedRevision: 4,
        ),
      ]) {
        expect(action, throwsA(isA<BiteScoreRestaurantChangedException>()));
      }
    });

    test('missing and malformed current state fails closed', () {
      for (final currentData in <Map<String, dynamic>>[
        <String, dynamic>{},
        <String, dynamic>{'restaurantWriteRevision': '4'},
        <String, dynamic>{'restaurantWriteRevision': -1},
        <String, dynamic>{'restaurantWriteRevision': 1.5},
      ]) {
        expect(
          () => BiteScoreService.nextExpectedRestaurantWriteRevisionForTesting(
            currentData: currentData,
            expectedRevision: 4,
          ),
          throwsA(isA<BiteScoreRestaurantWriteStateException>()),
        );
        expect(
          () => RestaurantMenuService.nextRestaurantWriteRevisionForTesting(
            currentData: currentData,
            expectedRevision: 4,
          ),
          throwsA(isA<BiteScoreRestaurantWriteStateException>()),
        );
      }
    });
  });

  group('BiteScore claim write boundary', () {
    test('direct claim accepts every strict active-unclaimed shape', () {
      final activityCases = <Map<String, dynamic>>[
        const <String, dynamic>{},
        const <String, dynamic>{'isActive': true},
        const <String, dynamic>{'active': true},
        const <String, dynamic>{'isActive': true, 'active': true},
      ];
      final ownershipCases = <Map<String, dynamic>>[
        const <String, dynamic>{},
        const <String, dynamic>{'isClaimed': false},
        const <String, dynamic>{'ownerUserId': null},
        const <String, dynamic>{'ownerUserId': ''},
        const <String, dynamic>{'isClaimed': false, 'ownerUserId': null},
        const <String, dynamic>{'isClaimed': false, 'ownerUserId': ''},
      ];

      for (final activity in activityCases) {
        for (final ownership in ownershipCases) {
          final data = claimableRestaurantData(
            fields: <String, dynamic>{...activity, ...ownership},
          );
          expect(
            () => BiteScoreService.requireRestaurantAvailableForClaimForTesting(
              data: data,
              restaurantDocumentId: 'restaurant-1',
            ),
            returnsNormally,
            reason: '$activity $ownership',
          );
        }
      }
    });

    test('direct claim fails closed for unavailable activity and identity', () {
      final unavailable = claimArgumentError(
        BiteScoreService.restaurantClaimUnavailableMessage,
      );
      final invalidData = <Map<String, dynamic>?>[
        null,
        claimableRestaurantData(id: 'other-restaurant'),
        claimableRestaurantData(fields: const {'isActive': false}),
        claimableRestaurantData(fields: const {'active': false}),
        claimableRestaurantData(
          fields: const {'isActive': true, 'active': false},
        ),
        claimableRestaurantData(fields: const {'isActive': 'true'}),
        claimableRestaurantData(fields: const {'active': null}),
      ];
      final missingIdentity = claimableRestaurantData()..remove('id');
      invalidData.add(missingIdentity);

      for (final data in invalidData) {
        expect(
          () => BiteScoreService.requireRestaurantAvailableForClaimForTesting(
            data: data,
            restaurantDocumentId: 'restaurant-1',
          ),
          throwsA(unavailable),
          reason: '$data',
        );
      }
    });

    test('direct claim rejects every malformed isClaimed type', () {
      final unavailable = claimArgumentError(
        BiteScoreService.restaurantClaimUnavailableMessage,
      );
      for (final value in <Object?>[
        true,
        null,
        0,
        'false',
        <String, Object?>{},
        <Object?>[],
      ]) {
        expect(
          () => BiteScoreService.requireRestaurantAvailableForClaimForTesting(
            data: claimableRestaurantData(fields: {'isClaimed': value}),
            restaurantDocumentId: 'restaurant-1',
          ),
          throwsA(unavailable),
          reason: 'isClaimed=$value',
        );
      }
    });

    test('direct claim rejects malformed owner and contradictory state', () {
      final unavailable = claimArgumentError(
        BiteScoreService.restaurantClaimUnavailableMessage,
      );
      for (final value in <Object?>[
        ' ',
        '\t',
        'owner-1',
        7,
        false,
        <String, Object?>{},
        <Object?>[],
      ]) {
        expect(
          () => BiteScoreService.requireRestaurantAvailableForClaimForTesting(
            data: claimableRestaurantData(fields: {'ownerUserId': value}),
            restaurantDocumentId: 'restaurant-1',
          ),
          throwsA(unavailable),
          reason: 'ownerUserId=$value',
        );
      }
      expect(
        () => BiteScoreService.requireRestaurantAvailableForClaimForTesting(
          data: claimableRestaurantData(
            fields: const {'isClaimed': false, 'ownerUserId': 'owner-1'},
          ),
          restaurantDocumentId: 'restaurant-1',
        ),
        throwsA(unavailable),
      );
      expect(
        () => BiteScoreService.requireRestaurantAvailableForClaimForTesting(
          data: claimableRestaurantData(
            fields: const {'isClaimed': true, 'ownerUserId': null},
          ),
          restaurantDocumentId: 'restaurant-1',
        ),
        throwsA(unavailable),
      );
    });

    test(
      'pending approval retains exact association and one revision step',
      () {
        expect(
          BiteScoreService.nextPendingClaimApprovalRevisionForTesting(
            restaurantData: claimableRestaurantData(
              fields: const {
                'isActive': true,
                'active': true,
                'isClaimed': false,
                'ownerUserId': null,
              },
            ),
            restaurantDocumentId: 'restaurant-1',
            expectedRestaurantRevision: 4,
            claimData: pendingClaimData(),
            claimDocumentId: 'claim-1',
            requesterUserId: 'requester-1',
          ),
          5,
        );
      },
    );

    test('pending approval checks hidden state before stale revision', () {
      expect(
        () => BiteScoreService.nextPendingClaimApprovalRevisionForTesting(
          restaurantData: claimableRestaurantData(
            revision: 5,
            fields: const {'isActive': false},
          ),
          restaurantDocumentId: 'restaurant-1',
          expectedRestaurantRevision: 4,
          claimData: pendingClaimData(),
          claimDocumentId: 'claim-1',
          requesterUserId: 'requester-1',
        ),
        throwsA(
          claimArgumentError(
            BiteScoreService.restaurantClaimUnavailableMessage,
          ),
        ),
      );
      expect(
        () => BiteScoreService.nextPendingClaimApprovalRevisionForTesting(
          restaurantData: claimableRestaurantData(revision: 5),
          restaurantDocumentId: 'restaurant-1',
          expectedRestaurantRevision: 4,
          claimData: pendingClaimData(),
          claimDocumentId: 'claim-1',
          requesterUserId: 'requester-1',
        ),
        throwsA(isA<BiteScoreRestaurantChangedException>()),
      );
    });

    test('pending approval rejects changed raw claim identity and status', () {
      final changedClaims = <Map<String, dynamic>>[
        pendingClaimData(id: 'other-claim'),
        pendingClaimData(restaurantId: 'other-restaurant'),
        pendingClaimData(requesterUserId: 'other-requester'),
        pendingClaimData(status: 'rejected'),
        pendingClaimData(status: ' pending '),
        pendingClaimData()..remove('email'),
      ];
      for (final claimData in changedClaims) {
        expect(
          () => BiteScoreService.nextPendingClaimApprovalRevisionForTesting(
            restaurantData: claimableRestaurantData(),
            restaurantDocumentId: 'restaurant-1',
            expectedRestaurantRevision: 4,
            claimData: claimData,
            claimDocumentId: 'claim-1',
            requesterUserId: 'requester-1',
          ),
          throwsA(isA<BiteScoreRestaurantChangedException>()),
          reason: '$claimData',
        );
      }
    });

    test(
      'only final permission denial is mapped to a private safe error',
      () async {
        final privateError = FirebaseException(
          plugin: 'cloud_firestore',
          code: 'permission-denied',
          message: 'private lock and revision details',
        );
        await expectLater(
          BiteScoreService.runControlledRestaurantClaimWriteForTesting<void>(
            () async => throw privateError,
          ),
          throwsA(
            claimArgumentError(
              BiteScoreService.restaurantClaimTemporarilyUnavailableMessage,
            ).having(
              (error) => error.toString(),
              'safe text',
              isNot(contains('private lock and revision details')),
            ),
          ),
        );

        final networkError = FirebaseException(
          plugin: 'cloud_firestore',
          code: 'unavailable',
        );
        await expectLater(
          BiteScoreService.runControlledRestaurantClaimWriteForTesting<void>(
            () async => throw networkError,
          ),
          throwsA(same(networkError)),
        );
        await expectLater(
          BiteScoreService.runControlledRestaurantClaimWriteForTesting<String>(
            () async => 'created',
          ),
          completion('created'),
        );
      },
    );
  });

  group('BiteScore hidden-state visibility', () {
    test(
      'customer Finder dedupes while Admin preserves every restaurant ID',
      () {
        final activeLegacy = parsedRestaurant(
          id: 'active-legacy',
          name: 'Alpha Cafe',
          activity: const <String, dynamic>{},
        );
        final activeCanonical = parsedRestaurant(
          id: 'active-canonical',
          name: 'Beta Cafe',
          city: 'Tampa',
          activity: const <String, dynamic>{'isActive': true},
        );
        final hidden = parsedRestaurant(
          id: 'hidden',
          name: 'Hidden Cafe',
          activity: const <String, dynamic>{'isActive': false},
        );
        final malformed = parsedRestaurant(
          id: 'malformed',
          name: 'Malformed Cafe',
          activity: const <String, dynamic>{'isActive': 'true'},
        );
        final conflicting = parsedRestaurant(
          id: 'conflicting',
          name: 'Conflicting Cafe',
          activity: const <String, dynamic>{'isActive': true, 'active': false},
        );
        final duplicateActive = activeLegacy.copyWith(id: 'duplicate-active');
        final duplicateHidden = activeLegacy.copyWith(
          id: 'duplicate-hidden',
          isActive: false,
        );
        final source = <BitescoreRestaurant>[
          activeCanonical,
          hidden,
          malformed,
          conflicting,
          activeLegacy,
          duplicateActive,
          duplicateHidden,
        ];

        final customer = BiteScoreService.customerRestaurantDirectoryForTesting(
          source,
        );
        final admin = BiteScoreService.adminRestaurantDirectoryForTesting(
          source,
        );

        expect(customer.map((entry) => entry.id), <String>[
          'active-legacy',
          'active-canonical',
        ]);
        expect(customer.every((entry) => entry.isActive), isTrue);
        expect(admin.map((entry) => entry.id).toSet(), <String>{
          'active-legacy',
          'active-canonical',
          'hidden',
          'malformed',
          'conflicting',
          'duplicate-active',
          'duplicate-hidden',
        });
        expect(
          admin
              .where((entry) => !entry.isActive)
              .map((entry) => entry.id)
              .toSet(),
          <String>{'hidden', 'malformed', 'conflicting', 'duplicate-hidden'},
        );
        expect(
          admin.map((entry) => '${entry.state}|${entry.city}|${entry.name}'),
          orderedEquals(
            [
              ...admin.map(
                (entry) => '${entry.state}|${entry.city}|${entry.name}',
              ),
            ]..sort(),
          ),
        );
      },
    );

    test(
      'customer home joins reject hidden parents and unavailable dishes',
      () {
        final activeRestaurant = restaurant();
        final hiddenRestaurant = restaurant(
          id: 'restaurant-hidden',
          name: 'Hidden Kitchen',
          isActive: false,
        );
        final visibleDish = dish();
        final hiddenParentDish = dish(
          id: 'dish-hidden-parent',
          restaurantId: hiddenRestaurant.id,
        );
        final hiddenDish = dish(id: 'dish-hidden', isActive: false);
        final mergedDish = dish(
          id: 'dish-merged',
          mergedIntoDishId: 'dish-survivor',
        );

        final entries = BiteScoreService.customerVisibleHomeEntriesForTesting(
          restaurants: <BitescoreRestaurant>[
            hiddenRestaurant,
            activeRestaurant,
          ],
          dishes: <BitescoreDish>[
            visibleDish,
            hiddenParentDish,
            hiddenDish,
            mergedDish,
          ],
          aggregates: const <String, DishRatingAggregate>{},
        );

        expect(entries.map((entry) => entry.dish.id), <String>['dish-1']);
        expect(entries.single.restaurant.id, activeRestaurant.id);
        expect(entries.single.aggregate.dishId, visibleDish.id);
      },
    );

    test(
      'review presentation requires a consistent active dish and parent',
      () {
        final activeRestaurant = restaurant();
        final activeDish = dish();
        BiteScoreUserReviewEntry entry({
          DishReview? sourceReview,
          BitescoreDish? sourceDish,
          BitescoreRestaurant? sourceRestaurant,
        }) => BiteScoreUserReviewEntry(
          review: sourceReview ?? review(),
          dish: sourceDish ?? activeDish,
          restaurant: sourceRestaurant ?? activeRestaurant,
        );

        expect(BiteScoreService.isCustomerVisibleReviewEntry(entry()), isTrue);
        expect(
          BiteScoreService.isCustomerVisibleReviewEntry(
            entry(sourceRestaurant: activeRestaurant.copyWith(isActive: false)),
          ),
          isFalse,
        );
        expect(
          BiteScoreService.isCustomerVisibleReviewEntry(
            entry(sourceDish: dish(isActive: false)),
          ),
          isFalse,
        );
        expect(
          BiteScoreService.isCustomerVisibleReviewEntry(
            entry(sourceDish: dish(mergedIntoDishId: 'dish-survivor')),
          ),
          isFalse,
        );
        expect(
          BiteScoreService.isCustomerVisibleReviewEntry(
            entry(sourceReview: review(restaurantId: 'other-restaurant')),
          ),
          isFalse,
        );
        expect(
          BiteScoreService.isCustomerVisibleReviewEntry(
            entry(sourceRestaurant: restaurant(id: 'other-restaurant')),
          ),
          isFalse,
        );
        expect(
          BiteScoreService.isCustomerVisibleReviewEntry(
            BiteScoreUserReviewEntry(
              review: review(),
              dish: null,
              restaurant: activeRestaurant,
            ),
          ),
          isFalse,
        );
      },
    );

    test(
      'public profile keeps historical badge inputs separate from cards',
      () {
        final source = File(
          'lib/services/bitescore_service.dart',
        ).readAsStringSync();
        final profile = sourceSection(
          source,
          'loadPublicReviewerProfileData',
          'static Future<bool> isPublicUsernameAvailable',
        );

        expect(profile, contains('loadCustomerVisibleReviewEntry(review)'));
        expect(profile, contains('reviews: reviewEntries'));
        expect(profile, contains('reviewCount: reviews.length'));
        expect(
          profile,
          contains(
            '_profileBadgeLabelFor(\n'
            '      reviewCount: reviews.length,',
          ),
        );
      },
    );

    test(
      'all affected Admin moderation loaders use the all-state directory',
      () {
        final source = File(
          'lib/services/bitescore_service.dart',
        ).readAsStringSync();
        final sections = <String>[
          sourceSection(
            source,
            'reportedRestaurantsAdminStream',
            'reportedDishesAdminStream',
          ),
          sourceSection(
            source,
            'reportedDishesAdminStream',
            'duplicateRestaurantReportsAdminStream',
          ),
          sourceSection(
            source,
            'duplicateRestaurantReportsAdminStream',
            'claimRequestsAdminStream',
          ),
          sourceSection(
            source,
            'claimRequestsAdminStream',
            'approvedOwnershipsAdminStream',
          ),
        ];
        for (final section in sections) {
          expect(section, contains('loadRestaurantsForAdminModeration()'));
          expect(section, isNot(contains('loadRestaurantsForFinder()')));
        }

        final finder = sourceSection(
          source,
          'static Future<List<BitescoreRestaurant>> loadRestaurantsForFinder',
          'static Future<List<BitescoreDish>> loadDishes',
        );
        expect(finder, contains('_customerRestaurantDirectory'));
        expect(finder, contains('_adminRestaurantDirectory'));
        expect(finder, isNot(contains('includeHidden')));
      },
    );
  });

  group('restaurant rename retry repair', () {
    test('a refreshed source no-op skips another profile revision write', () {
      final current = restaurant(
        revision: 5,
        updatedAt: DateTime.utc(2026, 8, 11, 12),
      );
      final submitted = current.copyWith(
        restaurantWriteRevision: 6,
        updatedAt: DateTime.utc(2026, 8, 11, 13),
      );

      expect(
        BiteScoreService.restaurantProfileWriteRequiredForTesting(
          current: current,
          updated: submitted,
        ),
        isFalse,
      );
      expect(
        BiteScoreService.shouldSynchronizeRestaurantDishNamesForTesting(
          profileWriteRequired: false,
          restaurantNameChanged: false,
        ),
        isTrue,
      );
    });

    test('real profile changes still require the guarded source write', () {
      final current = restaurant();
      expect(
        BiteScoreService.restaurantProfileWriteRequiredForTesting(
          current: current,
          updated: current.copyWith(phone: '555-0101'),
        ),
        isTrue,
      );
      expect(
        BiteScoreService.shouldSynchronizeRestaurantDishNamesForTesting(
          profileWriteRequired: true,
          restaurantNameChanged: false,
        ),
        isFalse,
      );
    });

    test('a real rename writes the source and synchronizes dish names', () {
      final current = restaurant();
      final renamed = current.copyWith(
        name: 'Renamed Kitchen',
        normalizedName: 'renamed kitchen',
      );
      expect(
        BiteScoreService.restaurantProfileWriteRequiredForTesting(
          current: current,
          updated: renamed,
        ),
        isTrue,
      );
      expect(
        BiteScoreService.shouldSynchronizeRestaurantDishNamesForTesting(
          profileWriteRequired: true,
          restaurantNameChanged: true,
        ),
        isTrue,
      );
    });
  });

  test('shared menu reuse requires the current claimed owner', () {
    final current = restaurant().copyWith(
      isClaimed: true,
      ownerUserId: 'owner-1',
    );
    expect(
      RestaurantMenuService.isCurrentSharedMenuOwnerForTesting(
        current,
        'owner-1',
      ),
      isTrue,
    );
    expect(
      RestaurantMenuService.isCurrentSharedMenuOwnerForTesting(
        current,
        'former-owner',
      ),
      isFalse,
    );
    expect(
      RestaurantMenuService.isCurrentSharedMenuOwnerForTesting(
        current.copyWith(isClaimed: false),
        'owner-1',
      ),
      isFalse,
    );
  });

  test(
    'destructive account-root clients are absent while safe unclaim remains',
    () {
      final productionDartSource = Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((file) => file.path.endsWith('.dart'))
          .map((file) => file.readAsStringSync())
          .join('\n');
      expect(
        productionDartSource,
        isNot(contains('deleteUserAccountRecordsAsAdmin')),
      );
      expect(productionDartSource, isNot(contains('deleteRestaurantAccount')));

      final peopleDashboard = File(
        'lib/widgets/rating_admin_people_paged_dashboard.dart',
      ).readAsStringSync();
      for (final removedAction in <String>[
        'Delete User Account Records',
        'Delete account records',
        'Delete Records',
        'deleteUserRecords',
      ]) {
        expect(
          peopleDashboard,
          isNot(contains(removedAction)),
          reason: removedAction,
        );
      }

      final couponDashboard = File(
        'lib/widgets/coupon_admin_paged_dashboard.dart',
      ).readAsStringSync();
      for (final removedAction in <String>[
        'Delete Restaurant',
        'Delete this restaurant account and all of its coupons from BiteSaver?',
        '_deleteRestaurant(',
        'deleteAccount',
      ]) {
        expect(
          couponDashboard,
          isNot(contains(removedAction)),
          reason: removedAction,
        );
      }
      final couponAdminScreen = File(
        'lib/screens/admin_review_screen.dart',
      ).readAsStringSync();
      expect(couponAdminScreen, isNot(contains('deleteAccount')));

      final claimedRestaurantsDashboard = File(
        'lib/widgets/rating_admin_paged_dashboard.dart',
      ).readAsStringSync();
      expect(claimedRestaurantsDashboard, contains("tooltip: 'Remove owner'"));
      expect(
        claimedRestaurantsDashboard,
        contains(
          'BiteScoreService.unclaimRestaurantAsAdmin(record.restaurant)',
        ),
      );

      final biteScoreSource = File(
        'lib/services/bitescore_service.dart',
      ).readAsStringSync();
      final unclaim = sourceSection(
        biteScoreSource,
        'static Future<void> unclaimRestaurantAsAdmin',
        'static Future<BiteScoreReviewSaveResult> createAndRate',
      );
      expect(unclaim, contains('restaurant.isClaimed'));
      expect(unclaim, contains('restaurant.ownerUserId'));
      expect(unclaim, contains('restaurant.restaurantWriteRevision'));
      expect(unclaim, contains('_runExpectedRestaurantRevisionTransaction'));
      expect(unclaim, contains("currentData?['isClaimed'] != true"));
      expect(unclaim, contains("currentData?['ownerUserId']"));
      expect(unclaim, contains("'ownerUserId': null"));
      expect(unclaim, contains("'isClaimed': false"));
      expect(unclaim, contains('restaurantWriteRevisionField: nextRevision'));
      expect(unclaim, isNot(contains('.delete(')));
      expect(unclaim, isNot(contains("collection('restaurant_accounts')")));
      expect(unclaim, isNot(contains("collection('coupons')")));
    },
  );

  test('all traced client writers use the production revision transaction', () {
    final biteScoreSource = File(
      'lib/services/bitescore_service.dart',
    ).readAsStringSync();
    final dishNameRepair = sourceSection(
      biteScoreSource,
      'static Future<void> _synchronizeRestaurantDishNames',
      'static CollectionReference<Map<String, dynamic>> restaurantsCollection',
    );
    expect(dishNameRepair, contains('_firestore.runTransaction'));
    expect(dishNameRepair, contains('_requireExpectedRestaurantWriteRevision'));
    expect(dishNameRepair, contains("currentData?['name']"));
    expect(
      dishNameRepair.indexOf('transaction.get(restaurantRef)') <
          dishNameRepair.indexOf('transaction.set(dishDoc.reference'),
      isTrue,
    );

    final create = sourceSection(
      biteScoreSource,
      'static Future<_BiteScoreRestaurantResolution> _findOrCreateRestaurant',
      'static Future<BitescoreRestaurant> _completeNewRestaurantCreationProvenance',
    );
    expect(create, contains('restaurantWriteRevision: 0'));

    final provenance = sourceSection(
      biteScoreSource,
      'static Future<BitescoreRestaurant> _completeNewRestaurantCreationProvenance',
      'static Future<_BiteScoreDishResolution> _findOrCreateDish',
    );
    expect(provenance, contains('_runExpectedRestaurantRevisionTransaction'));
    expect(provenance, contains('restaurantWriteRevisionField'));

    final adminEdit = sourceSection(
      biteScoreSource,
      'static Future<void> updateRestaurantAsAdmin',
      'static Future<void> updateRestaurantAsOwner',
    );
    expect(
      adminEdit.indexOf('final expectedRevision') <
          adminEdit.indexOf('_verifyRestaurantAddress'),
      isTrue,
    );
    expect(adminEdit, contains('_runExpectedRestaurantRevisionTransaction'));
    expect(adminEdit, contains('if (profileWriteRequired)'));
    expect(adminEdit, contains('_synchronizeRestaurantDishNames'));
    expect(adminEdit, contains('dishNameSynchronizationRevision'));
    expect(adminEdit, contains("..remove('isActive')"));
    expect(adminEdit, contains("..remove('active')"));
    expect(adminEdit, isNot(contains('bool? isActive')));

    final ownerEdit = sourceSection(
      biteScoreSource,
      'static Future<void> updateRestaurantAsOwner',
      'static Future<void> updateDishAsAdmin',
    );
    expect(ownerEdit, contains('updateRestaurantAsAdmin'));

    final directClaim = sourceSection(
      biteScoreSource,
      'static Future<void> submitRestaurantClaim',
      'static Future<void> approveClaimAsAdmin',
    );
    final directRestaurantRead = directClaim.indexOf(
      'final restaurantSnapshot = await restaurantRef.get()',
    );
    final directValidation = directClaim.indexOf(
      '_requireRestaurantAvailableForClaim(',
    );
    final duplicateRead = directClaim.indexOf(
      'final duplicateSnapshot = await claimRequestsCollection()',
    );
    final pendingWrite = directClaim.indexOf(
      'await _createPendingRestaurantClaimRequestOnly(',
    );
    expect(
      directClaim,
      contains('restaurantsCollection().doc(normalizedRestaurantId)'),
    );
    expect(
      directClaim,
      contains('restaurantDocumentId: restaurantSnapshot.id'),
    );
    expect(directClaim, contains('_runControlledRestaurantClaimWrite'));
    expect(
      directRestaurantRead >= 0 &&
          directRestaurantRead < directValidation &&
          directValidation < duplicateRead &&
          duplicateRead < pendingWrite,
      isTrue,
    );

    final claim = sourceSection(
      biteScoreSource,
      'static Future<void> approveClaimAsAdmin',
      'static Future<void> rejectClaimAsAdmin',
    );
    expect(claim, contains('initialRestaurant'));
    expect(claim, contains('_requireRestaurantAvailableForClaim'));
    expect(claim, contains('_runControlledRestaurantClaimWrite'));
    expect(claim, contains('_firestore.runTransaction'));
    expect(claim, contains('_nextPendingClaimApprovalRevision'));
    expect(claim, contains('restaurantWriteRevisionField'));
    expect(RegExp(r'transaction\.get\(').allMatches(claim).length, 2);
    expect(RegExp(r'transaction\.set\(').allMatches(claim).length, 2);
    final approvalTransaction = claim.indexOf('_firestore.runTransaction');
    final restaurantRead = claim.indexOf('transaction.get(restaurantRef)');
    final claimRead = claim.indexOf('transaction.get(claimRef)');
    final approvalValidation = claim.indexOf(
      '_nextPendingClaimApprovalRevision(',
    );
    final claimWrite = claim.indexOf('transaction.set(claimRef');
    final restaurantWrite = claim.indexOf('transaction.set(restaurantRef');
    expect(
      approvalTransaction >= 0 &&
          approvalTransaction < restaurantRead &&
          restaurantRead < claimRead &&
          claimRead < approvalValidation &&
          approvalValidation < claimWrite &&
          claimWrite < restaurantWrite,
      isTrue,
    );

    final unclaim = sourceSection(
      biteScoreSource,
      'static Future<void> unclaimRestaurantAsAdmin',
      'static Future<BiteScoreReviewSaveResult> createAndRate',
    );
    expect(unclaim, contains('restaurant.restaurantWriteRevision'));
    expect(unclaim, contains('_runExpectedRestaurantRevisionTransaction'));

    final merge = sourceSection(
      biteScoreSource,
      'static Future<void> mergeRestaurantsAsAdmin',
      'static Future<void> deleteReviewAsAdmin',
    );
    expect(
      RegExp(
        '_runExpectedRestaurantRevisionTransaction',
      ).allMatches(merge).length,
      2,
    );
  });

  test('all traced menu writers use exact revision-aware transactions', () {
    final source = File(
      'lib/services/restaurant_menu_service.dart',
    ).readAsStringSync();
    final route = sourceSection(
      source,
      'static Future<void> setBiteScoreMenuSourceToBiteSaver',
      'static Future<void> clearBiteScoreMenuSourceRouting',
    );
    expect(route, contains('expectedRevision'));
    expect(route, contains('_runRestaurantRevisionTransaction'));
    expect(route, contains('restaurantWriteRevisionField'));

    final clear = sourceSection(
      source,
      'static Future<void> clearBiteScoreMenuSourceRouting',
      'static Future<List<RestaurantMenuImage>> loadMenuImages',
    );
    expect(clear, contains('_runRestaurantRevisionTransaction'));
    expect(clear, contains('restaurantWriteRevisionField'));

    final sharedMenu = sourceSection(
      source,
      'static Future<RestaurantMenuSource> ensureSharedMenuForBiteScoreRestaurant',
      'static Future<void> _touchSharedMenu',
    );
    expect(sharedMenu, contains('_runRestaurantRevisionTransaction'));
    expect(sharedMenu, contains('_isCurrentSharedMenuOwner'));
    expect(sharedMenu, contains('transaction.set(menuDoc'));
    expect(sharedMenu, contains('restaurantWriteRevisionField'));
  });
}
