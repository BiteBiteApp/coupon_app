import 'dart:convert';

import 'package:coupon_app/services/existing_google_password_link.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

String tokenFor(String email) =>
    'header.${base64Url.encode(utf8.encode(jsonEncode({'email': email}))).replaceAll('=', '')}.signature';
Matcher throwsCode(String code) =>
    throwsA(isA<FirebaseAuthException>().having((e) => e.code, 'code', code));

void main() {
  late _Backend backend;
  late ExistingGooglePasswordLink linker;
  late DebugPrintCallback originalPrint;
  late List<String> diagnostics;
  setUp(() {
    originalPrint = debugPrint;
    diagnostics = [];
    debugPrint = (message, {wrapWidth}) {
      if (message != null) diagnostics.add(message);
    };
    backend = _Backend();
    linker = ExistingGooglePasswordLink(
      apiKey: 'synthetic-api-key',
      tenantId: 'synthetic-tenant',
      client: MockClient(backend.handle),
    );
  });
  tearDown(() {
    debugPrint = originalPrint;
    // Only fixed labels/numbers, never request values or raw exceptions.
    for (final line in diagnostics) {
      expect(
        line,
        matches(
          RegExp(
            r'^BS_AUTH_DIAG stage=[A-Za-z]+ check=[A-Za-z]+( http=[0-9]{3})?$',
          ),
        ),
      );
    }
  });
  Future<String> link({
    String email = 'same@gmail.com',
    String? token,
    bool Function()? current,
  }) => linker.link(
    googleIdToken: token ?? tokenFor(email),
    email: email,
    password: ' new password ',
    isCurrent: current ?? () => true,
  );

  test(
    'existing-only proof, narrow lookups, token-bound link preserve UID/data',
    () async {
      expect(await link(), 'original-uid');
      expect(backend.calls, ['signInWithIdp', 'lookup', 'signUp', 'lookup']);
      expect(backend.password, ' new password ');
      expect(backend.data, {
        'uid': 'original-uid',
        'role': 'admin',
        'history': 17,
      });
      expect(backend.newUsers, 0);
    },
  );

  test('wrong Google email is rejected before any Firebase request', () async {
    await expectLater(
      link(token: tokenFor('wrong@gmail.com')),
      throwsCode('email-mismatch'),
    );
    expect(backend.calls, isEmpty);
  });
  test('malformed credential is rejected without network', () async {
    await expectLater(
      link(token: 'not-a-token'),
      throwsCode('invalid-credential'),
    );
    expect(backend.calls, isEmpty);
  });
  test('case-insensitive verified email is the same account', () async {
    expect(await link(email: 'Same@Gmail.com'), 'original-uid');
  });
  test('absent Google account cannot create a Firebase user', () async {
    backend.exists = false;
    await expectLater(link(), throwsCode('invalid-credential'));
    expect(backend.calls, ['signInWithIdp']);
    expect(backend.newUsers, 0);
    expect(backend.password, isNull);
  });
  for (final verified in [true, false]) {
    for (final invalid in [
      'missing token',
      'missing uid',
      'wrong lookup email',
      'wrong identity email',
      'new user',
      'wrong lookup uid',
      'missing google provider',
      'existing password',
    ]) {
      test(
        '$invalid cannot reach the link request; verified=$verified',
        () async {
          backend.invalid = invalid;
          backend.identityVerified = verified;
          backend.lookupVerified = verified;
          await expectLater(link(), throwsA(isA<FirebaseAuthException>()));
          expect(backend.calls, isNot(contains('signUp')));
          expect(backend.password, isNull);
          expect(backend.newUsers, 0);
        },
      );
    }
  }
  test('lookup is authoritative, not the decoded Google token email', () async {
    backend.invalid = 'wrong identity email';
    await expectLater(link(), throwsCode('invalid-credential'));
    expect(backend.calls, ['signInWithIdp']);
  });
  for (final verified in [true, false]) {
    for (final cancelAfter in ['signInWithIdp', 'lookup', 'signUp']) {
      test(
        'cancel after $cancelAfter prevents continuation; verified=$verified',
        () async {
          backend.identityVerified = verified;
          backend.lookupVerified = verified;
          var active = true;
          backend.after = (method) {
            if (method == cancelAfter) active = false;
          };
          await expectLater(
            link(current: () => active),
            throwsCode('flow-cancelled'),
          );
          expect(backend.calls.last, cancelAfter);
          if (cancelAfter != 'signUp') expect(backend.password, isNull);
          // An already accepted in-flight link cannot be undone by client cancellation.
          expect(backend.newUsers, 0);
        },
      );
    }
  }
  test(
    'server rejection has no reset, update or unbound signup fallback',
    () async {
      backend.rejectLink = true;
      await expectLater(link(), throwsCode('credential-already-in-use'));
      expect(backend.calls, ['signInWithIdp', 'lookup', 'signUp']);
      expect(backend.password, isNull);
    },
  );
  test('server cannot substitute a different UID at link completion', () async {
    backend.invalid = 'wrong link uid';
    await expectLater(link(), throwsCode('user-mismatch'));
  });
  test('missing linked provider is not reported as success', () async {
    backend.invalid = 'missing linked provider';
    await expectLater(link(), throwsCode('association-not-confirmed'));
  });
  test('linked password can require normal email verification', () async {
    // Observed Android/Firebase result: ownership was verified before linking,
    // then signUp added password on that UID and emailVerified became false.
    backend.invalid = 'post-link pending verification';
    expect(await link(), 'original-uid');
    expect(backend.calls, ['signInWithIdp', 'lookup', 'signUp', 'lookup']);
    expect(backend.password, ' new password ');
    expect(backend.newUsers, 0);
  });
  for (final mismatch in ['uid', 'email', 'google provider']) {
    test(
      'pending verification cannot hide post-link $mismatch mismatch',
      () async {
        backend.invalid = 'post-link wrong $mismatch';
        await expectLater(link(), throwsCode('user-mismatch'));
        expect(backend.calls, ['signInWithIdp', 'lookup', 'signUp', 'lookup']);
      },
    );
  }
  test('network errors never expose credential or URL details', () async {
    linker = ExistingGooglePasswordLink(
      apiKey: 'synthetic-secret-marker',
      client: MockClient((_) async {
        throw http.ClientException('synthetic-secret-marker');
      }),
    );
    try {
      await link();
      fail('Expected failure');
    } catch (error) {
      expect(error, isA<FirebaseAuthException>());
      expect('$error', isNot(contains('synthetic-secret-marker')));
    }
    expect(
      diagnostics,
      contains('BS_AUTH_DIAG stage=existingGoogle check=networkFailure'),
    );
    expect(diagnostics.join(), isNot(contains('synthetic-secret-marker')));
  });

  for (final status in [(false, false), (false, true), (true, false)]) {
    test(
      'authenticated existing Google account links with verification $status',
      () async {
        backend.identityVerified = status.$1;
        backend.lookupVerified = status.$2;
        expect(await link(), 'original-uid');
        expect(backend.calls, ['signInWithIdp', 'lookup', 'signUp', 'lookup']);
        expect(backend.password, ' new password ');
        expect(backend.newUsers, 0);
        expect(backend.data, {
          'uid': 'original-uid',
          'role': 'admin',
          'history': 17,
        });
        expect(backend.identityVerified, status.$1);
        expect(backend.lookupVerified, status.$2);
        expect(diagnostics.join(), isNot(contains('check=emailUnverified')));
      },
    );
  }

  for (final entry in {
    'INVALID_IDP_RESPONSE': 'firebaseInvalidIdpResponse',
    'USER_NOT_FOUND': 'firebaseUserNotFound',
    'INVALID_LOGIN_CREDENTIALS': 'firebaseInvalidCredential',
    'OPERATION_NOT_ALLOWED': 'firebaseOperationNotAllowed',
    'INVALID_IDP_RESPONSE: synthetic-secret-marker': 'firebaseOtherRejection',
  }.entries) {
    test(
      'Firebase rejection category ${entry.value} stays sanitized',
      () async {
        var calls = 0;
        linker = ExistingGooglePasswordLink(
          apiKey: 'synthetic-secret-marker',
          client: MockClient((_) async {
            calls++;
            return http.Response(
              jsonEncode({
                'error': {
                  'message': entry.key,
                  'details': 'synthetic-secret-marker',
                },
              }),
              400,
            );
          }),
        );
        await expectLater(link(), throwsCode('invalid-credential'));
        expect(calls, 1);
        expect(
          diagnostics,
          contains(
            'BS_AUTH_DIAG stage=existingGoogle check=${entry.value} http=400',
          ),
        );
        expect(diagnostics.join(), isNot(contains('synthetic-secret-marker')));
        expect(diagnostics.join(), isNot(contains('emailUnverified')));
      },
    );
  }

  test('malformed response does not leak its contents', () async {
    linker = ExistingGooglePasswordLink(
      apiKey: 'synthetic-secret-marker',
      client: MockClient(
        (_) async => http.Response('synthetic-secret-marker', 200),
      ),
    );
    await expectLater(link(), throwsCode('invalid-credential'));
    expect(
      diagnostics,
      contains(
        'BS_AUTH_DIAG stage=existingGoogle check=responseReceived http=200',
      ),
    );
    expect(
      diagnostics,
      contains('BS_AUTH_DIAG stage=existingGoogle check=malformedResponse'),
    );
    expect(diagnostics.join(), isNot(contains('synthetic-secret-marker')));
  });

  test(
    'diagnostic sink failure cannot change an authentication result',
    () async {
      debugPrint = (message, {wrapWidth}) => throw StateError('unavailable');
      expect(await link(), 'original-uid');
      expect(backend.calls, ['signInWithIdp', 'lookup', 'signUp', 'lookup']);
    },
  );
}

