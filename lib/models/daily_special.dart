import 'package:cloud_firestore/cloud_firestore.dart';

enum DailySpecialAvailabilityMode {
  todayOnly('todayOnly'),
  specificDays('specificDays');

  final String firestoreValue;

  const DailySpecialAvailabilityMode(this.firestoreValue);

  static DailySpecialAvailabilityMode fromFirestoreValue(dynamic value) {
    if (value is String) {
      final normalized = value.trim();
      for (final mode in values) {
        if (mode.firestoreValue == normalized) {
          return mode;
        }
      }
    }

    return DailySpecialAvailabilityMode.todayOnly;
  }
}

class DailySpecial {
  static const String fieldId = 'id';
  static const String fieldRestaurantId = 'restaurantId';
  static const String fieldOwnerUid = 'ownerUid';
  static const String fieldTitle = 'title';
  static const String fieldDetails = 'details';
  static const String fieldCreatedAt = 'createdAt';
  static const String fieldUpdatedAt = 'updatedAt';
  static const String fieldIsActive = 'isActive';
  static const String fieldAvailabilityMode = 'availabilityMode';
  static const String fieldDaysOfWeek = 'daysOfWeek';
  static const String fieldAllDay = 'allDay';
  static const String fieldStartTime = 'startTime';
  static const String fieldEndTime = 'endTime';
  static const String fieldHideWhenUnavailable = 'hideWhenUnavailable';

  final String id;
  final String restaurantId;
  final String ownerUid;
  final String title;
  final String? details;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final bool isActive;
  final DailySpecialAvailabilityMode availabilityMode;
  final List<int> daysOfWeek;
  final bool allDay;
  final String? startTime;
  final String? endTime;
  final bool hideWhenUnavailable;

  const DailySpecial({
    required this.id,
    required this.restaurantId,
    required this.ownerUid,
    required this.title,
    this.details,
    this.createdAt,
    this.updatedAt,
    this.isActive = true,
    this.availabilityMode = DailySpecialAvailabilityMode.todayOnly,
    this.daysOfWeek = const [],
    this.allDay = true,
    this.startTime,
    this.endTime,
    this.hideWhenUnavailable = true,
  });

  bool get showAlways => !hideWhenUnavailable;

  String? validateForSave() {
    if (restaurantId.trim().isEmpty) {
      return 'Restaurant ID is required.';
    }

    if (ownerUid.trim().isEmpty) {
      return 'Owner user ID is required.';
    }

    if (title.trim().isEmpty) {
      return 'Daily special title is required.';
    }

    if (availabilityMode == DailySpecialAvailabilityMode.specificDays &&
        _normalizedDaysOfWeek(daysOfWeek).isEmpty) {
      return 'Select at least one day for this daily special.';
    }

    if (!allDay) {
      final startMinutes = _minutesSinceMidnight(startTime);
      final endMinutes = _minutesSinceMidnight(endTime);
      if (startMinutes == null || endMinutes == null) {
        return 'Start and end times are required for timed daily specials.';
      }
      if (endMinutes <= startMinutes) {
        return 'Daily special end time must be after the start time.';
      }
    }

    return null;
  }

  bool get isValidForSave => validateForSave() == null;

