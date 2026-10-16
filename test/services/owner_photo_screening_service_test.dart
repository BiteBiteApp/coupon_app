import 'dart:async';
import 'dart:typed_data';
import 'package:coupon_app/services/owner_photo_screening_service.dart';
import 'package:coupon_app/services/photo_screening_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final id = 'bso_${'a' * 64}';
  final path =
      'bitescore_user_uploads/${'b' * 64}/owner_images/screened_$id.jpg';
  final url =
      'https://firebasestorage.googleapis.com/v0/b/demo/o/${Uri.encodeComponent(path)}?alt=media';
  String uid = 'owner';
  String state = 'needs_review';
  String family = 'coupon';
  String target = 'draft';
  final calls = <String>[];
  late OwnerPhotoScreeningService service;
  Map<String, Object?> response() => {
    'schemaVersion': 1,
    'imageId': id,
    'state': state,
    'sourceType': 'biteSaver',
    'sourceId': 'owner',
    'family': family,
    'targetId': target,
    if (state == 'available') ...{'imageUrl': url, 'storagePath': path},
  };
  Future<Map> submit() => service.submit(
    uid: 'owner',
    sourceType: 'biteSaver',
    sourceId: 'owner',
    family: family,
    targetId: target,
    bytes: Uint8List.fromList([255, 216, 255]),
    contentType: 'image/jpeg',
  );
  Future<Map?> recover() => service.recover(
    uid: 'owner',
    sourceType: 'biteSaver',
    sourceId: 'owner',
    family: family,
    targetId: target,
  );
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    uid = 'owner';
    state = 'needs_review';
    family = 'coupon';
    target = 'draft';
    calls.clear();
    service = OwnerPhotoScreeningService(
      currentUserId: () => uid,
      transport: PhotoScreeningService(
        currentUserId: () => uid,
        transport: (name, data) async {
          calls.add(name);
          expect(data['expectedUserId'], 'owner');
          expect(data.containsKey('storagePath'), false);
          expect(data.containsKey('imageUrl'), false);
          return name == 'useOwnerScreenedPhoto'
              ? {'schemaVersion': 1, 'state': 'published'}
              : response();
        },
      ),
    );
  });
  test(
    'flag remains off; each exact family/target has a recoverable private receipt',
    () async {
      expect(OwnerPhotoScreeningService.enabled, false);
      for (final entry in [
        ('main', 'owner'),
        ('managed', 'gallery'),
        ('managed', 'board'),
        ('managed', 'special'),
        ('coupon', 'draft'),
        ('menu', 'page'),
      ]) {
        family = entry.$1;
        target = entry.$2;
        await expectLater(submit(), throwsA(isA<OwnerPhotoCheckOutcome>()));
        expect(
          (await SharedPreferences.getInstance()).getKeys().length,
          calls.where((c) => c.startsWith('submit')).length,
        );
      }
    },
  );
  test(
    'held status reads never submit again; approved receipt survives until successful attachment',
    () async {
      await expectLater(submit(), throwsA(isA<OwnerPhotoCheckOutcome>()));
      await expectLater(recover(), throwsA(isA<OwnerPhotoCheckOutcome>()));
      state = 'available';
      expect((await recover())!['imageUrl'], url);
      expect((await recover())!['imageId'], id);
      expect(calls.where((c) => c.startsWith('submit')).length, 1);
      expect((await SharedPreferences.getInstance()).getKeys(), isNotEmpty);
      await service.use(url, expectedUid: 'owner');
      expect(await recover(), null);
    },
  );
  test(
    'explicit replacement releases only the selected approved receipt; cancellation can keep its existing URL',
    () async {
      state = 'available';
      final selected = await submit();
      await service.acknowledge(selected['imageId'], 'owner');
      expect(await recover(), null);
      expect(selected['imageUrl'], url);
      expect(calls, ['submitScreenedOwnerPhoto']);
    },
  );
  test(
    'account switch prevents publication and preserves pending receipt',
    () async {
      state = 'available';
      await submit();
      uid = 'other';
      await expectLater(
        service.use(url, expectedUid: 'owner'),
        throwsStateError,
      );
      expect(calls, ['submitScreenedOwnerPhoto']);
      uid = 'owner';
      expect(await recover(), isNotNull);
    },
  );
  test(
    'held selection can be explicitly discarded without touching business text',
    () async {
      OwnerPhotoCheckOutcome? outcome;
      try {
        await submit();
      } on OwnerPhotoCheckOutcome catch (error) {
        outcome = error;
      }
      expect(outcome!.message, contains('text can still be saved'));
      await outcome.discard();
      expect(await recover(), null);
      expect(calls, ['submitScreenedOwnerPhoto', 'useOwnerScreenedPhoto']);
    },
  );
  test(
    'failed upload requires explicit reselection; status does not spend an attempt',
    () async {
      state = 'failed';
      await expectLater(submit(), throwsA(isA<OwnerPhotoCheckOutcome>()));
      expect(await recover(), null);
      expect(calls, ['submitScreenedOwnerPhoto', 'getOwnerScreenedPhoto']);
    },
  );
  test(
    'late response after account change and wrong target never install a photo',
    () async {
      final pending = Completer<Object?>();
      service = OwnerPhotoScreeningService(
        currentUserId: () => uid,
        transport: PhotoScreeningService(
          currentUserId: () => uid,
          transport: (_, _) => pending.future,
        ),
      );
      final operation = submit();
      uid = 'other';
      state = 'available';
      pending.complete(response());
      await expectLater(operation, throwsStateError);
      expect((await SharedPreferences.getInstance()).getKeys(), isEmpty);
      uid = 'owner';
      service = OwnerPhotoScreeningService(
        currentUserId: () => uid,
        transport: PhotoScreeningService(
          currentUserId: () => uid,
          transport: (_, _) async => {...response(), 'targetId': 'different'},
        ),
      );
      await expectLater(submit(), throwsFormatException);
    },
  );
  test(
    'acknowledged menu attachment clears its exact recoverable target',
    () async {
      family = 'menu';
      target = 'page';
      state = 'available';
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'owner.menu.photo.target.owner.biteSaver.owner',
        'page',
      );
      await submit();
      await service.use(url);
      expect(
        prefs.getString('owner.menu.photo.target.owner.biteSaver.owner'),
        null,
      );
    },
  );
}
