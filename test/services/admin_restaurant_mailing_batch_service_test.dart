import 'package:coupon_app/models/admin_restaurant_mailing_batch.dart';
import 'package:coupon_app/services/admin_restaurant_mailing_batch_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('sequential chunking and callable payload', () {
    for (final restaurantCount in <int>[1, 25, 26, 50, 200, 250, 400]) {
      test(
        '$restaurantCount IDs use ordered sequential chunks of 25',
        () async {
          final calls = <List<String>>[];
          var activeCalls = 0;
          var maximumActiveCalls = 0;
          final service = AdminRestaurantMailingBatchService(
            functionsBoundary: (callableName, request) async {
              expect(
                callableName,
                AdminRestaurantMailingBatchService.callableName,
              );
              expect(request.keys, <String>[
                'schemaVersion',
                'catalogRestaurantIds',
              ]);
              expect(request['schemaVersion'], 1);
              expect(request, isNot(contains('cursor')));
              expect(request, isNot(contains('session')));
              expect(request, isNot(contains('preparation')));
              expect(request, isNot(contains('invitation')));
              expect(request, isNot(contains('qr')));
              final ids = (request['catalogRestaurantIds']! as List<Object?>)
                  .cast<String>();
              calls.add(ids);
              activeCalls += 1;
              maximumActiveCalls = activeCalls > maximumActiveCalls
                  ? activeCalls
                  : maximumActiveCalls;
              await Future<void>.delayed(Duration.zero);
              activeCalls -= 1;
              return _response(ids);
            },
          );
          final ids = List<String>.generate(
            restaurantCount,
            (index) => 'restaurant-${index.toString().padLeft(3, '0')}',
          );

          final result = await service.prepareRestaurants(ids);

          expect(maximumActiveCalls, 1);
          expect(calls.length, (restaurantCount + 24) ~/ 25);
          expect(calls.every((chunk) => chunk.length <= 25), isTrue);
          expect(calls.expand((chunk) => chunk), ids);
          expect(result.requestedCatalogRestaurantIds, ids);
          expect(
            result.confirmedResults.map((value) => value.catalogRestaurantId),
            ids,
          );
          expect(result.isFullyConfirmed, isTrue);
          expect(result.allRestaurantsReady, isTrue);
        },
      );
    }

    test('validates the full selection before any client call', () async {
      var calls = 0;
      final service = AdminRestaurantMailingBatchService(
        functionsBoundary: (_, _) async {
          calls += 1;
          return null;
        },
      );
      final malformedUnicode = String.fromCharCode(0xd800);
      final invalidSelections = <List<String>>[
        <String>[],
        <String>['restaurant-a', 'restaurant-a'],
        <String>[' restaurant-a'],
        <String>['restaurant-a '],
        <String>['restaurant/a'],
        <String>['.'],
        <String>['..'],
        <String>['restaurant\u200b1'],
        <String>['\u17b4'],
        <String>['\u17b5'],
        <String>['restaurant-\u17b4-id'],
        <String>['restaurant-\u17b5-id'],
        <String>[malformedUnicode],
        <String>[List<String>.filled(1501, 'x').join()],
      ];

      for (final selection in invalidSelections) {
        await expectLater(
          service.prepareRestaurants(selection),
          throwsA(
            isA<AdminRestaurantMailingServiceException>().having(
              (error) => error.kind,
              'kind',
              AdminRestaurantMailingServiceFailureKind.invalidRequest,
            ),
          ),
        );
      }
      expect(calls, 0);
    });

    test(
      'preserves accepted ASCII, supplementary, and visible Khmer IDs',
      () async {
        final calls = <List<String>>[];
        final service = AdminRestaurantMailingBatchService(
          functionsBoundary: (_, request) async {
            final ids = (request['catalogRestaurantIds']! as List<Object?>)
                .cast<String>();
            calls.add(ids);
            return _response(ids);
          },
        );
        const ids = <String>[
          'restaurant-ascii',
          'restaurant-😀',
          'restaurant-ក-id',
        ];

        final result = await service.prepareRestaurants(ids);

        expect(calls, <List<String>>[ids]);
        expect(result.requestedCatalogRestaurantIds, ids);
        expect(
          result.confirmedResults.map((value) => value.catalogRestaurantId),
          ids,
        );
      },
    );

    test(
      'server-ready rejected code points fail the whole chunk closed',
      () async {
        for (final rejected in <String>['\u17b4', '\u17b5']) {
          var calls = 0;
          final service = AdminRestaurantMailingBatchService(
            functionsBoundary: (_, request) async {
              calls += 1;
              final ids = (request['catalogRestaurantIds']! as List<Object?>)
                  .cast<String>();
              return <String, Object?>{
                ..._response(ids),
                'results': <Object?>[
                  <String, Object?>{
                    ..._ready(ids.single),
                    'restaurantName': 'Malformed$rejected',
                  },
                ],
              };
            },
          );

          final result = await service.prepareRestaurants(const <String>[
            'restaurant-1',
          ]);

          expect(calls, 1);
          expect(result.confirmedResults, isEmpty);
          expect(
            result.interruption!.kind,
            AdminRestaurantMailingInterruptionKind.invalidResponse,
          );
        }
      },
    );
  });

  group('failure and explicit retry', () {
    test('first-chunk transport failure preserves the full suffix', () async {
      var calls = 0;
      final service = AdminRestaurantMailingBatchService(
        functionsBoundary: (_, _) async {
          calls += 1;
          throw StateError('synthetic transport detail');
        },
      );
      final ids = List<String>.generate(30, (index) => 'restaurant-$index');

      final result = await service.prepareRestaurants(ids);

      expect(calls, 1);
      expect(result.confirmedResults, isEmpty);
      expect(result.unconfirmedCatalogRestaurantIds, ids);
      expect(
        result.interruption!.kind,
        AdminRestaurantMailingInterruptionKind.unavailable,
      );
      expect(result.interruption!.message, isNot(contains('synthetic')));
    });

    test(
      'later transport failure preserves the exact confirmed prefix',
      () async {
        var calls = 0;
        final requests = <List<String>>[];
        final service = AdminRestaurantMailingBatchService(
          functionsBoundary: (_, request) async {
            calls += 1;
            final ids = (request['catalogRestaurantIds']! as List<Object?>)
                .cast<String>();
            requests.add(ids);
            if (calls == 2) throw StateError('synthetic lost response');
            return _response(ids);
          },
        );
        final ids = List<String>.generate(50, (index) => 'restaurant-$index');

        final result = await service.prepareRestaurants(ids);

        expect(calls, 2);
        expect(result.confirmedResults, hasLength(25));
        expect(
          result.confirmedResults.map((value) => value.catalogRestaurantId),
          ids.take(25),
        );
        expect(result.unconfirmedCatalogRestaurantIds, ids.skip(25));
        expect(requests, <List<String>>[
          ids.take(25).toList(),
          ids.skip(25).toList(),
        ]);
      },
    );

    test(
      'malformed later response preserves the exact retryable suffix',
      () async {
        var calls = 0;
        final service = AdminRestaurantMailingBatchService(
          functionsBoundary: (_, request) async {
            calls += 1;
            final ids = (request['catalogRestaurantIds']! as List<Object?>)
                .cast<String>();
            if (calls == 2) {
              return <String, Object?>{
                ..._response(ids),
                'results': <Object?>[],
              };
            }
            return _response(ids);
          },
        );
        final ids = List<String>.generate(30, (index) => 'restaurant-$index');

        final result = await service.prepareRestaurants(ids);

        expect(calls, 2);
        expect(result.confirmedResults, hasLength(25));
        expect(result.unconfirmedCatalogRestaurantIds, ids.skip(25));
        expect(
          result.interruption!.kind,
          AdminRestaurantMailingInterruptionKind.invalidResponse,
        );
      },
    );

    test(
      'explicit retry sends only the suffix and merges without duplicates',
      () async {
        var calls = 0;
        final requests = <List<String>>[];
        final service = AdminRestaurantMailingBatchService(
          functionsBoundary: (_, request) async {
            calls += 1;
            final ids = (request['catalogRestaurantIds']! as List<Object?>)
                .cast<String>();
            requests.add(ids);
            if (calls == 2) throw StateError('synthetic lost response');
            return _response(ids);
          },
        );
        final ids = List<String>.generate(30, (index) => 'restaurant-$index');

        final first = await service.prepareRestaurants(ids);
        final merged = await service.retryUnconfirmed(first);

        expect(calls, 3);
        expect(requests.last, ids.skip(25));
        expect(
          merged.confirmedResults.map((value) => value.catalogRestaurantId),
          ids,
        );
        expect(
          merged.confirmedResults
              .map((value) => value.catalogRestaurantId)
              .toSet(),
          hasLength(30),
        );
        expect(merged.isFullyConfirmed, isTrue);
        expect(merged.wasInterrupted, isFalse);
      },
    );

    test('a fully confirmed result is not called again by retry', () async {
      var calls = 0;
      final service = AdminRestaurantMailingBatchService(
        functionsBoundary: (_, request) async {
          calls += 1;
          final ids = (request['catalogRestaurantIds']! as List<Object?>)
              .cast<String>();
          return _response(ids);
        },
      );
      final first = await service.prepareRestaurants(const <String>[
        'restaurant-1',
      ]);

      final retry = await service.retryUnconfirmed(first);

      expect(identical(retry, first), isTrue);
      expect(calls, 1);
    });

    test(
      'confirmed authoritative problems are retained and not retried',
      () async {
        var calls = 0;
        final service = AdminRestaurantMailingBatchService(
          functionsBoundary: (_, request) async {
            calls += 1;
            final ids = (request['catalogRestaurantIds']! as List<Object?>)
                .cast<String>();
            return <String, Object?>{
              'schemaVersion': 1,
              'outcome': 'partialFailure',
              'results': <Object?>[_problem(ids.single)],
            };
          },
        );

        final result = await service.prepareRestaurants(const <String>[
          'restaurant-1',
        ]);
        final retry = await service.retryUnconfirmed(result);

        expect(calls, 1);
        expect(identical(retry, result), isTrue);
        expect(result.isFullyConfirmed, isTrue);
        expect(result.allRestaurantsReady, isFalse);
        expect(result.problems, hasLength(1));
      },
    );
  });
}

Map<String, Object?> _response(List<String> ids) => <String, Object?>{
  'schemaVersion': 1,
  'outcome': 'complete',
  'results': ids.map(_ready).toList(growable: false),
};

Map<String, Object?> _ready(String id) => <String, Object?>{
  'catalogRestaurantId': id,
  'outcome': 'ready',
  'restaurantName': 'Restaurant $id',
  'streetAddress': '1 Main Street',
  'city': 'Crystal River',
  'state': 'FL',
  'zipCode': '34428',
};

Map<String, Object?> _problem(String id) => <String, Object?>{
  'catalogRestaurantId': id,
  'outcome': 'unavailable',
  'restaurantName': null,
  'code': 'restaurant_not_found',
  'message': 'Restaurant was not found.',
};
