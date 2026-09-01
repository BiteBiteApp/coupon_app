// ignore_for_file: avoid_web_libraries_in_flutter

import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

import 'restaurant_qr_pdf_export_lifecycle.dart';

const _pdfMimeType = 'application/pdf';

bool canDownloadPdf() {
  try {
    return globalContext.has('Blob') &&
        globalContext.has('URL') &&
        web.document.body != null;
  } catch (_) {
    return false;
  }
}

Future<void> downloadPdf(Uint8List bytes, String filename) async {
  if (!canDownloadPdf()) {
    throw UnsupportedError('PDF download is unavailable.');
  }
  if (!_isSafeGenericFilename(filename)) {
    throw ArgumentError.value(filename, 'filename', 'Unsafe PDF filename.');
  }
  await runRestaurantQrPdfDownloadLifecycle<web.HTMLAnchorElement>(
    bytes: bytes,
    filename: filename,
    mimeType: _pdfMimeType,
    createObjectUrl: (artifact, mimeType) {
      final blob = web.Blob(
        <JSAny>[artifact.toJS].toJS,
        web.BlobPropertyBag(type: mimeType),
      );
      return web.URL.createObjectURL(blob);
    },
    createAnchor: (objectUrl, safeFilename) => web.HTMLAnchorElement()
      ..href = objectUrl
      ..download = safeFilename
      ..style.display = 'none',
    appendAnchor: (anchor) => web.document.body!.appendChild(anchor),
    clickAnchor: (anchor) => anchor.click(),
    waitForInitiationTurn: () => Future<void>.delayed(Duration.zero),
    removeAnchor: (anchor) => anchor.remove(),
    revokeObjectUrl: (objectUrl) => web.URL.revokeObjectURL(objectUrl),
  );
}

bool _isSafeGenericFilename(String value) {
  return RegExp(r'^bitestar-qr-labels-[0-9]{8}-[0-9]{6}\.pdf$').hasMatch(value);
}
