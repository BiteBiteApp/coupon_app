import 'package:flutter/foundation.dart';

const String pageProtocolVersion = 'bitestar.page.v1';
const int operationalQueueDefaultPageSize = 25;
const int adminDirectoryDefaultPageSize = 50;
const int customerDiscoveryDefaultPageSize = 25;
const int maximumPageSize = 100;
const int _maximumSafeJsonInteger = 9007199254740991;

enum PageDirection {
  first('first'),
  forward('forward'),
  backward('backward'),
  last('last');

  const PageDirection(this.wireName);
  final String wireName;

  static PageDirection parse(Object? value) {
    return PageDirection.values.firstWhere(
      (direction) => direction.wireName == value,
      orElse: _invalidPageDirection,
    );
  }

  static PageDirection _invalidPageDirection() {
    throw const PagedProtocolException();
  }
}

class PagedProtocolException extends FormatException {
  const PagedProtocolException()
    : super('The BiteStar page request or response is invalid.');
}

Map<String, Object?> _requireMap(Object? value) {
  if (value is! Map) {
    throw const PagedProtocolException();
  }
  final result = <String, Object?>{};
  for (final entry in value.entries) {
    if (entry.key is! String) {
      throw const PagedProtocolException();
    }
    result[entry.key as String] = entry.value;
  }
  return result;
}

void _requireKeys(
  Map<String, Object?> data,
  Set<String> required, [
  Set<String> optional = const <String>{},
]) {
  if (!data.keys.toSet().containsAll(required) ||
      data.keys.any(
        (key) => !required.contains(key) && !optional.contains(key),
      )) {
    throw const PagedProtocolException();
  }
}

int _requireSafeInteger(
  Object? value, {
  int minimum = 0,
  int maximum = _maximumSafeJsonInteger,
}) {
  if (value is! int || value < minimum || value > maximum) {
    throw const PagedProtocolException();
  }
  return value;
}

String _requireString(Object? value, {required int maximumLength}) {
  if (value is! String || value.isEmpty || value.length > maximumLength) {
    throw const PagedProtocolException();
  }
  return value;
}

bool _requireBool(Object? value) {
  if (value is! bool) {
    throw const PagedProtocolException();
  }
  return value;
}

int validatePageSize(int pageSize) {
  return _requireSafeInteger(pageSize, minimum: 1, maximum: maximumPageSize);
}

Object? _freezeFilterValue(Object? value) {
  if (value == null || value is String || value is bool) {
    return value;
  }
  if (value is int) {
    return _requireSafeInteger(
      value,
      minimum: -_maximumSafeJsonInteger,
      maximum: _maximumSafeJsonInteger,
    );
  }
  if (value is List) {
    return List<Object?>.unmodifiable(value.map(_freezeFilterValue));
  }
  if (value is Map) {
    final map = _requireMap(value);
    return Map<String, Object?>.unmodifiable(
      map.map((key, nested) => MapEntry(key, _freezeFilterValue(nested))),
    );
  }
  throw const PagedProtocolException();
}

Map<String, Object?> freezePageCriteria(Map<String, Object?> criteria) {
  return Map<String, Object?>.unmodifiable(
    criteria.map((key, value) => MapEntry(key, _freezeFilterValue(value))),
  );
}

@immutable
class PagedRequest {
  factory PagedRequest({
    String protocolVersion = pageProtocolVersion,
    required int pageSize,
    required Map<String, Object?> criteria,
    String? cursor,
    required PageDirection direction,
    bool requestExactCount = false,
    required String clientRequestId,
  }) {
    if (protocolVersion != pageProtocolVersion) {
      throw const PagedProtocolException();
    }
    final size = validatePageSize(pageSize);
    final requestId = _requireString(clientRequestId, maximumLength: 128);
    final requiresCursor =
        direction == PageDirection.forward ||
        direction == PageDirection.backward;
    if (requiresCursor != (cursor != null)) {
      throw const PagedProtocolException();
    }
    final validatedCursor = cursor == null
        ? null
        : _requireString(cursor, maximumLength: 8192);
    return PagedRequest._(
      pageSize: size,
      criteria: freezePageCriteria(criteria),
      cursor: validatedCursor,
      direction: direction,
      requestExactCount: requestExactCount,
      clientRequestId: requestId,
    );
  }

  const PagedRequest._({
    required this.pageSize,
    required this.criteria,
    required this.cursor,
    required this.direction,
    required this.requestExactCount,
    required this.clientRequestId,
  });

  factory PagedRequest.fromJson(Object? value) {
    final data = _requireMap(value);
    _requireKeys(
      data,
      <String>{
        'protocolVersion',
        'pageSize',
        'criteria',
        'direction',
        'requestExactCount',
        'clientRequestId',
      },
      <String>{'cursor'},
    );
    if (data['protocolVersion'] != pageProtocolVersion) {
      throw const PagedProtocolException();
    }
    return PagedRequest(
      pageSize: _requireSafeInteger(
        data['pageSize'],
        minimum: 1,
        maximum: maximumPageSize,
      ),
      criteria: _requireMap(data['criteria']),
      cursor: data.containsKey('cursor')
          ? _requireString(data['cursor'], maximumLength: 8192)
          : null,
      direction: PageDirection.parse(data['direction']),
      requestExactCount: _requireBool(data['requestExactCount']),
      clientRequestId: _requireString(
        data['clientRequestId'],
        maximumLength: 128,
      ),
    );
  }

