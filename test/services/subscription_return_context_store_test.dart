import 'dart:async';
import 'dart:convert';

import 'package:coupon_app/services/subscription_return_context_store.dart';
import 'package:flutter_test/flutter_test.dart';

final DateTime _now = DateTime.utc(2026, 7, 31, 12);

String _token(int seed) {
  final prefix = seed.toRadixString(36).padLeft(3, '0');
  return '$prefix${'A' * 40}';
}

class _MemoryPersistence implements SubscriptionReturnInboxPersistence {
  String? value;
  bool failRead = false;
  bool failWrite = false;
  bool failRemove = false;
  int reads = 0;
  int writes = 0;
  int removes = 0;
  Completer<void>? writeStarted;
  Completer<void>? releaseWrite;

  @override
  Future<String?> read() async {
    reads += 1;
    if (failRead) {
      throw StateError('read failed');
    }
    return value;
  }

  @override
  Future<void> write(String nextValue) async {
    writes += 1;
    writeStarted?.complete();
    await releaseWrite?.future;
    if (failWrite) {
      throw StateError('write failed');
    }
    value = nextValue;
  }

  @override
  Future<void> remove() async {
    removes += 1;
    if (failRemove) {
      throw StateError('remove failed');
    }
    value = null;
  }
}

void main() {
  test('validates exact tokens, event IDs, and canonical document IDs', () {
    expect(isValidSubscriptionReturnToken(_token(1)), isTrue);
    expect(isValidSubscriptionReturnToken('A' * 42), isFalse);
    expect(isValidSubscriptionReturnToken('${'A' * 42}='), isFalse);
    expect(isValidSubscriptionReturnToken('${'A' * 42}+'), isFalse);
    expect(isValidSubscriptionReturnEventId('1'), isTrue);
    expect(isValidSubscriptionReturnEventId('9007199254740990'), isTrue);
    expect(isValidSubscriptionReturnEventId('0'), isFalse);
    expect(isValidSubscriptionReturnEventId('01'), isFalse);
    expect(isValidSubscriptionReturnEventId('9007199254740991'), isFalse);
    expect(isValidSubscriptionReturnAccountDocumentId('owner_doc-1'), isTrue);
    expect(isValidSubscriptionReturnAccountDocumentId(' owner'), isFalse);
    expect(isValidSubscriptionReturnAccountDocumentId('owner/path'), isFalse);
    expect(isValidSubscriptionReturnAccountDocumentId('.'), isFalse);
  });

  test('owner scope equality includes exact canonical document identity', () {
    const first = SubscriptionReturnOwnerScope(
      uid: 'owner-a',
      accountDocumentId: 'account-a',
    );
    const same = SubscriptionReturnOwnerScope(
      uid: 'owner-a',
      accountDocumentId: 'account-a',
    );
    const sibling = SubscriptionReturnOwnerScope(
      uid: 'owner-a',
      accountDocumentId: 'account-b',
    );
    expect(first.isValid, isTrue);
    expect(first, same);
    expect(first, isNot(sibling));
  });

  test('adds, reloads, deduplicates, and removes a raw delivery', () async {
    final persistence = _MemoryPersistence();
    final store = SubscriptionReturnInboxStore(
      persistence: persistence,
      clock: () => _now,
    );

    expect(
      await store.add(
        returnToken: _token(1),
        kind: SubscriptionReturnKind.checkoutSuccess,
      ),
      SubscriptionReturnInboxAddResult.added,
    );
    expect(
      await store.add(
        returnToken: _token(1),
        kind: SubscriptionReturnKind.checkoutSuccess,
      ),
      SubscriptionReturnInboxAddResult.duplicate,
    );

    final restarted = SubscriptionReturnInboxStore(
      persistence: persistence,
      clock: () => _now,
    );
    final deliveries = await restarted.load();
    expect(deliveries, hasLength(1));
    expect(deliveries.single.kind, SubscriptionReturnKind.checkoutSuccess);
    expect(deliveries.single.firstSeenAt, _now);
    expect(deliveries.single.expiresAt, _now.add(subscriptionReturnRecordTtl));
    expect(await restarted.remove(deliveries.single), isTrue);
    expect(await restarted.load(), isEmpty);
  });

  test(
    'persisted inbox contains no owner, event, claim, or Stripe state',
    () async {
      final persistence = _MemoryPersistence();
      final store = SubscriptionReturnInboxStore(
        persistence: persistence,
        clock: () => _now,
      );
      await store.add(
        returnToken: _token(2),
        kind: SubscriptionReturnKind.customerPortal,
      );

      final decoded = jsonDecode(persistence.value!) as Map<String, dynamic>;
      expect(decoded.keys, <String>{'schemaVersion', 'deliveries'});
      final delivery = (decoded['deliveries'] as List<dynamic>).single as Map;
      expect(delivery.keys.toSet(), <String>{
        'schemaVersion',
        'returnToken',
        'returnKind',
        'firstSeenAtEpochMs',
        'expiresAtEpochMs',
      });
      final encoded = persistence.value!;
      for (final forbidden in <String>[
        'ownerUid',
        'accountDocumentId',
        'eventId',
        'navigationClaimed',
        'refreshClaimed',
        'stripe',
        'sessionId',
        'customerId',
      ]) {
        expect(encoded, isNot(contains(forbidden)));
      }
    },
  );

  test('enforces capacity without evicting an active delivery', () async {
    final persistence = _MemoryPersistence();
    final store = SubscriptionReturnInboxStore(
      persistence: persistence,
      clock: () => _now,
    );
    for (var index = 0; index < subscriptionReturnInboxCapacity; index += 1) {
      expect(
        await store.add(
          returnToken: _token(index),
          kind: SubscriptionReturnKind.checkoutCancel,
        ),
        SubscriptionReturnInboxAddResult.added,
      );
    }
    expect(
      await store.add(
        returnToken: _token(subscriptionReturnInboxCapacity),
        kind: SubscriptionReturnKind.customerPortal,
      ),
      SubscriptionReturnInboxAddResult.capacityFull,
    );
    expect(await store.load(), hasLength(subscriptionReturnInboxCapacity));
  });

  test('expired delivery is cleaned before the capacity check', () async {
    var clock = _now;
    final persistence = _MemoryPersistence();
    final store = SubscriptionReturnInboxStore(
      persistence: persistence,
      clock: () => clock,
    );
    for (var index = 0; index < subscriptionReturnInboxCapacity; index += 1) {
      await store.add(
        returnToken: _token(index),
        kind: SubscriptionReturnKind.checkoutSuccess,
      );
    }
    clock = _now.add(subscriptionReturnRecordTtl);
    expect(
      await store.add(
        returnToken: _token(90),
        kind: SubscriptionReturnKind.customerPortal,
      ),
      SubscriptionReturnInboxAddResult.added,
    );
    expect((await store.load()).single.returnToken, _token(90));
  });

  test(
    'rejects future-created and overlong-lifetime persisted records',
    () async {
      Map<String, Object> state({
        required DateTime firstSeen,
        required DateTime expires,
      }) => <String, Object>{
        'schemaVersion': SubscriptionReturnInboxStore.schemaVersion,
        'deliveries': <Object>[
          <String, Object>{
            'schemaVersion': SubscriptionReturnInboxStore.recordSchemaVersion,
            'returnToken': _token(3),
            'returnKind': SubscriptionReturnKind.checkoutSuccess.name,
            'firstSeenAtEpochMs': firstSeen.millisecondsSinceEpoch,
            'expiresAtEpochMs': expires.millisecondsSinceEpoch,
          },
        ],
      };

      for (final fixture in <Map<String, Object>>[
        state(
          firstSeen: _now.add(
            subscriptionReturnAllowedClockSkew +
                const Duration(milliseconds: 1),
          ),
          expires: _now.add(const Duration(hours: 1)),
        ),
        state(
          firstSeen: _now,
          expires: _now.add(
            subscriptionReturnRecordTtl + const Duration(milliseconds: 1),
          ),
        ),
        state(firstSeen: _now, expires: _now),
        state(
          firstSeen: DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
          expires: _now.add(const Duration(hours: 1)),
        ),
      ]) {
        final persistence = _MemoryPersistence()..value = jsonEncode(fixture);
        final store = SubscriptionReturnInboxStore(
          persistence: persistence,
          clock: () => _now,
        );
        expect(await store.load(), isEmpty);
        expect(persistence.value, isNull);
      }
    },
  );

  test('created time at five-minute skew boundary remains valid', () async {
    final firstSeen = _now.add(subscriptionReturnAllowedClockSkew);
    final persistence = _MemoryPersistence()
      ..value = jsonEncode(<String, Object>{
        'schemaVersion': SubscriptionReturnInboxStore.schemaVersion,
        'deliveries': <Object>[
          <String, Object>{
            'schemaVersion': SubscriptionReturnInboxStore.recordSchemaVersion,
            'returnToken': _token(4),
            'returnKind': SubscriptionReturnKind.checkoutCancel.name,
            'firstSeenAtEpochMs': firstSeen.millisecondsSinceEpoch,
            'expiresAtEpochMs': firstSeen
                .add(const Duration(hours: 23))
                .millisecondsSinceEpoch,
          },
        ],
      });
    final store = SubscriptionReturnInboxStore(
      persistence: persistence,
      clock: () => _now,
    );
    expect(await store.load(), hasLength(1));
  });

  test('negative and near-maximum injected clocks fail closed', () async {
    for (final clockValue in <DateTime>[
      DateTime.fromMillisecondsSinceEpoch(-1, isUtc: true),
      DateTime.fromMillisecondsSinceEpoch(8640000000000000, isUtc: true),
    ]) {
      final persistence = _MemoryPersistence();
      final store = SubscriptionReturnInboxStore(
        persistence: persistence,
        clock: () => clockValue,
      );
      expect(
        await store.add(
          returnToken: _token(41),
          kind: SubscriptionReturnKind.checkoutSuccess,
        ),
        SubscriptionReturnInboxAddResult.invalid,
      );
      expect(persistence.value, isNull);
    }
  });

  test('unknown root keys, record keys, and schema fail closed', () async {
    final validRecord = <String, Object>{
      'schemaVersion': SubscriptionReturnInboxStore.recordSchemaVersion,
      'returnToken': _token(5),
      'returnKind': SubscriptionReturnKind.checkoutSuccess.name,
      'firstSeenAtEpochMs': _now.millisecondsSinceEpoch,
      'expiresAtEpochMs': _now
          .add(subscriptionReturnRecordTtl)
          .millisecondsSinceEpoch,
    };
    for (final value in <Object>[
      '{',
      <String, Object>{
        'schemaVersion': 99,
        'deliveries': <Object>[validRecord],
      },
      <String, Object>{
        'schemaVersion': SubscriptionReturnInboxStore.schemaVersion,
        'deliveries': <Object>[validRecord],
        'unexpected': true,
      },
      <String, Object>{
        'schemaVersion': SubscriptionReturnInboxStore.schemaVersion,
        'deliveries': <Object>[
          <String, Object>{...validRecord, 'unexpected': true},
        ],
      },
    ]) {
      final persistence = _MemoryPersistence()
        ..value = value is String ? value : jsonEncode(value);
      final store = SubscriptionReturnInboxStore(
        persistence: persistence,
        clock: () => _now,
      );
      expect(await store.load(), isEmpty);
      expect(persistence.value, isNull);
    }
  });

  test(
    'read/write failures are fail-closed and retain no false success',
    () async {
      final readFailure = _MemoryPersistence()..failRead = true;
      final readStore = SubscriptionReturnInboxStore(
        persistence: readFailure,
        clock: () => _now,
      );
      expect(await readStore.load(), isEmpty);
      expect(
        await readStore.add(
          returnToken: _token(6),
          kind: SubscriptionReturnKind.checkoutSuccess,
        ),
        SubscriptionReturnInboxAddResult.persistenceFailed,
      );

      final writeFailure = _MemoryPersistence()..failWrite = true;
      final writeStore = SubscriptionReturnInboxStore(
        persistence: writeFailure,
        clock: () => _now,
      );
      expect(
        await writeStore.add(
          returnToken: _token(7),
          kind: SubscriptionReturnKind.checkoutSuccess,
        ),
        SubscriptionReturnInboxAddResult.persistenceFailed,
      );
      expect(writeFailure.value, isNull);
    },
  );

  test('clear remains serialized behind an in-flight add', () async {
    final persistence = _MemoryPersistence()
      ..writeStarted = Completer<void>()
      ..releaseWrite = Completer<void>();
    final store = SubscriptionReturnInboxStore(
      persistence: persistence,
      clock: () => _now,
    );
    final add = store.add(
      returnToken: _token(8),
      kind: SubscriptionReturnKind.customerPortal,
    );
    await persistence.writeStarted!.future;
    final clear = store.clear();
    await Future<void>.delayed(Duration.zero);
    expect(persistence.removes, 0);
    persistence.releaseWrite!.complete();
    expect(await add, SubscriptionReturnInboxAddResult.added);
    await clear;
    expect(persistence.value, isNull);
  });

  test('SharedPreferencesAsync facade uses an isolated v2 inbox key', () {
    expect(
      SharedPreferencesAsyncSubscriptionReturnInboxPersistence.persistenceKey,
      'bitestar_subscription_return_delivery_inbox_v2',
    );
  });
}
