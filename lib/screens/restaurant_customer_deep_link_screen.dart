import 'package:flutter/material.dart';

import '../models/bitescore_restaurant.dart';
import '../models/daily_special.dart';
import '../models/demo_redemption_store.dart';
import '../models/restaurant.dart';
import '../services/app_error_text.dart';
import '../services/app_mode_state_service.dart';
import '../services/bitescore_service.dart';
import '../services/restaurant_account_service.dart';
import 'bitescore_restaurant_dishes_screen.dart';
import 'main_navigation_screen.dart';
import 'restaurant_profile_screen.dart';

class RestaurantCustomerDeepLinkScreen extends StatefulWidget {
  final String side;
  final String restaurantId;

  const RestaurantCustomerDeepLinkScreen({
    super.key,
    required this.side,
    required this.restaurantId,
  });

  @override
  State<RestaurantCustomerDeepLinkScreen> createState() =>
      _RestaurantCustomerDeepLinkScreenState();
}

class _RestaurantCustomerDeepLinkScreenState
    extends State<RestaurantCustomerDeepLinkScreen> {
  late Future<_RestaurantDeepLinkResolution> _resolutionFuture;

  bool get _isBiteScore => widget.side == 'bitescore';

  @override
  void initState() {
    super.initState();
    _resolutionFuture = _resolveLink();
  }

  Future<_RestaurantDeepLinkResolution> _resolveLink() async {
    final restaurantId = widget.restaurantId.trim();
    if (restaurantId.isEmpty) {
      return const _RestaurantDeepLinkResolution.notFound();
    }

    if (_isBiteScore) {
      final restaurant = await BiteScoreService.loadRestaurantById(
        restaurantId,
      );
      if (restaurant == null) {
        return const _RestaurantDeepLinkResolution.notFound();
      }
      final entries = await BiteScoreService.loadEntriesForRestaurant(
        restaurant,
      );
      return _RestaurantDeepLinkResolution.biteScore(
        restaurant: restaurant,
        entries: entries,
      );
    }

    final accountData = await RestaurantAccountService.getAccountData(
      restaurantId,
    );
    if (accountData == null) {
      return const _RestaurantDeepLinkResolution.notFound();
    }

    final coupons =
        RestaurantAccountService.customerVisibleCouponsForAccountData(
          accountData,
          await RestaurantAccountService.loadCoupons(restaurantId),
        );
    final dailySpecials =
        RestaurantAccountService.hasCouponPostingAccess(accountData)
        ? await RestaurantAccountService.loadDailySpecialsForRestaurant(
            restaurantId,
          )
        : const <DailySpecial>[];
    final restaurant = Restaurant.fromFirestore(
      accountData,
      coupons: coupons,
      dailySpecials: dailySpecials,
    );
    if (!restaurant.hasValidRequiredFields) {
      return const _RestaurantDeepLinkResolution.notFound();
    }

    final now = DateTime.now();
    final visibleCoupons = coupons
        .where(
          (coupon) =>
              coupon.isActiveAt(now) &&
              DemoRedemptionStore.isAvailable(coupon.id, coupon.usageRule),
        )
        .toList(growable: false);
    final visibleSpecials = DailySpecial.visibleSpecialsAt(dailySpecials, now);
    if (visibleCoupons.isEmpty && visibleSpecials.isEmpty) {
      return _RestaurantDeepLinkResolution.noOffers(restaurant: restaurant);
    }

    return _RestaurantDeepLinkResolution.coupon(restaurant: restaurant);
  }

  String get _title => _isBiteScore ? 'BiteScore Restaurant' : 'Restaurant';

  String get _notFoundMessage => _isBiteScore
      ? 'This BiteScore restaurant could not be found.'
      : 'We couldn’t find this restaurant.';

  String get _noOffersMessage =>
      'This restaurant does not have any customer-visible offers right now.';

  void _openSafeHome() {
    final mode = _isBiteScore ? AppMode.biteScore : AppMode.biteSaver;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(
        builder: (_) => MainNavigationScreen(initialMode: mode),
      ),
      (route) => false,
    );
  }

  Widget _buildSafeState(String message) {
    return Scaffold(
      appBar: AppBar(title: Text(_title)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.storefront_outlined, size: 56),
                const SizedBox(height: 16),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'You can keep browsing from the app home.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.black54),
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _openSafeHome,
                  child: const Text('Go to Home'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildErrorState(Object error) {
    final message = AppErrorText.friendly(
      error,
      fallback: 'Could not open this restaurant right now.',
    );
    return Scaffold(
      appBar: AppBar(title: Text(_title)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(message, textAlign: TextAlign.center),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<_RestaurantDeepLinkResolution>(
      future: _resolutionFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return Scaffold(
            appBar: AppBar(title: Text(_title)),
            body: const Center(child: CircularProgressIndicator()),
          );
        }

        if (snapshot.hasError) {
          return _buildErrorState(snapshot.error!);
        }

        final resolution =
            snapshot.data ?? const _RestaurantDeepLinkResolution.notFound();
        if (resolution.state == _RestaurantDeepLinkResolutionState.notFound) {
          return _buildSafeState(_notFoundMessage);
        }
        if (resolution.state == _RestaurantDeepLinkResolutionState.noOffers) {
          return _buildSafeState(_noOffersMessage);
        }

        final couponRestaurant = resolution.restaurant;
        if (couponRestaurant != null) {
          return RestaurantProfileScreen(restaurant: couponRestaurant);
        }

        return BiteScoreRestaurantDishesScreen(
          restaurant: resolution.biteScoreRestaurant!,
          entries: resolution.biteScoreEntries,
        );
      },
    );
  }
}

class _RestaurantDeepLinkResolution {
  final _RestaurantDeepLinkResolutionState state;
  final Restaurant? restaurant;
  final BitescoreRestaurant? biteScoreRestaurant;
  final List<BiteScoreHomeEntry> biteScoreEntries;

  const _RestaurantDeepLinkResolution._({
    required this.state,
    required this.restaurant,
    required this.biteScoreRestaurant,
    required this.biteScoreEntries,
  });

  const _RestaurantDeepLinkResolution.notFound()
    : this._(
        state: _RestaurantDeepLinkResolutionState.notFound,
        restaurant: null,
        biteScoreRestaurant: null,
        biteScoreEntries: const [],
      );

  const _RestaurantDeepLinkResolution.coupon({required Restaurant restaurant})
    : this._(
        state: _RestaurantDeepLinkResolutionState.loaded,
        restaurant: restaurant,
        biteScoreRestaurant: null,
        biteScoreEntries: const [],
      );

  const _RestaurantDeepLinkResolution.noOffers({required Restaurant restaurant})
    : this._(
        state: _RestaurantDeepLinkResolutionState.noOffers,
        restaurant: restaurant,
        biteScoreRestaurant: null,
        biteScoreEntries: const [],
      );

  const _RestaurantDeepLinkResolution.biteScore({
    required BitescoreRestaurant restaurant,
    required List<BiteScoreHomeEntry> entries,
  }) : this._(
         state: _RestaurantDeepLinkResolutionState.loaded,
         restaurant: null,
         biteScoreRestaurant: restaurant,
         biteScoreEntries: entries,
       );
}

enum _RestaurantDeepLinkResolutionState { loaded, notFound, noOffers }