  final int pageSize;
  final Map<String, Object?> criteria;
  final String? cursor;
  final PageDirection direction;
  final bool requestExactCount;
  final String clientRequestId;

  Map<String, Object?> toJson() => <String, Object?>{
    'protocolVersion': pageProtocolVersion,
    'pageSize': pageSize,
    'criteria': criteria,
    if (cursor != null) 'cursor': cursor,
    'direction': direction.wireName,
    'requestExactCount': requestExactCount,
    'clientRequestId': clientRequestId,
  };
}

enum PagedTotalState { exact, unknown }

@immutable
class PagedTotal {
  factory PagedTotal.exact(int value) {
    return PagedTotal._(
      state: PagedTotalState.exact,
      exactValue: _requireSafeInteger(value),
    );
  }

  const PagedTotal.unknown()
    : state = PagedTotalState.unknown,
      exactValue = null;

  const PagedTotal._({required this.state, required this.exactValue});

  factory PagedTotal.fromJson(Object? value) {
    final data = _requireMap(value);
    if (data['state'] == 'exact') {
      _requireKeys(data, <String>{'state', 'value'});
      return PagedTotal.exact(_requireSafeInteger(data['value']));
    }
    if (data['state'] == 'unknown') {
      _requireKeys(data, <String>{'state'});
      return const PagedTotal.unknown();
    }
    throw const PagedProtocolException();
  }

  final PagedTotalState state;
  final int? exactValue;

  bool get isExact => state == PagedTotalState.exact;

  Map<String, Object?> toJson() => <String, Object?>{
    'state': state.name,
    if (exactValue != null) 'value': exactValue,
  };
}

@immutable
class PageCapabilities {
  const PageCapabilities({
    required this.first,
    required this.previous,
    required this.numberedVisitedPages,
    required this.next,
    required this.last,
  });

  factory PageCapabilities.fromJson(Object? value) {
    final data = _requireMap(value);
    _requireKeys(data, <String>{
      'first',
      'previous',
      'numberedVisitedPages',
      'next',
      'last',
    });
    return PageCapabilities(
      first: _requireBool(data['first']),
      previous: _requireBool(data['previous']),
      numberedVisitedPages: _requireBool(data['numberedVisitedPages']),
      next: _requireBool(data['next']),
      last: _requireBool(data['last']),
    );
  }

  final bool first;
  final bool previous;
  final bool numberedVisitedPages;
  final bool next;
  final bool last;

  Map<String, Object?> toJson() => <String, Object?>{
    'first': first,
    'previous': previous,
    'numberedVisitedPages': numberedVisitedPages,
    'next': next,
    'last': last,
  };
}

@immutable
class PageCursorSet {
  const PageCursorSet({this.next, this.previous});

  final String? next;
  final String? previous;
}

@immutable
class PageNumberState {
  factory PageNumberState(int currentPageNumber) {
    return PageNumberState._(
      _requireSafeInteger(currentPageNumber, minimum: 1),
    );
  }

  const PageNumberState._(this.currentPageNumber);

  final int currentPageNumber;

  int? totalPages(PagedTotal? total, int pageSize) {
    if (total?.isExact != true) {
      return null;
    }
    final size = validatePageSize(pageSize);
    return ((total!.exactValue! + size - 1) ~/ size).clamp(
      1,
      _maximumSafeJsonInteger,
    );
  }
}

enum PagePreparationState { preparing, ready, failed }

@immutable
class PagePreparation {
  factory PagePreparation.fromJson(Object? value) {
    final data = _requireMap(value);
    _requireKeys(
      data,
      <String>{'state', 'completedUnits'},
      <String>{'totalUnits', 'message'},
    );
    final state = switch (data['state']) {
      'preparing' => PagePreparationState.preparing,
      'ready' => PagePreparationState.ready,
      'failed' => PagePreparationState.failed,
      _ => throw const PagedProtocolException(),
    };
    final completedUnits = _requireSafeInteger(data['completedUnits']);
    final totalUnits = data.containsKey('totalUnits')
        ? _requireSafeInteger(data['totalUnits'])
        : null;
    if (totalUnits != null && completedUnits > totalUnits) {
      throw const PagedProtocolException();
    }
    final message = data.containsKey('message')
        ? _requireString(data['message'], maximumLength: 500)
        : null;
    return PagePreparation._(
      state: state,
      completedUnits: completedUnits,
      totalUnits: totalUnits,
      message: message,
    );
  }

  const PagePreparation._({
    required this.state,
    required this.completedUnits,
    required this.totalUnits,
    required this.message,
  });

