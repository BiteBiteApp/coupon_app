import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../models/customer_bitesaver_favorite.dart';
import '../models/customer_bitesaver_search.dart';
import 'customer_bitesaver_favorite_service.dart';
import 'customer_bitesaver_guest_usage_store.dart';
import 'customer_bitesaver_service.dart';
import 'customer_load_more_controller.dart';

typedef CustomerBiteSaverRequestIdGenerator = String Function();
typedef CustomerBiteSaverDelay = Future<void> Function(Duration duration);
typedef CustomerBiteSaverScheduler =
    CustomerBiteSaverScheduledTask Function(
      Duration delay,
      void Function() callback,
    );

abstract interface class CustomerBiteSaverScheduledTask {
  void cancel();
}

final class _TimerScheduledTask implements CustomerBiteSaverScheduledTask {
  _TimerScheduledTask(this._timer);

  final Timer _timer;

  @override
  void cancel() => _timer.cancel();
}

@immutable
final class CustomerBiteSaverAuthSnapshot {
  const CustomerBiteSaverAuthSnapshot.signedOut()
    : uid = null,
      isAnonymous = false;

  const CustomerBiteSaverAuthSnapshot.anonymous(String this.uid)
    : isAnonymous = true;

  const CustomerBiteSaverAuthSnapshot.signed(String this.uid)
    : isAnonymous = false;

  final String? uid;
  final bool isAnonymous;

  bool get isGuest => uid == null || isAnonymous;
  bool get isSigned => uid != null && !isAnonymous;

  String get realmKey => isGuest ? 'guest' : 'signed:$uid';
}

enum CustomerBiteSaverCoordinatorStatus {
  idle,
  starting,
  preparing,
  ready,
  failed,
  expired,
  error,
  paused,
  freshSearchRequired,
}

enum CustomerBiteSaverLocalUsageOverlayState {
  notApplicable,
  clear,
  unavailable,
  activeTimer,
  unknown,
}

@immutable
final class CustomerBiteSaverEffectiveOfferAvailability {
  const CustomerBiteSaverEffectiveOfferAvailability({
    required this.serverAvailable,
    required this.serverUsageState,
    required this.localUsageState,
    required this.localActiveTimerExpiresAtMillis,
  });

  final bool serverAvailable;
  final CustomerBiteSaverUsageState serverUsageState;
  final CustomerBiteSaverLocalUsageOverlayState localUsageState;
  final int? localActiveTimerExpiresAtMillis;

  bool get available =>
      serverAvailable &&
      serverUsageState == CustomerBiteSaverUsageState.available &&
      (localUsageState == CustomerBiteSaverLocalUsageOverlayState.clear ||
          localUsageState ==
              CustomerBiteSaverLocalUsageOverlayState.notApplicable);
}

enum _StatusPollPurpose { preparing, readyExpiry, pageReconciliation }

final class CustomerBiteSaverStaleOperationException implements Exception {
  const CustomerBiteSaverStaleOperationException();

  @override
  String toString() => 'The BiteSaver operation no longer owns client state.';
}

final class CustomerBiteSaverFreshSearchRequiredException implements Exception {
  const CustomerBiteSaverFreshSearchRequiredException();

  @override
  String toString() => 'A fresh BiteSaver search is required.';
}

final class CustomerBiteSaverProtocolBudgetException implements Exception {
  const CustomerBiteSaverProtocolBudgetException();

  @override
  String toString() => 'The BiteSaver polling budget was exhausted.';
}

typedef CustomerBiteSaverRestaurantFavoriteWrite =
    Future<void> Function(CustomerBiteSaverRestaurantFavoriteIdentity identity);
typedef CustomerBiteSaverRestaurantFavoriteRemove =
    Future<void> Function(CustomerBiteSaverRestaurantId restaurantId);
typedef CustomerBiteSaverCouponFavoriteWrite =
    Future<void> Function(CustomerBiteSaverCouponFavoriteIdentity identity);
typedef CustomerBiteSaverCouponFavoriteRemove =
    Future<void> Function(CustomerBiteSaverOfferId offerId);

/// The narrow write-only seam over the already-canonical favorite facade.
final class CustomerBiteSaverFavoriteActions {
  const CustomerBiteSaverFavoriteActions({
    required this.upsertRestaurant,
    required this.removeRestaurant,
    required this.upsertCoupon,
    required this.removeCoupon,
  });

  factory CustomerBiteSaverFavoriteActions.fromService(
    CustomerBiteSaverFavoriteService service,
  ) => CustomerBiteSaverFavoriteActions(
    upsertRestaurant: service.upsertRestaurantFavorite,
    removeRestaurant: service.removeRestaurantFavorite,
    upsertCoupon: service.upsertCouponFavorite,
    removeCoupon: service.removeCouponFavorite,
  );

  final CustomerBiteSaverRestaurantFavoriteWrite upsertRestaurant;
  final CustomerBiteSaverRestaurantFavoriteRemove removeRestaurant;
  final CustomerBiteSaverCouponFavoriteWrite upsertCoupon;
  final CustomerBiteSaverCouponFavoriteRemove removeCoupon;
}

/// A presentation-safe validation view. Authorization tokens stay private.
@immutable
final class CustomerBiteSaverRedemptionDecision {
  const CustomerBiteSaverRedemptionDecision({
    required this.restaurantId,
    required this.offerId,
    required this.allowed,
    required this.reason,
    required this.evaluatedAtMillis,
    required this.activeTimerExpiresAtMillis,
    required this.nextAvailableAtMillis,
    required this.validationExpiresAtMillis,
  });

  final CustomerBiteSaverRestaurantId restaurantId;
  final CustomerBiteSaverOfferId offerId;
  final bool allowed;
  final String reason;
  final int evaluatedAtMillis;
  final int? activeTimerExpiresAtMillis;
  final int? nextAvailableAtMillis;
  final int? validationExpiresAtMillis;
}

@immutable
final class CustomerBiteSaverRedemptionReceipt {
  const CustomerBiteSaverRedemptionReceipt._({
    this.signedResult,
    this.guestResult,
    this.guestUnlimitedRestaurantId,
    this.guestUnlimitedOfferId,
  });

  factory CustomerBiteSaverRedemptionReceipt.signed(
    CustomerBiteSaverRedemptionStartResult result,
  ) => CustomerBiteSaverRedemptionReceipt._(signedResult: result);

  factory CustomerBiteSaverRedemptionReceipt.guest(
    CustomerBiteSaverGuestRedemptionStart result,
  ) => CustomerBiteSaverRedemptionReceipt._(guestResult: result);

  factory CustomerBiteSaverRedemptionReceipt.guestUnlimited({
    required CustomerBiteSaverRestaurantId restaurantId,
    required CustomerBiteSaverOfferId offerId,
  }) => CustomerBiteSaverRedemptionReceipt._(
    guestUnlimitedRestaurantId: restaurantId,
    guestUnlimitedOfferId: offerId,
  );

  final CustomerBiteSaverRedemptionStartResult? signedResult;
  final CustomerBiteSaverGuestRedemptionStart? guestResult;
  final CustomerBiteSaverRestaurantId? guestUnlimitedRestaurantId;
  final CustomerBiteSaverOfferId? guestUnlimitedOfferId;

  bool get isGuest => guestResult != null || guestUnlimitedOfferId != null;
  bool get isUnlimited =>
      signedResult?.status == CustomerBiteSaverRedemptionStatus.unlimited ||
      guestUnlimitedOfferId != null;
  int? get timerStartedAtMillis =>
      signedResult?.timerStartedAtMillis ?? guestResult?.timerStartedAtMillis;
  int? get timerExpiresAtMillis =>
      signedResult?.timerExpiresAtMillis ?? guestResult?.timerExpiresAtMillis;
}

/// Owns one foreground BiteSaver search/session and its user-requested pages.
///
/// This deliberately has no screen dependencies. Every asynchronous completion
/// is fenced by the coordinator generation, auth realm, criteria, session,
/// attempt/query generation, and (for guests) durable local revision.
final class CustomerBiteSaverSearchCoordinator extends ChangeNotifier {
  CustomerBiteSaverSearchCoordinator({
    required CustomerBiteSaverApi api,
    required CustomerBiteSaverGuestUsageStore guestUsageStore,
    required String clientInstanceId,
    required CustomerBiteSaverAuthSnapshot initialAuth,
    CustomerBiteSaverFavoriteActions? favoriteActions,
    CustomerBiteSaverRequestIdGenerator? requestIdGenerator,
    DateTime Function()? clock,
    CustomerBiteSaverScheduler? scheduler,
    CustomerBiteSaverDelay? delay,
    this.statusPollInterval = const Duration(milliseconds: 750),
    this.guestRetryDelay = const Duration(milliseconds: 250),
    this.maximumStatusPolls = 20,
    this.maximumGuestProtocolSteps = 12,
  }) : _api = api,
       _guestUsageStore = guestUsageStore,
       _clientInstanceId = clientInstanceId,
       _auth = initialAuth,
       _favoriteActions = favoriteActions,
       _requestIdGenerator = requestIdGenerator ?? _secureRequestId,
       _clock = clock ?? DateTime.now,
       _scheduler = scheduler ?? _timerScheduler,
       _delay = delay ?? Future<void>.delayed {
    if (maximumStatusPolls < 1 || maximumGuestProtocolSteps < 1) {
      throw ArgumentError('Polling and continuation budgets must be positive.');
    }
    if (statusPollInterval < Duration.zero || guestRetryDelay < Duration.zero) {
      throw ArgumentError('Coordinator delays cannot be negative.');
    }
    _validateAuthSnapshot(_auth);
    if (!RegExp(r'^[A-Za-z0-9_-]{16,128}$').hasMatch(_clientInstanceId)) {
      throw ArgumentError.value(
        _clientInstanceId,
        'clientInstanceId',
        'The stable client instance ID is invalid.',
      );
    }
  }

  final CustomerBiteSaverApi _api;
  final CustomerBiteSaverGuestUsageStore _guestUsageStore;
  final String _clientInstanceId;
  final CustomerBiteSaverFavoriteActions? _favoriteActions;
  final CustomerBiteSaverRequestIdGenerator _requestIdGenerator;
  final DateTime Function() _clock;
  final CustomerBiteSaverScheduler _scheduler;
  final CustomerBiteSaverDelay _delay;

  final Duration statusPollInterval;
  final Duration guestRetryDelay;
  final int maximumStatusPolls;
  final int maximumGuestProtocolSteps;

  CustomerBiteSaverAuthSnapshot _auth;
  CustomerBiteSaverCoordinatorStatus _status =
      CustomerBiteSaverCoordinatorStatus.idle;
  CustomerBiteSaverCoordinatorStatus? _statusBeforePause;
  CustomerBiteSaverSearchCriteria? _criteria;
  String? _criteriaKey;
  CustomerBiteSaverSessionBinding? _binding;
  int? _attemptGeneration;
  String? _queryFingerprint;
  int? _logicalExpiresAtMillis;
  int? _guestStateRevision;
  CustomerBiteSaverSearchProgress? _progress;
  CustomerBiteSaverFailureCode? _failureCode;
  bool _failureRetriable = false;
  Object? _error;
  StackTrace? _errorStackTrace;
  Object? _favoriteError;
  Object? _redemptionError;
  bool _disposed = false;
  int _generation = 0;
  int _statusPollCount = 0;
  int _statusAutomaticRetryCount = 0;
  Future<void>? _statusPollInFlight;
  CustomerBiteSaverScheduledTask? _scheduledStatusPoll;
  CustomerBiteSaverScheduledTask? _scheduledUsageContextExpiry;
  int? _usageContextValidUntilExclusiveMillis;
  CustomerBiteSaverStatusRequest? _pendingStatusRequest;
  _StatusPollPurpose? _pendingStatusPurpose;
  bool _pendingPageReconciliation = false;
  CustomerLoadMoreController<CustomerBiteSaverRestaurant>? _restaurantPager;
  final Map<String, CustomerLoadMoreController<CustomerBiteSaverOffer>>
  _offerPagers = <String, CustomerLoadMoreController<CustomerBiteSaverOffer>>{};
  final Set<String> _offerPagerRestartRequired = <String>{};
  final Map<String, CustomerBiteSaverRestaurant> _restaurants =
      <String, CustomerBiteSaverRestaurant>{};
  final Set<String> _deliveredRestaurantIds = <String>{};
  final Set<String> _deliveredOfferIds = <String>{};
  final Map<String, String> _observedOfferRestaurantIds = <String, String>{};
  final Map<String, String> _offerRestaurantIds = <String, String>{};
  final Map<String, CustomerBiteSaverOffer> _offers =
      <String, CustomerBiteSaverOffer>{};
  final Map<String, _LocalUsageOverlay> _localUsageOverlays =
      <String, _LocalUsageOverlay>{};
  final Map<String, CustomerBiteSaverFavoriteState> _restaurantFavorites =
      <String, CustomerBiteSaverFavoriteState>{};
  final Map<String, CustomerBiteSaverFavoriteState> _offerFavorites =
      <String, CustomerBiteSaverFavoriteState>{};
  final Map<String, int> _favoriteOperationVersions = <String, int>{};
  final Set<String> _issuedRequestIds = <String>{};
  final Map<String, _PendingOriginalCall> _pendingOriginalCalls =
      <String, _PendingOriginalCall>{};
  final Map<String, CustomerBiteSaverGuestContinuationRequest>
  _pendingGuestContinuations =
      <String, CustomerBiteSaverGuestContinuationRequest>{};
  final Map<String, _GuestProtocolProgress> _guestProtocolProgress =
      <String, _GuestProtocolProgress>{};
  final Map<String, CustomerBiteSaverRedemptionValidationRequest>
  _pendingValidationRequests =
      <String, CustomerBiteSaverRedemptionValidationRequest>{};
  _PendingSearch? _pendingSearch;
  _RedemptionAuthorization? _redemptionAuthorization;
  CustomerBiteSaverRedemptionDecision? _redemptionDecision;
  CustomerBiteSaverRedemptionStartRequest? _pendingSignedStart;
  int? _pendingGuestStartIntentGeneration;
  int _redemptionIntentGeneration = 0;
  _RedemptionIntent? _activeRedemptionIntent;
  _ValidationInFlight? _validationInFlight;
  _RedemptionStartInFlight? _redemptionStartInFlight;

