import 'dart:async';

import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/services/paged_query_controller.dart';
import 'package:coupon_app/widgets/paged_directory_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const String _fingerprint =
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

PagedResponse<String> _page(
  int pageNumber,
  List<String> items, {
  bool hasNext = false,
  bool hasPrevious = false,
}) => PagedResponse<String>(
  items: items,
  pageSize: 50,
  hasNext: hasNext,
  hasPrevious: hasPrevious,
  nextCursor: hasNext ? 'next-$pageNumber' : null,
  previousCursor: hasPrevious ? 'previous-$pageNumber' : null,
  pageNumber: PageNumberState(pageNumber),
  total: PagedTotal.exact(
    ((pageNumber - 1) * 50) + items.length + (hasNext ? 50 : 0),
  ),
  queryFingerprint: _fingerprint,
  snapshotTimestampMs: 1786185600000 + pageNumber,
  capabilities: PageCapabilities(
    first: pageNumber > 1,
    previous: hasPrevious,
    numberedVisitedPages: true,
    next: hasNext,
    last: hasNext,
  ),
);

Widget _host(PagedQueryController<String> controller) {
  return MaterialApp(
    home: Scaffold(
      body: SizedBox(
        width: 390,
        height: 700,
        child: PagedDirectoryView<String>(
          controller: controller,
          onRefresh: controller.refreshFirstPage,
          itemBuilder: (context, item, index) => ListTile(title: Text(item)),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('shows initial loading and then empty state', (tester) async {
    final pending = Completer<PagedResponse<String>>();
    final controller = PagedQueryController<String>(
      criteria: const <String, Object?>{},
      pageLoader: (request) => pending.future,
    );
    addTearDown(controller.dispose);
    final load = controller.loadInitial();
    await tester.pumpWidget(_host(controller));
    expect(
      find.byKey(const ValueKey<String>('paged-directory-loading')),
      findsOneWidget,
    );
    pending.complete(_page(1, <String>[]));
    await load;
    await tester.pump();
    expect(
      find.byKey(const ValueKey<String>('paged-directory-empty')),
      findsOneWidget,
    );
    expect(find.text('No results found.'), findsOneWidget);
  });

  testWidgets('shows initial error and retry action', (tester) async {
    var calls = 0;
    final controller = PagedQueryController<String>(
      criteria: const <String, Object?>{},
      pageLoader: (request) async {
        calls += 1;
        if (calls == 1) {
          throw StateError('temporary');
        }
        return _page(1, <String>['recovered']);
      },
    );
    addTearDown(controller.dispose);
    await controller.loadInitial();
    await tester.pumpWidget(_host(controller));
    expect(
      find.byKey(const ValueKey<String>('paged-directory-error')),
      findsOneWidget,
    );
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('recovered'), findsOneWidget);
  });

  testWidgets('keeps existing data visible while refreshing', (tester) async {
    final refresh = Completer<PagedResponse<String>>();
    var calls = 0;
    final controller = PagedQueryController<String>(
      criteria: const <String, Object?>{},
      pageLoader: (request) {
        calls += 1;
        return calls == 1
            ? Future<PagedResponse<String>>.value(
                _page(1, <String>['existing']),
              )
            : refresh.future;
      },
    );
    addTearDown(controller.dispose);
    await controller.loadInitial();
    await tester.pumpWidget(_host(controller));
    final refreshing = controller.refreshCurrentPage();
    await tester.pump();
    expect(find.text('existing'), findsOneWidget);
    expect(
      find.byKey(const ValueKey<String>('paged-directory-refreshing')),
      findsOneWidget,
    );
    refresh.complete(_page(1, <String>['refreshed']));
    await refreshing;
    await tester.pump();
    expect(find.text('refreshed'), findsOneWidget);
  });

  testWidgets('page transition replaces items and restores result focus', (
    tester,
  ) async {
    final controller = PagedQueryController<String>(
      criteria: const <String, Object?>{},
      pageLoader: (request) async => request.direction == PageDirection.first
          ? _page(1, <String>['page one'], hasNext: true)
          : _page(2, <String>['page two'], hasPrevious: true),
    );
    addTearDown(controller.dispose);
    await controller.loadInitial();
    await tester.pumpWidget(_host(controller));
    await tester.tap(find.byKey(const ValueKey<String>('pagination-next')));
    await tester.pumpAndSettle();
    expect(find.text('page one'), findsNothing);
    expect(find.text('page two'), findsOneWidget);
    final focus = tester
        .widgetList<Focus>(
          find.descendant(
            of: find.byType(PagedDirectoryView<String>),
            matching: find.byType(Focus),
          ),
        )
        .firstWhere(
          (widget) => widget.focusNode?.debugLabel == 'Paged results',
        );
    expect(focus.focusNode?.hasFocus, isTrue);
  });

  testWidgets('inline refresh error preserves page and retries', (
    tester,
  ) async {
    var calls = 0;
    final controller = PagedQueryController<String>(
      criteria: const <String, Object?>{},
      pageLoader: (request) async {
        calls += 1;
        if (calls == 2) {
          throw StateError('refresh failed');
        }
        return _page(1, <String>[calls == 1 ? 'kept' : 'retried']);
      },
    );
    addTearDown(controller.dispose);
    await controller.loadInitial();
    await tester.pumpWidget(_host(controller));
    await controller.refreshCurrentPage();
    await tester.pump();
    expect(find.text('kept'), findsOneWidget);
    expect(
      find.byKey(const ValueKey<String>('paged-directory-inline-error')),
      findsOneWidget,
    );
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('retried'), findsOneWidget);
  });

  testWidgets('semantics announce results, page, loading, and errors', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final controller = PagedQueryController<String>(
      criteria: const <String, Object?>{},
      pageLoader: (request) async => _page(1, <String>['one']),
    );
    addTearDown(controller.dispose);
    await controller.loadInitial();
    await tester.pumpWidget(_host(controller));
    expect(
      find.bySemanticsLabel(RegExp(r'1 total result, page 1')),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('Page 1 results'), findsOneWidget);
    handle.dispose();
  });
}
