import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:coupon_app/utils/phone_number_formatter.dart';

void main() {
  group('formatPhoneNumberForDisplay', () {
    test('formats ten digit US phone numbers', () {
      expect(formatPhoneNumberForDisplay('3525551234'), '(352) 555-1234');
    });

    test('does not double-format already formatted phone numbers', () {
      expect(formatPhoneNumberForDisplay('(352) 555-1234'), '(352) 555-1234');
    });

    test('normalizes dashes, dots, and leading country code', () {
      expect(formatPhoneNumberForDisplay('352-555-1234'), '(352) 555-1234');
      expect(formatPhoneNumberForDisplay('352.555.1234'), '(352) 555-1234');
      expect(formatPhoneNumberForDisplay('1-352-555-1234'), '(352) 555-1234');
    });

    test('leaves nonstandard phone values unchanged', () {
      expect(
        formatPhoneNumberForDisplay('+44 20 7946 0958'),
        '+44 20 7946 0958',
      );
      expect(formatPhoneNumberForDisplay('Call after 5'), 'Call after 5');
    });
  });

  group('UsPhoneNumberTextInputFormatter', () {
    const formatter = UsPhoneNumberTextInputFormatter();

    TextEditingValue format(String text) {
      return formatter.formatEditUpdate(
        TextEditingValue.empty,
        TextEditingValue(
          text: text,
          selection: TextSelection.collapsed(offset: text.length),
        ),
      );
    }

    test('formats digits while editing', () {
      expect(format('3525551234').text, '(352) 555-1234');
    });

    test('formats partial input without throwing', () {
      expect(format('3').text, '(3');
      expect(format('3525').text, '(352) 5');
      expect(format('3525551').text, '(352) 555-1');
    });

    test('handles a leading US country code while editing', () {
      expect(format('1-352-555-1234').text, '(352) 555-1234');
    });

    test('leaves nonstandard editing input safely unchanged', () {
      expect(format('+44 20 7946 0958').text, '+44 20 7946 0958');
      expect(format('Call after 5').text, 'Call after 5');
    });
  });
}
