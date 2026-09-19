import 'dart:async';

import 'package:flutter/material.dart';

import '../models/customer_bitesaver_saved.dart';
import '../services/customer_bitesaver_saved_coordinator.dart';
import '../services/customer_bitesaver_search_coordinator.dart';
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
        useBoundedCoupon: coordinator.canUseCoupons
            ? (detailContext) {
                if (!detailContext.mounted) {
                  throw const CustomerBiteSaverStaleOperationException();
                }
                final lease = MainNavigationAuthBoundOverlayScope.maybeOf(
                  detailContext,
                )?.captureLease();
                final route = ModalRoute.of(detailContext);
                if (route?.isActive == false || lease?.isCurrent == false) {
                  throw const CustomerBiteSaverStaleOperationException();
                }
                // The coordinator owns committed use beyond this route;
                // its live account checks still fence every continuation.
                return coordinator.useCoupon(access);
              }
            : null,
      ),
      preserveConfirmedDeviceTimer: true,
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
    WidgetBuilder builder, {
    bool preserveConfirmedDeviceTimer = false,
  }) async {
    if (!access.isCurrent) {
      throw StateError('The Saved account session changed.');
    }
    final parentBinding = MainNavigationAuthBoundOverlayScope.maybeOf(context);
    final guardKey = GlobalKey<_CustomerBiteSaverSavedDestinationGuardState>();
    await pushMainNavigationPrivateRoute<void>(
      context,
      parentBinding: parentBinding,
      originatingAuthRealm: parentBinding == null ? access.authRealmKey : null,
      canPreserveRouteOnAuthChange: () =>
          preserveConfirmedDeviceTimer &&
          access.redemptionPresentation?.isDeviceTimerActiveAt(
                access.redemptionPresentationNowMillis,
              ) ==
              true,
      onAuthRealmReplaced: (_, _) =>
          guardKey.currentState?.retireAuthorityForAuthChange(),
      builder: (_) => _CustomerBiteSaverSavedDestinationGuard(
        key: guardKey,
        access: access,
        builder: builder,
      ),
    );
  }
}

class _CustomerBiteSaverSavedDestinationGuard extends StatefulWidget {
  const _CustomerBiteSaverSavedDestinationGuard({
    super.key,
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
    extends State<_CustomerBiteSaverSavedDestinationGuard>
    with WidgetsBindingObserver {
  bool _retirementScheduled = false;
  bool _authorityRetiredForAuth = false;
  Timer? _confirmedExpiryTimer;
  CustomerBiteSaverRedemptionPresentation? _scheduledPresentation;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.access.changes.addListener(_handleChange);
    _reconcileOwnership();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reconcileOwnership();
  }

  @override
  void didUpdateWidget(_CustomerBiteSaverSavedDestinationGuard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.access.changes, widget.access.changes)) {
      oldWidget.access.changes.removeListener(_handleChange);
      widget.access.changes.addListener(_handleChange);
    }
    _cancelConfirmedExpiryTimer();
    _reconcileOwnership();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _cancelConfirmedExpiryTimer();
    widget.access.changes.removeListener(_handleChange);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _reconcileOwnership();
  }

  void retireAuthorityForAuthChange() {
    if (!mounted) return;
    _authorityRetiredForAuth = true;
    _reconcileOwnership();
    setState(() {});
  }

  bool get _hasCurrentAuthority =>
      !_authorityRetiredForAuth && widget.access.isCurrent;

  bool get _hasConfirmedDisplay {
    final presentation = widget.access.redemptionPresentation;
    if (presentation == null) return false;
    final nowMillis = widget.access.redemptionPresentationNowMillis;
    return _authorityRetiredForAuth
        ? presentation.isDeviceTimerActiveAt(nowMillis)
        : presentation.isActiveAt(nowMillis);
  }

  void _handleChange() => _reconcileOwnership();

  void _reconcileOwnership() {
    if (!mounted) return;
    _syncConfirmedExpiryTimer();
    _retireIfStale();
  }

  void _syncConfirmedExpiryTimer() {
    final presentation = widget.access.redemptionPresentation;
    final expiresAtMillis = presentation?.timerExpiresAtMillis;
    if (presentation == null ||
        presentation.isUnlimited ||
        expiresAtMillis == null ||
        !presentation.isActiveAt(
          widget.access.redemptionPresentationNowMillis,
        )) {
      _cancelConfirmedExpiryTimer();
      return;
    }
    if (_sameScheduledPresentation(presentation) &&
        _confirmedExpiryTimer?.isActive == true) {
      return;
    }
    _cancelConfirmedExpiryTimer();
    _scheduledPresentation = presentation;
    final remainingMillis =
        expiresAtMillis - widget.access.redemptionPresentationNowMillis;
    if (remainingMillis <= 0) return;
    _confirmedExpiryTimer = Timer(
      Duration(milliseconds: remainingMillis),
      () => _handleConfirmedExpiry(presentation),
    );
  }

  bool _sameScheduledPresentation(
    CustomerBiteSaverRedemptionPresentation presentation,
  ) {
    final scheduled = _scheduledPresentation;
    return scheduled != null &&
        scheduled.restaurantId == presentation.restaurantId &&
        scheduled.offerId == presentation.offerId &&
        scheduled.offerOccurrence == presentation.offerOccurrence &&
        scheduled.timerStartedAtMillis == presentation.timerStartedAtMillis &&
        scheduled.timerExpiresAtMillis == presentation.timerExpiresAtMillis;
  }

  void _handleConfirmedExpiry(
    CustomerBiteSaverRedemptionPresentation scheduled,
  ) {
    if (!mounted || !_sameScheduledPresentation(scheduled)) return;
    _confirmedExpiryTimer = null;
    _scheduledPresentation = null;
    final current = widget.access.redemptionPresentation;
    if (current != null &&
        current.restaurantId == scheduled.restaurantId &&
        current.offerId == scheduled.offerId &&
        current.offerOccurrence == scheduled.offerOccurrence &&
        current.timerStartedAtMillis == scheduled.timerStartedAtMillis &&
        current.timerExpiresAtMillis == scheduled.timerExpiresAtMillis) {
      _reconcileOwnership();
    } else {
      _syncConfirmedExpiryTimer();
    }
  }

  void _cancelConfirmedExpiryTimer() {
    _confirmedExpiryTimer?.cancel();
    _confirmedExpiryTimer = null;
    _scheduledPresentation = null;
  }

  void _retireIfStale() {
    final hasConfirmedDisplay = _hasConfirmedDisplay;
    if (_retirementScheduled || _hasCurrentAuthority || hasConfirmedDisplay) {
      return;
    }
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
    final hasConfirmedDisplay = _hasConfirmedDisplay;
    if ((!_hasCurrentAuthority && !hasConfirmedDisplay) ||
        _retirementScheduled) {
      return const SizedBox.shrink();
    }
    return widget.builder(context);
  }
}
