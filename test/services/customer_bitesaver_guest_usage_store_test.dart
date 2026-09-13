import 'dart:async';
import 'dart:convert';

import 'package:coupon_app/models/customer_bitesaver_favorite.dart';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:coupon_app/services/customer_bitesaver_guest_usage_store.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const guestDeviceId = 'guest-test-device';
  final restaurantId = _restaurantId(1);
  final offerId = _offerId(1);
  final secondOfferId = _offerId(2);
  const firstLogicalId = 'guest-redemption-request-0001';
  const secondLogicalId = 'guest-redemption-request-0002';
  final startAt = DateTime.parse(
    '2026-09-09T12:00:00.000Z',
  ).millisecondsSinceEpoch;
  late int clockMillis;
  late _FakePreferences preferences;
  late CustomerBiteSaverGuestUsageStore store;

  CustomerBiteSaverEvaluationContext context(
    int evaluationAtMillis, {
    String timeZone = 'America/New_York',
    int utcOffsetMinutes = -240,
    int? validUntilExclusiveMillis,
    List<CustomerBiteSaverOncePerDayUnavailableWindow>? windows,
  }) {
    return CustomerBiteSaverEvaluationContext(
      sessionId: 'bss_${_repeat('s', 43)}',
      attemptGeneration: 0,
      queryFingerprint: _repeat('c', 64),
      evaluationAtMillis: evaluationAtMillis,
      timeZone: timeZone,
      utcOffsetMinutes: utcOffsetMinutes,
      availabilityGeneration: _repeat('a', 64),
      validUntilExclusiveMillis:
          validUntilExclusiveMillis ??
          evaluationAtMillis +
              CustomerBiteSaverSearchContract
                  .usageEvaluationMaximumLifetimeMilliseconds,
      oncePerDayUnavailableWindows:
          windows ??
          <CustomerBiteSaverOncePerDayUnavailableWindow>[
            CustomerBiteSaverOncePerDayUnavailableWindow(
              startAtMillisInclusive: evaluationAtMillis >= 86400000
                  ? evaluationAtMillis - 86400000
                  : 0,
              endAtMillisExclusive: evaluationAtMillis + 1,
            ),
          ],
    );
  }

  CustomerBiteSaverGuestCheckCandidate candidate(
    CustomerBiteSaverOfferId id,
    CustomerBiteSaverGuestUsagePolicy policy,
  ) {
    return CustomerBiteSaverGuestCheckCandidate(
      offerId: id,
      usagePolicy: policy,
    );
  }

  Future<CustomerBiteSaverGuestRedemptionStart> start({
    String logicalId = firstLogicalId,
    CustomerBiteSaverRestaurantId? restaurant,
    CustomerBiteSaverOfferId? offer,
    CustomerBiteSaverGuestUsagePolicy policy =
        CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
    int? evaluationAtMillis,
    CustomerBiteSaverEvaluationContext? evaluationContext,
    int expectedRevision = 0,
    bool reusableAfterTimer = false,
  }) {
    final evaluatedAt = evaluationAtMillis ?? startAt;
    return store.startRedemption(
      redemptionRequestId: logicalId,
      restaurantId: restaurant ?? restaurantId,
      offerId: offer ?? offerId,
      usagePolicy: policy,
      evaluationContext: evaluationContext ?? context(evaluatedAt),
      validationExpiresAtMillis: evaluatedAt + 60000,
      expectedGuestStateRevision: expectedRevision,
      reusableAfterTimer: reusableAfterTimer,
    );
  }

  setUp(() {
    clockMillis = startAt;
    preferences = _FakePreferences();
    store = CustomerBiteSaverGuestUsageStore(
      guestDeviceId: guestDeviceId,
      preferences: preferences,
      clock: () =>
          DateTime.fromMillisecondsSinceEpoch(clockMillis, isUtc: true),
    );
  });

  test(
    'uses only the fresh device namespace and genuine absence is unused',
    () async {
      preferences.values['guest_coupon_redemptions_$guestDeviceId'] =
          jsonEncode(<String, Object?>{
            offerId.value: <String, Object?>{'used': true},
          });

      expect(await store.readRevision(), 0);
      final result = await store.evaluateCandidates(
        <CustomerBiteSaverGuestCheckCandidate>[
          candidate(offerId, CustomerBiteSaverGuestUsagePolicy.oncePerCustomer),
        ],
        context(startAt),
      );

      expect(result.guestStateRevision, 0);
      expect(result.allEvaluated, isTrue);
      expect(result.unavailableOfferIds, isEmpty);
      expect(
        preferences.readKeys,
        isNot(contains('guest_coupon_redemptions_$guestDeviceId')),
      );
      expect(store.metaKey, 'bitesaver_guest_usage_v1:$guestDeviceId:meta');
      expect(
        store.journalKey,
        'bitesaver_guest_usage_v1:$guestDeviceId:journal',
      );
      expect(
        store.offerKey(offerId),
        'bitesaver_guest_usage_v1:$guestDeviceId:offer:${offerId.value}',
      );
    },
  );

  test(
    'strictly distinguishes corrupt data and read failures from absence',
    () async {
      final oneCandidate = <CustomerBiteSaverGuestCheckCandidate>[
        candidate(offerId, CustomerBiteSaverGuestUsagePolicy.oncePerCustomer),
      ];
      preferences.values[store.metaKey] = '{';
      await _expectFailure(
        store.evaluateCandidates(oneCandidate, context(startAt)),
        CustomerBiteSaverGuestUsageFailure.corruptData,
      );

      preferences.values.clear();
      preferences.values[store.metaKey] = jsonEncode(_meta(1));
      preferences.values[store.offerKey(
        offerId,
      )] = jsonEncode(<String, Object?>{
        ..._offer(
          restaurantId: restaurantId,
          offerId: offerId,
          logicalId: firstLogicalId,
          startedAtMillis: startAt,
        ),
        'unexpected': true,
      });
      await _expectFailure(
        store.evaluateCandidates(oneCandidate, context(startAt)),
        CustomerBiteSaverGuestUsageFailure.corruptData,
      );

      preferences.values.clear();
      preferences.throwOnReadKey = store.offerKey(offerId);
      await _expectFailure(
        store.evaluateCandidates(oneCandidate, context(startAt)),
        CustomerBiteSaverGuestUsageFailure.readFailed,
      );

      preferences.throwOnReadKey = null;
      preferences.values[store.journalKey] = '{}';
      await _expectFailure(
        store.readRevision(),
        CustomerBiteSaverGuestUsageFailure.corruptData,
      );
    },
  );

  test('an active index entry without its offer record fails closed', () async {
    preferences.values[store.metaKey] = jsonEncode(
      _meta(1, activeOfferIds: <String>[offerId.value]),
    );
    await _expectFailure(
      store.evaluateCandidates(<CustomerBiteSaverGuestCheckCandidate>[
        candidate(offerId, CustomerBiteSaverGuestUsagePolicy.oncePerCustomer),
      ], context(startAt)),
      CustomerBiteSaverGuestUsageFailure.corruptData,
    );
  });

  test(
    'reads only journal, metadata twice, and the bounded candidates',
    () async {
      preferences.values[store.metaKey] = jsonEncode(_meta(1001));
      for (var index = 0; index < 1001; index += 1) {
        final historicalOfferId = _offerId(index + 100);
        preferences.values[store.offerKey(historicalOfferId)] = jsonEncode(
          _offer(
            restaurantId: restaurantId,
            offerId: historicalOfferId,
            logicalId: 'historical-request-${index.toString().padLeft(4, '0')}',
            startedAtMillis: startAt - 86400000,
          ),
        );
      }
      final candidates = List<CustomerBiteSaverGuestCheckCandidate>.generate(
        customerBiteSaverGuestCheckMaximumCandidates,
        (index) => candidate(
          _offerId(index + 2000),
          CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
        ),
      );

      final result = await store.evaluateCandidates(
        candidates,
        context(startAt),
      );

      expect(result.allEvaluated, isTrue);
      expect(result.unavailableOfferIds, isEmpty);
      expect(
        preferences.readKeys.where((key) => key == store.journalKey),
        hasLength(1),
      );
      expect(
        preferences.readKeys.where((key) => key == store.metaKey),
        hasLength(2),
      );
      expect(
        preferences.readKeys.where((key) => key.contains(':offer:')),
        hasLength(customerBiteSaverGuestCheckMaximumCandidates),
      );
      expect(
        preferences.readKeys,
        hasLength(customerBiteSaverGuestCheckMaximumCandidates + 3),
      );
    },
  );

  test(
    'rejects duplicate and oversized candidate batches without reads',
    () async {
      final duplicate = candidate(
        offerId,
        CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
      );
      await _expectFailure(
        store.evaluateCandidates(<CustomerBiteSaverGuestCheckCandidate>[
          duplicate,
          duplicate,
        ], context(startAt)),
        CustomerBiteSaverGuestUsageFailure.invalidArgument,
      );
      await _expectFailure(
        store.evaluateCandidates(
          List<CustomerBiteSaverGuestCheckCandidate>.generate(
            customerBiteSaverGuestCheckMaximumCandidates + 1,
            (index) => candidate(
              _offerId(index + 3000),
              CustomerBiteSaverGuestUsagePolicy.oncePerDay,
            ),
          ),
          context(startAt),
        ),
        CustomerBiteSaverGuestUsageFailure.invalidArgument,
      );
      expect(preferences.readKeys, isEmpty);
    },
  );

  test('a start persists exact closed schemas and increments once', () async {
    final result = await start();

    expect(result.status, CustomerBiteSaverGuestRedemptionStartStatus.started);
    expect(result.didMutate, isTrue);
    expect(result.guestStateRevision, 1);
    expect(result.timerStartedAtMillis, startAt);
    expect(
      result.timerExpiresAtMillis,
      startAt + customerBiteSaverGuestRedemptionTimerDuration.inMilliseconds,
    );
    expect(await store.readRevision(), 1);
    expect(preferences.values[store.journalKey], isNull);

    final meta =
        jsonDecode(preferences.values[store.metaKey]!) as Map<String, dynamic>;
    expect(meta.keys.toSet(), <String>{
      'schemaVersion',
      'guestStateRevision',
      'activeOfferIds',
    });
    expect(meta['guestStateRevision'], 1);
    expect(meta['activeOfferIds'], <String>[offerId.value]);

    final offer =
        jsonDecode(preferences.values[store.offerKey(offerId)]!)
            as Map<String, dynamic>;
    expect(offer.keys.toSet(), <String>{
      'schemaVersion',
      'restaurantId',
      'offerId',
      'redemptionRequestId',
      'usagePolicy',
      'reusableAfterTimer',
      'committedRevision',
      'evaluationContext',
      'validationExpiresAtMillis',
      'timerStartedAtMillis',
      'timerExpiresAtMillis',
    });
    expect(offer['restaurantId'], restaurantId.value);
    expect(offer['offerId'], offerId.value);
    expect(offer['redemptionRequestId'], firstLogicalId);
    expect(offer['usagePolicy'], 'oncePerCustomer');
    expect(offer['reusableAfterTimer'], isFalse);
    expect(offer['committedRevision'], 1);
    expect(_map(offer['evaluationContext'])['timeZone'], 'America/New_York');
    expect(_map(offer['evaluationContext'])['utcOffsetMinutes'], -240);
    expect(
      _map(offer['evaluationContext'])['availabilityGeneration'],
      _repeat('a', 64),
    );
    expect(offer['validationExpiresAtMillis'], startAt + 60000);

    final journalWrite = preferences.mutations.firstWhere(
      (mutation) => mutation.key == store.journalKey && mutation.value != null,
    );
    final journal = jsonDecode(journalWrite.value!) as Map<String, dynamic>;
    expect(journal.keys.toSet(), <String>{
      'schemaVersion',
      'mutationKind',
      'previousMeta',
      'nextMeta',
      'previousOffer',
      'nextOffer',
    });
    expect(journal['previousMeta'], isNull);
    expect(journal['previousOffer'], isNull);
  });

  test(
    'exact replay preserves anchors and revision while active is a no-op',
    () async {
      final first = await start();
      final mutationCount = preferences.mutations.length;

      final replay = await start();
      expect(
        replay.status,
        CustomerBiteSaverGuestRedemptionStartStatus.replayed,
      );
      expect(replay.didMutate, isFalse);
      expect(replay.timerStartedAtMillis, first.timerStartedAtMillis);
      expect(replay.timerExpiresAtMillis, first.timerExpiresAtMillis);
      expect(replay.guestStateRevision, 1);
      expect(preferences.mutations, hasLength(mutationCount));

      final active = await start(
        logicalId: secondLogicalId,
        evaluationAtMillis: startAt + 1000,
        expectedRevision: 1,
      );
      expect(active.status, CustomerBiteSaverGuestRedemptionStartStatus.active);
      expect(active.redemptionRequestId, firstLogicalId);
      expect(active.timerStartedAtMillis, first.timerStartedAtMillis);
      expect(active.guestStateRevision, 1);
      expect(preferences.mutations, hasLength(mutationCount));
    },
  );

  test('exact replay rejects changed immutable start input', () async {
    await start();
    final mutationCount = preferences.mutations.length;

    Future<void> expectInvalid(Future<Object?> operation) => _expectFailure(
      operation,
      CustomerBiteSaverGuestUsageFailure.invalidArgument,
    );

    await expectInvalid(
      start(
        policy: CustomerBiteSaverGuestUsagePolicy.oncePerDay,
        expectedRevision: 0,
      ),
    );
    await expectInvalid(start(expectedRevision: 0, reusableAfterTimer: true));
    await expectInvalid(
      start(evaluationAtMillis: startAt + 1, expectedRevision: 0),
    );
    await expectInvalid(
      store.startRedemption(
        redemptionRequestId: firstLogicalId,
        restaurantId: restaurantId,
        offerId: offerId,
        usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
        evaluationContext: CustomerBiteSaverEvaluationContext(
          sessionId: 'bss_${_repeat('t', 43)}',
          attemptGeneration: 1,
          queryFingerprint: _repeat('d', 64),
          evaluationAtMillis: startAt,
          timeZone: 'UTC',
          utcOffsetMinutes: 0,
          availabilityGeneration: _repeat('b', 64),
          validUntilExclusiveMillis:
              startAt +
              CustomerBiteSaverSearchContract
                  .usageEvaluationMaximumLifetimeMilliseconds,
          oncePerDayUnavailableWindows:
              <CustomerBiteSaverOncePerDayUnavailableWindow>[
                CustomerBiteSaverOncePerDayUnavailableWindow(
                  startAtMillisInclusive: startAt - 86400000,
                  endAtMillisExclusive: startAt + 1,
                ),
              ],
        ),
        validationExpiresAtMillis: startAt + 59999,
        expectedGuestStateRevision: 0,
      ),
    );

    expect(preferences.mutations, hasLength(mutationCount));
    expect(await store.readRevision(), 1);
  });

  test(
    'lost response remains exactly replayable after an unrelated commit',
    () async {
      final first = await start();
      await start(
        logicalId: secondLogicalId,
        offer: secondOfferId,
        expectedRevision: 1,
      );
      final mutationCount = preferences.mutations.length;
      clockMillis = startAt + 60000;

      final replay = await start(expectedRevision: 0);

      expect(
        replay.status,
        CustomerBiteSaverGuestRedemptionStartStatus.replayed,
      );
      expect(replay.timerStartedAtMillis, first.timerStartedAtMillis);
      expect(replay.timerExpiresAtMillis, first.timerExpiresAtMillis);
      expect(replay.guestStateRevision, 2);
      expect(preferences.mutations, hasLength(mutationCount));
      expect(await store.readRevision(), 2);
    },
  );

  test(
    'exact replay survives expiry pruning without changing the newer state',
    () async {
      final first = await start();
      final secondEvaluationAt = first.timerExpiresAtMillis + 1;
      clockMillis = secondEvaluationAt;
      final second = await start(
        logicalId: secondLogicalId,
        offer: secondOfferId,
        evaluationAtMillis: secondEvaluationAt,
        expectedRevision: 1,
      );

      expect(
        second.status,
        CustomerBiteSaverGuestRedemptionStartStatus.started,
      );
      expect(second.guestStateRevision, 2);
      final metaBefore = preferences.values[store.metaKey];
      final firstBefore = preferences.values[store.offerKey(offerId)];
      final secondBefore = preferences.values[store.offerKey(secondOfferId)];
      final journalBefore = preferences.values[store.journalKey];
      final mutationCount = preferences.mutations.length;
      expect(_map(jsonDecode(metaBefore!))['guestStateRevision'], 2);
      expect(_map(jsonDecode(metaBefore))['activeOfferIds'], <String>[
        secondOfferId.value,
      ]);

      for (var retry = 0; retry < 2; retry += 1) {
        final replay = await start(expectedRevision: 0);
        expect(
          replay.status,
          CustomerBiteSaverGuestRedemptionStartStatus.replayed,
        );
        expect(replay.didMutate, isFalse);
        expect(replay.redemptionRequestId, firstLogicalId);
        expect(replay.timerStartedAtMillis, first.timerStartedAtMillis);
        expect(replay.timerExpiresAtMillis, first.timerExpiresAtMillis);
        expect(replay.guestStateRevision, 2);
      }

      expect(preferences.mutations, hasLength(mutationCount));
      expect(preferences.values[store.metaKey], metaBefore);
      expect(preferences.values[store.offerKey(offerId)], firstBefore);
      expect(preferences.values[store.offerKey(secondOfferId)], secondBefore);
      expect(preferences.values[store.journalKey], journalBefore);
      expect(
        _map(jsonDecode(preferences.values[store.metaKey]!))['activeOfferIds'],
        <String>[secondOfferId.value],
      );
    },
  );

  test(
    'expired pruned history accepts only the exact committed request',
    () async {
      final first = await start();
      final secondEvaluationAt = first.timerExpiresAtMillis + 1;
      clockMillis = secondEvaluationAt;
      await start(
        logicalId: secondLogicalId,
        offer: secondOfferId,
        evaluationAtMillis: secondEvaluationAt,
        expectedRevision: 1,
      );
      final mutationCount = preferences.mutations.length;

      await _expectFailure(
        start(logicalId: 'guest-redemption-request-changed'),
        CustomerBiteSaverGuestUsageFailure.validationExpired,
      );
      await _expectFailure(
        start(restaurant: _restaurantId(9)),
        CustomerBiteSaverGuestUsageFailure.validationExpired,
      );
      await _expectFailure(
        start(offer: secondOfferId),
        CustomerBiteSaverGuestUsageFailure.validationExpired,
      );
      await _expectFailure(
        start(policy: CustomerBiteSaverGuestUsagePolicy.oncePerDay),
        CustomerBiteSaverGuestUsageFailure.validationExpired,
      );
      await _expectFailure(
        start(reusableAfterTimer: true),
        CustomerBiteSaverGuestUsageFailure.validationExpired,
      );

      expect(preferences.mutations, hasLength(mutationCount));
      expect(await store.readRevision(), 2);
    },
  );

  test('non-replay requests still enforce active index consistency', () async {
    await start();
    preferences.values[store.metaKey] = jsonEncode(_meta(1));

    await _expectFailure(
      start(
        logicalId: secondLogicalId,
        evaluationAtMillis: startAt + 1,
        expectedRevision: 1,
      ),
      CustomerBiteSaverGuestUsageFailure.corruptData,
    );
  });

  test(
    'same-revision exact replay still rejects a missing active index',
    () async {
      await start();
      preferences.values[store.metaKey] = jsonEncode(_meta(1));

      await _expectFailure(
        start(),
        CustomerBiteSaverGuestUsageFailure.corruptData,
      );
    },
  );

  test('same-ID changed payload cannot mask a missing active index', () async {
    await start();
    preferences.values[store.metaKey] = jsonEncode(_meta(1));
    final mutationCount = preferences.mutations.length;

    await _expectFailure(
      start(
        policy: CustomerBiteSaverGuestUsagePolicy.oncePerDay,
        expectedRevision: 0,
      ),
      CustomerBiteSaverGuestUsageFailure.corruptData,
    );

    expect(preferences.mutations, hasLength(mutationCount));
  });

  test(
    'validation deadline and revision are rechecked before success',
    () async {
      clockMillis = startAt + 60000;
      await _expectFailure(
        start(),
        CustomerBiteSaverGuestUsageFailure.validationExpired,
      );
      expect(preferences.mutations, isEmpty);

      clockMillis = startAt;
      preferences.afterRead = (key) {
        if (key == store.offerKey(offerId)) {
          clockMillis = startAt + 60000;
        }
      };
      await _expectFailure(
        start(),
        CustomerBiteSaverGuestUsageFailure.validationExpired,
      );
      expect(preferences.mutations, isEmpty);

      clockMillis = startAt;
      preferences.afterRead = null;
      preferences.values[store.metaKey] = jsonEncode(_meta(2));
      await _expectFailure(
        start(expectedRevision: 1),
        CustomerBiteSaverGuestUsageFailure.revisionChanged,
      );
      expect(preferences.mutations, isEmpty);
    },
  );

  test(
    'a restarted store recovers an active timer with its original anchors',
    () async {
      final first = await start();
      final restarted = CustomerBiteSaverGuestUsageStore(
        guestDeviceId: guestDeviceId,
        preferences: preferences,
        clock: () =>
            DateTime.fromMillisecondsSinceEpoch(clockMillis, isUtc: true),
      );

      final recovered = await restarted.startRedemption(
        redemptionRequestId: secondLogicalId,
        restaurantId: restaurantId,
        offerId: offerId,
        usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
        evaluationContext: context(startAt + 1000),
        validationExpiresAtMillis: startAt + 61000,
        expectedGuestStateRevision: 1,
      );

      expect(
        recovered.status,
        CustomerBiteSaverGuestRedemptionStartStatus.active,
      );
      expect(recovered.timerStartedAtMillis, first.timerStartedAtMillis);
      expect(recovered.timerExpiresAtMillis, first.timerExpiresAtMillis);
      expect(recovered.guestStateRevision, 1);
    },
  );

  test(
    'active timer is available, then once-per-customer is unavailable',
    () async {
      final started = await start();
      final check = candidate(
        offerId,
        CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
      );

      final active = await store.evaluateCandidates(
        <CustomerBiteSaverGuestCheckCandidate>[check],
        context(started.timerExpiresAtMillis - 1),
      );
      expect(active.unavailableOfferIds, isEmpty);
      expect(
        active.activeTimerExpiresAtMillisByOfferId[offerId],
        started.timerExpiresAtMillis,
      );

      final completed = await store.evaluateCandidates(
        <CustomerBiteSaverGuestCheckCandidate>[check],
        context(started.timerExpiresAtMillis),
      );
      expect(completed.unavailableOfferIds, <CustomerBiteSaverOfferId>[
        offerId,
      ]);

      final later = await store.evaluateCandidates(
        <CustomerBiteSaverGuestCheckCandidate>[check],
        context(started.timerExpiresAtMillis + 10 * 86400000),
      );
      expect(later.unavailableOfferIds, <CustomerBiteSaverOfferId>[offerId]);
    },
  );

  test('current signed policy controls retained completed evidence', () async {
    final started = await start();
    final evaluatedAt = started.timerExpiresAtMillis;
    final evaluationContext = context(evaluatedAt);

    final restrictive = await store
        .evaluateLocalCandidates(<CustomerBiteSaverLocalUsageCandidate>[
          CustomerBiteSaverLocalUsageCandidate(
            offerId: offerId,
            usagePolicy: CustomerBiteSaverUsagePolicy.oncePerCustomer,
          ),
        ], evaluationContext);
    expect(restrictive.unavailableOfferIds, <CustomerBiteSaverOfferId>[
      offerId,
    ]);

    for (final policy in <CustomerBiteSaverUsagePolicy>[
      CustomerBiteSaverUsagePolicy.unlimited,
      CustomerBiteSaverUsagePolicy.reusableAfterTimer,
    ]) {
      final changed = await store.evaluateLocalCandidates(
        <CustomerBiteSaverLocalUsageCandidate>[
          CustomerBiteSaverLocalUsageCandidate(
            offerId: offerId,
            usagePolicy: policy,
          ),
        ],
        evaluationContext,
      );
      expect(changed.unavailableOfferIds, isEmpty, reason: policy.name);
      expect(
        changed.activeTimerExpiresAtMillisByOfferId,
        isEmpty,
        reason: policy.name,
      );
    }
  });

  test(
    'expired evaluation metadata fails before targeted history reads',
    () async {
      final expired = context(startAt, validUntilExclusiveMillis: startAt + 1);
      clockMillis = expired.validUntilExclusiveMillis;
      preferences.readKeys.clear();

      await _expectFailure(
        store.evaluateLocalCandidates(<CustomerBiteSaverLocalUsageCandidate>[
          CustomerBiteSaverLocalUsageCandidate(
            offerId: offerId,
            usagePolicy: CustomerBiteSaverUsagePolicy.oncePerCustomer,
          ),
        ], expired),
        CustomerBiteSaverGuestUsageFailure.evaluationExpired,
      );
      expect(preferences.readKeys, isEmpty);
    },
  );

  test(
    'once-per-day resets at local 00:01 and permits one new mutation',
    () async {
      final first = await start(
        policy: CustomerBiteSaverGuestUsagePolicy.oncePerDay,
      );
      final check = candidate(
        offerId,
        CustomerBiteSaverGuestUsagePolicy.oncePerDay,
      );
      final justBeforeReset = DateTime.parse(
        '2026-09-10T04:00:59.999Z',
      ).millisecondsSinceEpoch;
      final atReset = DateTime.parse(
        '2026-09-10T04:01:00.000Z',
      ).millisecondsSinceEpoch;
      final currentDayStart = DateTime.parse(
        '2026-09-10T04:00:00.000Z',
      ).millisecondsSinceEpoch;
      final previousDayStart = DateTime.parse(
        '2026-09-09T04:00:00.000Z',
      ).millisecondsSinceEpoch;

      expect(
        (await store.evaluateCandidates(
          <CustomerBiteSaverGuestCheckCandidate>[check],
          context(
            justBeforeReset,
            windows: <CustomerBiteSaverOncePerDayUnavailableWindow>[
              CustomerBiteSaverOncePerDayUnavailableWindow(
                startAtMillisInclusive: previousDayStart,
                endAtMillisExclusive: justBeforeReset + 1,
              ),
            ],
          ),
        )).unavailableOfferIds,
        <CustomerBiteSaverOfferId>[offerId],
      );
      expect(
        (await store.evaluateCandidates(
          <CustomerBiteSaverGuestCheckCandidate>[check],
          context(
            atReset,
            windows: <CustomerBiteSaverOncePerDayUnavailableWindow>[
              CustomerBiteSaverOncePerDayUnavailableWindow(
                startAtMillisInclusive: currentDayStart,
                endAtMillisExclusive: atReset + 1,
              ),
            ],
          ),
        )).unavailableOfferIds,
        isEmpty,
      );

      clockMillis = atReset;
      final second = await start(
        logicalId: secondLogicalId,
        policy: CustomerBiteSaverGuestUsagePolicy.oncePerDay,
        evaluationAtMillis: atReset,
        evaluationContext: context(
          atReset,
          windows: <CustomerBiteSaverOncePerDayUnavailableWindow>[
            CustomerBiteSaverOncePerDayUnavailableWindow(
              startAtMillisInclusive: currentDayStart,
              endAtMillisExclusive: atReset + 1,
            ),
          ],
        ),
        expectedRevision: 1,
      );
      expect(
        second.status,
        CustomerBiteSaverGuestRedemptionStartStatus.started,
      );
      expect(second.guestStateRevision, 2);
      expect(second.timerStartedAtMillis, atReset);
      expect(second.timerStartedAtMillis, isNot(first.timerStartedAtMillis));
    },
  );

  test(
    'two-window rollback descriptor evaluates each absolute interval',
    () async {
      final evaluationAt = DateTime.parse(
        '2000-10-29T03:31:00.000Z',
      ).millisecondsSinceEpoch;
      final completions = <int>[
        DateTime.parse('2000-10-29T02:30:30.000Z').millisecondsSinceEpoch,
        DateTime.parse('2000-10-29T03:00:00.000Z').millisecondsSinceEpoch,
        DateTime.parse('2000-10-29T03:30:30.000Z').millisecondsSinceEpoch,
      ];
      final offers = <CustomerBiteSaverOfferId>[
        _offerId(31),
        _offerId(32),
        _offerId(33),
      ];
      for (var index = 0; index < offers.length; index += 1) {
        final startedAt =
            completions[index] -
            customerBiteSaverGuestRedemptionTimerDuration.inMilliseconds;
        clockMillis = startedAt;
        await start(
          logicalId: 'guest-rollback-request-${index + 1}'.padRight(28, '0'),
          offer: offers[index],
          policy: CustomerBiteSaverGuestUsagePolicy.oncePerDay,
          evaluationAtMillis: startedAt,
          expectedRevision: index,
        );
      }
      clockMillis = evaluationAt;
      final rollbackContext = context(
        evaluationAt,
        timeZone: 'America/St_Johns',
        utcOffsetMinutes: -210,
        windows: <CustomerBiteSaverOncePerDayUnavailableWindow>[
          CustomerBiteSaverOncePerDayUnavailableWindow(
            startAtMillisInclusive: DateTime.parse(
              '2000-10-29T02:30:00.000Z',
            ).millisecondsSinceEpoch,
            endAtMillisExclusive: DateTime.parse(
              '2000-10-29T02:31:00.000Z',
            ).millisecondsSinceEpoch,
          ),
          CustomerBiteSaverOncePerDayUnavailableWindow(
            startAtMillisInclusive: DateTime.parse(
              '2000-10-29T03:30:00.000Z',
            ).millisecondsSinceEpoch,
            endAtMillisExclusive: evaluationAt + 1,
          ),
        ],
      );

      final evaluated = await store
          .evaluateCandidates(<CustomerBiteSaverGuestCheckCandidate>[
            for (final offer in offers)
              candidate(offer, CustomerBiteSaverGuestUsagePolicy.oncePerDay),
          ], rollbackContext);

      expect(evaluated.unavailableOfferIds, <CustomerBiteSaverOfferId>[
        offers.first,
        offers.last,
      ]);
      expect(evaluated.activeTimerExpiresAtMillisByOfferId, isEmpty);
    },
  );

  test(
    'current non-hour-zone descriptor controls records created in another zone',
    () async {
      final beforeBoundary = DateTime.parse(
        '2026-10-03T13:29:59.999Z',
      ).millisecondsSinceEpoch;
      final atBoundary = DateTime.parse(
        '2026-10-03T13:30:00.000Z',
      ).millisecondsSinceEpoch;
      final evaluationAt = DateTime.parse(
        '2026-10-04T12:00:00.000Z',
      ).millisecondsSinceEpoch;
      final beforeOffer = _offerId(34);
      final boundaryOffer = _offerId(35);
      for (final entry in <(CustomerBiteSaverOfferId, int)>[
        (beforeOffer, beforeBoundary),
        (boundaryOffer, atBoundary),
      ]) {
        final startedAt =
            entry.$2 -
            customerBiteSaverGuestRedemptionTimerDuration.inMilliseconds;
        clockMillis = startedAt;
        await start(
          logicalId: entry.$1 == beforeOffer
              ? 'guest-lord-howe-before-0001'
              : 'guest-lord-howe-boundary-01',
          offer: entry.$1,
          policy: CustomerBiteSaverGuestUsagePolicy.oncePerDay,
          evaluationAtMillis: startedAt,
          expectedRevision: entry.$1 == beforeOffer ? 0 : 1,
        );
      }
      clockMillis = evaluationAt;
      final lordHoweContext = context(
        evaluationAt,
        timeZone: 'Australia/Lord_Howe',
        utcOffsetMinutes: 660,
        windows: <CustomerBiteSaverOncePerDayUnavailableWindow>[
          CustomerBiteSaverOncePerDayUnavailableWindow(
            startAtMillisInclusive: atBoundary,
            endAtMillisExclusive: evaluationAt + 1,
          ),
        ],
      );

      final evaluated = await store.evaluateCandidates(<
        CustomerBiteSaverGuestCheckCandidate
      >[
        candidate(beforeOffer, CustomerBiteSaverGuestUsagePolicy.oncePerDay),
        candidate(boundaryOffer, CustomerBiteSaverGuestUsagePolicy.oncePerDay),
      ], lordHoweContext);

      expect(evaluated.unavailableOfferIds, <CustomerBiteSaverOfferId>[
        boundaryOffer,
      ]);
    },
  );

  test('timer-only legacy policy can start a new timer after expiry', () async {
    final first = await start(reusableAfterTimer: true);
    clockMillis = first.timerExpiresAtMillis;

    final replay = await start(reusableAfterTimer: true);
    expect(replay.status, CustomerBiteSaverGuestRedemptionStartStatus.replayed);
    expect(replay.guestStateRevision, 1);
    expect(replay.timerStartedAtMillis, first.timerStartedAtMillis);
    expect(replay.timerExpiresAtMillis, first.timerExpiresAtMillis);

    final second = await start(
      logicalId: secondLogicalId,
      evaluationAtMillis: clockMillis,
      expectedRevision: 1,
      reusableAfterTimer: true,
    );

    expect(second.status, CustomerBiteSaverGuestRedemptionStartStatus.started);
    expect(second.guestStateRevision, 2);
    expect(second.timerStartedAtMillis, first.timerExpiresAtMillis);
    expect(
      second.timerExpiresAtMillis,
      greaterThan(first.timerExpiresAtMillis),
    );
  });

  test('New York spring-forward uses the completion-time civil day', () async {
    final startedAt = DateTime.parse(
      '2026-03-08T04:25:00.000Z',
    ).millisecondsSinceEpoch;
    clockMillis = startedAt;
    final started = await start(
      policy: CustomerBiteSaverGuestUsagePolicy.oncePerDay,
      evaluationAtMillis: startedAt,
    );
    expect(
      started.timerExpiresAtMillis,
      DateTime.parse('2026-03-08T04:30:00.000Z').millisecondsSinceEpoch,
    );

    final evaluation = DateTime.parse(
      '2026-03-08T07:30:00.000Z',
    ).millisecondsSinceEpoch;
    final result = await store.evaluateCandidates(
      <CustomerBiteSaverGuestCheckCandidate>[
        candidate(offerId, CustomerBiteSaverGuestUsagePolicy.oncePerDay),
      ],
      context(
        evaluation,
        utcOffsetMinutes: -240,
        windows: <CustomerBiteSaverOncePerDayUnavailableWindow>[
          CustomerBiteSaverOncePerDayUnavailableWindow(
            startAtMillisInclusive: DateTime.parse(
              '2026-03-08T05:00:00.000Z',
            ).millisecondsSinceEpoch,
            endAtMillisExclusive: evaluation + 1,
          ),
        ],
      ),
    );

    // 04:30Z was March 7 at 23:30 EST. The committed backend rule permits
    // reuse on March 8 at 03:30 EDT; applying the evaluation's -04:00
    // offset to that historical completion incorrectly says March 8.
    expect(result.unavailableOfferIds, isEmpty);
  });

  test(
    'authoritative windows, not the supplied offset, control history',
    () async {
      final startedAt = DateTime.parse(
        '2026-09-09T23:50:00.000Z',
      ).millisecondsSinceEpoch;
      clockMillis = startedAt;
      await start(
        policy: CustomerBiteSaverGuestUsagePolicy.oncePerDay,
        evaluationAtMillis: startedAt,
      );
      final check = candidate(
        offerId,
        CustomerBiteSaverGuestUsagePolicy.oncePerDay,
      );
      final evaluation = DateTime.parse(
        '2026-09-10T00:01:00.000Z',
      ).millisecondsSinceEpoch;
      final authoritativeWindows =
          <CustomerBiteSaverOncePerDayUnavailableWindow>[
            CustomerBiteSaverOncePerDayUnavailableWindow(
              startAtMillisInclusive: DateTime.parse(
                '2026-09-10T00:00:00.000Z',
              ).millisecondsSinceEpoch,
              endAtMillisExclusive: evaluation + 1,
            ),
          ];

      final utc = await store.evaluateCandidates(
        <CustomerBiteSaverGuestCheckCandidate>[check],
        context(evaluation, utcOffsetMinutes: 0, windows: authoritativeWindows),
      );
      final newYork = await store.evaluateCandidates(
        <CustomerBiteSaverGuestCheckCandidate>[check],
        context(
          evaluation,
          utcOffsetMinutes: -240,
          windows: authoritativeWindows,
        ),
      );
      expect(utc.unavailableOfferIds, isEmpty);
      expect(newYork.unavailableOfferIds, isEmpty);
    },
  );

  test('revision changing between bounded reads prevents an answer', () async {
    preferences.values[store.metaKey] = jsonEncode(_meta(4));
    var metaReads = 0;
    preferences.afterRead = (key) {
      if (key == store.metaKey && ++metaReads == 1) {
        scheduleMicrotask(() {
          preferences.values[store.metaKey] = jsonEncode(_meta(5));
        });
      }
    };

    await _expectFailure(
      store.evaluateCandidates(<CustomerBiteSaverGuestCheckCandidate>[
        candidate(
          secondOfferId,
          CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
        ),
      ], context(startAt)),
      CustomerBiteSaverGuestUsageFailure.revisionChanged,
    );
  });

  test('operations on one store are serialized', () async {
    final gate = Completer<void>();
    final mutationStarted = Completer<void>();
    preferences.beforeMutation = (mutationNumber, key, value) async {
      if (mutationNumber == 1) {
        mutationStarted.complete();
        await gate.future;
      }
    };

    final first = start();
    await mutationStarted.future;
    final second = start(
      logicalId: secondLogicalId,
      offer: secondOfferId,
      expectedRevision: 0,
    );
    await Future<void>.delayed(Duration.zero);
    expect(preferences.maximumConcurrentOperations, 1);
    expect(
      preferences.readKeys,
      isNot(contains(store.offerKey(secondOfferId))),
    );

    gate.complete();
    expect((await first).guestStateRevision, 1);
    await _expectFailure(
      second,
      CustomerBiteSaverGuestUsageFailure.revisionChanged,
    );
    expect(preferences.maximumConcurrentOperations, 1);
  });

  test(
    'operations across live stores share one device namespace queue',
    () async {
      final secondStore = CustomerBiteSaverGuestUsageStore(
        guestDeviceId: guestDeviceId,
        preferences: preferences,
        clock: () =>
            DateTime.fromMillisecondsSinceEpoch(clockMillis, isUtc: true),
      );
      final firstWriteEntered = Completer<void>();
      final firstWriteGate = Completer<void>();
      preferences.beforeMutation = (mutationNumber, key, value) async {
        if (mutationNumber == 1) {
          firstWriteEntered.complete();
          await firstWriteGate.future;
        }
      };

      final first = start();
      await firstWriteEntered.future;
      final second = secondStore.startRedemption(
        redemptionRequestId: secondLogicalId,
        restaurantId: restaurantId,
        offerId: secondOfferId,
        usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
        evaluationContext: context(startAt),
        validationExpiresAtMillis: startAt + 60000,
        expectedGuestStateRevision: 1,
      );
      await Future<void>.delayed(Duration.zero);

      expect(preferences.maximumConcurrentOperations, 1);
      expect(
        preferences.readKeys,
        isNot(contains(secondStore.offerKey(secondOfferId))),
      );

      firstWriteGate.complete();
      expect((await first).guestStateRevision, 1);
      expect((await second).guestStateRevision, 2);

      expect(await store.readRevision(), 2);
      final meta =
          jsonDecode(preferences.values[store.metaKey]!)
              as Map<String, dynamic>;
      expect(
        meta['activeOfferIds'],
        <String>[offerId.value, secondOfferId.value]..sort(),
      );
      expect(preferences.values[store.offerKey(offerId)], isNotNull);
      expect(preferences.values[store.offerKey(secondOfferId)], isNotNull);
      expect(preferences.values[store.journalKey], isNull);
      expect(preferences.maximumConcurrentOperations, 1);
    },
  );

  test('a failed initial journal write leaves no partial mutation', () async {
    preferences.throwOnMutationNumber = 1;
    await _expectFailure(
      start(),
      CustomerBiteSaverGuestUsageFailure.writeFailed,
    );
    expect(preferences.values[store.journalKey], isNull);
    expect(preferences.values[store.metaKey], isNull);
    expect(preferences.values[store.offerKey(offerId)], isNull);

    final restarted = CustomerBiteSaverGuestUsageStore(
      guestDeviceId: guestDeviceId,
      preferences: preferences,
      clock: () =>
          DateTime.fromMillisecondsSinceEpoch(clockMillis, isUtc: true),
    );
    final started = await restarted.startRedemption(
      redemptionRequestId: firstLogicalId,
      restaurantId: restaurantId,
      offerId: offerId,
      usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
      evaluationContext: context(startAt),
      validationExpiresAtMillis: startAt + 60000,
      expectedGuestStateRevision: 0,
    );
    expect(started.status, CustomerBiteSaverGuestRedemptionStartStatus.started);
    expect(started.guestStateRevision, 1);
  });

  for (final crashMutation in <int>[2, 3, 4]) {
    test(
      'journal recovers interrupted mutation stage $crashMutation',
      () async {
        preferences.throwOnMutationNumber = crashMutation;
        await _expectFailure(
          start(),
          CustomerBiteSaverGuestUsageFailure.writeFailed,
        );
        expect(preferences.values[store.journalKey], isNotNull);

        final restarted = CustomerBiteSaverGuestUsageStore(
          guestDeviceId: guestDeviceId,
          preferences: preferences,
          clock: () =>
              DateTime.fromMillisecondsSinceEpoch(clockMillis, isUtc: true),
        );
        expect(await restarted.readRevision(), 1);
        expect(preferences.values[restarted.journalKey], isNull);

        final replay = await restarted.startRedemption(
          redemptionRequestId: firstLogicalId,
          restaurantId: restaurantId,
          offerId: offerId,
          usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
          evaluationContext: context(startAt),
          validationExpiresAtMillis: startAt + 60000,
          expectedGuestStateRevision: 0,
        );
        expect(
          replay.status,
          CustomerBiteSaverGuestRedemptionStartStatus.replayed,
        );
        expect(replay.guestStateRevision, 1);
        expect(replay.timerStartedAtMillis, startAt);
      },
    );
  }

  for (final crashMutation in <int>[2, 3, 4]) {
    test(
      'expired exact retry rolls forward durable journal stage $crashMutation',
      () async {
        preferences.throwOnMutationNumber = crashMutation;
        await _expectFailure(
          start(),
          CustomerBiteSaverGuestUsageFailure.writeFailed,
        );

        final mutationCountBeforeRecovery = preferences.mutations.length;
        expect(preferences.values[store.journalKey], isNotNull);

        clockMillis = startAt + 60000;
        final restarted = CustomerBiteSaverGuestUsageStore(
          guestDeviceId: guestDeviceId,
          preferences: preferences,
          clock: () =>
              DateTime.fromMillisecondsSinceEpoch(clockMillis, isUtc: true),
        );

        await _expectFailure(
          restarted.startRedemption(
            redemptionRequestId: secondLogicalId,
            restaurantId: restaurantId,
            offerId: secondOfferId,
            usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
            evaluationContext: context(startAt),
            validationExpiresAtMillis: startAt + 60000,
            expectedGuestStateRevision: 0,
          ),
          CustomerBiteSaverGuestUsageFailure.validationExpired,
        );
        expect(preferences.mutations, hasLength(mutationCountBeforeRecovery));
        expect(preferences.values[store.journalKey], isNotNull);

        final replay = await restarted.startRedemption(
          redemptionRequestId: firstLogicalId,
          restaurantId: restaurantId,
          offerId: offerId,
          usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
          evaluationContext: context(startAt),
          validationExpiresAtMillis: startAt + 60000,
          expectedGuestStateRevision: 0,
        );

        expect(
          replay.status,
          CustomerBiteSaverGuestRedemptionStartStatus.replayed,
        );
        expect(replay.didMutate, isFalse);
        expect(replay.timerStartedAtMillis, startAt);
        expect(
          replay.timerExpiresAtMillis,
          startAt +
              customerBiteSaverGuestRedemptionTimerDuration.inMilliseconds,
        );
        expect(replay.guestStateRevision, 1);
        final recoveredMeta =
            jsonDecode(preferences.values[store.metaKey]!)
                as Map<String, dynamic>;
        final recoveredOffer =
            jsonDecode(preferences.values[store.offerKey(offerId)]!)
                as Map<String, dynamic>;
        expect(recoveredMeta['guestStateRevision'], 1);
        expect(recoveredMeta['activeOfferIds'], <String>[offerId.value]);
        expect(recoveredOffer['redemptionRequestId'], firstLogicalId);
        expect(recoveredOffer['timerStartedAtMillis'], startAt);
        expect(preferences.values[store.journalKey], isNull);

        final recoveryMutations = preferences.mutations
            .skip(mutationCountBeforeRecovery)
            .toList();
        final expectedRecoveryKeys = switch (crashMutation) {
          2 => <String>[
            store.offerKey(offerId),
            store.metaKey,
            store.journalKey,
          ],
          3 => <String>[store.metaKey, store.journalKey],
          _ => <String>[store.journalKey],
        };
        expect(
          recoveryMutations.map((mutation) => mutation.key),
          orderedEquals(expectedRecoveryKeys),
        );
        expect(recoveryMutations.last.value, isNull);
      },
    );
  }

  test(
    'exact WAL recovery may finish when validation expires during its reads',
    () async {
      preferences.throwOnMutationNumber = 3;
      await _expectFailure(
        start(),
        CustomerBiteSaverGuestUsageFailure.writeFailed,
      );
      expect(preferences.values[store.journalKey], isNotNull);

      var crossedDeadline = false;
      preferences.afterRead = (key) {
        if (!crossedDeadline && key == store.journalKey) {
          crossedDeadline = true;
          clockMillis = startAt + 60000;
        }
      };
      final restarted = CustomerBiteSaverGuestUsageStore(
        guestDeviceId: guestDeviceId,
        preferences: preferences,
        clock: () =>
            DateTime.fromMillisecondsSinceEpoch(clockMillis, isUtc: true),
      );

      final replay = await restarted.startRedemption(
        redemptionRequestId: firstLogicalId,
        restaurantId: restaurantId,
        offerId: offerId,
        usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
        evaluationContext: context(startAt),
        validationExpiresAtMillis: startAt + 60000,
        expectedGuestStateRevision: 0,
      );

      expect(crossedDeadline, isTrue);
      expect(
        replay.status,
        CustomerBiteSaverGuestRedemptionStartStatus.replayed,
      );
      expect(replay.didMutate, isFalse);
      expect(replay.timerStartedAtMillis, startAt);
      expect(replay.guestStateRevision, 1);
      expect(preferences.values[store.journalKey], isNull);
    },
  );

  test(
    'expired exact retry replays committed state after its response is lost',
    () async {
      final committed = await start();
      final committedMeta = preferences.values[store.metaKey];
      final committedOffer = preferences.values[store.offerKey(offerId)];
      final mutationCount = preferences.mutations.length;
      expect(preferences.values[store.journalKey], isNull);

      clockMillis = startAt + 60000;
      final restarted = CustomerBiteSaverGuestUsageStore(
        guestDeviceId: guestDeviceId,
        preferences: preferences,
        clock: () =>
            DateTime.fromMillisecondsSinceEpoch(clockMillis, isUtc: true),
      );
      final replay = await restarted.startRedemption(
        redemptionRequestId: firstLogicalId,
        restaurantId: restaurantId,
        offerId: offerId,
        usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
        evaluationContext: context(startAt),
        validationExpiresAtMillis: startAt + 60000,
        expectedGuestStateRevision: 0,
      );

      expect(
        replay.status,
        CustomerBiteSaverGuestRedemptionStartStatus.replayed,
      );
      expect(replay.didMutate, isFalse);
      expect(replay.timerStartedAtMillis, committed.timerStartedAtMillis);
      expect(replay.timerExpiresAtMillis, committed.timerExpiresAtMillis);
      expect(replay.guestStateRevision, committed.guestStateRevision);
      expect(preferences.values[store.metaKey], committedMeta);
      expect(preferences.values[store.offerKey(offerId)], committedOffer);
      expect(preferences.values[store.journalKey], isNull);
      expect(preferences.mutations, hasLength(mutationCount));
    },
  );

  test('does not complete start before journal cleanup is durable', () async {
    final removeEntered = Completer<void>();
    final removeGate = Completer<void>();
    preferences.beforeMutation = (mutationNumber, key, value) async {
      if (key == store.journalKey && value == null) {
        removeEntered.complete();
        await removeGate.future;
      }
    };
    var completed = false;
    final pending = start()..whenComplete(() => completed = true);

    await removeEntered.future;
    expect(completed, isFalse);
    expect(preferences.values[store.journalKey], isNotNull);
    removeGate.complete();

    final result = await pending;
    expect(completed, isTrue);
    expect(result.status, CustomerBiteSaverGuestRedemptionStartStatus.started);
    expect(preferences.values[store.journalKey], isNull);
  });
}

