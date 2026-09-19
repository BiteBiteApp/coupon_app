import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_category.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:flutter_test/flutter_test.dart';

const request = BiteScoreCreateRequest(
  restaurantName: 'Good Food', streetAddress: '1 Main St', city: 'New York',
  state: 'NY', zipCode: '10001', dishName: 'BBQ-smash BURGER', category: 'Burgers',
  subcategory: 'Beef', priceLabel: r'$8', headline: 'Good', notes: 'Tasty',
  overallImpression: 8, tastinessScore: 8, qualityScore: 8, valueScore: 8,
);
const restaurant = BitescoreRestaurant(
  id: 'restaurant-1', name: 'Good Food', normalizedName: 'good food',
  address: '1 Main St', city: 'New York', state: 'NY', zipCode: '10001',
  location: GeoPoint(40.75, -73.99), restaurantWriteRevision: 0,
);
Map<String, Object?> restaurantData([Map<String, Object?> extra = const {}]) => {
  'id': restaurant.id, 'name': restaurant.name, 'normalizedName': 'good food',
  'address': restaurant.address, 'city': restaurant.city, 'state': restaurant.state,
  'zipCode': restaurant.zipCode, 'latitude': 40.75, 'longitude': -73.99,
  'restaurantWriteRevision': 0, 'isActive': true, 'isClaimed': false, ...extra,
};
Map<String, Object?> dishData([Map<String, Object?> extra = const {}]) => {
  'id': 'dish-1', 'restaurantId': restaurant.id, 'restaurantName': restaurant.name,
  'name': 'Bbq-Smash Burger', 'normalizedName': 'bbq-smash burger', 'category': 'Burgers',
  'isActive': true, 'mergedIntoDishId': null, ...extra,
};

