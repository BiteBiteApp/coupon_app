import 'dart:async';

import 'package:coupon_app/screens/customer_account_screen.dart';
import 'package:coupon_app/screens/restaurant_auth_screen.dart';
import 'package:firebase_core/firebase_core.dart';
// SDK transport fakes: these tests cannot contact Firebase or send mail.
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/firebase_core_platform_interface.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_auth_platform_interface/firebase_auth_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

final _auth = _Auth();
Finder field(String label) => find.byWidgetPredicate(
  (w) => w is TextField && w.decoration?.labelText == label,
);
Finder get resetField => find.descendant(
  of: find.byType(AlertDialog),
  matching: find.byType(TextFormField),
);

void main() {
  setUpAll(() {
    FirebasePlatform.instance = _Core();
    FirebaseAuthPlatform.instance = _auth;
  });
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    _auth.emails.clear();
    _auth.error = null;
    _auth.pending = null;
  });

  Future<void> open(
    WidgetTester tester,
    bool restaurant, {
    Size size = const Size(900, 1500),
    double textScale = 1,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: restaurant
            ? RestaurantAuthScreen(authStateStream: Stream.value(null))
            : CustomerAccountScreen(userStream: Stream.value(null)),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> recover(WidgetTester tester) async {
    await tester.ensureVisible(find.text('Forgot password?'));
    await tester.tap(find.text('Forgot password?'));
    await tester.pumpAndSettle();
  }

  for (final restaurant in [false, true]) {
    final name = restaurant ? 'restaurant' : 'customer';
    testWidgets(
      '$name recovery remains usable at narrow width and large text',
      (tester) async {
        await open(
          tester,
          restaurant,
          size: const Size(320, 640),
          textScale: 2,
        );
        await recover(tester);
        await tester.enterText(resetField, 'person@example.test');
        await tester.ensureVisible(find.text('Request reset email'));
        await tester.tap(find.text('Request reset email'));
        await tester.pumpAndSettle();
        expect(find.text('Check your email'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.ensureVisible(find.text('Done'));
        await tester.tap(find.text('Done'));
        await tester.pumpAndSettle();
        expect(find.byType(AlertDialog), findsNothing);
      },
    );

    testWidgets(
      '$name recovery prefills email, validates and cancels without a request',
      (tester) async {
        await open(tester, restaurant);
        await tester.enterText(field('Email'), '  person@example.test  ');
        await recover(tester);
        expect(
          tester.widget<TextFormField>(resetField).controller!.text,
          'person@example.test',
        );
        for (final invalid in ['', 'bad-address', 'a b@example.test']) {
          await tester.enterText(resetField, invalid);
          await tester.tap(find.text('Request reset email'));
          await tester.pumpAndSettle();
          expect(find.text('Enter a valid email address.'), findsOneWidget);
        }
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(find.byType(AlertDialog), findsNothing);
        expect(_auth.emails, isEmpty);
      },
    );

    testWidgets(
      '$name accepted request is guarded against duplicate button/keyboard submissions',
      (tester) async {
        await open(tester, restaurant);
        await recover(tester);
        await tester.enterText(resetField, '  person@example.test  ');
        final pending = Completer<void>();
        _auth.pending = pending.future;
        final button = tester.widget<FilledButton>(
          find.widgetWithText(FilledButton, 'Request reset email'),
        );
        button.onPressed!();
        button.onPressed!();
        tester
            .widget<TextField>(
              find.descendant(of: resetField, matching: find.byType(TextField)),
            )
            .onSubmitted!('person@example.test');
        await tester.pump();
        expect(_auth.emails, ['person@example.test']);
        expect(find.text('Requesting...'), findsOneWidget);
        expect(
          tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
          isNull,
        );
        pending.complete();
        await tester.pumpAndSettle();
        expect(find.text('Check your email'), findsOneWidget);
        expect(
          find.textContaining('If this address is eligible'),
          findsOneWidget,
        );
        expect(find.textContaining('sent successfully'), findsNothing);
        await tester.tap(find.text('Done'));
        await tester.pumpAndSettle();
        expect(find.byType(AlertDialog), findsNothing);
      },
    );

    for (final code in ['user-not-found', 'user-disabled']) {
      testWidgets('$name $code displays the same private accepted feedback', (
        tester,
      ) async {
        await open(tester, restaurant);
        await recover(tester);
        await tester.enterText(resetField, 'person@example.test');
        _auth.error = FirebaseAuthException(
          code: code,
          message: 'secret SDK detail',
        );
        await tester.tap(find.text('Request reset email'));
        await tester.pumpAndSettle();
        expect(find.text('Check your email'), findsOneWidget);
        expect(find.textContaining('secret SDK detail'), findsNothing);
        expect(find.textContaining(code), findsNothing);
      });
    }

    for (final entry in {
      'network-request-failed': 'Check your connection and try again.',
      'too-many-requests': 'Please wait before trying again.',
      'operation-not-allowed':
          'Could not request a password reset right now. Try again later.',
    }.entries) {
      testWidgets('$name ${entry.key} is safe, visible and retryable', (
        tester,
      ) async {
        await open(tester, restaurant);
        await recover(tester);
        await tester.enterText(resetField, 'person@example.test');
        _auth.error = FirebaseAuthException(
          code: entry.key,
          message: 'secret SDK detail',
        );
        await tester.tap(find.text('Request reset email'));
        await tester.pumpAndSettle();
        expect(find.text(entry.value), findsOneWidget);
        expect(find.textContaining('secret SDK detail'), findsNothing);
        _auth.error = null;
        await tester.tap(find.text('Request reset email'));
        await tester.pumpAndSettle();
        expect(_auth.emails, hasLength(2));
        expect(find.text('Check your email'), findsOneWidget);
      });
    }

    for (final failure in [false, true]) {
      for (final cancel in [false, true]) {
        testWidgets(
          '$name pending request after ${cancel ? 'cancel' : 'screen disposal'}, failure=$failure',
          (tester) async {
            await open(tester, restaurant);
            await recover(tester);
            await tester.enterText(resetField, 'person@example.test');
            final pending = Completer<void>();
            _auth.pending = pending.future;
            await tester.tap(find.text('Request reset email'));
            await tester.pump();
            if (cancel) {
              await tester.tap(find.text('Cancel'));
              await tester.pumpAndSettle();
            } else {
              await tester.pumpWidget(const SizedBox.shrink());
              expect(find.byType(AlertDialog), findsNothing);
            }
            if (failure) {
              pending.completeError(
                FirebaseAuthException(
                  code: 'network-request-failed',
                  message: 'secret SDK detail',
                ),
              );
            } else {
              pending.complete();
            }
            await tester.pumpAndSettle();
            expect(find.text('Check your email'), findsNothing);
            expect(find.textContaining('secret SDK detail'), findsNothing);
            expect(
              find.text('Check your connection and try again.'),
              findsNothing,
            );
            expect(tester.takeException(), isNull);
          },
        );
      }
    }

    testWidgets(
      '$name password and confirmation toggle independently without changing values',
      (tester) async {
        await open(tester, restaurant);
        await tester.enterText(field('Password'), ' secret with spaces ');
        final controller = tester
            .widget<TextField>(field('Password'))
            .controller!;
        final value = controller.value;
        expect(tester.widget<TextField>(field('Password')).obscureText, isTrue);
        await tester.tap(find.byTooltip('Show password'));
        await tester.pumpAndSettle();
        expect(
          tester.widget<TextField>(field('Password')).obscureText,
          isFalse,
        );
        expect(controller.value, value);
        await tester.tap(find.byTooltip('Hide password'));
        await tester.pumpAndSettle();
        expect(controller.value, value);
        await tester.ensureVisible(find.text('Need an account? Create one'));
        await tester.tap(find.text('Need an account? Create one'));
        await tester.pumpAndSettle();
        expect(find.text('Forgot password?'), findsNothing);
        await tester.enterText(field('Password'), ' new secret ');
        await tester.enterText(field('Confirm Password'), ' new secret ');
        expect(tester.widget<TextField>(field('Password')).obscureText, isTrue);
        expect(
          tester.widget<TextField>(field('Confirm Password')).obscureText,
          isTrue,
        );
        await tester.tap(find.byTooltip('Show confirm password'));
        await tester.pumpAndSettle();
        expect(
          tester.widget<TextField>(field('Confirm Password')).obscureText,
          isFalse,
        );
        expect(tester.widget<TextField>(field('Password')).obscureText, isTrue);
        expect(
          tester.widget<TextField>(field('Confirm Password')).controller!.text,
          ' new secret ',
        );
        await tester.tap(find.byTooltip('Show password'));
        await tester.pumpAndSettle();
        expect(
          tester.widget<TextField>(field('Password')).controller!.text,
          ' new secret ',
        );
        await tester.ensureVisible(
          find.text('Already have an account? Sign in'),
        );
        await tester.tap(find.text('Already have an account? Sign in'));
        await tester.pumpAndSettle();
        expect(tester.widget<TextField>(field('Password')).obscureText, isTrue);
      },
    );
  }
}

class _Core extends FirebasePlatform {
  @override
  FirebaseAppPlatform app([String name = '[DEFAULT]']) => FirebaseAppPlatform(
    name,
    const FirebaseOptions(
      apiKey: 'synthetic',
      appId: 'synthetic',
      messagingSenderId: 'synthetic',
      projectId: 'demo-password-recovery',
    ),
  );
}

class _Auth extends FirebaseAuthPlatform {
  final emails = <String>[];
  Object? error;
  Future<void>? pending;
  @override
  FirebaseAuthPlatform delegateFor({required FirebaseApp app}) => this;
  @override
  FirebaseAuthPlatform setInitialValues({
    InternalUserDetails? currentUser,
    String? languageCode,
  }) => this;
  @override
  UserPlatform? get currentUser => null;
  @override
  Stream<UserPlatform?> userChanges() => Stream.value(null);
  @override
  Future<void> sendPasswordResetEmail(
    String email, [
    ActionCodeSettings? actionCodeSettings,
  ]) async {
    expect(actionCodeSettings, isNull);
    emails.add(email);
    if (error != null) throw error!;
    await pending;
  }
}
