import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

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

class BiteScoreHomeScreen extends StatefulWidget {
  const BiteScoreHomeScreen({super.key});

  @override
  State<BiteScoreHomeScreen> createState() => _BiteScoreHomeScreenState();
}

class _BiteScoreHomeScreenState extends State<BiteScoreHomeScreen> {
  static const double _collapsedHeaderExtent = 86;
  static const double _expandedHeaderExtent = 300;
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
  bool _isLoading = true;
  Object? _loadError;

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
    locationSearchController.text = sharedLocation.searchText;
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
    final distanceMiles = _distanceMilesFor(entry);
    if (distanceMiles == null) {
      return 'Distance unavailable';
    }

    return '${distanceMiles.toStringAsFixed(1)} mi';
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
      final locations = await locationFromAddress(query);
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
      final locationText = locationDetails.city?.isNotEmpty == true
          ? locationDetails.city!
          : (locationDetails.zip?.isNotEmpty == true
                ? locationDetails.zip!
                : '');

      if (!mounted) return;
      setState(() {
        currentPosition = position;
        typedSearchCenter = null;
        locationSearchController.text = locationText;
        _launchLocationMessage = null;
      });
      SharedLocationStateService.saveCurrentLocation(
        position: position,
        searchText: locationText,
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
    final dishQuery = dishSearchController.text.trim().toLowerCase();
    final locationQuery = locationSearchController.text.trim().toLowerCase();
    final radiusMiles = _radiusMiles();
    final center = _activeSearchCenter();

    final filtered = entries.where((entry) {
      final matchesDishQuery =
          dishQuery.isEmpty ||
          _matchesSearchText(entry.dish.name, dishQuery) ||
          _matchesSearchText(entry.restaurant.name, dishQuery) ||
          _matchesCategorySearch(entry.dish.category, dishQuery);

      if (!matchesDishQuery) {
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

  bool _matchesSearchText(String source, String query) {
    final normalizedSource = _normalizeSearchText(source);
    final normalizedQuery = _normalizeSearchText(query);
    if (normalizedQuery.isEmpty) {
      return true;
    }
    if (normalizedSource.contains(normalizedQuery)) {
      return true;
    }

    final sourceTerms = _searchTerms(normalizedSource);
    final queryTerms = _searchTerms(normalizedQuery);
    return queryTerms.any(sourceTerms.contains);
  }

  bool _matchesCategorySearch(String? category, String query) {
    final normalizedCategory = _normalizeSearchText(category ?? '');
    final normalizedQuery = _normalizeSearchText(query);
    if (normalizedQuery.isEmpty) {
      return true;
    }
    if (normalizedCategory.isEmpty) {
      return false;
    }
    return normalizedCategory == normalizedQuery ||
        '${normalizedCategory}s' == normalizedQuery ||
        '${normalizedQuery}s' == normalizedCategory;
  }

  Set<String> _searchTerms(String value) {
    final terms = <String>{};
    final normalized = _normalizeSearchText(value);
    if (normalized.isNotEmpty) {
      terms.add(normalized);
    }
    for (final token in normalized.split(' ')) {
      if (token.isEmpty) {
        continue;
      }
      terms.add(token);
      terms.add(_singularSearchTerm(token));
    }
    return terms;
  }

  String _normalizeSearchText(String value) {
    return value
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), ' ')
        .trim();
  }

  String _singularSearchTerm(String value) {
    if (value.length > 3 && value.endsWith('ies')) {
      return '${value.substring(0, value.length - 3)}y';
    }
    if (value.length > 3 && value.endsWith('es')) {
      return value.substring(0, value.length - 2);
    }
    if (value.length > 2 && value.endsWith('s')) {
      return value.substring(0, value.length - 1);
    }
    return value;
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
                contentPadding: const EdgeInsets.fromLTRB(12, 13, 156, 13),
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

  ButtonStyle _bitescoreActionButtonStyle() {
    return BiteRaterTheme.filledButtonStyle();
  }

  Widget _buildBiteScoreActionButton({
    required String label,
    required VoidCallback? onPressed,
    List<Color>? gradientColors,
    BoxDecoration? decoration,
    ButtonStyle? style,
    bool fullWidth = false,
  }) {
    return DecoratedBox(
      decoration:
          decoration ??
          BoxDecoration(
            gradient: gradientColors == null
                ? BiteRaterTheme.brandGradient
                : LinearGradient(
                    begin: Alignment.centerLeft,
                    end: Alignment.centerRight,
                    colors: gradientColors,
                  ),
            borderRadius: BorderRadius.circular(16),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFFC62828).withOpacity(0.18),
                blurRadius: 14,
                offset: const Offset(0, 6),
              ),
            ],
          ),
      child: ElevatedButton(
        onPressed: onPressed,
        style: style ?? _bitescoreActionButtonStyle(),
        child: Container(
          width: fullWidth ? double.infinity : null,
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
          child: Text(label),
        ),
      ),
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

  Widget _buildLocationActionRow({
    double minHeight = 52,
    bool showRefresh = true,
  }) {
    final borderRadius = BorderRadius.circular(16);
    final sharedActionButtonStyle = ElevatedButton.styleFrom(
      backgroundColor: BiteRaterTheme.cardSurface,
      foregroundColor: Theme.of(context).colorScheme.primary,
      elevation: 1,
      shadowColor: Theme.of(context).colorScheme.shadow.withOpacity(0.20),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      shape: RoundedRectangleBorder(
        borderRadius: borderRadius,
        side: BorderSide(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
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
            if (showRefresh) ...[
              const SizedBox(width: 10),
              SizedBox(
                height: minHeight,
                child: ElevatedButton(
                  onPressed: isGettingLocation ? null : _useMyLocation,
                  style: sharedActionButtonStyle.copyWith(
                    minimumSize: const WidgetStatePropertyAll(Size(88, 0)),
                    padding: const WidgetStatePropertyAll(
                      EdgeInsets.symmetric(horizontal: 12),
                    ),
                  ),
                  child: const Text('Refresh'),
                ),
              ),
            ],
          ],
        ),
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
            color: const Color(0xFFFDFDFC),
            boxShadow: const [
              BoxShadow(
                color: Color(0x10000000),
                blurRadius: 0,
                spreadRadius: 1,
              ),
              BoxShadow(
                color: Color(0x1E0F172A),
                blurRadius: 20,
                offset: Offset(0, 8),
              ),
              BoxShadow(
                color: Color(0x100F172A),
                blurRadius: 6,
                offset: Offset(0, 2),
              ),
            ],
          ),
          child: BiteRaterTheme.liftedCard(
            radius: 20,
            borderColor: BiteRaterTheme.coral.withOpacity(0.28),
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
                                    hintText: 'Enter city or ZIP code',
                                    prefixIcon: Icons.search,
                                    onSearch: _searchLocation,
                                    showArrowIcon: false,
                                  ),
                                  const SizedBox(height: 4),
                                  _buildLocationActionRow(minHeight: 40),
                                  const SizedBox(height: 4),
                                  Row(
                                    children: [
                                      Expanded(
                                        child: DropdownButtonFormField<String>(
                                          initialValue: selectedRadius,
                                          isExpanded: true,
                                          decoration: _inputDecoration(
                                            hintText: 'Radius',
                                          ),
                                          items: const [
                                            DropdownMenuItem(
                                              value: '1 mile',
                                              child: Text('1 mile'),
                                            ),
                                            DropdownMenuItem(
                                              value: '5 miles',
                                              child: Text('5 miles'),
                                            ),
                                            DropdownMenuItem(
                                              value: '10 miles',
                                              child: Text('10 miles'),
                                            ),
                                            DropdownMenuItem(
                                              value: '15 miles',
                                              child: Text('15 miles'),
                                            ),
                                            DropdownMenuItem(
                                              value: '25 miles',
                                              child: Text('25 miles'),
                                            ),
                                            DropdownMenuItem(
                                              value: '30 miles',
                                              child: Text('30 miles'),
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
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: DropdownButtonFormField<String>(
                                          initialValue: _normalizeSortOption(
                                            selectedSort,
                                          ),
                                          isExpanded: true,
                                          decoration: _inputDecoration(
                                            hintText: 'Sort',
                                          ),
                                          selectedItemBuilder: (context) =>
                                              const [
                                                Text(
                                                  'BiteScore',
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                ),
                                                Text(
                                                  'Reviews',
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                ),
                                                Text(
                                                  'Closest',
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                ),
                                                Text(
                                                  'Value',
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                ),
                                                Text(
                                                  'Flavor',
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                ),
                                                Text(
                                                  'Quality',
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                ),
                                                Text(
                                                  'Enjoyed',
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                ),
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
                                            DropdownMenuItem(
                                              value: 'Closest',
                                              child: Text('Closest'),
                                            ),
                                            DropdownMenuItem(
                                              value: 'Best Value',
                                              child: Text('Best Value'),
                                            ),
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
                                                selectedSort =
                                                    _normalizeSortOption(value);
                                              });
                                            }
                                          },
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 4),
                                  SizedBox(
                                    width: double.infinity,
                                    child: _buildBiteScoreActionButton(
                                      label: 'Create and Rate',
                                      onPressed: _openCreateAndRate,
                                      fullWidth: true,
                                      style: BiteRaterTheme.filledButtonStyle()
                                          .copyWith(
                                            textStyle:
                                                const WidgetStatePropertyAll(
                                                  TextStyle(
                                                    fontSize: 16,
                                                    fontWeight: FontWeight.w600,
                                                    letterSpacing: 0.2,
                                                  ),
                                                ),
                                          ),
                                      decoration: BoxDecoration(
                                        gradient: const LinearGradient(
                                          begin: Alignment.centerLeft,
                                          end: Alignment.centerRight,
                                          colors: [
                                            Color(0xFF6C88B8),
                                            Color(0xFF7082B2),
                                            Color(0xFF767AA9),
                                          ],
                                        ),
                                        borderRadius: BorderRadius.circular(16),
                                        border: Border.all(
                                          color: BiteRaterTheme.ocean
                                              .withOpacity(0.14),
                                          width: 1,
                                        ),
                                        boxShadow: [
                                          BoxShadow(
                                            color: BiteRaterTheme.ocean
                                                .withOpacity(0.10),
                                            blurRadius: 7,
                                            offset: const Offset(0, 2),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                ],
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

  Widget _buildEntryCard(
    BiteScoreHomeEntry entry,
    List<BiteScoreHomeEntry> entries,
  ) {
    final scoreLabel = entry.aggregate.overallBiteScore > 0
        ? entry.aggregate.overallBiteScore.toStringAsFixed(0)
        : '--';
    final category = entry.dish.category?.trim() ?? '';
    final restaurantEntries = entries
        .where((item) => item.restaurant.id == entry.restaurant.id)
        .toList();

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BiteRaterTheme.liftedCardOuterDecoration(radius: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          BiteRaterTheme.pressableSection(
            onTap: () => _openDishDetail(entry),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
            border: const Border(
              top: BorderSide(color: BiteRaterTheme.lineBlue),
              left: BorderSide(color: BiteRaterTheme.lineBlue),
              right: BorderSide(color: BiteRaterTheme.lineBlue),
            ),
            pressedScale: 0.965,
            pressedColor: const Color(0xFFF4F8FD),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 9,
                        ),
                        decoration: BoxDecoration(
                          gradient: BiteRaterTheme.softHeroGradient,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                            color: BiteRaterTheme.lineBlue.withOpacity(0.55),
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.white.withOpacity(0.75),
                              blurRadius: 0,
                              offset: const Offset(0, -1),
                            ),
                            BoxShadow(
                              color: const Color(0xFF6F6F6A).withOpacity(0.06),
                              blurRadius: 8,
                              offset: const Offset(0, 3),
                            ),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              entry.dish.name,
                              style: const TextStyle(
                                color: BiteRaterTheme.ink,
                                fontSize: 19,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 0.0,
                                height: 1.08,
                              ),
                            ),
                            if (category.isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Text(
                                category,
                                style: TextStyle(
                                  color: BiteRaterTheme.mutedInk.withValues(
                                    alpha: 0.88,
                                  ),
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                  height: 1.0,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  SizedBox(
                    width: 76,
                    child: Align(
                      alignment: Alignment.center,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          Text(
                            scoreLabel,
                            style: const TextStyle(
                              fontSize: 31,
                              fontWeight: FontWeight.w900,
                              height: 0.94,
                              color: BiteRaterTheme.scoreFlame,
                            ),
                          ),
                          Text(
                            'BiteScore',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 8.5,
                              fontWeight: FontWeight.w600,
                              letterSpacing: 0.12,
                              color: BiteRaterTheme.mutedInk.withOpacity(0.82),
                              height: 1.0,
                            ),
                          ),
                          Text(
                            '(${entry.aggregate.ratingCount})',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 9,
                              color: BiteRaterTheme.mutedInk.withOpacity(0.78),
                              fontWeight: FontWeight.w500,
                              height: 1.0,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          Container(
            height: 0.5,
            margin: const EdgeInsets.symmetric(horizontal: 18),
            color: BiteRaterTheme.lineBlue.withOpacity(0.35),
          ),
          BiteRaterTheme.pressableSection(
            onTap: () => _openRestaurantPage(
              restaurant: entry.restaurant,
              entries: restaurantEntries,
            ),
            borderRadius: const BorderRadius.vertical(
              bottom: Radius.circular(20),
            ),
            border: const Border(
              left: BorderSide(color: BiteRaterTheme.lineBlue),
              right: BorderSide(color: BiteRaterTheme.lineBlue),
              bottom: BorderSide(color: BiteRaterTheme.lineBlue),
            ),
            pressedScale: 0.99,
            pressedColor: const Color(0xFFFCFDFE),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          entry.restaurant.name,
                          style: TextStyle(
                            color: BiteRaterTheme.restaurantTitle.withOpacity(
                              0.96,
                            ),
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            height: 1.12,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${entry.restaurant.city} · ${_distanceLabel(entry)}',
                          style: TextStyle(
                            color: BiteRaterTheme.mutedInk.withOpacity(0.92),
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                            height: 1.15,
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
                      _buildLocationActionRow(showRefresh: false),
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
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
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
