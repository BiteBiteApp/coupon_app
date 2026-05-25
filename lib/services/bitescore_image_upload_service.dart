import 'dart:typed_data';

import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';

class BiteScorePickedDishImage {
  final String fileName;
  final Uint8List bytes;

  const BiteScorePickedDishImage({required this.fileName, required this.bytes});
}

class BiteScoreUploadedDishImage {
  final String imageUrl;
  final String storagePath;

  const BiteScoreUploadedDishImage({
    required this.imageUrl,
    required this.storagePath,
  });
}

class BiteScoreImageUploadService {
  static final ImagePicker _picker = ImagePicker();
  static final FirebaseStorage _storage = FirebaseStorage.instance;

  static Future<BiteScorePickedDishImage?> pickDishImage() async {
    final image = await _picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 82,
      maxWidth: 1600,
    );
    if (image == null) {
      return null;
    }

    return BiteScorePickedDishImage(
      fileName: image.name,
      bytes: await image.readAsBytes(),
    );
  }

  static Future<BiteScoreUploadedDishImage?> pickAndUploadDishImage({
    required String dishId,
  }) async {
    final pickedImage = await pickDishImage();
    if (pickedImage == null) {
      return null;
    }

    return uploadDishImage(dishId: dishId, pickedImage: pickedImage);
  }

  static Future<BiteScoreUploadedDishImage> uploadDishImage({
    required String dishId,
    required BiteScorePickedDishImage pickedImage,
  }) async {
    final timestamp = DateTime.now().microsecondsSinceEpoch;
    final storagePath =
        'bitescore_dishes/${_safePathSegment(dishId)}/images/$timestamp.jpg';
    final ref = _storage.ref().child(storagePath);

    final uploadSnapshot = await ref.putData(
      pickedImage.bytes,
      SettableMetadata(contentType: _contentTypeFor(pickedImage.fileName)),
    );

    return BiteScoreUploadedDishImage(
      imageUrl: await uploadSnapshot.ref.getDownloadURL(),
      storagePath: storagePath,
    );
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
