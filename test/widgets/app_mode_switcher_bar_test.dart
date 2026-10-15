import 'dart:ui' show Tristate;

import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/widgets/app_mode_switcher_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final width in [320.0, 390.0, 430.0]) {
    for (final scale in [1.0, 2.0, 3.0]) {
      for (final initialMode in AppMode.values) {
        testWidgets('labels and controls at $width dp, $scale, $initialMode', (
          tester,
        ) async {
          tester.view.devicePixelRatio = 1;
          tester.view.physicalSize = Size(width, 900);
          addTearDown(tester.view.reset);
          final semantics = tester.ensureSemantics();
          try {
            var selected = initialMode;
            await tester.pumpWidget(
              MaterialApp(
                builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(textScaler: TextScaler.linear(scale)),
                  child: child!,
                ),
                home: Scaffold(
                  body: StatefulBuilder(
                    builder: (context, setState) => Align(
                      alignment: Alignment.topCenter,
                      child: AppModeSwitcherBar(
                        selectedMode: selected,
                        onModeSelected: (mode) =>
                            setState(() => selected = mode),
                      ),
                    ),
                  ),
                ),
              ),
            );

            void checkLabels() {
              expect(find.text('BiteSaver'), findsNothing);
              expect(find.text('BiteScore'), findsNothing);
              for (final label in ['Coupons & Specials', 'Dish Ratings']) {
                expect(find.bySemanticsLabel(label), findsOneWidget);
                final isSelected = label == 'Coupons & Specials'
                    ? selected == AppMode.biteSaver
                    : selected == AppMode.biteScore;
                final node = tester.getSemantics(find.bySemanticsLabel(label));
                expect(node.flagsCollection.isButton, isTrue);
                expect(
                  node.flagsCollection.isSelected == Tristate.isTrue,
                  isSelected,
                );
                expect(
                  node.getSemanticsData().hasAction(SemanticsAction.tap),
                  isTrue,
                );
                for (final element in find.text(label).evaluate()) {
                  final paragraph = element.renderObject! as RenderParagraph;
                  expect(paragraph.text.style!.fontSize, 13);
                  expect(
                    paragraph.textScaler.scale(13),
                    closeTo(13 * scale, .01),
                  );
                  expect(paragraph.didExceedMaxLines, isFalse);
                  // Selection boxes for trailing wrap spaces extend beyond the line;
                  // check painted glyphs individually instead of those spaces.
                  final boxes = [
                    for (var i = 0; i < label.length; i++)
                      if (label[i] != ' ')
                        ...paragraph.getBoxesForSelection(
                          TextSelection(baseOffset: i, extentOffset: i + 1),
                        ),
                  ];
                  expect(boxes, isNotEmpty);
                  for (final box in boxes) {
                    expect(box.left, greaterThanOrEqualTo(-.01));
                    expect(
                      box.right,
                      lessThanOrEqualTo(paragraph.size.width + .01),
                    );
                    expect(
                      box.bottom,
                      lessThanOrEqualTo(paragraph.size.height + .01),
                    );
                  }
                  final rect = tester.getRect(
                    find.byElementPredicate((e) => e == element),
                  );
                  final bar = tester.getRect(find.byType(AppModeSwitcherBar));
                  expect(bar.contains(rect.topLeft), isTrue);
                  expect(bar.contains(rect.bottomRight), isTrue);
                }
              }
              expect(tester.takeException(), isNull);
            }

            checkLabels();
            for (final mode in AppMode.values) {
              await tester.tap(
                find
                    .text(
                      mode == AppMode.biteSaver
                          ? 'Coupons & Specials'
                          : 'Dish Ratings',
                    )
                    .last,
              );
              await tester.pumpAndSettle();
              expect(selected, mode);
              checkLabels();
            }
            final bar = tester.getRect(find.byType(AppModeSwitcherBar));
            await tester.dragFrom(
              Offset(bar.left + bar.width * .75, bar.center.dy),
              Offset(-bar.width * .65, 0),
            );
            await tester.pumpAndSettle();
            expect(selected, AppMode.biteSaver);
            checkLabels();
            await tester.dragFrom(
              Offset(bar.left + bar.width * .25, bar.center.dy),
              Offset(bar.width * .65, 0),
            );
            await tester.pumpAndSettle();
            expect(selected, AppMode.biteScore);
            checkLabels();
          } finally {
            semantics.dispose();
          }
        });
      }
    }
  }
}
