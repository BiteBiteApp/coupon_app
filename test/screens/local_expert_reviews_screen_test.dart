import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/dish_review.dart';
import 'package:coupon_app/screens/local_expert_reviews_screen.dart';
import 'package:coupon_app/services/local_expert_review_service.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';

void main() {
  test('empty state uses selected expert display name', () {
    expect(
      LocalExpertReviewsScreen.emptyMessageFor('Burger'),
      'No Burger reviews are available.',
    );
  });

  test('default sort is highest rated', () {
    expect(
      LocalExpertReviewListPresenter.defaultSort,
      LocalExpertReviewSort.highestRated,
    );

    final entries = LocalExpertReviewListPresenter.visibleEntries(
      entries: [
        _entry('low', score: 62, createdAt: DateTime(2026, 1, 3)),
        _entry('high', score: 96, createdAt: DateTime(2026, 1, 1)),
      ],
      sort: LocalExpertReviewListPresenter.defaultSort,
    );

    expect(entries.map((entry) => entry.review.id), ['high', 'low']);
  });

  test('most recent sort remains available', () {
    final entries = LocalExpertReviewListPresenter.visibleEntries(
      entries: [
        _entry('old', createdAt: DateTime(2026, 1, 1)),
        _entry('new', createdAt: DateTime(2026, 1, 3)),
        _entry('middle', createdAt: DateTime(2026, 1, 2)),
      ],
      sort: LocalExpertReviewSort.mostRecent,
    );

    expect(entries.map((entry) => entry.review.id), ['new', 'middle', 'old']);
  });

  test('highest-rated and lowest-rated sorting use review BiteScore', () {
    final source = [
      _entry('low', score: 62, createdAt: DateTime(2026, 1, 3)),
      _entry('high', score: 96, createdAt: DateTime(2026, 1, 1)),
      _entry('middle', score: 82, createdAt: DateTime(2026, 1, 2)),
    ];

    final highest = LocalExpertReviewListPresenter.visibleEntries(
      entries: source,
      sort: LocalExpertReviewSort.highestRated,
    );
    final lowest = LocalExpertReviewListPresenter.visibleEntries(
      entries: source,
      sort: LocalExpertReviewSort.lowestRated,
    );

    expect(highest.map((entry) => entry.review.id), ['high', 'middle', 'low']);
    expect(lowest.map((entry) => entry.review.id), ['low', 'middle', 'high']);
  });

  test('nearest sort uses selected location', () {
    const selectedLocation = LocalExpertSelectedLocation(
      label: 'Ocala',
      latitude: 0,
      longitude: 0,
    );
    final entries = LocalExpertReviewListPresenter.visibleEntries(
      entries: [
        _entry('far', location: const GeoPoint(0.20, 0)),
        _entry('near', location: const GeoPoint(0.01, 0)),
        _entry('middle', location: const GeoPoint(0.05, 0)),
      ],
      sort: LocalExpertReviewSort.nearest,
      selectedLocation: selectedLocation,
    );

    expect(entries.map((entry) => entry.review.id), ['near', 'middle', 'far']);
  });

  test('invalid or empty location leaves the list usable', () {
    final entries = LocalExpertReviewListPresenter.visibleEntries(
      entries: [_entry('first'), _entry('second')],
      sort: LocalExpertReviewSort.nearest,
      selectedLocation: null,
    );

    expect(entries.map((entry) => entry.review.id), ['first', 'second']);
  });

  test('page-specific City ZIP and radius controls are absent', () {
    expect(
      LocalExpertReviewListPresenter.hasPageSpecificLocationControls,
      false,
    );
    expect(
      LocalExpertReviewListPresenter.nearestNoLocationMessage,
      contains('main BiteScore or BiteSaver screen'),
    );
  });

  test('shared Use My Location coordinates are honored', () {
    final selected =
        LocalExpertReviewListPresenter.selectedLocationFromSharedState(
          SharedLocationState(
            usingCurrentLocation: true,
            searchText: 'Ocala',
            currentPosition: _position(latitude: 29.1872, longitude: -82.1401),
          ),
        );

    expect(selected, isNotNull);
    expect(selected!.label, 'Ocala');
    expect(selected.latitude, 29.1872);
    expect(selected.longitude, -82.1401);
  });

  test('shared manually selected city ZIP coordinates are honored', () {
    final selected =
        LocalExpertReviewListPresenter.selectedLocationFromSharedState(
          const SharedLocationState(
            usingTypedSearchLocation: true,
            typedLatitude: 28.9025,
            typedLongitude: -82.5926,
            typedLabel: 'Crystal River',
            searchText: '34429',
          ),
        );

    expect(selected, isNotNull);
    expect(selected!.label, 'Crystal River');
    expect(selected.latitude, 28.9025);
    expect(selected.longitude, -82.5926);
  });

  test('missing shared selected location returns null safely', () {
    expect(
      LocalExpertReviewListPresenter.selectedLocationFromSharedState(
        const SharedLocationState(),
      ),
      isNull,
    );
  });

  test('restaurant button includes city and state when available', () {
    expect(
      LocalExpertReviewListPresenter.restaurantButtonLabel(
        _restaurant(city: 'Ocala', state: 'FL'),
      ),
      'Restaurant — Ocala, FL',
    );
    expect(
      LocalExpertReviewListPresenter.restaurantButtonLabel(
        _restaurant(city: '', state: ''),
      ),
      'Restaurant',
    );
  });

  testWidgets('destination row uses chevron and non-underlined styling', (
    tester,
  ) async {
    var tapped = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: LocalExpertReviewDestinationRow(
            label: 'Brother’s Pizza — Crystal River, FL',
            leadingIcon: Icons.storefront_outlined,
            onTap: () {
              tapped = true;
            },
          ),
        ),
      ),
    );

    expect(find.byIcon(Icons.chevron_right), findsOneWidget);
    final text = tester.widget<Text>(
      find.text('Brother’s Pizza — Crystal River, FL'),
    );
    expect(text.style?.decoration, isNot(TextDecoration.underline));

    await tester.tap(find.text('Brother’s Pizza — Crystal River, FL'));
    expect(tapped, isTrue);
  });

  testWidgets('review content region is tappable with right-aligned action', (
    tester,
  ) async {
    var tapped = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: LocalExpertReviewContentRegion(
            distanceLabel: '2.1 mi away',
            headline: 'Great burger',
            notes: 'Juicy and crisp.',
            dateLabel: 'Jan 1, 2026',
            onTap: () {
              tapped = true;
            },
          ),
        ),
      ),
    );

    expect(find.text('View review'), findsOneWidget);
    expect(find.byIcon(Icons.chevron_right), findsOneWidget);
    expect(find.text('Jan 1, 2026'), findsOneWidget);
    final text = tester.widget<Text>(find.text('View review'));
    expect(text.style?.decoration, isNot(TextDecoration.underline));
    expect(tester.getTopLeft(find.text('Jan 1, 2026')).dx, lessThan(40));
    expect(
      tester.getTopRight(find.text('View review')).dx,
      greaterThan(tester.getTopRight(find.text('Great burger')).dx),
    );

    await tester.tap(find.text('Juicy and crisp.'));
    expect(tapped, isTrue);
  });

  testWidgets(
    'sort dropdown is compact while preserving label and selected text',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 158,
              child: DropdownButtonFormField<LocalExpertReviewSort>(
                initialValue: LocalExpertReviewSort.highestRated,
                isExpanded: true,
                decoration: InputDecoration(
                  labelText: 'Sort',
                  isDense: true,
                  border: OutlineInputBorder(),
                  contentPadding: EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 7,
                  ),
                ),
                items: [
                  DropdownMenuItem(
                    value: LocalExpertReviewSort.highestRated,
                    child: Text('Highest rated'),
                  ),
                  DropdownMenuItem(
                    value: LocalExpertReviewSort.mostRecent,
                    child: Text('Most recent'),
                  ),
                  DropdownMenuItem(
                    value: LocalExpertReviewSort.lowestRated,
                    child: Text('Lowest rated'),
                  ),
                  DropdownMenuItem(
                    value: LocalExpertReviewSort.nearest,
                    child: Text('Nearest my selected location'),
                  ),
                ],
                onChanged: null,
              ),
            ),
          ),
        ),
      );

      expect(find.text('Sort'), findsOneWidget);
      expect(find.text('Highest rated'), findsOneWidget);
      expect(tester.getSize(find.byType(SizedBox).first).width, 158);
    },
  );

  test('expert review entry carries the stable exact review id', () {
    final entry = _entry('review-123');

    expect(entry.review.id, 'review-123');
    expect(entry.dish.id, 'dish-review-123');
  });
}

