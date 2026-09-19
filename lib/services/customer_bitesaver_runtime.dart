import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../models/customer_bitesaver_search.dart';
import '../models/customer_bitesaver_device_usage.dart';
import '../models/customer_bitesaver_favorite.dart';
import '../screens/customer_account_screen.dart';
import '../screens/customer_bitesaver_browse_destinations.dart';
import '../screens/customer_bitesaver_browse_screen.dart';
import '../screens/customer_profile_screen.dart';
import '../screens/restaurant_profile_screen.dart';
import '../screens/restaurant_menu_screen.dart';
import '../screens/coupon_detail_screen.dart';
import 'customer_bitesaver_public_profile.dart';
import 'customer_bitesaver_device_proof_service.dart';
import 'customer_bitesaver_device_use_service.dart';
import 'customer_bitesaver_favorite_service.dart';
import 'customer_bitesaver_guest_usage_store.dart';
import 'customer_bitesaver_saved_coordinator.dart';
import 'customer_bitesaver_search_coordinator.dart';
import 'customer_bitesaver_service.dart';
import 'customer_session_service.dart';

/// Source-only selection, following the BiteScore selector. Server authority is
/// still required for every operation. Public profile reads grant no coupon use.
abstract final class CustomerBiteSaverRuntime {
  static const bool _configured = bool.fromEnvironment(
    'BITESAVER_BOUNDED_CUSTOMER',
    defaultValue: false,
  );

  @visibleForTesting
  static bool? testEnabled;
  @visibleForTesting
  static CustomerBiteSaverComposition? testComposition;

  static bool get isEnabled => testEnabled ?? _configured;
  static Future<CustomerBiteSaverComposition>? _production;

  static Future<CustomerBiteSaverComposition> get _composition =>
      testComposition != null
      ? Future.value(testComposition)
      : _production ??= CustomerBiteSaverComposition.firebase();

  static Future<CustomerBiteSaverPublicProfile> loadPublicProfile(
    String catalogId,
  ) async {
    final composition = await _composition;
    final generation = composition._authGeneration;
    late final CustomerBiteSaverPublicProfile profile;
    profile = CustomerBiteSaverPublicProfile(
      composition._api,
      await composition._readPublicProfile(catalogId),
      composition._proofService.getTimeContext,
      (cursor) => composition._readPublicProfile(catalogId, cursor: cursor),
      (offer) {
        final value = composition.browse.redemptionPresentationFor(
          offer.offerId,
        );
        return value != null &&
                value.offerId == offer.offerId &&
                value.isDeviceAuthoritative &&
                (value.isDeviceTimerActiveAt(
                      composition._clock().millisecondsSinceEpoch,
                    ) ||
                    value.usagePolicy ==
                        CustomerBiteSaverUsagePolicy.oncePerCustomer ||
                    value.usagePolicy == CustomerBiteSaverUsagePolicy.unlimited)
            ? value
            : null;
      },
      () => composition._clock().millisecondsSinceEpoch,
      composition.browse,
      () => composition._publicProfiles.remove(profile),
    );
    composition._publicProfiles.add(profile);
    if (generation != composition._authGeneration &&
        composition._saved != null) {
      unawaited(profile.refreshFavoriteStates());
    }
    return profile;
  }

  static Widget buildPublicProfile(CustomerBiteSaverPublicProfile profile) =>
      _build((composition) => composition.buildPublicProfile(profile));

  static Widget buildBrowse(
    BuildContext context,
    int navigationRefreshGeneration,
    String authRealm,
  ) => _build(
    (composition) => composition.buildBrowse(
      context,
      navigationRefreshGeneration,
      authRealm,
    ),
  );

  static Widget buildAccount(BuildContext context, String authRealm) =>
      _build((composition) => composition.buildAccount(context, authRealm));

  static Widget _build(Widget Function(CustomerBiteSaverComposition) builder) =>
      FutureBuilder<CustomerBiteSaverComposition>(
        future: _composition,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return const Center(
              child: Text('Could not load BiteSaver right now.'),
            );
          }
          final composition = snapshot.data;
          if (composition == null) {
            return const Center(child: CircularProgressIndicator());
          }
          return AnimatedBuilder(
            animation: composition,
            builder: (_, _) => builder(composition),
          );
        },
      );
}

