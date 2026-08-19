import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/models/admin_restaurant_link_record.dart';
import 'package:coupon_app/services/admin_link_generation_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AdminLinkGenerationService request', () {
    test('keeps SC as the valid South Carolina location code', () {
      expect(
        AdminLinkGenerationService.locationValidationError('Charleston, SC'),
        isNull,
      );
      expect(
        AdminLinkGenerationService.normalizeLocation(' Charleston, sc '),
        'Charleston, SC',
      );
    });

    test('sends a normalized ZIP request with safe defaults', () async {
      Map<String, dynamic>? capturedPayload;
      final service = AdminLinkGenerationService(
        callable: (payload) async {
          capturedPayload = payload;
          return _response(results: const []);
        },
      );

      await service.search(
        locationQuery: ' 34428 ',
        radiusMiles: 10,
        sources: AdminRestaurantLinkSource.values.toSet(),
      );

      expect(capturedPayload, {
        'locationQuery': '34428',
        'radiusMiles': 10,
        'sources': ['biteScore', 'biteSaver'],
      });
      expect(capturedPayload, isNot(contains('resultLimit')));
      expect(capturedPayload, isNot(contains('candidateLimit')));
      expect(capturedPayload, isNot(contains('perBoundLimit')));
    });

    test('sends normalized City, ST, name, source, and radius', () async {
      Map<String, dynamic>? capturedPayload;
      final service = AdminLinkGenerationService(
        callable: (payload) async {
          capturedPayload = payload;
          return _response(results: const [], radiusMiles: 20);
        },
      );

      await service.search(
        locationQuery: ' Crystal   River , fl ',
        radiusMiles: 20,
        restaurantName: '  River   Grill ',
        sources: {AdminRestaurantLinkSource.biteSaver},
      );

      expect(capturedPayload, {
        'locationQuery': 'Crystal River, FL',
        'radiusMiles': 20,
        'restaurantName': 'River Grill',
        'sources': ['biteSaver'],
      });
      expect(capturedPayload, isNot(contains('resultLimit')));
    });

    test('sends BiteScore status only when explicitly requested', () async {
      for (final status in AdminBiteScoreStatus.values) {
        Map<String, dynamic>? capturedPayload;
        final service = AdminLinkGenerationService(
          callable: (payload) async {
            capturedPayload = payload;
            return _response(results: const []);
          },
        );

        await service.search(
          locationQuery: '34428',
          radiusMiles: 10,
          sources: {AdminRestaurantLinkSource.biteScore},
          biteScoreStatus: status,
        );

        expect(capturedPayload, {
          'locationQuery': '34428',
          'radiusMiles': 10,
          'sources': ['biteScore'],
          'biteScoreStatus': status.callableValue,
        });
        expect(capturedPayload, isNot(contains('resultLimit')));
        expect(capturedPayload, isNot(contains('candidateLimit')));
        expect(capturedPayload, isNot(contains('perBoundLimit')));
      }
    });

    test('rejects BiteScore status without the BiteScore source', () async {
      var calls = 0;
      final service = AdminLinkGenerationService(
        callable: (_) async {
          calls += 1;
          return _response(results: const []);
        },
      );

      await expectLater(
        service.search(
          locationQuery: '34428',
          radiusMiles: 10,
          sources: {AdminRestaurantLinkSource.biteSaver},
          biteScoreStatus: AdminBiteScoreStatus.all,
        ),
        throwsA(isA<AdminLinkGenerationException>()),
      );
      expect(calls, 0);
    });

    test('rejects invalid input before invoking the callable', () async {
      var calls = 0;
      final service = AdminLinkGenerationService(
        callable: (_) async {
          calls += 1;
          return _response(results: const []);
        },
      );

      await expectLater(
        service.search(
          locationQuery: 'Crystal River',
          radiusMiles: 10,
          sources: AdminRestaurantLinkSource.values.toSet(),
        ),
        throwsA(isA<AdminLinkGenerationException>()),
      );
      await expectLater(
        service.search(
          locationQuery: '34428',
          radiusMiles: 51,
          sources: AdminRestaurantLinkSource.values.toSet(),
        ),
        throwsA(isA<AdminLinkGenerationException>()),
      );
      await expectLater(
        service.search(
          locationQuery: '34428',
          radiusMiles: 10,
          sources: const {},
        ),
        throwsA(isA<AdminLinkGenerationException>()),
      );

      expect(calls, 0);
    });
  });

  group('Admin Link paged search', () {
    test(
      'uses the exact page protocol and carries resolved center forward',
      () async {
        final payloads = <Map<String, dynamic>>[];
        final service = AdminLinkGenerationService(
          pagedCallable: (payload) async {
            payloads.add(payload);
            return _pagedResponse(
              records: payloads.length == 1
                  ? [_biteScoreData(documentId: 'first')]
                  : [_biteScoreData(documentId: 'second')],
              hasNext: payloads.length == 1,
              nextCursor: payloads.length == 1 ? _pageCursor('cursor-1') : null,
            );
          },
        );

        final first = await service.searchPage(
          locationQuery: ' 34428 ',
          radiusMiles: 10,
          restaurantName: ' River   Grill ',
          sources: AdminRestaurantLinkSource.values.toSet(),
          searchInstanceId: 'search-1',
          clientRequestId: 'request-1',
        );
        final second = await service.searchPage(
          locationQuery: '34428',
          radiusMiles: 10,
          restaurantName: 'River Grill',
          sources: AdminRestaurantLinkSource.values.toSet(),
          searchInstanceId: 'search-1',
          clientRequestId: 'request-2',
          cursor: first.nextCursor,
          resolvedSearchCenter: first.searchCenter,
        );

        expect(payloads.first['protocolVersion'], 'bitestar.page.v1');
        expect(payloads.first['pageSize'], 50);
        expect(payloads.first['direction'], 'first');
        expect(payloads.first['requestExactCount'], isFalse);
        expect(payloads.first, isNot(contains('cursor')));
        final firstCriteria = payloads.first['criteria'] as Map;
        expect(firstCriteria['radiusMicromiles'], 10000000);
        expect(firstCriteria['restaurantName'], 'River Grill');
        expect(firstCriteria['sources'], ['biteScore', 'biteSaver']);
        expect(firstCriteria['futureFilters'], isEmpty);
        expect(firstCriteria, isNot(contains('resolvedCenter')));
        expect(payloads.last['direction'], 'forward');
        expect(payloads.last['cursor'], _pageCursor('cursor-1'));
        expect((payloads.last['criteria'] as Map)['resolvedCenter'], {
          'latitudeMicros': 28851700,
          'longitudeMicros': -82487000,
          'displayName': 'Crystal River, FL',
        });
        expect(second.page.items.single.documentId, 'second');
      },
    );

    test('accepts a preparing page with forward polling metadata', () async {
      final result = await _searchPagedResponse(
        _pagedResponse(
          preparationState: 'preparing',
          hasNext: true,
          nextCursor: _pageCursor('preparing-1'),
        ),
      );

      expect(result.isPreparing, isTrue);
      expect(result.page.items, isEmpty);
      expect(result.hasNext, isTrue);
      expect(result.nextCursor, _pageCursor('preparing-1'));
      expect(result.consumedBoundary, isNull);
      expect(result.page.preparation?.completedUnits, 1);
      expect(result.page.preparation?.totalUnits, 2);
    });

    test('accepts a ready page with visible materialized identities', () async {
      final result = await _searchPagedResponse(
        _pagedResponse(
          records: [
            _biteScoreData(documentId: 'visible-score'),
            _biteSaverData(documentId: 'visible-saver'),
          ],
        ),
      );

      expect(result.isReady, isTrue);
      expect(result.page.items.map((record) => record.documentId), [
        'visible-score',
        'visible-saver',
      ]);
      expect(
        result.page.items,
        everyElement(
          isA<AdminRestaurantLinkRecord>().having(
            (record) => record.materializedOrder,
            'materializedOrder',
            isNotNull,
          ),
        ),
      );
      expect(result.consumedBoundary?.sourceDocumentId, 'visible-saver');
      expect(result.hasNext, isFalse);
    });

    test(
      'accepts a final sparse ready page with a consumed boundary',
      () async {
        final response = _pagedResponse();
        response['consumedBoundary'] = _materializedBoundary(
          sourceDocumentId: 'last-consumed-but-filtered',
        );

        final result = await _searchPagedResponse(response);

        expect(result.isReady, isTrue);
        expect(result.page.items, isEmpty);
        expect(result.hasNext, isFalse);
        expect(
          result.consumedBoundary?.sourceDocumentId,
          'last-consumed-but-filtered',
        );
      },
    );

    test(
      'accepts a true zero-materialized ready page without a boundary',
      () async {
        final result = await _searchPagedResponse(_pagedResponse());

        expect(result.isReady, isTrue);
        expect(result.page.items, isEmpty);
        expect(result.hasNext, isFalse);
        expect(result.consumedBoundary, isNull);
      },
    );

    test('accepts a failed page only when it is terminal and empty', () async {
      final response = _pagedResponse(preparationState: 'failed');
      _setPagedNestedValue(
        response,
        'preparation',
        'message',
        'Preparation failed safely.',
      );

      final result = await _searchPagedResponse(response);

      expect(result.isFailed, isTrue);
      expect(result.page.items, isEmpty);
      expect(result.hasNext, isFalse);
      expect(result.nextCursor, isNull);
      expect(result.consumedBoundary, isNull);
      expect(result.preparationMessage, 'Preparation failed safely.');
    });

    test(
      'fails closed on invalid protocol, page metadata, capabilities, and cursors',
      () async {
        final invalidResponses = <MapEntry<String, Map<String, dynamic>>>[
          MapEntry(
            'protocol version',
            _changedPagedResponse(
              _pagedResponse(),
              (response) => response['protocolVersion'] = 'bitestar.page.v2',
            ),
          ),
          MapEntry(
            'unknown top-level field',
            _changedPagedResponse(
              _pagedResponse(),
              (response) => response['unexpected'] = true,
            ),
          ),
          MapEntry(
            'wrong dedicated page size',
            _changedPagedResponse(
              _pagedResponse(),
              (response) => response['pageSize'] = 49,
            ),
          ),
          MapEntry(
            'missing unknown total',
            _changedPagedResponse(
              _pagedResponse(),
              (response) => response.remove('total'),
            ),
          ),
          MapEntry(
            'exact total',
            _changedPagedResponse(
              _pagedResponse(),
              (response) => response['total'] = {'state': 'exact', 'value': 0},
            ),
          ),
          MapEntry(
            'numbered page metadata',
            _changedPagedResponse(
              _pagedResponse(),
              (response) => response['currentPageNumber'] = 1,
            ),
          ),
          MapEntry(
            'previous navigation',
            _changedPagedResponse(_pagedResponse(), (response) {
              response['hasPrevious'] = true;
              response['previousCursor'] = _pageCursor('previous-1');
              _setPagedNestedValue(response, 'capabilities', 'previous', true);
            }),
          ),
          MapEntry(
            'first capability',
            _changedPagedResponse(
              _pagedResponse(),
              (response) =>
                  _setPagedNestedValue(response, 'capabilities', 'first', true),
            ),
          ),
          MapEntry(
            'numbered capability',
            _changedPagedResponse(
              _pagedResponse(),
              (response) => _setPagedNestedValue(
                response,
                'capabilities',
                'numberedVisitedPages',
                true,
              ),
            ),
          ),
          MapEntry(
            'last capability',
            _changedPagedResponse(
              _pagedResponse(),
              (response) =>
                  _setPagedNestedValue(response, 'capabilities', 'last', true),
            ),
          ),
          MapEntry(
            'next capability mismatch',
            _changedPagedResponse(
              _emptyReadyContinuation(),
              (response) =>
                  _setPagedNestedValue(response, 'capabilities', 'next', false),
            ),
          ),
          MapEntry(
            'legacy cursor prefix',
            _emptyReadyContinuation(nextCursor: 'cursor-1'),
          ),
          MapEntry(
            'empty opaque cursor payload',
            _emptyReadyContinuation(nextCursor: 'bsp1.'),
          ),
          MapEntry(
            'undersized opaque cursor envelope',
            _emptyReadyContinuation(nextCursor: 'bsp1.a'),
          ),
          MapEntry(
            'noncanonical opaque cursor encoding',
            _emptyReadyContinuation(nextCursor: _nonCanonicalPageCursor()),
          ),
          MapEntry(
            'impossible opaque cursor encoding length',
            _emptyReadyContinuation(
              nextCursor: 'bsp1.${List.filled(41, 'A').join()}',
            ),
          ),
          MapEntry(
            'non-base64url cursor character',
            _emptyReadyContinuation(nextCursor: 'bsp1.with.dot'),
          ),
          MapEntry(
            'cursor while hasNext is false',
            _changedPagedResponse(
              _pagedResponse(),
              (response) => response['nextCursor'] = _pageCursor('unexpected'),
            ),
          ),
          MapEntry(
            'null cursor field',
            _changedPagedResponse(
              _pagedResponse(),
              (response) => response['nextCursor'] = null,
            ),
          ),
          MapEntry(
            'invalid search center',
            _changedPagedResponse(_pagedResponse(), (response) {
              _setPagedNestedValue(response, 'searchCenter', 'latitude', 91);
            }),
          ),
          MapEntry(
            'search center with an extra field',
            _changedPagedResponse(_pagedResponse(), (response) {
              _setPagedNestedValue(
                response,
                'searchCenter',
                'unexpected',
                true,
              );
            }),
          ),
          MapEntry(
            'oversized search center display name',
            _changedPagedResponse(_pagedResponse(), (response) {
              _setPagedNestedValue(
                response,
                'searchCenter',
                'displayName',
                List.filled(501, 'n').join(),
              );
            }),
          ),
          MapEntry(
            'missing search center',
            _changedPagedResponse(
              _pagedResponse(),
              (response) => response.remove('searchCenter'),
            ),
          ),
          MapEntry(
            'invalid radius',
            _changedPagedResponse(
              _pagedResponse(),
              (response) => response['radiusMiles'] = 51,
            ),
          ),
          MapEntry(
            'non-canonical source order',
            _changedPagedResponse(
              _pagedResponse(),
              (response) =>
                  response['queriedSources'] = ['biteSaver', 'biteScore'],
            ),
          ),
          MapEntry(
            'duplicate queried source',
            _changedPagedResponse(
              _pagedResponse(),
              (response) =>
                  response['queriedSources'] = ['biteScore', 'biteScore'],
            ),
          ),
          MapEntry(
            'unknown queried source',
            _changedPagedResponse(
              _pagedResponse(),
              (response) => response['queriedSources'] = ['unknown'],
            ),
          ),
          MapEntry(
            'malformed query fingerprint',
            _changedPagedResponse(
              _pagedResponse(),
              (response) => response['queryFingerprint'] = 'abc',
            ),
          ),
          MapEntry(
            'negative snapshot timestamp',
            _changedPagedResponse(
              _pagedResponse(),
              (response) => response['snapshotTimestampMs'] = -1,
            ),
          ),
        ];

        for (final invalid in invalidResponses) {
          await _expectInvalidPagedResponse(invalid.value, reason: invalid.key);
        }
      },
    );

    test('fails closed on impossible preparation-state combinations', () async {
      final preparingWithBoundary = _pagedResponse(
        preparationState: 'preparing',
        hasNext: true,
        nextCursor: _pageCursor('preparing-boundary'),
      );
      preparingWithBoundary['consumedBoundary'] = _materializedBoundary();

      final readyItemWithoutBoundary = _pagedResponse(
        records: [_biteScoreData(documentId: 'ready-visible')],
      )..remove('consumedBoundary');
      final readyContinuationWithoutBoundary = _pagedResponse(
        hasNext: true,
        nextCursor: _pageCursor('ready-next'),
      );

      final failedWithBoundary = _pagedResponse(preparationState: 'failed');
      failedWithBoundary['consumedBoundary'] = _materializedBoundary();

      final invalidResponses = <MapEntry<String, Map<String, dynamic>>>[
        MapEntry(
          'preparing with visible items',
          _pagedResponse(
            records: [_biteScoreData(documentId: 'preparing-visible')],
            preparationState: 'preparing',
            hasNext: true,
            nextCursor: _pageCursor('preparing-visible'),
          ),
        ),
        MapEntry(
          'preparing without continuation',
          _pagedResponse(preparationState: 'preparing'),
        ),
        MapEntry('preparing with boundary', preparingWithBoundary),
        MapEntry(
          'preparing at completion',
          _changedPagedResponse(
            _pagedResponse(
              preparationState: 'preparing',
              hasNext: true,
              nextCursor: _pageCursor('preparing-complete'),
            ),
            (response) => _setPagedNestedValue(
              response,
              'preparation',
              'completedUnits',
              2,
            ),
          ),
        ),
        MapEntry(
          'ready before completion',
          _changedPagedResponse(
            _pagedResponse(),
            (response) => _setPagedNestedValue(
              response,
              'preparation',
              'completedUnits',
              1,
            ),
          ),
        ),
        MapEntry('ready visible without boundary', readyItemWithoutBoundary),
        MapEntry(
          'ready continuation without boundary',
          readyContinuationWithoutBoundary,
        ),
        MapEntry(
          'failed with visible items',
          _pagedResponse(
            records: [_biteScoreData(documentId: 'failed-visible')],
            preparationState: 'failed',
          ),
        ),
        MapEntry(
          'failed with continuation',
          _pagedResponse(
            preparationState: 'failed',
            hasNext: true,
            nextCursor: _pageCursor('failed-next'),
          ),
        ),
        MapEntry('failed with boundary', failedWithBoundary),
        MapEntry(
          'failed at completed range count',
          _changedPagedResponse(
            _pagedResponse(preparationState: 'failed'),
            (response) => _setPagedNestedValue(
              response,
              'preparation',
              'completedUnits',
              2,
            ),
          ),
        ),
        MapEntry(
          'missing preparation total',
          _changedPagedResponse(
            _pagedResponse(),
            (response) =>
                _removePagedNestedValue(response, 'preparation', 'totalUnits'),
          ),
        ),
        MapEntry(
          'zero preparation total',
          _changedPagedResponse(_pagedResponse(), (response) {
            _setPagedNestedValue(response, 'preparation', 'completedUnits', 0);
            _setPagedNestedValue(response, 'preparation', 'totalUnits', 0);
          }),
        ),
      ];

      for (final invalid in invalidResponses) {
        await _expectInvalidPagedResponse(invalid.value, reason: invalid.key);
      }
    });

    test(
      'fails closed on malformed, mismatched, unordered, and unscoped tuples',
      () async {
        final missingOrder = _pagedResponse(
          records: [_biteScoreData(documentId: 'missing-order')],
        );
        _removeItemMaterializedOrder(missingOrder, 0);

        final malformedOrder = _pagedResponse(
          records: [_biteScoreData(documentId: 'malformed-order')],
        );
        _changeItemMaterializedOrder(
          malformedOrder,
          0,
          (order) => order['distanceMillimeters'] = -1,
        );

        final extraOrderKey = _pagedResponse(
          records: [_biteScoreData(documentId: 'extra-order-key')],
        );
        _changeItemMaterializedOrder(
          extraOrderKey,
          0,
          (order) => order['unexpected'] = true,
        );

        final mismatchedDocument = _pagedResponse(
          records: [_biteScoreData(documentId: 'actual-document')],
        );
        _changeItemMaterializedOrder(
          mismatchedDocument,
          0,
          (order) => order['sourceDocumentId'] = 'different-document',
        );

        final mismatchedSource = _pagedResponse(
          records: [_biteScoreData(documentId: 'source-mismatch')],
        );
        _changeItemMaterializedOrder(
          mismatchedSource,
          0,
          (order) => order['source'] = 'biteSaver',
        );

        final itemOutsideQueriedSources = _pagedResponse(
          records: [_biteSaverData(documentId: 'unqueried-item')],
        )..['queriedSources'] = ['biteScore'];

        final boundaryOutsideQueriedSources = _pagedResponse();
        boundaryOutsideQueriedSources['queriedSources'] = ['biteScore'];
        boundaryOutsideQueriedSources['consumedBoundary'] =
            _materializedBoundary(
              sourceDocumentId: 'unqueried-boundary',
              source: 'biteSaver',
            );

        final itemAfterBoundary = _pagedResponse(
          records: [_biteScoreData(documentId: 'after-boundary')],
        );
        final beforeItem = _firstItemMaterializedOrder(itemAfterBoundary);
        beforeItem['distanceMillimeters'] =
            (beforeItem['distanceMillimeters'] as int) - 1;
        itemAfterBoundary['consumedBoundary'] = beforeItem;

        final outOfOrder = _pagedResponse(
          records: [
            _biteScoreData(documentId: 'nearer'),
            _biteSaverData(documentId: 'farther'),
          ],
        );
        final reversedItems = List<Object?>.from(
          outOfOrder['items'] as List,
        ).reversed.toList(growable: false);
        outOfOrder['items'] = reversedItems;

        final duplicate = _biteScoreData(documentId: 'duplicate');
        final duplicateIdentity = _pagedResponse(
          records: [duplicate, duplicate],
        );

        final malformedBoundary = _pagedResponse();
        malformedBoundary['consumedBoundary'] = {
          ..._materializedBoundary(),
          'unexpected': true,
        };

        final invalidResponses = <MapEntry<String, Map<String, dynamic>>>[
          MapEntry('missing item order', missingOrder),
          MapEntry('malformed item order', malformedOrder),
          MapEntry('extra item order key', extraOrderKey),
          MapEntry('mismatched document identity', mismatchedDocument),
          MapEntry('mismatched source identity', mismatchedSource),
          MapEntry('item outside queried sources', itemOutsideQueriedSources),
          MapEntry(
            'boundary outside queried sources',
            boundaryOutsideQueriedSources,
          ),
          MapEntry('item after consumed boundary', itemAfterBoundary),
          MapEntry('non-increasing item order', outOfOrder),
          MapEntry('duplicate materialized identity', duplicateIdentity),
          MapEntry('malformed boundary', malformedBoundary),
        ];

        for (final invalid in invalidResponses) {
          await _expectInvalidPagedResponse(invalid.value, reason: invalid.key);
        }
      },
    );

    test('enforces the shared normalized-name tuple limit exactly', () async {
      final maximumName = List.filled(
        adminRestaurantMaterializedOrderNameMaximumLength,
        'n',
      ).join();
      expect(
        maximumName.length,
        adminRestaurantMaterializedOrderNameMaximumLength,
      );

      final maximumResponse = _pagedResponse(
        records: [_biteScoreData(documentId: 'maximum-name')],
      );
      _changeItemMaterializedOrder(
        maximumResponse,
        0,
        (order) => order['normalizedName'] = maximumName,
      );
      maximumResponse['consumedBoundary'] = _firstItemMaterializedOrder(
        maximumResponse,
      );

      final accepted = await _searchPagedResponse(maximumResponse);
      expect(
        accepted.page.items.single.materializedOrder?.normalizedName,
        maximumName,
      );

      final oversizedResponse = _pagedResponse(
        records: [_biteScoreData(documentId: 'oversized-name')],
      );
      _changeItemMaterializedOrder(
        oversizedResponse,
        0,
        (order) => order['normalizedName'] = '${maximumName}n',
      );
      oversizedResponse['consumedBoundary'] = _firstItemMaterializedOrder(
        oversizedResponse,
      );

      await _expectInvalidPagedResponse(oversizedResponse);
    });

    test('compares every field in the exact materialized tuple order', () {
      const orders = <AdminRestaurantMaterializedOrder>[
        AdminRestaurantMaterializedOrder(
          distanceMillimeters: 2,
          normalizedName: 'a',
          sourceDocumentId: 'a',
          source: AdminRestaurantLinkSource.biteSaver,
        ),
        AdminRestaurantMaterializedOrder(
          distanceMillimeters: 1,
          normalizedName: 'b',
          sourceDocumentId: 'a',
          source: AdminRestaurantLinkSource.biteSaver,
        ),
        AdminRestaurantMaterializedOrder(
          distanceMillimeters: 1,
          normalizedName: 'a',
          sourceDocumentId: 'b',
          source: AdminRestaurantLinkSource.biteSaver,
        ),
        AdminRestaurantMaterializedOrder(
          distanceMillimeters: 1,
          normalizedName: 'a',
          sourceDocumentId: 'a',
          source: AdminRestaurantLinkSource.biteScore,
        ),
        AdminRestaurantMaterializedOrder(
          distanceMillimeters: 1,
          normalizedName: 'a',
          sourceDocumentId: 'a',
          source: AdminRestaurantLinkSource.biteSaver,
        ),
      ];

      final sorted = [...orders]..sort();

      expect(
        sorted
            .map(
              (order) => (
                order.distanceMillimeters,
                order.normalizedName,
                order.sourceDocumentId,
                order.source.callableValue,
              ),
            )
            .toList(growable: false),
        const [
          (1, 'a', 'a', 'biteSaver'),
          (1, 'a', 'a', 'biteScore'),
          (1, 'a', 'b', 'biteSaver'),
          (1, 'b', 'a', 'biteSaver'),
          (2, 'a', 'a', 'biteSaver'),
        ],
      );
    });

    test('validates only canonical packed opaque cursor envelopes', () {
      final minimumPackedCursor = _pageCursorFromBytes(29);
      final canonicalSuffix = minimumPackedCursor.substring(
        adminRestaurantPageCursorPrefix.length,
      );
      final nonCanonicalTrailingBits =
          '${canonicalSuffix.substring(0, canonicalSuffix.length - 1)}B';

      expect(canonicalSuffix.length, 39);
      expect(base64Url.decode('$canonicalSuffix='), hasLength(29));
      expect(
        base64Url
            .encode(base64Url.decode('$canonicalSuffix='))
            .replaceAll('=', ''),
        canonicalSuffix,
      );
      expect(isValidAdminRestaurantPageCursor(minimumPackedCursor), isTrue);
      expect(isValidAdminRestaurantPageCursor('bsp1.a'), isFalse);
      expect(
        isValidAdminRestaurantPageCursor(_pageCursorFromBytes(28)),
        isFalse,
      );
      expect(
        isValidAdminRestaurantPageCursor('bsp1.${List.filled(41, 'A').join()}'),
        isFalse,
      );
      expect(
        isValidAdminRestaurantPageCursor(
          '$adminRestaurantPageCursorPrefix$nonCanonicalTrailingBits',
        ),
        isFalse,
      );
      expect(
        isValidAdminRestaurantPageCursor(
          '$minimumPackedCursor${List.filled(8192, 'A').join()}',
        ),
        isFalse,
      );
    });

    test(
      'rejects malformed page requests before invoking the callable',
      () async {
        var calls = 0;
        final service = AdminLinkGenerationService(
          pagedCallable: (_) async {
            calls += 1;
            return _pagedResponse();
          },
        );
        const center = AdminRestaurantSearchCenter(
          latitude: 28.8517,
          longitude: -82.487,
          displayName: 'Crystal River, FL',
        );

        Future<void> expectRejected({
          String locationQuery = '34428',
          int radiusMiles = 10,
          String? restaurantName,
          Set<AdminRestaurantLinkSource>? sources,
          AdminBiteScoreStatus biteScoreStatus = AdminBiteScoreStatus.active,
          String searchInstanceId = 'search-valid',
          String clientRequestId = 'request-valid',
          String? cursor,
          AdminRestaurantSearchCenter? resolvedSearchCenter,
        }) async {
          await expectLater(
            service.searchPage(
              locationQuery: locationQuery,
              radiusMiles: radiusMiles,
              restaurantName: restaurantName,
              sources: sources ?? AdminRestaurantLinkSource.values.toSet(),
              biteScoreStatus: biteScoreStatus,
              searchInstanceId: searchInstanceId,
              clientRequestId: clientRequestId,
              cursor: cursor,
              resolvedSearchCenter: resolvedSearchCenter,
            ),
            throwsA(isA<AdminLinkGenerationException>()),
          );
        }

        await expectRejected(locationQuery: 'Crystal River');
        await expectRejected(radiusMiles: 51);
        await expectRejected(sources: const {});
        await expectRejected(
          sources: {AdminRestaurantLinkSource.biteSaver},
          biteScoreStatus: AdminBiteScoreStatus.inactive,
        );
        await expectRejected(restaurantName: List.filled(101, 'n').join());
        await expectRejected(searchInstanceId: '');
        await expectRejected(searchInstanceId: 'search with spaces');
        await expectRejected(searchInstanceId: 'search/with/slashes');
        await expectRejected(searchInstanceId: List.filled(129, 's').join());
        await expectRejected(clientRequestId: '');
        await expectRejected(clientRequestId: ' request-leading-space');
        await expectRejected(clientRequestId: 'request-trailing-space ');
        await expectRejected(clientRequestId: List.filled(129, 'r').join());
        await expectRejected(cursor: _pageCursor('cursor-without-center'));
        await expectRejected(resolvedSearchCenter: center);
        for (final cursor in [
          'cursor-1',
          'bsp1.',
          'bsp1.a',
          'bsp1.with.dot',
          'bsp1.contains space',
          'bsp1.${List.filled(41, 'A').join()}',
          _nonCanonicalPageCursor(),
          _pageCursorFromBytes(28),
        ]) {
          await expectRejected(cursor: cursor, resolvedSearchCenter: center);
        }
        await expectRejected(
          cursor: 'bsp1.${List.filled(8190, 'a').join()}',
          resolvedSearchCenter: center,
        );
        await expectRejected(
          cursor: _pageCursor('invalid-center'),
          resolvedSearchCenter: const AdminRestaurantSearchCenter(
            latitude: 91,
            longitude: -82.487,
            displayName: 'Crystal River, FL',
          ),
        );
        await expectRejected(
          cursor: _pageCursor('padded-center'),
          resolvedSearchCenter: const AdminRestaurantSearchCenter(
            latitude: 28.8517,
            longitude: -82.487,
            displayName: ' Crystal River, FL',
          ),
        );

        expect(calls, 0);
      },
    );
  });

  group('Admin restaurant link response parsing', () {
    test(
      'parses valid preparation and fails closed on malformed projections',
      () async {
        final service = AdminLinkGenerationService(
          callable: (_) async => _response(
            results: [
              _biteScoreData(
                documentId: 'prepared-doc',
                extra: {
                  'preparation': {
                    'canonicalCatalogRestaurantId': 'prepared-doc',
                    'i': 'prepared',
                    'c': 'unprepared',
                    'sa': 'prepared',
                    'sr': 'unprepared',
                  },
                },
              ),
              _biteScoreData(
                documentId: 'malformed-doc',
                extra: {
                  'preparation': {
                    'canonicalCatalogRestaurantId': 'different-doc',
                    'i': 'prepared',
                    'c': 'unprepared',
                    'sa': 'prepared',
                    'sr': 'unprepared',
                  },
                },
              ),
              _biteSaverData(
                documentId: 'standalone-account',
                extra: {
                  'preparation': {
                    'canonicalCatalogRestaurantId': null,
                    'i': 'unavailable',
                    'c': 'unavailable',
                    'sa': 'unavailable',
                    'sr': 'unavailable',
                  },
                },
              ),
              _biteSaverData(
                documentId: 'unsafe-standalone-state',
                extra: {
                  'preparation': {
                    'canonicalCatalogRestaurantId': null,
                    'i': 'unavailable',
                    'c': 'unavailable',
                    'sa': 'prepared',
                    'sr': 'unavailable',
                  },
                },
              ),
            ],
          ),
        );

        final result = await service.search(
          locationQuery: '34428',
          radiusMiles: 10,
          sources: AdminRestaurantLinkSource.values.toSet(),
        );

        final prepared = result.results[0].preparation;
        expect(prepared.canonicalCatalogRestaurantId, 'prepared-doc');
        expect(prepared.ownerInvite, AdminRestaurantPreparationStatus.prepared);
        expect(
          prepared.claimInvite,
          AdminRestaurantPreparationStatus.unprepared,
        );
        expect(
          prepared.biteSaverCustomer,
          AdminRestaurantPreparationStatus.prepared,
        );
        expect(
          prepared.biteScoreCustomer,
          AdminRestaurantPreparationStatus.unprepared,
        );
        for (final record in result.results.skip(1)) {
          expect(
            AdminRestaurantPreparationType.values.map(
              record.preparation.statusFor,
            ),
            everyElement(AdminRestaurantPreparationStatus.unavailable),
          );
        }
      },
    );

    test('accepts every valid participation matrix', () {
      for (final binding in AdminBiteSaverCatalogBindingState.values) {
        for (final claimState in AdminRestaurantClaimState.values) {
          final ownerStatus = switch (binding) {
            AdminBiteSaverCatalogBindingState.unbound => 'prepared',
            AdminBiteSaverCatalogBindingState.bound => 'notRequired',
            AdminBiteSaverCatalogBindingState.unavailable => 'unavailable',
          };
          final claimStatus = switch (claimState) {
            AdminRestaurantClaimState.available => 'unprepared',
            AdminRestaurantClaimState.claimed => 'notRequired',
            AdminRestaurantClaimState.unavailable => 'unavailable',
          };

          final state = AdminRestaurantPreparationState.tryFromCallableData(
            {
              'canonicalCatalogRestaurantId': 'matrix-doc',
              'i': ownerStatus,
              'c': claimStatus,
              'sa': 'prepared',
              'sr': 'unprepared',
            },
            source: AdminRestaurantLinkSource.biteScore,
            documentId: 'matrix-doc',
            biteSaverCatalogBindingState: binding,
            claimState: claimState,
          );

          expect(
            state.canonicalCatalogRestaurantId,
            'matrix-doc',
            reason: '$binding / $claimState',
          );
        }
      }
    });

    test('rejects impossible and mixed-unavailable status combinations', () {
      final invalidProjections = <Map<String, Object?>>[
        {
          'canonicalCatalogRestaurantId': ' matrix-doc',
          'i': 'prepared',
          'c': 'unprepared',
          'sa': 'prepared',
          'sr': 'unprepared',
        },
        {
          'canonicalCatalogRestaurantId': 'matrix-doc',
          'i': 'notRequired',
          'c': 'unprepared',
          'sa': 'prepared',
          'sr': 'unprepared',
        },
        {
          'canonicalCatalogRestaurantId': 'matrix-doc',
          'i': 'prepared',
          'c': 'notRequired',
          'sa': 'prepared',
          'sr': 'unprepared',
        },
        {
          'canonicalCatalogRestaurantId': 'matrix-doc',
          'i': 'prepared',
          'c': 'unprepared',
          'sa': 'notRequired',
          'sr': 'unprepared',
        },
        {
          'canonicalCatalogRestaurantId': 'matrix-doc',
          'i': 'prepared',
          'c': 'unprepared',
          'sa': 'prepared',
          'sr': 'unavailable',
        },
        {
          'canonicalCatalogRestaurantId': 'matrix-doc',
          'i': 'unavailable',
          'c': 'unavailable',
          'sa': 'unavailable',
          'sr': 'unavailable',
        },
      ];

      for (final projection in invalidProjections) {
        final state = AdminRestaurantPreparationState.tryFromCallableData(
          projection,
          source: AdminRestaurantLinkSource.biteScore,
          documentId: 'matrix-doc',
          biteSaverCatalogBindingState:
              AdminBiteSaverCatalogBindingState.unbound,
          claimState: AdminRestaurantClaimState.available,
        );
        expect(state.canonicalCatalogRestaurantId, isNull);
        expect(
          AdminRestaurantPreparationType.values.map(state.statusFor),
          everyElement(AdminRestaurantPreparationStatus.unavailable),
        );
      }
    });

    test(
      'rejects aliased Firestore identities without trimming display text',
      () async {
        final invalidIds = <String>[
          ' restaurant-id',
          'restaurant-id ',
          '',
          '   ',
          'restaurant/id',
          '.',
          '..',
        ];
        final service = AdminLinkGenerationService(
          callable: (_) async => _response(
            results: [
              for (final id in invalidIds) _biteScoreData(documentId: id),
              _biteScoreData(
                documentId: 'valid-id',
                extra: {
                  'restaurantName': '  Display Name  ',
                  'streetAddress': '  1 Main Street  ',
                },
              ),
            ],
          ),
        );

        final result = await service.search(
          locationQuery: '34428',
          radiusMiles: 10,
          sources: {AdminRestaurantLinkSource.biteScore},
        );

        expect(result.results, hasLength(1));
        expect(result.results.single.documentId, 'valid-id');
        expect(result.results.single.restaurantName, 'Display Name');
        expect(result.results.single.streetAddress, '1 Main Street');
      },
    );

    test(
      'preserves metadata, actual IDs, action IDs, and source status',
      () async {
        final service = AdminLinkGenerationService(
          callable: (_) async => _response(
            results: [
              _biteScoreData(
                documentId: 'actual-bitescore-doc',
                extra: {
                  'id': 'stored-compatibility-id',
                  'isClaimed': true,
                  'ownerUserId': 'owner-1',
                  'linkedBiteSaverUid': 'account-1',
                },
              ),
              _biteSaverData(
                documentId: 'account-doc',
                actionId: 'canonical-account-uid',
                extra: {
                  'approvalStatus': 'approved',
                  'couponApplicationSubmitted': true,
                  'uid': 'canonical-account-uid',
                  'linkedBiteScoreRestaurantId': 'actual-bitescore-doc',
                },
              ),
            ],
            truncated: true,
            returnedCount: 2,
          ),
        );

        final result = await service.search(
          locationQuery: '34428',
          radiusMiles: 10,
          sources: AdminRestaurantLinkSource.values.toSet(),
        );

        expect(result.searchCenter.displayName, 'Crystal River, FL');
        expect(result.searchCenter.latitude, 28.8517);
        expect(result.radiusMiles, 10);
        expect(result.resultsMayBeTruncated, isTrue);
        expect(result.returnedCount, 2);
        expect(result.queriedSources, AdminRestaurantLinkSource.values);

        final biteScore = result.results.first;
        expect(biteScore.documentId, 'actual-bitescore-doc');
        expect(biteScore.actionId, 'actual-bitescore-doc');
        expect(biteScore.isClaimed, isTrue);
        expect(biteScore.claimState, AdminRestaurantClaimState.claimed);
        expect(
          biteScore.biteSaverCatalogBindingState,
          AdminBiteSaverCatalogBindingState.unbound,
        );
        expect(biteScore.ownerUserId, 'owner-1');
        expect(biteScore.linkedBiteSaverUid, 'account-1');

        final biteSaver = result.results.last;
        expect(biteSaver.documentId, 'account-doc');
        expect(biteSaver.actionId, 'canonical-account-uid');
        expect(biteSaver.uid, 'canonical-account-uid');
        expect(biteSaver.approvalStatus, 'approved');
        expect(biteSaver.couponApplicationSubmitted, isTrue);
        expect(biteSaver.linkedBiteScoreRestaurantId, 'actual-bitescore-doc');
        expect(biteSaver.canCopyCouponCustomerLink, isTrue);
      },
    );

    test('safely skips malformed result entries', () async {
      final service = AdminLinkGenerationService(
        callable: (_) async => _response(
          results: [
            _biteScoreData(documentId: 'valid-doc'),
            {'source': 'biteScore', 'documentId': 'missing-fields'},
            _biteSaverData(
              documentId: 'bad-coordinates',
              extra: {'latitude': 'not-a-number'},
            ),
            'not-a-map',
          ],
          returnedCount: 4,
        ),
      );

      final result = await service.search(
        locationQuery: '34428',
        radiusMiles: 10,
        sources: AdminRestaurantLinkSource.values.toSet(),
      );

      expect(result.results, hasLength(1));
      expect(result.results.single.documentId, 'valid-doc');
      expect(result.returnedCount, 4);
    });

    test('BiteScore records ignore injected BiteSaver-only fields', () async {
      final service = AdminLinkGenerationService(
        callable: (_) async => _response(
          results: [
            _biteScoreData(
              documentId: 'actual-bitescore-document',
              extra: {
                'id': 'stored-compatibility-id',
                'isClaimed': true,
                'ownerUserId': 'score-owner',
                'linkedBiteSaverUid': 'linked-saver-account',
                'approvalStatus': 'approved',
                'couponApplicationSubmitted': true,
                'uid': 'injected-saver-uid',
                'linkedBiteScoreRestaurantId': 'injected-score-link',
              },
            ),
          ],
        ),
      );

      final result = await service.search(
        locationQuery: '34428',
        radiusMiles: 10,
        sources: {AdminRestaurantLinkSource.biteScore},
      );
      final record = result.results.single;

      expect(record.source, AdminRestaurantLinkSource.biteScore);
      expect(record.documentId, 'actual-bitescore-document');
      expect(record.actionId, 'actual-bitescore-document');
      expect(record.restaurantName, 'River Grill');
      expect(record.isActive, isTrue);
      expect(record.isClaimed, isTrue);
      expect(record.claimState, AdminRestaurantClaimState.claimed);
      expect(record.canCreateBiteScoreClaimInvite, isFalse);
      expect(record.canCreateBiteSaverOwnerInvite, isTrue);
      expect(record.ownerUserId, 'score-owner');
      expect(record.linkedBiteSaverUid, 'linked-saver-account');
      expect(record.approvalStatus, isNull);
      expect(record.couponApplicationSubmitted, isNull);
      expect(record.uid, isNull);
      expect(record.linkedBiteScoreRestaurantId, isNull);
    });

    test(
      'parses inactive BiteScore status without changing document ID',
      () async {
        final service = AdminLinkGenerationService(
          callable: (_) async => _response(
            results: [
              _biteScoreData(
                documentId: 'actual-hidden-document',
                extra: {'isActive': false},
              ),
            ],
          ),
        );

        final result = await service.search(
          locationQuery: '34428',
          radiusMiles: 10,
          sources: {AdminRestaurantLinkSource.biteScore},
          biteScoreStatus: AdminBiteScoreStatus.inactive,
        );

        expect(result.results.single.documentId, 'actual-hidden-document');
        expect(result.results.single.actionId, 'actual-hidden-document');
        expect(result.results.single.isActive, isFalse);
      },
    );

    test('parses only the closed BiteSaver catalog binding states', () async {
      final service = AdminLinkGenerationService(
        callable: (_) async => _response(
          results: [
            for (final state in AdminBiteSaverCatalogBindingState.values)
              _biteScoreData(
                documentId: 'catalog-${state.callableValue}',
                extra: {'biteSaverCatalogBindingState': state.callableValue},
              ),
            _biteScoreData(
              documentId: 'catalog-invalid',
              extra: const {'biteSaverCatalogBindingState': 'repairable'},
            ),
            {..._biteScoreData(documentId: 'catalog-missing')}
              ..remove('biteSaverCatalogBindingState'),
          ],
          returnedCount: 5,
        ),
      );

      final result = await service.search(
        locationQuery: '34428',
        radiusMiles: 10,
        sources: {AdminRestaurantLinkSource.biteScore},
      );

      expect(result.results, hasLength(3));
      expect(
        result.results.map((record) => record.biteSaverCatalogBindingState),
        AdminBiteSaverCatalogBindingState.values,
      );
      expect(
        result.results
            .where(
              (record) =>
                  record.biteSaverCatalogBindingState ==
                  AdminBiteSaverCatalogBindingState.unbound,
            )
            .single
            .canCreateBiteSaverOwnerInvite,
        isTrue,
      );
      expect(
        result.results
            .where(
              (record) =>
                  record.biteSaverCatalogBindingState !=
                  AdminBiteSaverCatalogBindingState.unbound,
            )
            .every((record) => !record.canCreateBiteSaverOwnerInvite),
        isTrue,
      );
    });

    test('BiteSaver records ignore injected BiteScore-only fields', () async {
      final service = AdminLinkGenerationService(
        callable: (_) async => _response(
          results: [
            _biteSaverData(
              documentId: 'bitesaver-document',
              actionId: 'canonical-saver-uid',
              extra: {
                'approvalStatus': 'approved',
                'couponApplicationSubmitted': true,
                'linkedBiteScoreRestaurantId': 'linked-score-document',
                'isActive': true,
                'isClaimed': true,
                'ownerUserId': 'injected-score-owner',
                'linkedBiteSaverUid': 'injected-saver-link',
              },
            ),
          ],
        ),
      );

      final result = await service.search(
        locationQuery: '34428',
        radiusMiles: 10,
        sources: {AdminRestaurantLinkSource.biteSaver},
      );
      final record = result.results.single;

      expect(record.source, AdminRestaurantLinkSource.biteSaver);
      expect(record.documentId, 'bitesaver-document');
      expect(record.actionId, 'canonical-saver-uid');
      expect(record.restaurantName, 'River Grill');
      expect(record.approvalStatus, 'approved');
      expect(record.couponApplicationSubmitted, isTrue);
      expect(record.uid, 'canonical-saver-uid');
      expect(record.linkedBiteScoreRestaurantId, 'linked-score-document');
      expect(record.isActive, isNull);
      expect(record.isClaimed, isNull);
      expect(record.ownerUserId, isNull);
      expect(record.linkedBiteSaverUid, isNull);
    });

    test(
      'converts callable and malformed-response failures to safe errors',
      () async {
        final failingService = AdminLinkGenerationService(
          callable: (_) async => throw StateError('raw provider payload'),
        );
        final malformedService = AdminLinkGenerationService(
          callable: (_) async => {'results': []},
        );

        await expectLater(
          failingService.search(
            locationQuery: '34428',
            radiusMiles: 10,
            sources: AdminRestaurantLinkSource.values.toSet(),
          ),
          throwsA(
            isA<AdminLinkGenerationException>().having(
              (error) => error.message,
              'message',
              isNot(contains('raw provider payload')),
            ),
          ),
        );
        await expectLater(
          malformedService.search(
            locationQuery: '34428',
            radiusMiles: 10,
            sources: AdminRestaurantLinkSource.values.toSet(),
          ),
          throwsA(
            isA<AdminLinkGenerationException>().having(
              (error) => error.message,
              'message',
              contains('invalid response'),
            ),
          ),
        );
      },
    );
  });

  group('Admin preparation mutation', () {
    test('sends the exact catalog type and invitation identity', () async {
      Map<String, dynamic>? capturedPayload;
      final service = AdminLinkGenerationService(
        preparationCallable: (payload) async {
          capturedPayload = payload;
          return {
            'preparation': {
              'canonicalCatalogRestaurantId': 'catalog-doc',
              'i': 'prepared',
              'c': 'unprepared',
              'sa': 'unprepared',
              'sr': 'unprepared',
            },
          };
        },
      );

      final state = await service.updatePreparation(
        catalogRestaurantId: 'catalog-doc',
        type: AdminRestaurantPreparationType.ownerInvite,
        prepared: true,
        expectedInviteId: 'invite-7',
        biteSaverCatalogBindingState: AdminBiteSaverCatalogBindingState.unbound,
        claimState: AdminRestaurantClaimState.available,
      );

      expect(capturedPayload, {
        'catalogRestaurantId': 'catalog-doc',
        'type': 'I',
        'prepared': true,
        'expectedInviteId': 'invite-7',
      });
      expect(state.ownerInvite, AdminRestaurantPreparationStatus.prepared);
    });

    test('rejects invalid identities before invoking the callable', () async {
      var calls = 0;
      final service = AdminLinkGenerationService(
        preparationCallable: (_) async {
          calls += 1;
          return const <String, Object?>{};
        },
      );
      final invalidIds = <String>[
        ' restaurant-id',
        'restaurant-id ',
        '',
        '   ',
        'restaurant/id',
      ];

      for (final invalidId in invalidIds) {
        await expectLater(
          service.updatePreparation(
            catalogRestaurantId: invalidId,
            type: AdminRestaurantPreparationType.ownerInvite,
            prepared: true,
            expectedInviteId: 'invite-id',
            biteSaverCatalogBindingState:
                AdminBiteSaverCatalogBindingState.unbound,
            claimState: AdminRestaurantClaimState.available,
          ),
          throwsA(isA<AdminLinkGenerationException>()),
        );
        await expectLater(
          service.updatePreparation(
            catalogRestaurantId: 'catalog-doc',
            type: AdminRestaurantPreparationType.ownerInvite,
            prepared: true,
            expectedInviteId: invalidId,
            biteSaverCatalogBindingState:
                AdminBiteSaverCatalogBindingState.unbound,
            claimState: AdminRestaurantClaimState.available,
          ),
          throwsA(isA<AdminLinkGenerationException>()),
        );
      }
      expect(calls, 0);
    });

    test(
      'rejects malformed and semantically impossible responses safely',
      () async {
        var calls = 0;
        final service = AdminLinkGenerationService(
          preparationCallable: (_) async {
            calls += 1;
            return {
              'preparation': {
                'canonicalCatalogRestaurantId': 'catalog-doc',
                'i': 'notRequired',
                'c': 'unprepared',
                'sa': 'unprepared',
                'sr': 'unprepared',
              },
            };
          },
        );

        await expectLater(
          service.updatePreparation(
            catalogRestaurantId: 'catalog-doc',
            type: AdminRestaurantPreparationType.claimInvite,
            prepared: true,
            biteSaverCatalogBindingState:
                AdminBiteSaverCatalogBindingState.unbound,
            claimState: AdminRestaurantClaimState.available,
          ),
          throwsA(isA<AdminLinkGenerationException>()),
        );
        expect(calls, 1);
      },
    );
  });

  test('service uses the callable and contains no direct Firestore access', () {
    final source = File(
      'lib/services/admin_link_generation_service.dart',
    ).readAsStringSync();

    expect(source, contains("region: 'us-central1'"));
    expect(source, contains("httpsCallable('searchAdminRestaurants')"));
    expect(source, contains("'searchAdminLinkRestaurantsPage'"));
    expect(source, isNot(contains('cloud_firestore')));
    expect(source, isNot(contains("collection('restaurant_accounts')")));
    expect(source, isNot(contains("collection('bitescore_restaurants')")));
  });
}

