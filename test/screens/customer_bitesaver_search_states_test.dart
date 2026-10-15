import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/screens/customer_bitesaver_browse_screen.dart';
import 'package:coupon_app/services/customer_bitesaver_guest_usage_store.dart';
import 'package:coupon_app/services/customer_bitesaver_search_coordinator.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    SharedLocationStateService.resetForTesting();
  });
  tearDown(SharedLocationStateService.resetForTesting);

  testWidgets(
    'repeated transient status retries preserve the exact search until recovery',
    (tester) async {
      final fixture = _StateFixture(preparing: true, statusFailures: 2);
      await fixture.pump(tester);
      await fixture.until(tester, () => fixture.statusRequests.length == 1);
      expect(find.text('Could not continue this search.'), findsOneWidget);
      expect(find.text('No nearby deals yet'), findsNothing);
      expect(fixture.coordinator.canRetryStatusPoll, isTrue);
      final original = fixture.statusRequests.single;
      await tester.tap(find.text('Try Again'));
      await tester.pumpAndSettle();
      expect(
        fixture.starts,
        hasLength(1),
        reason:
            'An uncertain retry must not silently become another fresh search.',
      );
      expect(fixture.statusRequests, [original, original]);
      expect(find.text('Could not continue this search.'), findsOneWidget);
      expect(find.text('No nearby deals yet'), findsNothing);
      await tester.tap(find.text('Try Again'));
      await fixture.until(
        tester,
        () => find.text('No nearby deals yet').evaluate().isNotEmpty,
      );
      expect(fixture.statusRequests, [original, original, original]);
      expect(fixture.starts, hasLength(1));
      expect(fixture.pages, hasLength(1));
    },
  );

  testWidgets(
    'poll budget exhaustion retains the established fresh-search recovery',
    (tester) async {
      final fixture = _StateFixture(
        preparing: true,
        statusState: 'preparing',
        maximumStatusPolls: 2,
      );
      await fixture.pump(tester);
      await fixture.until(
        tester,
        () =>
            fixture.coordinator.error
                is CustomerBiteSaverProtocolBudgetException,
      );
      expect(fixture.coordinator.canRetryStatusPoll, isFalse);
      expect(find.text('No nearby deals yet'), findsNothing);
      await tester.tap(find.text('Try Again'));
      await fixture.until(
        tester,
        () => find.text('No nearby deals yet').evaluate().isNotEmpty,
      );
      expect(fixture.starts.map((r) => r['freshSearch']), [false, true]);
    },
  );

  testWidgets(
    'start failure remains an error and exact retry can confirm empty',
    (tester) async {
      final fixture = _StateFixture(startFailures: 1);
      await fixture.pump(tester);
      await fixture.until(
        tester,
        () => find.text('Try Again').evaluate().isNotEmpty,
      );
      expect(find.text('No nearby deals yet'), findsNothing);
      expect(fixture.pages, isEmpty);
      await tester.tap(find.text('Try Again'));
      await fixture.until(
        tester,
        () => find.text('No nearby deals yet').evaluate().isNotEmpty,
      );
      expect(fixture.starts, hasLength(2));
      expect(fixture.starts.last, fixture.starts.first);
    },
  );

  testWidgets('no location requests a center without starting search', (
    tester,
  ) async {
    final fixture = _StateFixture();
    await fixture.pump(tester, location: false);
    await tester.pumpAndSettle();
    expect(find.text('Find great food near you 🍽️'), findsOneWidget);
    expect(find.text('No nearby deals yet'), findsNothing);
    expect(fixture.starts, isEmpty);
  });

  testWidgets(
    'preparation and first-page loading never claim confirmed empty',
    (tester) async {
      final statusGate = Completer<void>(), pageGate = Completer<void>();
      final fixture = _StateFixture(
        preparing: true,
        statusGate: statusGate.future,
        pageGate: pageGate.future,
      );
      await fixture.pump(tester);
      await fixture.until(tester, () => fixture.statusRequests.isNotEmpty);
      expect(find.text('Preparing nearby deals…'), findsOneWidget);
      expect(find.text('No nearby deals yet'), findsNothing);
      statusGate.complete();
      await fixture.until(tester, () => fixture.pages.isNotEmpty);
      expect(find.text('Loading nearby restaurants…'), findsOneWidget);
      expect(find.text('No nearby deals yet'), findsNothing);
      pageGate.complete();
      await fixture.until(
        tester,
        () => find.text('No nearby deals yet').evaluate().isNotEmpty,
      );
    },
  );

  testWidgets(
    'first-page transport failure retries that page in the same session',
    (tester) async {
      final fixture = _StateFixture(pageFailures: 1);
      await fixture.pump(tester);
      await fixture.until(
        tester,
        () => find.text('Could not load nearby deals.').evaluate().isNotEmpty,
      );
      expect(find.text('No nearby deals yet'), findsNothing);
      await tester.tap(find.text('Try Again'));
      await fixture.until(
        tester,
        () => find.text('No nearby deals yet').evaluate().isNotEmpty,
      );
      expect(fixture.starts, hasLength(1));
      expect(fixture.pages, hasLength(2));
      expect(fixture.pages.last, fixture.pages.first);
    },
  );

  testWidgets(
    'empty partial page continues its bounded cursor before confirmed empty',
    (tester) async {
      final fixture = _StateFixture(partialFirst: true);
      await fixture.pump(tester);
      await fixture.until(
        tester,
        () => find.text('Continue Search').evaluate().isNotEmpty,
      );
      expect(find.text('No nearby deals yet'), findsNothing);
      await tester.tap(find.text('Continue Search'));
      await fixture.until(
        tester,
        () => find.text('No nearby deals yet').evaluate().isNotEmpty,
      );
      expect(fixture.pages.map((r) => r['cursor']), [
        null,
        'bsc1.local-continuation',
      ]);
      expect(fixture.starts, hasLength(1));
    },
  );

  testWidgets('expired status uses explicit fresh search', (tester) async {
    final fixture = _StateFixture(preparing: true, statusState: 'expired');
    await fixture.pump(tester);
    await fixture.until(
      tester,
      () => find.text('This search has expired.').evaluate().isNotEmpty,
    );
    expect(find.text('No nearby deals yet'), findsNothing);
    await tester.tap(find.text('Fresh Search'));
    await fixture.until(
      tester,
      () => find.text('No nearby deals yet').evaluate().isNotEmpty,
    );
    expect(fixture.starts.map((r) => r['freshSearch']), [false, true]);
  });

  testWidgets(
    'preparation failure stays distinct from empty and retries when permitted',
    (tester) async {
      final fixture = _StateFixture(preparing: true, statusState: 'failed');
      await fixture.pump(tester);
      await fixture.until(
        tester,
        () => find
            .text('This search could not be prepared.')
            .evaluate()
            .isNotEmpty,
      );
      expect(find.text('No nearby deals yet'), findsNothing);
      await tester.tap(find.text('Try Again'));
      await fixture.until(
        tester,
        () => find.text('No nearby deals yet').evaluate().isNotEmpty,
      );
      expect(fixture.starts, hasLength(2));
    },
  );
}

