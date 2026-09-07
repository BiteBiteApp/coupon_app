import 'package:flutter/foundation.dart';

import 'admin_restaurant_mailing_batch.dart';

enum AdminRestaurantMailingPdfProblemCode {
  authoritativeMailingData('authoritative_mailing_data'),
  unconfirmedTransport('unconfirmed_transport'),
  unsupportedGlyph('unsupported_glyph'),
  textCannotFit('text_cannot_fit'),
  excludedNoQrValidArtifact('excluded_no_qr_valid_artifact');

  const AdminRestaurantMailingPdfProblemCode(this.wireName);

  final String wireName;
}

@immutable
class AdminRestaurantMailingManifestEntry {
  factory AdminRestaurantMailingManifestEntry.fromReady(
    AdminRestaurantMailingReady ready,
  ) => AdminRestaurantMailingManifestEntry._(
    catalogRestaurantId: ready.catalogRestaurantId,
    restaurantName: ready.restaurantName,
    streetAddress: ready.streetAddress,
    city: ready.city,
    state: ready.state,
    zipCode: ready.zipCode,
  );

  const AdminRestaurantMailingManifestEntry._({
    required this.catalogRestaurantId,
    required this.restaurantName,
    required this.streetAddress,
    required this.city,
    required this.state,
    required this.zipCode,
  });

  final String catalogRestaurantId;
  final String restaurantName;
  final String streetAddress;
  final String city;
  final String state;
  final String zipCode;

  String get cityStateZip => '$city, $state $zipCode';

  List<String> get printedLines => List<String>.unmodifiable(<String>[
    restaurantName,
    streetAddress,
    cityStateZip,
  ]);
}

@immutable
class AdminRestaurantMailingManifest {
  factory AdminRestaurantMailingManifest(
    Iterable<AdminRestaurantMailingManifestEntry> entries,
  ) {
    final immutableEntries =
        List<AdminRestaurantMailingManifestEntry>.unmodifiable(entries);
    final seenIds = <String>{};
    if (immutableEntries.any(
      (entry) => !seenIds.add(entry.catalogRestaurantId),
    )) {
      throw const AdminRestaurantMailingProtocolException();
    }
    return AdminRestaurantMailingManifest._(immutableEntries);
  }

  const AdminRestaurantMailingManifest._(this.entries);

  final List<AdminRestaurantMailingManifestEntry> entries;

  bool get isEmpty => entries.isEmpty;
  bool get isNotEmpty => entries.isNotEmpty;
  int get labelCount => entries.length;
}

@immutable
class AdminRestaurantMailingPdfProblem {
  factory AdminRestaurantMailingPdfProblem({
    required String catalogRestaurantId,
    required String? restaurantName,
    required AdminRestaurantMailingPdfProblemCode code,
    required String message,
  }) {
    final exactId = AdminRestaurantMailingSelection(<String>[
      catalogRestaurantId,
    ]).catalogRestaurantIds.single;
    final safeName = restaurantName == null
        ? null
        : _safeOneLineText(restaurantName, maximumLength: 300);
    return AdminRestaurantMailingPdfProblem._(
      catalogRestaurantId: exactId,
      restaurantName: safeName,
      code: code,
      message: _safeOneLineText(message, maximumLength: 500),
    );
  }

  const AdminRestaurantMailingPdfProblem._({
    required this.catalogRestaurantId,
    required this.restaurantName,
    required this.code,
    required this.message,
  });

  final String catalogRestaurantId;
  final String? restaurantName;
  final AdminRestaurantMailingPdfProblemCode code;
  final String message;
}

@immutable
class AdminRestaurantMailingLayoutEntry {
  factory AdminRestaurantMailingLayoutEntry({
    required AdminRestaurantMailingManifestEntry entry,
    required double fontSizePoints,
    required double lineHeightPoints,
  }) {
    const fontSizes = <double>[9, 8.75, 8.5, 8.25, 8];
    final expectedLineHeight = fontSizePoints == 8 ? 10 : 11;
    if (!fontSizes.contains(fontSizePoints) ||
        lineHeightPoints != expectedLineHeight) {
      throw const AdminRestaurantMailingProtocolException();
    }
    return AdminRestaurantMailingLayoutEntry._(
      entry: entry,
      fontSizePoints: fontSizePoints,
      lineHeightPoints: lineHeightPoints,
    );
  }

