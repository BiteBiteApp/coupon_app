import 'package:flutter/material.dart';

import '../models/bitescore_dish.dart';
import '../models/bitescore_restaurant.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_sign_in_gate.dart';
import '../services/bitescore_service.dart';
import '../widgets/app_mode_switcher_bar.dart';
import '../widgets/biterater_theme.dart';
import 'bitescore_restaurant_dishes_screen.dart';

enum _RestaurantEntryStage {
  chooseRestaurant,
  confirmCloseMatch,
  createNewRestaurant,
}

enum _DuplicateDishSaveAction { useExistingDish, createNewDishAnyway }

class _DuplicateDishSaveChoice {
  final _DuplicateDishSaveAction action;
  final BitescoreDish? dish;

  const _DuplicateDishSaveChoice._(this.action, this.dish);

  const _DuplicateDishSaveChoice.useExistingDish(BitescoreDish dish)
    : this._(_DuplicateDishSaveAction.useExistingDish, dish);

  const _DuplicateDishSaveChoice.createNewDishAnyway()
    : this._(_DuplicateDishSaveAction.createNewDishAnyway, null);
}

class BiteScoreCreateRateScreen extends StatefulWidget {
  final BiteScoreHomeEntry? existingEntry;
  final BitescoreRestaurant? existingRestaurant;

  const BiteScoreCreateRateScreen({
    super.key,
    this.existingEntry,
    this.existingRestaurant,
  });

  @override
  State<BiteScoreCreateRateScreen> createState() =>
      _BiteScoreCreateRateScreenState();
}

class _BiteScoreCreateRateScreenState extends State<BiteScoreCreateRateScreen> {
  static const String _manualCategoryOption = 'Enter manually';
  static const List<String> _dishCategoryOptions = <String>[
    'Pizza',
    'Sandwich',
    'Burger',
    'Chicken Dish',
    'Barbecue',
    'Tacos',
    'Pasta',
    'Wings',
    'Breakfast',
    'Seafood',
    'Steak',
    'Salad',
    'Dessert',
    'Appetizer',
  ];
  static const List<String> _manualStateOptions = <String>[
    'AL',
    'AK',
    'AZ',
    'AR',
    'CA',
    'CO',
    'CT',
    'DE',
    'FL',
    'GA',
    'HI',
    'ID',
    'IL',
    'IN',
    'IA',
    'KS',
    'KY',
    'LA',
    'ME',
    'MD',
    'MA',
    'MI',
    'MN',
    'MS',
    'MO',
    'MT',
    'NE',
    'NV',
    'NH',
    'NJ',
    'NM',
    'NY',
    'NC',
    'ND',
    'OH',
    'OK',
    'OR',
    'PA',
    'RI',
    'SC',
    'SD',
    'TN',
    'TX',
    'UT',
    'VT',
    'VA',
    'WA',
    'WV',
    'WI',
    'WY',
    'DC',
  ];
  static const List<String> _floridaCities = <String>[
    'Alachua',
    'Alford',
    'Altamonte Springs',
    'Altha',
    'Anna Maria',
    'Apalachicola',
    'Apopka',
    'Arcadia',
    'Archer',
    'Astatula',
    'Atlantic Beach',
    'Atlantis',
    'Auburndale',
    'Aventura',
    'Avon Park',
    'Bal Harbour',
    'Baldwin',
    'Bartow',
    'Bascom',
    'Bay Harbor Islands',
    'Bay Lake',
    'Bell',
    'Belle Glade',
    'Belle Isle',
    'Belleair',
    'Belleair Beach',
    'Belleair Bluffs',
    'Belleair Shore',
    'Belleview',
    'Beverly Beach',
    'Biscayne Park',
    'Blountstown',
    'Boca Raton',
    'Bonifay',
    'Bonita Springs',
    'Bowling Green',
    'Boynton Beach',
    'Bradenton',
    'Bradenton Beach',
    'Brandon',
    'Branford',
    'Briny Breezes',
    'Bristol',
    'Bronson',
    'Brooker',
    'Brooksville',
    'Bunnell',
    'Bushnell',
    'Callahan',
    'Callaway',
    'Campbellton',
    'Cape Canaveral',
    'Cape Coral',
    'Carrabelle',
    'Caryville',
    'Casselberry',
    'Cedar Key',
    'Center Hill',
    'Century',
    'Chattahoochee',
    'Chiefland',
    'Chipley',
    'Cinco Bayou',
    'Clearwater',
    'Clermont',
    'Clewiston',
    'Cloud Lake',
    'Cocoa',
    'Cocoa Beach',
    'Coconut Creek',
    'Coleman',
    'Cooper City',
    'Coral Gables',
    'Coral Springs',
    'Cottondale',
    'Crescent City',
    'Crestview',
    'Cross City',
    'Crystal River',
    'Cutler Bay',
    'Dade City',
    'Dania Beach',
    'Davenport',
    'Davie',
    'Daytona Beach',
    'Daytona Beach Shores',
    'DeBary',
    'Deerfield Beach',
    'DeFuniak Springs',
    'DeLand',
    'Delray Beach',
    'Deltona',
    'Destin',
    'Doral',
    'Dundee',
    'Dunedin',
    'Dunnellon',
    'Eagle Lake',
    'Eatonville',
    'Ebro',
    'Edgewater',
    'Edgewood',
    'El Portal',
    'Estero',
    'Esto',
    'Eustis',
    'Everglades City',
    'Fanning Springs',
    'Fellsmere',
    'Fernandina Beach',
    'Flagler Beach',
    'Florida City',
    'Fort Lauderdale',
    'Fort Meade',
    'Fort Myers',
    'Fort Myers Beach',
    'Fort Pierce',
    'Fort Walton Beach',
    'Fort White',
    'Freeport',
    'Frostproof',
    'Fruitland Park',
    'Gainesville',
    'Glen Ridge',
    'Glen St. Mary',
    'Golden Beach',
    'Golf',
    'Graceville',
    'Grand Ridge',
    'Grant-Valkaria',
    'Green Cove Springs',
    'Greenacres',
    'Greensboro',
    'Greenville',
    'Greenwood',
    'Gretna',
    'Groveland',
    'Gulf Breeze',
    'Gulf Stream',
    'Gulfport',
    'Haines City',
    'Hallandale Beach',
    'Hampton',
    'Havana',
    'Haverhill',
    'Hawthorne',
    'Hialeah',
    'Hialeah Gardens',
    'High Springs',
    'Highland Beach',
    'Highland Park',
    'Hillcrest Heights',
    'Hilliard',
    'Hillsboro Beach',
    'Holly Hill',
    'Hollywood',
    'Holmes Beach',
    'Homestead',
    'Homosassa',
    'Horseshoe Beach',
    'Howey-in-the-Hills',
    'Hudson',
    'Hypoluxo',
    'Indialantic',
    'Indian Creek',
    'Indian Harbour Beach',
    'Indian River Shores',
    'Indian Rocks Beach',
    'Indian Shores',
    'Indiantown',
    'Inglis',
    'Interlachen',
    'Inverness',
    'Islamorada',
    'Jacksonville',
    'Jacksonville Beach',
    'Jacob City',
    'Jasper',
    'Jay',
    'Jennings',
    'Juno Beach',
    'Jupiter',
    'Jupiter Inlet Colony',
    'Jupiter Island',
    'Kenneth City',
    'Key Biscayne',
    'Key Colony Beach',
    'Key West',
    'Keystone Heights',
    'Kissimmee',
    'LaBelle',
    'LaCrosse',
    'Lady Lake',
    'Lake Alfred',
    'Lake Buena Vista',
    'Lake Butler',
    'Lake City',
    'Lake Clarke Shores',
    'Lake Hamilton',
    'Lake Helen',
    'Lake Mary',
    'Lake Park',
    'Lake Placid',
    'Lake Wales',
    'Lake Worth Beach',
    'Lakeland',
    'Lantana',
    'Largo',
    'Lecanto',
    'Lauderdale Lakes',
    'Lauderdale-by-the-Sea',
    'Lauderhill',
    'Laurel Hill',
    'Lawtey',
    'Layton',
    'Lazy Lake',
    'Lee',
    'Leesburg',
    'Lighthouse Point',
    'Live Oak',
    'Longboat Key',
    'Longwood',
    'Loxahatchee Groves',
    'Lynn Haven',
    'Macclenny',
    'Madeira Beach',
    'Madison',
    'Maitland',
    'Malabar',
    'Malone',
    'Manalapan',
    'Mangonia Park',
    'Marathon',
    'Marco Island',
    'Margate',
    'Marianna',
    'Marineland',
    'Mary Esther',
    'Mascotte',
    'Mayo',
    'McIntosh',
    'Medley',
    'Melbourne',
    'Melbourne Beach',
    'Melbourne Village',
    'Mexico Beach',
    'Miami',
    'Miami Beach',
    'Miami Gardens',
    'Miami Lakes',
    'Miami Shores',
    'Miami Springs',
    'Micanopy',
    'Midway',
    'Milton',
    'Minneola',
    'Miramar',
    'Monticello',
    'Montverde',
    'Moore Haven',
    'Mount Dora',
    'Mulberry',
    'Naples',
    'Neptune Beach',
    'New Port Richey',
    'New Smyrna Beach',
    'Newberry',
    'Niceville',
    'Noma',
    'North Bay Village',
    'North Lauderdale',
    'North Miami',
    'North Miami Beach',
    'North Palm Beach',
    'North Port',
    'North Redington Beach',
    'Oak Hill',
    'Oakland',
    'Oakland Park',
    'Ocala',
    'Ocean Breeze',
    'Ocean Ridge',
    'Ocoee',
    'Okeechobee',
    'Oldsmar',
    'Opa-locka',
    'Orange City',
    'Orange Park',
    'Orchid',
    'Orlando',
    'Ormond Beach',
    'Otter Creek',
    'Oviedo',
    'Pahokee',
    'Palatka',
    'Palm Bay',
    'Palm Beach',
    'Palm Beach Gardens',
    'Palm Beach Shores',
    'Palm Coast',
    'Palm Harbor',
    'Palm Shores',
    'Palm Springs',
    'Palmetto',
    'Palmetto Bay',
    'Panama City',
    'Panama City Beach',
    'Parker',
    'Parkland',
    'Paxton',
    'Pembroke Park',
    'Pembroke Pines',
    'Penney Farms',
    'Pensacola',
    'Perry',
    'Pierson',
    'Pinecrest',
    'Pinellas Park',
    'Plant City',
    'Plantation',
    'Polk City',
    'Pomona Park',
    'Pompano Beach',
    'Ponce de Leon',
    'Ponce Inlet',
    'Port Orange',
    'Port Charlotte',
    'Port Richey',
    'Port St. Joe',
    'Port St. Lucie',
    'Punta Gorda',
    'Quincy',
    'Raiford',
    'Reddick',
    'Redington Beach',
    'Redington Shores',
    'Riverview',
    'Riviera Beach',
    'Rockledge',
    'Royal Palm Beach',
    'Safety Harbor',
    'San Antonio',
    'Sanford',
    'Sanibel',
    'Sarasota',
    'Satellite Beach',
    'Sea Ranch Lakes',
    'Sebastian',
    'Sebring',
    'Seminole',
    'Sewall\'s Point',
    'Shalimar',
    'Sneads',
    'Sopchoppy',
    'South Bay',
    'South Daytona',
    'South Miami',
    'South Palm Beach',
    'South Pasadena',
    'Southwest Ranches',
    'Spring Hill',
    'Springfield',
    'St. Augustine',
    'St. Augustine Beach',
    'St. Cloud',
    'St. Leo',
    'St. Lucie Village',
    'St. Marks',
    'St. Pete Beach',
    'St. Petersburg',
    'Starke',
    'Stuart',
    'Sunny Isles Beach',
    'Sunrise',
    'Surfside',
    'Sweetwater',
    'Tallahassee',
    'Tamarac',
    'Tampa',
    'Tarpon Springs',
    'Tavares',
    'Temple Terrace',
    'Tequesta',
    'The Villages',
    'Titusville',
    'Treasure Island',
    'Trenton',
    'Umatilla',
    'Valparaiso',
    'Venice',
    'Vernon',
    'Vero Beach',
    'Virginia Gardens',
    'Waldo',
    'Wauchula',
    'Wausau',
    'Webster',
    'Welaka',
    'Wellington',
    'West Melbourne',
    'West Miami',
    'West Palm Beach',
    'West Park',
    'Westlake',
    'Weston',
    'Westville',
    'Wewahitchka',
    'White Springs',
    'Wildwood',
    'Williston',
    'Wilton Manors',
    'Windermere',
    'Winter Garden',
    'Winter Haven',
    'Winter Park',
    'Winter Springs',
    'Worthington Springs',
    'Yankeetown',
    'Zephyrhills',
    'Zolfo Springs',
  ];
  final TextEditingController restaurantNameController =
      TextEditingController();
  final TextEditingController cityController = TextEditingController();
  final TextEditingController stateController = TextEditingController();
  final TextEditingController zipCodeController = TextEditingController();
  final TextEditingController streetAddressController = TextEditingController();
  final TextEditingController dishNameController = TextEditingController();
  final TextEditingController categoryController = TextEditingController();
  final MenuController _categoryMenuController = MenuController();
  final FocusNode _categoryFocusNode = FocusNode();
  final TextEditingController priceLabelController = TextEditingController();
  final TextEditingController headlineController = TextEditingController();
  final TextEditingController notesController = TextEditingController();

