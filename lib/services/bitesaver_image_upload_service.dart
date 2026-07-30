import 'dart:ui' as ui;

import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';

class BiteSaverPickedImage {
  final String fileName;
  final Uint8List bytes;

  const BiteSaverPickedImage({required this.fileName, required this.bytes});
}

enum _BiteSaverRestaurantImageFormat {
  png(canonicalExtension: 'png', contentType: 'image/png'),
  jpeg(canonicalExtension: 'jpg', contentType: 'image/jpeg');

  final String canonicalExtension;
  final String contentType;

  const _BiteSaverRestaurantImageFormat({
    required this.canonicalExtension,
    required this.contentType,
  });
}

final class BiteSaverValidatedRestaurantImage {
  final BiteSaverPickedImage pickedImage;
  final BiteSaverPickedImage _sourceImage;
  final _BiteSaverRestaurantImageFormat _format;

  const BiteSaverValidatedRestaurantImage._(
    this.pickedImage,
    this._sourceImage,
    this._format,
  );

  bool wasValidatedFrom(BiteSaverPickedImage sourceImage) =>
      identical(_sourceImage, sourceImage);
}

typedef BiteSaverRestaurantImageStorageWriter =
    Future<BiteSaverImageUploadResult> Function({
      required String objectPath,
      required Uint8List bytes,
      required String contentType,
    });

sealed class BiteSaverCouponImageUploadResult {
  const BiteSaverCouponImageUploadResult();

  const factory BiteSaverCouponImageUploadResult.completed(String imageUrl) =
      BiteSaverCouponImageUploadCompleted;

  const factory BiteSaverCouponImageUploadResult.cancelled() =
      BiteSaverCouponImageUploadCancelled;

  const factory BiteSaverCouponImageUploadResult.stale() =
      BiteSaverCouponImageUploadStale;
}

final class BiteSaverCouponImageUploadCompleted
    extends BiteSaverCouponImageUploadResult {
  final String imageUrl;

  const BiteSaverCouponImageUploadCompleted(this.imageUrl);
}

final class BiteSaverCouponImageUploadCancelled
    extends BiteSaverCouponImageUploadResult {
  const BiteSaverCouponImageUploadCancelled();
}

final class BiteSaverCouponImageUploadStale
    extends BiteSaverCouponImageUploadResult {
  const BiteSaverCouponImageUploadStale();
}

@visibleForTesting
enum BiteSaverCouponImageCheckpoint {
  beforePicker,
  afterPicker,
  beforeByteRead,
  afterByteRead,
  beforeProcessing,
  afterProcessing,
  beforeUpload,
  afterUpload,
  beforeDownloadUrlRetrieval,
  afterDownloadUrlRetrieval,
  beforeSuccessReturn,
}

@visibleForTesting
final class BiteSaverCouponImageSource {
  final String fileName;
  final Future<Uint8List> Function() readAsBytes;

  const BiteSaverCouponImageSource({
    required this.fileName,
    required this.readAsBytes,
  });
}

@visibleForTesting
final class BiteSaverCouponImageUploadReceipt {
  final Future<String> Function() _retrieveDownloadUrl;

  const BiteSaverCouponImageUploadReceipt({
    required Future<String> Function() retrieveDownloadUrl,
  }) : _retrieveDownloadUrl = retrieveDownloadUrl;

  Future<String> retrieveDownloadUrl() => _retrieveDownloadUrl();
}

typedef BiteSaverCouponImagePicker =
    Future<BiteSaverCouponImageSource?> Function();

typedef BiteSaverCouponImageStorageUploader =
    Future<BiteSaverCouponImageUploadReceipt> Function({
      required String objectPath,
      required Uint8List bytes,
      required String contentType,
    });

typedef BiteSaverCouponImageCheckpointWaiter =
    Future<void> Function(BiteSaverCouponImageCheckpoint checkpoint);

@visibleForTesting
final class BiteSaverCouponImageUploadDependencies {
  final BiteSaverCouponImagePicker pickImage;
  final BiteSaverCouponImageStorageUploader uploadImage;
  final BiteSaverCouponImageCheckpointWaiter? waitAtCheckpoint;

