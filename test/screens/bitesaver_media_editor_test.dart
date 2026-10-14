import 'dart:convert';
import 'package:coupon_app/screens/bitesaver_media_editor_screen.dart';
import 'package:coupon_app/services/bitesaver_owner_media_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> clone(Map<String, dynamic> value) =>
    Map<String, dynamic>.from(jsonDecode(jsonEncode(value)) as Map);

class Backend {
  var data = <String, dynamic>{
    'schemaVersion': 1,
    'contentFingerprint': 'initial',
    'media': {
      'version': 0,
      'images': [],
      'gallery': [],
      'legacyMain': null,
      'mode': 'manual',
      'boardImage': null,
      'specialImages': {},
    },
    'specials': [],
  };
  final saves = <Map<String, dynamic>>[];
  final removals = <Map<String, dynamic>>[];
  bool fail = false;
  String? uid = 'owner';
  late final service = BiteSaverOwnerMediaService(
    currentUid: () => uid,
    call: (name, payload) async {
      if (name == 'removeBiteSaverOwnerImage') {
        removals.add(payload);
        return {'removed': true};
      }
      if (payload['action'] == 'load') return clone(data);
      saves.add(clone(payload));
      if (fail) throw Exception('save unavailable');
      final media = data['media'] as Map;
      media['version'] = (media['version'] as int) + 1;
      media['gallery'] = payload['gallery'];
      media['mode'] = payload['mode'];
      media['boardImage'] = payload['boardImage'];
      data['specials'] = payload['specials'];
      return clone(data);
    },
  );
  Future<Map<String, dynamic>?> upload(String uid, int version) async {
    final media = data['media'] as Map;
    final id = 'photo${(media['images'] as List).length}';
    (media['images'] as List).add({
      'id': id,
      'url': 'https://example.test/$id.png',
      'registrationVersion': version + 1,
      'state': 'ready',
    });
    media['version'] = version + 1;
    return clone(data);
  }
}

