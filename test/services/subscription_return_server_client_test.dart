import 'dart:async';

import 'package:coupon_app/services/subscription_return_context_store.dart';
import 'package:coupon_app/services/subscription_return_server_client.dart';
import 'package:flutter_test/flutter_test.dart';

final DateTime _now = DateTime.utc(2026, 7, 31, 12);
const SubscriptionReturnOwnerScope _owner = SubscriptionReturnOwnerScope(
  uid: 'owner-a',
  accountDocumentId: 'owner-a',
);

String _token() => 'A' * 43;

SubscriptionReturnInboxDelivery _delivery({
  SubscriptionReturnKind kind = SubscriptionReturnKind.checkoutSuccess,
}) {
  return SubscriptionReturnInboxDelivery(
    returnToken: _token(),
    kind: kind,
    firstSeenAt: _now,
    expiresAt: _now.add(subscriptionReturnRecordTtl),
  );
}

void main() {
  test(
    'redeem sends the exact v2 owner-document request and parses creation',
    () async {
      String? callable;
      Map<String, Object?>? payload;
      final client = SubscriptionReturnServerClient(
        clock: () => _now,
        invokeCallable: (name, request) async {
          callable = name;
          payload = request;
          return <String, Object?>{
            'returnProtocolVersion': 2,
            'created': true,
            'eventId': '1',
            'returnKind': 'checkoutSuccess',
          };
        },
      );

      final result = await client.redeem(
        ownerScope: _owner,
        delivery: _delivery(),
      );
      expect(callable, redeemSubscriptionReturnCallableName);
      expect(payload, <String, Object?>{
        'returnProtocolVersion': 2,
        'restaurantAccountDocumentId': 'owner-a',
        'returnToken': _token(),
        'returnKind': 'checkoutSuccess',
      });
      expect(result.created, isTrue);
      expect(result.eventId, '1');
      expect(result.kind, SubscriptionReturnKind.checkoutSuccess);
    },
  );

  test('already-consumed replay is an exact safe response', () async {
    final client = SubscriptionReturnServerClient(
      invokeCallable: (_, _) async => <String, Object?>{
        'returnProtocolVersion': 2,
        'created': false,
        'eventId': '8',
        'returnKind': 'customerPortal',
      },
    );
    final result = await client.redeem(
      ownerScope: _owner,
      delivery: _delivery(kind: SubscriptionReturnKind.customerPortal),
    );
    expect(result.created, isFalse);
    expect(result.eventId, '8');
  });

  test('list parses at most 32 safe owner-bound events', () async {
    Map<String, Object?>? payload;
    final client = SubscriptionReturnServerClient(
      clock: () => _now,
      invokeCallable: (name, request) async {
        expect(name, listSubscriptionReturnEventsCallableName);
        payload = request;
        return <String, Object?>{
          'returnProtocolVersion': 2,
          'events': <Object?>[
            <String, Object?>{
              'eventId': '2',
              'returnKind': 'checkoutCancel',
              'navigationClaimed': false,
              'refreshClaimed': true,
              'expiresAtEpochMs': _now
                  .add(const Duration(hours: 1))
                  .millisecondsSinceEpoch,
            },
          ],
        };
      },
    );

    final events = await client.listPending(ownerScope: _owner);
    expect(payload, <String, Object?>{
      'returnProtocolVersion': 2,
      'restaurantAccountDocumentId': 'owner-a',
    });
    expect(events, hasLength(1));
    expect(events.single.ownerScope, _owner);
    expect(events.single.id, '2');
    expect(events.single.kind, SubscriptionReturnKind.checkoutCancel);
    expect(events.single.navigationClaimed, isFalse);
    expect(events.single.refreshClaimed, isTrue);
  });

  for (final claimType in SubscriptionReturnClaimType.values) {
    test('claims ${claimType.name} with the exact request', () async {
      Map<String, Object?>? payload;
      final client = SubscriptionReturnServerClient(
        invokeCallable: (name, request) async {
          expect(name, claimSubscriptionReturnEventCallableName);
          payload = request;
          return <String, Object?>{
            'returnProtocolVersion': 2,
            'claimed': true,
            'eventId': '3',
            'returnKind': 'checkoutSuccess',
          };
        },
      );
      final result = await client.claim(
        ownerScope: _owner,
        eventId: '3',
        claimType: claimType,
      );
      expect(payload, <String, Object?>{
        'returnProtocolVersion': 2,
        'restaurantAccountDocumentId': 'owner-a',
        'eventId': '3',
        'claimType': claimType.name,
      });
      expect(result.claimed, isTrue);
      expect(result.kind, SubscriptionReturnKind.checkoutSuccess);
    });
  }

  test(
    'wrong owner/document rejection remains a controlled neutral failure',
    () async {
      final client = SubscriptionReturnServerClient(
        invokeCallable: (_, _) async =>
            throw const SubscriptionReturnServerException(
              SubscriptionReturnServerFailure.rejected,
            ),
      );
      await expectLater(
        client.redeem(ownerScope: _owner, delivery: _delivery()),
        throwsA(
          isA<SubscriptionReturnServerException>().having(
            (error) => error.failure,
            'failure',
            SubscriptionReturnServerFailure.rejected,
          ),
        ),
      );
    },
  );

  test(
    'generic network failure maps to unavailable without raw data',
    () async {
      final client = SubscriptionReturnServerClient(
        invokeCallable: (_, _) async =>
            throw StateError('sensitive raw failure'),
      );
      await expectLater(
        client.listPending(ownerScope: _owner),
        throwsA(
          isA<SubscriptionReturnServerException>().having(
            (error) => error.failure,
            'failure',
            SubscriptionReturnServerFailure.unavailable,
          ),
        ),
      );
    },
  );

  test('unknown/extra/mismatched response data fails closed', () async {
    for (final response in <Object?>[
      <String, Object?>{
        'returnProtocolVersion': 2,
        'created': true,
        'eventId': '1',
        'returnKind': 'checkoutSuccess',
        'extra': true,
      },
      <String, Object?>{
        'returnProtocolVersion': 1,
        'created': true,
        'eventId': '1',
        'returnKind': 'checkoutSuccess',
      },
      <String, Object?>{
        'returnProtocolVersion': 2,
        'created': true,
        'eventId': '0',
        'returnKind': 'checkoutSuccess',
      },
      <String, Object?>{
        'returnProtocolVersion': 2,
        'created': true,
        'eventId': '1',
        'returnKind': 'customerPortal',
      },
      <String, Object?>{
        'returnProtocolVersion': 2,
        'eventId': '1',
        'returnKind': 'checkoutSuccess',
      },
      <String, Object?>{
        'returnProtocolVersion': 2,
        'created': 'true',
        'eventId': '1',
        'returnKind': 'checkoutSuccess',
      },
      for (final hostileVersion in <Object?>[
        2.0,
        double.nan,
        double.infinity,
        true,
        '2',
        null,
      ])
        <String, Object?>{
          'returnProtocolVersion': hostileVersion,
          'created': true,
          'eventId': '1',
          'returnKind': 'checkoutSuccess',
        },
    ]) {
      final client = SubscriptionReturnServerClient(
        invokeCallable: (_, _) async => response,
      );
      await expectLater(
        client.redeem(ownerScope: _owner, delivery: _delivery()),
        throwsA(
          isA<SubscriptionReturnServerException>().having(
            (error) => error.failure,
            'failure',
            SubscriptionReturnServerFailure.invalidResponse,
          ),
        ),
      );
    }
  });

  test(
    'expired, future, duplicate, and over-capacity list data fails closed',
    () async {
      Map<String, Object?> event(String id, int expiresAt) => <String, Object?>{
        'eventId': id,
        'returnKind': 'checkoutSuccess',
        'navigationClaimed': false,
        'refreshClaimed': false,
        'expiresAtEpochMs': expiresAt,
      };

      final invalidLists = <List<Object?>>[
        <Object?>[event('1', _now.millisecondsSinceEpoch)],
        <Object?>[
          <String, Object?>{
            ...event(
              '1',
              _now.add(const Duration(hours: 1)).millisecondsSinceEpoch,
            ),
            'navigationClaimed': true,
            'refreshClaimed': true,
          },
        ],
        <Object?>[
          event(
            '1',
            _now
                .add(subscriptionReturnRecordTtl)
                .add(subscriptionReturnAllowedClockSkew)
                .add(const Duration(milliseconds: 1))
                .millisecondsSinceEpoch,
          ),
        ],
        <Object?>[
          event('1', _now.add(const Duration(hours: 1)).millisecondsSinceEpoch),
          event('1', _now.add(const Duration(hours: 1)).millisecondsSinceEpoch),
        ],
        <Object?>[
          for (var index = 1; index <= 33; index += 1)
            event(
              '$index',
              _now.add(const Duration(hours: 1)).millisecondsSinceEpoch,
            ),
        ],
      ];

      for (final events in invalidLists) {
        final client = SubscriptionReturnServerClient(
          clock: () => _now,
          invokeCallable: (_, _) async => <String, Object?>{
            'returnProtocolVersion': 2,
            'events': events,
          },
        );
        await expectLater(
          client.listPending(ownerScope: _owner),
          throwsA(isA<SubscriptionReturnServerException>()),
        );
      }
    },
  );

  test(
    'near-maximum client clock fails closed without DateTime leakage',
    () async {
      final maximum = DateTime.fromMillisecondsSinceEpoch(
        8640000000000000,
        isUtc: true,
      );
      final client = SubscriptionReturnServerClient(
        clock: () => maximum,
        invokeCallable: (_, _) async => <String, Object?>{
          'returnProtocolVersion': 2,
          'events': const <Object?>[],
        },
      );
      await expectLater(
        client.listPending(ownerScope: _owner),
        throwsA(
          isA<SubscriptionReturnServerException>().having(
            (error) => error.failure,
            'failure',
            SubscriptionReturnServerFailure.invalidResponse,
          ),
        ),
      );
    },
  );

  test('list independently rejects non-integer protocol versions', () async {
    for (final hostileVersion in <Object?>[2.0, '2']) {
      final client = SubscriptionReturnServerClient(
        clock: () => _now,
        invokeCallable: (_, _) async => <String, Object?>{
          'returnProtocolVersion': hostileVersion,
          'events': const <Object?>[],
        },
      );
      await expectLater(
        client.listPending(ownerScope: _owner),
        throwsA(
          isA<SubscriptionReturnServerException>().having(
            (error) => error.failure,
            'failure',
            SubscriptionReturnServerFailure.invalidResponse,
          ),
        ),
      );
    }
  });

  test('claim independently rejects non-integer protocol versions', () async {
    for (final hostileVersion in <Object?>[2.0, true]) {
      final client = SubscriptionReturnServerClient(
        invokeCallable: (_, _) async => <String, Object?>{
          'returnProtocolVersion': hostileVersion,
          'claimed': true,
          'eventId': '3',
          'returnKind': 'checkoutSuccess',
        },
      );
      await expectLater(
        client.claim(
          ownerScope: _owner,
          eventId: '3',
          claimType: SubscriptionReturnClaimType.refresh,
        ),
        throwsA(
          isA<SubscriptionReturnServerException>().having(
            (error) => error.failure,
            'failure',
            SubscriptionReturnServerFailure.invalidResponse,
          ),
        ),
      );
    }
  });

  test('callable client emits no token, event, or owner logs', () async {
    final printed = <String>[];
    await runZoned(
      () async {
        final client = SubscriptionReturnServerClient(
          invokeCallable: (_, _) async => <String, Object?>{
            'returnProtocolVersion': 2,
            'created': true,
            'eventId': '4',
            'returnKind': 'checkoutSuccess',
          },
        );
        await client.redeem(ownerScope: _owner, delivery: _delivery());
      },
      zoneSpecification: ZoneSpecification(
        print: (_, _, _, line) => printed.add(line),
      ),
    );
    expect(printed, isEmpty);
  });
}
