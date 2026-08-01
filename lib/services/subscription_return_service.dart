import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';

import 'subscription_return_context_store.dart';
import 'subscription_return_server_client.dart';
import 'subscription_return_web_location.dart';

export 'subscription_return_context_store.dart';
export 'subscription_return_server_client.dart'
    show
        SubscriptionReturnClaim,
        SubscriptionReturnClaimType,
        SubscriptionReturnRedemption,
        SubscriptionReturnServerClient,
        SubscriptionReturnServerException,
        SubscriptionReturnServerFailure;

const String stripeCustomerPortalReturnUrl =
    'https://app.bitestar.app/subscription/portal-return';
const String subscriptionCheckoutSuccessReturnUri =
    'bitesaver://subscription-success';
const String subscriptionCheckoutCancelReturnUri =
    'bitesaver://subscription-cancel';
const String subscriptionPortalReturnUri =
    'bitesaver://subscription-portal-return';
const String subscriptionReturnWebOrigin = 'https://app.bitestar.app';
const String subscriptionReturnWebRoutePrefix = '/subscription-return/';

final RegExp _exactSubscriptionReturnLinkPattern = RegExp(
  r'^bitesaver://(subscription-success|subscription-cancel|subscription-portal-return)\?return_token=([A-Za-z0-9_-]{43})$',
);
final RegExp _exactSubscriptionReturnWebLocationPattern = RegExp(
  r'^https://app\.bitestar\.app/#/subscription-return/(checkoutSuccess|checkoutCancel|customerPortal)\?return_token=([A-Za-z0-9_-]{43})$',
);

@immutable
class SubscriptionReturnLink {
  final SubscriptionReturnKind kind;
  final String returnToken;

  const SubscriptionReturnLink({required this.kind, required this.returnToken});
}

SubscriptionReturnLink? parseSubscriptionReturnLink(String rawUri) {
  final match = _exactSubscriptionReturnLinkPattern.firstMatch(rawUri);
  if (match == null) {
    return null;
  }
  final host = match.group(1);
  final returnToken = match.group(2);
  if (host == null ||
      returnToken == null ||
      !isValidSubscriptionReturnToken(returnToken)) {
    return null;
  }
  final kind = switch (host) {
    'subscription-success' => SubscriptionReturnKind.checkoutSuccess,
    'subscription-cancel' => SubscriptionReturnKind.checkoutCancel,
    'subscription-portal-return' => SubscriptionReturnKind.customerPortal,
    _ => null,
  };
  final uri = Uri.tryParse(rawUri);
  final queryValues =
      uri?.queryParametersAll[subscriptionReturnTokenQueryParameter];
  if (kind == null ||
      uri == null ||
      uri.scheme != 'bitesaver' ||
      uri.host != host ||
      uri.path.isNotEmpty ||
      uri.hasFragment ||
      uri.userInfo.isNotEmpty ||
      uri.hasPort ||
      uri.queryParametersAll.length != 1 ||
      queryValues == null ||
      queryValues.length != 1 ||
      queryValues.single != returnToken ||
      uri.toString() != rawUri) {
    return null;
  }
  return SubscriptionReturnLink(kind: kind, returnToken: returnToken);
}

SubscriptionReturnLink? parseSubscriptionReturnUri(Uri uri) {
  return parseSubscriptionReturnLink(uri.toString());
}

SubscriptionReturnLink? parseSubscriptionReturnWebLocation(String rawLocation) {
  final match = _exactSubscriptionReturnWebLocationPattern.firstMatch(
    rawLocation,
  );
  if (match == null) {
    return null;
  }
  final rawKind = match.group(1);
  final returnToken = match.group(2);
  final kind = rawKind == null ? null : subscriptionReturnKindFromName(rawKind);
  final uri = Uri.tryParse(rawLocation);
  if (kind == null ||
      returnToken == null ||
      !isValidSubscriptionReturnToken(returnToken) ||
      uri == null ||
      uri.scheme != 'https' ||
      uri.host != 'app.bitestar.app' ||
      uri.path != '/' ||
      uri.hasQuery ||
      uri.userInfo.isNotEmpty ||
      uri.hasPort ||
      uri.fragment !=
          '$subscriptionReturnWebRoutePrefix${kind.name}'
              '?$subscriptionReturnTokenQueryParameter=$returnToken' ||
      uri.toString() != rawLocation) {
    return null;
  }
  return SubscriptionReturnLink(kind: kind, returnToken: returnToken);
}

