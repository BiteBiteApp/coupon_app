import 'package:cloud_functions/cloud_functions.dart';
import 'package:coupon_app/services/posting_restriction_service.dart';
import 'package:coupon_app/widgets/posting_restriction_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../services/posting_restriction_service_test.dart' show status;
import '../services/reviewer_safety_service_test.dart' show SafetyUser;

void main() {
  for (final option in {
    'Restrict 7 days': '7d',
    'Restrict 14 days': '14d',
    'Restrict indefinitely': 'indefinite',
    'Release restriction': 'release',
  }.entries) {
    testWidgets(
      '${option.key} requires confirmation and sends exact contributor',
      (tester) async {
        var writes = 0;
        final service = PostingRestrictionService(
          currentUser: () => SafetyUser('admin'),
          boundary: (name, data) async {
            if (name == 'getAdminPostingRestriction') return status();
            expect(data['targetUserId'], 'author');
            expect(data['expectedRevision'], 1);
            expect(data['action'], option.value);
            writes++;
            return status(
              state: option.value == 'release' ? 'released' : 'active',
              kind: option.value == 'release' ? '7d' : option.value,
              revision: 2,
            );
          },
        );
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: PostingRestrictionDialog(
                reportId: 'case',
                service: service,
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text(option.key));
        await tester.tap(find.text(option.key));
        await tester.pumpAndSettle();
        expect(writes, 0);
        expect(find.textContaining('UID author?'), findsOneWidget);
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(writes, 0);
        await tester.tap(find.text(option.key));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Confirm'));
        await tester.pumpAndSettle();
        expect(writes, 1);
        expect(find.byKey(const Key('posting-status')), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets('narrow screen and large text keep controls scrollable', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final service = PostingRestrictionService(
      currentUser: () => SafetyUser('admin'),
      boundary: (_, _) async => status(),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(2)),
          child: Scaffold(
            body: PostingRestrictionDialog(reportId: 'case', service: service),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Release restriction'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Release restriction'));
    await tester.pumpAndSettle();
    expect(find.text('Confirm'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('conflict clears stale actions until status refreshed', (
    tester,
  ) async {
    final service = PostingRestrictionService(
      currentUser: () => SafetyUser('admin'),
      boundary: (name, _) async {
        if (name == 'getAdminPostingRestriction') return status();
        throw FirebaseFunctionsException(
          code: 'failed-precondition',
          message: 'Posting restriction changed. Refresh before continuing.',
        );
      },
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PostingRestrictionDialog(reportId: 'case', service: service),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Restrict 7 days'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Confirm'));
    await tester.pumpAndSettle();
    expect(find.text('Restrict 7 days'), findsNothing);
    expect(find.textContaining('Refresh before continuing'), findsOneWidget);
    await tester.tap(find.text('Refresh status'));
    await tester.pumpAndSettle();
    expect(find.text('Restrict 7 days'), findsOneWidget);
  });
  testWidgets(
    'exact UID inspection supports release without evidence and does not issue new restriction',
    (tester) async {
      final service = PostingRestrictionService(
        currentUser: () => SafetyUser('admin'),
        boundary: (_, data) async {
          expect(data['targetUserId'], 'author');
          expect(data['reportId'], isNull);
          return status(kind: 'indefinite');
        },
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: PostingRestrictionDialog(service: service)),
        ),
      );
      await tester.enterText(find.byType(TextField), 'author');
      await tester.tap(find.text('Refresh status'));
      await tester.pumpAndSettle();
      expect(find.text('Release restriction'), findsOneWidget);
      expect(find.text('Restrict 7 days'), findsNothing);
      await tester.enterText(find.byType(TextField), 'different');
      await tester.pump();
      expect(find.text('Release restriction'), findsNothing);
    },
  );
}
