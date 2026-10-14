import 'dart:convert';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:coupon_app/services/bitesaver_owner_media_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const key = 'bitesaver.ownerMedia.pendingUpload.owner';
  final receipt = {
    'action': 'register',
    'expectedVersion': 1,
    'requestId': 'same-request',
    'imageId': 'a' * 32,
    'extension': 'png',
  };
  setUp(
    () => SharedPreferences.setMockInitialValues({key: jsonEncode(receipt)}),
  );
  test(
    'interrupted registration retries same object, refreshed version, no new upload',
    () async {
      var fail = true;
      final calls = <Map<String, dynamic>>[];
      final service = BiteSaverOwnerMediaService(
        currentUid: () => 'owner',
        call: (_, data) async {
          if (data['action'] == 'load') {
            return {
              'media': {'version': 7, 'images': []},
            };
          }
          calls.add(data);
          if (fail) {
            throw FirebaseFunctionsException(
              code: 'unavailable',
              message: 'Local unavailable',
            );
          }
          return {
            'media': {
              'version': 8,
              'images': [
                {'id': receipt['imageId'], 'state': 'ready'},
              ],
            },
          };
        },
      );
      await expectLater(
        service.upload('owner', 1),
        throwsA(isA<FirebaseFunctionsException>()),
      );
      expect((await SharedPreferences.getInstance()).getString(key), isNotNull);
      fail = false;
      final result = await service.upload('owner', 1);
      expect(calls.length, 2);
      expect(calls.first, calls.last);
      expect(calls.last['expectedVersion'], 7);
      expect(result!['registeredImageId'], receipt['imageId']);
      expect((await SharedPreferences.getInstance()).getString(key), isNull);
    },
  );
  test(
    'lost acknowledgement recovers existing registration without publishing or registering again',
    () async {
      var calls = 0;
      final service = BiteSaverOwnerMediaService(
        currentUid: () => 'owner',
        call: (_, data) async {
          calls++;
          expect(data['action'], 'load');
          return {
            'media': {
              'version': 9,
              'images': [
                {'id': receipt['imageId'], 'state': 'ready'},
              ],
            },
          };
        },
      );
      expect(
        (await service.upload('owner', 9))!['registeredImageId'],
        receipt['imageId'],
      );
      expect(calls, 1);
      expect((await SharedPreferences.getInstance()).getString(key), isNull);
    },
  );
  test(
    'confirmed missing upload releases receipt without deleting any file',
    () async {
      final service = BiteSaverOwnerMediaService(
        currentUid: () => 'owner',
        call: (_, data) async {
          if (data['action'] == 'load') {
            return {
              'media': {'version': 0, 'images': []},
            };
          }
          throw FirebaseFunctionsException(
            code: 'not-found',
            message: 'Local missing',
          );
        },
      );
      await expectLater(service.upload('owner', 0), throwsArgumentError);
      expect((await SharedPreferences.getInstance()).getString(key), isNull);
    },
  );
  test(
    'owner switch during load never registers or returns prior owner data',
    () async {
      String? current = 'owner';
      var calls = 0;
      final service = BiteSaverOwnerMediaService(
        currentUid: () => current,
        call: (_, data) async {
          calls++;
          current = 'other';
          return {
            'media': {'version': 0, 'images': []},
          };
        },
      );
      await expectLater(service.upload('owner', 0), throwsStateError);
      expect(calls, 1);
      expect((await SharedPreferences.getInstance()).getString(key), isNotNull);
    },
  );
}
