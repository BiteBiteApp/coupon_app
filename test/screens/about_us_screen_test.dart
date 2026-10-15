import 'package:coupon_app/screens/about_us_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

const approvedParagraphs = [
  'BiteStar brings two ways to explore food together in one app: finding restaurant deals and discovering dishes worth trying.',
  "Looking for a great deal? Explore restaurant coupons, Daily Specials, and menus to see what's available.",
  'Rate the dish. Not the restaurant.',
  'Think about it. A restaurant might make an incredible burger but a disappointing pizza. So why give the entire restaurant one rating?',
  "BiteStar puts the spotlight on individual dishes, letting you discover what people think about the exact food you're considering ordering. Rate the dishes you've actually tried, share your experiences, and help others discover what's really worth ordering.",
  "Whether you're returning to a favorite restaurant or trying somewhere new, BiteStar helps you explore your options.",
];

void main() {
  for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
    for (final scale in [1.0, 2.0, 3.0]) {
      testWidgets('approved static copy scrolls at $scale on $platform', (
        tester,
      ) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = const Size(320, 640);
        addTearDown(tester.view.reset);
        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(platform: platform),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(scale)),
              child: child!,
            ),
            home: const AboutUsScreen(),
          ),
        );
        expect(find.text('About BiteStar'), findsOneWidget);
        for (final paragraph in approvedParagraphs) {
          expect(find.text(paragraph), findsOneWidget);
          await tester.ensureVisible(find.text(paragraph));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
        }
        final emphasis = tester.widget<Text>(find.text(approvedParagraphs[2]));
        expect(emphasis.style!.fontSize, 24);
        expect(emphasis.style!.fontWeight, FontWeight.w800);
        final scrollable = tester.state<ScrollableState>(
          find.byType(Scrollable).last,
        );
        expect(scrollable.position.maxScrollExtent, greaterThan(0));
        expect(scrollable.position.pixels, greaterThan(0));
        // At 300%, a paragraph can be taller than the viewport. Verify its final
        // glyph can be reached instead of requiring its center to be visible.
        scrollable.position.jumpTo(scrollable.position.maxScrollExtent);
        await tester.pumpAndSettle();
        final paragraph = tester.renderObject<RenderParagraph>(
          find.text(approvedParagraphs.last),
        );
        final end = approvedParagraphs.last.length;
        final box = paragraph
            .getBoxesForSelection(
              TextSelection(baseOffset: end - 1, extentOffset: end),
            )
            .single;
        final lastGlyph = paragraph.localToGlobal(box.toRect().center);
        expect(lastGlyph.dy, greaterThan(0));
        expect(lastGlyph.dy, lessThan(640));
      });
    }
  }
}
