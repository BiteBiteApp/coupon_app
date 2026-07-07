import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/bitescore_category.dart';
import '../models/bitescore_food_search.dart';
import '../models/bitescore_restaurant.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_sign_in_gate.dart';
import '../services/bitescore_service.dart';
import '../services/shared_location_state_service.dart';
import '../widgets/biterater_theme.dart';
import 'bitescore_create_rate_screen.dart';
import 'bitescore_dish_detail_screen.dart';
import 'bitescore_restaurant_dishes_screen.dart';

class BiteScoreSearchCenter {
  final double latitude;
  final double longitude;
  final String label;

  const BiteScoreSearchCenter({
    required this.latitude,
    required this.longitude,
    required this.label,
  });
}

class _BiteScoreCategoryFilter {
  final String id;
  final String label;
  final String query;
  final String categoryId;
  final bool isSubcategory;

  const _BiteScoreCategoryFilter({
    required this.id,
    required this.label,
    required this.query,
    required this.categoryId,
    required this.isSubcategory,
  });

  factory _BiteScoreCategoryFilter.category(BitescoreCategory category) {
    return _BiteScoreCategoryFilter(
      id: 'category:${category.id}',
      label: category.displayName,
      query: category.displayName,
      categoryId: category.id,
      isSubcategory: false,
    );
  }

  factory _BiteScoreCategoryFilter.subcategory(
    BitescoreCategory category,
    String subcategory,
  ) {
    return _BiteScoreCategoryFilter(
      id: 'subcategory:${category.id}:$subcategory',
      label: subcategory,
      query: subcategory,
      categoryId: category.id,
      isSubcategory: true,
    );
  }

  @override
  bool operator ==(Object other) {
    return other is _BiteScoreCategoryFilter && other.id == id;
  }

  @override
  int get hashCode => id.hashCode;
}

class BiteScoreHomeScreen extends StatefulWidget {
  const BiteScoreHomeScreen({super.key});

  @override
  State<BiteScoreHomeScreen> createState() => _BiteScoreHomeScreenState();
}

class _BiteScoreHomeScreenState extends State<BiteScoreHomeScreen> {
  static const double _collapsedHeaderExtent = 86;
  static const double _expandedHeaderExtent = 190;
  static const double _homeControlPillWidth = 92;
  static const String _selectedRadiusPreferenceKey = 'selected_radius';
  static const String _defaultSort = 'Highest BiteScore';

  final TextEditingController dishSearchController = TextEditingController();
  final TextEditingController locationSearchController =
      TextEditingController();
  final FocusNode _locationSearchFocusNode = FocusNode();
  final ScrollController _listScrollController = ScrollController();

  String selectedRadius = '15 miles';
  String selectedSort = _defaultSort;
  bool isGettingLocation = false;
  bool isSearchingLocation = false;
  String? _launchLocationMessage;
  Position? currentPosition;
  BiteScoreSearchCenter? typedSearchCenter;
  List<BiteScoreHomeEntry> _entries = const <BiteScoreHomeEntry>[];
  Set<_BiteScoreCategoryFilter> _selectedCategoryFilters =
      <_BiteScoreCategoryFilter>{};
  bool _isLoading = true;
  Object? _loadError;
  bool _showAllCategoryFilterChips = false;

  @override
  void initState() {
    super.initState();
    _loadSelectedRadius();
    _restoreSharedLocationState();
    _refreshEntries();
    _restorePersistedLocationPreference();
  }

  @override
  void dispose() {
    dishSearchController.dispose();
    locationSearchController.dispose();
    _locationSearchFocusNode.dispose();
    _listScrollController.dispose();
    super.dispose();
  }

  bool get _hasLocationOrZipInput {
    return currentPosition != null ||
        typedSearchCenter != null ||
        locationSearchController.text.trim().isNotEmpty;
  }