  CustomerBiteSaverAuthSnapshot get auth => _auth;
  CustomerBiteSaverCoordinatorStatus get status => _status;
  CustomerBiteSaverSearchCriteria? get criteria => _criteria;
  CustomerBiteSaverSearchProgress? get progress => _progress;
  CustomerBiteSaverFailureCode? get failureCode => _failureCode;
  bool get failureRetriable => _failureRetriable;
  Object? get error => _error;
  StackTrace? get errorStackTrace => _errorStackTrace;
  Object? get favoriteError => _favoriteError;
  Object? get redemptionError => _redemptionError;
  int get statusPollCount => _statusPollCount;
  int? get logicalExpiresAtMillis => _logicalExpiresAtMillis;
  int? get guestStateRevision => _guestStateRevision;
  bool get hasSession => _binding != null;
  bool get isDisposed => _disposed;
  CustomerLoadMoreController<CustomerBiteSaverRestaurant>?
  get restaurantPager => _restaurantPager;
  CustomerBiteSaverRedemptionDecision? get redemptionDecision =>
      _redemptionDecision;

  List<CustomerBiteSaverRestaurant> get restaurants =>
      _restaurantPager?.items ?? const <CustomerBiteSaverRestaurant>[];

  CustomerBiteSaverFavoriteState restaurantFavoriteState(
    CustomerBiteSaverRestaurantId restaurantId,
  ) =>
      _restaurantFavorites[restaurantId.value] ??
      CustomerBiteSaverFavoriteState.unknown;

  CustomerBiteSaverFavoriteState offerFavoriteState(
    CustomerBiteSaverOfferId offerId,
  ) => _offerFavorites[offerId.value] ?? CustomerBiteSaverFavoriteState.unknown;

  CustomerBiteSaverEffectiveOfferAvailability effectiveOfferAvailability(
    CustomerBiteSaverOfferId offerId,
  ) {
    final offer = _offers[offerId.value];
    if (offer == null) {
      throw StateError('Only delivered offers have effective availability.');
    }
    final overlay = _effectiveLocalUsageOverlay(offer);
    return CustomerBiteSaverEffectiveOfferAvailability(
      serverAvailable: offer.available,
      serverUsageState: offer.usageState,
      localUsageState: overlay.state,
      localActiveTimerExpiresAtMillis: overlay.activeTimerExpiresAtMillis,
    );
  }

  List<CustomerBiteSaverOffer> previewOffersFor(
    CustomerBiteSaverRestaurantId restaurantId,
  ) => List<CustomerBiteSaverOffer>.unmodifiable(
    _restaurants[restaurantId.value]?.offers ??
        const <CustomerBiteSaverOffer>[],
  );

  CustomerBiteSaverRestaurant? currentAcceptedRestaurantFor(
    CustomerBiteSaverRestaurantId restaurantId,
  ) {
    if (!_hasCurrentAcceptedBrowseState ||
        !_deliveredRestaurantIds.contains(restaurantId.value)) {
      return null;
    }
    return _restaurants[restaurantId.value];
  }

  ({CustomerBiteSaverRestaurant restaurant, CustomerBiteSaverOffer offer})?
  currentAcceptedOfferSelectionFor(
    CustomerBiteSaverRestaurantId restaurantId,
    CustomerBiteSaverOfferId offerId,
  ) {
    final restaurant = currentAcceptedRestaurantFor(restaurantId);
    if (restaurant == null ||
        !_deliveredOfferIds.contains(offerId.value) ||
        _offerRestaurantIds[offerId.value] != restaurantId.value) {
      return null;
    }
    final offer = _offers[offerId.value];
    return offer == null ? null : (restaurant: restaurant, offer: offer);
  }

  bool get _hasCurrentAcceptedBrowseState =>
      !_disposed &&
      _status == CustomerBiteSaverCoordinatorStatus.ready &&
      _binding != null;

  CustomerLoadMoreController<CustomerBiteSaverOffer>? offerPagerFor(
    CustomerBiteSaverRestaurantId restaurantId,
  ) => _offerPagers[restaurantId.value];

  bool offerPageRequiresRestart(CustomerBiteSaverRestaurantId restaurantId) =>
      _offerPagerRestartRequired.contains(restaurantId.value);

  Future<void> startSearch(CustomerBiteSaverSearchCriteria criteria) =>
      _start(criteria, freshSearch: false);

  Future<void> freshSearch([CustomerBiteSaverSearchCriteria? criteria]) {
    final selected = criteria ?? _criteria;
    if (selected == null) {
      throw StateError('Fresh Search requires criteria.');
    }
    return _start(selected, freshSearch: true);
  }

  Future<void> retrySearch() {
    final pending = _pendingSearch;
    if (pending != null &&
        pending.realmKey == _auth.realmKey &&
        pending.criteriaKey == _criteriaKey) {
      return _start(
        pending.criteria,
        freshSearch: pending.request.freshSearch,
        exactRequest: pending.request,
      );
    }
    if (_failureRetriable && _criteria != null) {
      return _start(_criteria!, freshSearch: false);
    }
    return Future<void>.value();
  }

  Future<void> _start(
    CustomerBiteSaverSearchCriteria criteria, {
    required bool freshSearch,
    CustomerBiteSaverStartRequest? exactRequest,
  }) async {
    _ensureAlive();
    if (_hasPendingRedemptionStart) {
      throw StateError(
        'An in-flight or uncertain redemption start must settle or recover '
        'before starting another search.',
      );
    }
    _invalidateAsyncWork(clearSessionData: true, clearFavorites: false);
    _criteria = criteria;
    _criteriaKey = _criteriaIdentity(criteria);
    _status = CustomerBiteSaverCoordinatorStatus.starting;
    _failureCode = null;
    _failureRetriable = false;
    _error = null;
    _errorStackTrace = null;
    _redemptionError = null;
    _notify();

    final request =
        exactRequest ??
        CustomerBiteSaverStartRequest(
          clientRequestId: _nextRequestId(),
          clientInstanceId: _clientInstanceId,
          criteria: criteria,
          freshSearch: freshSearch,
        );
    _pendingSearch = _PendingSearch(
      request: request,
      criteria: criteria,
      criteriaKey: _criteriaKey!,
      realmKey: _auth.realmKey,
    );
    final fence = _captureFence(includeSession: false);
    try {
      final response = await _api.startCustomerBiteSaverSearch(request);
      if (!_isCurrent(fence, includeSession: false, includeGuest: false)) {
        return;
      }
      final binding = CustomerBiteSaverSessionBinding.fromStart(
        clientInstanceId: _clientInstanceId,
        response: response,
      );
      final localRevision = await _guestUsageStore.readRevision();
      if (!_isCurrent(fence, includeSession: false, includeGuest: false)) {
        return;
      }
      _pendingSearch = null;
      _binding = binding;
      _attemptGeneration = response.attemptGeneration;
      _queryFingerprint = response.queryFingerprint;
      _logicalExpiresAtMillis = response.logicalExpiresAtMillis;
      _guestStateRevision = localRevision;
      switch (response.state) {
        case CustomerBiteSaverSearchState.preparing:
          _status = CustomerBiteSaverCoordinatorStatus.preparing;
          _notify();
          _scheduleStatusPoll();
        case CustomerBiteSaverSearchState.ready:
          await _becomeReadyAndLoad();
        case CustomerBiteSaverSearchState.failed:
        case CustomerBiteSaverSearchState.expired:
          throw const CustomerBiteSaverProtocolException();
      }
    } catch (caught, stackTrace) {
      if (!_isCurrent(fence, includeSession: false, includeGuest: false)) {
        return;
      }
      _status = CustomerBiteSaverCoordinatorStatus.error;
      _error = caught;
      _errorStackTrace = stackTrace;
      _notify();
    }
  }

  Future<void> pollNow() {
    _ensureAlive();
    _scheduledStatusPoll?.cancel();
    _scheduledStatusPoll = null;
    final purpose = switch (_status) {
      CustomerBiteSaverCoordinatorStatus.preparing =>
        _StatusPollPurpose.preparing,
      CustomerBiteSaverCoordinatorStatus.ready =>
        _StatusPollPurpose.readyExpiry,
      _ => null,
    };
    return _pollStatus(purpose: purpose);
  }

  /// Replays the exact status request whose transport outcome was uncertain.
  Future<void> retryStatusPoll() {
    _ensureAlive();
    final purpose = _pendingStatusPurpose;
    if (_status != CustomerBiteSaverCoordinatorStatus.error ||
        _pendingStatusRequest == null ||
        purpose == null ||
        _binding == null) {
      return Future<void>.value();
    }
    _status = purpose == _StatusPollPurpose.preparing
        ? CustomerBiteSaverCoordinatorStatus.preparing
        : CustomerBiteSaverCoordinatorStatus.ready;
    _statusAutomaticRetryCount = 0;
    _error = null;
    _errorStackTrace = null;
    _notify();
    return _pollStatus(purpose: purpose);
  }

  void _scheduleStatusPoll() {
    if (_disposed ||
        (_status != CustomerBiteSaverCoordinatorStatus.preparing &&
            _status != CustomerBiteSaverCoordinatorStatus.ready) ||
        _scheduledStatusPoll != null ||
        _statusPollInFlight != null) {
      return;
    }
    final purpose =
        _pendingStatusPurpose ??
        (_status == CustomerBiteSaverCoordinatorStatus.preparing
            ? _StatusPollPurpose.preparing
            : _StatusPollPurpose.readyExpiry);
    if (purpose == _StatusPollPurpose.preparing &&
        _statusPollCount >= maximumStatusPolls &&
        _pendingStatusRequest == null) {
      _status = CustomerBiteSaverCoordinatorStatus.error;
      _error = const CustomerBiteSaverProtocolBudgetException();
      _errorStackTrace = StackTrace.current;
      _notify();
      return;
    }
    final delay =
        _pendingStatusRequest != null ||
            purpose != _StatusPollPurpose.readyExpiry
        ? statusPollInterval
        : _readyStatusPollDelay();
    final scheduledFence = _captureFence();
    _scheduledStatusPoll = _scheduler(delay, () {
      _scheduledStatusPoll = null;
      if (_isCurrent(scheduledFence, includeGuest: false)) {
        unawaited(_pollStatus(purpose: purpose));
      }
    });
  }

  Duration _readyStatusPollDelay() {
    final expiresAtMillis = _logicalExpiresAtMillis;
    if (expiresAtMillis == null) {
      return statusPollInterval;
    }
    final remainingMillis = expiresAtMillis - _clock().millisecondsSinceEpoch;
    if (remainingMillis > 0) {
      return Duration(milliseconds: remainingMillis);
    }
    const overdueFloor = Duration(seconds: 30);
    return statusPollInterval > overdueFloor
        ? statusPollInterval
        : overdueFloor;
  }

  Future<void> _pollStatus({_StatusPollPurpose? purpose}) {
    final selectedPurpose = _pendingStatusPurpose ?? purpose;
    if (_disposed || selectedPurpose == null) {
      return Future<void>.value();
    }
    final expectedStatus = selectedPurpose == _StatusPollPurpose.preparing
        ? CustomerBiteSaverCoordinatorStatus.preparing
        : CustomerBiteSaverCoordinatorStatus.ready;
    if (_status != expectedStatus) {
      return Future<void>.value();
    }
    final existing = _statusPollInFlight;
    if (existing != null) {
      return existing;
    }
    if (selectedPurpose == _StatusPollPurpose.preparing &&
        _statusPollCount >= maximumStatusPolls &&
        _pendingStatusRequest == null) {
      _scheduleStatusPoll();
      return Future<void>.value();
    }
    final binding = _binding;
    if (binding == null) {
      return Future<void>.value();
    }
    final request =
        _pendingStatusRequest ??
        CustomerBiteSaverStatusRequest(
          clientRequestId: _nextRequestId(),
          binding: binding,
        );
    if (_pendingStatusRequest == null) {
      _statusAutomaticRetryCount = 0;
      if (selectedPurpose == _StatusPollPurpose.preparing) {
        _statusPollCount += 1;
      }
    }
    _pendingStatusRequest = request;
    _pendingStatusPurpose = selectedPurpose;
    final fence = _captureFence();

    late final Future<void> operation;
    operation = () async {
      try {
        final response = await _api.getCustomerBiteSaverSearchStatus(request);
        if (!_isCurrent(fence, includeGuest: false)) {
          return;
        }
        _pendingStatusRequest = null;
        _pendingStatusPurpose = null;
        _statusAutomaticRetryCount = 0;
        if ((_attemptGeneration != null &&
                response.attemptGeneration < _attemptGeneration!) ||
            (response.attemptGeneration == _attemptGeneration &&
                response.queryFingerprint != _queryFingerprint)) {
          throw const CustomerBiteSaverProtocolException();
        }
        final previousBinding = _binding!;
        final sameReadyGeneration =
            response.attemptGeneration == _attemptGeneration &&
            response.queryFingerprint == _queryFingerprint;
        _binding = CustomerBiteSaverSessionBinding(
          clientInstanceId: previousBinding.clientInstanceId,
          sessionId: previousBinding.sessionId,
          capability: previousBinding.capability,
          criteriaFingerprint: previousBinding.criteriaFingerprint,
          attemptGeneration: response.attemptGeneration,
          queryFingerprint: response.queryFingerprint,
        );
        _attemptGeneration = response.attemptGeneration;
        _queryFingerprint = response.queryFingerprint;
        _logicalExpiresAtMillis = response.logicalExpiresAtMillis;
        _progress = response.progress;
        _failureCode = response.failureCode;
        _failureRetriable = response.retriable;
        _error = null;
        _errorStackTrace = null;
        switch (response.state) {
          case CustomerBiteSaverSearchState.preparing:
            _pendingPageReconciliation = false;
            _discardReadySessionWork();
            _status = CustomerBiteSaverCoordinatorStatus.preparing;
            _notify();
          case CustomerBiteSaverSearchState.ready:
            if (_pendingPageReconciliation) {
              _pendingPageReconciliation = false;
              _requireFreshSearchAfterPageFailure();
            } else if (sameReadyGeneration && _restaurantPager != null) {
              _status = CustomerBiteSaverCoordinatorStatus.ready;
              _progress = null;
              _failureCode = null;
              _failureRetriable = false;
              _error = null;
              _errorStackTrace = null;
              _notify();
            } else {
              await _becomeReadyAndLoad();
            }
          case CustomerBiteSaverSearchState.failed:
            _pendingPageReconciliation = false;
            _transitionToTerminal(CustomerBiteSaverCoordinatorStatus.failed);
          case CustomerBiteSaverSearchState.expired:
            _pendingPageReconciliation = false;
            _transitionToTerminal(CustomerBiteSaverCoordinatorStatus.expired);
        }
      } catch (caught, stackTrace) {
        if (!_isCurrent(fence, includeGuest: false)) {
          return;
        }
        final normalizedCode = caught is CustomerBiteSaverServiceException
            ? (caught.code.startsWith('functions/')
                  ? caught.code.substring('functions/'.length)
                  : caught.code)
            : null;
        if (caught is CustomerBiteSaverServiceException &&
            caught.kind == CustomerBiteSaverServiceFailureKind.callable &&
            normalizedCode == 'resource-exhausted') {
          _statusAutomaticRetryCount += 1;
          _status = _statusAutomaticRetryCount >= maximumStatusPolls
              ? CustomerBiteSaverCoordinatorStatus.error
              : expectedStatus;
          _error = caught;
          _errorStackTrace = stackTrace;
          _notify();
          return;
        }
        if (caught is CustomerBiteSaverServiceException &&
            caught.kind != CustomerBiteSaverServiceFailureKind.transport) {
          _pendingStatusRequest = null;
          _pendingStatusPurpose = null;
          _statusAutomaticRetryCount = 0;
          _pendingPageReconciliation = false;
        }
        _status = CustomerBiteSaverCoordinatorStatus.error;
        _error = caught;
        _errorStackTrace = stackTrace;
        _notify();
      } finally {
        if (identical(_statusPollInFlight, operation)) {
          _statusPollInFlight = null;
        }
        if (_status == CustomerBiteSaverCoordinatorStatus.preparing ||
            _status == CustomerBiteSaverCoordinatorStatus.ready) {
          _scheduleStatusPoll();
        }
      }
    }();
    _statusPollInFlight = operation;
    return operation;
  }

