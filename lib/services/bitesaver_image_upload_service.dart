import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';

class BiteSaverImageUploadService {
  static final ImagePicker _picker = ImagePicker();
  static final FirebaseStorage _storage = FirebaseStorage.instance;

  static Future<String?> pickAndUploadRestaurantImage({
    required String uid,
  }) async {
    return _pickAndUpload(
      storagePath:
          'bitesaver_restaurants/${_safePathSegment(uid)}/restaurant_images',
      filePrefix: 'main_image',
    );
  }

  static Future<String?> pickAndUploadCouponImage({
    required String uid,
    required String couponKey,
  }) async {
    return _pickAndUpload(
      storagePath:
          'bitesaver_restaurants/${_safePathSegment(uid)}/coupon_images',
      filePrefix: _safePathSegment(couponKey),
    );
  }

  static Future<String?> pickAndUploadMenuImage({required String uid}) async {
    return _pickAndUpload(
      storagePath: 'bitesaver_restaurants/${_safePathSegment(uid)}/menu_images',
      filePrefix: 'menu',
    );
  }

  static Future<String?> _pickAndUpload({
    required String storagePath,
    required String filePrefix,
  }) async {
    final image = await _picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 82,
      maxWidth: 1600,
    );
    if (image == null) {
      return null;
    }

    final bytes = await image.readAsBytes();
    final contentType = _contentTypeFor(image.name);
    final extension = _extensionFor(image.name);
    final timestamp = DateTime.now().microsecondsSinceEpoch;
    final ref = _storage.ref().child(
      '$storagePath/${_safePathSegment(filePrefix)}_$timestamp.$extension',
    );

    final uploadSnapshot = await ref.putData(
      bytes,
      SettableMetadata(contentType: contentType),
    );

    return uploadSnapshot.ref.getDownloadURL();
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
