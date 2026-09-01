import 'package:flutter/services.dart';
import 'package:pdf/pdf.dart';
import 'package:qr/qr.dart';

import '../models/admin_restaurant_qr_batch.dart';

typedef RestaurantQrPdfAssetLoader = Future<ByteData> Function(String key);
typedef RestaurantQrPdfClock = DateTime Function();

class RestaurantQrPdfException implements Exception {
  const RestaurantQrPdfException(this.message);

  final String message;

  @override
  String toString() => message;
}

class RestaurantQrPdfRect {
  const RestaurantQrPdfRect({
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

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is RestaurantQrPdfRect &&
          left == other.left &&
          top == other.top &&
          width == other.width &&
          height == other.height;

  @override
  int get hashCode => Object.hash(left, top, width, height);
}

class RestaurantQrPdfLabelGeometry {
  const RestaurantQrPdfLabelGeometry({
    required this.pageIndex,
    required this.slotIndex,
    required this.column,
    required this.row,
    required this.labelRect,
    required this.headerRect,
    required this.qrRect,
  });

  final int pageIndex;
  final int slotIndex;
  final int column;
  final int row;
  final RestaurantQrPdfRect labelRect;
  final RestaurantQrPdfRect headerRect;
  final RestaurantQrPdfRect qrRect;
}

class RestaurantQrPdfModuleRun {
  const RestaurantQrPdfModuleRun({
    required this.row,
    required this.startColumn,
    required this.length,
  });

  final int row;
  final int startColumn;
  final int length;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is RestaurantQrPdfModuleRun &&
          row == other.row &&
          startColumn == other.startColumn &&
          length == other.length;

  @override
  int get hashCode => Object.hash(row, startColumn, length);
}

/// Immutable, packed QR data-module matrix. The four-module quiet zone is
/// intentionally not stored here; it is applied by the label renderer.
class RestaurantQrPdfMatrix {
  RestaurantQrPdfMatrix._({
    required this.dataModuleCount,
    required Iterable<BigInt> darkRows,
  }) : _darkRows = List<BigInt>.unmodifiable(darkRows);

  factory RestaurantQrPdfMatrix.fromQrImage(QrImage image) {
    final rows = <BigInt>[];
    for (var row = 0; row < image.moduleCount; row += 1) {
      var darkBits = BigInt.zero;
      for (var column = 0; column < image.moduleCount; column += 1) {
        if (image.isDark(row, column)) {
          darkBits |= BigInt.one << column;
        }
      }
      rows.add(darkBits);
    }
    return RestaurantQrPdfMatrix._(
      dataModuleCount: image.moduleCount,
      darkRows: rows,
    );
  }

  final int dataModuleCount;
  final List<BigInt> _darkRows;

  bool isDark(int row, int column) {
    RangeError.checkValidIndex(row, _darkRows, 'row');
    RangeError.checkValidIndex(column, _darkRows, 'column', dataModuleCount);
    return (_darkRows[row] & (BigInt.one << column)) != BigInt.zero;
  }

  List<RestaurantQrPdfModuleRun> get horizontalDarkRuns {
    final runs = <RestaurantQrPdfModuleRun>[];
    for (var row = 0; row < dataModuleCount; row += 1) {
      var column = 0;
      while (column < dataModuleCount) {
        if (!isDark(row, column)) {
          column += 1;
          continue;
        }
        final start = column;
        do {
          column += 1;
        } while (column < dataModuleCount && isDark(row, column));
        runs.add(
          RestaurantQrPdfModuleRun(
            row: row,
            startColumn: start,
            length: column - start,
          ),
        );
      }
    }
    return List<RestaurantQrPdfModuleRun>.unmodifiable(runs);
  }

  int get darkModuleCount {
    var count = 0;
    for (var row = 0; row < dataModuleCount; row += 1) {
      for (var column = 0; column < dataModuleCount; column += 1) {
        if (isDark(row, column)) count += 1;
      }
    }
    return count;
  }
}

class RestaurantQrPdfLabelPlan {
  const RestaurantQrPdfLabelPlan({
    required this.catalogRestaurantId,
    required this.restaurantName,
    required this.label,
    required this.headerText,
    required this.matrix,
    required this.moduleSizePoints,
  });

  final String catalogRestaurantId;
  final String restaurantName;
  final AdminRestaurantQrLabelEntry label;
  final String headerText;
  final RestaurantQrPdfMatrix matrix;
  final double moduleSizePoints;
}

class RestaurantQrPdfPreflightResult {
  RestaurantQrPdfPreflightResult._({
    required this.validManifest,
    required Iterable<AdminRestaurantQrPdfProblem> problems,
    required Iterable<RestaurantQrPdfLabelPlan> labelPlans,
    required Uint8List fontBytes,
  }) : problems = List<AdminRestaurantQrPdfProblem>.unmodifiable(problems),
       labelPlans = List<RestaurantQrPdfLabelPlan>.unmodifiable(labelPlans),
       _fontBytes = Uint8List.fromList(fontBytes);

  final AdminRestaurantQrArtifactManifest validManifest;
  final List<AdminRestaurantQrPdfProblem> problems;
  final List<RestaurantQrPdfLabelPlan> labelPlans;
  final Uint8List _fontBytes;

  bool get hasProblems => problems.isNotEmpty;
  bool get hasValidLabels => validManifest.isNotEmpty;
  int get pageCount =>
      RestaurantQrPdfService.pageCountForLabelCount(validManifest.labelCount);
}

class RestaurantQrPdfArtifact {
  RestaurantQrPdfArtifact({required Uint8List bytes, required this.summary})
    : _bytes = Uint8List.fromList(bytes);

  final Uint8List _bytes;
  final AdminRestaurantQrPdfArtifactSummary summary;

  /// Returns a defensive copy so callers cannot mutate the reusable artifact.
  Uint8List get bytes => Uint8List.fromList(_bytes);

  int get byteLength => _bytes.length;
}

/// Pure Avery 5658 label-layout and vector QR PDF builder.
///
/// The 4.5-point inset and 0.75-point minimum QR module size are provisional
/// production guards. Both still require printed alignment and real-phone
/// scanning before physical distribution.
class RestaurantQrPdfService {
  const RestaurantQrPdfService({
    RestaurantQrPdfAssetLoader? loadAsset,
    RestaurantQrPdfClock? clock,
  }) : _loadAsset = loadAsset,
       _clock = clock;

  static const String fontAssetPath = 'assets/fonts/NotoSans-Regular.ttf';
  static const double pageWidthPoints = 612;
  static const double pageHeightPoints = 792;
  static const int columnCount = 6;
  static const int rowCount = 8;
  static const int labelsPerPage = columnCount * rowCount;
  static const double labelSizePoints = 72;
  static const double leftMarginPoints = 45;
  static const double rightMarginPoints = 45;
  static const double topMarginPoints = 45;
  static const double bottomMarginPoints = 45;
  static const double horizontalPitchPoints = 90;
  static const double verticalPitchPoints = 90;
  static const double horizontalGapPoints = 18;
  static const double verticalGapPoints = 18;
  static const double safeInsetPoints = 4.5;
  static const double headerHeightPoints = 7.5;
  static const double headerGapPoints = 1.5;
  static const double qrOuterSizePoints = 54;
  static const double headerFontSizePoints = 6.5;
  static const int quietZoneModules = 4;
  static const double minimumQrModuleSizePoints = 0.75;
  static const QrErrorCorrectLevel errorCorrectLevel =
      QrErrorCorrectLevel.quartile;

  static const String _tooDenseCode = 'qr_too_dense';
  static const String _payloadTooLongCode = 'qr_payload_too_long';
  static const String _matrixUnavailableCode = 'qr_matrix_unavailable';
  static const String _unsupportedFontCode = 'restaurant_name_font_unsupported';
  static const String _headerLayoutCode = 'header_layout_unavailable';

  final RestaurantQrPdfAssetLoader? _loadAsset;
  final RestaurantQrPdfClock? _clock;

  static int pageCountForLabelCount(int labelCount) {
    if (labelCount < 0) {
      throw RangeError.range(labelCount, 0, null, 'labelCount');
    }
    return (labelCount + labelsPerPage - 1) ~/ labelsPerPage;
  }

  static double moduleSizeForDataModuleCount(int dataModuleCount) {
    if (dataModuleCount <= 0) {
      throw RangeError.range(dataModuleCount, 1, null, 'dataModuleCount');
    }
    return qrOuterSizePoints / (dataModuleCount + (quietZoneModules * 2));
  }

  static RestaurantQrPdfLabelGeometry geometryForLabelIndex(int labelIndex) {
    if (labelIndex < 0) {
      throw RangeError.range(labelIndex, 0, null, 'labelIndex');
    }
    final pageIndex = labelIndex ~/ labelsPerPage;
    final slotIndex = labelIndex % labelsPerPage;
    final column = slotIndex % columnCount;
    final row = slotIndex ~/ columnCount;
    final labelLeft = leftMarginPoints + (column * horizontalPitchPoints);
    final labelTop = topMarginPoints + (row * verticalPitchPoints);
    final labelRect = RestaurantQrPdfRect(
      left: labelLeft,
      top: labelTop,
      width: labelSizePoints,
      height: labelSizePoints,
    );
    return RestaurantQrPdfLabelGeometry(
      pageIndex: pageIndex,
      slotIndex: slotIndex,
      column: column,
      row: row,
      labelRect: labelRect,
      headerRect: RestaurantQrPdfRect(
        left: labelLeft + safeInsetPoints,
        top: labelTop + safeInsetPoints,
        width: labelSizePoints - (safeInsetPoints * 2),
        height: headerHeightPoints,
      ),
      qrRect: RestaurantQrPdfRect(
        left: labelLeft + ((labelSizePoints - qrOuterSizePoints) / 2),
        top: labelTop + safeInsetPoints + headerHeightPoints + headerGapPoints,
        width: qrOuterSizePoints,
        height: qrOuterSizePoints,
      ),
    );
  }

  static String safeFilename(DateTime generatedAt) =>
      'bitestar-qr-labels-'
      '${_fourDigits(generatedAt.year)}'
      '${_twoDigits(generatedAt.month)}'
      '${_twoDigits(generatedAt.day)}-'
      '${_twoDigits(generatedAt.hour)}'
      '${_twoDigits(generatedAt.minute)}'
      '${_twoDigits(generatedAt.second)}.pdf';

  Future<RestaurantQrPdfPreflightResult> preflight(
    AdminRestaurantQrArtifactManifest manifest,
  ) async {
    final fontBytes = await _loadFontBytes();
    final metricsDocument = PdfDocument();
    late final PdfTtfFont font;
    try {
      font = PdfTtfFont(metricsDocument, fontBytes.buffer.asByteData());
    } catch (_) {
      throw const RestaurantQrPdfException(
        'Could not load the embedded PDF font.',
      );
    }

    final validRestaurants = <AdminRestaurantQrArtifactRestaurant>[];
    final problems = <AdminRestaurantQrPdfProblem>[];
    final plans = <RestaurantQrPdfLabelPlan>[];
    var processedLabels = 0;

    for (final restaurant in manifest.restaurants) {
      final validLabels = <AdminRestaurantQrLabelEntry>[];
      final unsupportedNameRune = restaurant.restaurantName.runes.any(
        (rune) => !font.isRuneSupported(rune),
      );

      for (final label in restaurant.labels) {
        processedLabels += 1;
        if (processedLabels % labelsPerPage == 0) {
          await Future<void>.delayed(Duration.zero);
        }
        if (unsupportedNameRune) {
          problems.add(
            _problem(
              restaurant: restaurant,
              label: label,
              code: _unsupportedFontCode,
              message:
                  'This restaurant name contains characters that the '
                  'embedded label font cannot render.',
            ),
          );
          continue;
        }

        final RestaurantQrPdfMatrix matrix;
        try {
          matrix = RestaurantQrPdfMatrix.fromQrImage(
            QrImage(
              QrCode(
                payload: QrPayload.fromString(label.payloadUrl),
                errorCorrectLevel: errorCorrectLevel,
              ),
            ),
          );
        } on InputTooLongException {
          problems.add(
            _problem(
              restaurant: restaurant,
              label: label,
              code: _payloadTooLongCode,
              message:
                  'This QR payload is too long for the provisional Avery '
                  '5658 one-inch label preset.',
            ),
          );
          continue;
        } catch (_) {
          problems.add(
            _problem(
              restaurant: restaurant,
              label: label,
              code: _matrixUnavailableCode,
              message: 'This QR code could not be prepared for PDF export.',
            ),
          );
          continue;
        }

        final moduleSizePoints = moduleSizeForDataModuleCount(
          matrix.dataModuleCount,
        );
        if (moduleSizePoints < minimumQrModuleSizePoints) {
          problems.add(
            _problem(
              restaurant: restaurant,
              label: label,
              code: _tooDenseCode,
              message:
                  'This QR code is too dense for the provisional Avery 5658 '
                  'one-inch label preset.',
            ),
          );
          continue;
        }

        final headerText = _fitHeaderText(
          font: font,
          marker: label.type.wireName,
          restaurantName: restaurant.restaurantName,
        );
        if (headerText == null) {
          problems.add(
            _problem(
              restaurant: restaurant,
              label: label,
              code: _headerLayoutCode,
              message:
                  'This label header cannot fit the provisional Avery 5658 '
                  'one-inch label preset.',
            ),
          );
          continue;
        }

        validLabels.add(label);
        plans.add(
          RestaurantQrPdfLabelPlan(
            catalogRestaurantId: restaurant.catalogRestaurantId,
            restaurantName: restaurant.restaurantName,
            label: label,
            headerText: headerText,
            matrix: matrix,
            moduleSizePoints: moduleSizePoints,
          ),
        );
      }

      if (validLabels.isNotEmpty) {
        validRestaurants.add(restaurant.withLabels(validLabels));
      }
    }

    return RestaurantQrPdfPreflightResult._(
      validManifest: manifest.withRestaurants(validRestaurants),
      problems: problems,
      labelPlans: plans,
      fontBytes: fontBytes,
    );
  }

  Future<RestaurantQrPdfArtifact> build(
    RestaurantQrPdfPreflightResult approvedPreflight,
  ) async {
    final manifest = approvedPreflight.validManifest;
    final plans = approvedPreflight.labelPlans;
    if (manifest.isEmpty || plans.length != manifest.labelCount) {
      throw const RestaurantQrPdfException(
        'At least one approved QR label is required to build the PDF.',
      );
    }

    try {
      final pdf = PdfDocument(version: PdfVersion.pdf_1_4);
      PdfInfo(
        pdf,
        title: 'BiteStar QR Labels',
        creator: 'BiteStar',
        producer: 'BiteStar',
      );
      final fontBytes = Uint8List.fromList(approvedPreflight._fontBytes);
      final font = PdfTtfFont(pdf, fontBytes.buffer.asByteData());
      final pageCount = pageCountForLabelCount(plans.length);

      for (var pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        final page = PdfPage(
          pdf,
          pageFormat: const PdfPageFormat(pageWidthPoints, pageHeightPoints),
        );
        final graphics = page.getGraphics()..setColor(PdfColors.black);
        final firstPlanIndex = pageIndex * labelsPerPage;
        final lastPlanIndex = (firstPlanIndex + labelsPerPage).clamp(
          0,
          plans.length,
        );

        for (
          var planIndex = firstPlanIndex;
          planIndex < lastPlanIndex;
          planIndex += 1
        ) {
          final plan = plans[planIndex];
          final geometry = geometryForLabelIndex(planIndex);
          _drawHeader(
            graphics: graphics,
            font: font,
            headerText: plan.headerText,
            headerRect: geometry.headerRect,
          );
          _drawQrRuns(
            graphics: graphics,
            matrix: plan.matrix,
            qrRect: geometry.qrRect,
            moduleSizePoints: plan.moduleSizePoints,
          );
        }
      }

      final bytes = await pdf.save(enableEventLoopBalancing: true);
      final filename = safeFilename(_clock?.call() ?? DateTime.now());
      final summary = AdminRestaurantQrPdfArtifactSummary(
        filename: filename,
        pageCount: pageCount,
        includedManifest: manifest,
      );
      return RestaurantQrPdfArtifact(bytes: bytes, summary: summary);
    } on RestaurantQrPdfException {
      rethrow;
    } catch (_) {
      throw const RestaurantQrPdfException('Could not build the QR label PDF.');
    }
  }

  Future<Uint8List> _loadFontBytes() async {
    try {
      final data = await (_loadAsset ?? rootBundle.load)(fontAssetPath);
      if (data.lengthInBytes == 0) {
        throw StateError('Empty font asset.');
      }
      return Uint8List.fromList(
        data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
      );
    } catch (_) {
      throw const RestaurantQrPdfException(
        'Could not load the embedded PDF font.',
      );
    }
  }

  static AdminRestaurantQrPdfProblem _problem({
    required AdminRestaurantQrArtifactRestaurant restaurant,
    required AdminRestaurantQrLabelEntry label,
    required String code,
    required String message,
  }) => AdminRestaurantQrPdfProblem(
    catalogRestaurantId: restaurant.catalogRestaurantId,
    restaurantName: restaurant.restaurantName,
    labelType: label.type,
    code: code,
    message: message,
  );

  static String? _fitHeaderText({
    required PdfFont font,
    required String marker,
    required String restaurantName,
  }) {
    const ellipsis = '…';
    final prefix = '$marker ';
    final fullText = '$prefix$restaurantName';
    if (_headerFits(font, fullText)) return fullText;
    if (!_headerFits(font, '$prefix$ellipsis')) return null;

    final nameRunes = restaurantName.runes.toList(growable: false);
    var low = 0;
    var high = nameRunes.length;
    while (low < high) {
      final middle = (low + high + 1) ~/ 2;
      final candidate =
          '$prefix${String.fromCharCodes(nameRunes.take(middle))}$ellipsis';
      if (_headerFits(font, candidate)) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return '$prefix${String.fromCharCodes(nameRunes.take(low))}$ellipsis';
  }

  static bool _headerFits(PdfFont font, String text) {
    final metrics = font.stringMetrics(text) * headerFontSizePoints;
    return metrics.advanceWidth <= labelSizePoints - (safeInsetPoints * 2) &&
        metrics.height <= headerHeightPoints;
  }

  static void _drawHeader({
    required PdfGraphics graphics,
    required PdfFont font,
    required String headerText,
    required RestaurantQrPdfRect headerRect,
  }) {
    final metrics = font.stringMetrics(headerText) * headerFontSizePoints;
    final x = headerRect.left + ((headerRect.width - metrics.advanceWidth) / 2);
    final headerBottom = pageHeightPoints - headerRect.bottom;
    final baseline =
        headerBottom + ((headerRect.height - metrics.height) / 2) - metrics.top;
    graphics.drawString(font, headerFontSizePoints, headerText, x, baseline);
  }

  static void _drawQrRuns({
    required PdfGraphics graphics,
    required RestaurantQrPdfMatrix matrix,
    required RestaurantQrPdfRect qrRect,
    required double moduleSizePoints,
  }) {
    final totalModuleCount = matrix.dataModuleCount + (quietZoneModules * 2);
    final qrBottom = pageHeightPoints - qrRect.bottom;
    for (final run in matrix.horizontalDarkRuns) {
      final left =
          qrRect.left +
          ((quietZoneModules + run.startColumn) * moduleSizePoints);
      final bottom =
          qrBottom +
          ((totalModuleCount - quietZoneModules - run.row - 1) *
              moduleSizePoints);
      graphics.drawRect(
        left,
        bottom,
        run.length * moduleSizePoints,
        moduleSizePoints,
      );
    }
    graphics.fillPath();
  }

  static String _twoDigits(int value) => value.toString().padLeft(2, '0');
  static String _fourDigits(int value) => value.toString().padLeft(4, '0');
}