  double? overallImpression;
  double? tastinessScore;
  double? qualityScore;
  double? valueScore;
  bool isSaving = false;
  bool _isContinuingRestaurant = false;
  Future<List<BitescoreRestaurant>>? _restaurantsFuture;
  List<DishCatalogSuggestion> _dishSuggestions =
      const <DishCatalogSuggestion>[];
  bool _isLoadingDishSuggestions = false;
  int _dishSuggestionRequestId = 0;
  List<String> _manualCitySuggestions = const <String>[];
  List<BitescoreRestaurant> _manualRestaurantSuggestions =
      const <BitescoreRestaurant>[];
  String? _selectedManualRestaurantId;
  String? selectedFinderState;
  String? selectedFinderCity;
  String? selectedFinderRestaurantId;
  _RestaurantEntryStage _restaurantEntryStage =
      _RestaurantEntryStage.chooseRestaurant;
  BitescoreRestaurant? _closeMatchRestaurant;

  bool get isExistingDishMode => widget.existingEntry != null;
  bool get isExistingRestaurantMode =>
      widget.existingRestaurant != null && !isExistingDishMode;
  bool get isRestaurantSelectionMode =>
      !isExistingDishMode && !isExistingRestaurantMode;
  bool get showDishCreationForManualRestaurant =>
      _restaurantEntryStage == _RestaurantEntryStage.createNewRestaurant;

  bool get _hasRequiredScores =>
      overallImpression != null &&
      tastinessScore != null &&
      qualityScore != null &&
      valueScore != null;

  String get _categoryDisplayText {
    final category = categoryController.text.trim();
    return category.isEmpty ? 'Choose a category' : category;
  }

  double get overallBiteScore {
    if (!_hasRequiredScores) {
      return 0;
    }

    return BiteScoreService.computeOverallBiteScore(
      overallImpression: overallImpression!,
      tastinessScore: tastinessScore!,
      qualityScore: qualityScore!,
      valueScore: valueScore!,
    );
  }

