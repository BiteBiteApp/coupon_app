import 'dart:async';
import 'dart:io' show Platform;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/coupon.dart';
import '../models/daily_special.dart';
import '../models/demo_redemption_store.dart';
import '../models/restaurant.dart';
import '../services/app_mode_state_service.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_sign_in_gate.dart';
import '../services/bitescore_service.dart';
import '../services/restaurant_account_service.dart';
import '../services/shared_location_state_service.dart';
import '../widgets/bitesaver_colors.dart';
import '../widgets/bitesaver_restaurant_images.dart';
import '../widgets/pressable_scale.dart';
import 'coupon_detail_screen.dart';
import 'restaurant_profile_screen.dart';
import 'restaurant_specials_screen.dart';

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
  final Stream<QuerySnapshot<Map<String, dynamic>>>? approvedAccountsStream;
  final Future<List<Restaurant>> Function()? restaurantLoader;
  final bool initializeFirebaseBackedState;

  const HomeScreen({
    super.key,
    this.approvedAccountsStream,
    this.restaurantLoader,
    this.initializeFirebaseBackedState = true,
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  static const double _collapsedHeaderExtent = 60;
  static const double _tightExpandedHeaderExtent = 219;
  static const double _regularExpandedHeaderExtent = 222;
  static const String _selectedRadiusPreferenceKey = 'selected_radius';
  String selectedRadius = '15 miles';
  String searchQuery = '';
  final TextEditingController searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();
  String generalSearchQuery = '';
  final TextEditingController generalSearchController = TextEditingController();
  final ScrollController _listScrollController = ScrollController();
  final Set<String> _favoriteRestaurantKeys = <String>{};
  final Set<String> _savingFavoriteRestaurantKeys = <String>{};
  final Set<String> _expandedRestaurantDealKeys = <String>{};

  bool usingCurrentLocation = false;
  bool usingTypedSearchLocation = false;
  bool isGettingLocation = false;
  bool isSearchingLocation = false;

  String? detectedCity;
  String? detectedZip;
  String? locationStatusMessage;
  String? _favoriteRestaurantsSignature;
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
    if (widget.initializeFirebaseBackedState) {
      DemoRedemptionStore.ensureInitialized();
    }
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
    searchController.text = sharedLocation.usingCurrentLocation
        ? ''
        : sharedLocation.searchText;
    searchQuery = sharedLocation.usingCurrentLocation
        ? ''
        : sharedLocation.searchText;
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
          await (widget.restaurantLoader?.call() ??
              RestaurantAccountService.loadApprovedRestaurantsWithCoupons());
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

  static bool _usesTightHeaderLayout(double width) => width < 430;

  static double _heroTextScaleHeightAdjustment(
    double width,
    TextScaler textScaler,
  ) {
    final heroFontSize = _usesTightHeaderLayout(width) ? 28.0 : 33.0;
    final scaledFontSize = textScaler.scale(heroFontSize);
    return ((scaledFontSize - heroFontSize) * 2 * 1.04).clamp(
      0,
      double.infinity,
    );
  }

  static double _expandedHeaderExtentFor(double width, TextScaler textScaler) {
    final baseExtent = _usesTightHeaderLayout(width)
        ? _tightExpandedHeaderExtent
        : _regularExpandedHeaderExtent;
    return baseExtent + _heroTextScaleHeightAdjustment(width, textScaler);
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
      final locations = await SharedLocationStateService.geocodeSearchQuery(
        query,
      );

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
        searchQuery = '';
        searchController.clear();
        locationStatusMessage = 'Using your current location.';
      });
      SharedLocationStateService.saveCurrentLocation(
        position: position,
        searchText: '',
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

    return _normalizeCityForExactMatch(restaurant.city) ==
            _normalizeCityForExactMatch(trimmedQuery) ||
        restaurant.zipCode.trim() == trimmedQuery;
  }

  String _normalizeCityForExactMatch(String value) {
    return value.split(',').first.trim().toLowerCase();
  }

  bool matchesRestaurantSearch(Restaurant restaurant) {
    final query = _normalizeRestaurantSearchText(generalSearchQuery);
    if (query.isEmpty) {
      return true;
    }

    return _normalizeRestaurantSearchText(restaurant.name).contains(query) ||
        _normalizeRestaurantSearchText(restaurant.city).contains(query) ||
        _normalizeRestaurantSearchText(restaurant.zipCode).contains(query) ||
        _normalizeRestaurantSearchText(restaurant.bio ?? '').contains(query);
  }

  bool matchesGeneralSearch(Restaurant restaurant, Coupon coupon) {
    final query = _normalizeRestaurantSearchText(generalSearchQuery);
    if (query.isEmpty) {
      return true;
    }

    return matchesRestaurantSearch(restaurant) ||
        _normalizeRestaurantSearchText(coupon.title).contains(query) ||
        _normalizeRestaurantSearchText(coupon.restaurant).contains(query) ||
        _normalizeRestaurantSearchText(coupon.usageRule).contains(query) ||
        _normalizeRestaurantSearchText(coupon.couponCode ?? '').contains(query);
  }

  bool matchesDailySpecialSearch(Restaurant restaurant, DailySpecial special) {
    final query = _normalizeRestaurantSearchText(generalSearchQuery);
    if (query.isEmpty) {
      return true;
    }

    return matchesRestaurantSearch(restaurant) ||
        _normalizeRestaurantSearchText(special.title).contains(query) ||
        _normalizeRestaurantSearchText(special.details ?? '').contains(query);
  }

  String _normalizeRestaurantSearchText(String value) {
    return value
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r"[\u2018\u2019\u201B\u2032']"), '')
        .replaceAll(RegExp(r'[^a-z0-9]+'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
  }

  String _toTitleCase(String value) {
    final words = value
        .trim()
        .split(RegExp(r'\s+'))
        .where((word) => word.isNotEmpty)
        .toList();
    if (words.isEmpty) return value.trim();
    return words
        .map(
          (word) => word.length == 1
              ? word.toUpperCase()
              : '${word[0].toUpperCase()}${word.substring(1).toLowerCase()}',
        )
        .join(' ');
  }

  String _formatRestaurantLocationLine(Restaurant restaurant) {
    final distance = restaurant.distance
        .replaceAll('miles away', 'mi')
        .replaceAll('mile away', 'mi')
        .trim();
    final city = _toTitleCase(restaurant.city);
    final hasDistance =
        distance.isNotEmpty && distance != Restaurant.defaultDistanceLabel;
    if (hasDistance && city.isNotEmpty) {
      return '$distance • $city';
    }
    if (hasDistance) {
      return distance;
    }
    return city.isEmpty ? 'Location unavailable' : city;
  }

  String _formatCouponMetaLine(Coupon coupon, {required bool proximityOnly}) {
    final parts = <String>[
      if (proximityOnly) 'Unlocked nearby',
      if (coupon.couponCode != null) 'Code: ${coupon.couponCode}',
    ];
    return parts.join(' • ');
  }

  List<Restaurant> filterRestaurants(List<Restaurant> allRestaurants) {
    final radius = selectedRadiusMiles();
    final center = activeSearchCenter;
    final now = DateTime.now();
    final results =
        <
          ({
            Restaurant restaurant,
            List<DailySpecial> dailySpecials,
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
      final displayableDailySpecials =
          DailySpecial.visibleSpecialsAt(restaurant.dailySpecials, now)
              .where(
                (special) => matchesDailySpecialSearch(restaurant, special),
              )
              .toList();

      if (availableCoupons.isEmpty && displayableDailySpecials.isEmpty) {
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
        dailySpecials: displayableDailySpecials,
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
        uid: result.restaurant.uid,
        name: result.restaurant.name,
        distance: result.exactMatch
            ? 'Local'
            : restaurantDistanceLabel(result.restaurant),
        city: result.restaurant.city,
        state: result.restaurant.state,
        zipCode: result.restaurant.zipCode,
        streetAddress: result.restaurant.streetAddress,
        phone: result.restaurant.phone,
        website: result.restaurant.website,
        bio: result.restaurant.bio,
        mainImageUrl: result.restaurant.mainImageUrl,
        businessHours: result.restaurant.businessHours,
        dailySpecials: result.dailySpecials,
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
      return '"$contentQuery" \u2022 $restaurantCount restaurants \u2022 $couponCount coupons';
    }

    if (usingCurrentLocation) {
      return 'Live location \u2022 $restaurantCount restaurants \u2022 $couponCount coupons';
    }

    final query = typedSearchCenter?.label ?? searchQuery.trim();
    if (query.isNotEmpty) {
      return '$query \u2022 $restaurantCount restaurants \u2022 $couponCount coupons';
    }

    if (locationStatusMessage != null && locationStatusMessage!.isNotEmpty) {
      return locationStatusMessage!;
    }

    return '$restaurantCount restaurants \u2022 $couponCount coupons';
  }

  List<BoxShadow> _biteSaverTileShadows({
    double strength = 1,
    double opacityBoost = 0,
  }) {
    return [
      BoxShadow(
        color: BiteSaverColors.coolShadow.withValues(
          alpha: 0.06 + opacityBoost / 2,
        ),
        blurRadius: 10.5 * strength,
        offset: Offset(0, 6 * strength),
      ),
      BoxShadow(
        color: BiteSaverColors.coolShadow.withValues(
          alpha: 0.10 + opacityBoost / 2,
        ),
        blurRadius: 2.1 * strength,
        offset: Offset(0, 2.4 * strength),
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
    Color shellBorderColor = BiteSaverColors.border,
    Color highlightBorderColor = const Color(0xF7FFFFFF),
    Color faceBorderColor = Colors.transparent,
    Gradient shellGradient = const LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: [
        BiteSaverColors.surface,
        BiteSaverColors.secondaryBackground,
        BiteSaverColors.subtleSurface,
        BiteSaverColors.border,
      ],
      stops: [0.0, 0.34, 0.72, 1.0],
    ),
    Gradient faceGradient = const LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: [
        BiteSaverColors.surface,
        BiteSaverColors.secondaryBackground,
        BiteSaverColors.subtleSurface,
      ],
    ),
    EdgeInsetsGeometry innerMargin = const EdgeInsets.all(1.8),
    List<BoxShadow>? shadows,
  }) {
    final shellColors = _biteSaverGradientColors(shellGradient);
    final faceColors = _biteSaverGradientColors(faceGradient);
    final adjustedFaceColors = faceColors.isNotEmpty
        ? faceColors.toList(growable: false)
        : const <Color>[
            BiteSaverColors.surface,
            BiteSaverColors.secondaryBackground,
            BiteSaverColors.subtleSurface,
          ];
    final adjustedFaceGradient = faceGradient is LinearGradient
        ? LinearGradient(
            begin: faceGradient.begin,
            end: faceGradient.end,
            colors: adjustedFaceColors,
            stops: faceGradient.stops,
            tileMode: faceGradient.tileMode,
            transform: faceGradient.transform,
          )
        : faceGradient is RadialGradient
        ? RadialGradient(
            center: faceGradient.center,
            radius: faceGradient.radius,
            colors: adjustedFaceColors,
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
            colors: adjustedFaceColors,
            stops: faceGradient.stops,
            tileMode: faceGradient.tileMode,
            transform: faceGradient.transform,
          )
        : faceGradient;
    final rawShellBottomColor = shellColors.isNotEmpty
        ? shellColors.last
        : BiteSaverColors.borderStrong;
    final shellBottomColor =
        Color.lerp(rawShellBottomColor, BiteSaverColors.borderStrong, 0.14) ??
        rawShellBottomColor;
    final faceTopColor = adjustedFaceColors.isNotEmpty
        ? adjustedFaceColors.first
        : BiteSaverColors.surface;
    final lipColor =
        Color.lerp(shellBottomColor, BiteSaverColors.borderStrong, 0.28) ??
        shellBottomColor;
    final resolvedShadows = <BoxShadow>[
      const BoxShadow(
        color: Color.fromRGBO(15, 23, 42, 0.12),
        blurRadius: 1,
        spreadRadius: 0,
        offset: Offset(0, -1),
      ),
      const BoxShadow(
        color: Color.fromRGBO(15, 23, 42, 0.08),
        blurRadius: 1,
        spreadRadius: 0,
        offset: Offset(0, 0),
      ),
      const BoxShadow(
        color: Color.fromRGBO(15, 23, 42, 0.04),
        blurRadius: 8,
        offset: Offset(0, -1),
      ),
      const BoxShadow(
        color: Color.fromRGBO(15, 23, 42, 0.03),
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
                    color: BiteSaverColors.coolShadow.withValues(alpha: 0.08),
                    blurRadius: 1.5,
                    offset: const Offset(0, 1.3),
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
                              right: BorderSide(
                                color: Colors.white,
                                width: 0.7,
                              ),
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
                                : Border.all(
                                    color: faceBorderColor,
                                    width: 0.35,
                                  ),
                            boxShadow: [
                              BoxShadow(
                                color: BiteSaverColors.coolShadow.withValues(
                                  alpha: 0.035,
                                ),
                                blurRadius: 1.8,
                                offset: const Offset(0, 1.0),
                              ),
                            ],
                          ),
                          child: ClipRRect(
                            borderRadius: faceRadius,
                            child: child,
                          ),
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

  Widget _biteSaverLightTileControl(Widget child, {List<BoxShadow>? shadows}) {
    return _biteSaverTile(
      shellRadius: BorderRadius.circular(14),
      faceRadius: BorderRadius.circular(12.5),
      innerMargin: const EdgeInsets.all(1.6),
      shadows:
          shadows ?? _biteSaverTileShadows(strength: 0.72, opacityBoost: 0.01),
      child: child,
    );
  }

  Widget _biteSaverRedTileControl(Widget child, {List<BoxShadow>? shadows}) {
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
      shadows:
          shadows ??
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

  Widget buildCouponCard(Coupon coupon, BuildContext context) {
    final proximityOnly = isProximityCoupon(coupon);

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      child: _ImmediatePressFeedback(
        borderRadius: BorderRadius.circular(17),
        child: _biteSaverTile(
          shellRadius: BorderRadius.circular(17),
          faceRadius: BorderRadius.circular(15.5),
          shellBorderColor: BiteSaverColors.border,
          highlightBorderColor: const Color(0xF7FFFFFF),
          faceBorderColor: Colors.transparent,
          shellGradient: const LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              BiteSaverColors.surface,
              BiteSaverColors.secondaryBackground,
              BiteSaverColors.subtleSurface,
              BiteSaverColors.border,
            ],
            stops: [0.0, 0.34, 0.72, 1.0],
          ),
          faceGradient: const LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              BiteSaverColors.surface,
              BiteSaverColors.secondaryBackground,
              BiteSaverColors.subtleSurface,
            ],
          ),
          innerMargin: const EdgeInsets.all(1.7),
          shadows: [
            const BoxShadow(
              color: Color.fromRGBO(15, 23, 42, 0.12),
              offset: Offset(0, 2),
              blurRadius: 0,
              spreadRadius: 0,
            ),
            ..._biteSaverTileShadows(strength: 0.82, opacityBoost: 0.008),
          ],
          child: Material(
            color: Colors.transparent,
            child: ListTile(
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 15,
                vertical: 7,
              ),
              title: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (proximityOnly)
                    Container(
                      margin: const EdgeInsets.only(bottom: 5),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 2.5,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFB7613F),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: const Text(
                        'Proximity Deal',
                        style: TextStyle(
                          color: Color(0xF5FFFFFF),
                          fontSize: 10.6,
                          fontWeight: FontWeight.w700,
                          height: 1.0,
                          letterSpacing: 0.14,
                        ),
                      ),
                    ),
                  Text(
                    coupon.title.trim().isEmpty
                        ? 'Untitled coupon'
                        : coupon.title.trim(),
                    style: const TextStyle(
                      color: BiteSaverColors.ink,
                      fontSize: 16.4,
                      fontWeight: FontWeight.w700,
                      height: 1.06,
                      letterSpacing: 0.02,
                    ),
                  ),
                ],
              ),
              trailing: const SizedBox(
                width: 24,
                height: 24,
                child: Center(
                  child: Icon(
                    Icons.chevron_right,
                    color: BiteSaverColors.orangeDark,
                    size: 21,
                  ),
                ),
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

  Future<void> openRestaurantProfile(Restaurant restaurant) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => RestaurantProfileScreen(restaurant: restaurant),
      ),
    );
    if (mounted) {
      _favoriteRestaurantsSignature = null;
      setState(() {});
    }
  }

  String _restaurantFavoriteKey(Restaurant restaurant) {
    final keySource = [
      restaurant.name,
      restaurant.city,
      restaurant.zipCode,
      restaurant.streetAddress ?? '',
    ].join('_').toLowerCase();
    final normalizedKey = keySource
        .replaceAll(RegExp(r'[^a-z0-9]+'), '_')
        .replaceAll(RegExp(r'^_+|_+$'), '');
    return normalizedKey.isEmpty
        ? 'bitesaver_restaurant'
        : 'bitesaver_$normalizedKey';
  }

  String _favoriteStatusSignature(List<Restaurant> restaurants) {
    final authScope = BiteScoreSignInGate.canCurrentUserSaveFavorites
        ? 'signed-in'
        : 'guest';
    return '$authScope:${restaurants.map(_restaurantFavoriteKey).join('|')}';
  }

  Future<void> _loadRestaurantFavoriteStatuses(
    List<Restaurant> restaurants,
  ) async {
    final signature = _favoriteStatusSignature(restaurants);
    if (_favoriteRestaurantsSignature == signature) {
      return;
    }
    _favoriteRestaurantsSignature = signature;

    if (!BiteScoreSignInGate.canCurrentUserSaveFavorites) {
      if (_favoriteRestaurantKeys.isNotEmpty && mounted) {
        setState(() {
          _favoriteRestaurantKeys.clear();
        });
      }
      return;
    }

    final favoriteKeys = <String>{};
    for (final restaurant in restaurants) {
      final isFavorite =
          await BiteScoreService.isSaverRestaurantFavoritedByCurrentUser(
            restaurant,
          );
      if (isFavorite) {
        favoriteKeys.add(_restaurantFavoriteKey(restaurant));
      }
    }

    if (!mounted) {
      return;
    }
    setState(() {
      _favoriteRestaurantKeys
        ..clear()
        ..addAll(favoriteKeys);
    });
  }

  Future<void> _toggleRestaurantFavorite(Restaurant restaurant) async {
    final key = _restaurantFavoriteKey(restaurant);
    if (_savingFavoriteRestaurantKeys.contains(key)) {
      return;
    }

    final canSave = await BiteScoreSignInGate.ensureSignedInForFavorites(
      context,
      returnToOriginAfterSignIn: true,
    );
    if (!canSave || !mounted) {
      return;
    }

    final nextIsFavorite = !_favoriteRestaurantKeys.contains(key);
    setState(() {
      _savingFavoriteRestaurantKeys.add(key);
      if (nextIsFavorite) {
        _favoriteRestaurantKeys.add(key);
      } else {
        _favoriteRestaurantKeys.remove(key);
      }
    });

    try {
      await BiteScoreService.setSaverRestaurantFavorite(
        restaurant: restaurant,
        isFavorite: nextIsFavorite,
      );
    } catch (error) {
      if (mounted) {
        setState(() {
          if (nextIsFavorite) {
            _favoriteRestaurantKeys.remove(key);
          } else {
            _favoriteRestaurantKeys.add(key);
          }
        });
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(
              content: Text(
                AppErrorText.friendly(
                  error,
                  fallback: 'Could not update this saved restaurant right now.',
                ),
              ),
            ),
          );
      }
    } finally {
      if (mounted) {
        setState(() {
          _savingFavoriteRestaurantKeys.remove(key);
        });
      }
    }
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
                          backgroundColor: const Color(0xFFE94312),
                          foregroundColor: Colors.white,
                          disabledBackgroundColor: const Color(
                            0xFFE94312,
                          ).withValues(alpha: 0.55),
                          disabledForegroundColor: Colors.white.withValues(
                            alpha: 0.82,
                          ),
                          elevation: 0,
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          textStyle: const TextStyle(
                            fontWeight: FontWeight.w800,
                          ),
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
                        color: BiteSaverColors.secondaryText,
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
                  style: const TextStyle(
                    color: BiteSaverColors.secondaryText,
                    height: 1.35,
                  ),
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
    final fallbackImagePaths =
        BiteSaverRestaurantPlaceholderImages.fallbackPathsForVisibleCards(
          filteredRestaurants.map((restaurant) => restaurant.mainImageUrl),
        );

    return SliverList(
      delegate: SliverChildBuilderDelegate(
        (context, index) {
          if (filteredRestaurants.isEmpty) {
            final nextRadius = _nextRadiusOption();
            final canIncreaseRadius = nextRadius != selectedRadius;

            return Padding(
              padding: const EdgeInsets.fromLTRB(0, 8, 0, 8),
              child: Container(
                decoration: BoxDecoration(
                  color: BiteSaverColors.surface,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: BiteSaverColors.border),
                  boxShadow: const [
                    BoxShadow(
                      color: Color.fromRGBO(15, 23, 42, 0.08),
                      blurRadius: 18,
                      offset: Offset(0, 10),
                    ),
                  ],
                ),
                child: Padding(
                  padding: const EdgeInsets.all(22),
                  child: Column(
                    children: [
                      const Icon(
                        Icons.local_offer_outlined,
                        color: Color(0xFFC97917),
                        size: 32,
                      ),
                      const SizedBox(height: 10),
                      const Text(
                        'No nearby deals yet',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: BiteSaverColors.ink,
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Try a larger radius, another ZIP code, or switch to BiteScore to find highly rated dishes nearby.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: BiteSaverColors.secondaryText,
                          height: 1.35,
                        ),
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
          return _buildModernRestaurantCard(
            restaurant: restaurant,
            index: index,
            fallbackImagePath: fallbackImagePaths[index],
          );
        },
        childCount: filteredRestaurants.isEmpty
            ? 1
            : filteredRestaurants.length,
      ),
    );
  }

  Widget _buildModernRestaurantCard({
    required Restaurant restaurant,
    required int index,
    required String fallbackImagePath,
  }) {
    final promoItems = _buildRestaurantPromoItems(restaurant);
    final title = restaurant.name.trim().isEmpty
        ? 'Restaurant'
        : restaurant.name.trim();
    final locationLine = _formatRestaurantLocationLine(restaurant);
    final favoriteKey = _restaurantFavoriteKey(restaurant);
    final isFavoriteRestaurant = _favoriteRestaurantKeys.contains(favoriteKey);
    final isSavingFavoriteRestaurant = _savingFavoriteRestaurantKeys.contains(
      favoriteKey,
    );
    final isDealsExpanded = _expandedRestaurantDealKeys.contains(favoriteKey);
    final collapsedPromoItems = _buildCollapsedRestaurantPromoItems(promoItems);
    final visiblePromoItems = isDealsExpanded
        ? promoItems
        : collapsedPromoItems;
    final hiddenPromoCount = promoItems.length - collapsedPromoItems.length;

    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => openRestaurantProfile(restaurant),
          borderRadius: BorderRadius.circular(15),
          child: Ink(
            decoration: BoxDecoration(
              color: BiteSaverColors.surface,
              borderRadius: BorderRadius.circular(15),
              border: Border.all(color: BiteSaverColors.border, width: 0.7),
              boxShadow: const [
                BoxShadow(
                  color: Color.fromRGBO(15, 23, 42, 0.065),
                  blurRadius: 13,
                  offset: Offset(0, 6),
                ),
                BoxShadow(
                  color: Color.fromRGBO(15, 23, 42, 0.035),
                  blurRadius: 3,
                  offset: Offset(0, 1),
                ),
              ],
            ),
            child: Padding(
              padding: const EdgeInsets.all(5),
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final compact = constraints.maxWidth < 360;
                  final imageWidth = compact ? 102.0 : 121.0;
                  final imageRhythmOffset = index.isOdd ? 4.0 : -2.0;

                  return Stack(
                    clipBehavior: Clip.none,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          SizedBox(
                            width: imageWidth,
                            height: compact ? 98 : 113,
                            child: _SoftRestaurantImageFrame(
                              imageUrl: restaurant.mainImageUrl,
                              fallbackImagePath: fallbackImagePath,
                              verticalOffset: imageRhythmOffset,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        title,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                          color: BiteSaverColors.ink,
                                          fontSize: compact ? 16.7 : 17.6,
                                          fontWeight: FontWeight.w800,
                                          height: 1.08,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 3),
                                    const Icon(
                                      Icons.chevron_right,
                                      color: Color(0xFFE24A17),
                                      size: 20,
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 3),
                                Row(
                                  children: [
                                    const Icon(
                                      Icons.location_on,
                                      color: Color(0xFF5F8F25),
                                      size: 15,
                                    ),
                                    const SizedBox(width: 3),
                                    Expanded(
                                      child: Text(
                                        locationLine,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          color: BiteSaverColors.secondaryText,
                                          fontSize: 12.7,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 5),
                                AnimatedSize(
                                  duration: const Duration(milliseconds: 180),
                                  curve: Curves.easeOutCubic,
                                  alignment: Alignment.topCenter,
                                  child: Column(
                                    children: [
                                      if (visiblePromoItems.isNotEmpty)
                                        _buildStaggeredPromoPreviewStack(
                                          visiblePromoItems,
                                          restaurant,
                                          compact: compact,
                                        ),
                                      if (hiddenPromoCount > 0) ...[
                                        const SizedBox(height: 5),
                                        _buildMoreDealsToggle(
                                          restaurantKey: favoriteKey,
                                          hiddenCount: hiddenPromoCount,
                                          isExpanded: isDealsExpanded,
                                        ),
                                      ],
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      if (isFavoriteRestaurant)
                        Positioned(
                          left: -6,
                          bottom: -6,
                          child: SizedBox(
                            width: 24,
                            height: 23,
                            child: IconButton(
                              tooltip: 'Unsave restaurant',
                              onPressed: isSavingFavoriteRestaurant
                                  ? null
                                  : () => _toggleRestaurantFavorite(restaurant),
                              visualDensity: VisualDensity.compact,
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints.tightFor(
                                width: 24,
                                height: 23,
                              ),
                              icon: Icon(
                                Icons.favorite,
                                color: Colors.red.shade400,
                                size: 18,
                                shadows: const [
                                  Shadow(
                                    color: Color.fromRGBO(15, 23, 42, 0.18),
                                    blurRadius: 5,
                                    offset: Offset(0, 2),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                    ],
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }

  List<_RestaurantPromoItem> _buildRestaurantPromoItems(Restaurant restaurant) {
    return <_RestaurantPromoItem>[
      for (final special in restaurant.dailySpecials)
        _RestaurantPromoItem.dailySpecial(special),
      for (final coupon in restaurant.coupons)
        _RestaurantPromoItem.coupon(coupon),
    ];
  }

  List<_RestaurantPromoItem> _buildCollapsedRestaurantPromoItems(
    List<_RestaurantPromoItem> promoItems,
  ) {
    final specialItems = promoItems
        .where((item) => item.dailySpecial != null)
        .toList();
    final couponItems = promoItems
        .where((item) => item.coupon != null)
        .toList();

    if (specialItems.isNotEmpty && couponItems.isNotEmpty) {
      return <_RestaurantPromoItem>[specialItems.first, couponItems.first];
    }

    if (specialItems.isNotEmpty) {
      return specialItems.take(2).toList();
    }

    if (couponItems.isNotEmpty) {
      return couponItems.take(2).toList();
    }

    return const <_RestaurantPromoItem>[];
  }

  Widget _buildMoreDealsToggle({
    required String restaurantKey,
    required int hiddenCount,
    required bool isExpanded,
  }) {
    final label = isExpanded
        ? '▲ Show fewer deals'
        : '▼ $hiddenCount more ${hiddenCount == 1 ? 'deal' : 'deals'}';

    return InkWell(
      onTap: () {
        setState(() {
          if (isExpanded) {
            _expandedRestaurantDealKeys.remove(restaurantKey);
          } else {
            _expandedRestaurantDealKeys.add(restaurantKey);
          }
        });
      },
      borderRadius: BorderRadius.circular(9),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
        child: Align(
          alignment: Alignment.centerLeft,
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: BiteSaverColors.ink,
              fontSize: 11.6,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStaggeredPromoPreviewStack(
    List<_RestaurantPromoItem> items,
    Restaurant restaurant, {
    required bool compact,
  }) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final availableWidth = constraints.maxWidth;
        final horizontalOffset =
            BiteSaverHomeDealBubbleStagger.horizontalOffsetFor(
              availableWidth: availableWidth,
              compact: compact,
            );
        final showBubble = items.length > 1;

        return SizedBox(
          height: BiteSaverHomeDealBubbleStagger.stackHeightFor(
            itemCount: items.length,
            compact: compact,
          ),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              for (var index = 0; index < items.length; index += 1)
                _buildStaggeredPromoPreviewPosition(
                  item: items[index],
                  restaurant: restaurant,
                  index: index,
                  compact: compact,
                  availableWidth: availableWidth,
                  horizontalOffset: horizontalOffset,
                  showBubble: showBubble,
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildStaggeredPromoPreviewPosition({
    required _RestaurantPromoItem item,
    required Restaurant restaurant,
    required int index,
    required bool compact,
    required double availableWidth,
    required double horizontalOffset,
    required bool showBubble,
  }) {
    final shiftsBubbleLeft = BiteSaverHomeDealBubbleStagger.isLeftPosition(
      index,
    );
    final bodyLeadingInset = showBubble && shiftsBubbleLeft
        ? horizontalOffset
        : 0.0;
    final positionedLeft = showBubble && shiftsBubbleLeft
        ? -horizontalOffset
        : 0.0;
    final bubbleCenterX = showBubble && shiftsBubbleLeft
        ? availableWidth * BiteSaverHomeDealBubbleClipper.bubbleCenterFraction
        : null;

    return Positioned(
      top: BiteSaverHomeDealBubbleStagger.topFor(
        index: index,
        compact: compact,
      ),
      left: positionedLeft,
      width: availableWidth + bodyLeadingInset,
      child: _buildPromoPreview(
        item,
        restaurant,
        rectangularBodyLeadingInset: bodyLeadingInset,
        bubbleCenterX: bubbleCenterX,
        showBubble: showBubble,
      ),
    );
  }

  Widget _buildPromoPreview(
    _RestaurantPromoItem item,
    Restaurant restaurant, {
    double rectangularBodyLeadingInset = 0,
    double? bubbleCenterX,
    bool showBubble = false,
  }) {
    final special = item.dailySpecial;
    if (special != null) {
      return _buildDailySpecialPreview(
        special,
        restaurant,
        rectangularBodyLeadingInset: rectangularBodyLeadingInset,
        bubbleCenterX: bubbleCenterX,
        showBubble: showBubble,
      );
    }

    return _buildCouponPreview(
      item.coupon!,
      restaurant,
      rectangularBodyLeadingInset: rectangularBodyLeadingInset,
      bubbleCenterX: bubbleCenterX,
      showBubble: showBubble,
    );
  }

  Widget _buildDailySpecialPreview(
    DailySpecial special,
    Restaurant restaurant, {
    double rectangularBodyLeadingInset = 0,
    double? bubbleCenterX,
    bool showBubble = false,
  }) {
    final title = special.title.trim().isEmpty
        ? 'Today: Daily special'
        : 'Today: ${special.title.trim()}';

    return BiteSaverHomeDealBubble(
      onTap: () {
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) =>
                RestaurantSpecialsScreen(restaurant: restaurant),
          ),
        );
      },
      backgroundColor: BiteSaverColors.secondaryBackground,
      borderColor: BiteSaverColors.borderStrong,
      rectangularBodyLeadingInset: rectangularBodyLeadingInset,
      bubbleCenterX: bubbleCenterX,
      showBubble: showBubble,
      child: Row(
        children: [
          const Icon(
            Icons.local_fire_department_outlined,
            color: Color(0xFFC95F17),
            size: 17,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Color(0xFFC95F17),
                fontSize: 14.1,
                fontWeight: FontWeight.w900,
                height: 1.05,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCouponPreview(
    Coupon coupon,
    Restaurant restaurant, {
    double rectangularBodyLeadingInset = 0,
    double? bubbleCenterX,
    bool showBubble = false,
  }) {
    final metaLine = _formatCouponMetaLine(
      coupon,
      proximityOnly: isProximityCoupon(coupon),
    );

    return BiteSaverHomeDealBubble(
      onTap: () async {
        await Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) =>
                CouponDetailScreen(coupon: coupon, restaurant: restaurant),
          ),
        );
        setState(() {});
      },
      backgroundColor: const Color(0xFFF8FCF2),
      borderColor: const Color(0xFFB9D99E),
      rectangularBodyLeadingInset: rectangularBodyLeadingInset,
      bubbleCenterX: bubbleCenterX,
      showBubble: showBubble,
      child: Row(
        children: [
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  coupon.title.trim().isEmpty
                      ? 'Limited time deal'
                      : coupon.title.trim(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: const Color(0xFF4E7B20),
                    fontSize: 14.1,
                    fontWeight: FontWeight.w900,
                    height: 1.05,
                  ),
                ),
                if (metaLine.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    metaLine,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: BiteSaverColors.secondaryText,
                      fontSize: 11.2,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 7),
          Icon(Icons.chevron_right, color: const Color(0xFF5F8F25), size: 18),
        ],
      ),
    );
  }

  Widget _buildHeader({
    required List<Restaurant> allRestaurants,
    required List<Restaurant> filteredRestaurants,
    required double expansionT,
  }) {
    final collapsed = expansionT <= 0.12;
    final statusLine = compactStatusLine(filteredRestaurants);

    InputDecoration searchDecoration({
      required String hint,
      required IconData icon,
      Widget? suffixIcon,
      EdgeInsetsGeometry contentPadding = const EdgeInsets.symmetric(
        horizontal: 16,
        vertical: 15,
      ),
    }) {
      return InputDecoration(
        filled: true,
        fillColor: BiteSaverColors.surface,
        hintText: hint,
        hintStyle: const TextStyle(
          color: BiteSaverColors.mutedInk,
          fontSize: 12.6,
          fontWeight: FontWeight.w500,
        ),
        prefixIcon: Icon(icon, color: BiteSaverColors.ink, size: 21),
        prefixIconConstraints: const BoxConstraints(
          minWidth: 32,
          minHeight: 36,
        ),
        suffixIcon: suffixIcon,
        suffixIconConstraints: const BoxConstraints(
          minWidth: 32,
          minHeight: 36,
        ),
        contentPadding: contentPadding,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(13),
          borderSide: const BorderSide(color: BiteSaverColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(13),
          borderSide: const BorderSide(color: BiteSaverColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(13),
          borderSide: const BorderSide(
            color: BiteSaverColors.orange,
            width: 1.25,
          ),
        ),
      );
    }

    Widget currentLocationButton(bool tight, double controlHeight) {
      return ElevatedButton.icon(
        onPressed: isGettingLocation
            ? null
            : () => useMyLocation(allRestaurants),
        icon: Icon(
          isGettingLocation ? Icons.hourglass_top : Icons.near_me_outlined,
          size: tight ? 17 : 21,
        ),
        label: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                isGettingLocation ? 'Locating...' : 'Use My Current Location',
                maxLines: 1,
                textScaler: TextScaler.noScaling,
                style: TextStyle(fontSize: tight ? 10.3 : 12.2),
              ),
            ),
            if (!tight)
              Text(
                'Find restaurants near you',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: tight ? 9.2 : 10.2,
                  fontWeight: FontWeight.w600,
                ),
              ),
          ],
        ),
        style: ElevatedButton.styleFrom(
          fixedSize: Size.fromHeight(controlHeight),
          backgroundColor: const Color(0xFFE94312),
          foregroundColor: Colors.white,
          elevation: 0,
          padding: EdgeInsets.symmetric(horizontal: tight ? 5 : 9),
          textStyle: const TextStyle(
            fontSize: 12.6,
            fontWeight: FontWeight.w800,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(11),
          ),
        ),
      );
    }

    Widget typedLocationButton(bool tight, double controlHeight) {
      return SizedBox(
        height: controlHeight,
        child: TextField(
          controller: searchController,
          focusNode: _searchFocusNode,
          onSubmitted: (_) => runSearch(allRestaurants),
          decoration: searchDecoration(
            hint: 'City or zip code',
            icon: Icons.location_on,
            contentPadding: EdgeInsets.symmetric(
              horizontal: tight ? 5 : 9,
              vertical: tight ? 6 : 8,
            ),
            suffixIcon: IconButton(
              onPressed: isSearchingLocation
                  ? null
                  : () => runSearch(allRestaurants),
              tooltip: 'Search location',
              icon: isSearchingLocation
                  ? const SizedBox(
                      width: 17,
                      height: 17,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(
                      Icons.arrow_forward,
                      color: BiteSaverColors.ink,
                      size: 18,
                    ),
            ),
          ),
        ),
      );
    }

    Widget radiusDropdown(bool tight, double controlHeight) {
      return SizedBox(
        height: controlHeight,
        child: LayoutBuilder(
          builder: (context, constraints) {
            return DropdownButtonFormField<String>(
              initialValue: selectedRadius,
              isExpanded: true,
              decoration: InputDecoration(
                filled: true,
                fillColor: BiteSaverColors.surface,
                isDense: true,
                contentPadding: EdgeInsets.symmetric(
                  horizontal: tight ? 7 : 8,
                  vertical: tight ? 5 : 6,
                ),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(11),
                  borderSide: const BorderSide(color: BiteSaverColors.border),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(11),
                  borderSide: const BorderSide(color: BiteSaverColors.border),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(11),
                  borderSide: const BorderSide(color: Color(0xFFD79A32)),
                ),
              ),
              style: TextStyle(
                color: BiteSaverColors.ink,
                fontSize: tight ? 11.7 : 12.2,
                fontWeight: FontWeight.w700,
              ),
              selectedItemBuilder: (context) => const [
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text('1 mi'),
                ),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text('3 mi'),
                ),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text('5 mi'),
                ),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text('10 mi'),
                ),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text('15 mi'),
                ),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text('20 mi'),
                ),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text('30 mi'),
                ),
              ],
              items: const [
                DropdownMenuItem(value: '1 mile', child: Text('1 mile')),
                DropdownMenuItem(value: '3 miles', child: Text('3 miles')),
                DropdownMenuItem(value: '5 miles', child: Text('5 miles')),
                DropdownMenuItem(value: '10 miles', child: Text('10 miles')),
                DropdownMenuItem(value: '15 miles', child: Text('15 miles')),
                DropdownMenuItem(value: '20 miles', child: Text('20 miles')),
                DropdownMenuItem(value: '30 miles', child: Text('30 miles')),
              ],
              onChanged: (value) {
                if (value == null) return;
                setState(() => selectedRadius = value);
                _saveSelectedRadius(value);
              },
            );
          },
        ),
      );
    }

    Widget restaurantSearchField(bool tight, double controlHeight) {
      return SizedBox(
        height: controlHeight,
        child: TextField(
          controller: generalSearchController,
          onSubmitted: (_) => runGeneralSearch(),
          decoration: searchDecoration(
            hint: tight
                ? 'Restaurants or cuisines...'
                : 'Search for restaurants or cuisines...',
            icon: Icons.search,
            contentPadding: EdgeInsets.symmetric(
              horizontal: 10,
              vertical: tight ? 6 : 8,
            ),
            suffixIcon: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (generalSearchQuery.trim().isNotEmpty)
                  IconButton(
                    onPressed: clearGeneralSearch,
                    tooltip: 'Clear search',
                    icon: const Icon(
                      Icons.close,
                      color: BiteSaverColors.softMutedInk,
                      size: 17,
                    ),
                  ),
                IconButton(
                  onPressed: runGeneralSearch,
                  tooltip: 'Search',
                  icon: const Icon(
                    Icons.arrow_forward,
                    color: BiteSaverColors.ink,
                    size: 18,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Material(
      color: BiteSaverColors.secondaryBackground,
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 180),
        layoutBuilder: (currentChild, previousChildren) {
          return Stack(
            alignment: Alignment.topCenter,
            children: <Widget>[...previousChildren, ?currentChild],
          );
        },
        child: collapsed
            ? Padding(
                key: const ValueKey('collapsed'),
                padding: const EdgeInsets.fromLTRB(10, 7, 10, 0),
                child: SizedBox(
                  height: 44,
                  child: Container(
                    padding: const EdgeInsets.only(left: 13, right: 5),
                    decoration: BoxDecoration(
                      color: BiteSaverColors.surface,
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: BiteSaverColors.border),
                      boxShadow: const [
                        BoxShadow(
                          color: Color.fromRGBO(15, 23, 42, 0.07),
                          blurRadius: 12,
                          offset: Offset(0, 5),
                        ),
                      ],
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            statusLine.isEmpty
                                ? 'Find local BiteSaver deals'
                                : statusLine,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: BiteSaverColors.ink,
                              fontSize: 13.4,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: _expandHeader,
                          visualDensity: VisualDensity.compact,
                          constraints: const BoxConstraints.tightFor(
                            width: 34,
                            height: 34,
                          ),
                          padding: EdgeInsets.zero,
                          icon: const Icon(
                            Icons.keyboard_arrow_down,
                            color: Color(0xFFE24A17),
                            size: 24,
                          ),
                          tooltip: 'Expand search',
                        ),
                      ],
                    ),
                  ),
                ),
              )
            : Opacity(
                key: const ValueKey('expanded'),
                opacity: expansionT,
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final width = constraints.maxWidth;
                    final tight = _usesTightHeaderLayout(width);
                    final controlHeight = tight ? 38.0 : 43.0;
                    final heroVisualHeight = tight ? 120.0 : 128.0;
                    final searchPanelOverlap = tight ? 10.0 : 12.0;
                    final heroLayoutHeight =
                        heroVisualHeight -
                        searchPanelOverlap +
                        _heroTextScaleHeightAdjustment(
                          width,
                          MediaQuery.textScalerOf(context),
                        );
                    final horizontalPadding = tight ? 8.0 : 10.0;
                    final searchPadding = tight ? 5.0 : 7.0;

                    return DecoratedBox(
                      decoration: const BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            BiteSaverColors.secondaryBackground,
                            BiteSaverColors.pageBackground,
                          ],
                        ),
                      ),
                      child: Column(
                        children: [
                          SizedBox(
                            key: const ValueKey('bitesaver-home-hero'),
                            height: heroLayoutHeight,
                            child: Padding(
                              padding: EdgeInsets.fromLTRB(
                                horizontalPadding + 4,
                                10,
                                tight ? 6 : horizontalPadding,
                                0,
                              ),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    flex: tight ? 58 : 56,
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        FittedBox(
                                          fit: BoxFit.scaleDown,
                                          alignment: Alignment.centerLeft,
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                'Eat well.',
                                                style: TextStyle(
                                                  color: const Color(
                                                    0xFF111827,
                                                  ),
                                                  fontSize: tight ? 28 : 33,
                                                  fontWeight: FontWeight.w900,
                                                  height: 1.04,
                                                ),
                                              ),
                                              Text(
                                                'Spend less.',
                                                style: TextStyle(
                                                  color: const Color(
                                                    0xFF4F8A24,
                                                  ),
                                                  fontSize: tight ? 28 : 33,
                                                  fontWeight: FontWeight.w900,
                                                  height: 1.04,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                        const SizedBox(height: 6),
                                        Text(
                                          'Save money at nearby favorites.',
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                          style: TextStyle(
                                            color: BiteSaverColors.valueInk,
                                            fontSize: tight ? 12.2 : 13.4,
                                            height: 1.18,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  SizedBox(width: tight ? 12 : 16),
                                  Expanded(
                                    flex: tight ? 42 : 44,
                                    child: Transform.translate(
                                      offset: Offset(
                                        BiteSaverHomeHeroLogo.horizontalOffsetFor(
                                          tight: tight,
                                          availableWidth: width,
                                        ),
                                        BiteSaverHomeHeroLogo.verticalOffsetFor(
                                          tight: tight,
                                        ),
                                      ),
                                      child: Align(
                                        alignment: Alignment.topRight,
                                        child: IgnorePointer(
                                          child: Transform.scale(
                                            scale: 1.25,
                                            alignment: Alignment.center,
                                            child: BiteSaverHomeHeroLogo(
                                              tight: tight,
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          Padding(
                            key: const ValueKey('bitesaver-home-search-panel'),
                            padding: EdgeInsets.fromLTRB(
                              horizontalPadding,
                              0,
                              horizontalPadding,
                              0,
                            ),
                            child: Container(
                              width: double.infinity,
                              padding: EdgeInsets.fromLTRB(
                                searchPadding,
                                tight ? 3 : 5,
                                searchPadding,
                                tight ? 3 : 5,
                              ),
                              decoration: BoxDecoration(
                                color: BiteSaverColors.surface,
                                borderRadius: BorderRadius.circular(15),
                                border: Border.all(
                                  color: BiteSaverColors.border,
                                  width: 0.8,
                                ),
                                boxShadow: const [
                                  BoxShadow(
                                    color: Color.fromRGBO(15, 23, 42, 0.085),
                                    blurRadius: 18,
                                    offset: Offset(0, 7),
                                  ),
                                ],
                              ),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        flex: 49,
                                        child: currentLocationButton(
                                          tight,
                                          controlHeight,
                                        ),
                                      ),
                                      SizedBox(width: tight ? 8 : 10),
                                      Expanded(
                                        flex: 51,
                                        child: typedLocationButton(
                                          tight,
                                          controlHeight,
                                        ),
                                      ),
                                    ],
                                  ),
                                  SizedBox(height: tight ? 2 : 3),
                                  Row(
                                    children: [
                                      Expanded(
                                        child: restaurantSearchField(
                                          tight,
                                          controlHeight,
                                        ),
                                      ),
                                      SizedBox(width: tight ? 5 : 7),
                                      SizedBox(
                                        width: tight ? 92 : 100,
                                        child: radiusDropdown(
                                          tight,
                                          controlHeight,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: DemoRedemptionStore.changes,
      builder: (context, changes, child) {
        return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream:
              widget.approvedAccountsStream ??
              RestaurantAccountService.approvedAccountsStream(),
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
                          style: TextStyle(
                            color: BiteSaverColors.secondaryText,
                          ),
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
            if (widget.initializeFirebaseBackedState) {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (mounted) {
                  _loadRestaurantFavoriteStatuses(allRestaurants);
                }
              });
            }

            detectAndShowNewCouponNotifications(allRestaurants);

            final filteredRestaurants = filterRestaurants(allRestaurants);
            final expandedHeaderExtent = _expandedHeaderExtentFor(
              MediaQuery.sizeOf(context).width,
              MediaQuery.textScalerOf(context),
            );
            final bottomContentPadding =
                136.0 + MediaQuery.of(context).viewPadding.bottom;

            return Scaffold(
              backgroundColor: BiteSaverColors.pageBackground,
              body: Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      BiteSaverColors.pageBackground,
                      BiteSaverColors.secondaryBackground,
                    ],
                  ),
                ),
                child: ScrollConfiguration(
                  behavior: ScrollConfiguration.of(
                    context,
                  ).copyWith(overscroll: false),
                  child: CustomScrollView(
                    controller: _listScrollController,
                    physics: const ClampingScrollPhysics(),
                    slivers: [
                      SliverPersistentHeader(
                        pinned: true,
                        delegate: _HomeHeaderDelegate(
                          minExtentHeight: _collapsedHeaderExtent,
                          maxExtentHeight: expandedHeaderExtent,
                          builder: (context, expansionT) => _buildHeader(
                            allRestaurants: allRestaurants,
                            filteredRestaurants: filteredRestaurants,
                            expansionT: expansionT,
                          ),
                        ),
                      ),
                      SliverPadding(
                        padding: EdgeInsets.fromLTRB(
                          8,
                          0,
                          8,
                          bottomContentPadding,
                        ),
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

    return SizedBox(
      height: currentExtent,
      child: ClipRect(
        child: OverflowBox(
          alignment: Alignment.topCenter,
          minHeight: 0,
          maxHeight: maxExtent,
          child: SizedBox(
            height: maxExtent,
            child: builder(context, expansionT),
          ),
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

class _RestaurantPromoItem {
  final DailySpecial? dailySpecial;
  final Coupon? coupon;

  const _RestaurantPromoItem.dailySpecial(DailySpecial special)
    : dailySpecial = special,
      coupon = null;

  const _RestaurantPromoItem.coupon(this.coupon) : dailySpecial = null;
}

class BiteSaverHomeDealBubble extends StatelessWidget {
  static const double previousVerticalPadding = 6;
  static const double verticalPadding = 6;
  static const double horizontalPadding = 12;
  static const double previousApproximateCouponHeight = 40;
  static const double bodyHeight = previousApproximateCouponHeight;
  static const double bubbleDiameter = previousApproximateCouponHeight * 1.25;
  static const double minHeight = bubbleDiameter;

  final VoidCallback? onTap;
  final Color backgroundColor;
  final Color borderColor;
  final Widget child;
  final double rectangularBodyLeadingInset;
  final double? bubbleCenterX;
  final bool showBubble;

  const BiteSaverHomeDealBubble({
    super.key,
    required this.onTap,
    required this.backgroundColor,
    required this.borderColor,
    required this.child,
    this.rectangularBodyLeadingInset = 0,
    this.bubbleCenterX,
    this.showBubble = false,
  });

  @override
  Widget build(BuildContext context) {
    final safeBodyLeadingInset = rectangularBodyLeadingInset < 0
        ? 0.0
        : rectangularBodyLeadingInset;
    final bannerHeight = showBubble ? bubbleDiameter : bodyHeight;
    final clipper = BiteSaverHomeDealBubbleClipper(
      rectangularBodyLeadingInset: safeBodyLeadingInset,
      bubbleCenterX: bubbleCenterX,
      showBubble: showBubble,
    );

    return CustomPaint(
      foregroundPainter: _BiteSaverHomeDealBubbleBorderPainter(
        clipper: clipper,
        color: borderColor,
      ),
      child: ClipPath(
        clipper: clipper,
        child: Material(
          color: backgroundColor,
          child: InkWell(
            onTap: onTap,
            child: SizedBox(
              width: double.infinity,
              height: bannerHeight,
              child: Padding(
                padding: EdgeInsets.only(
                  left: horizontalPadding + safeBodyLeadingInset,
                  right: horizontalPadding,
                  top: verticalPadding,
                  bottom: verticalPadding,
                ),
                child: Align(alignment: Alignment.center, child: child),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class BiteSaverHomeDealBubbleStagger {
  const BiteSaverHomeDealBubbleStagger._();

  static const double bubbleGap = 1;
  static const double visibleShapeHeight =
      BiteSaverHomeDealBubble.bubbleDiameter;
  static const double regularStep = visibleShapeHeight + bubbleGap;
  static const double compactStep = visibleShapeHeight + bubbleGap;
  static const double regularOffsetFraction = 0.16;
  static const double compactOffsetFraction = 0.16;
  static const double regularMinOffset = 36;
  static const double compactMinOffset = 28;
  static const double regularMaxOffset = 64;
  static const double compactMaxOffset = 64;

  static bool isLeftPosition(int index) => index.isEven;

  static double topFor({required int index, required bool compact}) {
    final safeIndex = index < 0 ? 0 : index;
    final verticalStep = compact ? compactStep : regularStep;
    return safeIndex * verticalStep;
  }

  static double stackHeightFor({
    required int itemCount,
    required bool compact,
  }) {
    if (itemCount <= 0) {
      return 0;
    }

    return BiteSaverHomeDealBubble.minHeight +
        topFor(index: itemCount - 1, compact: compact);
  }

  static double horizontalOffsetFor({
    required double availableWidth,
    required bool compact,
  }) {
    if (availableWidth <= 0) {
      return 0;
    }

    final fraction = compact ? compactOffsetFraction : regularOffsetFraction;
    final minOffset = compact ? compactMinOffset : regularMinOffset;
    final maxOffset = compact ? compactMaxOffset : regularMaxOffset;
    final maxSafeOffset = availableWidth * 0.28;

    return (availableWidth * fraction)
        .clamp(minOffset, maxOffset)
        .clamp(0.0, maxSafeOffset)
        .toDouble();
  }
}

class BiteSaverHomeDealBubbleClipper extends CustomClipper<Path> {
  static const double bubbleCenterFraction = 0.52;

  final double rectangularBodyLeadingInset;
  final double? bubbleCenterX;
  final bool showBubble;

  const BiteSaverHomeDealBubbleClipper({
    this.rectangularBodyLeadingInset = 0,
    this.bubbleCenterX,
    this.showBubble = false,
  });

  @override
  Path getClip(Size size) {
    final width = size.width;
    final height = size.height;
    final left = rectangularBodyLeadingInset.clamp(0.0, width).toDouble();
    final right = width;
    final bodyTop = showBubble
        ? (height - BiteSaverHomeDealBubble.bodyHeight) / 2
        : 0.0;
    final bodyBottom = showBubble
        ? bodyTop + BiteSaverHomeDealBubble.bodyHeight
        : height;
    final bodyRadius = (bodyBottom - bodyTop) / 2;
    final bodyPath = Path()
      ..addRRect(
        RRect.fromLTRBR(
          left,
          bodyTop,
          right,
          bodyBottom,
          Radius.circular(bodyRadius),
        ),
      );

    if (!showBubble) {
      return bodyPath;
    }

    final circleRadius = height / 2;
    final centerX = (bubbleCenterX ?? width * bubbleCenterFraction)
        .clamp(left + circleRadius, right - circleRadius)
        .toDouble();
    final circlePath = Path()
      ..addOval(
        Rect.fromCircle(
          center: Offset(centerX, height / 2),
          radius: circleRadius,
        ),
      );

    return Path.combine(PathOperation.union, bodyPath, circlePath);
  }

  @override
  bool shouldReclip(covariant BiteSaverHomeDealBubbleClipper oldClipper) {
    return rectangularBodyLeadingInset !=
            oldClipper.rectangularBodyLeadingInset ||
        bubbleCenterX != oldClipper.bubbleCenterX ||
        showBubble != oldClipper.showBubble;
  }
}

class _BiteSaverHomeDealBubbleBorderPainter extends CustomPainter {
  final BiteSaverHomeDealBubbleClipper clipper;
  final Color color;

  const _BiteSaverHomeDealBubbleBorderPainter({
    required this.clipper,
    required this.color,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.75;

    canvas.drawPath(
      clipper.getClip(size).shift(const Offset(0.375, 0.375)),
      paint,
    );
  }

  @override
  bool shouldRepaint(
    covariant _BiteSaverHomeDealBubbleBorderPainter oldDelegate,
  ) {
    return color != oldDelegate.color ||
        clipper.rectangularBodyLeadingInset !=
            oldDelegate.clipper.rectangularBodyLeadingInset ||
        clipper.bubbleCenterX != oldDelegate.clipper.bubbleCenterX ||
        clipper.showBubble != oldDelegate.clipper.showBubble;
  }
}

class _ImmediatePressFeedback extends StatelessWidget {
  final Widget child;
  final BorderRadius borderRadius;

  const _ImmediatePressFeedback({
    required this.child,
    required this.borderRadius,
  });

  @override
  Widget build(BuildContext context) {
    return child;
  }
}

class _SoftRestaurantImageFrame extends StatelessWidget {
  final String? imageUrl;
  final String fallbackImagePath;
  final double verticalOffset;

  const _SoftRestaurantImageFrame({
    required this.imageUrl,
    required this.fallbackImagePath,
    required this.verticalOffset,
  });

  @override
  Widget build(BuildContext context) {
    return Transform.translate(
      offset: Offset(-1, verticalOffset),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(
            left: 3,
            right: -1,
            top: 4,
            bottom: -2,
            child: ClipPath(
              clipper: const _SquircleClipper(),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: BiteSaverColors.borderStrong,
                  boxShadow: const [
                    BoxShadow(
                      color: Color.fromRGBO(15, 23, 42, 0.14),
                      blurRadius: 9,
                      offset: Offset(0, 4),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Positioned.fill(
            child: ClipPath(
              clipper: const _SquircleClipper(),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: BiteSaverColors.surface,
                  border: Border.all(color: BiteSaverColors.border, width: 1.2),
                ),
                child: BiteSaverRestaurantCardImage(
                  imageUrl: imageUrl,
                  fallbackImagePath: fallbackImagePath,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SquircleClipper extends CustomClipper<Path> {
  const _SquircleClipper();

  @override
  Path getClip(Size size) {
    final w = size.width;
    final h = size.height;
    final r = (w < h ? w : h) * 0.23;
    final c = r * 0.66;

    return Path()
      ..moveTo(r, 0)
      ..lineTo(w - r, 0)
      ..cubicTo(w - c, 0, w, c, w, r)
      ..lineTo(w, h - r)
      ..cubicTo(w, h - c, w - c, h, w - r, h)
      ..lineTo(r, h)
      ..cubicTo(c, h, 0, h - c, 0, h - r)
      ..lineTo(0, r)
      ..cubicTo(0, c, c, 0, r, 0)
      ..close();
  }

  @override
  bool shouldReclip(covariant _SquircleClipper oldClipper) => false;
}
