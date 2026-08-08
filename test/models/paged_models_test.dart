import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:flutter_test/flutter_test.dart';

const String _fingerprint =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

Map<String, Object?> _response({
  Object? total = const <String, Object?>{'state': 'exact', 'value': 51},
  Object? currentPageNumber = 1,
  bool hasNext = true,
  bool hasPrevious = false,
  Object? items = const <Object?>[
    <String, Object?>{'id': 'one'},
  ],
}) => <String, Object?>{
  'protocolVersion': pageProtocolVersion,
  'items': items,
  'pageSize': 50,
  'hasNext': hasNext,
  'hasPrevious': hasPrevious,
  if (hasNext) 'nextCursor': 'opaque-next',
  if (hasPrevious) 'previousCursor': 'opaque-previous',
  'currentPageNumber': ?currentPageNumber,
  'total': ?total,
  'queryFingerprint': _fingerprint,
  'snapshotTimestampMs': 1786185600000,
  'capabilities': <String, Object?>{
    'first': hasPrevious,
    'previous': hasPrevious,
    'numberedVisitedPages': true,
    'next': hasNext,
    'last': hasNext,
  },
};

void main() {
  test(
    'protocol version and page-size constants match the shared contract',
    () {
      expect(pageProtocolVersion, 'bitestar.page.v1');
      expect(operationalQueueDefaultPageSize, 25);
      expect(adminDirectoryDefaultPageSize, 50);
      expect(customerDiscoveryDefaultPageSize, inInclusiveRange(20, 30));
      expect(maximumPageSize, 100);
    },
  );

  test('request round trips strict first and opaque forward cursor shapes', () {
    final first = PagedRequest(
      pageSize: 50,
      criteria: <String, Object?>{
        'source': 'bitesaver',
        'nested': <String, Object?>{'active': true},
      },
      direction: PageDirection.first,
      requestExactCount: true,
      clientRequestId: 'request-1',
    );
    expect(
      PagedRequest.fromJson(first.toJson()).direction,
      PageDirection.first,
    );
    final forward = PagedRequest(
      pageSize: 25,
      criteria: const <String, Object?>{'source': 'bitescore'},
      cursor: 'bsp1.opaque',
      direction: PageDirection.forward,
      clientRequestId: 'request-2',
    );
    expect(PagedRequest.fromJson(forward.toJson()).cursor, 'bsp1.opaque');
    expect(forward.toJson(), isNot(contains('offset')));
  });

  test(
    'request rejects wrong protocol, invalid direction, and cursor contradictions',
    () {
      expect(
        () => PagedRequest.fromJson(<String, Object?>{
          'protocolVersion': 'bitestar.page.v2',
          'pageSize': 50,
          'criteria': <String, Object?>{},
          'direction': 'first',
          'requestExactCount': false,
          'clientRequestId': 'x',
        }),
        throwsA(isA<PagedProtocolException>()),
      );
      expect(
        () => PagedRequest.fromJson(<String, Object?>{
          'protocolVersion': pageProtocolVersion,
          'pageSize': 50,
          'criteria': <String, Object?>{},
          'direction': 'sideways',
          'requestExactCount': false,
          'clientRequestId': 'x',
        }),
        throwsA(isA<PagedProtocolException>()),
      );
      expect(
        () => PagedRequest(
          pageSize: 50,
          criteria: const <String, Object?>{},
          direction: PageDirection.forward,
          clientRequestId: 'x',
        ),
        throwsA(isA<PagedProtocolException>()),
      );
      expect(
        () => PagedRequest(
          pageSize: 50,
          criteria: const <String, Object?>{},
          cursor: 'unexpected',
          direction: PageDirection.first,
          clientRequestId: 'x',
        ),
        throwsA(isA<PagedProtocolException>()),
      );
    },
  );

  test(
    'exact integer rules reject fractional, nonfinite, and unsafe values',
    () {
      for (final value in <Object?>[
        1.5,
        double.nan,
        double.infinity,
        9007199254740992,
      ]) {
        final raw = _response()..['pageSize'] = value;
        expect(
          () =>
              PagedResponse<Object?>.fromJson(raw, itemParser: (item) => item),
          throwsA(isA<PagedProtocolException>()),
          reason: '$value',
        );
      }
    },
  );

  test('exact and unknown totals parse while contradictory shapes fail', () {
    expect(
      PagedTotal.fromJson(<String, Object?>{
        'state': 'exact',
        'value': 0,
      }).exactValue,
      0,
    );
    expect(
      PagedTotal.fromJson(<String, Object?>{'state': 'unknown'}).state,
      PagedTotalState.unknown,
    );
    for (final total in <Object?>[
      <String, Object?>{'state': 'exact'},
      <String, Object?>{'state': 'exact', 'value': -1},
      <String, Object?>{'state': 'exact', 'value': 1.5},
      <String, Object?>{'state': 'unknown', 'value': 4},
    ]) {
      expect(
        () => PagedTotal.fromJson(total),
        throwsA(isA<PagedProtocolException>()),
      );
    }
  });

  test(
    'generic item parsing projects items and retains no raw response map',
    () {
      final raw = _response();
      final parsed = PagedResponse<String>.fromJson(
        raw,
        itemParser: (item) => (item! as Map<Object?, Object?>)['id']! as String,
      );
      expect(parsed.items, <String>['one']);
      expect(parsed.pageSize, 50);
      expect(parsed.pageNumber?.currentPageNumber, 1);
      expect(parsed.total?.exactValue, 51);
      expect(parsed.capabilities.next, isTrue);
      expect(parsed.nextCursor, 'opaque-next');
    },
  );

  test('cursor and capability contradictions are rejected', () {
    final missingNext = _response()..remove('nextCursor');
    final extraPrevious = _response()..['previousCursor'] = 'unexpected';
    final wrongCapability = _response();
    (wrongCapability['capabilities']! as Map<String, Object?>)['next'] = false;
    for (final raw in <Map<String, Object?>>[
      missingNext,
      extraPrevious,
      wrongCapability,
    ]) {
      expect(
        () => PagedResponse<Object?>.fromJson(raw, itemParser: (item) => item),
        throwsA(isA<PagedProtocolException>()),
      );
    }
  });

  test('Page X of Y exists only for exact totals', () {
    final page = PageNumberState(2);
    expect(page.totalPages(PagedTotal.exact(51), 50), 2);
    expect(page.totalPages(const PagedTotal.unknown(), 50), isNull);
    expect(page.totalPages(null, 50), isNull);
  });
}