  @override
  void initState() {
    super.initState();
    _categoryFocusNode.addListener(_handleCategoryFocusChanged);
    _seedExistingDishValues();
    _seedExistingRestaurantValues();
    if (isRestaurantSelectionMode) {
      _restaurantsFuture = BiteScoreService.loadRestaurantsForFinder();
    }
  }

  void _seedExistingDishValues() {
    final entry = widget.existingEntry;
    if (entry == null) {
      return;
    }

    restaurantNameController.text = entry.restaurant.name;
    cityController.text = entry.restaurant.city;
    stateController.text = entry.restaurant.state;
    zipCodeController.text = entry.restaurant.zipCode;
    streetAddressController.text = entry.restaurant.address;
    dishNameController.text = entry.dish.name;
    categoryController.text = entry.dish.category ?? '';
    priceLabelController.text = entry.dish.priceLabel ?? '';
  }

  void _seedExistingRestaurantValues() {
    final restaurant = widget.existingRestaurant;
    if (restaurant == null || isExistingDishMode) {
      return;
    }

    restaurantNameController.text = restaurant.name;
    cityController.text = restaurant.city;
    stateController.text = restaurant.state;
    zipCodeController.text = restaurant.zipCode;
    streetAddressController.text = restaurant.address;
  }

  void _handleCategoryFocusChanged() {
    if (!_categoryFocusNode.hasFocus) {
      _categoryMenuController.close();
    }
  }

  void _finishManualCategoryEntry() {
    _categoryFocusNode.unfocus();
    _categoryMenuController.close();
  }

  @override
  void dispose() {
    restaurantNameController.dispose();
    cityController.dispose();
    stateController.dispose();
    zipCodeController.dispose();
    streetAddressController.dispose();
    dishNameController.dispose();
    _categoryFocusNode.removeListener(_handleCategoryFocusChanged);
    _categoryFocusNode.dispose();
    categoryController.dispose();
    priceLabelController.dispose();
    headlineController.dispose();
    notesController.dispose();
    super.dispose();
  }

  Future<List<BitescoreRestaurant>> _loadFinderRestaurants() async {
    if (_restaurantsFuture == null) {
      _restaurantsFuture = BiteScoreService.loadRestaurantsForFinder();
    }

    return _restaurantsFuture!;
  }

  Future<void> _handleDishNameChanged(String value) async {
    final query = value.trim();
    final requestId = ++_dishSuggestionRequestId;

    if (query.isEmpty) {
      if (!mounted) {
        return;
      }
      setState(() {
        _dishSuggestions = const <DishCatalogSuggestion>[];
        _isLoadingDishSuggestions = false;
      });
      return;
    }

    setState(() {
      _isLoadingDishSuggestions = true;
    });

    try {
      final suggestions = await BiteScoreService.loadDishCatalogSuggestions(
        query,
      );
      if (!mounted || requestId != _dishSuggestionRequestId) {
        return;
      }

      setState(() {
        _dishSuggestions = suggestions;
      });
    } catch (_) {
      if (!mounted || requestId != _dishSuggestionRequestId) {
        return;
      }

      setState(() {
        _dishSuggestions = const <DishCatalogSuggestion>[];
      });
    } finally {
      if (mounted && requestId == _dishSuggestionRequestId) {
        setState(() {
          _isLoadingDishSuggestions = false;
        });
      }
    }
  }

  void _applyDishSuggestion(DishCatalogSuggestion suggestion) {
    dishNameController.text = suggestion.canonicalName;
    dishNameController.selection = TextSelection.fromPosition(
      TextPosition(offset: suggestion.canonicalName.length),
    );

    setState(() {
      _dishSuggestions = const <DishCatalogSuggestion>[];
      _isLoadingDishSuggestions = false;
    });
  }

