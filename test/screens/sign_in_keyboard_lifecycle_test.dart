import 'dart:async';

import 'package:coupon_app/screens/customer_account_screen.dart';
import 'package:coupon_app/screens/restaurant_auth_screen.dart';
import 'package:firebase_core/firebase_core.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/firebase_core_platform_interface.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_auth_platform_interface/firebase_auth_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _Core extends FirebasePlatform {
  @override
  FirebaseAppPlatform app([String name = '[DEFAULT]']) => FirebaseAppPlatform(
    name,
    const FirebaseOptions(
      apiKey: 'fixture',
      appId: 'fixture',
      messagingSenderId: 'fixture',
      projectId: 'demo-sign-in',
    ),
  );
}

class _Auth extends FirebaseAuthPlatform {
  @override
  FirebaseAuthPlatform delegateFor({required FirebaseApp app}) => this;
  @override
  FirebaseAuthPlatform setInitialValues({
    InternalUserDetails? currentUser,
    String? languageCode,
  }) => this;
  @override
  Stream<UserPlatform?> userChanges() =>
      Stream<UserPlatform?>.multi((controller) {
        controller.add(null);
      }, isBroadcast: true);
}

void main() {
  setUpAll(() {
    FirebasePlatform.instance = _Core();
    FirebaseAuthPlatform.instance = _Auth();
  });
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final account in [true, false]) {
    testWidgets(
      '${account ? 'Account' : 'Restaurant Hub'} keeps email/password focus through keyboard resize',
      (tester) async {
        tester.view.physicalSize = const Size(1000, 1800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(
          MaterialApp(
            home: Builder(
              builder: (context) {
                // The real navigation shell depends on keyboard metrics too.
                MediaQuery.of(context);
                return account
                    ? CustomerAccountScreen()
                    : RestaurantAuthScreen();
              },
            ),
          ),
        );
        await tester.pumpAndSettle();
        final email = find.byWidgetPredicate(
          (w) => w is TextField && w.decoration?.labelText == 'Email',
        );
        await tester.ensureVisible(email);
        await tester.tap(email);
        await tester.pump();
        final editable = find.descendant(
          of: email,
          matching: find.byType(EditableText),
        );
        final fieldState = tester.state<EditableTextState>(editable);
        expect(fieldState.widget.focusNode.hasFocus, isTrue);
        tester.view.viewInsets = const FakeViewPadding(bottom: 400);
        await tester.pumpAndSettle();
        expect(tester.state<EditableTextState>(editable), same(fieldState));
        expect(fieldState.widget.focusNode.hasFocus, isTrue);
        tester.testTextInput.enterText('visual-check@example.test');
        await tester.pump();
        final password = find.byWidgetPredicate(
          (w) => w is TextField && w.decoration?.labelText == 'Password',
        );
        await tester.ensureVisible(password);
        await tester.tap(password);
        await tester.pump();
        tester.testTextInput.enterText('not-a-real-password');
        await tester.pump();
        tester.view.viewInsets = const FakeViewPadding(bottom: 450);
        await tester.pumpAndSettle();
        expect(
          tester.widget<TextField>(email).controller!.text,
          'visual-check@example.test',
        );
        expect(
          tester.widget<TextField>(password).controller!.text,
          'not-a-real-password',
        );
        expect(
          tester
              .widget<EditableText>(
                find.descendant(
                  of: password,
                  matching: find.byType(EditableText),
                ),
              )
              .focusNode
              .hasFocus,
          isTrue,
        );
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }
}
