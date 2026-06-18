import 'bitescore_category.dart';
import 'bitescore_food_search.dart';

enum LocalExpertBadgeLevel { level1, level2, level3 }

class LocalExpertBadgeThreshold {
  final int? distinctRestaurantsInCluster;
  final int distinctRestaurantsOverall;

  const LocalExpertBadgeThreshold({
    this.distinctRestaurantsInCluster,
    required this.distinctRestaurantsOverall,
  });
}

class LocalExpertBadgeThresholds {
  static const double clusterRadiusMiles = 30;

  static const Map<LocalExpertBadgeLevel, LocalExpertBadgeThreshold> byLevel = {
    LocalExpertBadgeLevel.level1: LocalExpertBadgeThreshold(
      distinctRestaurantsInCluster: 3,
      distinctRestaurantsOverall: 5,
    ),
    LocalExpertBadgeLevel.level2: LocalExpertBadgeThreshold(
      distinctRestaurantsInCluster: 5,
      distinctRestaurantsOverall: 10,
    ),
    LocalExpertBadgeLevel.level3: LocalExpertBadgeThreshold(
      distinctRestaurantsOverall: 25,
    ),
  };

  static LocalExpertBadgeThreshold forLevel(LocalExpertBadgeLevel level) {
    return byLevel[level]!;
  }
}

class LocalExpertType {
  final String id;
  final String displayName;
  final String iconName;
  final List<String> mappedCategoryIds;
  final List<String> mappedCategoryNames;
  final List<String> mappedSubcategories;
  final List<String> exactAliases;
  final List<String> aliases;
  final List<String> excludedCategoryIds;
  final List<String> excludedCategoryNames;
  final List<String> excludedSubcategories;
  final List<String> excludedAliases;
  final bool categoryMayQualify;

  const LocalExpertType({
    required this.id,
    required this.displayName,
    required this.iconName,
    this.mappedCategoryIds = const [],
    this.mappedCategoryNames = const [],
    this.mappedSubcategories = const [],
    this.exactAliases = const [],
    this.aliases = const [],
    this.excludedCategoryIds = const [],
    this.excludedCategoryNames = const [],
    this.excludedSubcategories = const [],
    this.excludedAliases = const [],
    this.categoryMayQualify = false,
  });
}

class LocalExpertReviewReference {
  final String userId;
  final String reviewId;
  final String restaurantId;
  final String expertTypeId;

  const LocalExpertReviewReference({
    required this.userId,
    required this.reviewId,
    required this.restaurantId,
    required this.expertTypeId,
  });

  String get deduplicationKey => LocalExperts.deduplicationKey(
    userId: userId,
    restaurantId: restaurantId,
    expertTypeId: expertTypeId,
  );
}

class LocalExperts {
  static const int minimumWrittenReviewWords = 10;
  static const Set<String> legacyExpertTypeIds = {
    'burrito',
    'tacos',
    'lobster',
    'pasta',
  };

  static const LocalExpertType burger = LocalExpertType(
    id: 'burger',
    displayName: 'Burger',
    iconName: 'lunch_dining',
    mappedCategoryIds: ['burgers'],
    mappedCategoryNames: ['Burgers'],
    mappedSubcategories: ['Burgers', 'Black bean burger', 'Veggie burger'],
    aliases: ['burger', 'burgers', 'cheeseburger', 'bacon burger'],
    categoryMayQualify: true,
  );

  static const LocalExpertType pizza = LocalExpertType(
    id: 'pizza',
    displayName: 'Pizza',
    iconName: 'local_pizza',
    mappedCategoryIds: ['pizza'],
    mappedCategoryNames: ['Pizza'],
    mappedSubcategories: ['Pizza', 'Vegan pizza'],
    aliases: ['pizza', 'pepperoni pizza', 'cheese pizza', 'vegan pizza'],
    categoryMayQualify: true,
  );

  static const LocalExpertType wings = LocalExpertType(
    id: 'wings',
    displayName: 'Wings',
    iconName: 'chicken_wing',
    mappedSubcategories: ['Boneless wings', 'Wings'],
    aliases: ['wings', 'wing', 'chicken wings', 'boneless wings'],
  );

  static const LocalExpertType ramen = LocalExpertType(
    id: 'ramen',
    displayName: 'Ramen',
    iconName: 'ramen_dining',
    mappedSubcategories: ['Ramen'],
    aliases: ['ramen', 'tonkotsu ramen', 'miso ramen'],
  );

