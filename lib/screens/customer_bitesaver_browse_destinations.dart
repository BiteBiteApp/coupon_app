import 'package:flutter/material.dart';

import '../services/customer_bitesaver_search_coordinator.dart';
import 'coupon_detail_screen.dart';
import 'customer_bitesaver_browse_screen.dart';
import 'main_navigation_screen.dart';
import 'restaurant_menu_screen.dart';
import 'restaurant_profile_screen.dart';

/// Opens bounded browse selections in the existing customer destinations.
///
/// The route receives only public DTOs and an opaque, generation-fenced lease.
final class CustomerBiteSaverBrowseDestinationHandler {
  const CustomerBiteSaverBrowseDestinationHandler();

  Future<CustomerBiteSaverBrowseActionResult> call(
    BuildContext context,
    CustomerBiteSaverBrowseSelection selection,
  ) async {
    _requireCurrent(selection);
    switch (selection.action) {
      case CustomerBiteSaverBrowseAction.restaurantProfile:
        await _openRestaurant(context, selection);
      case CustomerBiteSaverBrowseAction.offer:
        await _openOffer(context, selection);
      case CustomerBiteSaverBrowseAction.menu:
        await _openMenu(context, selection);
    }
    return const CustomerBiteSaverBrowseActionResult();
  }

  Future<void> _openRestaurant(
    BuildContext context,
    CustomerBiteSaverBrowseSelection selection,
  ) async {
    await _pushCurrentDestination(
      context,
      selection: selection,
      builder: (_) => RestaurantProfileScreen.fromCustomerBiteSaver(
        restaurant: selection.restaurant,
        session: selection.session,
        access: selection.access,
        openBoundedOffer: (profileContext, offer) async {
          final current = selection.session
              .currentAcceptedOfferSelectionForAccess(
                selection.access,
                selection.restaurant.restaurantId,
                offer.offerId,
              );
          if (current == null ||
              current.offer.offerOccurrence != offer.offerOccurrence) {
            throw const CustomerBiteSaverFreshSearchRequiredException();
          }
          await call(
            profileContext,
            CustomerBiteSaverBrowseSelection.offer(
              restaurant: current.restaurant,
              offer: current.offer,
              session: selection.session,
              access: selection.access,
            ),
          );
        },
        openBoundedMenu: (menuContext) async {
          final current = selection.session.currentAcceptedRestaurantForAccess(
            selection.access,
            selection.restaurant.restaurantId,
          );
          if (current == null) {
            throw const CustomerBiteSaverFreshSearchRequiredException();
          }
          await call(
            menuContext,
            CustomerBiteSaverBrowseSelection.menu(
              restaurant: current,
              session: selection.session,
              access: selection.access,
            ),
          );
        },
      ),
    );
  }

  Future<void> _openMenu(
    BuildContext context,
    CustomerBiteSaverBrowseSelection selection,
  ) async {
    await _pushCurrentDestination(
      context,
      selection: selection,
      builder: (_) => RestaurantMenuScreen.fromCustomerBiteSaver(
        restaurantName: selection.restaurant.displayName,
        pageLoader: (cursor) => selection.session.loadMenuPageForAccess(
          access: selection.access,
          restaurantId: selection.restaurant.restaurantId,
          cursor: cursor,
        ),
        openImageViewer: (viewerContext, viewerBuilder) async {
          if (!selection.isCurrent) return;
          await _pushCurrentDestination(
            viewerContext,
            selection: selection,
            builder: viewerBuilder,
          );
        },
      ),
    );
  }

  Future<void> _openOffer(
    BuildContext context,
    CustomerBiteSaverBrowseSelection selection,
  ) async {
    final offer = selection.offer;
    if (offer == null) {
      throw StateError('The selected BiteSaver offer is unavailable.');
    }
    await _pushCurrentDestination(
      context,
      selection: selection,
      builder: (_) => CouponDetailScreen.fromCustomerBiteSaver(
        restaurant: selection.restaurant,
        offer: offer,
        session: selection.session,
        access: selection.access,
        openBoundedRestaurant: (detailContext) async {
          final current = selection.session.currentAcceptedRestaurantForAccess(
            selection.access,
            selection.restaurant.restaurantId,
          );
          if (current == null) {
            throw const CustomerBiteSaverFreshSearchRequiredException();
          }
          await call(
            detailContext,
            CustomerBiteSaverBrowseSelection.restaurantProfile(
              restaurant: current,
              session: selection.session,
              access: selection.access,
            ),
          );
        },
        // Intentionally uncomposed until the bounded redemption checkpoint.
        useBoundedCoupon: null,
      ),
    );
  }

  Future<void> _pushCurrentDestination(
    BuildContext context, {
    required CustomerBiteSaverBrowseSelection selection,
    required WidgetBuilder builder,
  }) async {
    _requireCurrent(selection);
    final parentBinding = MainNavigationAuthBoundOverlayScope.maybeOf(context);
    await pushMainNavigationPrivateRoute<void>(
      context,
      parentBinding: parentBinding,
      originatingAuthRealm: parentBinding == null
          ? selection.access.authRealmKey
          : null,
      builder: (routeContext) => _CustomerBiteSaverDestinationGuard(
        selection: selection,
        builder: builder,
      ),
    );
  }

  void _requireCurrent(CustomerBiteSaverBrowseSelection selection) {
    if (!selection.isCurrent) {
      throw const CustomerBiteSaverFreshSearchRequiredException();
    }
  }
}

class _CustomerBiteSaverDestinationGuard extends StatefulWidget {
  const _CustomerBiteSaverDestinationGuard({
    required this.selection,
    required this.builder,
  });

  final CustomerBiteSaverBrowseSelection selection;
  final WidgetBuilder builder;

  @override
  State<_CustomerBiteSaverDestinationGuard> createState() =>
      _CustomerBiteSaverDestinationGuardState();
}

class _CustomerBiteSaverDestinationGuardState
    extends State<_CustomerBiteSaverDestinationGuard> {
  bool _retirementScheduled = false;

  @override
  void initState() {
    super.initState();
    widget.selection.session.addListener(_handleSessionChange);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _retireIfStale();
  }

  @override
  void dispose() {
    widget.selection.session.removeListener(_handleSessionChange);
    super.dispose();
  }

  void _handleSessionChange() {
    _retireIfStale();
  }

  void _retireIfStale() {
    if (_retirementScheduled || widget.selection.isCurrent) return;
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
    if (!widget.selection.isCurrent || _retirementScheduled) {
      return const SizedBox.shrink();
    }
    return widget.builder(context);
  }
}
