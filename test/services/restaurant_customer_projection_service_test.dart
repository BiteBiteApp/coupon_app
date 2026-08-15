import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/services/restaurant_account_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
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
