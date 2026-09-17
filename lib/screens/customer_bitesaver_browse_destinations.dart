import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../models/customer_bitesaver_search.dart';
import '../services/customer_bitesaver_search_coordinator.dart';
import '../services/customer_bitesaver_service.dart';
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
          currentCoordinatesProvider ?? _loadCurrentCoordinates,
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

  static Future<CustomerBiteSaverCoordinates> _loadCurrentCoordinates() async {
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

final class _CustomerBiteSaverBrowseCouponUse {
  _CustomerBiteSaverBrowseCouponUse({
    required this.selection,
    required this.currentCoordinatesProvider,
  });

  final CustomerBiteSaverBrowseSelection selection;
  final CustomerBiteSaverRedemptionCoordinatesProvider
  currentCoordinatesProvider;

  String? _redemptionRequestId;
  CustomerBiteSaverCoordinates? _coordinates;
  bool _validationCompleted = false;
  Future<CustomerBiteSaverRedemptionPresentation>? _inFlight;

  Future<CustomerBiteSaverRedemptionPresentation> call(BuildContext context) {
    final existing = _inFlight;
    if (existing != null) return existing;
    late final Future<CustomerBiteSaverRedemptionPresentation> operation;
    operation = _run().whenComplete(() {
      if (identical(_inFlight, operation)) _inFlight = null;
    });
    _inFlight = operation;
    return operation;
  }

  Future<CustomerBiteSaverRedemptionPresentation> _run() async {
    final offer = selection.offer!;
    final session = selection.session;
    if (!_validationCompleted) {
      if (!selection.isCurrent) {
        throw const CustomerBiteSaverFreshSearchRequiredException();
      }
      _redemptionRequestId ??= _secureRequestId();
      if (offer.isProximityOnly && _coordinates == null) {
        _coordinates = await currentCoordinatesProvider();
        if (!selection.isCurrent) {
          throw const CustomerBiteSaverStaleOperationException();
        }
      }
      try {
        final decision = await session.validateRedemption(
          restaurantId: selection.restaurant.restaurantId,
          offerId: offer.offerId,
          redemptionRequestId: _redemptionRequestId!,
          currentCoordinates: _coordinates,
        );
        if (!decision.allowed) {
          final activeExpiresAt = decision.activeTimerExpiresAtMillis;
          if (activeExpiresAt != null &&
              activeExpiresAt > session.redemptionPresentationNowMillis) {
            final presentation = CustomerBiteSaverRedemptionPresentation(
              restaurantId: decision.restaurantId,
              offerId: decision.offerId,
              offerOccurrence: offer.offerOccurrence,
              status: CustomerBiteSaverRedemptionPresentationStatus.active,
              usagePolicy:
                  offer.usagePolicy ??
                  (throw const CustomerBiteSaverProtocolException()),
              timerStartedAtMillis:
                  activeExpiresAt -
                  CustomerBiteSaverSearchContract.redemptionTimerMilliseconds,
              timerExpiresAtMillis: activeExpiresAt,
            );
            session.recordRecoveredRedemptionPresentation(presentation);
            _resetAttempt();
            return presentation;
          }
          _resetAttempt();
          throw CustomerBiteSaverRedemptionDeniedException(decision);
        }
        _validationCompleted = true;
      } catch (error) {
        if (error is CustomerBiteSaverServiceException &&
            error.kind == CustomerBiteSaverServiceFailureKind.callable) {
          _resetAttempt();
        }
        rethrow;
      }
    }

    await session.startValidatedRedemption();
    final presentation = session.redemptionPresentationFor(offer.offerId);
    if (presentation == null) {
      throw const CustomerBiteSaverProtocolException();
    }
    _resetAttempt();
    return presentation;
  }

  void _resetAttempt() {
    _redemptionRequestId = null;
    _coordinates = null;
    _validationCompleted = false;
  }

  static String _secureRequestId() {
    final random = Random.secure();
    return base64UrlEncode(
      List<int>.generate(24, (_) => random.nextInt(256)),
    ).replaceAll('=', '');
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
    extends State<_CustomerBiteSaverDestinationGuard>
    with WidgetsBindingObserver {
  bool _retirementScheduled = false;
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
    final hasConfirmedDisplay =
        offer != null &&
        widget.selection.session.hasDisplayableRedemptionPresentation(
          offer.offerId,
        );
    if (_retirementScheduled ||
        widget.selection.isCurrent ||
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
    final hasConfirmedDisplay =
        offer != null &&
        widget.selection.session.hasDisplayableRedemptionPresentation(
          offer.offerId,
        );
    if ((!widget.selection.isCurrent && !hasConfirmedDisplay) ||
        _retirementScheduled) {
      return const SizedBox.shrink();
    }
    return widget.builder(context);
  }
}
