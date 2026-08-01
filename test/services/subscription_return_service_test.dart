import 'dart:async';

import 'package:coupon_app/services/subscription_checkout_service.dart';
import 'package:coupon_app/services/subscription_return_service.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/subscription_return_test_backend.dart';

final DateTime _now = DateTime.utc(2026, 7, 31, 12);
const SubscriptionReturnOwnerScope _ownerA = SubscriptionReturnOwnerScope(
  uid: 'owner-a',
  accountDocumentId: 'owner-a',
);
const SubscriptionReturnOwnerScope _ownerB = SubscriptionReturnOwnerScope(
  uid: 'owner-b',
  accountDocumentId: 'owner-b',
);
const SubscriptionReturnOwnerScope _ownerASiblingDocument =
    SubscriptionReturnOwnerScope(
      uid: 'owner-a',
      accountDocumentId: 'owner-a-sibling',
    );

String _token(int seed) =>
    '${seed.toRadixString(36).padLeft(3, '0')}${'A' * 40}';

SubscriptionReturnCoordinator _coordinator(
  FakeSubscriptionReturnBackend backend, {
  MemorySubscriptionReturnInboxPersistence? persistence,
}) {
  final coordinator = SubscriptionReturnCoordinator(
    inboxStore: SubscriptionReturnInboxStore(
      persistence: persistence ?? MemorySubscriptionReturnInboxPersistence(),
      clock: () => _now,
    ),
    serverClient: SubscriptionReturnServerClient(
      invokeCallable: backend.invoke,
      clock: () => _now,
    ),
  );
  addTearDown(coordinator.dispose);
  return coordinator;
}

