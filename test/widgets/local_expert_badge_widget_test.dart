import 'package:coupon_app/models/local_expert.dart';
import 'package:coupon_app/widgets/local_expert_badge_widget.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('LocalExpertBadgeVisuals', () {
    test('level 1 uses bronze single-ring metadata', () {
      final metadata = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: 'burger',
        level: LocalExpertBadgeLevel.level1,
      );

      expect(metadata.ringCount, 1);
      expect(metadata.levelMarker, 'I');
      expect(metadata.usesCrown, isFalse);
      expect(metadata.icon, Icons.lunch_dining);
    });

    test('level 2 uses silver double-ring metadata', () {
      final metadata = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: 'pizza',
        level: LocalExpertBadgeLevel.level2,
      );

      expect(metadata.ringCount, 2);
      expect(metadata.levelMarker, 'II');
      expect(metadata.usesCrown, isFalse);
      expect(metadata.icon, Icons.local_pizza);
    });

    test('level 3 uses gold triple-ring metadata with no crown', () {
      final metadata = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: 'steak',
        level: LocalExpertBadgeLevel.level3,
      );

      expect(metadata.ringCount, 3);
      expect(metadata.levelMarker, 'III');
      expect(metadata.usesCrown, isFalse);
      expect(metadata.icon, Icons.restaurant_menu);
    });

    test('central icon mapping falls back safely', () {
      expect(LocalExpertBadgeVisuals.iconForName('set_meal'), Icons.set_meal);
      expect(
        LocalExpertBadgeVisuals.iconForName('not_a_known_icon'),
        Icons.restaurant_menu,
      );
    });
  });
}
