import 'package:cloud_firestore/cloud_firestore.dart';

class Coupon {
  static const String fieldId = 'id';
  static const String fieldRestaurant = 'restaurant';
  static const String fieldTitle = 'title';
  static const String fieldDistance = 'distance';
  static const String fieldExpires = 'expires';
  static const String fieldStartTime = 'startTime';
  static const String fieldEndTime = 'endTime';
  static const String fieldUsageRule = 'usageRule';
  static const String fieldCouponCode = 'couponCode';
  static const String fieldIsProximityOnly = 'isProximityOnly';
  static const String fieldProximityRadiusMiles = 'proximityRadiusMiles';
  static const String fieldDetails = 'details';
  static const String fieldCreatedAt = 'createdAt';
  static const String fieldUpdatedAt = 'updatedAt';
  static const String defaultUsageRule = 'Once per customer';

  final String id;
  final String restaurant;
  final String title;
  final String distance;
  final String? expiresText;
  final DateTime? startTime;
  final DateTime? endTime;
  final String usageRule;
  final String? couponCode;
  final bool isProximityOnly;
  final double? proximityRadiusMiles;
  final String? details;

  const Coupon({
    required this.id,
    required this.restaurant,
    required this.title,
    required this.distance,
    String? expires,
    this.startTime,
    this.endTime,
    required this.usageRule,
    this.couponCode,
    this.isProximityOnly = false,
    this.proximityRadiusMiles,
    this.details,
  }) : expiresText = expires;

  String get expires {
    if (endTime != null) {
      return 'Exp. ${formatMonthDayTime(endTime!)}';
    }

    final legacyText = expiresText?.trim();
    if (legacyText != null && legacyText.isNotEmpty) {
      return legacyText;
    }

    if (startTime != null) {
      return 'Starts ${formatDateTime(startTime!)}';
    }

    return 'Limited time';
  }

  String? get startsLabel =>
      startTime == null ? null : 'Starts ${formatDateTime(startTime!)}';

  String? get endsLabel =>
      endTime == null ? null : 'Exp. ${formatMonthDayTime(endTime!)}';

  String get shortExpiresLabel {
    if (endTime != null) {
      return 'Exp. ${formatMonthDayTime(endTime!)}';
    }

    return expires;
  }

  bool get hasStructuredSchedule => startTime != null || endTime != null;

  String? validateForSave() {
    if (title.trim().isEmpty) {
      return 'Coupon title is required.';
    }

    if (startTime == null) {
      return 'Coupon start time is required.';
    }

    if (endTime == null) {
      return 'Coupon end time is required.';
    }

    if (!endTime!.isAfter(startTime!)) {
      return 'Coupon end time must be after the start time.';
    }

    return null;
  }

  bool get isValidForSave => validateForSave() == null;

  bool isActiveAt(DateTime now) {
    if (startTime != null && now.isBefore(startTime!)) {
      return false;
    }

    if (endTime != null && now.isAfter(endTime!)) {
      return false;
    }

    return true;
  }

  bool isScheduledForFutureAt(DateTime now) {
    return startTime != null && now.isBefore(startTime!);
  }

  bool isExpiredAt(DateTime now) {
    return endTime != null && now.isAfter(endTime!);
  }

  Coupon copyWith({
    String? id,
    String? restaurant,
    String? title,
    String? distance,
    String? expiresText,
    DateTime? startTime,
    DateTime? endTime,
    String? usageRule,
    String? couponCode,
    bool? isProximityOnly,
    double? proximityRadiusMiles,
    String? details,
  }) {
    return Coupon(
      id: id ?? this.id,
      restaurant: restaurant ?? this.restaurant,
      title: title ?? this.title,
      distance: distance ?? this.distance,
      expires: expiresText ?? this.expiresText,
      startTime: startTime ?? this.startTime,
      endTime: endTime ?? this.endTime,
      usageRule: usageRule ?? this.usageRule,
      couponCode: couponCode ?? this.couponCode,
      isProximityOnly: isProximityOnly ?? this.isProximityOnly,
      proximityRadiusMiles: proximityRadiusMiles ?? this.proximityRadiusMiles,
      details: details ?? this.details,
    );
  }

