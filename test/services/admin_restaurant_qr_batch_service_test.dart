import 'package:coupon_app/models/admin_restaurant_qr_batch.dart';
import 'package:coupon_app/services/admin_restaurant_qr_batch_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('sequential preparation orchestration', () {
    for (final restaurantCount in <int>[1, 25, 26, 50, 200, 250, 400]) {
      test(
        '$restaurantCount IDs use ordered sequential chunks of 25',
        () async {
          final calls = <List<String>>[];
          var activeCalls = 0;
          var maximumActiveCalls = 0;
          final service = AdminRestaurantQrBatchService(
            functionsBoundary: (callableName, request) async {
              expect(
                callableName,
                AdminRestaurantQrBatchService.preparationCallableName,
              );
              expect(request.keys, <String>[
                'schemaVersion',
                'catalogRestaurantIds',
              ]);
              expect(request['schemaVersion'], 1);
              final ids = (request['catalogRestaurantIds']! as List<Object?>)
                  .cast<String>();
              calls.add(ids);
              activeCalls += 1;
              maximumActiveCalls = activeCalls > maximumActiveCalls
                  ? activeCalls
                  : maximumActiveCalls;
              await Future<void>.delayed(Duration.zero);
              activeCalls -= 1;
              return _preparationResponse(ids);
            },
          );
          final ids = List<String>.generate(
            restaurantCount,
            (index) => 'restaurant-${index.toString().padLeft(3, '0')}',
          );
          final progress = <int>[];

          final result = await service.prepareRestaurants(
            ids,
            onProgress: (value) {
              expect(value.totalRestaurantCount, restaurantCount);
              progress.add(value.confirmedRestaurantCount);
            },
          );

          expect(maximumActiveCalls, 1);
          expect(calls.length, (restaurantCount + 24) ~/ 25);
          expect(calls.every((chunk) => chunk.length <= 25), isTrue);
          expect(calls.expand((chunk) => chunk), ids);
          expect(result.requestedCatalogRestaurantIds, ids);
          expect(
            result.readyRestaurants.map(
              (restaurant) => restaurant.catalogRestaurantId,
            ),
            ids,
          );
          expect(result.isComplete, isTrue);
          expect(result.wasInterrupted, isFalse);
          expect(progress.last, restaurantCount);
        },
      );
    }

    test('validates the full identity list before making any call', () async {
      var calls = 0;
      final service = AdminRestaurantQrBatchService(
        functionsBoundary: (_, _) async {
          calls += 1;
          return null;
        },
      );

      await expectLater(
        service.prepareRestaurants(<String>['restaurant-a', 'restaurant-a']),
        throwsA(
          isA<AdminRestaurantQrBatchServiceException>().having(
            (error) => error.kind,
            'kind',
            AdminRestaurantQrBatchFailureKind.invalidRequest,
          ),
        ),
      );
      await expectLater(
        service.prepareRestaurants(<String>['restaurant-a', ' restaurant-b']),
        throwsA(isA<AdminRestaurantQrBatchServiceException>()),
      );
      expect(calls, 0);
    });

    test(
      'does not retry an ambiguous later chunk and preserves earlier ready results',
      () async {
        var calls = 0;
        final requests = <List<String>>[];
        final service = AdminRestaurantQrBatchService(
          functionsBoundary: (_, request) async {
            calls += 1;
            final ids = (request['catalogRestaurantIds']! as List<Object?>)
                .cast<String>();
            requests.add(ids);
            if (calls == 2) throw StateError('synthetic lost response');
            return _preparationResponse(ids);
          },
        );
        final ids = List<String>.generate(30, (index) => 'restaurant-$index');

        final firstAttempt = await service.prepareRestaurants(ids);

        expect(calls, 2);
        expect(firstAttempt.readyRestaurants.length, 25);
        expect(firstAttempt.problems.length, 5);
        expect(firstAttempt.wasInterrupted, isTrue);
        expect(firstAttempt.canRetryPreparation, isTrue);
        expect(firstAttempt.interruption!.code, 'preparation_unavailable');
        expect(firstAttempt.retryCatalogRestaurantIds, ids.skip(25));
        expect(
          firstAttempt.problems.map((problem) => problem.catalogRestaurantId),
          ids.skip(25),
        );

        final merged = await service.retryPreparation(firstAttempt);

        expect(calls, 3);
        expect(requests.last, ids.skip(25));
        expect(merged.readyRestaurants.length, 30);
        expect(merged.isComplete, isTrue);
        expect(merged.wasInterrupted, isFalse);
      },
    );

    test('turns a malformed chunk into complete controlled problems', () async {
      final service = AdminRestaurantQrBatchService(
        functionsBoundary: (_, request) async {
          final ids = request['catalogRestaurantIds']! as List<Object?>;
          if (ids.first == 'restaurant-0') {
            return _preparationResponse(ids.cast<String>());
          }
          return <String, Object?>{
            'schemaVersion': 1,
            'outcome': 'complete',
            'results': <Object?>[],
          };
        },
      );
      final ids = List<String>.generate(27, (index) => 'restaurant-$index');

      final result = await service.prepareRestaurants(ids);

      expect(result.readyRestaurants.length, 25);
      expect(result.problems.length, 2);
      expect(result.interruption!.code, 'preparation_response_invalid');
      expect(
        result.problems.every((problem) => !problem.message.contains('http')),
        isTrue,
      );
    });

    test('public chunk call rejects invalid closed responses', () async {
      final service = AdminRestaurantQrBatchService(
        functionsBoundary: (_, _) async => <String, Object?>{
          'schemaVersion': 1,
          'outcome': 'complete',
          'results': <Object?>[_ready('different-id')],
        },
      );

      await expectLater(
        service.prepareChunk(
          AdminRestaurantQrPreparationRequest(const <String>['expected-id']),
        ),
        throwsA(
          isA<AdminRestaurantQrBatchServiceException>().having(
            (error) => error.kind,
            'kind',
            AdminRestaurantQrBatchFailureKind.invalidResponse,
          ),
        ),
      );
    });
  });

  group('sequential marking orchestration', () {
    for (final restaurantCount in <int>[1, 25, 26, 50, 200, 250, 400]) {
      test(
        '$restaurantCount groups use sequential 25-restaurant/100-label chunks',
        () async {
          final calls = <Map<String, Object?>>[];
          var activeCalls = 0;
          var maximumActiveCalls = 0;
          final service = AdminRestaurantQrBatchService(
            functionsBoundary: (callableName, request) async {
              expect(
                callableName,
                AdminRestaurantQrBatchService.markingCallableName,
              );
              calls.add(request);
              activeCalls += 1;
              maximumActiveCalls = activeCalls > maximumActiveCalls
                  ? activeCalls
                  : maximumActiveCalls;
              await Future<void>.delayed(Duration.zero);
              activeCalls -= 1;
              return _markingResponse(request);
            },
          );
          final worklist = _worklist(restaurantCount);
          final progress = <AdminRestaurantQrMarkingProgress>[];

          final result = await service.markPrepared(
            worklist,
            onProgress: progress.add,
          );

          expect(maximumActiveCalls, 1);
          expect(calls.length, (restaurantCount + 24) ~/ 25);
          expect(
            calls.every((request) {
              final restaurants = request['restaurants']! as List<Object?>;
              final labelCount = restaurants.fold<int>(
                0,
                (count, restaurant) =>
                    count +
                    ((restaurant as Map<String, Object?>)['labels']!
                            as List<Object?>)
                        .length,
              );
              return restaurants.length <= 25 && labelCount <= 100;
            }),
            isTrue,
          );
          expect(
            calls
                .expand((request) => request['restaurants']! as List<Object?>)
                .map(
                  (restaurant) =>
                      (restaurant
                          as Map<String, Object?>)['catalogRestaurantId'],
                ),
            worklist.restaurants.map(
              (restaurant) => restaurant.catalogRestaurantId,
            ),
          );
          expect(
            calls.every(
              (request) =>
                  !request.toString().contains('https://') &&
                  !request.toString().contains('token-'),
            ),
            isTrue,
          );
          expect(result.isComplete, isTrue);
          expect(result.savedCount, restaurantCount * 4);
          expect(result.unresolvedCount, 0);
          expect(result.preparationProjections.length, restaurantCount);
          expect(progress.last.processedRestaurantCount, restaurantCount);
          expect(progress.last.processedLabelCount, restaurantCount * 4);
        },
      );
    }

    test('transport failure keeps only affected labels unresolved', () async {
      var calls = 0;
      final service = AdminRestaurantQrBatchService(
        functionsBoundary: (_, request) async {
          calls += 1;
          if (calls == 1) throw StateError('synthetic transport failure');
          return _markingResponse(request);
        },
      );
      final worklist = _worklist(26);

      final result = await service.markPrepared(worklist);

      expect(calls, 2);
      expect(result.unresolvedCount, 100);
      expect(result.unresolvedWorklist.restaurantCount, 25);
      expect(result.unresolvedWorklist.labelCount, 100);
      expect(result.fullyResolvedRestaurantIds, <String>['restaurant-25']);
      expect(
        result.results
            .take(25)
            .expand((restaurant) => restaurant.labels)
            .every((label) => label.code == 'marking_unavailable'),
        isTrue,
      );
    });

    test(
      'retry sends only unresolved labels and reuses invitation IDs',
      () async {
        final requests = <Map<String, Object?>>[];
        var calls = 0;
        final service = AdminRestaurantQrBatchService(
          functionsBoundary: (_, request) async {
            calls += 1;
            requests.add(request);
            if (calls == 1) return _partiallyFailedMarkingResponse(request);
            return _markingResponse(request);
          },
        );
        final worklist = _worklist(1);

        final firstAttempt = await service.markPrepared(worklist);
        final retry = await service.retryUnresolved(firstAttempt);

        expect(firstAttempt.unresolvedCount, 1);
        expect(retry.requestedWorklist.restaurantCount, 1);
        expect(retry.requestedWorklist.labelCount, 1);
        expect(retry.isComplete, isTrue);
        expect(calls, 2);
        final retryRestaurants = requests.last['restaurants']! as List<Object?>;
        final retryLabels =
            (retryRestaurants.single as Map<String, Object?>)['labels']!
                as List<Object?>;
        expect(retryLabels, <Object?>[
          <String, Object?>{
            'type': 'C',
            'invitationId': 'invite-restaurant-0-C',
          },
        ]);
        expect(requests.last.toString(), isNot(contains('https://')));
        expect(requests.last.toString(), isNot(contains('token-')));
      },
    );

    test(
      'invalid marking response becomes unresolved without a retry',
      () async {
        var calls = 0;
        final service = AdminRestaurantQrBatchService(
          functionsBoundary: (_, request) async {
            calls += 1;
            final response = _markingResponse(request);
            response['outcome'] = 'partialFailure';
            return response;
          },
        );

        final result = await service.markPrepared(_worklist(1));

        expect(calls, 1);
        expect(result.unresolvedCount, 4);
        expect(
          result.results.single.labels.every(
            (label) => label.code == 'marking_response_invalid',
          ),
          isTrue,
        );
      },
    );

    test('an empty retry worklist does not call the backend', () async {
      var calls = 0;
      final service = AdminRestaurantQrBatchService(
        functionsBoundary: (_, request) async {
          calls += 1;
          return _markingResponse(request);
        },
      );
      final complete = await service.markPrepared(_worklist(1));
      expect(calls, 1);

      final retry = await service.retryUnresolved(complete);

      expect(calls, 1);
      expect(retry.requestedWorklist.isEmpty, isTrue);
      expect(retry.isComplete, isTrue);
    });
  });
}