  Future<void> _becomeReadyAndLoad() async {
    if (_guestStateRevision == null) {
      final beforeRead = _captureFence();
      final revision = await _guestUsageStore.readRevision();
      if (!_isCurrent(beforeRead, includeGuest: false)) {
        return;
      }
      _guestStateRevision = revision;
    }
    _status = CustomerBiteSaverCoordinatorStatus.ready;
    _progress = null;
    _failureCode = null;
    _failureRetriable = false;
    _error = null;
    _errorStackTrace = null;
    _configureRestaurantPager();
    _notify();
    _scheduleStatusPoll();
    await _restaurantPager!.loadInitial();
  }

  bool get _hasPendingRedemptionStart =>
      _redemptionStartInFlight != null ||
      _pendingSignedStart != null ||
      _pendingGuestStartIntentGeneration != null;

  void _discardReadySessionWork() {
    final preserveRedemptionStart = _hasPendingRedemptionStart;
    _generation += 1;
    _cancelScheduledWork();
    _disposePagers(clearDelivered: true);
    _pendingOriginalCalls.clear();
    _pendingGuestContinuations.clear();
    _guestProtocolProgress.clear();
    _pendingValidationRequests.clear();
    _pendingStatusRequest = null;
    _pendingStatusPurpose = null;
    _statusAutomaticRetryCount = 0;
    if (!preserveRedemptionStart) {
      _clearRedemption();
    }
  }

  void _transitionToTerminal(CustomerBiteSaverCoordinatorStatus terminal) {
    if (terminal != CustomerBiteSaverCoordinatorStatus.failed &&
        terminal != CustomerBiteSaverCoordinatorStatus.expired) {
      throw ArgumentError.value(terminal, 'terminal');
    }
    _discardReadySessionWork();
    _status = terminal;
    _notify();
  }

  Future<void> _handleDefinitivePageFailure(
    CustomerBiteSaverServiceException error, {
    required bool hasCursor,
    CustomerBiteSaverRestaurantId? offerRestaurantId,
  }) async {
    if (_disposed) {
      return;
    }
    final code = error.code.startsWith('functions/')
        ? error.code.substring('functions/'.length)
        : error.code;
    if (offerRestaurantId != null) {
      if (error.kind == CustomerBiteSaverServiceFailureKind.callable &&
          (code == 'failed-precondition' ||
              (code == 'invalid-argument' && hasCursor))) {
        _offerPagerRestartRequired.add(offerRestaurantId.value);
        _notify();
      }
      return;
    }
    if (error.kind == CustomerBiteSaverServiceFailureKind.callable &&
        code == 'invalid-argument' &&
        hasCursor) {
      _requireFreshSearchAfterPageFailure();
      return;
    }
    if (error.kind == CustomerBiteSaverServiceFailureKind.callable &&
        code == 'failed-precondition') {
      _pendingPageReconciliation = true;
      _discardReadySessionWork();
      _status = CustomerBiteSaverCoordinatorStatus.ready;
      _error = null;
      _errorStackTrace = null;
      _notify();
      await _pollStatus(purpose: _StatusPollPurpose.pageReconciliation);
    }
  }

  void _requireFreshSearchAfterPageFailure() {
    _pendingPageReconciliation = false;
    _discardReadySessionWork();
    _status = CustomerBiteSaverCoordinatorStatus.freshSearchRequired;
    _error = null;
    _errorStackTrace = null;
    _notify();
  }

  void _configureRestaurantPager() {
    final binding = _binding;
    if (binding == null ||
        _attemptGeneration == null ||
        _queryFingerprint == null) {
      throw StateError('A ready search must have a complete session binding.');
    }
    _restaurantPager?.dispose();
    final controllerGeneration = _generation;
    _restaurantPager =
        CustomerLoadMoreController<CustomerBiteSaverRestaurant>.envelope(
          criteria: <String, Object?>{
            'kind': 'restaurantPage',
            'criteriaFingerprint': binding.criteriaFingerprint,
          },
          stableId: (restaurant) => restaurant.restaurantId.value,
          pageSize: CustomerBiteSaverSearchContract.pageSize,
          retainAllItems: true,
          requestIdGenerator: _nextRequestId,
          clock: _clock,
          pageLoader: (pageRequest) async {
            final pageFence = _captureFence(
              expectedGeneration: controllerGeneration,
            );
            try {
              final fence = pageFence;
              final revision = await _revisionForRequest(fence);
              final executed = await _executeGuestAware(
                operation: CustomerBiteSaverGuestOperation.restaurantPage,
                operationKey: 'restaurantPage:${pageRequest.clientRequestId}',
                initialRequestId: pageRequest.clientRequestId,
                initialGuestRevision: revision,
                fence: fence.withGuestRevision(_guestStateRevision),
                invokeOriginal: (clientRequestId, guestRevision) =>
                    _api.getCustomerBiteSaverSearchPage(
                      CustomerBiteSaverRestaurantPageRequest(
                        clientRequestId: clientRequestId,
                        binding: _bindingForFence(fence),
                        cursor: pageRequest.cursor,
                        guestStateRevision: guestRevision,
                      ),
                    ),
              );
              final result = executed.result;
              _requireCurrent(executed.fence);
              if (result.attemptGeneration != _attemptGeneration ||
                  result.queryFingerprint != _queryFingerprint) {
                throw const CustomerBiteSaverProtocolException();
              }
              final signedUsageOverlay = _auth.isSigned
                  ? await _prepareSignedUsageOverlay(
                      result.restaurants.expand(
                        (restaurant) => restaurant.offers,
                      ),
                      executed.evaluationContext,
                      executed.fence,
                    )
                  : null;
              final page =
                  CustomerLoadMorePageEnvelope<CustomerBiteSaverRestaurant>(
                    items: result.restaurants,
                    nextCursor: result.nextCursor,
                    hasMore: result.hasMore,
                    partial: result.partial,
                    onAccepted: () {
                      final ownershipClaims =
                          _restaurantPageOfferOwnershipClaims(
                            result.restaurants,
                          );
                      final invalidatesAtMillis = signedUsageOverlay != null
                          ? _commitSignedUsageOverlay(signedUsageOverlay)
                          : min(
                              executed
                                  .evaluationContext
                                  .validUntilExclusiveMillis,
                              executed.pendingActiveTimerExpiresAtMillis ??
                                  executed
                                      .evaluationContext
                                      .validUntilExclusiveMillis,
                            );
                      _observedOfferRestaurantIds.addAll(ownershipClaims);
                      _scheduleUsageContextExpiry(invalidatesAtMillis);
                    },
                  );
              return page;
            } on CustomerBiteSaverServiceException catch (error) {
              if (error.kind == CustomerBiteSaverServiceFailureKind.transport) {
                rethrow;
              }
              if (!_isCurrent(pageFence, includeGuest: false)) {
                rethrow;
              }
              await _handleDefinitivePageFailure(
                error,
                hasCursor: pageRequest.cursor != null,
              );
              rethrow;
            }
          },
        );
    final pager = _restaurantPager!;
    pager.addListener(() {
      if (!pager.isDisposed) {
        _registerRestaurants(pager.items);
      }
    });
  }

  Future<CustomerLoadMoreController<CustomerBiteSaverOffer>> loadOffers(
    CustomerBiteSaverRestaurantId restaurantId,
  ) async {
    _ensureAlive();
    if (_status != CustomerBiteSaverCoordinatorStatus.ready ||
        !_deliveredRestaurantIds.contains(restaurantId.value)) {
      throw StateError(
        'Offers require a delivered restaurant in a ready search.',
      );
    }
    final restartRequired = _offerPagerRestartRequired.remove(
      restaurantId.value,
    );
    final existing = _offerPagers[restaurantId.value];
    if (existing != null && !restartRequired) {
      await existing.loadInitial();
      return existing;
    }
    if (existing != null) {
      _discardOfferPager(restaurantId, existing);
    }
    final restaurant = _restaurants[restaurantId.value]!;
    final previewIds = restaurant.offers
        .map((offer) => offer.offerId.value)
        .toSet();
    final controllerGeneration = _generation;
    final binding = _binding!;
    final controller = CustomerLoadMoreController<CustomerBiteSaverOffer>.envelope(
      criteria: <String, Object?>{
        'kind': 'offerPage',
        'criteriaFingerprint': binding.criteriaFingerprint,
        'restaurantId': restaurantId.value,
      },
      stableId: (offer) => offer.offerId.value,
      pageSize: CustomerBiteSaverSearchContract.pageSize,
      retainAllItems: true,
      requestIdGenerator: _nextRequestId,
      clock: _clock,
      pageLoader: (pageRequest) async {
        final pageFence = _captureFence(
          expectedGeneration: controllerGeneration,
        );
        try {
          final fence = pageFence;
          final revision = await _revisionForRequest(fence);
          final executed = await _executeGuestAware(
            operation: CustomerBiteSaverGuestOperation.offerPage,
            operationKey:
                'offerPage:${restaurantId.value}:${pageRequest.clientRequestId}',
            initialRequestId: pageRequest.clientRequestId,
            initialGuestRevision: revision,
            fence: fence.withGuestRevision(_guestStateRevision),
            invokeOriginal: (clientRequestId, guestRevision) =>
                _api.getCustomerBiteSaverOfferPage(
                  CustomerBiteSaverOfferPageRequest(
                    clientRequestId: clientRequestId,
                    binding: _bindingForFence(fence),
                    restaurantId: restaurantId,
                    cursor: pageRequest.cursor,
                    guestStateRevision: guestRevision,
                  ),
                ),
          );
          final result = executed.result;
          _requireCurrent(executed.fence);
          if (result.restaurantId != restaurantId) {
            throw const CustomerBiteSaverProtocolException();
          }
          final signedUsageOverlay = _auth.isSigned
              ? await _prepareSignedUsageOverlay(
                  result.offers,
                  executed.evaluationContext,
                  executed.fence,
                )
              : null;
          final additional = result.offers
              .where((offer) => !previewIds.contains(offer.offerId.value))
              .toList(growable: false);
          final page = CustomerLoadMorePageEnvelope<CustomerBiteSaverOffer>(
            items: additional,
            nextCursor: result.nextCursor,
            hasMore: result.hasMore,
            partial: result.partial,
            onAccepted: () {
              final ownershipClaims = _offerPageOfferOwnershipClaims(
                restaurantId,
                result.offers,
              );
              _replaceAcceptedPreviewOccurrences(restaurantId, result.offers);
              final invalidatesAtMillis = signedUsageOverlay != null
                  ? _commitSignedUsageOverlay(signedUsageOverlay)
                  : min(
                      executed.evaluationContext.validUntilExclusiveMillis,
                      executed.pendingActiveTimerExpiresAtMillis ??
                          executed.evaluationContext.validUntilExclusiveMillis,
                    );
              _observedOfferRestaurantIds.addAll(ownershipClaims);
              _scheduleUsageContextExpiry(invalidatesAtMillis);
            },
          );
          return page;
        } on CustomerBiteSaverServiceException catch (error) {
          if (error.kind == CustomerBiteSaverServiceFailureKind.transport) {
            rethrow;
          }
          if (!_isCurrent(pageFence, includeGuest: false)) {
            rethrow;
          }
          await _handleDefinitivePageFailure(
            error,
            hasCursor: pageRequest.cursor != null,
            offerRestaurantId: restaurantId,
          );
          rethrow;
        }
      },
    );
    controller.addListener(() {
      if (!controller.isDisposed) {
        _registerOffers(restaurantId, controller.items);
      }
    });
    _offerPagers[restaurantId.value] = controller;
    await controller.loadInitial();
    return controller;
  }

  void _replaceAcceptedPreviewOccurrences(
    CustomerBiteSaverRestaurantId restaurantId,
    List<CustomerBiteSaverOffer> acceptedOffers,
  ) {
    final restaurant = _restaurants[restaurantId.value];
    if (restaurant == null || restaurant.offers.isEmpty) return;
    final acceptedById = <String, CustomerBiteSaverOffer>{
      for (final offer in acceptedOffers) offer.offerId.value: offer,
    };
    var changed = false;
    final currentPreviews = restaurant.offers
        .map((preview) {
          final accepted = acceptedById[preview.offerId.value];
          if (accepted == null) return preview;
          changed =
              changed || accepted.offerOccurrence != preview.offerOccurrence;
          _offers[accepted.offerId.value] = accepted;
          return accepted;
        })
        .toList(growable: false);
    if (!changed) return;
    _restaurants[restaurantId.value] =
        CustomerBiteSaverRestaurant.fromJson(<String, Object?>{
          ...restaurant.toJson(),
          'offers': currentPreviews
              .map((offer) => offer.toJson())
              .toList(growable: false),
        });
  }

