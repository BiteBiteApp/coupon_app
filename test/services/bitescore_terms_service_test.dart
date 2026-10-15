import 'package:coupon_app/services/bitescore_terms_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Map<String, Object?> status({bool accepted = false}) => {
    'schemaVersion': 1,
    'userId': 'A',
    'enabled': true,
    'version': 'SIMULATED-APPROVED-v1',
    'text': 'Simulated approved Terms.',
    'accepted': accepted,
  };

  test('dormant default makes no calls or prompts', () async {
    expect(BiteScoreTermsService.enabled, false);
    expect(
      await BiteScoreTermsService.ensureAccepted(
        expectedUserId: '',
        isCurrent: () => true,
        confirm: (_, _) async => throw StateError('Must not prompt'),
        transport: (_, _) async => throw StateError('Must not call'),
      ),
      true,
    );
  });

  test(
    'decline does not accept; matching receipt needs no new prompt',
    () async {
      var calls = 0;
      for (final accepted in [false, true]) {
        expect(
          await BiteScoreTermsService.ensureAccepted(
            active: true,
            expectedUserId: 'A',
            isCurrent: () => true,
            confirm: (_, _) async {
              expect(accepted, false);
              return false;
            },
            transport: (name, _) async {
              expect(name, 'getCustomerBiteScoreTerms');
              calls++;
              return status(accepted: accepted);
            },
          ),
          accepted,
        );
      }
      expect(calls, 2);
    },
  );

  test(
    'explicit acceptance sends version and expected UID, no receipt assertion',
    () async {
      final names = <String>[];
      expect(
        await BiteScoreTermsService.ensureAccepted(
          active: true,
          expectedUserId: 'A',
          isCurrent: () => true,
          confirm: (version, text) async {
            expect(version, 'SIMULATED-APPROVED-v1');
            expect(text, 'Simulated approved Terms.');
            return true;
          },
          transport: (name, request) async {
            names.add(name);
            expect(
              request,
              names.length == 1
                  ? {'expectedUserId': 'A'}
                  : {'expectedUserId': 'A', 'version': 'SIMULATED-APPROVED-v1'},
            );
            return status(accepted: names.length == 2);
          },
        ),
        true,
      );
      expect(names, [
        'getCustomerBiteScoreTerms',
        'acceptCustomerBiteScoreTerms',
      ]);
    },
  );

  test(
    'account switching while reading or confirming invalidates all prior state',
    () async {
      for (final switchDuringRead in [true, false]) {
        var current = true;
        var calls = 0;
        final result = BiteScoreTermsService.ensureAccepted(
          active: true,
          expectedUserId: 'A',
          isCurrent: () => current,
          confirm: (_, _) async {
            current = false;
            return true;
          },
          transport: (_, _) async {
            calls++;
            if (switchDuringRead) current = false;
            return status();
          },
        );
        if (switchDuringRead) {
          await expectLater(result, throwsStateError);
        } else {
          expect(await result, false);
        }
        expect(calls, 1);
      }
    },
  );

  test(
    'inactive, malformed, cross-user and changed-version responses fail closed',
    () async {
      for (final bad in [
        <String, Object?>{'enabled': false},
        {...status(), 'userId': 'B'},
        {...status(), 'text': ''},
        {...status(), 'version': null},
      ]) {
        await expectLater(
          BiteScoreTermsService.ensureAccepted(
            active: true,
            expectedUserId: 'A',
            isCurrent: () => true,
            confirm: (_, _) async => throw StateError('Must not prompt'),
            transport: (_, _) async => bad,
          ),
          throwsStateError,
        );
      }
      await expectLater(
        BiteScoreTermsService.ensureAccepted(
          active: true,
          expectedUserId: 'A',
          isCurrent: () => true,
          confirm: (_, _) async => true,
          transport: (name, _) async => name == 'getCustomerBiteScoreTerms'
              ? status()
              : {...status(accepted: true), 'version': 'SIMULATED-APPROVED-v2'},
        ),
        throwsStateError,
      );
    },
  );
}
