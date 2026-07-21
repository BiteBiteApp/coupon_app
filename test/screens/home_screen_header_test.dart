import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/screens/home_screen.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:coupon_app/widgets/bitesaver_restaurant_images.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(const <String, Object>{});
  });

  Future<void> pumpHomeHeader(
    WidgetTester tester, {
    required Size size,
    double textScaleFactor = 1,
  }) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = size;
    addTearDown(tester.view.reset);
    SharedLocationStateService.saveTypedLocation(
      latitude: 28.85,
      longitude: -82.49,
      label: 'Test location',
      searchText: '',
    );
    addTearDown(SharedLocationStateService.clear);

    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(textScaleFactor)),
          child: child!,
        ),
        home: HomeScreen(
          approvedAccountsStream:
              const Stream<QuerySnapshot<Map<String, dynamic>>>.empty(),
          restaurantLoader: () async => const <Restaurant>[],
          initializeFirebaseBackedState: false,
        ),
      ),
    );
    await tester.pump();
  }

  void expectExpandedHeaderContent(WidgetTester tester) {
    expect(tester.takeException(), isNull);
    expect(find.text('Eat well.'), findsOneWidget);
    expect(find.text('Spend less.'), findsOneWidget);
    expect(find.byType(BiteSaverHomeHeroLogo), findsOneWidget);
    expect(find.text('Use My Current Location'), findsOneWidget);
    expect(find.text('City or zip code'), findsOneWidget);
    final cuisineHints = find.byWidgetPredicate(
      (widget) =>
          widget is Text &&
          (widget.data?.toLowerCase().contains('restaurants or cuisines') ??
              false),
    );
    expect(cuisineHints, findsOneWidget);
    expect(find.text('15 mi'), findsOneWidget);

    final logoSize = tester.getSize(find.byType(BiteSaverHomeHeroLogo));
    expect(logoSize.width, greaterThan(0));
    expect(logoSize.width, lessThan(tester.view.physicalSize.width * 0.6));
    expect(logoSize.height, lessThan(140));
  }

  final cases = <({String name, Size size})>[
    (name: 'small portrait phone', size: const Size(360, 640)),
    (name: 'large portrait phone', size: const Size(430, 932)),
    (name: 'short landscape phone', size: const Size(640, 360)),
    (name: 'large landscape phone', size: const Size(915, 412)),
    (name: 'tablet window', size: const Size(1024, 768)),
  ];

  for (final testCase in cases) {
    testWidgets(
      '${testCase.name} shows every header control without overflow',
      (tester) async {
        await pumpHomeHeader(tester, size: testCase.size);

        expectExpandedHeaderContent(tester);
      },
    );
  }

  testWidgets('supports increased accessibility text scaling', (tester) async {
    await pumpHomeHeader(
      tester,
      size: const Size(640, 360),
      textScaleFactor: 1.4,
    );

    expectExpandedHeaderContent(tester);
  });

  testWidgets('keeps the existing portrait overlap geometry', (tester) async {
    await pumpHomeHeader(tester, size: const Size(360, 640));

    final heroRect = tester.getRect(
      find.byKey(const ValueKey('bitesaver-home-hero')),
    );
    final panelRect = tester.getRect(
      find.byKey(const ValueKey('bitesaver-home-search-panel')),
    );

    expect(heroRect.top, 0);
    expect(heroRect.height, 110);
    expect(panelRect.top, 110);
    expect(panelRect.bottom, closeTo(205.6, 0.1));
    expect(tester.takeException(), isNull);
  });
}