Future<AdminRestaurantLinkPagedResult> _searchPagedResponse(Object? response) {
  final service = AdminLinkGenerationService(
    pagedCallable: (_) async => response,
  );
  return service.searchPage(
    locationQuery: '34428',
    radiusMiles: 10,
    sources: AdminRestaurantLinkSource.values.toSet(),
    searchInstanceId: 'search-contract',
    clientRequestId: 'request-contract',
  );
}

Future<void> _expectInvalidPagedResponse(
  Object? response, {
  String? reason,
}) async {
  await expectLater(
    _searchPagedResponse(response),
    throwsA(
      isA<AdminLinkGenerationException>().having(
        (error) => error.message,
        'message',
        contains('invalid page'),
      ),
    ),
    reason: reason,
  );
}

Map<String, dynamic> _changedPagedResponse(
  Map<String, dynamic> response,
  void Function(Map<String, dynamic> response) change,
) {
  change(response);
  return response;
}

void _setPagedNestedValue(
  Map<String, dynamic> response,
  String field,
  String nestedField,
  Object? value,
) {
  final nested = Map<String, dynamic>.from(response[field] as Map);
  nested[nestedField] = value;
  response[field] = nested;
}

void _removePagedNestedValue(
  Map<String, dynamic> response,
  String field,
  String nestedField,
) {
  final nested = Map<String, dynamic>.from(response[field] as Map);
  nested.remove(nestedField);
  response[field] = nested;
}

