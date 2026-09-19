import 'dart:async';
import 'package:coupon_app/models/customer_bitescore_search.dart';
import 'package:coupon_app/models/bitescore_dish_image.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/screens/bitescore_restaurant_dishes_screen.dart';
import 'package:coupon_app/services/customer_bitescore_reads.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'customer_bitescore_search_service_test.dart'
    show dishProjection, restaurantProjection;

Map<String, Object?> review(String id, {String dishId = 'dish'}) => {
  'review': {
    'id': id,
    'dishId': dishId,
    'restaurantId': 'restaurant-1',
    'userId': 'reviewer',
    'headline': 'Review $id',
    'notes': '',
    'overallImpression': 8,
    'overallBiteScore': 80,
    'tastinessScore': 8,
    'qualityScore': 8,
    'valueScore': 8,
    'createdAtMs': 100,
    'updatedAtMs': 100,
  },
  'helpfulCount': 2,
  'notHelpfulCount': 1,
  'currentUserVoteType': 'helpful',
  'hasPendingUserReport': false,
  'reviewer': {
    'userId': 'reviewer',
    'displayName': 'Public Name',
    'publicReviewCount': 25,
    'badges': [],
  },
};
Map<String, Object?> detail() => {
  'kind': 'dish',
  'dish': dishProjection('dish'),
  'restaurant': restaurantProjection('restaurant-1'),
  'isFavorite': false,
  'canManage': false,
};

