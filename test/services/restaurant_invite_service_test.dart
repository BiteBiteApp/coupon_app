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

    test('parses double-slash coupon invite custom-scheme links', () {
      final link = RestaurantInviteService.parseInviteDeepLink(
        Uri.parse('bitesaver://invite/coupon/token123'),
      );

      expect(link, isNotNull);
      expect(link!.side, 'coupon');
      expect(link.token, 'token123');
    });

    test('parses triple-slash coupon invite custom-scheme links', () {
      final link = RestaurantInviteService.parseInviteDeepLink(
        Uri.parse('bitesaver:///invite/coupon/token123'),
      );

      expect(link, isNotNull);
      expect(link!.side, 'coupon');
      expect(link.token, 'token123');
    });

    test('parses double-slash BiteScore invite custom-scheme links', () {
      final link = RestaurantInviteService.parseInviteDeepLink(
        Uri.parse('bitesaver://invite/bitescore/token123'),
      );

      expect(link, isNotNull);
      expect(link!.side, 'bitescore');
      expect(link.token, 'token123');
    });

    test('parses triple-slash BiteScore invite custom-scheme links', () {
      final link = RestaurantInviteService.parseInviteDeepLink(
        Uri.parse('bitesaver:///invite/bitescore/token123'),
      );

      expect(link, isNotNull);
      expect(link!.side, 'bitescore');
      expect(link.token, 'token123');
    });

    test('parses HTTPS coupon invite links on trusted QR hosts', () {
      const trustedHosts = [
        'go.bitestar.app',
        'app.bitestar.app',
        'go.biteranger.com',
        'app.biteranger.com',
        'go.colesmartllc.com',
        'app.colesmartllc.com',
        'colesmartllc.com',
        'www.colesmartllc.com',
      ];

      for (final host in trustedHosts) {
        final link = RestaurantInviteService.parseInviteDeepLink(
          Uri.parse('https://$host/invite/coupon/test-token'),
        );

        expect(link, isNotNull, reason: host);
        expect(link!.side, 'coupon', reason: host);
        expect(link.token, 'test-token', reason: host);
      }
    });

    test('parses HTTPS BiteScore invite links on trusted QR hosts', () {
      const trustedHosts = [
        'go.bitestar.app',
        'app.bitestar.app',
        'go.biteranger.com',
        'app.biteranger.com',
        'go.colesmartllc.com',
        'app.colesmartllc.com',
        'colesmartllc.com',
        'www.colesmartllc.com',
      ];

      for (final host in trustedHosts) {
        final link = RestaurantInviteService.parseInviteDeepLink(
          Uri.parse('https://$host/invite/bitescore/test-token'),
        );

        expect(link, isNotNull, reason: host);
        expect(link!.side, 'bitescore', reason: host);
        expect(link.token, 'test-token', reason: host);
      }
    });

    test('parses Flutter startup coupon invite route name', () {
      final link = RestaurantInviteService.parseInviteRouteName(
        '/coupon/token123',
      );

      expect(link, isNotNull);
      expect(link!.side, 'coupon');
      expect(link.token, 'token123');
    });

    test('parses Flutter startup BiteScore invite route name', () {
      final link = RestaurantInviteService.parseInviteRouteName(
        '/bitescore/token123',
      );

      expect(link, isNotNull);
      expect(link!.side, 'bitescore');
      expect(link.token, 'token123');
    });

    test('parses explicit invite route name', () {
      final link = RestaurantInviteService.parseInviteRouteName(
        '/invite/coupon/token123',
      );

      expect(link, isNotNull);
      expect(link!.side, 'coupon');
      expect(link.token, 'token123');
    });

    test('ignores existing subscription deep links', () {
      final link = RestaurantInviteService.parseInviteDeepLink(
        Uri.parse('bitesaver://subscription-success'),
      );

      expect(link, isNull);
    });

    test('ignores existing subscription route names', () {
      final success = RestaurantInviteService.parseInviteRouteName(
        '/subscription-success',
      );
      final cancel = RestaurantInviteService.parseInviteRouteName(
        '/subscription-cancel',
      );

      expect(success, isNull);
      expect(cancel, isNull);
    });

    test('ignores unsupported invite routes', () {
      final link = RestaurantInviteService.parseInviteDeepLink(
        Uri.parse('bitesaver://invite/other/token123'),
      );

      expect(link, isNull);
    });

    test('ignores invite HTTPS links on untrusted hosts', () {
      final link = RestaurantInviteService.parseInviteDeepLink(
        Uri.parse('https://evil.com/invite/coupon/test-token'),
      );

      expect(link, isNull);
    });

    test('ignores random HTTPS paths on colesmartllc.com', () {
      final link = RestaurantInviteService.parseInviteDeepLink(
        Uri.parse('https://colesmartllc.com/random/path'),
      );

      expect(link, isNull);
    });

    test('ignores plain HTTP invite links on colesmartllc.com', () {
      final link = RestaurantInviteService.parseInviteDeepLink(
        Uri.parse('http://colesmartllc.com/invite/coupon/test-token'),
      );

      expect(link, isNull);
    });
  });

  group('RestaurantInvitePreview', () {
    test('parses safe coupon preview data', () {
      final preview = RestaurantInvitePreview.fromCallableData({
        'inviteId': 'invite_coupon',
        'side': 'coupon',
        'type': 'coupon_invite',
        'status': 'active',
        'restaurantName': 'Preview Restaurant',
        'pendingRestaurantKey': 'pending_invite_coupon',
        'expiresAtMillis': 1767225600000,
        'couponPrefill': {
          'streetAddress': '123 Main St',
          'city': 'Lecanto',
          'state': 'FL',
          'zipCode': '34461',
          'phone': '(352) 555-1234',
          'website': 'https://example.com',
          'latitude': 28.8,
          'longitude': -82.4,
        },
      });

      expect(preview.isCoupon, isTrue);
      expect(preview.restaurantName, 'Preview Restaurant');
      expect(preview.pendingRestaurantKey, 'pending_invite_coupon');
      expect(preview.couponPrefill?.streetAddress, '123 Main St');
      expect(preview.couponPrefill?.latitude, 28.8);
    });

    test('parses safe BiteScore preview data', () {
      final preview = RestaurantInvitePreview.fromCallableData({
        'inviteId': 'invite_bitescore',
        'side': 'bitescore',
        'type': 'bitescore_claim_invite',
        'status': 'active',
        'restaurantId': 'restaurant_123',
        'restaurantName': 'Claim Restaurant',
        'restaurantAddressSummary': '123 Main St, Lecanto, FL, 34461',
        'expiresAtMillis': 1767225600000,
      });

      expect(preview.isBiteScore, isTrue);
      expect(preview.restaurantId, 'restaurant_123');
      expect(
        preview.restaurantAddressSummary,
        '123 Main St, Lecanto, FL, 34461',
      );
      expect(preview.couponPrefill, isNull);
    });
  });

  group('RestaurantInviteRedemptionResult', () {
    test('parses coupon redemption response', () {
      final result = RestaurantInviteRedemptionResult.fromCallableData({
        'inviteId': 'invite_coupon',
        'restaurantName': 'Redeemed Restaurant',
      });

      expect(result.inviteId, 'invite_coupon');
      expect(result.restaurantId, isEmpty);
      expect(result.restaurantName, 'Redeemed Restaurant');
    });

    test('parses BiteScore claim redemption response', () {
      final result = RestaurantInviteRedemptionResult.fromCallableData({
        'inviteId': 'invite_bitescore',
        'restaurantId': 'restaurant_123',
        'restaurantName': 'Claimed Restaurant',
      });

      expect(result.inviteId, 'invite_bitescore');
      expect(result.restaurantId, 'restaurant_123');
      expect(result.restaurantName, 'Claimed Restaurant');
    });
  });
}
