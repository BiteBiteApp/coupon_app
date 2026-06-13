import 'package:coupon_app/models/bitescore_category.dart';
import 'package:coupon_app/models/bitescore_food_search.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BitescoreCategories sections', () {
    test('Section A includes Subs and keeps the existing featured order', () {
      final names = BitescoreCategories.featuredCategories
          .map((category) => category.displayName)
          .toList();

      expect(names, ['Burgers', 'Tacos', 'Pizza', 'Donuts', 'Subs']);
      expect(names, isNot(equals([...names]..sort())));
      expect(BitescoreCategories.byId('subs')?.hasSubcategories, isFalse);
    });

    test('Subs appears in Add a Dish and Filter Section A', () {
      expect(
        BitescoreCategories.addDishCommonCategories
            .take(6)
            .map((category) => category.displayName),
        ['Other', 'Burgers', 'Tacos', 'Pizza', 'Donuts', 'Subs'],
      );
      expect(
        BitescoreCategories.filterCommonCategories
            .take(5)
            .map((category) => category.displayName),
        ['Burgers', 'Tacos', 'Pizza', 'Donuts', 'Subs'],
      );
    });

    test(
      'Section B main categories are alphabetized without Section A or C',
      () {
        final sectionB = BitescoreCategories.sectionBMainCategories;
        final names = sectionB.map((category) => category.displayName).toList();
        final sortedNames = [...names]
          ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));

        expect(names, sortedNames);
        expect(names.first, 'American');
        expect(names, contains('Deli / Sandwiches'));
        expect(
          names.indexOf('Deli / Sandwiches'),
          names.indexOf('Coffee / Drinks') + 1,
        );
        expect(
          names.indexOf('Deli / Sandwiches'),
          lessThan(names.indexOf('Dessert / Bakery')),
        );
        expect(
          sectionB.map((category) => category.id),
          isNot(containsAll(['burgers', 'tacos', 'pizza', 'donuts', 'subs'])),
        );
        expect(names, isNot(contains('Thai')));
        expect(names, isNot(contains('Sandwiches')));
      },
    );

    test('Section C raw cuisine list stays alphabetized with Other last', () {
      final moreCuisineNames = BitescoreCategories.moreCuisineCategories
          .map((category) => category.displayName)
          .toList();
      final sortedNames = [
        ...moreCuisineNames.where(
          (name) => name != BitescoreCategories.otherLabel,
        ),
      ]..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));

      expect(moreCuisineNames.first, 'French');
      expect(
        moreCuisineNames.take(moreCuisineNames.length - 1).toList(),
        sortedNames,
      );
      expect(moreCuisineNames.last, BitescoreCategories.otherLabel);
      expect(moreCuisineNames, contains('Thai'));
    });

    test('Add and filter category lists do not duplicate category rows', () {
      final addIds = [
        ...BitescoreCategories.addDishCommonCategories,
        ...BitescoreCategories.addDishMoreCuisineCategories,
      ].map((category) => category.id).toList();
      final filterIds = [
        ...BitescoreCategories.filterCommonCategories,
        ...BitescoreCategories.filterMoreCuisineCategories,
      ].map((category) => category.id).toList();

      expect(addIds.toSet(), hasLength(addIds.length));
      expect(filterIds.toSet(), hasLength(filterIds.length));
    });
  });

  group('Deli / Sandwiches children', () {
    test('Sandwiches and Subs lead the Add a Dish Deli child list', () {
      final deli = BitescoreCategories.byId('deli_sandwiches');

      expect(deli, isNotNull);
      expect(deli!.subcategories.take(4), [
        'Sandwiches',
        'Subs',
        BitescoreCategories.otherLabel,
        'BLT',
      ]);
      expect(
        deli.subcategories.where((value) => value == 'Sandwiches'),
        hasLength(1),
      );
      expect(
        deli.subcategories.where((value) => value == 'Subs'),
        hasLength(1),
      );
      expect(deli.subcategories.skip(3).take(4), [
        'BLT',
        'Chicken salad sandwich',
        'Club sandwich',
        'Cuban sandwich',
      ]);
    });

    test('Filter Deli child list removes Other but keeps order', () {
      final deli = BitescoreCategories.filterCommonCategories.firstWhere(
        (category) => category.id == 'deli_sandwiches',
      );

      expect(deli.subcategories.take(5), [
        'Sandwiches',
        'Subs',
        'BLT',
        'Chicken salad sandwich',
        'Club sandwich',
      ]);
      expect(
        deli.subcategories,
        isNot(contains(BitescoreCategories.otherLabel)),
      );
    });
  });

  group('Other category behavior', () {
    test('Other remains available in Add a Dish but not Filter Categories', () {
      expect(
        BitescoreCategories.addDishCommonCategories.map(
          (category) => category.displayName,
        ),
        contains(BitescoreCategories.otherLabel),
      );
      expect(
        BitescoreCategories.filterCommonCategories.map(
          (category) => category.displayName,
        ),
        isNot(contains(BitescoreCategories.otherLabel)),
      );
      expect(
        BitescoreCategories.filterMoreCuisineCategories.map(
          (category) => category.displayName,
        ),
        isNot(contains(BitescoreCategories.otherLabel)),
      );
      expect(
        BitescoreCategories.filterCommonCategories.expand(
          (category) => category.subcategories,
        ),
        isNot(contains(BitescoreCategories.otherLabel)),
      );
    });

    test('main category Other still validates as an Add a Dish value', () {
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

    test('existing Other dish values remain searchable data values', () {
      final tags = BitescoreCategories.buildSearchableTags(
        categoryName: 'Other',
        manualKeywords: 'Pierogi, Polish',
      );

      expect(tags, containsAll(['other', 'pierogi', 'polish']));
    });
  });

  group('Category search compatibility', () {
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

    test('featured categories include parent category tags', () {
      final subsTags = BitescoreCategories.buildSearchableTags(
        categoryId: 'subs',
      );

      expect(
        subsTags,
        containsAll(['subs', 'sub', 'submarine sandwich', 'hoagie']),
      );
    });

    test('Subs uses specific sub-family matching', () {
      expect(
        BiteScoreFoodSearch.matchesFoodText('Italian hoagie', 'Subs'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Turkey grinder', 'Subs'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Barbecue sandwich', 'Subs'),
        isFalse,
      );
    });

    test('Sandwiches uses broad sandwich matching', () {
      expect(
        BiteScoreFoodSearch.matchesFoodText('Barbecue sandwich', 'Sandwiches'),
        isTrue,
      );
      expect(
        BiteScoreFoodSearch.matchesFoodText('Italian sub', 'Sandwiches'),
        isTrue,
      );
    });

    test('Add a Dish accepts new Deli / Sandwiches child values', () {
      expect(
        BitescoreCategories.validateSelection(
          category: 'Deli / Sandwiches',
          subcategory: 'Sandwiches',
        ),
        isNull,
      );
      expect(
        BitescoreCategories.validateSelection(
          category: 'Deli / Sandwiches',
          subcategory: 'Subs',
        ),
        isNull,
      );
      expect(BitescoreCategories.validateSelection(category: 'Subs'), isNull);
    });
  });
}