/// One process-owned Browse session and one Saved owner per auth session.
/// Navigation only borrows these owners: a committed final tap survives route
/// removal. Genuine auth replacement fences work using the existing lifecycle.
final class CustomerBiteSaverComposition extends ChangeNotifier {
  CustomerBiteSaverComposition({
    required CustomerBiteSaverService api,
    required CustomerBiteSaverFavoriteService favoriteService,
    required CustomerBiteSaverGuestUsageStore guestUsageStore,
    required User? Function() currentUser,
    required Stream<User?> Function() userChanges,
    CustomerBiteSaverDeviceProofService? proofService,
    CustomerBiteSaverDeviceUseTransport? deviceTransport,
    Future<CustomerBiteSaverCoordinates> Function()? currentCoordinatesProvider,
    String? clientInstanceId,
    DateTime Function()? clock,
  }) : _api = api,
       _favoriteService = favoriteService,
       _currentUser = currentUser,
       _userChanges = userChanges,
       _proofService = proofService ?? CustomerBiteSaverDeviceProofService(),
       _deviceTransport = deviceTransport,
       _clock = clock ?? DateTime.now,
       _clientInstanceId = clientInstanceId ?? _newInstanceId(),
       _guestUsageStore = guestUsageStore,
       _currentCoordinatesProvider =
           currentCoordinatesProvider ??
           CustomerBiteSaverBrowseDestinationHandler.loadCurrentCoordinates {
    _auth = _readAuth();
    _saved = _createSaved();
    _profileDeviceUse = _newDeviceUseService();
    browse = CustomerBiteSaverSearchCoordinator(
      api: api,
      guestUsageStore: guestUsageStore,
      clientInstanceId: _clientInstanceId,
      initialAuth: _auth,
      clock: _clock,
      authSnapshotProvider: _readAuth,
      deviceUseService: _newDeviceUseService(),
      favoriteActions: CustomerBiteSaverFavoriteActions.fromService(
        favoriteService,
      ),
      favoriteStateOwner: _saved,
    );
    _subscription = userChanges().listen(_authChanged);
  }

  static Future<CustomerBiteSaverComposition> firebase() async {
    final guestId = await CustomerSessionService.getOrCreateGuestDeviceId();
    final auth = FirebaseAuth.instance;
    return CustomerBiteSaverComposition(
      api: CustomerBiteSaverService(),
      favoriteService: CustomerBiteSaverFavoriteService.firebase(auth: auth),
      guestUsageStore: CustomerBiteSaverGuestUsageStore(guestDeviceId: guestId),
      currentUser: () => auth.currentUser,
      userChanges: auth.userChanges,
    );
  }

  final CustomerBiteSaverService _api;
  final CustomerBiteSaverFavoriteService _favoriteService;
  final User? Function() _currentUser;
  final Stream<User?> Function() _userChanges;
  final CustomerBiteSaverDeviceProofService _proofService;
  final CustomerBiteSaverDeviceUseTransport? _deviceTransport;
  final DateTime Function() _clock;
  final Future<CustomerBiteSaverCoordinates> Function()
  _currentCoordinatesProvider;
  late final StreamSubscription<User?> _subscription;
  late CustomerBiteSaverAuthSnapshot _auth;
  late final CustomerBiteSaverSearchCoordinator browse;
  CustomerBiteSaverSavedCoordinator? _saved;
  int _authGeneration = 0;
  final String _clientInstanceId;
  final CustomerBiteSaverGuestUsageStore _guestUsageStore;
  late final CustomerBiteSaverDeviceUseService _profileDeviceUse;
  _ProfileUseAttempt? _profileAttempt;
  Future<CustomerBiteSaverRedemptionPresentation>? _profileInFlight;

  final Set<CustomerBiteSaverPublicProfile> _publicProfiles = {};

  CustomerBiteSaverSavedCoordinator? get saved => _saved;

  CustomerBiteSaverAuthSnapshot _readAuth() => _snapshot(_currentUser());

  static CustomerBiteSaverAuthSnapshot _snapshot(User? user) {
    if (user == null) return const CustomerBiteSaverAuthSnapshot.signedOut();
    return user.isAnonymous
        ? CustomerBiteSaverAuthSnapshot.anonymous(user.uid)
        : CustomerBiteSaverAuthSnapshot.signed(user.uid);
  }

