import 'dart:async';

import 'package:coupon_app/services/subscription_return_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

typedef MalformedCheckoutReturnFixture = ({
  String category,
  String rawUri,
  SubscriptionReturnKind kind,
  bool verifyParsedSeam,
});

typedef _MalformedCheckoutReturnFixturePair = ({
  String category,
  String successUri,
  String cancelUri,
  bool verifyParsedSeam,
});

const List<_MalformedCheckoutReturnFixturePair>
_malformedCheckoutReturnFixturePairs = <_MalformedCheckoutReturnFixturePair>[
  (
    category: 'leading whitespace',
    successUri: ' bitesaver://subscription-success',
    cancelUri: ' bitesaver://subscription-cancel',
    verifyParsedSeam: false,
  ),
  (
    category: 'trailing whitespace',
    successUri: 'bitesaver://subscription-success ',
    cancelUri: 'bitesaver://subscription-cancel ',
    verifyParsedSeam: false,
  ),
  (
    category: 'trailing slash',
    successUri: 'bitesaver://subscription-success/',
    cancelUri: 'bitesaver://subscription-cancel/',
    verifyParsedSeam: true,
  ),
  (
    category: 'extra path segment',
    successUri: 'bitesaver://subscription-success/extra',
    cancelUri: 'bitesaver://subscription-cancel/extra',
    verifyParsedSeam: true,
  ),
  (
    category: 'populated query',
    successUri: 'bitesaver://subscription-success?source=caller',
    cancelUri: 'bitesaver://subscription-cancel?source=caller',
    verifyParsedSeam: true,
  ),
  (
    category: 'empty query marker',
    successUri: 'bitesaver://subscription-success?',
    cancelUri: 'bitesaver://subscription-cancel?',
    verifyParsedSeam: true,
  ),
  (
    category: 'populated fragment',
    successUri: 'bitesaver://subscription-success#caller',
    cancelUri: 'bitesaver://subscription-cancel#caller',
    verifyParsedSeam: true,
  ),
  (
    category: 'empty fragment marker',
    successUri: 'bitesaver://subscription-success#',
    cancelUri: 'bitesaver://subscription-cancel#',
    verifyParsedSeam: true,
  ),
  (
    category: 'userinfo',
    successUri: 'bitesaver://user@subscription-success',
    cancelUri: 'bitesaver://user@subscription-cancel',
    verifyParsedSeam: true,
  ),
  (
    category: 'explicit port',
    successUri: 'bitesaver://subscription-success:444',
    cancelUri: 'bitesaver://subscription-cancel:444',
    verifyParsedSeam: true,
  ),
  (
    category: 'wrong custom scheme',
    successUri: 'bitestar://subscription-success',
    cancelUri: 'bitestar://subscription-cancel',
    verifyParsedSeam: true,
  ),
  (
    category: 'HTTPS host substitution',
    successUri: 'https://subscription-success',
    cancelUri: 'https://subscription-cancel',
    verifyParsedSeam: true,
  ),
  (
    category: 'HTTPS checkout helper substitution',
    successUri: 'https://app.bitestar.app/stripe-success.html',
    cancelUri: 'https://app.bitestar.app/stripe-cancel.html',
    verifyParsedSeam: true,
  ),
  (
    category: 'extra hostname suffix',
    successUri: 'bitesaver://subscription-success-extra',
    cancelUri: 'bitesaver://subscription-cancel-extra',
    verifyParsedSeam: true,
  ),
  (
    category: 'similar hostname',
    successUri: 'bitesaver://subscription-successful',
    cancelUri: 'bitesaver://subscription-cancellation',
    verifyParsedSeam: true,
  ),
  (
    category: 'percent-encoded path',
    successUri: 'bitesaver://subscription-success/%65xtra',
    cancelUri: 'bitesaver://subscription-cancel/%65xtra',
    verifyParsedSeam: true,
  ),
  (
    category: 'percent-encoded dot path',
    successUri: 'bitesaver://subscription-success/%2E',
    cancelUri: 'bitesaver://subscription-cancel/%2E',
    verifyParsedSeam: true,
  ),
  (
    category: 'additional empty path component',
    successUri: 'bitesaver://subscription-success//extra',
    cancelUri: 'bitesaver://subscription-cancel//extra',
    verifyParsedSeam: true,
  ),
  (
    category: 'additional authority and path components',
    successUri: 'bitesaver://subscription-success.example/extra',
    cancelUri: 'bitesaver://subscription-cancel.example/extra',
    verifyParsedSeam: true,
  ),
  (
    category: 'uppercase scheme',
    successUri: 'BITESAVER://subscription-success',
    cancelUri: 'BITESAVER://subscription-cancel',
    verifyParsedSeam: false,
  ),
  (
    category: 'mixed-case scheme',
    successUri: 'BiteSaver://subscription-success',
    cancelUri: 'BiteSaver://subscription-cancel',
    verifyParsedSeam: false,
  ),
  (
    category: 'uppercase event hostname',
    successUri: 'bitesaver://SUBSCRIPTION-SUCCESS',
    cancelUri: 'bitesaver://SUBSCRIPTION-CANCEL',
    verifyParsedSeam: false,
  ),
  (
    category: 'mixed-case event hostname',
    successUri: 'bitesaver://Subscription-Success',
    cancelUri: 'bitesaver://Subscription-Cancel',
    verifyParsedSeam: false,
  ),
  (
    category: 'uppercase scheme and event hostname',
    successUri: 'BITESAVER://SUBSCRIPTION-SUCCESS',
    cancelUri: 'BITESAVER://SUBSCRIPTION-CANCEL',
    verifyParsedSeam: false,
  ),
  (
    category: 'empty userinfo',
    successUri: 'bitesaver://@subscription-success',
    cancelUri: 'bitesaver://@subscription-cancel',
    verifyParsedSeam: false,
  ),
  (
    category: 'empty explicit port',
    successUri: 'bitesaver://subscription-success:',
    cancelUri: 'bitesaver://subscription-cancel:',
    verifyParsedSeam: false,
  ),
  (
    category: 'explicit zero port',
    successUri: 'bitesaver://subscription-success:0',
    cancelUri: 'bitesaver://subscription-cancel:0',
    verifyParsedSeam: false,
  ),
  (
    category: 'percent-encoded hostname',
    successUri: 'bitesaver://%73ubscription-success',
    cancelUri: 'bitesaver://%73ubscription-cancel',
    verifyParsedSeam: false,
  ),
];

