import 'package:flutter/services.dart';
import 'package:pdf/pdf.dart';

import '../models/admin_restaurant_mailing_pdf.dart';

typedef RestaurantMailingLabelPdfAssetLoader =
    Future<ByteData> Function(String key);
typedef RestaurantMailingLabelPdfClock = DateTime Function();

class RestaurantMailingLabelPdfException implements Exception {
  const RestaurantMailingLabelPdfException(this.message);

  final String message;

  @override
  String toString() => message;
}

class RestaurantMailingLabelPdfRect {
  const RestaurantMailingLabelPdfRect({
    required this.left,
    required this.top,
    required this.width,
    required this.height,
  });

  final double left;
  final double top;
  final double width;
  final double height;

  double get right => left + width;
  double get bottom => top + height;
  double get pdfBottom =>
      RestaurantMailingLabelPdfService.pageHeightPoints - bottom;
}

class RestaurantMailingLabelPdfGeometry {
  const RestaurantMailingLabelPdfGeometry({
    required this.pageIndex,
    required this.slotIndex,
    required this.column,
    required this.row,
    required this.labelRect,
    required this.textRect,
  });

  final int pageIndex;
  final int slotIndex;
  final int column;
  final int row;
  final RestaurantMailingLabelPdfRect labelRect;
  final RestaurantMailingLabelPdfRect textRect;
}

/// Avery 5160 mailing-label preflight and direct-text PDF builder.
///
/// The nine-point inset and eight-point minimum font remain provisional until
/// the physical-print handoff has been completed on every intended printer.
class RestaurantMailingLabelPdfService {
  const RestaurantMailingLabelPdfService({
    RestaurantMailingLabelPdfAssetLoader? loadAsset,
    RestaurantMailingLabelPdfClock? clock,
  }) : _loadAsset = loadAsset,
       _clock = clock;

  static const String fontAssetPath = 'assets/fonts/NotoSans-Regular.ttf';
  static const double pageWidthPoints = 612;
  static const double pageHeightPoints = 792;
  static const int columnCount = 3;
  static const int rowCount = 10;
  static const int labelsPerPage = columnCount * rowCount;
  static const double labelWidthPoints = 189.36;
  static const double labelHeightPoints = 72;
  static const double leftMarginPoints = 13.5;
  static const double rightMarginPoints = 13.14;
  static const double topMarginPoints = 36;
  static const double bottomMarginPoints = 36;
  static const double horizontalPitchPoints = 198;
  static const double verticalPitchPoints = 72;
  static const double horizontalGapPoints = 8.64;
  static const double verticalGapPoints = 0;
  static const double horizontalInsetPoints = 9;
  static const double verticalInsetPoints = 9;
  static const double usableTextWidthPoints = 171.36;
  static const double usableTextHeightPoints = 54;
  static const List<double> fontSizeCandidates = <double>[
    9,
    8.75,
    8.5,
    8.25,
    8,
  ];

  final RestaurantMailingLabelPdfAssetLoader? _loadAsset;
  final RestaurantMailingLabelPdfClock? _clock;

  static int pageCountForLabelCount(int labelCount) {
    if (labelCount < 0) {
      throw RangeError.range(labelCount, 0, null, 'labelCount');
    }
    return (labelCount + labelsPerPage - 1) ~/ labelsPerPage;
  }

  static double lineHeightForFontSize(double fontSizePoints) =>
      fontSizePoints == 8 ? 10 : 11;

