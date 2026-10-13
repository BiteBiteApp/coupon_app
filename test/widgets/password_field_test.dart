import 'package:coupon_app/widgets/account_auth_confirmation.dart';
import 'package:coupon_app/widgets/password_field.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'visibility preserves editing value, input action and autofill; new controller is masked',
    (tester) async {
      final first = TextEditingController(text: ' original password ');
      final second = TextEditingController(text: ' different password ');
      addTearDown(first.dispose);
      addTearDown(second.dispose);
      first.selection = const TextSelection(baseOffset: 2, extentOffset: 7);
      final value = first.value;
      Widget app(TextEditingController controller) => MaterialApp(
        home: Scaffold(
          body: PasswordField(
            controller: controller,
            autofocus: true,
            textInputAction: TextInputAction.next,
            autofillHints: const [AutofillHints.newPassword],
            decoration: const InputDecoration(labelText: 'Confirm password'),
          ),
        ),
      );
      await tester.pumpWidget(app(first));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField)).obscureText,
        isTrue,
      );
      await tester.tap(find.byTooltip('Show confirm password'));
      await tester.pumpAndSettle();
      final field = tester.widget<TextField>(find.byType(TextField));
      expect(field.obscureText, isFalse);
      expect(first.value, value);
      expect(field.autocorrect, isFalse);
      expect(field.enableSuggestions, isFalse);
      expect(field.enableIMEPersonalizedLearning, isFalse);
      expect(field.textInputAction, TextInputAction.next);
      expect(field.autofillHints, [AutofillHints.newPassword]);
      expect(field.autofocus, isTrue);
      await tester.pumpWidget(app(second));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField)).obscureText,
        isTrue,
      );
      expect(second.text, ' different password ');
    },
  );

  testWidgets(
    'existing-account confirmation can show and hide the exact submitted password',
    (tester) async {
      String? result;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async =>
                    result = await confirmExistingAccountPassword(
                      context,
                      'synthetic@example.test',
                    ),
                child: const Text('Confirm account'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Confirm account'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextField),
        ' exact original password ',
      );
      await tester.tap(find.byTooltip('Show bitestar password'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField)).obscureText,
        isFalse,
      );
      await tester.tap(find.byTooltip('Hide bitestar password'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField)).obscureText,
        isTrue,
      );
      await tester.tap(find.text('Confirm'));
      await tester.pumpAndSettle();
      expect(result, ' exact original password ');
    },
  );
}