String subscriptionReturnUri({
  required SubscriptionReturnKind kind,
  required String returnToken,
}) {
  if (!isValidSubscriptionReturnToken(returnToken)) {
    throw ArgumentError('A valid subscription return token is required.');
  }
  final baseUri = switch (kind) {
    SubscriptionReturnKind.checkoutSuccess =>
      subscriptionCheckoutSuccessReturnUri,
    SubscriptionReturnKind.checkoutCancel =>
      subscriptionCheckoutCancelReturnUri,
    SubscriptionReturnKind.customerPortal => subscriptionPortalReturnUri,
  };
  return '$baseUri?$subscriptionReturnTokenQueryParameter=$returnToken';
}

String subscriptionReturnWebLocation({
  required SubscriptionReturnKind kind,
  required String returnToken,
}) {
  if (!isValidSubscriptionReturnToken(returnToken)) {
    throw ArgumentError('A valid subscription return token is required.');
  }
  return '$subscriptionReturnWebOrigin/#$subscriptionReturnWebRoutePrefix'
      '${kind.name}?$subscriptionReturnTokenQueryParameter=$returnToken';
}

@immutable
class SubscriptionReturnRefreshCandidate {
  final SubscriptionReturnEvent event;
  final Future<bool>? coalescedLifecycleRefresh;

  const SubscriptionReturnRefreshCandidate({
    required this.event,
    required this.coalescedLifecycleRefresh,
  });
}

class SubscriptionReturnCoordinator {
  final SubscriptionReturnInboxStore _inboxStore;
  final SubscriptionReturnServerClient _serverClient;
  final StreamController<Uri> _appLinkController =
      StreamController<Uri>.broadcast(sync: true);
  final StreamController<void> _changeController =
      StreamController<void>.broadcast(sync: true);
  final StreamController<SubscriptionReturnEvent> _eventController =
      StreamController<SubscriptionReturnEvent>.broadcast(sync: true);
  final Map<SubscriptionReturnOwnerScope, List<SubscriptionReturnEvent>>
  _serverEvents =
      <SubscriptionReturnOwnerScope, List<SubscriptionReturnEvent>>{};
  final Set<String> _announcedEventKeys = <String>{};
  final Map<String, Future<bool>?> _coalescedLifecycleRefreshes =
      <String, Future<bool>?>{};
  final Set<String> _activeReturnRefreshes = <String>{};

  StreamSubscription<Object?>? _appLinkSubscription;
  StreamSubscription<String>? _webLocationSubscription;
  bool _appLinkIngestionStarted = false;
  Future<void> _synchronizationTail = Future<void>.value();
  int _activeRestaurantHubCount = 0;
  Object? _restaurantHubLifecycleRefreshOwner;
  Future<bool>? _restaurantHubLifecycleRefreshCredit;
  Completer<bool>? _restaurantHubLifecycleRefreshReservation;
  bool _restaurantHubLifecycleRefreshReservationRegistered = false;
  bool _restaurantHubLifecycleIsResumed = false;
  final Map<SubscriptionReturnOwnerScope, Set<String>>
  _restaurantHubLifecycleRefreshSuppressions =
      <SubscriptionReturnOwnerScope, Set<String>>{};
  final Set<String> _successfulLocalReturnRefreshes = <String>{};

  SubscriptionReturnCoordinator({
    SubscriptionReturnInboxStore? inboxStore,
    SubscriptionReturnServerClient? serverClient,
  }) : _inboxStore = inboxStore ?? SubscriptionReturnInboxStore(),
       _serverClient =
           serverClient ?? SubscriptionReturnServerClient.production();

  Stream<Uri> get appLinks => _appLinkController.stream;

  Stream<void> get changes => _changeController.stream;

  Stream<SubscriptionReturnEvent> get events => _eventController.stream;

  bool get hasActiveRestaurantHub => _activeRestaurantHubCount > 0;

  bool get appLinkIngestionStarted => _appLinkIngestionStarted;

