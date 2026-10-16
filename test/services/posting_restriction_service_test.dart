import 'dart:async';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:coupon_app/services/app_error_text.dart';
import 'package:coupon_app/services/posting_restriction_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'reviewer_safety_service_test.dart' show SafetyUser;

Map<String, Object?> status({
  String state = 'active',
  String? kind = '7d',
  int revision = 1,
  String? target = 'author',
}) => {
  'schemaVersion': 1,
  'status': state,
  'kind': kind,
  'revision': revision,
  'startsAtMillis': kind == null ? null : 1000,
  'endsAtMillis': kind == '7d' || kind == '14d' ? 1792792800000 : null,
  'targetUserId': ?target,
};
void main() {
  tearDown(() => PostingRestrictionService.testEnabled = null);
  test(
    'customer preflight is independently default off; no dormant flags activated',
    () async {
      var calls = 0;
      final service = PostingRestrictionService(
        currentUser: () => SafetyUser('A'),
        boundary: (_, _) async {
          calls++;
          return null;
        },
      );
      expect(PostingRestrictionService.customerEnabled, isFalse);
      await service.requireAllowed('A');
      expect(calls, 0);
    },
  );
  test(
    'active temporary and indefinite statuses explain restriction; expiry/release allow posting',
    () async {
      PostingRestrictionService.testEnabled = true;
      for (final state in ['active', 'expired', 'released', 'none']) {
        for (final kind in ['7d', '14d', 'indefinite']) {
          final service = PostingRestrictionService(
            currentUser: () => SafetyUser('A'),
            boundary: (name, data) async {
              expect(name, 'getCustomerPostingStatus');
              expect(data, {'schemaVersion': 1, 'expectedUserId': 'A'});
              return status(
                state: state,
                kind: state == 'none' ? null : kind,
                revision: state == 'none' ? 0 : 1,
                target: null,
              );
            },
          );
          if (state == 'active') {
            await expectLater(
              service.requireAllowed('A'),
              throwsA(
                isA<ArgumentError>().having(
                  (e) => e.message,
                  'message',
                  contains(
                    kind == 'indefinite' ? 'administrator releases' : 'UTC',
                  ),
                ),
              ),
            );
          } else {
            await service.requireAllowed('A');
          }
        }
      }
    },
  );
  test(
    'customer account switch before dispatch or during response is rejected',
    () async {
      PostingRestrictionService.testEnabled = true;
      var user = SafetyUser('A'), calls = 0;
      final response = Completer<Object?>();
      final service = PostingRestrictionService(
        currentUser: () => user,
        boundary: (_, _) {
          calls++;
          return response.future;
        },
      );
      await expectLater(service.requireAllowed('B'), throwsArgumentError);
      expect(calls, 0);
      final pending = service.requireAllowed('A');
      user = SafetyUser('B');
      response.complete(
        status(state: 'none', kind: null, revision: 0, target: null),
      );
      await expectLater(pending, throwsArgumentError);
    },
  );
  test(
    'Admin action pins inspected identity across confirmation, including two authorized accounts',
    () async {
      var user = SafetyUser('adminA'), writes = 0;
      final service = PostingRestrictionService(
        currentUser: () => user,
        boundary: (name, data) async {
          if (name == 'getAdminPostingRestriction') return status();
          writes++;
          return status(revision: 2);
        },
      );
      final current = await service.inspect(reportId: 'case');
      user = SafetyUser('adminB');
      await expectLater(
        service.change(current: current, action: '14d', reportId: 'case'),
        throwsArgumentError,
      );
      expect(writes, 0);
    },
  );
  test(
    'Admin sends exact resolved UID and inspected revision; no target inference',
    () async {
      final calls = <Map<String, Object?>>[];
      final service = PostingRestrictionService(
        currentUser: () => SafetyUser('admin'),
        boundary: (name, data) async {
          calls.add(data);
          return status(revision: calls.length);
        },
      );
      final current = await service.inspect(reportId: 'exact-case');
      await service.change(
        current: current,
        action: '14d',
        reportId: 'exact-case',
      );
      expect(calls.first['targetUserId'], isNull);
      expect(calls.last['targetUserId'], 'author');
      expect(calls.last['expectedRevision'], 1);
      expect(calls.last['requestId'], matches(RegExp(r'^[a-f0-9]{48}$')));
    },
  );
  test(
    'malformed, mismatched UID and missing-expiry responses fail safely',
    () async {
      for (final value in [
        null,
        {},
        {...status(), 'endsAtMillis': null},
        {...status(), 'kind': 'forever'},
        {...status(), 'targetUserId': 42},
      ]) {
        expect(
          () => PostingRestrictionStatus.parse(value),
          throwsFormatException,
        );
      }
      final service = PostingRestrictionService(
        currentUser: () => SafetyUser('admin'),
        boundary: (_, _) async => status(target: 'other'),
      );
      await expectLater(
        service.inspect(targetUserId: 'author'),
        throwsFormatException,
      );
    },
  );
  test(
    'trusted rejection survives common error formatter without leaking audit data',
    () {
      final message = AppErrorText.friendly(
        FirebaseFunctionsException(
          code: 'permission-denied',
          message: 'restricted',
          details: {
            'reason': 'posting-restricted',
            'endsAtMillis': null,
            'private': 'CANARY',
          },
        ),
        fallback: 'Failed',
      );
      expect(message, contains('administrator releases'));
      expect(message, isNot(contains('CANARY')));
      expect(
        AppErrorText.friendly(
          FirebaseFunctionsException(
            code: 'permission-denied',
            message: 'Denied',
          ),
          fallback: 'Failed',
        ),
        'You do not have permission to do that.',
      );
    },
  );
}