  static const LocalExpertType donuts = LocalExpertType(
    id: 'donuts',
    displayName: 'Donuts',
    iconName: 'donut_ring',
    mappedCategoryIds: ['donuts'],
    mappedCategoryNames: ['Donuts'],
    aliases: ['donut', 'donuts', 'doughnut', 'doughnuts'],
    categoryMayQualify: true,
  );

  static const LocalExpertType chinese = LocalExpertType(
    id: 'chinese',
    displayName: 'Chinese',
    iconName: 'CH',
    mappedCategoryIds: ['chinese'],
    mappedCategoryNames: ['Chinese'],
    mappedSubcategories: [
      'Beef and broccoli',
      'Chow mein',
      'Dumplings',
      'Egg rolls',
      'Fried rice',
      'General Tso’s chicken',
      'Hot and sour soup',
      'Kung pao chicken',
      'Lo mein',
      'Mongolian beef',
      'Orange chicken',
      'Sesame chicken',
      'Sweet and sour chicken',
      'Wonton soup',
    ],
    aliases: ['chinese', 'general tsos chicken', 'kung pao', 'lo mein'],
    categoryMayQualify: true,
  );

  static const LocalExpertType japaneseSushi = LocalExpertType(
    id: 'japanese_sushi',
    displayName: 'Japanese / Sushi',
    iconName: 'set_meal',
    mappedCategoryIds: ['japanese_sushi'],
    mappedCategoryNames: ['Japanese / Sushi'],
    mappedSubcategories: [
      'Bento box',
      'Gyoza',
      'Hibachi chicken',
      'Hibachi steak',
      'Nigiri',
      'Sashimi',
      'Sushi',
      'Sushi roll',
      'Tempura',
      'Teriyaki chicken',
      'Udon',
    ],
    aliases: ['japanese', 'sushi', 'sashimi', 'nigiri', 'hibachi', 'teriyaki'],
    categoryMayQualify: true,
  );

  static const LocalExpertType steak = LocalExpertType(
    id: 'steak',
    displayName: 'Steak',
    iconName: 'ST',
    mappedCategoryIds: ['steakhouse'],
    mappedCategoryNames: ['Steakhouse'],
    mappedSubcategories: [
      'Filet mignon',
      'Hibachi steak',
      'New York strip',
      'Prime rib',
      'Ribeye',
      'Sirloin',
      'Steak',
      'Steak frites',
      'Steak sandwich',
      'Steak tips',
      'T-bone steak',
    ],
    aliases: [
      'steak',
      'ribeye',
      'filet mignon',
      'new york strip',
      'sirloin',
      't-bone',
      't bone',
      'porterhouse',
      'prime rib',
    ],
    categoryMayQualify: false,
  );

  static const LocalExpertType mexican = LocalExpertType(
    id: 'mexican',
    displayName: 'Mexican',
    iconName: 'MX',
    mappedCategoryIds: ['mexican', 'tacos'],
    mappedCategoryNames: ['Mexican', 'Tacos'],
    mappedSubcategories: [
      'Burrito',
      'Breakfast burrito',
      'Breakfast tacos',
      'Carne asada',
      'Chilaquiles',
      'Chile relleno',
      'Chimichanga',
      'Elote / street corn',
      'Enchiladas',
      'Fajitas',
      'Guacamole',
      'Nachos',
      'Quesadilla',
      'Rice bowl',
      'Tacos',
      'Tamales',
      'Tostada',
      'Vegan tacos',
    ],
    aliases: [
      'mexican',
      'taco',
      'tacos',
      'burrito',
      'burritos',
      'enchiladas',
      'quesadilla',
      'quesadillas',
      'tamale',
      'tamales',
      'fajita',
      'fajitas',
      'nachos',
      'chilaquiles',
      'chile relleno',
      'carne asada',
    ],
    categoryMayQualify: true,
  );

