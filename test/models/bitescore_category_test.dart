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
