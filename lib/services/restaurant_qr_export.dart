import 'dart:typed_data';

import 'restaurant_qr_export_stub.dart'
    if (dart.library.js_interop) 'restaurant_qr_export_web.dart'
    as platform;

typedef RestaurantQrCopyPngCallback = Future<void> Function(Uint8List bytes);
typedef RestaurantQrDownloadPngCallback =
    Future<void> Function(Uint8List bytes, String filename);

class RestaurantQrExportCapabilities {
  final bool canCopyImage;
  final bool canDownloadPng;
  final String? copyUnavailableReason;
  final String? downloadUnavailableReason;

  const RestaurantQrExportCapabilities({
    required this.canCopyImage,
    required this.canDownloadPng,
    this.copyUnavailableReason,
    this.downloadUnavailableReason,
  });
}

class RestaurantQrExportException implements Exception {
  final String message;

  const RestaurantQrExportException(this.message);

  @override
  String toString() => message;
}

class RestaurantQrExporter {
  static const String pngMimeType = 'image/png';

  final RestaurantQrExportCapabilities capabilities;
  final RestaurantQrCopyPngCallback _copyPng;
  final RestaurantQrDownloadPngCallback _downloadPng;

  RestaurantQrExporter({
    RestaurantQrExportCapabilities? capabilities,
    RestaurantQrCopyPngCallback? copyPng,
    RestaurantQrDownloadPngCallback? downloadPng,
  }) : capabilities = capabilities ?? _platformCapabilities(),
       _copyPng = copyPng ?? platform.copyPngImage,
       _downloadPng = downloadPng ?? platform.downloadPng;

  Future<void> copyPng(Uint8List bytes) async {
    if (!capabilities.canCopyImage) {
      throw RestaurantQrExportException(
        capabilities.copyUnavailableReason ??
            'Copy Image is unavailable on this device.',
      );
    }
    _validatePngBytes(bytes);
    try {
      await _copyPng(bytes);
    } catch (_) {
      throw const RestaurantQrExportException(
        'Could not copy the QR image. Download the PNG instead.',
      );
    }
  }

  Future<void> downloadPng(Uint8List bytes, String filename) async {
    if (!capabilities.canDownloadPng) {
      throw RestaurantQrExportException(
        capabilities.downloadUnavailableReason ??
            'PNG download is unavailable on this device.',
      );
    }
    _validatePngBytes(bytes);
    if (!_isSafePngFilename(filename)) {
      throw const RestaurantQrExportException(
        'Could not download the QR image.',
      );
    }
    try {
      await _downloadPng(bytes, filename);
    } catch (_) {
      throw const RestaurantQrExportException(
        'Could not download the QR image.',
      );
    }
  }

  static RestaurantQrExportCapabilities _platformCapabilities() {
    final canCopy = platform.canCopyPngImage();
    final canDownload = platform.canDownloadPng();
    return RestaurantQrExportCapabilities(
      canCopyImage: canCopy,
      canDownloadPng: canDownload,
      copyUnavailableReason: canCopy
          ? null
          : 'Copy Image requires a supported secure web browser.',
      downloadUnavailableReason: canDownload
          ? null
          : 'PNG download is available in the web admin workspace.',
    );
  }

  static void _validatePngBytes(Uint8List bytes) {
    const signature = <int>[137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < signature.length) {
      throw const RestaurantQrExportException('Could not export the QR image.');
    }
    for (var index = 0; index < signature.length; index += 1) {
      if (bytes[index] != signature[index]) {
        throw const RestaurantQrExportException(
          'Could not export the QR image.',
        );
      }
    }
  }

  static bool _isSafePngFilename(String value) {
    return RegExp(r'^[a-z0-9][a-z0-9-]{0,119}\.png$').hasMatch(value);
  }
}
