import 'dart:typed_data';

typedef RestaurantQrPdfObjectUrlFactory =
    String Function(Uint8List bytes, String mimeType);
typedef RestaurantQrPdfAnchorFactory<T> =
    T Function(String objectUrl, String filename);
typedef RestaurantQrPdfAnchorAction<T> = void Function(T anchor);
typedef RestaurantQrPdfObjectUrlRevoker = void Function(String objectUrl);
typedef RestaurantQrPdfEventTurn = Future<void> Function();

/// Runs the browser download lifecycle behind platform-neutral seams so its
/// ordering and cleanup contract can be tested without a real file download.
Future<void> runRestaurantQrPdfDownloadLifecycle<T>({
  required Uint8List bytes,
  required String filename,
  required String mimeType,
  required RestaurantQrPdfObjectUrlFactory createObjectUrl,
  required RestaurantQrPdfAnchorFactory<T> createAnchor,
  required RestaurantQrPdfAnchorAction<T> appendAnchor,
  required RestaurantQrPdfAnchorAction<T> clickAnchor,
  required RestaurantQrPdfEventTurn waitForInitiationTurn,
  required RestaurantQrPdfAnchorAction<T> removeAnchor,
  required RestaurantQrPdfObjectUrlRevoker revokeObjectUrl,
}) async {
  final objectUrl = createObjectUrl(bytes, mimeType);
  T? anchor;
  Object? primaryError;
  StackTrace? primaryStackTrace;
  try {
    final createdAnchor = createAnchor(objectUrl, filename);
    anchor = createdAnchor;
    appendAnchor(createdAnchor);
    clickAnchor(createdAnchor);
    await waitForInitiationTurn();
  } catch (error, stackTrace) {
    primaryError = error;
    primaryStackTrace = stackTrace;
  }

  if (anchor != null) {
    try {
      removeAnchor(anchor);
    } catch (_) {
      // Cleanup is best effort and must not replace the initiation outcome.
    }
  }
  try {
    revokeObjectUrl(objectUrl);
  } catch (_) {
    // Revocation is still attempted after removal fails, without changing the
    // primary success or failure observed by the caller.
  }

  if (primaryError != null) {
    Error.throwWithStackTrace(primaryError, primaryStackTrace!);
  }
}
