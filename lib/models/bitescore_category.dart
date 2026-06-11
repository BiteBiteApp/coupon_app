class BitescoreCategory {
  final String id;
  final String displayName;
  final List<String> subcategories;
  final List<String> searchTags;

  const BitescoreCategory({
    required this.id,
    required this.displayName,
    this.subcategories = const [],
    this.searchTags = const [],
  });

  bool get hasSubcategories => subcategories.isNotEmpty;
}

class BitescoreCategories {
  static const String otherLabel = 'Other';
  static const String manualKeywordHelperText =
      'Optional: separate keywords with commas';
  static const String requiredManualKeywordHelperText =
      'Required: separate keywords with commas';
  static const String moreCuisinesStartId = 'thai';

  static const List<BitescoreCategory> all = [
    BitescoreCategory(id: 'other', displayName: 'Other'),
    BitescoreCategory(id: 'burgers', displayName: 'Burgers'),
    BitescoreCategory(id: 'tacos', displayName: 'Tacos'),
    BitescoreCategory(
      id: 'pizza',
      displayName: 'Pizza',
      subcategories: [otherLabel, 'Calzone', 'Pizza', 'Stromboli'],
    ),
    BitescoreCategory(id: 'donuts', displayName: 'Donuts'),
    BitescoreCategory(
      id: 'american',
      displayName: 'American',
      subcategories: [
        otherLabel,
        'Burgers',
        'Chicken tenders',
        'Chili',
        'Club sandwich',
        'Fried chicken',
        'Fries / loaded fries',
        'Grilled cheese',
        'Grilled chicken',
        'Hot dogs',
        'Mac and cheese',
        'Meatloaf',
        'Pot roast',
        'Wings',
      ],
      searchTags: ['usa', 'classic american'],
    ),
    BitescoreCategory(
      id: 'chicken_wings',
      displayName: 'Chicken / Wings',
      subcategories: [
        otherLabel,
        'Boneless wings',
        'Chicken and waffles',
        'Chicken nuggets',
        'Chicken sandwich',
        'Chicken tenders',
        'Chicken wrap',
        'Fried chicken',
        'Grilled chicken',
        'Rotisserie chicken',
        'Wings',
      ],
      searchTags: ['chicken', 'wings'],
    ),
    BitescoreCategory(
      id: 'bbq',
      displayName: 'BBQ',
      subcategories: [
        otherLabel,
        'Baked beans',
        'BBQ chicken',
        'BBQ sandwich',
        'Brisket',
        'Burnt ends',
        'Coleslaw',
        'Cornbread',
        'Loaded baked potato',
        'Mac and cheese',
        'Pulled pork',
        'Ribs',
        'Sausage',
      ],
      searchTags: ['barbecue', 'barbeque'],
    ),
    BitescoreCategory(
      id: 'steakhouse',
      displayName: 'Steakhouse',
      subcategories: [
        otherLabel,
        'Caesar salad',
        'Filet mignon',
        'French onion soup',
        'Loaded baked potato',
        'New York strip',
        'Pork chop',
        'Prime rib',
        'Ribeye',
        'Sirloin',
        'Steak',
        'Steak sandwich',
        'Steak tips',
        'T-bone steak',
      ],
      searchTags: ['steak'],
    ),
    BitescoreCategory(
      id: 'mexican',
      displayName: 'Mexican',
      subcategories: [
        otherLabel,
        'Burrito',
        'Carne asada',
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
      ],
    ),
    BitescoreCategory(
      id: 'chinese',
      displayName: 'Chinese',
      subcategories: [
        otherLabel,
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
    ),
    BitescoreCategory(
      id: 'italian',
      displayName: 'Italian',
      subcategories: [
        otherLabel,
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
        'Pizza',
        'Risotto',
        'Stromboli',
      ],
    ),
    BitescoreCategory(
      id: 'breakfast_brunch',
      displayName: 'Breakfast / Brunch',
      subcategories: [
        otherLabel,
        'Avocado toast',
        'Bagel',
        'Biscuits and gravy',
        'Breakfast burrito',
        'Breakfast sandwich',
        'Breakfast tacos',
        'Eggs Benedict',
        'French toast',
        'Grits',
        'Hash browns',
        'Omelet',
        'Pancakes',
        'Waffles',
      ],
      searchTags: ['breakfast', 'brunch'],
    ),
    BitescoreCategory(
      id: 'deli_sandwiches',
      displayName: 'Deli / Sandwiches',
      subcategories: [
        otherLabel,
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
      searchTags: ['deli', 'sandwich', 'sandwiches', 'subs', 'wraps'],
    ),
    BitescoreCategory(
      id: 'seafood',
      displayName: 'Seafood',
      subcategories: [
        otherLabel,
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
    ),
    BitescoreCategory(
      id: 'coffee_drinks',
      displayName: 'Coffee / Drinks',
      subcategories: [
        otherLabel,
        'Boba tea',
        'Cappuccino',
        'Coffee',
        'Cold brew',
        'Espresso',
        'Iced coffee',
        'Latte',
        'Lemonade',
        'Milkshake',
        'Smoothie',
        'Specialty drink',
        'Tea',
      ],
      searchTags: ['coffee', 'drinks', 'beverages'],
    ),
    BitescoreCategory(
      id: 'dessert_bakery',
      displayName: 'Dessert / Bakery',
      subcategories: [
        otherLabel,
        'Brownie',
        'Cake',
        'Cannoli',
        'Cheesecake',
        'Cinnamon roll',
        'Cookies',
        'Cupcake',
        'Ice cream',
        'Milkshake',
        'Pastry',
        'Pie',
        'Pudding',
      ],
      searchTags: ['dessert', 'bakery', 'sweets'],
    ),
    BitescoreCategory(
      id: 'soup',
      displayName: 'Soup',
      subcategories: [
        otherLabel,
        'Broccoli cheddar soup',
        'Chicken noodle soup',
        'Chili',
        'Clam chowder',
        'French onion soup',
        'Hot and sour soup',
        'Lentil soup',
        'Miso soup',
        'Pho',
        'Ramen',
        'Soup',
        'Tomato soup',
        'Wonton soup',
      ],
    ),
    BitescoreCategory(
      id: 'salads_healthy',
      displayName: 'Salads / Healthy',
      subcategories: [
        otherLabel,
        'Caesar salad',
        'Chef salad',
        'Chicken salad',
        'Cobb salad',
        'Garden salad',
        'Grain bowl',
        'Greek salad',
        'Protein bowl',
        'Salad',
        'Smoothie bowl',
        'Taco salad',
        'Veggie plate',
        'Wrap',
      ],
      searchTags: ['salad', 'salads', 'healthy'],
    ),
    BitescoreCategory(
      id: 'japanese_sushi',
      displayName: 'Japanese / Sushi',
      subcategories: [
        otherLabel,
        'Bento box',
        'Fried rice',
        'Gyoza',
        'Hibachi chicken',
        'Hibachi steak',
        'Nigiri',
        'Ramen',
        'Sashimi',
        'Sushi',
        'Sushi roll',
        'Tempura',
        'Teriyaki chicken',
        'Udon',
      ],
      searchTags: ['japanese', 'sushi'],
    ),
    BitescoreCategory(
      id: 'thai',
      displayName: 'Thai',
      subcategories: [
        otherLabel,
        'Basil chicken',
        'Drunken noodles',
        'Fried rice',
        'Green curry',
        'Massaman curry',
        'Pad see ew',
        'Pad Thai',
        'Red curry',
        'Spring rolls',
        'Thai curry',
        'Tom kha soup',
        'Tom yum soup',
      ],
    ),
    BitescoreCategory(
      id: 'korean',
      displayName: 'Korean',
      subcategories: [
        otherLabel,
        'Bibimbap',
        'Bulgogi',
        'Japchae',
        'Kimchi fried rice',
        'Korean BBQ',
        'Korean fried chicken',
        'Mandu',
        'Ramen',
        'Short ribs',
        'Tteokbokki',
      ],
    ),
    BitescoreCategory(
      id: 'indian',
      displayName: 'Indian',
      subcategories: [
        otherLabel,
        'Biryani',
        'Butter chicken',
        'Chana masala',
        'Chicken tikka masala',
        'Curry',
        'Dal',
        'Korma',
        'Lamb curry',
        'Naan',
        'Saag paneer',
        'Samosas',
        'Tandoori chicken',
        'Vindaloo',
      ],
    ),
    BitescoreCategory(
      id: 'vegetarian_vegan',
      displayName: 'Vegetarian / Vegan',
      subcategories: [
        otherLabel,
        'Black bean burger',
        'Falafel',
        'Hummus plate',
        'Plant-based chicken',
        'Salad',
        'Tofu dish',
        'Vegan pizza',
        'Vegan tacos',
        'Vegetable curry',
        'Veggie bowl',
        'Veggie burger',
        'Veggie wrap',
      ],
      searchTags: ['vegetarian', 'vegan', 'veggie', 'plant based'],
    ),
    BitescoreCategory(
      id: 'latin_caribbean',
      displayName: 'Latin / Caribbean',
      subcategories: [
        otherLabel,
        'Arepas',
        'Cuban sandwich',
        'Curry goat',
        'Empanadas',
        'Jerk chicken',
        'Mofongo',
        'Oxtail',
        'Pernil',
        'Plantains',
        'Rice and beans',
        'Ropa vieja',
        'Tostones',
      ],
      searchTags: ['latin', 'caribbean'],
    ),
    BitescoreCategory(
      id: 'vietnamese_pho',
      displayName: 'Vietnamese / Pho',
      subcategories: [
        otherLabel,
        'Banh mi',
        'Bun bo hue',
        'Egg rolls',
        'Grilled chicken',
        'Grilled pork',
        'Pho',
        'Rice plate',
        'Spring rolls',
        'Vermicelli bowl',
      ],
      searchTags: ['vietnamese', 'pho'],
    ),
    BitescoreCategory(
      id: 'french',
      displayName: 'French',
      subcategories: [
        otherLabel,
        'Crepes',
        'Croissant',
        'Croque monsieur',
        'Crème brûlée',
        'Duck confit',
        'Escargot',
        'French onion soup',
        'Macarons',
        'Quiche',
        'Ratatouille',
        'Steak frites',
      ],
    ),
    BitescoreCategory(
      id: 'mediterranean_greek',
      displayName: 'Mediterranean / Greek',
      subcategories: [
        otherLabel,
        'Chicken souvlaki',
        'Falafel',
        'Greek salad',
        'Gyro',
        'Hummus',
        'Kabobs',
        'Lamb platter',
        'Pita wrap',
        'Rice bowl',
        'Shawarma',
        'Spanakopita',
        'Tzatziki',
      ],
      searchTags: ['mediterranean', 'greek'],
    ),
    BitescoreCategory(
      id: 'middle_eastern',
      displayName: 'Middle Eastern',
      subcategories: [
        otherLabel,
        'Baba ganoush',
        'Baklava',
        'Chicken platter',
        'Falafel',
        'Gyro',
        'Hummus',
        'Kabobs',
        'Lamb platter',
        'Pita wrap',
        'Shawarma',
        'Tabouleh',
      ],
    ),
  ];

  static BitescoreCategory? byId(String? id) {
    final normalizedId = _normalizeLookup(id);
    if (normalizedId == null) {
      return null;
    }

    for (final category in all) {
      if (_normalizeLookup(category.id) == normalizedId) {
        return category;
      }
    }

    return null;
  }

  static BitescoreCategory? byName(String? name) {
    final normalizedName = _normalizeLookup(name);
    if (normalizedName == null) {
      return null;
    }

    for (final category in all) {
      if (_normalizeLookup(category.displayName) == normalizedName) {
        return category;
      }
    }

    return null;
  }

  static BitescoreCategory? byIdOrName(String? value) {
    return byId(value) ?? byName(value);
  }

  static List<BitescoreCategory> get commonCategories {
    final splitIndex = all.indexWhere(
      (category) => category.id == moreCuisinesStartId,
    );
    if (splitIndex <= 0) {
      return all;
    }
    return all.take(splitIndex).toList(growable: false);
  }

  static List<BitescoreCategory> get moreCuisineCategories {
    final splitIndex = all.indexWhere(
      (category) => category.id == moreCuisinesStartId,
    );
    if (splitIndex < 0) {
      return const [];
    }

    final categories = all.skip(splitIndex).toList();
    final otherCategory = byName(otherLabel);
    if (otherCategory != null &&
        !categories.any((category) => category.id == otherCategory.id)) {
      categories.add(otherCategory);
    }

    categories.sort((a, b) {
      if (a.displayName == otherLabel) {
        return 1;
      }
      if (b.displayName == otherLabel) {
        return -1;
      }
      return a.displayName.toLowerCase().compareTo(b.displayName.toLowerCase());
    });
    return categories.toList(growable: false);
  }

  static List<String> buildSearchableTags({
    String? categoryId,
    String? categoryName,
    String? subcategory,
    String? manualKeywords,
    String? dishName,
    String? restaurantName,
  }) {
    final tags = <String>{};
    final category = byId(categoryId) ?? byName(categoryName);

    if (category != null) {
      _addSearchTerms(tags, category.displayName);
      for (final tag in category.searchTags) {
        _addSearchTerms(tags, tag);
      }
    } else {
      _addSearchTerms(tags, categoryName);
    }

    _addSearchTerms(tags, subcategory);
    _addCommaSeparatedSearchTerms(tags, manualKeywords);
    _addSearchTerms(tags, dishName);
    _addSearchTerms(tags, restaurantName);

    return tags.toList(growable: false);
  }

  static String? _normalizeLookup(String? value) {
    final normalized = value?.trim().toLowerCase();
    return normalized == null || normalized.isEmpty ? null : normalized;
  }

  static void _addCommaSeparatedSearchTerms(Set<String> tags, String? value) {
    if (value == null) {
      return;
    }

    for (final keyword in value.split(',')) {
      _addSearchTerms(tags, keyword);
    }
  }

  static void _addSearchTerms(Set<String> tags, String? value) {
    final normalized = _normalizeTag(value);
    if (normalized == null) {
      return;
    }

    tags.add(normalized);

    for (final part in normalized.split('/')) {
      final trimmedPart = part.trim();
      if (trimmedPart.isNotEmpty) {
        tags.add(trimmedPart);
      }
    }

    for (final word in normalized.split(RegExp(r'[^a-z0-9]+'))) {
      if (word.length >= 3 && !_searchStopWords.contains(word)) {
        tags.add(word);
      }
    }
  }

  static String? _normalizeTag(String? value) {
    final normalized = value?.trim().toLowerCase().replaceAll('’', "'");
    return normalized == null || normalized.isEmpty ? null : normalized;
  }

  static const Set<String> _searchStopWords = {'and', 'the', 'with'};
}
