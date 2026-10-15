import 'dart:io';

import 'package:coupon_app/screens/privacy_policy_screen.dart';
import 'package:coupon_app/screens/terms_of_service_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/legal_draft_copy.dart';

void main() {
  for (final document in [
    (
      name: 'privacy',
      page: const PrivacyPolicyScreen(),
      expected: privacyExpectedText,
      headings: privacyExpectedHeadings,
    ),
    (
      name: 'terms',
      page: const TermsOfServiceScreen(),
      expected: termsExpectedText,
      headings: termsExpectedHeadings,
    ),
  ]) {
    for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
      for (final scale in [1.0, 2.0, 3.0]) {
        testWidgets('${document.name} exact draft at $platform scale $scale', (
          tester,
        ) async {
          tester.view.devicePixelRatio = 1;
          tester.view.physicalSize = Size(
            platform == TargetPlatform.android ? 320 : 390,
            700,
          );
          addTearDown(tester.view.reset);
          await HttpOverrides.runZoned(
            () async {
              // No Firebase initialization, login, or service setup is supplied.
              await tester.pumpWidget(
                MaterialApp(
                  theme: ThemeData(platform: platform),
                  builder: (context, child) => MediaQuery(
                    data: MediaQuery.of(
                      context,
                    ).copyWith(textScaler: TextScaler.linear(scale)),
                    child: child!,
                  ),
                  home: document.page,
                ),
              );
              final textWidgets = tester.widgetList<Text>(find.byType(Text));
              expect(
                textWidgets.map((text) => text.data).toList(),
                document.expected,
              );
              expect(
                find.text('Draft for Owner Review — Not Yet Published'),
                findsOneWidget,
              );
              expect(
                find.text(
                  'Effective date: Pending final approval and publication.',
                ),
                findsOneWidget,
              );
              expect(find.textContaining('Do not '), findsNothing);
              expect(find.textContaining('2026'), findsNothing);
              for (final heading in document.headings) {
                final semantics = tester.widget<Semantics>(
                  find
                      .ancestor(
                        of: find.text(heading),
                        matching: find.byWidgetPredicate(
                          (widget) =>
                              widget is Semantics &&
                              widget.properties.header == true,
                        ),
                      )
                      .first,
                );
                expect(semantics.properties.header, isTrue);
              }
              // Verify every printed glyph fits its paragraph at the full scaler.
              // Whole-line selection boxes include trailing wrap whitespace.
              // Allow half a logical pixel for fractional glyph rasterization.
              for (final element in find.byType(Text).evaluate()) {
                final paragraph = element.renderObject! as RenderParagraph;
                final text = (element.widget as Text).data!;
                expect(paragraph.didExceedMaxLines, isFalse);
                for (var i = 0; i < text.length; i++) {
                  if (text[i].trim().isEmpty) continue;
                  for (final box in paragraph.getBoxesForSelection(
                    TextSelection(baseOffset: i, extentOffset: i + 1),
                  )) {
                    expect(box.left, greaterThanOrEqualTo(-.01), reason: text);
                    expect(
                      box.right,
                      lessThanOrEqualTo(paragraph.size.width + .5),
                      reason: text,
                    );
                    expect(
                      box.bottom,
                      lessThanOrEqualTo(paragraph.size.height + .5),
                      reason: text,
                    );
                  }
                }
              }
              final scrollable = tester.state<ScrollableState>(
                find.byType(Scrollable),
              );
              expect(scrollable.position.maxScrollExtent, greaterThan(0));
              scrollable.position.jumpTo(scrollable.position.maxScrollExtent);
              await tester.pumpAndSettle();
              expect(
                find.text('https://www.colesmartllc.com/').hitTestable(),
                findsOneWidget,
              );
              expect(tester.takeException(), isNull);
            },
            createHttpClient: (_) =>
                throw StateError('Legal text attempted a network request'),
          );
        });
      }
    }
  }
}