  bool isAvailableAt(DateTime now) {
    if (!isActive) {
      return false;
    }

    final localNow = now.toLocal();
    if (availabilityMode == DailySpecialAvailabilityMode.specificDays &&
        !_normalizedDaysOfWeek(daysOfWeek).contains(localNow.weekday)) {
      return false;
    }

    if (allDay) {
      return true;
    }

    final startMinutes = _minutesSinceMidnight(startTime);
    final endMinutes = _minutesSinceMidnight(endTime);
    if (startMinutes == null || endMinutes == null) {
      return false;
    }

    final currentMinutes = localNow.hour * 60 + localNow.minute;
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  bool shouldShowAt(DateTime now) {
    if (!isActive) {
      return false;
    }

    return isAvailableAt(now) || showAlways;
  }

  DailySpecial copyWith({
    String? id,
    String? restaurantId,
    String? ownerUid,
    String? title,
    String? details,
    DateTime? createdAt,
    DateTime? updatedAt,
    bool? isActive,
    DailySpecialAvailabilityMode? availabilityMode,
    List<int>? daysOfWeek,
    bool? allDay,
    String? startTime,
    String? endTime,
    bool? hideWhenUnavailable,
  }) {
    return DailySpecial(
      id: id ?? this.id,
      restaurantId: restaurantId ?? this.restaurantId,
      ownerUid: ownerUid ?? this.ownerUid,
      title: title ?? this.title,
      details: details ?? this.details,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      isActive: isActive ?? this.isActive,
      availabilityMode: availabilityMode ?? this.availabilityMode,
      daysOfWeek: daysOfWeek ?? this.daysOfWeek,
      allDay: allDay ?? this.allDay,
      startTime: startTime ?? this.startTime,
      endTime: endTime ?? this.endTime,
      hideWhenUnavailable: hideWhenUnavailable ?? this.hideWhenUnavailable,
    );
  }

  Map<String, dynamic> toFirestoreMap({String? id}) {
    final sanitized = sanitizedForSave(id: id);
    final validationError = sanitized.validateForSave();
    if (validationError != null) {
      throw ArgumentError(validationError);
    }

    return {
      fieldId: sanitized.id,
      fieldRestaurantId: sanitized.restaurantId,
      fieldOwnerUid: sanitized.ownerUid,
      fieldTitle: sanitized.title,
      fieldDetails: sanitized.details,
      fieldIsActive: sanitized.isActive,
      fieldAvailabilityMode: sanitized.availabilityMode.firestoreValue,
      fieldDaysOfWeek: sanitized.daysOfWeek,
      fieldAllDay: sanitized.allDay,
      fieldStartTime: sanitized.allDay ? null : sanitized.startTime,
      fieldEndTime: sanitized.allDay ? null : sanitized.endTime,
      fieldHideWhenUnavailable: sanitized.hideWhenUnavailable,
    };
  }

  DailySpecial sanitizedForSave({String? id}) {
    final trimmedDetails = details?.trim();
    final sanitizedAllDay = allDay;
    return DailySpecial(
      id: id ?? this.id.trim(),
      restaurantId: restaurantId.trim(),
      ownerUid: ownerUid.trim(),
      title: title.trim(),
      details: trimmedDetails == null || trimmedDetails.isEmpty
          ? null
          : trimmedDetails,
      createdAt: createdAt,
      updatedAt: updatedAt,
      isActive: isActive,
      availabilityMode: availabilityMode,
      daysOfWeek: availabilityMode == DailySpecialAvailabilityMode.specificDays
          ? _normalizedDaysOfWeek(daysOfWeek)
          : const [],
      allDay: sanitizedAllDay,
      startTime: sanitizedAllDay ? null : _normalizedTime(startTime),
      endTime: sanitizedAllDay ? null : _normalizedTime(endTime),
      hideWhenUnavailable: hideWhenUnavailable,
    );
  }

  static DailySpecial? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
    required String fallbackRestaurantId,
  }) {
    if (data == null) {
      return null;
    }

    final restaurantId =
        _readString(data[fieldRestaurantId]) ?? fallbackRestaurantId;
    final ownerUid = _readString(data[fieldOwnerUid]) ?? restaurantId;
    final title = _readString(data[fieldTitle]);
    if (title == null) {
      return null;
    }

    return DailySpecial(
      id: _readString(data[fieldId]) ?? fallbackId,
      restaurantId: restaurantId,
      ownerUid: ownerUid,
      title: title,
      details: _readString(data[fieldDetails]),
      createdAt: _coerceDateTime(data[fieldCreatedAt]),
      updatedAt: _coerceDateTime(data[fieldUpdatedAt]),
      isActive: _readBool(data[fieldIsActive]) ?? true,
      availabilityMode: DailySpecialAvailabilityMode.fromFirestoreValue(
        data[fieldAvailabilityMode],
      ),
      daysOfWeek: _readDaysOfWeek(data[fieldDaysOfWeek]),
      allDay: _readBool(data[fieldAllDay]) ?? true,
      startTime: _normalizedTime(_readString(data[fieldStartTime])),
      endTime: _normalizedTime(_readString(data[fieldEndTime])),
      hideWhenUnavailable: _readBool(data[fieldHideWhenUnavailable]) ?? true,
    );
  }

  static List<int> _readDaysOfWeek(dynamic value) {
    if (value is Iterable) {
      return _normalizedDaysOfWeek(value.map(_readDayOfWeek).nonNulls);
    }

    return const [];
  }

  static int? _readDayOfWeek(dynamic value) {
    if (value is int && value >= DateTime.monday && value <= DateTime.sunday) {
      return value;
    }

    if (value is num) {
      final intValue = value.toInt();
      if (intValue >= DateTime.monday && intValue <= DateTime.sunday) {
        return intValue;
      }
    }

    if (value is String) {
      final normalized = value.trim().toLowerCase();
      final parsed = int.tryParse(normalized);
      if (parsed != null &&
          parsed >= DateTime.monday &&
          parsed <= DateTime.sunday) {
        return parsed;
      }

      return _weekdayNames[normalized];
    }

    return null;
  }

  static List<int> _normalizedDaysOfWeek(Iterable<int> days) {
    final normalized =
        days
            .where((day) => day >= DateTime.monday && day <= DateTime.sunday)
            .toSet()
            .toList()
          ..sort();
    return List<int>.unmodifiable(normalized);
  }

  static int? _minutesSinceMidnight(String? value) {
    final normalized = _normalizedTime(value);
    if (normalized == null) {
      return null;
    }

    final parts = normalized.split(':');
    return int.parse(parts[0]) * 60 + int.parse(parts[1]);
  }

  static String? _normalizedTime(String? value) {
    if (value == null) {
      return null;
    }

    final match = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(value.trim());
    if (match == null) {
      return null;
    }

    final hour = int.parse(match.group(1)!);
    final minute = int.parse(match.group(2)!);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }

    return '${hour.toString().padLeft(2, '0')}:'
        '${minute.toString().padLeft(2, '0')}';
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

    if (value is num) {
      return value != 0;
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

  static DateTime? _coerceDateTime(dynamic value) {
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

  static const Map<String, int> _weekdayNames = <String, int>{
    'monday': DateTime.monday,
    'mon': DateTime.monday,
    'tuesday': DateTime.tuesday,
    'tue': DateTime.tuesday,
    'wednesday': DateTime.wednesday,
    'wed': DateTime.wednesday,
    'thursday': DateTime.thursday,
    'thu': DateTime.thursday,
    'friday': DateTime.friday,
    'fri': DateTime.friday,
    'saturday': DateTime.saturday,
    'sat': DateTime.saturday,
    'sunday': DateTime.sunday,
    'sun': DateTime.sunday,
  };
}
