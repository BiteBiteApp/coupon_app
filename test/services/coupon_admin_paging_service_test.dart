import 'package:flutter_test/flutter_test.dart';

import 'package:coupon_app/models/coupon_admin_paging_models.dart';
import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/services/coupon_admin_paging_service.dart';

Map<String, Object?> page(
  List<Map<String, Object?>> items, {
  int pageSize = 50,
  bool hasNext = false,
  bool hasPrevious = false,
  String? nextCursor,
  String? previousCursor,
  int currentPage = 1,
  Object? total = const <String, Object?>{'state': 'exact', 'value': 1},
  Map<String, Object?>? preparation,
}) => <String, Object?>{
  'protocolVersion': pageProtocolVersion,
  'items': items,
  'pageSize': pageSize,
  'hasNext': hasNext,
  'hasPrevious': hasPrevious,
  'nextCursor': ?nextCursor,
  'previousCursor': ?previousCursor,
  'currentPageNumber': currentPage,
  'total': ?total,
  'queryFingerprint': 'a' * 64,
  'snapshotTimestampMs': 1786200000000,
  'capabilities': <String, Object?>{
    'first': currentPage > 1,
    'previous': hasPrevious,
    'numberedVisitedPages': true,
    'next': hasNext,
    'last': false,
  },
  'preparation': ?preparation,
};

Map<String, Object?> restaurant(String id) => <String, Object?>{
  'source': 'biteSaver',
  'documentId': id,
  'actionId': 'uid-$id',
  'restaurantName': 'Restaurant $id',
  'streetAddress': '1 Main Street',
  'city': 'Inverness',
  'state': 'FL',
  'zipCode': '01234',
  'phone': '5550100',
  'website': 'https://example.test',
  'latitude': 28.85,
  'longitude': -82.49,
  'distanceMiles': null,
  'approvalStatus': 'approved',
  'couponApplicationSubmitted': true,
  'uid': 'uid-$id',
  'linkedBiteScoreRestaurantId': null,
};

PagedRequest request(Map<String, Object?> criteria, {int pageSize = 50}) =>
    PagedRequest(
      pageSize: pageSize,
      criteria: criteria,
      direction: PageDirection.first,
      requestExactCount: true,
      clientRequestId: 'test-request',
    );

