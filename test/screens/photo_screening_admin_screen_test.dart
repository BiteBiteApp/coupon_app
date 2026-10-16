import 'dart:async';
import 'package:coupon_app/screens/photo_screening_admin_screen.dart';
import 'package:coupon_app/services/photo_screening_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const item = {
  'imageId': 'exact-image',
  'generation': '9007199254740993',
  'dishName': 'Soup',
  'restaurantName': 'Cafe',
  'state': 'needs_review',
  'scanStatus': 'completed',
};

void main() {
  for (final decision in ['approved', 'rejected']) {
    testWidgets(
      'Admin $decision applies only to the inspected generation at large text',
      (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final decisions = <Map<String, Object?>>[];
        final service = PhotoScreeningService(
          currentUserId: () => 'admin',
          transport: (name, data) async {
            if (name == 'listAdminScreeningPhotos') {
              return {
                'schemaVersion': 1,
                'items': decisions.isEmpty ? [item] : [],
                'nextCursor': null,
              };
            }
            expect(data['imageId'], item['imageId']);
            expect(data['generation'], item['generation']);
            if (name == 'previewAdminScreeningPhoto') {
              return {'schemaVersion': 1, 'bytesBase64': png};
            }
            expect(name, 'decideAdminScreeningPhoto');
            decisions.add(data);
            return {'schemaVersion': 1, 'state': decision};
          },
        );
        await tester.pumpWidget(
          MaterialApp(
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(1.7)),
              child: child!,
            ),
            home: PhotoScreeningAdminScreen(
              service: service,
              expectedUid: 'admin',
            ),
          ),
        );
        await tester.pumpAndSettle();
        await openPreview(tester);
        expect(find.byType(Image), findsOneWidget);
        expect(decisions, isEmpty);
        await tester.runAsync(() async {
          await tester.tap(
            find.text(decision == 'approved' ? 'Approve' : 'Reject'),
          );
          await Future<void>.delayed(const Duration(milliseconds: 20));
        });
        await tester.pumpAndSettle();
        expect(decisions.single['decision'], decision);
        expect(find.text('No photographs awaiting review.'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }

  testWidgets('undecodable preview cannot be approved but can be rejected', (
    tester,
  ) async {
    var rejected = false;
    final service = PhotoScreeningService(
      currentUserId: () => 'admin',
      transport: (name, data) async {
        if (name == 'listAdminScreeningPhotos') {
          return {
            'schemaVersion': 1,
            'items': rejected ? [] : [item],
            'nextCursor': null,
          };
        }
        if (name == 'previewAdminScreeningPhoto') {
          return {'schemaVersion': 1, 'bytesBase64': 'YWJj'};
        }
        expect(data['decision'], 'rejected');
        rejected = true;
        return {'schemaVersion': 1};
      },
    );
    await tester.pumpWidget(
      MaterialApp(
        home: PhotoScreeningAdminScreen(service: service, expectedUid: 'admin'),
      ),
    );
    await tester.pumpAndSettle();
    await openPreview(tester);
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Approve'))
          .onPressed,
      isNull,
    );
    await tester.runAsync(() async {
      await tester.tap(find.text('Reject'));
      await Future<void>.delayed(const Duration(milliseconds: 20));
    });
    await tester.pumpAndSettle();
    expect(rejected, isTrue);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'account change during preview discards private response and cannot decide',
    (tester) async {
      var uid = 'admin';
      var decisions = 0;
      final pending = Completer<Object?>();
      final service = PhotoScreeningService(
        currentUserId: () => uid,
        transport: (name, data) async {
          if (name == 'listAdminScreeningPhotos') {
            return {
              'schemaVersion': 1,
              'items': [item],
              'nextCursor': null,
            };
          }
          if (name == 'previewAdminScreeningPhoto') return pending.future;
          decisions++;
          return {'schemaVersion': 1};
        },
      );
      await tester.pumpWidget(
        MaterialApp(
          home: PhotoScreeningAdminScreen(
            service: service,
            expectedUid: 'admin',
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Inspect'));
      await tester.pump();
      uid = 'other';
      pending.complete({'schemaVersion': 1, 'bytesBase64': png});
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(decisions, 0);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}

Future<void> openPreview(WidgetTester tester) async {
  await tester.runAsync(() async {
    await tester.tap(find.text('Inspect'));
    // Image decoding runs outside the fake widget clock.
    for (
      var i = 0;
      i < 25 && find.byType(AlertDialog).evaluate().isEmpty;
      i++
    ) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
      await tester.pump();
    }
  });
  await tester.pump(const Duration(milliseconds: 300));
  expect(find.byType(AlertDialog), findsOneWidget);
}
