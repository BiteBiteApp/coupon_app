import 'package:coupon_app/models/daily_special.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('DailySpecial availability', () {
    test('today-only all-day special is available when active', () {
      final special = DailySpecial(
        id: 'today',
        restaurantId: 'restaurant-1',
        ownerUid: 'restaurant-1',
        title: 'Soup of the Day',
      );

      expect(special.isAvailableAt(DateTime(2026, 6, 8, 9)), isTrue);
      expect(special.shouldShowAt(DateTime(2026, 6, 8, 9)), isTrue);
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
