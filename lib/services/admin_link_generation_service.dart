import 'package:cloud_functions/cloud_functions.dart';

import '../models/admin_restaurant_link_record.dart';
import 'firestore_document_id.dart';

typedef AdminRestaurantCallable =
    Future<Object?> Function(Map<String, dynamic> payload);
typedef AdminRestaurantPreparationCallable =
    Future<Object?> Function(Map<String, dynamic> payload);

class AdminLinkGenerationException implements Exception {
  final String message;

  const AdminLinkGenerationException(this.message);

  @override
  String toString() => message;
}

class AdminLinkGenerationService {
  static const List<int> radiusOptionsMiles = [1, 3, 5, 10, 15, 20, 30, 50];
  static const int defaultRadiusMiles = 10;

  static const Set<String> _usStateCodes = {
    'AL',
    'AK',
    'AZ',
    'AR',
    'CA',
    'CO',
    'CT',
    'DE',
    'FL',
    'GA',
    'HI',
    'ID',
    'IL',
    'IN',
    'IA',
    'KS',
    'KY',
    'LA',
    'ME',
    'MD',
    'MA',
    'MI',
    'MN',
    'MS',
    'MO',
    'MT',
    'NE',
    'NV',
    'NH',
    'NJ',
    'NM',
    'NY',
    'NC',
    'ND',
    'OH',
    'OK',
    'OR',
    'PA',
    'RI',
    'SC',
    'SD',
    'TN',
    'TX',
    'UT',
    'VT',
    'VA',
    'WA',
    'WV',
    'WI',
    'WY',
    'DC',
  };

  final AdminRestaurantCallable _callable;
  final AdminRestaurantPreparationCallable _preparationCallable;

  AdminLinkGenerationService({
    AdminRestaurantCallable? callable,
    AdminRestaurantPreparationCallable? preparationCallable,
  }) : _callable = callable ?? _callFirebase,
       _preparationCallable = preparationCallable ?? _callPreparationFirebase;

  static String? locationValidationError(String value) {
    final normalized = _normalizeWhitespace(
      value,
    ).replaceAll(RegExp(r'\s*,\s*'), ', ');
    if (normalized.length > 100) {
      return 'Enter a five-digit ZIP code or City, ST.';
    }
    if (RegExp(r'^\d{5}$').hasMatch(normalized)) {
      return null;
    }
    final match = RegExp(
      r"^([A-Za-z](?:[A-Za-z .'-]*[A-Za-z.])?),\s*([A-Za-z]{2})$",
    ).firstMatch(normalized);
    if (match == null) {
      return 'Enter a five-digit ZIP code or City, ST.';
    }
    if (!_usStateCodes.contains(match.group(2)!.toUpperCase())) {
      return 'Enter a valid two-letter US state abbreviation.';
    }
    return null;
  }

  static String normalizeLocation(String value) {
    final normalized = _normalizeWhitespace(
      value,
    ).replaceAll(RegExp(r'\s*,\s*'), ', ');
    final error = locationValidationError(normalized);
    if (error != null) {
      throw AdminLinkGenerationException(error);
    }
    if (RegExp(r'^\d{5}$').hasMatch(normalized)) {
      return normalized;
    }
    final commaIndex = normalized.lastIndexOf(',');
    final city = normalized.substring(0, commaIndex).trim();
    final state = normalized.substring(commaIndex + 1).trim().toUpperCase();
    return '$city, $state';
  }