  static const LocalExpertType seafood = LocalExpertType(
    id: 'seafood',
    displayName: 'Seafood',
    iconName: 'set_meal',
    mappedCategoryIds: ['seafood'],
    mappedCategoryNames: ['Seafood'],
    mappedSubcategories: [
      'Clam chowder',
      'Crab',
      'Fish',
      'Grouper',
      'Lobster',
      'Oysters',
      'Salmon',
      'Scallops',
      'Seafood platter',
      'Shrimp',
    ],
    aliases: [
      'seafood',
      'lobster',
      'lobster roll',
      'shrimp',
      'crab',
      'oysters',
      'oyster',
      'scallops',
      'scallop',
      'clams',
      'clam',
      'mussels',
      'mussel',
      'fish',
      'grouper',
      'salmon',
    ],
    categoryMayQualify: true,
    excludedCategoryIds: ['japanese_sushi'],
    excludedCategoryNames: ['Japanese / Sushi'],
    excludedSubcategories: ['Sushi', 'Sushi roll', 'Sashimi', 'Nigiri'],
    excludedAliases: ['sushi', 'sushi roll', 'sashimi', 'nigiri'],
  );

  static const LocalExpertType italian = LocalExpertType(
    id: 'italian',
    displayName: 'Italian',
    iconName: 'IT',
    mappedCategoryIds: ['italian'],
    mappedCategoryNames: ['Italian'],
    mappedSubcategories: [
      'Breadsticks',
      'Bruschetta',
      'Calzone',
      'Chicken parmesan',
      'Eggplant parmesan',
      'Garlic knots',
      'Gnocchi',
      'Italian sub',
      'Meatballs',
      'Pasta',
      'Risotto',
      'Stromboli',
    ],
    aliases: [
      'italian',
      'spaghetti',
      'lasagna',
      'ravioli',
      'pasta',
      'fettuccine',
      'linguine',
      'rigatoni',
      'gnocchi',
      'chicken parmesan',
      'chicken parm',
      'chicken parmigiana',
      'eggplant parmesan',
      'meatballs',
    ],
    categoryMayQualify: true,
    excludedSubcategories: ['Pizza', 'Vegan pizza'],
    excludedAliases: ['pizza', 'pepperoni pizza', 'cheese pizza'],
  );

  static const LocalExpertType bbq = LocalExpertType(
    id: 'bbq',
    displayName: 'BBQ',
    iconName: 'outdoor_grill',
    mappedCategoryIds: ['bbq'],
    mappedCategoryNames: ['BBQ'],
    mappedSubcategories: [
      'BBQ chicken',
      'BBQ sandwich',
      'Brisket',
      'Burnt ends',
      'Pulled pork',
      'Ribs',
    ],
    aliases: [
      'bbq',
      'barbecue',
      'barbeque',
      'bar-b-q',
      'bar-b-que',
      'bbq sandwich',
      'ribs',
      'bbq ribs',
      'pulled pork',
      'brisket',
      'bbq brisket',
      'bbq chicken',
      'burnt ends',
    ],
    categoryMayQualify: true,
  );

  static const LocalExpertType hotDogsCornDogs = LocalExpertType(
    id: 'hot_dogs_corn_dogs',
    displayName: 'Hot Dogs / Corn Dogs',
    iconName: 'HD',
    mappedSubcategories: ['Hot dogs'],
    aliases: [
      'hot dog',
      'hot dogs',
      'hotdog',
      'hotdogs',
      'corn dog',
      'corn dogs',
      'corndog',
      'corndogs',
      'coney',
      'coney dog',
      'chili dog',
      'chili dogs',
    ],
  );

  static const LocalExpertType chili = LocalExpertType(
    id: 'chili',
    displayName: 'Chili',
    iconName: 'CI',
    mappedCategoryIds: ['american', 'soup'],
    mappedCategoryNames: ['American', 'Soup'],
    mappedSubcategories: ['Chili'],
    exactAliases: ['chili', 'chilli'],
    aliases: [
      'chili con carne',
      'chilli con carne',
      'texas chili',
      'beef chili',
      'bowl of chili',
      'chili bowl',
      'white chicken chili',
      'vegetarian chili',
      'chili dog',
      'chili dogs',
      'chili cheese dog',
      'chili cheese dogs',
    ],
    excludedAliases: [
      'chili sauce',
      'sweet chili sauce',
      'chili oil',
      'chili pepper',
      'chili peppers',
      'green chili',
      'green chili pepper',
    ],
  );

  static const LocalExpertType macAndCheese = LocalExpertType(
    id: 'mac_and_cheese',
    displayName: 'Mac and Cheese',
    iconName: 'M&C',
    mappedSubcategories: ['Mac and cheese'],
    aliases: [
      'mac and cheese',
      'mac & cheese',
      'macaroni and cheese',
      'macaroni & cheese',
      'mac n cheese',
      "mac 'n' cheese",
    ],
  );

