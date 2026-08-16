import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/services/restaurant_account_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final bindingId = List<String>.filled(43, 'A').join();

  Map<String, dynamic> projection({
    String restaurantId = 'restaurant-account-1',
    String indexDocumentId = 'safe-index-1',
    Map<String, dynamic> overrides = const <String, dynamic>{},
  }) {
    return <String, dynamic>{
      'publicProjectionVersion':
          RestaurantAccountService.customerPublicProjectionVersion,
      'entityType': 'restaurant',
      'source': 'biteSaver',
      'sourceDocumentId': restaurantId,
      'indexDocumentId': indexDocumentId,
      'displayName': 'Projection Cafe',
      'streetAddress': '123 Public Street',
      'city': 'Crystal River',
      'state': 'FL',
      'zipCode': '34428',
      'formattedAddress': '123 Public Street, Crystal River, FL 34428',
      'phone': '(352) 555-0100',
      'website': 'projection.example.test',
      'bio': 'Public restaurant description.',
      'primaryImageUrl': 'https://images.example.test/restaurant.jpg',
      'businessHours': <Map<String, dynamic>>[
        for (final day in const <String>[
          'Sunday',
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
        ])
          <String, dynamic>{
            'day': day,
            'opensAt': '9:00 AM',
            'closesAt': '5:00 PM',
            'closed': day == 'Sunday',
          },
      ],
      'latitude': 28.8517,
      'longitude': -82.487,
      'publicVisible': true,
      ...overrides,
    };
  }

  CustomerRestaurantProjectionDocument projectionDocument({
    String restaurantId = 'restaurant-account-1',
    String indexDocumentId = 'safe-index-1',
    Map<String, dynamic> overrides = const <String, dynamic>{},
  }) => CustomerRestaurantProjectionDocument(
    documentId: indexDocumentId,
    data: projection(
      restaurantId: restaurantId,
      indexDocumentId: indexDocumentId,
      overrides: overrides,
    ),
  );

  Map<String, dynamic> catalog({
    String id = 'catalog-1',
    bool includeId = true,
    bool isActive = true,
    bool includeBinding = false,
    Object? binding,
    Map<String, dynamic> overrides = const <String, dynamic>{},
  }) => <String, dynamic>{
    if (includeId) 'id': id,
    'name': 'Catalog Cafe',
    'normalizedName': 'catalog cafe',
    'address': '456 Catalog Street',
    'city': 'Crystal River',
    'state': 'FL',
    'zip': '34428',
    'location': const GeoPoint(28.8517, -82.487),
    'restaurantWriteRevision': 1,
    'isActive': isActive,
    'active': isActive,
    if (includeBinding)
      RestaurantAccountService.biteSaverCatalogBindingIdField: binding,
    ...overrides,
  };

  test(
    'public projection parser carries only customer-safe restaurant data',
    () {
      final data = projection(
        overrides: <String, dynamic>{
          'email': 'owner-private@example.test',
          'phoneNumber': 'private-auth-phone',
          'uid': 'duplicate-private-uid',
          'subscriptionStatus': 'active',
          'stripeCustomerId': 'cus_private',
          'inviteTokenHash': 'private-invite-hash',
          'unknownLegacyField': 'private-legacy-value',
        },
      );

      final restaurant =
          RestaurantAccountService.customerRestaurantFromProjectionData(
            data,
            expectedRestaurantId: 'restaurant-account-1',
            projectionDocumentId: 'safe-index-1',
          );

      expect(restaurant, isNotNull);
      expect(restaurant!.documentId, 'restaurant-account-1');
      expect(restaurant.uid, isNull);
      expect(restaurant.name, 'Projection Cafe');
      expect(restaurant.phone, '(352) 555-0100');
      expect(restaurant.streetAddress, '123 Public Street');
      expect(restaurant.website, 'projection.example.test');
      expect(restaurant.bio, 'Public restaurant description.');
      expect(restaurant.businessHours, hasLength(7));
      expect(restaurant.latitude, 28.8517);
      expect(restaurant.longitude, -82.487);
      expect(restaurant.accountDocumentId, 'restaurant-account-1');
    },
  );

  test(
    'public projection parser fails closed for malformed contract state',
    () {
      final invalid = <Map<String, dynamic>>[
        projection(overrides: <String, dynamic>{'publicVisible': false}),
        projection(overrides: <String, dynamic>{'publicVisible': 'true'}),
        projection(overrides: <String, dynamic>{'source': 'biteScore'}),
        projection(overrides: <String, dynamic>{'entityType': 'dish'}),
        projection(
          overrides: <String, dynamic>{
            'publicProjectionVersion':
                'bitestar.bitesaver-public-restaurant.v0',
          },
        ),
        projection(overrides: <String, dynamic>{'displayName': ''}),
        projection(overrides: <String, dynamic>{'streetAddress': null}),
        projection(restaurantId: 'invalid/path'),
        projection(indexDocumentId: 'invalid/path'),
      ];

      for (final data in invalid) {
        expect(
          RestaurantAccountService.customerRestaurantFromProjectionData(data),
          isNull,
        );
      }
      expect(
        RestaurantAccountService.customerRestaurantFromProjectionData(
          projection(),
          expectedRestaurantId: 'different-restaurant',
        ),
        isNull,
      );
      expect(
        RestaurantAccountService.customerRestaurantFromProjectionData(
          projection(),
          projectionDocumentId: 'different-index',
        ),
        isNull,
      );
    },
  );

  test('public projection binding fields are paired and strict', () {
    final validBoundProjection = projection(
      overrides: <String, dynamic>{
        RestaurantAccountService.biteScoreCatalogRestaurantIdField: 'catalog-1',
        RestaurantAccountService.biteSaverCatalogBindingIdField: bindingId,
      },
    );
    expect(
      RestaurantAccountService.customerRestaurantFromProjectionData(
        validBoundProjection,
      ),
      isNotNull,
    );

    for (final invalidOverrides in <Map<String, dynamic>>[
      <String, dynamic>{
        RestaurantAccountService.biteScoreCatalogRestaurantIdField: 'catalog-1',
      },
      <String, dynamic>{
        RestaurantAccountService.biteSaverCatalogBindingIdField: bindingId,
      },
      <String, dynamic>{
        RestaurantAccountService.biteScoreCatalogRestaurantIdField: 'catalog/1',
        RestaurantAccountService.biteSaverCatalogBindingIdField: bindingId,
      },
      <String, dynamic>{
        RestaurantAccountService.biteScoreCatalogRestaurantIdField: 'catalog-1',
        RestaurantAccountService.biteSaverCatalogBindingIdField: bindingId
            .substring(1),
      },
      <String, dynamic>{
        RestaurantAccountService.biteScoreCatalogRestaurantIdField: 'catalog-1',
        RestaurantAccountService.biteSaverCatalogBindingIdField:
            '${bindingId.substring(1)}+',
      },
    ]) {
      expect(
        RestaurantAccountService.customerRestaurantFromProjectionData(
          projection(overrides: invalidOverrides),
        ),
        isNull,
      );
    }
  });

  test('existing account-ID link resolves after both bounded reads', () async {
    final accountReads = <String>[];
    final catalogReads = <String>[];
    var catalogBindingQueries = 0;

    final result =
        await RestaurantAccountService.resolveCustomerRestaurantAccountLink(
          'restaurant-account-1',
          accountProjectionLoader: (restaurantId) async {
            accountReads.add(restaurantId);
            return <CustomerRestaurantProjectionDocument>[projectionDocument()];
          },
          catalogDocumentLoader: (restaurantId) async {
            catalogReads.add(restaurantId);
            return null;
          },
          catalogProjectionLoader:
              ({
                required String catalogRestaurantId,
                required String bindingId,
              }) async {
                catalogBindingQueries += 1;
                return const <CustomerRestaurantProjectionDocument>[];
              },
        );

    expect(result.state, CustomerRestaurantLinkResolutionState.available);
    expect(result.account?.documentId, 'restaurant-account-1');
    expect(result.account?.accountUid, 'restaurant-account-1');
    expect(accountReads, <String>['restaurant-account-1']);
    expect(catalogReads, <String>['restaurant-account-1']);
    expect(catalogBindingQueries, 0);
  });

  test(
    'whitespace route IDs never resolve through a trimmed identity',
    () async {
      for (final routeId in const <String>[
        ' restaurant-account-1',
        'restaurant-account-1 ',
        ' restaurant-account-1 ',
        '   ',
      ]) {
        var accountReads = 0;
        var catalogReads = 0;
        var bindingQueries = 0;
        final result =
            await RestaurantAccountService.resolveCustomerRestaurantAccountLink(
              routeId,
              accountProjectionLoader: (_) async {
                accountReads += 1;
                return <CustomerRestaurantProjectionDocument>[
                  projectionDocument(),
                ];
              },
              catalogDocumentLoader: (_) async {
                catalogReads += 1;
                return catalog();
              },
              catalogProjectionLoader:
                  ({
                    required String catalogRestaurantId,
                    required String bindingId,
                  }) async {
                    bindingQueries += 1;
                    return <CustomerRestaurantProjectionDocument>[
                      projectionDocument(),
                    ];
                  },
            );

        expect(
          result.state,
          CustomerRestaurantLinkResolutionState.unavailable,
          reason: routeId.codeUnits.toString(),
        );
        expect(accountReads, 0, reason: routeId.codeUnits.toString());
        expect(catalogReads, 0, reason: routeId.codeUnits.toString());
        expect(bindingQueries, 0, reason: routeId.codeUnits.toString());
      }
    },
  );

  test(
    'noncanonical catalog IDs skip catalog reads but preserve account lookup',
    () async {
      final invalidIds = <String>[
        '.',
        '..',
        String.fromCharCodes(<int>[98, 97, 100, 0, 105, 100]),
        'bad${String.fromCharCode(0x200e)}id',
        List<String>.filled(1501, 'a').join(),
      ];

      for (final invalidId in invalidIds) {
        var accountReads = 0;
        var catalogReads = 0;
        final result =
            await RestaurantAccountService.resolveCustomerRestaurantAccountLink(
              invalidId,
              accountProjectionLoader: (_) async {
                accountReads += 1;
                return const <CustomerRestaurantProjectionDocument>[];
              },
              catalogDocumentLoader: (_) async {
                catalogReads += 1;
                return null;
              },
            );

        expect(result.state, CustomerRestaurantLinkResolutionState.unavailable);
        expect(accountReads, 1, reason: 'route: ${invalidId.codeUnits}');
        expect(catalogReads, 0, reason: 'route: ${invalidId.codeUnits}');
      }

      var legacyCatalogReads = 0;
      final legacyAccount =
          await RestaurantAccountService.resolveCustomerRestaurantAccountLink(
            '.',
            accountProjectionLoader: (restaurantId) async =>
                <CustomerRestaurantProjectionDocument>[
                  projectionDocument(
                    restaurantId: restaurantId,
                    indexDocumentId: 'legacy-account-index',
                  ),
                ],
            catalogDocumentLoader: (_) async {
              legacyCatalogReads += 1;
              return null;
            },
          );
      expect(
        legacyAccount.state,
        CustomerRestaurantLinkResolutionState.available,
      );
      expect(legacyAccount.account?.documentId, '.');
      expect(legacyCatalogReads, 0);
    },
  );

  test(
    'valid active unbound catalog is recognized without an account',
    () async {
      var catalogBindingQueries = 0;
      final result =
          await RestaurantAccountService.resolveCustomerRestaurantAccountLink(
            'catalog-1',
            accountProjectionLoader: (_) async => const [],
            catalogDocumentLoader: (_) async => catalog(),
            catalogProjectionLoader:
                ({
                  required String catalogRestaurantId,
                  required String bindingId,
                }) async {
                  catalogBindingQueries += 1;
                  return const <CustomerRestaurantProjectionDocument>[];
                },
          );

      expect(
        result.state,
        CustomerRestaurantLinkResolutionState.catalogNotAvailable,
      );
      expect(result.account, isNull);
      expect(catalogBindingQueries, 0);
    },
  );

  test('bound catalog resolves one exact cross-validated projection', () async {
    final lookups = <({String catalogRestaurantId, String bindingId})>[];
    final result =
        await RestaurantAccountService.resolveCustomerRestaurantAccountLink(
          'catalog-1',
          accountProjectionLoader: (_) async => const [],
          catalogDocumentLoader: (_) async =>
              catalog(includeBinding: true, binding: bindingId),
          catalogProjectionLoader:
              ({
                required String catalogRestaurantId,
                required String bindingId,
              }) async {
                lookups.add((
                  catalogRestaurantId: catalogRestaurantId,
                  bindingId: bindingId,
                ));
                return <CustomerRestaurantProjectionDocument>[
                  projectionDocument(
                    restaurantId: 'bound-account',
                    indexDocumentId: 'bound-index',
                    overrides: <String, dynamic>{
                      RestaurantAccountService
                              .biteScoreCatalogRestaurantIdField:
                          'catalog-1',
                      RestaurantAccountService.biteSaverCatalogBindingIdField:
                          bindingId,
                    },
                  ),
                ];
              },
        );

    expect(result.state, CustomerRestaurantLinkResolutionState.available);
    expect(result.account?.documentId, 'bound-account');
    expect(lookups, <({String catalogRestaurantId, String bindingId})>[
      (catalogRestaurantId: 'catalog-1', bindingId: bindingId),
    ]);
  });

  test(
    'bound direct account links require an exact reciprocal catalog binding',
    () async {
      final directProjection = projectionDocument(
        overrides: <String, dynamic>{
          RestaurantAccountService.biteScoreCatalogRestaurantIdField:
              'catalog-1',
          RestaurantAccountService.biteSaverCatalogBindingIdField: bindingId,
        },
      );

      Future<({CustomerRestaurantLinkResolution result, List<String> reads})>
      resolveWith(Map<String, dynamic>? reciprocalCatalog) async {
        final reads = <String>[];
        final result =
            await RestaurantAccountService.resolveCustomerRestaurantAccountLink(
              'restaurant-account-1',
              accountProjectionLoader: (_) async =>
                  <CustomerRestaurantProjectionDocument>[directProjection],
              catalogDocumentLoader: (documentId) async {
                reads.add(documentId);
                return documentId == 'catalog-1' ? reciprocalCatalog : null;
              },
              catalogProjectionLoader:
                  ({
                    required String catalogRestaurantId,
                    required String bindingId,
                  }) async => throw StateError('must not query'),
            );
        return (result: result, reads: reads);
      }

      final valid = await resolveWith(
        catalog(includeBinding: true, binding: bindingId),
      );
      expect(
        valid.result.state,
        CustomerRestaurantLinkResolutionState.available,
      );
      expect(valid.result.account?.documentId, 'restaurant-account-1');
      expect(valid.reads, <String>['restaurant-account-1', 'catalog-1']);

      for (final reciprocalCatalog in <Map<String, dynamic>>[
        catalog(isActive: false, includeBinding: true, binding: bindingId),
        catalog(
          includeBinding: true,
          binding: bindingId,
          overrides: const <String, dynamic>{'address': null},
        ),
        catalog(
          includeBinding: true,
          binding: bindingId,
          overrides: const <String, dynamic>{
            'restaurantWriteRevision':
                BitescoreRestaurant.maxRestaurantWriteRevision,
          },
        ),
        catalog(
          id: 'stale-compatibility-id',
          includeBinding: true,
          binding: bindingId,
        ),
      ]) {
        final preserved = await resolveWith(reciprocalCatalog);
        expect(
          preserved.result.state,
          CustomerRestaurantLinkResolutionState.available,
        );
      }

      for (final reciprocalCatalog in <Map<String, dynamic>?>[
        null,
        catalog(
          includeBinding: true,
          binding: List<String>.filled(43, 'B').join(),
        ),
        catalog(includeBinding: false),
      ]) {
        final invalid = await resolveWith(reciprocalCatalog);
        expect(
          invalid.result.state,
          CustomerRestaurantLinkResolutionState.unavailable,
          reason: '$reciprocalCatalog',
        );
        expect(invalid.result.account, isNull);
        expect(invalid.reads, <String>['restaurant-account-1', 'catalog-1']);
      }
    },
  );

  test(
    'same-name catalog restaurants resolve only by distinct exact IDs',
    () async {
      final secondBindingId = List<String>.filled(43, 'B').join();

      Future<CustomerRestaurantLinkResolution> resolve({
        required String catalogId,
        required String catalogBindingId,
        required String accountId,
      }) => RestaurantAccountService.resolveCustomerRestaurantAccountLink(
        catalogId,
        accountProjectionLoader: (_) async => const [],
        catalogDocumentLoader: (_) async => catalog(
          id: catalogId,
          includeBinding: true,
          binding: catalogBindingId,
        ),
        catalogProjectionLoader:
            ({
              required String catalogRestaurantId,
              required String bindingId,
            }) async {
              expect(catalogRestaurantId, catalogId);
              expect(bindingId, catalogBindingId);
              return <CustomerRestaurantProjectionDocument>[
                projectionDocument(
                  restaurantId: accountId,
                  indexDocumentId: 'index-$accountId',
                  overrides: <String, dynamic>{
                    RestaurantAccountService.biteScoreCatalogRestaurantIdField:
                        catalogId,
                    RestaurantAccountService.biteSaverCatalogBindingIdField:
                        catalogBindingId,
                  },
                ),
              ];
            },
      );

      final first = await resolve(
        catalogId: 'same-name-catalog-1',
        catalogBindingId: bindingId,
        accountId: 'same-name-account-1',
      );
      final second = await resolve(
        catalogId: 'same-name-catalog-2',
        catalogBindingId: secondBindingId,
        accountId: 'same-name-account-2',
      );

      expect(first.state, CustomerRestaurantLinkResolutionState.available);
      expect(second.state, CustomerRestaurantLinkResolutionState.available);
      expect(first.account?.documentId, 'same-name-account-1');
      expect(second.account?.documentId, 'same-name-account-2');
    },
  );

  test(
    'missing, hidden, malformed, and contradictory catalogs fail closed',
    () async {
      final cases = <Map<String, dynamic>?>[
        null,
        catalog(isActive: false),
        catalog(includeId: false),
        catalog(id: 'different-catalog'),
        catalog(
          overrides: const <String, dynamic>{'isActive': true, 'active': false},
        ),
        catalog(overrides: const <String, dynamic>{'address': null}),
        catalog(overrides: const <String, dynamic>{'city': null}),
        catalog(overrides: const <String, dynamic>{'state': null}),
        catalog(overrides: const <String, dynamic>{'zip': null}),
        catalog(overrides: const <String, dynamic>{'location': GeoPoint(0, 0)}),
        catalog(
          overrides: const <String, dynamic>{
            'restaurantWriteRevision':
                BitescoreRestaurant.maxRestaurantWriteRevision,
          },
        ),
        catalog(includeBinding: true, binding: null),
        catalog(includeBinding: true, binding: bindingId.substring(1)),
      ];

      for (final catalogData in cases) {
        final result =
            await RestaurantAccountService.resolveCustomerRestaurantAccountLink(
              'catalog-1',
              accountProjectionLoader: (_) async => const [],
              catalogDocumentLoader: (_) async => catalogData,
              catalogProjectionLoader:
                  ({
                    required String catalogRestaurantId,
                    required String bindingId,
                  }) async => throw StateError('must not query'),
            );
        expect(
          result.state,
          CustomerRestaurantLinkResolutionState.unavailable,
          reason: '$catalogData',
        );
      }
    },
  );

  test(
    'nonpublic, malformed, and duplicate bound projections fail closed',
    () async {
      Future<CustomerRestaurantLinkResolution> resolveWith(
        List<CustomerRestaurantProjectionDocument> matches,
      ) => RestaurantAccountService.resolveCustomerRestaurantAccountLink(
        'catalog-1',
        accountProjectionLoader: (_) async => const [],
        catalogDocumentLoader: (_) async =>
            catalog(includeBinding: true, binding: bindingId),
        catalogProjectionLoader:
            ({
              required String catalogRestaurantId,
              required String bindingId,
            }) async => matches,
      );

      final validFields = <String, dynamic>{
        RestaurantAccountService.biteScoreCatalogRestaurantIdField: 'catalog-1',
        RestaurantAccountService.biteSaverCatalogBindingIdField: bindingId,
      };
      final invalidMatches = <List<CustomerRestaurantProjectionDocument>>[
        const <CustomerRestaurantProjectionDocument>[],
        <CustomerRestaurantProjectionDocument>[
          projectionDocument(
            overrides: <String, dynamic>{
              ...validFields,
              RestaurantAccountService.publicVisibleField: false,
            },
          ),
        ],
        <CustomerRestaurantProjectionDocument>[
          projectionDocument(
            overrides: <String, dynamic>{
              ...validFields,
              RestaurantAccountService.biteScoreCatalogRestaurantIdField:
                  'different-catalog',
            },
          ),
        ],
        <CustomerRestaurantProjectionDocument>[
          projectionDocument(overrides: validFields),
          projectionDocument(
            restaurantId: 'different-account',
            indexDocumentId: 'different-index',
            overrides: validFields,
          ),
        ],
      ];

      for (final matches in invalidMatches) {
        final result = await resolveWith(matches);
        expect(result.state, CustomerRestaurantLinkResolutionState.unavailable);
        expect(result.account, isNull);
      }
    },
  );

  test('account and catalog interpretation conflicts fail closed', () async {
    final direct = projectionDocument(
      restaurantId: 'catalog-1',
      indexDocumentId: 'direct-index',
    );

    final unboundConflict =
        await RestaurantAccountService.resolveCustomerRestaurantAccountLink(
          'catalog-1',
          accountProjectionLoader: (_) async =>
              <CustomerRestaurantProjectionDocument>[direct],
          catalogDocumentLoader: (_) async => catalog(),
        );
    expect(
      unboundConflict.state,
      CustomerRestaurantLinkResolutionState.unavailable,
    );

    final boundConflict =
        await RestaurantAccountService.resolveCustomerRestaurantAccountLink(
          'catalog-1',
          accountProjectionLoader: (_) async =>
              <CustomerRestaurantProjectionDocument>[direct],
          catalogDocumentLoader: (_) async =>
              catalog(includeBinding: true, binding: bindingId),
          catalogProjectionLoader:
              ({
                required String catalogRestaurantId,
                required String bindingId,
              }) async => <CustomerRestaurantProjectionDocument>[
                projectionDocument(
                  restaurantId: 'different-account',
                  indexDocumentId: 'different-index',
                  overrides: <String, dynamic>{
                    RestaurantAccountService.biteScoreCatalogRestaurantIdField:
                        catalogRestaurantId,
                    RestaurantAccountService.biteSaverCatalogBindingIdField:
                        bindingId,
                  },
                ),
              ],
        );
    expect(
      boundConflict.state,
      CustomerRestaurantLinkResolutionState.unavailable,
    );
  });

  test('matching account and catalog interpretations resolve once', () async {
    final sharedProjection = projectionDocument(
      restaurantId: 'catalog-1',
      indexDocumentId: 'shared-index',
      overrides: <String, dynamic>{
        RestaurantAccountService.biteScoreCatalogRestaurantIdField: 'catalog-1',
        RestaurantAccountService.biteSaverCatalogBindingIdField: bindingId,
      },
    );
    final result =
        await RestaurantAccountService.resolveCustomerRestaurantAccountLink(
          'catalog-1',
          accountProjectionLoader: (_) async =>
              <CustomerRestaurantProjectionDocument>[sharedProjection],
          catalogDocumentLoader: (_) async =>
              catalog(includeBinding: true, binding: bindingId),
          catalogProjectionLoader:
              ({
                required String catalogRestaurantId,
                required String bindingId,
              }) async => <CustomerRestaurantProjectionDocument>[
                sharedProjection,
              ],
        );

    expect(result.state, CustomerRestaurantLinkResolutionState.available);
    expect(result.account?.documentId, 'catalog-1');
  });

  test('duplicate direct account projections fail closed', () async {
    final result =
        await RestaurantAccountService.resolveCustomerRestaurantAccountLink(
          'restaurant-account-1',
          accountProjectionLoader: (_) async =>
              <CustomerRestaurantProjectionDocument>[
                projectionDocument(),
                projectionDocument(indexDocumentId: 'duplicate-index'),
              ],
          catalogDocumentLoader: (_) async => null,
        );

    expect(result.state, CustomerRestaurantLinkResolutionState.unavailable);
    expect(result.account, isNull);
  });

  test('catalog binding lookup stays equality-only and bounded', () {
    final source = File(
      'lib/services/restaurant_account_service.dart',
    ).readAsStringSync();
    final start = source.indexOf(
      '_loadCustomerRestaurantProjectionMatchesByCatalogBinding',
    );
    final end = source.indexOf(
      'static Restaurant? customerRestaurantFromProjectionData',
      start,
    );
    final lookup = source.substring(start, end);

    expect(lookup, contains('_customerRestaurantProjectionQuery()'));
    expect(lookup, contains('biteScoreCatalogRestaurantIdField'));
    expect(lookup, contains('biteSaverCatalogBindingIdField'));
    expect(lookup, contains('.limit(2)'));
    expect(lookup, isNot(contains('displayName')));
    expect(lookup, isNot(contains('streetAddress')));
    expect(lookup, isNot(contains("collection('restaurant_accounts')")));

    final indexes = File('firestore.indexes.json').readAsStringSync();
    expect(indexes, isNot(contains('biteScoreCatalogRestaurantId')));
    expect(indexes, isNot(contains('biteSaverCatalogBindingId')));
  });

  test('coupon stable restaurant ID is runtime-only and survives copies', () {
    final now = DateTime(2026, 8, 15, 12);
    final coupon = Coupon(
      id: 'coupon-1',
      restaurantAccountId: 'restaurant-account-1',
      restaurant: 'Projection Cafe',
      title: 'Lunch special',
      distance: '',
      startTime: now,
      endTime: now.add(const Duration(hours: 1)),
      usageRule: 'Unlimited',
    );

    expect(
      coupon.copyWith(title: 'Updated').restaurantAccountId,
      'restaurant-account-1',
    );
    expect(coupon.toFirestoreMap(), isNot(contains('restaurantAccountId')));
  });
}
