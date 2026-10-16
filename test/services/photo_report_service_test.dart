import 'dart:async';
import 'package:coupon_app/models/bitescore_dish_image.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:coupon_app/services/photo_report_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'reviewer_safety_service_test.dart' show SafetyUser;

BiteScoreDishImage photo({String id = 'photo', String? version}) =>
    BiteScoreDishImage(
      id: id,
      dishId: 'dish',
      restaurantId: 'restaurant',
      reviewId: 'review',
      uploadedByUserId: '',
      imageUrl: 'https://example.test/$id.jpg',
      storagePath: '',
      reportTargetVersion: version ?? 'a' * 64,
    );
void main() {
  setUp(() {
    CustomerBiteScoreRuntime.testEnabled = true;
    PhotoReportingUi.testEnabled = true;
  });
  tearDown(() {
    CustomerBiteScoreRuntime.testEnabled = null;
    PhotoReportingUi.testEnabled = null;
  });
  Future<bool> submit(
    PhotoReportService service, {
    BiteScoreDishImage? image,
    bool Function()? lease,
  }) => service.submit(
    image: image ?? photo(),
    reason: 'Other',
    requestId: 'local_request_123456789',
    expectedUserId: 'A',
    leaseIsCurrent: lease ?? () => true,
  );
  test(
    'separate default-off gate and bounded prerequisite; no ordinary activation',
    () async {
      var calls = 0;
      final service = PhotoReportService(
        currentUser: () => SafetyUser('A'),
        boundary: (_, _) async {
          calls++;
          return null;
        },
      );
      PhotoReportingUi.testEnabled = null;
      await expectLater(submit(service), throwsStateError);
      PhotoReportingUi.testEnabled = true;
      CustomerBiteScoreRuntime.testEnabled = false;
      await expectLater(submit(service), throwsStateError);
      expect(calls, 0);
    },
  );
  test(
    'exact source ID/version and authenticated expected user; unverified user can report',
    () async {
      final service = PhotoReportService(
        currentUser: () => SafetyUser('A'),
        boundary: (name, data) async {
          expect(name, 'submitPhotoReport');
          expect(data, {
            'schemaVersion': 1,
            'expectedUserId': 'A',
            'imageId': 'photo',
            'dishId': 'dish',
            'restaurantId': 'restaurant',
            'reason': 'Other',
            'requestId': 'local_request_123456789',
            'reportTargetVersion': 'a' * 64,
          });
          return {
            'schemaVersion': 1,
            'imageId': 'photo',
            'reportId': 'case',
            'submitted': true,
          };
        },
      );
      expect(await submit(service), isTrue);
    },
  );
  test('guest and stale account/lease cannot submit', () async {
    var calls = 0;
    for (final user in [
      null,
      SafetyUser('A', isAnonymous: true),
      SafetyUser('B'),
    ]) {
      final service = PhotoReportService(
        currentUser: () => user,
        boundary: (_, _) async {
          calls++;
          return null;
        },
      );
      await expectLater(submit(service), throwsStateError);
    }
    await expectLater(
      submit(
        PhotoReportService(currentUser: () => SafetyUser('A')),
        lease: () => false,
      ),
      throwsStateError,
    );
    expect(calls, 0);
  });
  test(
    'account switching or stale lease rejects an outstanding successful response',
    () async {
      var user = SafetyUser('A');
      final response = Completer<Object?>();
      final service = PhotoReportService(
        currentUser: () => user,
        boundary: (_, _) => response.future,
      );
      final future = submit(service);
      user = SafetyUser('B');
      response.complete({
        'schemaVersion': 1,
        'imageId': 'photo',
        'reportId': 'case',
        'submitted': true,
      });
      await expectLater(future, throwsStateError);
    },
  );
  test(
    'duplicates return false; bad response identity rejected; failures are not automatically retried',
    () async {
      var calls = 0;
      final service = PhotoReportService(
        currentUser: () => SafetyUser('A'),
        boundary: (_, _) async {
          calls++;
          return {
            'schemaVersion': 1,
            'imageId': calls == 1 ? 'photo' : 'wrong',
            'reportId': 'case',
            'submitted': false,
          };
        },
      );
      expect(await submit(service), isFalse);
      await expectLater(submit(service), throwsFormatException);
      expect(calls, 2);
    },
  );
  test(
    'raw photo model uses document identity and excludes moderated sources',
    () {
      final data = <String, dynamic>{
        'id': 'forged',
        'dishId': 'dish',
        'restaurantId': 'restaurant',
        'uploadedByUserId': 'uploader',
        'imageUrl': 'https://example.test/photo.jpg',
        'storagePath': 'owned/photo.jpg',
      };
      expect(
        BiteScoreDishImage.tryFromFirestore(data, fallbackId: 'actual')!.id,
        'actual',
      );
      expect(
        BiteScoreDishImage.tryFromFirestore({
          ...data,
          'moderationStatus': 'removed',
        }, fallbackId: 'actual'),
        isNull,
      );
    },
  );
  test(
    'moderation pins case/photo/action and account across the trusted call',
    () async {
      final service = PhotoReportService(
        currentUser: () => SafetyUser('admin'),
        boundary: (name, data) async {
          expect(name, 'moderatePhotoReport');
          expect(data, {
            'schemaVersion': 1,
            'expectedUserId': 'admin',
            'reportId': 'case',
            'imageId': 'photo',
            'action': 'remove',
          });
          return {
            'schemaVersion': 1,
            'reportId': 'case',
            'imageId': 'photo',
            'status': 'resolved',
          };
        },
      );
      await service.moderate(
        reportId: 'case',
        imageId: 'photo',
        action: 'remove',
      );
    },
  );
}