void main() {
  test('claim transport pins expected actor without sending authoritative email, ownership or approval fields', () async {
    var calls = 0;
    await BiteScoreService.submitRestaurantClaimWithTrustedHandler(
      expectedUserId: 'user-1',
      restaurantId: restaurant.id, claimantName: 'Owner', phone: '555-0100', message: 'Hello',
      transport: (name, data) async {
        calls++;
        expect(name, 'submitCustomerBiteScoreRestaurantClaim');
        expect(data, {'schemaVersion': 1, 'expectedUserId': 'user-1', 'restaurantId': restaurant.id,
          'claimantName': 'Owner', 'phone': '555-0100', 'message': 'Hello'});
        return {'schemaVersion': 1, 'claimId': 'claim-1'};
      },
    );
    expect(calls, 1);
  });

  test('restaurant lookup asks for geocoding only after a bounded miss', () async {
    final result = await BiteScoreService.resolveRestaurantCreationWithTrustedHandler(
      expectedUserId: 'user-1',
      request: request, requestId: 'request_id_0000001',
      transport: (name, data) async {
        expect(name, 'resolveCustomerBiteScoreRestaurantCreation');
        expect(data['name'], 'Good Food'); expect(data['location'], isNull);
        expect(data.containsKey('createdByUserId'), false);
        return {'schemaVersion': 1, 'requiresLocation': true};
      },
    );
    expect(result, isNull);
  });

  test('verified coordinates and a stable request identity complete creation without a source read', () async {
    final result = await BiteScoreService.resolveRestaurantCreationWithTrustedHandler(
      expectedUserId: 'user-1',
      request: request, requestId: 'request_id_0000001', location: restaurant.location,
      transport: (name, data) async {
        expect(data['requestId'], 'request_id_0000001');
        expect(data['location'], {'latitude': 40.75, 'longitude': -73.99});
        return {'schemaVersion': 1, 'restaurant': restaurantData(), 'wasCreated': true};
      },
    );
    expect(result!.restaurant.id, restaurant.id); expect(result.wasCreated, true);
    expect(result.restaurant.ownerUserId, isNull);
  });

  test('creation preserves the established dish normalization, category tags and force-create choice', () async {
    final result = await BiteScoreService.resolveDishCreationWithTrustedHandler(
      expectedUserId: 'user-1',
      request: request, restaurant: restaurant, requestId: 'request_id_0000001', allowExistingMatch: false,
      transport: (name, data) async {
        expect(name, 'resolveCustomerBiteScoreDishCreation');
        expect(data['expectedUserId'], 'user-1');
        expect(data['restaurantId'], restaurant.id); expect(data['dishName'], 'Bbq-Smash Burger');
        expect(data['allowExistingMatch'], false);
        expect(data['categoryTags'], BitescoreCategories.buildSearchableTags(
          categoryName: 'Burgers', subcategory: 'Beef', dishName: 'Bbq-Smash Burger', restaurantName: 'Good Food'));
        expect(data.containsKey('createdFromReviewId'), false);
        return {'schemaVersion': 1, 'dish': dishData(), 'wasCreated': true, 'restaurantHadNoDishesBefore': false};
      },
    );
    expect(result.dish.id, 'dish-1'); expect(result.wasCreated, true);
  });

  test('provenance transport binds exact restaurant, dish and expected revision', () async {
    final result = await BiteScoreService.completeRestaurantProvenanceWithTrustedHandler(
      expectedUserId: 'user-1',
      restaurant: restaurant, dishId: 'dish-1', transport: (name, data) async {
        expect(name, 'completeCustomerBiteScoreRestaurantProvenance');
        expect(data, {'schemaVersion': 1, 'expectedUserId': 'user-1', 'restaurantId': restaurant.id, 'dishId': 'dish-1', 'expectedRestaurantRevision': 0});
        return {'schemaVersion': 1, 'restaurant': restaurantData({'restaurantWriteRevision': 1})};
      },
    );
    expect(result.restaurantWriteRevision, 1);
  });

  test('dish response rejects swapped parent, inactive, merged and malformed canonical identities', () async {
    for (final extra in <Map<String, Object?>>[
      {'restaurantId': 'another-restaurant'}, {'id': ' dish-1'}, {'isActive': false},
      {'mergedIntoDishId': 'merged-target'}, {'normalizedName': 'different'},
    ]) {
      await expectLater(BiteScoreService.resolveDishCreationWithTrustedHandler(
      expectedUserId: 'user-1',
        request: request, restaurant: restaurant, requestId: 'request_id_0000001', allowExistingMatch: true,
        transport: (_, data) async => {'schemaVersion': 1, 'dish': dishData(extra), 'wasCreated': false, 'restaurantHadNoDishesBefore': false},
      ), throwsStateError);
    }
  });

  test('provenance response rejects another restaurant and stale revision', () async {
    for (final extra in <Map<String, Object?>>[{'id': 'another-restaurant'}, {'restaurantWriteRevision': 0}]) {
      await expectLater(BiteScoreService.completeRestaurantProvenanceWithTrustedHandler(
      expectedUserId: 'user-1',
        restaurant: restaurant, dishId: 'dish-1',
        transport: (_, data) async => {'schemaVersion': 1, 'restaurant': restaurantData(extra)},
      ), throwsStateError);
    }
  });

  test('invalid creation response cannot silently fall back to raw reads', () async {
    for (final response in <Object?>[null, {'schemaVersion': 2}, {'schemaVersion': 1, 'restaurant': restaurantData(), 'wasCreated': 'true'}]) {
      await expectLater(BiteScoreService.resolveRestaurantCreationWithTrustedHandler(
      expectedUserId: 'user-1',
        request: request, requestId: 'request_id_0000001', transport: (_, data) async => response,
      ), throwsStateError);
    }
    await expectLater(BiteScoreService.resolveRestaurantCreationWithTrustedHandler(
      expectedUserId: 'user-1',
      request: request, requestId: 'request_id_0000001', location: restaurant.location,
      transport: (_, data) async => {'schemaVersion': 1, 'requiresLocation': true},
    ), throwsStateError);
  });

  test('claim canonical identity and invalid response are rejected', () async {
    var calls = 0;
    Future<Object?> transport(String name, Map<String, Object?> data) async {
      calls++; return {'schemaVersion': 1, 'claimId': ' claim-1'};
    }
    await expectLater(BiteScoreService.submitRestaurantClaimWithTrustedHandler(
      expectedUserId: 'user-1',
      restaurantId: ' restaurant-1', claimantName: 'Owner', phone: '555', message: '', transport: transport,
    ), throwsStateError);
    expect(calls, 0);
    await expectLater(BiteScoreService.submitRestaurantClaimWithTrustedHandler(
      expectedUserId: 'user-1',
      restaurantId: restaurant.id, claimantName: 'Owner', phone: '555', message: '', transport: transport,
    ), throwsStateError);
    expect(calls, 1);
  });

  test('creation transparently continues without a total cap and retains the original actor and criteria', () async {
    var calls = 0;
    final result = await BiteScoreService.resolveRestaurantCreationWithTrustedHandler(
      expectedUserId: 'original-user', request: request, requestId: 'request_id_0000001',
      transport: (name, data) async {
        calls++;
        expect(data['expectedUserId'], 'original-user');
        expect(data['requestId'], 'request_id_0000001');
        expect(data['name'], request.restaurantName);
        if (calls > 1) expect(data['cursor'], 'cursor-${calls - 1}');
        if (calls <= 105) return {'schemaVersion': 1, 'state': 'preparing', 'nextCursor': 'cursor-$calls'};
        return {'schemaVersion': 1, 'restaurant': restaurantData(), 'wasCreated': false};
      },
    );
    expect(calls, 106); expect(result!.restaurant.id, restaurant.id);
  });

  test('dish continuation preserves force-match criteria and fails closed on an account-switch rejection', () async {
    var calls = 0;
    await expectLater(BiteScoreService.resolveDishCreationWithTrustedHandler(
      expectedUserId: 'original-user', request: request, restaurant: restaurant,
      requestId: 'request_id_0000001', allowExistingMatch: true,
      transport: (name, data) async {
        calls++; expect(data['expectedUserId'], 'original-user');
        expect(data['allowExistingMatch'], true);
        if (calls == 1) return {'schemaVersion': 1, 'state': 'preparing', 'nextCursor': 'opaque-cursor'};
        expect(data['cursor'], 'opaque-cursor');
        throw StateError('Account changed: server rejected before reads.');
      },
    ), throwsStateError);
    expect(calls, 2);
  });
}
