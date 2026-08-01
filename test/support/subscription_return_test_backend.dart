import 'dart:async';

import 'package:coupon_app/services/subscription_return_server_client.dart';
import 'package:coupon_app/services/subscription_return_service.dart';

class MemorySubscriptionReturnInboxPersistence
    implements SubscriptionReturnInboxPersistence {
  String? value;
  bool failRead = false;
  bool failWrite = false;
  bool failRemove = false;

  @override
  Future<String?> read() async {
    if (failRead) {
      throw StateError('read failed');
    }
    return value;
  }

  @override
  Future<void> write(String nextValue) async {
    if (failWrite) {
      throw StateError('write failed');
    }
    value = nextValue;
  }

  @override
  Future<void> remove() async {
    if (failRemove) {
      throw StateError('remove failed');
    }
    value = null;
  }
}

class FakeSubscriptionReturnBackend {
  final DateTime Function() clock;
  final Map<String, _FakeContext> _contexts = <String, _FakeContext>{};
  final Map<String, List<_FakeEvent>> _events = <String, List<_FakeEvent>>{};
  final Map<String, int> _nextEventIds = <String, int>{};

  bool failRedeem = false;
  bool failList = false;
  bool failClaim = false;
  int remainingClaimFailures = 0;
  Completer<void>? claimStarted;
  Completer<void>? releaseClaim;
  void Function()? afterNextListResponse;
  int redeemCalls = 0;
  int listCalls = 0;
  int claimCalls = 0;
  String? authenticatedUid;

  FakeSubscriptionReturnBackend({DateTime Function()? clock})
    : clock = clock ?? (() => DateTime.now().toUtc());

  void reserve({
    required String returnToken,
    required SubscriptionReturnOwnerScope ownerScope,
    required SubscriptionReturnFamily family,
  }) {
    authenticatedUid ??= ownerScope.uid;
    _contexts[returnToken] = _FakeContext(
      ownerScope: ownerScope,
      family: family,
    );
  }

  void addPendingEvent({
    required SubscriptionReturnOwnerScope ownerScope,
    required String eventId,
    required SubscriptionReturnKind kind,
    bool navigationClaimed = false,
    bool refreshClaimed = false,
  }) {
    authenticatedUid ??= ownerScope.uid;
    final events = _events.putIfAbsent(
      _scopeKey(ownerScope),
      () => <_FakeEvent>[],
    );
    events.add(
      _FakeEvent(
        id: eventId,
        kind: kind,
        expiresAt: clock().toUtc().add(const Duration(hours: 1)),
        navigationClaimed: navigationClaimed,
        refreshClaimed: refreshClaimed,
      ),
    );
    final parsed = int.parse(eventId);
    final next = _nextEventIds[_scopeKey(ownerScope)] ?? 1;
    if (parsed >= next) {
      _nextEventIds[_scopeKey(ownerScope)] = parsed + 1;
    }
  }

  int eventCountFor(SubscriptionReturnOwnerScope ownerScope) =>
      _events[_scopeKey(ownerScope)]?.length ?? 0;

  void markRefreshClaimed({
    required SubscriptionReturnOwnerScope ownerScope,
    required String eventId,
  }) {
    final events = _events[_scopeKey(ownerScope)] ?? <_FakeEvent>[];
    for (final event in events) {
      if (event.id == eventId) {
        event.refreshClaimed = true;
        return;
      }
    }
    throw StateError('unknown synthetic event');
  }

  Future<Object?> invoke(
    String callableName,
    Map<String, Object?> payload,
  ) async {
    switch (callableName) {
      case redeemSubscriptionReturnCallableName:
        return _redeem(payload);
      case listSubscriptionReturnEventsCallableName:
        return _list(payload);
      case claimSubscriptionReturnEventCallableName:
        return _claim(payload);
      default:
        throw StateError('unexpected callable');
    }
  }

