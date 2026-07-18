import 'package:coupon_app/widgets/admin_content_insets.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('admin scroll padding clears bottom nav and system inset', (
    tester,
  ) async {
    late BuildContext capturedContext;

    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(viewPadding: EdgeInsets.only(bottom: 34)),
          child: Builder(
            builder: (context) {
              capturedContext = context;
              return const SizedBox.shrink();
            },
          ),
        ),
      ),
    );

    final padding = AdminContentInsets.scrollPadding(
      capturedContext,
      bottom: 20,
    );

    expect(padding.left, 16);
    expect(padding.top, 16);
    expect(padding.right, 16);
    expect(
      padding.bottom,
      20 +
          AdminContentInsets.bottomNavigationHeight +
          AdminContentInsets.bottomNavigationOuterPadding +
          34 +
          AdminContentInsets.bottomBreathingRoom,
    );
  });

  testWidgets('system scroll padding clears phone system controls', (
    tester,
  ) async {
    late BuildContext capturedContext;

    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(viewPadding: EdgeInsets.only(bottom: 34)),
          child: Builder(
            builder: (context) {
              capturedContext = context;
              return const SizedBox.shrink();
            },
          ),
        ),
      ),
    );

    final padding = AdminContentInsets.systemScrollPadding(
      capturedContext,
      bottom: 20,
    );

    expect(padding.left, 16);
    expect(padding.top, 16);
    expect(padding.right, 16);
    expect(padding.bottom, 20 + 34 + AdminContentInsets.bottomBreathingRoom);
  });
}