  String _displayText(String value, String fallback) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? fallback : trimmed;
  }

  String _restaurantMetaLabel(BiteScoreHomeEntry entry) {
    final city = entry.restaurant.city.trim();
    final distance = _distanceLabel(entry).trim();
    final parts = <String>[
      if (city.isNotEmpty) city,
      if (distance.isNotEmpty) distance,
    ];
    return parts.isEmpty ? 'Location unavailable' : parts.join(' • ');
  }

  Future<void> _loadSelectedRadius() async {
    final prefs = await SharedPreferences.getInstance();
    final savedRadius = prefs.getString(_selectedRadiusPreferenceKey);
    if (savedRadius == null || !_isSupportedRadius(savedRadius) || !mounted) {
      return;
    }

    setState(() {
      selectedRadius = savedRadius;
    });
  }

  Future<void> _saveSelectedRadius(String value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_selectedRadiusPreferenceKey, value);
  }

  bool _isSupportedRadius(String value) {
    switch (value) {
      case '1 mile':
      case '3 miles':
      case '5 miles':
      case '10 miles':
      case '15 miles':
      case '20 miles':
      case '30 miles':
        return true;
      default:
        return false;
    }
  }

  Future<void> _refreshEntries() async {
    final showLoading = _entries.isEmpty;
    if (mounted) {
      setState(() {
        _loadError = null;
        if (showLoading) {
          _isLoading = true;
        }
      });
    }

    try {
      final loaded = await BiteScoreService.loadHomeEntries();
      if (!mounted) return;
      setState(() {
        _entries = loaded;
        _isLoading = false;
        _loadError = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _loadError = error;
      });
    }
  }

  bool get _supportsReverseGeocodingOnThisPlatform {
    if (kIsWeb) return false;
    return Platform.isAndroid || Platform.isIOS;
  }

  void _restoreSharedLocationState() {
    final sharedLocation = SharedLocationStateService.state;
    locationSearchController.text = sharedLocation.usingCurrentLocation
        ? ''
        : sharedLocation.searchText;
    currentPosition = sharedLocation.usingCurrentLocation
        ? sharedLocation.currentPosition
        : null;
    typedSearchCenter =
        sharedLocation.usingTypedSearchLocation &&
            sharedLocation.typedLatitude != null &&
            sharedLocation.typedLongitude != null
        ? BiteScoreSearchCenter(
            latitude: sharedLocation.typedLatitude!,
            longitude: sharedLocation.typedLongitude!,
            label: sharedLocation.typedLabel.isNotEmpty
                ? sharedLocation.typedLabel
                : sharedLocation.searchText,
          )
        : null;
  }

  Future<void> _restorePersistedLocationPreference() async {
    final result = await SharedLocationStateService.restoreOnLaunch(
      reverseLookupLocation: _reverseLookupLocation,
    );

    if (!mounted) {
      return;
    }

    setState(() {
      _restoreSharedLocationState();
      _launchLocationMessage = result.message;
    });
  }

  double _radiusMiles() {
    return double.tryParse(selectedRadius.split(' ').first) ?? 15;
  }

  double? _distanceMilesFor(BiteScoreHomeEntry entry) {
    final center = _activeSearchCenter();

    if (center == null ||
        entry.restaurant.latitude == null ||
        entry.restaurant.longitude == null) {
      return null;
    }

    final meters = Geolocator.distanceBetween(
      center.latitude,
      center.longitude,
      entry.restaurant.latitude!,
      entry.restaurant.longitude!,
    );

    return meters / 1609.344;
  }

  BiteScoreSearchCenter? _activeSearchCenter() {
    if (currentPosition != null) {
      return BiteScoreSearchCenter(
        latitude: currentPosition!.latitude,
        longitude: currentPosition!.longitude,
        label: 'Using Live Location',
      );
    }

    return typedSearchCenter;
  }

  String _distanceLabel(BiteScoreHomeEntry entry) {
    if (_isExactLocationMatch(entry)) {
      return 'Local';
    }

    final distanceMiles = _distanceMilesFor(entry);
    if (distanceMiles == null) {
      return 'Distance unavailable';
    }

    return '${distanceMiles.toStringAsFixed(1)} mi';
  }

  bool _isExactLocationMatch(BiteScoreHomeEntry entry) {
    final query = typedSearchCenter?.label.trim() ?? '';
    if (query.isEmpty) {
      return false;
    }

    return _normalizeCityForExactMatch(entry.restaurant.city) ==
            _normalizeCityForExactMatch(query) ||
        entry.restaurant.zipCode.trim() == query;
  }

  String _normalizeCityForExactMatch(String value) {
    return value.split(',').first.trim().toLowerCase();
  }

  Future<void> _searchLocation() async {
    final query = locationSearchController.text.trim();
    if (query.isEmpty) {
      setState(() {
        typedSearchCenter = null;
        currentPosition = null;
        _launchLocationMessage = null;
      });
      SharedLocationStateService.clear();
      return;
    }

    setState(() {
      isSearchingLocation = true;
    });

    try {
      final locations = await SharedLocationStateService.geocodeSearchQuery(
        query,
      );
      if (locations.isEmpty) {
        throw Exception('No matching location found.');
      }

      if (!mounted) return;
      setState(() {
        typedSearchCenter = BiteScoreSearchCenter(
          latitude: locations.first.latitude,
          longitude: locations.first.longitude,
          label: query,
        );
        currentPosition = null;
        _launchLocationMessage = null;
      });
      SharedLocationStateService.saveTypedLocation(
        latitude: locations.first.latitude,
        longitude: locations.first.longitude,
        label: query,
        searchText: query,
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not find that location right now.',
            ),
          ),
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          isSearchingLocation = false;
        });
      }
    }
  }

  Future<void> _useMyLocation() async {
    setState(() {
      isGettingLocation = true;
    });

    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        throw Exception('Location services are turned off.');
      }

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }

      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        throw Exception('Location permission was denied.');
      }

      final position = await Geolocator.getCurrentPosition();
      final locationDetails = await _reverseLookupLocation(position);

      if (!mounted) return;
      setState(() {
        currentPosition = position;
        typedSearchCenter = null;
        locationSearchController.clear();
        _launchLocationMessage = null;
      });
      SharedLocationStateService.saveCurrentLocation(
        position: position,
        searchText: '',
        detectedCity: locationDetails.city,
        detectedZip: locationDetails.zip,
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not get your location right now.',
            ),
          ),
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          isGettingLocation = false;
        });
      }
    }
  }

  Future<({String? city, String? zip})> _reverseLookupLocation(
    Position position,
  ) async {
    String? city;
    String? zip;

    if (_supportsReverseGeocodingOnThisPlatform) {
      try {
        final placemarks = await placemarkFromCoordinates(
          position.latitude,
          position.longitude,
        );
        if (placemarks.isNotEmpty) {
          city = (placemarks.first.locality ?? '').trim();
          zip = (placemarks.first.postalCode ?? '').trim();
        }
      } catch (_) {}
    }

    return (city: city, zip: zip);
  }

  List<BiteScoreHomeEntry> _filteredEntries(List<BiteScoreHomeEntry> entries) {
    final dishQuery = dishSearchController.text.trim();
    final locationQuery = locationSearchController.text.trim().toLowerCase();
    final radiusMiles = _radiusMiles();
    final center = _activeSearchCenter();

    final filtered = entries.where((entry) {
      final matchesDishQuery =
          dishQuery.isEmpty ||
          BiteScoreFoodSearch.matchesFoodText(
            entry.dish.name,
            dishQuery,
            enableFuzzy: true,
          ) ||
          BiteScoreFoodSearch.matchesPlainText(
            entry.restaurant.name,
            dishQuery,
          ) ||
          _matchesDishCategorySearch(
            category: entry.dish.category,
            subcategory: entry.dish.subcategory,
            manualKeywords: entry.dish.categoryManualKeywords,
            categoryTags: entry.dish.categoryTags,
            query: dishQuery,
          );

      if (!matchesDishQuery) {
        return false;
      }

      if (_selectedCategoryFilters.isNotEmpty &&
          !_matchesSelectedCategoryFilters(entry)) {
        return false;
      }

      if (center != null) {
        final distanceMiles = _distanceMilesFor(entry);
        if (distanceMiles == null || distanceMiles > radiusMiles) {
          return false;
        }
      } else {
        final matchesLocationQuery =
            locationQuery.isEmpty ||
            entry.restaurant.city.toLowerCase().contains(locationQuery) ||
            entry.restaurant.zipCode.toLowerCase().contains(locationQuery);
        if (!matchesLocationQuery) {
          return false;
        }
      }

      return true;
    }).toList();

    filtered.sort(_compareEntriesForSelectedSort);

    return filtered;
  }

  bool _matchesSelectedCategoryFilters(BiteScoreHomeEntry entry) {
    return _selectedCategoryFilters.any((filter) {
      return BitescoreCategories.matchesSearchQuery(
        categoryName: entry.dish.category,
        subcategory: entry.dish.subcategory,
        manualKeywords: entry.dish.categoryManualKeywords,
        categoryTags: entry.dish.categoryTags,
        query: filter.query,
        enableFuzzy: false,
      );
    });
  }

  bool _matchesDishCategorySearch({
    required String? category,
    required String? subcategory,
    required String? manualKeywords,
    required List<String> categoryTags,
    required String query,
  }) {
    if (BitescoreCategories.matchesSearchQuery(
      categoryName: category,
      subcategory: subcategory,
      manualKeywords: manualKeywords,
      categoryTags: categoryTags,
      query: query,
      enableFuzzy: true,
    )) {
      return true;
    }

    final searchableText = [
      if (subcategory?.trim().isNotEmpty ?? false) subcategory!.trim(),
      if (manualKeywords?.trim().isNotEmpty ?? false) manualKeywords!.trim(),
      ...categoryTags,
    ].join(' ');

    return BiteScoreFoodSearch.matchesFoodText(
      searchableText,
      query,
      enableFuzzy: true,
    );
  }

  int _compareEntriesForSelectedSort(
    BiteScoreHomeEntry a,
    BiteScoreHomeEntry b,
  ) {
    switch (_normalizeSortOption(selectedSort)) {
      case 'Closest':
        final aDistance = _distanceMilesFor(a) ?? double.infinity;
        final bDistance = _distanceMilesFor(b) ?? double.infinity;
        final byDistance = aDistance.compareTo(bDistance);
        if (byDistance != 0) {
          return byDistance;
        }
        return _compareByHighestBiteScore(a, b);
      case 'Most Reviewed':
        final byCount = b.aggregate.ratingCount.compareTo(
          a.aggregate.ratingCount,
        );
        if (byCount != 0) {
          return byCount;
        }
        return _compareByHighestBiteScore(a, b);
      case 'Best Value':
        return _compareByNullableScore(
          a,
          b,
          (entry) => entry.aggregate.valueScoreAverage,
        );
      case 'Best Flavor':
        return _compareByNullableScore(
          a,
          b,
          (entry) => entry.aggregate.tastinessScoreAverage,
        );
      case 'Highest Quality':
        return _compareByNullableScore(
          a,
          b,
          (entry) => entry.aggregate.qualityScoreAverage,
        );
      case 'Most Enjoyed':
        return _compareByNullableScore(
          a,
          b,
          (entry) => entry.aggregate.overallImpressionAverage,
        );
      case 'Highest BiteScore':
      default:
        return _compareByHighestBiteScore(a, b);
    }
  }

  String _normalizeSortOption(String? value) {
    return switch (value) {
      'Highest BiteScore' => 'Highest BiteScore',
      'Top Rated' => 'Highest BiteScore',
      'Highest Rated' => 'Highest BiteScore',
      'Most Reviewed' => 'Most Reviewed',
      'Closest' => 'Closest',
      'Close By' => 'Closest',
      'Nearby' => 'Closest',
      'Best Value' => 'Best Value',
      'Best Flavor' => 'Best Flavor',
      'Highest Quality' => 'Highest Quality',
      'Most Enjoyed' => 'Most Enjoyed',
      _ => _defaultSort,
    };
  }

  int _compareByHighestBiteScore(BiteScoreHomeEntry a, BiteScoreHomeEntry b) {
    final byScore = b.aggregate.overallBiteScore.compareTo(
      a.aggregate.overallBiteScore,
    );
    if (byScore != 0) {
      return byScore;
    }
    final byCount = b.aggregate.ratingCount.compareTo(a.aggregate.ratingCount);
    if (byCount != 0) {
      return byCount;
    }
    return _compareByDishName(a, b);
  }

  int _compareByNullableScore(
    BiteScoreHomeEntry a,
    BiteScoreHomeEntry b,
    double? Function(BiteScoreHomeEntry entry) readScore,
  ) {
    final aScore = readScore(a);
    final bScore = readScore(b);
    if (aScore == null && bScore == null) {
      return _compareByHighestBiteScore(a, b);
    }
    if (aScore == null) {
      return 1;
    }
    if (bScore == null) {
      return -1;
    }
    final byScore = bScore.compareTo(aScore);
    if (byScore != 0) {
      return byScore;
    }
    return _compareByHighestBiteScore(a, b);
  }

  int _compareByDishName(BiteScoreHomeEntry a, BiteScoreHomeEntry b) {
    return a.dish.name.toLowerCase().compareTo(b.dish.name.toLowerCase());
  }

  InputDecoration _inputDecoration({
    required String hintText,
    IconData? prefixIcon,
  }) {
    return InputDecoration(
      hintText: hintText,
      filled: true,
      fillColor: BiteRaterTheme.cardSurface,
      isDense: true,
      prefixIcon: prefixIcon == null
          ? null
          : Icon(prefixIcon, color: BiteRaterTheme.ocean.withOpacity(0.82)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: BiteRaterTheme.lineBlue, width: 1),
      ),
      disabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: BiteRaterTheme.lineBlue, width: 1),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(
          color: BiteRaterTheme.ocean.withOpacity(0.55),
          width: 1.4,
        ),
      ),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(16)),
    );
  }

  Widget _buildSearchField({
    required TextEditingController controller,
    required String hintText,
    required VoidCallback onSearch,
    FocusNode? focusNode,
    IconData? prefixIcon,
    bool showArrowIcon = true,
  }) {
    return Stack(
      alignment: Alignment.centerRight,
      children: [
        TextField(
          controller: controller,
          focusNode: focusNode,
          onSubmitted: (_) => onSearch(),
          decoration:
              _inputDecoration(
                hintText: hintText,
                prefixIcon: prefixIcon,
              ).copyWith(
                contentPadding: EdgeInsets.fromLTRB(
                  12,
                  13,
                  showArrowIcon ? 156 : 88,
                  13,
                ),
              ),
        ),
        Positioned(
          top: 1,
          right: 1,
          bottom: 1,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: const Color(0xFFF7FAFD),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: BiteRaterTheme.ocean.withOpacity(0.14)),
              boxShadow: [
                BoxShadow(
                  color: BiteRaterTheme.ocean.withOpacity(0.04),
                  blurRadius: 4,
                  offset: const Offset(0, 1),
                ),
              ],
            ),
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: onSearch,
                borderRadius: BorderRadius.circular(16),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 18),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (showArrowIcon) ...[
                        const Icon(
                          Icons.arrow_forward,
                          size: 16,
                          color: BiteRaterTheme.restaurantTitle,
                        ),
                        const SizedBox(width: 6),
                      ],
                      const Text(
                        'Search',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: BiteRaterTheme.restaurantTitle,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _expandHeader() async {
    if (!_listScrollController.hasClients) {
      return;
    }
    await _listScrollController.animateTo(
      0,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
    );
  }

  Future<void> _focusLocationSearchField() async {
    await _expandHeader();
    if (!mounted) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _locationSearchFocusNode.requestFocus();
      }
    });
  }

  Widget _buildLocationActionRow({double minHeight = 52}) {
    final borderRadius = BorderRadius.circular(14);
    final sharedActionButtonStyle = ElevatedButton.styleFrom(
      backgroundColor: const Color(0xFFE94312),
      foregroundColor: Colors.white,
      disabledBackgroundColor: const Color(0xFFE94312).withValues(alpha: 0.55),
      disabledForegroundColor: Colors.white.withValues(alpha: 0.82),
      elevation: 0,
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      shape: RoundedRectangleBorder(
        borderRadius: borderRadius,
        side: BorderSide.none,
      ),
      textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
    );

    return Align(
      alignment: Alignment.center,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 380),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Expanded(
              child: ElevatedButton.icon(
                onPressed: isGettingLocation ? null : _useMyLocation,
                style: sharedActionButtonStyle.copyWith(
                  minimumSize: WidgetStatePropertyAll(
                    Size.fromHeight(minHeight),
                  ),
                  padding: const WidgetStatePropertyAll(
                    EdgeInsets.symmetric(vertical: 10),
                  ),
                ),
                icon: const Icon(Icons.location_on, size: 18),
                label: Text(
                  isGettingLocation ? 'Getting Location...' : 'Use My Location',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSortDropdown() {
    return SizedBox(
      height: 36,
      child: Container(
        padding: const EdgeInsets.only(left: 12, right: 10),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: BiteRaterTheme.lineBlue, width: 0.8),
        ),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<String>(
            value: _normalizeSortOption(selectedSort),
            isDense: true,
            isExpanded: false,
            padding: EdgeInsets.zero,
            icon: const Icon(Icons.keyboard_arrow_down, size: 18),
            style: const TextStyle(
              color: BiteRaterTheme.ink,
              fontSize: 12,
              fontWeight: FontWeight.w600,
              height: 1,
            ),
            selectedItemBuilder: (context) => const [
              Text('BiteScore'),
              Text('Reviews', overflow: TextOverflow.ellipsis),
              Text('Closest', overflow: TextOverflow.ellipsis),
              Text('Value', overflow: TextOverflow.ellipsis),
              Text('Flavor', overflow: TextOverflow.ellipsis),
              Text('Quality', overflow: TextOverflow.ellipsis),
              Text('Enjoyed', overflow: TextOverflow.ellipsis),
            ],
            items: const [
              DropdownMenuItem(
                value: 'Highest BiteScore',
                child: Text('Highest BiteScore'),
              ),
              DropdownMenuItem(
                value: 'Most Reviewed',
                child: Text('Most Reviewed'),
              ),
              DropdownMenuItem(value: 'Closest', child: Text('Closest')),
              DropdownMenuItem(value: 'Best Value', child: Text('Best Value')),
              DropdownMenuItem(
                value: 'Best Flavor',
                child: Text('Best Flavor'),
              ),
              DropdownMenuItem(
                value: 'Highest Quality',
                child: Text('Highest Quality'),
              ),
              DropdownMenuItem(
                value: 'Most Enjoyed',
                child: Text('Most Enjoyed'),
              ),
            ],
            onChanged: (value) {
              if (value != null) {
                setState(() {
                  selectedSort = _normalizeSortOption(value);
                });
              }
            },
          ),
        ),
      ),
    );
  }

  Widget _buildSortControl() {
    return Align(alignment: Alignment.centerLeft, child: _buildSortDropdown());
  }

  Future<void> _openCategoryFilterSheet() async {
    final selection = await showModalBottomSheet<Set<_BiteScoreCategoryFilter>>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (context) {
        return _BiteScoreCategoryFilterSheet(
          selectedFilters: _selectedCategoryFilters,
        );
      },
    );

    if (selection == null || !mounted) {
      return;
    }

    setState(() {
      _selectedCategoryFilters = selection;
      if (_selectedCategoryFilters.length <= 3) {
        _showAllCategoryFilterChips = false;
      }
    });
  }

  void _removeCategoryFilter(_BiteScoreCategoryFilter filter) {
    setState(() {
      _selectedCategoryFilters = {..._selectedCategoryFilters}..remove(filter);
      if (_selectedCategoryFilters.length <= 3) {
        _showAllCategoryFilterChips = false;
      }
    });
  }

  void _clearCategoryFilters() {
    setState(() {
      _selectedCategoryFilters = <_BiteScoreCategoryFilter>{};
      _showAllCategoryFilterChips = false;
    });
  }

  Widget _buildAddDishButton() {
    return SizedBox(
      width: _homeControlPillWidth,
      height: 36,
      child: ElevatedButton(
        onPressed: _openCreateAndRate,
        style:
            ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFE94312),
              foregroundColor: Colors.white,
              disabledBackgroundColor: const Color(
                0xFFE94312,
              ).withValues(alpha: 0.55),
              disabledForegroundColor: Colors.white.withValues(alpha: 0.82),
              shadowColor: Colors.transparent,
              surfaceTintColor: Colors.transparent,
              elevation: 0,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(18),
              ),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ).copyWith(
              minimumSize: const WidgetStatePropertyAll(Size(0, 36)),
              textStyle: const WidgetStatePropertyAll(
                TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.1,
                ),
              ),
            ),
        child: const Text(
          'Add Dish',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
  }

  Widget _buildFilterButton() {
    final hasFilters = _selectedCategoryFilters.isNotEmpty;
    return SizedBox(
      width: _homeControlPillWidth,
      height: 36,
      child: OutlinedButton(
        onPressed: _openCategoryFilterSheet,
        style: OutlinedButton.styleFrom(
          foregroundColor: hasFilters
              ? BiteRaterTheme.grape
              : BiteRaterTheme.ink,
          backgroundColor: hasFilters ? const Color(0xFFFAF7FF) : Colors.white,
          side: BorderSide(
            color: hasFilters
                ? BiteRaterTheme.grape.withValues(alpha: 0.34)
                : BiteRaterTheme.lineBlue,
            width: 0.9,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Filter',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
            ),
            SizedBox(width: 6),
            Icon(Icons.tune, size: 17),
          ],
        ),
      ),
    );
  }

  Widget _buildFilterChips() {
    if (_selectedCategoryFilters.isEmpty) {
      return const SizedBox.shrink();
    }

    final filters = _selectedCategoryFilters.toList()
      ..sort((a, b) => a.label.compareTo(b.label));
    final visibleFilters = _showAllCategoryFilterChips
        ? filters
        : filters.take(3).toList();
    final hiddenCount = filters.length - visibleFilters.length;

    return Align(
      alignment: Alignment.centerLeft,
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          for (final filter in visibleFilters)
            InputChip(
              label: Text(filter.label),
              visualDensity: VisualDensity.compact,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              onDeleted: () => _removeCategoryFilter(filter),
              deleteIcon: const Icon(Icons.close, size: 15),
              backgroundColor: const Color(0xFFF7FAFF),
              side: BorderSide(
                color: BiteRaterTheme.ocean.withValues(alpha: 0.18),
              ),
              labelStyle: const TextStyle(
                color: BiteRaterTheme.ink,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          if (hiddenCount > 0)
            ActionChip(
              visualDensity: VisualDensity.compact,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              label: Text('+$hiddenCount'),
              onPressed: () {
                setState(() {
                  _showAllCategoryFilterChips = true;
                });
              },
            ),
          if (_showAllCategoryFilterChips && filters.length > 3)
            ActionChip(
              visualDensity: VisualDensity.compact,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              label: const Icon(Icons.keyboard_arrow_up_rounded, size: 18),
              onPressed: () {
                setState(() {
                  _showAllCategoryFilterChips = false;
                });
              },
            ),
          TextButton(
            onPressed: _clearCategoryFilters,
            style: TextButton.styleFrom(
              foregroundColor: BiteRaterTheme.mutedInk,
              visualDensity: VisualDensity.compact,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text(
              'Clear all',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildResultsControlBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 3),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            height: 1,
            margin: const EdgeInsets.only(bottom: 4),
            color: BiteRaterTheme.lineBlue.withValues(alpha: 0.42),
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _buildSortControl(),
                        const SizedBox(width: 10),
                        _buildFilterButton(),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              _buildAddDishButton(),
            ],
          ),
          if (_selectedCategoryFilters.isNotEmpty) ...[
            const SizedBox(height: 6),
            _buildFilterChips(),
          ],
        ],
      ),
    );
  }

  Widget _buildHeader({required double expansionT}) {
    final collapsed = expansionT <= 0.02;

    return Material(
      color: Colors.transparent,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 2),
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            color: const Color(0xFFFFFCF6),
            boxShadow: const [
              BoxShadow(
                color: Color(0x10000000),
                blurRadius: 0,
                spreadRadius: 1,
              ),
              BoxShadow(
                color: Color(0x180F172A),
                blurRadius: 16,
                offset: Offset(0, 7),
              ),
              BoxShadow(
                color: Color(0x0C0F172A),
                blurRadius: 5,
                offset: Offset(0, 2),
              ),
            ],
          ),
          child: BiteRaterTheme.liftedCard(
            radius: 20,
            borderColor: BiteRaterTheme.coral.withValues(alpha: 0.28),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: const Color(0xFFFFFCF6),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (collapsed)
                      Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          InkWell(
                            borderRadius: BorderRadius.circular(16),
                            onTap: _expandHeader,
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 2),
                              child: Column(
                                children: [
                                  Text(
                                    'Expand search',
                                    style: TextStyle(
                                      color: BiteRaterTheme.grape,
                                      fontSize: 12,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  const SizedBox(height: 1),
                                  Icon(
                                    Icons.keyboard_arrow_down,
                                    color: BiteRaterTheme.grape,
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      )
                    else
                      const SizedBox.shrink(),
                    ClipRect(
                      child: Align(
                        alignment: Alignment.topCenter,
                        heightFactor: expansionT,
                        child: IgnorePointer(
                          ignoring: collapsed,
                          child: Opacity(
                            opacity: expansionT,
                            child: Stack(
                              children: [
                                Column(
                                  mainAxisSize: MainAxisSize.min,
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    _buildSearchField(
                                      controller: dishSearchController,
                                      hintText: 'Search dishes or restaurants',
                                      prefixIcon: Icons.restaurant_menu,
                                      onSearch: () {
                                        setState(() {});
                                      },
                                      showArrowIcon: false,
                                    ),
                                    const SizedBox(height: 4),
                                    _buildSearchField(
                                      controller: locationSearchController,
                                      focusNode: _locationSearchFocusNode,
                                      hintText: 'City or zip code',
                                      prefixIcon: Icons.search,
                                      onSearch: _searchLocation,
                                      showArrowIcon: false,
                                    ),
                                    const SizedBox(height: 4),
                                    Row(
                                      children: [
                                        Expanded(
                                          flex: 7,
                                          child: _buildLocationActionRow(
                                            minHeight: 40,
                                          ),
                                        ),
                                        const SizedBox(width: 10),
                                        SizedBox(
                                          width: 116,
                                          height: 40,
                                          child: DropdownButtonFormField<String>(
                                            initialValue: selectedRadius,
                                            isExpanded: true,
                                            decoration:
                                                _inputDecoration(
                                                  hintText: 'Radius',
                                                ).copyWith(
                                                  contentPadding:
                                                      const EdgeInsets.symmetric(
                                                        horizontal: 12,
                                                        vertical: 9,
                                                      ),
                                                ),
                                            selectedItemBuilder: (context) =>
                                                const [
                                                  Text('1 mi'),
                                                  Text('3 mi'),
                                                  Text('5 mi'),
                                                  Text('10 mi'),
                                                  Text('15 mi'),
                                                  Text('20 mi'),
                                                  Text('30 mi'),
                                                ],
                                            items: const [
                                              DropdownMenuItem(
                                                value: '1 mile',
                                                child: Text('1 mi'),
                                              ),
                                              DropdownMenuItem(
                                                value: '3 miles',
                                                child: Text('3 mi'),
                                              ),
                                              DropdownMenuItem(
                                                value: '5 miles',
                                                child: Text('5 mi'),
                                              ),
                                              DropdownMenuItem(
                                                value: '10 miles',
                                                child: Text('10 mi'),
                                              ),
                                              DropdownMenuItem(
                                                value: '15 miles',
                                                child: Text('15 mi'),
                                              ),
                                              DropdownMenuItem(
                                                value: '20 miles',
                                                child: Text('20 mi'),
                                              ),
                                              DropdownMenuItem(
                                                value: '30 miles',
                                                child: Text('30 mi'),
                                              ),
                                            ],
                                            onChanged: (value) {
                                              if (value != null) {
                                                setState(() {
                                                  selectedRadius = value;
                                                });
                                                _saveSelectedRadius(value);
                                              }
                                            },
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                  ],
                                ),
                                if (isSearchingLocation)
                                  Positioned.fill(
                                    child: DecoratedBox(
                                      decoration: BoxDecoration(
                                        color: BiteRaterTheme.cardSurface
                                            .withValues(alpha: 0.74),
                                        borderRadius: BorderRadius.circular(18),
                                      ),
                                      child: const Center(
                                        child: SizedBox(
                                          width: 20,
                                          height: 20,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            color: BiteRaterTheme.ocean,
                                          ),
                                        ),
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
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _openDishDetail(BiteScoreHomeEntry entry) async {
    final distanceLabel = _distanceLabel(entry);
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => BiteScoreDishDetailScreen(
          entry: entry,
          distanceLabel: distanceLabel,
        ),
      ),
    );

    if (mounted) {
      _refreshEntries();
    }
  }

  Future<void> _openRestaurantPage({
    required BitescoreRestaurant restaurant,
    required List<BiteScoreHomeEntry> entries,
  }) async {
    final refreshed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => BiteScoreRestaurantDishesScreen(
          restaurant: restaurant,
          entries: entries,
        ),
      ),
    );

    if (refreshed == true && mounted) {
      _refreshEntries();
    }
  }

  Widget _buildDishThumbnail(
    String? imageUrl, {
    required double width,
    required double height,
    required BorderRadius borderRadius,
  }) {
    final trimmedUrl = imageUrl?.trim();

    Widget buildPlaceholder() {
      return Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFFFFF7EA), Color(0xFFF3F6FB)],
          ),
          borderRadius: borderRadius,
        ),
        alignment: Alignment.center,
        child: Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.78),
            shape: BoxShape.circle,
            border: Border.all(
              color: BiteRaterTheme.coral.withValues(alpha: 0.18),
            ),
          ),
          child: Icon(
            Icons.restaurant_menu_rounded,
            size: 24,
            color: BiteRaterTheme.coral.withValues(alpha: 0.70),
          ),
        ),
      );
    }

    if (trimmedUrl == null || trimmedUrl.isEmpty) {
      return buildPlaceholder();
    }

    return ClipRRect(
      borderRadius: borderRadius,
      child: Image.network(
        trimmedUrl,
        width: width,
        height: height,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) => buildPlaceholder(),
      ),
    );
  }

  Widget _buildEntryCard(
    BiteScoreHomeEntry entry,
    List<BiteScoreHomeEntry> entries,
  ) {
    final biteScore = entry.aggregate.overallBiteScore;
    final displayedScore = biteScore.isFinite && biteScore > 0
        ? int.tryParse(biteScore.toStringAsFixed(0))
        : null;
    final scoreLabel = displayedScore?.toString() ?? '--';
    final scorePillLabel = '$scoreLabel/100';
    final scorePalette = _ScorePillPalette.forDisplayedScore(displayedScore);
    final restaurantEntries = entries
        .where((item) => item.restaurant.id == entry.restaurant.id)
        .toList();
    const cardRadius = 22.0;
    const cardHeight = 150.0;
    const imageWidth = 176.0;
    const imageRadius = BorderRadius.horizontal(
      left: Radius.circular(cardRadius),
    );

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BiteRaterTheme.liftedCardOuterDecoration(radius: cardRadius),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(cardRadius),
        child: Container(
          height: cardHeight,
          decoration: BoxDecoration(
            color: BiteRaterTheme.cardSurface,
            borderRadius: BorderRadius.circular(cardRadius),
            border: Border.all(
              color: BiteRaterTheme.lineBlue.withValues(alpha: 0.68),
              width: 0.9,
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                width: imageWidth,
                child: BiteRaterTheme.pressableSection(
                  onTap: () => _openDishDetail(entry),
                  borderRadius: imageRadius,
                  pressedScale: 0.965,
                  restingColor: const Color(0xFFFFFCF6),
                  pressedColor: const Color(0xFFFFF7EA),
                  child: _buildDishThumbnail(
                    entry.dish.primaryImageUrl,
                    width: imageWidth,
                    height: cardHeight,
                    borderRadius: imageRadius,
                  ),
                ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      child: BiteRaterTheme.pressableSection(
                        onTap: () => _openDishDetail(entry),
                        borderRadius: const BorderRadius.only(
                          topRight: Radius.circular(cardRadius),
                        ),
                        pressedScale: 0.965,
                        restingColor: const Color(0xFFFFFCF6),
                        pressedColor: const Color(0xFFFFF7EA),
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(14, 8, 8, 6),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: [
                              Expanded(
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      _displayText(
                                        entry.dish.name,
                                        'Unnamed dish',
                                      ),
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        color: BiteRaterTheme.ink,
                                        fontSize: 18.0,
                                        fontWeight: FontWeight.w900,
                                        letterSpacing: 0.0,
                                        height: 1.06,
                                      ),
                                    ),
                                    const SizedBox(height: 5),
                                    Align(
                                      alignment: Alignment.centerLeft,
                                      child: Column(
                                        mainAxisSize: MainAxisSize.min,
                                        crossAxisAlignment:
                                            CrossAxisAlignment.center,
                                        children: [
                                          Container(
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 9,
                                              vertical: 3,
                                            ),
                                            decoration: BoxDecoration(
                                              color: scorePalette.background,
                                              borderRadius:
                                                  BorderRadius.circular(999),
                                              border: Border.all(
                                                color: scorePalette.border,
                                              ),
                                            ),
                                            child: Text(
                                              scorePillLabel,
                                              textAlign: TextAlign.center,
                                              style: TextStyle(
                                                fontSize: 14,
                                                fontWeight: FontWeight.w900,
                                                color: scorePalette.foreground,
                                                height: 1,
                                              ),
                                            ),
                                          ),
                                          const SizedBox(height: 2),
                                          Text(
                                            '(${entry.aggregate.ratingCount})',
                                            textAlign: TextAlign.center,
                                            style: TextStyle(
                                              fontSize: 10.5,
                                              color: BiteRaterTheme.mutedInk
                                                  .withValues(alpha: 0.72),
                                              fontWeight: FontWeight.w700,
                                              height: 1,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 6),
                              Icon(
                                Icons.chevron_right_rounded,
                                size: 25,
                                color: BiteRaterTheme.mutedInk.withValues(
                                  alpha: 0.62,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    Container(
                      height: 0.5,
                      margin: const EdgeInsets.only(left: 14, right: 10),
                      color: BiteRaterTheme.lineBlue.withValues(alpha: 0.48),
                    ),
                    SizedBox(
                      height: 50,
                      child: BiteRaterTheme.pressableSection(
                        onTap: () => _openRestaurantPage(
                          restaurant: entry.restaurant,
                          entries: restaurantEntries,
                        ),
                        borderRadius: const BorderRadius.only(
                          bottomRight: Radius.circular(cardRadius),
                        ),
                        restingColor: const Color(0xFFF8FAFC),
                        pressedScale: 0.99,
                        pressedColor: const Color(0xFFF1F5FA),
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(13, 7, 12, 8),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.center,
                                children: [
                                  Icon(
                                    Icons.storefront_outlined,
                                    size: 16,
                                    color: BiteRaterTheme.restaurantTitle
                                        .withValues(alpha: 0.72),
                                  ),
                                  const SizedBox(width: 7),
                                  Expanded(
                                    child: Text(
                                      _displayText(
                                        entry.restaurant.name,
                                        'Restaurant',
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        color: BiteRaterTheme.restaurantTitle
                                            .withValues(alpha: 0.86),
                                        fontSize: 12.6,
                                        fontWeight: FontWeight.w700,
                                        height: 1.05,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 3),
                              Padding(
                                padding: const EdgeInsets.only(left: 23),
                                child: Text(
                                  _restaurantMetaLabel(entry),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    color: BiteRaterTheme.mutedInk.withValues(
                                      alpha: 0.78,
                                    ),
                                    fontSize: 11.2,
                                    fontWeight: FontWeight.w500,
                                    height: 1.08,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openCreateAndRate() async {
    final canWrite = await BiteScoreSignInGate.ensureSignedInForWrite(context);
    if (!canWrite || !mounted) {
      return;
    }

    final created = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const BiteScoreCreateRateScreen()),
    );

    if (created == true && mounted) {
      _refreshEntries();
    }
  }

  Widget _buildGetStartedState() {
    return SliverFillRemaining(
      hasScrollBody: false,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 32),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.all(22),
                  decoration: BiteRaterTheme.surfaceDecoration(
                    accentColor: BiteRaterTheme.ocean,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        'Find great food near you 🍽️',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: BiteRaterTheme.ink,
                          fontSize: 28,
                          fontWeight: FontWeight.w900,
                          height: 1.15,
                        ),
                      ),
                      const SizedBox(height: 14),
                      const Text(
                        'Use your location or enter a ZIP code to see nearby deals and top-rated dishes.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: BiteRaterTheme.mutedInk,
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          height: 1.45,
                        ),
                      ),
                      if (_launchLocationMessage != null &&
                          _launchLocationMessage!.trim().isNotEmpty) ...[
                        const SizedBox(height: 12),
                        Text(
                          _launchLocationMessage!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: BiteRaterTheme.mutedInk,
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            height: 1.35,
                          ),
                        ),
                      ],
                      const SizedBox(height: 24),
                      _buildLocationActionRow(),
                      const SizedBox(height: 12),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: _focusLocationSearchField,
                          style: BiteRaterTheme.outlinedButtonStyle(
                            accentColor: BiteRaterTheme.ocean,
                          ),
                          icon: const Icon(Icons.location_searching, size: 18),
                          label: const Text('Enter ZIP Code'),
                        ),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'We only use your location to show nearby results.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: BiteRaterTheme.mutedInk,
                          fontSize: 12,
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
      ),
    );
  }

  Widget _buildInlineLoadingState() {
    return const SliverToBoxAdapter(
      child: Padding(
        padding: EdgeInsets.fromLTRB(24, 20, 24, 24),
        child: Center(
          child: SizedBox(
            width: 24,
            height: 24,
            child: CircularProgressIndicator(strokeWidth: 2.4),
          ),
        ),
      ),
    );
  }

  Widget _buildInlineErrorState() {
    return SliverToBoxAdapter(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(20),
          decoration: BiteRaterTheme.surfaceDecoration(
            accentColor: BiteRaterTheme.coral,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Could not load BiteScore dishes.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: BiteRaterTheme.ink,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 12),
              ElevatedButton(
                onPressed: _refreshEntries,
                child: const Text('Try Again'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildResultsSliver(List<BiteScoreHomeEntry> entries) {
    return SliverList(
      delegate: SliverChildBuilderDelegate((context, index) {
        if (entries.isEmpty) {
          return Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              decoration: BiteRaterTheme.surfaceDecoration(
                accentColor: BiteRaterTheme.ocean,
              ),
              child: const Text(
                'No BiteScore dishes found yet. Use Create and Rate to add the first one.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: BiteRaterTheme.mutedInk,
                  fontWeight: FontWeight.w700,
                  height: 1.3,
                ),
              ),
            ),
          );
        }

        return _buildEntryCard(entries[index], _entries);
      }, childCount: entries.isEmpty ? 1 : entries.length),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filteredEntries = _filteredEntries(_entries);
    final bottomContentPadding =
        148.0 + MediaQuery.of(context).viewPadding.bottom;

    return Scaffold(
      backgroundColor: BiteRaterTheme.pageBackground,
      body: ScrollConfiguration(
        behavior: ScrollConfiguration.of(context).copyWith(overscroll: false),
        child: CustomScrollView(
          controller: _listScrollController,
          physics: const ClampingScrollPhysics(),
          slivers: [
            SliverPersistentHeader(
              pinned: true,
              delegate: _BiteScoreHeaderDelegate(
                minExtentHeight: _collapsedHeaderExtent,
                maxExtentHeight: _expandedHeaderExtent,
                builder: (context, expansionT) =>
                    _buildHeader(expansionT: expansionT),
              ),
            ),
            if (_hasLocationOrZipInput)
              SliverToBoxAdapter(child: _buildResultsControlBar()),
            SliverPadding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, bottomContentPadding),
              sliver: !_hasLocationOrZipInput
                  ? _buildGetStartedState()
                  : _loadError != null && _entries.isEmpty
                  ? _buildInlineErrorState()
                  : _isLoading && _entries.isEmpty
                  ? _buildInlineLoadingState()
                  : _buildResultsSliver(filteredEntries),
            ),
          ],
        ),
      ),
    );
  }
}

class _BiteScoreCategoryFilterSheet extends StatefulWidget {
  final Set<_BiteScoreCategoryFilter> selectedFilters;

  const _BiteScoreCategoryFilterSheet({required this.selectedFilters});

  @override
  State<_BiteScoreCategoryFilterSheet> createState() =>
      _BiteScoreCategoryFilterSheetState();
}

class _BiteScoreCategoryFilterSheetState
    extends State<_BiteScoreCategoryFilterSheet> {
  late Set<_BiteScoreCategoryFilter> _draftFilters;
  late Set<String> _expandedCategoryIds;
  bool _isMoreCuisinesExpanded = false;

  @override
  void initState() {
    super.initState();
    _draftFilters = {...widget.selectedFilters};
    _expandedCategoryIds = {
      for (final filter in _draftFilters)
        if (filter.id.startsWith('subcategory:'))
          filter.id.split(':').length >= 3 ? filter.id.split(':')[1] : '',
    }..remove('');
    _isMoreCuisinesExpanded = _draftFilters.any((filter) {
      return BitescoreCategories.filterMoreCuisineCategories.any(
        (category) =>
            filter.id == _BiteScoreCategoryFilter.category(category).id ||
            filter.id.startsWith('subcategory:${category.id}:'),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.paddingOf(context).bottom;

    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.84,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 12, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Filter',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      color: BiteRaterTheme.ink,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Close',
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
          ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              padding: EdgeInsets.fromLTRB(8, 0, 8, bottomPadding + 88),
              children: [
                for (final category
                    in BitescoreCategories.filterCommonCategories)
                  ..._buildCategoryRows(category),
                if (BitescoreCategories.filterMoreCuisineCategories.isNotEmpty)
                  _buildMoreCuisinesRow(),
                if (_isMoreCuisinesExpanded)
                  for (final category
                      in BitescoreCategories.filterMoreCuisineCategories)
                    ..._buildCategoryRows(category),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
              decoration: const BoxDecoration(
                color: Colors.white,
                border: Border(
                  top: BorderSide(color: BiteRaterTheme.lineBlue, width: 0.8),
                ),
              ),
              child: Row(
                children: [
                  TextButton(
                    onPressed: _draftFilters.isEmpty
                        ? null
                        : () {
                            setState(() {
                              _draftFilters = <_BiteScoreCategoryFilter>{};
                            });
                          },
                    child: const Text('Clear all'),
                  ),
                  const Spacer(),
                  FilledButton(
                    onPressed: () => Navigator.of(context).pop(_draftFilters),
                    child: const Text('Apply'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _buildCategoryRows(BitescoreCategory category) {
    final filter = _BiteScoreCategoryFilter.category(category);
    final isSelected = _draftFilters.contains(filter);
    final isExpanded = _expandedCategoryIds.contains(category.id);
    final canExpand =
        category.hasSubcategories && !_isQuickPickCategory(category);

    return [
      ListTile(
        leading: Checkbox(
          value: isSelected,
          onChanged: (_) => _toggleCategoryFilter(category),
        ),
        title: Text(
          category.displayName,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        trailing: canExpand
            ? IconButton(
                tooltip: isExpanded ? 'Collapse' : 'Expand',
                icon: Icon(
                  isExpanded
                      ? Icons.keyboard_arrow_up_rounded
                      : Icons.keyboard_arrow_down_rounded,
                  color: BiteRaterTheme.mutedInk,
                ),
                onPressed: () => _toggleCategoryExpansion(category.id),
              )
            : null,
        onTap: () => _toggleCategoryFilter(category),
      ),
      if (canExpand && isExpanded) ...[
        const Padding(
          padding: EdgeInsets.fromLTRB(72, 0, 16, 4),
          child: Text(
            'Optional subcategory',
            style: TextStyle(
              color: BiteRaterTheme.mutedInk,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        for (final subcategory in category.subcategories)
          Padding(
            padding: const EdgeInsets.only(left: 24),
            child: CheckboxListTile(
              dense: true,
              controlAffinity: ListTileControlAffinity.leading,
              value: _draftFilters.contains(
                _BiteScoreCategoryFilter.subcategory(category, subcategory),
              ),
              title: Text(subcategory),
              onChanged: (_) => _toggleSubcategoryFilter(category, subcategory),
            ),
          ),
      ],
    ];
  }

  bool _isQuickPickCategory(BitescoreCategory category) {
    return BitescoreCategories.isFeaturedCategory(category);
  }

  void _toggleCategoryFilter(BitescoreCategory category) {
    final filter = _BiteScoreCategoryFilter.category(category);
    final canExpand =
        category.hasSubcategories && !_isQuickPickCategory(category);
    setState(() {
      if (_draftFilters.contains(filter)) {
        _draftFilters.remove(filter);
      } else {
        _draftFilters
          ..removeWhere(
            (selected) =>
                selected.categoryId == category.id && selected.isSubcategory,
          )
          ..add(filter);
        if (canExpand) {
          _expandedCategoryIds.add(category.id);
        }
      }
    });
  }

  void _toggleSubcategoryFilter(
    BitescoreCategory category,
    String subcategory,
  ) {
    final filter = _BiteScoreCategoryFilter.subcategory(category, subcategory);
    final parentFilter = _BiteScoreCategoryFilter.category(category);
    setState(() {
      if (_draftFilters.contains(filter)) {
        _draftFilters.remove(filter);
      } else {
        _draftFilters
          ..remove(parentFilter)
          ..add(filter);
      }
    });
  }

  Widget _buildMoreCuisinesRow() {
    return ListTile(
      dense: true,
      title: const Text(
        'More cuisines',
        style: TextStyle(
          color: BiteRaterTheme.mutedInk,
          fontWeight: FontWeight.w700,
        ),
      ),
      trailing: Icon(
        _isMoreCuisinesExpanded
            ? Icons.keyboard_arrow_up_rounded
            : Icons.keyboard_arrow_down_rounded,
        color: BiteRaterTheme.mutedInk,
      ),
      onTap: () {
        setState(() {
          _isMoreCuisinesExpanded = !_isMoreCuisinesExpanded;
        });
      },
    );
  }

  void _toggleCategoryExpansion(String categoryId) {
    setState(() {
      if (_expandedCategoryIds.contains(categoryId)) {
        _expandedCategoryIds.remove(categoryId);
      } else {
        _expandedCategoryIds.add(categoryId);
      }
    });
  }
}

class _BiteScoreHeaderDelegate extends SliverPersistentHeaderDelegate {
  final double minExtentHeight;
  final double maxExtentHeight;
  final Widget Function(BuildContext context, double expansionT) builder;

  const _BiteScoreHeaderDelegate({
    required this.minExtentHeight,
    required this.maxExtentHeight,
    required this.builder,
  });

  @override
  double get minExtent => minExtentHeight;

  @override
  double get maxExtent => maxExtentHeight;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    final availableRange = (maxExtent - minExtent).clamp(1, double.infinity);
    final currentExtent = (maxExtent - shrinkOffset).clamp(
      minExtent,
      maxExtent,
    );
    final expansionT = ((currentExtent - minExtent) / availableRange).clamp(
      0.0,
      1.0,
    );

    return ClipRect(
      child: SizedBox(
        height: currentExtent,
        child: Align(
          alignment: Alignment.topCenter,
          child: builder(context, expansionT),
        ),
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _BiteScoreHeaderDelegate oldDelegate) {
    return minExtentHeight != oldDelegate.minExtentHeight ||
        maxExtentHeight != oldDelegate.maxExtentHeight ||
        builder != oldDelegate.builder;
  }
}

class _ScorePillPalette {
  final Color background;
  final Color border;
  final Color foreground;

  const _ScorePillPalette({
    required this.background,
    required this.border,
    required this.foreground,
  });

  factory _ScorePillPalette.forDisplayedScore(int? score) {
    if (score == null) {
      return const _ScorePillPalette(
        background: Color(0xFFF1F5F9),
        border: Color(0xFFD6DEE8),
        foreground: Color(0xFF64748B),
      );
    }
    if (score >= 90) {
      return const _ScorePillPalette(
        background: Color(0xFFE7F7ED),
        border: Color(0xFF9AD6AE),
        foreground: Color(0xFF197A3A),
      );
    }
    if (score >= 80) {
      return const _ScorePillPalette(
        background: Color(0xFFFFF4D7),
        border: Color(0xFFEBC96B),
        foreground: Color(0xFF9A6500),
      );
    }
    if (score >= 70) {
      return const _ScorePillPalette(
        background: Color(0xFFFFE9D6),
        border: Color(0xFFFFB16F),
        foreground: Color(0xFFB64B00),
      );
    }
    return const _ScorePillPalette(
      background: Color(0xFFFFE6E0),
      border: Color(0xFFFFA197),
      foreground: Color(0xFFC53123),
    );
  }
}
