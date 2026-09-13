import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/pagination/paged_models.dart';
import 'paged_query_controller.dart' show PagedPageLoader;

typedef StableItemId<T> = Object Function(T item);
typedef CustomerLoadMoreRequestIdGenerator = String Function();
typedef CustomerLoadMorePageLoader<T> =
    Future<CustomerLoadMorePageEnvelope<T>> Function(
      CustomerLoadMoreRequest request,
    );

enum CustomerLoadMoreStatus { idle, loading, empty, data, error }

@immutable
final class CustomerLoadMoreRequest {
  const CustomerLoadMoreRequest._({
    required this.pageSize,
    required this.criteria,
    required this.cursor,
    required this.clientRequestId,
  });

  final int pageSize;
  final Map<String, Object?> criteria;
  final String? cursor;
  final String clientRequestId;

  bool get isInitial => cursor == null;
}

@immutable
final class CustomerLoadMorePageEnvelope<T> {
  factory CustomerLoadMorePageEnvelope({
    required List<T> items,
    required String? nextCursor,
    required bool hasMore,
    required bool partial,
    VoidCallback? onAccepted,
  }) {
    if (hasMore != (nextCursor != null) ||
        (nextCursor != null && nextCursor.isEmpty) ||
        (partial && !hasMore)) {
      throw const FormatException('The customer page envelope is invalid.');
    }
    return CustomerLoadMorePageEnvelope._(
      items: List<T>.unmodifiable(items),
      nextCursor: nextCursor,
      hasMore: hasMore,
      partial: partial,
      onAccepted: onAccepted,
    );
  }

  const CustomerLoadMorePageEnvelope._({
    required this.items,
    required this.nextCursor,
    required this.hasMore,
    required this.partial,
    required VoidCallback? onAccepted,
  }) : _onAccepted = onAccepted;

  final List<T> items;
  final String? nextCursor;
  final bool hasMore;
  final bool partial;
  final VoidCallback? _onAccepted;

  void _accept() => _onAccepted?.call();
}

final class CustomerLoadMoreNonProgressException implements Exception {
  const CustomerLoadMoreNonProgressException();

  @override
  String toString() =>
      'The customer page continuation did not make forward progress.';
}

typedef _CustomerLoadMoreInternalPageLoader<T> =
    Future<_CustomerLoadMoreLoadedPage<T>> Function(
      CustomerLoadMoreRequest request,
    );

final class _CustomerLoadMoreLoadedPage<T> {
  const _CustomerLoadMoreLoadedPage({required this.envelope, this.legacyPage});

  final CustomerLoadMorePageEnvelope<T> envelope;
  final PagedResponse<T>? legacyPage;
}

class CustomerLoadMoreController<T> extends ChangeNotifier {
  CustomerLoadMoreController({
    required PagedPageLoader<T> pageLoader,
    required StableItemId<T> stableId,
    required Map<String, Object?> criteria,
    int pageSize = customerDiscoveryDefaultPageSize,
    int maximumRetainedItems = 120,
    bool retainAllItems = false,
    CustomerLoadMoreRequestIdGenerator? requestIdGenerator,
    DateTime Function()? clock,
    Duration nonProgressRetryDelay = const Duration(seconds: 1),
  }) : this._(
         pageLoader: (request) async {
           final direction = request.isInitial
               ? PageDirection.first
               : PageDirection.forward;
           final page = await pageLoader(
             PagedRequest(
               pageSize: request.pageSize,
               criteria: request.criteria,
               cursor: request.cursor,
               direction: direction,
               requestExactCount: false,
               clientRequestId: request.clientRequestId,
             ),
           );
           return _CustomerLoadMoreLoadedPage<T>(
             envelope: CustomerLoadMorePageEnvelope<T>(
               items: page.items,
               nextCursor: page.nextCursor,
               hasMore: page.hasNext,
               partial: false,
             ),
             legacyPage: page,
           );
         },
         stableId: stableId,
         criteria: criteria,
         pageSize: pageSize,
         maximumRetainedItems: maximumRetainedItems,
         retainAllItems: retainAllItems,
         requestIdGenerator: requestIdGenerator,
         clock: clock,
         nonProgressRetryDelay: nonProgressRetryDelay,
       );

  CustomerLoadMoreController.envelope({
    required CustomerLoadMorePageLoader<T> pageLoader,
    required StableItemId<T> stableId,
    required Map<String, Object?> criteria,
    int pageSize = customerDiscoveryDefaultPageSize,
    int maximumRetainedItems = 120,
    bool retainAllItems = false,
    CustomerLoadMoreRequestIdGenerator? requestIdGenerator,
    DateTime Function()? clock,
    Duration nonProgressRetryDelay = const Duration(seconds: 1),
  }) : this._(
         pageLoader: (request) async => _CustomerLoadMoreLoadedPage<T>(
           envelope: await pageLoader(request),
         ),
         stableId: stableId,
         criteria: criteria,
         pageSize: pageSize,
         maximumRetainedItems: maximumRetainedItems,
         retainAllItems: retainAllItems,
         requestIdGenerator: requestIdGenerator,
         clock: clock,
         nonProgressRetryDelay: nonProgressRetryDelay,
       );

