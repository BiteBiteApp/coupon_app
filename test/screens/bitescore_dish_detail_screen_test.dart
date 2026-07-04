import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_dish_image.dart';
import 'package:coupon_app/models/bitescore_dish_image_vote.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/dish_rating_aggregate.dart';
import 'package:coupon_app/models/dish_review.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('multi-word title does not shrink when individual words fit', () {
    final size = BiteScoreResponsiveDishTitle.fittedFontSizeFor(
      text: 'Double Cheeseburger',
      availableWidth: 360,
    );

    expect(size, BiteScoreResponsiveDishTitle.normalFontSize);
  });

  test('normal length title keeps normal font size when practical', () {
    final size = BiteScoreResponsiveDishTitle.fittedFontSizeFor(
      text: 'Burger',
      availableWidth: 220,
    );

    expect(size, BiteScoreResponsiveDishTitle.normalFontSize);
  });

  testWidgets('dish title wraps naturally instead of forcing one line', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 360,
            child: BiteScoreResponsiveDishTitle(title: 'Double Cheeseburger'),
          ),
        ),
      ),
    );

    final title = tester.widget<Text>(find.text('Double Cheeseburger'));
    expect(title.maxLines, isNull);
    expect(title.softWrap, true);
    expect(title.style?.fontSize, BiteScoreResponsiveDishTitle.normalFontSize);
  });

  test('single overlong word shrinks only to readable minimum', () {
    final size = BiteScoreResponsiveDishTitle.fittedFontSizeFor(
      text: 'Supercalifragilisticexpialidocious',
      availableWidth: 90,
    );

    expect(size, BiteScoreResponsiveDishTitle.minFontSize);
  });

  test('overlong single-word fallback uses visible hyphen', () {
    final display = BiteScoreResponsiveDishTitle.hyphenatedTitleFor(
      text: 'Supercalifragilisticexpialidocious',
      availableWidth: 90,
      fontSize: BiteScoreResponsiveDishTitle.minFontSize,
    );

    expect(display, contains('-\n'));
  });

  test(
    'double cheeseburger does not create a lone trailing letter fallback',
    () {
      final display = BiteScoreResponsiveDishTitle.hyphenatedTitleFor(
        text: 'Double Cheeseburger',
        availableWidth: 360,
        fontSize: BiteScoreResponsiveDishTitle.normalFontSize,
      );

      expect(display, 'Double Cheeseburger');
      expect(display.endsWith('\nr'), isFalse);
    },
  );

  test(
    'dish detail accepts exact target review id without affecting normal navigation',
    () {
      final normal = BiteScoreDishDetailScreen(entry: _entry());
      final targeted = BiteScoreDishDetailScreen(
        entry: _entry(),
        targetReviewId: 'review-1',
      );
      final reviewFocused = BiteScoreDishDetailScreen(
        entry: _entry(),
        scrollToReviewSection: true,
      );

      expect(normal.targetReviewId, isNull);
      expect(normal.scrollToReviewSection, isFalse);
      expect(targeted.targetReviewId, 'review-1');
      expect(reviewFocused.scrollToReviewSection, isTrue);
    },
  );

  test('Most Helpful puts written reviews above textless reviews', () {
    final written = _review(id: 'written', notes: 'Fantastic sauce.');
    final textless = _review(id: 'textless');

    final sorted = BiteScoreReviewSortPresenter.mostHelpfulReviews(
      reviews: [textless, written],
      trustByReviewId: const {
        'textless': ReviewTrustSummary(helpfulCount: 20),
        'written': ReviewTrustSummary(helpfulCount: 1),
      },
    );

    expect(sorted.map((review) => review.id), ['written', 'textless']);
  });

  test(
    'Most Helpful keeps helpful sorting within written and textless groups',
    () {
      final writtenLow = _review(id: 'written-low', notes: 'Good.');
      final writtenHigh = _review(id: 'written-high', headline: 'Great');
      final textlessLow = _review(id: 'textless-low');
      final textlessHigh = _review(id: 'textless-high');

      final sorted = BiteScoreReviewSortPresenter.mostHelpfulReviews(
        reviews: [textlessLow, writtenLow, textlessHigh, writtenHigh],
        trustByReviewId: const {
          'written-low': ReviewTrustSummary(helpfulCount: 1),
          'written-high': ReviewTrustSummary(helpfulCount: 4),
          'textless-low': ReviewTrustSummary(helpfulCount: 2),
          'textless-high': ReviewTrustSummary(helpfulCount: 9),
        },
      );

      expect(sorted.map((review) => review.id), [
        'written-high',
        'written-low',
        'textless-high',
        'textless-low',
      ]);
    },
  );

  test('Most Helpful treats whitespace-only review text as textless', () {
    final whitespace = _review(id: 'whitespace', headline: '   ', notes: '\n ');
    final written = _review(id: 'written', notes: 'Crisp and fresh.');

    final sorted = BiteScoreReviewSortPresenter.mostHelpfulReviews(
      reviews: [whitespace, written],
      trustByReviewId: const {
        'whitespace': ReviewTrustSummary(helpfulCount: 8),
        'written': ReviewTrustSummary(helpfulCount: 0),
      },
    );

    expect(sorted.map((review) => review.id), ['written', 'whitespace']);
  });

  test('profile review category display prefers subcategory over category', () {
    final entry = BiteScoreUserReviewEntry(
      review: _review(id: 'review-1'),
      dish: _dish(category: 'American', subcategory: 'Wings'),
      restaurant: _restaurant(),
    );

    expect(entry.categoryDisplayName, 'Wings');
  });

  test(
    'profile review category display handles missing dish data gracefully',
    () {
      final entry = BiteScoreUserReviewEntry(
        review: _review(id: 'review-1'),
        dish: null,
        restaurant: _restaurant(),
      );

      expect(entry.categoryDisplayName, isNull);
    },
  );

  test('dish image preview prefers image records over primary image url', () {
    final dish = _dish(primaryImageUrl: 'https://example.com/primary.jpg');
    final image = _dishImage(imageUrl: 'https://example.com/secondary.jpg');

    expect(
      BiteScoreDishImagePreview.effectiveImageUrl(dish, [image]),
      'https://example.com/secondary.jpg',
    );
  });

  test('dish image preview falls back to legacy primary image url', () {
    final dish = _dish(primaryImageUrl: 'https://example.com/primary.jpg');

    expect(
      BiteScoreDishImagePreview.effectiveImageUrl(dish, const []),
      'https://example.com/primary.jpg',
    );
  });

  test('dish image preview can use existing image records', () {
    final image = _dishImage(imageUrl: 'https://example.com/dish.jpg');

    expect(
      BiteScoreDishImagePreview.effectiveImageUrl(_dish(), [image]),
      'https://example.com/dish.jpg',
    );
  });

  test('dish image preview uses the most thumbed-up image as main', () {
    final earlyImage = _dishImage(
      id: 'image-1',
      imageUrl: 'https://example.com/early.jpg',
      helpfulCount: 1,
      createdAt: DateTime(2024),
    );
    final popularImage = _dishImage(
      id: 'image-2',
      imageUrl: 'https://example.com/popular.jpg',
      helpfulCount: 4,
      createdAt: DateTime(2025),
    );

    expect(
      BiteScoreDishImagePreview.effectiveImageUrl(_dish(), [
        earlyImage,
        popularImage,
      ]),
      'https://example.com/popular.jpg',
    );
  });

  test('dish image preview breaks thumbs-up ties by earliest image', () {
    final earlyImage = _dishImage(
      id: 'image-1',
      imageUrl: 'https://example.com/early.jpg',
      helpfulCount: 2,
      createdAt: DateTime(2024),
    );
    final laterImage = _dishImage(
      id: 'image-2',
      imageUrl: 'https://example.com/later.jpg',
      helpfulCount: 2,
      createdAt: DateTime(2025),
    );

    expect(
      BiteScoreDishImagePreview.effectiveImageUrl(_dish(), [
        laterImage,
        earlyImage,
      ]),
      'https://example.com/early.jpg',
    );
  });

  test('dish image vote ids prevent duplicate votes by the same user', () {
    final first = BiteScoreService.dishImageVoteDocumentIdForTesting(
      imageId: 'image-1',
      userId: 'user-1',
    );
    final duplicate = BiteScoreService.dishImageVoteDocumentIdForTesting(
      imageId: 'image-1',
      userId: 'user-1',
    );
    final otherUser = BiteScoreService.dishImageVoteDocumentIdForTesting(
      imageId: 'image-1',
      userId: 'user-2',
    );

    expect(first, duplicate);
    expect(first, isNot(otherUser));
  });

  testWidgets('dish with an image shows the image normally', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: BiteScoreDishImagePreview(
            dish: _dish(primaryImageUrl: 'https://example.com/dish.jpg'),
            images: const [],
            isAddingImage: false,
          ),
        ),
      ),
    );

    expect(find.byType(Image), findsOneWidget);
    expect(find.text('Add Image'), findsNothing);
    expect(
      find.byKey(const ValueKey('bitescore-dish-add-image-placeholder')),
      findsNothing,
    );
  });

  testWidgets('dish without an image shows add image placeholder', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: BiteScoreDishImagePreview(
            dish: _dish(),
            images: const [],
            isAddingImage: false,
          ),
        ),
      ),
    );

    expect(
      find.byKey(const ValueKey('bitescore-dish-add-image-placeholder')),
      findsOneWidget,
    );
    expect(find.text('Add Image'), findsOneWidget);
    expect(find.byIcon(Icons.add_a_photo_outlined), findsOneWidget);
  });

  testWidgets('tapping add image starts the add image flow', (tester) async {
    var tapped = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: BiteScoreDishImagePreview(
            dish: _dish(),
            images: const [],
            isAddingImage: false,
            onAddImage: () {
              tapped = true;
            },
          ),
        ),
      ),
    );

    await tester.tap(
      find.byKey(const ValueKey('bitescore-dish-add-image-button')),
    );
    await tester.pump();

    expect(tapped, isTrue);
    expect(find.text('Add Image'), findsOneWidget);
  });

  testWidgets('tapping main image opens the gallery action', (tester) async {
    var opened = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: BiteScoreDishImagePreview(
            dish: _dish(primaryImageUrl: 'https://example.com/dish.jpg'),
            images: const [],
            isAddingImage: false,
            onOpenImage: () {
              opened = true;
            },
          ),
        ),
      ),
    );

    await tester.tap(find.byType(InkWell));
    await tester.pump();

    expect(opened, isTrue);
  });

  testWidgets('canceling image selection can leave the placeholder unchanged', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: BiteScoreDishImagePreview(
            dish: _dish(),
            images: const [],
            isAddingImage: false,
            onAddImage: () {},
          ),
        ),
      ),
    );

    await tester.tap(
      find.byKey(const ValueKey('bitescore-dish-add-image-button')),
    );
    await tester.pump();

    expect(find.text('Add Image'), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('uploading state disables add image action', (tester) async {
    var tapped = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: BiteScoreDishImagePreview(
            dish: _dish(),
            images: const [],
            isAddingImage: true,
            onAddImage: () {
              tapped = true;
            },
          ),
        ),
      ),
    );

    await tester.tap(
      find.byKey(const ValueKey('bitescore-dish-add-image-button')),
    );
    await tester.pump();

    expect(tapped, isFalse);
    expect(find.text('Uploading'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('gallery displays selected image and thumbnails', (tester) async {
    final first = _dishImage(
      id: 'image-1',
      imageUrl: 'https://example.com/first.jpg',
    );
    final second = _dishImage(
      id: 'image-2',
      imageUrl: 'https://example.com/second.jpg',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: BiteScoreDishImageGalleryScreen(
          dish: _dish(),
          restaurant: _restaurant(),
          images: [first, second],
          imageUrls: [first.imageUrl, second.imageUrl],
          initialIndex: 0,
          loadCurrentVotes: (_) async => const <String, String>{},
        ),
      ),
    );
    await tester.pump();

    expect(
      find.byKey(
        const ValueKey(
          'bitescore-gallery-main-image-https://example.com/first.jpg',
        ),
      ),
      findsOneWidget,
    );
    expect(
      find.byKey(
        const ValueKey(
          'bitescore-gallery-thumbnail-https://example.com/first.jpg',
        ),
      ),
      findsOneWidget,
    );
    expect(
      find.byKey(
        const ValueKey(
          'bitescore-gallery-thumbnail-https://example.com/second.jpg',
        ),
      ),
      findsOneWidget,
    );
  });

  testWidgets('gallery thumbnail tap changes the selected image', (
    tester,
  ) async {
    final first = _dishImage(
      id: 'image-1',
      imageUrl: 'https://example.com/first.jpg',
    );
    final second = _dishImage(
      id: 'image-2',
      imageUrl: 'https://example.com/second.jpg',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: BiteScoreDishImageGalleryScreen(
          dish: _dish(),
          restaurant: _restaurant(),
          images: [first, second],
          imageUrls: [first.imageUrl, second.imageUrl],
          initialIndex: 0,
          loadCurrentVotes: (_) async => const <String, String>{},
        ),
      ),
    );

    await tester.tap(
      find.byKey(
        const ValueKey(
          'bitescore-gallery-thumbnail-https://example.com/second.jpg',
        ),
      ),
    );
    await tester.pump();

    expect(
      find.byKey(
        const ValueKey(
          'bitescore-gallery-main-image-https://example.com/second.jpg',
        ),
      ),
      findsOneWidget,
    );
  });

  testWidgets('gallery add image appends without replacing existing images', (
    tester,
  ) async {
    final first = _dishImage(
      id: 'image-1',
      imageUrl: 'https://example.com/first.jpg',
    );
    final second = _dishImage(
      id: 'image-2',
      imageUrl: 'https://example.com/second.jpg',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: BiteScoreDishImageGalleryScreen(
          dish: _dish(),
          restaurant: _restaurant(),
          images: [first],
          imageUrls: [first.imageUrl],
          initialIndex: 0,
          loadCurrentVotes: (_) async => const <String, String>{},
          onAddImage: (context, dish, restaurant) async => second,
        ),
      ),
    );

    await tester.tap(
      find.byKey(const ValueKey('bitescore-gallery-add-image-button')),
    );
    await tester.pump();

    expect(
      find.byKey(
        const ValueKey(
          'bitescore-gallery-thumbnail-https://example.com/first.jpg',
        ),
      ),
      findsOneWidget,
    );
    expect(
      find.byKey(
        const ValueKey(
          'bitescore-gallery-thumbnail-https://example.com/second.jpg',
        ),
      ),
      findsOneWidget,
    );
    expect(
      find.byKey(
        const ValueKey(
          'bitescore-gallery-main-image-https://example.com/second.jpg',
        ),
      ),
      findsOneWidget,
    );
  });

  testWidgets('gallery thumbs-up toggles the current image vote', (
    tester,
  ) async {
    final image = _dishImage(id: 'image-1', helpfulCount: 0);
    var voteCalls = 0;

    await tester.pumpWidget(
      MaterialApp(
        home: BiteScoreDishImageGalleryScreen(
          dish: _dish(),
          restaurant: _restaurant(),
          images: [image],
          imageUrls: [image.imageUrl],
          initialIndex: 0,
          canVote: (_) async => true,
          loadCurrentVotes: (_) async => const <String, String>{},
          onToggleVote: ({required image, required voteType}) async {
            voteCalls += 1;
            expect(voteType, BiteScoreDishImageVote.voteHelpful);
            return BiteScoreDishImageVoteResult(
              image: image.copyWith(helpfulCount: 1),
              currentUserVoteType: BiteScoreDishImageVote.voteHelpful,
            );
          },
        ),
      ),
    );

    await tester.tap(
      find.byKey(const ValueKey('bitescore-gallery-thumbs-up-button')),
    );
    await tester.pump();

    expect(voteCalls, 1);
    expect(find.text('1'), findsOneWidget);
    expect(find.byIcon(Icons.thumb_up_alt), findsOneWidget);
  });
}