  const BiteSaverCouponImageUploadDependencies({
    required this.pickImage,
    required this.uploadImage,
    this.waitAtCheckpoint,
  });
}

class BiteSaverImageUploadService {
  static final ImagePicker _picker = ImagePicker();
  static final FirebaseStorage _storage = FirebaseStorage.instance;

  static Future<BiteSaverPickedImage?> pickRestaurantImage({
    bool Function()? isCurrent,
  }) => _pickImage(isCurrent: isCurrent);

  static Future<BiteSaverValidatedRestaurantImage?> validateRestaurantImage(
    BiteSaverPickedImage pickedImage,
  ) async {
    if (pickedImage.bytes.isEmpty) {
      return null;
    }
    final canonicalImage = BiteSaverPickedImage(
      fileName: pickedImage.fileName,
      bytes: Uint8List.fromList(pickedImage.bytes).asUnmodifiableView(),
    );
    final format = _detectRestaurantImageFormat(canonicalImage.bytes);
    if (format == null) {
      return null;
    }

    ui.Codec? codec;
    ui.Image? decodedImage;
    try {
      codec = await ui.instantiateImageCodec(canonicalImage.bytes);
      final frame = await codec.getNextFrame();
      decodedImage = frame.image;
      if (decodedImage.width <= 0 || decodedImage.height <= 0) {
        return null;
      }
      return BiteSaverValidatedRestaurantImage._(
        canonicalImage,
        pickedImage,
        format,
      );
    } catch (_) {
      return null;
    } finally {
      decodedImage?.dispose();
      codec?.dispose();
    }
  }

  static Future<BiteSaverImageUploadResult> uploadRestaurantImage({
    required String uid,
    required BiteSaverValidatedRestaurantImage validatedImage,
    BiteSaverRestaurantImageStorageWriter? storageWriter,
  }) {
    final timestamp = DateTime.now().microsecondsSinceEpoch;
    final objectPath =
        'bitesaver_restaurants/${_safePathSegment(uid)}/restaurant_images/'
        'main_image_$timestamp.'
        '${validatedImage._format.canonicalExtension}';
    final writeStorageObject = storageWriter ?? _writeStorageObject;
    return writeStorageObject(
      objectPath: objectPath,
      bytes: validatedImage.pickedImage.bytes,
      contentType: validatedImage._format.contentType,
    );
  }

  static Future<String?> pickAndUploadRestaurantImage({
    required String uid,
  }) async {
    final pickedImage = await pickRestaurantImage();
    if (pickedImage == null) {
      return null;
    }
    final validatedImage = await validateRestaurantImage(pickedImage);
    if (validatedImage == null) {
      return null;
    }

    final result = await uploadRestaurantImage(
      uid: uid,
      validatedImage: validatedImage,
    );
    return result.imageUrl;
  }