  void startAppLinkIngestion({
    Stream<Uri>? links,
    Stream<String>? rawLinks,
    String? initialWebLocation,
    Stream<String>? webLocations,
  }) {
    if (_appLinkIngestionStarted) {
      return;
    }
    assert(
      links == null || rawLinks == null,
      'Provide either parsed or raw app links, not both.',
    );
    _appLinkIngestionStarted = true;

    if (links != null) {
      _appLinkSubscription = links.listen(
        _ingestParsedAppLink,
        onError: (_) {},
      );
    } else {
      _appLinkSubscription = (rawLinks ?? AppLinks().stringLinkStream).listen(
        (rawUri) => unawaited(_ingestRawAppLink(rawUri)),
        onError: (_) {},
      );
    }

    final capturedWebLocation =
        initialWebLocation ?? captureInitialSubscriptionReturnWebLocation();
    if (capturedWebLocation != null) {
      unawaited(ingestWebReturnLocation(capturedWebLocation));
    }
    _webLocationSubscription =
        (webLocations ?? subscriptionReturnWebLocationChanges).listen(
          (location) => unawaited(ingestWebReturnLocation(location)),
          onError: (_) {},
        );
  }

  Future<bool> ingestReturnLink(String rawUri) async {
    final returnLink = parseSubscriptionReturnLink(rawUri);
    if (returnLink == null) {
      return false;
    }
    return _retainReturnLink(returnLink);
  }

  Future<bool> ingestWebReturnLocation(String rawLocation) async {
    final returnLink = parseSubscriptionReturnWebLocation(rawLocation);
    if (returnLink == null) {
      return false;
    }
    return _retainReturnLink(returnLink);
  }

  Future<SubscriptionReturnEvent?> peekPendingNavigationFor(
    SubscriptionReturnOwnerScope ownerScope, {
    bool Function()? isCurrent,
  }) async {
    final events = await _synchronizeForOwner(ownerScope, isCurrent: isCurrent);
    if (events == null) {
      return null;
    }
    return _firstWhereOrNull(events, (event) => !event.navigationClaimed);
  }

  Future<SubscriptionReturnEvent?> peekPendingRefreshFor(
    SubscriptionReturnOwnerScope ownerScope, {
    bool Function()? isCurrent,
  }) async {
    final events = await _synchronizeForOwner(ownerScope, isCurrent: isCurrent);
    if (events == null) {
      return null;
    }
    return _firstWhereOrNull(events, (event) => !event.refreshClaimed);
  }

  Future<SubscriptionReturnRefreshCandidate?> peekPendingRefreshCandidateFor(
    SubscriptionReturnOwnerScope ownerScope, {
    bool Function()? isCurrent,
  }) async {
    final event = await peekPendingRefreshFor(ownerScope, isCurrent: isCurrent);
    if (event == null) {
      return null;
    }
    return SubscriptionReturnRefreshCandidate(
      event: event,
      coalescedLifecycleRefresh: _coalescedLifecycleRefreshes[_eventKey(event)],
    );
  }

  Future<bool> hasPendingLocalDelivery() {
    return _inboxStore.containsPendingDelivery();
  }

  Future<bool> claimNavigationFor(
    String eventId,
    SubscriptionReturnOwnerScope ownerScope, {
    bool Function()? isCurrent,
  }) {
    return _claimEvent(
      eventId,
      ownerScope,
      SubscriptionReturnClaimType.navigation,
      isCurrent: isCurrent,
    );
  }

  Future<bool> claimRefreshFor(
    String eventId,
    SubscriptionReturnOwnerScope ownerScope, {
    bool Function()? isCurrent,
  }) async {
    final claimed = await _claimEvent(
      eventId,
      ownerScope,
      SubscriptionReturnClaimType.refresh,
      isCurrent: isCurrent,
    );
    if (claimed) {
      _activeReturnRefreshes.add(_eventKeyFor(ownerScope, eventId));
    } else {
      _retireRestaurantHubLifecycleRefreshSuppression(ownerScope, eventId);
      _coalescedLifecycleRefreshes.remove(_eventKeyFor(ownerScope, eventId));
    }
    return claimed;
  }

  Future<SubscriptionReturnEvent?> claimNextPendingNavigationFor(
    SubscriptionReturnOwnerScope ownerScope, {
    bool Function()? isCurrent,
  }) async {
    final event = await peekPendingNavigationFor(
      ownerScope,
      isCurrent: isCurrent,
    );
    if (event == null ||
        !await claimNavigationFor(event.id, ownerScope, isCurrent: isCurrent)) {
      return null;
    }
    return _claimGuardPasses(isCurrent) ? event : null;
  }

  Future<SubscriptionReturnRefreshCandidate?> claimNextPendingRefreshFor(
    SubscriptionReturnOwnerScope ownerScope, {
    bool Function()? isCurrent,
  }) async {
    final candidate = await peekPendingRefreshCandidateFor(
      ownerScope,
      isCurrent: isCurrent,
    );
    if (candidate == null ||
        !await claimRefreshFor(
          candidate.event.id,
          ownerScope,
          isCurrent: isCurrent,
        )) {
      return null;
    }
    return _claimGuardPasses(isCurrent) ? candidate : null;
  }

