import 'dart:async';
import 'dart:collection';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

const String stripeCustomerPortalReturnUrl =
    'https://app.bitestar.app/subscription/portal-return';
const String subscriptionCheckoutSuccessReturnUri =
    'bitesaver://subscription-success';
const String subscriptionCheckoutCancelReturnUri =
    'bitesaver://subscription-cancel';
const String subscriptionPortalReturnUri =
    'bitesaver://subscription-portal-return';

enum SubscriptionReturnKind { checkoutSuccess, checkoutCancel, customerPortal }

SubscriptionReturnKind? parseSubscriptionReturnUri(Uri uri) {
  if (_matchesExactSubscriptionReturnUri(
    uri,
    canonicalUri: subscriptionCheckoutSuccessReturnUri,
    host: 'subscription-success',
  )) {
    return SubscriptionReturnKind.checkoutSuccess;
  }

  if (_matchesExactSubscriptionReturnUri(
    uri,
    canonicalUri: subscriptionCheckoutCancelReturnUri,
    host: 'subscription-cancel',
  )) {
    return SubscriptionReturnKind.checkoutCancel;
  }

  if (_matchesExactSubscriptionReturnUri(
    uri,
    canonicalUri: subscriptionPortalReturnUri,
    host: 'subscription-portal-return',
  )) {
    return SubscriptionReturnKind.customerPortal;
  }

  return _parseLegacySubscriptionReturnUri(uri);
}

SubscriptionReturnKind? parseSubscriptionReturnLink(String rawUri) {
  if (_matchesExactRawSubscriptionReturnUri(
    rawUri,
    subscriptionCheckoutSuccessReturnUri,
  )) {
    return SubscriptionReturnKind.checkoutSuccess;
  }
  if (_matchesExactRawSubscriptionReturnUri(
    rawUri,
    subscriptionCheckoutCancelReturnUri,
  )) {
    return SubscriptionReturnKind.checkoutCancel;
  }
  if (_matchesExactRawSubscriptionReturnUri(
    rawUri,
    subscriptionPortalReturnUri,
  )) {
    return SubscriptionReturnKind.customerPortal;
  }

  final uri = Uri.tryParse(rawUri);
  return uri == null ? null : _parseLegacySubscriptionReturnUri(uri);
}

SubscriptionReturnKind? _parseLegacySubscriptionReturnUri(Uri uri) {
  if (uri.scheme != 'couponapp' || uri.host != 'subscription-return') {
    return null;
  }
  final status = uri.queryParameters['status']?.trim().toLowerCase();
  if (status == 'success') {
    return SubscriptionReturnKind.checkoutSuccess;
  }
  if (status == 'cancel') {
    return SubscriptionReturnKind.checkoutCancel;
  }
  return null;
}

bool _matchesExactRawSubscriptionReturnUri(String rawUri, String canonicalUri) {
  return rawUri == canonicalUri;
}

bool _matchesExactSubscriptionReturnUri(
  Uri uri, {
  required String canonicalUri,
  required String host,
}) {
  return uri.scheme == 'bitesaver' &&
      uri.host == host &&
      uri.path.isEmpty &&
      !uri.hasQuery &&
      !uri.hasFragment &&
      uri.userInfo.isEmpty &&
      !uri.hasPort &&
      uri.toString() == canonicalUri;
}

class SubscriptionReturnEvent {
  final int id;
  final SubscriptionReturnKind kind;

  const SubscriptionReturnEvent({required this.id, required this.kind});
}

class SubscriptionReturnRefreshCandidate {
  final SubscriptionReturnEvent event;
  final Future<bool>? coalescedLifecycleRefresh;

  const SubscriptionReturnRefreshCandidate({
    required this.event,
    required this.coalescedLifecycleRefresh,
  });
}

class _PendingSubscriptionReturn {
  final SubscriptionReturnEvent event;
  final Future<bool>? coalescedLifecycleRefresh;
  bool navigationClaimed = false;
  bool refreshClaimed = false;

  _PendingSubscriptionReturn(
    this.event, {
    required this.coalescedLifecycleRefresh,
  });
}

class SubscriptionReturnService {
  static const String restaurantHubContext = 'restaurant_hub';
  static const String _pendingReturnContextKey =
      'pending_subscription_return_context';
  static const int _maxPendingEvents = 32;

