import 'package:flutter/material.dart';

import '../models/customer_bitesaver_saved.dart';
import '../services/customer_bitesaver_saved_coordinator.dart';
import 'coupon_detail_screen.dart';
import 'main_navigation_screen.dart';
import 'restaurant_menu_screen.dart';
import 'restaurant_profile_screen.dart';

final class CustomerBiteSaverSavedDestinationHandler {
  const CustomerBiteSaverSavedDestinationHandler();

  Future<void> call(
    BuildContext context, {
    required CustomerBiteSaverSavedCoordinator coordinator,
    required CustomerBiteSaverSavedEntry entry,
  }) async {
    final access = coordinator.captureAccess(entry);
    final offer = access.offer;
    if (offer == null) {
      await _openRestaurant(context, coordinator, access);
    } else {
      await _openOffer(context, coordinator, access);
    }
  }

  Future<void> _openRestaurant(
    BuildContext context,
    CustomerBiteSaverSavedCoordinator coordinator,
    CustomerBiteSaverSavedAccess access,
  ) => _push(
    context,
    access,
    (_) => RestaurantProfileScreen.fromCustomerBiteSaverSaved(
      restaurant: access.restaurant,
      savedCoordinator: coordinator,
      openBoundedOffer: null,
      openBoundedMenu: (menuContext) =>
          _openMenu(menuContext, coordinator, access),
    ),
  );

  Future<void> _openOffer(
    BuildContext context,
    CustomerBiteSaverSavedCoordinator coordinator,
    CustomerBiteSaverSavedAccess access,
  ) async {
    final offer = access.offer;
    if (offer == null) throw StateError('That Saved coupon is unavailable.');
    await _push(
      context,
      access,
      (_) => CouponDetailScreen.fromCustomerBiteSaverSaved(
        restaurant: access.restaurant,
        offer: offer,
        savedCoordinator: coordinator,
        savedAccess: access,
        openBoundedRestaurant: (restaurantContext) =>
            _openRestaurant(restaurantContext, coordinator, access),
      ),
    );
  }

  Future<void> _openMenu(
    BuildContext context,
    CustomerBiteSaverSavedCoordinator coordinator,
    CustomerBiteSaverSavedAccess access,
  ) => _push(
    context,
    access,
    (_) => RestaurantMenuScreen.fromCustomerBiteSaver(
      restaurantName: access.restaurant.displayName,
      pageLoader: (cursor) => coordinator.loadMenuPage(access, cursor),
      openImageViewer: (viewerContext, viewerBuilder) =>
          _push(viewerContext, access, viewerBuilder),
    ),
  );

  Future<void> _push(
    BuildContext context,
    CustomerBiteSaverSavedAccess access,
    WidgetBuilder builder,
  ) async {
    if (!access.isCurrent) {
      throw StateError('The Saved account session changed.');
    }
    final parentBinding = MainNavigationAuthBoundOverlayScope.maybeOf(context);
    await pushMainNavigationPrivateRoute<void>(
      context,
      parentBinding: parentBinding,
      originatingAuthRealm: parentBinding == null ? access.authRealmKey : null,
      builder: (_) => _CustomerBiteSaverSavedDestinationGuard(
        access: access,
        builder: builder,
      ),
    );
  }
}

class _CustomerBiteSaverSavedDestinationGuard extends StatefulWidget {
  const _CustomerBiteSaverSavedDestinationGuard({
    required this.access,
    required this.builder,
  });

  final CustomerBiteSaverSavedAccess access;
  final WidgetBuilder builder;

  @override
  State<_CustomerBiteSaverSavedDestinationGuard> createState() =>
      _CustomerBiteSaverSavedDestinationGuardState();
}

class _CustomerBiteSaverSavedDestinationGuardState
    extends State<_CustomerBiteSaverSavedDestinationGuard> {
  bool _retirementScheduled = false;

  @override
  void initState() {
    super.initState();
    widget.access.changes.addListener(_handleChange);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _retireIfStale();
  }

  @override
  void dispose() {
    widget.access.changes.removeListener(_handleChange);
    super.dispose();
  }

  void _handleChange() => _retireIfStale();

  void _retireIfStale() {
    if (_retirementScheduled || widget.access.isCurrent) return;
    _retirementScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final route = ModalRoute.of(context);
      final navigator = Navigator.maybeOf(context, rootNavigator: true);
      if (route != null && navigator != null && route.isActive) {
        navigator.removeRoute(route);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.access.isCurrent || _retirementScheduled) {
      return const SizedBox.shrink();
    }
    return widget.builder(context);
  }
}
