import 'dart:async';

import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/daily_special.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/screens/coupon_detail_screen.dart';
import 'package:coupon_app/screens/home_screen.dart';
import 'package:coupon_app/screens/restaurant_menu_screen.dart';
import 'package:coupon_app/screens/restaurant_profile_screen.dart';
import 'package:coupon_app/screens/restaurant_specials_screen.dart';
import 'package:coupon_app/services/restaurant_account_service.dart';
import 'package:coupon_app/services/restaurant_menu_service.dart';
import 'package:coupon_app/widgets/bitesaver_report_dialog.dart';
import 'package:coupon_app/widgets/bitesaver_restaurant_images.dart';
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

  test(
    'home projection signature reacts only to public restaurant changes',
    () {
      final base = <MapEntry<String, Map<String, dynamic>>>[
        MapEntry('restaurant-index-1', <String, dynamic>{
          'sourceFingerprint': 'fingerprint-1',
          RestaurantAccountService.publicVisibleField: true,
          RestaurantAccountService.offerCatalogUpdatedAtField: DateTime.utc(
            2026,
            8,
            15,
            12,
          ),
        }),
      ];
      final baseSignature = buildBiteSaverHomeProjectionSignature(base);

      expect(buildBiteSaverHomeProjectionSignature(base), baseSignature);
      expect(
        buildBiteSaverHomeProjectionSignature(
          <MapEntry<String, Map<String, dynamic>>>[
            MapEntry('restaurant-index-1', <String, dynamic>{
              ...base.single.value,
              'email': 'private-owner@example.test',
              'subscriptionStatus': 'past_due',
              'updatedAt': DateTime.utc(2026, 8, 15, 13),
            }),
          ],
        ),
        baseSignature,
      );
      expect(
        buildBiteSaverHomeProjectionSignature(
          <MapEntry<String, Map<String, dynamic>>>[
            MapEntry('restaurant-index-1', <String, dynamic>{
              ...base.single.value,
              'sourceFingerprint': 'fingerprint-2',
            }),
          ],
        ),
        isNot(baseSignature),
      );
      expect(
        buildBiteSaverHomeProjectionSignature(
          <MapEntry<String, Map<String, dynamic>>>[
            MapEntry('restaurant-index-1', <String, dynamic>{
              ...base.single.value,
              RestaurantAccountService.publicVisibleField: false,
            }),
          ],
        ),
        isNot(baseSignature),
      );
      for (final changedAt in <DateTime>[
        DateTime.utc(2026, 8, 15, 12, 1),
        DateTime.utc(2026, 8, 15, 12, 2),
      ]) {
        expect(
          buildBiteSaverHomeProjectionSignature(
            <MapEntry<String, Map<String, dynamic>>>[
              MapEntry('restaurant-index-1', <String, dynamic>{
                ...base.single.value,
                RestaurantAccountService.offerCatalogUpdatedAtField: changedAt,
              }),
            ],
          ),
          isNot(baseSignature),
        );
      }
    },
  );

  testWidgets(
    'home reloads once per changed public signature and ignores identical snapshots',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(1024, 1200);
      addTearDown(tester.view.reset);
      final signatures = StreamController<String>.broadcast();
      addTearDown(signatures.close);
      var loadCount = 0;

      await tester.pumpWidget(
        MaterialApp(
          home: HomeScreen(
            approvedAccountsSignatureStream: signatures.stream,
            restaurantLoader: () async {
              loadCount += 1;
              return const <Restaurant>[];
            },
            initializeFirebaseBackedState: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(loadCount, 1);

      Future<void> emit(String signature) async {
        signatures.add(signature);
        await tester.pumpAndSettle();
      }

      await emit('restaurant|fingerprint-1|true|');
      expect(loadCount, 2);
      await emit('restaurant|fingerprint-1|true|');
      expect(loadCount, 2);
      await emit('restaurant|fingerprint-2|true|');
      expect(loadCount, 3);
      await emit('restaurant|fingerprint-2|false|');
      expect(loadCount, 4);
      await emit('restaurant|fingerprint-2|true|coupon-change');
      expect(loadCount, 5);
      await emit('restaurant|fingerprint-2|true|special-change');
      expect(loadCount, 6);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'rapid offer signals cannot let an older reload overwrite state',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(1024, 1200);
      addTearDown(tester.view.reset);
      final signatures = StreamController<String>.broadcast();
      addTearDown(signatures.close);
      final pendingLoads = <Completer<List<Restaurant>>>[];
      var loadCount = 0;

      Future<List<Restaurant>> loadRestaurants() {
        loadCount += 1;
        if (loadCount == 1) {
          return Future<List<Restaurant>>.value(const <Restaurant>[]);
        }
        final pending = Completer<List<Restaurant>>();
        pendingLoads.add(pending);
        return pending.future;
      }

      await tester.pumpWidget(
        MaterialApp(
          home: HomeScreen(
            approvedAccountsSignatureStream: signatures.stream,
            restaurantLoader: loadRestaurants,
            initializeFirebaseBackedState: false,
          ),
        ),
      );
      await tester.pumpAndSettle();

      signatures.add('restaurant|fingerprint|true|coupon-change');
      await tester.pump();
      await tester.pump();
      signatures.add('restaurant|fingerprint|true|special-change');
      await tester.pump();
      await tester.pump();
      expect(loadCount, 3);
      expect(pendingLoads, hasLength(2));

      pendingLoads.last.complete(const <Restaurant>[]);
      await tester.pumpAndSettle();
      pendingLoads.first.completeError(StateError('stale reload failure'));
      await tester.pumpAndSettle();

      expect(find.text('Could not load nearby deals right now.'), findsNothing);
      expect(tester.takeException(), isNull);
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
    'coupon visibility uses the stable account ID and safe projection',
    () async {
      const coupon = Coupon(
        id: 'identity-coupon',
        restaurantAccountId: 'coupon-account',
        restaurant: 'Identity Cafe',
        title: 'Identity special',
        distance: '',
        usageRule: 'Unlimited',
      );
      const restaurantCoupon = Coupon(
        id: 'restaurant-coupon',
        restaurantAccountId: 'account-document',
        restaurant: 'Identity Cafe',
        title: 'Restaurant identity special',
        distance: '',
        usageRule: 'Unlimited',
      );
      final loadedAccountIds = <String>[];
      final loadedCouponPaths = <String>[];

      Future<Map<String, dynamic>?> loadVisibleProjection(
        String accountDocumentId,
      ) async {
        loadedAccountIds.add(accountDocumentId);
        return _publicProjection(accountDocumentId);
      }

      Future<Map<String, dynamic>?> loadCoupon(
        String accountDocumentId,
        String couponId,
      ) async {
        loadedCouponPaths.add('$accountDocumentId/$couponId');
        return <String, dynamic>{
          'restaurant': 'Identity Cafe',
          'title': 'Identity special',
          'distance': '',
          'usageRule': 'Unlimited',
          'startTime': DateTime.now().subtract(const Duration(hours: 1)),
          'endTime': DateTime.now().add(const Duration(hours: 1)),
        };
      }

      expect(
        await RestaurantAccountService.isCouponCustomerVisible(
          restaurantCoupon,
          restaurant: _restaurant(
            documentId: ' account-document ',
            uid: 'stored-owner',
          ),
          projectionDataLoader: loadVisibleProjection,
        ),
        isTrue,
      );
      expect(
        await RestaurantAccountService.isCouponCustomerVisible(
          coupon,
          projectionDataLoader: loadVisibleProjection,
          couponDataLoader: loadCoupon,
        ),
        isTrue,
      );

      expect(
        await RestaurantAccountService.isCouponCustomerVisible(
          coupon,
          restaurant: _restaurant(
            documentId: 'different-account',
            uid: 'different-owner',
          ),
          projectionDataLoader: loadVisibleProjection,
        ),
        isFalse,
        reason: 'conflicting stable restaurant identities must fail closed',
      );

      expect(loadedAccountIds, <String>['account-document', 'coupon-account']);
      expect(loadedCouponPaths, <String>['coupon-account/identity-coupon']);

      expect(
        await RestaurantAccountService.isCouponCustomerVisible(
          coupon,
          projectionDataLoader: loadVisibleProjection,
          couponDataLoader: (_, _) async => null,
        ),
        isFalse,
        reason: 'saved coupons must still exist in their exact child path',
      );
    },
  );

  test(
    'direct coupon visibility requires an exact visible projection',
    () async {
      const coupon = Coupon(
        id: 'direct-visibility-coupon',
        restaurant: 'Identity Cafe',
        title: 'Direct visibility special',
        distance: '',
        usageRule: 'Unlimited',
      );
      final restaurant = _restaurant(
        documentId: 'account-document',
        uid: 'stored-owner',
      );

      expect(
        await RestaurantAccountService.isCouponCustomerVisible(
          coupon,
          restaurant: restaurant,
          projectionDataLoader: (_) async =>
              _publicProjection('account-document'),
        ),
        isTrue,
      );

      for (final projectionData in <Map<String, dynamic>?>[
        null,
        _publicProjection('account-document', publicVisible: false),
        _publicProjection('account-document', publicVisible: 'true'),
        _publicProjection('different-account'),
        <String, dynamic>{
          ..._publicProjection('account-document'),
          RestaurantAccountService.publicProjectionVersionField:
              'bitestar.bitesaver-public-restaurant.v0',
        },
      ]) {
        expect(
          await RestaurantAccountService.isCouponCustomerVisible(
            coupon,
            restaurant: restaurant,
            projectionDataLoader: (_) async => projectionData,
          ),
          isFalse,
        );
      }
    },
  );

  testWidgets(
    'account-backed profile stays fail-closed while visibility is unresolved',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1000);
      addTearDown(tester.view.reset);
      final projection = Completer<Map<String, dynamic>?>();

      await tester.pumpWidget(
        MaterialApp(
          home: RestaurantProfileScreen(
            restaurant: _restaurant(
              documentId: 'pending-account',
              uid: 'pending-owner',
            ),
            loadFavorite: (_) async => false,
            loadProjectionData: (_) => projection.future,
          ),
        ),
      );
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('Identity Cafe'), findsNothing);
      expect(find.text('Available Coupons'), findsNothing);

      projection.complete(
        _publicProjection('pending-account', publicVisible: false),
      );
      await tester.pumpAndSettle();

      expect(
        find.text('This restaurant is not currently available in BiteSaver.'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'hidden account replaces stale customer profile with unavailable state',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1000);
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        MaterialApp(
          home: RestaurantProfileScreen(
            restaurant: _restaurant(
              documentId: 'hidden-account',
              uid: 'hidden-owner',
            ),
            loadFavorite: (_) async => false,
            loadProjectionData: (_) async =>
                _publicProjection('hidden-account', publicVisible: false),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.text('This restaurant is not currently available in BiteSaver.'),
        findsOneWidget,
      );
      expect(find.text('Identity Cafe'), findsNothing);
      expect(find.text('Available Coupons'), findsNothing);
    },
  );

  testWidgets('profile without a stable restaurant ID fails closed', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: RestaurantProfileScreen(
          restaurant: _restaurant(documentId: null, uid: null),
          loadFavorite: (_) async => false,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('This restaurant is not currently available in BiteSaver.'),
      findsOneWidget,
    );
    expect(find.text('Identity Cafe'), findsNothing);
  });

  testWidgets('blocked direct coupon details remain non-redeemable', (
    tester,
  ) async {
    const coupon = Coupon(
      id: 'blocked-direct-coupon',
      restaurant: 'Identity Cafe',
      title: 'Blocked Direct Coupon',
      distance: '',
      usageRule: 'Once per customer',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: CouponDetailScreen(
          coupon: coupon,
          restaurant: _restaurant(
            documentId: 'blocked-account',
            uid: 'blocked-owner',
          ),
          loadFavoriteState: (_) async => false,
          loadCustomerVisibility: (_, _) async => false,
          initializeRedemptionStore: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Not Available'), findsOneWidget);
    expect(find.text('This offer is no longer available.'), findsWidgets);
    expect(
      tester
          .widget<ElevatedButton>(
            find.widgetWithText(ElevatedButton, 'Not Available'),
          )
          .onPressed,
      isNull,
    );
  });

  testWidgets('coupon visibility lookup failure remains non-redeemable', (
    tester,
  ) async {
    const coupon = Coupon(
      id: 'failed-direct-coupon',
      restaurant: 'Identity Cafe',
      title: 'Failed Direct Coupon',
      distance: '',
      usageRule: 'Once per customer',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: CouponDetailScreen(
          coupon: coupon,
          loadFavoriteState: (_) async => false,
          loadCustomerVisibility: (_, _) async =>
              throw StateError('synthetic visibility failure'),
          initializeRedemptionStore: () async {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Not Available'), findsOneWidget);
    expect(
      tester
          .widget<ElevatedButton>(
            find.widgetWithText(ElevatedButton, 'Not Available'),
          )
          .onPressed,
      isNull,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('restaurant refresh failure clears stale customer offers', (
    tester,
  ) async {
    const staleCoupon = Coupon(
      id: 'stale-profile-coupon',
      restaurant: 'Identity Cafe',
      title: 'Stale Profile Coupon',
      distance: '',
      usageRule: 'Unlimited',
    );
    const staleSpecial = DailySpecial(
      id: 'stale-profile-special',
      restaurantId: 'blocked-account',
      ownerUid: 'blocked-owner',
      title: 'Stale Profile Special',
      isActive: true,
      availabilityMode: DailySpecialAvailabilityMode.specificDays,
      daysOfWeek: <int>[
        DateTime.monday,
        DateTime.tuesday,
        DateTime.wednesday,
        DateTime.thursday,
        DateTime.friday,
        DateTime.saturday,
        DateTime.sunday,
      ],
      allDay: true,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: RestaurantProfileScreen(
          restaurant: _restaurant(
            documentId: 'blocked-account',
            uid: 'blocked-owner',
            coupons: const <Coupon>[staleCoupon],
            dailySpecials: const <DailySpecial>[staleSpecial],
          ),
          loadFavorite: (_) async => false,
          refreshRestaurant: (_) async =>
              throw StateError('synthetic blocked refresh'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text(staleCoupon.title), findsNothing);
    expect(find.text(staleSpecial.title), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'public restaurant detail delegates its complete image URL to shared rendering',
    (tester) async {
      const imageUrl =
          'https://firebasestorage.googleapis.com/v0/b/example.appspot.com/o/'
          'restaurants%2Fidentity-cafe.jpg?alt=media&token=synthetic-token';

      await tester.pumpWidget(
        MaterialApp(
          home: RestaurantProfileScreen(
            restaurant: _restaurant(
              documentId: 'account-document',
              uid: 'stored-owner',
              mainImageUrl: imageUrl,
            ),
            loadFavorite: (restaurant) async => false,
            refreshRestaurant: (restaurant) async => null,
          ),
        ),
      );

      final image = tester.widget<BiteSaverRestaurantImage>(
        find.byType(BiteSaverRestaurantImage),
      );
      expect(image.imageUrl, imageUrl);
      expect(image.semanticLabel, 'Identity Cafe restaurant image');
      expect(
        BiteSaverRestaurantImage.networkWebHtmlElementStrategy,
        WebHtmlElementStrategy.prefer,
      );
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

  testWidgets('unavailable public menu cannot fall back to account children', (
    tester,
  ) async {
    final restaurant = _restaurant(
      documentId: 'menu-unavailable',
      uid: 'private-owner-id',
    );
    await tester.pumpWidget(
      MaterialApp(
        home: RestaurantProfileScreen(
          restaurant: restaurant,
          loadFavorite: (_) async => false,
          refreshRestaurant: (_) async => restaurant,
          resolvePublicMenu: (_) async => null,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Restaurant Information'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Menu'));
    await tester.pumpAndSettle();

    expect(find.byType(RestaurantMenuScreen), findsNothing);
    expect(find.text('Menu is not available right now.'), findsOneWidget);
  });

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

  testWidgets('specials without a stable restaurant ID discard embedded data', (
    tester,
  ) async {
    final embedded = DailySpecial(
      id: 'embedded-special',
      restaurantId: 'missing-account',
      ownerUid: 'private-owner',
      title: 'Must not render',
      isActive: true,
      availabilityMode: DailySpecialAvailabilityMode.specificDays,
      daysOfWeek: <int>[DateTime.now().weekday],
      allDay: true,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: RestaurantSpecialsScreen(
          restaurant: _restaurant(
            documentId: null,
            uid: null,
            dailySpecials: <DailySpecial>[embedded],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Must not render'), findsNothing);
    expect(find.text('No specials posted right now.'), findsOneWidget);
  });

  group('production public-menu query identity', () {
    test(
      'mismatched stored UID reads only the canonical account and menu paths',
      () async {
        final boundary = _RecordingRestaurantMenuQueryBoundary(
          projections: {
            'actual-doc-id': _publicProjection(
              'actual-doc-id',
              overrides: <String, dynamic>{
                RestaurantMenuService.menuSourceSideField:
                    RestaurantMenuService.menuSourceBiteSaver,
              },
            ),
            'legacy-stored-uid': _publicProjection(
              'legacy-stored-uid',
              overrides: <String, dynamic>{
                RestaurantMenuService.menuSourceSideField:
                    RestaurantMenuService.menuSourceBiteScore,
                RestaurantMenuService.linkedBiteScoreRestaurantIdField:
                    'wrong-restaurant',
              },
            ),
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
        expect(boundary.projectionReads, <String>['actual-doc-id']);
        expect(boundary.documentReads, isEmpty);
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
        projections: {
          'matching-account': _publicProjection(
            'matching-account',
            overrides: <String, dynamic>{
              RestaurantMenuService.menuSourceSideField:
                  RestaurantMenuService.menuSourceBiteSaver,
            },
          ),
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
          'restaurant_search_index/matching-account',
          'restaurant_accounts/matching-account/menu_images',
          'restaurant_accounts/matching-account/menu_items',
          'restaurant_accounts/matching-account/menu_sections',
        ]),
      );
    });

    test('missing document ID queries the stored UID fallback', () async {
      final boundary = _RecordingRestaurantMenuQueryBoundary(
        projections: {
          'legacy-owner': _publicProjection(
            'legacy-owner',
            overrides: <String, dynamic>{
              RestaurantMenuService.menuSourceSideField:
                  RestaurantMenuService.menuSourceBiteSaver,
            },
          ),
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
          'restaurant_search_index/legacy-owner',
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
  required _RecordingRestaurantMenuQueryBoundary boundary,
}) async {
  final source = await RestaurantMenuService.resolveBiteSaverPublicMenuSource(
    uid: restaurant.accountDocumentId ?? '',
    projectionLoader: boundary.loadProjection,
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
  final Map<String, Map<String, dynamic>> projections;
  final Map<String, Map<String, dynamic>> documents;
  final Map<String, List<RestaurantMenuQueryDocument>> collections;
  final List<String> projectionReads = [];
  final List<String> documentReads = [];
  final List<String> collectionReads = [];

  _RecordingRestaurantMenuQueryBoundary({
    Map<String, Map<String, dynamic>>? projections,
    Map<String, Map<String, dynamic>>? documents,
    Map<String, List<RestaurantMenuQueryDocument>>? collections,
  }) : projections = projections ?? const {},
       documents = documents ?? const {},
       collections = collections ?? const {};

  List<String> get allReads => <String>[
    ...projectionReads.map((id) => 'restaurant_search_index/$id'),
    ...documentReads,
    ...collectionReads,
  ];

  Future<Map<String, dynamic>?> loadProjection(String restaurantId) async {
    projectionReads.add(restaurantId);
    return projections[restaurantId];
  }

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

Map<String, dynamic> _publicProjection(
  String restaurantId, {
  Object? publicVisible = true,
  Map<String, dynamic> overrides = const <String, dynamic>{},
}) {
  return <String, dynamic>{
    RestaurantAccountService.publicProjectionVersionField:
        RestaurantAccountService.customerPublicProjectionVersion,
    RestaurantAccountService.projectionEntityTypeField: 'restaurant',
    RestaurantAccountService.projectionSourceField: 'biteSaver',
    RestaurantAccountService.projectionSourceDocumentIdField: restaurantId,
    RestaurantAccountService.projectionIndexDocumentIdField:
        'index-$restaurantId',
    RestaurantAccountService.projectionDisplayNameField: 'Identity Cafe',
    Restaurant.fieldStreetAddress: '1 Main Street',
    Restaurant.fieldCity: 'Crystal River',
    Restaurant.fieldState: 'FL',
    Restaurant.fieldZipCode: '34428',
    RestaurantAccountService.publicVisibleField: publicVisible,
    ...overrides,
  };
}

Restaurant _restaurant({
  required String? documentId,
  required String? uid,
  String? mainImageUrl,
  List<Coupon> coupons = const <Coupon>[],
  List<DailySpecial> dailySpecials = const <DailySpecial>[],
}) {
  return Restaurant(
    documentId: documentId,
    uid: uid,
    name: 'Identity Cafe',
    distance: '1.0 mi',
    city: 'Crystal River',
    state: 'FL',
    zipCode: '34428',
    streetAddress: '1 Main Street',
    mainImageUrl: mainImageUrl,
    coupons: coupons,
    dailySpecials: dailySpecials,
  );
}
