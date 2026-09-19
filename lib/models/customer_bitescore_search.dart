import 'package:cloud_firestore/cloud_firestore.dart';

import '../services/bitescore_service.dart' show BiteScoreHomeEntry;
import '../services/firestore_document_id.dart';
import 'bitescore_dish.dart';
import 'bitescore_restaurant.dart';
import 'dish_rating_aggregate.dart';
import 'restaurant.dart';

/// Display-only models built exclusively from allowlisted customer projections.
/// Private owner/provenance fields are deliberately never copied into them.
abstract final class CustomerBiteScorePublicData {
  static String _identity(Object? value) {
    final id = exactFirestoreDocumentId(value);
    if (id == null || id != value) {
      throw const FormatException('Invalid BiteScore document identity.');
    }
    return id;
  }

  static String _text(Map<String, dynamic> value, String key) {
    final text = value[key];
    if (text is! String) {
      throw FormatException('Missing BiteScore $key.');
    }
    return text;
  }

  static double _number(Map<String, dynamic> value, String key) {
    final number = value[key];
    if (number is! num || !number.isFinite) {
      throw FormatException('Invalid BiteScore $key.');
    }
    return number.toDouble();
  }

  static List<String> _strings(Object? value) {
    if (value == null) return const [];
    if (value is! List || value.any((item) => item is! String)) {
      throw const FormatException('Invalid BiteScore text list.');
    }
    return List<String>.unmodifiable(value.cast<String>());
  }

  static void _public(Map<String, dynamic> data, String kind) {
    if (data['source'] != 'biteScore' ||
        data['entityType'] != kind ||
        data['publicVisible'] != true ||
        data['customerPublicProjectionVersion'] !=
            'bitestar.bitescore-customer-public-$kind.v1') {
      throw const FormatException('Invalid BiteScore customer projection.');
    }
  }

  static BitescoreRestaurant restaurant(Map<String, dynamic> data) {
    _public(data, 'restaurant');
    final latitude = _number(data, 'latitude');
    final longitude = _number(data, 'longitude');
    if (latitude.abs() > 90 || longitude.abs() > 180) {
      throw const FormatException('Invalid BiteScore coordinates.');
    }
    return BitescoreRestaurant(
      id: _identity(data['sourceDocumentId']),
      name: _text(data, 'displayName'),
      normalizedName: _text(data, 'normalizedName'),
      address: _text(data, 'streetAddress'),
      city: _text(data, 'city'),
      state: _text(data, 'state'),
      zipCode: _text(data, 'zipCode'),
      location: GeoPoint(latitude, longitude),
      phone: data['phone'] as String?,
      website: data['website'] as String?,
      bio: data['bio'] as String?,
      businessHours: RestaurantBusinessHours.listFromFirestore(
        data['businessHours'],
      ),
      cuisineTags: _strings(data['cuisineTags']),
      isClaimed: data['isClaimed'] == true,
      restaurantWriteRevision: 0,
    );
  }

  static BiteScoreHomeEntry entry(
    Map<String, dynamic> data, {
    Map<String, dynamic>? restaurantProjection,
  }) {
    _public(data, 'dish');
    final dishId = _identity(data['sourceDocumentId']);
    final restaurantId = _identity(data['restaurantSourceDocumentId']);
    final latitude = _number(data, 'latitude');
    final longitude = _number(data, 'longitude');
    if (latitude.abs() > 90 || longitude.abs() > 180) {
      throw const FormatException('Invalid BiteScore coordinates.');
    }
    restaurantProjection ??= data['restaurant'] is Map
        ? Map<String, dynamic>.from(data['restaurant'] as Map)
        : null;
    final parent = restaurantProjection == null
        ? BitescoreRestaurant(
            id: restaurantId,
            name: _text(data, 'restaurantDisplayName'),
            normalizedName: _text(data, 'restaurantNormalizedName'),
            address: '',
            city: _text(data, 'restaurantCity'),
            state: _text(data, 'restaurantState'),
            zipCode: _text(data, 'restaurantZipCode'),
            location: GeoPoint(latitude, longitude),
            restaurantWriteRevision: 0,
          )
        : restaurant(restaurantProjection);
    if (parent.id != restaurantId) {
      throw const FormatException('BiteScore restaurant binding mismatch.');
    }
    final count = data['ratingCount'];
    if (count is! int || count < 0) {
      throw const FormatException('Invalid BiteScore rating count.');
    }
    double? component(String name) =>
        data[name] == null ? null : _number(data, name);
    return BiteScoreHomeEntry(
      restaurant: parent,
      dish: BitescoreDish(
        id: dishId,
        restaurantId: restaurantId,
        restaurantName: parent.name,
        name: _text(data, 'displayName'),
        normalizedName: _text(data, 'normalizedName'),
        category: data['category'] as String?,
        subcategory: data['subcategory'] as String?,
        categoryManualKeywords: data['categoryManualKeywords'] as String?,
        categoryTags: _strings(data['categoryTags']),
        priceLabel: data['priceLabel'] as String?,
        primaryImageUrl: data['primaryImageUrl'] as String?,
      ),
      aggregate: DishRatingAggregate(
        dishId: dishId,
        restaurantId: restaurantId,
        overallBiteScore: _number(data, 'overallBiteScore'),
        ratingCount: count,
        overallImpressionAverage: component('overallImpressionAverage'),
        tastinessScoreAverage: component('tastinessScoreAverage'),
        qualityScoreAverage: component('qualityScoreAverage'),
        valueScoreAverage: component('valueScoreAverage'),
      ),
    );
  }
}