  static const LocalExpertType meatloaf = LocalExpertType(
    id: 'meatloaf',
    displayName: 'Meatloaf',
    iconName: 'ML',
    mappedSubcategories: ['Meatloaf'],
    aliases: ['meatloaf', 'meat loaf', 'meatloaves'],
  );

  static const LocalExpertType chickenPie = LocalExpertType(
    id: 'chicken_pie',
    displayName: 'Chicken Pie / Chicken Pot Pie',
    iconName: 'CP',
    mappedSubcategories: ['Chicken Pie / Chicken Pot Pie'],
    aliases: [
      BitescoreCategories.chickenPieCanonicalId,
      'chicken pie',
      'chicken pies',
      'chicken pot pie',
      'chicken pot pies',
    ],
  );

  static const LocalExpertType chickenSandwich = LocalExpertType(
    id: 'chicken_sandwich',
    displayName: 'Chicken Sandwich',
    iconName: 'CS',
    mappedSubcategories: ['Chicken sandwich'],
    aliases: [
      'chicken sandwich',
      'fried chicken sandwich',
      'grilled chicken sandwich',
      'spicy chicken sandwich',
    ],
    excludedSubcategories: ['Cuban sandwich'],
    excludedAliases: [
      BitescoreCategories.cubanSandwichCanonicalId,
      'cuban sandwich',
      'cubano',
    ],
  );

  static const LocalExpertType friedChicken = LocalExpertType(
    id: 'fried_chicken',
    displayName: 'Fried Chicken',
    iconName: 'FC',
    mappedSubcategories: ['Chicken tenders', 'Fried chicken'],
    aliases: [
      'fried chicken',
      'fried chicken pieces',
      'fried chicken dinner',
      'chicken tenders',
      'chicken tender',
      'chicken fingers',
      'chicken finger',
      'chicken strips',
      'chicken strip',
      'fried chicken sandwich',
    ],
    excludedSubcategories: ['Boneless wings', 'Wings'],
    excludedAliases: ['wings', 'wing', 'chicken wings', 'boneless wings'],
  );

  static const LocalExpertType cuban = LocalExpertType(
    id: 'cuban',
    displayName: 'Cuban',
    iconName: 'CU',
    mappedCategoryIds: ['cuban'],
    mappedCategoryNames: ['Cuban'],
    mappedSubcategories: [
      'Arroz con pollo',
      'Bistec empanizado',
      'Black beans and rice',
      'Croquetas',
      'Cuban coffee',
      'Cuban sandwich',
      'Cuban-style chicken',
      'Cuban tamal',
      'Empanadas',
      'Flan',
      'Lechón / roast pork',
      'Maduros / sweet plantains',
      'Masitas de puerco',
      'Medianoche',
      'Moros y cristianos',
      'Palomilla steak',
      'Picadillo',
      'Potato balls / papas rellenas',
      'Ropa vieja',
      'Tostones',
      'Vaca frita',
      'Yuca with mojo',
    ],
    aliases: [
      BitescoreCategories.cubanSandwichCanonicalId,
      'cuban',
      'cubano',
      'cuban sandwich',
      'medianoche',
      'ropa vieja',
      'ropa viejo',
      'picadillo',
      'lechon',
      'lechón',
      'roast pork',
      'masitas de puerco',
      'vaca frita',
      'arroz con pollo',
      'palomilla steak',
      'bistec empanizado',
      'croquetas',
      'papas rellenas',
      'papa rellena',
      'potato ball',
      'potato balls',
      'black beans and rice',
      'moros y cristianos',
      'yuca with mojo',
      'tostones',
      'maduros',
      'sweet plantains',
      'cuban tamal',
      'cuban tamale',
      'cuban-style chicken',
      'cuban coffee',
    ],
    categoryMayQualify: true,
  );