  void finishRefresh(
    SubscriptionReturnEvent event, {
    required bool refreshSucceeded,
  }) {
    final key = _eventKey(event);
    _activeReturnRefreshes.remove(key);
    _coalescedLifecycleRefreshes.remove(key);
    if (refreshSucceeded &&
        !_restaurantHubLifecycleIsResumed &&
        _restaurantHubLifecycleRefreshSuppressions[event.ownerScope]?.contains(
              key,
            ) ==
            true) {
      _successfulLocalReturnRefreshes.add(key);
    } else {
      _retireRestaurantHubLifecycleRefreshSuppression(
        event.ownerScope,
        event.id,
      );
    }
  }

  Future<int> pendingLocalDeliveryCount() async =>
      (await _inboxStore.load()).length;

  Future<int> pendingServerEventCount() async => _serverEvents.values.fold<int>(
    0,
    (total, events) => total + events.length,
  );

  Future<SubscriptionReturnInboxSnapshot> inboxSnapshot() {
    return _inboxStore.snapshot();
  }

  void registerRestaurantHub() {
    _activeRestaurantHubCount += 1;
  }

  void noteRestaurantHubMounted({required bool isResumed}) {
    if (isResumed) {
      _restaurantHubLifecycleIsResumed = true;
    }
  }

  void unregisterRestaurantHub() {
    if (_activeRestaurantHubCount > 0) {
      _activeRestaurantHubCount -= 1;
    }
  }

  bool claimRestaurantHubLifecycleRefresh(Object owner) {
    if (_restaurantHubLifecycleIsResumed) {
      return false;
    }
    _restaurantHubLifecycleIsResumed = true;
    _retireRestaurantHubLifecycleRefreshReservation();
    _restaurantHubLifecycleRefreshCredit = null;
    if (_restaurantHubLifecycleRefreshSuppressions.isNotEmpty) {
      _restaurantHubLifecycleRefreshSuppressions.clear();
      _successfulLocalReturnRefreshes.clear();
      return false;
    }
    if (_restaurantHubLifecycleRefreshOwner != null ||
        _activeReturnRefreshes.isNotEmpty) {
      return false;
    }
    _restaurantHubLifecycleRefreshOwner = owner;
    return true;
  }

  Future<bool> claimRestaurantHubLifecycleRefreshFor(
    Object owner,
    SubscriptionReturnOwnerScope ownerScope,
  ) async {
    if (!ownerScope.isValid ||
        await peekPendingRefreshFor(ownerScope) != null ||
        _restaurantHubLifecycleIsResumed) {
      return false;
    }
    _restaurantHubLifecycleIsResumed = true;
    _restaurantHubLifecycleRefreshCredit = null;
    if (_consumeRestaurantHubLifecycleRefreshSuppressions(ownerScope)) {
      return false;
    }
    if (_restaurantHubLifecycleRefreshOwner != null ||
        _activeReturnRefreshes.isNotEmpty) {
      return false;
    }
    _restaurantHubLifecycleRefreshOwner = owner;
    final reservation = Completer<bool>();
    _restaurantHubLifecycleRefreshReservation = reservation;
    _restaurantHubLifecycleRefreshReservationRegistered = false;
    _restaurantHubLifecycleRefreshCredit = reservation.future;
    if (await peekPendingRefreshFor(ownerScope) == null) {
      return true;
    }
    finishRestaurantHubLifecycleRefresh(owner);
    return false;
  }

  void noteRestaurantHubLifecycleNotResumed() {
    if (_restaurantHubLifecycleIsResumed) {
      _retireProvisionalRestaurantHubLifecycleRefreshSuppressions();
    }
    _restaurantHubLifecycleIsResumed = false;
    _retireRestaurantHubLifecycleRefreshReservation();
    _restaurantHubLifecycleRefreshCredit = null;
  }

  bool claimRestaurantHubReturnRetryForResume(
    SubscriptionReturnOwnerScope ownerScope,
  ) {
    if (!ownerScope.isValid || _restaurantHubLifecycleIsResumed) {
      return false;
    }
    _restaurantHubLifecycleIsResumed = true;
    _retireRestaurantHubLifecycleRefreshReservation();
    _restaurantHubLifecycleRefreshCredit = null;
    _consumeRestaurantHubLifecycleRefreshSuppressions(ownerScope);
    return true;
  }