  Future<AdminRestaurantLinkSearchResult> search({
    required String locationQuery,
    required int radiusMiles,
    String? restaurantName,
    required Set<AdminRestaurantLinkSource> sources,
    AdminBiteScoreStatus? biteScoreStatus,
  }) async {
    final normalizedLocation = normalizeLocation(locationQuery);
    if (!radiusOptionsMiles.contains(radiusMiles)) {
      throw const AdminLinkGenerationException(
        'Choose a search radius from 1 through 50 miles.',
      );
    }
    if (sources.isEmpty) {
      throw const AdminLinkGenerationException(
        'Select at least one restaurant source.',
      );
    }
    if (biteScoreStatus != null &&
        !sources.contains(AdminRestaurantLinkSource.biteScore)) {
      throw const AdminLinkGenerationException(
        'BiteScore status requires the BiteScore restaurant source.',
      );
    }
    final normalizedName = _normalizeWhitespace(restaurantName ?? '');
    if (normalizedName.length > 100) {
      throw const AdminLinkGenerationException(
        'Restaurant name must be no more than 100 characters.',
      );
    }

    final payload = <String, dynamic>{
      'locationQuery': normalizedLocation,
      'radiusMiles': radiusMiles,
      if (normalizedName.isNotEmpty) 'restaurantName': normalizedName,
      'sources': AdminRestaurantLinkSource.values
          .where(sources.contains)
          .map((source) => source.callableValue)
          .toList(growable: false),
      if (biteScoreStatus != null)
        'biteScoreStatus': biteScoreStatus.callableValue,
    };

    Object? rawResponse;
    try {
      rawResponse = await _callable(payload);
    } catch (error) {
      if (error is AdminLinkGenerationException) {
        rethrow;
      }
      throw const AdminLinkGenerationException(
        'Could not search restaurants right now. Please try again.',
      );
    }

    try {
      return AdminRestaurantLinkSearchResult.fromCallableData(rawResponse);
    } on FormatException {
      throw const AdminLinkGenerationException(
        'Restaurant search returned an invalid response. Please try again.',
      );
    }
  }

  static Future<Object?> _callFirebase(Map<String, dynamic> payload) async {
    final functions = FirebaseFunctions.instanceFor(region: 'us-central1');
    final callable = functions.httpsCallable('searchAdminRestaurants');
    final response = await callable.call<Object?>(payload);
    return response.data;
  }

  Future<AdminRestaurantPreparationState> updatePreparation({
    required String catalogRestaurantId,
    required AdminRestaurantPreparationType type,
    required bool prepared,
    required AdminBiteSaverCatalogBindingState biteSaverCatalogBindingState,
    required AdminRestaurantClaimState claimState,
    String? expectedInviteId,
  }) async {
    final exactCatalogId = exactFirestoreDocumentId(catalogRestaurantId);
    final exactInviteId = expectedInviteId == null
        ? null
        : exactFirestoreDocumentId(expectedInviteId);
    if (exactCatalogId == null ||
        (expectedInviteId != null && exactInviteId == null)) {
      throw const AdminLinkGenerationException(
        'Preparation identity is unavailable.',
      );
    }
    Object? rawResponse;
    try {
      rawResponse = await _preparationCallable(<String, dynamic>{
        'catalogRestaurantId': exactCatalogId,
        'type': type.marker,
        'prepared': prepared,
        'expectedInviteId': ?exactInviteId,
      });
    } catch (error) {
      if (error is AdminLinkGenerationException) {
        rethrow;
      }
      throw const AdminLinkGenerationException(
        'Could not update preparation status right now.',
      );
    }
    if (rawResponse is! Map || rawResponse['preparation'] == null) {
      throw const AdminLinkGenerationException(
        'Preparation status returned an invalid response.',
      );
    }
    final state = AdminRestaurantPreparationState.tryFromCallableData(
      rawResponse['preparation'],
      source: AdminRestaurantLinkSource.biteScore,
      documentId: exactCatalogId,
      biteSaverCatalogBindingState: biteSaverCatalogBindingState,
      claimState: claimState,
    );
    if (state.canonicalCatalogRestaurantId != exactCatalogId) {
      throw const AdminLinkGenerationException(
        'Preparation status returned an invalid response.',
      );
    }
    return state;
  }

  static Future<Object?> _callPreparationFirebase(
    Map<String, dynamic> payload,
  ) async {
    final functions = FirebaseFunctions.instanceFor(region: 'us-central1');
    final callable = functions.httpsCallable(
      'updateAdminRestaurantQrPreparation',
    );
    final response = await callable.call<Object?>(payload);
    return response.data;
  }

  static String _normalizeWhitespace(String value) {
    return value.trim().replaceAll(RegExp(r'\s+'), ' ');
  }
}
