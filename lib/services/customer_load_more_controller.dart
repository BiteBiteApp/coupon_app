import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/pagination/paged_models.dart';
import 'paged_query_controller.dart' show PagedPageLoader;

typedef StableItemId<T> = Object Function(T item);

enum CustomerLoadMoreStatus { idle, loading, empty, data, error }

class CustomerLoadMoreController<T> extends ChangeNotifier {
  CustomerLoadMoreController({
    required PagedPageLoader<T> pageLoader,
    required StableItemId<T> stableId,
    required Map<String, Object?> criteria,
    this.pageSize = customerDiscoveryDefaultPageSize,
    this.maximumRetainedItems = 120,
  }) : _pageLoader = pageLoader,
       _stableId = stableId,
       _criteria = freezePageCriteria(criteria) {
    validatePageSize(pageSize);
    if (maximumRetainedItems < 1 || maximumRetainedItems > 120) {
      throw ArgumentError.value(
        maximumRetainedItems,
        'maximumRetainedItems',
        'Retention must be from 1 through 120.',
      );
    }
  }

  final PagedPageLoader<T> _pageLoader;
  final StableItemId<T> _stableId;
  final int pageSize;
  final int maximumRetainedItems;
  Map<String, Object?> _criteria;

  List<T> _items = <T>[];
  PagedResponse<T>? _lastPage;
  Object? _error;
  StackTrace? _errorStackTrace;
  bool _isLoading = false;
  bool _disposed = false;
  int _generation = 0;
  int _requestSequence = 0;
  int _trimmedBeforeCount = 0;
  Future<void>? _inFlight;
  PagedRequest? _failedRequest;
  bool _failedAppend = false;

  Map<String, Object?> get criteria => _criteria;
  List<T> get items => List<T>.unmodifiable(_items);
  PagedResponse<T>? get lastPage => _lastPage;
  Object? get error => _error;
  StackTrace? get errorStackTrace => _errorStackTrace;
  bool get isLoading => _isLoading;
  bool get isDisposed => _disposed;
  bool get hasNext => _lastPage?.hasNext ?? false;
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
    if (_lastPage == null) {
      return CustomerLoadMoreStatus.idle;
    }
    return _items.isEmpty
        ? CustomerLoadMoreStatus.empty
        : CustomerLoadMoreStatus.data;
  }

  PagedRequest _request(PageDirection direction, {String? cursor}) {
    _requestSequence += 1;
    return PagedRequest(
      pageSize: pageSize,
      criteria: _criteria,
      cursor: cursor,
      direction: direction,
      requestExactCount: false,
      clientRequestId: 'customer-page-$_generation-$_requestSequence',
    );
  }

  Future<void> loadInitial() {
    if (_lastPage != null) {
      return Future<void>.value();
    }
    return _execute(_request(PageDirection.first), append: false);
  }

  Future<void> loadMore() {
    final page = _lastPage;
    if (page == null || !page.hasNext || page.nextCursor == null) {
      return Future<void>.value();
    }
    return _execute(
      _request(PageDirection.forward, cursor: page.nextCursor),
      append: true,
    );
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
    final request = _failedRequest;
    if (request == null) {
      return Future<void>.value();
    }
    return _execute(
      _request(request.direction, cursor: request.cursor),
      append: _failedAppend,
    );
  }

  Future<void> _execute(PagedRequest request, {required bool append}) {
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
        final combined = append ? <T>[..._items] : <T>[];
        final ids = combined.map(_stableId).toSet();
        for (final item in result.items) {
          if (ids.add(_stableId(item))) {
            combined.add(item);
          }
        }
        final overflow = combined.length - maximumRetainedItems;
        if (overflow > 0) {
          combined.removeRange(0, overflow);
          _trimmedBeforeCount += overflow;
        } else if (!append) {
          _trimmedBeforeCount = 0;
        }
        _items = combined;
        _lastPage = result;
        _error = null;
        _errorStackTrace = null;
        _failedRequest = null;
      } catch (error, stackTrace) {
        if (_disposed || requestGeneration != _generation) {
          return;
        }
        _error = error;
        _errorStackTrace = stackTrace;
        _failedRequest = request;
        _failedAppend = append;
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
    _lastPage = null;
    _error = null;
    _errorStackTrace = null;
    _failedRequest = null;
    _failedAppend = false;
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
}
