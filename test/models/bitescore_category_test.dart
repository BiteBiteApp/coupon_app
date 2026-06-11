import 'package:coupon_app/models/bitescore_category.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BitescoreCategories', () {
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
  });
}