final List<MalformedCheckoutReturnFixture> malformedCheckoutReturnFixtures =
    List<MalformedCheckoutReturnFixture>.unmodifiable(
      <MalformedCheckoutReturnFixture>[
        for (final pair in _malformedCheckoutReturnFixturePairs) ...[
          (
            category: pair.category,
            rawUri: pair.successUri,
            kind: SubscriptionReturnKind.checkoutSuccess,
            verifyParsedSeam: pair.verifyParsedSeam,
          ),
          (
            category: pair.category,
            rawUri: pair.cancelUri,
            kind: SubscriptionReturnKind.checkoutCancel,
            verifyParsedSeam: pair.verifyParsedSeam,
          ),
        ],
      ],
    );

const int freshCoordinatorFirstEventId = 0;

String canonicalUriForMalformedCheckoutFixture(
  MalformedCheckoutReturnFixture fixture,
) {
  return switch (fixture.kind) {
    SubscriptionReturnKind.checkoutSuccess =>
      subscriptionCheckoutSuccessReturnUri,
    SubscriptionReturnKind.checkoutCancel =>
      subscriptionCheckoutCancelReturnUri,
    SubscriptionReturnKind.customerPortal => throw ArgumentError.value(
      fixture.kind,
      'fixture.kind',
      'Malformed checkout fixtures cannot use the portal event kind.',
    ),
  };
}

const List<String> _lexicallyNonCanonicalPortalReturnUris = <String>[
  'BITESAVER://SUBSCRIPTION-PORTAL-RETURN',
  'bitesaver://@subscription-portal-return',
  'bitesaver://subscription-portal-return:0',
  'bitesaver://%73ubscription-portal-return',
];

int get _pendingEventCapacity => SubscriptionReturnService.maxPendingEvents;

Future<SubscriptionReturnEvent> _dispatchAcceptedReturn(
  SubscriptionReturnKind kind,
) async {
  final SubscriptionReturnEvent? event =
      await SubscriptionReturnService.dispatchReturn(kind);
  if (event == null) {
    fail('Expected $kind to be accepted');
  }
  return event;
}