  Future<void> _openSelectedRestaurant(BitescoreRestaurant restaurant) async {
    final restaurantEntries = await BiteScoreService.loadEntriesForRestaurant(
      restaurant,
    );
    if (!mounted) {
      return;
    }

    final refreshed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => BiteScoreRestaurantDishesScreen(
          restaurant: restaurant,
          entries: restaurantEntries,
        ),
      ),
    );

    if (refreshed == true && mounted) {
      setState(() {
        _restaurantsFuture = BiteScoreService.loadRestaurantsForFinder();
      });
    }
  }

  Future<void> _continueWithManualRestaurant() async {
    final manualName = restaurantNameController.text.trim();
    final manualCity = cityController.text.trim();
    final manualState = _normalizedState(stateController.text);

    if (manualName.isEmpty) {
      _showSnackBar('Restaurant name is required.');
      return;
    }
    if (manualCity.isEmpty) {
      _showSnackBar('City is required.');
      return;
    }
    if (manualState.isEmpty) {
      _showSnackBar('State is required.');
      return;
    }

    setState(() {
      _isContinuingRestaurant = true;
      stateController.text = manualState;
      _manualRestaurantSuggestions = const <BitescoreRestaurant>[];
    });

    try {
      final restaurants = await _loadFinderRestaurants();
      final locationRestaurants = _restaurantsForManualLocation(
        restaurants,
        city: manualCity,
        state: manualState,
      );
      BitescoreRestaurant? exactMatch;
      if (_selectedManualRestaurantId == null) {
        exactMatch = _findExactRestaurantMatch(
          locationRestaurants,
          name: manualName,
          city: manualCity,
          state: manualState,
        );
      } else {
        for (final restaurant in locationRestaurants) {
          if (restaurant.id == _selectedManualRestaurantId &&
              _normalizeText(restaurant.name) == _normalizeText(manualName)) {
            exactMatch = restaurant;
            break;
          }
        }
      }

      if (exactMatch != null) {
        if (!mounted) {
          return;
        }
        await _openSelectedRestaurant(exactMatch);
        return;
      }

      final closeMatches = _findCloseRestaurantMatches(
        locationRestaurants,
        name: manualName,
        city: manualCity,
        state: manualState,
      );

      if (!mounted) {
        return;
      }

      if (closeMatches.isEmpty) {
        setState(() {
          _restaurantEntryStage = _RestaurantEntryStage.createNewRestaurant;
        });
        return;
      }

      final didYouMeanSelection = await Navigator.of(context).push<Object?>(
        MaterialPageRoute(
          builder: (_) => _DidYouMeanRestaurantScreen(
            restaurants: closeMatches,
            enteredRestaurantName: manualName,
            enteredCity: manualCity,
            enteredState: manualState,
          ),
        ),
      );

      if (!mounted) {
        return;
      }

      if (didYouMeanSelection is BitescoreRestaurant) {
        await _openSelectedRestaurant(didYouMeanSelection);
        return;
      }

      if (didYouMeanSelection == true) {
        _useManualRestaurantInstead();
      }
    } finally {
      if (mounted) {
        setState(() {
          _isContinuingRestaurant = false;
        });
      }
    }
  }

  BitescoreRestaurant? _findExactRestaurantMatch(
    List<BitescoreRestaurant> restaurants, {
    required String name,
    required String city,
    required String state,
  }) {
    final normalizedName = _normalizeText(name);
    final normalizedCity = _normalizeText(city);
    final normalizedState = _normalizedState(state);

    for (final restaurant in restaurants) {
      if (_normalizeText(restaurant.name) == normalizedName &&
          _normalizeText(restaurant.city) == normalizedCity &&
          _normalizedState(restaurant.state) == normalizedState) {
        return restaurant;
      }
    }

    return null;
  }

  List<BitescoreRestaurant> _restaurantsForManualLocation(
    List<BitescoreRestaurant> restaurants, {
    required String city,
    required String state,
  }) {
    final normalizedCity = _normalizeText(city);
    final normalizedState = _normalizedState(state);

    return restaurants.where((restaurant) {
      return _normalizeText(restaurant.city) == normalizedCity &&
          _normalizedState(restaurant.state) == normalizedState;
    }).toList();
  }

  List<BitescoreRestaurant> _findCloseRestaurantMatches(
    List<BitescoreRestaurant> restaurants, {
    required String name,
    required String city,
    required String state,
  }) {
    final queryName = _normalizeText(name);
    final queryTokens = _tokenize(name);
    final scoredMatches = <({BitescoreRestaurant restaurant, double score})>[];

    for (final restaurant in _restaurantsForManualLocation(
      restaurants,
      city: city,
      state: state,
    )) {
      if (_normalizeText(restaurant.name) == queryName) {
        continue;
      }

      final candidateName = _normalizeText(restaurant.name);
      final candidateTokens = _tokenize(restaurant.name);
      final sharedTokens = queryTokens.intersection(candidateTokens).length;
      final totalTokens = queryTokens.union(candidateTokens).length;
      final tokenScore = totalTokens == 0 ? 0.0 : sharedTokens / totalTokens;
      final containsScore =
          candidateName.contains(queryName) ||
          queryName.contains(candidateName);
      final startsWithScore =
          candidateName.startsWith(queryName) ||
          queryName.startsWith(candidateName);
      final maxLength = queryName.length > candidateName.length
          ? queryName.length
          : candidateName.length;
      final levenshteinScore = maxLength == 0
          ? 0.0
          : 1 - (_levenshteinDistance(queryName, candidateName) / maxLength);

      final score = containsScore
          ? 1.0
          : startsWithScore
          ? 0.92
          : tokenScore > levenshteinScore
          ? tokenScore
          : levenshteinScore;

      if (score >= 0.55) {
        scoredMatches.add((restaurant: restaurant, score: score));
      }
    }

    scoredMatches.sort((a, b) {
      final byScore = b.score.compareTo(a.score);
      if (byScore != 0) {
        return byScore;
      }

      return a.restaurant.name.toLowerCase().compareTo(
        b.restaurant.name.toLowerCase(),
      );
    });

    return scoredMatches
        .map((match) => match.restaurant)
        .take(8)
        .toList(growable: false);
  }

  Set<String> _tokenize(String value) {
    return value
        .toLowerCase()
        .split(RegExp(r'[^a-z0-9]+'))
        .map((token) => token.trim())
        .where((token) => token.isNotEmpty)
        .toSet();
  }

  String _normalizeText(String value) {
    return value
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), ' ')
        .trim()
        .replaceAll(RegExp(r'\s+'), ' ');
  }

  String _normalizedState(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return '';
    }

    if (trimmed.length == 2) {
      return trimmed.toUpperCase();
    }

    return trimmed.toUpperCase();
  }

  String? get _selectedManualState {
    final normalized = _normalizedState(stateController.text);
    return normalized.isEmpty ? null : normalized;
  }

  bool get _isManualCityEnabled => _selectedManualState != null;
  bool get _canSuggestManualRestaurant =>
      _isManualCityEnabled && cityController.text.trim().isNotEmpty;

  void _handleManualStateChanged(String? value) {
    setState(() {
      stateController.text = value ?? '';
      cityController.clear();
      _manualCitySuggestions = const <String>[];
      _manualRestaurantSuggestions = const <BitescoreRestaurant>[];
      _selectedManualRestaurantId = null;
    });
  }

  void _handleManualCityChanged(String value) {
    _selectedManualRestaurantId = null;
    final selectedState = _selectedManualState;
    if (selectedState == null) {
      if (_manualCitySuggestions.isEmpty) {
        return;
      }

      setState(() {
        _manualCitySuggestions = const <String>[];
        _manualRestaurantSuggestions = const <BitescoreRestaurant>[];
      });
      return;
    }

    final query = value.trim().toLowerCase();
    final suggestions = selectedState == 'FL'
        ? _floridaCities
              .where((city) => city.toLowerCase().contains(query))
              .take(8)
              .toList()
        : const <String>[];

    setState(() {
      _manualCitySuggestions = query.isEmpty ? const <String>[] : suggestions;
      _manualRestaurantSuggestions = const <BitescoreRestaurant>[];
    });
  }

  void _applyManualCitySuggestion(String city) {
    cityController.text = city;
    cityController.selection = TextSelection.fromPosition(
      TextPosition(offset: city.length),
    );

    setState(() {
      _manualCitySuggestions = const <String>[];
      _manualRestaurantSuggestions = const <BitescoreRestaurant>[];
      _selectedManualRestaurantId = null;
    });
  }

  Future<void> _handleManualRestaurantNameChanged(String value) async {
    _selectedManualRestaurantId = null;

    if (!_canSuggestManualRestaurant) {
      if (_manualRestaurantSuggestions.isEmpty) {
        return;
      }

      setState(() {
        _manualRestaurantSuggestions = const <BitescoreRestaurant>[];
      });
      return;
    }

    final query = value.trim();
    if (query.isEmpty) {
      setState(() {
        _manualRestaurantSuggestions = const <BitescoreRestaurant>[];
      });
      return;
    }

    final restaurants = await _loadFinderRestaurants();
    if (!mounted) {
      return;
    }

    final suggestions =
        _restaurantsForManualLocation(
              restaurants,
              city: cityController.text,
              state: stateController.text,
            )
            .where((restaurant) {
              return _normalizeText(
                restaurant.name,
              ).contains(_normalizeText(query));
            })
            .take(8)
            .toList(growable: false);

    setState(() {
      _manualRestaurantSuggestions = suggestions;
    });
  }

  void _applyManualRestaurantSuggestion(BitescoreRestaurant restaurant) {
    restaurantNameController.text = restaurant.name;
    restaurantNameController.selection = TextSelection.fromPosition(
      TextPosition(offset: restaurant.name.length),
    );

    setState(() {
      _selectedManualRestaurantId = restaurant.id;
      _manualRestaurantSuggestions = const <BitescoreRestaurant>[];
    });
  }

  void _useManualRestaurantInstead() {
    setState(() {
      _restaurantEntryStage = _RestaurantEntryStage.createNewRestaurant;
      _closeMatchRestaurant = null;
    });
  }

  void _backToRestaurantSelection() {
    setState(() {
      _restaurantEntryStage = _RestaurantEntryStage.chooseRestaurant;
      _closeMatchRestaurant = null;
      _dishSuggestions = const <DishCatalogSuggestion>[];
      _isLoadingDishSuggestions = false;
    });
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Widget _buildField({
    required TextEditingController controller,
    required String label,
    required String hint,
    ValueChanged<String>? onChanged,
    int minLines = 1,
    int maxLines = 1,
    TextInputType? keyboardType,
  }) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      minLines: minLines,
      maxLines: maxLines,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        filled: true,
        fillColor: Colors.white,
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: BiteRaterTheme.lineBlue),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: BiteRaterTheme.grape, width: 1.4),
        ),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
      ),
    );
  }

  Widget _buildCategoryInput() {
    return LayoutBuilder(
      builder: (context, constraints) {
        return MenuAnchor(
          controller: _categoryMenuController,
          menuChildren: [
            SizedBox(
              width: constraints.maxWidth,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _manualCategoryOption,
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: BiteRaterTheme.ink,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: categoryController,
                      focusNode: _categoryFocusNode,
                      onChanged: (_) {
                        setState(() {});
                      },
                      onSubmitted: (_) => _finishManualCategoryEntry(),
                      decoration: InputDecoration(
                        isDense: true,
                        filled: true,
                        fillColor: Colors.white,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 12,
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(
                            color: BiteRaterTheme.lineBlue,
                          ),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(
                            color: BiteRaterTheme.grape,
                            width: 1.4,
                          ),
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            ..._dishCategoryOptions.map(
              (category) => MenuItemButton(
                onPressed: () {
                  setState(() {
                    categoryController.text = category;
                  });
                  _categoryMenuController.close();
                },
                child: SizedBox(
                  width: constraints.maxWidth,
                  child: Text(category),
                ),
              ),
            ),
          ],
          builder: (context, controller, child) {
            return InkWell(
              borderRadius: BorderRadius.circular(14),
              onTap: () {
                if (controller.isOpen) {
                  controller.close();
                } else {
                  controller.open();
                }
              },
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: 'Category (optional)',
                  filled: true,
                  fillColor: Colors.white,
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(
                      color: BiteRaterTheme.lineBlue,
                    ),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(
                      color: BiteRaterTheme.grape,
                      width: 1.4,
                    ),
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        _categoryDisplayText,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: categoryController.text.trim().isEmpty
                              ? Theme.of(context).hintColor
                              : BiteRaterTheme.ink,
                        ),
                      ),
                    ),
                    const Icon(Icons.arrow_drop_down),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildManualCityField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: cityController,
          enabled: _isManualCityEnabled,
          onChanged: _handleManualCityChanged,
          decoration: InputDecoration(
            labelText: 'City',
            hintText: _isManualCityEnabled
                ? 'Example: Lecanto'
                : 'Select a state first',
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
        if (_manualCitySuggestions.isNotEmpty) ...[
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: BiteRaterTheme.ocean.withOpacity(0.16)),
              boxShadow: [
                BoxShadow(
                  color: BiteRaterTheme.ocean.withOpacity(0.08),
                  blurRadius: 14,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: Column(
              children: _manualCitySuggestions.asMap().entries.map((entry) {
                final index = entry.key;
                final city = entry.value;

                return Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: () => _applyManualCitySuggestion(city),
                    borderRadius: BorderRadius.vertical(
                      top: index == 0 ? const Radius.circular(12) : Radius.zero,
                      bottom: index == _manualCitySuggestions.length - 1
                          ? const Radius.circular(12)
                          : Radius.zero,
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(city),
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildManualRestaurantSuggestionList() {
    if (_manualRestaurantSuggestions.isEmpty) {
      return const SizedBox.shrink();
    }

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: BiteRaterTheme.grape.withOpacity(0.16)),
        boxShadow: [
          BoxShadow(
            color: BiteRaterTheme.grape.withOpacity(0.08),
            blurRadius: 14,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        children: _manualRestaurantSuggestions.asMap().entries.map((entry) {
          final index = entry.key;
          final restaurant = entry.value;

          return Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: () => _applyManualRestaurantSuggestion(restaurant),
              borderRadius: BorderRadius.vertical(
                top: index == 0 ? const Radius.circular(12) : Radius.zero,
                bottom: index == _manualRestaurantSuggestions.length - 1
                    ? const Radius.circular(12)
                    : Radius.zero,
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      restaurant.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${restaurant.city}, ${restaurant.state}',
                      style: const TextStyle(
                        fontSize: 12,
                        color: Colors.black54,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildDishSuggestionList() {
    if (_isLoadingDishSuggestions && _dishSuggestions.isEmpty) {
      return Container(
        width: double.infinity,
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: Theme.of(context).colorScheme.outlineVariant,
          ),
        ),
        child: const Text(
          'Looking for matching dishes...',
          style: TextStyle(fontSize: 12, color: Colors.black54),
        ),
      );
    }

    if (_dishSuggestions.isEmpty) {
      return const SizedBox.shrink();
    }

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: BiteRaterTheme.coral.withOpacity(0.16)),
        boxShadow: [
          BoxShadow(
            color: BiteRaterTheme.coral.withOpacity(0.08),
            blurRadius: 14,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        children: _dishSuggestions.asMap().entries.map((entry) {
          final index = entry.key;
          final suggestion = entry.value;
          final subtitle = suggestion.aliases.take(2).join(' • ');

          return Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: () => _applyDishSuggestion(suggestion),
              borderRadius: BorderRadius.vertical(
                top: index == 0 ? const Radius.circular(12) : Radius.zero,
                bottom: index == _dishSuggestions.length - 1
                    ? const Radius.circular(12)
                    : Radius.zero,
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            suggestion.canonicalName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          if (subtitle.isNotEmpty) ...[
                            const SizedBox(height: 2),
                            Text(
                              subtitle,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 12,
                                color: Colors.black54,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(width: 10),
                    const Icon(Icons.north_west, size: 16),
                  ],
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Future<_DuplicateDishSaveChoice?> _showDidYouMeanDishDialog(
    List<BitescoreDish> dishes,
  ) {
    return showModalBottomSheet<_DuplicateDishSaveChoice>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Did you mean one of these?',
                  style: TextStyle(
                    color: BiteRaterTheme.ink,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 12),
                Flexible(
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: dishes.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, index) {
                      final dish = dishes[index];
                      return BiteRaterTheme.liftedCard(
                        margin: EdgeInsets.zero,
                        radius: 18,
                        borderColor: BiteRaterTheme.ocean.withOpacity(0.16),
                        child: ListTile(
                          title: Text(
                            dish.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: BiteRaterTheme.ink,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          subtitle: Text(
                            [
                              if ((dish.category ?? '').trim().isNotEmpty)
                                dish.category!.trim(),
                              dish.restaurantName,
                            ].join(' | '),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => Navigator.of(
                            sheetContext,
                          ).pop(_DuplicateDishSaveChoice.useExistingDish(dish)),
                        ),
                      );
                    },
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(
                      sheetContext,
                    ).pop(const _DuplicateDishSaveChoice.createNewDishAnyway()),
                    style: BiteRaterTheme.outlinedButtonStyle(
                      accentColor: BiteRaterTheme.grape,
                    ),
                    child: const Text('No, create new dish anyway'),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildSectionTitle(String title, String subtitle) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: BiteRaterTheme.sectionTitleStyle()),
        const SizedBox(height: 4),
        Text(
          subtitle,
          style: const TextStyle(
            color: BiteRaterTheme.mutedInk,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }

  Widget _buildDropdownText(String text) {
    return Text(text, maxLines: 1, overflow: TextOverflow.ellipsis);
  }

  Widget _buildScoreSlider({
    required String label,
    required String helperText,
    required double? value,
    required ValueChanged<double> onChanged,
  }) {
    final sliderValue = value ?? 5.5;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  color: BiteRaterTheme.ink,
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BiteRaterTheme.chipDecoration(BiteRaterTheme.coral),
              child: Text(
                value?.toStringAsFixed(1) ?? 'Not rated',
                style: const TextStyle(
                  color: BiteRaterTheme.coral,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          helperText,
          style: const TextStyle(
            fontSize: 12,
            color: BiteRaterTheme.mutedInk,
            fontWeight: FontWeight.w600,
          ),
        ),
        Slider(
          value: sliderValue,
          min: 1,
          max: 10,
          divisions: 18,
          label: value?.toStringAsFixed(1) ?? 'Choose',
          onChanged: onChanged,
        ),
      ],
    );
  }

  Widget _buildRequiredScoreSection({
    required String title,
    required String helperText,
    required double? value,
    required ValueChanged<double> onChanged,
  }) {
    return _buildScoreSlider(
      label: '$title (Required)',
      helperText: helperText,
      value: value,
      onChanged: onChanged,
    );
  }

  List<String> _availableStates(List<BitescoreRestaurant> restaurants) {
    final states =
        restaurants
            .map((restaurant) => restaurant.state.trim())
            .where((state) => state.isNotEmpty)
            .toSet()
            .toList()
          ..sort();
    return states;
  }

  List<String> _availableCities(List<BitescoreRestaurant> restaurants) {
    if (selectedFinderState == null || selectedFinderState!.isEmpty) {
      return const <String>[];
    }

    final cities =
        restaurants
            .where((restaurant) => restaurant.state == selectedFinderState)
            .map((restaurant) => restaurant.city.trim())
            .where((city) => city.isNotEmpty)
            .toSet()
            .toList()
          ..sort();
    return cities;
  }

  List<BitescoreRestaurant> _availableRestaurants(
    List<BitescoreRestaurant> restaurants,
  ) {
    if (selectedFinderState == null ||
        selectedFinderState!.isEmpty ||
        selectedFinderCity == null ||
        selectedFinderCity!.isEmpty) {
      return const <BitescoreRestaurant>[];
    }

    final filtered =
        restaurants
            .where(
              (restaurant) =>
                  restaurant.state == selectedFinderState &&
                  restaurant.city == selectedFinderCity,
            )
            .toList()
          ..sort(
            (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
          );
    return filtered;
  }

  Widget _buildExistingRestaurantFinder() {
    return FutureBuilder<List<BitescoreRestaurant>>(
      future: _restaurantsFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return BiteRaterTheme.liftedCard(
            radius: 22,
            borderColor: BiteRaterTheme.ocean.withOpacity(0.16),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: const [
                  SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  SizedBox(width: 12),
                  Text('Loading existing restaurants...'),
                ],
              ),
            ),
          );
        }

        if (snapshot.hasError) {
          return BiteRaterTheme.liftedCard(
            radius: 22,
            borderColor: BiteRaterTheme.coral.withOpacity(0.16),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Could not load existing restaurants.',
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: () {
                      setState(() {
                        _restaurantsFuture =
                            BiteScoreService.loadRestaurantsForFinder();
                      });
                    },
                    style: BiteRaterTheme.outlinedButtonStyle(
                      accentColor: BiteRaterTheme.coral,
                    ),
                    child: const Text('Try Again'),
                  ),
                ],
              ),
            ),
          );
        }

        final restaurants = snapshot.data ?? const <BitescoreRestaurant>[];
        final states = _availableStates(restaurants);
        final cities = _availableCities(restaurants);
        final availableRestaurants = _availableRestaurants(restaurants);

        return BiteRaterTheme.liftedCard(
          radius: 24,
          borderColor: BiteRaterTheme.grape.withOpacity(0.16),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildSectionTitle(
                  'Find existing restaurant',
                  'Choose an existing BiteScore restaurant to open its page and use the restaurant page\'s Add Dish button.',
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: states.contains(selectedFinderState)
                            ? selectedFinderState
                            : null,
                        decoration: InputDecoration(
                          labelText: 'State',
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        items: states
                            .map(
                              (state) => DropdownMenuItem(
                                value: state,
                                child: Text(state),
                              ),
                            )
                            .toList(),
                        onChanged: (value) {
                          setState(() {
                            selectedFinderState = value;
                            selectedFinderCity = null;
                            selectedFinderRestaurantId = null;
                          });
                        },
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: cities.contains(selectedFinderCity)
                            ? selectedFinderCity
                            : null,
                        decoration: InputDecoration(
                          labelText: 'City',
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        items: cities
                            .map(
                              (city) => DropdownMenuItem(
                                value: city,
                                child: Text(city),
                              ),
                            )
                            .toList(),
                        onChanged: selectedFinderState == null
                            ? null
                            : (value) {
                                setState(() {
                                  selectedFinderCity = value;
                                  selectedFinderRestaurantId = null;
                                });
                              },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  initialValue:
                      availableRestaurants.any(
                        (restaurant) =>
                            restaurant.id == selectedFinderRestaurantId,
                      )
                      ? selectedFinderRestaurantId
                      : null,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: 'Restaurant',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  items: availableRestaurants
                      .map(
                        (restaurant) => DropdownMenuItem(
                          value: restaurant.id,
                          child: _buildDropdownText(restaurant.name),
                        ),
                      )
                      .toList(),
                  selectedItemBuilder: (context) {
                    return availableRestaurants
                        .map(
                          (restaurant) => Align(
                            alignment: Alignment.centerLeft,
                            child: _buildDropdownText(restaurant.name),
                          ),
                        )
                        .toList();
                  },
                  onChanged: selectedFinderCity == null
                      ? null
                      : (value) {
                          if (value == null) {
                            return;
                          }

                          final restaurant = availableRestaurants.firstWhere(
                            (item) => item.id == value,
                          );

                          setState(() {
                            selectedFinderRestaurantId = value;
                          });

                          _openSelectedRestaurant(restaurant);
                        },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildManualRestaurantChooser() {
    return BiteRaterTheme.liftedCard(
      radius: 24,
      borderColor: BiteRaterTheme.coral.withOpacity(0.16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSectionTitle(
              'Enter a new restaurant',
              'Start with the restaurant name, city, and state. We\'ll check for a match before showing dish entry.',
            ),
            const SizedBox(height: 16),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue:
                        _manualStateOptions.contains(_selectedManualState)
                        ? _selectedManualState
                        : null,
                    decoration: InputDecoration(
                      labelText: 'State',
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    items: _manualStateOptions
                        .map(
                          (state) => DropdownMenuItem<String>(
                            value: state,
                            child: Text(state),
                          ),
                        )
                        .toList(),
                    onChanged: _handleManualStateChanged,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(flex: 2, child: _buildManualCityField()),
              ],
            ),
            const SizedBox(height: 16),
            _buildField(
              controller: restaurantNameController,
              label: 'Restaurant Name',
              hint: 'Example: Joe\'s Pizza',
              onChanged: _handleManualRestaurantNameChanged,
            ),
            _buildManualRestaurantSuggestionList(),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isContinuingRestaurant
                    ? null
                    : _continueWithManualRestaurant,
                style: ElevatedButton.styleFrom(
                  foregroundColor: Colors.white,
                  backgroundColor: BiteRaterTheme.grape,
                  minimumSize: const Size.fromHeight(48),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
                child: Text(
                  _isContinuingRestaurant ? 'Checking...' : 'Continue',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCloseMatchConfirmation() {
    final closeMatch = _closeMatchRestaurant;
    if (closeMatch == null) {
      return const SizedBox.shrink();
    }

    return BiteRaterTheme.liftedCard(
      radius: 24,
      borderColor: BiteRaterTheme.ocean.withOpacity(0.16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSectionTitle(
              'Possible match found',
              'This looks very close to what you entered. You can open the existing restaurant or keep your manual information.',
            ),
            const SizedBox(height: 16),
            _buildRestaurantSummaryCard(
              title: closeMatch.name,
              subtitle:
                  '${closeMatch.city}, ${closeMatch.state} ${closeMatch.zipCode}'
                      .trim(),
              caption: closeMatch.address,
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => _openSelectedRestaurant(closeMatch),
                style: ElevatedButton.styleFrom(
                  foregroundColor: Colors.white,
                  backgroundColor: BiteRaterTheme.grape,
                  minimumSize: const Size.fromHeight(48),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
                child: const Text('Use Existing Restaurant'),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: _useManualRestaurantInstead,
                style: BiteRaterTheme.outlinedButtonStyle(
                  accentColor: BiteRaterTheme.coral,
                ),
                child: const Text('No, use my manually entered information'),
              ),
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: _backToRestaurantSelection,
              child: const Text('Back'),
            ),
          ],
        ),
      ),
    );
  }

  int _levenshteinDistance(String source, String target) {
    if (source == target) {
      return 0;
    }
    if (source.isEmpty) {
      return target.length;
    }
    if (target.isEmpty) {
      return source.length;
    }

    final costs = List<int>.generate(target.length + 1, (index) => index);

    for (int i = 1; i <= source.length; i++) {
      int previousDiagonal = costs[0];
      costs[0] = i;

      for (int j = 1; j <= target.length; j++) {
        final previousAbove = costs[j];
        final substitutionCost = source[i - 1] == target[j - 1] ? 0 : 1;

        int candidate = costs[j] + 1;
        if (costs[j - 1] + 1 < candidate) {
          candidate = costs[j - 1] + 1;
        }
        if (previousDiagonal + substitutionCost < candidate) {
          candidate = previousDiagonal + substitutionCost;
        }

        costs[j] = candidate;
        previousDiagonal = previousAbove;
      }
    }

    return costs[target.length];
  }

  Widget _buildRestaurantSummaryCard({
    required String title,
    required String subtitle,
    String? caption,
  }) {
    return BiteRaterTheme.liftedCard(
      margin: EdgeInsets.zero,
      radius: 22,
      borderColor: BiteRaterTheme.peach.withOpacity(0.18),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(
                color: BiteRaterTheme.ink,
                fontSize: 20,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 6),
            if (subtitle.trim().isNotEmpty)
              Text(
                subtitle,
                style: const TextStyle(
                  color: BiteRaterTheme.mutedInk,
                  fontWeight: FontWeight.w600,
                ),
              ),
            if (caption != null && caption.trim().isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                caption.trim(),
                style: const TextStyle(
                  color: BiteRaterTheme.mutedInk,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildExistingDishHeader() {
    final entry = widget.existingEntry!;
    return _buildRestaurantSummaryCard(
      title: entry.dish.name,
      subtitle: entry.restaurant.name,
      caption:
          '${entry.restaurant.city}, ${entry.restaurant.state} ${entry.restaurant.zipCode}',
    );
  }

  Widget _buildExistingRestaurantHeader() {
    final restaurant = widget.existingRestaurant!;
    return _buildRestaurantSummaryCard(
      title: restaurant.name,
      subtitle:
          '${restaurant.address}, ${restaurant.city}, ${restaurant.state} ${restaurant.zipCode}',
      caption: restaurant.phone,
    );
  }

  Widget _buildManualRestaurantHeader() {
    return _buildRestaurantSummaryCard(
      title: restaurantNameController.text.trim(),
      subtitle:
          '${cityController.text.trim()}, ${_normalizedState(stateController.text)}',
      caption:
          'This restaurant was not found. Finish the required location details below, then add the dish and first rating.',
    );
  }

  Widget _buildDishCreationSection({
    required String title,
    required String subtitle,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionTitle(title, subtitle),
        const SizedBox(height: 16),
        _buildField(
          controller: dishNameController,
          label: 'Dish Name',
          hint: 'Example: Large Pepperoni Pizza',
          onChanged: _handleDishNameChanged,
        ),
        _buildDishSuggestionList(),
        const SizedBox(height: 16),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: _buildCategoryInput()),
            const SizedBox(width: 12),
            Expanded(
              child: _buildField(
                controller: priceLabelController,
                label: 'Price (Optional)',
                hint: 'Example: \$14.99',
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildRatingSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionTitle(
          'Your Rating',
          'Enjoyment, Tastiness, Quality, and Value are all required so BiteScore ratings stay consistent.',
        ),
        const SizedBox(height: 16),
        _buildField(
          controller: headlineController,
          label: 'Review Headline (Optional)',
          hint: 'Optional short headline',
        ),
        const SizedBox(height: 16),
        _buildField(
          controller: notesController,
          label: 'Review Notes (Optional)',
          hint: 'Optional notes about what stood out',
          minLines: 4,
          maxLines: 6,
        ),
        const SizedBox(height: 20),
        BiteRaterTheme.liftedCard(
          radius: 24,
          borderColor: BiteRaterTheme.grape.withOpacity(0.16),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Rate each category to submit your score.',
                  style: TextStyle(
                    color: BiteRaterTheme.mutedInk,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 12),
                _buildScoreSlider(
                  label: 'Enjoyment (Required)',
                  helperText:
                      'How much you enjoyed eating this dish from 1 to 10.',
                  value: overallImpression,
                  onChanged: (value) {
                    setState(() {
                      overallImpression = value;
                    });
                  },
                ),
                const SizedBox(height: 12),
                _buildRequiredScoreSection(
                  title: 'Tastiness',
                  helperText: 'Flavor, seasoning, and overall tastiness.',
                  value: tastinessScore,
                  onChanged: (value) {
                    setState(() {
                      tastinessScore = value;
                    });
                  },
                ),
                const SizedBox(height: 8),
                _buildRequiredScoreSection(
                  title: 'Quality',
                  helperText:
                      'How well-made and high-quality the dish felt overall.',
                  value: qualityScore,
                  onChanged: (value) {
                    setState(() {
                      qualityScore = value;
                    });
                  },
                ),
                const SizedBox(height: 8),
                _buildRequiredScoreSection(
                  title: 'Value',
                  helperText:
                      'How fair the price felt for the quality and portion.',
                  value: valueScore,
                  onChanged: (value) {
                    setState(() {
                      valueScore = value;
                    });
                  },
                ),
                const SizedBox(height: 20),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BiteRaterTheme.heroSurfaceDecoration(
                    accentColor: BiteRaterTheme.scoreFlame,
                    radius: 16,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Calculated BiteScore',
                        style: TextStyle(
                          color: BiteRaterTheme.ink,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _hasRequiredScores
                            ? overallBiteScore.toStringAsFixed(0)
                            : '--',
                        style: const TextStyle(
                          fontSize: 28,
                          fontWeight: FontWeight.w900,
                          color: BiteRaterTheme.scoreFlame,
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'This score uses only the inputs you provided and normalizes the weights automatically.',
                        style: TextStyle(
                          fontSize: 12,
                          color: BiteRaterTheme.mutedInk,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _save() async {
    if (!_hasRequiredScores) {
      _showSnackBar('Please rate each category before submitting.');
      return;
    }

    final selectedOverallImpression = overallImpression!;
    final selectedTastinessScore = tastinessScore!;
    final selectedQualityScore = qualityScore!;
    final selectedValueScore = valueScore!;

    final canWrite = await BiteScoreSignInGate.ensureSignedInForWrite(context);
    if (!canWrite || !mounted) {
      return;
    }

    var forceCreateNewDish = false;
    BitescoreDish? selectedExistingDish;

    if (isExistingRestaurantMode) {
      final restaurant = widget.existingRestaurant!;
      final dishName = dishNameController.text.trim();
      if (dishName.isEmpty) {
        _showSnackBar('Dish name is required.');
        return;
      }

      final matchingDishes =
          await BiteScoreService.findSimilarDishesForRestaurant(
            restaurantId: restaurant.id,
            dishName: dishName,
          );
      if (!mounted) {
        return;
      }

      if (matchingDishes.isNotEmpty) {
        final selection = await _showDidYouMeanDishDialog(matchingDishes);
        if (!mounted) {
          return;
        }

        if (selection == null) {
          return;
        }

        if (selection.action == _DuplicateDishSaveAction.useExistingDish) {
          selectedExistingDish = selection.dish;
          if (selectedExistingDish == null) {
            _showSnackBar('That dish is no longer available.');
            return;
          }
        } else {
          forceCreateNewDish = true;
        }
      }
    }

    setState(() {
      isSaving = true;
    });

    try {
      if (isExistingDishMode) {
        final entry = widget.existingEntry!;
        await BiteScoreService.addReviewForDish(
          dish: entry.dish,
          restaurant: entry.restaurant,
          overallImpression: selectedOverallImpression,
          headline: headlineController.text,
          notes: notesController.text,
          tastinessScore: selectedTastinessScore,
          qualityScore: selectedQualityScore,
          valueScore: selectedValueScore,
        );
      } else if (isExistingRestaurantMode) {
        final restaurant = widget.existingRestaurant!;

        if (selectedExistingDish != null) {
          await BiteScoreService.addReviewForDish(
            dish: selectedExistingDish,
            restaurant: restaurant,
            overallImpression: selectedOverallImpression,
            headline: headlineController.text,
            notes: notesController.text,
            tastinessScore: selectedTastinessScore,
            qualityScore: selectedQualityScore,
            valueScore: selectedValueScore,
          );
        } else {
          await BiteScoreService.createDishAndRateForRestaurant(
            restaurant: restaurant,
            dishName: dishNameController.text,
            category: categoryController.text,
            priceLabel: priceLabelController.text,
            headline: headlineController.text,
            notes: notesController.text,
            overallImpression: selectedOverallImpression,
            tastinessScore: selectedTastinessScore,
            qualityScore: selectedQualityScore,
            valueScore: selectedValueScore,
            forceCreateNewDish: forceCreateNewDish,
          );
        }
      } else {
        if (!showDishCreationForManualRestaurant) {
          _showSnackBar('Choose or confirm a restaurant first.');
          return;
        }

        final request = BiteScoreCreateRequest(
          restaurantName: restaurantNameController.text,
          streetAddress: streetAddressController.text,
          city: cityController.text,
          state: _normalizedState(stateController.text),
          zipCode: zipCodeController.text,
          dishName: dishNameController.text,
          category: categoryController.text,
          priceLabel: priceLabelController.text,
          headline: headlineController.text,
          notes: notesController.text,
          overallImpression: selectedOverallImpression,
          tastinessScore: selectedTastinessScore,
          qualityScore: selectedQualityScore,
          valueScore: selectedValueScore,
        );

        final validationError = request.validate();
        if (validationError != null) {
          _showSnackBar(validationError);
          return;
        }

        await BiteScoreService.createAndRate(request);
      }

      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            isExistingDishMode
                ? 'Review saved.'
                : isExistingRestaurantMode && selectedExistingDish == null
                ? 'Dish created and rated.'
                : 'Review saved.',
          ),
        ),
      );

      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) {
        return;
      }

      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not save your BiteScore changes right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          isSaving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = isExistingDishMode
        ? 'Rate & Review'
        : isExistingRestaurantMode
        ? 'Add Dish'
        : 'Create and Rate';

    return Scaffold(
      backgroundColor: BiteRaterTheme.pageBackground,
      appBar: AppBar(title: Text(title), centerTitle: true),
      body: Column(
        children: [
          buildPersistentAppModeSwitcher(context),
          Expanded(
            child: SafeArea(
              top: false,
              child: ScrollConfiguration(
                behavior: ScrollConfiguration.of(
                  context,
                ).copyWith(overscroll: false),
                child: SingleChildScrollView(
                  physics: const ClampingScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (isExistingDishMode) ...[
                        _buildSectionTitle(
                          'Dish',
                          'You are reviewing an existing BiteScore dish.',
                        ),
                        const SizedBox(height: 16),
                        _buildExistingDishHeader(),
                        const SizedBox(height: 28),
                        _buildRatingSection(),
                      ] else if (isExistingRestaurantMode) ...[
                        _buildSectionTitle(
                          'Restaurant',
                          'You are adding a dish for an existing BiteScore restaurant.',
                        ),
                        const SizedBox(height: 16),
                        _buildExistingRestaurantHeader(),
                        const SizedBox(height: 28),
                        _buildDishCreationSection(
                          title: 'Dish',
                          subtitle:
                              'Create a new dish for this restaurant and add the first rating.',
                        ),
                        const SizedBox(height: 28),
                        _buildRatingSection(),
                      ] else ...[
                        if (_restaurantEntryStage ==
                            _RestaurantEntryStage.chooseRestaurant) ...[
                          _buildExistingRestaurantFinder(),
                          const SizedBox(height: 20),
                          _buildManualRestaurantChooser(),
                        ],
                        if (_restaurantEntryStage ==
                            _RestaurantEntryStage.confirmCloseMatch)
                          _buildCloseMatchConfirmation(),
                        if (_restaurantEntryStage ==
                            _RestaurantEntryStage.createNewRestaurant) ...[
                          _buildSectionTitle(
                            'Restaurant confirmed',
                            'Finish the required location details for this new restaurant, then add the dish and first rating.',
                          ),
                          const SizedBox(height: 16),
                          _buildManualRestaurantHeader(),
                          const SizedBox(height: 20),
                          _buildField(
                            controller: streetAddressController,
                            label: 'Street Address',
                            hint: 'Required street address',
                          ),
                          const SizedBox(height: 16),
                          _buildField(
                            controller: zipCodeController,
                            label: 'ZIP Code',
                            hint: '34461',
                            keyboardType: TextInputType.number,
                          ),
                          const SizedBox(height: 28),
                          _buildDishCreationSection(
                            title: 'Add a Dish',
                            subtitle:
                                'Now that the restaurant is confirmed, add the dish and first rating.',
                          ),
                          const SizedBox(height: 28),
                          _buildRatingSection(),
                          const SizedBox(height: 16),
                          TextButton(
                            onPressed: _backToRestaurantSelection,
                            child: const Text('Back to restaurant selection'),
                          ),
                        ],
                      ],
                      const SizedBox(height: 24),
                      if (!isRestaurantSelectionMode ||
                          showDishCreationForManualRestaurant)
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton(
                            onPressed: isSaving
                                ? null
                                : _hasRequiredScores
                                ? _save
                                : () => _showSnackBar(
                                    'Please rate each category before submitting.',
                                  ),
                            style: ElevatedButton.styleFrom(
                              foregroundColor: Colors.white,
                              backgroundColor: _hasRequiredScores
                                  ? BiteRaterTheme.coral
                                  : BiteRaterTheme.mutedInk,
                              minimumSize: const Size.fromHeight(50),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16),
                              ),
                              textStyle: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            child: Text(
                              isSaving
                                  ? 'Saving...'
                                  : isExistingDishMode
                                  ? 'Save Review'
                                  : isExistingRestaurantMode ||
                                        showDishCreationForManualRestaurant
                                  ? 'Save Dish & Rating'
                                  : 'Save Rating',
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DidYouMeanRestaurantScreen extends StatelessWidget {
  final List<BitescoreRestaurant> restaurants;
  final String enteredRestaurantName;
  final String enteredCity;
  final String enteredState;

  const _DidYouMeanRestaurantScreen({
    required this.restaurants,
    required this.enteredRestaurantName,
    required this.enteredCity,
    required this.enteredState,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BiteRaterTheme.pageBackground,
      appBar: AppBar(title: const Text('Did you mean?')),
      body: Column(
        children: [
          buildPersistentAppModeSwitcher(context),
          Expanded(
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'We found some similar restaurants in that city.',
                      style: TextStyle(
                        color: BiteRaterTheme.mutedInk,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Expanded(
                      child: ListView.separated(
                        itemCount: restaurants.length + 1,
                        separatorBuilder: (_, __) => const SizedBox(height: 12),
                        itemBuilder: (context, index) {
                          if (index == restaurants.length) {
                            return BiteRaterTheme.liftedCard(
                              radius: 20,
                              borderColor: BiteRaterTheme.coral.withOpacity(
                                0.16,
                              ),
                              child: ListTile(
                                onTap: () {
                                  Navigator.of(context).pop(true);
                                },
                                title: const Text('Use my entered restaurant'),
                                subtitle: Text(
                                  '$enteredRestaurantName\n$enteredCity, $enteredState',
                                ),
                                isThreeLine: true,
                                trailing: const Icon(Icons.chevron_right),
                              ),
                            );
                          }

                          final restaurant = restaurants[index];

                          return BiteRaterTheme.liftedCard(
                            radius: 20,
                            borderColor: BiteRaterTheme.grape.withOpacity(0.16),
                            child: ListTile(
                              onTap: () {
                                Navigator.of(context).pop(restaurant);
                              },
                              title: Text(restaurant.name),
                              subtitle: Text(
                                '${restaurant.city}, ${restaurant.state}',
                              ),
                              trailing: const Icon(Icons.chevron_right),
                            ),
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
