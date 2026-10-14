import 'dart:convert';
import 'dart:io';
import 'package:coupon_app/screens/customer_bitesaver_browse_screen.dart';
import 'package:coupon_app/services/customer_bitesaver_search_coordinator.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:coupon_app/services/customer_bitesaver_guest_usage_store.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../support/customer_bitesaver_device_use_fixture.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    SharedLocationStateService.resetForTesting();
  });
  tearDown(SharedLocationStateService.resetForTesting);
  for (final scale in [1.0, 2.0]) {
    testWidgets(
      'bounded Saver 320dp scale $scale retains search when expanding',
      (tester) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = const Size(320, 640);
        addTearDown(tester.view.reset);
        final fixture =
            jsonDecode(
                  File(
                    'test/fixtures/customer_bitesaver_client_boundary_v1.json',
                  ).readAsStringSync(),
                )
                as Map;
        final responses = (fixture['signed'] as Map)['responses'] as Map;
        Map<String, dynamic> clone(Object? value) =>
            jsonDecode(jsonEncode(value)) as Map<String, dynamic>;
        final page = clone(responses['restaurantPage']);
        final now = DateTime.fromMillisecondsSinceEpoch(
          (page['evaluationContext'] as Map)['evaluationAtMillis'] as int,
          isUtc: true,
        );
        page['restaurants'] = List.generate(12, (i) {
          final r = clone((page['restaurants'] as List).first);
          r['restaurantId'] =
              'bsr_${base64Url.encode(List.filled(32, i + 1)).replaceAll('=', '')}';
          r['displayName'] = 'Local Cafe $i';
          r['offers'] = [];
          r['usableOfferCount'] = 0;
          r['hasMoreOffers'] = false;
          return r;
        });
        var starts = 0;
        var pages = 0;
        final device = CustomerBiteSaverDeviceUseFixture(
          evaluatedAtMillis: now.millisecondsSinceEpoch,
          authenticatedUserId: 'local-header',
        );
        addTearDown(device.dispose);
        late CustomerBiteSaverSearchCoordinator coordinator;
        coordinator = CustomerBiteSaverSearchCoordinator(
          api: CustomerBiteSaverService(
            transport: (name, request) async {
              if (name == CustomerBiteSaverService.startCallableName) {
                starts++;
                return clone(responses['start'])..['state'] = 'ready';
              }
              if (name == CustomerBiteSaverService.restaurantPageCallableName) {
                pages++;
                return clone(page);
              }
              if (name == CustomerBiteSaverService.favoriteStatesCallableName) {
                return clone(responses['favoriteStates']);
              }
              throw StateError('Unexpected synthetic read $name');
            },
          ),
          deviceUseService: device.service,
          authSnapshotProvider: () => coordinator.auth,
          guestUsageStore: CustomerBiteSaverGuestUsageStore(
            guestDeviceId: 'local-header-device',
            preferences: _MemoryPreferences(),
            clock: () => now,
          ),
          clientInstanceId: 'local-header-client-0001',
          initialAuth: const CustomerBiteSaverAuthSnapshot.signed(
            'local-header',
          ),
          clock: () => now,
        );
        await tester.pumpWidget(
          MaterialApp(
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(scale)),
              child: child!,
            ),
            home: CustomerBiteSaverBrowseScreen(
              coordinator: coordinator,
              timeContextProvider: () async =>
                  const CustomerBiteSaverTimeContext(
                    timeZone: 'America/New_York',
                    utcOffsetMinutes: -240,
                  ),
              onAction: (_, _) async =>
                  const CustomerBiteSaverBrowseActionResult(),
              locationRestoreLoader: () async =>
                  const SharedLocationRestoreResult(
                    state: SharedLocationState(
                      usingTypedSearchLocation: true,
                      typedLatitude: 29.1872,
                      typedLongitude: -82.1401,
                      typedLabel: 'Ocala, FL',
                      searchText: 'Ocala, FL',
                    ),
                  ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(coordinator.restaurants, isNotEmpty);
        final field = find.byKey(const ValueKey('bounded-content-field'));
        final controller = tester.widget<TextField>(field).controller!;
        controller.text = 'draft pizza';
        final before = coordinator.criteria;
        final reads = (starts, pages);
        final restaurants = coordinator.restaurants.toList();
        final scroll = tester.widget<CustomScrollView>(
          find.byType(CustomScrollView),
        );
        scroll.controller!.jumpTo(500);
        await tester.pumpAndSettle();
        expect(find.text('Expand Search'), findsOneWidget);
        await tester.tap(find.text('Expand Search'));
        await tester.pumpAndSettle();
        expect(find.text('Expand Search'), findsNothing);
        expect(controller.text, 'draft pizza');
        expect(coordinator.criteria, before);
        expect((starts, pages), reads);
        expect(coordinator.restaurants, restaurants);
        if (scale > 1) {
          final element = tester.element(field);
          await Scrollable.of(
            element,
          ).position.ensureVisible(element.renderObject!);
          await tester.pump();
          expect(tester.getSize(field).height, greaterThanOrEqualTo(48));
          final radius = find.byType(DropdownButton<int>);
          final radiusElement = tester.element(radius);
          await Scrollable.of(
            radiusElement,
          ).position.ensureVisible(radiusElement.renderObject!);
          await tester.pump();
          await tester.tap(radius);
          await tester.pumpAndSettle();
          expect(find.text('30 miles'), findsWidgets);
          await tester.binding.handlePopRoute();
          await tester.pumpAndSettle();
        }
        expect(tester.takeException(), isNull);
      },
    );
  }
}

class _MemoryPreferences implements CustomerBiteSaverGuestUsagePreferences {
  final values = <String, String>{};
  @override
  Future<String?> getString(String key) async => values[key];
  @override
  Future<void> setString(String key, String value) async {
    values[key] = value;
  }

  @override
  Future<void> remove(String key) async {
    values.remove(key);
  }
}