void main() {
  test('restaurant criteria builds exact ZIP and strips ZIP+4', () {
    expect(
      CouponAdminPagingService.restaurantCriteria(
        mode: CouponAdminRestaurantSearchMode.exactZip,
        location: ' 01234-9876 ',
        radiusMiles: 50,
        restaurantName: '  sub  shop ',
      ),
      <String, Object?>{
        'mode': 'exactZip',
        'zipCode': '01234',
        'restaurantName': 'sub shop',
      },
    );
  });

  test('restaurant criteria builds exact City and State', () {
    expect(
      CouponAdminPagingService.restaurantCriteria(
        mode: CouponAdminRestaurantSearchMode.exactCity,
        location: 'Inverness, fl',
        radiusMiles: 10,
      ),
      <String, Object?>{
        'mode': 'exactCity',
        'city': 'Inverness',
        'state': 'FL',
      },
    );
  });

  test(
    'exact City rejects a bare city and exact ZIP rejects malformed input',
    () {
      expect(
        () => CouponAdminPagingService.restaurantCriteria(
          mode: CouponAdminRestaurantSearchMode.exactCity,
          location: 'Inverness',
          radiusMiles: 10,
        ),
        throwsA(isA<CouponAdminPagingException>()),
      );
      expect(
        () => CouponAdminPagingService.restaurantCriteria(
          mode: CouponAdminRestaurantSearchMode.exactZip,
          location: '1234',
          radiusMiles: 10,
        ),
        throwsA(isA<CouponAdminPagingException>()),
      );
    },
  );

  test('nearby criteria retains location and an allowed radius', () {
    expect(
      CouponAdminPagingService.restaurantCriteria(
        mode: CouponAdminRestaurantSearchMode.nearbyRadius,
        location: 'Crystal River, FL',
        radiusMiles: 30,
      ),
      <String, Object?>{
        'mode': 'nearbyRadius',
        'locationQuery': 'Crystal River, FL',
        'radiusMiles': 30,
      },
    );
  });

  test(
    'restaurant service calls the exact v2 callable and strictly parses',
    () async {
      String? name;
      Map<String, Object?>? payload;
      final service = CouponAdminPagingService(
        functionsBoundary: (callableName, request) async {
          name = callableName;
          payload = request;
          return page(<Map<String, Object?>>[restaurant('one')]);
        },
      );
      final result = await service.loadRestaurantPage(
        request(<String, Object?>{'mode': 'exactZip', 'zipCode': '01234'}),
      );
      expect(name, 'searchCouponAdminRestaurantsPage');
      expect(payload?['protocolVersion'], pageProtocolVersion);
      expect(result.items.single.documentId, 'one');
      expect(result.items.single.distanceMiles, isNull);
    },
  );

  test('queue service uses exact callable and typed queue identity', () async {
    final service = CouponAdminPagingService(
      functionsBoundary: (name, request) async => page(<Map<String, Object?>>[
        <String, Object?>{
          'id': 'pending-one',
          'kind': 'pendingApplications',
          'restaurantName': 'Pending',
          'uid': 'uid',
          'email': 'admin@example.test',
          'phone': '',
          'applicantPhone': '',
          'streetAddress': '',
          'city': '',
          'state': '',
          'zipCode': '',
          'website': '',
          'latitude': null,
          'longitude': null,
          'approvalStatus': 'pending',
          'couponApplicationSubmitted': true,
          'profileVersion': 4,
          'createdAtMillis': null,
          'updatedAtMillis': 10,
        },
      ], pageSize: 25),
    );
    final result = await service.loadQueuePage(
      request(<String, Object?>{
        'queueKind': 'pendingApplications',
      }, pageSize: 25),
    );
    expect(result.items.single.id, 'pending-one');
    expect(result.items.single.integer('profileVersion'), 4);
  });

  test(
    'coupon service parses a bounded coupon without retaining raw response',
    () async {
      final raw = page(<Map<String, Object?>>[
        <String, Object?>{
          'id': 'coupon-one',
          'title': 'Twenty Percent Off',
          'restaurant': 'Restaurant',
          'expires': 'Soon',
          'startTimeMillis': null,
          'endTimeMillis': null,
          'usageRule': 'Once',
          'couponNumber': '001',
          'isProximityOnly': false,
          'proximityRadiusMiles': null,
          'details': null,
          'imageUrl': null,
          'createdAtMillis': 1,
          'updatedAtMillis': 2,
        },
      ], pageSize: 25);
      final service = CouponAdminPagingService(
        functionsBoundary: (name, request) async => raw,
      );
      final response = await service.loadCouponPage(
        request(<String, Object?>{
          'restaurantAccountId': 'restaurant-one',
        }, pageSize: 25),
      );
      expect(response.items.single.coupon.id, 'coupon-one');
      raw['items'] = <Object?>[];
      expect(response.items.single.coupon.id, 'coupon-one');
    },
  );

  test(
    'invite parser enforces Coupon side and exposes no token field',
    () async {
      final service = CouponAdminPagingService(
        functionsBoundary: (name, request) async => page(<Map<String, Object?>>[
          <String, Object?>{
            'id': 'invite-one',
            'type': 'coupon_invite',
            'side': 'coupon',
            'status': 'active',
            'restaurantId': 'restaurant-one',
            'pendingRestaurantKey': '',
            'restaurantName': 'Restaurant',
            'createdByEmail': 'admin@example.test',
            'createdAtMillis': 1,
            'expiresAtMillis': 2,
            'usedAtMillis': null,
            'revokedAtMillis': null,
            'maxUses': 1,
            'useCount': 0,
          },
        ]),
      );
      final response = await service.loadCouponInviteHistoryPage(
        request(<String, Object?>{'side': 'coupon'}),
      );
      expect(response.items.single.id, 'invite-one');
      expect(response.items.single.toString().contains('token'), isFalse);
    },
  );

  test('unknown response fields fail closed', () async {
    final invalid = page(<Map<String, Object?>>[restaurant('one')]);
    invalid['unexpected'] = true;
    final service = CouponAdminPagingService(
      functionsBoundary: (name, request) async => invalid,
    );
    expect(
      service.loadRestaurantPage(
        request(<String, Object?>{'mode': 'exactZip', 'zipCode': '01234'}),
      ),
      throwsA(isA<CouponAdminPagingException>()),
    );
  });

  test('unknown item fields fail closed', () async {
    final invalidRestaurant = restaurant('one')..['privateCanary'] = 'secret';
    final service = CouponAdminPagingService(
      functionsBoundary: (name, request) async =>
          page(<Map<String, Object?>>[invalidRestaurant]),
    );
    expect(
      service.loadRestaurantPage(
        request(<String, Object?>{'mode': 'exactZip', 'zipCode': '01234'}),
      ),
      throwsA(isA<CouponAdminPagingException>()),
    );
  });

  test('preparing radius response retains honest unknown total', () async {
    final service = CouponAdminPagingService(
      functionsBoundary: (name, request) async => page(
        const <Map<String, Object?>>[],
        hasNext: true,
        nextCursor: 'opaque',
        total: const <String, Object?>{'state': 'unknown'},
        preparation: const <String, Object?>{
          'state': 'preparing',
          'completedUnits': 2,
          'totalUnits': 9,
        },
      ),
    );
    final response = await service.loadRestaurantPage(
      request(<String, Object?>{
        'mode': 'nearbyRadius',
        'locationQuery': 'Center',
        'radiusMiles': 10,
      }),
    );
    expect(response.preparation?.state, PagePreparationState.preparing);
    expect(response.total?.isExact, isFalse);
  });
}
