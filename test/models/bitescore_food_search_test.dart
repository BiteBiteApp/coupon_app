import 'package:coupon_app/models/bitescore_category.dart';
import 'package:coupon_app/models/bitescore_food_search.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BiteScore food search normalization', () {
    test('normalizes capitalization whitespace punctuation and hyphens', () {
      expect(BiteScoreFoodSearch.normalize('  PO-BOY!!  '), 'po boy');
      expect(BiteScoreFoodSearch.normalize('Mozz   Sticks'), 'mozz sticks');
    });

    test('normalizes ampersands apostrophes and accents', () {
      expect(BiteScoreFoodSearch.normalize('Mac & Cheese'), 'mac and cheese');
      expect(BiteScoreFoodSearch.normalize("Po' Boy"), 'po boy');
      expect(BiteScoreFoodSearch.normalize('phở café'), 'pho cafe');
    });

    test('supports joined and separated variants', () {
      expect(BiteScoreFoodSearch.matchesFoodText('Hot Dog', 'hotdog'), isTrue);
      expect(
        BiteScoreFoodSearch.matchesFoodText('Cole Slaw', 'coleslaw'),
        isTrue,
      );
      expect(BiteScoreFoodSearch.matchesFoodText('Lo Mein', 'lomein'), isTrue);
    });
  });

  group('BiteScore food search aliases', () {
    test('generic sandwich search includes specific sub-family terms', () {
      expect(
        BiteScoreFoodSearch.matchesFoodText('Barbecue Sandwich', 'sandwich'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Italian Sub', 'sandwich'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Meatball Hoagie', 'sandwich'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Turkey Grinder', 'sandwich'),
        isTrue,
      );
    });

    test('specific sub-family aliases are mutually equivalent', () {
      expect(
        BiteScoreFoodSearch.matchesFoodText('Italian Hoagie', 'sub'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Meatball Grinder', 'sub'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Turkey Sub', 'hoagie'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          'Italian Submarine Sandwich',
          'hero',
        ),
        isTrue,
      );
    });

    test('coleslaw and slaw are equivalent', () {
      expect(BiteScoreFoodSearch.matchesFoodText('slaw', 'coleslaw'), isTrue);
      expect(BiteScoreFoodSearch.matchesFoodText('coleslaw', 'slaw'), isTrue);
    });

    test('burger family intentionally broadens both directions', () {
      expect(
        BiteScoreFoodSearch.matchesFoodText('Plain hamburger', 'cheeseburger'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Bacon cheeseburger', 'hamburger'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Smashburger', 'burger'),
        isTrue,
      );
    });

    test('mozzarella sticks aliases work', () {
      expect(
        BiteScoreFoodSearch.matchesFoodText('Mozzarella sticks', 'mozz sticks'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Mozzarella sticks', 'moz sticks'),
        isTrue,
      );
    });

    test('additional reviewed alias groups work', () {
      expect(
        BiteScoreFoodSearch.matchesFoodText('Barbecue ribs', 'BBQ'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Glazed doughnut', 'donut'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Kebab plate', 'kabob'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Garlic shrimp', 'prawns'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Crawfish boil', 'crawdad'),
        isTrue,
      );
      expect(BiteScoreFoodSearch.matchesFoodText("Po' boy", 'poboy'), isTrue);
      expect(
        BiteScoreFoodSearch.matchesFoodText('Collard greens', 'collards'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Sweet potato fries', 'yam'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Chicken parmesan', 'chicken parm'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          "General Tso's chicken",
          'General Tao chicken',
        ),
        isTrue,
      );
    });
  });

  group('BiteScore food search avoids unwanted broadening', () {
    test('specific dishes do not become unrelated broad categories', () {
      expect(
        BiteScoreFoodSearch.matchesFoodText('Garden salad', 'Caesar salad'),
        isFalse,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Tomato chowder', 'clam chowder'),
        isFalse,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Salsa roja', 'pico de gallo'),
        isFalse,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Spring roll', 'egg roll'),
        isFalse,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Chow mein', 'lo mein'),
        isFalse,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Vanilla ice cream', 'gelato'),
        isFalse,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Steak sandwich', 'cheesesteak'),
        isFalse,
      );
    });

    test('specific sub-family search does not match generic sandwiches', () {
      expect(
        BiteScoreFoodSearch.matchesFoodText('Barbecue Sandwich', 'sub'),
        isFalse,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Grilled Chicken Sandwich', 'sub'),
        isFalse,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Pulled Pork Sandwich', 'hoagie'),
        isFalse,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          'Grilled Cheese Sandwich',
          'grinder',
        ),
        isFalse,
      );
    });

    test(
      'generic sandwich with independent sub metadata can still qualify',
      () {
        expect(
          BiteScoreFoodSearch.matchesAnyFoodText([
            'Barbecue Sandwich',
            'sub',
          ], 'sub'),
          isTrue,
        );
      },
    );
  });

  group('BiteScore food search fuzzy matching', () {
    test('typed typo fallback finds close food terms and aliases', () {
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          'Mozzarella sticks',
          'mozerella sticks',
          enableFuzzy: true,
        ),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          'Hamburger',
          'cheesburger',
          enableFuzzy: true,
        ),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          'Quesadilla',
          'quesadila',
          enableFuzzy: true,
        ),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          'Turkey sandwich',
          'sandwhich',
          enableFuzzy: true,
        ),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          'Italian Sub',
          'sandwhich',
          enableFuzzy: true,
        ),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          'Pulled Pork Sandwich',
          'hogie',
          enableFuzzy: true,
        ),
        isFalse,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          'Meatball Grinder',
          'hogie',
          enableFuzzy: true,
        ),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          'Coleslaw',
          'colslaw',
          enableFuzzy: true,
        ),
        isTrue,
      );
    });

    test('short words are not fuzzily over-expanded', () {
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          'Ribeye steak',
          'rib',
          enableFuzzy: true,
        ),
        isFalse,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          'Sweet tea',
          'sea',
          enableFuzzy: true,
        ),
        isFalse,
      );
    });

    test('direct and alias matches work without fuzzy fallback', () {
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          'Mozzarella sticks',
          'mozzarella',
          enableFuzzy: false,
        ),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          'Mozzarella sticks',
          'mozz sticks',
          enableFuzzy: false,
        ),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText(
          'Mozzarella sticks',
          'mozerella sticks',
          enableFuzzy: false,
        ),
        isFalse,
      );
    });
  });

  group('BiteScore food search filters and sorting', () {
    test('category alias expansion works without fuzzy matching', () {
      expect(
        BitescoreCategories.matchesSearchQuery(
          categoryName: 'Deli / Sandwiches',
          subcategory: 'Italian sub',
          query: 'sandwich',
        ),
        isTrue,
      );
      expect(
        BitescoreCategories.matchesSearchQuery(
          subcategory: 'Barbecue Sandwich',
          query: 'sub',
        ),
        isFalse,
      );
      expect(
        BitescoreCategories.matchesSearchQuery(
          categoryName: 'Deli / Sandwiches',
          subcategory: 'Barbecue Sandwich',
          categoryTags: const ['sub'],
          query: 'sub',
        ),
        isTrue,
      );
      expect(
        BitescoreCategories.matchesSearchQuery(
          categoryName: 'Deli / Sandwiches',
          subcategory: 'Italian sub',
          query: 'sandwich',
        ),
        isTrue,
      );
      expect(
        BitescoreCategories.matchesSearchQuery(
          categoryName: 'BBQ',
          subcategory: 'Coleslaw',
          query: 'slaw',
        ),
        isTrue,
      );
      expect(
        BitescoreCategories.matchesSearchQuery(
          categoryName: 'Burgers',
          query: 'cheeseburger',
        ),
        isTrue,
      );
    });

    test('controlled filter values do not use fuzzy matching by default', () {
      expect(
        BitescoreCategories.matchesSearchQuery(
          categoryName: 'Mexican',
          subcategory: 'Quesadilla',
          query: 'quesadila',
        ),
        isFalse,
      );
      expect(
        BitescoreCategories.matchesSearchQuery(
          categoryName: 'Mexican',
          subcategory: 'Quesadilla',
          query: 'quesadila',
          enableFuzzy: true,
        ),
        isTrue,
      );
    });

    test('alias-expanded results can keep the selected sort order', () {
      final dishes =
          [
              (name: 'Hamburger', score: 70),
              (name: 'Bacon cheeseburger', score: 95),
              (name: 'Smashburger', score: 85),
            ].where((dish) {
              return BiteScoreFoodSearch.matchesFoodText(dish.name, 'burger');
            }).toList()
            ..sort((a, b) => b.score.compareTo(a.score));

      expect(dishes.map((dish) => dish.name), [
        'Bacon cheeseburger',
        'Smashburger',
        'Hamburger',
      ]);
    });
  });
}