void main() {
  group('exact native return parser', () {
    for (final kind in SubscriptionReturnKind.values) {
      test('parses and rebuilds exact ${kind.name}', () {
        final raw = subscriptionReturnUri(
          kind: kind,
          returnToken: _token(kind.index),
        );
        final parsed = parseSubscriptionReturnLink(raw);
        expect(parsed?.kind, kind);
        expect(parsed?.returnToken, _token(kind.index));
        expect(parseSubscriptionReturnUri(Uri.parse(raw))?.kind, kind);
      });
    }

    test('rejects tokenless, duplicate, noncanonical, and malformed links', () {
      final token = _token(1);
      for (final raw in <String>[
        subscriptionCheckoutSuccessReturnUri,
        '$subscriptionCheckoutSuccessReturnUri?return_token=short',
        '$subscriptionCheckoutSuccessReturnUri?return_token=$token&return_token=$token',
        '$subscriptionCheckoutSuccessReturnUri?return_token=$token&extra=1',
        'BITESAVER://subscription-success?return_token=$token',
        'bitesaver://subscription-success/?return_token=$token',
        'bitesaver://subscription-success?return_token=$token#fragment',
        'bitesaver://user@subscription-success?return_token=$token',
        'bitesaver://subscription-success:443?return_token=$token',
        'bitesaver://subscription-success?return_token=${token.substring(1)}=',
      ]) {
        expect(parseSubscriptionReturnLink(raw), isNull, reason: raw);
      }
    });
  });

  group('fixed Flutter-web fragment parser', () {
    for (final kind in SubscriptionReturnKind.values) {
      test('parses exact ${kind.name} fragment and no HTTPS query', () {
        final raw = subscriptionReturnWebLocation(
          kind: kind,
          returnToken: _token(kind.index),
        );
        final uri = Uri.parse(raw);
        expect(uri.query, isEmpty);
        expect(uri.fragment, contains('return_token='));
        final parsed = parseSubscriptionReturnWebLocation(raw);
        expect(parsed?.kind, kind);
        expect(parsed?.returnToken, _token(kind.index));
      });
    }

    test('rejects query tokens, wrong origins, and malformed fragments', () {
      final token = _token(2);
      for (final raw in <String>[
        'https://app.bitestar.app/?return_token=$token',
        'http://app.bitestar.app/#/subscription-return/checkoutSuccess?return_token=$token',
        'https://evil.example/#/subscription-return/checkoutSuccess?return_token=$token',
        'https://app.bitestar.app/path#/subscription-return/checkoutSuccess?return_token=$token',
        'https://app.bitestar.app/#/subscription-return/checkoutSuccess?return_token=short',
        'https://app.bitestar.app/#/subscription-return/checkoutSuccess?return_token=$token&extra=1',
        'https://app.bitestar.app/#/subscription-return/checkoutSuccess?return_token=$token&return_token=$token',
        'https://app.bitestar.app/#/subscription-return/unknown?return_token=$token',
      ]) {
        expect(parseSubscriptionReturnWebLocation(raw), isNull, reason: raw);
      }
    });
  });

  test('ingestion only retains a non-authoritative local delivery', () async {
    final backend = FakeSubscriptionReturnBackend(clock: () => _now);
    final persistence = MemorySubscriptionReturnInboxPersistence();
    final coordinator = _coordinator(backend, persistence: persistence);
    backend.reserve(
      returnToken: _token(3),
      ownerScope: _ownerA,
      family: SubscriptionReturnFamily.checkout,
    );

    expect(
      await coordinator.ingestReturnLink(
        subscriptionReturnUri(
          kind: SubscriptionReturnKind.checkoutSuccess,
          returnToken: _token(3),
        ),
      ),
      isTrue,
    );
    expect(backend.redeemCalls, 0);
    expect(backend.eventCountFor(_ownerA), 0);
    expect(await coordinator.pendingLocalDeliveryCount(), 1);
  });

  test(
    'matching owner redeems once, removes raw token, and claims both obligations',
    () async {
      final backend = FakeSubscriptionReturnBackend(clock: () => _now);
      final coordinator = _coordinator(backend);
      backend.reserve(
        returnToken: _token(4),
        ownerScope: _ownerA,
        family: SubscriptionReturnFamily.checkout,
      );
      await coordinator.ingestReturnLink(
        subscriptionReturnUri(
          kind: SubscriptionReturnKind.checkoutSuccess,
          returnToken: _token(4),
        ),
      );

      final navigation = await coordinator.claimNextPendingNavigationFor(
        _ownerA,
      );
      expect(navigation?.kind, SubscriptionReturnKind.checkoutSuccess);
      expect(await coordinator.pendingLocalDeliveryCount(), 0);
      expect(backend.eventCountFor(_ownerA), 1);
      expect(
        await coordinator.claimNavigationFor(navigation!.id, _ownerA),
        isFalse,
      );

      final refresh = await coordinator.claimNextPendingRefreshFor(_ownerA);
      expect(refresh?.event.id, navigation.id);
      coordinator.finishRefresh(refresh!.event, refreshSucceeded: true);
      expect(await coordinator.peekPendingNavigationFor(_ownerA), isNull);
      expect(await coordinator.peekPendingRefreshFor(_ownerA), isNull);
    },
  );

  test('wrong owner is neutral and matching owner can redeem later', () async {
    final backend = FakeSubscriptionReturnBackend(clock: () => _now);
    final coordinator = _coordinator(backend);
    backend.reserve(
      returnToken: _token(5),
      ownerScope: _ownerA,
      family: SubscriptionReturnFamily.customerPortal,
    );
    await coordinator.ingestReturnLink(
      subscriptionReturnUri(
        kind: SubscriptionReturnKind.customerPortal,
        returnToken: _token(5),
      ),
    );

    backend.authenticatedUid = _ownerB.uid;
    expect(await coordinator.peekPendingNavigationFor(_ownerB), isNull);
    expect(await coordinator.pendingLocalDeliveryCount(), 1);
    expect(backend.eventCountFor(_ownerA), 0);

    backend.authenticatedUid = _ownerA.uid;
    expect(
      (await coordinator.peekPendingNavigationFor(_ownerA))?.kind,
      SubscriptionReturnKind.customerPortal,
    );
    expect(await coordinator.pendingLocalDeliveryCount(), 0);
  });

  test('same UID with a different canonical document cannot redeem', () async {
    final backend = FakeSubscriptionReturnBackend(clock: () => _now);
    final coordinator = _coordinator(backend);
    backend.reserve(
      returnToken: _token(6),
      ownerScope: _ownerA,
      family: SubscriptionReturnFamily.checkout,
    );
    await coordinator.ingestReturnLink(
      subscriptionReturnUri(
        kind: SubscriptionReturnKind.checkoutCancel,
        returnToken: _token(6),
      ),
    );
    expect(
      await coordinator.peekPendingNavigationFor(_ownerASiblingDocument),
      isNull,
    );
    expect(await coordinator.pendingLocalDeliveryCount(), 1);
    expect(backend.eventCountFor(_ownerA), 0);
    expect(await coordinator.peekPendingNavigationFor(_ownerA), isNotNull);
  });

  test(
    'duplicate local delivery and server replay cannot create a second event',
    () async {
      final backend = FakeSubscriptionReturnBackend(clock: () => _now);
      final coordinator = _coordinator(backend);
      backend.reserve(
        returnToken: _token(7),
        ownerScope: _ownerA,
        family: SubscriptionReturnFamily.checkout,
      );
      final raw = subscriptionReturnUri(
        kind: SubscriptionReturnKind.checkoutSuccess,
        returnToken: _token(7),
      );
      await Future.wait(<Future<bool>>[
        coordinator.ingestReturnLink(raw),
        coordinator.ingestReturnLink(raw),
      ]);
      await coordinator.peekPendingNavigationFor(_ownerA);
      expect(backend.eventCountFor(_ownerA), 1);
      expect(await coordinator.pendingLocalDeliveryCount(), 0);

      await coordinator.ingestReturnLink(raw);
      await coordinator.peekPendingNavigationFor(_ownerA);
      expect(backend.eventCountFor(_ownerA), 1);
      expect(await coordinator.pendingLocalDeliveryCount(), 0);
    },
  );

  test(
    'network failure retains raw delivery and later recovery redeems',
    () async {
      final backend = FakeSubscriptionReturnBackend(clock: () => _now)
        ..failRedeem = true;
      final coordinator = _coordinator(backend);
      backend.reserve(
        returnToken: _token(8),
        ownerScope: _ownerA,
        family: SubscriptionReturnFamily.checkout,
      );
      await coordinator.ingestReturnLink(
        subscriptionReturnUri(
          kind: SubscriptionReturnKind.checkoutCancel,
          returnToken: _token(8),
        ),
      );
      expect(await coordinator.peekPendingNavigationFor(_ownerA), isNull);
      expect(await coordinator.pendingLocalDeliveryCount(), 1);

      backend.failRedeem = false;
      expect(await coordinator.peekPendingNavigationFor(_ownerA), isNotNull);
      expect(await coordinator.pendingLocalDeliveryCount(), 0);
    },
  );

  test(
    'created false after completed cleanup clears inbox without recreating UI',
    () async {
      final backend = FakeSubscriptionReturnBackend(clock: () => _now);
      final coordinator = _coordinator(backend);
      final announced = <SubscriptionReturnEvent>[];
      final subscription = coordinator.events.listen(announced.add);
      addTearDown(subscription.cancel);
      backend.reserve(
        returnToken: _token(70),
        ownerScope: _ownerA,
        family: SubscriptionReturnFamily.checkout,
      );
      final raw = subscriptionReturnUri(
        kind: SubscriptionReturnKind.checkoutSuccess,
        returnToken: _token(70),
      );
      await coordinator.ingestReturnLink(raw);
      final navigation = await coordinator.claimNextPendingNavigationFor(
        _ownerA,
      );
      expect(navigation, isNotNull);
      final refresh = await coordinator.claimNextPendingRefreshFor(_ownerA);
      expect(refresh, isNotNull);
      coordinator.finishRefresh(refresh!.event, refreshSucceeded: true);
      expect(await coordinator.peekPendingNavigationFor(_ownerA), isNull);
      expect(announced, hasLength(1));

      await coordinator.ingestReturnLink(raw);
      expect(await coordinator.pendingLocalDeliveryCount(), 1);
      expect(await coordinator.peekPendingNavigationFor(_ownerA), isNull);
      expect(await coordinator.peekPendingRefreshFor(_ownerA), isNull);
      expect(await coordinator.pendingLocalDeliveryCount(), 0);
      expect(announced, hasLength(1));
    },
  );

  test(
    'permanent claim failure performs one attempt and does not loop',
    () async {
      final backend = FakeSubscriptionReturnBackend(clock: () => _now);
      final coordinator = _coordinator(backend);
      backend.addPendingEvent(
        ownerScope: _ownerA,
        eventId: '1',
        kind: SubscriptionReturnKind.customerPortal,
      );
      expect(await coordinator.peekPendingRefreshFor(_ownerA), isNotNull);
      backend
        ..failClaim = true
        ..claimCalls = 0;

      expect(await coordinator.claimNextPendingRefreshFor(_ownerA), isNull);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(backend.claimCalls, 1);
    },
  );

  test(
    'owner change after server claim suppresses UI without rollback',
    () async {
      final backend = FakeSubscriptionReturnBackend(clock: () => _now);
      final coordinator = _coordinator(backend);
      backend.addPendingEvent(
        ownerScope: _ownerA,
        eventId: '1',
        kind: SubscriptionReturnKind.checkoutSuccess,
      );
      final event = await coordinator.peekPendingNavigationFor(_ownerA);
      expect(event, isNotNull);

      var current = true;
      backend
        ..claimStarted = Completer<void>()
        ..releaseClaim = Completer<void>();
      final claim = coordinator.claimNavigationFor(
        event!.id,
        _ownerA,
        isCurrent: () => current,
      );
      await backend.claimStarted!.future;
      current = false;
      backend.releaseClaim!.complete();
      expect(await claim, isFalse);

      backend
        ..claimStarted = null
        ..releaseClaim = null;
      expect(await coordinator.claimNavigationFor(event.id, _ownerA), isFalse);
      expect(backend.claimCalls, 2);
    },
  );

  test('two shells cannot duplicate an atomic server claim', () async {
    final backend = FakeSubscriptionReturnBackend(clock: () => _now);
    backend.addPendingEvent(
      ownerScope: _ownerA,
      eventId: '1',
      kind: SubscriptionReturnKind.customerPortal,
    );
    final first = _coordinator(backend);
    final second = _coordinator(backend);
    await Future.wait(<Future<SubscriptionReturnEvent?>>[
      first.peekPendingNavigationFor(_ownerA),
      second.peekPendingNavigationFor(_ownerA),
    ]);
    final claims = await Future.wait(<Future<SubscriptionReturnEvent?>>[
      first.claimNextPendingNavigationFor(_ownerA),
      second.claimNextPendingNavigationFor(_ownerA),
    ]);
    expect(claims.whereType<SubscriptionReturnEvent>(), hasLength(1));
  });

  test(
    'process restart recovers pending server events without local state',
    () async {
      final backend = FakeSubscriptionReturnBackend(clock: () => _now);
      backend.addPendingEvent(
        ownerScope: _ownerA,
        eventId: '9',
        kind: SubscriptionReturnKind.checkoutCancel,
      );
      final restarted = _coordinator(backend);
      final event = await restarted.peekPendingRefreshFor(_ownerA);
      expect(event?.id, '9');
      expect(await restarted.pendingLocalDeliveryCount(), 0);
    },
  );

  test(
    'prepare and launch survive process recreation before the later return',
    () async {
      final backend = FakeSubscriptionReturnBackend(clock: () => _now);
      final persistence = MemorySubscriptionReturnInboxPersistence();
      final liveProcesses = <SubscriptionReturnCoordinator>{};
      addTearDown(() async {
        for (final process in liveProcesses.toList().reversed) {
          await process.dispose();
        }
      });

      SubscriptionReturnCoordinator createProcess() {
        final process = SubscriptionReturnCoordinator(
          inboxStore: SubscriptionReturnInboxStore(
            persistence: persistence,
            clock: () => _now,
          ),
          serverClient: SubscriptionReturnServerClient(
            invokeCallable: backend.invoke,
            clock: () => _now,
          ),
        );
        liveProcesses.add(process);
        return process;
      }

      Future<void> disposeProcess(SubscriptionReturnCoordinator process) async {
        liveProcesses.remove(process);
        await process.dispose();
      }

      final token = _token(71);
      const checkoutUrl =
          'https://checkout.stripe.com/c/pay/process-recreation';
      var preparationCalls = 0;
      var registrationCalls = 0;
      var launchCalls = 0;

      final processA = createProcess();
      final processAEvents = <SubscriptionReturnEvent>[];
      final processASubscription = processA.events.listen(processAEvents.add);

      Future<void> prepareAndLaunchInProcessA() async {
        final checkoutService = SubscriptionCheckoutService(
          invokeCallable: (name, payload) async {
            expect(name, 'createCheckoutSession');
            expect(payload, <String, Object?>{
              'returnProtocolVersion': subscriptionReturnProtocolVersion,
              'restaurantAccountDocumentId': _ownerA.accountDocumentId,
            });
            preparationCalls += 1;
            registrationCalls += 1;
            backend.reserve(
              returnToken: token,
              ownerScope: _ownerA,
              family: SubscriptionReturnFamily.checkout,
            );
            return <String, Object?>{
              'url': checkoutUrl,
              'returnToken': token,
              'returnProtocolVersion': subscriptionReturnProtocolVersion,
            };
          },
          launchExternalUrl: (url) async {
            expect(url, Uri.parse(checkoutUrl));
            launchCalls += 1;
            return true;
          },
        );
        final prepared = await checkoutService.prepareSubscriptionCheckout(
          restaurantAccountDocumentId: _ownerA.accountDocumentId,
        );
        expect(
          await checkoutService.launchPreparedSubscriptionUrl(
            prepared,
            isCurrent: () => true,
          ),
          SubscriptionExternalLaunchResult.launched,
        );
      }

      await prepareAndLaunchInProcessA();
      expect(preparationCalls, 1);
      expect(registrationCalls, 1);
      expect(launchCalls, 1);
      expect(backend.redeemCalls, 0);
      expect(backend.eventCountFor(_ownerA), 0);
      expect(processAEvents, isEmpty);
      expect(await processA.pendingLocalDeliveryCount(), 0);

      await processASubscription.cancel();
      await disposeProcess(processA);

      final processB = createProcess();
      final processBEvents = <SubscriptionReturnEvent>[];
      final processBSubscription = processB.events.listen(processBEvents.add);
      expect(await processB.pendingServerEventCount(), 0);
      expect(await processB.pendingLocalDeliveryCount(), 0);
      expect(processBEvents, isEmpty);
      expect(backend.eventCountFor(_ownerA), 0);

      final rawReturn = subscriptionReturnUri(
        kind: SubscriptionReturnKind.checkoutSuccess,
        returnToken: token,
      );
      expect(await processB.ingestReturnLink(rawReturn), isTrue);
      expect(await processB.pendingLocalDeliveryCount(), 1);
      expect(backend.eventCountFor(_ownerA), 0);

      expect(
        await processB.peekPendingNavigationFor(_ownerASiblingDocument),
        isNull,
      );
      expect(await processB.pendingLocalDeliveryCount(), 1);
      backend.authenticatedUid = _ownerB.uid;
      expect(await processB.peekPendingNavigationFor(_ownerB), isNull);
      expect(backend.eventCountFor(_ownerB), 0);
      expect(await processB.pendingLocalDeliveryCount(), 1);
      backend.authenticatedUid = _ownerA.uid;

      final event = await processB.peekPendingNavigationFor(_ownerA);
      expect(event, isNotNull);
      expect(event!.id, '1');
      expect(event.kind, SubscriptionReturnKind.checkoutSuccess);
      expect(event.ownerScope, _ownerA);
      expect(backend.eventCountFor(_ownerA), 1);
      expect(backend.redeemCalls, 3);
      expect(await processB.pendingLocalDeliveryCount(), 0);
      expect(processBEvents, <SubscriptionReturnEvent>[event]);
      expect(
        <String>[
          event.id,
          event.kind.name,
          event.ownerScope.uid,
          event.ownerScope.accountDocumentId,
        ].join('|'),
        isNot(contains(token)),
      );

      final navigation = await processB.claimNextPendingNavigationFor(_ownerA);
      expect(navigation?.id, event.id);
      expect(await processB.claimNextPendingNavigationFor(_ownerA), isNull);
      final refresh = await processB.claimNextPendingRefreshFor(_ownerA);
      expect(refresh?.event.id, event.id);
      processB.finishRefresh(refresh!.event, refreshSucceeded: true);
      expect(await processB.claimNextPendingRefreshFor(_ownerA), isNull);
      expect(backend.claimCalls, 2);

      expect(await processB.ingestReturnLink(rawReturn), isTrue);
      expect(await processB.pendingLocalDeliveryCount(), 1);
      expect(await processB.peekPendingNavigationFor(_ownerA), isNull);
      expect(await processB.peekPendingRefreshFor(_ownerA), isNull);
      expect(await processB.pendingLocalDeliveryCount(), 0);
      expect(processBEvents, <SubscriptionReturnEvent>[event]);
      expect(backend.eventCountFor(_ownerA), 0);
      expect(backend.claimCalls, 2);
      expect(preparationCalls, 1);
      expect(registrationCalls, 1);
      expect(launchCalls, 1);

      await processBSubscription.cancel();
      await disposeProcess(processB);

      final processC = createProcess();
      final processCEvents = <SubscriptionReturnEvent>[];
      final processCSubscription = processC.events.listen(processCEvents.add);
      expect(await processC.peekPendingNavigationFor(_ownerA), isNull);
      expect(await processC.peekPendingRefreshFor(_ownerA), isNull);
      expect(await processC.pendingLocalDeliveryCount(), 0);
      expect(processCEvents, isEmpty);
      expect(backend.claimCalls, 2);
      await processCSubscription.cancel();
      await disposeProcess(processC);
    },
  );

  test(
    'navigation-only server event does not suppress a normal lifecycle refresh',
    () async {
      final backend = FakeSubscriptionReturnBackend(clock: () => _now);
      final coordinator = _coordinator(backend);
      final lifecycleOwner = Object();
      backend.addPendingEvent(
        ownerScope: _ownerA,
        eventId: '10',
        kind: SubscriptionReturnKind.customerPortal,
        refreshClaimed: true,
      );

      final navigation = await coordinator.peekPendingNavigationFor(_ownerA);
      expect(navigation?.id, '10');
      expect(navigation?.refreshClaimed, isTrue);
      expect(
        await coordinator.claimRestaurantHubLifecycleRefreshFor(
          lifecycleOwner,
          _ownerA,
        ),
        isTrue,
      );
      expect(
        (await coordinator.peekPendingNavigationFor(_ownerA))?.id,
        navigation?.id,
      );
      coordinator.finishRestaurantHubLifecycleRefresh(lifecycleOwner);
    },
  );

  test(
    'remote refresh claim retires a previously tentative suppression',
    () async {
      final backend = FakeSubscriptionReturnBackend(clock: () => _now);
      final coordinator = _coordinator(backend);
      final lifecycleOwner = Object();
      backend.addPendingEvent(
        ownerScope: _ownerA,
        eventId: '11',
        kind: SubscriptionReturnKind.customerPortal,
      );

      expect((await coordinator.peekPendingRefreshFor(_ownerA))?.id, '11');
      backend.markRefreshClaimed(ownerScope: _ownerA, eventId: '11');
      expect((await coordinator.peekPendingNavigationFor(_ownerA))?.id, '11');
      expect(
        await coordinator.claimRestaurantHubLifecycleRefreshFor(
          lifecycleOwner,
          _ownerA,
        ),
        isTrue,
      );
      coordinator.finishRestaurantHubLifecycleRefresh(lifecycleOwner);
    },
  );

  test('claimed false retires the local tentative suppression', () async {
    final backend = FakeSubscriptionReturnBackend(clock: () => _now);
    final coordinator = _coordinator(backend);
    final lifecycleOwner = Object();
    backend.addPendingEvent(
      ownerScope: _ownerA,
      eventId: '12',
      kind: SubscriptionReturnKind.customerPortal,
    );

    final event = await coordinator.peekPendingRefreshFor(_ownerA);
    expect(event?.id, '12');
    backend.markRefreshClaimed(ownerScope: _ownerA, eventId: '12');
    expect(await coordinator.claimRefreshFor('12', _ownerA), isFalse);
    expect(
      await coordinator.claimRestaurantHubLifecycleRefreshFor(
        lifecycleOwner,
        _ownerA,
      ),
      isTrue,
    );
    coordinator.finishRestaurantHubLifecycleRefresh(lifecycleOwner);
  });

  for (final refreshSucceeded in <bool>[true, false]) {
    test(
      'local refresh ${refreshSucceeded ? 'success retains' : 'failure retires'} its tentative suppression',
      () async {
        final backend = FakeSubscriptionReturnBackend(clock: () => _now);
        final coordinator = _coordinator(backend);
        final lifecycleOwner = Object();
        backend.addPendingEvent(
          ownerScope: _ownerA,
          eventId: '13',
          kind: SubscriptionReturnKind.customerPortal,
          navigationClaimed: true,
        );

        final candidate = await coordinator.claimNextPendingRefreshFor(_ownerA);
        expect(candidate?.event.id, '13');
        coordinator.finishRefresh(
          candidate!.event,
          refreshSucceeded: refreshSucceeded,
        );
        // The completed event is now absent from the next server list. A
        // locally earned success credit must survive that reconciliation;
        // a failed local refresh must not.
        expect(await coordinator.peekPendingNavigationFor(_ownerA), isNull);
        if (refreshSucceeded) {
          coordinator.noteRestaurantHubMounted(isResumed: true);
          coordinator.noteRestaurantHubLifecycleNotResumed();
        }
        expect(
          await coordinator.claimRestaurantHubLifecycleRefreshFor(
            lifecycleOwner,
            _ownerA,
          ),
          refreshSucceeded ? isFalse : isTrue,
        );
        coordinator.finishRestaurantHubLifecycleRefresh(lifecycleOwner);
      },
    );
  }

  test(
    'initial and changed web fragments enter the same bounded inbox once',
    () async {
      final backend = FakeSubscriptionReturnBackend(clock: () => _now);
      final coordinator = _coordinator(backend);
      final changes = StreamController<String>.broadcast(sync: true);
      addTearDown(changes.close);
      final initial = subscriptionReturnWebLocation(
        kind: SubscriptionReturnKind.checkoutSuccess,
        returnToken: _token(9),
      );
      final later = subscriptionReturnWebLocation(
        kind: SubscriptionReturnKind.customerPortal,
        returnToken: _token(10),
      );
      coordinator.startAppLinkIngestion(
        rawLinks: const Stream<String>.empty(),
        initialWebLocation: initial,
        webLocations: changes.stream,
      );
      changes
        ..add(initial)
        ..add(later);
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(await coordinator.pendingLocalDeliveryCount(), 2);
    },
  );

  test('parsed app-link stream never consumes tokenized URI', () async {
    final backend = FakeSubscriptionReturnBackend(clock: () => _now);
    final coordinator = _coordinator(backend);
    final parsedLinks = StreamController<Uri>.broadcast(sync: true);
    addTearDown(parsedLinks.close);
    coordinator.startAppLinkIngestion(
      links: parsedLinks.stream,
      webLocations: const Stream<String>.empty(),
    );
    parsedLinks.add(
      Uri.parse(
        subscriptionReturnUri(
          kind: SubscriptionReturnKind.checkoutSuccess,
          returnToken: _token(11),
        ),
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(await coordinator.pendingLocalDeliveryCount(), 0);
  });
}