  final PagePreparationState state;
  final int completedUnits;
  final int? totalUnits;
  final String? message;
}

@immutable
class PagedResponse<T> {
  factory PagedResponse({
    String protocolVersion = pageProtocolVersion,
    required List<T> items,
    required int pageSize,
    required bool hasNext,
    required bool hasPrevious,
    String? nextCursor,
    String? previousCursor,
    PageNumberState? pageNumber,
    PagedTotal? total,
    required String queryFingerprint,
    required int snapshotTimestampMs,
    required PageCapabilities capabilities,
    PagePreparation? preparation,
  }) {
    if (protocolVersion != pageProtocolVersion) {
      throw const PagedProtocolException();
    }
    final size = validatePageSize(pageSize);
    if (items.length > size ||
        hasNext != (nextCursor != null) ||
        hasPrevious != (previousCursor != null) ||
        capabilities.next != hasNext ||
        capabilities.previous != hasPrevious ||
        (preparation?.state == PagePreparationState.preparing &&
            total?.isExact == true)) {
      throw const PagedProtocolException();
    }
    final fingerprint = _requireString(queryFingerprint, maximumLength: 64);
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(fingerprint)) {
      throw const PagedProtocolException();
    }
    final validatedNext = nextCursor == null
        ? null
        : _requireString(nextCursor, maximumLength: 8192);
    final validatedPrevious = previousCursor == null
        ? null
        : _requireString(previousCursor, maximumLength: 8192);
    final totalPages = pageNumber?.totalPages(total, size);
    if (totalPages != null && pageNumber!.currentPageNumber > totalPages) {
      throw const PagedProtocolException();
    }
    return PagedResponse._(
      items: List<T>.unmodifiable(items),
      pageSize: size,
      hasNext: hasNext,
      hasPrevious: hasPrevious,
      cursors: PageCursorSet(next: validatedNext, previous: validatedPrevious),
      pageNumber: pageNumber,
      total: total,
      queryFingerprint: fingerprint,
      snapshotTimestampMs: _requireSafeInteger(snapshotTimestampMs),
      capabilities: capabilities,
      preparation: preparation,
    );
  }

  const PagedResponse._({
    required this.items,
    required this.pageSize,
    required this.hasNext,
    required this.hasPrevious,
    required this.cursors,
    required this.pageNumber,
    required this.total,
    required this.queryFingerprint,
    required this.snapshotTimestampMs,
    required this.capabilities,
    required this.preparation,
  });

  factory PagedResponse.fromJson(
    Object? value, {
    required T Function(Object? value) itemParser,
  }) {
    final data = _requireMap(value);
    _requireKeys(
      data,
      <String>{
        'protocolVersion',
        'items',
        'pageSize',
        'hasNext',
        'hasPrevious',
        'queryFingerprint',
        'snapshotTimestampMs',
        'capabilities',
      },
      <String>{
        'nextCursor',
        'previousCursor',
        'currentPageNumber',
        'total',
        'preparation',
      },
    );
    if (data['protocolVersion'] != pageProtocolVersion ||
        data['items'] is! List) {
      throw const PagedProtocolException();
    }
    final hasNext = _requireBool(data['hasNext']);
    final hasPrevious = _requireBool(data['hasPrevious']);
    return PagedResponse<T>(
      items: (data['items']! as List<Object?>).map(itemParser).toList(),
      pageSize: _requireSafeInteger(
        data['pageSize'],
        minimum: 1,
        maximum: maximumPageSize,
      ),
      hasNext: hasNext,
      hasPrevious: hasPrevious,
      nextCursor: data.containsKey('nextCursor')
          ? _requireString(data['nextCursor'], maximumLength: 8192)
          : null,
      previousCursor: data.containsKey('previousCursor')
          ? _requireString(data['previousCursor'], maximumLength: 8192)
          : null,
      pageNumber: data.containsKey('currentPageNumber')
          ? PageNumberState(
              _requireSafeInteger(data['currentPageNumber'], minimum: 1),
            )
          : null,
      total: data.containsKey('total')
          ? PagedTotal.fromJson(data['total'])
          : null,
      queryFingerprint: _requireString(
        data['queryFingerprint'],
        maximumLength: 64,
      ),
      snapshotTimestampMs: _requireSafeInteger(data['snapshotTimestampMs']),
      capabilities: PageCapabilities.fromJson(data['capabilities']),
      preparation: data.containsKey('preparation')
          ? PagePreparation.fromJson(data['preparation'])
          : null,
    );
  }

  final List<T> items;
  final int pageSize;
  final bool hasNext;
  final bool hasPrevious;
  final PageCursorSet cursors;
  final PageNumberState? pageNumber;
  final PagedTotal? total;
  final String queryFingerprint;
  final int snapshotTimestampMs;
  final PageCapabilities capabilities;
  final PagePreparation? preparation;

  String? get nextCursor => cursors.next;
  String? get previousCursor => cursors.previous;
}