  static final StreamController<Uri> _appLinkController =
      StreamController<Uri>.broadcast(sync: true);
  static final StreamController<SubscriptionReturnEvent> _eventController =
      StreamController<SubscriptionReturnEvent>.broadcast(sync: true);
  static final LinkedHashMap<int, _PendingSubscriptionReturn> _pendingEvents =
      LinkedHashMap<int, _PendingSubscriptionReturn>();

  static int _nextEventId = 0;
  static int _activeRestaurantHubCount = 0;
  static StreamSubscription<Object?>? _appLinkSubscription;
  static bool _appLinkIngestionStarted = false;

  // A platform resume and its app link may arrive in either order. Keep one
  // app-wide refresh credit for that lifecycle episode so the return consumes
  // the existing attempt instead of issuing a duplicate account read.
  static Object? _restaurantHubLifecycleRefreshOwner;
  static Future<bool>? _restaurantHubLifecycleRefreshCredit;
  static bool _restaurantHubLifecycleIsResumed = false;
  static bool _skipNextRestaurantHubLifecycleRefresh = false;
  static final Set<int> _activeReturnRefreshes = <int>{};

  static Stream<Uri> get appLinks => _appLinkController.stream;
  static Stream<SubscriptionReturnEvent> get events => _eventController.stream;

  static bool get hasActiveRestaurantHub => _activeRestaurantHubCount > 0;

  static void startAppLinkIngestion({
    Stream<Uri>? links,
    Stream<String>? rawLinks,
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
      _appLinkSubscription = links.listen(_ingestAppLink, onError: (_) {});
      return;
    }

    _appLinkSubscription = (rawLinks ?? AppLinks().stringLinkStream).listen(
      _ingestRawAppLink,
      onError: (_) {},
    );
  }

  static void _ingestRawAppLink(String rawUri) {
    final uri = Uri.tryParse(rawUri);
    if (uri == null) {
      return;
    }
    _ingestClassifiedAppLink(
      uri,
      returnKind: parseSubscriptionReturnLink(rawUri),
    );
  }

  static void _ingestAppLink(Uri uri) {
    _ingestClassifiedAppLink(uri, returnKind: parseSubscriptionReturnUri(uri));
  }

  static void _ingestClassifiedAppLink(
    Uri uri, {
    required SubscriptionReturnKind? returnKind,
  }) {
    if (returnKind != null) {
      _tryCreateEvent(returnKind);
      unawaited(clearPendingReturnContext().onError((_, _) {}));
    }
    _appLinkController.add(uri);
  }

  static void registerRestaurantHub() {
    _activeRestaurantHubCount += 1;
  }

  static void noteRestaurantHubMounted({required bool isResumed}) {
    if (isResumed) {
      _restaurantHubLifecycleIsResumed = true;
    }
  }

  static void unregisterRestaurantHub() {
    if (_activeRestaurantHubCount == 0) {
      return;
    }
    _activeRestaurantHubCount -= 1;
  }

