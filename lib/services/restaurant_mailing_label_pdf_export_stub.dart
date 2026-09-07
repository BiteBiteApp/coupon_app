import 'dart:typed_data';

bool canDownloadPdf() => false;

Future<void> downloadPdf(Uint8List bytes, String filename) {
  throw UnsupportedError('PDF download is unavailable.');
}