  void registerRestaurantHubLifecycleRefresh(
    Object owner,
    Future<bool> refresh,
  ) {
    if (!identical(_restaurantHubLifecycleRefreshOwner, owner)) {
      return;
    }
    final reservation = _restaurantHubLifecycleRefreshReservation;
    if (reservation == null) {
      _restaurantHubLifecycleRefreshCredit = refresh;
      return;
    }
    _restaurantHubLifecycleRefreshReservationRegistered = true;
    unawaited(
      refresh.then<void>(
        (succeeded) {
          if (!reservation.isCompleted) {
            reservation.complete(succeeded);
          }
        },
        onError: (_, _) {
          if (!reservation.isCompleted) {
            reservation.complete(false);
          }
        },
      ),
    );
  }

  void finishRestaurantHubLifecycleRefresh(Object owner) {
    if (identical(_restaurantHubLifecycleRefreshOwner, owner)) {
      _restaurantHubLifecycleRefreshOwner = null;
      _retireRestaurantHubLifecycleRefreshReservation();
    }
  }

  Future<void> resetForTesting() async {
    final appLinkSubscription = _appLinkSubscription;
    final webLocationSubscription = _webLocationSubscription;
    _appLinkSubscription = null;
    _webLocationSubscription = null;
    _appLinkIngestionStarted = false;
    await appLinkSubscription?.cancel();
    await webLocationSubscription?.cancel();
    await _inboxStore.clear();
    _serverEvents.clear();
    _announcedEventKeys.clear();
    _activeRestaurantHubCount = 0;
    _restaurantHubLifecycleRefreshOwner = null;
    _retireRestaurantHubLifecycleRefreshReservation();
    _restaurantHubLifecycleRefreshCredit = null;
    _restaurantHubLifecycleIsResumed = false;
    _restaurantHubLifecycleRefreshSuppressions.clear();
    _successfulLocalReturnRefreshes.clear();
    _activeReturnRefreshes.clear();
    _coalescedLifecycleRefreshes.clear();
    _synchronizationTail = Future<void>.value();
  }

  Future<void> dispose() async {
    await _appLinkSubscription?.cancel();
    await _webLocationSubscription?.cancel();
    await disposeSubscriptionReturnWebLocationSource();
    await _appLinkController.close();
    await _changeController.close();
    await _eventController.close();
  }

  Future<void> _ingestRawAppLink(String rawUri) async {
    final uri = Uri.tryParse(rawUri);
    if (uri == null) {
      return;
    }
    await ingestReturnLink(rawUri);
    if (!_appLinkController.isClosed) {
      _appLinkController.add(uri);
    }
  }

  void _ingestParsedAppLink(Uri uri) {
    // Parsed Uris do not retain enough lexical information to prove exact
    // lowercase spelling, so only the exact raw stream ingests return tokens.
    if (!_appLinkController.isClosed) {
      _appLinkController.add(uri);
    }
  }

  Future<bool> _retainReturnLink(SubscriptionReturnLink returnLink) async {
    final result = await _inboxStore.add(
      returnToken: returnLink.returnToken,
      kind: returnLink.kind,
    );
    if (!result.isRetained) {
      return false;
    }
    if (!_changeController.isClosed) {
      _changeController.add(null);
    }
    return true;
  }

  Future<List<SubscriptionReturnEvent>?> _synchronizeForOwner(
    SubscriptionReturnOwnerScope ownerScope, {
    bool Function()? isCurrent,
  }) {
    return _serializedSynchronization(() async {
      if (!ownerScope.isValid || !_claimGuardPasses(isCurrent)) {
        return null;
      }

      final deliveries = await _inboxStore.load();
      for (final delivery in deliveries) {
        if (!_claimGuardPasses(isCurrent)) {
          return null;
        }
        try {
          await _serverClient.redeem(
            ownerScope: ownerScope,
            delivery: delivery,
          );
          // Both a newly created event and an already-consumed replay prove
          // that this local raw delivery is stale and safe to remove.
          await _inboxStore.remove(delivery);
        } on SubscriptionReturnServerException catch (error) {
          if (error.failure == SubscriptionReturnServerFailure.unavailable ||
              error.failure ==
                  SubscriptionReturnServerFailure.invalidResponse) {
            break;
          }
          // A neutral rejection may be a wrong owner/document. Retain the raw
          // delivery for a later authenticated scope without exposing why.
        }
      }

      if (!_claimGuardPasses(isCurrent)) {
        return null;
      }
      try {
        final events = await _serverClient.listPending(ownerScope: ownerScope);
        if (!_claimGuardPasses(isCurrent)) {
          return null;
        }
        _recordServerEvents(ownerScope, events);
        return events;
      } on SubscriptionReturnServerException {
        return null;
      }
    });
  }

