import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart';

import 'subscription_return_context_store.dart';

const String redeemSubscriptionReturnCallableName =
    'redeemBiteSaverSubscriptionReturn';
const String claimSubscriptionReturnEventCallableName =
    'claimBiteSaverSubscriptionReturnEvent';
const String listSubscriptionReturnEventsCallableName =
    'listBiteSaverSubscriptionReturnEvents';

typedef SubscriptionReturnCallableInvoker =
    Future<Object?> Function(String callableName, Map<String, Object?> payload);

enum SubscriptionReturnServerFailure { unavailable, rejected, invalidResponse }

class SubscriptionReturnServerException implements Exception {
  final SubscriptionReturnServerFailure failure;

  const SubscriptionReturnServerException(this.failure);

  @override
  String toString() => 'SubscriptionReturnServerException(${failure.name})';
}

enum SubscriptionReturnClaimType { navigation, refresh }

@immutable
class SubscriptionReturnRedemption {
  final bool created;
  final String eventId;
  final SubscriptionReturnKind kind;

  const SubscriptionReturnRedemption({
    required this.created,
    required this.eventId,
    required this.kind,
  });
}

@immutable
class SubscriptionReturnClaim {
  final bool claimed;
  final String eventId;
  final SubscriptionReturnKind kind;

  const SubscriptionReturnClaim({
    required this.claimed,
    required this.eventId,
    required this.kind,
  });
}

class SubscriptionReturnServerClient {
  final SubscriptionReturnCallableInvoker _invokeCallable;
  final DateTime Function() _clock;

  const SubscriptionReturnServerClient({
    required SubscriptionReturnCallableInvoker invokeCallable,
    DateTime Function()? clock,
  }) : _invokeCallable = invokeCallable,
       _clock = clock ?? _utcNow;

  factory SubscriptionReturnServerClient.production() {
    return SubscriptionReturnServerClient(
      invokeCallable: (callableName, payload) async {
        try {
          final callable = FirebaseFunctions.instanceFor(
            region: 'us-central1',
          ).httpsCallable(callableName);
          return (await callable.call<Object?>(payload)).data;
        } on FirebaseFunctionsException catch (error) {
          throw SubscriptionReturnServerException(
            _isUnavailableCode(error.code)
                ? SubscriptionReturnServerFailure.unavailable
                : SubscriptionReturnServerFailure.rejected,
          );
        } catch (_) {
          throw const SubscriptionReturnServerException(
            SubscriptionReturnServerFailure.unavailable,
          );
        }
      },
    );
  }

