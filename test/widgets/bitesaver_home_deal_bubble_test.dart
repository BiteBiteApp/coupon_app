import 'package:coupon_app/screens/home_screen.dart';
import 'package:coupon_app/widgets/bitesaver_colors.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BiteSaverHomeDealBubble', () {
    testWidgets('uses a larger tappable bubble hit target', (tester) async {
      var tapped = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 280,
              child: BiteSaverHomeDealBubble(
                onTap: () {
                  tapped = true;
                },
                backgroundColor: const Color(0xFFF8FCF2),
                borderColor: const Color(0xFFB9D99E),
                child: const Row(
                  children: [
                    Expanded(child: Text('Free fries with any combo')),
                    Icon(Icons.chevron_right),
                  ],
                ),
              ),
            ),
          ),
        ),
      );

      final bubbleRect = tester.getRect(find.byType(BiteSaverHomeDealBubble));

      expect(
        BiteSaverHomeDealBubble.verticalPadding,
        greaterThan(BiteSaverHomeDealBubble.previousVerticalPadding),
      );
      expect(
        bubbleRect.height,
        greaterThanOrEqualTo(BiteSaverHomeDealBubble.minHeight),
      );
      expect(
        BiteSaverHomeDealBubble.minHeight,
        BiteSaverHomeDealBubble.previousApproximateCouponHeight * 1.25,
      );

      await tester.tap(find.byType(BiteSaverHomeDealBubble));

      expect(tapped, isTrue);
    });

    testWidgets('keeps row content centered and safe on narrow widths', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 180,
              child: BiteSaverHomeDealBubble(
                onTap: null,
                backgroundColor: BiteSaverColors.secondaryBackground,
                borderColor: BiteSaverColors.borderStrong,
                child: Row(
                  children: [
                    Icon(Icons.local_fire_department_outlined, size: 17),
                    SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'Today: Very long daily special title',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );

      expect(tester.takeException(), isNull);
      expect(find.text('Today: Very long daily special title'), findsOneWidget);
    });

    test('clip path creates a rounded center bulge', () {
      const clipper = BiteSaverHomeDealBubbleClipper();
      final path = clipper.getClip(
        const Size(240, BiteSaverHomeDealBubble.minHeight),
      );
      final bounds = path.getBounds();

      expect(bounds.top, 0);
      expect(bounds.bottom, BiteSaverHomeDealBubble.minHeight);
      expect(bounds.left, 0);
      expect(bounds.right, 240);

      final centerX = 240 * 0.52;
      expect(path.contains(Offset(centerX, 1)), isTrue);
      expect(
        path.contains(Offset(centerX, BiteSaverHomeDealBubble.minHeight - 1)),
        isTrue,
      );
      expect(path.contains(const Offset(8, 1)), isFalse);
    });
  });
}
