import 'dart:convert';
import 'dart:io';
import 'package:coupon_app/models/bitesaver_restaurant_media.dart';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:coupon_app/models/daily_special.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/screens/bitesaver_photo_viewer.dart';
import 'package:coupon_app/screens/restaurant_profile_screen.dart';
import 'package:coupon_app/screens/restaurant_specials_screen.dart';
import 'package:coupon_app/services/customer_bitesaver_public_profile.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:coupon_app/widgets/bitesaver_profile_deal_card.dart';
import 'package:coupon_app/widgets/bitesaver_restaurant_images.dart';
import 'package:coupon_app/widgets/bitesaver_specials_board.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

Map<String, dynamic> fixture() {
  final data =
      jsonDecode(
            File(
              'test/fixtures/customer_bitesaver_client_boundary_v1.json',
            ).readAsStringSync(),
          )
          as Map;
  return Map<String, dynamic>.from(
    data['signed']['responses']['restaurantPage']['restaurants'][0] as Map,
  );
}

DailySpecial special(String id, {String? image}) => DailySpecial(
  id: id,
  restaurantId: 'account',
  ownerUid: 'account',
  title: id,
  availabilityMode: DailySpecialAvailabilityMode.specificDays,
  daysOfWeek: const [1, 2, 3, 4, 5, 6, 7],
  imageUrl: image,
);
Future<CustomerBiteSaverPublicProfile> profile(
  WidgetTester tester, {
  bool photo = false,
  bool fail = false,
  double scale = 1,
}) async {
  final data = fixture();
  final base = Map<String, dynamic>.from((data['offers'] as List).first as Map);
  data['offers'] = [
    ...data['offers'],
    {
      ...base,
      'offerId': 'bso_${'s' * 43}',
      'offerType': 'dailySpecial',
      'usagePolicy': null,
      'title': 'Manual soup',
      'imageUrl': 'https://example.test/soup.png',
    },
  ];
  data['usableOfferCount'] = 3;
  final result = CustomerBiteSaverPublicProfileResult.fromJson({
    'schemaVersion': 1,
    'kind': 'publicProfile',
    'catalogRestaurantId': 'catalog',
    'state': 'available',
    'restaurant': data,
    'nextCursor': null,
    'hasMore': false,
    'partial': false,
    'favoriteStates': [],
  });
  final notifier = ChangeNotifier();
  final model = CustomerBiteSaverPublicProfile(
    CustomerBiteSaverService(),
    result,
    () async => (timeZone: 'America/New_York', utcOffsetMinutes: -240),
    (_) async => result,
    (_) => null,
    () => DateTime.now().millisecondsSinceEpoch,
    notifier,
    () {},
  );
  addTearDown(() {
    model.dispose();
    notifier.dispose();
  });
  await tester.pumpWidget(
    MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: RestaurantProfileScreen.fromPublicProfile(
        profile: model,
        openBoundedOffer: (_, _) async {},
        openBoundedMenu: (_) async {},
        loadMedia: (id) async {
          if (fail) throw StateError('Local media unavailable');
          return BiteSaverRestaurantMedia(
            restaurantId: id,
            gallery: const [
              'https://example.test/main.png',
              'https://example.test/second.png',
            ],
            photoBoard: photo,
            board: photo
                ? special('board', image: 'https://example.test/board.png')
                : null,
          );
        },
      ),
    ),
  );
  await tester.pumpAndSettle();
  return model;
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets(
    'profile gallery binds loaded photos and preserves compact coupon controls',
    (tester) async {
      await profile(tester);
      await tester.ensureVisible(
        find.byKey(const ValueKey('profile-main-photo')),
      );
      await tester.tap(find.byKey(const ValueKey('profile-main-photo')));
      await tester.pumpAndSettle();
      expect(find.byType(BiteSaverPhotoViewer), findsOneWidget);
      expect(find.text('1 / 2'), findsOneWidget);
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      expect(find.text('2 / 2'), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('View More Coupons'), findsOneWidget);
      expect(find.text('Fixture Coupon 2'), findsNothing);
    },
  );
  testWidgets(
    'photo board replaces manual entries in profile and dedicated board with enlargement',
    (tester) async {
      await profile(tester, photo: true);
      final board = find.byKey(const ValueKey('daily-specials-board-photo'));
      await tester.scrollUntilVisible(board, 300);
      await tester.pumpAndSettle();
      expect(find.text('Manual soup'), findsNothing);
      expect(find.byType(BiteSaverSpecialsBoard), findsOneWidget);
      await tester.tap(board);
      await tester.pumpAndSettle();
      expect(find.byType(BiteSaverPhotoViewer), findsOneWidget);
      expect(
        tester
            .widget<BiteSaverPhotoViewer>(find.byType(BiteSaverPhotoViewer))
            .imageUrl,
        'https://example.test/board.png',
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'manual thumbnail is bounded and text-only entries have no image holder',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                BiteSaverLegacySpecialsEntry(
                  special: special(
                    'Soup',
                    image: 'https://example.test/soup.png',
                  ),
                ),
                BiteSaverLegacySpecialsEntry(special: special('Salad')),
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(BiteSaverRestaurantImage), findsOneWidget);
      expect(tester.getSize(find.byType(BiteSaverRestaurantImage)).height, 110);
      await tester.tap(find.byType(BiteSaverRestaurantImage));
      await tester.pumpAndSettle();
      expect(find.byType(BiteSaverPhotoViewer), findsOneWidget);
    },
  );
  testWidgets(
    'retained photographed board is omitted from manual legacy dedicated screen',
    (tester) async {
      final restaurant = Restaurant(
        documentId: 'account',
        uid: 'account',
        name: 'Local cafe',
        distance: '0 mi',
        city: 'City',
        state: 'CT',
        zipCode: '06000',
        coupons: const [],
      );
      await tester.pumpWidget(
        MaterialApp(
          home: RestaurantSpecialsScreen(
            restaurant: restaurant,
            loadSpecials: (_) async => [
              special('Manual soup'),
              special(
                'bitesaver_managed_board',
                image: 'https://example.test/inactive.png',
              ),
            ],
            media: const BiteSaverRestaurantMedia(
              restaurantId: 'public',
              gallery: [],
              photoBoard: false,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Manual soup'), findsOneWidget);
      expect(find.byType(BiteSaverRestaurantImage), findsNothing);
      expect(find.text('bitesaver_managed_board'), findsNothing);
    },
  );
  testWidgets(
    'photo-board layout at 320 width and large text does not overflow',
    (tester) async {
      tester.view.physicalSize = const Size(320, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await profile(tester, photo: true, scale: 2);
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('daily-specials-board-photo')),
        300,
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'failed media request keeps existing coupon navigation and presents retry',
    (tester) async {
      await profile(tester, fail: true);
      expect(find.text('Retry photos and board'), findsOneWidget);
      expect(find.byKey(const ValueKey('profile-menu-main')), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'dedicated photo board uses the supplied guarded image destination',
    (tester) async {
      final opened = <String>[];
      final restaurant = Restaurant(
        documentId: 'account',
        uid: 'account',
        name: 'Local cafe',
        distance: '0 mi',
        city: 'City',
        state: 'CT',
        zipCode: '06000',
        coupons: const [],
      );
      await tester.pumpWidget(
        MaterialApp(
          home: RestaurantSpecialsScreen.fromCustomerBiteSaver(
            restaurant: restaurant,
            offers: const [],
            media: BiteSaverRestaurantMedia(
              restaurantId: 'public',
              gallery: const [],
              photoBoard: true,
              board: special('board', image: 'https://example.test/board.png'),
            ),
            openImage: (_, url) async {
              opened.add(url);
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('daily-specials-board-photo')),
      );
      await tester.pumpAndSettle();
      expect(opened, ['https://example.test/board.png']);
      expect(find.byType(BiteSaverPhotoViewer), findsNothing);
    },
  );
}
