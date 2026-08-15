import 'dart:io';

import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('saved BiteSaver customer visibility', () {
    test('saved coupon writes preserve the projection restaurant ID', () {
      final source = File(
        'lib/services/bitescore_service.dart',
      ).readAsStringSync();
      final start = source.indexOf('static Future<void> setCouponFavorite');
      final end = source.indexOf(
        'static Future<BiteScoreUserProfileData>',
        start,
      );
      final implementation = source.substring(start, end);

      expect(implementation, contains('coupon.restaurantAccountId'));
      expect(implementation, contains("'restaurantAccountId'"));
      expect(
        implementation,
        isNot(contains('loadApprovedRestaurantsWithCoupons')),
      );
    });

    test('stable account identity survives name and address changes', () {
      final current = _restaurant(
        documentId: 'account-1',
        name: 'Renamed Cafe',
        city: 'New City',
        zipCode: '99999',
        streetAddress: '99 New Street',
      );

      final match =
          BiteScoreService.visibleSaverRestaurantForFavoriteDataForTesting(
            const <String, dynamic>{
              'restaurantAccountId': 'account-1',
              'restaurantId': 'bitesaver_old_cafe_old_city_11111_1_old_street',
              'restaurantName': 'Old Cafe',
              'city': 'Old City',
              'zipCode': '11111',
              'streetAddress': '1 Old Street',
            },
            customerVisibleRestaurants: <Restaurant>[current],
          );

      expect(match, same(current));
    });

    test('legacy favorites survive one-dimensional profile edits', () {
      final renamed = _restaurant(
        documentId: 'account-renamed',
        name: 'New Name',
      );
      final moved = _restaurant(
        documentId: 'account-moved',
        streetAddress: '2 New Street',
      );

      expect(
        BiteScoreService.visibleSaverRestaurantForFavoriteDataForTesting(
          const <String, dynamic>{
            'restaurantName': 'Old Name',
            'city': 'Lecanto',
            'zipCode': '34461',
            'streetAddress': '1 Main Street',
          },
          customerVisibleRestaurants: <Restaurant>[renamed],
        ),
        same(renamed),
      );
      expect(
        BiteScoreService.visibleSaverRestaurantForFavoriteDataForTesting(
          const <String, dynamic>{
            'restaurantName': 'Current Cafe',
            'city': 'Lecanto',
            'zipCode': '34461',
            'streetAddress': '1 Main Street',
          },
          customerVisibleRestaurants: <Restaurant>[moved],
        ),
        same(moved),
      );
    });

    test('blocked, mismatched, and ambiguous restaurants fail closed', () {
      final first = _restaurant(documentId: 'account-1');
      final second = _restaurant(documentId: 'account-2');

      expect(
        BiteScoreService.visibleSaverRestaurantForFavoriteDataForTesting(
          const <String, dynamic>{
            'restaurantAccountId': 'blocked-account',
            'restaurantName': 'Current Cafe',
          },
          customerVisibleRestaurants: <Restaurant>[first],
        ),
        isNull,
      );
      expect(
        BiteScoreService.visibleSaverRestaurantForFavoriteDataForTesting(
          const <String, dynamic>{'restaurantName': 'Current Cafe'},
          customerVisibleRestaurants: <Restaurant>[first, second],
        ),
        isNull,
      );
      expect(
        BiteScoreService.visibleSaverRestaurantForFavoriteDataForTesting(
          const <String, dynamic>{'restaurantAccountId': 'blocked-account'},
          customerVisibleRestaurants: const <Restaurant>[],
        ),
        isNull,
      );
    });

    test('conflicting unique name and address evidence fails closed', () {
      final oldNameAtNewAddress = _restaurant(
        documentId: 'name-match',
        name: 'Old Name',
        streetAddress: '2 New Street',
      );
      final renamedAtOldAddress = _restaurant(
        documentId: 'address-match',
        name: 'Renamed Cafe',
      );

      expect(
        BiteScoreService.visibleSaverRestaurantForFavoriteDataForTesting(
          const <String, dynamic>{
            'restaurantName': 'Old Name',
            'city': 'Lecanto',
            'zipCode': '34461',
            'streetAddress': '1 Main Street',
          },
          customerVisibleRestaurants: <Restaurant>[
            oldNameAtNewAddress,
            renamedAtOldAddress,
          ],
        ),
        isNull,
      );
    });

    test('saved coupons use current visible sources across root renames', () {
      const currentCoupon = Coupon(
        id: 'coupon-1',
        restaurant: 'Old Name',
        title: 'Fresh Current Coupon',
        distance: '',
        usageRule: 'Unlimited',
      );
      final current = _restaurant(
        documentId: 'account-1',
        name: 'Renamed Cafe',
        coupons: const <Coupon>[currentCoupon],
      );

      final visible = BiteScoreService.visibleFavoriteCouponsForTesting(
        const <Map<String, dynamic>>[
          <String, dynamic>{
            'couponId': 'coupon-1',
            'restaurantName': 'Old Name',
            'couponTitle': 'Stale Saved Title',
          },
        ],
        customerVisibleRestaurants: <Restaurant>[current],
      );

      expect(visible, const <Coupon>[currentCoupon]);
    });

    test('stable coupon identity survives coupon restaurant-name updates', () {
      const currentCoupon = Coupon(
        id: 'coupon-1',
        restaurant: 'New Name',
        title: 'Fresh Current Coupon',
        distance: '',
        usageRule: 'Unlimited',
      );
      final current = _restaurant(
        documentId: 'account-1',
        name: 'New Name',
        coupons: const <Coupon>[currentCoupon],
      );

      final visible = BiteScoreService.visibleFavoriteCouponsForTesting(
        const <Map<String, dynamic>>[
          <String, dynamic>{
            'couponId': 'coupon-1',
            'restaurantAccountId': 'account-1',
            'restaurantName': 'Old Name',
          },
        ],
        customerVisibleRestaurants: <Restaurant>[current],
      );

      expect(visible, const <Coupon>[currentCoupon]);
    });

    test('blocked and cross-account saved coupons fail closed', () {
      const currentCoupon = Coupon(
        id: 'coupon-1',
        restaurant: 'Visible Cafe',
        title: 'Visible Coupon',
        distance: '',
        usageRule: 'Unlimited',
      );
      final visibleRestaurant = _restaurant(
        documentId: 'visible-account',
        name: 'Visible Cafe',
        coupons: const <Coupon>[currentCoupon],
      );

      expect(
        BiteScoreService.visibleFavoriteCouponsForTesting(
          const <Map<String, dynamic>>[
            <String, dynamic>{
              'couponId': 'blocked-coupon',
              'restaurantName': 'Blocked Cafe',
            },
          ],
          customerVisibleRestaurants: <Restaurant>[visibleRestaurant],
        ),
        isEmpty,
      );
      expect(
        BiteScoreService.visibleFavoriteCouponsForTesting(
          const <Map<String, dynamic>>[
            <String, dynamic>{
              'couponId': 'coupon-1',
              'restaurantAccountId': 'blocked-account',
              'restaurantName': 'Visible Cafe',
            },
          ],
          customerVisibleRestaurants: <Restaurant>[visibleRestaurant],
        ),
        isEmpty,
      );
    });
  });
}

Restaurant _restaurant({
  required String documentId,
  String name = 'Current Cafe',
  String city = 'Lecanto',
  String zipCode = '34461',
  String streetAddress = '1 Main Street',
  List<Coupon> coupons = const <Coupon>[],
}) {
  return Restaurant(
    documentId: documentId,
    uid: documentId,
    name: name,
    distance: Restaurant.defaultDistanceLabel,
    city: city,
    zipCode: zipCode,
    streetAddress: streetAddress,
    coupons: coupons,
  );
}
