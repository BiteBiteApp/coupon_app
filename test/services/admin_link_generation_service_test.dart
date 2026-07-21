import 'dart:io';

import 'package:coupon_app/models/admin_restaurant_link_record.dart';
import 'package:coupon_app/services/admin_link_generation_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AdminLinkGenerationService request', () {
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

  group('Admin restaurant link response parsing', () {
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
      expect(record.isClaimed, isFalse);
      expect(record.ownerUserId, 'score-owner');
      expect(record.linkedBiteSaverUid, 'linked-saver-account');
      expect(record.approvalStatus, isNull);
      expect(record.couponApplicationSubmitted, isNull);
      expect(record.uid, isNull);
      expect(record.linkedBiteScoreRestaurantId, isNull);
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

  test('service uses the callable and contains no direct Firestore access', () {
    final source = File(
      'lib/services/admin_link_generation_service.dart',
    ).readAsStringSync();

    expect(source, contains("region: 'us-central1'"));
    expect(source, contains("httpsCallable('searchAdminRestaurants')"));
    expect(source, isNot(contains('cloud_firestore')));
    expect(source, isNot(contains("collection('restaurant_accounts')")));
    expect(source, isNot(contains("collection('bitescore_restaurants')")));
  });
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