  void _recordServerEvents(
    SubscriptionReturnOwnerScope ownerScope,
    List<SubscriptionReturnEvent> events,
  ) {
    final previousEvents = _serverEvents[ownerScope];
    _serverEvents[ownerScope] = List<SubscriptionReturnEvent>.of(events);
    final returnedKeys = <String>{for (final event in events) _eventKey(event)};
    if (previousEvents != null) {
      for (final previousEvent in previousEvents) {
        final key = _eventKey(previousEvent);
        if (!returnedKeys.contains(key) &&
            !_activeReturnRefreshes.contains(key) &&
            !_successfulLocalReturnRefreshes.contains(key)) {
          _retireRestaurantHubLifecycleRefreshSuppression(
            ownerScope,
            previousEvent.id,
          );
          _coalescedLifecycleRefreshes.remove(key);
        }
      }
    }
    for (final event in events) {
      final key = _eventKey(event);
      if (event.refreshClaimed &&
          !_activeReturnRefreshes.contains(key) &&
          !_successfulLocalReturnRefreshes.contains(key)) {
        _retireRestaurantHubLifecycleRefreshSuppression(ownerScope, event.id);
        _coalescedLifecycleRefreshes.remove(key);
      }
      if (!_announcedEventKeys.add(key)) {
        continue;
      }
      if (!event.refreshClaimed) {
        if (!_restaurantHubLifecycleIsResumed) {
          _restaurantHubLifecycleRefreshSuppressions
              .putIfAbsent(ownerScope, () => <String>{})
              .add(key);
        }
        final lifecycleRefresh = _restaurantHubLifecycleRefreshCredit;
        _restaurantHubLifecycleRefreshCredit = null;
        _coalescedLifecycleRefreshes[key] = lifecycleRefresh;
      }
      if (!_eventController.isClosed) {
        _eventController.add(event);
      }
      if (!_changeController.isClosed) {
        _changeController.add(null);
      }
    }
  }

  Future<bool> _claimEvent(
    String eventId,
    SubscriptionReturnOwnerScope ownerScope,
    SubscriptionReturnClaimType claimType, {
    bool Function()? isCurrent,
  }) async {
    if (!isValidSubscriptionReturnEventId(eventId) ||
        !ownerScope.isValid ||
        !_claimGuardPasses(isCurrent)) {
      return false;
    }
    final events = _serverEvents[ownerScope];
    final event = events == null
        ? null
        : _firstWhereOrNull(events, (candidate) => candidate.id == eventId);
    if (event == null) {
      return false;
    }
    try {
      final result = await _serverClient.claim(
        ownerScope: ownerScope,
        eventId: eventId,
        claimType: claimType,
      );
      if (result.kind != event.kind) {
        return false;
      }
      _markCachedClaim(ownerScope, eventId, claimType);
      if (!result.claimed || !_claimGuardPasses(isCurrent)) {
        return false;
      }
      return true;
    } on SubscriptionReturnServerException {
      return false;
    }
  }

  void _markCachedClaim(
    SubscriptionReturnOwnerScope ownerScope,
    String eventId,
    SubscriptionReturnClaimType claimType,
  ) {
    final events = _serverEvents[ownerScope];
    if (events == null) {
      return;
    }
    final index = events.indexWhere((event) => event.id == eventId);
    if (index < 0) {
      return;
    }
    final event = events[index];
    final updated = switch (claimType) {
      SubscriptionReturnClaimType.navigation => event.copyWith(
        navigationClaimed: true,
      ),
      SubscriptionReturnClaimType.refresh => event.copyWith(
        refreshClaimed: true,
      ),
    };
    if (updated.navigationClaimed && updated.refreshClaimed) {
      events.removeAt(index);
    } else {
      events[index] = updated;
    }
  }

  Future<T> _serializedSynchronization<T>(Future<T> Function() operation) {
    final previous = _synchronizationTail;
    final completion = Completer<void>.sync();
    _synchronizationTail = completion.future;
    return () async {
      try {
        await previous;
        return await operation();
      } finally {
        completion.complete();
      }
    }();
  }

