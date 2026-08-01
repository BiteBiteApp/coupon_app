import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

const int subscriptionReturnProtocolVersion = 2;
const String subscriptionReturnTokenQueryParameter = 'return_token';
const Duration subscriptionReturnRecordTtl = Duration(hours: 24);
const Duration subscriptionReturnAllowedClockSkew = Duration(minutes: 5);
const int subscriptionReturnInboxCapacity = 32;
const int subscriptionReturnPendingEventCapacity = 32;

final RegExp _subscriptionReturnTokenPattern = RegExp(r'^[A-Za-z0-9_-]{43}$');
final RegExp _subscriptionReturnEventIdPattern = RegExp(r'^[1-9][0-9]{0,15}$');

bool isValidSubscriptionReturnToken(String value) {
  return _subscriptionReturnTokenPattern.hasMatch(value);
}

bool isValidSubscriptionReturnEventId(String value) {
  if (!_subscriptionReturnEventIdPattern.hasMatch(value)) {
    return false;
  }
  final parsed = int.tryParse(value);
  return parsed != null && parsed <= 9007199254740990;
}

bool isValidSubscriptionReturnAccountDocumentId(String value) {
  return _isValidAccountDocumentId(value);
}

@immutable
class SubscriptionReturnOwnerScope {
  final String uid;
  final String accountDocumentId;

  const SubscriptionReturnOwnerScope({
    required this.uid,
    required this.accountDocumentId,
  });

  bool get isValid =>
      _isValidUid(uid) && _isValidAccountDocumentId(accountDocumentId);

  @override
  bool operator ==(Object other) =>
      other is SubscriptionReturnOwnerScope &&
      other.uid == uid &&
      other.accountDocumentId == accountDocumentId;

  @override
  int get hashCode => Object.hash(uid, accountDocumentId);
}

enum SubscriptionReturnFamily { checkout, customerPortal }

enum SubscriptionReturnKind {
  checkoutSuccess,
  checkoutCancel,
  customerPortal;

  SubscriptionReturnFamily get family => switch (this) {
    SubscriptionReturnKind.checkoutSuccess ||
    SubscriptionReturnKind.checkoutCancel => SubscriptionReturnFamily.checkout,
    SubscriptionReturnKind.customerPortal =>
      SubscriptionReturnFamily.customerPortal,
  };
}

SubscriptionReturnKind? subscriptionReturnKindFromName(String value) {
  for (final kind in SubscriptionReturnKind.values) {
    if (kind.name == value) {
      return kind;
    }
  }
  return null;
}

@immutable
class SubscriptionReturnInboxDelivery {
  final String returnToken;
  final SubscriptionReturnKind kind;
  final DateTime firstSeenAt;
  final DateTime expiresAt;

  const SubscriptionReturnInboxDelivery({
    required this.returnToken,
    required this.kind,
    required this.firstSeenAt,
    required this.expiresAt,
  });

  bool isValidAt(DateTime now) {
    try {
      final normalizedNow = now.toUtc();
      final lifetime = expiresAt.difference(firstSeenAt);
      return isValidSubscriptionReturnToken(returnToken) &&
          firstSeenAt.isUtc &&
          expiresAt.isUtc &&
          firstSeenAt.millisecondsSinceEpoch > 0 &&
          expiresAt.millisecondsSinceEpoch > 0 &&
          !firstSeenAt.isAfter(
            normalizedNow.add(subscriptionReturnAllowedClockSkew),
          ) &&
          lifetime > Duration.zero &&
          lifetime <= subscriptionReturnRecordTtl &&
          !expiresAt.isAfter(
            normalizedNow
                .add(subscriptionReturnRecordTtl)
                .add(subscriptionReturnAllowedClockSkew),
          ) &&
          expiresAt.isAfter(normalizedNow);
    } catch (_) {
      return false;
    }
  }

  @override
  bool operator ==(Object other) =>
      other is SubscriptionReturnInboxDelivery &&
      other.returnToken == returnToken &&
      other.kind == kind &&
      other.firstSeenAt == firstSeenAt &&
      other.expiresAt == expiresAt;