Future<void> _expectFailure(
  Future<Object?> future,
  CustomerBiteSaverGuestUsageFailure failure,
) async {
  await expectLater(
    future,
    throwsA(
      isA<CustomerBiteSaverGuestUsageException>().having(
        (error) => error.failure,
        'failure',
        failure,
      ),
    ),
  );
}

CustomerBiteSaverRestaurantId _restaurantId(int index) =>
    CustomerBiteSaverRestaurantId('bsr_${_token(index)}');

CustomerBiteSaverOfferId _offerId(int index) =>
    CustomerBiteSaverOfferId('bso_${_token(index)}');

String _token(int index) => index.toRadixString(36).padLeft(43, '0');

String _repeat(String value, int count) =>
    List<String>.filled(count, value).join();

Map<String, dynamic> _map(Object? value) =>
    Map<String, dynamic>.from(value! as Map);

Map<String, Object?> _meta(
  int revision, {
  List<String> activeOfferIds = const <String>[],
}) {
  return <String, Object?>{
    'schemaVersion': 1,
    'guestStateRevision': revision,
    'activeOfferIds': activeOfferIds,
  };
}

Map<String, Object?> _offer({
  required CustomerBiteSaverRestaurantId restaurantId,
  required CustomerBiteSaverOfferId offerId,
  required String logicalId,
  required int startedAtMillis,
  CustomerBiteSaverGuestUsagePolicy usagePolicy =
      CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
  bool reusableAfterTimer = false,
  int committedRevision = 1,
  int? validationExpiresAtMillis,
}) {
  return <String, Object?>{
    'schemaVersion': 1,
    'restaurantId': restaurantId.value,
    'offerId': offerId.value,
    'redemptionRequestId': logicalId,
    'usagePolicy': usagePolicy.name,
    'reusableAfterTimer': reusableAfterTimer,
    'committedRevision': committedRevision,
    'evaluationContext': CustomerBiteSaverEvaluationContext(
      sessionId: 'bss_${_repeat('s', 43)}',
      attemptGeneration: 0,
      queryFingerprint: _repeat('c', 64),
      evaluationAtMillis: startedAtMillis,
      timeZone: 'America/New_York',
      utcOffsetMinutes: -240,
      availabilityGeneration: _repeat('a', 64),
      validUntilExclusiveMillis:
          startedAtMillis +
          CustomerBiteSaverSearchContract
              .usageEvaluationMaximumLifetimeMilliseconds,
      oncePerDayUnavailableWindows:
          <CustomerBiteSaverOncePerDayUnavailableWindow>[
            CustomerBiteSaverOncePerDayUnavailableWindow(
              startAtMillisInclusive: startedAtMillis >= 86400000
                  ? startedAtMillis - 86400000
                  : 0,
              endAtMillisExclusive: startedAtMillis + 1,
            ),
          ],
    ).toJson(),
    'validationExpiresAtMillis':
        validationExpiresAtMillis ?? startedAtMillis + 60000,
    'timerStartedAtMillis': startedAtMillis,
    'timerExpiresAtMillis':
        startedAtMillis +
        customerBiteSaverGuestRedemptionTimerDuration.inMilliseconds,
  };
}

