import 'package:cloud_functions/cloud_functions.dart';

import '../models/coupon_admin_paging_models.dart';
import '../models/pagination/paged_models.dart';

typedef CouponAdminFunctionsBoundary =
    Future<Object?> Function(String callableName, Map<String, Object?> request);

class CouponAdminPagingException implements Exception {
  const CouponAdminPagingException(this.message);

  final String message;

  @override
  String toString() => message;
}

class CouponAdminPagingService {
  CouponAdminPagingService({CouponAdminFunctionsBoundary? functionsBoundary})
    : _functionsBoundary = functionsBoundary ?? _callFirebase;

  static const int restaurantPageSize = 50;
  static const int queuePageSize = 25;
  static const int couponPageSize = 25;
  static const int invitePageSize = 50;

  final CouponAdminFunctionsBoundary _functionsBoundary;

  Future<PagedResponse<CouponAdminRestaurantRecord>> loadRestaurantPage(
    PagedRequest request,
  ) => _load(
    'searchCouponAdminRestaurantsPage',
    request,
    CouponAdminRestaurantRecord.fromJson,
  );

  Future<PagedResponse<CouponAdminQueueRecord>> loadQueuePage(
    PagedRequest request,
  ) => _load(
    'listCouponAdminQueuePage',
    request,
    CouponAdminQueueRecord.fromJson,
  );

  Future<PagedResponse<CouponAdminCouponRecord>> loadCouponPage(
    PagedRequest request,
  ) => _load(
    'listCouponAdminCouponsPage',
    request,
    CouponAdminCouponRecord.fromJson,
  );

  Future<PagedResponse<CouponAdminInviteRecord>> loadCouponInviteHistoryPage(
    PagedRequest request,
  ) => _load(
    'listCouponAdminInviteHistoryPage',
    request,
    CouponAdminInviteRecord.fromJson,
  );

  Future<PagedResponse<T>> _load<T>(
    String callableName,
    PagedRequest request,
    T Function(Object? value) parser,
  ) async {
    try {
      final raw = await _functionsBoundary(callableName, request.toJson());
      return PagedResponse<T>.fromJson(raw, itemParser: parser);
    } on CouponAdminPagingException {
      rethrow;
    } on FirebaseFunctionsException catch (error) {
      throw CouponAdminPagingException(
        error.message ?? 'Coupon Admin results could not be loaded.',
      );
    } on FormatException {
      throw const CouponAdminPagingException(
        'Coupon Admin returned an invalid page. Refresh and try again.',
      );
    } catch (_) {
      throw const CouponAdminPagingException(
        'Coupon Admin results could not be loaded. Try again.',
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
    required CouponAdminRestaurantSearchMode mode,
    required String location,
    required int radiusMiles,
    String? restaurantName,
  }) {
    final normalizedLocation = location.trim().replaceAll(RegExp(r'\s+'), ' ');
    final normalizedName = restaurantName?.trim().replaceAll(
      RegExp(r'\s+'),
      ' ',
    );
    if (normalizedName != null && normalizedName.length > 100) {
      throw const CouponAdminPagingException(
        'Restaurant name must be no more than 100 characters.',
      );
    }
    return switch (mode) {
      CouponAdminRestaurantSearchMode.nearbyRadius => <String, Object?>{
        'mode': mode.wireName,
        'locationQuery': _requireLocation(normalizedLocation),
        'radiusMiles': _requireRadius(radiusMiles),
        if (normalizedName?.isNotEmpty == true)
          'restaurantName': normalizedName,
      },
      CouponAdminRestaurantSearchMode.exactZip => <String, Object?>{
        'mode': mode.wireName,
        'zipCode': _requireZip(normalizedLocation),
        if (normalizedName?.isNotEmpty == true)
          'restaurantName': normalizedName,
      },
      CouponAdminRestaurantSearchMode.exactCity => <String, Object?>{
        'mode': mode.wireName,
        ..._requireCityState(normalizedLocation),
        if (normalizedName?.isNotEmpty == true)
          'restaurantName': normalizedName,
      },
    };
  }

  static String _requireLocation(String value) {
    if (value.isEmpty || value.length > 100) {
      throw const CouponAdminPagingException(
        'Enter a location for nearby search.',
      );
    }
    return value;
  }

  static int _requireRadius(int value) {
    if (value < 1 || value > 50) {
      throw const CouponAdminPagingException(
        'Choose a search radius from 1 through 50 miles.',
      );
    }
    return value;
  }

  static String _requireZip(String value) {
    final match = RegExp(r'^(\d{5})(?:-\d{4})?$').firstMatch(value);
    if (match == null) {
      throw const CouponAdminPagingException(
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
      throw const CouponAdminPagingException('Enter City, ST.');
    }
    return <String, Object?>{
      'city': match.group(1)!.trim(),
      'state': match.group(2)!.toUpperCase(),
    };
  }
}
