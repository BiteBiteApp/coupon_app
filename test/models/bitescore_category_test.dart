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
      expect(BitescoreCategories.byId('pizza')?.hasSubcategories, isFalse);
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

    test('Section A Pizza is standalone but Italian still offers Pizza', () {
      final addPizza = BitescoreCategories.addDishCommonCategories.firstWhere(
        (category) => category.id == 'pizza',
      );
      final filterPizza = BitescoreCategories.filterCommonCategories.firstWhere(
        (category) => category.id == 'pizza',
      );
      final italian = BitescoreCategories.byId('italian');

      expect(addPizza.hasSubcategories, isFalse);
      expect(filterPizza.hasSubcategories, isFalse);
      expect(addPizza.displayName, 'Pizza');
      expect(filterPizza.displayName, 'Pizza');
      expect(italian?.subcategories, contains('Pizza'));
      expect(BitescoreCategories.validateSelection(category: 'Pizza'), isNull);
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
        expect(names, contains('Cuban'));
        expect(names.indexOf('Cuban'), names.indexOf('Coffee / Drinks') + 1);
        expect(
          names.indexOf('Cuban'),
          lessThan(names.indexOf('Deli / Sandwiches')),
        );
        expect(names, contains('Deli / Sandwiches'));
        expect(names.indexOf('Deli / Sandwiches'), names.indexOf('Cuban') + 1);
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
        expect(names, isNot(contains('Latin / Caribbean')));
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
      expect(moreCuisineNames, isNot(contains('Cuban')));
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

  group('Cuban category', () {
    test('Cuban is a Section B category in Add a Dish and Filter lists', () {
      final addNames = BitescoreCategories.addDishCommonCategories
          .map((category) => category.displayName)
          .toList();
      final filterNames = BitescoreCategories.filterCommonCategories
          .map((category) => category.displayName)
          .toList();

      expect(addNames, contains('Cuban'));
      expect(filterNames, contains('Cuban'));
      expect(
        addNames.indexOf('Cuban'),
        lessThan(addNames.indexOf('Deli / Sandwiches')),
      );
      expect(
        filterNames.indexOf('Cuban'),
        lessThan(filterNames.indexOf('Deli / Sandwiches')),
      );
      expect(
        BitescoreCategories.addDishMoreCuisineCategories.map(
          (category) => category.displayName,
        ),
        isNot(contains('Cuban')),
      );
      expect(
        BitescoreCategories.filterMoreCuisineCategories.map(
          (category) => category.displayName,
        ),
        isNot(contains('Cuban')),
      );
    });

    test('Cuban includes the practical reviewed dish list', () {
      final cuban = BitescoreCategories.byId('cuban');

      expect(cuban, isNotNull);
      expect(cuban!.displayName, 'Cuban');
      expect(
        cuban.subcategories,
        containsAll([
          'Cuban sandwich',
          'Medianoche',
          'Ropa vieja',
          'Picadillo',
          'Lechón / roast pork',
          'Masitas de puerco',
          'Vaca frita',
          'Arroz con pollo',
          'Palomilla steak',
          'Bistec empanizado',
          'Croquetas',
          'Potato balls / papas rellenas',
          'Empanadas',
          'Black beans and rice',
          'Moros y cristianos',
          'Yuca with mojo',
          'Tostones',
          'Maduros / sweet plantains',
          'Cuban tamal',
          'Cuban-style chicken',
          'Cuban coffee',
          'Flan',
        ]),
      );
    });

    test(
      'Cuban sandwich has shared Cuban and Deli tags from either parent',
      () {
        final fromDeli = BitescoreCategories.buildSearchableTags(
          categoryName: 'Deli / Sandwiches',
          subcategory: 'Cuban sandwich',
        );
        final fromCuban = BitescoreCategories.buildSearchableTags(
          categoryName: 'Cuban',
          subcategory: 'Cuban sandwich',
        );

        expect(
          fromDeli,
          containsAll([
            BitescoreCategories.cubanSandwichCanonicalId,
            'cuban',
            'deli',
            'sandwich',
          ]),
        );
        expect(
          fromCuban,
          containsAll([
            BitescoreCategories.cubanSandwichCanonicalId,
            'cuban',
            'deli',
            'sandwich',
          ]),
        );
        expect(
          BitescoreCategories.matchesSearchQuery(
            categoryName: 'Cuban',
            subcategory: 'Cuban sandwich',
            categoryTags: fromCuban,
            query: 'Deli / Sandwiches',
          ),
          isTrue,
        );
        expect(
          BitescoreCategories.matchesSearchQuery(
            categoryName: 'Deli / Sandwiches',
            subcategory: 'Cuban sandwich',
            categoryTags: fromDeli,
            query: 'Cuban',
          ),
          isTrue,
        );
        expect(
          BitescoreCategories.matchesSearchQuery(
            categoryName: 'Deli / Sandwiches',
            subcategory: 'Cuban sandwich',
            query: 'Cuban',
          ),
          isTrue,
        );
        expect(
          BitescoreCategories.matchesSearchQuery(
            categoryName: 'Cuban',
            subcategory: 'Cuban sandwich',
            query: 'Deli / Sandwiches',
          ),
          isTrue,
        );
        expect(
          BitescoreCategories.canonicalDishClassificationIdFor(
            'Cuban sandwich',
          ),
          BitescoreCategories.cubanSandwichCanonicalId,
        );
      },
    );
  });

  group('American Chicken Pie category', () {
    test('Chicken Pie / Chicken Pot Pie appears beneath American', () {
      final american = BitescoreCategories.byId('american');
      final filterAmerican = BitescoreCategories.filterCommonCategories
          .firstWhere((category) => category.id == 'american');

      expect(american, isNotNull);
      expect(
        american!.subcategories,
        contains('Chicken Pie / Chicken Pot Pie'),
      );
      expect(
        american.subcategories.indexOf('Chicken Pie / Chicken Pot Pie'),
        lessThan(american.subcategories.indexOf('Chicken tenders')),
      );
      expect(
        filterAmerican.subcategories,
        contains('Chicken Pie / Chicken Pot Pie'),
      );
    });

    test('Chicken Pie aliases resolve to one canonical classification id', () {
      for (final value in [
        'Chicken Pie / Chicken Pot Pie',
        'chicken pie',
        'Chicken Pies',
        'chicken pot pie',
        'Chicken Pot Pies',
      ]) {
        expect(
          BitescoreCategories.canonicalDishClassificationIdFor(value),
          BitescoreCategories.chickenPieCanonicalId,
        );
      }
    });

    test('Chicken Pie save metadata includes canonical and alias tags', () {
      final tags = BitescoreCategories.buildSearchableTags(
        categoryName: 'American',
        subcategory: 'Chicken Pie / Chicken Pot Pie',
      );

      expect(
        tags,
        containsAll([
          BitescoreCategories.chickenPieCanonicalId,
          'chicken pie',
          'chicken pot pie',
          'american',
        ]),
      );
      expect(
        BitescoreCategories.matchesSearchQuery(
          categoryName: 'American',
          subcategory: 'Chicken Pie / Chicken Pot Pie',
          categoryTags: tags,
          query: 'chicken pot pie',
        ),
        isTrue,
      );
      expect(
        BitescoreCategories.matchesSearchQuery(
          categoryName: 'American',
          subcategory: 'Chicken Pie / Chicken Pot Pie',
          categoryTags: tags,
          query: 'chicken pie',
        ),
        isTrue,
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
