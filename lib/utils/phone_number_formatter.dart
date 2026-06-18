import 'package:flutter/services.dart';

String formatPhoneNumberForDisplay(String? value) {
  final raw = value?.trim() ?? '';
  if (raw.isEmpty) {
    return raw;
  }

  final digits = raw.replaceAll(RegExp(r'\D'), '');
  final localDigits = digits.length == 11 && digits.startsWith('1')
      ? digits.substring(1)
      : digits;

  if (localDigits.length != 10) {
    return raw;
  }

  return '(${localDigits.substring(0, 3)}) '
      '${localDigits.substring(3, 6)}-${localDigits.substring(6)}';
}

const usPhoneNumberInputFormatters = <TextInputFormatter>[
  UsPhoneNumberTextInputFormatter(),
];

class UsPhoneNumberTextInputFormatter extends TextInputFormatter {
  const UsPhoneNumberTextInputFormatter();

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final formatted = formatUsPhoneNumberForEditing(newValue.text);
    return TextEditingValue(
      text: formatted,
      selection: TextSelection.collapsed(offset: formatted.length),
    );
  }
}

String formatUsPhoneNumberForEditing(String value) {
  final raw = value.trim();
  if (raw.isEmpty) {
    return raw;
  }

  if (RegExp(r'[A-Za-z]').hasMatch(raw)) {
    return value;
  }

  final digits = raw.replaceAll(RegExp(r'\D'), '');
  final localDigits = digits.length == 11 && digits.startsWith('1')
      ? digits.substring(1)
      : digits;

  if (localDigits.length > 10) {
    return value;
  }

  return _formatPartialUsPhoneNumber(localDigits);
}

String _formatPartialUsPhoneNumber(String digits) {
  if (digits.isEmpty) {
    return '';
  }
  if (digits.length <= 3) {
    return '($digits';
  }
  if (digits.length <= 6) {
    return '(${digits.substring(0, 3)}) ${digits.substring(3)}';
  }
  return '(${digits.substring(0, 3)}) '
      '${digits.substring(3, 6)}-${digits.substring(6)}';
}