  Future<_GuestAwareResult<T>>
  _executeGuestAware<T extends CustomerBiteSaverOperationResult>({
    required CustomerBiteSaverGuestOperation operation,
    required String operationKey,
    required String initialRequestId,
    required int? initialGuestRevision,
    required _RequestFence fence,
    required Future<CustomerBiteSaverEndpointResponse<T>> Function(
      String clientRequestId,
      int? guestStateRevision,
    )
    invokeOriginal,
    CustomerBiteSaverOfferId? expectedChallengeOfferId,
    bool Function()? operationIsCurrent,
  }) async {
    var currentFence = fence;
    var currentRevision = initialGuestRevision;
    final retainedProgress = _guestProtocolProgress[operationKey];
    var challengeObserved = retainedProgress?.challengeObserved ?? false;
    var evaluationBinding = retainedProgress?.evaluationBinding;
    var pendingActiveTimerExpiresAtMillis =
        retainedProgress?.pendingActiveTimerExpiresAtMillis;
    final policies = <String, CustomerBiteSaverGuestUsagePolicy>{
      ...?retainedProgress?.challengedPolicies,
    };

    void requireOperationCurrent() {
      _requireCurrent(currentFence, includeGuest: false);
      if (operationIsCurrent != null && !operationIsCurrent()) {
        throw const CustomerBiteSaverStaleOperationException();
      }
      final pendingDeadline = pendingActiveTimerExpiresAtMillis;
      if (pendingDeadline != null &&
          _clock().millisecondsSinceEpoch >= pendingDeadline) {
        _pendingOriginalCalls.remove(operationKey);
        _pendingGuestContinuations.remove(operationKey);
        _guestProtocolProgress.remove(operationKey);
        throw const CustomerBiteSaverStaleOperationException();
      }
    }

    var stepsSinceYield = 0;
    while (true) {
      if (stepsSinceYield >= maximumGuestProtocolSteps) {
        await _delay(guestRetryDelay);
        requireOperationCurrent();
        stepsSinceYield = 0;
      }
      stepsSinceYield += 1;
      requireOperationCurrent();
      final pendingContinuation = _pendingGuestContinuations[operationKey];
      CustomerBiteSaverEndpointResponse<T> response;
      if (pendingContinuation != null) {
        final continued = await _api.continueCustomerBiteSaverGuestOfferCheck(
          pendingContinuation,
        );
        requireOperationCurrent();
        if (continued.operation != operation) {
          throw const CustomerBiteSaverProtocolException();
        }
        response = _narrowGuestResponse<T>(continued);
        _pendingGuestContinuations.remove(operationKey);
      } else {
        final pending = _pendingOriginalCalls[operationKey];
        final call =
            pending ??
            _PendingOriginalCall(
              clientRequestId: initialRequestId,
              guestStateRevision: currentRevision,
            );
        _pendingOriginalCalls[operationKey] = call;
        response = await invokeOriginal(
          call.clientRequestId,
          call.guestStateRevision,
        );
        _pendingOriginalCalls.remove(operationKey);
        requireOperationCurrent();
      }

      if (_auth.isSigned) {
        if (response case CustomerBiteSaverDirectResponse<T> direct) {
          _requireEvaluationContextCurrent(
            direct.evaluationContext,
            currentFence,
          );
          _guestProtocolProgress.remove(operationKey);
          return _GuestAwareResult<T>(
            result: direct.result,
            fence: currentFence,
            guestStateRevision: null,
            evaluationContext: direct.evaluationContext,
            challengeObserved: false,
            challengedPolicies:
                const <String, CustomerBiteSaverGuestUsagePolicy>{},
            pendingActiveTimerExpiresAtMillis: null,
          );
        }
        throw const CustomerBiteSaverProtocolException();
      }
      if (response is! CustomerBiteSaverGuestOperationResponse<T>) {
        throw const CustomerBiteSaverProtocolException();
      }
      if (expectedChallengeOfferId != null &&
          response is CustomerBiteSaverGuestCheckRequired<T> &&
          (response.candidates.length != 1 ||
              response.candidates.single.offerId != expectedChallengeOfferId)) {
        throw const CustomerBiteSaverProtocolException();
      }
      final persistedRevision = await _guestUsageStore.readRevision();
      requireOperationCurrent();

      switch (response) {
        case CustomerBiteSaverGuestCheckRequired<T> challenge:
          _requireEvaluationContextCurrent(
            challenge.evaluationContext,
            currentFence,
          );
          final challengeBinding = _evaluationContextOperationBinding(
            challenge.evaluationContext,
          );
          if (evaluationBinding != null &&
              evaluationBinding != challengeBinding) {
            throw const CustomerBiteSaverProtocolException();
          }
          evaluationBinding = challengeBinding;
          challengeObserved = true;
          if (persistedRevision != currentRevision ||
              challenge.guestStateRevision != currentRevision) {
            throw const CustomerBiteSaverStaleOperationException();
          }
          for (final candidate in challenge.candidates) {
            policies[candidate.offerId.value] = candidate.usagePolicy;
          }
          _guestProtocolProgress[operationKey] = _GuestProtocolProgress(
            challengeObserved: true,
            challengedPolicies: policies,
            evaluationBinding: evaluationBinding,
            pendingActiveTimerExpiresAtMillis:
                pendingActiveTimerExpiresAtMillis,
          );
          final evaluated = await _guestUsageStore.evaluateCandidates(
            challenge.candidates,
            challenge.evaluationContext,
          );
          requireOperationCurrent();
          final recheckedRevision = await _guestUsageStore.readRevision();
          requireOperationCurrent();
          if (!evaluated.allEvaluated ||
              evaluated.guestStateRevision != currentRevision ||
              recheckedRevision != currentRevision) {
            throw const CustomerBiteSaverStaleOperationException();
          }
          for (final timerExpiresAtMillis
              in evaluated.activeTimerExpiresAtMillisByOfferId.values) {
            pendingActiveTimerExpiresAtMillis = min(
              pendingActiveTimerExpiresAtMillis ?? timerExpiresAtMillis,
              timerExpiresAtMillis,
            );
          }
          _guestProtocolProgress[operationKey] = _GuestProtocolProgress(
            challengeObserved: true,
            challengedPolicies: policies,
            evaluationBinding: evaluationBinding,
            pendingActiveTimerExpiresAtMillis:
                pendingActiveTimerExpiresAtMillis,
          );
          _pendingGuestContinuations[operationKey] =
              CustomerBiteSaverGuestContinuationRequest(
                clientRequestId: _nextRequestId(),
                binding: _bindingForFence(currentFence),
                operationRef: challenge.operationRef,
                checkToken: challenge.checkToken,
                batchSequence: challenge.batchSequence,
                guestStateRevision: currentRevision!,
                unavailableOfferIds: evaluated.unavailableOfferIds,
              );
        case CustomerBiteSaverGuestRetryRequired<T> retry:
          if (retry.restartFrom == CustomerBiteSaverGuestRestartFrom.search) {
            _markFreshSearchRequired();
            throw const CustomerBiteSaverFreshSearchRequiredException();
          }
          if (retry.guestStateRevision != persistedRevision) {
            throw const CustomerBiteSaverStaleOperationException();
          }
          await _delay(guestRetryDelay);
          requireOperationCurrent();
          stepsSinceYield = 0;
          final recheckedRevision = await _guestUsageStore.readRevision();
          requireOperationCurrent();
          if (recheckedRevision != retry.guestStateRevision) {
            throw const CustomerBiteSaverStaleOperationException();
          }
          currentRevision = recheckedRevision;
          _guestStateRevision = recheckedRevision;
          currentFence = currentFence.withGuestRevision(recheckedRevision);
          if (retry.reason != CustomerBiteSaverGuestRetryReason.workBudget) {
            challengeObserved = false;
            policies.clear();
            evaluationBinding = null;
            pendingActiveTimerExpiresAtMillis = null;
            _guestProtocolProgress.remove(operationKey);
          }
          _pendingOriginalCalls[operationKey] = _PendingOriginalCall(
            clientRequestId: _nextRequestId(),
            guestStateRevision: recheckedRevision,
          );
        case CustomerBiteSaverGuestComplete<T> complete:
          _requireEvaluationContextCurrent(
            complete.evaluationContext,
            currentFence,
          );
          if (complete.guestStateRevision != persistedRevision ||
              persistedRevision != currentRevision ||
              complete.attemptGeneration != currentFence.attemptGeneration ||
              complete.queryFingerprint != currentFence.queryFingerprint ||
              (evaluationBinding != null &&
                  evaluationBinding !=
                      _evaluationContextOperationBinding(
                        complete.evaluationContext,
                      ))) {
            throw const CustomerBiteSaverStaleOperationException();
          }
          final completed = _GuestAwareResult<T>(
            result: complete.result,
            fence: currentFence,
            guestStateRevision: persistedRevision,
            evaluationContext: complete.evaluationContext,
            challengeObserved: challengeObserved,
            challengedPolicies:
                Map<String, CustomerBiteSaverGuestUsagePolicy>.unmodifiable(
                  policies,
                ),
            pendingActiveTimerExpiresAtMillis:
                pendingActiveTimerExpiresAtMillis,
          );
          _guestProtocolProgress.remove(operationKey);
          return completed;
      }
    }
  }

  Future<_SignedUsageOverlayUpdate> _prepareSignedUsageOverlay(
    Iterable<CustomerBiteSaverOffer> offers,
    CustomerBiteSaverEvaluationContext context,
    _RequestFence fence,
  ) async {
    final candidates = offers
        .where((offer) => offer.offerType == CustomerBiteSaverOfferType.coupon)
        .map(
          (offer) => CustomerBiteSaverLocalUsageCandidate(
            offerId: offer.offerId,
            usagePolicy:
                offer.usagePolicy ??
                (throw const CustomerBiteSaverProtocolException()),
          ),
        )
        .toList(growable: false);
    if (candidates.isEmpty) {
      _requireCurrent(fence);
      _requireEvaluationContextCurrent(context, fence);
      return _SignedUsageOverlayUpdate(
        candidates: candidates,
        evaluation: null,
        context: context,
        fence: fence,
      );
    }
    final evaluated = await _evaluateSignedUsageCandidates(
      candidates,
      context,
      fence,
      updateOverlay: false,
    );
    return _SignedUsageOverlayUpdate(
      candidates: candidates,
      evaluation: evaluated,
      context: context,
      fence: fence,
    );
  }

  int _commitSignedUsageOverlay(_SignedUsageOverlayUpdate update) {
    _requireCurrent(update.fence);
    _requireEvaluationContextCurrent(update.context, update.fence);
    final evaluated = update.evaluation;
    if (evaluated == null) {
      if (update.candidates.isNotEmpty) {
        throw const CustomerBiteSaverProtocolException();
      }
      return update.context.validUntilExclusiveMillis;
    }
    if (evaluated.guestStateRevision != update.fence.guestStateRevision) {
      throw const CustomerBiteSaverStaleOperationException();
    }
    final unavailableIds = evaluated.unavailableOfferIds
        .map((offerId) => offerId.value)
        .toSet();
    final overlays = <String, _LocalUsageOverlay>{};
    for (final candidate in update.candidates) {
      final activeTimer =
          evaluated.activeTimerExpiresAtMillisByOfferId[candidate.offerId];
      final state = activeTimer != null
          ? CustomerBiteSaverLocalUsageOverlayState.activeTimer
          : unavailableIds.contains(candidate.offerId.value)
          ? CustomerBiteSaverLocalUsageOverlayState.unavailable
          : CustomerBiteSaverLocalUsageOverlayState.clear;
      overlays[candidate.offerId.value] = _LocalUsageOverlay(
        state: state,
        activeTimerExpiresAtMillis: activeTimer,
        usagePolicy: candidate.usagePolicy,
        context: update.context,
        guestStateRevision: evaluated.guestStateRevision,
        realmKey: _auth.realmKey,
      );
    }
    var invalidatesAtMillis = update.context.validUntilExclusiveMillis;
    for (final timerExpiresAtMillis
        in evaluated.activeTimerExpiresAtMillisByOfferId.values) {
      invalidatesAtMillis = min(invalidatesAtMillis, timerExpiresAtMillis);
    }
    _localUsageOverlays.addAll(overlays);
    return invalidatesAtMillis;
  }

  Future<CustomerBiteSaverGuestCandidateEvaluation>
  _evaluateSignedUsageCandidates(
    List<CustomerBiteSaverLocalUsageCandidate> candidates,
    CustomerBiteSaverEvaluationContext context,
    _RequestFence fence, {
    required bool updateOverlay,
  }) async {
    if (!_auth.isSigned) {
      throw const CustomerBiteSaverStaleOperationException();
    }
    _requireCurrent(fence);
    _requireEvaluationContextCurrent(context, fence);
    late final CustomerBiteSaverGuestCandidateEvaluation evaluated;
    try {
      evaluated = await _guestUsageStore.evaluateLocalCandidates(
        candidates,
        context,
      );
    } on CustomerBiteSaverGuestUsageException catch (caught) {
      if (caught.failure ==
              CustomerBiteSaverGuestUsageFailure.revisionChanged ||
          caught.failure ==
              CustomerBiteSaverGuestUsageFailure.evaluationExpired) {
        await _invalidateChangedLocalEvidence(fence);
        throw const CustomerBiteSaverFreshSearchRequiredException();
      }
      rethrow;
    }
    _requireCurrent(fence);
    final recheckedRevision = await _guestUsageStore.readRevision();
    _requireCurrent(fence);
    if (!evaluated.allEvaluated ||
        evaluated.guestStateRevision != fence.guestStateRevision ||
        recheckedRevision != fence.guestStateRevision) {
      _guestStateRevision = recheckedRevision;
      _markFreshSearchRequired();
      throw const CustomerBiteSaverFreshSearchRequiredException();
    }
    _requireEvaluationContextCurrent(context, fence);
    if (updateOverlay) {
      final invalidatesAtMillis = _commitSignedUsageOverlay(
        _SignedUsageOverlayUpdate(
          candidates: candidates,
          evaluation: evaluated,
          context: context,
          fence: fence,
        ),
      );
      _scheduleUsageContextExpiry(invalidatesAtMillis);
    }
    return evaluated;
  }

  Future<void> _invalidateChangedLocalEvidence(_RequestFence fence) async {
    try {
      final revision = await _guestUsageStore.readRevision();
      if (_isCurrent(fence, includeGuest: false)) {
        _guestStateRevision = revision;
        _markFreshSearchRequired();
      }
    } catch (_) {
      if (_isCurrent(fence, includeGuest: false)) {
        _localUsageOverlays.clear();
      }
    }
  }

