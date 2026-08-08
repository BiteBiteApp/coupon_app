import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/pagination/paged_models.dart';

typedef PagedPageLoader<T> =
    Future<PagedResponse<T>> Function(PagedRequest request);

enum PagedQueryStatus { idle, loading, empty, data, error }

class PagedQueryController<T> extends ChangeNotifier {
  PagedQueryController({
    required PagedPageLoader<T> pageLoader,
    required Map<String, Object?> criteria,
    this.pageSize = adminDirectoryDefaultPageSize,
    this.requestExactCount = true,
  }) : _pageLoader = pageLoader,
       _criteria = freezePageCriteria(criteria) {
    validatePageSize(pageSize);
  }

  final PagedPageLoader<T> _pageLoader;
  final int pageSize;
  final bool requestExactCount;
  Map<String, Object?> _criteria;
  final Map<int, PagedRequest> _visitedPageRequests = <int, PagedRequest>{};

  PagedResponse<T>? _page;
  Object? _error;
  StackTrace? _errorStackTrace;
  bool _isLoading = false;
  bool _disposed = false;
  int _generation = 0;
  int _requestSequence = 0;
  int? _currentPageNumber;
  Future<void>? _inFlight;
  PagedRequest? _failedRequest;
  int? _failedExpectedPage;

  Map<String, Object?> get criteria => _criteria;
  PagedResponse<T>? get page => _page;
  List<T> get items => _page?.items ?? const <Never>[];
  Object? get error => _error;
  StackTrace? get errorStackTrace => _errorStackTrace;
  bool get isLoading => _isLoading;
  bool get isRefreshing => _isLoading && _page != null;
  bool get isDisposed => _disposed;
  int? get currentPageNumber => _currentPageNumber;
  PagedTotal? get total => _page?.total;
  List<int> get visitedPageNumbers {
    final pages = _visitedPageRequests.keys.toList()..sort();
    return List<int>.unmodifiable(pages);
  }

  PagedQueryStatus get status {
    if (_page == null && _isLoading) {
      return PagedQueryStatus.loading;
    }
    if (_error != null) {
      return PagedQueryStatus.error;
    }
    if (_page == null) {
      return PagedQueryStatus.idle;
    }
    return _page!.items.isEmpty
        ? PagedQueryStatus.empty
        : PagedQueryStatus.data;
  }

  PagedRequest _request(PageDirection direction, {String? cursor}) {
    _requestSequence += 1;
    return PagedRequest(
      pageSize: pageSize,
      criteria: _criteria,
      cursor: cursor,
      direction: direction,
      requestExactCount: requestExactCount,
      clientRequestId: 'admin-page-$_generation-$_requestSequence',
    );
  }

  Future<void> loadInitial() {
    if (_page != null) {
      return Future<void>.value();
    }
    return _execute(_request(PageDirection.first), expectedPage: 1);
  }

  Future<void> nextPage() {
    final current = _page;
    final currentNumber = _currentPageNumber;
    if (current == null ||
        currentNumber == null ||
        !current.hasNext ||
        current.nextCursor == null) {
      return Future<void>.value();
    }
    return _execute(
      _request(PageDirection.forward, cursor: current.nextCursor),
      expectedPage: currentNumber + 1,
    );
  }

  Future<void> previousPage() {
    final current = _page;
    final currentNumber = _currentPageNumber;
    if (current == null || currentNumber == null || currentNumber <= 1) {
      return Future<void>.value();
    }
    final visited = _visitedPageRequests[currentNumber - 1];
    if (visited != null) {
      return _execute(_renew(visited), expectedPage: currentNumber - 1);
    }
    if (!current.hasPrevious || current.previousCursor == null) {
      return Future<void>.value();
    }
    return _execute(
      _request(PageDirection.backward, cursor: current.previousCursor),
      expectedPage: currentNumber - 1,
    );
  }

  Future<void> firstPage() {
    if (_page != null && !_page!.capabilities.first) {
      return Future<void>.value();
    }
    return _execute(_request(PageDirection.first), expectedPage: 1);
  }

  Future<void> lastPage() {
    if (_page == null || !_page!.capabilities.last) {
      return Future<void>.value();
    }
    return _execute(_request(PageDirection.last));
  }

  Future<void> goToVisitedPage(int pageNumber) {
    if (_page?.capabilities.numberedVisitedPages != true) {
      throw StateError('Numbered visited-page navigation is not supported.');
    }
    final request = _visitedPageRequests[pageNumber];
    if (request == null) {
      throw ArgumentError.value(
        pageNumber,
        'pageNumber',
        'Page was not visited.',
      );
    }
    return _execute(_renew(request), expectedPage: pageNumber);
  }

  Future<void> updateCriteria(
    Map<String, Object?> criteria, {
    bool load = true,
  }) {
    _invalidatePending();
    _criteria = freezePageCriteria(criteria);
    _clearPageState();
    _notifySafely();
    return load ? loadInitial() : Future<void>.value();
  }

  Future<void> refreshFirstPage() {
    _visitedPageRequests.clear();
    return _execute(_request(PageDirection.first), expectedPage: 1);
  }

  Future<void> refreshCurrentPage() {
    final pageNumber = _currentPageNumber;
    if (pageNumber == null) {
      return loadInitial();
    }
    final anchor = _visitedPageRequests[pageNumber];
    if (anchor == null) {
      return Future<void>.value();
    }
    return _execute(_renew(anchor), expectedPage: pageNumber);
  }

  Future<void> retry() {
    final request = _failedRequest;
    if (request == null) {
      return Future<void>.value();
    }
    return _execute(_renew(request), expectedPage: _failedExpectedPage);
  }

  PagedRequest _renew(PagedRequest anchor) {
    return _request(anchor.direction, cursor: anchor.cursor);
  }

  Future<void> _execute(PagedRequest request, {int? expectedPage}) {
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
        final resolvedPage =
            result.pageNumber?.currentPageNumber ?? expectedPage;
        if (resolvedPage == null || resolvedPage < 1) {
          throw const PagedProtocolException();
        }
        _page = result;
        _currentPageNumber = resolvedPage;
        _visitedPageRequests[resolvedPage] = request;
        _error = null;
        _errorStackTrace = null;
        _failedRequest = null;
        _failedExpectedPage = null;
      } catch (error, stackTrace) {
        if (_disposed || requestGeneration != _generation) {
          return;
        }
        _error = error;
        _errorStackTrace = stackTrace;
        _failedRequest = request;
        _failedExpectedPage = expectedPage;
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

  void _clearPageState() {
    _page = null;
    _currentPageNumber = null;
    _visitedPageRequests.clear();
    _error = null;
    _errorStackTrace = null;
    _failedRequest = null;
    _failedExpectedPage = null;
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
