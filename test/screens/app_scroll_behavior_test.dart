import 'package:coupon_app/screens/home_screen.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../overscroll_fixture/main.dart';
import '../visual_polish_fixture/main.dart' show initializeVisualFixture;

void expectClamped(WidgetTester tester) {
  expect(find.byType(StretchingOverscrollIndicator), findsNothing);
  expect(find.byType(GlowingOverscrollIndicator), findsNothing);
  for (final element in find.byType(Scrollable).evaluate()) {
    final position = (element as StatefulElement).state as ScrollableState;
    expect(
      position.position.pixels,
      greaterThanOrEqualTo(position.position.minScrollExtent - .01),
    );
    expect(
      position.position.pixels,
      lessThanOrEqualTo(position.position.maxScrollExtent + .01),
    );
    var physics = position.position.physics;
    var clamping = false;
    while (true) {
      expect(physics, isNot(isA<BouncingScrollPhysics>()));
      clamping = clamping || physics is ClampingScrollPhysics;
      if (physics.parent == null) break;
      physics = physics.parent!;
    }
    expect(clamping, isTrue);
  }
}

Future<void> edges(WidgetTester tester, Finder scrollable) async {
  for (final lower in [false, true]) {
    final state = tester.state<ScrollableState>(scrollable);
    state.position.jumpTo(
      lower ? state.position.maxScrollExtent : state.position.minScrollExtent,
    );
    await tester.pump();
    final gesture = await tester.startGesture(tester.getCenter(scrollable));
    await gesture.moveBy(Offset(0, lower ? -280 : 280));
    await tester.pump(const Duration(milliseconds: 100));
    expectClamped(tester);
    await gesture.up();
    await tester.pumpAndSettle();
    expectClamped(tester);
  }
}

