import 'dart:ui' as ui;

import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/widgets/admin_pagination_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const PageCapabilities _allCapabilities = PageCapabilities(
  first: true,
  previous: true,
  numberedVisitedPages: true,
  next: true,
  last: true,
);

Widget _host({
  required double width,
  required double textScale,
  PageCapabilities capabilities = _allCapabilities,
  PagedTotal? total = const PagedTotal.unknown(),
  bool loading = false,
  List<int> visitedPages = const <int>[1, 2, 3],
  int currentPage = 2,
  VoidCallback? onFirst,
  VoidCallback? onPrevious,
  ValueChanged<int>? onVisitedPage,
  VoidCallback? onNext,
  VoidCallback? onLast,
}) {
  return MaterialApp(
    home: Scaffold(
      body: SingleChildScrollView(
        child: Center(
          child: MediaQuery(
            data: const MediaQueryData().copyWith(
              textScaler: TextScaler.linear(textScale),
            ),
            child: SizedBox(
              width: width,
              child: AdminPaginationBar(
                currentPageNumber: currentPage,
                visitedPageNumbers: visitedPages,
                pageSize: 50,
                total: total,
                capabilities: capabilities,
                loading: loading,
                onFirst: onFirst ?? () {},
                onPrevious: onPrevious ?? () {},
                onVisitedPage: onVisitedPage ?? (_) {},
                onNext: onNext ?? () {},
                onLast: onLast ?? () {},
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  for (final width in <double>[320, 390, 1280]) {
    for (final scale in <double>[1, 1.5, 2]) {
      testWidgets('has no overflow at ${width}px and ${scale}x text', (
        tester,
      ) async {
        await tester.pumpWidget(_host(width: width, textScale: scale));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(
          find.byKey(const ValueKey<String>('pagination-summary')),
          findsOneWidget,
        );
      });
    }
  }

  testWidgets('every rendered action has at least a 48-pixel touch target', (
    tester,
  ) async {
    await tester.pumpWidget(_host(width: 390, textScale: 1));
    for (final key in <String>[
      'pagination-first',
      'pagination-previous',
      'pagination-page-1',
      'pagination-page-2',
      'pagination-page-3',
      'pagination-next',
      'pagination-last',
    ]) {
      final size = tester.getSize(find.byKey(ValueKey<String>(key)));
      expect(size.width, greaterThanOrEqualTo(48), reason: key);
      expect(size.height, greaterThanOrEqualTo(48), reason: key);
    }
  });

  testWidgets('unsupported capabilities are not displayed', (tester) async {
    await tester.pumpWidget(
      _host(
        width: 390,
        textScale: 1,
        capabilities: const PageCapabilities(
          first: false,
          previous: false,
          numberedVisitedPages: false,
          next: true,
          last: false,
        ),
      ),
    );
    expect(
      find.byKey(const ValueKey<String>('pagination-first')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey<String>('pagination-previous')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey<String>('pagination-page-2')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey<String>('pagination-next')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey<String>('pagination-last')), findsNothing);
  });

  testWidgets('loading disables actions and current page is always disabled', (
    tester,
  ) async {
    await tester.pumpWidget(_host(width: 390, textScale: 1, loading: true));
    for (final button in tester.widgetList<OutlinedButton>(
      find.byType(OutlinedButton),
    )) {
      expect(button.onPressed, isNull);
    }
    await tester.pumpWidget(_host(width: 390, textScale: 1));
    final currentButton = tester.widget<OutlinedButton>(
      find.descendant(
        of: find.byKey(const ValueKey<String>('pagination-page-2')),
        matching: find.byType(OutlinedButton),
      ),
    );
    expect(currentButton.onPressed, isNull);
  });

  testWidgets('exact and unknown count wording is honest', (tester) async {
    await tester.pumpWidget(
      _host(
        width: 390,
        textScale: 1,
        total: PagedTotal.exact(101),
        currentPage: 2,
      ),
    );
    expect(
      find.text('101 results • Page 2 of 3 • 50 per page'),
      findsOneWidget,
    );
    await tester.pumpWidget(
      _host(width: 390, textScale: 1, total: const PagedTotal.unknown()),
    );
    expect(find.text('Total unknown • Page 2 • 50 per page'), findsOneWidget);
  });

  testWidgets('only visited page buttons are offered and callbacks work', (
    tester,
  ) async {
    int? selected;
    var nextCalls = 0;
    await tester.pumpWidget(
      _host(
        width: 390,
        textScale: 1,
        visitedPages: const <int>[1, 2, 4],
        onVisitedPage: (page) => selected = page,
        onNext: () => nextCalls += 1,
      ),
    );
    expect(
      find.byKey(const ValueKey<String>('pagination-page-3')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey<String>('pagination-page-4')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey<String>('pagination-page-4')));
    await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
    expect(selected, 4);
    expect(nextCalls, 1);
  });

  testWidgets('standard keyboard focus activates the available action', (
    tester,
  ) async {
    var nextCalls = 0;
    await tester.pumpWidget(
      _host(
        width: 390,
        textScale: 1,
        capabilities: const PageCapabilities(
          first: false,
          previous: false,
          numberedVisitedPages: false,
          next: true,
          last: false,
        ),
        onNext: () => nextCalls += 1,
      ),
    );
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(nextCalls, 1);
  });

  testWidgets('semantics identify current and visited page controls', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(_host(width: 390, textScale: 1));
    final current = tester.getSemantics(
      find.byKey(const ValueKey<String>('pagination-page-2')),
    );
    expect(current.label, 'Current page 2');
    expect(current.flagsCollection.isButton, isTrue);
    expect(current.flagsCollection.isSelected, ui.Tristate.isTrue);
    expect(current.flagsCollection.isEnabled, ui.Tristate.isFalse);
    final visited = tester.getSemantics(
      find.byKey(const ValueKey<String>('pagination-page-3')),
    );
    expect(visited.label, 'Visited page 3');
    expect(visited.flagsCollection.isButton, isTrue);
    expect(visited.flagsCollection.isEnabled, ui.Tristate.isTrue);
    handle.dispose();
  });
}
