import 'package:coupon_app/models/local_expert.dart';
import 'package:coupon_app/models/local_expert_badge.dart';
import 'package:coupon_app/models/local_expert_badge_calculator.dart';
import 'package:coupon_app/services/local_expert_badge_recalculation_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('LocalExpertBadgeRecalculationClient', () {
    test('requires an authenticated current user', () async {
      final client = LocalExpertBadgeRecalculationClient(
        currentUserIdProvider: () => null,
        callable: () async => const <String, Object?>{},
      );

      expect(client.recalculateMyBadges(), throwsA(isA<StateError>()));
    });

    test('does not submit user ids or badge data to callable', () async {
      var callCount = 0;
      final client = LocalExpertBadgeRecalculationClient(
        currentUserIdProvider: () => 'user-1',
        callable: () async {
          callCount += 1;
          return const {'earnedBadgeCount': 2, 'removedBadgeCount': 1};
        },
      );

      final result = await client.recalculateMyBadges();

      expect(callCount, 1);
      expect(result.earnedBadgeCount, 2);
      expect(result.removedBadgeCount, 1);
    });
  });

  group('LocalExpertBadgeProfileRefreshBridge', () {
    test('calls recalculation at most once per profile session', () async {
      final bridge = LocalExpertBadgeProfileRefreshBridge();
      var recalculationCount = 0;
      var loadCount = 0;

      Future<LocalExpertBadgeRecalculationResult> recalculate() async {
        recalculationCount += 1;
        return const LocalExpertBadgeRecalculationResult(
          earnedBadgeCount: 1,
          removedBadgeCount: 0,
        );
      }

      Future<List<LocalExpertBadge>> loadBadges(String? userId) async {
        loadCount += 1;
        return [_badge()];
      }

      await bridge.loadBadgesAfterSessionRecalculation(
        userId: 'user-1',
        recalculate: recalculate,
        loadBadges: loadBadges,
      );
      await bridge.loadBadgesAfterSessionRecalculation(
        userId: 'user-1',
        recalculate: recalculate,
        loadBadges: loadBadges,
      );

      expect(recalculationCount, 1);
      expect(loadCount, 2);
    });

    test('reloads badges after successful recalculation', () async {
      final bridge = LocalExpertBadgeProfileRefreshBridge();
      final events = <String>[];

      final badges = await bridge.loadBadgesAfterSessionRecalculation(
        userId: 'user-1',
        recalculate: () async {
          events.add('recalculate');
          return const LocalExpertBadgeRecalculationResult(
            earnedBadgeCount: 1,
            removedBadgeCount: 0,
          );
        },
        loadBadges: (userId) async {
          events.add('load:$userId');
          return [_badge()];
        },
      );

      expect(events, ['recalculate', 'load:user-1']);
      expect(badges, hasLength(1));
    });

    test('failure does not prevent badge loading', () async {
      final bridge = LocalExpertBadgeProfileRefreshBridge();
      Object? reportedError;

      final badges = await bridge.loadBadgesAfterSessionRecalculation(
        userId: 'user-1',
        recalculate: () async {
          throw StateError('function unavailable');
        },
        loadBadges: (_) async => const <LocalExpertBadge>[],
        onRecalculationError: (error, stackTrace) {
          reportedError = error;
        },
      );

      expect(reportedError, isA<StateError>());
      expect(badges, isEmpty);
      expect(bridge.hasRequestedRecalculation, isTrue);
    });
  });
}

LocalExpertBadge _badge() {
  return const LocalExpertBadge(
    expertTypeId: 'burger',
    displayName: 'Burger',
    level: LocalExpertBadgeLevel.level1,
    totalRestaurantCount: 5,
    localClusterRestaurantCount: 3,
    qualificationMethod: LocalExpertQualificationMethod.overall,
  );
}