void main() {
  setUp(initializeVisualFixture);
  tearDown(() => debugDefaultTargetPlatformOverride = null);
  for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
    for (final name in [
      'BiteSaver Home',
      'BiteScore Home',
      'Restaurant detail',
      'Dish detail',
      'My Profile and Saved',
      'Restaurant Owner Hub',
      'Admin paged content',
    ]) {
      testWidgets(
        '$name inherits bounded edges on ${platform.name}',
        (tester) async {
          await tester.pumpWidget(scrollHost(scrollCases[name]!()));
          await tester.pumpAndSettle();
          expect(find.byType(Scrollable), findsWidgets);
          expectClamped(tester);
          await edges(tester, find.byType(Scrollable).first);
          expect(tester.takeException(), isNull);
        },
        variant: TargetPlatformVariant({platform}),
      );
    }
    for (final short in [true, false]) {
      testWidgets(
        'pull refresh retains function for ${short ? 'short' : 'long'} content on ${platform.name}',
        (tester) async {
          await tester.pumpWidget(scrollHost(LocalRefreshScroll(short: short)));
          await tester.pumpAndSettle();
          final gesture = await tester.startGesture(
            tester.getCenter(find.byType(ListView)),
          );
          await gesture.moveBy(const Offset(0, 400));
          await tester.pump(const Duration(seconds: 1));
          expectClamped(tester);
          await gesture.up();
          await tester.pumpAndSettle();
          expect(
            tester
                .state<LocalRefreshScrollState>(find.byType(LocalRefreshScroll))
                .refreshes,
            1,
          );
          expect(tester.takeException(), isNull);
        },
        variant: TargetPlatformVariant({platform}),
      );
    }
    testWidgets(
      'gallery horizontal paging and edges on ${platform.name}',
      (tester) async {
        await tester.pumpWidget(scrollHost(scrollCases['Gallery']!()));
        await tester.pumpAndSettle();
        final page = find.byType(PageView);
        expectClamped(tester);
        await tester.drag(page, const Offset(-600, 0));
        await tester.pumpAndSettle();
        expect(find.text('2 / 2'), findsOneWidget);
        final gesture = await tester.startGesture(tester.getCenter(page));
        await gesture.moveBy(const Offset(-200, 0));
        await tester.pump();
        expectClamped(tester);
        await gesture.up();
        await tester.pumpAndSettle();
        await tester.tap(find.text('Previous'));
        await tester.pumpAndSettle();
        expect(find.text('1 / 2'), findsOneWidget);
        final viewer = find.byKey(const ValueKey('photo-zoom-0'));
        final center = tester.getCenter(viewer);
        final first = await tester.startGesture(
          center - const Offset(0, 3),
          pointer: 1,
        );
        final second = await tester.startGesture(
          center + const Offset(0, 3),
          pointer: 2,
        );
        await first.moveBy(const Offset(0, -30));
        await second.moveBy(const Offset(0, 30));
        await tester.pump();
        await first.moveBy(const Offset(0, -20));
        await second.moveBy(const Offset(0, 20));
        await tester.pump();
        final transform = tester.widget<Transform>(
          find.descendant(of: viewer, matching: find.byType(Transform)).first,
        );
        expect(transform.transform.getMaxScaleOnAxis(), greaterThan(1));
        await first.up();
        await second.up();
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      },
      variant: TargetPlatformVariant({platform}),
    );
  }
  testWidgets('real profile refresh reloads without moving its upper edge', (
    tester,
  ) async {
    var loads = 0;
    await tester.pumpWidget(
      scrollHost(
        scrollMyProfile(
          load: () async {
            loads++;
            return scrollProfile;
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    final list = find.byType(ListView).first;
    await tester.drag(list, const Offset(0, 500));
    await tester.pumpAndSettle();
    expect(loads, 2);
    expectClamped(tester);
    expect(tester.takeException(), isNull);
  });
  testWidgets('Admin component paging retains next and previous actions', (
    tester,
  ) async {
    await tester.pumpWidget(scrollHost(const LocalPagedScroll()));
    await tester.pumpAndSettle();
    final state = tester.state<LocalPagedScrollState>(
      find.byType(LocalPagedScroll),
    );
    await tester.tap(find.byKey(const ValueKey('pagination-next')));
    await tester.pumpAndSettle();
    expect(state.controller.currentPageNumber, 2);
    expect(state.loads, 2);
    await tester.tap(find.byKey(const ValueKey('pagination-previous')));
    await tester.pumpAndSettle();
    expect(state.controller.currentPageNumber, 1);
    expect(state.loads, 3);
    expectClamped(tester);
    expect(tester.takeException(), isNull);
  });
  testWidgets('nested large text Home remains scrollable at 320dp', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(320, 640);
    addTearDown(tester.view.reset);
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.pumpWidget(scrollHost(scrollCases['BiteSaver Home']!()));
    await tester.pumpAndSettle();
    final inner = find.byKey(
      const PageStorageKey('accessible-bitesaver-search-header'),
    );
    await tester.drag(inner, const Offset(0, -350));
    await tester.pumpAndSettle();
    expectClamped(tester);
    final field = find.byWidgetPredicate(
      (w) => w is TextField && w.decoration?.hintText == 'City or zip code',
    );
    final e = tester.element(field);
    await Scrollable.of(e).position.ensureVisible(e.renderObject!);
    await tester.pump();
    await tester.enterText(field, 'Ocala');
    expectClamped(tester);
    final scroll = tester.widget<CustomScrollView>(
      find.descendant(
        of: find.byType(HomeScreen),
        matching: find.byType(CustomScrollView),
      ),
    );
    scroll.controller!.jumpTo(500);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Expand Search'));
    await tester.pumpAndSettle();
    expect(scroll.controller!.offset, 0);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'desktop wheel input and scrollbar remain enabled',
    (tester) async {
      await tester.pumpWidget(
        scrollHost(const LocalRefreshScroll(short: false)),
      );
      await tester.pumpAndSettle();
      expect(find.byType(Scrollbar), findsWidgets);
      final scroll = find.byType(Scrollable).first;
      final state = tester.state<ScrollableState>(scroll);
      await tester.sendEventToBinding(
        PointerScrollEvent(
          position: tester.getCenter(scroll),
          scrollDelta: const Offset(0, 200),
        ),
      );
      await tester.pumpAndSettle();
      expect(state.position.pixels, greaterThan(0));
      expectClamped(tester);
      expect(tester.takeException(), isNull);
    },
    variant: TargetPlatformVariant({TargetPlatform.macOS}),
  );
  testWidgets(
    'scrollable dialogs inherit clamping and dismiss normally',
    (tester) async {
      await tester.pumpWidget(
        scrollHost(
          Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: FilledButton(
                  onPressed: () => showDialog<void>(
                    context: context,
                    builder: (_) => AlertDialog(
                      title: const Text('Local dialog'),
                      content: SingleChildScrollView(
                        child: Text(
                          List.filled(60, 'Long local line').join('\n'),
                        ),
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.of(context).pop(),
                          child: const Text('Close'),
                        ),
                      ],
                    ),
                  ),
                  child: const Text('Open dialog'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open dialog'));
      await tester.pumpAndSettle();
      await edges(tester, find.byType(Scrollable).first);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('Local dialog'), findsNothing);
      expect(tester.takeException(), isNull);
    },
    variant: TargetPlatformVariant({
      TargetPlatform.android,
      TargetPlatform.iOS,
    }),
  );
  testWidgets(
    'tab swipes retain page snapping without edge displacement',
    (tester) async {
      await tester.pumpWidget(
        scrollHost(
          const DefaultTabController(
            length: 2,
            child: Scaffold(
              appBar: TabBar(
                tabs: [
                  Tab(text: 'Local A'),
                  Tab(text: 'Local B'),
                ],
              ),
              body: TabBarView(
                children: [
                  Center(child: Text('Page A')),
                  Center(child: Text('Page B')),
                ],
              ),
            ),
          ),
        ),
      );
      final tabs = find.byType(TabBarView);
      await tester.drag(tabs, const Offset(-700, 0));
      await tester.pumpAndSettle();
      expect(find.text('Page B'), findsOneWidget);
      expectClamped(tester);
      final gesture = await tester.startGesture(tester.getCenter(tabs));
      await gesture.moveBy(const Offset(-200, 0));
      await tester.pump();
      expectClamped(tester);
      await gesture.up();
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
    variant: TargetPlatformVariant({
      TargetPlatform.android,
      TargetPlatform.iOS,
    }),
  );
  testWidgets(
    'dropdown overlay scrolls with bounded edges and still selects',
    (tester) async {
      var chosen = 0;
      await tester.pumpWidget(
        scrollHost(
          Scaffold(
            body: Center(
              child: DropdownButton<int>(
                value: 0,
                items: [
                  for (var i = 0; i < 30; i++)
                    DropdownMenuItem(value: i, child: Text('Choice $i')),
                ],
                onChanged: (value) => chosen = value!,
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byType(DropdownButton<int>));
      await tester.pumpAndSettle();
      await edges(tester, find.byType(Scrollable).first);
      await tester.scrollUntilVisible(
        find.text('Choice 29'),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('Choice 29'));
      await tester.pumpAndSettle();
      expect(chosen, 29);
      expect(tester.takeException(), isNull);
    },
    variant: TargetPlatformVariant({
      TargetPlatform.android,
      TargetPlatform.iOS,
    }),
  );
}
