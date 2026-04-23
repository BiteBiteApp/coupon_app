import 'dart:async';
import 'dart:io' show Platform;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/coupon.dart';
import '../models/demo_redemption_store.dart';
import '../models/restaurant.dart';
import '../services/app_mode_state_service.dart';
import '../services/app_error_text.dart';
import '../services/restaurant_account_service.dart';
import '../services/shared_location_state_service.dart';
import 'coupon_detail_screen.dart';
import 'restaurant_profile_screen.dart';

class SearchCenter {
  final double latitude;
  final double longitude;
  final String label;

  const SearchCenter({
    required this.latitude,
    required this.longitude,
    required this.label,
  });
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  static const double _collapsedHeaderExtent = 90;
  static const double _expandedHeaderExtent = 340;
  static const String _selectedRadiusPreferenceKey = 'selected_radius';

  String selectedRadius = '15 miles';
  String searchQuery = '';
  final TextEditingController searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();
  String generalSearchQuery = '';
  final TextEditingController generalSearchController = TextEditingController();
  final ScrollController _listScrollController = ScrollController();

  bool usingCurrentLocation = false;
  bool usingTypedSearchLocation = false;
  bool isGettingLocation = false;
  bool isSearchingLocation = false;

  String? detectedCity;
  String? detectedZip;
  String? locationStatusMessage;
  Position? currentPosition;
  SearchCenter? typedSearchCenter;

  final Set<String> _knownCouponIds = {};
  bool _hasInitializedKnownCoupons = false;
  String? _lastNewCouponNotificationKey;

  final Set<String> _notifiedUnlockedCouponIds = {};
  StreamSubscription<Position>? _positionStreamSubscription;
  List<Restaurant> _restaurants = const <Restaurant>[];
  bool _isRestaurantsLoading = true;
  Object? _restaurantsError;
  String _approvedAccountsSignature = '';

  final List<Restaurant> sampleRestaurants = const [
    Restaurant(
      name: 'Joe\'s Pizza',
      distance: '0.4 miles away',
      city: 'Lecanto',
      zipCode: '34461',
      latitude: 28.8517,
      longitude: -82.4870,
      streetAddress: '123 Main St',
      phone: '(352) 555-1111',
      website: 'https://joespizza.com',
      bio: 'A local favorite serving pizza, knots, and family specials.',
      coupons: [
        Coupon(
          id: 'joes_pizza_1',
          restaurant: 'Joe\'s Pizza',
          title: '50% Off Any Large Pizza',
          distance: '0.4 miles away',
          expires: 'Expires today',
          usageRule: 'Once per customer',
          couponCode: 'JOE50',
        ),
        Coupon(
          id: 'joes_pizza_2',
          restaurant: 'Joe\'s Pizza',
          title: 'Free Garlic Knots with Any Large Pizza',
          distance: '0.4 miles away',
          expires: 'Expires tomorrow',
          usageRule: 'Once per day',
          isProximityOnly: true,
          proximityRadiusMiles: 1,
        ),
      ],
    ),
    Restaurant(
      name: 'Burger Barn',
      distance: '1.1 miles away',
      city: 'Lecanto',
      zipCode: '34461',
      latitude: 28.8582,
      longitude: -82.4584,
      streetAddress: '456 Market Ave',
      phone: '(352) 555-2222',
      website: 'https://burgerbarn.com',
      bio: 'Classic burgers, fries, and shakes in a casual setting.',
      coupons: [
        Coupon(
          id: 'burger_barn_1',
          restaurant: 'Burger Barn',
          title: 'Free Fries with Any Combo',
          distance: '1.1 miles away',
          expires: 'Expires in 2 days',
          usageRule: 'Once per customer',
          couponCode: 'FRIESFREE',
        ),
      ],
    ),
    Restaurant(
      name: 'Sushi Wave',
      distance: '2.3 miles away',
      city: 'Inverness',
      zipCode: '34450',
      latitude: 28.8358,
      longitude: -82.3306,
      streetAddress: '88 Lakeview Dr',
      phone: '(352) 555-3333',
      website: 'https://sushiwave.com',
      bio: 'Fresh sushi, soups, and rolls with modern flavors.',
      coupons: [
        Coupon(
          id: 'sushi_wave_1',
          restaurant: 'Sushi Wave',
          title: 'Buy 1 Roll, Get 1 Half Off',
          distance: '2.3 miles away',
          expires: 'Expires this weekend',
          usageRule: 'Once per day',
          isProximityOnly: true,
          proximityRadiusMiles: 3,
        ),
        Coupon(
          id: 'sushi_wave_2',
          restaurant: 'Sushi Wave',
          title: 'Free Miso Soup with Entree',
          distance: '2.3 miles away',
          expires: 'Expires Friday',
          usageRule: 'Unlimited',
          couponCode: 'MISOFREE',
        ),
      ],
    ),
    Restaurant(
      name: 'Taco Town',
      distance: '4.8 miles away',
      city: 'Crystal River',
      zipCode: '34429',
      latitude: 28.9025,
      longitude: -82.5926,
      streetAddress: '900 Citrus Blvd',
      phone: '(352) 555-4444',
      website: 'https://tacotown.com',
      bio: 'Quick tacos, burritos, and drinks for lunch and dinner.',
      coupons: [
        Coupon(
          id: 'taco_town_1',
          restaurant: 'Taco Town',
          title: 'Free Drink with 2 Tacos',
          distance: '4.8 miles away',
          expires: 'Expires tonight',
          usageRule: 'Once per day',
          isProximityOnly: true,
          proximityRadiusMiles: 5,
        ),
      ],
    ),
    Restaurant(
      name: 'Pasta Place',
      distance: '7.2 miles away',
      city: 'Ocala',
      zipCode: '34471',
      latitude: 29.1872,
      longitude: -82.1401,
      streetAddress: '17 Central Pkwy',
      phone: '(352) 555-5555',
      website: 'https://pastaplace.com',
      bio: 'Comfort pasta dishes and family meals made fresh daily.',
      coupons: [
        Coupon(
          id: 'pasta_place_1',
          restaurant: 'Pasta Place',
          title: '20% Off Any Pasta Dish',
          distance: '7.2 miles away',
          expires: 'Expires tomorrow',
          usageRule: 'Once per customer',
          couponCode: 'PASTA20',
        ),
      ],
    ),
    Restaurant(
      name: 'Coastal Cafe',
      distance: '12.4 miles away',
      city: 'Homosassa',
      zipCode: '34446',
      latitude: 28.7997,
      longitude: -82.5768,
      streetAddress: '72 Gulf Rd',
      phone: '(352) 555-6666',
      website: 'https://coastalcafe.com',
      bio: 'Breakfast, coffee, and fresh pastries near the water.',
      coupons: [
        Coupon(
          id: 'coastal_cafe_1',
          restaurant: 'Coastal Cafe',
          title: 'Free Coffee with Breakfast',
          distance: '12.4 miles away',
          expires: 'Expires Sunday',
          usageRule: 'Once per day',
          isProximityOnly: true,
          proximityRadiusMiles: 10,
        ),
      ],
    ),
    Restaurant(
      name: 'BBQ Junction',
      distance: '18.7 miles away',
      city: 'Spring Hill',
      zipCode: '34606',
      latitude: 28.4769,
      longitude: -82.5255,
      streetAddress: '510 Smokehouse Ln',
      phone: '(352) 555-7777',
      website: 'https://bbqjunction.com',
      bio: 'Slow-smoked meats, platters, and family-size meals.',
      coupons: [
        Coupon(
          id: 'bbq_junction_1',
          restaurant: 'BBQ Junction',
          title: '25% Off Family Meal',
          distance: '18.7 miles away',
          expires: 'Expires this weekend',
          usageRule: 'Once per customer',
          couponCode: 'BBQ25',
        ),
      ],
    ),
    Restaurant(
      name: 'Sunset Seafood',
      distance: '27.5 miles away',
      city: 'Brooksville',
      zipCode: '34601',
      latitude: 28.5553,
      longitude: -82.3882,
      streetAddress: '14 Harbor View',
      phone: '(352) 555-8888',
      website: 'https://sunsetseafood.com',
      bio: 'Seafood dinners, desserts, and sunset patio seating.',
      coupons: [
        Coupon(
          id: 'sunset_seafood_1',
          restaurant: 'Sunset Seafood',
          title: 'Free Dessert with Dinner',
          distance: '27.5 miles away',
          expires: 'Expires Friday',
          usageRule: 'Unlimited',
        ),
      ],
    ),
  ];

