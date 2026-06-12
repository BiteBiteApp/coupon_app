import 'package:coupon_app/models/local_expert.dart';
import 'package:coupon_app/models/local_expert_badge.dart';
import 'package:coupon_app/models/local_expert_badge_calculator.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('LocalExpertBadge parsing', () {
    test('parses valid badge documents', () {
      final badge = LocalExpertBadge.tryFromMap(const {
        'expertTypeId': 'burger',
        'displayName': 'Burger',
        'level': 'level2',
        'totalRestaurantCount': 10,
        'localClusterRestaurantCount': 5,
        'qualificationMethod': 'both',
      });

      expect(badge, isNotNull);
      expect(badge!.expertTypeId, 'burger');
      expect(badge.level, LocalExpertBadgeLevel.level2);
      expect(badge.qualificationMethod, LocalExpertQualificationMethod.both);
    });

    test('uses fallback document id and skips malformed documents safely', () {
      final badge = LocalExpertBadge.tryFromMap(const {
        'displayName': 'Pizza',
        'level': 'level1',
        'totalRestaurantCount': 5,
        'localClusterRestaurantCount': 0,
      }, fallbackExpertTypeId: 'pizza');

      expect(badge?.expertTypeId, 'pizza');
      expect(
        LocalExpertBadge.tryFromMap(const {
          'expertTypeId': 'burger',
          'displayName': 'Burger',
          'level': 'giant-crown',
          'totalRestaurantCount': 5,
          'localClusterRestaurantCount': 0,
        }),
        isNull,
      );
      expect(
        LocalExpertBadge.tryFromMap(const {
          'expertTypeId': 'burger',
          'displayName': 'Burger',
          'level': 'level1',
          'totalRestaurantCount': -1,
          'localClusterRestaurantCount': 0,
        }),
        isNull,
      );
    });
  });

  group('LocalExpertBadge sorting and helpers', () {
    test('sorts by level descending then display name', () {
      final badges = LocalExpertBadge.sortBadges([
        _badge('pizza', 'Pizza', LocalExpertBadgeLevel.level1),
        _badge('burger', 'Burger', LocalExpertBadgeLevel.level3),
        _badge('tacos', 'Tacos', LocalExpertBadgeLevel.level2),
        _badge('chinese', 'Chinese', LocalExpertBadgeLevel.level2),
      ]);

      expect(badges.map((badge) => badge.displayName), [
        'Burger',
        'Chinese',
        'Tacos',
        'Pizza',
      ]);
    });

    test('compact summary limits visible badges and reports hidden count', () {
      final summary = LocalExpertBadgeOverflowSummary.fromBadges([
        _badge('pizza', 'Pizza', LocalExpertBadgeLevel.level1),
        _badge('burger', 'Burger', LocalExpertBadgeLevel.level3),
        _badge('tacos', 'Tacos', LocalExpertBadgeLevel.level2),
      ]);

      expect(summary.visibleBadges, hasLength(2));
      expect(summary.hiddenCount, 1);
      expect(summary.visibleBadges.first.expertTypeId, 'burger');
    });

    test('matching dish type is prioritized before other badges', () {
      final prioritized = LocalExpertBadgePrioritizer.prioritizeForDish(
        badges: [
          _badge('burger', 'Burger', LocalExpertBadgeLevel.level3),
          _badge('pizza', 'Pizza', LocalExpertBadgeLevel.level1),
        ],
        dishName: 'Slice',
        categoryName: 'Pizza',
        categoryTags: const ['pizza', 'italian'],
      );

      expect(prioritized.first.expertTypeId, 'pizza');
    });

    test('empty badge collections are safe', () {
      expect(LocalExpertBadge.sortBadges(const []), isEmpty);
      expect(
        LocalExpertBadgeOverflowSummary.fromBadges(
          const <LocalExpertBadge>[],
        ).hiddenCount,
        0,
      );
    });
  });
}

LocalExpertBadge _badge(
  String expertTypeId,
  String displayName,
  LocalExpertBadgeLevel level,
) {
  return LocalExpertBadge(
    expertTypeId: expertTypeId,
    displayName: displayName,
    level: level,
    totalRestaurantCount: 5,
    localClusterRestaurantCount: 3,
    qualificationMethod: LocalExpertQualificationMethod.overall,
  );
}
