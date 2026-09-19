import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import '../models/customer_bitesaver_device_usage.dart';
import '../models/customer_bitesaver_favorite.dart';
import '../models/customer_bitesaver_saved.dart';
import '../models/customer_bitesaver_search.dart';
import 'customer_bitesaver_device_proof_service.dart';
import 'customer_bitesaver_device_use_service.dart';
import 'customer_bitesaver_favorite_service.dart';
import 'customer_bitesaver_search_coordinator.dart';
import 'customer_bitesaver_service.dart';

typedef CustomerBiteSaverSavedRequestIdGenerator = String Function();
typedef CustomerBiteSaverSavedAccountCurrent = bool Function(String userId);
typedef CustomerBiteSaverSavedTimeContextProvider =
    Future<({String timeZone, int utcOffsetMinutes})> Function();
typedef CustomerBiteSaverSavedCurrentCoordinatesProvider =
    Future<CustomerBiteSaverCoordinates> Function();
typedef CustomerBiteSaverSavedRestaurantWrite =
    Future<void> Function(
      CustomerBiteSaverRestaurantFavoriteIdentity identity,
      String expectedUserId,
    );
typedef CustomerBiteSaverSavedRestaurantRemove =
    Future<void> Function(
      CustomerBiteSaverRestaurantId restaurantId,
      String expectedUserId,
    );
typedef CustomerBiteSaverSavedCouponWrite =
    Future<void> Function(
      CustomerBiteSaverCouponFavoriteIdentity identity,
      String expectedUserId,
    );
typedef CustomerBiteSaverSavedCouponRemove =
    Future<void> Function(
      CustomerBiteSaverOfferId offerId,
      String expectedUserId,
    );

@immutable
final class CustomerBiteSaverSavedFavoriteActions {
  const CustomerBiteSaverSavedFavoriteActions({
    required this.upsertRestaurant,
    required this.removeRestaurant,
    required this.upsertCoupon,
    required this.removeCoupon,
  });

  factory CustomerBiteSaverSavedFavoriteActions.fromService(
    CustomerBiteSaverFavoriteService service,
  ) => CustomerBiteSaverSavedFavoriteActions(
    upsertRestaurant: (identity, userId) =>
        service.upsertRestaurantFavorite(identity, expectedUserId: userId),
    removeRestaurant: (restaurantId, userId) =>
        service.removeRestaurantFavorite(restaurantId, expectedUserId: userId),
    upsertCoupon: (identity, userId) =>
        service.upsertCouponFavorite(identity, expectedUserId: userId),
    removeCoupon: (offerId, userId) =>
        service.removeCouponFavorite(offerId, expectedUserId: userId),
  );

  final CustomerBiteSaverSavedRestaurantWrite upsertRestaurant;
  final CustomerBiteSaverSavedRestaurantRemove removeRestaurant;
  final CustomerBiteSaverSavedCouponWrite upsertCoupon;
  final CustomerBiteSaverSavedCouponRemove removeCoupon;
}

@immutable
final class CustomerBiteSaverSavedAccess {
  const CustomerBiteSaverSavedAccess._({
    required CustomerBiteSaverSavedCoordinator owner,
    required int generation,
    required this.restaurant,
    required this.offer,
    required this.accessToken,
  }) : _owner = owner,
       _generation = generation;

  final CustomerBiteSaverSavedCoordinator _owner;
  final int _generation;
  final CustomerBiteSaverRestaurant restaurant;
  final CustomerBiteSaverOffer? offer;
  final String accessToken;

  bool get isCurrent => _owner.isAccessCurrent(this);
  bool get hasDisplayableRedemption =>
      offer != null &&
      _owner.hasDisplayableRedemptionPresentation(offer!.offerId);
  CustomerBiteSaverRedemptionPresentation? get redemptionPresentation =>
      offer == null ? null : _owner.redemptionPresentationFor(offer!.offerId);
  int get redemptionPresentationNowMillis =>
      _owner.redemptionPresentationNowMillis;
  String get authRealmKey => _owner.authRealmKey;
  Listenable get changes => _owner;
}

