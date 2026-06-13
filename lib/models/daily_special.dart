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
  static const String fieldExpiresAt = 'expiresAt';

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
  final DateTime? expiresAt;

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
    this.expiresAt,
  });

  bool get showAlways => !hideWhenUnavailable;

  bool get isTodayOnly =>
      availabilityMode == DailySpecialAvailabilityMode.todayOnly;

  bool isExpiredAt(DateTime now) {
    if (!isTodayOnly) {
      return false;
    }

    final effectiveExpiration = expiresAt ?? _fallbackTodayOnlyExpiration();
    if (effectiveExpiration == null) {
      return false;
    }

    return !now.toLocal().isBefore(effectiveExpiration.toLocal());
  }

  bool isScheduledForWeekday(int weekday) {
    if (availabilityMode == DailySpecialAvailabilityMode.todayOnly) {
      return weekday >= DateTime.monday && weekday <= DateTime.sunday;
    }

    return _normalizedDaysOfWeek(daysOfWeek).contains(weekday);
  }

  bool isScheduledAt(DateTime now) {
    return isScheduledForWeekday(now.toLocal().weekday);
  }

  bool isAvailableNow([DateTime? now]) {
    return isAvailableAt(now ?? DateTime.now());
  }

  bool shouldShowPubliclyAt(DateTime now) {
    if (!isActive || isExpiredAt(now) || !isScheduledAt(now)) {
      return false;
    }

    return hideWhenUnavailable ? isAvailableAt(now) : true;
  }

  String scheduleSummaryText({bool includeToday = true}) {
    final parts = <String>[];
    if (availabilityMode == DailySpecialAvailabilityMode.todayOnly) {
      if (includeToday) {
        parts.add('Today');
      }
    } else {
      final daysText = _weekdaySummary(_normalizedDaysOfWeek(daysOfWeek));
      if (daysText != null) {
        parts.add(daysText);
      }
    }

    if (allDay) {
      parts.add(
        includeToday && parts.isNotEmpty
            ? 'available all day'
            : 'Available all day',
      );
    } else {
      final start = _formatDisplayTime(startTime);
      final end = _formatDisplayTime(endTime);
      if (start != null && end != null) {
        parts.add('$start-$end');
      }
    }

    return parts.join(', ');
  }

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

    if (isExpiredAt(now)) {
      return false;
    }

    final localNow = now.toLocal();
    if (!isScheduledAt(localNow)) {
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
    return shouldShowPubliclyAt(now);
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
    DateTime? expiresAt,
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
      expiresAt: expiresAt ?? this.expiresAt,
    );
  }

  Map<String, dynamic> toFirestoreMap({String? id, DateTime? now}) {
    final sanitized = sanitizedForSave(id: id, now: now);
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
      fieldExpiresAt: sanitized.expiresAt == null
          ? null
          : Timestamp.fromDate(sanitized.expiresAt!),
    };
  }

  DailySpecial sanitizedForSave({String? id, DateTime? now}) {
    final trimmedDetails = details?.trim();
    final sanitizedAllDay = allDay;
    final sanitizedAvailabilityMode = availabilityMode;
    final sanitizedExpiresAt =
        sanitizedAvailabilityMode == DailySpecialAvailabilityMode.todayOnly
        ? endOfLocalDay(now ?? DateTime.now())
        : null;
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
      availabilityMode: sanitizedAvailabilityMode,
      daysOfWeek:
          sanitizedAvailabilityMode == DailySpecialAvailabilityMode.specificDays
          ? _normalizedDaysOfWeek(daysOfWeek)
          : const [],
      allDay: sanitizedAllDay,
      startTime: sanitizedAllDay ? null : _normalizedTime(startTime),
      endTime: sanitizedAllDay ? null : _normalizedTime(endTime),
      hideWhenUnavailable: hideWhenUnavailable,
      expiresAt: sanitizedExpiresAt,
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
      expiresAt: _coerceDateTime(data[fieldExpiresAt]),
    );
  }

  static DateTime endOfLocalDay(DateTime value) {
    final local = value.toLocal();
    return DateTime(local.year, local.month, local.day + 1);
  }

  static bool shouldCleanupExpiredTodayOnly(
    DailySpecial special, {
    DateTime? now,
  }) {
    return special.isTodayOnly && special.isExpiredAt(now ?? DateTime.now());
  }

  static List<DailySpecial> visibleSpecialsAt(
    Iterable<DailySpecial> specials,
    DateTime now,
  ) {
    return specials
        .where((special) => special.shouldShowPubliclyAt(now))
        .toList();
  }

  DateTime? _fallbackTodayOnlyExpiration() {
    if (!isTodayOnly) {
      return null;
    }

    final basis = createdAt ?? updatedAt;
    if (basis == null) {
      return null;
    }

    return endOfLocalDay(basis);
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

  static String? _formatDisplayTime(String? value) {
    final normalized = _normalizedTime(value);
    if (normalized == null) {
      return null;
    }

    final parts = normalized.split(':');
    final hour = int.parse(parts[0]);
    final minute = int.parse(parts[1]);
    final displayHour = hour % 12 == 0 ? 12 : hour % 12;
    final displayMinute = minute.toString().padLeft(2, '0');
    final suffix = hour >= 12 ? 'PM' : 'AM';
    return '$displayHour:$displayMinute $suffix';
  }

  static String? _weekdaySummary(List<int> days) {
    if (days.isEmpty) {
      return null;
    }

    final ranges = <String>[];
    var rangeStart = days.first;
    var previous = days.first;
    for (final day in days.skip(1)) {
      if (day == previous + 1) {
        previous = day;
        continue;
      }

      ranges.add(_weekdayRangeLabel(rangeStart, previous));
      rangeStart = day;
      previous = day;
    }
    ranges.add(_weekdayRangeLabel(rangeStart, previous));

    return ranges.join(', ');
  }

  static String _weekdayRangeLabel(int start, int end) {
    if (start == end) {
      return _shortWeekdayNames[start] ?? '';
    }

    return '${_shortWeekdayNames[start]}-${_shortWeekdayNames[end]}';
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

  static const Map<int, String> _shortWeekdayNames = <int, String>{
    DateTime.monday: 'Mon',
    DateTime.tuesday: 'Tue',
    DateTime.wednesday: 'Wed',
    DateTime.thursday: 'Thu',
    DateTime.friday: 'Fri',
    DateTime.saturday: 'Sat',
    DateTime.sunday: 'Sun',
  };
}