  CustomerBiteSaverDeviceUseService _newDeviceUseService() =>
      CustomerBiteSaverDeviceUseService(
        proofService: _proofService,
        transport: _deviceTransport,
      );

  CustomerBiteSaverSavedCoordinator? _createSaved() {
    if (!_auth.isSigned) return null;
    final generation = _authGeneration;
    return CustomerBiteSaverSavedCoordinator(
      userId: _auth.uid!,
      clock: _clock,
      api: _api,
      favoriteActions: CustomerBiteSaverSavedFavoriteActions.fromService(
        _favoriteService,
      ),
      isAccountCurrent: (uid) {
        final current = _readAuth();
        return generation == _authGeneration &&
            current.isSigned &&
            current.uid == uid;
      },
      timeContextProvider: _proofService.getTimeContext,
      currentCoordinatesProvider: _currentCoordinatesProvider,
      deviceUseService: _newDeviceUseService(),
    );
  }

  void _authChanged(User? user) {
    // Process each auth event, including a rapid A -> guest -> A sequence.
    // Every operation additionally checks the live current user.
    final next = _snapshot(user);
    if (next.uid == _auth.uid && next.isAnonymous == _auth.isAnonymous) return;
    // Only confirmed current-phone timer values outlive the account. These
    // immutable presentations contain no entries, favorites or use authority.
    for (final timer
        in _saved?.activeDeviceRedemptionPresentations ??
            <CustomerBiteSaverRedemptionPresentation>[]) {
      if (timer.isDeviceTimerActiveAt(_clock().millisecondsSinceEpoch)) {
        browse.recordRecoveredRedemptionPresentation(timer);
      }
    }
    _authGeneration += 1;
    _profileDeviceUse.cancel();
    _profileAttempt = null;
    _profileInFlight = null;
    final previous = _saved;
    _auth = next;
    // updateAuth fences synchronously before its first await; its existing
    // same-guest reconciliation may then finish asynchronously.
    unawaited(browse.updateAuth(next));
    _saved = _createSaved();
    browse.replaceFavoriteStateOwner(_saved);
    final owner = _saved;
    if (owner != null) {
      for (final timer in browse.activeDeviceRedemptionPresentations) {
        if (timer.isDeviceTimerActiveAt(_clock().millisecondsSinceEpoch)) {
          owner.recordRedemptionPresentation(
            timer,
            expectedAuthRealmKey: next.realmKey,
          );
        }
      }
    }
    previous?.dispose();
    notifyListeners();
    if (_saved != null) {
      for (final profile in _publicProfiles.toList()) {
        unawaited(profile.refreshFavoriteStates());
      }
    }
  }

  // One committed operation owns context acquisition, proof, and exact retry.
  // A route is checked only at handoff; navigation cannot cancel this owner.
  Future<CustomerBiteSaverRedemptionPresentation> _useProfileCoupon(
    CustomerBiteSaverPublicProfile profile,
    CustomerBiteSaverOffer offer,
  ) {
    if (!profile.contains(offer) ||
        offer.offerType != CustomerBiteSaverOfferType.coupon) {
      throw const CustomerBiteSaverStaleOperationException();
    }
    final auth = _readAuth();
    if (auth.uid != _auth.uid || auth.isAnonymous != _auth.isAnonymous) {
      throw const CustomerBiteSaverStaleOperationException();
    }
    var attempt = _profileAttempt;
    if (attempt != null &&
        (attempt.catalogId != profile.catalogRestaurantId ||
            attempt.restaurantId != profile.restaurant!.restaurantId ||
            attempt.offer.offerId != offer.offerId)) {
      throw StateError(
        'Recover the pending coupon use before using another coupon.',
      );
    }
    final running = _profileInFlight;
    if (running != null) return running;
    if (attempt == null) {
      final active = browse.redemptionPresentationFor(offer.offerId);
      if (active != null &&
          active.restaurantId == profile.restaurant!.restaurantId &&
          active.isDeviceTimerActiveAt(_clock().millisecondsSinceEpoch)) {
        return Future.value(active);
      }
      attempt = _ProfileUseAttempt(
        profile.catalogRestaurantId,
        profile.restaurant!.restaurantId,
        offer,
        _newInstanceId(),
      );
      _profileAttempt = attempt;
    }
    final generation = _authGeneration;
    bool owns() =>
        generation == _authGeneration &&
        identical(_profileAttempt, attempt) &&
        _readAuth().uid == auth.uid &&
        _readAuth().isAnonymous == auth.isAnonymous;
    late final Future<CustomerBiteSaverRedemptionPresentation> operation;
    operation = _runProfileCouponUse(attempt, auth, owns).whenComplete(() {
      if (identical(_profileInFlight, operation)) _profileInFlight = null;
    });
    _profileInFlight = operation;
    return operation;
  }