  static const LocalExpertType subsSandwiches = LocalExpertType(
    id: 'subs_sandwiches',
    displayName: 'Subs / Sandwiches',
    iconName: 'SUB',
    mappedCategoryIds: ['subs', 'deli_sandwiches'],
    mappedCategoryNames: ['Subs', 'Deli / Sandwiches'],
    mappedSubcategories: [
      'Sandwiches',
      'Subs',
      'BLT',
      'Chicken salad sandwich',
      'Club sandwich',
      'Cuban sandwich',
      'Ham sandwich',
      'Italian sub',
      'Pastrami sandwich',
      'Philly cheesesteak',
      'Reuben',
      'Roast beef sandwich',
      'Tuna sandwich',
      'Turkey sandwich',
      'Wrap',
    ],
    aliases: [
      BitescoreCategories.cubanSandwichCanonicalId,
      'sub',
      'subs',
      'sub sandwich',
      'sub sandwiches',
      'submarine',
      'submarine sandwich',
      'submarine sandwiches',
      'hoagie',
      'hoagies',
      'grinder',
      'grinders',
      'hero',
      'heroes',
      'hero sandwich',
      'hero sandwiches',
      'deli sandwich',
      'deli sandwiches',
      'torpedo',
      'torpedo sandwich',
      'torpedo sandwiches',
      'cuban sandwich',
      'cubano',
    ],
    excludedCategoryIds: [
      'bbq',
      'burgers',
      'chicken_wings',
      'mexican',
      'tacos',
      'breakfast_brunch',
    ],
    excludedCategoryNames: [
      'BBQ',
      'Burgers',
      'Chicken',
      'Mexican',
      'Tacos',
      'Breakfast / Brunch',
    ],
    excludedSubcategories: [
      'BBQ sandwich',
      'Burgers',
      'Chicken sandwich',
      'Fried chicken',
      'Grilled chicken',
      'Hot dogs',
      'Breakfast sandwich',
      'Breakfast burrito',
      'Breakfast tacos',
      'Burrito',
      'Tacos',
    ],
    excludedAliases: [
      'bbq sandwich',
      'barbecue sandwich',
      'barbeque sandwich',
      'pulled pork sandwich',
      'brisket sandwich',
      'chicken sandwich',
      'fried chicken sandwich',
      'grilled chicken sandwich',
      'spicy chicken sandwich',
      'breakfast sandwich',
      'burger',
      'burgers',
      'hamburger',
      'hamburgers',
      'cheeseburger',
      'cheeseburgers',
      'hot dog',
      'hot dogs',
      'hotdog',
      'hotdogs',
      'corn dog',
      'corn dogs',
      'corndog',
      'corndogs',
      'taco',
      'tacos',
      'burrito',
      'burritos',
    ],
    categoryMayQualify: true,
  );

  static const List<LocalExpertType> all = [
    burger,
    pizza,
    wings,
    ramen,
    donuts,
    steak,
    chinese,
    japaneseSushi,
    mexican,
    seafood,
    italian,
    bbq,
    hotDogsCornDogs,
    chili,
    macAndCheese,
    meatloaf,
    chickenPie,
    chickenSandwich,
    friedChicken,
    cuban,
    subsSandwiches,
  ];

  static LocalExpertType? byId(String? id) {
    final normalizedId = _normalizeId(id);
    if (normalizedId == null) {
      return null;
    }

    for (final type in all) {
      if (_normalizeId(type.id) == normalizedId) {
        return type;
      }
    }

    return null;
  }

  static LocalExpertType? matchDish({
    String? dishName,
    String? categoryId,
    String? categoryName,
    String? subcategory,
    Iterable<String> categoryTags = const [],
  }) {
    final matches = matchDishes(
      dishName: dishName,
      categoryId: categoryId,
      categoryName: categoryName,
      subcategory: subcategory,
      categoryTags: categoryTags,
    );
    return matches.isEmpty ? null : matches.first;
  }

  static List<LocalExpertType> matchDishes({
    String? dishName,
    String? categoryId,
    String? categoryName,
    String? subcategory,
    Iterable<String> categoryTags = const [],
  }) {
    final category =
        BitescoreCategories.byId(categoryId) ??
        BitescoreCategories.byName(categoryName);
    final normalizedCategoryId = _normalizeId(category?.id ?? categoryId);
    final normalizedCategoryName = _normalizeTerm(
      category?.displayName ?? categoryName,
    );
    final normalizedSubcategory = _normalizeTerm(subcategory);
    final searchSources = <String>[
      if (dishName?.trim().isNotEmpty ?? false) dishName!.trim(),
      if (subcategory?.trim().isNotEmpty ?? false) subcategory!.trim(),
    ];
    for (final tag in categoryTags) {
      if (tag.trim().isNotEmpty) {
        searchSources.add(tag.trim());
      }
    }

    return all
        .where(
          (type) => _matchesType(
            type,
            normalizedCategoryId: normalizedCategoryId,
            normalizedCategoryName: normalizedCategoryName,
            normalizedSubcategory: normalizedSubcategory,
            searchSources: searchSources,
          ),
        )
        .toList(growable: false);
  }