  void _requireEvaluationContextCurrent(
    CustomerBiteSaverEvaluationContext context,
    _RequestFence fence,
  ) {
    if (context.sessionId != fence.sessionId ||
        context.attemptGeneration != fence.attemptGeneration ||
        context.queryFingerprint != fence.queryFingerprint) {
      throw const CustomerBiteSaverProtocolException();
    }
    if (_clock().millisecondsSinceEpoch >= context.validUntilExclusiveMillis) {
      _markFreshSearchRequired();
      throw const CustomerBiteSaverFreshSearchRequiredException();
    }
  }

  static String _evaluationContextOperationBinding(
    CustomerBiteSaverEvaluationContext context,
  ) {
    final binding = Map<String, Object?>.of(context.toJson())
      ..remove('availabilityGeneration')
      ..remove('validUntilExclusiveMillis');
    return jsonEncode(binding);
  }

  _LocalUsageOverlay _effectiveLocalUsageOverlay(CustomerBiteSaverOffer offer) {
    if (!_auth.isSigned ||
        offer.offerType != CustomerBiteSaverOfferType.coupon) {
      return const _LocalUsageOverlay.notApplicable();
    }
    final overlay = _localUsageOverlays[offer.offerId.value];
    final context = overlay?.context;
    final nowMillis = _clock().millisecondsSinceEpoch;
    if (overlay == null ||
        context == null ||
        overlay.realmKey != _auth.realmKey ||
        overlay.guestStateRevision != _guestStateRevision ||
        overlay.usagePolicy != offer.usagePolicy ||
        context.sessionId != _binding?.sessionId ||
        context.attemptGeneration != _attemptGeneration ||
        context.queryFingerprint != _queryFingerprint ||
        nowMillis >= context.validUntilExclusiveMillis ||
        (overlay.activeTimerExpiresAtMillis != null &&
            nowMillis >= overlay.activeTimerExpiresAtMillis!)) {
      return const _LocalUsageOverlay.unknown();
    }
    return overlay;
  }

  void _scheduleUsageContextExpiry(int validUntilExclusiveMillis) {
    final existing = _usageContextValidUntilExclusiveMillis;
    if (existing != null && existing <= validUntilExclusiveMillis) {
      return;
    }
    _scheduledUsageContextExpiry?.cancel();
    _usageContextValidUntilExclusiveMillis = validUntilExclusiveMillis;
    final remaining =
        validUntilExclusiveMillis - _clock().millisecondsSinceEpoch;
    if (remaining <= 0) {
      _markFreshSearchRequired();
      return;
    }
    final fence = _captureFence();
    _scheduledUsageContextExpiry = _scheduler(
      Duration(milliseconds: remaining),
      () {
        _scheduledUsageContextExpiry = null;
        _usageContextValidUntilExclusiveMillis = null;
        if (!_isCurrent(fence)) {
          return;
        }
        final currentRemaining =
            validUntilExclusiveMillis - _clock().millisecondsSinceEpoch;
        if (currentRemaining > 0) {
          _scheduleUsageContextExpiry(validUntilExclusiveMillis);
          return;
        }
        _markFreshSearchRequired();
      },
    );
  }

  CustomerBiteSaverGuestOperationResponse<T>
  _narrowGuestResponse<T extends CustomerBiteSaverOperationResult>(
    CustomerBiteSaverGuestOperationResponse<CustomerBiteSaverOperationResult>
    response,
  ) {
    switch (response) {
      case CustomerBiteSaverGuestCheckRequired<CustomerBiteSaverOperationResult>
      challenge:
        return challenge as CustomerBiteSaverGuestOperationResponse<T>;
      case CustomerBiteSaverGuestRetryRequired<CustomerBiteSaverOperationResult>
      retry:
        return retry as CustomerBiteSaverGuestOperationResponse<T>;
      case CustomerBiteSaverGuestComplete<CustomerBiteSaverOperationResult>
      complete:
        if (complete.result is! T) {
          throw const CustomerBiteSaverProtocolException();
        }
        return complete as CustomerBiteSaverGuestOperationResponse<T>;
    }
  }

  Map<String, String> _restaurantPageOfferOwnershipClaims(
    List<CustomerBiteSaverRestaurant> restaurants,
  ) {
    final pageClaims = <String, String>{};
    for (final restaurant in restaurants) {
      final restaurantId = restaurant.restaurantId.value;
      for (final offer in restaurant.offers) {
        _stageOfferOwnership(
          pageClaims,
          offerId: offer.offerId.value,
          restaurantId: restaurantId,
        );
      }
    }
    return pageClaims;
  }

  Map<String, String> _offerPageOfferOwnershipClaims(
    CustomerBiteSaverRestaurantId restaurantId,
    List<CustomerBiteSaverOffer> offers,
  ) {
    final pageClaims = <String, String>{};
    for (final offer in offers) {
      _stageOfferOwnership(
        pageClaims,
        offerId: offer.offerId.value,
        restaurantId: restaurantId.value,
      );
    }
    return pageClaims;
  }

  void _stageOfferOwnership(
    Map<String, String> pageClaims, {
    required String offerId,
    required String restaurantId,
  }) {
    final existingOwner =
        pageClaims[offerId] ?? _observedOfferRestaurantIds[offerId];
    if (existingOwner != null && existingOwner != restaurantId) {
      throw const CustomerBiteSaverProtocolException();
    }
    pageClaims[offerId] = restaurantId;
  }

  void _registerRestaurants(List<CustomerBiteSaverRestaurant> restaurants) {
    final favoriteRestaurants = <CustomerBiteSaverRestaurantId>[];
    final favoriteOffers = <CustomerBiteSaverOfferId>[];
    for (final restaurant in restaurants) {
      final restaurantId = restaurant.restaurantId.value;
      if (_deliveredRestaurantIds.add(restaurantId)) {
        _restaurants[restaurantId] = restaurant;
        _restaurantFavorites.putIfAbsent(
          restaurantId,
          () => restaurant.favoriteState,
        );
        favoriteRestaurants.add(restaurant.restaurantId);
      }
      final previewIds = <String>{};
      for (final offer in restaurant.offers) {
        if (!previewIds.add(offer.offerId.value)) {
          throw const CustomerBiteSaverProtocolException();
        }
        if (_deliveredOfferIds.add(offer.offerId.value)) {
          _offers[offer.offerId.value] = offer;
          _offerRestaurantIds[offer.offerId.value] = restaurantId;
          _offerFavorites.putIfAbsent(
            offer.offerId.value,
            () => CustomerBiteSaverFavoriteState.unknown,
          );
          favoriteOffers.add(offer.offerId);
        }
      }
    }
    if (_auth.isSigned &&
        (favoriteRestaurants.isNotEmpty || favoriteOffers.isNotEmpty)) {
      unawaited(_refreshFavoriteBatch(favoriteRestaurants, favoriteOffers));
    }
  }

  void _registerOffers(
    CustomerBiteSaverRestaurantId restaurantId,
    List<CustomerBiteSaverOffer> offers,
  ) {
    final favoriteOffers = <CustomerBiteSaverOfferId>[];
    for (final offer in offers) {
      if (_deliveredOfferIds.add(offer.offerId.value)) {
        _offers[offer.offerId.value] = offer;
        _offerRestaurantIds[offer.offerId.value] = restaurantId.value;
        _offerFavorites.putIfAbsent(
          offer.offerId.value,
          () => CustomerBiteSaverFavoriteState.unknown,
        );
        favoriteOffers.add(offer.offerId);
      }
    }
    if (_auth.isSigned && favoriteOffers.isNotEmpty) {
      unawaited(_refreshFavoriteBatch(const [], favoriteOffers));
    }
  }

  Future<void> refreshFavoriteStates() async {
    _ensureAlive();
    if (!_auth.isSigned || _binding == null) {
      return;
    }
    final restaurantIds = _deliveredRestaurantIds
        .map(CustomerBiteSaverRestaurantId.new)
        .toList(growable: false);
    final offerIds = _deliveredOfferIds
        .map(CustomerBiteSaverOfferId.new)
        .toList(growable: false);
    var restaurantOffset = 0;
    var offerOffset = 0;
    while (restaurantOffset < restaurantIds.length ||
        offerOffset < offerIds.length) {
      final restaurantEnd = min(
        restaurantOffset +
            CustomerBiteSaverSearchContract.maximumFavoriteRestaurantIds,
        restaurantIds.length,
      );
      final remaining =
          CustomerBiteSaverSearchContract.maximumFavoriteIds -
          (restaurantEnd - restaurantOffset);
      final offerEnd = min(
        min(
          offerOffset + CustomerBiteSaverSearchContract.maximumFavoriteOfferIds,
          offerOffset + remaining,
        ),
        offerIds.length,
      );
      await _refreshFavoriteBatch(
        restaurantIds.sublist(restaurantOffset, restaurantEnd),
        offerIds.sublist(offerOffset, offerEnd),
      );
      restaurantOffset = restaurantEnd;
      offerOffset = offerEnd;
    }
  }

  Future<void> _refreshFavoriteBatch(
    List<CustomerBiteSaverRestaurantId> restaurantIds,
    List<CustomerBiteSaverOfferId> offerIds,
  ) async {
    if (!_auth.isSigned ||
        _binding == null ||
        (restaurantIds.isEmpty && offerIds.isEmpty)) {
      return;
    }
    final fence = _captureFence();
    final versions = <String, int>{};
    for (final id in <String>[
      ...restaurantIds.map((value) => value.value),
      ...offerIds.map((value) => value.value),
    ]) {
      versions[id] = (_favoriteOperationVersions[id] ?? 0) + 1;
      _favoriteOperationVersions[id] = versions[id]!;
    }
    try {
      final response = await _api.getCustomerBiteSaverFavoriteStates(
        CustomerBiteSaverFavoriteStatesRequest(
          clientRequestId: _nextRequestId(),
          binding: _bindingForFence(fence),
          restaurantIds: restaurantIds,
          offerIds: offerIds,
        ),
      );
      if (!_isCurrent(fence, includeGuest: false)) {
        return;
      }
      for (final entry in response.states) {
        if (_favoriteOperationVersions[entry.idValue] !=
            versions[entry.idValue]) {
          continue;
        }
        switch (entry.id) {
          case CustomerBiteSaverRestaurantId():
            _restaurantFavorites[entry.idValue] = entry.state;
          case CustomerBiteSaverOfferId():
            _offerFavorites[entry.idValue] = entry.state;
        }
      }
      _favoriteError = null;
      _notify();
    } catch (caught) {
      if (_isCurrent(fence, includeGuest: false)) {
        _favoriteError = caught;
        _notify();
      }
    }
  }

  Future<void> setRestaurantFavorite(
    CustomerBiteSaverRestaurantId restaurantId,
    bool favorite,
  ) async {
    final actions = _requireFavoriteWrite(restaurantId.value);
    final fence = _captureFence();
    final version = (_favoriteOperationVersions[restaurantId.value] ?? 0) + 1;
    _favoriteOperationVersions[restaurantId.value] = version;
    try {
      if (favorite) {
        await actions.upsertRestaurant(
          CustomerBiteSaverRestaurantFavoriteIdentity(
            restaurantId: restaurantId,
          ),
        );
      } else {
        await actions.removeRestaurant(restaurantId);
      }
      if (_isCurrent(fence, includeGuest: false) &&
          _favoriteOperationVersions[restaurantId.value] == version) {
        _restaurantFavorites[restaurantId.value] = favorite
            ? CustomerBiteSaverFavoriteState.favorite
            : CustomerBiteSaverFavoriteState.notFavorite;
        _favoriteError = null;
        _notify();
      }
    } catch (caught) {
      if (_isCurrent(fence, includeGuest: false) &&
          _favoriteOperationVersions[restaurantId.value] == version) {
        _favoriteError = caught;
        _notify();
      }
      rethrow;
    }
  }

  Future<void> setOfferFavorite(
    CustomerBiteSaverOfferId offerId,
    bool favorite,
  ) async {
    final actions = _requireFavoriteWrite(offerId.value);
    if (_offers[offerId.value]?.offerType !=
        CustomerBiteSaverOfferType.coupon) {
      throw StateError('Only delivered BiteSaver coupons can be saved.');
    }
    final restaurantIdValue = _offerRestaurantIds[offerId.value];
    if (restaurantIdValue == null) {
      throw StateError('Only delivered offers can be saved.');
    }
    final fence = _captureFence();
    final version = (_favoriteOperationVersions[offerId.value] ?? 0) + 1;
    _favoriteOperationVersions[offerId.value] = version;
    try {
      if (favorite) {
        await actions.upsertCoupon(
          CustomerBiteSaverCouponFavoriteIdentity(
            restaurantId: CustomerBiteSaverRestaurantId(restaurantIdValue),
            offerId: offerId,
          ),
        );
      } else {
        await actions.removeCoupon(offerId);
      }
      if (_isCurrent(fence, includeGuest: false) &&
          _favoriteOperationVersions[offerId.value] == version) {
        _offerFavorites[offerId.value] = favorite
            ? CustomerBiteSaverFavoriteState.favorite
            : CustomerBiteSaverFavoriteState.notFavorite;
        _favoriteError = null;
        _notify();
      }
    } catch (caught) {
      if (_isCurrent(fence, includeGuest: false) &&
          _favoriteOperationVersions[offerId.value] == version) {
        _favoriteError = caught;
        _notify();
      }
      rethrow;
    }
  }

  CustomerBiteSaverFavoriteActions _requireFavoriteWrite(String id) {
    if (!_auth.isSigned) {
      throw ArgumentError(
        CustomerBiteSaverFavoriteService.loginRequiredMessage,
      );
    }
    if (!_deliveredRestaurantIds.contains(id) &&
        !_deliveredOfferIds.contains(id)) {
      throw StateError('Only delivered BiteSaver identities can be saved.');
    }
    final actions = _favoriteActions;
    if (actions == null) {
      throw StateError('Favorite writes are not configured.');
    }
    return actions;
  }