class _Backend {
  bool exists = true;
  bool identityVerified = true;
  bool lookupVerified = true;
  bool rejectLink = false;
  String? invalid;
  String? password;
  final calls = <String>[];
  int newUsers = 0;
  final data = {'uid': 'original-uid', 'role': 'admin', 'history': 17};
  void Function(String)? after;

  Future<http.Response> handle(http.Request request) async {
    expect(request.method, 'POST');
    expect(request.url.scheme, 'https');
    expect(request.url.host, 'identitytoolkit.googleapis.com');
    expect(request.url.queryParameters['key'], 'synthetic-api-key');
    final body = jsonDecode(request.body) as Map<String, dynamic>;
    expect(body['tenantId'], 'synthetic-tenant');
    final method = request.url.path.split(':').last;
    calls.add(method);
    Map<String, dynamic> response;
    switch (method) {
      case 'signInWithIdp':
        expect(
          body['autoCreate'],
          false,
          reason: 'Google confirmation must be existing-only.',
        );
        expect(
          body.containsKey('idToken'),
          false,
          reason: 'Do not attach Google to a guest or another local user.',
        );
        expect(
          request.url.queryParameters['fields'],
          'localId,email,emailVerified,idToken,isNewUser',
        );
        expect(
          Uri.splitQueryString(body['postBody'] as String)['providerId'],
          'google.com',
        );
        if (!exists) {
          return http.Response(
            jsonEncode({
              'error': {'message': 'USER_NOT_FOUND'},
            }),
            400,
          );
        }
        response = {
          'localId': 'original-uid',
          'idToken': 'synthetic-firebase-token',
          'email': 'same@gmail.com',
          'emailVerified': identityVerified,
          'isNewUser': false,
        };
        if (invalid == 'missing token') response.remove('idToken');
        if (invalid == 'missing uid') response.remove('localId');
        if (invalid == 'wrong identity email') {
          response['email'] = 'wrong@gmail.com';
        }
        if (invalid == 'new user') response['isNewUser'] = true;
      case 'lookup':
        expect(body['idToken'], 'synthetic-firebase-token');
        expect(
          request.url.queryParameters['fields'],
          'users(localId,email,emailVerified,providerUserInfo(providerId))',
        );
        response = {
          'users': [
            {
              'localId':
                  invalid == 'wrong lookup uid' ||
                      (password != null && invalid == 'post-link wrong uid')
                  ? 'other-uid'
                  : 'original-uid',
              'email':
                  invalid == 'wrong lookup email' ||
                      (password != null && invalid == 'post-link wrong email')
                  ? 'wrong@gmail.com'
                  : 'same@gmail.com',
              'emailVerified':
                  lookupVerified &&
                  !(password != null &&
                      invalid?.startsWith('post-link') == true),
              'providerUserInfo': [
                if (invalid != 'missing google provider' &&
                    !(password != null &&
                        invalid == 'post-link wrong google provider'))
                  {'providerId': 'google.com'},
                if (invalid == 'existing password' ||
                    (password != null && invalid != 'missing linked provider'))
                  {'providerId': 'password'},
              ],
            },
          ],
        };
      case 'signUp':
        expect(
          body['idToken'],
          'synthetic-firebase-token',
          reason: 'Missing token would create a replacement account.',
        );
        expect(
          body.keys,
          unorderedEquals([
            'tenantId',
            'idToken',
            'email',
            'password',
            'returnSecureToken',
          ]),
        );
        expect(body['email'].toString().toLowerCase(), 'same@gmail.com');
        if (rejectLink) {
          return http.Response(
            jsonEncode({
              'error': {'message': 'EMAIL_EXISTS'},
            }),
            400,
          );
        }
        password = body['password'] as String;
        response = {
          'localId': invalid == 'wrong link uid' ? 'other-uid' : 'original-uid',
          'idToken': 'synthetic-firebase-token',
        };
      default:
        throw StateError('Unexpected authentication endpoint: $method');
    }
    after?.call(method);
    return http.Response(jsonEncode(response), 200);
  }
}
