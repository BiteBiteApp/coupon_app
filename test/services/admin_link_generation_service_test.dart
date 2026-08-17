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
