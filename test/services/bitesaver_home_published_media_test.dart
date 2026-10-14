import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitesaver_restaurant_media.dart';
import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/daily_special.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/screens/home_screen.dart';
import 'package:coupon_app/services/restaurant_account_service.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const accountId = 'owner-cafe';
final publicId = 'bsr_${List.filled(43, 'A').join()}';
const manual = DailySpecial(
  id: 'manual-one',
  restaurantId: accountId,
  ownerUid: accountId,
  title: 'Manual soup',
  hideWhenUnavailable: false,
);
const retainedBoard = DailySpecial(
  id: 'bitesaver_managed_board',
  restaurantId: accountId,
  ownerUid: accountId,
  title: 'Old retained board',
  hideWhenUnavailable: false,
);
const publishedBoard = DailySpecial(
  id: 'board',
  restaurantId: 'opaque-server-id',
  ownerUid: 'opaque-server-id',
  title: 'Published photo board',
  hideWhenUnavailable: false,
  imageUrl: 'https://example.test/board.png',
);
const coupon = Coupon(
  id: 'coupon',
  restaurantAccountId: accountId,
  restaurant: 'Local Cafe',
  title: 'Preserved coupon',
  distance: '',
  usageRule: 'Once per customer',
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final retained = [manual, retainedBoard];
  var rawReads = 0;
  var mediaReads = 0;
  var mode = 'manual';
  var fail = false;
  var mismatch = false;
  var includePublicId = true;
  DailySpecial? board = publishedBoard;

  Future<List<Restaurant>> load() =>
      RestaurantAccountService.loadApprovedRestaurantsWithCoupons(
        projectionLoader: () async => [
          CustomerRestaurantProjectionDocument(
            documentId: 'safe-index',
            data: {
              'publicProjectionVersion':
                  RestaurantAccountService.customerPublicProjectionVersion,
              'entityType': 'restaurant',
              'source': 'biteSaver',
              'sourceDocumentId': accountId,
              'indexDocumentId': 'safe-index',
              'publicVisible': true,
              'displayName': 'Local Cafe',
              'streetAddress': '123 Public Street',
              'city': 'Crystal River',
              'state': 'FL',
              'zipCode': '34428',
              'latitude': 28.85,
              'longitude': -82.49,
              if (includePublicId) 'publicRestaurantId': publicId,
            },
          ),
        ],
        couponLoader: (id) async {
          expect(id, accountId);
          return [coupon];
        },
        specialsLoader: (id) async {
          expect(id, accountId);
          rawReads++;
          return retained;
        },
        mediaLoader: (id) async {
          expect(id, publicId);
          mediaReads++;
          if (fail) throw StateError('Local simulated unavailable response');
          return BiteSaverRestaurantMedia(
            restaurantId: mismatch ? 'different-restaurant' : publicId,
            gallery: const [],
            photoBoard: mode == 'photo',
            board: mode == 'photo' ? board : null,
          );
        },
      );

  setUp(() {
    rawReads = mediaReads = 0;
    mode = 'manual';
    fail = mismatch = false;
    includePublicId = true;
    board = publishedBoard;
    retained
      ..clear()
      ..addAll([manual, retainedBoard]);
    SharedPreferences.setMockInitialValues({});
  });

  test('default Home loader selects manual and retains owner inputs', () async {
    final restaurant = (await load()).single;
    expect(restaurant.dailySpecials, [manual]);
    expect(restaurant.coupons, [coupon]);
    expect(retained, [manual, retainedBoard]);
    expect(rawReads, 1);
    expect(mediaReads, 1);
  });

  test(
    'photo mode uses authoritative board and preserves account identity',
    () async {
      mode = 'photo';
      final restaurant = (await load()).single;
      final special = restaurant.dailySpecials.single;
      expect(special.title, publishedBoard.title);
      expect(special.imageUrl, publishedBoard.imageUrl);
      expect(special.id, retainedBoard.id);
      expect(special.restaurantId, accountId);
      expect(special.ownerUid, accountId);
      expect(restaurant.accountDocumentId, accountId);
      expect(restaurant.coupons, [coupon]);
      expect(rawReads, 0);
      expect(retained, [manual, retainedBoard]);
    },
  );

  test(
    'absent or expired photo board never exposes retained manual entries',
    () async {
      mode = 'photo';
      board = null;
      retained.removeLast();
      expect((await load()).single.dailySpecials, isEmpty);
      expect(mediaReads, 1);
      expect(rawReads, 0);
    },
  );

  test(
    'failed authority lookup preserves coupons and retries on refresh',
    () async {
      fail = true;
      final unavailable = (await load()).single;
      expect(unavailable.dailySpecials, isEmpty);
      expect(unavailable.coupons, [coupon]);
      fail = false;
      mode = 'photo';
      expect(
        (await load()).single.dailySpecials.single.title,
        publishedBoard.title,
      );
      mode = 'manual';
      expect((await load()).single.dailySpecials, [manual]);
      expect(mediaReads, 3);
      expect(retained, [manual, retainedBoard]);
    },
  );

  test(
    'wrong restaurant response does not replace restaurant content',
    () async {
      mismatch = true;
      final restaurant = (await load()).single;
      expect(restaurant.dailySpecials, isEmpty);
      expect(restaurant.coupons, [coupon]);
      expect(rawReads, 0);
    },
  );

  test(
    'missing public identity fails closed without removing coupons',
    () async {
      includePublicId = false;
      final restaurant = (await load()).single;
      expect(restaurant.dailySpecials, isEmpty);
      expect(restaurant.coupons, [coupon]);
      expect(mediaReads, 0);
    },
  );

  for (final selectedMode in ['manual', 'photo']) {
    testWidgets(
      'legacy Home displays only $selectedMode specials from its loader',
      (tester) async {
        mode = selectedMode;
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = const Size(430, 1200);
        addTearDown(tester.view.reset);
        SharedLocationStateService.saveTypedLocation(
          latitude: 28.85,
          longitude: -82.49,
          label: 'Test location',
          searchText: '',
        );
        addTearDown(SharedLocationStateService.clear);
        await tester.pumpWidget(
          MaterialApp(
            home: HomeScreen(
              approvedAccountsStream:
                  const Stream<QuerySnapshot<Map<String, dynamic>>>.empty(),
              restaurantLoader: load,
              locationRestoreLoader: () async =>
                  const SharedLocationRestoreResult(
                    state: SharedLocationState(
                      usingTypedSearchLocation: true,
                      typedLatitude: 28.85,
                      typedLongitude: -82.49,
                      typedLabel: 'Test location',
                    ),
                  ),
              initializeFirebaseBackedState: false,
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          find.textContaining(
            selectedMode == 'manual' ? manual.title : publishedBoard.title,
          ),
          findsWidgets,
        );
        expect(
          find.textContaining(
            selectedMode == 'manual' ? publishedBoard.title : manual.title,
          ),
          findsNothing,
        );
        expect(find.textContaining(retainedBoard.title), findsNothing);
        expect(find.text(coupon.title), findsWidgets);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
