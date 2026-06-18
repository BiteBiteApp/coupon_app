import 'package:coupon_app/screens/home_screen.dart';
import 'package:coupon_app/widgets/bitesaver_colors.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BiteSaverHomeDealBubble', () {
    testWidgets('uses the restored tappable bubble hit target', (tester) async {
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
        BiteSaverHomeDealBubble.previousVerticalPadding,
      );
      expect(bubbleRect.height, BiteSaverHomeDealBubble.bodyHeight);
      expect(
        BiteSaverHomeDealBubble.bubbleDiameter,
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

    test('clip path creates a true circular center bubble when enabled', () {
      const clipper = BiteSaverHomeDealBubbleClipper(showBubble: true);
      final path = clipper.getClip(
        const Size(240, BiteSaverHomeDealBubble.bubbleDiameter),
      );
      final bounds = path.getBounds();

      expect(bounds.top, closeTo(0, 0.001));
      expect(bounds.bottom, BiteSaverHomeDealBubble.bubbleDiameter);
      expect(bounds.left, 0);
      expect(bounds.right, 240);

      final centerX = 240 * 0.52;
      final centerY = BiteSaverHomeDealBubble.bubbleDiameter / 2;
      final radius = BiteSaverHomeDealBubble.bubbleDiameter / 2;
      expect(path.contains(Offset(centerX, 1)), isTrue);
      expect(
        path.contains(
          Offset(centerX, BiteSaverHomeDealBubble.bubbleDiameter - 1),
        ),
        isTrue,
      );
      expect(path.contains(Offset(centerX - radius + 1, centerY)), isTrue);
      expect(path.contains(Offset(centerX + radius - 1, centerY)), isTrue);
      expect(path.contains(const Offset(8, 1)), isFalse);
    });

    test('clip path omits the bubble when disabled for a single banner', () {
      const clipper = BiteSaverHomeDealBubbleClipper();
      final path = clipper.getClip(
        const Size(240, BiteSaverHomeDealBubble.bodyHeight),
      );

      final centerX = 240 * 0.52;
      expect(clipper.showBubble, isFalse);
      expect(path.contains(Offset(centerX, 1)), isTrue);
      expect(path.contains(Offset(centerX, -1)), isFalse);
    });

    test('body inset moves the rectangle without moving the bubble center', () {
      const bodyInset = 36.0;
      const originalWidth = 240.0;
      const expandedWidth = originalWidth + bodyInset;
      const originalBubbleCenter =
          originalWidth * BiteSaverHomeDealBubbleClipper.bubbleCenterFraction;
      const centerY = BiteSaverHomeDealBubble.bubbleDiameter / 2;

      const clipper = BiteSaverHomeDealBubbleClipper(
        rectangularBodyLeadingInset: bodyInset,
        bubbleCenterX: originalBubbleCenter,
        showBubble: true,
      );
      final path = clipper.getClip(
        const Size(expandedWidth, BiteSaverHomeDealBubble.bubbleDiameter),
      );

      expect(path.contains(const Offset(bodyInset - 1, centerY)), isFalse);
      expect(path.contains(const Offset(bodyInset + 1, centerY)), isTrue);
      expect(path.contains(const Offset(originalBubbleCenter, 1)), isTrue);
      expect(
        path.contains(
          const Offset(
            originalBubbleCenter,
            BiteSaverHomeDealBubble.bubbleDiameter - 1,
          ),
        ),
        isTrue,
      );
    });

    test('multi-banner body keeps the same pill ends as a single banner', () {
      const bodyInset = 36.0;
      const clipper = BiteSaverHomeDealBubbleClipper(
        rectangularBodyLeadingInset: bodyInset,
        showBubble: true,
      );
      final path = clipper.getClip(
        const Size(276, BiteSaverHomeDealBubble.bubbleDiameter),
      );

      const bodyTop =
          (BiteSaverHomeDealBubble.bubbleDiameter -
              BiteSaverHomeDealBubble.bodyHeight) /
          2;
      const bodyCenterY = bodyTop + BiteSaverHomeDealBubble.bodyHeight / 2;
      const bodyRadius = BiteSaverHomeDealBubble.bodyHeight / 2;

      expect(path.contains(const Offset(bodyInset + 1, bodyCenterY)), isTrue);
      expect(
        path.contains(const Offset(bodyInset + bodyRadius, bodyTop + 1)),
        isTrue,
      );
      expect(path.contains(const Offset(bodyInset + 1, bodyTop + 1)), isFalse);
    });

    test('stagger alternates far left and right while nesting vertically', () {
      final offset = BiteSaverHomeDealBubbleStagger.horizontalOffsetFor(
        availableWidth: 420,
        compact: false,
      );
      final compactOffset = BiteSaverHomeDealBubbleStagger.horizontalOffsetFor(
        availableWidth: 240,
        compact: true,
      );

      expect(BiteSaverHomeDealBubbleStagger.isLeftPosition(0), isTrue);
      expect(BiteSaverHomeDealBubbleStagger.isLeftPosition(1), isFalse);
      expect(BiteSaverHomeDealBubbleStagger.isLeftPosition(2), isTrue);
      expect(BiteSaverHomeDealBubbleStagger.isLeftPosition(3), isFalse);
      expect(offset, greaterThan(55));
      expect(offset, lessThanOrEqualTo(420 * 0.28));
      expect(compactOffset, lessThan(offset));
      expect(
        BiteSaverHomeDealBubbleStagger.topFor(index: 1, compact: false),
        BiteSaverHomeDealBubbleStagger.visibleShapeHeight +
            BiteSaverHomeDealBubbleStagger.bubbleGap,
      );
      expect(
        BiteSaverHomeDealBubbleStagger.topFor(index: 1, compact: true),
        BiteSaverHomeDealBubbleStagger.visibleShapeHeight +
            BiteSaverHomeDealBubbleStagger.bubbleGap,
      );
      expect(
        BiteSaverHomeDealBubbleStagger.regularStep,
        BiteSaverHomeDealBubbleStagger.compactStep,
      );
      expect(
        BiteSaverHomeDealBubbleStagger.stackHeightFor(
          itemCount: 4,
          compact: false,
        ),
        BiteSaverHomeDealBubble.minHeight +
            (BiteSaverHomeDealBubbleStagger.visibleShapeHeight +
                    BiteSaverHomeDealBubbleStagger.bubbleGap) *
                3,
      );
    });
  });
}