  const AdminRestaurantMailingLayoutEntry._({
    required this.entry,
    required this.fontSizePoints,
    required this.lineHeightPoints,
  });

  final AdminRestaurantMailingManifestEntry entry;
  final double fontSizePoints;
  final double lineHeightPoints;
}

@immutable
class AdminRestaurantMailingPdfPreflightResult {
  AdminRestaurantMailingPdfPreflightResult({
    required Iterable<AdminRestaurantMailingLayoutEntry> validLayouts,
    required Iterable<AdminRestaurantMailingPdfProblem> problems,
  }) : validLayouts = List<AdminRestaurantMailingLayoutEntry>.unmodifiable(
         validLayouts,
       ),
       problems = List<AdminRestaurantMailingPdfProblem>.unmodifiable(
         problems,
       ) {
    final validIds = <String>{};
    final problemIds = <String>{};
    if (this.validLayouts.any(
          (layout) => !validIds.add(layout.entry.catalogRestaurantId),
        ) ||
        this.problems.any(
          (problem) =>
              validIds.contains(problem.catalogRestaurantId) ||
              !problemIds.add(problem.catalogRestaurantId),
        )) {
      throw const AdminRestaurantMailingProtocolException();
    }
  }

  final List<AdminRestaurantMailingLayoutEntry> validLayouts;
  final List<AdminRestaurantMailingPdfProblem> problems;

  bool get hasProblems => problems.isNotEmpty;
  bool get hasValidLabels => validLayouts.isNotEmpty;
  int get labelCount => validLayouts.length;
}

@immutable
class AdminRestaurantMailingPdfArtifactSummary {
  AdminRestaurantMailingPdfArtifactSummary({
    required this.filename,
    required Iterable<String> includedCatalogRestaurantIds,
    required this.pageCount,
    required Iterable<AdminRestaurantMailingPdfProblem> problems,
  }) : includedCatalogRestaurantIds = List<String>.unmodifiable(
         AdminRestaurantMailingSelection(
           includedCatalogRestaurantIds,
         ).catalogRestaurantIds,
       ),
       problems = List<AdminRestaurantMailingPdfProblem>.unmodifiable(
         problems,
       ) {
    final expectedPageCount =
        (this.includedCatalogRestaurantIds.length + 29) ~/ 30;
    final includedIds = this.includedCatalogRestaurantIds.toSet();
    final problemIds = <String>{};
    if (!RegExp(
          r'^bitestar-mailing-labels-[0-9]{8}-[0-9]{6}\.pdf$',
        ).hasMatch(filename) ||
        pageCount != expectedPageCount ||
        this.problems.any(
          (problem) =>
              includedIds.contains(problem.catalogRestaurantId) ||
              !problemIds.add(problem.catalogRestaurantId),
        )) {
      throw const AdminRestaurantMailingProtocolException();
    }
  }

  final String filename;
  final List<String> includedCatalogRestaurantIds;
  final int pageCount;
  final List<AdminRestaurantMailingPdfProblem> problems;

  int get restaurantCount => includedCatalogRestaurantIds.length;
  int get labelCount => restaurantCount;
}

@immutable
class AdminRestaurantMailingPdfArtifact {
  AdminRestaurantMailingPdfArtifact({
    required Uint8List bytes,
    required this.summary,
  }) : _bytes = Uint8List.fromList(bytes) {
    if (_bytes.length < 5 ||
        _bytes[0] != 37 ||
        _bytes[1] != 80 ||
        _bytes[2] != 68 ||
        _bytes[3] != 70 ||
        _bytes[4] != 45) {
      throw const AdminRestaurantMailingProtocolException();
    }
  }

  final Uint8List _bytes;
  final AdminRestaurantMailingPdfArtifactSummary summary;

  Uint8List get bytes => Uint8List.fromList(_bytes);
  int get byteLength => _bytes.length;
}

String _safeOneLineText(String value, {required int maximumLength}) {
  if (value.isEmpty ||
      value.length > maximumLength ||
      value.trim() != value ||
      value.runes.any((rune) => rune < 0x20 || rune == 0x7f) ||
      RegExp(
        r'(?:https?://|go\.bitestar\.app|/invite/)',
        caseSensitive: false,
      ).hasMatch(value)) {
    throw const AdminRestaurantMailingProtocolException();
  }
  return value;
}
