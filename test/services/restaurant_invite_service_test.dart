import 'package:coupon_app/services/restaurant_invite_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('RestaurantInviteCreationResult', () {
    test('parses one-time invite creation response', () {
      final result = RestaurantInviteCreationResult.fromCallableData({
        'inviteId': 'invite_123',
        'token': 'plain-token',
        'inviteUrl': 'https://colesmartllc.com/invite/coupon/plain-token',
        'expiresAtMillis': 1767225600000,
      });

      expect(result.inviteId, 'invite_123');
      expect(result.token, 'plain-token');
      expect(
        result.inviteUrl,
        'https://colesmartllc.com/invite/coupon/plain-token',
      );
      expect(
        result.expiresAt,
        DateTime.fromMillisecondsSinceEpoch(1767225600000),
      );
    });
  });

  group('RestaurantInviteAdminEntry', () {
    test('parses invite metadata without requiring plaintext token', () {
      final entry = RestaurantInviteAdminEntry.fromCallableData({
        'id': 'invite_123',
        'type': 'bitescore_claim_invite',
        'side': 'bitescore',
        'status': 'active',
        'restaurantId': 'restaurant_abc',
        'pendingRestaurantKey': '',
        'restaurantName': 'Test Restaurant',
        'createdByEmail': 'admin@example.com',
        'createdAtMillis': 1760000000000,
        'expiresAtMillis': 1767225600000,
        'usedAtMillis': null,
        'usedByEmail': '',
        'maxUses': 1,
        'useCount': 0,
      });

      expect(entry.id, 'invite_123');
      expect(entry.type, 'bitescore_claim_invite');
      expect(entry.side, 'bitescore');
      expect(entry.isActive, isTrue);
      expect(entry.restaurantId, 'restaurant_abc');
      expect(entry.restaurantName, 'Test Restaurant');
      expect(entry.maxUses, 1);
      expect(entry.useCount, 0);
      expect(entry.usedAt, isNull);
      expect(entry.usedByEmail, isEmpty);
    });

    test('supports coupon invites without an existing restaurant ID', () {
      final entry = RestaurantInviteAdminEntry.fromCallableData({
        'id': 'invite_456',
        'type': 'coupon_invite',
        'side': 'coupon',
        'status': 'active',
        'restaurantId': '',
        'pendingRestaurantKey': 'pending_invite_456',
        'restaurantName': 'New Restaurant',
        'usedAtMillis': 1762000000000,
        'usedByEmail': 'owner@example.com',
        'maxUses': 1,
        'useCount': 0,
      });

      expect(entry.restaurantId, isEmpty);
      expect(entry.pendingRestaurantKey, 'pending_invite_456');
      expect(entry.restaurantName, 'New Restaurant');
      expect(entry.usedAt, DateTime.fromMillisecondsSinceEpoch(1762000000000));
      expect(entry.usedByEmail, 'owner@example.com');
      expect(entry.isActive, isTrue);
    });
  });

  group('RestaurantInviteService', () {
    test('requires BiteScore restaurant ID before creating claim invite', () {
      expect(
        RestaurantInviteService.createBiteScoreClaimInvite(restaurantId: ''),
        throwsArgumentError,
      );
    });
  });
}
