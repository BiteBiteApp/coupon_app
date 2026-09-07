import 'dart:typed_data';

import 'restaurant_mailing_label_pdf_export_stub.dart'
    if (dart.library.js_interop) 'restaurant_mailing_label_pdf_export_web.dart'
    as platform;

typedef RestaurantMailingLabelPdfDownloadCallback =
    Future<void> Function(Uint8List bytes, String filename);

class RestaurantMailingLabelPdfExportCapabilities {
  const RestaurantMailingLabelPdfExportCapabilities({
    required this.canDownloadPdf,
    this.downloadUnavailableReason,
  });

  final bool canDownloadPdf;
  final String? downloadUnavailableReason;
}

enum RestaurantMailingLabelPdfExportFailure {
  unsupported,
  invalidPdf,
  invalidFilename,
  initiationFailed,
}

class RestaurantMailingLabelPdfExportResult {
  const RestaurantMailingLabelPdfExportResult._({
    required this.initiated,
    required this.message,
    this.failure,
  });

  const RestaurantMailingLabelPdfExportResult.initiated()
    : this._(initiated: true, message: 'Mailing-label PDF download initiated.');

  const RestaurantMailingLabelPdfExportResult.failed({
    required RestaurantMailingLabelPdfExportFailure failure,
    required String message,
  }) : this._(initiated: false, message: message, failure: failure);

  final bool initiated;
  final String message;
  final RestaurantMailingLabelPdfExportFailure? failure;
}

class RestaurantMailingLabelPdfExporter {
  RestaurantMailingLabelPdfExporter({
    RestaurantMailingLabelPdfExportCapabilities? capabilities,
    RestaurantMailingLabelPdfDownloadCallback? downloadPdf,
  }) : capabilities = capabilities ?? _platformCapabilities(),
       _downloadPdf = downloadPdf ?? platform.downloadPdf;

  static const String pdfMimeType = 'application/pdf';

  final RestaurantMailingLabelPdfExportCapabilities capabilities;
  final RestaurantMailingLabelPdfDownloadCallback _downloadPdf;

  Future<RestaurantMailingLabelPdfExportResult> downloadPdf(
    Uint8List bytes,
    String filename,
  ) async {
    if (!capabilities.canDownloadPdf) {
      return RestaurantMailingLabelPdfExportResult.failed(
        failure: RestaurantMailingLabelPdfExportFailure.unsupported,
        message:
            capabilities.downloadUnavailableReason ??
            'Mailing-label PDF download is unavailable on this device.',
      );
    }
    if (!_hasPdfSignature(bytes)) {
      return const RestaurantMailingLabelPdfExportResult.failed(
        failure: RestaurantMailingLabelPdfExportFailure.invalidPdf,
        message: 'Could not download the mailing-label PDF.',
      );
    }
    if (!isSafeGenericFilename(filename)) {
      return const RestaurantMailingLabelPdfExportResult.failed(
        failure: RestaurantMailingLabelPdfExportFailure.invalidFilename,
        message: 'Could not download the mailing-label PDF.',
      );
    }
    try {
      await _downloadPdf(bytes, filename);
      return const RestaurantMailingLabelPdfExportResult.initiated();
    } catch (_) {
      return const RestaurantMailingLabelPdfExportResult.failed(
        failure: RestaurantMailingLabelPdfExportFailure.initiationFailed,
        message: 'Could not initiate the mailing-label PDF download.',
      );
    }
  }

  static bool isSafeGenericFilename(String value) => RegExp(
    r'^bitestar-mailing-labels-[0-9]{8}-[0-9]{6}\.pdf$',
  ).hasMatch(value);

  static RestaurantMailingLabelPdfExportCapabilities _platformCapabilities() {
    final canDownload = platform.canDownloadPdf();
    return RestaurantMailingLabelPdfExportCapabilities(
      canDownloadPdf: canDownload,
      downloadUnavailableReason: canDownload
          ? null
          : 'Mailing-label PDF download is available in the web admin workspace.',
    );
  }

  static bool _hasPdfSignature(Uint8List bytes) {
    const signature = <int>[37, 80, 68, 70, 45];
    if (bytes.length < signature.length) return false;
    for (var index = 0; index < signature.length; index += 1) {
      if (bytes[index] != signature[index]) return false;
    }
    return true;
  }
}
