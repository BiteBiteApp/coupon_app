import 'package:coupon_app/services/customer_bitescore_search_service.dart';

Map<String, dynamic> dishProjection(String id) => {
  'customerPublicProjectionVersion':
      'bitestar.bitescore-customer-public-dish.v1',
  'source': 'biteScore',
  'entityType': 'dish',
  'sourceDocumentId': id,
  'restaurantSourceDocumentId': 'restaurant-1',
  'publicVisible': true,
  'displayName': 'Same Dish',
  'normalizedName': 'same dish',
  'restaurantDisplayName': 'Kitchen',
  'restaurantNormalizedName': 'kitchen',
  'restaurantCity': 'Orlando',
  'restaurantState': 'FL',
  'restaurantZipCode': '32801',
  'latitude': 28.5,
  'longitude': -81.3,
  'categoryTags': <String>[],
  'overallBiteScore': 80.0,
  'ratingCount': 3,
};

Map<String, dynamic> restaurantProjection(String id) => {
  'customerPublicProjectionVersion':
      'bitestar.bitescore-customer-public-restaurant.v1',
  'source': 'biteScore',
  'entityType': 'restaurant',
  'sourceDocumentId': id,
  'publicVisible': true,
  'displayName': 'Kitchen',
  'normalizedName': 'kitchen',
  'streetAddress': '1 Main St',
  'city': 'Orlando',
  'state': 'FL',
  'zipCode': '32801',
  'latitude': 28.5,
  'longitude': -81.3,
  'isClaimed': false,
  'cuisineTags': <String>[],
};

Map<String, dynamic> response({
  String session = 'session',
  String state = 'ready',
  List<Map<String, dynamic>> items = const [],
  String? cursor,
}) => {
  'schemaVersion': 1,
  'sessionId': session,
  'queryFingerprint': 'a' * 64,
  'state': state,
  'scannedCount': 70,
  'items': items,
  'nextCursor': cursor,
  'hasMore': cursor != null,
};

final class FakeSearchApi implements CustomerBiteScoreSearchApi {
  FakeSearchApi(this.handler);
  final Future<Map<String, dynamic>> Function(String, Map<String, Object?>)
  handler;
  final calls = <String>[];
  @override
  Future<Map<String, dynamic>> invoke(String name, Map<String, Object?> data) {
    calls.add(name);
    return handler(name, data);
  }
}
