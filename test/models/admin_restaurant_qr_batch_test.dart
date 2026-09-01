import 'package:coupon_app/models/admin_restaurant_qr_batch.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('preparation request', () {
    test('preserves exact identities and is immutable', () {
      final source = <String>['id-b', 'id-a'];
      final request = AdminRestaurantQrPreparationRequest(source);
      source[0] = 'changed';

      expect(request.catalogRestaurantIds, <String>['id-b', 'id-a']);
      expect(request.toJson(), <String, Object?>{
        'schemaVersion': 1,
        'catalogRestaurantIds': <String>['id-b', 'id-a'],
      });
      expect(
        () => request.catalogRestaurantIds.add('another'),
        throwsUnsupportedError,
      );
    });

    test('rejects empty, duplicate, changed, and oversized identities', () {
      for (final ids in <List<String>>[
        <String>[],
        <String>['same', 'same'],
        <String>[' exact'],
        <String>['exact '],
        <String>['a/b'],
        List<String>.generate(26, (index) => 'id-$index'),
      ]) {
        expect(
          () => AdminRestaurantQrPreparationRequest(ids),
          throwsA(isA<AdminRestaurantQrProtocolException>()),
          reason: '$ids',
        );
      }
    });
  });

  group('strict preparation response', () {
    test('parses a closed mixed response and builds an ordered manifest', () {
      final response = AdminRestaurantQrPreparationChunkResult.fromCallableData(
        <String, Object?>{
          'schemaVersion': 1,
          'outcome': 'partialFailure',
          'results': <Object?>[
            _ready('restaurant-b', name: '食べる Café'),
            <String, Object?>{
              'catalogRestaurantId': 'restaurant-a',
              'outcome': 'unavailable',
              'code': 'restaurant_not_found',
              'message': 'The canonical restaurant was not found.',
            },
          ],
        },
        expectedCatalogRestaurantIds: <String>['restaurant-b', 'restaurant-a'],
      );
      final run = AdminRestaurantQrPreparationRunResult(
        requestedCatalogRestaurantIds: <String>['restaurant-b', 'restaurant-a'],
        results: response.results,
      );
      final manifest = run.toArtifactManifest();

      expect(
        response.outcome,
        AdminRestaurantQrPreparationOutcome.partialFailure,
      );
      expect(run.readyRestaurants.single.restaurantName, '食べる Café');
      expect(run.problems.single.catalogRestaurantId, 'restaurant-a');
      expect(manifest.selectedRestaurantCount, 2);
      expect(manifest.restaurantCount, 1);
      expect(
        manifest.restaurants.single.labels.map((label) => label.type),
        AdminRestaurantQrLabelType.values,
      );
    });

    test('rejects unknown, missing, wrong-type, and impossible top fields', () {
      final valid = _preparationResponse(<String>['restaurant-a']);
      final cases = <Object?>[
        <String, Object?>{...valid, 'unknown': true},
        <String, Object?>{'schemaVersion': 1, 'outcome': 'complete'},
        <String, Object?>{...valid, 'schemaVersion': 1.0},
        <String, Object?>{...valid, 'results': 'not-a-list'},
        <String, Object?>{...valid, 'outcome': 'partialFailure'},
      ];

      for (final value in cases) {
        expect(
          () => AdminRestaurantQrPreparationChunkResult.fromCallableData(
            value,
            expectedCatalogRestaurantIds: const <String>['restaurant-a'],
          ),
          throwsA(isA<AdminRestaurantQrProtocolException>()),
          reason: '$value',
        );
      }
    });

    test(
      'rejects duplicate, missing, mismatched, and reordered identities',
      () {
        for (final results in <List<Object?>>[
          <Object?>[_ready('restaurant-a'), _ready('restaurant-a')],
          <Object?>[_ready('restaurant-a')],
          <Object?>[_ready('restaurant-x'), _ready('restaurant-b')],
          <Object?>[_ready('restaurant-b'), _ready('restaurant-a')],
        ]) {
          expect(
            () => AdminRestaurantQrPreparationChunkResult.fromCallableData(
              <String, Object?>{
                'schemaVersion': 1,
                'outcome': 'complete',
                'results': results,
              },
              expectedCatalogRestaurantIds: const <String>[
                'restaurant-a',
                'restaurant-b',
              ],
            ),
            throwsA(isA<AdminRestaurantQrProtocolException>()),
          );
        }
      },
    );

    test('rejects unknown result fields and unsafe problem text', () {
      final unknownReady = _ready('restaurant-a')..['extra'] = true;
      for (final result in <Map<String, Object?>>[
        unknownReady,
        <String, Object?>{
          'catalogRestaurantId': 'restaurant-a',
          'outcome': 'failed',
          'code': 'UPPERCASE',
          'message': 'Safe message.',
        },
        <String, Object?>{
          'catalogRestaurantId': 'restaurant-a',
          'outcome': 'failed',
          'code': 'safe_code',
          'message': ' leading whitespace',
        },
        <String, Object?>{
          'catalogRestaurantId': 'restaurant-a',
          'outcome': 'failed',
          'code': 'safe_code',
          'message':
              'Do not display https://go.bitestar.app/invite/coupon/token.',
        },
      ]) {
        expect(
          () => AdminRestaurantQrPreparationChunkResult.fromCallableData(
            <String, Object?>{
              'schemaVersion': 1,
              'outcome': 'partialFailure',
              'results': <Object?>[result],
            },
            expectedCatalogRestaurantIds: const <String>['restaurant-a'],
          ),
          throwsA(isA<AdminRestaurantQrProtocolException>()),
        );
      }
    });

    test('requires unique canonical I/C/SA/SR label order', () {
      final validLabels = _ready('restaurant-a')['labels']! as List<Object?>;
      final cases = <List<Object?>>[
        <Object?>[validLabels[1], validLabels[0], ...validLabels.skip(2)],
        <Object?>[validLabels[0], validLabels[0], ...validLabels.skip(2)],
        <Object?>[validLabels[0], validLabels[1], validLabels[3]],
        <Object?>[validLabels[0], validLabels[1], validLabels[2]],
        <Object?>[...validLabels, _label('SA', 'restaurant-a')],
      ];
      for (final labels in cases) {
        final ready = _ready('restaurant-a')..['labels'] = labels;
        expect(
          () => AdminRestaurantQrPreparationChunkResult.fromCallableData(
            <String, Object?>{
              'schemaVersion': 1,
              'outcome': 'complete',
              'results': <Object?>[ready],
            },
            expectedCatalogRestaurantIds: const <String>['restaurant-a'],
          ),
          throwsA(isA<AdminRestaurantQrProtocolException>()),
        );
      }
    });
  });

  group('strict payload URLs', () {
    test('accepts exact invite and decoded customer route identities', () {
      const id = "Café !'()*";
      final ready = AdminRestaurantQrReadyRestaurant.fromCallableData(
        _ready(id),
      );

      expect(ready.catalogRestaurantId, id);
      expect(ready.labels.length, 4);
      expect(ready.labels[0].invitationId, 'invite-I');
      expect(ready.labels[2].invitationId, isNull);
    });

    test(
      'rejects scheme, host, port, query, fragment, and route mismatches',
      () {
        final invalidUrls = <String>[
          'http://go.bitestar.app/invite/coupon/token',
          'https://evil.example/invite/coupon/token',
          'https://go.bitestar.app:443/invite/coupon/token',
          'https://go.bitestar.app/invite/coupon/token?secret=x',
          'https://go.bitestar.app/invite/coupon/token#fragment',
          'https://go.bitestar.app/invite/bitescore/token',
          'https://go.bitestar.app/invite/coupon/',
          ' https://go.bitestar.app/invite/coupon/token',
        ];
        for (final url in invalidUrls) {
          final ready = _ready('restaurant-a');
          (ready['labels']! as List<Object?>)[0] = <String, Object?>{
            'type': 'I',
            'payloadUrl': url,
            'invitationId': 'invite-I',
            'invitationExpiresAtMillis': 2000000000000,
          };
          expect(
            () => AdminRestaurantQrReadyRestaurant.fromCallableData(ready),
            throwsA(isA<AdminRestaurantQrProtocolException>()),
            reason: url,
          );
        }
      },
    );

    test('rejects SA/SR route type and decoded identity mismatches', () {
      for (final replacement in <Map<String, Object?>>[
        <String, Object?>{
          'type': 'SA',
          'payloadUrl': 'https://go.bitestar.app/r/bitescore/restaurant-a',
        },
        <String, Object?>{
          'type': 'SA',
          'payloadUrl': 'https://go.bitestar.app/r/coupons/restaurant-b',
        },
        <String, Object?>{
          'type': 'SR',
          'payloadUrl':
              'https://go.bitestar.app/r/bitescore/restaurant-a%2Fother',
        },
      ]) {
        final ready = _ready('restaurant-a');
        final labels = ready['labels']! as List<Object?>;
        labels[replacement['type'] == 'SA' ? 2 : 3] = replacement;
        expect(
          () => AdminRestaurantQrReadyRestaurant.fromCallableData(ready),
          throwsA(isA<AdminRestaurantQrProtocolException>()),
        );
      }
    });

    test(
      'requires invitation IDs and positive integer expiry only for I/C',
      () {
        final cases = <Map<String, Object?>>[
          <String, Object?>{
            'type': 'I',
            'payloadUrl': 'https://go.bitestar.app/invite/coupon/token',
            'invitationExpiresAtMillis': 2000000000000,
          },
          <String, Object?>{
            'type': 'I',
            'payloadUrl': 'https://go.bitestar.app/invite/coupon/token',
            'invitationId': 'invite-I',
            'invitationExpiresAtMillis': 2000000000000.0,
          },
          <String, Object?>{
            'type': 'SA',
            'payloadUrl': 'https://go.bitestar.app/r/coupons/restaurant-a',
            'invitationId': 'forbidden',
          },
        ];
        for (final invalid in cases) {
          expect(
            () => AdminRestaurantQrLabelEntry.fromCallableData(
              invalid,
              expectedCatalogRestaurantId: 'restaurant-a',
            ),
            throwsA(isA<AdminRestaurantQrProtocolException>()),
          );
        }
      },
    );
  });

  group('artifact manifest', () {
    test('freezes input and preserves selected count across filtering', () {
      final source = <AdminRestaurantQrArtifactRestaurant>[
        _artifactRestaurant('restaurant-a'),
        _artifactRestaurant('restaurant-b'),
      ];
      final manifest = AdminRestaurantQrArtifactManifest(
        selectedRestaurantCount: 3,
        restaurants: source,
      );
      source.clear();
      final filtered = manifest.withRestaurants(
        <AdminRestaurantQrArtifactRestaurant>[manifest.restaurants.last],
      );

      expect(manifest.restaurantCount, 2);
      expect(manifest.labelCount, 8);
      expect(filtered.selectedRestaurantCount, 3);
      expect(filtered.restaurants.single.catalogRestaurantId, 'restaurant-b');
      expect(
        () => manifest.restaurants.add(_artifactRestaurant('restaurant-c')),
        throwsUnsupportedError,
      );
    });

    test('allows an empty filtered manifest but no empty PDF summary', () {
      final empty = AdminRestaurantQrArtifactManifest(
        selectedRestaurantCount: 2,
        restaurants: const <AdminRestaurantQrArtifactRestaurant>[],
      );
      expect(empty.isEmpty, isTrue);
      expect(
        () => AdminRestaurantQrPdfArtifactSummary(
          filename: 'bitestar-qr-labels-20260829-205400.pdf',
          pageCount: 0,
          includedManifest: empty,
        ),
        throwsA(isA<AdminRestaurantQrProtocolException>()),
      );
    });

    test('summary enforces generic filename and exact 48-label pages', () {
      final restaurants = List<AdminRestaurantQrArtifactRestaurant>.generate(
        13,
        (index) => _artifactRestaurant('restaurant-$index'),
      );
      final manifest = AdminRestaurantQrArtifactManifest(
        selectedRestaurantCount: 13,
        restaurants: restaurants,
      );
      final summary = AdminRestaurantQrPdfArtifactSummary(
        filename: 'bitestar-qr-labels-20260829-205400.pdf',
        pageCount: 2,
        includedManifest: manifest,
      );
      expect(summary.labelCount, 52);
      expect(summary.pageCount, 2);
      for (final filename in <String>[
        'restaurant-a.pdf',
        'bitestar-qr-labels.pdf',
        '../bitestar-qr-labels-20260829-205400.pdf',
      ]) {
        expect(
          () => AdminRestaurantQrPdfArtifactSummary(
            filename: filename,
            pageCount: 2,
            includedManifest: manifest,
          ),
          throwsA(isA<AdminRestaurantQrProtocolException>()),
        );
      }
    });
  });

  group('strict marking contract', () {
    test('serializes only exact marking identity without URLs or expiry', () {
      final request = AdminRestaurantQrMarkingRequest(
        AdminRestaurantQrMarkingWorklist.fromManifest(
          AdminRestaurantQrArtifactManifest(
            selectedRestaurantCount: 1,
            restaurants: <AdminRestaurantQrArtifactRestaurant>[
              _artifactRestaurant('restaurant-a'),
            ],
          ),
        ).restaurants,
      );
      final json = request.toJson();

      expect(json.toString(), isNot(contains('https://')));
      expect(json.toString(), isNot(contains('token-')));
      expect(json.toString(), isNot(contains('Expires')));
      expect(
        ((json['restaurants']! as List<Object?>).single
            as Map<String, Object?>)['labels'],
        <Object?>[
          <String, Object?>{'type': 'I', 'invitationId': 'invite-I'},
          <String, Object?>{'type': 'C', 'invitationId': 'invite-C'},
          <String, Object?>{'type': 'SA'},
          <String, Object?>{'type': 'SR'},
        ],
      );
    });

    test('strictly parses statuses and the safe preparation projection', () {
      final request = _markingRequest('restaurant-a');
      final response = AdminRestaurantQrMarkingChunkResult.fromCallableData(
        _markingResponse(request),
        expectedRequest: request,
      );
      final result = response.results.single;

      expect(response.outcome, AdminRestaurantQrMarkingOutcome.complete);
      expect(result.labels[0].invitationId, 'invite-I');
      expect(
        result.labels[0].status,
        AdminRestaurantQrLabelMarkingStatus.notRequired,
      );
      expect(result.labels[1].alreadySaved, isTrue);
      expect(result.labels[2].alreadySaved, isFalse);
      expect(result.preparation!.canonicalCatalogRestaurantId, 'restaurant-a');
      expect(result.preparation!.isComplete, isTrue);
    });

    test('accepts an omitted optional safe preparation projection', () {
      final request = _markingRequest('restaurant-a');
      final raw = _markingResponse(request);
      final rawResult =
          (raw['results']! as List<Object?>).single as Map<String, Object?>;
      rawResult.remove('preparation');

      final response = AdminRestaurantQrMarkingChunkResult.fromCallableData(
        raw,
        expectedRequest: request,
      );

      expect(response.outcome, AdminRestaurantQrMarkingOutcome.complete);
      expect(response.results.single.isResolved, isTrue);
      expect(response.results.single.preparation, isNull);
    });

    test('requires exact result/type order and status-specific fields', () {
      final request = _markingRequest('restaurant-a');
      final valid = _markingResponse(request);
      final rawResult =
          (valid['results']! as List<Object?>).single as Map<String, Object?>;
      final validLabels = rawResult['labels']! as List<Object?>;
      final invalidResponses = <Map<String, Object?>>[
        <String, Object?>{...valid, 'unknown': true},
        <String, Object?>{...valid, 'outcome': 'partialFailure'},
        _withMarkingLabels(valid, <Object?>[
          validLabels[1],
          validLabels[0],
          ...validLabels.skip(2),
        ]),
        _withMarkingLabels(valid, <Object?>[
          <String, Object?>{
            ...(validLabels[0] as Map<String, Object?>),
            'code': 'forbidden',
          },
          ...validLabels.skip(1),
        ]),
        _withMarkingLabels(valid, <Object?>[
          ...validLabels.take(2),
          <String, Object?>{'type': 'SA', 'status': 'notRequired'},
          validLabels[3],
        ]),
        _withPreparation(valid, <String, Object?>{
          ..._projection('different-id'),
        }),
      ];

      for (final invalid in invalidResponses) {
        expect(
          () => AdminRestaurantQrMarkingChunkResult.fromCallableData(
            invalid,
            expectedRequest: request,
          ),
          throwsA(isA<AdminRestaurantQrProtocolException>()),
        );
      }
    });

    test(
      'derives an unresolved-only worklist with exact invitation identity',
      () {
        final request = _markingRequest('restaurant-a');
        final response = _markingResponse(request);
        final rawResult =
            (response['results']! as List<Object?>).single
                as Map<String, Object?>;
        rawResult['outcome'] = 'partialFailure';
        final labels = rawResult['labels']! as List<Object?>;
        labels[1] = <String, Object?>{
          'type': 'C',
          'status': 'failed',
          'code': 'invitation_invalid',
          'message': 'The represented invitation is no longer valid.',
        };
        response['outcome'] = 'partialFailure';
        final parsed = AdminRestaurantQrMarkingChunkResult.fromCallableData(
          response,
          expectedRequest: request,
        );
        final run = AdminRestaurantQrMarkingRunResult(
          requestedWorklist: AdminRestaurantQrMarkingWorklist(
            request.restaurants,
          ),
          results: parsed.results,
        );

        expect(run.savedCount, 2);
        expect(run.alreadySavedCount, 0);
        expect(run.notRequiredCount, 1);
        expect(run.unresolvedCount, 1);
        expect(run.unresolvedWorklist.restaurantCount, 1);
        expect(run.unresolvedWorklist.labelCount, 1);
        expect(
          run.unresolvedWorklist.restaurants.single.labels.single,
          AdminRestaurantQrMarkingLabelRequest(
            type: AdminRestaurantQrLabelType.claimInvite,
            invitationId: 'invite-C',
          ),
        );
      },
    );
  });
}

