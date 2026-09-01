import 'dart:typed_data';

import 'restaurant_qr_pdf_export_stub.dart'
    if (dart.library.js_interop) 'restaurant_qr_pdf_export_web.dart'
    as platform;

typedef RestaurantQrPdfDownloadCallback =
    Future<void> Function(Uint8List bytes, String filename);

class RestaurantQrPdfExportCapabilities {
  final bool canDownloadPdf;
  final String? downloadUnavailableReason;

  const RestaurantQrPdfExportCapabilities({
    required this.canDownloadPdf,
    this.downloadUnavailableReason,
  });
}

enum RestaurantQrPdfExportFailure {
  unsupported,
  invalidPdf,
  invalidFilename,
  initiationFailed,
}

class RestaurantQrPdfExportResult {
  final bool initiated;
  final String message;
  final RestaurantQrPdfExportFailure? failure;

  const RestaurantQrPdfExportResult._({
    required this.initiated,
    required this.message,
    this.failure,
  });

  const RestaurantQrPdfExportResult.initiated()
    : this._(initiated: true, message: 'PDF download initiated.');

  const RestaurantQrPdfExportResult.failed({
    required RestaurantQrPdfExportFailure failure,
    required String message,
  }) : this._(initiated: false, message: message, failure: failure);
}

class RestaurantQrPdfExporter {
  static const String pdfMimeType = 'application/pdf';

  final RestaurantQrPdfExportCapabilities capabilities;
  final RestaurantQrPdfDownloadCallback _downloadPdf;

  RestaurantQrPdfExporter({
    RestaurantQrPdfExportCapabilities? capabilities,
    RestaurantQrPdfDownloadCallback? downloadPdf,
  }) : capabilities = capabilities ?? _platformCapabilities(),
       _downloadPdf = downloadPdf ?? platform.downloadPdf;

  Future<RestaurantQrPdfExportResult> downloadPdf(
    Uint8List bytes,
    String filename,
  ) async {
    if (!capabilities.canDownloadPdf) {
      return RestaurantQrPdfExportResult.failed(
        failure: RestaurantQrPdfExportFailure.unsupported,
        message:
            capabilities.downloadUnavailableReason ??
            'PDF download is unavailable on this device.',
      );
    }
    if (!_hasPdfSignature(bytes)) {
      return const RestaurantQrPdfExportResult.failed(
        failure: RestaurantQrPdfExportFailure.invalidPdf,
        message: 'Could not download the QR label PDF.',
      );
    }
    if (!_isSafeGenericFilename(filename)) {
      return const RestaurantQrPdfExportResult.failed(
        failure: RestaurantQrPdfExportFailure.invalidFilename,
        message: 'Could not download the QR label PDF.',
      );
    }
    try {
      await _downloadPdf(bytes, filename);
      return const RestaurantQrPdfExportResult.initiated();
    } catch (_) {
      return const RestaurantQrPdfExportResult.failed(
        failure: RestaurantQrPdfExportFailure.initiationFailed,
        message: 'Could not initiate the PDF download.',
      );
    }
  }

  static RestaurantQrPdfExportCapabilities _platformCapabilities() {
    final canDownload = platform.canDownloadPdf();
    return RestaurantQrPdfExportCapabilities(
      canDownloadPdf: canDownload,
      downloadUnavailableReason: canDownload
          ? null
          : 'PDF download is available in the web admin workspace.',
    );
  }

  static bool _hasPdfSignature(Uint8List bytes) {
    const signature = <int>[37, 80, 68, 70, 45]; // %PDF-
    if (bytes.length < signature.length) {
      return false;
    }
    for (var index = 0; index < signature.length; index += 1) {
      if (bytes[index] != signature[index]) {
        return false;
      }
    }
    return true;
  }

  static bool _isSafeGenericFilename(String value) {
    return RegExp(
      r'^bitestar-qr-labels-[0-9]{8}-[0-9]{6}\.pdf$',
    ).hasMatch(value);
  }
}