  static Future<BiteSaverCouponImageUploadResult> pickAndUploadCouponImage({
    required String uid,
    required String couponKey,
    required bool Function() isCurrent,
    BiteSaverCouponImageUploadDependencies? dependencies,
  }) async {
    final pickImage = dependencies?.pickImage ?? _pickCouponImage;
    final uploadImage =
        dependencies?.uploadImage ?? _uploadCouponImageStorageObject;
    final waitAtCheckpoint = dependencies?.waitAtCheckpoint;

    if (waitAtCheckpoint != null &&
        !await _waitForCouponImageCheckpoint(
          BiteSaverCouponImageCheckpoint.beforePicker,
          isCurrent: isCurrent,
          waitAtCheckpoint: waitAtCheckpoint,
        )) {
      return const BiteSaverCouponImageUploadResult.stale();
    }
    if (!_isCouponImageOperationCurrent(isCurrent)) {
      return const BiteSaverCouponImageUploadResult.stale();
    }

    BiteSaverCouponImageSource? source;
    try {
      source = await pickImage();
    } catch (error, stackTrace) {
      if (!_isCouponImageOperationCurrent(isCurrent)) {
        return const BiteSaverCouponImageUploadResult.stale();
      }
      Error.throwWithStackTrace(error, stackTrace);
    }

    if (waitAtCheckpoint != null &&
        !await _waitForCouponImageCheckpoint(
          BiteSaverCouponImageCheckpoint.afterPicker,
          isCurrent: isCurrent,
          waitAtCheckpoint: waitAtCheckpoint,
        )) {
      return const BiteSaverCouponImageUploadResult.stale();
    }
    if (!_isCouponImageOperationCurrent(isCurrent)) {
      return const BiteSaverCouponImageUploadResult.stale();
    }
    if (source == null) {
      return const BiteSaverCouponImageUploadResult.cancelled();
    }

    if (waitAtCheckpoint != null &&
        !await _waitForCouponImageCheckpoint(
          BiteSaverCouponImageCheckpoint.beforeByteRead,
          isCurrent: isCurrent,
          waitAtCheckpoint: waitAtCheckpoint,
        )) {
      return const BiteSaverCouponImageUploadResult.stale();
    }
    if (!_isCouponImageOperationCurrent(isCurrent)) {
      return const BiteSaverCouponImageUploadResult.stale();
    }

    late Uint8List bytes;
    try {
      bytes = await source.readAsBytes();
    } catch (error, stackTrace) {
      if (!_isCouponImageOperationCurrent(isCurrent)) {
        return const BiteSaverCouponImageUploadResult.stale();
      }
      Error.throwWithStackTrace(error, stackTrace);
    }

    if (waitAtCheckpoint != null &&
        !await _waitForCouponImageCheckpoint(
          BiteSaverCouponImageCheckpoint.afterByteRead,
          isCurrent: isCurrent,
          waitAtCheckpoint: waitAtCheckpoint,
        )) {
      return const BiteSaverCouponImageUploadResult.stale();
    }
    if (!_isCouponImageOperationCurrent(isCurrent)) {
      return const BiteSaverCouponImageUploadResult.stale();
    }

    if (waitAtCheckpoint != null &&
        !await _waitForCouponImageCheckpoint(
          BiteSaverCouponImageCheckpoint.beforeProcessing,
          isCurrent: isCurrent,
          waitAtCheckpoint: waitAtCheckpoint,
        )) {
      return const BiteSaverCouponImageUploadResult.stale();
    }
    if (!_isCouponImageOperationCurrent(isCurrent)) {
      return const BiteSaverCouponImageUploadResult.stale();
    }

    // Coupon images currently require no service-side processing. These
    // checkpoints make that boundary explicit if processing is added later.
    final processedBytes = bytes;

    if (waitAtCheckpoint != null &&
        !await _waitForCouponImageCheckpoint(
          BiteSaverCouponImageCheckpoint.afterProcessing,
          isCurrent: isCurrent,
          waitAtCheckpoint: waitAtCheckpoint,
        )) {
      return const BiteSaverCouponImageUploadResult.stale();
    }
    if (!_isCouponImageOperationCurrent(isCurrent)) {
      return const BiteSaverCouponImageUploadResult.stale();
    }

    final contentType = _contentTypeFor(source.fileName);
    final extension = _extensionFor(source.fileName);
    final timestamp = DateTime.now().microsecondsSinceEpoch;
    final objectPath =
        'bitesaver_restaurants/${_safePathSegment(uid)}/coupon_images/'
        '${_safePathSegment(couponKey)}_$timestamp.$extension';

    if (waitAtCheckpoint != null &&
        !await _waitForCouponImageCheckpoint(
          BiteSaverCouponImageCheckpoint.beforeUpload,
          isCurrent: isCurrent,
          waitAtCheckpoint: waitAtCheckpoint,
        )) {
      return const BiteSaverCouponImageUploadResult.stale();
    }
    if (!_isCouponImageOperationCurrent(isCurrent)) {
      return const BiteSaverCouponImageUploadResult.stale();
    }

    late BiteSaverCouponImageUploadReceipt receipt;
    try {
      receipt = await uploadImage(
        objectPath: objectPath,
        bytes: processedBytes,
        contentType: contentType,
      );
    } catch (error, stackTrace) {
      if (!_isCouponImageOperationCurrent(isCurrent)) {
        return const BiteSaverCouponImageUploadResult.stale();
      }
      Error.throwWithStackTrace(error, stackTrace);
    }

    if (waitAtCheckpoint != null &&
        !await _waitForCouponImageCheckpoint(
          BiteSaverCouponImageCheckpoint.afterUpload,
          isCurrent: isCurrent,
          waitAtCheckpoint: waitAtCheckpoint,
        )) {
      return const BiteSaverCouponImageUploadResult.stale();
    }
    if (!_isCouponImageOperationCurrent(isCurrent)) {
      return const BiteSaverCouponImageUploadResult.stale();
    }

    if (waitAtCheckpoint != null &&
        !await _waitForCouponImageCheckpoint(
          BiteSaverCouponImageCheckpoint.beforeDownloadUrlRetrieval,
          isCurrent: isCurrent,
          waitAtCheckpoint: waitAtCheckpoint,
        )) {
      return const BiteSaverCouponImageUploadResult.stale();
    }
    if (!_isCouponImageOperationCurrent(isCurrent)) {
      return const BiteSaverCouponImageUploadResult.stale();
    }

    late String imageUrl;
    try {
      imageUrl = await receipt.retrieveDownloadUrl();
    } catch (error, stackTrace) {
      if (!_isCouponImageOperationCurrent(isCurrent)) {
        return const BiteSaverCouponImageUploadResult.stale();
      }
      Error.throwWithStackTrace(error, stackTrace);
    }

    if (waitAtCheckpoint != null &&
        !await _waitForCouponImageCheckpoint(
          BiteSaverCouponImageCheckpoint.afterDownloadUrlRetrieval,
          isCurrent: isCurrent,
          waitAtCheckpoint: waitAtCheckpoint,
        )) {
      return const BiteSaverCouponImageUploadResult.stale();
    }
    if (!_isCouponImageOperationCurrent(isCurrent)) {
      return const BiteSaverCouponImageUploadResult.stale();
    }

    if (waitAtCheckpoint != null &&
        !await _waitForCouponImageCheckpoint(
          BiteSaverCouponImageCheckpoint.beforeSuccessReturn,
          isCurrent: isCurrent,
          waitAtCheckpoint: waitAtCheckpoint,
        )) {
      return const BiteSaverCouponImageUploadResult.stale();
    }
    if (!_isCouponImageOperationCurrent(isCurrent)) {
      return const BiteSaverCouponImageUploadResult.stale();
    }

    return BiteSaverCouponImageUploadResult.completed(imageUrl);
  }

