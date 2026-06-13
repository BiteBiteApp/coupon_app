import 'package:coupon_app/models/daily_special.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('DailySpecial availability', () {
    test('today-only all-day special is available when active', () {
      final special = DailySpecial(
        id: 'today',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Soup of the Day',
        expiresAt: DateTime(2026, 6, 9),
      );

      expect(special.isAvailableAt(DateTime(2026, 6, 8, 9)), isTrue);
      expect(special.shouldShowAt(DateTime(2026, 6, 8, 9)), isTrue);
      expect(special.isScheduledAt(DateTime(2026, 6, 8, 9)), isTrue);
      expect(special.scheduleSummaryText(), 'Today, available all day');
    });

    test('today-only special created today expires at local midnight', () {
      final special = DailySpecial(
        id: 'today',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Today Taco',
      ).sanitizedForSave(now: DateTime(2026, 6, 12, 14, 30));

      expect(special.expiresAt, DateTime(2026, 6, 13));
      expect(special.shouldShowAt(DateTime(2026, 6, 12, 23, 59)), isTrue);
      expect(special.shouldShowAt(DateTime(2026, 6, 13)), isFalse);
      expect(special.isExpiredAt(DateTime(2026, 6, 13)), isTrue);
    });

    test('firestore map stores expiresAt only for today-only specials', () {
      final todayOnlyMap = DailySpecial(
        id: 'today',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Today Taco',
      ).toFirestoreMap(now: DateTime(2026, 6, 12, 14, 30));
      final recurringMap = DailySpecial(
        id: 'recurring',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Monday Pasta',
        availabilityMode: DailySpecialAvailabilityMode.specificDays,
        daysOfWeek: const [DateTime.monday],
      ).toFirestoreMap(now: DateTime(2026, 6, 12, 14, 30));

      expect(
        todayOnlyMap[DailySpecial.fieldExpiresAt],
        isA<Timestamp>().having(
          (timestamp) => timestamp.toDate(),
          'date',
          DateTime(2026, 6, 13),
        ),
      );
      expect(recurringMap[DailySpecial.fieldExpiresAt], isNull);
    });

    test('expired today-only special is filtered even if document remains', () {
      final special = DailySpecial(
        id: 'stale',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Yesterday Burger',
        availabilityMode: DailySpecialAvailabilityMode.todayOnly,
        expiresAt: DateTime(2026, 6, 13),
      );

      expect(special.shouldShowAt(DateTime(2026, 6, 12, 18)), isTrue);
      expect(special.shouldShowAt(DateTime(2026, 6, 13, 0, 1)), isFalse);
      expect(
        DailySpecial.visibleSpecialsAt([special], DateTime(2026, 6, 13, 0, 1)),
        isEmpty,
      );
    });

    test('legacy today-only special falls back to created date expiration', () {
      final special = DailySpecial(
        id: 'legacy',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Legacy Plate',
        availabilityMode: DailySpecialAvailabilityMode.todayOnly,
        createdAt: DateTime(2026, 6, 12, 10),
      );

      expect(special.shouldShowAt(DateTime(2026, 6, 12, 20)), isTrue);
      expect(special.shouldShowAt(DateTime(2026, 6, 13, 1)), isFalse);
    });

    test('cleanup targets only expired today-only specials', () {
      final expiredTodayOnly = DailySpecial(
        id: 'expired',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Expired',
        expiresAt: DateTime(2026, 6, 13),
      );
      final recurringWeekday = DailySpecial(
        id: 'weekday',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Monday Pasta',
        availabilityMode: DailySpecialAvailabilityMode.specificDays,
        daysOfWeek: const [DateTime.monday],
      );
      final disabledRecurring = recurringWeekday.copyWith(
        id: 'disabled',
        isActive: false,
      );

      expect(
        DailySpecial.shouldCleanupExpiredTodayOnly(
          expiredTodayOnly,
          now: DateTime(2026, 6, 13, 0, 1),
        ),
        isTrue,
      );
      expect(
        DailySpecial.shouldCleanupExpiredTodayOnly(
          recurringWeekday,
          now: DateTime(2026, 6, 13, 0, 1),
        ),
        isFalse,
      );
      expect(
        DailySpecial.shouldCleanupExpiredTodayOnly(
          disabledRecurring,
          now: DateTime(2026, 6, 13, 0, 1),
        ),
        isFalse,
      );
    });

    test('inactive special is unavailable even when showAlways is enabled', () {
      final hiddenSpecial = DailySpecial(
        id: 'hidden',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Chef Plate',
        isActive: false,
      );
      final showAlwaysSpecial = DailySpecial(
        id: 'show',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Chef Plate',
        isActive: false,
        hideWhenUnavailable: false,
      );

      expect(hiddenSpecial.isAvailableAt(DateTime(2026, 6, 8, 9)), isFalse);
      expect(hiddenSpecial.shouldShowAt(DateTime(2026, 6, 8, 9)), isFalse);
      expect(showAlwaysSpecial.isAvailableAt(DateTime(2026, 6, 8, 9)), isFalse);
      expect(showAlwaysSpecial.shouldShowAt(DateTime(2026, 6, 8, 9)), isFalse);
    });

    test('showAlways displays an active special outside its schedule', () {
      final special = DailySpecial(
        id: 'show',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Dinner Feature',
        allDay: false,
        startTime: '17:00',
        endTime: '21:00',
        hideWhenUnavailable: false,
      );

      expect(special.isAvailableAt(DateTime(2026, 6, 8, 12)), isFalse);
      expect(special.shouldShowAt(DateTime(2026, 6, 8, 12)), isTrue);
      expect(special.shouldShowPubliclyAt(DateTime(2026, 6, 8, 12)), isTrue);
    });

    test('showAlways does not display on an unselected weekday', () {
      final special = DailySpecial(
        id: 'show-wednesday',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Wednesday Dinner',
        availabilityMode: DailySpecialAvailabilityMode.specificDays,
        daysOfWeek: const [DateTime.wednesday],
        allDay: false,
        startTime: '17:00',
        endTime: '21:00',
        hideWhenUnavailable: false,
      );

      expect(special.isAvailableAt(DateTime(2026, 6, 8, 18)), isFalse);
      expect(special.shouldShowPubliclyAt(DateTime(2026, 6, 8, 18)), isFalse);
      expect(special.shouldShowPubliclyAt(DateTime(2026, 6, 10, 12)), isTrue);
    });

    test('specific-days special matches the local weekday', () {
      final mondaySpecial = DailySpecial(
        id: 'monday',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Monday Pasta',
        availabilityMode: DailySpecialAvailabilityMode.specificDays,
        daysOfWeek: const [DateTime.monday],
      );

      expect(mondaySpecial.isAvailableAt(DateTime(2026, 6, 8, 12)), isTrue);
      expect(mondaySpecial.isAvailableAt(DateTime(2026, 6, 9, 12)), isFalse);
      expect(mondaySpecial.isScheduledForWeekday(DateTime.monday), isTrue);
      expect(mondaySpecial.isScheduledForWeekday(DateTime.tuesday), isFalse);
      expect(
        DailySpecial.visibleSpecialsAt([
          mondaySpecial,
        ], DateTime(2026, 6, 8, 12)),
        [mondaySpecial],
      );
    });

    test('timed special is available only within its local time window', () {
      final lunchSpecial = DailySpecial(
        id: 'lunch',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Lunch Bowl',
        allDay: false,
        startTime: '11:00',
        endTime: '14:30',
      );

      expect(lunchSpecial.isAvailableAt(DateTime(2026, 6, 8, 10, 59)), isFalse);
      expect(lunchSpecial.isAvailableAt(DateTime(2026, 6, 8, 11)), isTrue);
      expect(lunchSpecial.isAvailableAt(DateTime(2026, 6, 8, 14, 30)), isTrue);
      expect(lunchSpecial.isAvailableAt(DateTime(2026, 6, 8, 14, 31)), isFalse);
      expect(
        lunchSpecial.shouldShowPubliclyAt(DateTime(2026, 6, 8, 10, 59)),
        isFalse,
      );
      expect(
        DailySpecial.visibleSpecialsAt([
          lunchSpecial,
        ], DateTime(2026, 6, 8, 10, 59)),
        isEmpty,
      );
      expect(
        DailySpecial.visibleSpecialsAt([
          lunchSpecial,
        ], DateTime(2026, 6, 8, 11)),
        [lunchSpecial],
      );
      expect(lunchSpecial.scheduleSummaryText(), 'Today, 11:00 AM-2:30 PM');
    });

    test('shared BiteSaver display filtering respects expiration', () {
      final visibleToday = DailySpecial(
        id: 'visible',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Visible Today',
        expiresAt: DateTime(2026, 6, 13),
      );
      final expired = DailySpecial(
        id: 'expired',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Expired Today Only',
        expiresAt: DateTime(2026, 6, 12),
      );
      final recurring = DailySpecial(
        id: 'recurring',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Friday Fish',
        availabilityMode: DailySpecialAvailabilityMode.specificDays,
        daysOfWeek: const [DateTime.friday],
      );

      expect(
        DailySpecial.visibleSpecialsAt([
          visibleToday,
          expired,
          recurring,
        ], DateTime(2026, 6, 12, 12)).map((special) => special.id),
        ['visible', 'recurring'],
      );
    });

    test('schedule summary compacts consecutive weekdays', () {
      final weekdayLunch = DailySpecial(
        id: 'weekday-lunch',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Weekday Lunch',
        availabilityMode: DailySpecialAvailabilityMode.specificDays,
        daysOfWeek: const [
          DateTime.monday,
          DateTime.tuesday,
          DateTime.wednesday,
          DateTime.thursday,
          DateTime.friday,
        ],
        allDay: false,
        startTime: '10:00',
        endTime: '14:00',
      );
      final splitDays = weekdayLunch.copyWith(
        daysOfWeek: const [
          DateTime.monday,
          DateTime.wednesday,
          DateTime.friday,
        ],
      );

      expect(weekdayLunch.scheduleSummaryText(), 'Mon-Fri, 10:00 AM-2:00 PM');
      expect(
        splitDays.scheduleSummaryText(),
        'Mon, Wed, Fri, 10:00 AM-2:00 PM',
      );
    });

    test('validation requires a day for specific-day specials', () {
      final special = DailySpecial(
        id: 'invalid',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Weekend Brunch',
        availabilityMode: DailySpecialAvailabilityMode.specificDays,
      );

      expect(
        special.validateForSave(),
        'Select at least one day for this daily special.',
      );
    });
  });
}