  Future<CustomerBiteSaverRedemptionDecision> validateRedemption({
    required CustomerBiteSaverRestaurantId restaurantId,
    required CustomerBiteSaverOfferId offerId,
    required String redemptionRequestId,
    CustomerBiteSaverCoordinates? currentCoordinates,
  }) async {
    _ensureAlive();
    if (_redemptionStartInFlight != null ||
        _pendingSignedStart != null ||
        _pendingGuestStartIntentGeneration != null) {
      throw StateError(
        'An in-flight or uncertain redemption start must settle or recover '
        'before another validation.',
      );
    }
    final offer = _offers[offerId.value];
    if (_status != CustomerBiteSaverCoordinatorStatus.ready ||
        offer == null ||
        _offerRestaurantIds[offerId.value] != restaurantId.value) {
      throw StateError('Redemption requires a currently delivered offer.');
    }
    if (offer.offerType != CustomerBiteSaverOfferType.coupon) {
      throw StateError('Only delivered BiteSaver coupons can be redeemed.');
    }
    final operationKey = 'redemptionStart:$redemptionRequestId';
    final intent = _RedemptionIntent(
      operationKey: operationKey,
      restaurantId: restaurantId,
      offerId: offerId,
      offerOccurrence: offer.offerOccurrence,
      redemptionRequestId: redemptionRequestId,
      currentCoordinates: currentCoordinates,
    );
    final validationInFlight = _validationInFlight;
    if (validationInFlight != null) {
      if (validationInFlight.intent == intent) {
        return validationInFlight.operation;
      }
      if (validationInFlight.intent.operationKey == operationKey) {
        throw StateError(
          'A redemption validation cannot change its in-flight payload.',
        );
      }
    }
    final pendingValidation = _pendingValidationRequests[operationKey];
    if (pendingValidation != null &&
        !_sameValidationIntent(
          pendingValidation,
          restaurantId: restaurantId,
          offerId: offerId,
          offerOccurrence: offer.offerOccurrence,
          redemptionRequestId: redemptionRequestId,
          currentCoordinates: currentCoordinates,
        )) {
      throw StateError(
        'A pending redemption validation cannot change its payload.',
      );
    }
    final activeIntent = _activeRedemptionIntent;
    if (activeIntent != null &&
        activeIntent.operationKey == operationKey &&
        activeIntent != intent) {
      throw StateError(
        'A redemption request ID cannot be reused with changed payload.',
      );
    }

    final continuingExactRetry = pendingValidation != null;
    final intentGeneration =
        continuingExactRetry && _activeRedemptionIntent == intent
        ? _redemptionIntentGeneration
        : _beginRedemptionIntent(intent);
    final initialFence = _captureFence();

    late final Future<CustomerBiteSaverRedemptionDecision> operation;
    operation =
        _runRedemptionValidation(
          intent: intent,
          intentGeneration: intentGeneration,
          offer: offer,
          pendingValidation: pendingValidation,
          initialFence: initialFence,
        ).whenComplete(() {
          final current = _validationInFlight;
          if (current != null && identical(current.operation, operation)) {
            _validationInFlight = null;
          }
        });
    _validationInFlight = _ValidationInFlight(
      intent: intent,
      intentGeneration: intentGeneration,
      operation: operation,
    );
    return operation;
  }

  Future<CustomerBiteSaverRedemptionDecision> _runRedemptionValidation({
    required _RedemptionIntent intent,
    required int intentGeneration,
    required CustomerBiteSaverOffer offer,
    required CustomerBiteSaverRedemptionValidationRequest? pendingValidation,
    required _RequestFence initialFence,
  }) async {
    final operationKey = intent.operationKey;
    final protocolOperationKey = '$operationKey:$intentGeneration';
    final revision = await _revisionForRequest(initialFence);
    _requireRedemptionIntent(intentGeneration, intent);
    if (pendingValidation != null &&
        pendingValidation.guestStateRevision != revision) {
      throw const CustomerBiteSaverStaleOperationException();
    }
    final fence = initialFence.withGuestRevision(_guestStateRevision);
    final firstRequestId =
        pendingValidation?.clientRequestId ?? _nextRequestId();
    final initialRequest =
        pendingValidation ??
        CustomerBiteSaverRedemptionValidationRequest(
          clientRequestId: firstRequestId,
          binding: _bindingForFence(fence),
          restaurantId: intent.restaurantId,
          offerId: intent.offerId,
          offerOccurrence: offer.offerOccurrence,
          redemptionRequestId: intent.redemptionRequestId,
          currentCoordinates: intent.currentCoordinates,
          guestStateRevision: revision,
        );
    _pendingValidationRequests[operationKey] = initialRequest;
    var lastValidationRequest = initialRequest;
    try {
      final executed = await _executeGuestAware(
        operation: CustomerBiteSaverGuestOperation.redemptionStart,
        operationKey: protocolOperationKey,
        initialRequestId: firstRequestId,
        initialGuestRevision: revision,
        fence: fence,
        expectedChallengeOfferId: intent.offerId,
        operationIsCurrent: () =>
            _isRedemptionIntentCurrent(intentGeneration, intent),
        invokeOriginal: (clientRequestId, guestRevision) {
          final retained = _pendingValidationRequests[operationKey];
          if (retained != null &&
              retained.clientRequestId == clientRequestId &&
              retained.guestStateRevision == guestRevision) {
            lastValidationRequest = retained;
          } else {
            lastValidationRequest =
                CustomerBiteSaverRedemptionValidationRequest(
                  clientRequestId: clientRequestId,
                  binding: _bindingForFence(fence),
                  restaurantId: initialRequest.restaurantId,
                  offerId: initialRequest.offerId,
                  offerOccurrence: initialRequest.offerOccurrence,
                  redemptionRequestId: initialRequest.redemptionRequestId,
                  currentCoordinates: initialRequest.currentCoordinates,
                  guestStateRevision: guestRevision,
                );
            _pendingValidationRequests[operationKey] = lastValidationRequest;
          }
          return _api.validateCustomerBiteSaverOfferRedemptionStart(
            lastValidationRequest,
          );
        },
      );
      _requireCurrent(executed.fence);
      _requireRedemptionIntent(intentGeneration, intent);
      final result = executed.result;
      if (result.restaurantId != initialRequest.restaurantId ||
          result.offerId != initialRequest.offerId) {
        throw const CustomerBiteSaverProtocolException();
      }
      _pendingValidationRequests.remove(operationKey);
      CustomerBiteSaverGuestUsagePolicy? guestPolicy;
      var guestUnlimited = false;
      var guestTimerOnly = false;
      var signedLocalUsageState =
          CustomerBiteSaverLocalUsageOverlayState.notApplicable;
      int? signedLocalActiveTimerExpiresAtMillis;
      _SignedUsageOverlayUpdate? signedUsageOverlay;
      if (_auth.isGuest) {
        guestPolicy = executed.challengedPolicies[intent.offerId.value];
        if (result.allowed) {
          switch (result.usagePolicy!) {
            case CustomerBiteSaverUsagePolicy.oncePerCustomer:
              if (guestPolicy !=
                  CustomerBiteSaverGuestUsagePolicy.oncePerCustomer) {
                throw const CustomerBiteSaverProtocolException();
              }
            case CustomerBiteSaverUsagePolicy.oncePerDay:
              if (guestPolicy != CustomerBiteSaverGuestUsagePolicy.oncePerDay) {
                throw const CustomerBiteSaverProtocolException();
              }
            case CustomerBiteSaverUsagePolicy.unlimited:
              if (guestPolicy != null) {
                throw const CustomerBiteSaverProtocolException();
              }
              guestUnlimited = true;
            case CustomerBiteSaverUsagePolicy.reusableAfterTimer:
              if (guestPolicy != null) {
                throw const CustomerBiteSaverProtocolException();
              }
              guestTimerOnly = true;
          }
        }
      } else if (result.allowed) {
        final policy = result.usagePolicy!;
        final evaluated = await _evaluateSignedUsageCandidates(
          <CustomerBiteSaverLocalUsageCandidate>[
            CustomerBiteSaverLocalUsageCandidate(
              offerId: result.offerId,
              usagePolicy: policy,
            ),
          ],
          executed.evaluationContext,
          executed.fence,
          updateOverlay: false,
        );
        _requireCurrent(executed.fence);
        _requireRedemptionIntent(intentGeneration, intent);
        signedUsageOverlay = _SignedUsageOverlayUpdate(
          candidates: <CustomerBiteSaverLocalUsageCandidate>[
            CustomerBiteSaverLocalUsageCandidate(
              offerId: result.offerId,
              usagePolicy: policy,
            ),
          ],
          evaluation: evaluated,
          context: executed.evaluationContext,
          fence: executed.fence,
        );
        signedLocalActiveTimerExpiresAtMillis =
            evaluated.activeTimerExpiresAtMillisByOfferId[result.offerId];
        signedLocalUsageState = signedLocalActiveTimerExpiresAtMillis != null
            ? CustomerBiteSaverLocalUsageOverlayState.activeTimer
            : evaluated.unavailableOfferIds.contains(result.offerId)
            ? CustomerBiteSaverLocalUsageOverlayState.unavailable
            : CustomerBiteSaverLocalUsageOverlayState.clear;
      }
      final authorization = _RedemptionAuthorization(
        intent: intent,
        intentGeneration: intentGeneration,
        fence: executed.fence,
        request: lastValidationRequest,
        result: result,
        guestStateRevision: executed.guestStateRevision,
        evaluationContext: executed.evaluationContext,
        guestUsagePolicy: guestPolicy,
        guestUnlimited: guestUnlimited,
        guestTimerOnly: guestTimerOnly,
      );
      final localSignedRestriction =
          _auth.isSigned &&
          result.allowed &&
          signedLocalUsageState !=
              CustomerBiteSaverLocalUsageOverlayState.clear;
      final decision = _decision(
        result,
        allowed: localSignedRestriction ? false : null,
        reason: localSignedRestriction
            ? signedLocalUsageState ==
                      CustomerBiteSaverLocalUsageOverlayState.activeTimer
                  ? 'localActiveTimer'
                  : 'localUsageUnavailable'
            : null,
        activeTimerExpiresAtMillis: signedLocalActiveTimerExpiresAtMillis,
      );
      final signedInvalidatesAtMillis = signedUsageOverlay == null
          ? null
          : _commitSignedUsageOverlay(signedUsageOverlay);
      _redemptionAuthorization = authorization;
      _redemptionDecision = decision;
      _redemptionError = null;
      _pendingSignedStart = null;
      _pendingGuestStartIntentGeneration = null;
      final validationInvalidatesAtMillis =
          signedInvalidatesAtMillis ??
          (_auth.isGuest ? executed.pendingActiveTimerExpiresAtMillis : null);
      if (validationInvalidatesAtMillis != null) {
        _scheduleUsageContextExpiry(validationInvalidatesAtMillis);
      }
      if (!_isCurrent(executed.fence) ||
          !_isRedemptionIntentCurrent(intentGeneration, intent)) {
        if (_status == CustomerBiteSaverCoordinatorStatus.freshSearchRequired) {
          throw const CustomerBiteSaverFreshSearchRequiredException();
        }
        throw const CustomerBiteSaverStaleOperationException();
      }
      _notify();
      return decision;
    } catch (caught) {
      if (_isCurrent(fence, includeGuest: false) &&
          _isRedemptionIntentCurrent(intentGeneration, intent)) {
        _redemptionError = caught;
        _notify();
      }
      rethrow;
    } finally {
      if (!_isRedemptionIntentCurrent(intentGeneration, intent)) {
        _discardRedemptionProtocolOperation(protocolOperationKey);
        if (identical(
          _pendingValidationRequests[operationKey],
          lastValidationRequest,
        )) {
          _pendingValidationRequests.remove(operationKey);
        }
      }
    }
  }

  Future<CustomerBiteSaverRedemptionReceipt> startValidatedRedemption() async {
    _ensureAlive();
    final authorization = _redemptionAuthorization;
    if (authorization == null || _redemptionDecision?.allowed != true) {
      throw StateError('There is no permitted current validation.');
    }
    final inFlight = _redemptionStartInFlight;
    if (inFlight != null &&
        inFlight.intentGeneration == authorization.intentGeneration &&
        inFlight.intent == authorization.intent) {
      return inFlight.operation;
    }
    final recoveringRetainedStart =
        (_auth.isSigned && _pendingSignedStart != null) ||
        (_auth.isGuest &&
            _pendingGuestStartIntentGeneration ==
                authorization.intentGeneration);
    if (recoveringRetainedStart) {
      _requireRedemptionSessionCurrent(authorization);
    } else {
      _requireCurrent(authorization.fence);
      if (_status != CustomerBiteSaverCoordinatorStatus.ready) {
        throw StateError('Redemption requires a ready search.');
      }
    }
    _requireRedemptionIntent(
      authorization.intentGeneration,
      authorization.intent,
    );

    late final Future<CustomerBiteSaverRedemptionReceipt> operation;
    operation = _runValidatedRedemptionStart(authorization).whenComplete(() {
      final current = _redemptionStartInFlight;
      if (current != null && identical(current.operation, operation)) {
        _redemptionStartInFlight = null;
      }
    });
    _redemptionStartInFlight = _RedemptionStartInFlight(
      intent: authorization.intent,
      intentGeneration: authorization.intentGeneration,
      operation: operation,
    );
    return operation;
  }

