import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/screens/home_screen.dart';
import 'package:coupon_app/screens/restaurant_menu_screen.dart';
import 'package:coupon_app/screens/restaurant_profile_screen.dart';
import 'package:coupon_app/screens/restaurant_specials_screen.dart';
import 'package:coupon_app/services/restaurant_account_service.dart';
import 'package:coupon_app/services/restaurant_menu_service.dart';
import 'package:coupon_app/widgets/bitesaver_report_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(const <String, Object>{});
  });

  test(
    'canonical account ID prefers Firestore document ID over stored UID',
    () {
      expect(
        _restaurant(
          documentId: ' account-document ',
          uid: 'stored-owner',
        ).accountDocumentId,
        'account-document',
      );
      expect(
        _restaurant(
          documentId: ' matching-account ',
          uid: 'matching-account',
        ).accountDocumentId,
        'matching-account',
      );
      expect(
        _restaurant(documentId: '  ', uid: ' stored-owner ').accountDocumentId,
        'stored-owner',
      );
      expect(
        _restaurant(documentId: null, uid: null).accountDocumentId,
        isNull,
      );
    },
  );

  testWidgets(
    'home filtering preserves the canonical Firestore account document ID',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(1024, 1200);
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        MaterialApp(
          home: HomeScreen(
            approvedAccountsStream: const Stream.empty(),
            restaurantLoader: () async => const <Restaurant>[],
            initializeFirebaseBackedState: false,
          ),
        ),
      );
      await tester.pump();

      final dynamic homeState = tester.state(find.byType(HomeScreen));
      homeState.usingTypedSearchLocation = true;
      homeState.typedSearchCenter = const SearchCenter(
        latitude: 28.85,
        longitude: -82.49,
        label: 'Test location',
      );

      final filteredRestaurants =
          homeState.filterRestaurants(<Restaurant>[
                const Restaurant(
                  documentId: 'account-document',
                  uid: 'stored-owner',
                  name: 'Identity Cafe',
                  distance: Restaurant.defaultDistanceLabel,
                  city: 'Crystal River',
                  state: 'FL',
                  zipCode: '34428',
                  streetAddress: '1 Main Street',
                  latitude: 28.85,
                  longitude: -82.49,
                  coupons: <Coupon>[
                    Coupon(
                      id: 'identity-coupon',
                      restaurant: 'Identity Cafe',
                      title: 'Identity special',
                      distance: '',
                      usageRule: 'Unlimited',
                    ),
                  ],
                ),
              ])
              as List<Restaurant>;

      expect(filteredRestaurants, hasLength(1));
      expect(filteredRestaurants.single.documentId, 'account-document');
      expect(filteredRestaurants.single.uid, 'stored-owner');
      expect(filteredRestaurants.single.accountDocumentId, 'account-document');
      expect(tester.takeException(), isNull);
    },
  );

  test(
    'coupon visibility prefers the document ID and falls back to stored UID',
    () async {
      const coupon = Coupon(
        id: 'identity-coupon',
        restaurant: 'Identity Cafe',
        title: 'Identity special',
        distance: '',
        usageRule: 'Unlimited',
      );
      final loadedAccountIds = <String>[];

      Future<Map<String, dynamic>?> loadActiveAccount(
        String accountDocumentId,
      ) async {
        loadedAccountIds.add(accountDocumentId);
        return <String, dynamic>{
          Restaurant.fieldApprovalStatus: 'approved',
          'subscriptionStatus': 'active',
        };
      }

      expect(
        await RestaurantAccountService.isCouponCustomerVisible(
          coupon,
          restaurant: _restaurant(
            documentId: ' account-document ',
            uid: 'stored-owner',
          ),
          accountDataLoader: loadActiveAccount,
        ),
        isTrue,
      );
      expect(
        await RestaurantAccountService.isCouponCustomerVisible(
          coupon,
          restaurant: _restaurant(
            documentId: ' matching-account ',
            uid: 'matching-account',
          ),
          accountDataLoader: loadActiveAccount,
        ),
        isTrue,
      );
      expect(
        await RestaurantAccountService.isCouponCustomerVisible(
          coupon,
          restaurant: _restaurant(documentId: ' ', uid: ' legacy-owner '),
          accountDataLoader: loadActiveAccount,
        ),
        isTrue,
      );

      expect(loadedAccountIds, <String>[
        'account-document',
        'matching-account',
        'legacy-owner',
      ]);
    },
  );

  for (final scenario in <({String label, String documentId, String uid})>[
    (
      label: 'matching',
      documentId: 'matching-account',
      uid: 'matching-account',
    ),
    (label: 'mismatched', documentId: 'account-document', uid: 'stored-owner'),
  ]) {
    testWidgets(
      '${scenario.label} public menu and report use the account document ID',
      (tester) async {
        String? resolvedMenuAccountId;
        String? reportedRestaurantId;

        await tester.pumpWidget(
          MaterialApp(
            home: RestaurantProfileScreen(
              restaurant: _restaurant(
                documentId: scenario.documentId,
                uid: scenario.uid,
              ),
              loadFavorite: (restaurant) async => false,
              refreshRestaurant: (restaurant) async => null,
              resolvePublicMenu: (accountDocumentId) async {
                resolvedMenuAccountId = accountDocumentId;
                return RestaurantMenuSource.legacyBiteSaver('');
              },
              promptForReport: (context) async => const BiteSaverReportResult(
                reason: 'Incorrect information',
                note: 'The public identity is wrong.',
              ),
              submitReport:
                  ({
                    required reportType,
                    restaurantId,
                    couponId,
                    required reason,
                    note,
                  }) async {
                    expect(reportType, 'restaurant');
                    expect(reason, 'Incorrect information');
                    reportedRestaurantId = restaurantId;
                  },
            ),
          ),
        );
        await tester.pumpAndSettle();

        final reportButton = find.widgetWithText(TextButton, 'Report');
        await tester.ensureVisible(reportButton);
        await tester.tap(reportButton);
        await tester.pumpAndSettle();

        expect(reportedRestaurantId, scenario.documentId);

        final informationTile = find.text('Restaurant Information');
        await tester.ensureVisible(informationTile);
        await tester.tap(informationTile);
        await tester.pumpAndSettle();

        final menuLink = find.text('Menu');
        await tester.ensureVisible(menuLink);
        await tester.tap(menuLink);
        await tester.pumpAndSettle();

        expect(resolvedMenuAccountId, scenario.documentId);
        final menuScreen = tester.widget<RestaurantMenuScreen>(
          find.byType(RestaurantMenuScreen),
        );
        expect(menuScreen.restaurantUid, scenario.documentId);
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final scenario in <({String label, String documentId, String uid})>[
    (
      label: 'matching',
      documentId: 'matching-account',
      uid: 'matching-account',
    ),
    (label: 'mismatched', documentId: 'account-document', uid: 'stored-owner'),
  ]) {
    testWidgets(
      '${scenario.label} public specials use the account document ID',
      (tester) async {
        String? loadedAccountId;

        await tester.pumpWidget(
          MaterialApp(
            home: RestaurantSpecialsScreen(
              restaurant: _restaurant(
                documentId: scenario.documentId,
                uid: scenario.uid,
              ),
              loadSpecials: (accountDocumentId) async {
                loadedAccountId = accountDocumentId;
                return const [];
              },
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(loadedAccountId, scenario.documentId);
        expect(find.text('No specials posted right now.'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }

  group('production public-menu query identity', () {
    test(
      'mismatched stored UID reads only the canonical account and menu paths',
      () async {
        final boundary = _RecordingRestaurantMenuQueryBoundary(
          documents: {
            'restaurant_accounts/actual-doc-id': {
              RestaurantMenuService.menuSourceSideField:
                  RestaurantMenuService.menuSourceBiteSaver,
            },
            'restaurant_accounts/legacy-stored-uid': {
              RestaurantMenuService.menuSourceSideField:
                  RestaurantMenuService.menuSourceBiteScore,
              RestaurantMenuService.linkedBiteScoreRestaurantIdField:
                  'wrong-restaurant',
            },
          },
        );

        final source = await _resolveAndLoadPublicMenu(
          restaurant: _restaurant(
            documentId: ' actual-doc-id ',
            uid: 'legacy-stored-uid',
          ),
          boundary: boundary,
        );

        expect(source?.isLegacyBiteSaver, isTrue);
        expect(source?.id, 'actual-doc-id');
        expect(boundary.documentReads, <String>[
          'restaurant_accounts/actual-doc-id',
        ]);
        expect(
          boundary.collectionReads,
          unorderedEquals(<String>[
            'restaurant_accounts/actual-doc-id/menu_images',
            'restaurant_accounts/actual-doc-id/menu_items',
            'restaurant_accounts/actual-doc-id/menu_sections',
          ]),
        );
        expect(
          boundary.allReads.where((path) => path.contains('legacy-stored-uid')),
          isEmpty,
        );
        expect(
          boundary.allReads.where((path) => path.contains('/coupons')),
          isEmpty,
        );
      },
    );

    test('matching document and stored IDs query that exact ID', () async {
      final boundary = _RecordingRestaurantMenuQueryBoundary(
        documents: {
          'restaurant_accounts/matching-account': {
            RestaurantMenuService.menuSourceSideField:
                RestaurantMenuService.menuSourceBiteSaver,
          },
        },
      );

      final source = await _resolveAndLoadPublicMenu(
        restaurant: _restaurant(
          documentId: 'matching-account',
          uid: 'matching-account',
        ),
        boundary: boundary,
      );

      expect(source?.id, 'matching-account');
      expect(
        boundary.allReads,
        unorderedEquals(<String>[
          'restaurant_accounts/matching-account',
          'restaurant_accounts/matching-account/menu_images',
          'restaurant_accounts/matching-account/menu_items',
          'restaurant_accounts/matching-account/menu_sections',
        ]),
      );
    });

    test('missing document ID queries the stored UID fallback', () async {
      final boundary = _RecordingRestaurantMenuQueryBoundary(
        documents: {
          'restaurant_accounts/legacy-owner': {
            RestaurantMenuService.menuSourceSideField:
                RestaurantMenuService.menuSourceBiteSaver,
          },
        },
      );

      final source = await _resolveAndLoadPublicMenu(
        restaurant: _restaurant(documentId: ' ', uid: ' legacy-owner '),
        boundary: boundary,
      );

      expect(source?.id, 'legacy-owner');
      expect(
        boundary.allReads,
        unorderedEquals(<String>[
          'restaurant_accounts/legacy-owner',
          'restaurant_accounts/legacy-owner/menu_images',
          'restaurant_accounts/legacy-owner/menu_items',
          'restaurant_accounts/legacy-owner/menu_sections',
        ]),
      );
    });

    test('missing both IDs fails safely without any storage access', () async {
      final boundary = _RecordingRestaurantMenuQueryBoundary();

      final source = await _resolveAndLoadPublicMenu(
        restaurant: _restaurant(documentId: null, uid: null),
        boundary: boundary,
      );

      expect(source, isNull);
      expect(boundary.allReads, isEmpty);
    });
  });
}

Future<RestaurantMenuSource?> _resolveAndLoadPublicMenu({
  required Restaurant restaurant,
  required RestaurantMenuQueryBoundary boundary,
}) async {
  final source = await RestaurantMenuService.resolveBiteSaverPublicMenuSource(
    uid: restaurant.accountDocumentId ?? '',
    queryBoundary: boundary,
  );
  if (source == null) {
    return null;
  }

  await Future.wait([
    RestaurantMenuService.loadMenuImages(source, queryBoundary: boundary),
    RestaurantMenuService.loadMenuItems(source, queryBoundary: boundary),
    RestaurantMenuService.loadMenuSections(source, queryBoundary: boundary),
  ]);
  return source;
}

class _RecordingRestaurantMenuQueryBoundary
    implements RestaurantMenuQueryBoundary {
  final Map<String, Map<String, dynamic>> documents;
  final Map<String, List<RestaurantMenuQueryDocument>> collections;
  final List<String> documentReads = [];
  final List<String> collectionReads = [];

  _RecordingRestaurantMenuQueryBoundary({
    Map<String, Map<String, dynamic>>? documents,
    Map<String, List<RestaurantMenuQueryDocument>>? collections,
  }) : documents = documents ?? const {},
       collections = collections ?? const {};

  List<String> get allReads => <String>[...documentReads, ...collectionReads];

  @override
  Future<RestaurantMenuQueryDocument?> getDocument(String documentPath) async {
    documentReads.add(documentPath);
    final data = documents[documentPath];
    if (data == null) {
      return null;
    }
    return RestaurantMenuQueryDocument(
      id: documentPath.split('/').last,
      data: data,
    );
  }

  @override
  Future<List<RestaurantMenuQueryDocument>> getCollection(
    String collectionPath,
  ) async {
    collectionReads.add(collectionPath);
    return collections[collectionPath] ?? const [];
  }
}

Restaurant _restaurant({required String? documentId, required String? uid}) {
  return Restaurant(
    documentId: documentId,
    uid: uid,
    name: 'Identity Cafe',
    distance: '1.0 mi',
    city: 'Crystal River',
    state: 'FL',
    zipCode: '34428',
    streetAddress: '1 Main Street',
    coupons: const [],
  );
}