final class CustomerBiteSaverSavedCoordinator extends ChangeNotifier
    implements
        CustomerBiteSaverFavoriteStateOwner,
        CustomerBiteSaverRedemptionPresentationOwner {
  CustomerBiteSaverSavedCoordinator({
    required String userId,
    required CustomerBiteSaverSavedApi api,
    required CustomerBiteSaverSavedFavoriteActions favoriteActions,
    required CustomerBiteSaverSavedAccountCurrent isAccountCurrent,
    CustomerBiteSaverSavedRequestIdGenerator? requestIdGenerator,
    CustomerBiteSaverSavedTimeContextProvider? timeContextProvider,
    CustomerBiteSaverSavedCurrentCoordinatesProvider?
    currentCoordinatesProvider,
    CustomerBiteSaverDeviceUseService? deviceUseService,
    DateTime Function()? clock,
  }) : _userId = userId,
       _api = api,
       _favoriteActions = favoriteActions,
       _isAccountCurrent = isAccountCurrent,
       _requestIdGenerator = requestIdGenerator ?? _secureRequestId,
       _timeContextProvider = timeContextProvider,
       _currentCoordinatesProvider = currentCoordinatesProvider,
       _deviceUseService =
           deviceUseService ??
           CustomerBiteSaverDeviceUseService(
             proofService: CustomerBiteSaverDeviceProofService(),
           ),
       _clock = clock ?? DateTime.now {
    if (userId.isEmpty || userId.contains('/')) {
      throw ArgumentError.value(userId, 'userId');
    }
  }

  factory CustomerBiteSaverSavedCoordinator.firebase({
    required String userId,
    FirebaseAuth? auth,
    CustomerBiteSaverService? api,
    CustomerBiteSaverFavoriteService? favoriteService,
    CustomerBiteSaverSavedTimeContextProvider? timeContextProvider,
    CustomerBiteSaverSavedCurrentCoordinatesProvider?
    currentCoordinatesProvider,
  }) {
    final firebaseAuth = auth ?? FirebaseAuth.instance;
    return CustomerBiteSaverSavedCoordinator(
      userId: userId,
      api: api ?? CustomerBiteSaverService(),
      favoriteActions: CustomerBiteSaverSavedFavoriteActions.fromService(
        favoriteService ??
            CustomerBiteSaverFavoriteService.firebase(auth: firebaseAuth),
      ),
      isAccountCurrent: (expectedUserId) {
        final user = firebaseAuth.currentUser;
        return user != null && !user.isAnonymous && user.uid == expectedUserId;
      },
      timeContextProvider: timeContextProvider,
      currentCoordinatesProvider: currentCoordinatesProvider,
    );
  }

  final String _userId;
  final CustomerBiteSaverSavedApi _api;
  final CustomerBiteSaverSavedFavoriteActions _favoriteActions;
  final CustomerBiteSaverSavedAccountCurrent _isAccountCurrent;
  final CustomerBiteSaverSavedRequestIdGenerator _requestIdGenerator;
  final CustomerBiteSaverSavedTimeContextProvider? _timeContextProvider;
  final CustomerBiteSaverSavedCurrentCoordinatesProvider?
  _currentCoordinatesProvider;
  final CustomerBiteSaverDeviceUseService _deviceUseService;
  final DateTime Function() _clock;

  final Map<CustomerBiteSaverSavedSection, List<CustomerBiteSaverSavedEntry>>
  _entries = <CustomerBiteSaverSavedSection, List<CustomerBiteSaverSavedEntry>>{
    CustomerBiteSaverSavedSection.restaurants: <CustomerBiteSaverSavedEntry>[],
    CustomerBiteSaverSavedSection.coupons: <CustomerBiteSaverSavedEntry>[],
  };
  final Map<CustomerBiteSaverSavedSection, String?> _cursors =
      <CustomerBiteSaverSavedSection, String?>{
        CustomerBiteSaverSavedSection.restaurants: null,
        CustomerBiteSaverSavedSection.coupons: null,
      };
  final Map<CustomerBiteSaverSavedSection, bool> _hasMore =
      <CustomerBiteSaverSavedSection, bool>{
        CustomerBiteSaverSavedSection.restaurants: false,
        CustomerBiteSaverSavedSection.coupons: false,
      };
  final Map<CustomerBiteSaverSavedSection, bool> _loaded =
      <CustomerBiteSaverSavedSection, bool>{
        CustomerBiteSaverSavedSection.restaurants: false,
        CustomerBiteSaverSavedSection.coupons: false,
      };
  final Map<CustomerBiteSaverSavedSection, bool> _loading =
      <CustomerBiteSaverSavedSection, bool>{
        CustomerBiteSaverSavedSection.restaurants: false,
        CustomerBiteSaverSavedSection.coupons: false,
      };
  final Map<CustomerBiteSaverSavedSection, Object?> _errors =
      <CustomerBiteSaverSavedSection, Object?>{};
  final Map<CustomerBiteSaverSavedSection, int> _loadVersions =
      <CustomerBiteSaverSavedSection, int>{};
  final Map<String, CustomerBiteSaverFavoriteState> _states =
      <String, CustomerBiteSaverFavoriteState>{};
  final Map<String, int> _operationRevisions = <String, int>{};
  final Set<String> _pendingIds = <String>{};
  final Set<String> _issuedRequestIds = <String>{};
  final Set<CustomerBiteSaverSavedSection> _refreshAfterLoad =
      <CustomerBiteSaverSavedSection>{};
  final Map<String, CustomerBiteSaverRedemptionPresentation>
  _redemptionPresentations =
      <String, CustomerBiteSaverRedemptionPresentation>{};
  _SavedRedemptionAttempt? _pendingRedemptionAttempt;
  _SavedRedemptionInFlight? _redemptionInFlight;
  CustomerBiteSaverSavedAccess? _couponUseAccess;
  bool _disposed = false;
  int _generation = 0;
  int _couponUseGeneration = 0;

  @override
  String get authRealmKey => 'signed:$_userId';

  bool get canUseCoupons => _timeContextProvider != null;

  bool get isDisposed => _disposed;

  int get redemptionPresentationNowMillis => _clock().millisecondsSinceEpoch;

  List<CustomerBiteSaverRedemptionPresentation>
  get activeDeviceRedemptionPresentations => List.unmodifiable(
    _redemptionPresentations.values.where(
      (value) => value.isDeviceTimerActiveAt(redemptionPresentationNowMillis),
    ),
  );

  @override
  CustomerBiteSaverRedemptionPresentation? redemptionPresentationFor(
    CustomerBiteSaverOfferId offerId,
  ) => _redemptionPresentations[offerId.value];

  bool hasDisplayableRedemptionPresentation(CustomerBiteSaverOfferId offerId) {
    final presentation = redemptionPresentationFor(offerId);
    return presentation != null &&
        presentation.isActiveAt(redemptionPresentationNowMillis);
  }

  @override
  void recordRedemptionPresentation(
    CustomerBiteSaverRedemptionPresentation presentation, {
    required String expectedAuthRealmKey,
  }) {
    if (!_isUsable || expectedAuthRealmKey != authRealmKey) return;
    _redemptionPresentations[presentation.offerId.value] = presentation;
    notifyListeners();
  }

  List<CustomerBiteSaverSavedEntry> entries(
    CustomerBiteSaverSavedSection section,
  ) => List<CustomerBiteSaverSavedEntry>.unmodifiable(_entries[section]!);

  bool isLoaded(CustomerBiteSaverSavedSection section) => _loaded[section]!;
  bool isLoading(CustomerBiteSaverSavedSection section) => _loading[section]!;
  bool hasMore(CustomerBiteSaverSavedSection section) => _hasMore[section]!;
  Object? errorFor(CustomerBiteSaverSavedSection section) => _errors[section];
  bool isPending(String id) => _pendingIds.contains(id);

  @override
  CustomerBiteSaverFavoriteState restaurantFavoriteState(
    CustomerBiteSaverRestaurantId restaurantId,
  ) => _states[restaurantId.value] ?? CustomerBiteSaverFavoriteState.unknown;

  @override
  CustomerBiteSaverFavoriteState offerFavoriteState(
    CustomerBiteSaverOfferId offerId,
  ) => _states[offerId.value] ?? CustomerBiteSaverFavoriteState.unknown;

  @override
  int operationRevision(String id) => _operationRevisions[id] ?? 0;

  @override
  void mergeResolvedStates(
    List<CustomerBiteSaverFavoriteStateEntry> states,
    Map<String, int> expectedRevisions,
  ) {
    if (_disposed || !_accountIsCurrent) return;
    var changed = false;
    for (final entry in states) {
      final id = entry.idValue;
      if (operationRevision(id) != expectedRevisions[id]) continue;
      if (_states[id] != entry.state) {
        _states[id] = entry.state;
        changed = true;
      }
    }
    if (changed) notifyListeners();
  }

  Future<void> refreshAll() async {
    Object? firstError;
    StackTrace? firstStackTrace;
    for (final section in CustomerBiteSaverSavedSection.values) {
      if (!_isUsable) return;
      try {
        await refresh(section);
      } catch (error, stackTrace) {
        firstError ??= error;
        firstStackTrace ??= stackTrace;
      }
    }
    if (firstError != null) {
      Error.throwWithStackTrace(firstError, firstStackTrace!);
    }
  }

  Future<void> ensureLoaded(CustomerBiteSaverSavedSection section) async {
    if (!_loaded[section]!) await refresh(section);
  }

  Future<void> refresh(CustomerBiteSaverSavedSection section) =>
      _load(section, append: false);

  Future<void> loadMore(CustomerBiteSaverSavedSection section) async {
    if (!_hasMore[section]! || _loading[section]!) return;
    await _load(section, append: true);
  }

  Future<void> _load(
    CustomerBiteSaverSavedSection section, {
    required bool append,
  }) async {
    _requireUsable();
    if (_loading[section]!) {
      if (!append) _refreshAfterLoad.add(section);
      return;
    }
    final cursor = append ? _cursors[section] : null;
    final startingRevisions = Map<String, int>.of(_operationRevisions);
    final version = (_loadVersions[section] ?? 0) + 1;
    _loadVersions[section] = version;
    final generation = _generation;
    _loading[section] = true;
    _errors.remove(section);
    notifyListeners();
    try {
      final result = await _api.getCustomerBiteSaverSavedPage(
        CustomerBiteSaverSavedPageRequest(
          clientRequestId: _nextRequestId(),
          section: section,
          cursor: cursor,
        ),
      );
      if (!_ownsCompletion(generation) || _loadVersions[section] != version) {
        return;
      }
      final currentEntries = result.entries.where((entry) {
        final startingRevision = startingRevisions[entry.favoriteId] ?? 0;
        return operationRevision(entry.favoriteId) == startingRevision ||
            _states[entry.favoriteId] !=
                CustomerBiteSaverFavoriteState.notFavorite;
      });
      final combined = append
          ? <CustomerBiteSaverSavedEntry>[
              ..._entries[section]!,
              ...currentEntries,
            ]
          : <CustomerBiteSaverSavedEntry>[...currentEntries];
      final deduplicated = <String, CustomerBiteSaverSavedEntry>{};
      for (final entry in combined) {
        deduplicated.putIfAbsent(entry.favoriteId, () => entry);
      }
      _entries[section] = deduplicated.values.toList(growable: false);
      _cursors[section] = result.nextCursor;
      _hasMore[section] = result.hasMore;
      _loaded[section] = true;
      for (final entry in currentEntries) {
        if (operationRevision(entry.favoriteId) ==
            (startingRevisions[entry.favoriteId] ?? 0)) {
          _states[entry.favoriteId] = CustomerBiteSaverFavoriteState.favorite;
        }
      }
      _errors.remove(section);
    } catch (error) {
      if (_ownsCompletion(generation) && _loadVersions[section] == version) {
        _errors[section] = error;
      }
      rethrow;
    } finally {
      if (_ownsCompletion(generation) && _loadVersions[section] == version) {
        _loading[section] = false;
        notifyListeners();
        if (_refreshAfterLoad.remove(section)) {
          unawaited(refresh(section).catchError((_) {}));
        }
      }
    }
  }

  CustomerBiteSaverSavedAccess captureAccess(
    CustomerBiteSaverSavedEntry entry,
  ) {
    _requireUsable();
    final restaurant = entry.restaurant;
    final accessToken = entry.accessToken;
    if (!entry.isAvailable || restaurant == null || accessToken == null) {
      throw StateError('That Saved item is unavailable.');
    }
    return CustomerBiteSaverSavedAccess._(
      owner: this,
      generation: _generation,
      restaurant: restaurant,
      offer: entry.offer,
      accessToken: accessToken,
    );
  }

  bool isAccessCurrent(CustomerBiteSaverSavedAccess access) =>
      identical(access._owner, this) &&
      access._generation == _generation &&
      _isUsable;

  Future<CustomerBiteSaverMenuPageResult> loadMenuPage(
    CustomerBiteSaverSavedAccess access,
    String? cursor,
  ) async {
    if (!isAccessCurrent(access)) {
      throw const CustomerBiteSaverStaleOperationException();
    }
    final generation = _generation;
    final result = await _api.getCustomerBiteSaverSavedMenuPage(
      CustomerBiteSaverSavedMenuPageRequest(
        clientRequestId: _nextRequestId(),
        accessToken: access.accessToken,
        cursor: cursor,
      ),
    );
    if (!_ownsCompletion(generation) ||
        result.restaurantId != access.restaurant.restaurantId) {
      throw const CustomerBiteSaverStaleOperationException();
    }
    return result;
  }

  Future<CustomerBiteSaverRedemptionPresentation> useCoupon(
    CustomerBiteSaverSavedAccess access, {
    bool Function()? isCurrent,
  }) {
    _requireUsable();
    final offer = access.offer;
    if (!isAccessCurrent(access) ||
        (isCurrent != null && !isCurrent()) ||
        offer == null ||
        offer.offerType != CustomerBiteSaverOfferType.coupon) {
      throw const CustomerBiteSaverStaleOperationException();
    }
    if (_timeContextProvider == null) {
      throw StateError(
        'Saved coupon use requires the customer time context provider.',
      );
    }
    final inFlight = _redemptionInFlight;
    if (inFlight != null) {
      if (inFlight.restaurantId == access.restaurant.restaurantId &&
          inFlight.offerId == offer.offerId) {
        return inFlight.operation;
      }
      throw StateError(
        'An in-flight or uncertain Saved redemption must settle or recover.',
      );
    }
    final pending = _pendingRedemptionAttempt;
    if (pending != null &&
        (pending.restaurantId != access.restaurant.restaurantId ||
            pending.offerId != offer.offerId)) {
      throw StateError(
        'An uncertain Saved redemption must be recovered before another use.',
      );
    }
    _couponUseAccess = access;
    late final Future<CustomerBiteSaverRedemptionPresentation> operation;
    operation = _runCouponUse(access, isCurrent: isCurrent).whenComplete(() {
      if (identical(_redemptionInFlight?.operation, operation)) {
        _redemptionInFlight = null;
        if (_pendingRedemptionAttempt == null) _couponUseAccess = null;
      }
    });
    _redemptionInFlight = _SavedRedemptionInFlight(
      restaurantId: access.restaurant.restaurantId,
      offerId: offer.offerId,
      operation: operation,
    );
    return operation;
  }

  /// Cancels pending foreground work without erasing a confirmed timer.
  void cancelCouponUse(CustomerBiteSaverSavedAccess access) {
    if (!identical(access._owner, this) ||
        !identical(_couponUseAccess, access)) {
      return;
    }
    _couponUseGeneration += 1;
    _pendingRedemptionAttempt = null;
    _redemptionInFlight = null;
    _couponUseAccess = null;
    _deviceUseService.cancel();
  }

  Future<CustomerBiteSaverRedemptionPresentation> _runCouponUse(
    CustomerBiteSaverSavedAccess access, {
    bool Function()? isCurrent,
  }) async {
    final offer = access.offer!;
    final generation = _generation;
    final useGeneration = _couponUseGeneration;
    bool ownsOperation() =>
        useGeneration == _couponUseGeneration &&
        _ownsCompletion(generation) &&
        isAccessCurrent(access) &&
        (isCurrent == null || isCurrent());
    void requireOwnedOperation() {
      if (!ownsOperation()) {
        throw const CustomerBiteSaverStaleOperationException();
      }
    }

    var attempt = _pendingRedemptionAttempt;
    if (attempt == null) {
      final time = await _timeContextProvider!.call();
      requireOwnedOperation();
      CustomerBiteSaverCoordinates? coordinates;
      if (offer.isProximityOnly) {
        final loader = _currentCoordinatesProvider;
        if (loader == null) {
          throw StateError('Current location is required for this coupon.');
        }
        coordinates = await loader();
        requireOwnedOperation();
      }
      attempt = _SavedRedemptionAttempt(
        restaurantId: access.restaurant.restaurantId,
        offerId: offer.offerId,
        offerOccurrence: offer.offerOccurrence,
        usagePolicy:
            offer.usagePolicy ??
            (throw const CustomerBiteSaverProtocolException()),
        request: CustomerBiteSaverCombinedUseRequest(
          logicalRequestId: _nextRequestId(),
          restaurantId: access.restaurant.restaurantId,
          offerId: offer.offerId,
          timeZone: time.timeZone,
          utcOffsetMinutes: time.utcOffsetMinutes,
          currentCoordinates: coordinates,
          origin: CustomerBiteSaverSavedUseAuthority(
            accessToken: access.accessToken,
          ),
        ),
      );
      _pendingRedemptionAttempt = attempt;
    }
    requireOwnedOperation();
    try {
      final result = await _deviceUseService.useCoupon(
        request: attempt.request,
        authenticatedUserId: _userId,
        isCurrent: ownsOperation,
      );
      requireOwnedOperation();
      _pendingRedemptionAttempt = null;
      final presentation =
          CustomerBiteSaverRedemptionPresentation.fromDeviceUse(
            result: result,
            offerOccurrence: attempt.offerOccurrence,
            usagePolicy: attempt.usagePolicy,
          );
      recordRedemptionPresentation(
        presentation,
        expectedAuthRealmKey: authRealmKey,
      );
      return presentation;
    } catch (error) {
      // Only an uncertain server outcome retains its exact frozen request.
      // The device service retains the matching proof until challenge expiry.
      if (identical(_pendingRedemptionAttempt, attempt) &&
          (error is! CustomerBiteSaverDeviceUseException ||
              (error.kind != CustomerBiteSaverDeviceUseFailureKind.ambiguous &&
                  error.kind !=
                      CustomerBiteSaverDeviceUseFailureKind.invalidResponse))) {
        _pendingRedemptionAttempt = null;
      }
      rethrow;
    }
  }

  @override
  Future<void> setRestaurantFavorite(
    CustomerBiteSaverRestaurant restaurant,
    bool favorite,
  ) async {
    final id = restaurant.restaurantId.value;
    await _runFavoriteWrite(
      id: id,
      section: CustomerBiteSaverSavedSection.restaurants,
      favorite: favorite,
      write: () => favorite
          ? _favoriteActions.upsertRestaurant(
              CustomerBiteSaverRestaurantFavoriteIdentity(
                restaurantId: restaurant.restaurantId,
              ),
              _userId,
            )
          : _favoriteActions.removeRestaurant(restaurant.restaurantId, _userId),
    );
  }

  Future<void> removeRestaurantFavorite(
    CustomerBiteSaverRestaurantId restaurantId,
  ) => _runFavoriteWrite(
    id: restaurantId.value,
    section: CustomerBiteSaverSavedSection.restaurants,
    favorite: false,
    write: () => _favoriteActions.removeRestaurant(restaurantId, _userId),
  );

  @override
  Future<void> setOfferFavorite(
    CustomerBiteSaverRestaurant restaurant,
    CustomerBiteSaverOffer offer,
    bool favorite,
  ) async {
    if (offer.offerType != CustomerBiteSaverOfferType.coupon) {
      throw StateError('Only BiteSaver coupons can be saved.');
    }
    await _runFavoriteWrite(
      id: offer.offerId.value,
      section: CustomerBiteSaverSavedSection.coupons,
      favorite: favorite,
      write: () => favorite
          ? _favoriteActions.upsertCoupon(
              CustomerBiteSaverCouponFavoriteIdentity(
                restaurantId: restaurant.restaurantId,
                offerId: offer.offerId,
              ),
              _userId,
            )
          : _favoriteActions.removeCoupon(offer.offerId, _userId),
    );
  }

  Future<void> removeCouponFavorite(CustomerBiteSaverOfferId offerId) =>
      _runFavoriteWrite(
        id: offerId.value,
        section: CustomerBiteSaverSavedSection.coupons,
        favorite: false,
        write: () => _favoriteActions.removeCoupon(offerId, _userId),
      );

  Future<void> _runFavoriteWrite({
    required String id,
    required CustomerBiteSaverSavedSection section,
    required bool favorite,
    required Future<void> Function() write,
  }) async {
    _requireUsable();
    if (_pendingIds.contains(id)) {
      throw StateError('That Saved item is already being updated.');
    }
    final generation = _generation;
    final revision = operationRevision(id) + 1;
    _operationRevisions[id] = revision;
    _pendingIds.add(id);
    notifyListeners();
    try {
      await write();
      if (!_ownsCompletion(generation) || operationRevision(id) != revision) {
        return;
      }
      _states[id] = favorite
          ? CustomerBiteSaverFavoriteState.favorite
          : CustomerBiteSaverFavoriteState.notFavorite;
      if (!favorite) {
        _entries[section] = _entries[section]!
            .where((entry) => entry.favoriteId != id)
            .toList(growable: false);
      }
      notifyListeners();
      if (favorite && _loaded[section]!) {
        try {
          await refresh(section);
        } catch (_) {
          // The confirmed heart remains truthful. Saved keeps its prior page
          // and exposes the bounded refresh error for an explicit retry.
        }
      }
    } finally {
      if (_ownsCompletion(generation) && operationRevision(id) == revision) {
        _pendingIds.remove(id);
        notifyListeners();
      }
    }
  }

  bool get _accountIsCurrent => _isAccountCurrent(_userId);
  bool get _isUsable => !_disposed && _accountIsCurrent;

  void _requireUsable() {
    if (!_isUsable) throw const CustomerBiteSaverStaleOperationException();
  }

  bool _ownsCompletion(int generation) =>
      !_disposed && generation == _generation && _accountIsCurrent;

  String _nextRequestId() {
    final requestId = _requestIdGenerator();
    if (!RegExp(r'^[A-Za-z0-9_-]{16,128}$').hasMatch(requestId) ||
        !_issuedRequestIds.add(requestId)) {
      throw StateError('The Saved request ID generator returned invalid data.');
    }
    return requestId;
  }

  static String _secureRequestId() {
    final random = Random.secure();
    return base64UrlEncode(
      List<int>.generate(24, (_) => random.nextInt(256)),
    ).replaceAll('=', '');
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _generation += 1;
    _couponUseGeneration += 1;
    _deviceUseService.dispose();
    _loadVersions.updateAll((_, value) => value + 1);
    _pendingIds.clear();
    _refreshAfterLoad.clear();
    _pendingRedemptionAttempt = null;
    _redemptionInFlight = null;
    _couponUseAccess = null;
    final nowMillis = redemptionPresentationNowMillis;
    _redemptionPresentations.removeWhere(
      (_, presentation) => !presentation.isDeviceTimerActiveAt(nowMillis),
    );
    super.dispose();
  }
}

final class _SavedRedemptionAttempt {
  const _SavedRedemptionAttempt({
    required this.restaurantId,
    required this.offerId,
    required this.offerOccurrence,
    required this.usagePolicy,
    required this.request,
  });

  final CustomerBiteSaverRestaurantId restaurantId;
  final CustomerBiteSaverOfferId offerId;
  final String offerOccurrence;
  final CustomerBiteSaverUsagePolicy usagePolicy;
  final CustomerBiteSaverCombinedUseRequest request;
}

final class _SavedRedemptionInFlight {
  const _SavedRedemptionInFlight({
    required this.restaurantId,
    required this.offerId,
    required this.operation,
  });

  final CustomerBiteSaverRestaurantId restaurantId;
  final CustomerBiteSaverOfferId offerId;
  final Future<CustomerBiteSaverRedemptionPresentation> operation;
}