Future<void> tap(WidgetTester tester, String label) async {
  final finder = find.text(label).last;
  if (find.text(label).evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      find.text(label),
      300,
      scrollable: find.byType(Scrollable).first,
      maxScrolls: 40,
    );
  }
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> pump(
  WidgetTester tester,
  Backend backend, {
  bool photos = false,
  double scale = 1,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: BiteSaverMediaEditorScreen(
        ownerUid: 'owner',
        photos: photos,
        service: backend.service,
        upload: backend.upload,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'manual text-only multiple specials have no image holders and save together',
    (tester) async {
      final backend = Backend();
      await pump(tester, backend);
      await tap(tester, 'Add Another Daily Special');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Title').first,
        'Lunch',
      );
      await tap(tester, 'Add Another Daily Special');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Title').last,
        'Dinner',
      );
      expect(find.byType(Image), findsNothing);
      await tap(tester, 'Save Changes');
      expect(backend.saves.single['specials'], hasLength(2));
      expect(
        (backend.saves.single['specials'] as List).map((s) => s['title']),
        ['Lunch', 'Dinner'],
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('photo add, main selection and remove stay local until save', (
    tester,
  ) async {
    final backend = Backend();
    await pump(tester, backend, photos: true);
    await tap(tester, 'Add Restaurant Photo');
    await tap(tester, 'Add Restaurant Photo');
    await tap(tester, 'Make Main');
    await tap(tester, 'Remove');
    expect(backend.saves, isEmpty);
    expect(backend.removals, isEmpty);
    await tap(tester, 'Save Changes');
    expect(backend.saves.single['gallery'], ['photo1']);
    expect(backend.saves.single['section'], 'photos');
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'photo-board draft is exclusive; switching back preserves it until confirmed save',
    (tester) async {
      final backend = Backend();
      await pump(tester, backend);
      await tap(tester, 'Manual Daily Specials');
      await tap(tester, 'Photographed Daily Specials board');
      await tap(tester, 'Upload Board Photo');
      expect(find.text('Add Another Daily Special'), findsNothing);
      expect(backend.saves, isEmpty);
      await tap(tester, 'Save Changes');
      expect(find.text('Change published board?'), findsOneWidget);
      await tap(tester, 'Continue');
      expect(backend.saves.single['mode'], 'photo');
      expect(backend.saves.single['boardImage'], 'photo0');
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('uncertain save retries identical payload and preserves draft', (
    tester,
  ) async {
    final backend = Backend()..fail = true;
    await pump(tester, backend);
    await tap(tester, 'Add Another Daily Special');
    await tester.enterText(find.widgetWithText(TextFormField, 'Title'), 'Soup');
    await tap(tester, 'Save Changes');
    expect(find.text('Soup'), findsOneWidget);
    backend.fail = false;
    await tap(tester, 'Retry Save');
    expect(backend.saves, hasLength(2));
    expect(backend.saves[0], backend.saves[1]);
    expect(tester.takeException(), isNull);
  });
  testWidgets('cancel does not save or delete published content', (
    tester,
  ) async {
    final backend = Backend();
    await pump(tester, backend);
    await tap(tester, 'Add Another Daily Special');
    await tap(tester, 'Cancel');
    expect(find.text('Discard this draft?'), findsOneWidget);
    await tap(tester, 'Cancel');
    expect(backend.saves, isEmpty);
    expect(backend.removals, isEmpty);
    expect(find.widgetWithText(TextFormField, 'Title'), findsOneWidget);
  });
  testWidgets('narrow large text authoring remains usable', (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final backend = Backend();
    await pump(tester, backend, scale: 2);
    await tap(tester, 'Add Another Daily Special');
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Title'),
      'Lunch',
    );
    await tap(tester, 'Save Changes');
    expect(backend.saves, hasLength(1));
    expect(tester.takeException(), isNull);
  });
  test('owner switch prevents all backend work', () async {
    final backend = Backend()..uid = 'other';
    await expectLater(backend.service.load('owner'), throwsStateError);
    await expectLater(
      backend.service.remove('owner', {'id': 'x', 'registrationVersion': 1}),
      throwsStateError,
    );
    expect(backend.saves, isEmpty);
    expect(backend.removals, isEmpty);
  });
  testWidgets(
    'invalid draft can be corrected without losing text or entering retry state',
    (tester) async {
      final backend = Backend();
      await pump(tester, backend);
      await tap(tester, 'Add Another Daily Special');
      await tap(tester, 'Save Changes');
      expect(backend.saves, isEmpty);
      await tester.ensureVisible(find.widgetWithText(TextFormField, 'Title'));
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Title'),
        'Corrected soup',
      );
      await tap(tester, 'Save Changes');
      expect(
        (backend.saves.single['specials'] as List).single['title'],
        'Corrected soup',
      );
    },
  );
  testWidgets(
    'optional photo replacement and removal do not delete saved files before publish',
    (tester) async {
      final backend = Backend();
      await pump(tester, backend);
      await tap(tester, 'Add Another Daily Special');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Title'),
        'Soup',
      );
      await tap(tester, 'Add Optional Photo');
      await tap(tester, 'Replace Photo');
      await tap(tester, 'Remove Photo');
      expect(backend.removals, isEmpty);
      await tap(tester, 'Save Changes');
      expect(
        (backend.saves.single['specials'] as List).single['imageId'],
        isNull,
      );
      expect(
        (backend.saves.single['specials'] as List).single['removeLegacyImage'],
        true,
      );
    },
  );
  testWidgets(
    'removing a draft special requires confirmation and only changes the published save',
    (tester) async {
      final backend = Backend();
      await pump(tester, backend);
      await tap(tester, 'Add Another Daily Special');
      await tap(tester, 'Remove Special');
      await tap(tester, 'Continue');
      expect(backend.saves, isEmpty);
      await tap(tester, 'Save Changes');
      expect(backend.saves.single['specials'], isEmpty);
    },
  );
}
