import 'dart:typed_data';
import 'dart:convert';
import 'package:crypto/crypto.dart';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:image_picker/image_picker.dart';

import 'firestore_document_id.dart';

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
    required String expectedUid,
  }) async {
    final pickedImage = await pickDishImage();
    if (pickedImage == null) {
      return null;
    }

    return uploadDishImage(
      dishId: dishId,
      expectedUid: expectedUid,
      pickedImage: pickedImage,
    );
  }

  static Future<BiteScoreUploadedDishImage> uploadDishImage({
    required String dishId,
    required String expectedUid,
    required BiteScorePickedDishImage pickedImage,
  }) async {
    void requireActor() {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null || user.uid != expectedUid || user.isAnonymous) {
        throw StateError('The signed-in account changed.');
      }
    }

    requireActor();
    final timestamp = DateTime.now().microsecondsSinceEpoch;
    final storagePath = dishImageStoragePath(
      dishId: dishId,
      expectedUid: expectedUid,
      timestamp: timestamp,
    );
    final ref = _storage.ref().child(storagePath);

    final uploadSnapshot = await ref.putData(
      pickedImage.bytes,
      SettableMetadata(
        contentType: _contentTypeFor(pickedImage.fileName),
        customMetadata: {
          'ownershipVersion': '1',
          'uploaderKey': dishImageOwnerKey(expectedUid),
          'dishId': dishId,
        },
      ),
    );

    final imageUrl = await uploadSnapshot.ref.getDownloadURL();
    requireActor();
    return BiteScoreUploadedDishImage(
      imageUrl: imageUrl,
      storagePath: storagePath,
    );
  }

  @visibleForTesting
  static String dishImageStoragePath({
    required String dishId,
    required String expectedUid,
    required int timestamp,
  }) {
    final exactDish = exactFirestoreDocumentId(dishId);
    final exactUid = exactFirestoreDocumentId(expectedUid);
    if (exactDish == null || exactUid == null) {
      throw ArgumentError('Invalid uploader or dish identity.');
    }
    return 'bitescore_user_uploads/${dishImageOwnerKey(exactUid)}/dish_images/$exactDish/$timestamp.jpg';
  }

  @visibleForTesting
  static String dishImageOwnerKey(String uid) =>
      sha256.convert(utf8.encode('bitestar.dish-upload.v1:$uid')).toString();

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
