import 'bitescore_category.dart';

/// Public owner-authored labels; limits match the existing cuisine projection.
abstract final class BiteSaverCuisine {
  static const maxTags = 32;
  static const maxTagLength = 100;
  static const maxInputLength = maxTags * (maxTagLength + 2);
  static final _invalid = RegExp(r'[\p{Cc}\p{Cf}\p{Cs}]', unicode: true);
  static final _letter = RegExp(r'\p{L}', unicode: true);

  static List<String> parse(String text) {
    if (text.runes.length > maxInputLength) {
      throw const FormatException(
        'Enter up to 32 cuisines, each 100 characters or fewer.',
      );
    }
    return normalize(
      text.split(',').where((value) => value.trim().isNotEmpty).toList(),
    );
  }

  static List<String> normalize(List<String> values) {
    if (values.length > maxTags) {
      throw const FormatException('Enter no more than 32 cuisines.');
    }
    final result = <String>[];
    final seen = <String>{};
    for (final raw in values) {
      if (_invalid.hasMatch(raw) ||
          raw.contains(',') ||
          raw.runes.length > maxTagLength) {
        throw const FormatException(
          'Each cuisine must be a single line of 100 characters or fewer.',
        );
      }
      final value = raw.trim().replaceAll(RegExp(r'\s+'), ' ');
      if (value.isEmpty || !_letter.hasMatch(value)) {
        throw const FormatException(
          'Enter a cuisine name, such as Barbecue or American.',
        );
      }
      if (seen.add(value.toLowerCase())) result.add(value);
    }
    return List.unmodifiable(result);
  }

  static List<String> fromStored(Object? value) {
    if (value == null) return const [];
    if (value is! List || value.any((item) => item is! String)) return const [];
    try {
      return normalize(value.cast<String>());
    } on FormatException {
      return const [];
    }
  }

  // Match the existing BiteSaver search normalizer, including apostrophes.
  static String _normalizeSearch(String value) => value
      .trim()
      .toLowerCase()
      .replaceAll(RegExp("[‘’‛′']"), '')
      .replaceAll(RegExp('[^a-z0-9]+'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();

  static final _bbqAliases =
      <String>{
          BitescoreCategories.byId('bbq')!.displayName,
          ...BitescoreCategories.byId('bbq')!.searchTags,
        }.map(_normalizeSearch).toList()
        ..sort((a, b) => b.length.compareTo(a.length));

  static String _canonicalSearch(String value) {
    var result = ' ${_normalizeSearch(value)} ';
    for (final alias in _bbqAliases) {
      result = result.replaceAll(' $alias ', ' bbq ');
    }
    return result.trim();
  }

  static bool matches(Iterable<String> cuisines, String query) {
    final needle = _canonicalSearch(query);
    return needle.isNotEmpty &&
        cuisines.any(
          (value) => ' ${_canonicalSearch(value)} '.contains(' $needle '),
        );
  }
}