  static Future<String?> pickAndUploadMenuImage({required String uid}) async {
    return _pickAndUpload(
      storagePath: 'bitesaver_restaurants/${_safePathSegment(uid)}/menu_images',
      filePrefix: 'menu',
    );
  }

  static Future<BiteSaverImageUploadResult?> pickAndUploadSharedMenuImage({
    required String menuId,
  }) async {
    return _pickAndUploadResult(
      storagePath: 'restaurant_menus/${_safePathSegment(menuId)}/menu_images',
      filePrefix: 'menu',
    );
  }

  static Future<String?> _pickAndUpload({
    required String storagePath,
    required String filePrefix,
  }) async {
    final result = await _pickAndUploadResult(
      storagePath: storagePath,
      filePrefix: filePrefix,
    );
    return result?.imageUrl;
  }

  static Future<BiteSaverImageUploadResult?> _pickAndUploadResult({
    required String storagePath,
    required String filePrefix,
  }) async {
    final pickedImage = await _pickImage();
    if (pickedImage == null) {
      return null;
    }

    return _uploadPickedImage(
      storagePath: storagePath,
      filePrefix: filePrefix,
      pickedImage: pickedImage,
    );
  }

  static Future<BiteSaverPickedImage?> _pickImage({
    bool Function()? isCurrent,
  }) async {
    final image = await _picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 82,
      maxWidth: 1600,
    );
    if (image == null || !(isCurrent?.call() ?? true)) {
      return null;
    }