Map<String, Object?> _preparationResponse(List<String> ids) =>
    <String, Object?>{
      'schemaVersion': 1,
      'outcome': 'complete',
      'results': ids.map(_ready).toList(growable: false),
    };

Map<String, Object?> _ready(String id, {String? name}) => <String, Object?>{
  'catalogRestaurantId': id,
  'outcome': 'ready',
  'restaurantName': name ?? 'Restaurant $id',
  'labels': <Object?>[
    _label('I', id),
    _label('C', id),
    _label('SA', id),
    _label('SR', id),
  ],
};

Map<String, Object?> _label(String type, String id) => switch (type) {
  'I' => <String, Object?>{
    'type': type,
    'payloadUrl': 'https://go.bitestar.app/invite/coupon/token-I',
    'invitationId': 'invite-I',
    'invitationExpiresAtMillis': 2000000000000,
  },
  'C' => <String, Object?>{
    'type': type,
    'payloadUrl': 'https://go.bitestar.app/invite/bitescore/token-C',
    'invitationId': 'invite-C',
    'invitationExpiresAtMillis': 2000000000000,
  },
  'SA' => <String, Object?>{
    'type': type,
    'payloadUrl':
        'https://go.bitestar.app/r/coupons/${Uri.encodeComponent(id)}',
  },
  'SR' => <String, Object?>{
    'type': type,
    'payloadUrl':
        'https://go.bitestar.app/r/bitescore/${Uri.encodeComponent(id)}',
  },
  _ => throw ArgumentError.value(type),
};

