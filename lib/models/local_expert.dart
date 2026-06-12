import 'bitescore_category.dart';

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
  final List<String> aliases;
  final bool categoryMayQualify;

  const LocalExpertType({
    required this.id,
    required this.displayName,
    required this.iconName,
    this.mappedCategoryIds = const [],
    this.mappedCategoryNames = const [],
    this.mappedSubcategories = const [],
    this.aliases = const [],
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
    aliases: ['pizza', 'pepperoni pizza', 'cheese pizza'],
    categoryMayQualify: true,
  );

  static const LocalExpertType burrito = LocalExpertType(
    id: 'burrito',
    displayName: 'Burrito',
    iconName: 'restaurant',
    mappedSubcategories: ['Burrito', 'Breakfast burrito'],
    aliases: ['burrito', 'burritos'],
  );

  static const LocalExpertType tacos = LocalExpertType(
    id: 'tacos',
    displayName: 'Tacos',
    iconName: 'restaurant',
    mappedCategoryIds: ['tacos'],
    mappedCategoryNames: ['Tacos'],
    mappedSubcategories: ['Tacos', 'Breakfast tacos', 'Vegan tacos'],
    aliases: ['taco', 'tacos'],
    categoryMayQualify: true,
  );

  static const LocalExpertType wings = LocalExpertType(
    id: 'wings',
    displayName: 'Wings',
    iconName: 'sports_bar',
    mappedSubcategories: ['Boneless wings', 'Wings'],
    aliases: ['wings', 'wing', 'chicken wings', 'boneless wings'],
  );

  static const LocalExpertType lobster = LocalExpertType(
    id: 'lobster',
    displayName: 'Lobster',
    iconName: 'set_meal',
    mappedSubcategories: ['Lobster'],
    aliases: ['lobster', 'lobster roll'],
  );

  static const LocalExpertType pasta = LocalExpertType(
    id: 'pasta',
    displayName: 'Pasta',
    iconName: 'ramen_dining',
    mappedSubcategories: ['Pasta', 'Gnocchi'],
    aliases: ['pasta', 'spaghetti', 'fettuccine', 'linguine', 'rigatoni'],
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
    iconName: 'bakery_dining',
    mappedCategoryIds: ['donuts'],
    mappedCategoryNames: ['Donuts'],
    aliases: ['donut', 'donuts', 'doughnut', 'doughnuts'],
    categoryMayQualify: true,
  );

  static const LocalExpertType chinese = LocalExpertType(
    id: 'chinese',
    displayName: 'Chinese',
    iconName: 'restaurant',
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
    iconName: 'restaurant_menu',
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

  static const List<LocalExpertType> all = [
    burger,
    pizza,
    burrito,
    tacos,
    wings,
    lobster,
    pasta,
    ramen,
    donuts,
    steak,
    chinese,
    japaneseSushi,
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
    final category =
        BitescoreCategories.byId(categoryId) ??
        BitescoreCategories.byName(categoryName);
    final normalizedCategoryId = _normalizeId(category?.id ?? categoryId);
    final normalizedCategoryName = _normalizeTerm(
      category?.displayName ?? categoryName,
    );
    final normalizedSubcategory = _normalizeTerm(subcategory);

    for (final type in all) {
      if (normalizedSubcategory != null &&
          _normalizedMatches(type.mappedSubcategories, normalizedSubcategory)) {
        return type;
      }
    }

    final searchTerms = <String>{};
    _addSearchTerms(searchTerms, dishName);
    _addSearchTerms(searchTerms, subcategory);
    for (final tag in categoryTags) {
      _addSearchTerms(searchTerms, tag);
    }

    for (final type in all) {
      if (_matchesAliases(type, searchTerms)) {
        return type;
      }
    }

    for (final type in all) {
      if (!type.categoryMayQualify) {
        continue;
      }
      if (normalizedCategoryId != null &&
          _normalizedMatches(type.mappedCategoryIds, normalizedCategoryId)) {
        return type;
      }
      if (normalizedCategoryName != null &&
          _normalizedMatches(
            type.mappedCategoryNames,
            normalizedCategoryName,
          )) {
        return type;
      }
    }

    return null;
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

  static bool _matchesAliases(LocalExpertType type, Set<String> searchTerms) {
    for (final alias in type.aliases) {
      final normalizedAlias = _normalizeTerm(alias);
      if (normalizedAlias == null) {
        continue;
      }
      if (searchTerms.contains(normalizedAlias)) {
        return true;
      }
      if (searchTerms.any((term) => term.contains(normalizedAlias))) {
        return true;
      }
    }
    return false;
  }

  static void _addSearchTerms(Set<String> terms, String? value) {
    final normalized = _normalizeTerm(value);
    if (normalized == null) {
      return;
    }

    terms.add(normalized);
    for (final part in normalized.split('/')) {
      final trimmedPart = part.trim();
      if (trimmedPart.isNotEmpty) {
        terms.add(trimmedPart);
      }
    }
  }
}
