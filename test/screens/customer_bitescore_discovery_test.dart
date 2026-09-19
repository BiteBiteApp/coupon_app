import 'dart:async';

import 'package:coupon_app/screens/bitescore_create_rate_screen.dart';
import 'package:coupon_app/screens/bitescore_home_screen.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/customer_bitescore_search.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/customer_bitescore_search_service_test.dart'
    show FakeSearchApi, dishProjection, restaurantProjection, response;

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    SharedLocationStateService.resetForTesting();
    CustomerBiteScoreRuntime.testEnabled = true;
  });
  tearDown(() {
    CustomerBiteScoreRuntime.testEnabled = null;
    SharedLocationStateService.resetForTesting();
  });

  Future<void> prepareFinder(
    WidgetTester tester,
    FakeSearchApi api, {
    Future<List<BitescoreRestaurant>> Function()? directoryLoader,
  }) async {
    tester.view.physicalSize = const Size(1000, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: BiteScoreCreateRateScreen(
          testSearchApi: api,
          testRestaurantFinderLoader:
              directoryLoader ?? () => throw StateError('raw directory read'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('FL').last);
    await tester.pumpAndSettle();
  }

  Finder restaurantField() => find.byWidgetPredicate(
    (widget) =>
        widget is TextField &&
        widget.decoration?.labelText == 'Restaurant Name',
  );

  testWidgets(
    'default Finder also fences a directory response after text clears',
    (tester) async {
      CustomerBiteScoreRuntime.testEnabled = false;
      final directory = Completer<List<BitescoreRestaurant>>();
      final api = FakeSearchApi(
        (_, _) async => throw StateError('bounded call in default mode'),
      );
      await prepareFinder(tester, api, directoryLoader: () => directory.future);
      await tester.enterText(restaurantField(), 'Kitchen');
      await tester.pump();
      await tester.enterText(restaurantField(), '');
      directory.complete([
        CustomerBiteScorePublicData.restaurant(
          restaurantProjection('old-place'),
        ),
      ]);
      await tester.pumpAndSettle();
      expect(find.textContaining('Kitchen', findRichText: true), findsNothing);
      expect(api.calls, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('Finder clearing text fences a delayed bounded response', (
    tester,
  ) async {
    final delayed = Completer<Map<String, dynamic>>();
    final api = FakeSearchApi(
      (name, data) async => name.startsWith('start')
          ? delayed.future
          : response(items: [restaurantProjection('old-place')]),
    );
    await prepareFinder(tester, api);
    await tester.enterText(restaurantField(), 'Kitchen');
    await tester.pump(const Duration(milliseconds: 300));
    expect(api.calls, ['startCustomerBiteScoreSearch']);
    await tester.enterText(restaurantField(), '');
    delayed.complete(response());
    await tester.pumpAndSettle();
    expect(find.textContaining('Kitchen', findRichText: true), findsNothing);
    expect(find.text('Load More'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'Finder shows at most eight suggestions and bounded failures do not read directory',
    (tester) async {
      var fail = false;
      final api = FakeSearchApi((name, data) async {
        if (fail) throw StateError('server unavailable');
        if (name.startsWith('start')) return response();
        return response(
          items: List.generate(
            8,
            (i) =>
                restaurantProjection('place-$i')
                  ..['displayName'] = 'Kitchen $i',
          ),
        );
      });
      await prepareFinder(tester, api);
      await tester.enterText(restaurantField(), 'Kitchen');
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();
      for (var i = 0; i < 8; i++) {
        expect(
          find.textContaining('Kitchen $i', findRichText: true),
          findsOneWidget,
        );
      }
      expect(find.text('Load More'), findsNothing);
      fail = true;
      await tester.enterText(restaurantField(), 'Other');
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Kitchen 0', findRichText: true),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Home preserves dish cards and appends exact distinct identities',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      SharedLocationStateService.saveTypedLocation(
        latitude: 28.5,
        longitude: -81.3,
        label: 'Orlando, FL',
        searchText: '32801',
      );
      final api = FakeSearchApi((name, data) async {
        if (name.startsWith('start')) return response();
        return data['cursor'] == null
            ? response(items: [dishProjection('dish-a')], cursor: 'page-two')
            : response(items: [dishProjection('dish-b')]);
      });
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(0.5)),
            child: BiteScoreHomeScreen(
              testSearchApi: api,
              testHomeEntriesLoader: () => throw StateError('raw Home read'),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Same Dish'), findsOneWidget);
      await tester.ensureVisible(find.text('Load More'));
      await tester.tap(find.text('Load More'));
      await tester.pumpAndSettle();
      expect(find.text('Same Dish'), findsNWidgets(2));
      expect(find.text('Load More'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
