// ignore_for_file: avoid_web_libraries_in_flutter

import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

const _pngMimeType = 'image/png';

bool canCopyPngImage() {
  try {
    if (!web.window.isSecureContext ||
        !globalContext.has('ClipboardItem') ||
        !web.window.navigator.has('clipboard')) {
      return false;
    }
    final clipboardItemConstructor = globalContext.getProperty<JSObject>(
      'ClipboardItem'.toJS,
    );
    if (!clipboardItemConstructor.has('supports')) {
      return false;
    }
    final clipboard = web.window.navigator.clipboard;
    return clipboard.has('write') && web.ClipboardItem.supports(_pngMimeType);
  } catch (_) {
    return false;
  }
}

bool canDownloadPng() {
  try {
    return globalContext.has('Blob') &&
        globalContext.has('URL') &&
        web.document.body != null;
  } catch (_) {
    return false;
  }
}

Future<void> copyPngImage(Uint8List bytes) async {
  if (!canCopyPngImage()) {
    throw UnsupportedError('Binary image clipboard is unavailable.');
  }
  final blob = _pngBlob(bytes);
  final itemData = JSObject()..[_pngMimeType] = blob;
  final clipboardItem = web.ClipboardItem(itemData);
  await web.window.navigator.clipboard
      .write(<web.ClipboardItem>[clipboardItem].toJS)
      .toDart;
}

Future<void> downloadPng(Uint8List bytes, String filename) async {
  if (!canDownloadPng()) {
    throw UnsupportedError('PNG download is unavailable.');
  }
  final blob = _pngBlob(bytes);
  final objectUrl = web.URL.createObjectURL(blob);
  final anchor = web.HTMLAnchorElement()
    ..href = objectUrl
    ..download = filename
    ..style.display = 'none';
  try {
    web.document.body!.appendChild(anchor);
    anchor.click();
    await Future<void>.delayed(Duration.zero);
  } finally {
    anchor.remove();
    web.URL.revokeObjectURL(objectUrl);
  }
}

web.Blob _pngBlob(Uint8List bytes) {
  return web.Blob(
    <JSAny>[bytes.toJS].toJS,
    web.BlobPropertyBag(type: _pngMimeType),
  );
}
