import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/dish_rating_aggregate.dart';
import 'package:coupon_app/models/dish_review.dart';
import 'package:coupon_app/screens/public_reviewer_profile_screen.dart';
import 'package:coupon_app/screens/restaurant_customer_deep_link_screen.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

BitescoreRestaurant _restaurant({
  String id = 'restaurant-1',
  String name = 'Visible Kitchen',
  bool isActive = true,
}) => BitescoreRestaurant(
  id: id,
  name: name,
  normalizedName: name.toLowerCase(),
  address: '1 Main St',
  city: 'Orlando',
  state: 'FL',
  zipCode: '32801',
  location: const GeoPoint(28.5, -81.3),
  isActive: isActive,
  restaurantWriteRevision: 4,
);

BitescoreRestaurant _parsedRestaurant({
  required String id,
  required String name,
  required Map<String, dynamic> activity,
}) {
  return BitescoreRestaurant.tryFromFinderFirestore(<String, dynamic>{
    'name': name,
    'normalizedName': name.toLowerCase(),
    'address': '1 Main St',
    'city': 'Orlando',
    'state': 'FL',
    'zipCode': '32801',
    'location': const GeoPoint(28.5, -81.3),
    'restaurantWriteRevision': 4,
    ...activity,
  }, fallbackId: id)!;
}

BitescoreDish _dish({
  String id = 'dish-1',
  String restaurantId = 'restaurant-1',
  String name = 'Visible Burger',
  bool isActive = true,
  String? mergedIntoDishId,
}) => BitescoreDish(
  id: id,
  restaurantId: restaurantId,
  restaurantName: 'Visible Kitchen',
  name: name,
  normalizedName: name.toLowerCase(),
  isActive: isActive,
  mergedIntoDishId: mergedIntoDishId,
);

DishReview _review({
  String id = 'review-1',
  String dishId = 'dish-1',
  String restaurantId = 'restaurant-1',
  String headline = 'Visible review headline',
}) => DishReview(
  id: id,
  dishId: dishId,
  restaurantId: restaurantId,
  userId: 'reviewer-1',
  headline: headline,
  notes: 'Visible review notes',
  overallImpression: 8,
  overallBiteScore: 80,
);

BiteScoreUserReviewEntry _reviewEntry({
  DishReview? review,
  BitescoreDish? dish,
  BitescoreRestaurant? restaurant,
}) => BiteScoreUserReviewEntry(
  review: review ?? _review(),
  dish: dish ?? _dish(),
  restaurant: restaurant ?? _restaurant(),
);

BiteScorePublicReviewerProfileData _profile(
  List<BiteScoreUserReviewEntry> entries, {
  int historicalReviewCount = 1,
}) => BiteScorePublicReviewerProfileData(
  userId: 'reviewer-1',
  publicDisplayName: 'Visible Reviewer',
  chosenUsername: null,
  fallbackUsername: 'reviewer000001',
  reviews: entries,
  badgeLabel: 'Historical Badge',
  reviewCount: historicalReviewCount,
  helpfulVotesReceived: 7,
  accountAgeDays: 20,
  moderationFlagCount: 0,
  contributionPoints: 12,
);