  static Future<void> markRestaurantHubCheckoutStarted() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_pendingReturnContextKey, restaurantHubContext);
  }

  static Future<String?> pendingReturnContext() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_pendingReturnContextKey);
  }

  static Future<void> clearPendingReturnContext() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_pendingReturnContextKey);
  }

  static Future<SubscriptionReturnEvent?> dispatchReturn(
    SubscriptionReturnKind kind,
  ) async {
    final event = _tryCreateEvent(kind);
    await clearPendingReturnContext();
    return event;
  }

  static SubscriptionReturnEvent? _tryCreateEvent(SubscriptionReturnKind kind) {
    if (_pendingEvents.length >= _maxPendingEvents) {
      // Every retained record still owns at least one unclaimed obligation.
      // Preserve those records and decline only this exceptional overflow
      // delivery; a later delivery can be accepted after capacity is released.
      return null;
    }

    final event = SubscriptionReturnEvent(id: _nextEventId++, kind: kind);
    if (!_restaurantHubLifecycleIsResumed) {
      _skipNextRestaurantHubLifecycleRefresh = true;
    }
    final lifecycleRefresh = _restaurantHubLifecycleRefreshCredit;
    _restaurantHubLifecycleRefreshCredit = null;
    _pendingEvents[event.id] = _PendingSubscriptionReturn(
      event,
      coalescedLifecycleRefresh: lifecycleRefresh,
    );
    _eventController.add(event);
    return event;
  }

  static SubscriptionReturnEvent? peekPendingNavigation() {
    for (final pending in _pendingEvents.values) {
      if (!pending.navigationClaimed) {
        return pending.event;
      }
    }
    return null;
  }

  static SubscriptionReturnEvent? peekPendingRefresh() {
    for (final pending in _pendingEvents.values) {
      if (!pending.refreshClaimed) {
        return pending.event;
      }
    }
    return null;
  }

  static SubscriptionReturnEvent? claimNextPendingNavigation() {
    final event = peekPendingNavigation();
    if (event == null || !claimNavigation(event.id)) {
      return null;
    }
    return event;
  }

  static SubscriptionReturnRefreshCandidate? peekPendingRefreshCandidate() {
    final event = peekPendingRefresh();
    if (event == null) {
      return null;
    }
    final lifecycleRefresh =
        _pendingEvents[event.id]?.coalescedLifecycleRefresh;
    return SubscriptionReturnRefreshCandidate(
      event: event,
      coalescedLifecycleRefresh: lifecycleRefresh,
    );
  }

  static bool claimNavigation(int eventId) {
    final pending = _pendingEvents[eventId];
    if (pending == null || pending.navigationClaimed) {
      return false;
    }

    pending.navigationClaimed = true;
    _removeIfComplete(eventId, pending);
    return true;
  }

  static bool claimRefresh(int eventId) {
    final pending = _pendingEvents[eventId];
    if (pending == null || pending.refreshClaimed) {
      return false;
    }

    pending.refreshClaimed = true;
    _activeReturnRefreshes.add(eventId);
    _removeIfComplete(eventId, pending);
    return true;
  }

  static void finishRefresh(int eventId) {
    _activeReturnRefreshes.remove(eventId);
  }

  static bool claimRestaurantHubLifecycleRefresh(Object owner) {
    if (_restaurantHubLifecycleIsResumed) {
      return false;
    }

    _restaurantHubLifecycleIsResumed = true;
    _restaurantHubLifecycleRefreshCredit = null;
    if (_skipNextRestaurantHubLifecycleRefresh) {
      _skipNextRestaurantHubLifecycleRefresh = false;
      return false;
    }
    if (_restaurantHubLifecycleRefreshOwner != null ||
        peekPendingRefresh() != null ||
        _activeReturnRefreshes.isNotEmpty) {
      return false;
    }

    _restaurantHubLifecycleRefreshOwner = owner;
    return true;
  }

  static void noteRestaurantHubLifecycleNotResumed() {
    if (_restaurantHubLifecycleIsResumed) {
      _skipNextRestaurantHubLifecycleRefresh = false;
    }
    _restaurantHubLifecycleIsResumed = false;
    _restaurantHubLifecycleRefreshCredit = null;
  }

  static void registerRestaurantHubLifecycleRefresh(
    Object owner,
    Future<bool> refresh,
  ) {
    if (identical(_restaurantHubLifecycleRefreshOwner, owner)) {
      _restaurantHubLifecycleRefreshCredit = refresh;
    }
  }

  static void finishRestaurantHubLifecycleRefresh(Object owner) {
    if (!identical(_restaurantHubLifecycleRefreshOwner, owner)) {
      return;
    }

    _restaurantHubLifecycleRefreshOwner = null;
  }

  static void _removeIfComplete(
    int eventId,
    _PendingSubscriptionReturn pending,
  ) {
    if (pending.navigationClaimed && pending.refreshClaimed) {
      _pendingEvents.remove(eventId);
    }
  }

  @visibleForTesting
  static int get pendingEventCount => _pendingEvents.length;

  @visibleForTesting
  static int get maxPendingEvents => _maxPendingEvents;

  @visibleForTesting
  static bool get appLinkIngestionStarted => _appLinkIngestionStarted;

  @visibleForTesting
  static Future<void> resetForTesting() async {
    final subscription = _appLinkSubscription;
    _appLinkSubscription = null;
    _appLinkIngestionStarted = false;
    await subscription?.cancel();
    _nextEventId = 0;
    _activeRestaurantHubCount = 0;
    _pendingEvents.clear();
    _restaurantHubLifecycleRefreshOwner = null;
    _restaurantHubLifecycleRefreshCredit = null;
    _restaurantHubLifecycleIsResumed = false;
    _skipNextRestaurantHubLifecycleRefresh = false;
    _activeReturnRefreshes.clear();
  }
}