  Future<CustomerBiteSaverRedemptionReceipt> _runValidatedRedemptionStart(
    _RedemptionAuthorization authorization,
  ) async {
    final intent = authorization.intent;
    final intentGeneration = authorization.intentGeneration;
    final expiresAt = authorization.result.validationExpiresAtMillis!;
    final retainedSignedStart = _pendingSignedStart;
    final recoveringGuestStart =
        _auth.isGuest && _pendingGuestStartIntentGeneration == intentGeneration;
    final freshStart =
        (_auth.isGuest && !recoveringGuestStart) ||
        (_auth.isSigned && retainedSignedStart == null);
    if (freshStart) {
      final nowMillis = _clock().millisecondsSinceEpoch;
      if (nowMillis >= expiresAt) {
        throw const CustomerBiteSaverGuestUsageException(
          CustomerBiteSaverGuestUsageFailure.validationExpired,
        );
      }
      _requireEvaluationContextCurrent(
        authorization.evaluationContext,
        authorization.fence,
      );
    }
    try {
      if (_auth.isGuest) {
        final int revision;
        if (recoveringGuestStart) {
          revision = authorization.guestStateRevision!;
        } else {
          revision = await _guestUsageStore.readRevision();
        }
        _requireRedemptionSessionCurrent(authorization);
        _requireRedemptionIntent(intentGeneration, intent);
        if (!recoveringGuestStart &&
            _status != CustomerBiteSaverCoordinatorStatus.ready) {
          throw const CustomerBiteSaverStaleOperationException();
        }
        if (!recoveringGuestStart &&
            _clock().millisecondsSinceEpoch >= expiresAt) {
          throw const CustomerBiteSaverGuestUsageException(
            CustomerBiteSaverGuestUsageFailure.validationExpired,
          );
        }
        if (!recoveringGuestStart &&
            revision != authorization.guestStateRevision) {
          _guestStateRevision = revision;
          _clearRedemption();
          _markFreshSearchRequired(clearRedemption: false);
          throw const CustomerBiteSaverFreshSearchRequiredException();
        }
        if (authorization.guestUnlimited) {
          final receipt = CustomerBiteSaverRedemptionReceipt.guestUnlimited(
            restaurantId: authorization.request.restaurantId,
            offerId: authorization.request.offerId,
          );
          _redemptionError = null;
          _completeRedemptionIntent(intentGeneration, intent);
          _notify();
          return receipt;
        }
        _pendingGuestStartIntentGeneration = intentGeneration;
        final guestPolicy =
            authorization.guestUsagePolicy ??
            (authorization.guestTimerOnly
                ? CustomerBiteSaverGuestUsagePolicy.oncePerCustomer
                : throw const CustomerBiteSaverProtocolException());
        late final CustomerBiteSaverGuestRedemptionStart guestResult;
        try {
          guestResult = await _guestUsageStore.startRedemption(
            redemptionRequestId: authorization.request.redemptionRequestId,
            restaurantId: authorization.request.restaurantId,
            offerId: authorization.request.offerId,
            usagePolicy: guestPolicy,
            evaluationContext: authorization.evaluationContext,
            validationExpiresAtMillis: expiresAt,
            expectedGuestStateRevision: revision,
            reusableAfterTimer: authorization.guestTimerOnly,
          );
        } on CustomerBiteSaverGuestUsageException catch (caught) {
          if (caught.failure !=
              CustomerBiteSaverGuestUsageFailure.revisionChanged) {
            rethrow;
          }
          final durableRevision = await _guestUsageStore.readRevision();
          _requireRedemptionSessionCurrent(authorization);
          _requireRedemptionIntent(intentGeneration, intent);
          _guestStateRevision = durableRevision;
          _clearRedemption();
          _markFreshSearchRequired(clearRedemption: false);
          throw const CustomerBiteSaverFreshSearchRequiredException();
        }
        _requireRedemptionSessionCurrent(authorization);
        _requireRedemptionIntent(intentGeneration, intent);
        _guestStateRevision = guestResult.guestStateRevision;
        final receipt = CustomerBiteSaverRedemptionReceipt.guest(guestResult);
        _redemptionError = null;
        _completeRedemptionIntent(intentGeneration, intent);
        _markFreshSearchRequired(clearRedemption: false);
        return receipt;
      }

      final validationId = authorization.result.validationId!;
      late final CustomerBiteSaverRedemptionStartRequest request;
      if (retainedSignedStart != null) {
        request = retainedSignedStart;
      } else {
        final usagePolicy = authorization.result.usagePolicy!;
        final evaluated = await _evaluateSignedUsageCandidates(
          <CustomerBiteSaverLocalUsageCandidate>[
            CustomerBiteSaverLocalUsageCandidate(
              offerId: authorization.request.offerId,
              usagePolicy: usagePolicy,
            ),
          ],
          authorization.evaluationContext,
          authorization.fence,
          updateOverlay: true,
        );
        _requireCurrent(authorization.fence);
        _requireRedemptionIntent(intentGeneration, intent);
        _requireEvaluationContextCurrent(
          authorization.evaluationContext,
          authorization.fence,
        );
        if (_clock().millisecondsSinceEpoch >= expiresAt) {
          throw const CustomerBiteSaverGuestUsageException(
            CustomerBiteSaverGuestUsageFailure.validationExpired,
          );
        }
        if (evaluated.unavailableOfferIds.contains(
              authorization.request.offerId,
            ) ||
            evaluated.activeTimerExpiresAtMillisByOfferId.containsKey(
              authorization.request.offerId,
            )) {
          throw const CustomerBiteSaverGuestUsageException(
            CustomerBiteSaverGuestUsageFailure.unavailable,
          );
        }
        request = CustomerBiteSaverRedemptionStartRequest.fromValidation(
          request: authorization.request,
          clientRequestId: _nextRequestId(),
          validationId: validationId,
        );
      }
      _pendingSignedStart = request;
      final result = await _api.startCustomerBiteSaverOfferRedemption(request);
      _requireRedemptionSessionCurrent(authorization);
      _requireRedemptionIntent(intentGeneration, intent);
      _redemptionError = null;
      _completeRedemptionIntent(intentGeneration, intent);
      _notify();
      return CustomerBiteSaverRedemptionReceipt.signed(result);
    } catch (caught) {
      if (_isRedemptionSessionCurrent(authorization) &&
          _isRedemptionIntentCurrent(intentGeneration, intent)) {
        if (_auth.isSigned &&
            caught is CustomerBiteSaverServiceException &&
            caught.kind == CustomerBiteSaverServiceFailureKind.callable) {
          _pendingSignedStart = null;
        } else if (_auth.isGuest &&
            caught is CustomerBiteSaverGuestUsageException &&
            caught.failure != CustomerBiteSaverGuestUsageFailure.readFailed &&
            caught.failure != CustomerBiteSaverGuestUsageFailure.writeFailed) {
          _pendingGuestStartIntentGeneration = null;
        }
        _redemptionError = caught;
        _notify();
      }
      rethrow;
    }
  }

  CustomerBiteSaverRedemptionDecision _decision(
    CustomerBiteSaverRedemptionValidationResult result, {
    bool? allowed,
    String? reason,
    int? activeTimerExpiresAtMillis,
  }) => CustomerBiteSaverRedemptionDecision(
    restaurantId: result.restaurantId,
    offerId: result.offerId,
    allowed: allowed ?? result.allowed,
    reason: reason ?? result.reason,
    evaluatedAtMillis: result.evaluatedAtMillis,
    activeTimerExpiresAtMillis:
        activeTimerExpiresAtMillis ?? result.activeTimerExpiresAtMillis,
    nextAvailableAtMillis: result.nextAvailableAtMillis,
    validationExpiresAtMillis: result.validationExpiresAtMillis,
  );

  Future<void> updateAuth(CustomerBiteSaverAuthSnapshot next) async {
    _ensureAlive();
    _validateAuthSnapshot(next);
    final previous = _auth;
    final previousStatus = _status;
    final previousRevision = _guestStateRevision;
    final preserveRedemptionStart =
        previous.realmKey == next.realmKey && _hasPendingRedemptionStart;
    _generation += 1;
    _cancelScheduledWork();
    _disposePagers(clearDelivered: true);
    _pendingOriginalCalls.clear();
    _pendingGuestContinuations.clear();
    _guestProtocolProgress.clear();
    _pendingValidationRequests.clear();
    _pendingSearch = null;
    _pendingStatusRequest = null;
    _pendingStatusPurpose = null;
    _statusAutomaticRetryCount = 0;
    _pendingPageReconciliation = false;
    if (!preserveRedemptionStart) {
      _pendingSignedStart = null;
      _clearRedemption();
    }
    _auth = next;
    _favoriteError = null;
    if (!preserveRedemptionStart) {
      _redemptionError = null;
    }

    if (previous.realmKey != next.realmKey) {
      _clearSessionData(clearFavorites: true);
      _status = CustomerBiteSaverCoordinatorStatus.idle;
      _notify();
      return;
    }

    {
      final generation = _generation;
      try {
        final currentRevision = await _guestUsageStore.readRevision();
        if (_disposed || generation != _generation) {
          return;
        }
        if (previousRevision != null && currentRevision != previousRevision) {
          _guestStateRevision = currentRevision;
          _markFreshSearchRequired();
          return;
        }
        _guestStateRevision = currentRevision;
      } catch (caught, stackTrace) {
        if (!_disposed && generation == _generation) {
          _status = CustomerBiteSaverCoordinatorStatus.error;
          _error = caught;
          _errorStackTrace = stackTrace;
          _notify();
        }
        return;
      }
    }

    if (_binding == null) {
      _status = CustomerBiteSaverCoordinatorStatus.idle;
      _notify();
      return;
    }
    if (previousStatus == CustomerBiteSaverCoordinatorStatus.preparing) {
      _status = CustomerBiteSaverCoordinatorStatus.preparing;
      _notify();
      _scheduleStatusPoll();
    } else if (previousStatus == CustomerBiteSaverCoordinatorStatus.ready) {
      await _becomeReadyAndLoad();
    } else {
      _status = previousStatus;
      _notify();
    }
  }

  void pause() {
    _ensureAlive();
    if (_status == CustomerBiteSaverCoordinatorStatus.paused) {
      return;
    }
    _statusBeforePause = _status;
    final preserveRedemptionStart = _hasPendingRedemptionStart;
    _generation += 1;
    _cancelScheduledWork();
    _disposePagers(clearDelivered: true);
    _pendingOriginalCalls.clear();
    _pendingGuestContinuations.clear();
    _guestProtocolProgress.clear();
    _pendingValidationRequests.clear();
    _pendingStatusRequest = null;
    _pendingStatusPurpose = null;
    _statusAutomaticRetryCount = 0;
    _pendingPageReconciliation = false;
    if (!preserveRedemptionStart) {
      _pendingSignedStart = null;
      _clearRedemption();
    }
    _status = CustomerBiteSaverCoordinatorStatus.paused;
    _notify();
  }

  Future<void> resume() async {
    _ensureAlive();
    if (_status != CustomerBiteSaverCoordinatorStatus.paused) {
      return;
    }
    _generation += 1;
    final prior = _statusBeforePause ?? CustomerBiteSaverCoordinatorStatus.idle;
    _statusBeforePause = null;
    if (_binding == null) {
      _status = CustomerBiteSaverCoordinatorStatus.idle;
      _notify();
    } else if (prior == CustomerBiteSaverCoordinatorStatus.preparing) {
      _status = CustomerBiteSaverCoordinatorStatus.preparing;
      _notify();
      _scheduleStatusPoll();
    } else if (prior == CustomerBiteSaverCoordinatorStatus.ready) {
      _status = CustomerBiteSaverCoordinatorStatus.ready;
      _notify();
      await _pollStatus(purpose: _StatusPollPurpose.readyExpiry);
    } else {
      _status = prior;
      _notify();
    }
  }

  Future<int?> _revisionForRequest(_RequestFence fence) async {
    final expected = _guestStateRevision;
    final persisted = await _guestUsageStore.readRevision();
    _requireCurrent(fence, includeGuest: false);
    if (expected == null) {
      _guestStateRevision = persisted;
      return _auth.isGuest ? persisted : null;
    }
    if (persisted != expected) {
      _guestStateRevision = persisted;
      _markFreshSearchRequired();
      throw const CustomerBiteSaverFreshSearchRequiredException();
    }
    return _auth.isGuest ? persisted : null;
  }

  CustomerBiteSaverSessionBinding _bindingForFence(_RequestFence fence) {
    _requireCurrent(fence, includeGuest: false);
    return _binding!;
  }

  _RequestFence _captureFence({
    bool includeSession = true,
    int? expectedGeneration,
  }) {
    if (expectedGeneration != null && expectedGeneration != _generation) {
      throw const CustomerBiteSaverStaleOperationException();
    }
    return _RequestFence(
      generation: _generation,
      realmKey: _auth.realmKey,
      criteriaKey: _criteriaKey,
      sessionId: includeSession ? _binding?.sessionId : null,
      attemptGeneration: includeSession ? _attemptGeneration : null,
      queryFingerprint: includeSession ? _queryFingerprint : null,
      guestStateRevision: includeSession ? _guestStateRevision : null,
    );
  }

  bool _isCurrent(
    _RequestFence fence, {
    bool includeSession = true,
    bool includeGuest = true,
  }) {
    if (_disposed ||
        fence.generation != _generation ||
        fence.realmKey != _auth.realmKey ||
        fence.criteriaKey != _criteriaKey) {
      return false;
    }
    if (includeSession &&
        (fence.sessionId != _binding?.sessionId ||
            fence.attemptGeneration != _attemptGeneration ||
            fence.queryFingerprint != _queryFingerprint)) {
      return false;
    }
    return !includeGuest || fence.guestStateRevision == _guestStateRevision;
  }

  bool _isRedemptionSessionCurrent(_RedemptionAuthorization authorization) {
    final fence = authorization.fence;
    return !_disposed &&
        fence.realmKey == _auth.realmKey &&
        fence.criteriaKey == _criteriaKey &&
        fence.sessionId == _binding?.sessionId &&
        fence.attemptGeneration == _attemptGeneration &&
        fence.queryFingerprint == _queryFingerprint;
  }

  void _requireRedemptionSessionCurrent(
    _RedemptionAuthorization authorization,
  ) {
    if (!_isRedemptionSessionCurrent(authorization)) {
      throw const CustomerBiteSaverStaleOperationException();
    }
  }

  void _requireCurrent(
    _RequestFence fence, {
    bool includeSession = true,
    bool includeGuest = true,
  }) {
    if (!_isCurrent(
      fence,
      includeSession: includeSession,
      includeGuest: includeGuest,
    )) {
      throw const CustomerBiteSaverStaleOperationException();
    }
  }

  void _markFreshSearchRequired({bool clearRedemption = true}) {
    final preserveRedemptionStart = _hasPendingRedemptionStart;
    _generation += 1;
    _cancelScheduledWork();
    _disposePagers(clearDelivered: true);
    _pendingOriginalCalls.clear();
    _pendingGuestContinuations.clear();
    _guestProtocolProgress.clear();
    _pendingValidationRequests.clear();
    _pendingStatusRequest = null;
    _pendingStatusPurpose = null;
    _statusAutomaticRetryCount = 0;
    _pendingPageReconciliation = false;
    if (!preserveRedemptionStart) {
      _pendingSignedStart = null;
    }
    if (clearRedemption && !preserveRedemptionStart) {
      _clearRedemption();
    }
    _status = CustomerBiteSaverCoordinatorStatus.freshSearchRequired;
    _notify();
  }

  void _invalidateAsyncWork({
    required bool clearSessionData,
    required bool clearFavorites,
  }) {
    _generation += 1;
    _cancelScheduledWork();
    _disposePagers(clearDelivered: true);
    _pendingOriginalCalls.clear();
    _pendingGuestContinuations.clear();
    _guestProtocolProgress.clear();
    _pendingValidationRequests.clear();
    _pendingStatusRequest = null;
    _pendingStatusPurpose = null;
    _pendingPageReconciliation = false;
    _pendingSignedStart = null;
    _clearRedemption();
    if (clearSessionData) {
      _clearSessionData(clearFavorites: clearFavorites);
    }
  }

