import 'dart:async';
import 'dart:typed_data';
import 'package:coupon_app/services/bitescore_image_upload_service.dart';
import 'package:coupon_app/services/photo_screening_service.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:flutter_test/flutter_test.dart';

final picked = BiteScorePickedDishImage(
  fileName: 'food.jpg',
  bytes: Uint8List.fromList([255, 216, 255, 217]),
);
Map<String, Object?> result(String state) => {
  'schemaVersion': 1,
  'imageId': 'image',
  'state': state,
  if (state == 'approved')
    'image': {
      'id': 'image',
      'dishId': 'dish',
      'restaurantId': 'restaurant',
      'reviewId': null,
      'imageUrl': 'https://example.test/approved.jpg',
      'reportTargetVersion': 'a' * 64,
      'helpfulCount': 0,
      'notHelpfulCount': 0,
    },
};
void main() {
  tearDown(() {
    PhotoScreeningService.debugEnabled = null;
    CustomerBiteScoreRuntime.testEnabled = null;
  });
  test('screening remains dormant and requires existing bounded runtime', () {
    expect(PhotoScreeningService.enabled, false);
    PhotoScreeningService.debugEnabled = true;
    CustomerBiteScoreRuntime.testEnabled = false;
    expect(PhotoScreeningService.isEnabled, false);
    CustomerBiteScoreRuntime.testEnabled = true;
    expect(PhotoScreeningService.isEnabled, true);
  });
  test(
    'manual submission sends only bytes and exact actor/context; no download URL',
    () async {
      final service = PhotoScreeningService(
        currentUserId: () => 'user',
        transport: (name, data) async {
          expect(name, 'submitScreenedBiteScorePhoto');
          expect(data, {
            'schemaVersion': 1,
            'expectedUserId': 'user',
            'dishId': 'dish',
            'restaurantId': 'restaurant',
            'reviewId': null,
            'mode': 'gallery',
            'contentType': 'image/jpeg',
            'bytesBase64': '/9j/2Q==',
            'retry': true,
          });
          return result('approved');
        },
      );
      final image = await service.submit(
        expectedUid: 'user',
        dishId: 'dish',
        restaurantId: 'restaurant',
        mode: 'gallery',
        pickedImage: picked,
      );
      expect(image.id, 'image');
      expect(image.storagePath, '');
    },
  );
  for (final state in [
    'needs_review',
    'failed',
    'scanning',
    'rejected',
    'removed',
    'expired',
    'upload_failed',
  ]) {
    test(
      '$state never becomes a public image or publication success',
      () async {
        var calls = 0;
        final service = PhotoScreeningService(
          currentUserId: () => 'user',
          transport: (_, _) async {
            calls++;
            return result(state);
          },
        );
        await expectLater(
          service.submit(
            expectedUid: 'user',
            dishId: 'dish',
            restaurantId: 'restaurant',
            mode: 'gallery',
            pickedImage: picked,
          ),
          throwsA(
            isA<PhotoScreeningOutcome>().having((e) => e.state, 'state', state),
          ),
        );
        expect(calls, 1);
      },
    );
  }
  test(
    'account switch before send or before response suppresses stale result',
    () async {
      String? uid = 'other';
      var calls = 0;
      final pending = Completer<Object?>();
      final service = PhotoScreeningService(
        currentUserId: () => uid,
        transport: (_, _) {
          calls++;
          return pending.future;
        },
      );
      Future<void> submit() async {
        await service.submit(
          expectedUid: 'user',
          dishId: 'dish',
          restaurantId: 'restaurant',
          mode: 'gallery',
          pickedImage: picked,
        );
      }

      await expectLater(submit(), throwsStateError);
      expect(calls, 0);
      uid = 'user';
      final future = submit();
      uid = 'other';
      pending.complete(result('approved'));
      await expectLater(future, throwsStateError);
      expect(calls, 1);
    },
  );
  test(
    'forged/malformed publication response fails before caller receives image',
    () async {
      for (final response in [
        {'schemaVersion': 1, 'state': 'passed', 'imageId': 'image'},
        {...result('approved'), 'imageId': 'other'},
        {...result('approved'), 'image': null},
      ]) {
        final service = PhotoScreeningService(
          currentUserId: () => 'user',
          transport: (_, _) async => response,
        );
        await expectLater(
          service.submit(
            expectedUid: 'user',
            dishId: 'dish',
            restaurantId: 'restaurant',
            mode: 'gallery',
            pickedImage: picked,
          ),
          throwsFormatException,
        );
      }
    },
  );
  test('oversized images do not invoke transport', () async {
    final service = PhotoScreeningService(
      currentUserId: () => 'user',
      transport: (_, _) async => throw StateError('must not send'),
    );
    await expectLater(
      service.submit(
        expectedUid: 'user',
        dishId: 'dish',
        restaurantId: 'restaurant',
        mode: 'gallery',
        pickedImage: BiteScorePickedDishImage(
          fileName: 'food.jpg',
          bytes: Uint8List(5 * 1024 * 1024 + 1),
        ),
      ),
      throwsArgumentError,
    );
  });
}
