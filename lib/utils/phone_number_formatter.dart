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
