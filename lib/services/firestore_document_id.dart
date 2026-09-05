import 'dart:convert';

/// Returns [value] unchanged only when it is a safe, exact Firestore document
/// path segment. In particular, boundary whitespace is rejected rather than
/// normalized into a different document identity.
String? exactFirestoreDocumentId(Object? value) {
  if (value is! String ||
      value.isEmpty ||
      value.trim() != value ||
      value == '.' ||
      value == '..' ||
      value.contains('/') ||
      utf8.encode(value).length > 1500) {
    return null;
  }
  for (final rune in value.runes) {
    if (_isUnsupportedFirestoreIdentityRune(rune)) {
      return null;
    }
  }
  return value;
}

bool _isUnsupportedFirestoreIdentityRune(int rune) {
  return _isExplicitlyRejectedKhmerFormattingRune(rune) ||
      rune <= 0x1f ||
      (rune >= 0x7f && rune <= 0x9f) ||
      rune == 0xad ||
      (rune >= 0x600 && rune <= 0x605) ||
      rune == 0x61c ||
      rune == 0x6dd ||
      rune == 0x70f ||
      (rune >= 0x890 && rune <= 0x891) ||
      rune == 0x8e2 ||
      rune == 0x180e ||
      (rune >= 0x200b && rune <= 0x200f) ||
      (rune >= 0x202a && rune <= 0x202e) ||
      (rune >= 0x2060 && rune <= 0x2064) ||
      (rune >= 0x2066 && rune <= 0x206f) ||
      rune == 0xfeff ||
      (rune >= 0xfff9 && rune <= 0xfffb) ||
      rune == 0x110bd ||
      rune == 0x110cd ||
      (rune >= 0x13430 && rune <= 0x1343f) ||
      (rune >= 0x1bca0 && rune <= 0x1bca3) ||
      (rune >= 0x1d173 && rune <= 0x1d17a) ||
      rune == 0xe0001 ||
      (rune >= 0xe0020 && rune <= 0xe007f);
}

bool _isExplicitlyRejectedKhmerFormattingRune(int rune) =>
    rune == 0x17b4 || rune == 0x17b5;
