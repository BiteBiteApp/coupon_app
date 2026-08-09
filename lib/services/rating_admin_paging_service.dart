import 'package:cloud_functions/cloud_functions.dart';

import '../models/admin_restaurant_link_record.dart';
import '../models/pagination/paged_models.dart';
import '../models/rating_admin_paging_models.dart';

typedef RatingAdminFunctionsBoundary =
    Future<Object?> Function(String callableName, Map<String, Object?> request);

class RatingAdminPagingException implements Exception {
  const RatingAdminPagingException(this.message);

  final String message;

  @override
  String toString() => message;
}

class RatingAdminPagingService {
  RatingAdminPagingService({RatingAdminFunctionsBoundary? functionsBoundary})
    : _functionsBoundary = functionsBoundary ?? _callFirebase;

  static const int restaurantPageSize = 50;
  static const int directoryPageSize = 50;
  static const int queuePageSize = 25;
  static const int invitePageSize = 50;

  final RatingAdminFunctionsBoundary _functionsBoundary;

  Future<PagedResponse<RatingAdminRestaurantRecord>> loadRestaurantPage(
    PagedRequest request,
  ) => _load(
    'searchRatingAdminRestaurantsPage',
    request,
    RatingAdminRestaurantRecord.fromJson,
  );

  Future<PagedResponse<RatingAdminDishRecord>> loadDishPage(
    PagedRequest request,
  ) => _load(
    'listRatingAdminDirectoryPage',
    request,
    RatingAdminDishRecord.fromJson,
  );

  Future<PagedResponse<RatingAdminReviewRecord>> loadReviewPage(
    PagedRequest request,
  ) => _load(
    'listRatingAdminDirectoryPage',
    request,
    RatingAdminReviewRecord.fromJson,
  );

  Future<PagedResponse<RatingAdminClaimedRestaurantRecord>>
  loadClaimedRestaurantPage(PagedRequest request) => _load(
    'listRatingAdminDirectoryPage',
    request,
    RatingAdminClaimedRestaurantRecord.fromJson,
  );

  Future<PagedResponse<RatingAdminQueueRecord>> loadQueuePage(
    PagedRequest request,
  ) => _load(
    'listRatingAdminQueuePage',
    request,
    RatingAdminQueueRecord.fromJson,
  );

  Future<PagedResponse<RatingAdminInviteRecord>> loadInviteHistoryPage(
    PagedRequest request,
  ) => _load(
    'listRatingAdminInviteHistoryPage',
    request,
    RatingAdminInviteRecord.fromJson,
  );

  Future<PagedResponse<T>> _load<T>(
    String callableName,
    PagedRequest request,
    T Function(Object? value) parser,
  ) async {
    try {
      final raw = await _functionsBoundary(callableName, request.toJson());
      return PagedResponse<T>.fromJson(raw, itemParser: parser);
    } on RatingAdminPagingException {
      rethrow;
    } on FirebaseFunctionsException catch (error) {
      throw RatingAdminPagingException(
        error.message ?? 'Rating Admin results could not be loaded.',
      );
    } on FormatException {
      throw const RatingAdminPagingException(
        'Rating Admin returned an invalid page. Refresh and try again.',
      );
    } catch (_) {
      throw const RatingAdminPagingException(
        'Rating Admin results could not be loaded. Try again.',
      );
    }
  }

  static Future<Object?> _callFirebase(
    String callableName,
    Map<String, Object?> request,
  ) async {
    final functions = FirebaseFunctions.instanceFor(region: 'us-central1');
    final response = await functions
        .httpsCallable(callableName)
        .call<Object?>(request);
    return response.data;
  }

  static Map<String, Object?> restaurantCriteria({
    required RatingAdminRestaurantSearchMode mode,
    required String location,
    required int radiusMiles,
    required AdminBiteScoreStatus status,
    String? restaurantName,
  }) {
    final normalizedLocation = location.trim().replaceAll(RegExp(r'\s+'), ' ');
    final normalizedName = restaurantName?.trim().replaceAll(
      RegExp(r'\s+'),
      ' ',
    );
    if (normalizedName != null && normalizedName.length > 100) {
      throw const RatingAdminPagingException(
        'Restaurant name must be no more than 100 characters.',
      );
    }
    return switch (mode) {
      RatingAdminRestaurantSearchMode.nearbyRadius => <String, Object?>{
        'mode': mode.wireName,
        'locationQuery': _requireLocation(normalizedLocation),
        'radiusMiles': _requireRadius(radiusMiles),
        'status': status.callableValue,
        if (normalizedName?.isNotEmpty == true)
          'restaurantName': normalizedName,
      },
      RatingAdminRestaurantSearchMode.exactZip => <String, Object?>{
        'mode': mode.wireName,
        'zipCode': _requireZip(normalizedLocation),
        'status': status.callableValue,
        if (normalizedName?.isNotEmpty == true)
          'restaurantName': normalizedName,
      },
      RatingAdminRestaurantSearchMode.exactCity => <String, Object?>{
        'mode': mode.wireName,
        ..._requireCityState(normalizedLocation),
        'status': status.callableValue,
        if (normalizedName?.isNotEmpty == true)
          'restaurantName': normalizedName,
      },
    };
  }

  static String _requireLocation(String value) {
    if (value.isEmpty || value.length > 100) {
      throw const RatingAdminPagingException(
        'Enter a location for nearby search.',
      );
    }
    return value;
  }

  static int _requireRadius(int value) {
    if (value < 1 || value > 50) {
      throw const RatingAdminPagingException(
        'Choose a search radius from 1 through 50 miles.',
      );
    }
    return value;
  }

  static String _requireZip(String value) {
    final match = RegExp(r'^(\d{5})(?:-\d{4})?$').firstMatch(value);
    if (match == null) {
      throw const RatingAdminPagingException(
        'Enter a five-digit ZIP code or ZIP+4.',
      );
    }
    return match.group(1)!;
  }

  static Map<String, Object?> _requireCityState(String value) {
    final match = RegExp(
      r"^([A-Za-z](?:[A-Za-z .'-]*[A-Za-z.])?),\s*([A-Za-z]{2})$",
    ).firstMatch(value);
    if (match == null) {
      throw const RatingAdminPagingException('Enter City, ST.');
    }
    return <String, Object?>{
      'city': match.group(1)!.trim(),
      'state': match.group(2)!.toUpperCase(),
    };
  }

  static Map<String, Object?> dishCriteria({
    required String restaurantId,
    AdminBiteScoreStatus status = AdminBiteScoreStatus.all,
    String? dishName,
  }) => <String, Object?>{
    'directoryKind': RatingAdminDirectoryKind.dishesByRestaurant.wireName,
    'restaurantId': restaurantId,
    'status': status.callableValue,
    if (dishName?.trim().isNotEmpty == true) 'dishName': dishName!.trim(),
  };

  static const Map<String, Object?> reviewCriteria = <String, Object?>{
    'directoryKind': 'reviews',
  };

  static Map<String, Object?> claimedRestaurantCriteria({
    String? restaurantName,
  }) => <String, Object?>{
    'directoryKind': RatingAdminDirectoryKind.claimedRestaurants.wireName,
    if (restaurantName?.trim().isNotEmpty == true)
      'restaurantName': restaurantName!.trim(),
  };

  static Map<String, Object?> queueCriteria(RatingAdminQueueKind kind) =>
      <String, Object?>{'queueKind': kind.wireName};

  static const Map<String, Object?> inviteCriteria = <String, Object?>{
    'side': 'bitescore',
  };
}