  static bool hasMinimumWrittenReview({String? headline, String? body}) {
    return writtenReviewWordCount(headline: headline, body: body) >=
        minimumWrittenReviewWords;
  }

  static int writtenReviewWordCount({String? headline, String? body}) {
    final combined = [headline, body]
        .whereType<String>()
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty)
        .join(' ');
    if (combined.isEmpty) {
      return 0;
    }

    return RegExp(
      r"[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?",
    ).allMatches(combined.replaceAll('’', "'")).length;
  }

  static bool hasValidRestaurant(String? restaurantId) {
    return restaurantId?.trim().isNotEmpty == true;
  }

  static String deduplicationKey({
    required String userId,
    required String restaurantId,
    required String expertTypeId,
  }) {
    return [
      _keyPart(userId),
      _keyPart(restaurantId),
      _keyPart(expertTypeId),
    ].join('|');
  }

  static String? _normalizeId(String? value) {
    final normalized = value?.trim().toLowerCase();
    return normalized == null || normalized.isEmpty ? null : normalized;
  }

  static String? _normalizeTerm(String? value) {
    final normalized = value
        ?.trim()
        .toLowerCase()
        .replaceAll('’', "'")
        .replaceAll(RegExp(r'\s+'), ' ');
    return normalized == null || normalized.isEmpty ? null : normalized;
  }

  static String _keyPart(String value) {
    return value.trim().toLowerCase();
  }

  static bool _normalizedMatches(Iterable<String> values, String normalized) {
    return values.any((value) {
      final candidate = _normalizeTerm(value) ?? _normalizeId(value);
      return candidate == normalized;
    });
  }

  static bool _matchesType(
    LocalExpertType type, {
    required String? normalizedCategoryId,
    required String? normalizedCategoryName,
    required String? normalizedSubcategory,
    required List<String> searchSources,
  }) {
    if (_isExcludedFromType(
      type,
      normalizedCategoryId: normalizedCategoryId,
      normalizedCategoryName: normalizedCategoryName,
      normalizedSubcategory: normalizedSubcategory,
      searchSources: searchSources,
    )) {
      return false;
    }

    if (normalizedSubcategory != null &&
        _normalizedMatches(type.mappedSubcategories, normalizedSubcategory)) {
      return true;
    }

    if (_matchesExactAliases(type.exactAliases, searchSources)) {
      return true;
    }

    if (_matchesAliases(type.aliases, searchSources)) {
      return true;
    }

    if (!type.categoryMayQualify) {
      return false;
    }
    if (normalizedCategoryId != null &&
        _normalizedMatches(type.mappedCategoryIds, normalizedCategoryId)) {
      return true;
    }
    if (normalizedCategoryName != null &&
        _normalizedMatches(type.mappedCategoryNames, normalizedCategoryName)) {
      return true;
    }
    return false;
  }

  static bool _isExcludedFromType(
    LocalExpertType type, {
    required String? normalizedCategoryId,
    required String? normalizedCategoryName,
    required String? normalizedSubcategory,
    required List<String> searchSources,
  }) {
    if (normalizedCategoryId != null &&
        _normalizedMatches(type.excludedCategoryIds, normalizedCategoryId)) {
      return true;
    }
    if (normalizedCategoryName != null &&
        _normalizedMatches(
          type.excludedCategoryNames,
          normalizedCategoryName,
        )) {
      return true;
    }
    if (normalizedSubcategory != null &&
        _normalizedMatches(type.excludedSubcategories, normalizedSubcategory)) {
      return true;
    }
    return _matchesAliases(type.excludedAliases, searchSources);
  }

  static bool _matchesAliases(
    Iterable<String> aliases,
    Iterable<String> searchSources,
  ) {
    return aliases.any(
      (alias) => BiteScoreFoodSearch.matchesAnyFoodText(searchSources, alias),
    );
  }

  static bool _matchesExactAliases(
    Iterable<String> aliases,
    Iterable<String> searchSources,
  ) {
    final normalizedSources = searchSources
        .map(BiteScoreFoodSearch.normalize)
        .where((source) => source.isNotEmpty)
        .toSet();
    return aliases.any(
      (alias) =>
          normalizedSources.contains(BiteScoreFoodSearch.normalize(alias)),
    );
  }
}