void main() {
  tearDown(() => CustomerBiteScoreRuntime.testEnabled = null);

  test(
    'safe detail preserves exact parent and only server management decision',
    () async {
      final service = CustomerBiteScoreReads(
        boundary: (_, __) async => detail(),
      );
      final result = await service.detail('dish', 'dish');
      expect(result.entry!.dish.id, 'dish');
      expect(result.entry!.restaurant.id, 'restaurant-1');
      expect(result.restaurant.ownerUserId, isNull);
      expect(result.canManage, false);
      await expectLater(
        service.detail('dish', 'different'),
        throwsFormatException,
      );
    },
  );

  test(
    'review pages preserve public metadata and cursor with stable client binding',
    () async {
      final requests = <Map<String, Object?>>[];
      final service = CustomerBiteScoreReads(
        boundary: (_, request) async {
          requests.add(request);
          return {
            'items': [review(request['cursor'] == null ? 'one' : 'two')],
            'nextCursor': request['cursor'] == null ? 'cursor' : null,
          };
        },
      );
      final first = await service.reviews('dish', sort: 'Most helpful');
      final second = await service.reviews(
        'dish',
        sort: 'Most helpful',
        cursor: first.nextCursor,
      );
      expect(first.items.single.trust.helpfulScore, 1);
      expect(first.items.single.displayName, 'Public Name');
      expect(second.items.single.review.id, 'two');
      expect(requests[0]['clientInstanceId'], requests[1]['clientInstanceId']);
      expect(requests[1]['cursor'], 'cursor');
    },
  );

  test(
    'oversized pages and mismatched parent are rejected without fallback',
    () async {
      var calls = 0;
      final service = CustomerBiteScoreReads(
        boundary: (_, __) async {
          calls++;
          return {
            'items': List.generate(26, (i) => review('$i')),
            'nextCursor': null,
          };
        },
      );
      await expectLater(
        service.reviews('dish', sort: 'Most helpful'),
        throwsFormatException,
      );
      expect(calls, 1);
      final wrong = CustomerBiteScoreReads(
        boundary: (_, __) async => {
          'items': [review('id', dishId: 'other')],
          'nextCursor': null,
        },
      );
      await expectLater(
        wrong.reviews('dish', sort: 'Most recent'),
        throwsFormatException,
      );
    },
  );

  test(
    'image data omits uploader/storage metadata and preserves signed sort order',
    () async {
      final service = CustomerBiteScoreReads(
        boundary: (_, __) async => {
          'items': [
            {
              'id': 'image',
              'dishId': 'dish',
              'restaurantId': 'restaurant-1',
              'reviewId': 'review',
              'imageUrl': 'https://example.test/image.jpg',
              'sortOrder': -1,
              'helpfulCount': 2,
              'notHelpfulCount': 0,
              'createdAtMs': 10,
              'uploadedByUserId': 'ignored',
              'storagePath': 'ignored',
            },
          ],
          'nextCursor': null,
        },
      );
      final image = (await service.images('dish')).items.single;
      expect(image.uploadedByUserId, isEmpty);
      expect(image.storagePath, isEmpty);
      expect(image.sortOrder, -1);
    },
  );

  testWidgets(
    'opt-in dish detail uses safe calls; sort change reloads server order',
    (tester) async {
      CustomerBiteScoreRuntime.testEnabled = true;
      final sorts = <String>[];
      final service = CustomerBiteScoreReads(
        boundary: (name, request) async {
          if (name == 'getCustomerBiteScoreDetail') return detail();
          if (name == 'pageCustomerBiteScoreImages')
            return {'items': [], 'nextCursor': null};
          sorts.add(request['sort'] as String);
          return {
            'items': [review('one')],
            'nextCursor': null,
          };
        },
      );
      await tester.pumpWidget(
        MaterialApp(
          home: BiteScoreDishDetailScreen(
            entry: CustomerBiteScorePublicData.entry(dishProjection('dish')),
            testCustomerReads: service,
            testCurrentUserProvider: () => null,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Could not load dish details.'), findsNothing);
      expect(sorts, ['Most helpful']);
      await tester.ensureVisible(find.text('Most helpful'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Most helpful'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Most recent').last);
      await tester.pumpAndSettle();
      expect(sorts.last, 'Most recent');
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'safe detail failure renders retry and does not attempt a legacy load',
    (tester) async {
      CustomerBiteScoreRuntime.testEnabled = true;
      var calls = 0;
      final service = CustomerBiteScoreReads(
        boundary: (_, __) async {
          calls++;
          throw StateError('offline');
        },
      );
      await tester.pumpWidget(
        MaterialApp(
          home: BiteScoreDishDetailScreen(
            entry: CustomerBiteScorePublicData.entry(dishProjection('dish')),
            testCustomerReads: service,
            testCurrentUserProvider: () => null,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Could not load dish details.'), findsOneWidget);
      expect(calls, 1);
      await tester.pumpWidget(const SizedBox());
    },
  );

  test(
    'menu preparation and append retain session and exact generation',
    () async {
      final requests = <Map<String, Object?>>[];
      final service = CustomerBiteScoreReads(
        delay: (_) async {},
        boundary: (name, request) async {
          expect(name, 'pageCustomerBiteScoreMenu');
          requests.add(request);
          if (requests.length == 1)
            return {
              'restaurantId': 'restaurant-1',
              'state': 'preparing',
              'menuStyle': 'biteScore',
              'entries': [],
              'sessionId': 's' * 64,
              'queryFingerprint': 'f' * 64,
              'nextCursor': null,
            };
          expect(request['sessionId'], 's' * 64);
          expect(request['queryFingerprint'], 'f' * 64);
          return {
            'restaurantId': 'restaurant-1',
            'state': 'available',
            'menuStyle': 'biteScore',
            'entries': [],
            'sessionId': 's' * 64,
            'queryFingerprint': 'f' * 64,
            'nextCursor': requests.length == 2 ? 'opaque' : null,
          };
        },
      );
      final first = await service.menu('restaurant-1');
      await service.menu('restaurant-1', cursor: first.nextCursor);
      expect(requests.length, 3);
      expect(
        requests.map((request) => request['queryGeneration']).toSet().length,
        1,
      );
      expect(
        requests.map((request) => request['clientRequestId']).toSet().length,
        1,
      );
      expect(requests.last['cursor'], 'opaque');
    },
  );

  test(
    'safe read rejects account-specific data after actor replacement',
    () async {
      var actor = 'user:A';
      final pending = Completer<Object?>();
      final service = CustomerBiteScoreReads(
        actorKey: () => actor,
        boundary: (_, _) => pending.future,
      );
      final future = service.detail('dish', 'dish');
      final assertion = expectLater(future, throwsStateError);
      actor = 'user:B';
      pending.complete({...detail(), 'isFavorite': true});
      await assertion;
    },
  );

  testWidgets(
    'gallery own-vote hydration uses bounded batches and only new page IDs',
    (tester) async {
      final entry = CustomerBiteScorePublicData.entry(dishProjection('dish'));
      BiteScoreDishImage image(int i) => BiteScoreDishImage(
        id: 'image$i',
        dishId: 'dish',
        restaurantId: 'restaurant-1',
        uploadedByUserId: '',
        imageUrl: 'https://example.test/$i.jpg',
        storagePath: '',
      );
      final images = List.generate(63, image);
      final batches = <List<String>>[];
      await tester.pumpWidget(
        MaterialApp(
          home: BiteScoreDishImageGalleryScreen(
            dish: entry.dish,
            restaurant: entry.restaurant,
            images: images,
            imageUrls: images.map((image) => image.imageUrl).toList(),
            initialIndex: 0,
            initialCursor: 'next',
            testCurrentUserProvider: () => null,
            loadCurrentVotes: (ids) async {
              batches.add(ids);
              return {};
            },
            pageLoader: (cursor) async {
              expect(cursor, 'next');
              return CustomerBiteScoreReadPage([image(63)], null);
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(batches.map((ids) => ids.length), [25, 25, 13]);
      await tester.tap(find.text('Load more photos'));
      await tester.pumpAndSettle();
      expect(batches.last, ['image63']);
      expect(batches.expand((ids) => ids).length, 64);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'enabled restaurant navigation skips the raw preload and opens bounded destination',
    (tester) async {
      CustomerBiteScoreRuntime.testEnabled = true;
      final calls = <String>[];
      final reads = CustomerBiteScoreReads(
        boundary: (name, request) async {
          calls.add(name);
          if (name == 'getCustomerBiteScoreDetail') return detail();
          return {'items': [], 'nextCursor': null};
        },
      );
      await tester.pumpWidget(
        MaterialApp(
          home: BiteScoreDishDetailScreen(
            entry: CustomerBiteScorePublicData.entry(dishProjection('dish')),
            testCustomerReads: reads,
            testCurrentUserProvider: () => null,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(calls, [
        'getCustomerBiteScoreDetail',
        'pageCustomerBiteScoreReviews',
        'pageCustomerBiteScoreImages',
      ]);
      // Firestore is intentionally not initialized. The old raw preload throws
      // before navigation; the enabled destination handles its own bounded load.
      await tester.tap(find.text('Kitchen').first);
      await tester.pumpAndSettle();
      final destination = tester.widget<BiteScoreRestaurantDishesScreen>(
        find.byType(BiteScoreRestaurantDishesScreen),
      );
      expect(destination.restaurant.id, 'restaurant-1');
      expect(destination.entries, isEmpty);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
