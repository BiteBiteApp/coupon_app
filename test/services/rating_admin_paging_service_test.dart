import 'package:flutter_test/flutter_test.dart';

import 'package:coupon_app/models/admin_restaurant_link_record.dart';
import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/models/rating_admin_paging_models.dart';
import 'package:coupon_app/services/rating_admin_paging_service.dart';

Map<String, Object?> page({
  List<Object?> items = const <Object?>[],
  int pageSize = 50,
  bool hasNext = false,
  String? nextCursor,
  int total = 0,
  Map<String, Object?>? preparation,
}) {
  return <String, Object?>{
    'protocolVersion': pageProtocolVersion,
    'items': items,
    'pageSize': pageSize,
    'hasNext': hasNext,
    'hasPrevious': false,
    'nextCursor': ?nextCursor,
    'currentPageNumber': 1,
    'total': <String, Object?>{'state': 'exact', 'value': total},
    'queryFingerprint': List<String>.filled(64, '0').join(),
    'snapshotTimestampMs': 1,
    'capabilities': <String, Object?>{
      'first': false,
      'previous': false,
      'numberedVisitedPages': true,
      'next': hasNext,
      'last': false,
    },
    'preparation': ?preparation,
  };
}

PagedRequest request(Map<String, Object?> criteria, {int pageSize = 50}) {
  return PagedRequest(
    pageSize: pageSize,
    criteria: criteria,
    direction: PageDirection.first,
    requestExactCount: true,
    clientRequestId: 'test-request',
  );
}

void main() {
  test('restaurant criteria are strict for ZIP, City, and radius', () {
    expect(
      RatingAdminPagingService.restaurantCriteria(
        mode: RatingAdminRestaurantSearchMode.exactZip,
        location: '01234-5678',
        radiusMiles: 10,
        status: AdminBiteScoreStatus.inactive,
        restaurantName: '  Root  Kitchen ',
      ),
      <String, Object?>{
        'mode': 'exactZip',
        'zipCode': '01234',
        'status': 'inactive',
        'restaurantName': 'Root Kitchen',
      },
    );
    expect(
      RatingAdminPagingService.restaurantCriteria(
        mode: RatingAdminRestaurantSearchMode.exactCity,
        location: 'Orlando, fl',
        radiusMiles: 10,
        status: AdminBiteScoreStatus.all,
      ),
      <String, Object?>{
        'mode': 'exactCity',
        'city': 'Orlando',
        'state': 'FL',
        'status': 'all',
      },
    );
    expect(
      RatingAdminPagingService.restaurantCriteria(
        mode: RatingAdminRestaurantSearchMode.nearbyRadius,
        location: 'Orlando',
        radiusMiles: 50,
        status: AdminBiteScoreStatus.active,
      )['radiusMiles'],
      50,
    );
    expect(
      () => RatingAdminPagingService.restaurantCriteria(
        mode: RatingAdminRestaurantSearchMode.exactCity,
        location: 'Orlando',
        radiusMiles: 10,
        status: AdminBiteScoreStatus.all,
      ),
      throwsA(isA<RatingAdminPagingException>()),
    );
  });

  test(
    'restaurant response preserves exact identity and nullable distance',
    () async {
      final service = RatingAdminPagingService(
        functionsBoundary: (name, body) async {
          expect(name, 'searchRatingAdminRestaurantsPage');
          expect(body['protocolVersion'], pageProtocolVersion);
          return page(
            total: 1,
            items: <Object?>[
              <String, Object?>{
                'source': 'biteScore',
                'documentId': 'restaurant-1',
                'actionId': 'restaurant-1',
                'restaurantName': 'Root Kitchen',
                'streetAddress': '1 Main St',
                'city': 'Orlando',
                'state': 'FL',
                'zipCode': '32801',
                'phone': '',
                'website': '',
                'latitude': 28.5,
                'longitude': -81.3,
                'distanceMiles': null,
                'isActive': true,
                'isClaimed': false,
                'ownerUserId': null,
                'linkedBiteSaverUid': null,
              },
            ],
          );
        },
      );
      final response = await service.loadRestaurantPage(
        request(<String, Object?>{
          'mode': 'exactZip',
          'zipCode': '32801',
          'status': 'all',
        }),
      );
      expect(response.items.single.documentId, 'restaurant-1');
      expect(response.items.single.distanceMiles, isNull);
      expect(
        response.items.single.toAdminLinkRecord().recordKey,
        'biteScore:restaurant-1',
      );
    },
  );

  test(
    'directory, queue, and invite methods use only exact callable names',
    () async {
      final calls = <String>[];
      final service = RatingAdminPagingService(
        functionsBoundary: (name, body) async {
          calls.add(name);
          return page(pageSize: name == 'listRatingAdminQueuePage' ? 25 : 50);
        },
      );
      await service.loadDishPage(
        request(
          RatingAdminPagingService.dishCriteria(restaurantId: 'restaurant-1'),
        ),
      );
      await service.loadReviewPage(
        request(RatingAdminPagingService.reviewCriteria),
      );
      await service.loadClaimedRestaurantPage(
        request(RatingAdminPagingService.claimedRestaurantCriteria()),
      );
      await service.loadQueuePage(
        request(
          RatingAdminPagingService.queueCriteria(RatingAdminQueueKind.claims),
          pageSize: 25,
        ),
      );
      await service.loadInviteHistoryPage(
        request(RatingAdminPagingService.inviteCriteria),
      );
      expect(calls, <String>[
        'listRatingAdminDirectoryPage',
        'listRatingAdminDirectoryPage',
        'listRatingAdminDirectoryPage',
        'listRatingAdminQueuePage',
        'listRatingAdminInviteHistoryPage',
      ]);
    },
  );

  test('contradictory preparing response fails closed', () async {
    final service = RatingAdminPagingService(
      functionsBoundary: (_, _) async => page(
        hasNext: true,
        nextCursor: 'cursor',
        total: 4,
        preparation: <String, Object?>{
          'state': 'preparing',
          'completedUnits': 1,
          'totalUnits': 9,
        },
      ),
    );
    expect(
      service.loadRestaurantPage(
        request(<String, Object?>{
          'mode': 'nearbyRadius',
          'locationQuery': 'Orlando',
          'radiusMiles': 10,
          'status': 'all',
        }),
      ),
      throwsA(isA<RatingAdminPagingException>()),
    );
  });

  test('invalid item shape never reaches UI as a raw map', () async {
    final service = RatingAdminPagingService(
      functionsBoundary: (_, _) async => page(
        total: 1,
        items: <Object?>[
          <String, Object?>{
            'source': 'biteScore',
            'documentId': 'restaurant-1',
            'unexpected': 'private-source-map',
          },
        ],
      ),
    );
    expect(
      service.loadRestaurantPage(
        request(<String, Object?>{
          'mode': 'exactZip',
          'zipCode': '32801',
          'status': 'all',
        }),
      ),
      throwsA(isA<RatingAdminPagingException>()),
    );
  });
}