Future<List<SubscriptionReturnEvent>> _fillPendingReturns({
  SubscriptionReturnKind Function(int index)? kindForIndex,
}) async {
  final events = <SubscriptionReturnEvent>[];
  for (var index = 0; index < _pendingEventCapacity; index += 1) {
    events.add(
      await _dispatchAcceptedReturn(
        kindForIndex?.call(index) ?? SubscriptionReturnKind.customerPortal,
      ),
    );
  }
  return events;
}

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await SubscriptionReturnService.resetForTesting();
  });
  tearDown(SubscriptionReturnService.resetForTesting);

  test(
    'stores Restaurant Hub as the intended subscription return context',
    () async {
      await SubscriptionReturnService.markRestaurantHubCheckoutStarted();

      expect(
        await SubscriptionReturnService.pendingReturnContext(),
        SubscriptionReturnService.restaurantHubContext,
      );
    },
  );

  test(
    'dispatching a successful return emits an event and clears context',
    () async {
      await SubscriptionReturnService.markRestaurantHubCheckoutStarted();

      final event = await _dispatchAcceptedReturn(
        SubscriptionReturnKind.checkoutSuccess,
      );

      expect(event.kind, SubscriptionReturnKind.checkoutSuccess);
      expect(SubscriptionReturnService.peekPendingNavigation(), same(event));
      expect(SubscriptionReturnService.peekPendingRefresh(), same(event));
      expect(await SubscriptionReturnService.pendingReturnContext(), isNull);
    },
  );

  test('dispatching a canceled return emits a cancel event', () async {
    final event = await _dispatchAcceptedReturn(
      SubscriptionReturnKind.checkoutCancel,
    );

    expect(event.kind, SubscriptionReturnKind.checkoutCancel);
  });

  test(
    'navigation and refresh claims are global and complete the event',
    () async {
      final event = await _dispatchAcceptedReturn(
        SubscriptionReturnKind.customerPortal,
      );

      expect(SubscriptionReturnService.pendingEventCount, 1);
      expect(SubscriptionReturnService.claimNavigation(event.id), isTrue);
      expect(SubscriptionReturnService.claimNavigation(event.id), isFalse);
      expect(SubscriptionReturnService.pendingEventCount, 1);
      expect(SubscriptionReturnService.claimRefresh(event.id), isTrue);
      expect(SubscriptionReturnService.claimRefresh(event.id), isFalse);
      expect(SubscriptionReturnService.pendingEventCount, 0);
      expect(SubscriptionReturnService.peekPendingNavigation(), isNull);
      expect(SubscriptionReturnService.peekPendingRefresh(), isNull);
    },
  );

  test(
    'one source delivery creates one event and coordinator starts only once',
    () async {
      final source = StreamController<Uri>();
      final events = <SubscriptionReturnEvent>[];
      final eventSubscription = SubscriptionReturnService.events.listen(
        events.add,
      );

      SubscriptionReturnService.startAppLinkIngestion(links: source.stream);
      SubscriptionReturnService.startAppLinkIngestion(links: source.stream);
      expect(SubscriptionReturnService.appLinkIngestionStarted, isTrue);

      source.add(Uri.parse(subscriptionPortalReturnUri));
      await Future<void>.delayed(Duration.zero);

      expect(events, hasLength(1));
      expect(events.single.kind, SubscriptionReturnKind.customerPortal);
      expect(SubscriptionReturnService.pendingEventCount, 1);

      await eventSubscription.cancel();
      await source.close();
    },
  );

  test('one exact raw source delivery creates one event', () async {
    final source = StreamController<String>();
    final events = <SubscriptionReturnEvent>[];
    final eventSubscription = SubscriptionReturnService.events.listen(
      events.add,
    );
    addTearDown(eventSubscription.cancel);
    addTearDown(source.close);
    SubscriptionReturnService.startAppLinkIngestion(rawLinks: source.stream);

    source.add(subscriptionCheckoutSuccessReturnUri);
    await Future<void>.delayed(Duration.zero);

    expect(events, hasLength(1));
    expect(events.single.kind, SubscriptionReturnKind.checkoutSuccess);
    expect(
      SubscriptionReturnService.peekPendingNavigation(),
      same(events.single),
    );
    expect(SubscriptionReturnService.peekPendingRefresh(), same(events.single));
  });

  test(
    'a genuine later source delivery with the same URI gets a new ID',
    () async {
      final source = StreamController<Uri>();
      final events = <SubscriptionReturnEvent>[];
      final eventSubscription = SubscriptionReturnService.events.listen(
        events.add,
      );
      SubscriptionReturnService.startAppLinkIngestion(links: source.stream);

      final portalUri = Uri.parse(subscriptionPortalReturnUri);
      source.add(portalUri);
      await Future<void>.delayed(Duration.zero);
      final firstEvent = events.single;
      expect(SubscriptionReturnService.claimNavigation(firstEvent.id), isTrue);
      expect(SubscriptionReturnService.claimRefresh(firstEvent.id), isTrue);
      SubscriptionReturnService.finishRefresh(firstEvent.id);

      source.add(portalUri);
      await Future<void>.delayed(Duration.zero);

      expect(events, hasLength(2));
      expect(events.last.id, greaterThan(firstEvent.id));
      expect(events.last.kind, SubscriptionReturnKind.customerPortal);
      expect(SubscriptionReturnService.pendingEventCount, 1);

      await eventSubscription.cancel();
      await source.close();
    },
  );

  test('capacity overflow preserves every fully unclaimed event', () async {
    final events = await _fillPendingReturns();

    final overflow = await SubscriptionReturnService.dispatchReturn(
      SubscriptionReturnKind.customerPortal,
    );

    expect(overflow, isNull);
    expect(SubscriptionReturnService.pendingEventCount, _pendingEventCapacity);
    expect(
      SubscriptionReturnService.peekPendingNavigation()?.id,
      events.first.id,
    );
    expect(SubscriptionReturnService.peekPendingRefresh()?.id, events.first.id);
    for (final event in events) {
      expect(SubscriptionReturnService.claimNavigation(event.id), isTrue);
      expect(SubscriptionReturnService.claimRefresh(event.id), isTrue);
      SubscriptionReturnService.finishRefresh(event.id);
    }
    expect(SubscriptionReturnService.pendingEventCount, 0);
  });

  test('capacity overflow preserves a navigation-only event', () async {
    final events = await _fillPendingReturns();
    final firstEvent = events.first;
    expect(SubscriptionReturnService.claimNavigation(firstEvent.id), isTrue);

    final overflow = await SubscriptionReturnService.dispatchReturn(
      SubscriptionReturnKind.checkoutSuccess,
    );

    expect(overflow, isNull);
    expect(SubscriptionReturnService.pendingEventCount, _pendingEventCapacity);
    expect(SubscriptionReturnService.claimRefresh(firstEvent.id), isTrue);
    expect(SubscriptionReturnService.claimNavigation(firstEvent.id), isFalse);
    SubscriptionReturnService.finishRefresh(firstEvent.id);
  });

  test('capacity overflow preserves a refresh-only event', () async {
    final events = await _fillPendingReturns();
    final firstEvent = events.first;
    expect(SubscriptionReturnService.claimRefresh(firstEvent.id), isTrue);
    SubscriptionReturnService.finishRefresh(firstEvent.id);

    final overflow = await SubscriptionReturnService.dispatchReturn(
      SubscriptionReturnKind.checkoutCancel,
    );

    expect(overflow, isNull);
    expect(SubscriptionReturnService.pendingEventCount, _pendingEventCapacity);
    expect(SubscriptionReturnService.claimNavigation(firstEvent.id), isTrue);
    expect(SubscriptionReturnService.claimRefresh(firstEvent.id), isFalse);
  });

  test(
    'capacity overflow preserves mixed kinds and partial claim states',
    () async {
      const kinds = SubscriptionReturnKind.values;
      final events = await _fillPendingReturns(
        kindForIndex: (index) => kinds[index % kinds.length],
      );

      for (var index = 0; index < events.length; index += 1) {
        final event = events[index];
        switch (index % 3) {
          case 0:
            expect(SubscriptionReturnService.claimNavigation(event.id), isTrue);
            break;
          case 1:
            expect(SubscriptionReturnService.claimRefresh(event.id), isTrue);
            SubscriptionReturnService.finishRefresh(event.id);
            break;
          case 2:
            break;
        }
      }

      final overflow = await SubscriptionReturnService.dispatchReturn(
        SubscriptionReturnKind.checkoutSuccess,
      );

      expect(overflow, isNull);
      expect(
        SubscriptionReturnService.pendingEventCount,
        _pendingEventCapacity,
      );
      for (var index = 0; index < events.length; index += 1) {
        final event = events[index];
        expect(event.kind, kinds[index % kinds.length]);
        switch (index % 3) {
          case 0:
            expect(
              SubscriptionReturnService.claimNavigation(event.id),
              isFalse,
            );
            expect(SubscriptionReturnService.claimRefresh(event.id), isTrue);
            SubscriptionReturnService.finishRefresh(event.id);
            break;
          case 1:
            expect(SubscriptionReturnService.claimNavigation(event.id), isTrue);
            expect(SubscriptionReturnService.claimRefresh(event.id), isFalse);
            break;
          case 2:
            expect(SubscriptionReturnService.claimNavigation(event.id), isTrue);
            expect(SubscriptionReturnService.claimRefresh(event.id), isTrue);
            SubscriptionReturnService.finishRefresh(event.id);
            break;
        }
      }
      expect(SubscriptionReturnService.pendingEventCount, 0);
    },
  );

  test('completed events free capacity and cannot be claimed again', () async {
    final event = await _dispatchAcceptedReturn(
      SubscriptionReturnKind.customerPortal,
    );

    expect(SubscriptionReturnService.claimNavigation(event.id), isTrue);
    expect(SubscriptionReturnService.claimRefresh(event.id), isTrue);
    SubscriptionReturnService.finishRefresh(event.id);

    expect(SubscriptionReturnService.pendingEventCount, 0);
    expect(SubscriptionReturnService.claimNavigation(event.id), isFalse);
    expect(SubscriptionReturnService.claimRefresh(event.id), isFalse);
    final nextEvent = await _dispatchAcceptedReturn(
      SubscriptionReturnKind.checkoutSuccess,
    );
    expect(nextEvent.id, greaterThan(event.id));
    expect(SubscriptionReturnService.pendingEventCount, 1);
  });

  test('overflow rejection recovers with monotonic accepted IDs', () async {
    final emittedEvents = <SubscriptionReturnEvent>[];
    final subscription = SubscriptionReturnService.events.listen(
      emittedEvents.add,
    );
    addTearDown(subscription.cancel);
    final events = await _fillPendingReturns();
    expect(emittedEvents, events);

    final rejected = await SubscriptionReturnService.dispatchReturn(
      SubscriptionReturnKind.checkoutCancel,
    );

    expect(rejected, isNull);
    expect(emittedEvents, hasLength(_pendingEventCapacity));
    expect(SubscriptionReturnService.pendingEventCount, _pendingEventCapacity);
    expect(SubscriptionReturnService.claimNavigation(events.first.id), isTrue);
    expect(SubscriptionReturnService.claimRefresh(events.first.id), isTrue);
    SubscriptionReturnService.finishRefresh(events.first.id);

    final recovered = await _dispatchAcceptedReturn(
      SubscriptionReturnKind.checkoutCancel,
    );

    expect(recovered.id, events.last.id + 1);
    expect(
      emittedEvents.map((event) => event.id),
      orderedEquals(<int>[...events.map((event) => event.id), recovered.id]),
    );
    expect(SubscriptionReturnService.pendingEventCount, _pendingEventCapacity);
    expect(SubscriptionReturnService.peekPendingNavigation()?.id, events[1].id);
    expect(SubscriptionReturnService.peekPendingRefresh()?.id, events[1].id);
  });

  test(
    'source overflow preserves pending work and later accepts the same URI',
    () async {
      final source = StreamController<Uri>();
      final emittedEvents = <SubscriptionReturnEvent>[];
      final eventSubscription = SubscriptionReturnService.events.listen(
        emittedEvents.add,
      );
      addTearDown(eventSubscription.cancel);
      addTearDown(source.close);
      SubscriptionReturnService.startAppLinkIngestion(links: source.stream);
      final retainedEvents = await _fillPendingReturns();
      final portalUri = Uri.parse(subscriptionPortalReturnUri);

      source.add(portalUri);
      await Future<void>.delayed(Duration.zero);

      expect(emittedEvents, retainedEvents);
      expect(
        SubscriptionReturnService.pendingEventCount,
        _pendingEventCapacity,
      );
      expect(
        SubscriptionReturnService.peekPendingNavigation()?.id,
        retainedEvents.first.id,
      );
      expect(
        SubscriptionReturnService.peekPendingRefresh()?.id,
        retainedEvents.first.id,
      );

      expect(
        SubscriptionReturnService.claimNavigation(retainedEvents.first.id),
        isTrue,
      );
      expect(
        SubscriptionReturnService.claimRefresh(retainedEvents.first.id),
        isTrue,
      );
      SubscriptionReturnService.finishRefresh(retainedEvents.first.id);
      source.add(portalUri);
      await Future<void>.delayed(Duration.zero);

      expect(emittedEvents, hasLength(_pendingEventCapacity + 1));
      final recoveredEvent = emittedEvents.last;
      expect(recoveredEvent.id, retainedEvents.last.id + 1);
      expect(recoveredEvent.kind, SubscriptionReturnKind.customerPortal);
      expect(
        SubscriptionReturnService.pendingEventCount,
        _pendingEventCapacity,
      );

      source.add(portalUri);
      await Future<void>.delayed(Duration.zero);
      expect(emittedEvents, hasLength(_pendingEventCapacity + 1));

      expect(
        SubscriptionReturnService.claimNavigation(retainedEvents[1].id),
        isTrue,
      );
      expect(
        SubscriptionReturnService.claimRefresh(retainedEvents[1].id),
        isTrue,
      );
      SubscriptionReturnService.finishRefresh(retainedEvents[1].id);
      source.add(portalUri);
      await Future<void>.delayed(Duration.zero);

      expect(emittedEvents, hasLength(_pendingEventCapacity + 2));
      expect(emittedEvents.last.id, greaterThan(recoveredEvent.id));
      expect(emittedEvents.last.kind, SubscriptionReturnKind.customerPortal);
      expect(
        SubscriptionReturnService.pendingEventCount,
        _pendingEventCapacity,
      );
    },
  );

  test(
    'one lifecycle refresh is app-wide and coalesces with only one return',
    () async {
      final firstHub = Object();
      final secondHub = Object();
      final lifecycleRefresh = Completer<bool>();

      expect(
        SubscriptionReturnService.claimRestaurantHubLifecycleRefresh(firstHub),
        isTrue,
      );
      expect(
        SubscriptionReturnService.claimRestaurantHubLifecycleRefresh(secondHub),
        isFalse,
      );
      SubscriptionReturnService.registerRestaurantHubLifecycleRefresh(
        firstHub,
        lifecycleRefresh.future,
      );
      lifecycleRefresh.complete(true);
      SubscriptionReturnService.finishRestaurantHubLifecycleRefresh(firstHub);

      final firstEvent = await _dispatchAcceptedReturn(
        SubscriptionReturnKind.customerPortal,
      );
      final secondEvent = await _dispatchAcceptedReturn(
        SubscriptionReturnKind.customerPortal,
      );
      expect(SubscriptionReturnService.claimNavigation(firstEvent.id), isTrue);
      expect(SubscriptionReturnService.claimNavigation(secondEvent.id), isTrue);

      final firstCandidate =
          SubscriptionReturnService.peekPendingRefreshCandidate();
      expect(firstCandidate?.event.id, firstEvent.id);
      expect(firstCandidate?.coalescedLifecycleRefresh, isNotNull);
      expect(SubscriptionReturnService.claimRefresh(firstEvent.id), isTrue);

      final secondCandidate =
          SubscriptionReturnService.peekPendingRefreshCandidate();
      expect(secondCandidate?.event.id, secondEvent.id);
      expect(secondCandidate?.coalescedLifecycleRefresh, isNull);
      expect(SubscriptionReturnService.claimRefresh(secondEvent.id), isTrue);

      expect(await firstCandidate!.coalescedLifecycleRefresh, isTrue);
      SubscriptionReturnService.finishRefresh(firstEvent.id);
      SubscriptionReturnService.finishRefresh(secondEvent.id);

      SubscriptionReturnService.noteRestaurantHubLifecycleNotResumed();
      expect(
        SubscriptionReturnService.claimRestaurantHubLifecycleRefresh(secondHub),
        isTrue,
      );
      SubscriptionReturnService.finishRestaurantHubLifecycleRefresh(secondHub);
    },
  );

  test('canonical customer portal return URL is exact and credential-free', () {
    final uri = Uri.parse(stripeCustomerPortalReturnUrl);

    expect(uri.scheme, 'https');
    expect(uri.host, 'app.bitestar.app');
    expect(uri.hasPort, isFalse);
    expect(uri.path, '/subscription/portal-return');
    expect(uri.hasQuery, isFalse);
    expect(uri.hasFragment, isFalse);
    expect(uri.userInfo, isEmpty);
    expect(uri.toString(), stripeCustomerPortalReturnUrl);
  });

  test('parses the exact neutral customer portal return event', () {
    expect(
      parseSubscriptionReturnUri(Uri.parse(subscriptionPortalReturnUri)),
      SubscriptionReturnKind.customerPortal,
    );
    expect(
      parseSubscriptionReturnLink(subscriptionPortalReturnUri),
      SubscriptionReturnKind.customerPortal,
    );
  });

  test('rejects non-exact customer portal return variants', () {
    const rejected = <String>[
      'bitesaver://subscription-portal-return/',
      'bitesaver://subscription-portal-return/extra',
      'bitesaver://subscription-portal-return?source=caller',
      'bitesaver://subscription-portal-return?',
      'bitesaver://subscription-portal-return#caller',
      'bitesaver://subscription-portal-return#',
      'bitesaver://user@subscription-portal-return',
      'bitesaver://subscription-portal-return:444',
      'https://app.bitestar.app/subscription/portal-return',
      'bitestar://subscription-portal-return',
      'bitesaver://subscription-portal',
      'bitesaver://subscription-portal-return-extra',
      'bitesaver://subscription-portal-return/%65xtra',
      'bitesaver://subscription-portal-return//extra',
    ];

    for (final rawUri in rejected) {
      expect(
        parseSubscriptionReturnUri(Uri.parse(rawUri)),
        isNull,
        reason: rawUri,
      );
      expect(parseSubscriptionReturnLink(rawUri), isNull, reason: rawUri);
    }
  });

  test('rejects non-exact checkout success and cancel variants', () {
    for (final fixture in malformedCheckoutReturnFixtures) {
      expect(
        parseSubscriptionReturnLink(fixture.rawUri),
        isNull,
        reason: '${fixture.kind.name}: ${fixture.category}',
      );
      if (fixture.verifyParsedSeam) {
        expect(
          parseSubscriptionReturnUri(Uri.parse(fixture.rawUri)),
          isNull,
          reason: '${fixture.kind.name}: ${fixture.category}',
        );
      }
    }
  });

  test('raw matcher still rejects noncanonical portal URI spellings', () {
    for (final rawUri in _lexicallyNonCanonicalPortalReturnUris) {
      expect(parseSubscriptionReturnLink(rawUri), isNull, reason: rawUri);
    }
  });

  test(
    'every malformed checkout delivery preserves the next logical event ID',
    () async {
      for (final fixture in malformedCheckoutReturnFixtures) {
        await SubscriptionReturnService.resetForTesting();
        final source = StreamController<String>();
        final events = <SubscriptionReturnEvent>[];
        final eventSubscription = SubscriptionReturnService.events.listen(
          events.add,
        );
        try {
          SubscriptionReturnService.startAppLinkIngestion(
            rawLinks: source.stream,
          );

          source.add(fixture.rawUri);
          await Future<void>.delayed(Duration.zero);

          expect(
            events,
            isEmpty,
            reason: '${fixture.kind.name}: ${fixture.category}',
          );
          expect(
            SubscriptionReturnService.pendingEventCount,
            0,
            reason: '${fixture.kind.name}: ${fixture.category}',
          );
          expect(
            SubscriptionReturnService.peekPendingNavigation(),
            isNull,
            reason: '${fixture.kind.name}: ${fixture.category}',
          );
          expect(
            SubscriptionReturnService.peekPendingRefresh(),
            isNull,
            reason: '${fixture.kind.name}: ${fixture.category}',
          );

          source.add(canonicalUriForMalformedCheckoutFixture(fixture));
          await Future<void>.delayed(Duration.zero);

          expect(
            events,
            hasLength(1),
            reason: '${fixture.kind.name}: ${fixture.category}',
          );
          expect(
            events.single.id,
            freshCoordinatorFirstEventId,
            reason: '${fixture.kind.name}: ${fixture.category}',
          );
          expect(
            events.single.kind,
            fixture.kind,
            reason: '${fixture.kind.name}: ${fixture.category}',
          );
          expect(
            SubscriptionReturnService.peekPendingNavigation()?.id,
            freshCoordinatorFirstEventId,
            reason: '${fixture.kind.name}: ${fixture.category}',
          );
          expect(
            SubscriptionReturnService.peekPendingRefresh()?.id,
            freshCoordinatorFirstEventId,
            reason: '${fixture.kind.name}: ${fixture.category}',
          );
        } finally {
          await eventSubscription.cancel();
          await source.close();
        }
      }
    },
  );

  test(
    'lexically noncanonical portal deliveries create no pending event',
    () async {
      final source = StreamController<String>();
      final events = <SubscriptionReturnEvent>[];
      final eventSubscription = SubscriptionReturnService.events.listen(
        events.add,
      );
      addTearDown(eventSubscription.cancel);
      addTearDown(source.close);
      SubscriptionReturnService.startAppLinkIngestion(rawLinks: source.stream);

      for (final rawUri in _lexicallyNonCanonicalPortalReturnUris) {
        source.add(rawUri);
        await Future<void>.delayed(Duration.zero);

        expect(events, isEmpty, reason: rawUri);
        expect(SubscriptionReturnService.pendingEventCount, 0, reason: rawUri);
      }
    },
  );

  test('preserves checkout success, cancel, and legacy parsing', () {
    expect(
      parseSubscriptionReturnUri(Uri.parse('bitesaver://subscription-success')),
      SubscriptionReturnKind.checkoutSuccess,
    );
    expect(
      parseSubscriptionReturnUri(Uri.parse('bitesaver://subscription-cancel')),
      SubscriptionReturnKind.checkoutCancel,
    );
    expect(
      parseSubscriptionReturnLink(subscriptionCheckoutSuccessReturnUri),
      SubscriptionReturnKind.checkoutSuccess,
    );
    expect(
      parseSubscriptionReturnLink(subscriptionCheckoutCancelReturnUri),
      SubscriptionReturnKind.checkoutCancel,
    );
    expect(
      parseSubscriptionReturnUri(
        Uri.parse('couponapp://subscription-return?status=success'),
      ),
      SubscriptionReturnKind.checkoutSuccess,
    );
    expect(
      parseSubscriptionReturnUri(
        Uri.parse('couponapp://subscription-return?status=cancel'),
      ),
      SubscriptionReturnKind.checkoutCancel,
    );
    expect(
      parseSubscriptionReturnLink(
        'couponapp://subscription-return?status=success',
      ),
      SubscriptionReturnKind.checkoutSuccess,
    );
    expect(
      parseSubscriptionReturnLink(
        'couponapp://subscription-return?status=cancel',
      ),
      SubscriptionReturnKind.checkoutCancel,
    );
  });

  test('does not collide with customer, BiteScore, invite, or admin links', () {
    const unrelatedLinks = <String>[
      'bitesaver://r/coupons/restaurant-1',
      'bitesaver://r/bitescore/restaurant-1',
      'bitesaver://invite/coupon/invite-token',
      'bitesaver://invite/bitescore/invite-token',
      'https://go.bitestar.app/r/coupons/restaurant-1',
      'couponapp://open',
      'bitesaver://admin',
    ];

    for (final rawUri in unrelatedLinks) {
      expect(
        parseSubscriptionReturnUri(Uri.parse(rawUri)),
        isNull,
        reason: rawUri,
      );
    }
  });

  test('tracks whether a Restaurant Hub is already active', () {
    expect(SubscriptionReturnService.hasActiveRestaurantHub, isFalse);

    SubscriptionReturnService.registerRestaurantHub();
    expect(SubscriptionReturnService.hasActiveRestaurantHub, isTrue);

    SubscriptionReturnService.unregisterRestaurantHub();
    expect(SubscriptionReturnService.hasActiveRestaurantHub, isFalse);
  });

  test(
    'active Restaurant Hub tracking is safe if unregister is called extra',
    () {
      SubscriptionReturnService.unregisterRestaurantHub();

      expect(SubscriptionReturnService.hasActiveRestaurantHub, isFalse);
    },
  );
}