  @override
  int get hashCode => Object.hash(returnToken, kind, firstSeenAt, expiresAt);
}

@immutable
class SubscriptionReturnEvent {
  final String id;
  final SubscriptionReturnKind kind;
  final SubscriptionReturnOwnerScope ownerScope;
  final DateTime expiresAt;
  final bool navigationClaimed;
  final bool refreshClaimed;

  const SubscriptionReturnEvent({
    required this.id,
    required this.kind,
    required this.ownerScope,
    required this.expiresAt,
    required this.navigationClaimed,
    required this.refreshClaimed,
  });

  SubscriptionReturnEvent copyWith({
    bool? navigationClaimed,
    bool? refreshClaimed,
  }) {
    return SubscriptionReturnEvent(
      id: id,
      kind: kind,
      ownerScope: ownerScope,
      expiresAt: expiresAt,
      navigationClaimed: navigationClaimed ?? this.navigationClaimed,
      refreshClaimed: refreshClaimed ?? this.refreshClaimed,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is SubscriptionReturnEvent &&
      other.id == id &&
      other.kind == kind &&
      other.ownerScope == ownerScope &&
      other.expiresAt == expiresAt &&
      other.navigationClaimed == navigationClaimed &&
      other.refreshClaimed == refreshClaimed;

  @override
  int get hashCode => Object.hash(
    id,
    kind,
    ownerScope,
    expiresAt,
    navigationClaimed,
    refreshClaimed,
  );
}

enum SubscriptionReturnInboxAddResult {
  added,
  duplicate,
  invalid,
  capacityFull,
  persistenceFailed;

  bool get isRetained =>
      this == SubscriptionReturnInboxAddResult.added ||
      this == SubscriptionReturnInboxAddResult.duplicate;
}

@immutable
class SubscriptionReturnInboxSnapshot {
  final List<SubscriptionReturnInboxDelivery> deliveries;

  const SubscriptionReturnInboxSnapshot({required this.deliveries});
}

/// Non-authoritative local persistence for signed-out/offline return UX only.
///
/// Server redemption and claims remain authoritative even if this inbox is
/// duplicated, rolled back, or lost.
abstract interface class SubscriptionReturnInboxPersistence {
  Future<String?> read();

  Future<void> write(String value);

  Future<void> remove();
}

class SharedPreferencesAsyncSubscriptionReturnInboxPersistence
    implements SubscriptionReturnInboxPersistence {
  static const String persistenceKey =
      'bitestar_subscription_return_delivery_inbox_v2';

  final SharedPreferencesAsync _preferences;

  SharedPreferencesAsyncSubscriptionReturnInboxPersistence({
    SharedPreferencesAsync? preferences,
  }) : _preferences = preferences ?? SharedPreferencesAsync();

  @override
  Future<String?> read() => _preferences.getString(persistenceKey);

  @override
  Future<void> write(String value) =>
      _preferences.setString(persistenceKey, value);

  @override
  Future<void> remove() => _preferences.remove(persistenceKey);
}

class SubscriptionReturnInboxStore {
  static const int schemaVersion = 2;
  static const int recordSchemaVersion = 1;

  final SubscriptionReturnInboxPersistence _persistence;
  final DateTime Function() _clock;
  Future<void> _operationTail = Future<void>.value();

  SubscriptionReturnInboxStore({
    SubscriptionReturnInboxPersistence? persistence,
    DateTime Function()? clock,
  }) : _persistence =
           persistence ??
           SharedPreferencesAsyncSubscriptionReturnInboxPersistence(),
       _clock = clock ?? _utcNow;

  Future<SubscriptionReturnInboxAddResult> add({
    required String returnToken,
    required SubscriptionReturnKind kind,
  }) {
    return _serialized(() async {
      late final DateTime now;
      late final SubscriptionReturnInboxDelivery delivery;
      try {
        now = _clock().toUtc();
        delivery = SubscriptionReturnInboxDelivery(
          returnToken: returnToken,
          kind: kind,
          firstSeenAt: now,
          expiresAt: now.add(subscriptionReturnRecordTtl),
        );
      } catch (_) {
        return SubscriptionReturnInboxAddResult.invalid;
      }
      if (!delivery.isValidAt(now)) {
        return SubscriptionReturnInboxAddResult.invalid;
      }

      try {
        final loaded = await _load(now);
        final deliveries = loaded.deliveries;
        if (deliveries.any(
          (candidate) =>
              candidate.returnToken == returnToken && candidate.kind == kind,
        )) {
          if (loaded.changed) {
            await _persist(deliveries);
          }
          return SubscriptionReturnInboxAddResult.duplicate;
        }
        if (deliveries.length >= subscriptionReturnInboxCapacity) {
          if (loaded.changed) {
            await _persist(deliveries);
          }
          return SubscriptionReturnInboxAddResult.capacityFull;
        }
        deliveries.add(delivery);
        await _persist(deliveries);
        return SubscriptionReturnInboxAddResult.added;
      } catch (_) {
        return SubscriptionReturnInboxAddResult.persistenceFailed;
      }
    });
  }

  Future<List<SubscriptionReturnInboxDelivery>> load() {
    return _serialized(() async {
      try {
        final loaded = await _load(_clock().toUtc());
        if (loaded.changed) {
          await _persist(loaded.deliveries);
        }
        return List<SubscriptionReturnInboxDelivery>.unmodifiable(
          loaded.deliveries,
        );
      } catch (_) {
        return const <SubscriptionReturnInboxDelivery>[];
      }
    });
  }

  Future<bool> remove(SubscriptionReturnInboxDelivery delivery) {
    return _serialized(() async {
      try {
        final loaded = await _load(_clock().toUtc());
        final lengthBefore = loaded.deliveries.length;
        loaded.deliveries.removeWhere(
          (candidate) =>
              candidate.returnToken == delivery.returnToken &&
              candidate.kind == delivery.kind &&
              candidate.firstSeenAt == delivery.firstSeenAt,
        );
        if (loaded.deliveries.length == lengthBefore && !loaded.changed) {
          return true;
        }
        await _persist(loaded.deliveries);
        return true;
      } catch (_) {
        return false;
      }
    });
  }

  Future<bool> containsPendingDelivery() async => (await load()).isNotEmpty;

  Future<SubscriptionReturnInboxSnapshot> snapshot() async {
    return SubscriptionReturnInboxSnapshot(deliveries: await load());
  }

  Future<void> clear() async {
    await _serialized(() async {
      try {
        await _persistence.remove();
      } catch (_) {
        // Explicit local reset remains fail closed. Server state is untouched.
      }
    });
  }

  Future<_LoadedInbox> _load(DateTime now) async {
    final raw = await _persistence.read();
    if (raw == null || raw.isEmpty) {
      return _LoadedInbox(
        deliveries: <SubscriptionReturnInboxDelivery>[],
        changed: false,
      );
    }

    final decoded = _decode(raw, now);
    final active = <SubscriptionReturnInboxDelivery>[];
    var changed = decoded.changed;
    for (final delivery in decoded.deliveries) {
      if (!delivery.isValidAt(now)) {
        changed = true;
      } else {
        active.add(delivery);
      }
    }
    return _LoadedInbox(deliveries: active, changed: changed);
  }

  _LoadedInbox _decode(String raw, DateTime now) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic> ||
          !_hasExactKeys(decoded, const <String>{
            'schemaVersion',
            'deliveries',
          }) ||
          decoded['schemaVersion'] != schemaVersion ||
          decoded['deliveries'] is! List<dynamic>) {
        return _LoadedInbox(
          deliveries: <SubscriptionReturnInboxDelivery>[],
          changed: true,
        );
      }

      final deliveries = <SubscriptionReturnInboxDelivery>[];
      var changed = false;
      final seen = <String>{};
      for (final rawDelivery in decoded['deliveries'] as List<dynamic>) {
        final delivery = _decodeDelivery(rawDelivery, now);
        if (delivery == null) {
          changed = true;
          continue;
        }
        final identity = '${delivery.kind.name}:${delivery.returnToken}';
        if (!seen.add(identity)) {
          changed = true;
          continue;
        }
        deliveries.add(delivery);
      }
      if (deliveries.length > subscriptionReturnInboxCapacity) {
        return _LoadedInbox(
          deliveries: <SubscriptionReturnInboxDelivery>[],
          changed: true,
        );
      }
      return _LoadedInbox(deliveries: deliveries, changed: changed);
    } catch (_) {
      return _LoadedInbox(
        deliveries: <SubscriptionReturnInboxDelivery>[],
        changed: true,
      );
    }
  }

  SubscriptionReturnInboxDelivery? _decodeDelivery(
    Object? value,
    DateTime now,
  ) {
    if (value is! Map<String, dynamic> ||
        !_hasExactKeys(value, const <String>{
          'schemaVersion',
          'returnToken',
          'returnKind',
          'firstSeenAtEpochMs',
          'expiresAtEpochMs',
        }) ||
        value['schemaVersion'] != recordSchemaVersion ||
        value['returnToken'] is! String ||
        value['returnKind'] is! String ||
        value['firstSeenAtEpochMs'] is! int ||
        value['expiresAtEpochMs'] is! int) {
      return null;
    }
    final kind = subscriptionReturnKindFromName(value['returnKind'] as String);
    if (kind == null) {
      return null;
    }
    try {
      final delivery = SubscriptionReturnInboxDelivery(
        returnToken: value['returnToken'] as String,
        kind: kind,
        firstSeenAt: DateTime.fromMillisecondsSinceEpoch(
          value['firstSeenAtEpochMs'] as int,
          isUtc: true,
        ),
        expiresAt: DateTime.fromMillisecondsSinceEpoch(
          value['expiresAtEpochMs'] as int,
          isUtc: true,
        ),
      );
      return delivery.isValidAt(now) ? delivery : null;
    } catch (_) {
      return null;
    }
  }

  Future<void> _persist(List<SubscriptionReturnInboxDelivery> deliveries) {
    if (deliveries.isEmpty) {
      return _persistence.remove();
    }
    return _persistence.write(
      jsonEncode(<String, Object>{
        'schemaVersion': schemaVersion,
        'deliveries': <Map<String, Object>>[
          for (final delivery in deliveries)
            <String, Object>{
              'schemaVersion': recordSchemaVersion,
              'returnToken': delivery.returnToken,
              'returnKind': delivery.kind.name,
              'firstSeenAtEpochMs': delivery.firstSeenAt.millisecondsSinceEpoch,
              'expiresAtEpochMs': delivery.expiresAt.millisecondsSinceEpoch,
            },
        ],
      }),
    );
  }

  Future<T> _serialized<T>(Future<T> Function() operation) {
    final previous = _operationTail;
    final completion = Completer<void>.sync();
    _operationTail = completion.future;
    return () async {
      try {
        await previous;
        return await operation();
      } finally {
        completion.complete();
      }
    }();
  }

  static DateTime _utcNow() => DateTime.now().toUtc();
}

class _LoadedInbox {
  final List<SubscriptionReturnInboxDelivery> deliveries;
  final bool changed;

  const _LoadedInbox({required this.deliveries, required this.changed});
}

bool _isValidUid(String value) {
  return value.isNotEmpty &&
      value.length <= 128 &&
      value.trim() == value &&
      !value.codeUnits.any((unit) => unit < 0x20 || unit == 0x7f);
}

bool _isValidAccountDocumentId(String value) {
  return value.isNotEmpty &&
      value.length <= 128 &&
      value.trim() == value &&
      value != '.' &&
      value != '..' &&
      !value.contains('/') &&
      !value.codeUnits.any((unit) => unit < 0x20 || unit == 0x7f);
}

bool _hasExactKeys(Map<String, dynamic> value, Set<String> expected) {
  return value.length == expected.length && value.keys.every(expected.contains);
}