final class _Mutation {
  final String key;
  final String? value;

  const _Mutation(this.key, this.value);
}

final class _FakePreferences implements CustomerBiteSaverGuestUsagePreferences {
  final Map<String, String> values = <String, String>{};
  final List<String> readKeys = <String>[];
  final List<_Mutation> mutations = <_Mutation>[];
  String? throwOnReadKey;
  int? throwOnMutationNumber;
  void Function(String key)? afterRead;
  Future<void> Function(int mutationNumber, String key, String? value)?
  beforeMutation;
  int _mutationCount = 0;
  int _concurrentOperations = 0;
  int maximumConcurrentOperations = 0;

  @override
  Future<String?> getString(String key) async {
    _enter();
    try {
      readKeys.add(key);
      if (throwOnReadKey == key) {
        throw StateError('synthetic read failure');
      }
      final result = values[key];
      afterRead?.call(key);
      return result;
    } finally {
      _leave();
    }
  }

  @override
  Future<void> setString(String key, String value) => _mutate(key, value);

  @override
  Future<void> remove(String key) => _mutate(key, null);

  Future<void> _mutate(String key, String? value) async {
    _enter();
    try {
      _mutationCount += 1;
      await beforeMutation?.call(_mutationCount, key, value);
      if (throwOnMutationNumber == _mutationCount) {
        throwOnMutationNumber = null;
        throw StateError('synthetic write failure');
      }
      mutations.add(_Mutation(key, value));
      if (value == null) {
        values.remove(key);
      } else {
        values[key] = value;
      }
    } finally {
      _leave();
    }
  }

  void _enter() {
    _concurrentOperations += 1;
    if (_concurrentOperations > maximumConcurrentOperations) {
      maximumConcurrentOperations = _concurrentOperations;
    }
  }

  void _leave() {
    _concurrentOperations -= 1;
  }
}
