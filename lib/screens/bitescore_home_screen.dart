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
  static const double _expandedHeaderExtent = 392;
  static const String _selectedRadiusPreferenceKey = 'selected_radius';

  final TextEditingController dishSearchController = TextEditingController();
  final TextEditingController locationSearchController =
      TextEditingController();
  final FocusNode _locationSearchFocusNode = FocusNode();
  final ScrollController _listScrollController = ScrollController();

  String selectedRadius = '15 miles';
  String selectedSort = 'Top Rated';
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

    return '${distanceMiles.toStringAsFixed(1)} miles away';
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
          entry.dish.name.toLowerCase().contains(dishQuery) ||
          entry.restaurant.name.toLowerCase().contains(dishQuery);

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

    filtered.sort((a, b) {
      switch (selectedSort) {
        case 'Closest':
          final aDistance = _distanceMilesFor(a) ?? double.infinity;
          final bDistance = _distanceMilesFor(b) ?? double.infinity;
          final byDistance = aDistance.compareTo(bDistance);
          if (byDistance != 0) {
            return byDistance;
          }
          return a.dish.name.toLowerCase().compareTo(b.dish.name.toLowerCase());
        case 'Most Reviewed':
          final byCount = b.aggregate.ratingCount.compareTo(
            a.aggregate.ratingCount,
          );
          if (byCount != 0) {
            return byCount;
          }
          return b.aggregate.overallBiteScore.compareTo(
            a.aggregate.overallBiteScore,
          );
        case 'Top Rated':
        default:
          final byScore = b.aggregate.overallBiteScore.compareTo(
            a.aggregate.overallBiteScore,
          );
          if (byScore != 0) {
            return byScore;
          }
          return b.aggregate.ratingCount.compareTo(a.aggregate.ratingCount);
      }
    });

    return filtered;
  }

  InputDecoration _inputDecoration({
    required String hintText,
    IconData? prefixIcon,
  }) {
    return InputDecoration(
      hintText: hintText,
      filled: true,
      fillColor: Colors.white,
      isDense: true,
      prefixIcon: prefixIcon == null
          ? null
          : Icon(prefixIcon, color: BiteRaterTheme.ocean.withOpacity(0.85)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: BiteRaterTheme.lineBlue),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(
          color: BiteRaterTheme.ocean.withOpacity(0.55),
          width: 1.4,
        ),
      ),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
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
                contentPadding: const EdgeInsets.fromLTRB(12, 14, 156, 14),
              ),
        ),
        Positioned(
          top: 1,
          right: 1,
          bottom: 1,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: BiteRaterTheme.softSearchBlue,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: BiteRaterTheme.ocean.withOpacity(0.10)),
              boxShadow: [
                BoxShadow(
                  color: BiteRaterTheme.ocean.withOpacity(0.05),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: onSearch,
                borderRadius: BorderRadius.circular(14),
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

  ButtonStyle _chromeActionButtonStyle() {
    return ElevatedButton.styleFrom(
      foregroundColor: const Color(0xFF20201E),
      backgroundColor: Colors.transparent,
      shadowColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      minimumSize: const Size.fromHeight(48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      padding: EdgeInsets.zero,
      textStyle: const TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w800,
        letterSpacing: 0.2,
      ),
    );
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

  Future<void> _collapseHeader() async {
    if (!_listScrollController.hasClients) {
      return;
    }
    final targetOffset = (_expandedHeaderExtent - _collapsedHeaderExtent).clamp(
      _listScrollController.position.minScrollExtent,
      _listScrollController.position.maxScrollExtent,
    );
    await _listScrollController.animateTo(
      targetOffset,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
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
      backgroundColor: Theme.of(context).colorScheme.surfaceContainerLowest,
      foregroundColor: Theme.of(context).colorScheme.primary,
      elevation: 1,
      shadowColor: Theme.of(context).colorScheme.shadow.withOpacity(0.20),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      shape: RoundedRectangleBorder(
        borderRadius: borderRadius,
        side: BorderSide(color: Theme.of(context).colorScheme.outlineVariant),
      ),
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
                    minimumSize: const WidgetStatePropertyAll(Size(110, 0)),
                    padding: const WidgetStatePropertyAll(
                      EdgeInsets.symmetric(horizontal: 18),
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
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: BiteRaterTheme.liftedCard(
          radius: 20,
          borderColor: BiteRaterTheme.coral.withOpacity(0.22),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (collapsed)
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      InkWell(
                        borderRadius: BorderRadius.circular(12),
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
                                ),
                                const SizedBox(height: 12),
                                _buildSearchField(
                                  controller: locationSearchController,
                                  focusNode: _locationSearchFocusNode,
                                  hintText: 'Enter city or ZIP code',
                                  prefixIcon: Icons.search,
                                  onSearch: _searchLocation,
                                  showArrowIcon: false,
                                ),
                                const SizedBox(height: 12),
                                _buildLocationActionRow(minHeight: 40),
                                const SizedBox(height: 12),
                                DropdownButtonFormField<String>(
                                  initialValue: selectedRadius,
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
                                const SizedBox(height: 12),
                                DropdownButtonFormField<String>(
                                  initialValue: selectedSort,
                                  decoration: _inputDecoration(
                                    hintText: 'Sort',
                                  ),
                                  items: const [
                                    DropdownMenuItem(
                                      value: 'Top Rated',
                                      child: Text('Top Rated'),
                                    ),
                                    DropdownMenuItem(
                                      value: 'Most Reviewed',
                                      child: Text('Most Reviewed'),
                                    ),
                                    DropdownMenuItem(
                                      value: 'Closest',
                                      child: Text('Closest'),
                                    ),
                                  ],
                                  onChanged: (value) {
                                    if (value != null) {
                                      setState(() {
                                        selectedSort = value;
                                      });
                                    }
                                  },
                                ),
                                const SizedBox(height: 8),
                                SizedBox(
                                  width: double.infinity,
                                  child: _buildBiteScoreActionButton(
                                    label: 'Create and Rate',
                                    onPressed: _openCreateAndRate,
                                    fullWidth: true,
                                    style: _chromeActionButtonStyle(),
                                    decoration: BoxDecoration(
                                      gradient: const LinearGradient(
                                        begin: Alignment.topLeft,
                                        end: Alignment.bottomRight,
                                        colors: [
                                          Color(0xFFF8F8F6),
                                          Color(0xFFE1E1DC),
                                          Color(0xFFB8B8B1),
                                          Color(0xFFEAEAE5),
                                          Color(0xFF8F8F89),
                                        ],
                                        stops: [0.0, 0.18, 0.44, 0.68, 1.0],
                                      ),
                                      borderRadius: BorderRadius.circular(16),
                                      border: Border.all(
                                        color: const Color(
                                          0xFFFDFDFB,
                                        ).withOpacity(0.95),
                                        width: 1.2,
                                      ),
                                      boxShadow: [
                                        BoxShadow(
                                          color: Colors.white.withOpacity(0.75),
                                          blurRadius: 0,
                                          offset: const Offset(0, -1),
                                        ),
                                        BoxShadow(
                                          color: const Color(
                                            0xFF6C6C67,
                                          ).withOpacity(0.28),
                                          blurRadius: 16,
                                          offset: const Offset(0, 8),
                                        ),
                                        BoxShadow(
                                          color: const Color(
                                            0xFFFFFFFF,
                                          ).withOpacity(0.38),
                                          blurRadius: 12,
                                          offset: const Offset(-4, -4),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 0),
                              ],
                            ),
                            Positioned(
                              top: -6,
                              right: -6,
                              child: IconButton(
                                onPressed: _collapseHeader,
                                icon: const Icon(Icons.keyboard_arrow_up),
                                tooltip: 'Collapse filters',
                                visualDensity: VisualDensity.compact,
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

  Future<void> _openExistingDishReview(BiteScoreHomeEntry entry) async {
    final canWrite = await BiteScoreSignInGate.ensureSignedInForWrite(context);
    if (!canWrite || !mounted) {
      return;
    }

    final refreshed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => BiteScoreCreateRateScreen(existingEntry: entry),
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
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 18, 18, 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 12,
                      ),
                      decoration: BoxDecoration(
                        gradient: BiteRaterTheme.softHeroGradient,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: BiteRaterTheme.peach.withOpacity(0.26),
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.white.withOpacity(0.75),
                            blurRadius: 0,
                            offset: const Offset(0, -1),
                          ),
                          BoxShadow(
                            color: const Color(0xFF6F6F6A).withOpacity(0.08),
                            blurRadius: 10,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: Text(
                        entry.dish.name,
                        style: const TextStyle(
                          color: BiteRaterTheme.ink,
                          fontSize: 19,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 0.1,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        scoreLabel,
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w900,
                          height: 1.0,
                          color: BiteRaterTheme.scoreFlame,
                        ),
                      ),
                      const SizedBox(height: 2),
                      const Text(
                        'BiteScore',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.2,
                          color: BiteRaterTheme.scoreFlame,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${entry.aggregate.ratingCount} ratings',
                        style: const TextStyle(
                          fontSize: 12,
                          color: BiteRaterTheme.mutedInk,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          Container(
            height: 1,
            margin: const EdgeInsets.symmetric(horizontal: 18),
            color: BiteRaterTheme.lineBlue.withOpacity(0.75),
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
            pressedScale: 0.98,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 12, 18, 18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    entry.restaurant.name,
                    style: const TextStyle(
                      color: BiteRaterTheme.ocean,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${entry.restaurant.city}, ${entry.restaurant.zipCode}',
                    style: const TextStyle(
                      color: BiteRaterTheme.mutedInk,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _distanceLabel(entry),
                    style: const TextStyle(
                      color: BiteRaterTheme.mutedInk,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      OutlinedButton(
                        onPressed: () => _openExistingDishReview(entry),
                        style: BiteRaterTheme.outlinedButtonStyle(
                          accentColor: BiteRaterTheme.coral,
                        ),
                        child: const Text('Rate & Review'),
                      ),
                      const SizedBox(width: 12),
                      const Icon(Icons.chevron_right),
                    ],
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
      body: CustomScrollView(
        controller: _listScrollController,
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
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 16),
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
