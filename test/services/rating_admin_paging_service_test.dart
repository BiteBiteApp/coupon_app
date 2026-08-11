import 'package:flutter_test/flutter_test.dart';

import 'package:coupon_app/models/admin_restaurant_link_record.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
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

Map<String, Object?> nestedRestaurant({Object? revision = 4}) =>
    <String, Object?>{
      'id': 'restaurant-1',
      'name': 'Root Kitchen',
      'normalizedName': 'root kitchen',
      'address': '1 Main St',
      'city': 'Orlando',
      'state': 'FL',
      'zipCode': '32801',
      'latitude': 28.5,
      'longitude': -81.3,
      'phone': null,
      'website': null,
      'ownerUserId': null,
      'isClaimed': false,
      'isActive': true,
      'createdAtMillis': null,
      'updatedAtMillis': null,
      'restaurantWriteRevision': revision,
    };

Map<String, Object?> restaurantReportQueueItem(
  String kind,
  Map<String, Object?> restaurant,
) => <String, Object?>{
  'kind': kind,
  'id': 'report-1',
  'reportId': 'report-1',
  'restaurantId': 'restaurant-1',
  'restaurantName': 'Root Kitchen',
  'reportingUserId': 'reporter-1',
  'reason': 'duplicate',
  'status': 'pending',
  'createdAtMillis': null,
  'updatedAtMillis': null,
  'restaurant': restaurant,
};

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
                'restaurantWriteRevision': 4,
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
      expect(response.items.single.restaurantWriteRevision, 4);
      expect(
        response.items.single.toAdminLinkRecord().recordKey,
        'biteScore:restaurant-1',
      );
    },
  );

  test('restaurant response requires an exact safe revision', () async {
    Map<String, Object?> item([Object? revision = 4]) => <String, Object?>{
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
      'restaurantWriteRevision': revision,
    };

    for (final revision in <Object?>[
      '4',
      -1,
      1.5,
      BitescoreRestaurant.maxRestaurantWriteRevision + 1,
    ]) {
      final service = RatingAdminPagingService(
        functionsBoundary: (_, _) async =>
            page(total: 1, items: <Object?>[item(revision)]),
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
    }

    final missing = item()..remove('restaurantWriteRevision');
    final service = RatingAdminPagingService(
      functionsBoundary: (_, _) async =>
          page(total: 1, items: <Object?>[missing]),
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

  test('nested report and duplicate actions receive the exact revision', () {
    for (final kind in <String>[
      'restaurantReports',
      'duplicateRestaurantReports',
    ]) {
      final record = RatingAdminQueueRecord.fromJson(
        restaurantReportQueueItem(kind, nestedRestaurant()),
      );
      expect(record.restaurant?.restaurantWriteRevision, 4);
    }
  });

  test('strict nested restaurant revision fails closed', () {
    final missing = nestedRestaurant()..remove('restaurantWriteRevision');
    for (final restaurant in <Map<String, Object?>>[
      missing,
      nestedRestaurant(revision: '4'),
      nestedRestaurant(revision: -1),
      nestedRestaurant(revision: 1.5),
      nestedRestaurant(
        revision: BitescoreRestaurant.maxRestaurantWriteRevision + 1,
      ),
    ]) {
      expect(
        () => RatingAdminQueueRecord.fromJson(
          restaurantReportQueueItem('restaurantReports', restaurant),
        ),
        throwsFormatException,
      );
    }
  });

  test('claimed restaurant handoff preserves exact revision', () {
    final record =
        RatingAdminClaimedRestaurantRecord.fromJson(<String, Object?>{
          'kind': 'claimedRestaurants',
          'id': 'restaurant-1',
          'restaurant': nestedRestaurant(),
          'approvedClaim': null,
        });
    expect(record.restaurant.restaurantWriteRevision, 4);
  });

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
