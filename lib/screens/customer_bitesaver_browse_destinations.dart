import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../models/customer_bitesaver_search.dart';
import '../services/customer_bitesaver_search_coordinator.dart';
import 'coupon_detail_screen.dart';
import 'customer_bitesaver_browse_screen.dart';
import 'main_navigation_screen.dart';
import 'restaurant_menu_screen.dart';
import 'restaurant_profile_screen.dart';

/// Opens bounded browse selections in the existing customer destinations.
///
/// The route receives only public DTOs and an opaque, generation-fenced lease.
typedef CustomerBiteSaverRedemptionCoordinatesProvider =
    Future<CustomerBiteSaverCoordinates> Function();

final class CustomerBiteSaverBrowseDestinationHandler {
  const CustomerBiteSaverBrowseDestinationHandler({
    this.currentCoordinatesProvider,
  });

  final CustomerBiteSaverRedemptionCoordinatesProvider?
  currentCoordinatesProvider;

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
    final useAction = _CustomerBiteSaverBrowseCouponUse(
      selection: selection,
      currentCoordinatesProvider:
          currentCoordinatesProvider ?? loadCurrentCoordinates,
    );
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
        useBoundedCoupon: useAction.call,
      ),
    );
  }

  static Future<CustomerBiteSaverCoordinates> loadCurrentCoordinates() async {
    final enabled = await Geolocator.isLocationServiceEnabled();
    if (!enabled) throw StateError('Location services are turned off.');
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied) {
      throw StateError('Location permission was denied.');
    }
    if (permission == LocationPermission.deniedForever) {
      throw StateError(
        'Location permission is permanently denied. Enable it in settings.',
      );
    }
    final position = await Geolocator.getCurrentPosition();
    return CustomerBiteSaverCoordinates(
      latitude: position.latitude,
      longitude: position.longitude,
      capturedAtMillis: position.timestamp.millisecondsSinceEpoch,
    );
  }

  Future<void> _pushCurrentDestination(
    BuildContext context, {
    required CustomerBiteSaverBrowseSelection selection,
    required WidgetBuilder builder,
  }) async {
    _requireCurrent(selection);
    final parentBinding = MainNavigationAuthBoundOverlayScope.maybeOf(context);
    final guardKey = GlobalKey<_CustomerBiteSaverDestinationGuardState>();
    bool canPreserveDeviceTimer() {
      final offer = selection.offer;
      return selection.action == CustomerBiteSaverBrowseAction.offer &&
          offer != null &&
          selection.session
                  .redemptionPresentationFor(offer.offerId)
                  ?.isDeviceTimerActiveAt(
                    selection.session.redemptionPresentationNowMillis,
                  ) ==
              true;
    }

    await pushMainNavigationPrivateRoute<void>(
      context,
      parentBinding: parentBinding,
      originatingAuthRealm: parentBinding == null
          ? selection.access.authRealmKey
          : null,
      canPreserveRouteOnAuthChange: canPreserveDeviceTimer,
      onAuthRealmReplaced: (_, _) =>
          guardKey.currentState?.retireAuthorityForAuthChange(),
      builder: (routeContext) => _CustomerBiteSaverDestinationGuard(
        key: guardKey,
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

final class _CustomerBiteSaverBrowseCouponUse {
  _CustomerBiteSaverBrowseCouponUse({
    required this.selection,
    required this.currentCoordinatesProvider,
  });

  final CustomerBiteSaverBrowseSelection selection;
  final CustomerBiteSaverRedemptionCoordinatesProvider
  currentCoordinatesProvider;

  Future<CustomerBiteSaverRedemptionPresentation> call(BuildContext context) {
    if (!context.mounted) {
      throw const CustomerBiteSaverStaleOperationException();
    }
    final lease = MainNavigationAuthBoundOverlayScope.maybeOf(
      context,
    )?.captureLease();
    final route = ModalRoute.of(context);
    if (route?.isActive == false || lease?.isCurrent == false) {
      throw const CustomerBiteSaverStaleOperationException();
    }
    // Final Use commits the attempt to the coordinator. Route disposal only
    // detaches its UI; the coordinator retains live auth and authority fencing.
    return selection.session.useCouponForAccess(
      access: selection.access,
      restaurantId: selection.restaurant.restaurantId,
      offerId: selection.offer!.offerId,
      currentCoordinatesProvider: currentCoordinatesProvider,
    );
  }
}

class _CustomerBiteSaverDestinationGuard extends StatefulWidget {
  const _CustomerBiteSaverDestinationGuard({
    super.key,
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
    extends State<_CustomerBiteSaverDestinationGuard>
    with WidgetsBindingObserver {
  bool _retirementScheduled = false;
  bool _authorityRetiredForAuth = false;
  Timer? _confirmedExpiryTimer;
  CustomerBiteSaverRedemptionPresentation? _scheduledPresentation;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.selection.session.addListener(_handleSessionChange);
    _reconcileOwnership();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reconcileOwnership();
  }

  @override
  void didUpdateWidget(_CustomerBiteSaverDestinationGuard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.selection.session, widget.selection.session)) {
      oldWidget.selection.session.removeListener(_handleSessionChange);
      widget.selection.session.addListener(_handleSessionChange);
    }
    _cancelConfirmedExpiryTimer();
    _reconcileOwnership();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _cancelConfirmedExpiryTimer();
    widget.selection.session.removeListener(_handleSessionChange);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _reconcileOwnership();
  }

  void retireAuthorityForAuthChange() {
    if (!mounted) return;
    _authorityRetiredForAuth = true;
    final offer = widget.selection.offer;
    if (offer != null) {
      widget.selection.session.cancelCouponUse(
        widget.selection.access,
        offerId: offer.offerId,
      );
    }
    _reconcileOwnership();
    setState(() {});
  }

  bool get _hasCurrentAuthority =>
      !_authorityRetiredForAuth && widget.selection.isCurrent;

  bool get _hasConfirmedDisplay {
    final offer = widget.selection.offer;
    if (offer == null) return false;
    final presentation = widget.selection.session.redemptionPresentationFor(
      offer.offerId,
    );
    if (presentation == null) return false;
    final nowMillis = widget.selection.session.redemptionPresentationNowMillis;
    return _authorityRetiredForAuth
        ? presentation.isDeviceTimerActiveAt(nowMillis)
        : presentation.isActiveAt(nowMillis);
  }

  void _handleSessionChange() {
    _reconcileOwnership();
  }

  void _reconcileOwnership() {
    if (!mounted) return;
    _syncConfirmedExpiryTimer();
    _retireIfStale();
  }

  void _syncConfirmedExpiryTimer() {
    final offer = widget.selection.offer;
    final presentation = offer == null
        ? null
        : widget.selection.session.redemptionPresentationFor(offer.offerId);
    final expiresAtMillis = presentation?.timerExpiresAtMillis;
    if (presentation == null ||
        presentation.isUnlimited ||
        expiresAtMillis == null ||
        !presentation.isActiveAt(
          widget.selection.session.redemptionPresentationNowMillis,
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
        expiresAtMillis -
        widget.selection.session.redemptionPresentationNowMillis;
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
    final offer = widget.selection.offer;
    final current = offer == null
        ? null
        : widget.selection.session.redemptionPresentationFor(offer.offerId);
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
    final offer = widget.selection.offer;
    final hasConfirmedDisplay = _hasConfirmedDisplay;
    final recoverable =
        !_authorityRetiredForAuth &&
        offer != null &&
        widget.selection.session.isCouponUseRecoverable(
          widget.selection.access,
          offer.offerId,
        );
    if (_retirementScheduled ||
        _hasCurrentAuthority ||
        recoverable ||
        hasConfirmedDisplay) {
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
    final offer = widget.selection.offer;
    final hasConfirmedDisplay = _hasConfirmedDisplay;
    final recoverable =
        !_authorityRetiredForAuth &&
        offer != null &&
        widget.selection.session.isCouponUseRecoverable(
          widget.selection.access,
          offer.offerId,
        );
    if ((!_hasCurrentAuthority && !hasConfirmedDisplay && !recoverable) ||
        _retirementScheduled) {
      return const SizedBox.shrink();
    }
    return widget.builder(context);
  }
}