Map<String, Object?> _preparationResponse(List<String> ids) =>
    <String, Object?>{
      'schemaVersion': 1,
      'outcome': 'complete',
      'results': ids.map(_ready).toList(growable: false),
    };

Map<String, Object?> _ready(String id) => <String, Object?>{
  'catalogRestaurantId': id,
  'outcome': 'ready',
  'restaurantName': 'Restaurant $id',
  'labels': <Object?>[
    <String, Object?>{
      'type': 'I',
      'payloadUrl': 'https://go.bitestar.app/invite/coupon/token-I',
      'invitationId': 'invite-$id-I',
      'invitationExpiresAtMillis': 2000000000000,
    },
    <String, Object?>{
      'type': 'C',
      'payloadUrl': 'https://go.bitestar.app/invite/bitescore/token-C',
      'invitationId': 'invite-$id-C',
      'invitationExpiresAtMillis': 2000000000000,
    },
    <String, Object?>{
      'type': 'SA',
      'payloadUrl':
          'https://go.bitestar.app/r/coupons/${Uri.encodeComponent(id)}',
    },
    <String, Object?>{
      'type': 'SR',
      'payloadUrl':
          'https://go.bitestar.app/r/bitescore/${Uri.encodeComponent(id)}',
    },
  ],
};

AdminRestaurantQrMarkingWorklist _worklist(int restaurantCount) =>
    AdminRestaurantQrMarkingWorklist(
      List<AdminRestaurantQrMarkingRestaurantRequest>.generate(
        restaurantCount,
        (index) {
          final id = 'restaurant-$index';
          return AdminRestaurantQrMarkingRestaurantRequest(
            catalogRestaurantId: id,
            labels: <AdminRestaurantQrMarkingLabelRequest>[
              AdminRestaurantQrMarkingLabelRequest(
                type: AdminRestaurantQrLabelType.ownerInvite,
                invitationId: 'invite-$id-I',
              ),
              AdminRestaurantQrMarkingLabelRequest(
                type: AdminRestaurantQrLabelType.claimInvite,
                invitationId: 'invite-$id-C',
              ),
              AdminRestaurantQrMarkingLabelRequest(
                type: AdminRestaurantQrLabelType.biteSaverCustomer,
              ),
              AdminRestaurantQrMarkingLabelRequest(
                type: AdminRestaurantQrLabelType.biteScoreCustomer,
              ),
            ],
          );
        },
      ),
    );

