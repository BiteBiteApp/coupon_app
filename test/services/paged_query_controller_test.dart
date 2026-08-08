import 'dart:async';

import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/services/paged_query_controller.dart';
import 'package:flutter_test/flutter_test.dart';

const String _fingerprint =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

PagedResponse<String> _page(
  int pageNumber,
  List<String> items, {
  bool hasNext = false,
  bool hasPrevious = false,
  bool supportsLast = false,
  PagedTotal? total,
}) {
  return PagedResponse<String>(
    items: items,
    pageSize: 50,
    hasNext: hasNext,
    hasPrevious: hasPrevious,
    nextCursor: hasNext ? 'next-$pageNumber' : null,
    previousCursor: hasPrevious ? 'previous-$pageNumber' : null,
    pageNumber: PageNumberState(pageNumber),
    total: total ?? const PagedTotal.unknown(),
    queryFingerprint: _fingerprint,
    snapshotTimestampMs: 1786185600000 + pageNumber,
    capabilities: PageCapabilities(
      first: pageNumber > 1,
      previous: hasPrevious,
      numberedVisitedPages: true,
      next: hasNext,
      last: supportsLast,
    ),
  );
}

void main() {
  test(
    'initial page and next replace current items instead of appending',
    () async {
      final requests = <PagedRequest>[];
      final controller = PagedQueryController<String>(
        criteria: const <String, Object?>{'zip': '34461'},
        pageLoader: (request) async {
          requests.add(request);
          return request.direction == PageDirection.first
              ? _page(
                  1,
                  <String>['one', 'two'],
                  hasNext: true,
                  supportsLast: true,
                )
              : _page(2, <String>['three'], hasPrevious: true);
        },
      );
      addTearDown(controller.dispose);

      await controller.loadInitial();
      expect(controller.items, <String>['one', 'two']);
      expect(controller.currentPageNumber, 1);
      expect(controller.status, PagedQueryStatus.data);
      await controller.nextPage();
      expect(controller.items, <String>['three']);
      expect(requests.last.direction, PageDirection.forward);
      expect(requests.last.cursor, 'next-1');
      expect(controller.visitedPageNumbers, <int>[1, 2]);
    },
  );

  test(
    'previous, first, and visited-number navigation use saved anchors',
    () async {
      final requests = <PagedRequest>[];
      final controller = PagedQueryController<String>(
        criteria: const <String, Object?>{'cityStateKey': 'FL|inverness'},
        pageLoader: (request) async {
          requests.add(request);
          if (request.direction == PageDirection.first) {
            return _page(1, <String>['one'], hasNext: true);
          }
          if (request.cursor == 'next-1') {
            return _page(2, <String>['two'], hasNext: true, hasPrevious: true);
          }
          if (request.cursor == 'next-2') {
            return _page(3, <String>['three'], hasPrevious: true);
          }
          throw StateError('unexpected anchor');
        },
      );
      addTearDown(controller.dispose);

      await controller.loadInitial();
      await controller.nextPage();
      await controller.nextPage();
      await controller.previousPage();
      expect(controller.currentPageNumber, 2);
      expect(requests.last.direction, PageDirection.forward);
      expect(requests.last.cursor, 'next-1');
      await controller.goToVisitedPage(1);
      expect(controller.currentPageNumber, 1);
      expect(requests.last.direction, PageDirection.first);
      await controller.firstPage();
      expect(
        requests.length,
        5,
        reason: 'First is unsupported while already on page one.',
      );
      expect(() => controller.goToVisitedPage(99), throwsArgumentError);
    },
  );

  test('last page runs only when server capability is declared', () async {
    final requests = <PagedRequest>[];
    final controller = PagedQueryController<String>(
      criteria: const <String, Object?>{},
      pageLoader: (request) async {
        requests.add(request);
        return request.direction == PageDirection.last
            ? _page(4, <String>['last'], hasPrevious: true)
            : _page(1, <String>['first'], hasNext: true, supportsLast: true);
      },
    );
    addTearDown(controller.dispose);
    await controller.loadInitial();
    await controller.lastPage();
    expect(requests.last.direction, PageDirection.last);
    expect(controller.currentPageNumber, 4);
    await controller.lastPage();
    expect(
      requests.length,
      2,
      reason: 'Last capability is false on the final response.',
    );
  });

  test('criteria change clears state and ignores stale completion', () async {
    final oldResult = Completer<PagedResponse<String>>();
    final newResult = Completer<PagedResponse<String>>();
    final requests = <PagedRequest>[];
    final controller = PagedQueryController<String>(
      criteria: const <String, Object?>{'name': 'old'},
      pageLoader: (request) {
        requests.add(request);
        return request.criteria['name'] == 'old'
            ? oldResult.future
            : newResult.future;
      },
    );
    addTearDown(controller.dispose);

    final oldLoad = controller.loadInitial();
    final newLoad = controller.updateCriteria(const <String, Object?>{
      'name': 'new',
    });
    expect(controller.items, isEmpty);
    expect(controller.currentPageNumber, isNull);
    newResult.complete(_page(1, <String>['new']));
    await newLoad;
    oldResult.complete(_page(1, <String>['stale']));
    await oldLoad;
    expect(controller.items, <String>['new']);
    expect(controller.criteria['name'], 'new');
    expect(requests, hasLength(2));
  });

  test('duplicate in-flight requests are suppressed', () async {
    final completer = Completer<PagedResponse<String>>();
    var calls = 0;
    final controller = PagedQueryController<String>(
      criteria: const <String, Object?>{},
      pageLoader: (request) {
        calls += 1;
        return completer.future;
      },
    );
    addTearDown(controller.dispose);
    final first = controller.loadInitial();
    final duplicate = controller.loadInitial();
    expect(identical(first, duplicate), isTrue);
    expect(calls, 1);
    completer.complete(_page(1, <String>['one']));
    await Future.wait(<Future<void>>[first, duplicate]);
  });

  test('error preserves successful page and retry succeeds', () async {
    var nextAttempts = 0;
    final controller = PagedQueryController<String>(
      criteria: const <String, Object?>{},
      pageLoader: (request) async {
        if (request.direction == PageDirection.first) {
          return _page(
            1,
            <String>['kept'],
            hasNext: true,
            supportsLast: true,
            total: PagedTotal.exact(51),
          );
        }
        nextAttempts += 1;
        if (nextAttempts == 1) {
          throw StateError('temporary');
        }
        return _page(2, <String>['recovered'], hasPrevious: true);
      },
    );
    addTearDown(controller.dispose);
    await controller.loadInitial();
    await controller.nextPage();
    expect(controller.status, PagedQueryStatus.error);
    expect(controller.items, <String>['kept']);
    expect(controller.total?.exactValue, 51);
    await controller.retry();
    expect(controller.items, <String>['recovered']);
    expect(controller.error, isNull);
  });

  test(
    'refresh first/current, empty page, unknown total, and disposal are safe',
    () async {
      var calls = 0;
      final pending = Completer<PagedResponse<String>>();
      final controller = PagedQueryController<String>(
        criteria: const <String, Object?>{},
        pageLoader: (request) {
          calls += 1;
          if (calls == 1) {
            return Future<PagedResponse<String>>.value(
              _page(1, <String>[], total: const PagedTotal.unknown()),
            );
          }
          return pending.future;
        },
      );
      await controller.loadInitial();
      expect(controller.status, PagedQueryStatus.empty);
      expect(controller.total?.state, PagedTotalState.unknown);
      final refresh = controller.refreshCurrentPage();
      expect(controller.isRefreshing, isTrue);
      controller.dispose();
      pending.complete(_page(1, <String>['ignored']));
      await refresh;
      expect(controller.isDisposed, isTrue);
      await controller.refreshFirstPage();
      expect(calls, 2);
    },
  );
}