Map<String, Object?> _map(Object? value) =>
    (value! as Map).cast<String, Object?>();
Map<String, Object?> _copy(Object? value) =>
    _map(jsonDecode(jsonEncode(value)));

class _StateFixture {
  _StateFixture({
    this.preparing = false,
    this.startFailures = 0,
    this.statusFailures = 0,
    this.pageFailures = 0,
    this.partialFirst = false,
    this.statusState = 'ready',
    this.maximumStatusPolls = 20,
    this.statusGate,
    this.pageGate,
  }) {
    final fixture = _map(
      jsonDecode(
        File(
          'test/fixtures/customer_bitesaver_client_boundary_v1.json',
        ).readAsStringSync(),
      ),
    );
    responses = _map(_map(fixture['signed'])['responses']);
    final evaluation = _map(
      _map(responses['restaurantPage'])['evaluationContext'],
    );
    var requestSequence = 0;
    DateTime clock() => DateTime.fromMillisecondsSinceEpoch(
      evaluation['evaluationAtMillis']! as int,
      isUtc: true,
    );
    coordinator = CustomerBiteSaverSearchCoordinator(
      api: CustomerBiteSaverService(transport: call),
      guestUsageStore: CustomerBiteSaverGuestUsageStore(
        guestDeviceId: 'search-states-local-device',
        preferences: _MemoryPreferences(),
        clock: clock,
      ),
      clientInstanceId: 'search-states-local-client',
      initialAuth: const CustomerBiteSaverAuthSnapshot.signed('local-reader'),
      authSnapshotProvider: () => coordinator.auth,
      requestIdGenerator: () => 'search-state-request-${++requestSequence}',
      clock: clock,
      statusPollInterval: const Duration(milliseconds: 10),
      maximumStatusPolls: maximumStatusPolls,
    );
  }
  final bool preparing, partialFirst;
  final int startFailures, statusFailures, pageFailures;
  final String statusState;
  final int maximumStatusPolls;
  final Future<void>? statusGate, pageGate;
  late final Map<String, Object?> responses;
  late final CustomerBiteSaverSearchCoordinator coordinator;
  final starts = <Map<String, Object?>>[],
      statusRequests = <Map<String, Object?>>[],
      pages = <Map<String, Object?>>[];