  void _clearSessionData({required bool clearFavorites}) {
    _binding = null;
    _attemptGeneration = null;
    _queryFingerprint = null;
    _logicalExpiresAtMillis = null;
    _guestStateRevision = null;
    _progress = null;
    _failureCode = null;
    _failureRetriable = false;
    _statusPollCount = 0;
    _statusAutomaticRetryCount = 0;
    if (clearFavorites) {
      _restaurantFavorites.clear();
      _offerFavorites.clear();
      _favoriteOperationVersions.clear();
    }
  }

  void _disposePagers({required bool clearDelivered}) {
    _restaurantPager?.dispose();
    _restaurantPager = null;
    for (final pager in _offerPagers.values) {
      pager.dispose();
    }
    _offerPagers.clear();
    _offerPagerRestartRequired.clear();
    if (clearDelivered) {
      _restaurants.clear();
      _deliveredRestaurantIds.clear();
      _deliveredOfferIds.clear();
      _observedOfferRestaurantIds.clear();
      _offerRestaurantIds.clear();
      _offers.clear();
      _localUsageOverlays.clear();
    }
  }

  void _discardOfferPager(
    CustomerBiteSaverRestaurantId restaurantId,
    CustomerLoadMoreController<CustomerBiteSaverOffer> pager,
  ) {
    final previewIds =
        _restaurants[restaurantId.value]?.offers
            .map((offer) => offer.offerId.value)
            .toSet() ??
        const <String>{};
    for (final offer in pager.items) {
      final offerId = offer.offerId.value;
      if (previewIds.contains(offerId)) {
        continue;
      }
      _deliveredOfferIds.remove(offerId);
      _offerRestaurantIds.remove(offerId);
      _offers.remove(offerId);
      _offerFavorites.remove(offerId);
      _favoriteOperationVersions.remove(offerId);
      _localUsageOverlays.remove(offerId);
    }
    pager.dispose();
    _offerPagers.remove(restaurantId.value);
  }

  void _cancelScheduledWork() {
    _scheduledStatusPoll?.cancel();
    _scheduledStatusPoll = null;
    _scheduledUsageContextExpiry?.cancel();
    _scheduledUsageContextExpiry = null;
    _usageContextValidUntilExclusiveMillis = null;
    _statusPollInFlight = null;
  }

  int _beginRedemptionIntent(_RedemptionIntent intent) {
    final previous = _activeRedemptionIntent;
    if (previous != null) {
      _discardRedemptionOperation(previous, _redemptionIntentGeneration);
    }
    _redemptionIntentGeneration += 1;
    _activeRedemptionIntent = intent;
    _validationInFlight = null;
    _redemptionStartInFlight = null;
    _redemptionAuthorization = null;
    _redemptionDecision = null;
    _redemptionError = null;
    _pendingSignedStart = null;
    _pendingGuestStartIntentGeneration = null;
    _notify();
    return _redemptionIntentGeneration;
  }

  bool _isRedemptionIntentCurrent(
    int intentGeneration,
    _RedemptionIntent intent,
  ) =>
      !_disposed &&
      intentGeneration == _redemptionIntentGeneration &&
      _activeRedemptionIntent == intent;

  void _requireRedemptionIntent(
    int intentGeneration,
    _RedemptionIntent intent,
  ) {
    if (!_isRedemptionIntentCurrent(intentGeneration, intent)) {
      throw const CustomerBiteSaverStaleOperationException();
    }
  }

  void _completeRedemptionIntent(
    int intentGeneration,
    _RedemptionIntent intent,
  ) {
    _requireRedemptionIntent(intentGeneration, intent);
    _discardRedemptionOperation(intent, intentGeneration);
    _redemptionIntentGeneration += 1;
    _activeRedemptionIntent = null;
    _validationInFlight = null;
    _redemptionStartInFlight = null;
    _redemptionAuthorization = null;
    _redemptionDecision = null;
    _pendingSignedStart = null;
    _pendingGuestStartIntentGeneration = null;
  }

  void _discardRedemptionOperation(
    _RedemptionIntent intent,
    int intentGeneration,
  ) {
    _discardRedemptionProtocolOperation(
      '${intent.operationKey}:$intentGeneration',
    );
    _pendingValidationRequests.remove(intent.operationKey);
  }

  void _discardRedemptionProtocolOperation(String operationKey) {
    _pendingOriginalCalls.remove(operationKey);
    _pendingGuestContinuations.remove(operationKey);
    _guestProtocolProgress.remove(operationKey);
  }

  void _clearRedemption() {
    final active = _activeRedemptionIntent;
    if (active != null) {
      _discardRedemptionOperation(active, _redemptionIntentGeneration);
    }
    _redemptionIntentGeneration += 1;
    _activeRedemptionIntent = null;
    _validationInFlight = null;
    _redemptionStartInFlight = null;
    _redemptionAuthorization = null;
    _redemptionDecision = null;
    _pendingSignedStart = null;
    _pendingGuestStartIntentGeneration = null;
  }

  void _ensureAlive() {
    if (_disposed) {
      throw StateError('The BiteSaver coordinator is disposed.');
    }
  }

  String _nextRequestId() {
    final requestId = _requestIdGenerator();
    if (!RegExp(r'^[A-Za-z0-9_-]{16,128}$').hasMatch(requestId) ||
        !_issuedRequestIds.add(requestId)) {
      throw StateError(
        'The BiteSaver request ID generator returned invalid or reused data.',
      );
    }
    return requestId;
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    if (_disposed) {
      return;
    }
    _disposed = true;
    _generation += 1;
    _cancelScheduledWork();
    _disposePagers(clearDelivered: true);
    _pendingOriginalCalls.clear();
    _pendingGuestContinuations.clear();
    _guestProtocolProgress.clear();
    _pendingValidationRequests.clear();
    _pendingStatusRequest = null;
    _pendingStatusPurpose = null;
    _statusAutomaticRetryCount = 0;
    _pendingPageReconciliation = false;
    _pendingSignedStart = null;
    _clearRedemption();
    super.dispose();
  }

  static String _criteriaIdentity(CustomerBiteSaverSearchCriteria criteria) =>
      jsonEncode(criteria.toJson());

  static void _validateAuthSnapshot(CustomerBiteSaverAuthSnapshot snapshot) {
    if (snapshot.uid != null && snapshot.uid!.isEmpty) {
      throw ArgumentError.value(
        snapshot.uid,
        'uid',
        'The auth UID is invalid.',
      );
    }
  }

  static bool _sameValidationIntent(
    CustomerBiteSaverRedemptionValidationRequest request, {
    required CustomerBiteSaverRestaurantId restaurantId,
    required CustomerBiteSaverOfferId offerId,
    required String offerOccurrence,
    required String redemptionRequestId,
    required CustomerBiteSaverCoordinates? currentCoordinates,
  }) =>
      request.restaurantId == restaurantId &&
      request.offerId == offerId &&
      request.offerOccurrence == offerOccurrence &&
      request.redemptionRequestId == redemptionRequestId &&
      _sameCoordinates(request.currentCoordinates, currentCoordinates);

  static bool _sameCoordinates(
    CustomerBiteSaverCoordinates? left,
    CustomerBiteSaverCoordinates? right,
  ) =>
      identical(left, right) ||
      (left != null &&
          right != null &&
          left.latitude == right.latitude &&
          left.longitude == right.longitude &&
          left.capturedAtMillis == right.capturedAtMillis);

  static CustomerBiteSaverScheduledTask _timerScheduler(
    Duration delay,
    void Function() callback,
  ) => _TimerScheduledTask(Timer(delay, callback));

  static String _secureRequestId() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-'
        '${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-'
        '${hex.substring(16, 20)}-'
        '${hex.substring(20)}';
  }
}

@immutable
final class _RequestFence {
  const _RequestFence({
    required this.generation,
    required this.realmKey,
    required this.criteriaKey,
    required this.sessionId,
    required this.attemptGeneration,
    required this.queryFingerprint,
    required this.guestStateRevision,
  });

  final int generation;
  final String realmKey;
  final String? criteriaKey;
  final String? sessionId;
  final int? attemptGeneration;
  final String? queryFingerprint;
  final int? guestStateRevision;

  _RequestFence withGuestRevision(int? revision) => _RequestFence(
    generation: generation,
    realmKey: realmKey,
    criteriaKey: criteriaKey,
    sessionId: sessionId,
    attemptGeneration: attemptGeneration,
    queryFingerprint: queryFingerprint,
    guestStateRevision: revision,
  );
}

final class _PendingSearch {
  const _PendingSearch({
    required this.request,
    required this.criteria,
    required this.criteriaKey,
    required this.realmKey,
  });

  final CustomerBiteSaverStartRequest request;
  final CustomerBiteSaverSearchCriteria criteria;
  final String criteriaKey;
  final String realmKey;
}

@immutable
final class _RedemptionIntent {
  const _RedemptionIntent({
    required this.operationKey,
    required this.restaurantId,
    required this.offerId,
    required this.offerOccurrence,
    required this.redemptionRequestId,
    required this.currentCoordinates,
  });

  final String operationKey;
  final CustomerBiteSaverRestaurantId restaurantId;
  final CustomerBiteSaverOfferId offerId;
  final String offerOccurrence;
  final String redemptionRequestId;
  final CustomerBiteSaverCoordinates? currentCoordinates;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is _RedemptionIntent &&
          operationKey == other.operationKey &&
          restaurantId == other.restaurantId &&
          offerId == other.offerId &&
          offerOccurrence == other.offerOccurrence &&
          redemptionRequestId == other.redemptionRequestId &&
          _coordinatesEqual(currentCoordinates, other.currentCoordinates);

  @override
  int get hashCode => Object.hash(
    operationKey,
    restaurantId,
    offerId,
    offerOccurrence,
    redemptionRequestId,
    currentCoordinates?.latitude,
    currentCoordinates?.longitude,
    currentCoordinates?.capturedAtMillis,
  );

  static bool _coordinatesEqual(
    CustomerBiteSaverCoordinates? left,
    CustomerBiteSaverCoordinates? right,
  ) =>
      identical(left, right) ||
      (left != null &&
          right != null &&
          left.latitude == right.latitude &&
          left.longitude == right.longitude &&
          left.capturedAtMillis == right.capturedAtMillis);
}

final class _ValidationInFlight {
  const _ValidationInFlight({
    required this.intent,
    required this.intentGeneration,
    required this.operation,
  });

  final _RedemptionIntent intent;
  final int intentGeneration;
  final Future<CustomerBiteSaverRedemptionDecision> operation;
}

final class _RedemptionStartInFlight {
  const _RedemptionStartInFlight({
    required this.intent,
    required this.intentGeneration,
    required this.operation,
  });

  final _RedemptionIntent intent;
  final int intentGeneration;
  final Future<CustomerBiteSaverRedemptionReceipt> operation;
}

final class _PendingOriginalCall {
  const _PendingOriginalCall({
    required this.clientRequestId,
    required this.guestStateRevision,
  });

  final String clientRequestId;
  final int? guestStateRevision;
}

final class _SignedUsageOverlayUpdate {
  const _SignedUsageOverlayUpdate({
    required this.candidates,
    required this.evaluation,
    required this.context,
    required this.fence,
  });

  final List<CustomerBiteSaverLocalUsageCandidate> candidates;
  final CustomerBiteSaverGuestCandidateEvaluation? evaluation;
  final CustomerBiteSaverEvaluationContext context;
  final _RequestFence fence;
}

final class _GuestAwareResult<T extends CustomerBiteSaverOperationResult> {
  const _GuestAwareResult({
    required this.result,
    required this.fence,
    required this.guestStateRevision,
    required this.evaluationContext,
    required this.challengeObserved,
    required this.challengedPolicies,
    required this.pendingActiveTimerExpiresAtMillis,
  });

  final T result;
  final _RequestFence fence;
  final int? guestStateRevision;
  final CustomerBiteSaverEvaluationContext evaluationContext;
  final bool challengeObserved;
  final Map<String, CustomerBiteSaverGuestUsagePolicy> challengedPolicies;
  final int? pendingActiveTimerExpiresAtMillis;
}

final class _GuestProtocolProgress {
  _GuestProtocolProgress({
    required this.challengeObserved,
    required Map<String, CustomerBiteSaverGuestUsagePolicy> challengedPolicies,
    required this.evaluationBinding,
    required this.pendingActiveTimerExpiresAtMillis,
  }) : challengedPolicies =
           Map<String, CustomerBiteSaverGuestUsagePolicy>.unmodifiable(
             challengedPolicies,
           );

  final bool challengeObserved;
  final Map<String, CustomerBiteSaverGuestUsagePolicy> challengedPolicies;
  final String? evaluationBinding;
  final int? pendingActiveTimerExpiresAtMillis;
}

final class _RedemptionAuthorization {
  const _RedemptionAuthorization({
    required this.intent,
    required this.intentGeneration,
    required this.fence,
    required this.request,
    required this.result,
    required this.guestStateRevision,
    required this.evaluationContext,
    required this.guestUsagePolicy,
    required this.guestUnlimited,
    required this.guestTimerOnly,
  });

  final _RedemptionIntent intent;
  final int intentGeneration;
  final _RequestFence fence;
  final CustomerBiteSaverRedemptionValidationRequest request;
  final CustomerBiteSaverRedemptionValidationResult result;
  final int? guestStateRevision;
  final CustomerBiteSaverEvaluationContext evaluationContext;
  final CustomerBiteSaverGuestUsagePolicy? guestUsagePolicy;
  final bool guestUnlimited;
  final bool guestTimerOnly;
}

final class _LocalUsageOverlay {
  const _LocalUsageOverlay({
    required this.state,
    required this.activeTimerExpiresAtMillis,
    required this.usagePolicy,
    required this.context,
    required this.guestStateRevision,
    required this.realmKey,
  });

  const _LocalUsageOverlay.notApplicable()
    : state = CustomerBiteSaverLocalUsageOverlayState.notApplicable,
      activeTimerExpiresAtMillis = null,
      usagePolicy = null,
      context = null,
      guestStateRevision = null,
      realmKey = null;

  const _LocalUsageOverlay.unknown()
    : state = CustomerBiteSaverLocalUsageOverlayState.unknown,
      activeTimerExpiresAtMillis = null,
      usagePolicy = null,
      context = null,
      guestStateRevision = null,
      realmKey = null;

  final CustomerBiteSaverLocalUsageOverlayState state;
  final int? activeTimerExpiresAtMillis;
  final CustomerBiteSaverUsagePolicy? usagePolicy;
  final CustomerBiteSaverEvaluationContext? context;
  final int? guestStateRevision;
  final String? realmKey;
}