  Future<CustomerBiteSaverRedemptionPresentation> _runProfileCouponUse(
    _ProfileUseAttempt attempt,
    CustomerBiteSaverAuthSnapshot auth,
    bool Function() owns,
  ) async {
    void check() {
      if (!owns()) throw const CustomerBiteSaverStaleOperationException();
    }

    try {
      check();
      if (attempt.contextRequest == null) {
        final time = await _proofService.getTimeContext();
        check();
        final revision = auth.isSigned
            ? null
            : await _guestUsageStore.readRevision();
        check();
        attempt.contextRequest = Map.unmodifiable({
          'schemaVersion': 1,
          'kind': 'publicProfileUse',
          'clientRequestId': attempt.requestId,
          'clientInstanceId': _clientInstanceId,
          'catalogRestaurantId': attempt.catalogId,
          'restaurantId': attempt.restaurantId.value,
          'offerId': attempt.offer.offerId.value,
          'timeZone': time.timeZone,
          'utcOffsetMinutes': time.utcOffsetMinutes,
          'guestStateRevision': revision,
        });
      }
      if (attempt.request == null) {
        final access = attempt.access ??= await _api.getProfileUseContext(
          attempt.contextRequest!,
        );
        check();
        final coordinates = access.isProximityOnly
            ? await _currentCoordinatesProvider()
            : null;
        check();
        attempt.request = CustomerBiteSaverCombinedUseRequest(
          logicalRequestId: attempt.requestId,
          restaurantId: attempt.restaurantId,
          offerId: attempt.offer.offerId,
          timeZone: attempt.contextRequest!['timeZone']! as String,
          utcOffsetMinutes: attempt.contextRequest!['utcOffsetMinutes']! as int,
          currentCoordinates: coordinates,
          origin: CustomerBiteSaverDiscoveryUseAuthority(
            clientInstanceId: _clientInstanceId,
            sessionId: access.sessionId,
            capability: access.capability,
            criteriaFingerprint: access.criteriaFingerprint,
            offerOccurrence: access.offerOccurrence,
            guestStateRevision:
                attempt.contextRequest!['guestStateRevision'] as int?,
          ),
        );
      }
      final result = await _profileDeviceUse.useCoupon(
        request: attempt.request!,
        authenticatedUserId: auth.isSigned ? auth.uid : null,
        isCurrent: owns,
      );
      check();
      final presentation =
          CustomerBiteSaverRedemptionPresentation.fromDeviceUse(
            result: result,
            offerOccurrence: attempt.offer.offerOccurrence,
            usagePolicy: attempt.access!.usagePolicy,
          );
      browse.recordRecoveredRedemptionPresentation(presentation);
      _profileAttempt = null;
      return presentation;
    } catch (error) {
      final uncertain =
          error is CustomerBiteSaverDeviceUseException &&
          (error.kind == CustomerBiteSaverDeviceUseFailureKind.ambiguous ||
              error.kind ==
                  CustomerBiteSaverDeviceUseFailureKind.invalidResponse);
      final contextUncertain =
          attempt.request == null &&
          error is CustomerBiteSaverServiceException &&
          (error.kind == CustomerBiteSaverServiceFailureKind.transport ||
              error.kind ==
                  CustomerBiteSaverServiceFailureKind.invalidResponse);
      if (owns() && !uncertain && !contextUncertain) _profileAttempt = null;
      rethrow;
    }
  }

  Future<CustomerBiteSaverPublicProfileResult> _readPublicProfile(
    String catalogId, {
    String? cursor,
  }) async {
    final generation = _authGeneration;
    final owner = _saved;
    final auth = _auth;
    final result = await _api.getPublicProfile(
      catalogId,
      cursor: cursor,
      timeContext: await _proofService.getTimeContext(),
    );
    if (owner != null &&
        generation == _authGeneration &&
        identical(owner, _saved) &&
        auth.realmKey == _readAuth().realmKey) {
      // Revision zero only: a read must never overwrite a newer local save/remove.
      owner.mergeResolvedStates(result.favoriteStates, {
        for (final state in result.favoriteStates) state.idValue: 0,
      });
    }
    return result;
  }

