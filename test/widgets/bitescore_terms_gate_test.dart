import 'dart:async';

import 'package:coupon_app/widgets/bitescore_terms_gate.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final action in ['Accept Terms', 'Cancel']) {
    testWidgets('$action shows actual approved text and preserves the draft', (
      tester,
    ) async {
      final identities = StreamController<String?>.broadcast();
      addTearDown(identities.close);
      var accepted = false;
      var writes = 0;
      var receipts = 0;
      final draft = TextEditingController(text: 'My draft');
      addTearDown(draft.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: Column(
                children: [
                  TextField(controller: draft),
                  TextButton(
                    onPressed: () async {
                      accepted = await BiteScoreTermsGate.ensureAccepted(
                        context,
                        expectedUserId: 'A',
                        isCurrent: () => true,
                        active: true,
                        identityChanges: identities.stream,
                        transport: (name, request) async {
                          expect(request['expectedUserId'], 'A');
                          if (name == 'acceptCustomerBiteScoreTerms') {
                            receipts++;
                            expect(request['version'], 'TEST-v1');
                          }
                          return {
                            'schemaVersion': 1,
                            'userId': 'A',
                            'enabled': true,
                            'version': 'TEST-v1',
                            'text': 'Approved synthetic wording',
                            'accepted': name == 'acceptCustomerBiteScoreTerms',
                          };
                        },
                      );
                      if (accepted) writes++;
                    },
                    child: const Text('Contribute'),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Contribute'));
      await tester.pumpAndSettle();
      expect(find.text('Approved synthetic wording'), findsOneWidget);
      expect(writes, 0);
      await tester.tap(find.text(action));
      await tester.pumpAndSettle();
      expect(accepted, action == 'Accept Terms');
      expect(writes, action == 'Accept Terms' ? 1 : 0);
      expect(receipts, writes);
      expect(draft.text, 'My draft');
    });
  }
  testWidgets('A to B to A while dialog is open invalidates the contribution', (
    tester,
  ) async {
    final identities = StreamController<String?>.broadcast();
    addTearDown(identities.close);
    var writes = 0, receipts = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                if (await BiteScoreTermsGate.ensureAccepted(
                  context,
                  expectedUserId: 'A',
                  isCurrent: () => true,
                  active: true,
                  identityChanges: identities.stream,
                  transport: (name, _) async {
                    if (name == 'acceptCustomerBiteScoreTerms') receipts++;
                    return {
                      'schemaVersion': 1,
                      'userId': 'A',
                      'enabled': true,
                      'version': 'TEST-v1',
                      'text': 'Synthetic text',
                      'accepted': false,
                    };
                  },
                )) {
                  writes++;
                }
              },
              child: const Text('Contribute'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Contribute'));
    await tester.pumpAndSettle();
    identities.add('B');
    await tester.pump();
    identities.add('A');
    await tester.pump();
    await tester.tap(find.text('Accept Terms'));
    await tester.pumpAndSettle();
    expect(writes, 0);
    expect(receipts, 0);
  });
  testWidgets(
    'same-version receipt skips prompt; dormant gate touches no identity or transport',
    (tester) async {
      late BuildContext context;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (c) {
              context = c;
              return const SizedBox();
            },
          ),
        ),
      );
      expect(
        await BiteScoreTermsGate.ensureAccepted(
          context,
          expectedUserId: 'A',
          isCurrent: () => true,
          active: true,
          identityChanges: const Stream.empty(),
          transport: (_, _) async => {
            'schemaVersion': 1,
            'userId': 'A',
            'enabled': true,
            'version': 'TEST-v1',
            'text': 'Synthetic text',
            'accepted': true,
          },
        ),
        true,
      );
      expect(find.byType(AlertDialog), findsNothing);
      expect(
        await BiteScoreTermsGate.ensureAccepted(
          context,
          expectedUserId: '',
          isCurrent: () => throw StateError('No identity access'),
          transport: (_, _) async => throw StateError('No call'),
        ),
        true,
      );
    },
  );
}