Map<String, Object?> _markingResponse(Map<String, Object?> request) {
  final restaurants = request['restaurants']! as List<Object?>;
  return <String, Object?>{
    'schemaVersion': 1,
    'outcome': 'complete',
    'results': restaurants
        .map((rawRestaurant) {
          final restaurant = rawRestaurant as Map<String, Object?>;
          final id = restaurant['catalogRestaurantId']! as String;
          final labels = restaurant['labels']! as List<Object?>;
          return <String, Object?>{
            'catalogRestaurantId': id,
            'outcome': 'processed',
            'labels': labels
                .map((rawLabel) {
                  final label = rawLabel as Map<String, Object?>;
                  return <String, Object?>{
                    'type': label['type'],
                    'status': 'saved',
                    'alreadySaved': false,
                  };
                })
                .toList(growable: false),
            'preparation': _projection(id),
          };
        })
        .toList(growable: false),
  };
}

Map<String, Object?> _partiallyFailedMarkingResponse(
  Map<String, Object?> request,
) {
  final response = _markingResponse(request);
  response['outcome'] = 'partialFailure';
  final result =
      (response['results']! as List<Object?>).single as Map<String, Object?>;
  result['outcome'] = 'partialFailure';
  final labels = result['labels']! as List<Object?>;
  labels[1] = <String, Object?>{
    'type': 'C',
    'status': 'failed',
    'code': 'invitation_invalid',
    'message': 'The represented invitation is no longer valid.',
  };
  return response;
}

Map<String, Object?> _projection(String id) => <String, Object?>{
  'canonicalCatalogRestaurantId': id,
  'i': 'prepared',
  'c': 'prepared',
  'sa': 'prepared',
  'sr': 'prepared',
};