  CustomerLoadMoreController._({
    required _CustomerLoadMoreInternalPageLoader<T> pageLoader,
    required StableItemId<T> stableId,
    required Map<String, Object?> criteria,
    required this.pageSize,
    required this.maximumRetainedItems,
    required this.retainAllItems,
    required CustomerLoadMoreRequestIdGenerator? requestIdGenerator,
    required DateTime Function()? clock,
    required this.nonProgressRetryDelay,
  }) : _pageLoader = pageLoader,
       _stableId = stableId,
       _requestIdGenerator = requestIdGenerator,
       _clock = clock ?? _now,
       _criteria = freezePageCriteria(criteria) {
    validatePageSize(pageSize);
    if (maximumRetainedItems < 1 || maximumRetainedItems > 120) {
      throw ArgumentError.value(
        maximumRetainedItems,
        'maximumRetainedItems',
        'Retention must be from 1 through 120.',
      );
    }
    if (nonProgressRetryDelay < Duration.zero) {
      throw ArgumentError.value(
        nonProgressRetryDelay,
        'nonProgressRetryDelay',
        'The retry delay cannot be negative.',
      );
    }
  }

  final _CustomerLoadMoreInternalPageLoader<T> _pageLoader;
  final StableItemId<T> _stableId;
  final CustomerLoadMoreRequestIdGenerator? _requestIdGenerator;
  final DateTime Function() _clock;
  final int pageSize;
  final int maximumRetainedItems;
  final bool retainAllItems;
  final Duration nonProgressRetryDelay;
  Map<String, Object?> _criteria;

  List<T> _items = <T>[];
  CustomerLoadMorePageEnvelope<T>? _pageEnvelope;
  PagedResponse<T>? _lastPage;
  Object? _error;
  StackTrace? _errorStackTrace;
  bool _isLoading = false;
  bool _disposed = false;
  int _generation = 0;
  int _requestSequence = 0;
  int _trimmedBeforeCount = 0;
  Future<void>? _inFlight;
  CustomerLoadMoreRequest? _failedRequest;
  bool _failedAppend = false;
  String? _nonProgressCursor;
  DateTime? _retryNotBefore;
  final Set<String> _seenContinuationCursors = <String>{};

  Map<String, Object?> get criteria => _criteria;
  List<T> get items => List<T>.unmodifiable(_items);
  CustomerLoadMorePageEnvelope<T>? get pageEnvelope => _pageEnvelope;
  PagedResponse<T>? get lastPage => _lastPage;
  Object? get error => _error;
  StackTrace? get errorStackTrace => _errorStackTrace;
  bool get isLoading => _isLoading;
  bool get isDisposed => _disposed;
  bool get hasNext => _pageEnvelope?.hasMore ?? false;
  bool get partial => _pageEnvelope?.partial ?? false;
  bool get hasRetry => _failedRequest != null || _nonProgressCursor != null;
  DateTime? get retryNotBefore => _retryNotBefore;
  bool get canRetry =>
      hasRetry &&
      (_retryNotBefore == null || !_clock().isBefore(_retryNotBefore!));
  Duration get retryDelayRemaining {
    final retryAt = _retryNotBefore;
    if (retryAt == null) {
      return Duration.zero;
    }
    final remaining = retryAt.difference(_clock());
    return remaining > Duration.zero ? remaining : Duration.zero;
  }

  int get trimmedBeforeCount => _trimmedBeforeCount;
  Object? get visibleWindowAnchorId =>
      _items.isEmpty ? null : _stableId(_items.first);

  CustomerLoadMoreStatus get status {
    if (_items.isEmpty && _isLoading) {
      return CustomerLoadMoreStatus.loading;
    }
    if (_error != null) {
      return CustomerLoadMoreStatus.error;
    }
    if (_pageEnvelope == null) {
      return CustomerLoadMoreStatus.idle;
    }
    return _items.isEmpty
        ? CustomerLoadMoreStatus.empty
        : CustomerLoadMoreStatus.data;
  }

  CustomerLoadMoreRequest _request({String? cursor}) {
    _requestSequence += 1;
    final clientRequestId =
        _requestIdGenerator?.call() ??
        'customer-page-$_generation-$_requestSequence';
    if (clientRequestId.isEmpty || clientRequestId.trim() != clientRequestId) {
      throw StateError('The customer page request ID is invalid.');
    }
    return CustomerLoadMoreRequest._(
      pageSize: pageSize,
      criteria: _criteria,
      cursor: cursor,
      clientRequestId: clientRequestId,
    );
  }