  @override
  void initState() {
    super.initState();
    DemoRedemptionStore.ensureInitialized();
    _loadSelectedRadius();
    _restoreSharedLocationState();
    _loadRestaurants();
    _restorePersistedLocationPreference();
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

  void _restoreSharedLocationState() {
    final sharedLocation = SharedLocationStateService.state;
    searchController.text = sharedLocation.searchText;
    searchQuery = sharedLocation.searchText;
    usingCurrentLocation = sharedLocation.usingCurrentLocation;
    currentPosition = sharedLocation.currentPosition;
    detectedCity = sharedLocation.detectedCity;
    detectedZip = sharedLocation.detectedZip;
    usingTypedSearchLocation = sharedLocation.usingTypedSearchLocation;
    typedSearchCenter =
        sharedLocation.usingTypedSearchLocation &&
            sharedLocation.typedLatitude != null &&
            sharedLocation.typedLongitude != null
        ? SearchCenter(
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
      reverseLookupLocation: reverseLookupLocation,
    );

    if (!mounted) {
      return;
    }

    setState(() {
      _restoreSharedLocationState();
      locationStatusMessage = result.message;
    });
  }

  Future<void> _loadRestaurants() async {
    final shouldShowLoading = _restaurants.isEmpty;

    if (mounted) {
      setState(() {
        _restaurantsError = null;
        if (shouldShowLoading) {
          _isRestaurantsLoading = true;
        }
      });
    }

    try {
      final restaurants =
          await RestaurantAccountService.loadApprovedRestaurantsWithCoupons();
      if (!mounted) {
        return;
      }
      setState(() {
        _restaurants = restaurants;
        _restaurantsError = null;
        _isRestaurantsLoading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _restaurantsError = error;
        _isRestaurantsLoading = false;
      });
    }
  }

  String _buildApprovedAccountsSignature(
    QuerySnapshot<Map<String, dynamic>>? snapshot,
  ) {
    if (snapshot == null) {
      return '';
    }

    return snapshot.docs
        .map((doc) {
          final data = doc.data();
          return '${doc.id}|${data[Restaurant.fieldApprovalStatus] ?? ''}|${data[Restaurant.fieldUpdatedAt] ?? ''}';
        })
        .join('||');
  }

  @override
  void dispose() {
    _positionStreamSubscription?.cancel();
    _listScrollController.dispose();
    generalSearchController.dispose();
    _searchFocusNode.dispose();
    searchController.dispose();
    super.dispose();
  }

  bool get _hasLocationOrZipInput {
    return usingCurrentLocation ||
        usingTypedSearchLocation ||
        searchController.text.trim().isNotEmpty ||
        searchQuery.trim().isNotEmpty;
  }

  bool get supportsReverseGeocodingOnThisPlatform {
    if (kIsWeb) return false;
    return Platform.isAndroid || Platform.isIOS;
  }

  double parseMiles(String distanceText) {
    return double.tryParse(distanceText.split(' ').first) ?? 999;
  }

  double selectedRadiusMiles() {
    switch (selectedRadius) {
      case '1 mile':
        return 1;
      case '3 miles':
        return 3;
      case '5 miles':
        return 5;
      case '10 miles':
        return 10;
      case '15 miles':
        return 15;
      case '20 miles':
        return 20;
      case '30 miles':
        return 30;
      default:
        return 5;
    }
  }

  String _nextRadiusOption() {
    switch (selectedRadius) {
      case '1 mile':
        return '3 miles';
      case '3 miles':
        return '5 miles';
      case '5 miles':
        return '10 miles';
      case '10 miles':
        return '15 miles';
      case '15 miles':
        return '20 miles';
      case '20 miles':
        return '30 miles';
      case '30 miles':
      default:
        return '30 miles';
    }
  }

  SearchCenter? get activeSearchCenter {
    if (usingCurrentLocation && currentPosition != null) {
      return SearchCenter(
        latitude: currentPosition!.latitude,
        longitude: currentPosition!.longitude,
        label: 'Current location',
      );
    }

    if (usingTypedSearchLocation && typedSearchCenter != null) {
      return typedSearchCenter;
    }

    return null;
  }

  double restaurantDistanceMiles(Restaurant restaurant) {
    final center = activeSearchCenter;

    if (center != null &&
        restaurant.latitude != null &&
        restaurant.longitude != null) {
      final meters = Geolocator.distanceBetween(
        center.latitude,
        center.longitude,
        restaurant.latitude!,
        restaurant.longitude!,
      );
      return meters / 1609.344;
    }

    return double.infinity;
  }

  String restaurantDistanceLabel(Restaurant restaurant) {
    final miles = restaurantDistanceMiles(restaurant);
    return '${miles.toStringAsFixed(1)} miles away';
  }

  bool isProximityCoupon(Coupon coupon) {
    return coupon.isProximityOnly;
  }

  bool isProximityUnlocked(Coupon coupon, Restaurant restaurant) {
    if (!isProximityCoupon(coupon)) return true;
    if (!usingCurrentLocation) return false;
    if (restaurant.latitude == null || restaurant.longitude == null) {
      return false;
    }

    final distance = restaurantDistanceMiles(restaurant);
    final unlockRadius = coupon.proximityRadiusMiles ?? 0;
    return distance <= unlockRadius;
  }

  List<Restaurant> mergeRestaurants({
    required List<Restaurant> firestoreRestaurants,
    required List<Restaurant> sampleRestaurants,
  }) {
    return firestoreRestaurants;
  }

  Set<String> collectCouponIds(List<Restaurant> restaurants) {
    final now = DateTime.now();

    return restaurants
        .expand((restaurant) => restaurant.coupons)
        .where((coupon) => coupon.isActiveAt(now))
        .map((coupon) => coupon.id)
        .toSet();
  }

  void detectAndShowNewCouponNotifications(List<Restaurant> restaurants) {
    final currentCouponIds = collectCouponIds(restaurants);

    if (!_hasInitializedKnownCoupons) {
      _knownCouponIds
        ..clear()
        ..addAll(currentCouponIds);
      _hasInitializedKnownCoupons = true;
      return;
    }

    final newCouponIds = currentCouponIds.difference(_knownCouponIds);

    if (newCouponIds.isNotEmpty) {
      final newCoupons = restaurants
          .expand((restaurant) => restaurant.coupons)
          .where((coupon) => newCouponIds.contains(coupon.id))
          .toList();

      if (newCoupons.isNotEmpty) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          showNewCouponsSnackBar(newCoupons);
        });
      }
    }

    _knownCouponIds
      ..clear()
      ..addAll(currentCouponIds);
  }

  void showNewCouponsSnackBar(List<Coupon> newCoupons) {
    if (!mounted || newCoupons.isEmpty) return;

    final notificationKey = newCoupons.map((c) => c.id).join('|');
    if (_lastNewCouponNotificationKey == notificationKey) return;
    _lastNewCouponNotificationKey = notificationKey;

    final message = newCoupons.length == 1
        ? 'New coupon added: ${newCoupons.first.title}'
        : '${newCoupons.length} new coupons just became available.';

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
      );
  }

  Future<void> runSearch(List<Restaurant> allRestaurants) async {
    final query = searchController.text.trim();

    if (query.isEmpty) {
      clearSearch();
      return;
    }

    await runSearchFromText(
      allRestaurants,
      query: query,
      showNoResultsSnackBar: true,
    );
  }

  Future<void> runSearchFromText(
    List<Restaurant> allRestaurants, {
    required String query,
    required bool showNoResultsSnackBar,
  }) async {
    setState(() {
      isSearchingLocation = true;
      locationStatusMessage = null;
    });

    try {
      final locations = await locationFromAddress(query);

      if (locations.isEmpty) {
        setState(() {
          isSearchingLocation = false;
          usingCurrentLocation = false;
          usingTypedSearchLocation = false;
          typedSearchCenter = null;
          searchQuery = query;
          locationStatusMessage =
              'Could not find that city or ZIP for radius search.';
        });
        return;
      }

      final first = locations.first;

      setState(() {
        isSearchingLocation = false;
        usingCurrentLocation = false;
        usingTypedSearchLocation = true;
        currentPosition = null;
        detectedCity = null;
        detectedZip = null;
        searchQuery = query;
        typedSearchCenter = SearchCenter(
          latitude: first.latitude,
          longitude: first.longitude,
          label: query,
        );
        locationStatusMessage = 'Using "$query" as your search center.';
      });
      SharedLocationStateService.saveTypedLocation(
        latitude: first.latitude,
        longitude: first.longitude,
        label: query,
        searchText: query,
      );

      if (showNoResultsSnackBar) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          final filtered = filterRestaurants(allRestaurants);
          if (filtered.isEmpty && mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('No restaurants found within that radius.'),
              ),
            );
          }
        });
      }
    } catch (_) {
      setState(() {
        isSearchingLocation = false;
        usingCurrentLocation = false;
        usingTypedSearchLocation = false;
        typedSearchCenter = null;
        searchQuery = query;
        locationStatusMessage =
            'Could not find that city or ZIP for radius search.';
      });
    }
  }

  Future<void> useMyLocation(List<Restaurant> allRestaurants) async {
    setState(() {
      isGettingLocation = true;
      locationStatusMessage = null;
    });

    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        setState(() {
          locationStatusMessage =
              'Location services are turned off on this device.';
          isGettingLocation = false;
        });
        return;
      }

      var permission = await Geolocator.checkPermission();

      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }

      if (permission == LocationPermission.denied) {
        setState(() {
          locationStatusMessage = 'Location permission was denied.';
          isGettingLocation = false;
        });
        return;
      }

      if (permission == LocationPermission.deniedForever) {
        setState(() {
          locationStatusMessage =
              'Location permission is permanently denied. Please enable it in settings.';
          isGettingLocation = false;
        });
        return;
      }

      final position = await Geolocator.getCurrentPosition();
      final locationDetails = await reverseLookupLocation(position);

      final newlyUnlocked = collectNewlyUnlockedCouponsForPosition(
        allRestaurants,
        position,
      );

      setState(() {
        usingCurrentLocation = true;
        usingTypedSearchLocation = false;
        typedSearchCenter = null;
        isGettingLocation = false;
        detectedCity = locationDetails.city;
        detectedZip = locationDetails.zip;
        currentPosition = position;
        searchQuery = locationDetails.city?.isNotEmpty == true
            ? locationDetails.city!
            : (locationDetails.zip?.isNotEmpty == true
                  ? locationDetails.zip!
                  : '');
        searchController.text = searchQuery;
        locationStatusMessage = 'Using your current location.';
      });
      SharedLocationStateService.saveCurrentLocation(
        position: position,
        searchText: searchQuery,
        detectedCity: locationDetails.city,
        detectedZip: locationDetails.zip,
      );

      if (newlyUnlocked.isNotEmpty && mounted) {
        for (final coupon in newlyUnlocked) {
          _notifiedUnlockedCouponIds.add(coupon.id);
        }

        WidgetsBinding.instance.addPostFrameCallback((_) {
          showUnlockedCouponNotification(newlyUnlocked);
        });
      }
    } catch (error) {
      setState(() {
        isGettingLocation = false;
        locationStatusMessage = AppErrorText.friendly(
          error,
          fallback: 'Could not get your location right now.',
        );
      });
    }
  }

  Future<({String? city, String? zip})> reverseLookupLocation(
    Position position,
  ) async {
    String? city;
    String? zip;

    if (supportsReverseGeocodingOnThisPlatform) {
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

  void startLiveLocationTracking(List<Restaurant> allRestaurants) {
    _positionStreamSubscription?.cancel();

    _positionStreamSubscription =
        Geolocator.getPositionStream(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.best,
            distanceFilter: 25,
          ),
        ).listen((position) async {
          if (!mounted || !usingCurrentLocation) return;

          final newlyUnlocked = collectNewlyUnlockedCouponsForPosition(
            allRestaurants,
            position,
          );

          if (!mounted) return;

          setState(() {
            currentPosition = position;
            locationStatusMessage = 'Using your current location live.';
          });

          if (newlyUnlocked.isNotEmpty) {
            for (final coupon in newlyUnlocked) {
              _notifiedUnlockedCouponIds.add(coupon.id);
            }

            WidgetsBinding.instance.addPostFrameCallback((_) {
              showUnlockedCouponNotification(newlyUnlocked);
            });
          }
        });
  }

  void stopLiveLocationTracking() {
    _positionStreamSubscription?.cancel();
    _positionStreamSubscription = null;
  }

  List<Coupon> collectNewlyUnlockedCouponsForPosition(
    List<Restaurant> allRestaurants,
    Position position,
  ) {
    final unlocked = <Coupon>[];
    final now = DateTime.now();

    for (final restaurant in allRestaurants) {
      for (final coupon in restaurant.coupons) {
        if (isProximityCoupon(coupon) &&
            coupon.isActiveAt(now) &&
            restaurant.latitude != null &&
            restaurant.longitude != null &&
            !_notifiedUnlockedCouponIds.contains(coupon.id) &&
            DemoRedemptionStore.isAvailable(coupon.id, coupon.usageRule)) {
          final distanceMeters = Geolocator.distanceBetween(
            position.latitude,
            position.longitude,
            restaurant.latitude!,
            restaurant.longitude!,
          );
          final distanceMiles = distanceMeters / 1609.344;
          final unlockRadius = coupon.proximityRadiusMiles ?? 0;

          if (distanceMiles <= unlockRadius) {
            unlocked.add(coupon);
          }
        }
      }
    }

    return unlocked;
  }

  void showUnlockedCouponNotification(List<Coupon> unlockedCoupons) {
    if (!mounted || unlockedCoupons.isEmpty) return;

    final message = unlockedCoupons.length == 1
        ? 'Nearby deal unlocked: ${unlockedCoupons.first.title}'
        : '${unlockedCoupons.length} nearby deals unlocked.';

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 4)),
      );
  }

  void clearSearch() {
    stopLiveLocationTracking();
    searchController.clear();
    SharedLocationStateService.clear();

    setState(() {
      searchQuery = '';
      usingCurrentLocation = false;
      usingTypedSearchLocation = false;
      typedSearchCenter = null;
      currentPosition = null;
      detectedCity = null;
      detectedZip = null;
      locationStatusMessage = null;
      _notifiedUnlockedCouponIds.clear();
    });
  }

  bool isExactLocationMatch(Restaurant restaurant) {
    if (!usingTypedSearchLocation) {
      return false;
    }

    final trimmedQuery = searchQuery.trim();
    final normalizedQuery = trimmedQuery.toLowerCase();
    if (normalizedQuery.isEmpty) {
      return false;
    }

    return restaurant.city.trim().toLowerCase() == normalizedQuery ||
        restaurant.zipCode.trim() == trimmedQuery;
  }

  bool matchesGeneralSearch(Restaurant restaurant, Coupon coupon) {
    final query = generalSearchQuery.trim().toLowerCase();
    if (query.isEmpty) {
      return true;
    }

    return restaurant.name.toLowerCase().contains(query) ||
        restaurant.city.toLowerCase().contains(query) ||
        restaurant.zipCode.toLowerCase().contains(query) ||
        (restaurant.bio ?? '').toLowerCase().contains(query) ||
        coupon.title.toLowerCase().contains(query) ||
        coupon.restaurant.toLowerCase().contains(query) ||
        coupon.usageRule.toLowerCase().contains(query) ||
        (coupon.couponCode ?? '').toLowerCase().contains(query);
  }

  List<Restaurant> filterRestaurants(List<Restaurant> allRestaurants) {
    final radius = selectedRadiusMiles();
    final center = activeSearchCenter;
    final now = DateTime.now();
    final results =
        <
          ({
            Restaurant restaurant,
            List<Coupon> coupons,
            bool exactMatch,
            double distanceMiles,
          })
        >[];

    for (final restaurant in allRestaurants) {
      final availableCoupons = restaurant.coupons.where((coupon) {
        if (!coupon.isActiveAt(now)) return false;

        final availableByUsage = DemoRedemptionStore.isAvailable(
          coupon.id,
          coupon.usageRule,
        );

        if (!availableByUsage) return false;

        if (isProximityCoupon(coupon) &&
            !isProximityUnlocked(coupon, restaurant)) {
          return false;
        }

        if (!matchesGeneralSearch(restaurant, coupon)) {
          return false;
        }

        return true;
      }).toList();

      if (availableCoupons.isEmpty) {
        continue;
      }

      final exactMatch = isExactLocationMatch(restaurant);
      final distanceMiles = restaurantDistanceMiles(restaurant);

      if (center != null) {
        if (!exactMatch &&
            (restaurant.latitude == null ||
                restaurant.longitude == null ||
                distanceMiles > radius)) {
          continue;
        }
      } else {
        final withinRadius = false;

        if (searchQuery.trim().isEmpty) {
          if (!withinRadius) {
            continue;
          }
        } else {
          final query = searchQuery.toLowerCase().trim();
          final matchesLocation =
              restaurant.city.toLowerCase().contains(query) ||
              restaurant.zipCode.contains(query);

          if (!withinRadius || !matchesLocation) {
            continue;
          }
        }
      }

      results.add((
        restaurant: restaurant,
        coupons: availableCoupons,
        exactMatch: exactMatch,
        distanceMiles: distanceMiles,
      ));
    }

    results.sort((a, b) {
      if (a.exactMatch != b.exactMatch) {
        return a.exactMatch ? -1 : 1;
      }

      if (a.exactMatch && b.exactMatch) {
        return a.restaurant.name.toLowerCase().compareTo(
          b.restaurant.name.toLowerCase(),
        );
      }

      final distanceComparison = a.distanceMiles.compareTo(b.distanceMiles);
      if (distanceComparison != 0) {
        return distanceComparison;
      }

      return a.restaurant.name.toLowerCase().compareTo(
        b.restaurant.name.toLowerCase(),
      );
    });

    return results.map((result) {
      return Restaurant(
        name: result.restaurant.name,
        distance: result.exactMatch
            ? 'Local'
            : restaurantDistanceLabel(result.restaurant),
        city: result.restaurant.city,
        zipCode: result.restaurant.zipCode,
        streetAddress: result.restaurant.streetAddress,
        phone: result.restaurant.phone,
        website: result.restaurant.website,
        bio: result.restaurant.bio,
        coupons: result.coupons,
        latitude: result.restaurant.latitude,
        longitude: result.restaurant.longitude,
      );
    }).toList();
  }

  int totalVisibleCoupons(List<Restaurant> restaurants) {
    return restaurants.fold(
      0,
      (total, restaurant) => total + restaurant.coupons.length,
    );
  }

  String compactStatusLine(List<Restaurant> filteredRestaurants) {
    if (!_hasLocationOrZipInput) {
      return locationStatusMessage?.trim() ?? '';
    }

    final restaurantCount = filteredRestaurants.length;
    final couponCount = totalVisibleCoupons(filteredRestaurants);
    final contentQuery = generalSearchQuery.trim();

    if (contentQuery.isNotEmpty) {
      return 'Showing "$contentQuery" \u2022 Restaurants: $restaurantCount \u2022 Coupons: $couponCount';
    }

    if (usingCurrentLocation) {
      return 'Using Live Location \u2022 Restaurants: $restaurantCount \u2022 Coupons: $couponCount';
    }

    final query = typedSearchCenter?.label ?? searchQuery.trim();
    if (query.isNotEmpty) {
      return 'Search: $query \u2022 Restaurants: $restaurantCount \u2022 Coupons: $couponCount';
    }

    if (locationStatusMessage != null && locationStatusMessage!.isNotEmpty) {
      return locationStatusMessage!;
    }

    return 'Restaurants: $restaurantCount \u2022 Coupons: $couponCount';
  }

  List<BoxShadow> _biteSaverTileShadows({
    double strength = 1,
    double opacityBoost = 0,
  }) {
    return [
      BoxShadow(
        color: const Color(0xFF493016).withOpacity(0.165 + opacityBoost),
        blurRadius: 12.5 * strength,
        offset: Offset(0, 8 * strength),
      ),
      BoxShadow(
        color: const Color(0xFF5B3A19).withOpacity(0.135 + opacityBoost / 2),
        blurRadius: 1.8 * strength,
        offset: Offset(0, 2.5 * strength),
      ),
      BoxShadow(
        color: Colors.white.withOpacity(0.64),
        blurRadius: 1.2 * strength,
        offset: Offset(0, -1 * strength),
      ),
    ];
  }

  Widget _biteSaverTile({
    required Widget child,
    required BorderRadius shellRadius,
    required BorderRadius faceRadius,
    Color shellBorderColor = const Color(0x66F2DDBB),
    Color highlightBorderColor = const Color(0xF7FFFFFF),
    Color faceBorderColor = Colors.transparent,
    Gradient shellGradient = const LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: [
        Color(0xFFFFF2DA),
        Color(0xFFE9D0A0),
        Color(0xFFD2B276),
        Color(0xFFA9854E),
      ],
      stops: [0.0, 0.34, 0.72, 1.0],
    ),
    Gradient faceGradient = const LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: [Color(0xFFFFFCF7), Color(0xFFFFF8F0), Color(0xFFFFF0E2)],
    ),
    EdgeInsetsGeometry innerMargin = const EdgeInsets.all(1.8),
    List<BoxShadow>? shadows,
  }) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: shellRadius,
        boxShadow: shadows ?? _biteSaverTileShadows(),
      ),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned.fill(
            left: 1.5,
            top: 1,
            right: 1.5,
            bottom: -1,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: shellRadius,
                gradient: const LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Color(0xFFFFEFD4),
                    Color(0xFFE4C58C),
                    Color(0xFFC29C5F),
                    Color(0xFFAA8249),
                    Color(0xFF856133),
                  ],
                  stops: [0.0, 0.25, 0.55, 0.78, 1.0],
                ),
                border: Border.all(color: const Color(0x55E3C996), width: 0.4),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: 1.5),
            child: Container(
              decoration: BoxDecoration(
                borderRadius: shellRadius,
                gradient: shellGradient,
                border: Border.all(color: shellBorderColor, width: 0.35),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF5B3A19).withOpacity(0.34),
                    blurRadius: 2.2,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: shellRadius,
                child: Padding(
                  padding: const EdgeInsets.all(1.2),
                  child: Padding(
                    padding: innerMargin,
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: faceRadius,
                        gradient: faceGradient,
                        border: faceBorderColor == Colors.transparent
                            ? null
                            : Border.all(color: faceBorderColor, width: 0.35),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.white.withOpacity(0.24),
                            blurRadius: 4,
                            spreadRadius: -2.8,
                            offset: const Offset(-1, -1.5),
                          ),
                          BoxShadow(
                            color: Colors.white.withOpacity(0.62),
                            blurRadius: 0.7,
                            offset: const Offset(0, -1),
                          ),
                          BoxShadow(
                            color: const Color(0xFF654720).withOpacity(0.05),
                            blurRadius: 2.6,
                            offset: const Offset(0, 1.5),
                          ),
                        ],
                      ),
                      child: ClipRRect(borderRadius: faceRadius, child: child),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _biteSaverLightTileControl(Widget child) {
    return _biteSaverTile(
      shellRadius: BorderRadius.circular(14),
      faceRadius: BorderRadius.circular(12.5),
      innerMargin: const EdgeInsets.all(1.6),
      shadows: _biteSaverTileShadows(strength: 0.72, opacityBoost: 0.01),
      child: child,
    );
  }

  Widget _biteSaverRedTileControl(Widget child) {
    return _biteSaverTile(
      shellRadius: BorderRadius.circular(14),
      faceRadius: BorderRadius.circular(12.5),
      shellBorderColor: const Color(0x55F7A29B),
      highlightBorderColor: const Color(0xAFFFFFFF),
      faceBorderColor: Colors.transparent,
      shellGradient: const LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [Color(0xFFF06A62), Color(0xFFE3544C), Color(0xFFD8443C)],
      ),
      faceGradient: const LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [Color(0xFFFF7A72), Color(0xFFF5625A), Color(0xFFE94B44)],
      ),
      innerMargin: const EdgeInsets.all(1.5),
      shadows: [
        BoxShadow(
          color: const Color(0xFF4A1F1A).withOpacity(0.15),
          blurRadius: 15,
          offset: const Offset(0, 8),
        ),
        BoxShadow(
          color: const Color(0xFF5A231D).withOpacity(0.065),
          blurRadius: 5,
          offset: const Offset(0, 2),
        ),
        BoxShadow(
          color: Colors.white.withOpacity(0.52),
          blurRadius: 2,
          offset: const Offset(0, -1),
        ),
      ],
      child: child,
    );
  }

  Widget buildCouponCard(Coupon coupon, BuildContext context) {
    final proximityOnly = isProximityCoupon(coupon);
    final scheduleText = coupon.shortExpiresLabel;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      child: _biteSaverTile(
        shellRadius: BorderRadius.circular(17),
        faceRadius: BorderRadius.circular(15.5),
        shellBorderColor: const Color(0x66F2DDBB),
        highlightBorderColor: const Color(0xF7FFFFFF),
        faceBorderColor: Colors.transparent,
        shellGradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Color(0xFFFFF2DA),
            Color(0xFFE9D0A0),
            Color(0xFFD3B478),
            Color(0xFFB08B53),
          ],
          stops: [0.0, 0.34, 0.72, 1.0],
        ),
        faceGradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFFFFFCF7), Color(0xFFFFF8F0), Color(0xFFFFF0E2)],
        ),
        innerMargin: const EdgeInsets.all(1.7),
        shadows: _biteSaverTileShadows(strength: 0.90),
        child: Material(
          color: Colors.transparent,
          child: ListTile(
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 10,
            ),
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (proximityOnly)
                  Container(
                    margin: const EdgeInsets.only(bottom: 5),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.deepOrange,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: const Text(
                      'Proximity Deal',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.12,
                      ),
                    ),
                  ),
                Text(
                  coupon.title,
                  style: const TextStyle(
                    color: Color(0xFF2B1D14),
                    fontSize: 16.5,
                    fontWeight: FontWeight.w700,
                    height: 1.12,
                    letterSpacing: -0.08,
                  ),
                ),
              ],
            ),
            subtitle: Padding(
              padding: const EdgeInsets.only(top: 7),
              child: Text(
                proximityOnly
                    ? '$scheduleText - ${coupon.usageRule} - Unlocked nearby'
                    : (coupon.couponCode == null
                          ? '$scheduleText - ${coupon.usageRule}'
                          : '$scheduleText - ${coupon.usageRule} - Code: ${coupon.couponCode}'),
                style: TextStyle(
                  color: Colors.black.withOpacity(0.62),
                  fontSize: 12.5,
                  fontWeight: FontWeight.w500,
                  height: 1.28,
                  letterSpacing: 0.02,
                ),
              ),
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              await Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => CouponDetailScreen(coupon: coupon),
                ),
              );
              setState(() {});
            },
          ),
        ),
      ),
    );
  }

  void openRestaurantProfile(Restaurant restaurant) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => RestaurantProfileScreen(restaurant: restaurant),
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

  void runGeneralSearch() {
    setState(() {
      generalSearchQuery = generalSearchController.text.trim();
    });
  }

  void clearGeneralSearch() {
    generalSearchController.clear();
    setState(() {
      generalSearchQuery = '';
    });
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
        _searchFocusNode.requestFocus();
      }
    });
  }

  Widget _buildLocationActionRow(
    List<Restaurant> allRestaurants, {
    double minHeight = 52,
    bool showRefresh = true,
    bool matchBiteScoreStyle = false,
  }) {
    final borderRadius = BorderRadius.circular(14);

    return Align(
      alignment: Alignment.center,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 380),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Expanded(
              child: matchBiteScoreStyle
                  ? _biteSaverLightTileControl(
                      ElevatedButton.icon(
                        onPressed: isGettingLocation
                            ? null
                            : () => useMyLocation(allRestaurants),
                        style: ElevatedButton.styleFrom(
                          minimumSize: Size.fromHeight(minHeight),
                          backgroundColor: Colors.transparent,
                          foregroundColor: Theme.of(
                            context,
                          ).colorScheme.primary,
                          elevation: 0,
                          shadowColor: Colors.transparent,
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          shape: RoundedRectangleBorder(
                            borderRadius: borderRadius,
                            side: BorderSide.none,
                          ),
                        ),
                        icon: const Icon(Icons.location_on_outlined),
                        label: Text(
                          isGettingLocation
                              ? 'Getting Location...'
                              : 'Use My Location',
                        ),
                      ),
                    )
                  : ElevatedButton.icon(
                      onPressed: isGettingLocation
                          ? null
                          : () => useMyLocation(allRestaurants),
                      style: ElevatedButton.styleFrom(
                        minimumSize: Size.fromHeight(minHeight),
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        shape: RoundedRectangleBorder(
                          borderRadius: borderRadius,
                          side: BorderSide.none,
                        ),
                      ),
                      icon: const Icon(Icons.location_on_outlined),
                      label: Text(
                        isGettingLocation
                            ? 'Getting Location...'
                            : 'Use My Location',
                      ),
                    ),
            ),
            if (showRefresh) ...[
              const SizedBox(width: 10),
              SizedBox(
                height: minHeight,
                child: _biteSaverRedTileControl(
                  ElevatedButton(
                    onPressed: isGettingLocation
                        ? null
                        : () => useMyLocation(allRestaurants),
                    style: ElevatedButton.styleFrom(
                      minimumSize: const Size(110, 0),
                      backgroundColor: Colors.transparent,
                      foregroundColor: Colors.white,
                      elevation: 0,
                      shadowColor: Colors.transparent,
                      shape: RoundedRectangleBorder(
                        borderRadius: borderRadius,
                        side: BorderSide.none,
                      ),
                      textStyle: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    child: const Text('Refresh'),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildGetStartedState(List<Restaurant> allRestaurants) {
    return SliverFillRemaining(
      hasScrollBody: false,
      child: Align(
        alignment: Alignment.topCenter,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Card(
              elevation: 4,
              shadowColor: Colors.black.withOpacity(0.08),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(24),
                side: const BorderSide(color: Color(0xFFE2E8F0)),
              ),
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Find great food near you 🍽️',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.onSurface,
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
                        color: Colors.black54,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        height: 1.45,
                      ),
                    ),
                    const SizedBox(height: 24),
                    _buildLocationActionRow(allRestaurants, showRefresh: false),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: _focusLocationSearchField,
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size.fromHeight(52),
                          foregroundColor: Theme.of(
                            context,
                          ).colorScheme.primary,
                          side: BorderSide(
                            color: Theme.of(
                              context,
                            ).colorScheme.primary.withOpacity(0.28),
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                        icon: const Icon(Icons.location_searching, size: 20),
                        label: const Text('Enter ZIP Code'),
                      ),
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'We only use your location to show nearby results.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.black45,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
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

  Widget _buildInlineRestaurantsLoading() {
    return const SliverToBoxAdapter(
      child: Padding(
        padding: EdgeInsets.fromLTRB(24, 24, 24, 24),
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

  Widget _buildInlineRestaurantsError() {
    return SliverToBoxAdapter(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Could not load nearby deals right now.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 8),
                Text(
                  AppErrorText.friendly(
                    _restaurantsError ?? StateError('Unknown loading error'),
                    fallback: 'Please try again in a moment.',
                  ),
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.black54, height: 1.35),
                ),
                const SizedBox(height: 14),
                ElevatedButton(
                  onPressed: _loadRestaurants,
                  child: const Text('Try Again'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildResultsSliver(
    List<Restaurant> allRestaurants,
    List<Restaurant> filteredRestaurants,
  ) {
    return SliverList(
      delegate: SliverChildBuilderDelegate((context, index) {
        if (filteredRestaurants.isEmpty) {
          final nextRadius = _nextRadiusOption();
          final canIncreaseRadius = nextRadius != selectedRadius;

          return Padding(
            padding: const EdgeInsets.only(top: 16),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  children: [
                    const Text(
                      'No nearby deals yet',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Try a larger radius, another ZIP code, or switch to BiteScore to find highly rated dishes nearby.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.black54, height: 1.35),
                    ),
                    const SizedBox(height: 14),
                    Wrap(
                      alignment: WrapAlignment.center,
                      spacing: 10,
                      runSpacing: 10,
                      children: [
                        OutlinedButton(
                          onPressed: canIncreaseRadius
                              ? () {
                                  setState(() {
                                    selectedRadius = nextRadius;
                                  });
                                }
                              : null,
                          child: Text(
                            canIncreaseRadius
                                ? 'Increase Radius'
                                : 'Max Radius',
                          ),
                        ),
                        TextButton(
                          onPressed: () {
                            AppModeStateService.setMode(AppMode.biteScore);
                          },
                          child: const Text('Try BiteScore'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          );
        }

        final restaurant = filteredRestaurants[index];
        return GestureDetector(
          onTap: () => openRestaurantProfile(restaurant),
          child: Container(
            margin: const EdgeInsets.only(bottom: 16),
            child: _biteSaverTile(
              shellRadius: BorderRadius.circular(20),
              faceRadius: BorderRadius.circular(18),
              shellBorderColor: const Color(0x66EED8B2),
              highlightBorderColor: const Color(0xF7FFFFFF),
              faceBorderColor: Colors.transparent,
              shellGradient: const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Color(0xFFFFEED2),
                  Color(0xFFE2C389),
                  Color(0xFFC29B5B),
                  Color(0xFFA27C45),
                ],
                stops: [0.0, 0.34, 0.72, 1.0],
              ),
              faceGradient: const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Color(0xFFFFFCF7),
                  Color(0xFFFFF8F0),
                  Color(0xFFFFF0E2),
                ],
              ),
              innerMargin: const EdgeInsets.all(2.1),
              shadows: _biteSaverTileShadows(
                strength: 1.08,
                opacityBoost: 0.03,
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 15),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            restaurant.name,
                            style: const TextStyle(
                              color: Color(0xFF1F1A16),
                              fontSize: 18.5,
                              fontWeight: FontWeight.w700,
                              height: 1.12,
                              letterSpacing: -0.12,
                            ),
                          ),
                        ),
                        const Icon(
                          Icons.storefront,
                          size: 18,
                          color: Colors.black54,
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '${restaurant.distance} - ${restaurant.city}, ${restaurant.zipCode}',
                      style: TextStyle(
                        color: Colors.black.withOpacity(0.65),
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        height: 1.22,
                        letterSpacing: 0.01,
                      ),
                    ),
                    const SizedBox(height: 12),
                    ...restaurant.coupons.map(
                      (coupon) => buildCouponCard(coupon, context),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      }, childCount: filteredRestaurants.isEmpty ? 1 : filteredRestaurants.length),
    );
  }

  Widget _buildHeader({
    required List<Restaurant> allRestaurants,
    required List<Restaurant> filteredRestaurants,
    required double expansionT,
  }) {
    final collapsed = expansionT <= 0.02;

    return Material(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
        child: SizedBox(
          width: double.infinity,
          child: _biteSaverTile(
            shellRadius: BorderRadius.circular(18),
            faceRadius: BorderRadius.circular(16),
            shellBorderColor: const Color(0x66F2DDBB),
            highlightBorderColor: const Color(0xF6FFFFFF),
            faceBorderColor: Colors.transparent,
            shellGradient: const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Color(0xFFFFF2DA),
                Color(0xFFE9D0A0),
                Color(0xFFD3B478),
                Color(0xFFB08B53),
              ],
              stops: [0.0, 0.34, 0.72, 1.0],
            ),
            faceGradient: const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFFFFFCF7), Color(0xFFFFF8F0), Color(0xFFFFF0E2)],
            ),
            innerMargin: const EdgeInsets.all(2.0),
            shadows: _biteSaverTileShadows(strength: 0.92),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (collapsed)
                    InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: _expandHeader,
                      child: Padding(
                        padding: EdgeInsets.zero,
                        child: Column(
                          children: [
                            Text(
                              'Expand search',
                              style: TextStyle(
                                color: Theme.of(
                                  context,
                                ).colorScheme.onSurfaceVariant,
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 0),
                            Icon(
                              Icons.keyboard_arrow_down,
                              color: Theme.of(
                                context,
                              ).colorScheme.onSurfaceVariant,
                            ),
                          ],
                        ),
                      ),
                    ),
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
                                children: [
                                  Stack(
                                    alignment: Alignment.centerRight,
                                    children: [
                                      TextField(
                                        controller: generalSearchController,
                                        onSubmitted: (_) => runGeneralSearch(),
                                        decoration: InputDecoration(
                                          isDense: true,
                                          hintText:
                                              'Search restaurants or coupons',
                                          prefixIcon: const Icon(
                                            Icons.manage_search,
                                          ),
                                          contentPadding:
                                              const EdgeInsets.fromLTRB(
                                                12,
                                                14,
                                                188,
                                                14,
                                              ),
                                          border: OutlineInputBorder(
                                            borderRadius: BorderRadius.circular(
                                              12,
                                            ),
                                          ),
                                        ),
                                      ),
                                      Positioned(
                                        top: 1,
                                        right: 1,
                                        bottom: 1,
                                        child: Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            if (generalSearchQuery
                                                .trim()
                                                .isNotEmpty)
                                              IconButton(
                                                icon: const Icon(Icons.clear),
                                                onPressed: clearGeneralSearch,
                                                tooltip: 'Clear search',
                                                visualDensity:
                                                    VisualDensity.compact,
                                              ),
                                            _biteSaverLightTileControl(
                                              Material(
                                                color: Colors.transparent,
                                                shape: RoundedRectangleBorder(
                                                  side: BorderSide.none,
                                                  borderRadius:
                                                      BorderRadius.circular(12),
                                                ),
                                                child: InkWell(
                                                  onTap: runGeneralSearch,
                                                  borderRadius:
                                                      BorderRadius.circular(12),
                                                  child: ConstrainedBox(
                                                    constraints:
                                                        const BoxConstraints(
                                                          minHeight: 42,
                                                        ),
                                                    child: Padding(
                                                      padding:
                                                          const EdgeInsets.symmetric(
                                                            horizontal: 18,
                                                          ),
                                                      child: Text(
                                                        'Search',
                                                        style: TextStyle(
                                                          fontSize: 12,
                                                          fontWeight:
                                                              FontWeight.w600,
                                                          color: Theme.of(
                                                            context,
                                                          ).colorScheme.primary,
                                                        ),
                                                      ),
                                                    ),
                                                  ),
                                                ),
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 10),
                                  Stack(
                                    alignment: Alignment.centerRight,
                                    children: [
                                      TextField(
                                        controller: searchController,
                                        focusNode: _searchFocusNode,
                                        onSubmitted: (_) =>
                                            runSearch(allRestaurants),
                                        decoration: InputDecoration(
                                          isDense: true,
                                          hintText: 'Enter city or ZIP code',
                                          prefixIcon: const Icon(Icons.search),
                                          contentPadding:
                                              const EdgeInsets.fromLTRB(
                                                12,
                                                14,
                                                188,
                                                14,
                                              ),
                                          border: OutlineInputBorder(
                                            borderRadius: BorderRadius.circular(
                                              12,
                                            ),
                                          ),
                                        ),
                                      ),
                                      Positioned(
                                        top: 1,
                                        right: 1,
                                        bottom: 1,
                                        child: Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            if (searchQuery.trim().isNotEmpty ||
                                                usingCurrentLocation ||
                                                usingTypedSearchLocation)
                                              IconButton(
                                                icon: const Icon(Icons.clear),
                                                onPressed: clearSearch,
                                                tooltip: 'Clear search',
                                                visualDensity:
                                                    VisualDensity.compact,
                                              ),
                                            _biteSaverLightTileControl(
                                              Material(
                                                color: Colors.transparent,
                                                shape: RoundedRectangleBorder(
                                                  side: BorderSide.none,
                                                  borderRadius:
                                                      BorderRadius.circular(12),
                                                ),
                                                child: InkWell(
                                                  onTap: isSearchingLocation
                                                      ? null
                                                      : () => runSearch(
                                                          allRestaurants,
                                                        ),
                                                  borderRadius:
                                                      BorderRadius.circular(12),
                                                  child: ConstrainedBox(
                                                    constraints:
                                                        const BoxConstraints(
                                                          minHeight: 42,
                                                        ),
                                                    child: Padding(
                                                      padding:
                                                          const EdgeInsets.symmetric(
                                                            horizontal: 18,
                                                          ),
                                                      child: Row(
                                                        mainAxisSize:
                                                            MainAxisSize.min,
                                                        children: [
                                                          Icon(
                                                            Icons.arrow_forward,
                                                            size: 16,
                                                            color:
                                                                Theme.of(
                                                                      context,
                                                                    )
                                                                    .colorScheme
                                                                    .primary,
                                                          ),
                                                          const SizedBox(
                                                            width: 6,
                                                          ),
                                                          Text(
                                                            isSearchingLocation
                                                                ? 'Searching...'
                                                                : 'Search',
                                                            style: TextStyle(
                                                              fontSize: 12,
                                                              fontWeight:
                                                                  FontWeight
                                                                      .w600,
                                                              color:
                                                                  Theme.of(
                                                                        context,
                                                                      )
                                                                      .colorScheme
                                                                      .primary,
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
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 10),
                                  _buildLocationActionRow(
                                    allRestaurants,
                                    minHeight: 40,
                                    matchBiteScoreStyle: true,
                                  ),
                                  const SizedBox(height: 12),
                                  Column(
                                    mainAxisSize: MainAxisSize.min,
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'Within Radius',
                                        style: TextStyle(
                                          color: Theme.of(
                                            context,
                                          ).colorScheme.onSurfaceVariant,
                                          fontSize: 12,
                                        ),
                                      ),
                                      _biteSaverLightTileControl(
                                        DropdownButtonFormField<String>(
                                          initialValue: selectedRadius,
                                          decoration: const InputDecoration(
                                            contentPadding:
                                                EdgeInsets.symmetric(
                                                  horizontal: 12,
                                                  vertical: 12,
                                                ),
                                            border: InputBorder.none,
                                          ),
                                          items: const [
                                            DropdownMenuItem(
                                              value: '1 mile',
                                              child: Text('1 mile'),
                                            ),
                                            DropdownMenuItem(
                                              value: '3 miles',
                                              child: Text('3 miles'),
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
                                              value: '20 miles',
                                              child: Text('20 miles'),
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
                                    ],
                                  ),
                                  const SizedBox(height: 4),
                                  if (compactStatusLine(
                                    filteredRestaurants,
                                  ).isNotEmpty)
                                    Align(
                                      alignment: Alignment.centerLeft,
                                      child: Text(
                                        compactStatusLine(filteredRestaurants),
                                        style: TextStyle(
                                          fontSize: 12,
                                          color:
                                              (locationStatusMessage != null &&
                                                  locationStatusMessage!
                                                      .isNotEmpty &&
                                                  !usingCurrentLocation &&
                                                  searchQuery.trim().isEmpty)
                                              ? Colors.deepOrange
                                              : Colors.black54,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                  const SizedBox(height: 2),
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
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: DemoRedemptionStore.changes,
      builder: (context, _, __) {
        return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: RestaurantAccountService.approvedAccountsStream(),
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return Scaffold(
                body: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.store_mall_directory_outlined,
                          size: 48,
                        ),
                        const SizedBox(height: 16),
                        const Text(
                          'Could not load restaurants right now.',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Please try again in a moment.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.black54),
                        ),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: _loadRestaurants,
                          child: const Text('Try Again'),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            }

            final approvedAccountsSignature = _buildApprovedAccountsSignature(
              snapshot.data,
            );
            if (approvedAccountsSignature != _approvedAccountsSignature) {
              _approvedAccountsSignature = approvedAccountsSignature;
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (mounted) {
                  _loadRestaurants();
                }
              });
            }

            final allRestaurants = mergeRestaurants(
              firestoreRestaurants: _restaurants,
              sampleRestaurants: sampleRestaurants,
            );

            detectAndShowNewCouponNotifications(allRestaurants);

            final filteredRestaurants = filterRestaurants(allRestaurants);

            final hiddenProximityCount = allRestaurants
                .expand((restaurant) => restaurant.coupons)
                .where(
                  (coupon) =>
                      coupon.isProximityOnly &&
                      coupon.isActiveAt(DateTime.now()),
                )
                .length;

            return Scaffold(
              body: CustomScrollView(
                controller: _listScrollController,
                slivers: [
                  SliverPersistentHeader(
                    pinned: true,
                    delegate: _HomeHeaderDelegate(
                      minExtentHeight: _collapsedHeaderExtent,
                      maxExtentHeight: _expandedHeaderExtent,
                      builder: (context, expansionT) => _buildHeader(
                        allRestaurants: allRestaurants,
                        filteredRestaurants: filteredRestaurants,
                        expansionT: expansionT,
                      ),
                    ),
                  ),
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    sliver: !_hasLocationOrZipInput
                        ? _buildGetStartedState(allRestaurants)
                        : _restaurantsError != null && _restaurants.isEmpty
                        ? _buildInlineRestaurantsError()
                        : _isRestaurantsLoading && _restaurants.isEmpty
                        ? _buildInlineRestaurantsLoading()
                        : _buildResultsSliver(
                            allRestaurants,
                            filteredRestaurants,
                          ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }
}

class _HomeHeaderDelegate extends SliverPersistentHeaderDelegate {
  final double minExtentHeight;
  final double maxExtentHeight;
  final Widget Function(BuildContext context, double expansionT) builder;

  const _HomeHeaderDelegate({
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
  bool shouldRebuild(covariant _HomeHeaderDelegate oldDelegate) {
    return minExtentHeight != oldDelegate.minExtentHeight ||
        maxExtentHeight != oldDelegate.maxExtentHeight ||
        builder != oldDelegate.builder;
  }
}