  bool _claimGuardPasses(bool Function()? isCurrent) {
    if (isCurrent == null) {
      return true;
    }
    try {
      return isCurrent();
    } catch (_) {
      return false;
    }
  }

  void _retireRestaurantHubLifecycleRefreshReservation() {
    final reservation = _restaurantHubLifecycleRefreshReservation;
    if (reservation != null &&
        !_restaurantHubLifecycleRefreshReservationRegistered &&
        !reservation.isCompleted) {
      reservation.complete(false);
    }
    _restaurantHubLifecycleRefreshReservation = null;
    _restaurantHubLifecycleRefreshReservationRegistered = false;
  }

  bool _consumeRestaurantHubLifecycleRefreshSuppressions(
    SubscriptionReturnOwnerScope ownerScope,
  ) {
    final eventKeys = _restaurantHubLifecycleRefreshSuppressions.remove(
      ownerScope,
    );
    if (eventKeys != null) {
      _successfulLocalReturnRefreshes.removeAll(eventKeys);
    }
    return eventKeys != null && eventKeys.isNotEmpty;
  }

  void _retireRestaurantHubLifecycleRefreshSuppression(
    SubscriptionReturnOwnerScope ownerScope,
    String eventId,
  ) {
    final eventKeys = _restaurantHubLifecycleRefreshSuppressions[ownerScope];
    if (eventKeys == null) {
      return;
    }
    final eventKey = _eventKeyFor(ownerScope, eventId);
    eventKeys.remove(eventKey);
    _successfulLocalReturnRefreshes.remove(eventKey);
    if (eventKeys.isEmpty) {
      _restaurantHubLifecycleRefreshSuppressions.remove(ownerScope);
    }
  }

  void _retireProvisionalRestaurantHubLifecycleRefreshSuppressions() {
    final retainedSuccessfulKeys = <String>{};
    _restaurantHubLifecycleRefreshSuppressions.removeWhere((_, eventKeys) {
      eventKeys.retainWhere(_successfulLocalReturnRefreshes.contains);
      retainedSuccessfulKeys.addAll(eventKeys);
      return eventKeys.isEmpty;
    });
    _successfulLocalReturnRefreshes.retainAll(retainedSuccessfulKeys);
  }
}

class SubscriptionReturnService {
  static SubscriptionReturnCoordinator? _coordinatorInstance;

  static SubscriptionReturnCoordinator get _coordinator =>
      _coordinatorInstance ??= SubscriptionReturnCoordinator();

  static Stream<Uri> get appLinks => _coordinator.appLinks;

  static Stream<void> get changes => _coordinator.changes;

  static Stream<SubscriptionReturnEvent> get events => _coordinator.events;

  static bool get hasActiveRestaurantHub => _coordinator.hasActiveRestaurantHub;

  static bool get appLinkIngestionStarted =>
      _coordinator.appLinkIngestionStarted;

  static int get maxPendingEvents => subscriptionReturnPendingEventCapacity;

  static Future<int> get pendingLocalDeliveryCount =>
      _coordinator.pendingLocalDeliveryCount();

  @visibleForTesting
  static Future<int> get pendingEventCount =>
      _coordinator.pendingServerEventCount();

  static void startAppLinkIngestion({
    Stream<Uri>? links,
    Stream<String>? rawLinks,
    String? initialWebLocation,
    Stream<String>? webLocations,
  }) {
    _coordinator.startAppLinkIngestion(
      links: links,
      rawLinks: rawLinks,
      initialWebLocation: initialWebLocation,
      webLocations: webLocations,
    );
  }

  static Future<bool> ingestReturnLink(String rawUri) {
    return _coordinator.ingestReturnLink(rawUri);
  }

  static Future<bool> ingestWebReturnLocation(String rawLocation) {
    return _coordinator.ingestWebReturnLocation(rawLocation);
  }

  static Future<SubscriptionReturnEvent?> peekPendingNavigationFor(
    SubscriptionReturnOwnerScope ownerScope, {
    bool Function()? isCurrent,
  }) {
    return _coordinator.peekPendingNavigationFor(
      ownerScope,
      isCurrent: isCurrent,
    );
  }

  static Future<SubscriptionReturnEvent?> peekPendingRefreshFor(
    SubscriptionReturnOwnerScope ownerScope, {
    bool Function()? isCurrent,
  }) {
    return _coordinator.peekPendingRefreshFor(ownerScope, isCurrent: isCurrent);
  }

