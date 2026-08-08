import 'dart:async';

import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/services/customer_load_more_controller.dart';
import 'package:flutter_test/flutter_test.dart';

const String _fingerprint =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

PagedResponse<String> _page(
  int pageNumber,
  List<String> items, {
  bool hasNext = false,
}) => PagedResponse<String>(
  items: items,
  pageSize: 25,
  hasNext: hasNext,
  hasPrevious: pageNumber > 1,
  nextCursor: hasNext ? 'next-$pageNumber' : null,
  previousCursor: pageNumber > 1 ? 'previous-$pageNumber' : null,
  pageNumber: PageNumberState(pageNumber),
  queryFingerprint: _fingerprint,
  snapshotTimestampMs: 1786185600000 + pageNumber,
  capabilities: PageCapabilities(
    first: pageNumber > 1,
    previous: pageNumber > 1,
    numberedVisitedPages: false,
    next: hasNext,
    last: false,
  ),
);

void main() {
  test(
    'first server page and each Load More use real opaque next cursor',
    () async {
      final requests = <PagedRequest>[];
      final controller = CustomerLoadMoreController<String>(
        criteria: const <String, Object?>{'radius': 25},
        stableId: (item) => item,
        pageLoader: (request) async {
          requests.add(request);
          return request.direction == PageDirection.first
              ? _page(1, <String>['one', 'two'], hasNext: true)
              : _page(2, <String>['three']);
        },
      );
      addTearDown(controller.dispose);
      await controller.loadInitial();
      expect(controller.items, <String>['one', 'two']);
      await controller.loadMore();
      expect(controller.items, <String>['one', 'two', 'three']);
      expect(requests.last.direction, PageDirection.forward);
      expect(requests.last.cursor, 'next-1');
      expect(requests.last.requestExactCount, isFalse);
    },
  );

  test('append deduplicates stable IDs', () async {
    final controller = CustomerLoadMoreController<String>(
      criteria: const <String, Object?>{},
      stableId: (item) => item.split(':').first,
      pageLoader: (request) async => request.direction == PageDirection.first
          ? _page(1, <String>['a:first', 'b:first'], hasNext: true)
          : _page(2, <String>['b:duplicate', 'c:first']),
    );
    addTearDown(controller.dispose);
    await controller.loadInitial();
    await controller.loadMore();
    expect(controller.items, <String>['a:first', 'b:first', 'c:first']);
  });

  test(
    'retention cap trims oldest items and preserves a visible-window anchor',
    () async {
      final controller = CustomerLoadMoreController<int>(
        criteria: const <String, Object?>{},
        maximumRetainedItems: 3,
        stableId: (item) => item,
        pageLoader: (request) async => request.direction == PageDirection.first
            ? PagedResponse<int>(
                items: <int>[1, 2],
                pageSize: 25,
                hasNext: true,
                hasPrevious: false,
                nextCursor: 'next',
                queryFingerprint: _fingerprint,
                snapshotTimestampMs: 1,
                capabilities: const PageCapabilities(
                  first: false,
                  previous: false,
                  numberedVisitedPages: false,
                  next: true,
                  last: false,
                ),
              )
            : PagedResponse<int>(
                items: <int>[3, 4],
                pageSize: 25,
                hasNext: false,
                hasPrevious: true,
                previousCursor: 'previous',
                queryFingerprint: _fingerprint,
                snapshotTimestampMs: 2,
                capabilities: const PageCapabilities(
                  first: true,
                  previous: true,
                  numberedVisitedPages: false,
                  next: false,
                  last: false,
                ),
              ),
      );
      addTearDown(controller.dispose);
      await controller.loadInitial();
      await controller.loadMore();
      expect(controller.items, <int>[2, 3, 4]);
      expect(controller.trimmedBeforeCount, 1);
      expect(controller.visibleWindowAnchorId, 2);
      expect(controller.maximumRetainedItems, lessThanOrEqualTo(120));
    },
  );

  test(
    'criteria change clears accumulated results and ignores stale result',
    () async {
      final oldResult = Completer<PagedResponse<String>>();
      final newResult = Completer<PagedResponse<String>>();
      final controller = CustomerLoadMoreController<String>(
        criteria: const <String, Object?>{'name': 'old'},
        stableId: (item) => item,
        pageLoader: (request) => request.criteria['name'] == 'old'
            ? oldResult.future
            : newResult.future,
      );
      addTearDown(controller.dispose);
      final oldLoad = controller.loadInitial();
      final newLoad = controller.updateCriteria(const <String, Object?>{
        'name': 'new',
      });
      expect(controller.items, isEmpty);
      newResult.complete(_page(1, <String>['new']));
      await newLoad;
      oldResult.complete(_page(1, <String>['stale']));
      await oldLoad;
      expect(controller.items, <String>['new']);
    },
  );

  test('duplicate Load More tap is suppressed', () async {
    final next = Completer<PagedResponse<String>>();
    var nextCalls = 0;
    final controller = CustomerLoadMoreController<String>(
      criteria: const <String, Object?>{},
      stableId: (item) => item,
      pageLoader: (request) {
        if (request.direction == PageDirection.first) {
          return Future<PagedResponse<String>>.value(
            _page(1, <String>['one'], hasNext: true),
          );
        }
        nextCalls += 1;
        return next.future;
      },
    );
    addTearDown(controller.dispose);
    await controller.loadInitial();
    final first = controller.loadMore();
    final duplicate = controller.loadMore();
    expect(identical(first, duplicate), isTrue);
    expect(nextCalls, 1);
    next.complete(_page(2, <String>['two']));
    await Future.wait(<Future<void>>[first, duplicate]);
  });

  test(
    'error preserves items, retry appends, and refresh restarts page one',
    () async {
      var nextAttempts = 0;
      var firstPageValue = 'first';
      final controller = CustomerLoadMoreController<String>(
        criteria: const <String, Object?>{},
        stableId: (item) => item,
        pageLoader: (request) async {
          if (request.direction == PageDirection.first) {
            return _page(1, <String>[firstPageValue], hasNext: true);
          }
          nextAttempts += 1;
          if (nextAttempts == 1) {
            throw StateError('temporary');
          }
          return _page(2, <String>['second']);
        },
      );
      addTearDown(controller.dispose);
      await controller.loadInitial();
      await controller.loadMore();
      expect(controller.status, CustomerLoadMoreStatus.error);
      expect(controller.items, <String>['first']);
      await controller.retry();
      expect(controller.items, <String>['first', 'second']);
      firstPageValue = 'refreshed';
      await controller.refresh();
      expect(controller.items, <String>['refreshed']);
      expect(controller.trimmedBeforeCount, 0);
    },
  );

  test('disposal suppresses pending completion and further loads', () async {
    final pending = Completer<PagedResponse<String>>();
    var calls = 0;
    final controller = CustomerLoadMoreController<String>(
      criteria: const <String, Object?>{},
      stableId: (item) => item,
      pageLoader: (request) {
        calls += 1;
        return pending.future;
      },
    );
    final load = controller.loadInitial();
    controller.dispose();
    pending.complete(_page(1, <String>['ignored']));
    await load;
    await controller.loadInitial();
    expect(controller.items, isEmpty);
    expect(controller.isDisposed, isTrue);
    expect(calls, 1);
  });
}
