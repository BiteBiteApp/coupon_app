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

    for (final width in [100.0, 180.0, 320.0, 430.0, 640.0]) {
      for (final scale in [1.0, 2.0]) {
        testWidgets(
          'real stacked coupon/special contours clear at $width scale $scale',
          (tester) async {
            tester.view.devicePixelRatio = 1;
            tester.view.physicalSize = Size(width, 900);
            addTearDown(tester.view.reset);
            final opened = <int>[];
            await tester.pumpWidget(
              MaterialApp(
                home: MediaQuery(
                  data: MediaQueryData(
                    size: Size(width, 900),
                    textScaler: TextScaler.linear(scale),
                  ),
                  child: Scaffold(
                    body: SingleChildScrollView(
                      child: BiteSaverDealFeedStack(
                        itemCount: 24,
                        itemBuilder: (context, index, centerX) =>
                            BiteSaverHomeDealBubble(
                              key: ValueKey('stacked-$index'),
                              showBubble: true,
                              bubbleCenterX: centerX,
                              onTap: () => opened.add(index),
                              backgroundColor: index.isEven
                                  ? const Color(0xFFF8FCF2)
                                  : BiteSaverColors.secondaryBackground,
                              borderColor: index.isEven
                                  ? const Color(0xFFB9D99E)
                                  : BiteSaverColors.borderStrong,
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Text(
                                  index.isEven
                                      ? 'Coupon $index'
                                      : 'Daily Special $index',
                                ),
                              ),
                            ),
                      ),
                    ),
                  ),
                ),
              ),
            );
            final bubbles = find.byType(BiteSaverHomeDealBubble);
            expect(bubbles, findsNWidgets(24));
            final paths = <Path>[];
            final centers = <Offset>[];
            for (var index = 0; index < 24; index++) {
              final finder = find.byKey(ValueKey('stacked-$index'));
              final widget = tester.widget<BiteSaverHomeDealBubble>(finder);
              final rect = tester.getRect(finder);
              final clipper = BiteSaverHomeDealBubbleClipper(
                showBubble: true,
                bubbleCenterX: widget.bubbleCenterX,
              );
              paths.add(clipper.getClip(rect.size).shift(rect.topLeft));
              centers.add(rect.topLeft + Offset(widget.bubbleCenterX!, 25));
              expect(rect.left, greaterThanOrEqualTo(0));
              expect(rect.right + .75, lessThanOrEqualTo(width));
              final label = find.descendant(
                of: finder,
                matching: find.byType(Text),
              );
              final labelRect = tester.getRect(label);
              expect(labelRect.top, greaterThanOrEqualTo(rect.top + 5));
              expect(labelRect.bottom, lessThanOrEqualTo(rect.top + 45));
              if (index > 0) {
                final previous = tester.getRect(
                  find.byKey(ValueKey('stacked-${index - 1}')),
                );
                final delta = rect.top - previous.top;
                if (width >= 110) {
                  expect(delta, 48);
                  expect((centers[index].dx - centers[index - 1].dx).abs(), 56);
                  // Include the .75px border; full circles stay horizontally clear.
                  expect(
                    (centers[index].dx - centers[index - 1].dx).abs() -
                        50 -
                        .75,
                    greaterThanOrEqualTo(5),
                  );
                  expect(rect.top - (previous.top + 45) - .75, greaterThan(0));
                  expect(rect.top + 5 - previous.bottom - .75, greaterThan(0));
                } else {
                  expect(delta, 53);
                  expect(rect.top - previous.bottom - .75, greaterThan(0));
                }
              }
            }
            // Compare actual full silhouettes, not just isolated horizontal offsets.
            for (var i = 0; i < paths.length; i++) {
              for (var j = i + 1; j < paths.length; j++) {
                expect(
                  Path.combine(
                    PathOperation.intersect,
                    paths[i],
                    paths[j],
                  ).computeMetrics(),
                  isEmpty,
                  reason: 'stacked contours $i/$j at $width',
                );
              }
            }
            if (width >= 110) {
              final shifts = [
                for (var i = 1; i < centers.length; i++)
                  centers[i].dx - centers[i - 1].dx,
              ];
              expect(shifts.any((dx) => dx > 0), isTrue);
              expect(shifts.any((dx) => dx < 0), isTrue);
              expect(
                centers.first.dx,
                27,
              ); // 1px tile inset plus safe center 26.
            }
            await tester.tap(find.text('Coupon 0'));
            expect(opened, [0]);
            expect(tester.takeException(), isNull);
          },
        );
      }
    }
  });
}