Future<void> _pumpProfile(
  WidgetTester tester, {
  required BiteScorePublicReviewerProfileData profile,
  PublicReviewerReviewEntryLoader? reviewEntryLoader,
  PublicReviewerAggregateLoader? aggregateLoader,
  PublicReviewerDishDestinationBuilder? destinationBuilder,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: PublicReviewerProfileScreen(
        userId: profile.userId,
        profileLoader: (_) async => profile,
        badgesLoader: (_) async => const [],
        reviewEntryLoader: reviewEntryLoader,
        aggregateLoader: aggregateLoader,
        dishDestinationBuilder: destinationBuilder,
        canEditReview: (_) => false,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'missing, hidden, malformed, and conflicting deep links share one safe state',
    (tester) async {
      final cases = <MapEntry<String, BitescoreRestaurant?>>[
        const MapEntry<String, BitescoreRestaurant?>('missing', null),
        MapEntry<String, BitescoreRestaurant?>(
          'hidden',
          _restaurant(name: 'Hidden Restaurant Name', isActive: false),
        ),
        MapEntry<String, BitescoreRestaurant?>(
          'malformed',
          _parsedRestaurant(
            id: 'malformed',
            name: 'Malformed Restaurant Name',
            activity: const <String, dynamic>{'isActive': 'true'},
          ),
        ),
        MapEntry<String, BitescoreRestaurant?>(
          'conflicting',
          _parsedRestaurant(
            id: 'conflicting',
            name: 'Conflicting Restaurant Name',
            activity: const <String, dynamic>{
              'isActive': true,
              'active': false,
            },
          ),
        ),
      ];

      for (final fixture in cases) {
        var dishLoads = 0;
        await tester.pumpWidget(
          MaterialApp(
            home: RestaurantCustomerDeepLinkScreen(
              key: ValueKey<String>(fixture.key),
              side: 'bitescore',
              restaurantId: fixture.key,
              biteScoreRestaurantLoader: (_) async => fixture.value,
              biteScoreEntriesLoader: (_) async {
                dishLoads += 1;
                return const <BiteScoreHomeEntry>[];
              },
              biteScoreDestinationBuilder: (_, _) =>
                  const Scaffold(body: Text('must not open')),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(
          find.text('This BiteScore restaurant is not currently available.'),
          findsOneWidget,
          reason: fixture.key,
        );
        expect(find.text('must not open'), findsNothing, reason: fixture.key);
        expect(dishLoads, 0, reason: fixture.key);
        final privateName = fixture.value?.name;
        if (privateName != null) {
          expect(find.text(privateName), findsNothing, reason: fixture.key);
        }
      }
    },
  );

  testWidgets('active deep link retains its destination behavior', (
    tester,
  ) async {
    final active = _restaurant();
    var dishLoads = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: RestaurantCustomerDeepLinkScreen(
          side: 'bitescore',
          restaurantId: active.id,
          biteScoreRestaurantLoader: (_) async => active,
          biteScoreEntriesLoader: (_) async {
            dishLoads += 1;
            return const <BiteScoreHomeEntry>[];
          },
          biteScoreDestinationBuilder: (restaurant, entries) => Scaffold(
            body: Text('active:${restaurant.name}:${entries.length}'),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('active:Visible Kitchen:0'), findsOneWidget);
    expect(dishLoads, 1);
  });

  testWidgets(
    'reviewer profile displays only active consistent entries while preserving metrics',
    (tester) async {
      final active = _reviewEntry();
      final hiddenRestaurant = _reviewEntry(
        review: _review(
          id: 'review-hidden-parent',
          dishId: 'dish-hidden-parent',
          headline: 'Hidden restaurant review',
        ),
        dish: _dish(id: 'dish-hidden-parent'),
        restaurant: _restaurant(name: 'Hidden Parent Name', isActive: false),
      );
      final hiddenDish = _reviewEntry(
        review: _review(
          id: 'review-hidden-dish',
          dishId: 'dish-hidden',
          headline: 'Hidden dish review',
        ),
        dish: _dish(
          id: 'dish-hidden',
          name: 'Hidden Dish Name',
          isActive: false,
        ),
      );

      await _pumpProfile(
        tester,
        profile: _profile(<BiteScoreUserReviewEntry>[
          active,
          hiddenRestaurant,
          hiddenDish,
        ], historicalReviewCount: 3),
      );

      expect(find.text('Visible Burger'), findsOneWidget);
      expect(find.text('Visible review headline'), findsOneWidget);
      expect(find.text('Hidden Parent Name'), findsNothing);
      expect(find.text('Hidden restaurant review'), findsNothing);
      expect(find.text('Hidden Dish Name'), findsNothing);
      expect(find.text('Hidden dish review'), findsNothing);
      expect(find.text('3 reviews'), findsWidgets);
    },
  );

  testWidgets('reviewer navigation rechecks visibility before opening', (
    tester,
  ) async {
    final active = _reviewEntry();
    var aggregateLoads = 0;
    var destinations = 0;
    await _pumpProfile(
      tester,
      profile: _profile(<BiteScoreUserReviewEntry>[active]),
      reviewEntryLoader: (_) async => null,
      aggregateLoader: (_) async {
        aggregateLoads += 1;
        return null;
      },
      destinationBuilder:
          ({
            required entry,
            required targetReviewId,
            required scrollToReviewSection,
            required editReviewId,
          }) {
            destinations += 1;
            return const Scaffold(body: Text('must not navigate'));
          },
    );

    await tester.tap(find.text('Visible Burger'));
    await tester.pumpAndSettle();

    expect(find.text('This dish is no longer available.'), findsOneWidget);
    expect(find.text('must not navigate'), findsNothing);
    expect(aggregateLoads, 0);
    expect(destinations, 0);
  });

  testWidgets('active reviewer entry still opens its dish destination', (
    tester,
  ) async {
    final active = _reviewEntry();
    String? openedTargetReviewId;
    await _pumpProfile(
      tester,
      profile: _profile(<BiteScoreUserReviewEntry>[active]),
      reviewEntryLoader: (_) async => active,
      aggregateLoader: (_) async => const DishRatingAggregate(
        dishId: 'dish-1',
        restaurantId: 'restaurant-1',
      ),
      destinationBuilder:
          ({
            required entry,
            required targetReviewId,
            required scrollToReviewSection,
            required editReviewId,
          }) {
            openedTargetReviewId = targetReviewId;
            return Scaffold(body: Text('opened:${entry.dish.name}'));
          },
    );

    await tester.tap(find.text('Visible Burger'));
    await tester.pumpAndSettle();

    expect(find.text('opened:Visible Burger'), findsOneWidget);
    expect(openedTargetReviewId, active.review.id);
  });
}
