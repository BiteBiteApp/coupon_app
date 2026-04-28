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
import '../widgets/pressable_scale.dart';
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
        color: const Color(0xFF5E3E1E).withOpacity(0.10 + opacityBoost / 2),
        blurRadius: 16 * strength,
        offset: Offset(0, 10 * strength),
      ),
      BoxShadow(
        color: const Color(0xFF704D24).withOpacity(0.22 + opacityBoost / 2),
        blurRadius: 3.4 * strength,
        offset: Offset(0, 4 * strength),
      ),
    ];
  }

  List<Color> _biteSaverGradientColors(Gradient gradient) {
    if (gradient is LinearGradient) return gradient.colors;
    if (gradient is RadialGradient) return gradient.colors;
    if (gradient is SweepGradient) return gradient.colors;
    return const <Color>[];
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
        Color(0xFFF7EEE4),
        Color(0xFFE6D0BD),
        Color(0xFFD7B79D),
        Color(0xFFC7A382),
      ],
      stops: [0.0, 0.34, 0.72, 1.0],
    ),
    Gradient faceGradient = const LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: [Color(0xFFFFFCFA), Color(0xFFFAF5EF), Color(0xFFF4EBE2)],
    ),
    EdgeInsetsGeometry innerMargin = const EdgeInsets.all(1.8),
    List<BoxShadow>? shadows,
  }) {
    final shellColors = _biteSaverGradientColors(shellGradient);
    final faceColors = _biteSaverGradientColors(faceGradient);
    final warmedFaceColors = faceColors.isNotEmpty
        ? faceColors
            .map(
              (color) =>
                  Color.lerp(color, const Color(0xFFF1E5D8), 0.08) ?? color,
            )
            .toList(growable: false)
        : const <Color>[Color(0xFFFFFCFA), Color(0xFFFAF5EF), Color(0xFFF4EBE2)];
    final adjustedFaceGradient = faceGradient is LinearGradient
        ? LinearGradient(
            begin: faceGradient.begin,
            end: faceGradient.end,
            colors: warmedFaceColors,
            stops: faceGradient.stops,
            tileMode: faceGradient.tileMode,
            transform: faceGradient.transform,
          )
        : faceGradient is RadialGradient
        ? RadialGradient(
            center: faceGradient.center,
            radius: faceGradient.radius,
            colors: warmedFaceColors,
            stops: faceGradient.stops,
            tileMode: faceGradient.tileMode,
            focal: faceGradient.focal,
            focalRadius: faceGradient.focalRadius,
            transform: faceGradient.transform,
          )
        : faceGradient is SweepGradient
        ? SweepGradient(
            center: faceGradient.center,
            startAngle: faceGradient.startAngle,
            endAngle: faceGradient.endAngle,
            colors: warmedFaceColors,
            stops: faceGradient.stops,
            tileMode: faceGradient.tileMode,
            transform: faceGradient.transform,
          )
        : faceGradient;
    final rawShellBottomColor =
        shellColors.isNotEmpty ? shellColors.last : const Color(0xFFC6944F);
    final shellBottomColor =
        Color.lerp(rawShellBottomColor, const Color(0xFF9D6E3A), 0.14) ??
        rawShellBottomColor;
    final faceTopColor =
        warmedFaceColors.isNotEmpty
        ? warmedFaceColors.first
        : const Color(0xFFFFFCF8);
    final lipColor = Color.lerp(shellBottomColor, const Color(0xFF8E6030), 0.28) ??
        shellBottomColor;
    final sideHighlightBottomColor =
        Color.lerp(highlightBorderColor, shellBorderColor, 0.84) ??
        shellBorderColor;
    final resolvedShadows = <BoxShadow>[
      const BoxShadow(
        color: Color.fromRGBO(90, 60, 30, 0.28),
        blurRadius: 1,
        spreadRadius: 0,
        offset: Offset(0, -1),
      ),
      const BoxShadow(
        color: Color.fromRGBO(90, 60, 30, 0.20),
        blurRadius: 1,
        spreadRadius: 0,
        offset: Offset(0, 0),
      ),
      const BoxShadow(
        color: Color.fromRGBO(90, 60, 30, 0.06),
        blurRadius: 8,
        offset: Offset(0, -1),
      ),
      const BoxShadow(
        color: Color.fromRGBO(90, 60, 30, 0.04),
        blurRadius: 6,
        offset: Offset(0, 0),
      ),
      ...(shadows ?? _biteSaverTileShadows()),
    ];

    return Container(
      decoration: BoxDecoration(
        borderRadius: shellRadius,
        boxShadow: resolvedShadows,
      ),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned.fill(
            left: 1.5,
            top: 5.2,
            right: 1.5,
            bottom: -1.1,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: shellRadius,
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    lipColor.withOpacity(0.0),
                    lipColor.withOpacity(0.0),
                    lipColor.withOpacity(0.18),
                    lipColor.withOpacity(0.52),
                  ],
                  stops: const [0.0, 0.80, 0.94, 1.0],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: 1.5),
            child: Container(
              decoration: BoxDecoration(
                borderRadius: shellRadius,
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    faceTopColor,
                    faceTopColor,
                    Color.lerp(faceTopColor, shellBottomColor, 0.28) ??
                        shellBottomColor,
                    shellBottomColor,
                  ],
                  stops: const [0.0, 0.78, 0.93, 1.0],
                ),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF704D24).withOpacity(0.14),
                    blurRadius: 1.8,
                    offset: const Offset(0, 1.6),
                  ),
                ],
              ),
              child: Stack(
                children: [
                  Positioned.fill(
                    left: 1.65,
                    top: 0.35,
                    right: 1.65,
                    bottom: 1.1,
                    child: IgnorePointer(
                      child: ShaderMask(
                        blendMode: BlendMode.srcATop,
                        shaderCallback: (bounds) {
                          return const LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              Color.fromRGBO(255, 255, 255, 1),
                              Color.fromRGBO(255, 255, 255, 0.72),
                              Color.fromRGBO(255, 255, 255, 0.34),
                              Color.fromRGBO(255, 255, 255, 0.07),
                              Color.fromRGBO(255, 255, 255, 0.01),
                              Color.fromRGBO(255, 255, 255, 0),
                              Color.fromRGBO(255, 255, 255, 0),
                            ],
                            stops: [0.0, 0.30, 0.48, 0.60, 0.74, 0.88, 1.0],
                          ).createShader(bounds);
                        },
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            borderRadius: shellRadius,
                            border: const Border(
                              top: BorderSide(color: Colors.white, width: 0.7),
                              left: BorderSide(color: Colors.white, width: 0.7),
                              right: BorderSide(color: Colors.white, width: 0.7),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  ClipRRect(
                    borderRadius: shellRadius,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(1.0, 0.4, 1.0, 1.9),
                      child: Padding(
                        padding: innerMargin,
                        child: Container(
                          decoration: BoxDecoration(
                            borderRadius: faceRadius,
                            gradient: adjustedFaceGradient,
                            border: faceBorderColor == Colors.transparent
                                ? Border(
                                    bottom: BorderSide(
                                      color: shellBottomColor.withOpacity(0.10),
                                      width: 0.5,
                                    ),
                                  )
                                : Border.all(color: faceBorderColor, width: 0.35),
                            boxShadow: [
                              BoxShadow(
                                color: const Color(0xFF704D24).withOpacity(0.05),
                                blurRadius: 1.8,
                                offset: const Offset(0, 1.0),
                              ),
                            ],
                          ),
                          child: ClipRRect(borderRadius: faceRadius, child: child),
                        ),
                      ),
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

  Widget _biteSaverLightTileControl(
    Widget child, {
    List<BoxShadow>? shadows,
  }) {
    return _biteSaverTile(
      shellRadius: BorderRadius.circular(14),
      faceRadius: BorderRadius.circular(12.5),
      innerMargin: const EdgeInsets.all(1.6),
      shadows: shadows ?? _biteSaverTileShadows(strength: 0.72, opacityBoost: 0.01),
      child: child,
    );
  }

  Widget _biteSaverRedTileControl(
    Widget child, {
    List<BoxShadow>? shadows,
  }) {
    return _biteSaverTile(
      shellRadius: BorderRadius.circular(14),
      faceRadius: BorderRadius.circular(12.5),
      shellBorderColor: const Color(0x55C8876A),
      highlightBorderColor: const Color(0xAFFFFFFF),
      faceBorderColor: Colors.transparent,
      shellGradient: const LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [Color(0xFFDDA17F), Color(0xFFBE7657), Color(0xFFA5664E)],
      ),
      faceGradient: const LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [Color(0xFFE5AE8E), Color(0xFFD18D69), Color(0xFFBC7355)],
      ),
      innerMargin: const EdgeInsets.all(1.5),
      shadows: shadows ??
          [
            BoxShadow(
              color: const Color(0xFF4A1F1A).withOpacity(0.18),
              blurRadius: 10,
              offset: const Offset(0, 9),
            ),
            BoxShadow(
              color: const Color(0xFF5A231D).withOpacity(0.10),
              blurRadius: 2,
              offset: const Offset(0, 3),
            ),
            BoxShadow(
              color: Colors.white.withOpacity(0.22),
              blurRadius: 1.5,
              offset: const Offset(0, 0.2),
            ),
          ],
      child: child,
    );
  }

  Widget _biteSaverInputFieldSurface() {
    return Positioned.fill(
      child: IgnorePointer(
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            color: const Color(0xFFFFFBF7),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.15),
                blurRadius: 5,
                offset: const Offset(0, 2),
              ),
            ],
            border: Border.all(
              color: const Color(0xFFE5D2C2),
              width: 1.2,
            ),
          ),
        ),
      ),
    );
  }

  Widget buildCouponCard(Coupon coupon, BuildContext context) {
    final proximityOnly = isProximityCoupon(coupon);
    final scheduleText = coupon.shortExpiresLabel;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      child: _ImmediatePressFeedback(
        borderRadius: BorderRadius.circular(17),
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
            Color(0xFFEFDECD),
            Color(0xFFDBC1AA),
            Color(0xFFCBA783),
            Color(0xFFBA9168),
          ],
          stops: [0.0, 0.34, 0.72, 1.0],
        ),
        faceGradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFFFFFBF8), Color(0xFFF7EEE5), Color(0xFFEFE0D1)],
        ),
        innerMargin: const EdgeInsets.all(1.7),
        shadows: [
          const BoxShadow(
            color: Color.fromRGBO(120, 80, 40, 0.45),
            offset: Offset(0, 2),
            blurRadius: 0,
            spreadRadius: 0,
          ),
          ..._biteSaverTileShadows(strength: 0.90),
        ],
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
                      color: const Color(0xFFB7613F),
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
            trailing: const Icon(
              Icons.chevron_right,
              color: Color(0xFF94482E),
            ),
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
                  ? PressableScale(
                      enabled: !isGettingLocation,
                      child: _biteSaverLightTileControl(
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
                          elevation: 4,
                          shadowColor: Colors.black.withOpacity(0.2),
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
                      shadows: const [],
                    ),
                    )
                  : PressableScale(
                      enabled: !isGettingLocation,
                      child: ElevatedButton.icon(
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
            ),
            if (showRefresh) ...[
              const SizedBox(width: 10),
              SizedBox(
                height: minHeight,
                child: PressableScale(
                  enabled: !isGettingLocation,
                  child: _biteSaverRedTileControl(
                  ElevatedButton(
                    onPressed: isGettingLocation
                        ? null
                        : () => useMyLocation(allRestaurants),
                    style: ElevatedButton.styleFrom(
                      minimumSize: const Size(110, 0),
                      backgroundColor: Colors.transparent,
                      foregroundColor: Colors.white,
                      elevation: 4,
                      shadowColor: Colors.black.withOpacity(0.2),
                      shape: RoundedRectangleBorder(
                        borderRadius: borderRadius,
                        side: BorderSide.none,
                      ),
                      textStyle: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    child: const Text('Refresh'),
                  ),
                  shadows: const [],
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
        final shellRadius = BorderRadius.circular(20);
        final faceRadius = BorderRadius.circular(18);
        final shellGradient = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Color(0xFFEEDBC9),
            Color(0xFFD8BEA3),
            Color(0xFFC7A17B),
            Color(0xFFB58B63),
          ],
          stops: [0.0, 0.34, 0.72, 1.0],
        );
        final faceGradient = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Color(0xFFFFFBF8),
            Color(0xFFF7EDE3),
            Color(0xFFEEDDCB),
          ],
        );
        final shellShadows = [
          const BoxShadow(
            color: Color.fromRGBO(120, 80, 40, 0.45),
            offset: Offset(0, 2),
            blurRadius: 0,
            spreadRadius: 0,
          ),
          ..._biteSaverTileShadows(
            strength: 1.08,
            opacityBoost: 0.03,
          ),
        ];

        return _RestaurantCardShellPressable(
          onTap: () => openRestaurantProfile(restaurant),
          title: restaurant.name,
          subtitle:
              '${restaurant.distance} - ${restaurant.city}, ${restaurant.zipCode}',
          couponChildren: restaurant.coupons
              .map((coupon) => buildCouponCard(coupon, context))
              .toList(),
          shellRadius: shellRadius,
          shellChild: _biteSaverTile(
            shellRadius: shellRadius,
            faceRadius: faceRadius,
            shellBorderColor: const Color(0x66EED8B2),
            highlightBorderColor: const Color(0xF7FFFFFF),
            faceBorderColor: Colors.transparent,
            shellGradient: shellGradient,
            faceGradient: faceGradient,
            innerMargin: const EdgeInsets.all(2.1),
            shadows: shellShadows,
            child: const SizedBox.expand(),
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
      color: Colors.transparent,
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
                Color(0xFFDFCBB8),
                Color(0xFFC5AE94),
                Color(0xFFB69170),
                Color(0xFFA77B59),
              ],
              stops: [0.0, 0.34, 0.72, 1.0],
            ),
            faceGradient: const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFFD0B9A3), Color(0xFFD0B9A3), Color(0xFFD0B9A3)],
            ),
            innerMargin: const EdgeInsets.all(2.0),
            shadows: [
              const BoxShadow(
                color: Color.fromRGBO(120, 80, 40, 0.45),
                offset: Offset(0, 2),
                blurRadius: 0,
                spreadRadius: 0,
              ),
              ..._biteSaverTileShadows(strength: 0.82),
            ],
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
                              color: const Color(0xFFB7613F),
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
                                      _biteSaverInputFieldSurface(),
                                      TextField(
                                        controller: generalSearchController,
                                        onSubmitted: (_) => runGeneralSearch(),
                                        decoration: InputDecoration(
                                          filled: true,
                                          fillColor: const Color(0xFFFFFAF5),
                                          isDense: true,
                                          hintText:
                                              'Search restaurants or coupons',
                                          prefixIcon: const Icon(
                                            Icons.manage_search,
                                            color: Color(0xFFB7613F),
                                          ),
                                          contentPadding:
                                              const EdgeInsets.fromLTRB(
                                                14,
                                                14,
                                                188,
                                                14,
                                              ),
                                          border: OutlineInputBorder(
                                            borderRadius:
                                                BorderRadius.circular(14),
                                            borderSide: const BorderSide(
                                              color: Color(0xFFD6B4A0),
                                              width: 1.0,
                                            ),
                                          ),
                                          enabledBorder: OutlineInputBorder(
                                            borderRadius:
                                                BorderRadius.circular(14),
                                            borderSide: const BorderSide(
                                              color: Color(0xFFD6B4A0),
                                              width: 1.0,
                                            ),
                                          ),
                                          focusedBorder: OutlineInputBorder(
                                            borderRadius:
                                                BorderRadius.circular(14),
                                            borderSide: const BorderSide(
                                              color: Color(0xFFD6B4A0),
                                              width: 1.0,
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
                                                icon: const Icon(
                                                  Icons.clear,
                                                  color: Color(0xFFB7613F),
                                                ),
                                                onPressed: clearGeneralSearch,
                                                tooltip: 'Clear search',
                                                visualDensity:
                                                    VisualDensity.compact,
                                              ),
                                            PressableScale(
                                              child: _biteSaverLightTileControl(
                                              ElevatedButton(
                                                onPressed: runGeneralSearch,
                                                style: ElevatedButton.styleFrom(
                                                  minimumSize: const Size(0, 42),
                                                  backgroundColor: const Color(
                                                    0xFFFFFBF7,
                                                  ),
                                                  foregroundColor: const Color(
                                                    0xFFB7613F,
                                                  ),
                                                  elevation: 4,
                                                  shadowColor:
                                                      Colors.black.withOpacity(0.2),
                                                  padding:
                                                      const EdgeInsets.symmetric(
                                                        horizontal: 18,
                                                      ),
                                                  tapTargetSize:
                                                      MaterialTapTargetSize
                                                          .shrinkWrap,
                                                  shape: RoundedRectangleBorder(
                                                    borderRadius:
                                                        BorderRadius.circular(12),
                                                    side: BorderSide.none,
                                                  ),
                                                ),
                                                child: const Text(
                                                  'Search',
                                                  style: TextStyle(
                                                    fontSize: 12,
                                                    fontWeight: FontWeight.w600,
                                                  ),
                                                ),
                                              ),
                                              shadows: const [],
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
                                      _biteSaverInputFieldSurface(),
                                      TextField(
                                        controller: searchController,
                                        focusNode: _searchFocusNode,
                                        onSubmitted: (_) =>
                                            runSearch(allRestaurants),
                                        decoration: InputDecoration(
                                          filled: true,
                                          fillColor: const Color(0xFFFFFAF5),
                                          isDense: true,
                                          hintText: 'Enter city or ZIP code',
                                          prefixIcon: const Icon(
                                            Icons.search,
                                            color: Color(0xFFB7613F),
                                          ),
                                          contentPadding:
                                              const EdgeInsets.fromLTRB(
                                                14,
                                                14,
                                                188,
                                                14,
                                              ),
                                          border: OutlineInputBorder(
                                            borderRadius:
                                                BorderRadius.circular(14),
                                            borderSide: const BorderSide(
                                              color: Color(0xFFD6B4A0),
                                              width: 1.0,
                                            ),
                                          ),
                                          enabledBorder: OutlineInputBorder(
                                            borderRadius:
                                                BorderRadius.circular(14),
                                            borderSide: const BorderSide(
                                              color: Color(0xFFD6B4A0),
                                              width: 1.0,
                                            ),
                                          ),
                                          focusedBorder: OutlineInputBorder(
                                            borderRadius:
                                                BorderRadius.circular(14),
                                            borderSide: const BorderSide(
                                              color: Color(0xFFD6B4A0),
                                              width: 1.0,
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
                                                icon: const Icon(
                                                  Icons.clear,
                                                  color: Color(0xFFB7613F),
                                                ),
                                                onPressed: clearSearch,
                                                tooltip: 'Clear search',
                                                visualDensity:
                                                    VisualDensity.compact,
                                              ),
                                            PressableScale(
                                              enabled:
                                                  !isSearchingLocation,
                                              child: _biteSaverLightTileControl(
                                              ElevatedButton(
                                                onPressed: isSearchingLocation
                                                    ? null
                                                    : () => runSearch(
                                                        allRestaurants,
                                                      ),
                                                style: ElevatedButton.styleFrom(
                                                  minimumSize: const Size(0, 42),
                                                  backgroundColor: const Color(
                                                    0xFFFFFBF7,
                                                  ),
                                                  foregroundColor: const Color(
                                                    0xFFB7613F,
                                                  ),
                                                  elevation: 4,
                                                  shadowColor:
                                                      Colors.black.withOpacity(0.2),
                                                  padding:
                                                      const EdgeInsets.symmetric(
                                                        horizontal: 18,
                                                      ),
                                                  tapTargetSize:
                                                      MaterialTapTargetSize
                                                          .shrinkWrap,
                                                  shape: RoundedRectangleBorder(
                                                    borderRadius:
                                                        BorderRadius.circular(12),
                                                    side: BorderSide.none,
                                                  ),
                                                ),
                                                child: Row(
                                                  mainAxisSize: MainAxisSize.min,
                                                  children: [
                                                    const Icon(
                                                      Icons.arrow_forward,
                                                      size: 16,
                                                    ),
                                                    const SizedBox(width: 6),
                                                    Text(
                                                      isSearchingLocation
                                                          ? 'Searching...'
                                                          : 'Search',
                                                      style: const TextStyle(
                                                        fontSize: 12,
                                                        fontWeight: FontWeight.w600,
                                                      ),
                                                    ),
                                                  ],
                                                ),
                                              ),
                                              shadows: const [],
                                            ),
                                            ),
                                          ],
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 10),
                                  Align(
                                    alignment: Alignment.center,
                                    child: ConstrainedBox(
                                      constraints: const BoxConstraints(
                                        maxWidth: 380,
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Expanded(
                                            child: PressableScale(
                                              enabled: !isGettingLocation,
                                              child: _biteSaverLightTileControl(
                                              ElevatedButton.icon(
                                                onPressed: isGettingLocation
                                                    ? null
                                                    : () => useMyLocation(
                                                        allRestaurants,
                                                      ),
                                                style:
                                                    ElevatedButton.styleFrom(
                                                      minimumSize:
                                                          const Size.fromHeight(
                                                            40,
                                                          ),
                                                      backgroundColor:
                                                          const Color(
                                                            0xFFFFFBF7,
                                                          ),
                                                      foregroundColor:
                                                          const Color(
                                                            0xFFB7613F,
                                                          ),
                                                      elevation: 0,
                                                      shadowColor:
                                                          Colors.transparent,
                                                      padding:
                                                          const EdgeInsets.symmetric(
                                                            vertical: 10,
                                                          ),
                                                      tapTargetSize:
                                                          MaterialTapTargetSize
                                                              .shrinkWrap,
                                                      shape:
                                                          RoundedRectangleBorder(
                                                            borderRadius:
                                                                BorderRadius.circular(
                                                                  12,
                                                                ),
                                                            side:
                                                                BorderSide.none,
                                                          ),
                                                    ),
                                                icon: const Icon(
                                                  Icons.location_on_outlined,
                                                ),
                                                label: Text(
                                                  isGettingLocation
                                                      ? 'Getting Location...'
                                                      : 'Use My Location',
                                                ),
                                              ),
                                              shadows: const [
                                                BoxShadow(
                                                  color: Color.fromRGBO(120, 80, 40, 0.08),
                                                  offset: Offset(0, 1),
                                                  blurRadius: 0,
                                                  spreadRadius: 0,
                                                ),
                                                BoxShadow(
                                                  color: Color.fromRGBO(94, 62, 30, 0.035),
                                                  offset: Offset(0, 2),
                                                  blurRadius: 6,
                                                  spreadRadius: 0,
                                                ),
                                              ],
                                            ),
                                            ),
                                          ),
                                          const SizedBox(width: 10),
                                          SizedBox(
                                            height: 40,
                                            child: PressableScale(
                                              enabled: !isGettingLocation,
                                              child: _biteSaverRedTileControl(
                                              ElevatedButton(
                                                onPressed: isGettingLocation
                                                    ? null
                                                    : () => useMyLocation(
                                                        allRestaurants,
                                                      ),
                                                style:
                                                    ElevatedButton.styleFrom(
                                                      minimumSize:
                                                          const Size(110, 0),
                                                      backgroundColor:
                                                          Colors.transparent,
                                                      foregroundColor:
                                                          Colors.white,
                                                      elevation: 0,
                                                      shadowColor:
                                                          Colors.transparent,
                                                      shape:
                                                          RoundedRectangleBorder(
                                                            borderRadius:
                                                                BorderRadius.circular(
                                                                  14,
                                                                ),
                                                            side:
                                                                BorderSide.none,
                                                          ),
                                                      textStyle:
                                                          const TextStyle(
                                                            fontWeight:
                                                                FontWeight.w800,
                                                          ),
                                                    ),
                                                child: const Text('Refresh'),
                                              ),
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
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
                                          decoration: InputDecoration(
                                            filled: true,
                                            fillColor: const Color(
                                              0xFFFFFAF5,
                                            ),
                                            isDense: true,
                                            contentPadding:
                                                const EdgeInsets.symmetric(
                                                  horizontal: 18,
                                                  vertical: 10,
                                                ),
                                            border: OutlineInputBorder(
                                              borderRadius:
                                                  BorderRadius.circular(12),
                                              borderSide: BorderSide.none,
                                            ),
                                            enabledBorder: OutlineInputBorder(
                                              borderRadius:
                                                  BorderRadius.circular(12),
                                              borderSide: BorderSide.none,
                                            ),
                                            focusedBorder: OutlineInputBorder(
                                              borderRadius:
                                                  BorderRadius.circular(12),
                                              borderSide: BorderSide.none,
                                            ),
                                          ),
                                          iconEnabledColor: const Color(
                                            0xFFB7613F,
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
                                        shadows: const [
                                          BoxShadow(
                                            color: Color.fromRGBO(120, 80, 40, 0.08),
                                            offset: Offset(0, 1),
                                            blurRadius: 0,
                                            spreadRadius: 0,
                                          ),
                                          BoxShadow(
                                            color: Color.fromRGBO(94, 62, 30, 0.035),
                                            offset: Offset(0, 2),
                                            blurRadius: 6,
                                            spreadRadius: 0,
                                          ),
                                        ],
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
                                              ? const Color(0xFFB7613F)
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
                                  icon: const Icon(
                                    Icons.keyboard_arrow_up,
                                    color: Color(0xFFB7613F),
                                  ),
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
              backgroundColor: const Color(0xFFFCF9F5),
              body: Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Color(0xFFFFFEFC), Color(0xFFF8F1E9)],
                  ),
                ),
                child: CustomScrollView(
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

class _ImmediatePressFeedback extends StatefulWidget {
  final Widget child;
  final BorderRadius borderRadius;

  const _ImmediatePressFeedback({
    required this.child,
    required this.borderRadius,
  });

  @override
  State<_ImmediatePressFeedback> createState() => _ImmediatePressFeedbackState();
}

class _ImmediatePressFeedbackState extends State<_ImmediatePressFeedback> {
  bool _pressed = false;

  Duration get _duration => Duration(milliseconds: _pressed ? 75 : 120);

  void _setPressed(bool value) {
    if (_pressed == value) return;
    setState(() {
      _pressed = value;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _setPressed(true),
      onPointerUp: (_) => _setPressed(false),
      onPointerCancel: (_) => _setPressed(false),
      child: AnimatedContainer(
        duration: _duration,
        curve: Curves.easeOut,
        decoration: BoxDecoration(
          borderRadius: widget.borderRadius,
          boxShadow: _pressed
              ? const [
                  BoxShadow(
                    color: Color.fromRGBO(48, 30, 16, 0.08),
                    blurRadius: 8,
                    offset: Offset(0, 4),
                  ),
                ]
              : const [],
        ),
        child: AnimatedScale(
          scale: _pressed ? 0.968 : 1.0,
          duration: _duration,
          curve: Curves.easeOut,
          child: AnimatedOpacity(
            opacity: _pressed ? 0.965 : 1.0,
            duration: _duration,
            curve: Curves.easeOut,
            child: Stack(
              children: [
                widget.child,
                Positioned.fill(
                  child: IgnorePointer(
                    child: ClipRRect(
                      borderRadius: widget.borderRadius,
                      child: AnimatedContainer(
                        duration: _duration,
                        curve: Curves.easeOut,
                        color: _pressed
                            ? const Color.fromRGBO(38, 24, 12, 0.05)
                            : Colors.transparent,
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
}

class _RestaurantCardShellPressable extends StatefulWidget {
  final VoidCallback onTap;
  final String title;
  final String subtitle;
  final List<Widget> couponChildren;
  final BorderRadius shellRadius;
  final Widget shellChild;

  const _RestaurantCardShellPressable({
    required this.onTap,
    required this.title,
    required this.subtitle,
    required this.couponChildren,
    required this.shellRadius,
    required this.shellChild,
  });

  @override
  State<_RestaurantCardShellPressable> createState() =>
      _RestaurantCardShellPressableState();
}

class _RestaurantCardShellPressableState
    extends State<_RestaurantCardShellPressable> {
  bool _pressed = false;

  Duration get _duration => Duration(milliseconds: _pressed ? 75 : 120);

  void _setPressed(bool value) {
    if (_pressed == value) return;
    setState(() {
      _pressed = value;
    });
  }

  Widget _headerContent() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                widget.title,
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
              color: Color(0xFF94482E),
            ),
          ],
        ),
        const SizedBox(height: 3),
        Text(
          widget.subtitle,
          style: TextStyle(
            color: Colors.black.withOpacity(0.65),
            fontSize: 13,
            fontWeight: FontWeight.w500,
            height: 1.22,
            letterSpacing: 0.01,
          ),
        ),
        const SizedBox(height: 12),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      child: Stack(
        children: [
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTapDown: (_) => _setPressed(true),
              onTapUp: (_) => _setPressed(false),
              onTapCancel: () => _setPressed(false),
              onTap: widget.onTap,
              child: AnimatedContainer(
                duration: _duration,
                curve: Curves.easeOut,
                decoration: BoxDecoration(
                  borderRadius: widget.shellRadius,
                  boxShadow: _pressed
                      ? const [
                          BoxShadow(
                            color: Color.fromRGBO(48, 30, 16, 0.10),
                            blurRadius: 10,
                            offset: Offset(0, 5),
                          ),
                        ]
                      : const [],
                ),
                child: AnimatedScale(
                  scale: _pressed ? 0.968 : 1.0,
                  duration: _duration,
                  curve: Curves.easeOut,
                  child: AnimatedOpacity(
                    opacity: _pressed ? 0.965 : 1.0,
                    duration: _duration,
                    curve: Curves.easeOut,
                    child: Stack(
                      children: [
                        widget.shellChild,
                        Positioned.fill(
                          child: IgnorePointer(
                            child: ClipRRect(
                              borderRadius: widget.shellRadius,
                              child: AnimatedContainer(
                                duration: _duration,
                                curve: Curves.easeOut,
                                color: _pressed
                                    ? const Color.fromRGBO(38, 24, 12, 0.05)
                                    : Colors.transparent,
                              ),
                            ),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 14, 16, 15),
                          child: _headerContent(),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 15),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                IgnorePointer(
                  child: Opacity(
                    opacity: 0,
                    child: _headerContent(),
                  ),
                ),
                ...widget.couponChildren,
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RestaurantShellPressable extends StatefulWidget {
  final VoidCallback onTap;
  final BorderRadius borderRadius;
  final Widget child;

  const _RestaurantShellPressable({
    required this.onTap,
    required this.borderRadius,
    required this.child,
  });

  @override
  State<_RestaurantShellPressable> createState() =>
      _RestaurantShellPressableState();
}

class _RestaurantShellPressableState extends State<_RestaurantShellPressable> {
  bool _pressed = false;

  void _setPressed(bool value) {
    if (_pressed == value) return;
    setState(() {
      _pressed = value;
    });
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => _setPressed(true),
      onTapUp: (_) => _setPressed(false),
      onTapCancel: () => _setPressed(false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _pressed ? 0.978 : 1.0,
        duration: const Duration(milliseconds: 100),
        curve: Curves.easeOut,
        child: AnimatedOpacity(
          opacity: _pressed ? 0.98 : 1.0,
          duration: const Duration(milliseconds: 100),
          curve: Curves.easeOut,
          child: Stack(
            children: [
              widget.child,
              Positioned.fill(
                child: IgnorePointer(
                  child: ClipRRect(
                    borderRadius: widget.borderRadius,
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 100),
                      curve: Curves.easeOut,
                      color: _pressed
                          ? const Color.fromRGBO(38, 24, 12, 0.05)
                          : Colors.transparent,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

