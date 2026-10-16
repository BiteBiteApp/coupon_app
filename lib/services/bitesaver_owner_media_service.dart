import 'owner_photo_screening_service.dart';
import 'dart:math';
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'bitesaver_image_upload_service.dart';

typedef OwnerMediaCall =
    Future<Map<String, dynamic>> Function(
      String name,
      Map<String, dynamic> data,
    );

/// Uses the existing owner profile save authority and one bounded removal API.
class BiteSaverOwnerMediaService {
  BiteSaverOwnerMediaService({
    OwnerMediaCall? call,
    String? Function()? currentUid,
  }) : _call = call ?? _firebaseCall,
       _currentUid =
           currentUid ?? (() => FirebaseAuth.instance.currentUser?.uid);
  final OwnerMediaCall _call;
  final String? Function() _currentUid;
  static String newId() => List.generate(
    16,
    (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();
  void requireOwner(String uid) {
    if (_currentUid() != uid) {
      throw StateError(
        'Your signed-in account changed. Reopen restaurant management.',
      );
    }
  }

  Future<Map<String, dynamic>> load(String uid) =>
      save(uid, {'action': 'load'});
  Future<Map<String, dynamic>> save(
    String uid,
    Map<String, dynamic> data,
  ) async {
    requireOwner(uid);
    final result = await _call('saveBiteSaverRestaurantProfile', {
      'intent': 'ownerMediaUpdate',
      ...data,
    });
    requireOwner(uid);
    return result;
  }

  Future<void> remove(String uid, Map<String, dynamic> image) async {
    requireOwner(uid);
    await _call('removeBiteSaverOwnerImage', {
      'imageId': image['id'],
      'registrationVersion': image['registrationVersion'],
    });
    requireOwner(uid);
  }

  Future<Map<String, dynamic>?> upload(
    String uid,
    int version, {
    String targetId = 'gallery',
  }) async {
    requireOwner(uid);
    if (OwnerPhotoScreeningService.isEnabled) {
      return _uploadScreened(uid, version, targetId);
    }
    final preferences = await SharedPreferences.getInstance();
    final receiptKey = 'bitesaver.ownerMedia.pendingUpload.$uid';
    final receipt = preferences.getString(receiptKey);
    if (receipt != null) {
      return _registerPending(
        uid,
        preferences,
        receiptKey,
        Map<String, dynamic>.from(jsonDecode(receipt) as Map),
      );
    }
    final picked = await BiteSaverImageUploadService.pickRestaurantImage(
      isCurrent: () => _currentUid() == uid,
    );
    requireOwner(uid);
    if (picked == null) return null;
    if (picked.bytes.length > 5 * 1024 * 1024) {
      throw const FormatException('Choose a photo smaller than 5 MB.');
    }
    final validated = await BiteSaverImageUploadService.validateRestaurantImage(
      picked,
    );
    requireOwner(uid);
    if (validated == null) {
      throw const FormatException('Choose a valid JPEG or PNG photo.');
    }
    final id = newId();
    Map<String, dynamic>? pending;
    await BiteSaverImageUploadService.uploadRestaurantImage(
      uid: uid,
      validatedImage: validated,
      storageWriter:
          ({required objectPath, required bytes, required contentType}) async {
            requireOwner(uid);
            final extension = contentType == 'image/png' ? 'png' : 'jpg';
            pending = {
              'action': 'register',
              'expectedVersion': version,
              'requestId': newId(),
              'imageId': id,
              'extension': extension,
            };
            if (!await preferences.setString(receiptKey, jsonEncode(pending))) {
              throw StateError(
                'Could not prepare a recoverable upload. Try again.',
              );
            }
            requireOwner(uid);
            final path =
                'bitesaver_restaurants/$uid/restaurant_images/managed_$id.$extension';
            final ref = FirebaseStorage.instance.ref(path);
            await ref.putData(
              bytes,
              SettableMetadata(
                contentType: contentType,
                customMetadata: {'mediaId': id},
              ),
            );
            requireOwner(uid);
            // The server obtains the URL and generation. No client receipt grants deletion authority.
            return BiteSaverImageUploadResult(imageUrl: '', storagePath: path);
          },
    );
    requireOwner(uid);
    return _registerPending(uid, preferences, receiptKey, pending!);
  }

  Future<Map<String, dynamic>?> _uploadScreened(
    String uid,
    int version,
    String targetId,
  ) async {
    final screening = OwnerPhotoScreeningService();
    var checked = await screening.recover(
      uid: uid,
      sourceType: 'biteSaver',
      sourceId: uid,
      family: 'managed',
      targetId: targetId,
    );
    if (checked == null) {
      final picked = await BiteSaverImageUploadService.pickRestaurantImage(
        isCurrent: () => _currentUid() == uid,
      );
      requireOwner(uid);
      if (picked == null) return null;
      final validated =
          await BiteSaverImageUploadService.validateRestaurantImage(picked);
      requireOwner(uid);
      if (validated == null) {
        throw ArgumentError('Choose a valid JPEG or PNG photo.');
      }
      final bytes = validated.pickedImage.bytes;
      checked = await screening.submit(
        uid: uid,
        sourceType: 'biteSaver',
        sourceId: uid,
        family: 'managed',
        targetId: targetId,
        bytes: bytes,
        contentType: bytes[0] == 0x89 ? 'image/png' : 'image/jpeg',
      );
    }
    requireOwner(uid);
    final current = await load(uid);
    final media = current['media'] as Map;
    if ((media['images'] as List).cast<Map>().any(
      (i) => i['id'] == checked!['imageId'],
    )) {
      await screening.acknowledge(checked['imageId'], uid);
      return {...current, 'registeredImageId': checked['imageId']};
    }
    final result = await save(uid, {
      'action': 'register',
      'expectedVersion': media['version'],
      'requestId': newId(),
      'imageId': checked['imageId'],
      'extension': 'jpg',
    });
    await screening.acknowledge(checked['imageId'], uid);
    return {...result, 'registeredImageId': checked['imageId']};
  }

  Future<Map<String, dynamic>> _registerPending(
    String uid,
    SharedPreferences preferences,
    String receiptKey,
    Map<String, dynamic> receipt,
  ) async {
    requireOwner(uid);
    // Recover an acknowledged or uncertain upload without creating another file.
    final current = await load(uid);
    final media = current['media'] as Map;
    final existing = (media['images'] as List)
        .cast<Map>()
        .where((image) => image['id'] == receipt['imageId'])
        .firstOrNull;
    if (existing != null) {
      if (existing['state'] != 'ready') {
        throw StateError(
          'This photo is being removed. Finish its removal before uploading again.',
        );
      }
      await preferences.remove(receiptKey);
      return {...current, 'registeredImageId': receipt['imageId']};
    }
    final request = {...receipt, 'expectedVersion': media['version']};
    await preferences.setString(receiptKey, jsonEncode(request));
    try {
      final result = await save(uid, request);
      await preferences.remove(receiptKey);
      return {...result, 'registeredImageId': receipt['imageId']};
    } on FirebaseFunctionsException catch (error) {
      if (error.code == 'not-found') {
        // The server confirmed that no upload exists at the derived owner path.
        await preferences.remove(receiptKey);
        throw ArgumentError(
          'The photo upload did not finish. Choose the photo again.',
        );
      }
      rethrow;
    }
  }

  static Future<Map<String, dynamic>> _firebaseCall(
    String name,
    Map<String, dynamic> data,
  ) async {
    final response = await FirebaseFunctions.instanceFor(
      region: 'us-central1',
    ).httpsCallable(name).call(data);
    return Map<String, dynamic>.from(response.data as Map);
  }
}