    final bytes = await image.readAsBytes();
    if (!(isCurrent?.call() ?? true)) {
      return null;
    }
    return BiteSaverPickedImage(fileName: image.name, bytes: bytes);
  }

  static Future<BiteSaverImageUploadResult> _uploadPickedImage({
    required String storagePath,
    required String filePrefix,
    required BiteSaverPickedImage pickedImage,
  }) async {
    final contentType = _contentTypeFor(pickedImage.fileName);
    final extension = _extensionFor(pickedImage.fileName);
    final timestamp = DateTime.now().microsecondsSinceEpoch;
    final fullPath =
        '$storagePath/${_safePathSegment(filePrefix)}_$timestamp.$extension';
    return _writeStorageObject(
      objectPath: fullPath,
      bytes: pickedImage.bytes,
      contentType: contentType,
    );
  }

  static Future<BiteSaverImageUploadResult> _writeStorageObject({
    required String objectPath,
    required Uint8List bytes,
    required String contentType,
  }) async {
    final ref = _storage.ref().child(objectPath);

    final uploadSnapshot = await ref.putData(
      bytes,
      SettableMetadata(contentType: contentType),
    );

    final imageUrl = await uploadSnapshot.ref.getDownloadURL();
    return BiteSaverImageUploadResult(
      imageUrl: imageUrl,
      storagePath: uploadSnapshot.ref.fullPath,
    );
  }

  static Future<BiteSaverCouponImageSource?> _pickCouponImage() async {
    final image = await _picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 82,
      maxWidth: 1600,
    );
    if (image == null) {
      return null;
    }
    return BiteSaverCouponImageSource(
      fileName: image.name,
      readAsBytes: image.readAsBytes,
    );
  }

  static Future<BiteSaverCouponImageUploadReceipt>
  _uploadCouponImageStorageObject({
    required String objectPath,
    required Uint8List bytes,
    required String contentType,
  }) async {
    final ref = _storage.ref().child(objectPath);
    final uploadSnapshot = await ref.putData(
      bytes,
      SettableMetadata(contentType: contentType),
    );
    return BiteSaverCouponImageUploadReceipt(
      retrieveDownloadUrl: uploadSnapshot.ref.getDownloadURL,
    );
  }

  static Future<bool> _waitForCouponImageCheckpoint(
    BiteSaverCouponImageCheckpoint checkpoint, {
    required bool Function() isCurrent,
    required BiteSaverCouponImageCheckpointWaiter waitAtCheckpoint,
  }) async {
    try {
      await waitAtCheckpoint(checkpoint);
    } catch (error, stackTrace) {
      if (!_isCouponImageOperationCurrent(isCurrent)) {
        return false;
      }
      Error.throwWithStackTrace(error, stackTrace);
    }
    return true;
  }

  static bool _isCouponImageOperationCurrent(bool Function() isCurrent) {
    try {
      return isCurrent();
    } catch (_) {
      return false;
    }
  }

  static _BiteSaverRestaurantImageFormat? _detectRestaurantImageFormat(
    Uint8List bytes,
  ) {
    if (bytes.length >= 8 &&
        bytes[0] == 0x89 &&
        bytes[1] == 0x50 &&
        bytes[2] == 0x4e &&
        bytes[3] == 0x47 &&
        bytes[4] == 0x0d &&
        bytes[5] == 0x0a &&
        bytes[6] == 0x1a &&
        bytes[7] == 0x0a) {
      return _BiteSaverRestaurantImageFormat.png;
    }
    if (bytes.length >= 3 &&
        bytes[0] == 0xff &&
        bytes[1] == 0xd8 &&
        bytes[2] == 0xff) {
      return _BiteSaverRestaurantImageFormat.jpeg;
    }
    return null;
  }

  static String _safePathSegment(String value) {
    final safe = value.trim().replaceAll(RegExp(r'[^A-Za-z0-9_-]+'), '_');
    return safe.isEmpty ? 'image' : safe;
  }

  static String _extensionFor(String fileName) {
    final lower = fileName.toLowerCase();
    if (lower.endsWith('.png')) {
      return 'png';
    }
    if (lower.endsWith('.webp')) {
      return 'webp';
    }
    return 'jpg';
  }

  static String _contentTypeFor(String fileName) {
    final extension = _extensionFor(fileName);
    return switch (extension) {
      'png' => 'image/png',
      'webp' => 'image/webp',
      _ => 'image/jpeg',
    };
  }
}

class BiteSaverImageUploadResult {
  final String imageUrl;
  final String storagePath;

  const BiteSaverImageUploadResult({
    required this.imageUrl,
    required this.storagePath,
  });
}