  static RestaurantMailingLabelPdfGeometry geometryForLabelIndex(
    int labelIndex,
  ) {
    if (labelIndex < 0) {
      throw RangeError.range(labelIndex, 0, null, 'labelIndex');
    }
    final pageIndex = labelIndex ~/ labelsPerPage;
    final slotIndex = labelIndex % labelsPerPage;
    final column = slotIndex % columnCount;
    final row = slotIndex ~/ columnCount;
    final left = leftMarginPoints + (column * horizontalPitchPoints);
    final top = topMarginPoints + (row * verticalPitchPoints);
    return RestaurantMailingLabelPdfGeometry(
      pageIndex: pageIndex,
      slotIndex: slotIndex,
      column: column,
      row: row,
      labelRect: RestaurantMailingLabelPdfRect(
        left: left,
        top: top,
        width: labelWidthPoints,
        height: labelHeightPoints,
      ),
      textRect: RestaurantMailingLabelPdfRect(
        left: left + horizontalInsetPoints,
        top: top + verticalInsetPoints,
        width: usableTextWidthPoints,
        height: usableTextHeightPoints,
      ),
    );
  }

  static String safeFilename(DateTime generatedAt) =>
      'bitestar-mailing-labels-'
      '${_fourDigits(generatedAt.year)}'
      '${_twoDigits(generatedAt.month)}'
      '${_twoDigits(generatedAt.day)}-'
      '${_twoDigits(generatedAt.hour)}'
      '${_twoDigits(generatedAt.minute)}'
      '${_twoDigits(generatedAt.second)}.pdf';

  Future<AdminRestaurantMailingPdfPreflightResult> preflight(
    AdminRestaurantMailingManifest manifest, {
    Iterable<AdminRestaurantMailingPdfProblem> existingProblems = const [],
  }) async {
    final fontBytes = await _loadFontBytes();
    final metricsDocument = PdfDocument();
    late final PdfTtfFont font;
    try {
      font = PdfTtfFont(metricsDocument, fontBytes.buffer.asByteData());
    } catch (_) {
      throw const RestaurantMailingLabelPdfException(
        'Could not load the embedded PDF font.',
      );
    }

    final validLayouts = <AdminRestaurantMailingLayoutEntry>[];
    final problems = <AdminRestaurantMailingPdfProblem>[...existingProblems];
    for (var index = 0; index < manifest.entries.length; index += 1) {
      final entry = manifest.entries[index];
      if (index > 0 && index % labelsPerPage == 0) {
        await Future<void>.delayed(Duration.zero);
      }
      if (entry.printedLines
          .expand((line) => line.runes)
          .any((rune) => !font.isRuneSupported(rune))) {
        problems.add(
          AdminRestaurantMailingPdfProblem(
            catalogRestaurantId: entry.catalogRestaurantId,
            restaurantName: entry.restaurantName,
            code: AdminRestaurantMailingPdfProblemCode.unsupportedGlyph,
            message:
                'This mailing label contains characters that the embedded font cannot render.',
          ),
        );
        continue;
      }

      final fontSize = _largestFittingFontSize(font, entry.printedLines);
      if (fontSize == null) {
        problems.add(
          AdminRestaurantMailingPdfProblem(
            catalogRestaurantId: entry.catalogRestaurantId,
            restaurantName: entry.restaurantName,
            code: AdminRestaurantMailingPdfProblemCode.textCannotFit,
            message:
                'The complete three-line address cannot fit the mailing label at the eight-point minimum.',
          ),
        );
        continue;
      }
      validLayouts.add(
        AdminRestaurantMailingLayoutEntry(
          entry: entry,
          fontSizePoints: fontSize,
          lineHeightPoints: lineHeightForFontSize(fontSize),
        ),
      );
    }

    return AdminRestaurantMailingPdfPreflightResult(
      validLayouts: validLayouts,
      problems: problems,
    );
  }

