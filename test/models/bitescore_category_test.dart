import 'package:coupon_app/models/bitescore_category.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BitescoreCategories', () {
    test('Other appears first in main categories', () {
      expect(BitescoreCategories.all.first.displayName, 'Other');
      expect(BitescoreCategories.commonCategories.first.displayName, 'Other');
    });

    test('Other appears first in subcategory lists', () {
      for (final category in BitescoreCategories.all) {
        if (!category.hasSubcategories) {
          continue;
        }

        expect(
          category.subcategories.first,
          BitescoreCategories.otherLabel,
          reason: '${category.displayName} should put Other first.',
        );
      }
    });

    test('subcategories are alphabetized after Other', () {
      for (final category in BitescoreCategories.all) {
        if (category.subcategories.length <= 2) {
          continue;
        }

        final subcategoriesAfterOther = category.subcategories.skip(1).toList();
        final sortedSubcategories = [...subcategoriesAfterOther]
          ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));

        expect(
          subcategoriesAfterOther,
          sortedSubcategories,
          reason: '${category.displayName} subcategories should be sorted.',
        );
      }
    });

    test('categories with no subcategories are handled', () {
      final burgers = BitescoreCategories.byId('burgers');

      expect(burgers, isNotNull);
      expect(burgers!.hasSubcategories, isFalse);
      expect(burgers.subcategories, isEmpty);
    });

    test('search tags include category subcategory and manual keywords', () {
      final tags = BitescoreCategories.buildSearchableTags(
        categoryId: 'mexican',
        subcategory: 'Tacos',
        manualKeywords: 'Al pastor, spicy salsa',
      );

      expect(tags, containsAll(['mexican', 'tacos', 'al pastor']));
      expect(tags, containsAll(['spicy salsa', 'spicy', 'salsa']));
    });

    test('manual keywords are split trimmed lowercase and unique', () {
      final tags = BitescoreCategories.buildSearchableTags(
        categoryId: 'deli_sandwiches',
        manualKeywords: ' Sandwich, deli, hoagie, sandwich ',
      );

      expect(tags, containsAll(['deli', 'sandwich', 'hoagie']));
      expect(tags.where((tag) => tag == 'sandwich'), hasLength(1));
      expect(tags, everyElement(predicate<String>((tag) => tag == tag.trim())));
      expect(
        tags,
        everyElement(predicate<String>((tag) => tag == tag.toLowerCase())),
      );
    });

    test('quick pick categories include parent category tags', () {
      final burgerTags = BitescoreCategories.buildSearchableTags(
        categoryId: 'burgers',
      );
      final tacoTags = BitescoreCategories.buildSearchableTags(
        categoryId: 'tacos',
      );
      final pizzaTags = BitescoreCategories.buildSearchableTags(
        categoryId: 'pizza',
      );
      final donutTags = BitescoreCategories.buildSearchableTags(
        categoryId: 'donuts',
      );

      expect(burgerTags, containsAll(['burgers', 'burger', 'american']));
      expect(tacoTags, containsAll(['tacos', 'taco', 'mexican']));
      expect(pizzaTags, containsAll(['pizza', 'italian']));
      expect(
        donutTags,
        containsAll([
          'donuts',
          'donut',
          'dessert',
          'dessert / bakery',
          'bakery',
        ]),
      );
    });

    test('quick pick categories match parent category searches', () {
      expect(
        BitescoreCategories.matchesSearchQuery(
          categoryName: ' Burgers ',
          query: ' american ',
        ),
        isTrue,
      );
      expect(
        BitescoreCategories.matchesSearchQuery(
          categoryName: 'Tacos',
          query: 'Mexican',
        ),
        isTrue,
      );
      expect(
        BitescoreCategories.matchesSearchQuery(
          categoryName: 'Pizza',
          query: 'Italian',
        ),
        isTrue,
      );
      expect(
        BitescoreCategories.matchesSearchQuery(
          categoryName: 'Donuts',
          query: 'Dessert / Bakery',
        ),
        isTrue,
      );
      expect(
        BitescoreCategories.matchesSearchQuery(
          categoryName: null,
          categoryTags: const [],
          query: 'American',
        ),
        isFalse,
      );
    });

    test('category and subcategory produce expected searchable tags', () {
      final tags = BitescoreCategories.buildSearchableTags(
        categoryId: 'italian',
        subcategory: 'Pasta',
      );

      expect(tags, containsAll(['italian', 'pasta']));
    });

    test('main category Other requires manual keywords', () {
      expect(
        BitescoreCategories.validateSelection(category: 'Other'),
        'Please describe the category.',
      );
      expect(
        BitescoreCategories.validateSelection(
          category: 'Other',
          manualKeywords: 'Polish, pierogi, kielbasa',
        ),
        isNull,
      );
    });

    test('subcategory Other manual keywords are optional', () {
      expect(
        BitescoreCategories.validateSelection(
          category: 'Mexican',
          subcategory: 'Other',
        ),
        isNull,
      );
    });

    test(
      'more cuisines start at Thai and are alphabetized with Other last',
      () {
        expect(
          BitescoreCategories.commonCategories.last.displayName,
          'Japanese / Sushi',
        );
        expect(
          BitescoreCategories.moreCuisineCategories.first.displayName,
          'French',
        );

        final moreCuisineNames = BitescoreCategories.moreCuisineCategories
            .map((category) => category.displayName)
            .toList();
        final sortedNames = [
          ...moreCuisineNames.where(
            (name) => name != BitescoreCategories.otherLabel,
          ),
        ]..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));

        expect(
          moreCuisineNames.take(moreCuisineNames.length - 1).toList(),
          sortedNames,
        );
        expect(moreCuisineNames.last, BitescoreCategories.otherLabel);
        expect(moreCuisineNames, contains('Thai'));
      },
    );
  });
}
