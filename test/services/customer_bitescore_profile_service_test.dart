import 'dart:async';
import 'package:coupon_app/services/customer_bitescore_profile_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'customer_bitescore_search_service_test.dart'
    show FakeSearchApi, dishProjection, restaurantProjection, response;

Map<String, dynamic> profileSummary({String userId = 'reviewer'}) => {
  'schemaVersion': 1,
  'userId': userId,
  'publicDisplayName': 'Public Reviewer',
  'chosenUsername': null,
  'fallbackUsername': 'anon1',
  'badgeLabel': 'Active Reviewer',
  'reviewCount': 93,
  'helpfulVotesReceived': 8,
  'accountAgeDays': 30,
  'moderationFlagCount': 0,
  'contributionPoints': 20,
  'badges': <Object?>[],
};
Map<String, dynamic> profileReview(String id, {String userId = 'reviewer'}) => {
  'restaurant': restaurantProjection('restaurant-1'),
  'dish': dishProjection('dish-$id')..['displayName'] = 'Dish $id',
  'review': {
    'id': id,
    'dishId': 'dish-$id',
    'restaurantId': 'restaurant-1',
    'userId': userId,
    'headline': 'Review $id',
    'notes': null,
    'overallImpression': 8,
    'overallBiteScore': 80,
    'tastinessScore': 8,
    'qualityScore': 8,
    'valueScore': 8,
    'createdAtMs': 1000,
    'updatedAtMs': 2000,
  },
};
void main() {
  test(
    'bounded profile pagination appends all 93 canonical reviews once',
    () async {
      final api = FakeSearchApi((name, request) async {
        if (name.startsWith('start')) return response();
        final offset = int.parse(request['cursor'] as String? ?? '0');
        final end = (offset + 25).clamp(0, 93);
        return response(
          items: [
            for (var i = offset; i < end; i++) profileReview('review $i'),
          ],
          cursor: end < 93 ? '$end' : null,
        );
      });
      final controller = CustomerBiteScoreProfileService(
        api: api,
        actorKey: () => 'user:reviewer',
      ).list(kind: 'reviews', userId: 'reviewer');
      addTearDown(controller.dispose);
      await controller.loadInitial();
      expect(controller.items.length, 25);
      while (controller.hasMore) {
        await controller.loadMore();
      }
      expect(controller.error, isNull);
      expect(
        controller.items
            .map(
              (item) => CustomerBiteScoreProfileService.review(item).review.id,
            )
            .toSet()
            .length,
        93,
      );
      expect(api.calls.first, 'startCustomerBiteScoreProfileList');
      expect(api.calls.skip(1).toSet(), {
        'getCustomerBiteScoreProfileListPage',
      });
    },
  );
  test('review author and parent bindings fail closed', () async {
    for (final bad in [
      profileReview('x', userId: 'other'),
      profileReview('x')..['restaurant'] = restaurantProjection('other'),
    ]) {
      final api = FakeSearchApi(
        (name, _) async =>
            name.startsWith('start') ? response() : response(items: [bad]),
      );
      final controller = CustomerBiteScoreProfileService(
        api: api,
      ).list(kind: 'reviews', userId: 'reviewer');
      await controller.loadInitial();
      expect(controller.items, isEmpty);
      expect(controller.error, isA<FormatException>());
      controller.dispose();
    }
  });
  test(
    'Local Expert refresh fences delayed prior ordering and selected location',
    () async {
      final old = Completer<Map<String, dynamic>>();
      var starts = 0;
      final api = FakeSearchApi((name, request) async {
        if (name.startsWith('start')) {
          starts++;
          if (starts == 1) return old.future;
          expect((request['criteria'] as Map)['sort'], 'nearest');
          return response(session: 'new');
        }
        return response(session: 'new', items: [profileReview('nearest')]);
      });
      final controller = CustomerBiteScoreProfileService(api: api).list(
        kind: 'localExpert',
        userId: 'reviewer',
        expertTypeId: 'burger',
        sort: 'highestRated',
      );
      addTearDown(controller.dispose);
      final pending = controller.loadInitial();
      await controller.updateCriteria({
        'kind': 'localExpert',
        'userId': 'reviewer',
        'expertTypeId': 'burger',
        'sort': 'nearest',
        'location': {'latitude': 28.5, 'longitude': -81.3},
      });
      old.complete(response(session: 'old'));
      await pending;
      expect(
        CustomerBiteScoreProfileService.review(
          controller.items.single,
        ).review.id,
        'nearest',
      );
    },
  );
  test('summary takes authoritative totals without loading history', () async {
    final api = FakeSearchApi((name, request) async {
      expect(name, 'getCustomerBiteScoreProfileSummary');
      return profileSummary()..['email'] = 'private@example.com';
    });
    final result = await CustomerBiteScoreProfileService(
      api: api,
    ).summary('reviewer');
    expect(result.reviewCount, 93);
    expect(result.reviews, isEmpty);
    expect(result.publicDisplayName, 'Public Reviewer');
    expect(api.calls.length, 1);
  });
  test(
    'Saved projection identity remains exact across same-name items',
    () async {
      final api = FakeSearchApi(
        (name, _) async => name.startsWith('start')
            ? response()
            : response(
                items: [
                  {'restaurant': restaurantProjection('place a')},
                  {'restaurant': restaurantProjection('place b')},
                ],
              ),
      );
      final controller = CustomerBiteScoreProfileService(
        api: api,
      ).list(kind: 'savedRestaurants', userId: 'reviewer');
      addTearDown(controller.dispose);
      await controller.loadInitial();
      expect(
        controller.items.map(
          (item) => CustomerBiteScoreProfileService.restaurant(item).id,
        ),
        ['place a', 'place b'],
      );
    },
  );
  test('badge reads consume only the fixed taxonomy safe summary', () async {
    final api = FakeSearchApi(
      (_, _) async => profileSummary()
        ..['badges'] = [
          {
            'expertTypeId': 'burger',
            'displayName': 'Burger',
            'level': 'level1',
            'totalRestaurantCount': 5,
            'localClusterRestaurantCount': 4,
            'qualificationMethod': 'none',
            'earnedAtMs': 1000,
            'updatedAtMs': 2000,
          },
        ],
    );
    final result = await CustomerBiteScoreProfileService(
      api: api,
    ).badges('reviewer');
    expect(result.single.expertTypeId, 'burger');
    expect(result.single.earnedAt?.millisecondsSinceEpoch, 1000);
    expect(api.calls, ['getCustomerBiteScoreProfileSummary']);
  });
}