AdminRestaurantQrArtifactRestaurant _artifactRestaurant(String id) =>
    AdminRestaurantQrReadyRestaurant.fromCallableData(
      _ready(id),
    ).toArtifactRestaurant();

AdminRestaurantQrMarkingRequest _markingRequest(String id) =>
    AdminRestaurantQrMarkingRequest(<AdminRestaurantQrMarkingRestaurantRequest>[
      AdminRestaurantQrMarkingRestaurantRequest(
        catalogRestaurantId: id,
        labels: <AdminRestaurantQrMarkingLabelRequest>[
          AdminRestaurantQrMarkingLabelRequest(
            type: AdminRestaurantQrLabelType.ownerInvite,
            invitationId: 'invite-I',
          ),
          AdminRestaurantQrMarkingLabelRequest(
            type: AdminRestaurantQrLabelType.claimInvite,
            invitationId: 'invite-C',
          ),
          AdminRestaurantQrMarkingLabelRequest(
            type: AdminRestaurantQrLabelType.biteSaverCustomer,
          ),
          AdminRestaurantQrMarkingLabelRequest(
            type: AdminRestaurantQrLabelType.biteScoreCustomer,
          ),
        ],
      ),
    ]);

Map<String, Object?> _markingResponse(AdminRestaurantQrMarkingRequest request) {
  final id = request.restaurants.single.catalogRestaurantId;
  return <String, Object?>{
    'schemaVersion': 1,
    'outcome': 'complete',
    'results': <Object?>[
      <String, Object?>{
        'catalogRestaurantId': id,
        'outcome': 'processed',
        'labels': <Object?>[
          <String, Object?>{'type': 'I', 'status': 'notRequired'},
          <String, Object?>{
            'type': 'C',
            'status': 'saved',
            'alreadySaved': true,
          },
          <String, Object?>{
            'type': 'SA',
            'status': 'saved',
            'alreadySaved': false,
          },
          <String, Object?>{
            'type': 'SR',
            'status': 'saved',
            'alreadySaved': false,
          },
        ],
        'preparation': _projection(id),
      },
    ],
  };
}

Map<String, Object?> _projection(String id) => <String, Object?>{
  'canonicalCatalogRestaurantId': id,
  'i': 'prepared',
  'c': 'prepared',
  'sa': 'notRequired',
  'sr': 'prepared',
};

Map<String, Object?> _withMarkingLabels(
  Map<String, Object?> original,
  List<Object?> labels,
) {
  final result = Map<String, Object?>.of(
    (original['results']! as List<Object?>).single as Map<String, Object?>,
  )..['labels'] = labels;
  return <String, Object?>{
    ...original,
    'results': <Object?>[result],
  };
}

Map<String, Object?> _withPreparation(
  Map<String, Object?> original,
  Map<String, Object?> preparation,
) {
  final result = Map<String, Object?>.of(
    (original['results']! as List<Object?>).single as Map<String, Object?>,
  )..['preparation'] = preparation;
  return <String, Object?>{
    ...original,
    'results': <Object?>[result],
  };
}