Map<String, dynamic> _emptyReadyContinuation({String? nextCursor}) {
  final response = _pagedResponse(
    hasNext: true,
    nextCursor: nextCursor ?? _pageCursor('next-1'),
  );
  response['consumedBoundary'] = _materializedBoundary();
  return response;
}

String _pageCursor(String label) {
  return '$adminRestaurantPageCursorPrefix${base64Url.encode(utf8.encode('admin-link-packed-cursor-envelope:$label')).replaceAll('=', '')}';
}

String _pageCursorFromBytes(int length) {
  return '$adminRestaurantPageCursorPrefix${base64Url.encode(List<int>.filled(length, 0)).replaceAll('=', '')}';
}

String _nonCanonicalPageCursor() {
  final canonical = _pageCursorFromBytes(29);
  return '${canonical.substring(0, canonical.length - 1)}B';
}

Map<String, Object?> _materializedBoundary({
  int distanceMillimeters = 1,
  String normalizedName = 'boundary',
  String sourceDocumentId = 'boundary-document',
  String source = 'biteScore',
}) {
  return {
    'distanceMillimeters': distanceMillimeters,
    'normalizedName': normalizedName,
    'sourceDocumentId': sourceDocumentId,
    'source': source,
  };
}

void _removeItemMaterializedOrder(Map<String, dynamic> response, int index) {
  final items = List<Object?>.from(response['items'] as List);
  final item = Map<String, dynamic>.from(items[index] as Map);
  item.remove('materializedOrder');
  items[index] = item;
  response['items'] = items;
}