  Future<void> loadInitial() {
    if (_pageEnvelope != null) {
      return Future<void>.value();
    }
    if (_failedRequest != null && !_failedAppend) {
      return retry();
    }
    return _execute(_request(), append: false);
  }

  Future<void> loadMore() {
    if (_failedRequest != null && _failedAppend) {
      return retry();
    }
    final page = _pageEnvelope;
    if (page == null || !page.hasMore || page.nextCursor == null) {
      return Future<void>.value();
    }
    if (_nonProgressCursor != null) {
      return Future<void>.value();
    }
    return _execute(_request(cursor: page.nextCursor), append: true);
  }

  Future<void> updateCriteria(
    Map<String, Object?> criteria, {
    bool load = true,
  }) {
    _invalidatePending();
    _criteria = freezePageCriteria(criteria);
    _clearResults();
    _notifySafely();
    return load ? loadInitial() : Future<void>.value();
  }

  Future<void> refresh() {
    _invalidatePending();
    _clearResults();
    _notifySafely();
    return loadInitial();
  }

  Future<void> retry() {
    final failedRequest = _failedRequest;
    if (failedRequest != null) {
      return _execute(failedRequest, append: _failedAppend);
    }
    final nonProgressCursor = _nonProgressCursor;
    if (nonProgressCursor == null || !canRetry) {
      return Future<void>.value();
    }
    return _execute(_request(cursor: nonProgressCursor), append: true);
  }

  Future<void> _execute(
    CustomerLoadMoreRequest request, {
    required bool append,
  }) {
    if (_disposed) {
      return Future<void>.value();
    }
    final existing = _inFlight;
    if (existing != null) {
      return existing;
    }
    final requestGeneration = _generation;
    _isLoading = true;
    _error = null;
    _errorStackTrace = null;
    _notifySafely();

    late final Future<void> operation;
    operation = () async {
      try {
        final result = await _pageLoader(request);
        if (_disposed || requestGeneration != _generation) {
          return;
        }
        final page = result.envelope;
        final nextCursor = page.nextCursor;
        if (append &&
            page.hasMore &&
            nextCursor != null &&
            (nextCursor == request.cursor ||
                _seenContinuationCursors.contains(nextCursor))) {
          _error = const CustomerLoadMoreNonProgressException();
          _errorStackTrace = StackTrace.current;
          _failedRequest = null;
          _failedAppend = false;
          _nonProgressCursor = request.cursor;
          _retryNotBefore = _clock().add(nonProgressRetryDelay);
          return;
        }

        final combined = append ? <T>[..._items] : <T>[];
        var nextTrimmedBeforeCount = append ? _trimmedBeforeCount : 0;
        final ids = combined.map(_stableId).toSet();
        for (final item in page.items) {
          if (ids.add(_stableId(item))) {
            combined.add(item);
          }
        }
        if (retainAllItems) {
          nextTrimmedBeforeCount = append ? _trimmedBeforeCount : 0;
        } else {
          final overflow = combined.length - maximumRetainedItems;
          if (overflow > 0) {
            combined.removeRange(0, overflow);
            nextTrimmedBeforeCount += overflow;
          }
        }
        page._accept();
        if (_disposed || requestGeneration != _generation) {
          return;
        }
        _items = combined;
        _trimmedBeforeCount = nextTrimmedBeforeCount;
        _pageEnvelope = page;
        _lastPage = result.legacyPage;
        if (nextCursor != null) {
          _seenContinuationCursors.add(nextCursor);
        }
        _error = null;
        _errorStackTrace = null;
        _failedRequest = null;
        _failedAppend = false;
        _nonProgressCursor = null;
        _retryNotBefore = null;
      } catch (error, stackTrace) {
        if (_disposed || requestGeneration != _generation) {
          return;
        }
        _error = error;
        _errorStackTrace = stackTrace;
        _failedRequest = request;
        _failedAppend = append;
        _nonProgressCursor = null;
        _retryNotBefore = null;
      } finally {
        if (!_disposed && requestGeneration == _generation) {
          if (identical(_inFlight, operation)) {
            _inFlight = null;
          }
          _isLoading = false;
          _notifySafely();
        }
      }
    }();
    _inFlight = operation;
    return operation;
  }

  void _invalidatePending() {
    _generation += 1;
    _inFlight = null;
    _isLoading = false;
  }

  void _clearResults() {
    _items = <T>[];
    _pageEnvelope = null;
    _lastPage = null;
    _error = null;
    _errorStackTrace = null;
    _failedRequest = null;
    _failedAppend = false;
    _nonProgressCursor = null;
    _retryNotBefore = null;
    _seenContinuationCursors.clear();
    _trimmedBeforeCount = 0;
  }

  void _notifySafely() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    if (_disposed) {
      return;
    }
    _disposed = true;
    _generation += 1;
    _inFlight = null;
    super.dispose();
  }

  static DateTime _now() => DateTime.now();
}