  Future<Object?> _redeem(Map<String, Object?> payload) async {
    redeemCalls += 1;
    if (failRedeem) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.unavailable,
      );
    }
    final token = payload['returnToken'];
    final documentId = payload['restaurantAccountDocumentId'];
    final rawKind = payload['returnKind'];
    if (token is! String || documentId is! String || rawKind is! String) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.rejected,
      );
    }
    final context = _contexts[token];
    final kind = subscriptionReturnKindFromName(rawKind);
    if (context == null ||
        kind == null ||
        context.ownerScope.uid != authenticatedUid ||
        context.ownerScope.accountDocumentId != documentId ||
        context.family != kind.family) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.rejected,
      );
    }
    final existingId = context.eventId;
    if (existingId != null) {
      return <String, Object?>{
        'returnProtocolVersion': 2,
        'created': false,
        'eventId': existingId,
        'returnKind': kind.name,
      };
    }
    final scopeKey = _scopeKey(context.ownerScope);
    final nextId = _nextEventIds[scopeKey] ?? 1;
    _nextEventIds[scopeKey] = nextId + 1;
    final eventId = '$nextId';
    context.eventId = eventId;
    _events
        .putIfAbsent(scopeKey, () => <_FakeEvent>[])
        .add(
          _FakeEvent(
            id: eventId,
            kind: kind,
            expiresAt: clock().toUtc().add(const Duration(hours: 1)),
          ),
        );
    return <String, Object?>{
      'returnProtocolVersion': 2,
      'created': true,
      'eventId': eventId,
      'returnKind': kind.name,
    };
  }

  Future<Object?> _list(Map<String, Object?> payload) async {
    listCalls += 1;
    if (failList) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.unavailable,
      );
    }
    final documentId = payload['restaurantAccountDocumentId'];
    if (documentId is! String) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.rejected,
      );
    }
    final entries =
        _events['${authenticatedUid ?? ''}\u0000$documentId'] ?? <_FakeEvent>[];
    entries.removeWhere(
      (event) => event.navigationClaimed && event.refreshClaimed,
    );
    entries.sort(
      (first, second) => int.parse(first.id).compareTo(int.parse(second.id)),
    );
    final response = <String, Object?>{
      'returnProtocolVersion': 2,
      'events': <Object?>[
        for (final event in entries)
          <String, Object?>{
            'eventId': event.id,
            'returnKind': event.kind.name,
            'navigationClaimed': event.navigationClaimed,
            'refreshClaimed': event.refreshClaimed,
            'expiresAtEpochMs': event.expiresAt.millisecondsSinceEpoch,
          },
      ],
    };
    final afterResponse = afterNextListResponse;
    afterNextListResponse = null;
    afterResponse?.call();
    return response;
  }

  Future<Object?> _claim(Map<String, Object?> payload) async {
    claimCalls += 1;
    final started = claimStarted;
    if (started != null && !started.isCompleted) {
      started.complete();
    }
    await releaseClaim?.future;
    if (failClaim || remainingClaimFailures > 0) {
      if (remainingClaimFailures > 0) {
        remainingClaimFailures -= 1;
      }
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.unavailable,
      );
    }
    final documentId = payload['restaurantAccountDocumentId'];
    final eventId = payload['eventId'];
    final rawClaimType = payload['claimType'];
    if (documentId is! String ||
        eventId is! String ||
        rawClaimType is! String) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.rejected,
      );
    }
    _FakeEvent? event;
    final scopedEvents =
        _events['${authenticatedUid ?? ''}\u0000$documentId'] ?? <_FakeEvent>[];
    for (final candidate in scopedEvents) {
      if (candidate.id == eventId) {
        event = candidate;
        break;
      }
    }
    if (event == null) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.rejected,
      );
    }
    late final bool claimed;
    if (rawClaimType == SubscriptionReturnClaimType.navigation.name) {
      claimed = !event.navigationClaimed;
      event.navigationClaimed = true;
    } else if (rawClaimType == SubscriptionReturnClaimType.refresh.name) {
      claimed = !event.refreshClaimed;
      event.refreshClaimed = true;
    } else {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.rejected,
      );
    }
    return <String, Object?>{
      'returnProtocolVersion': 2,
      'claimed': claimed,
      'eventId': event.id,
      'returnKind': event.kind.name,
    };
  }
}

Future<MemorySubscriptionReturnInboxPersistence>
installFakeSubscriptionReturnService(
  FakeSubscriptionReturnBackend backend, {
  DateTime Function()? clock,
}) async {
  final persistence = MemorySubscriptionReturnInboxPersistence();
  await SubscriptionReturnService.installForTesting(
    inboxStore: SubscriptionReturnInboxStore(
      persistence: persistence,
      clock: clock ?? backend.clock,
    ),
    serverClient: SubscriptionReturnServerClient(
      invokeCallable: backend.invoke,
      clock: clock ?? backend.clock,
    ),
  );
  return persistence;
}

String _scopeKey(SubscriptionReturnOwnerScope ownerScope) =>
    '${ownerScope.uid}\u0000${ownerScope.accountDocumentId}';

class _FakeContext {
  final SubscriptionReturnOwnerScope ownerScope;
  final SubscriptionReturnFamily family;
  String? eventId;

  _FakeContext({required this.ownerScope, required this.family});
}

class _FakeEvent {
  final String id;
  final SubscriptionReturnKind kind;
  final DateTime expiresAt;
  bool navigationClaimed;
  bool refreshClaimed;

  _FakeEvent({
    required this.id,
    required this.kind,
    required this.expiresAt,
    this.navigationClaimed = false,
    this.refreshClaimed = false,
  });
}