void _changeItemMaterializedOrder(
  Map<String, dynamic> response,
  int index,
  void Function(Map<String, dynamic> order) change,
) {
  final items = List<Object?>.from(response['items'] as List);
  final item = Map<String, dynamic>.from(items[index] as Map);
  final order = Map<String, dynamic>.from(item['materializedOrder'] as Map);
  change(order);
  item['materializedOrder'] = order;
  items[index] = item;
  response['items'] = items;
}

Map<String, dynamic> _firstItemMaterializedOrder(
  Map<String, dynamic> response,
) {
  final item = (response['items'] as List).first as Map;
  return Map<String, dynamic>.from(item['materializedOrder'] as Map);
}

Map<String, dynamic> _pagedResponse({
  List<Object?> records = const [],
  bool hasNext = false,
  String? nextCursor,
  String preparationState = 'ready',
}) {
  final items = records
      .map((rawRecord) {
        if (rawRecord is! Map) {
          return rawRecord;
        }
        final record = Map<String, dynamic>.from(rawRecord);
        record['materializedOrder'] ??= _materializedOrderForRecord(record);
        return record;
      })
      .toList(growable: false);
  final consumedBoundary = preparationState == 'ready' && items.isNotEmpty
      ? (items.last as Map<String, dynamic>)['materializedOrder']
      : null;
  return {
    'protocolVersion': 'bitestar.page.v1',
    'items': items,
    'pageSize': 50,
    'hasNext': hasNext,
    'hasPrevious': false,
    'nextCursor': ?nextCursor,
    'total': {'state': 'unknown'},
    'queryFingerprint': List.filled(64, 'a').join(),
    'snapshotTimestampMs': 1,
    'capabilities': {
      'first': false,
      'previous': false,
      'numberedVisitedPages': false,
      'next': hasNext,
      'last': false,
    },
    'preparation': {
      'state': preparationState,
      'completedUnits': preparationState == 'ready' ? 2 : 1,
      'totalUnits': 2,
    },
    'searchCenter': {
      'latitude': 28.8517,
      'longitude': -82.487,
      'displayName': 'Crystal River, FL',
    },
    'radiusMiles': 10,
    'queriedSources': ['biteScore', 'biteSaver'],
    'consumedBoundary': ?consumedBoundary,
  };
}