BitescoreDish _dish({
  String? primaryImageUrl,
  String? category = 'Burgers',
  String? subcategory,
}) {
  return BitescoreDish(
    id: 'dish-1',
    restaurantId: 'restaurant-1',
    restaurantName: 'Restaurant',
    name: 'Double Cheeseburger',
    normalizedName: 'double cheeseburger',
    category: category,
    subcategory: subcategory,
    categoryTags: const ['burger', 'burgers', 'american'],
    primaryImageUrl: primaryImageUrl,
  );
}

BiteScoreDishImage _dishImage({
  String id = 'image-1',
  String imageUrl = 'https://example.com/dish.jpg',
  int helpfulCount = 0,
  int sortOrder = 0,
  DateTime? createdAt,
}) {
  return BiteScoreDishImage(
    id: id,
    dishId: 'dish-1',
    restaurantId: 'restaurant-1',
    uploadedByUserId: 'user-1',
    imageUrl: imageUrl,
    storagePath: 'bitescore_dishes/dish-1/images/1.jpg',
    helpfulCount: helpfulCount,
    sortOrder: sortOrder,
    createdAt: createdAt,
  );
}

BitescoreRestaurant _restaurant() {
  return const BitescoreRestaurant(
    id: 'restaurant-1',
    name: 'Restaurant',
    normalizedName: 'restaurant',
    address: '1 Main St',
    city: 'Ocala',
    state: 'FL',
    zipCode: '34470',
    location: GeoPoint(0, 0),
  );
}

BiteScoreHomeEntry _entry() {
  return BiteScoreHomeEntry(
    dish: _dish(),
    restaurant: _restaurant(),
    aggregate: const DishRatingAggregate(
      dishId: 'dish-1',
      restaurantId: 'restaurant-1',
    ),
  );
}

DishReview _review({
  required String id,
  String? headline,
  String? notes,
  DateTime? createdAt,
}) {
  return DishReview(
    id: id,
    dishId: 'dish-1',
    restaurantId: 'restaurant-1',
    userId: 'user-$id',
    headline: headline,
    notes: notes,
    overallImpression: 8,
    overallBiteScore: 80,
    createdAt: createdAt,
  );
}