Position _position({required double latitude, required double longitude}) {
  return Position(
    latitude: latitude,
    longitude: longitude,
    timestamp: DateTime(2026, 1, 1),
    accuracy: 1,
    altitude: 0,
    altitudeAccuracy: 1,
    heading: 0,
    headingAccuracy: 1,
    speed: 0,
    speedAccuracy: 1,
  );
}

LocalExpertReviewEntry _entry(
  String id, {
  double score = 84,
  DateTime? createdAt,
  GeoPoint location = const GeoPoint(0, 0),
}) {
  return LocalExpertReviewEntry(
    review: DishReview(
      id: id,
      dishId: 'dish-$id',
      restaurantId: 'restaurant-$id',
      userId: 'user-1',
      overallImpression: 8,
      overallBiteScore: score,
      createdAt: createdAt ?? DateTime(2026, 1, 1),
    ),
    dish: BitescoreDish(
      id: 'dish-$id',
      restaurantId: 'restaurant-$id',
      restaurantName: 'Restaurant',
      name: 'Burger',
      normalizedName: 'burger',
      category: 'Burgers',
      categoryTags: const ['burger', 'burgers', 'american'],
    ),
    restaurant: _restaurant(id: 'restaurant-$id', location: location),
  );
}

BitescoreRestaurant _restaurant({
  String id = 'restaurant-1',
  String city = 'Ocala',
  String state = 'FL',
  GeoPoint location = const GeoPoint(0, 0),
}) {
  return BitescoreRestaurant(
    id: id,
    name: 'Restaurant',
    normalizedName: 'restaurant',
    address: '1 Main St',
    city: city,
    state: state,
    zipCode: '34470',
    location: location,
  );
}