Map<String, Object?> _materializedOrderForRecord(Map<String, dynamic> record) {
  final name = record['restaurantName'] as String;
  return {
    'distanceMillimeters': ((record['distanceMiles'] as num) * 1609344).round(),
    'normalizedName': name.trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase(),
    'sourceDocumentId': record['documentId'],
    'source': record['source'],
  };
}

Map<String, dynamic> _response({
  required List<Object?> results,
  double radiusMiles = 10,
  bool truncated = false,
  int? returnedCount,
}) {
  return {
    'searchCenter': {
      'latitude': 28.8517,
      'longitude': -82.487,
      'displayName': 'Crystal River, FL',
    },
    'radiusMiles': radiusMiles,
    'results': results,
    'resultsMayBeTruncated': truncated,
    'returnedCount': returnedCount ?? results.length,
    'queriedSources': ['biteScore', 'biteSaver'],
  };
}

Map<String, dynamic> _biteScoreData({
  required String documentId,
  Map<String, dynamic> extra = const {},
}) {
  final isActive = extra.containsKey('isActive') ? extra['isActive'] : true;
  final isClaimed = extra.containsKey('isClaimed') ? extra['isClaimed'] : false;
  final hasOwnerUserId = extra.containsKey('ownerUserId');
  final ownerUserId = extra['ownerUserId'];
  final strictlyUnclaimed =
      isClaimed == false &&
      (!hasOwnerUserId || ownerUserId == null || ownerUserId == '');
  final validlyClaimed =
      isClaimed == true &&
      ownerUserId is String &&
      ownerUserId.trim().isNotEmpty;
  final activityValid = isActive == true;
  return {
    'source': 'biteScore',
    'documentId': documentId,
    'actionId': documentId,
    'restaurantName': 'River Grill',
    'streetAddress': '1 Main Street',
    'city': 'Crystal River',
    'state': 'FL',
    'zipCode': '34428',
    'phone': '555-0100',
    'website': 'https://example.com',
    'latitude': 28.8517,
    'longitude': -82.487,
    'distanceMiles': 1.25,
    'isActive': true,
    'isClaimed': false,
    'claimAvailable': activityValid && strictlyUnclaimed,
    'claimStateValid': activityValid && (strictlyUnclaimed || validlyClaimed),
    'biteSaverCatalogBindingState': 'unbound',
    ...extra,
  };
}

Map<String, dynamic> _biteSaverData({
  required String documentId,
  String? actionId,
  Map<String, dynamic> extra = const {},
}) {
  return {
    'source': 'biteSaver',
    'documentId': documentId,
    'actionId': actionId ?? documentId,
    'restaurantName': 'River Grill',
    'streetAddress': '1 Main Street',
    'city': 'Crystal River',
    'state': 'FL',
    'zipCode': '34428',
    'phone': '555-0100',
    'website': 'https://example.com',
    'latitude': 28.8517,
    'longitude': -82.487,
    'distanceMiles': 1.5,
    'approvalStatus': 'pending',
    'couponApplicationSubmitted': false,
    'uid': actionId ?? documentId,
    ...extra,
  };
}
