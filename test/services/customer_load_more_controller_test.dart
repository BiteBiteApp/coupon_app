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

CustomerLoadMorePageEnvelope<T> _envelope<T>(
  List<T> items, {
  String? nextCursor,
  bool partial = false,
  void Function()? onAccepted,
}) => CustomerLoadMorePageEnvelope<T>(
  items: items,
  nextCursor: nextCursor,
  hasMore: nextCursor != null,
  partial: partial,
  onAccepted: onAccepted,
);

final class _SubclassedCustomerLoadMoreController
    extends CustomerLoadMoreController<String> {
  _SubclassedCustomerLoadMoreController({required super.pageLoader})
    : super(
        criteria: const <String, Object?>{'subclass': true},
        stableId: (item) => item,
      );
}

void main() {
  test('legacy public constructor remains subclassable', () async {
    final controller = _SubclassedCustomerLoadMoreController(
      pageLoader: (_) async => _page(1, <String>['subclassed']),
    );
    addTearDown(controller.dispose);

    await controller.loadInitial();

    expect(controller.items, <String>['subclassed']);
  });

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

  test(
    'customer envelope preserves empty partial progress and opaque cursors',
    () async {
      final requests = <CustomerLoadMoreRequest>[];
      final controller = CustomerLoadMoreController<String>.envelope(
        criteria: const <String, Object?>{'session': 'opaque'},
        stableId: (item) => item,
        pageLoader: (request) async {
          requests.add(request);
          return switch (request.cursor) {
            null => _envelope(<String>['one'], nextCursor: 'cursor-a'),
            'cursor-a' => _envelope(
              const <String>[],
              nextCursor: 'cursor-b',
              partial: true,
            ),
            'cursor-b' => _envelope(<String>['two']),
            _ => throw StateError('unexpected cursor'),
          };
        },
      );
      addTearDown(controller.dispose);

      await controller.loadInitial();
      await controller.loadMore();
      expect(controller.items, <String>['one']);
      expect(controller.partial, isTrue);
      expect(controller.hasNext, isTrue);
      expect(controller.pageEnvelope?.nextCursor, 'cursor-b');
      expect(controller.lastPage, isNull);

      await controller.loadMore();
      expect(controller.items, <String>['one', 'two']);
      expect(controller.partial, isFalse);
      expect(requests.map((request) => request.cursor), <String?>[
        null,
        'cursor-a',
        'cursor-b',
      ]);
    },
  );

  test('uncertain append re-tap replays the exact immutable request', () async {
    final requests = <CustomerLoadMoreRequest>[];
    var generatedIds = 0;
    var appendAttempts = 0;
    final controller = CustomerLoadMoreController<String>.envelope(
      criteria: const <String, Object?>{},
      stableId: (item) => item,
      requestIdGenerator: () => 'request-${++generatedIds}-00000000',
      pageLoader: (request) async {
        requests.add(request);
        if (request.isInitial) {
          return _envelope(<String>['one'], nextCursor: 'next');
        }
        appendAttempts += 1;
        if (appendAttempts == 1) {
          throw StateError('uncertain transport failure');
        }
        return _envelope(<String>['two']);
      },
    );
    addTearDown(controller.dispose);

    await controller.loadInitial();
    await controller.loadMore();
    expect(controller.items, <String>['one']);
    expect(controller.hasRetry, isTrue);
    expect(controller.canRetry, isTrue);

    await controller.loadMore();
    expect(identical(requests[1], requests[2]), isTrue);
    expect(requests[1].clientRequestId, requests[2].clientRequestId);
    expect(generatedIds, 2);
    expect(controller.items, <String>['one', 'two']);
  });

  test(
    'uncertain initial re-tap replays the exact immutable request',
    () async {
      final requests = <CustomerLoadMoreRequest>[];
      var generatedIds = 0;
      final controller = CustomerLoadMoreController<String>.envelope(
        criteria: const <String, Object?>{},
        stableId: (item) => item,
        requestIdGenerator: () => 'request-${++generatedIds}-00000000',
        pageLoader: (request) async {
          requests.add(request);
          if (requests.length == 1) {
            throw StateError('uncertain transport failure');
          }
          return _envelope(<String>['one']);
        },
      );
      addTearDown(controller.dispose);

      await controller.loadInitial();
      expect(controller.hasRetry, isTrue);
      await controller.loadInitial();

      expect(identical(requests[0], requests[1]), isTrue);
      expect(generatedIds, 1);
      expect(controller.items, <String>['one']);
    },
  );

  test('legacy uncertain retry preserves every request wire field', () async {
    final requests = <PagedRequest>[];
    var appendAttempts = 0;
    final controller = CustomerLoadMoreController<String>(
      criteria: const <String, Object?>{
        'nested': <String, Object?>{
          'values': <Object?>[1, 'two'],
        },
      },
      stableId: (item) => item,
      pageLoader: (request) async {
        requests.add(request);
        if (request.direction == PageDirection.first) {
          return _page(1, <String>['one'], hasNext: true);
        }
        appendAttempts += 1;
        if (appendAttempts == 1) {
          throw StateError('uncertain legacy transport failure');
        }
        return _page(2, <String>['two']);
      },
    );
    addTearDown(controller.dispose);

    await controller.loadInitial();
    await controller.loadMore();
    final uncertainWireRequest = requests.last.toJson();

    await controller.retry();

    expect(requests, hasLength(3));
    expect(requests.last.toJson(), uncertainWireRequest);
    expect(controller.items, <String>['one', 'two']);
  });

  test(
    'non-progress is paced and explicit retry starts a new transport request',
    () async {
      var now = DateTime.utc(2026, 9, 12, 12);
      var generatedIds = 0;
      final requests = <CustomerLoadMoreRequest>[];
      final controller = CustomerLoadMoreController<String>.envelope(
        criteria: const <String, Object?>{},
        stableId: (item) => item,
        clock: () => now,
        nonProgressRetryDelay: const Duration(seconds: 2),
        requestIdGenerator: () => 'request-${++generatedIds}-00000000',
        pageLoader: (request) async {
          requests.add(request);
          if (request.isInitial) {
            return _envelope(<String>['one'], nextCursor: 'cursor-a');
          }
          if (requests.length == 2) {
            return _envelope(
              <String>['must-not-append'],
              nextCursor: 'cursor-a',
              partial: true,
            );
          }
          return _envelope(<String>['two']);
        },
      );
      addTearDown(controller.dispose);

      await controller.loadInitial();
      await controller.loadMore();
      expect(controller.error, isA<CustomerLoadMoreNonProgressException>());
      expect(controller.items, <String>['one']);
      expect(controller.hasRetry, isTrue);
      expect(controller.canRetry, isFalse);
      expect(controller.retryDelayRemaining, const Duration(seconds: 2));

      await controller.loadMore();
      await controller.retry();
      expect(requests, hasLength(2));

      now = now.add(const Duration(seconds: 2));
      await controller.retry();
      expect(requests, hasLength(3));
      expect(requests[2].cursor, 'cursor-a');
      expect(requests[2].clientRequestId, isNot(requests[1].clientRequestId));
      expect(controller.items, <String>['one', 'two']);
      expect(controller.error, isNull);
    },
  );

  test(
    'opt-in unbounded retention keeps more than 120 ordered items',
    () async {
      var page = 0;
      final controller = CustomerLoadMoreController<int>.envelope(
        criteria: const <String, Object?>{},
        stableId: (item) => item,
        retainAllItems: true,
        pageLoader: (request) async {
          final currentPage = page++;
          final first = currentPage * 25;
          return _envelope(
            List<int>.generate(25, (index) => first + index),
            nextCursor: currentPage < 5 ? 'cursor-$currentPage' : null,
          );
        },
      );
      addTearDown(controller.dispose);

      await controller.loadInitial();
      while (controller.hasNext) {
        await controller.loadMore();
      }

      expect(controller.items, List<int>.generate(150, (index) => index));
      expect(controller.trimmedBeforeCount, 0);
      expect(controller.maximumRetainedItems, 120);
    },
  );

  test(
    'acceptance disposal cannot install the accepted page afterward',
    () async {
      late final CustomerLoadMoreController<String> controller;
      var accepted = 0;
      var notifications = 0;
      controller = CustomerLoadMoreController<String>.envelope(
        criteria: const <String, Object?>{},
        stableId: (item) => item,
        pageLoader: (_) async => _envelope(
          <String>['stale'],
          nextCursor: 'stale-cursor',
          onAccepted: () {
            accepted += 1;
            controller.dispose();
          },
        ),
      );
      controller.addListener(() => notifications += 1);

      await controller.loadInitial();

      expect(accepted, 1);
      expect(notifications, 1);
      expect(controller.isDisposed, isTrue);
      expect(controller.items, isEmpty);
      expect(controller.pageEnvelope, isNull);
      expect(controller.lastPage, isNull);
      expect(controller.hasNext, isFalse);
      expect(controller.error, isNull);
    },
  );

  test(
    'acceptance refresh fences the old page and preserves the newer request',
    () async {
      final replacement = Completer<CustomerLoadMorePageEnvelope<String>>();
      late final CustomerLoadMoreController<String> controller;
      var calls = 0;
      var accepted = 0;
      var notifications = 0;
      controller = CustomerLoadMoreController<String>.envelope(
        criteria: const <String, Object?>{},
        stableId: (item) => item,
        pageLoader: (_) {
          calls += 1;
          if (calls == 1) {
            return Future.value(
              _envelope(
                <String>['stale'],
                nextCursor: 'stale-cursor',
                onAccepted: () {
                  accepted += 1;
                  unawaited(controller.refresh());
                },
              ),
            );
          }
          return replacement.future;
        },
      );
      addTearDown(controller.dispose);
      controller.addListener(() => notifications += 1);

      await controller.loadInitial();

      expect(accepted, 1);
      expect(calls, 2);
      expect(controller.items, isEmpty);
      expect(controller.pageEnvelope, isNull);
      expect(controller.hasNext, isFalse);
      expect(controller.error, isNull);
      expect(controller.isLoading, isTrue);
      expect(notifications, 3);

      replacement.complete(_envelope(<String>['replacement']));
      await pumpEventQueue();

      expect(controller.items, <String>['replacement']);
      expect(controller.pageEnvelope, isNotNull);
      expect(controller.isLoading, isFalse);
      expect(controller.error, isNull);
      expect(notifications, 4);
    },
  );

  test('normal acceptance hook runs once and commits the page', () async {
    var accepted = 0;
    final controller = CustomerLoadMoreController<String>.envelope(
      criteria: const <String, Object?>{},
      stableId: (item) => item,
      pageLoader: (_) async => _envelope(
        <String>['accepted'],
        nextCursor: 'next',
        onAccepted: () => accepted += 1,
      ),
    );
    addTearDown(controller.dispose);

    await controller.loadInitial();

    expect(accepted, 1);
    expect(controller.items, <String>['accepted']);
    expect(controller.pageEnvelope, isNotNull);
    expect(controller.hasNext, isTrue);
    expect(controller.error, isNull);
  });
}