  Future<SubscriptionReturnRedemption> redeem({
    required SubscriptionReturnOwnerScope ownerScope,
    required SubscriptionReturnInboxDelivery delivery,
  }) async {
    _requireValidOwnerScope(ownerScope);
    if (!isValidSubscriptionReturnToken(delivery.returnToken)) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.invalidResponse,
      );
    }

    final raw =
        await _invoke(redeemSubscriptionReturnCallableName, <String, Object?>{
          'returnProtocolVersion': subscriptionReturnProtocolVersion,
          'restaurantAccountDocumentId': ownerScope.accountDocumentId,
          'returnToken': delivery.returnToken,
          'returnKind': delivery.kind.name,
        });
    final data = _requireExactMap(raw, const <String>{
      'returnProtocolVersion',
      'created',
      'eventId',
      'returnKind',
    });
    final version = data['returnProtocolVersion'];
    final created = data['created'];
    final eventId = data['eventId'];
    final rawKind = data['returnKind'];
    final kind = rawKind is String
        ? subscriptionReturnKindFromName(rawKind)
        : null;
    if (version is! int ||
        version != subscriptionReturnProtocolVersion ||
        created is! bool ||
        eventId is! String ||
        !isValidSubscriptionReturnEventId(eventId) ||
        kind == null ||
        kind != delivery.kind) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.invalidResponse,
      );
    }
    return SubscriptionReturnRedemption(
      created: created,
      eventId: eventId,
      kind: kind,
    );
  }

  Future<List<SubscriptionReturnEvent>> listPending({
    required SubscriptionReturnOwnerScope ownerScope,
  }) async {
    _requireValidOwnerScope(ownerScope);
    final raw = await _invoke(
      listSubscriptionReturnEventsCallableName,
      <String, Object?>{
        'returnProtocolVersion': subscriptionReturnProtocolVersion,
        'restaurantAccountDocumentId': ownerScope.accountDocumentId,
      },
    );
    final data = _requireExactMap(raw, const <String>{
      'returnProtocolVersion',
      'events',
    });
    final version = data['returnProtocolVersion'];
    final rawEvents = data['events'];
    if (version is! int ||
        version != subscriptionReturnProtocolVersion ||
        rawEvents is! List ||
        rawEvents.length > subscriptionReturnPendingEventCapacity) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.invalidResponse,
      );
    }

    late final DateTime now;
    late final DateTime maximumExpiration;
    try {
      now = _clock().toUtc();
      maximumExpiration = now
          .add(subscriptionReturnRecordTtl)
          .add(subscriptionReturnAllowedClockSkew);
    } catch (_) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.invalidResponse,
      );
    }
    final events = <SubscriptionReturnEvent>[];
    final seenIds = <String>{};
    for (final rawEvent in rawEvents) {
      final eventData = _requireExactMap(rawEvent, const <String>{
        'eventId',
        'returnKind',
        'navigationClaimed',
        'refreshClaimed',
        'expiresAtEpochMs',
      });
      final eventId = eventData['eventId'];
      final rawKind = eventData['returnKind'];
      final navigationClaimed = eventData['navigationClaimed'];
      final refreshClaimed = eventData['refreshClaimed'];
      final expiresAtEpochMs = eventData['expiresAtEpochMs'];
      final kind = rawKind is String
          ? subscriptionReturnKindFromName(rawKind)
          : null;
      if (eventId is! String ||
          !isValidSubscriptionReturnEventId(eventId) ||
          !seenIds.add(eventId) ||
          kind == null ||
          navigationClaimed is! bool ||
          refreshClaimed is! bool ||
          (navigationClaimed && refreshClaimed) ||
          expiresAtEpochMs is! int ||
          expiresAtEpochMs <= 0) {
        throw const SubscriptionReturnServerException(
          SubscriptionReturnServerFailure.invalidResponse,
        );
      }
      late final DateTime expiresAt;
      try {
        expiresAt = DateTime.fromMillisecondsSinceEpoch(
          expiresAtEpochMs,
          isUtc: true,
        );
      } catch (_) {
        throw const SubscriptionReturnServerException(
          SubscriptionReturnServerFailure.invalidResponse,
        );
      }
      if (!expiresAt.isAfter(now) || expiresAt.isAfter(maximumExpiration)) {
        throw const SubscriptionReturnServerException(
          SubscriptionReturnServerFailure.invalidResponse,
        );
      }
      events.add(
        SubscriptionReturnEvent(
          id: eventId,
          kind: kind,
          ownerScope: ownerScope,
          expiresAt: expiresAt,
          navigationClaimed: navigationClaimed,
          refreshClaimed: refreshClaimed,
        ),
      );
    }
    return List<SubscriptionReturnEvent>.unmodifiable(events);
  }

  Future<SubscriptionReturnClaim> claim({
    required SubscriptionReturnOwnerScope ownerScope,
    required String eventId,
    required SubscriptionReturnClaimType claimType,
  }) async {
    _requireValidOwnerScope(ownerScope);
    if (!isValidSubscriptionReturnEventId(eventId)) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.invalidResponse,
      );
    }
    final raw = await _invoke(
      claimSubscriptionReturnEventCallableName,
      <String, Object?>{
        'returnProtocolVersion': subscriptionReturnProtocolVersion,
        'restaurantAccountDocumentId': ownerScope.accountDocumentId,
        'eventId': eventId,
        'claimType': claimType.name,
      },
    );
    final data = _requireExactMap(raw, const <String>{
      'returnProtocolVersion',
      'claimed',
      'eventId',
      'returnKind',
    });
    final version = data['returnProtocolVersion'];
    final claimed = data['claimed'];
    final responseEventId = data['eventId'];
    final rawKind = data['returnKind'];
    final kind = rawKind is String
        ? subscriptionReturnKindFromName(rawKind)
        : null;
    if (version is! int ||
        version != subscriptionReturnProtocolVersion ||
        claimed is! bool ||
        responseEventId != eventId ||
        kind == null) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.invalidResponse,
      );
    }
    return SubscriptionReturnClaim(
      claimed: claimed,
      eventId: eventId,
      kind: kind,
    );
  }

  Future<Object?> _invoke(
    String callableName,
    Map<String, Object?> payload,
  ) async {
    try {
      return await _invokeCallable(callableName, payload);
    } on SubscriptionReturnServerException {
      rethrow;
    } catch (_) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.unavailable,
      );
    }
  }

  static void _requireValidOwnerScope(SubscriptionReturnOwnerScope ownerScope) {
    if (!ownerScope.isValid) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.invalidResponse,
      );
    }
  }

  static DateTime _utcNow() => DateTime.now().toUtc();
}

Map<String, Object?> _requireExactMap(Object? raw, Set<String> expectedKeys) {
  try {
    if (raw is! Map || raw.length != expectedKeys.length) {
      throw const SubscriptionReturnServerException(
        SubscriptionReturnServerFailure.invalidResponse,
      );
    }
    final result = <String, Object?>{};
    for (final entry in raw.entries) {
      final key = entry.key;
      if (key is! String || !expectedKeys.contains(key)) {
        throw const SubscriptionReturnServerException(
          SubscriptionReturnServerFailure.invalidResponse,
        );
      }
      result[key] = entry.value;
    }
    return result;
  } on SubscriptionReturnServerException {
    rethrow;
  } catch (_) {
    throw const SubscriptionReturnServerException(
      SubscriptionReturnServerFailure.invalidResponse,
    );
  }
}

bool _isUnavailableCode(String code) {
  return code == 'unavailable' ||
      code == 'deadline-exceeded' ||
      code == 'resource-exhausted' ||
      code == 'cancelled';
}