  Widget buildPublicProfile(CustomerBiteSaverPublicProfile profile) =>
      RestaurantProfileScreen.fromPublicProfile(
        profile: profile,
        boundedSavedCoordinator: _saved,
        openBoundedMenu: (context) => Navigator.of(context).push<void>(
          MaterialPageRoute(
            builder: (_) => RestaurantMenuScreen.fromCustomerBiteSaver(
              restaurantName: profile.restaurant!.displayName,
              pageLoader: profile.menu,
              openImageViewer: (context, builder) => Navigator.of(
                context,
              ).push<void>(MaterialPageRoute(builder: builder)),
            ),
          ),
        ),
        openBoundedOffer: (context, offer) async {
          if (!profile.contains(offer)) return;
          profile.viewOffer(offer);
          if (_saved?.offerFavoriteState(offer.offerId) ==
              CustomerBiteSaverFavoriteState.unknown) {
            unawaited(profile.refreshFavoriteStates());
          }
          await Navigator.of(context).push<void>(
            MaterialPageRoute(
              builder: (_) => AnimatedBuilder(
                animation: this,
                builder: (_, _) => CouponDetailScreen.fromPublicProfile(
                  key: ValueKey('public-coupon-$_authGeneration'),
                  profile: profile,
                  offer: offer,
                  boundedSavedCoordinator: _saved,
                  useBoundedCoupon: (_) => _useProfileCoupon(profile, offer),
                  openBoundedRestaurant: (context) async =>
                      Navigator.of(context).pop(),
                ),
              ),
            ),
          );
          profile.viewOffer(null);
        },
      );

  Widget buildBrowse(BuildContext context, int refresh, String authRealm) {
    if (authRealm != _auth.realmKey || _readAuth().realmKey != authRealm) {
      return const Center(child: CircularProgressIndicator());
    }
    return CustomerBiteSaverBrowseScreen(
      coordinator: browse,
      disposeCoordinator: false,
      navigationRefreshGeneration: refresh,
      timeContextProvider: () async {
        final value = await _proofService.getTimeContext();
        return CustomerBiteSaverTimeContext(
          timeZone: value.timeZone,
          utcOffsetMinutes: value.utcOffsetMinutes,
        );
      },
      onAction: CustomerBiteSaverBrowseDestinationHandler(
        currentCoordinatesProvider: _currentCoordinatesProvider,
      ).call,
    );
  }

  Widget buildAccount(BuildContext context, String authRealm) =>
      CustomerAccountScreen(
        userStream: _userChanges(),
        profileDestinationBuilder: (_, user) {
          final owner = _saved;
          final current = _readAuth();
          if (owner == null ||
              !current.isSigned ||
              current.uid != user.uid ||
              owner.authRealmKey != authRealm) {
            return const Scaffold(
              body: Center(child: Text('Please sign in to continue')),
            );
          }
          return CustomerProfileScreen.fromCustomerBiteSaver(
            currentUser: user,
            savedCoordinator: owner,
          );
        },
      );

  static String _newInstanceId() {
    final random = Random.secure();
    return base64UrlEncode(
      List.generate(24, (_) => random.nextInt(256)),
    ).replaceAll('=', '');
  }

  @override
  void dispose() {
    _authGeneration += 1;
    unawaited(_subscription.cancel());
    for (final profile in _publicProfiles.toList()) {
      profile.dispose();
    }
    _profileDeviceUse.dispose();
    _profileAttempt = null;
    _profileInFlight = null;
    browse.dispose();
    _saved?.dispose();
    super.dispose();
  }
}

final class _ProfileUseAttempt {
  _ProfileUseAttempt(
    this.catalogId,
    this.restaurantId,
    this.offer,
    this.requestId,
  );
  final String catalogId, requestId;
  final CustomerBiteSaverRestaurantId restaurantId;
  final CustomerBiteSaverOffer offer;
  Map<String, Object?>? contextRequest;
  CustomerBiteSaverProfileUseContext? access;
  CustomerBiteSaverCombinedUseRequest? request;
}
