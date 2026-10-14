import 'dart:async';
import 'package:geocoding/geocoding.dart';
// ignore: depend_on_referenced_packages
import 'package:geocoding_platform_interface/geocoding_platform_interface.dart';
import '../visual_polish_fixture/main.dart' show visualRestaurants;
import '../detail_route_history_fixture/main.dart' show historyDish;
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/screens/bitescore_home_screen.dart';
import 'package:coupon_app/screens/home_screen.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    SharedLocationStateService.resetForTesting();
    SharedLocationStateService.saveTypedLocation(
      latitude: 29.1872,
      longitude: -82.1401,
      label: 'Ocala, FL',
      searchText: 'Ocala, FL',
    );
  });
  tearDown(SharedLocationStateService.resetForTesting);
  for (final scale in [1.0, 2.0]) {
    for (final width in [320.0, 411.0]) {
      for (final score in [false, true]) {
        testWidgets(
          '${score ? 'BiteScore' : 'BiteSaver'} search fits ${width}dp at scale $scale',
          (tester) async {
            tester.view.devicePixelRatio = 1;
            tester.view.physicalSize = Size(width, 640);
            addTearDown(tester.view.reset);
            await tester.pumpWidget(
              MaterialApp(
                builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(textScaler: TextScaler.linear(scale)),
                  child: child!,
                ),
                home: score
                    ? BiteScoreHomeScreen(
                        testHomeEntriesLoader: () async => [historyDish],
                      )
                    : HomeScreen(
                        approvedAccountsStream:
                            const Stream<
                              QuerySnapshot<Map<String, dynamic>>
                            >.empty(),
                        restaurantLoader: () async => const <Restaurant>[],
                        initializeFirebaseBackedState: false,
                      ),
              ),
            );
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull);
            final location = find.byWidgetPredicate(
              (w) =>
                  w is TextField &&
                  w.decoration?.hintText == 'City or zip code',
            );
            expect(location, findsOneWidget);
            if (scale > 1) {
              expect(tester.getSize(location).height, greaterThanOrEqualTo(48));
            }
            expect(tester.getRect(location).left, greaterThanOrEqualTo(0));
            expect(tester.getRect(location).right, lessThanOrEqualTo(width));
            await _revealHeaderField(tester, location);
            final controller = tester.widget<TextField>(location).controller!;
            await tester.enterText(location, '34470');
            tester.view.viewInsets = const FakeViewPadding(bottom: 260);
            await tester.pumpAndSettle();
            await _revealHeaderField(tester, location);
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull);
            expect(controller.text, '34470');
            tester.view.viewInsets = const FakeViewPadding();
            await tester.pumpAndSettle();
            tester.testTextInput.hide();
            if (score) {
              await tester.ensureVisible(find.text('Filter'));
              await tester.tap(find.text('Filter'));
              await tester.pumpAndSettle();
              expect(find.text('Apply'), findsOneWidget);
              expect(tester.takeException(), isNull);
            }
          },
        );
      }
    }
  }
  testWidgets('collapsed Saver expands the same search without a reload', (
    tester,
  ) async {
    var loads = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: HomeScreen(
          approvedAccountsStream:
              const Stream<QuerySnapshot<Map<String, dynamic>>>.empty(),
          restaurantLoader: () async {
            loads++;
            return visualRestaurants;
          },
          initializeFirebaseBackedState: false,
        ),
      ),
    );
    await tester.pumpAndSettle();
    final fields = tester
        .widgetList<TextField>(find.byType(TextField))
        .toList();
    final controllers = fields.map((f) => f.controller!).toList();
    controllers.last.text = 'draft cuisine';
    final before = controllers.map((c) => c.text).toList();
    final count = loads;
    final scroll = tester.widget<CustomScrollView>(
      find.byType(CustomScrollView),
    );
    scroll.controller!.jumpTo(400);
    await tester.pumpAndSettle();
    expect(find.text('Expand Search'), findsOneWidget);
    expect(find.byIcon(Icons.keyboard_arrow_down), findsWidgets);
    await tester.tap(find.text('Expand Search'));
    await tester.pumpAndSettle();
    expect(find.text('Expand Search'), findsNothing);
    expect(controllers.map((c) => c.text).toList(), before);
    expect(loads, count);
    expect(find.text('15 mi'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'accessible Score blocks overlapping searches until location resolves',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(320, 640);
      addTearDown(tester.view.reset);
      final old = GeocodingPlatform.instance ?? _PendingGeocoder();
      final geocoder = _PendingGeocoder();
      GeocodingPlatform.instance = geocoder;
      addTearDown(() => GeocodingPlatform.instance = old);
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(2)),
            child: child!,
          ),
          home: BiteScoreHomeScreen(
            testHomeEntriesLoader: () async => [historyDish],
          ),
        ),
      );
      await tester.pumpAndSettle();
      final location = find.byWidgetPredicate(
        (w) => w is TextField && w.decoration?.hintText == 'City or zip code',
      );
      await _revealHeaderField(tester, location);
      await tester.enterText(location, '32801');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pump(const Duration(milliseconds: 500));
      expect(geocoder.calls, 1);
      final header = find.byKey(
        const PageStorageKey('accessible-bitescore-search-header'),
      );
      final blocker = tester.widget<IgnorePointer>(
        find.ancestor(of: header, matching: find.byType(IgnorePointer)).first,
      );
      expect(blocker.ignoring, isTrue);
      expect(find.byType(CircularProgressIndicator), findsWidgets);
      geocoder.pending.complete([
        Location(
          latitude: 28.5,
          longitude: -81.3,
          timestamp: DateTime.utc(2026),
        ),
      ]);
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<IgnorePointer>(
              find
                  .ancestor(of: header, matching: find.byType(IgnorePointer))
                  .first,
            )
            .ignoring,
        isFalse,
      );
      expect(SharedLocationStateService.state.searchText, '32801');
      expect(tester.takeException(), isNull);
    },
  );
}

class _PendingGeocoder extends GeocodingPlatform {
  final pending = Completer<List<Location>>();
  int calls = 0;
  @override
  Future<List<Location>> locationFromAddress(String address) {
    calls++;
    return pending.future;
  }
}

Future<void> _revealHeaderField(WidgetTester tester, Finder field) async {
  final element = tester.element(field);
  final scrollable = Scrollable.maybeOf(element);
  if (scrollable != null) {
    await scrollable.position.ensureVisible(
      element.renderObject!,
      duration: Duration.zero,
    );
  }
  await tester.pump();
}
