import 'dart:typed_data';

bool canCopyPngImage() => false;

bool canDownloadPng() => false;

Future<void> copyPngImage(Uint8List bytes) {
  throw UnsupportedError('Binary image clipboard is unavailable.');
}

Future<void> downloadPng(Uint8List bytes, String filename) {
  throw UnsupportedError('PNG download is unavailable.');
}