  Map<String, dynamic> toFirestoreMap({String? id}) {
    final validationError = validateForSave();
    if (validationError != null) {
      throw ArgumentError(validationError);
    }

    return {
      fieldId: id ?? this.id,
      fieldRestaurant: restaurant.trim(),
      fieldTitle: title.trim(),
      fieldExpires: expiresText ?? expires,
      fieldStartTime: Timestamp.fromDate(startTime!),
      fieldEndTime: Timestamp.fromDate(endTime!),
      fieldUsageRule:
          usageRule.trim().isEmpty ? defaultUsageRule : usageRule.trim(),
      fieldCouponCode:
          couponCode?.trim().isEmpty == true ? null : couponCode?.trim(),
      fieldIsProximityOnly: isProximityOnly,
      fieldProximityRadiusMiles: proximityRadiusMiles,
      fieldDetails:
          details?.trim().isEmpty == true ? null : details?.trim(),
    };
  }

  static Coupon? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final id = _readString(data[fieldId]) ?? fallbackId;
    final restaurant = _readString(data[fieldRestaurant]) ?? '';
    final title = _readString(data[fieldTitle]) ?? '';
    final distance = _readString(data[fieldDistance]) ?? '';
    final expires = _readString(data[fieldExpires]);
    final parsedStartTime = _coerceDateTime(data[fieldStartTime]);
    final parsedEndTime =
        _coerceDateTime(data[fieldEndTime]) ?? _coerceDateTime(data[fieldExpires]);
    final usageRule = _readString(data[fieldUsageRule]) ?? defaultUsageRule;
    final couponCode = _readString(data[fieldCouponCode]);
    final details = _readString(data[fieldDetails]);
    final isProximityOnly = _readBool(data[fieldIsProximityOnly]) ?? false;
    final proximityRadiusMiles = _readDouble(data[fieldProximityRadiusMiles]);

    final coupon = Coupon(
      id: id,
      restaurant: restaurant,
      title: title,
      distance: distance,
      expires: expires,
      startTime: parsedStartTime,
      endTime: parsedEndTime,
      usageRule: usageRule,
      couponCode: couponCode,
      isProximityOnly: isProximityOnly,
      proximityRadiusMiles: proximityRadiusMiles,
      details: details,
    );

    final hasLegacyFallback =
        restaurant.isNotEmpty &&
        title.isNotEmpty &&
        distance.isNotEmpty &&
        expires != null &&
        expires.isNotEmpty;

    if (coupon.isValidForSave || hasLegacyFallback) {
      return coupon;
    }

    return null;
  }

  static DateTime? _coerceDateTime(dynamic value) {
    if (value == null) {
      return null;
    }

    if (value is Timestamp) {
      return value.toDate().toLocal();
    }

    if (value is DateTime) {
      return value.toLocal();
    }

    if (value is int) {
      return DateTime.fromMillisecondsSinceEpoch(value).toLocal();
    }

    if (value is String) {
      final trimmed = value.trim();
      if (trimmed.isEmpty) {
        return null;
      }

      return DateTime.tryParse(trimmed)?.toLocal();
    }

    return null;
  }

  static String? _readString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }

    return null;
  }

  static bool? _readBool(dynamic value) {
    if (value is bool) {
      return value;
    }

    if (value is String) {
      final normalized = value.trim().toLowerCase();
      if (normalized == 'true') {
        return true;
      }
      if (normalized == 'false') {
        return false;
      }
    }

    return null;
  }

  static double? _readDouble(dynamic value) {
    if (value is num) {
      return value.toDouble();
    }

    if (value is String) {
      return double.tryParse(value.trim());
    }

    return null;
  }

  static String formatDateTime(DateTime dateTime) {
    final local = dateTime.toLocal();
    final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
    final minute = local.minute.toString().padLeft(2, '0');
    final suffix = local.hour >= 12 ? 'PM' : 'AM';
    final month = _monthNames[local.month - 1];

    return '$month ${local.day}, ${local.year} $hour:$minute $suffix';
  }

  static String formatMonthDay(DateTime dateTime) {
    final local = dateTime.toLocal();
    final month = _monthNames[local.month - 1];
    return '$month ${local.day}';
  }

  static String formatMonthDayTime(DateTime dateTime) {
    final local = dateTime.toLocal();
    final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
    final minute = local.minute.toString().padLeft(2, '0');
    final suffix = local.hour >= 12 ? 'PM' : 'AM';
    return '${formatMonthDay(local)} $hour:$minute $suffix';
  }

  static const List<String> _monthNames = <String>[
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
}
