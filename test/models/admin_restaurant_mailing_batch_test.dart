import 'package:coupon_app/models/admin_restaurant_mailing_batch.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('strict callable response parsing', () {
    test('parses an exact complete response', () {
      final result = AdminRestaurantMailingChunkResult.fromCallableData(
        _response(<Map<String, Object?>>[
          _ready('restaurant-1'),
          _ready(
            'restaurant-2',
            name: 'Café ក 🍽️',
            streetAddress: 'PO Box 44  ផ្ទះ  2',
            city: 'São  ក José',
            zipCode: '34461-1234',
          ),
        ]),
        expectedCatalogRestaurantIds: <String>['restaurant-1', 'restaurant-2'],
      );

      expect(result.outcome, AdminRestaurantMailingBatchOutcome.complete);
      expect(result.results, hasLength(2));
      final unicode = result.results[1] as AdminRestaurantMailingReady;
      expect(unicode.restaurantName, 'Café ក 🍽️');
      expect(unicode.streetAddress, 'PO Box 44  ផ្ទះ  2');
      expect(unicode.city, 'São  ក José');
      expect(unicode.zipCode, '34461-1234');
    });

    test('parses an exact partial response and nullable safe name', () {
      final result = AdminRestaurantMailingChunkResult.fromCallableData(
        _response(<Map<String, Object?>>[
          _ready('restaurant-1'),
          _problem('restaurant-2', restaurantName: null),
        ], outcome: 'partialFailure'),
        expectedCatalogRestaurantIds: <String>['restaurant-1', 'restaurant-2'],
      );

      expect(result.outcome, AdminRestaurantMailingBatchOutcome.partialFailure);
      final problem = result.results[1] as AdminRestaurantMailingProblem;
      expect(problem.restaurantName, isNull);
      expect(
        problem.code,
        AdminRestaurantMailingProblemCode.restaurantNotFound,
      );
    });

    test('rejects unknown, missing, and non-string top-level keys', () {
      final valid = _response(<Map<String, Object?>>[_ready('restaurant-1')]);
      final invalid = <Object?>[
        null,
        <Object?>[],
        <String, Object?>{...valid, 'extra': true},
        <String, Object?>{...valid}..remove('results'),
        <Object?, Object?>{1: 'value'},
      ];

      for (final value in invalid) {
        expect(
          () => AdminRestaurantMailingChunkResult.fromCallableData(
            value,
            expectedCatalogRestaurantIds: const <String>['restaurant-1'],
          ),
          throwsA(isA<AdminRestaurantMailingProtocolException>()),
        );
      }
    });

    test('rejects wrong version types and unsupported outcomes', () {
      for (final version in <Object?>[true, 1.0, '1', null, 0, 2, -1]) {
        expect(
          () => AdminRestaurantMailingChunkResult.fromCallableData(
            _response(<Map<String, Object?>>[
              _ready('restaurant-1'),
            ], schemaVersion: version),
            expectedCatalogRestaurantIds: const <String>['restaurant-1'],
          ),
          throwsA(isA<AdminRestaurantMailingProtocolException>()),
        );
      }
      expect(
        () => AdminRestaurantMailingChunkResult.fromCallableData(
          _response(<Map<String, Object?>>[
            _ready('restaurant-1'),
          ], outcome: 'unknown'),
          expectedCatalogRestaurantIds: const <String>['restaurant-1'],
        ),
        throwsA(isA<AdminRestaurantMailingProtocolException>()),
      );
    });

    test('rejects incoherent top-level outcomes and empty result sets', () {
      final invalid = <Map<String, Object?>>[
        _response(<Map<String, Object?>>[_problem('restaurant-1')]),
        _response(<Map<String, Object?>>[
          _problem(
            'restaurant-1',
            overrides: <String, Object?>{
              'outcome': 'failed',
              'code': 'bounded_read_failed',
              'message': 'Restaurant mailing data could not be read.',
            },
          ),
        ]),
        _response(<Map<String, Object?>>[
          _ready('restaurant-1'),
        ], outcome: 'partialFailure'),
        _response(<Map<String, Object?>>[], outcome: 'complete'),
      ];

      for (final value in invalid) {
        expect(
          () => AdminRestaurantMailingChunkResult.fromCallableData(
            value,
            expectedCatalogRestaurantIds: const <String>['restaurant-1'],
          ),
          throwsA(isA<AdminRestaurantMailingProtocolException>()),
        );
      }
    });

    test('rejects missing and forbidden fields for each result outcome', () {
      final ready = _ready('restaurant-1');
      final problem = _problem('restaurant-1');
      final invalidResults = <Map<String, Object?>>[
        <String, Object?>{...ready}..remove('city'),
        <String, Object?>{...ready, 'code': 'invalid_zip'},
        <String, Object?>{...problem}..remove('restaurantName'),
        <String, Object?>{...problem, 'streetAddress': '1 Main Street'},
      ];

      for (final invalidResult in invalidResults) {
        expect(
          () => AdminRestaurantMailingChunkResult.fromCallableData(
            _response(<Map<String, Object?>>[
              invalidResult,
            ], outcome: 'partialFailure'),
            expectedCatalogRestaurantIds: const <String>['restaurant-1'],
          ),
          throwsA(isA<AdminRestaurantMailingProtocolException>()),
        );
      }
    });

    test(
      'rejects reordered, substituted, duplicated, omitted, and extra IDs',
      () {
        final expected = <String>['restaurant-1', 'restaurant-2'];
        final cases = <List<Map<String, Object?>>>[
          <Map<String, Object?>>[
            _ready('restaurant-2'),
            _ready('restaurant-1'),
          ],
          <Map<String, Object?>>[
            _ready('restaurant-1'),
            _ready('restaurant-3'),
          ],
          <Map<String, Object?>>[
            _ready('restaurant-1'),
            _ready('restaurant-1'),
          ],
          <Map<String, Object?>>[_ready('restaurant-1')],
          <Map<String, Object?>>[
            _ready('restaurant-1'),
            _ready('restaurant-2'),
            _ready('restaurant-3'),
          ],
        ];

        for (final results in cases) {
          expect(
            () => AdminRestaurantMailingChunkResult.fromCallableData(
              _response(results),
              expectedCatalogRestaurantIds: expected,
            ),
            throwsA(isA<AdminRestaurantMailingProtocolException>()),
          );
        }
      },
    );

    test('rejects invalid result field types', () {
      for (final field in <String>[
        'catalogRestaurantId',
        'restaurantName',
        'streetAddress',
        'city',
        'state',
        'zipCode',
      ]) {
        expect(
          () => AdminRestaurantMailingChunkResult.fromCallableData(
            _response(<Map<String, Object?>>[
              _ready('restaurant-1', overrides: <String, Object?>{field: 4}),
            ]),
            expectedCatalogRestaurantIds: const <String>['restaurant-1'],
          ),
          throwsA(isA<AdminRestaurantMailingProtocolException>()),
        );
      }
      expect(
        () => AdminRestaurantMailingChunkResult.fromCallableData(
          _response(<Map<String, Object?>>[
            _problem(
              'restaurant-1',
              overrides: <String, Object?>{'restaurantName': 4},
            ),
          ], outcome: 'partialFailure'),
          expectedCatalogRestaurantIds: const <String>['restaurant-1'],
        ),
        throwsA(isA<AdminRestaurantMailingProtocolException>()),
      );
    });

    test(
      'rejects invalid state, ZIP, padding, controls, and malformed Unicode',
      () {
        final malformedUnicode = String.fromCharCode(0xd800);
        final invalidReady = <Map<String, Object?>>[
          _ready('restaurant-1', overrides: <String, Object?>{'state': 'fl'}),
          _ready('restaurant-1', overrides: <String, Object?>{'state': 'PR'}),
          _ready(
            'restaurant-1',
            overrides: <String, Object?>{'zipCode': '3446'},
          ),
          _ready(
            'restaurant-1',
            overrides: <String, Object?>{'zipCode': '34461 1234'},
          ),
          _ready(
            'restaurant-1',
            overrides: <String, Object?>{'restaurantName': ' Padded'},
          ),
          _ready(
            'restaurant-1',
            overrides: <String, Object?>{'streetAddress': 'Line\nBreak'},
          ),
          _ready(
            'restaurant-1',
            overrides: <String, Object?>{'city': 'Line\u2028Break'},
          ),
          _ready(
            'restaurant-1',
            overrides: <String, Object?>{'city': 'Line\u200bBreak'},
          ),
          _ready(
            'restaurant-1',
            overrides: <String, Object?>{
              'restaurantName': 'Bad$malformedUnicode',
            },
          ),
          for (final rejected in <String>[
            '\u17b4',
            '\u17b5',
          ]) ...<Map<String, Object?>>[
            _ready(
              'restaurant-1',
              overrides: <String, Object?>{'restaurantName': 'Name$rejected'},
            ),
            _ready(
              'restaurant-1',
              overrides: <String, Object?>{'streetAddress': 'Street$rejected'},
            ),
            _ready(
              'restaurant-1',
              overrides: <String, Object?>{'city': 'City$rejected'},
            ),
            _ready(
              'restaurant-1',
              overrides: <String, Object?>{'state': 'F$rejected'},
            ),
            _ready(
              'restaurant-1',
              overrides: <String, Object?>{'zipCode': '3442$rejected'},
            ),
            _ready('restaurant-$rejected-id'),
          ],
        ];

        for (final value in invalidReady) {
          expect(
            () => AdminRestaurantMailingChunkResult.fromCallableData(
              _response(<Map<String, Object?>>[value]),
              expectedCatalogRestaurantIds: const <String>['restaurant-1'],
            ),
            throwsA(isA<AdminRestaurantMailingProtocolException>()),
          );
        }
      },
    );

    test('enforces the exact stable problem code/outcome combinations', () {
      final cases = <Map<String, Object?>>[
        _problem(
          'restaurant-1',
          overrides: <String, Object?>{'code': 'unknown_code'},
        ),
        _problem(
          'restaurant-1',
          overrides: <String, Object?>{
            'outcome': 'failed',
            'code': 'restaurant_not_found',
          },
        ),
        _problem(
          'restaurant-1',
          overrides: <String, Object?>{
            'outcome': 'unavailable',
            'code': 'bounded_read_failed',
          },
        ),
      ];

      for (final value in cases) {
        expect(
          () => AdminRestaurantMailingChunkResult.fromCallableData(
            _response(<Map<String, Object?>>[value], outcome: 'partialFailure'),
            expectedCatalogRestaurantIds: const <String>['restaurant-1'],
          ),
          throwsA(isA<AdminRestaurantMailingProtocolException>()),
        );
      }
    });

    test('rejects unsafe problem messages and unexpected private fields', () {
      final invalidProblems = <Map<String, Object?>>[
        _problem(
          'restaurant-1',
          overrides: <String, Object?>{
            'message': 'Open https://example.test/private',
          },
        ),
        _problem(
          'restaurant-1',
          overrides: <String, Object?>{'message': 'Line\nBreak'},
        ),
        _problem(
          'restaurant-1',
          overrides: <String, Object?>{'ownerName': 'Private Owner'},
        ),
        _problem(
          'restaurant-1',
          overrides: <String, Object?>{'invitationId': 'private-invitation'},
        ),
      ];

      for (final problem in invalidProblems) {
        expect(
          () => AdminRestaurantMailingChunkResult.fromCallableData(
            _response(<Map<String, Object?>>[
              problem,
            ], outcome: 'partialFailure'),
            expectedCatalogRestaurantIds: const <String>['restaurant-1'],
          ),
          throwsA(isA<AdminRestaurantMailingProtocolException>()),
        );
      }
    });

    test('same names with different exact IDs remain separate', () {
      final result = AdminRestaurantMailingChunkResult.fromCallableData(
        _response(<Map<String, Object?>>[
          _ready('restaurant-1', name: 'Same Name'),
          _ready('restaurant-2', name: 'Same Name'),
        ]),
        expectedCatalogRestaurantIds: const <String>[
          'restaurant-1',
          'restaurant-2',
        ],
      );

      expect(result.results.map((value) => value.catalogRestaurantId), <String>[
        'restaurant-1',
        'restaurant-2',
      ]);
    });
  });

  group('ordered run and retry state', () {
    test('requires a confirmed exact prefix and exact unconfirmed suffix', () {
      final interruption = AdminRestaurantMailingInterruption(
        kind: AdminRestaurantMailingInterruptionKind.unavailable,
        message: 'Restaurant mailing data could not be confirmed.',
        catalogRestaurantIds: const <String>['restaurant-2', 'restaurant-3'],
      );
      final result = AdminRestaurantMailingBatchRunResult(
        requestedCatalogRestaurantIds: const <String>[
          'restaurant-1',
          'restaurant-2',
          'restaurant-3',
        ],
        confirmedResults: <AdminRestaurantMailingResult>[
          AdminRestaurantMailingReady(
            catalogRestaurantId: 'restaurant-1',
            restaurantName: 'Restaurant 1',
            streetAddress: '1 Main Street',
            city: 'Crystal River',
            state: 'FL',
            zipCode: '34428',
          ),
        ],
        interruption: interruption,
      );

      expect(result.isFullyConfirmed, isFalse);
      expect(result.unconfirmedCatalogRestaurantIds, <String>[
        'restaurant-2',
        'restaurant-3',
      ]);
      expect(result.confirmedResults, hasLength(1));
    });

    test('rejects impossible confirmed-prefix and suffix combinations', () {
      final ready = AdminRestaurantMailingReady(
        catalogRestaurantId: 'restaurant-2',
        restaurantName: 'Restaurant 2',
        streetAddress: '2 Main Street',
        city: 'Crystal River',
        state: 'FL',
        zipCode: '34428',
      );
      expect(
        () => AdminRestaurantMailingBatchRunResult(
          requestedCatalogRestaurantIds: const <String>[
            'restaurant-1',
            'restaurant-2',
          ],
          confirmedResults: <AdminRestaurantMailingResult>[ready],
          interruption: AdminRestaurantMailingInterruption(
            kind: AdminRestaurantMailingInterruptionKind.unavailable,
            message: 'Restaurant mailing data could not be confirmed.',
            catalogRestaurantIds: const <String>['restaurant-1'],
          ),
        ),
        throwsA(isA<AdminRestaurantMailingProtocolException>()),
      );
    });
  });
}

Map<String, Object?> _response(
  List<Map<String, Object?>> results, {
  Object? schemaVersion = 1,
  String outcome = 'complete',
}) => <String, Object?>{
  'schemaVersion': schemaVersion,
  'outcome': outcome,
  'results': results,
};

Map<String, Object?> _ready(
  String id, {
  String name = 'River Grill',
  String streetAddress = '1 Main Street',
  String city = 'Crystal River',
  String state = 'FL',
  String zipCode = '34428',
  Map<String, Object?> overrides = const <String, Object?>{},
}) => <String, Object?>{
  'catalogRestaurantId': id,
  'outcome': 'ready',
  'restaurantName': name,
  'streetAddress': streetAddress,
  'city': city,
  'state': state,
  'zipCode': zipCode,
  ...overrides,
};

Map<String, Object?> _problem(
  String id, {
  String? restaurantName = 'River Grill',
  Map<String, Object?> overrides = const <String, Object?>{},
}) => <String, Object?>{
  'catalogRestaurantId': id,
  'outcome': 'unavailable',
  'restaurantName': restaurantName,
  'code': 'restaurant_not_found',
  'message': 'Restaurant was not found.',
  ...overrides,
};