  Future<Object?> call(String name, Map<String, Object?> request) async {
    switch (name) {
      case CustomerBiteSaverService.startCallableName:
        starts.add(_copy(request));
        if (starts.length <= startFailures) {
          throw StateError('local start unavailable');
        }
        final response = _copy(responses['start']);
        response['state'] = preparing && starts.length == 1
            ? 'preparing'
            : 'ready';
        return response;
      case CustomerBiteSaverService.statusCallableName:
        statusRequests.add(_copy(request));
        if (statusRequests.length <= statusFailures) {
          throw StateError('local status unavailable');
        }
        await statusGate;
        return _copy(_map(responses['status'])[statusState]);
      case CustomerBiteSaverService.restaurantPageCallableName:
        pages.add(_copy(request));
        if (pages.length <= pageFailures) {
          throw StateError('local page unavailable');
        }
        await pageGate;
        final response = _copy(responses['restaurantPage']);
        final partial = partialFirst && pages.length == 1;
        response['restaurants'] = <Object?>[];
        response['hasMore'] = partial;
        response['partial'] = partial;
        response['nextCursor'] = partial ? 'bsc1.local-continuation' : null;
        return response;
      default:
        throw StateError('Unexpected local callable: $name');
    }
  }

  Future<void> pump(WidgetTester tester, {bool location = true}) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(430, 932);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: CustomerBiteSaverBrowseScreen(
          coordinator: coordinator,
          timeContextProvider: () async => const CustomerBiteSaverTimeContext(
            timeZone: 'America/New_York',
            utcOffsetMinutes: -240,
          ),
          onAction: (_, _) async => const CustomerBiteSaverBrowseActionResult(),
          locationRestoreLoader: () async => SharedLocationRestoreResult(
            state: location
                ? const SharedLocationState(
                    usingTypedSearchLocation: true,
                    typedLatitude: 28.5383,
                    typedLongitude: -81.3792,
                    searchText: '32801',
                  )
                : const SharedLocationState(),
          ),
        ),
      ),
    );
  }

  Future<void> until(WidgetTester tester, bool Function() predicate) async {
    for (var i = 0; i < 100; i++) {
      await tester.pump(const Duration(milliseconds: 10));
      if (predicate()) return;
    }
    fail('Local search-state fixture did not reach its expected state.');
  }
}

class _MemoryPreferences implements CustomerBiteSaverGuestUsagePreferences {
  final values = <String, String>{};
  @override
  Future<String?> getString(String key) async => values[key];
  @override
  Future<void> remove(String key) async {
    values.remove(key);
  }

  @override
  Future<void> setString(String key, String value) async {
    values[key] = value;
  }
}