  static Future<SubscriptionReturnRefreshCandidate?>
  peekPendingRefreshCandidateFor(
    SubscriptionReturnOwnerScope ownerScope, {
    bool Function()? isCurrent,
  }) {
    return _coordinator.peekPendingRefreshCandidateFor(
      ownerScope,
      isCurrent: isCurrent,
    );
  }

  static Future<bool> hasPendingLocalDelivery() {
    return _coordinator.hasPendingLocalDelivery();
  }

  static Future<bool> claimNavigationFor(
    String eventId,
    SubscriptionReturnOwnerScope ownerScope, {
    bool Function()? isCurrent,
  }) {
    return _coordinator.claimNavigationFor(
      eventId,
      ownerScope,
      isCurrent: isCurrent,
    );
  }

  static Future<bool> claimRefreshFor(
    String eventId,
    SubscriptionReturnOwnerScope ownerScope, {
    bool Function()? isCurrent,
  }) {
    return _coordinator.claimRefreshFor(
      eventId,
      ownerScope,
      isCurrent: isCurrent,
    );
  }

  static Future<SubscriptionReturnEvent?> claimNextPendingNavigationFor(
    SubscriptionReturnOwnerScope ownerScope, {
    bool Function()? isCurrent,
  }) {
    return _coordinator.claimNextPendingNavigationFor(
      ownerScope,
      isCurrent: isCurrent,
    );
  }

  static Future<SubscriptionReturnRefreshCandidate?> claimNextPendingRefreshFor(
    SubscriptionReturnOwnerScope ownerScope, {
    bool Function()? isCurrent,
  }) {
    return _coordinator.claimNextPendingRefreshFor(
      ownerScope,
      isCurrent: isCurrent,
    );
  }

  static void finishRefresh(
    SubscriptionReturnEvent event, {
    required bool refreshSucceeded,
  }) {
    _coordinator.finishRefresh(event, refreshSucceeded: refreshSucceeded);
  }

  static Future<SubscriptionReturnInboxSnapshot> inboxSnapshot() {
    return _coordinator.inboxSnapshot();
  }

  static void registerRestaurantHub() {
    _coordinator.registerRestaurantHub();
  }

  static void noteRestaurantHubMounted({required bool isResumed}) {
    _coordinator.noteRestaurantHubMounted(isResumed: isResumed);
  }

  static void unregisterRestaurantHub() {
    _coordinator.unregisterRestaurantHub();
  }

  static bool claimRestaurantHubLifecycleRefresh(Object owner) {
    return _coordinator.claimRestaurantHubLifecycleRefresh(owner);
  }

  static Future<bool> claimRestaurantHubLifecycleRefreshFor(
    Object owner,
    SubscriptionReturnOwnerScope ownerScope,
  ) {
    return _coordinator.claimRestaurantHubLifecycleRefreshFor(
      owner,
      ownerScope,
    );
  }

  static void noteRestaurantHubLifecycleNotResumed() {
    _coordinator.noteRestaurantHubLifecycleNotResumed();
  }

  static bool claimRestaurantHubReturnRetryForResume(
    SubscriptionReturnOwnerScope ownerScope,
  ) {
    return _coordinator.claimRestaurantHubReturnRetryForResume(ownerScope);
  }

  static void registerRestaurantHubLifecycleRefresh(
    Object owner,
    Future<bool> refresh,
  ) {
    _coordinator.registerRestaurantHubLifecycleRefresh(owner, refresh);
  }

  static void finishRestaurantHubLifecycleRefresh(Object owner) {
    _coordinator.finishRestaurantHubLifecycleRefresh(owner);
  }

  @visibleForTesting
  static Future<void> installForTesting({
    required SubscriptionReturnInboxStore inboxStore,
    required SubscriptionReturnServerClient serverClient,
  }) async {
    await _coordinatorInstance?.dispose();
    _coordinatorInstance = SubscriptionReturnCoordinator(
      inboxStore: inboxStore,
      serverClient: serverClient,
    );
  }

  @visibleForTesting
  static Future<void> resetForTesting() {
    return _coordinator.resetForTesting();
  }
}

T? _firstWhereOrNull<T>(Iterable<T> values, bool Function(T value) matches) {
  for (final value in values) {
    if (matches(value)) {
      return value;
    }
  }
  return null;
}

String _eventKey(SubscriptionReturnEvent event) {
  return _eventKeyFor(event.ownerScope, event.id);
}

String _eventKeyFor(SubscriptionReturnOwnerScope ownerScope, String eventId) {
  return '${ownerScope.uid}\u0000${ownerScope.accountDocumentId}\u0000$eventId';
}