  Future<AdminRestaurantMailingPdfArtifact> build(
    AdminRestaurantMailingPdfPreflightResult preflight, {
    bool approveValidOnly = false,
  }) async {
    if (!preflight.hasValidLabels) {
      throw const RestaurantMailingLabelPdfException(
        'At least one approved mailing label is required to build the PDF.',
      );
    }
    if (preflight.hasProblems && !approveValidOnly) {
      throw const RestaurantMailingLabelPdfException(
        'Explicit approval is required to export valid mailing labels only.',
      );
    }

    try {
      final fontBytes = await _loadFontBytes();
      final pdf = PdfDocument(version: PdfVersion.pdf_1_4);
      PdfInfo(
        pdf,
        title: 'BiteStar Mailing Labels',
        creator: 'BiteStar',
        producer: 'BiteStar',
      );
      final font = PdfTtfFont(pdf, fontBytes.buffer.asByteData());
      final pageCount = pageCountForLabelCount(preflight.labelCount);

      for (var pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        final page = PdfPage(
          pdf,
          pageFormat: const PdfPageFormat(pageWidthPoints, pageHeightPoints),
        );
        final graphics = page.getGraphics()..setColor(PdfColors.black);
        final firstIndex = pageIndex * labelsPerPage;
        final lastIndex = (firstIndex + labelsPerPage).clamp(
          0,
          preflight.validLayouts.length,
        );
        for (var index = firstIndex; index < lastIndex; index += 1) {
          _drawLabel(
            graphics: graphics,
            font: font,
            layout: preflight.validLayouts[index],
            geometry: geometryForLabelIndex(index),
          );
        }
        await Future<void>.delayed(Duration.zero);
      }

      final bytes = await pdf.save(enableEventLoopBalancing: true);
      return AdminRestaurantMailingPdfArtifact(
        bytes: bytes,
        summary: AdminRestaurantMailingPdfArtifactSummary(
          filename: safeFilename(_clock?.call() ?? DateTime.now()),
          includedCatalogRestaurantIds: preflight.validLayouts.map(
            (layout) => layout.entry.catalogRestaurantId,
          ),
          pageCount: pageCount,
          problems: preflight.problems,
        ),
      );
    } on RestaurantMailingLabelPdfException {
      rethrow;
    } catch (_) {
      throw const RestaurantMailingLabelPdfException(
        'Could not build the mailing-label PDF.',
      );
    }
  }

  Future<Uint8List> _loadFontBytes() async {
    try {
      final data = await (_loadAsset ?? rootBundle.load)(fontAssetPath);
      if (data.lengthInBytes == 0) throw StateError('Empty font asset.');
      return Uint8List.fromList(
        data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
      );
    } catch (_) {
      throw const RestaurantMailingLabelPdfException(
        'Could not load the embedded PDF font.',
      );
    }
  }

  static double? _largestFittingFontSize(PdfFont font, List<String> lines) {
    for (final fontSize in fontSizeCandidates) {
      final lineHeight = lineHeightForFontSize(fontSize);
      final blockHeight = lines.length * lineHeight;
      final allFit =
          blockHeight <= usableTextHeightPoints &&
          lines.every((line) {
            final metrics = font.stringMetrics(line) * fontSize;
            return metrics.advanceWidth <= usableTextWidthPoints &&
                metrics.height <= lineHeight;
          });
      if (allFit) return fontSize;
    }
    return null;
  }

  static void _drawLabel({
    required PdfGraphics graphics,
    required PdfFont font,
    required AdminRestaurantMailingLayoutEntry layout,
    required RestaurantMailingLabelPdfGeometry geometry,
  }) {
    final lines = layout.entry.printedLines;
    final blockHeight = lines.length * layout.lineHeightPoints;
    final blockTop =
        geometry.textRect.top + ((geometry.textRect.height - blockHeight) / 2);
    for (var lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      final line = lines[lineIndex];
      final metrics = font.stringMetrics(line) * layout.fontSizePoints;
      final lineTop = blockTop + (lineIndex * layout.lineHeightPoints);
      final lineBottomFromPdfBottom =
          pageHeightPoints - (lineTop + layout.lineHeightPoints);
      final baseline =
          lineBottomFromPdfBottom +
          ((layout.lineHeightPoints - metrics.height) / 2) -
          metrics.top;
      graphics.drawString(
        font,
        layout.fontSizePoints,
        line,
        geometry.textRect.left,
        baseline,
      );
    }
  }

  static String _twoDigits(int value) => value.toString().padLeft(2, '0');
  static String _fourDigits(int value) => value.toString().padLeft(4, '0');
}
