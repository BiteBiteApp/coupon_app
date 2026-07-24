import 'dart:async';

import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/services/bitesaver_restaurant_lifecycle_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BiteSaverRestaurantLifecycleService', () {
    test('construction performs no callable invocation', () {
      var calls = 0;

      BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          calls += 1;
          return <String, dynamic>{};
        },
      );

      expect(calls, 0);
      expect(BiteSaverRestaurantLifecycleService.region, 'us-central1');
    });

    test(
      'submission sends only normalized profile text and request data',
      () async {
        String? callableName;
        Map<String, dynamic>? payload;
        final service = BiteSaverRestaurantLifecycleService(
          invokeCallable: (name, data) async {
            callableName = name;
            payload = data;
            return <String, dynamic>{
              'documentId': 'owner-1',
              'approvalStatus': 'pending',
              'profileVersion': 1,
              'ignoredProviderField': 'not retained',
            };
          },
        );

        final result = await service.saveProfile(
          intent: BiteSaverProfileIntent.submitApplication,
          requestId: 'request-1',
          profile: _profile(),
        );

        expect(
          callableName,
          BiteSaverRestaurantLifecycleService.saveCallableName,
        );
        expect(payload, <String, dynamic>{
          'intent': 'submitApplication',
          'profile': <String, dynamic>{
            'restaurantName': 'River Grill',
            'streetAddress': '1 Main Street',
            'city': 'Crystal River',
            'state': 'FL',
            'zipCode': '34428',
            'phone': '(352) 555-0100',
            'website': '',
          },
          'requestId': 'request-1',
        });
        _expectNoNullValues(payload);
        _expectNoTrustedOrIdentityFields(payload!);
        expect(result.documentId, 'owner-1');
        expect(result.approvalStatus, 'pending');
        expect(result.profileVersion, 1);
      },
    );

    test(
      'submission sends included blank optional fields without null',
      () async {
        Map<String, dynamic>? payload;
        final service = BiteSaverRestaurantLifecycleService(
          invokeCallable: (name, data) async {
            payload = data;
            return <String, dynamic>{
              'documentId': 'owner-1',
              'approvalStatus': 'pending',
              'profileVersion': 1,
            };
          },
        );

        await service.saveProfile(
          intent: BiteSaverProfileIntent.submitApplication,
          requestId: 'blank-submission',
          profile: _profile(
            website: const BiteSaverOptionalField<String>.included('  '),
            bio: const BiteSaverOptionalField<String>.included(' \r\n '),
            mainImageUrl: const BiteSaverOptionalField<String>.included(null),
            businessHours:
                const BiteSaverOptionalField<
                  List<RestaurantBusinessHours>
                >.included(<RestaurantBusinessHours>[]),
          ),
        );

        expect(payload!['profile'], <String, dynamic>{
          'restaurantName': 'River Grill',
          'streetAddress': '1 Main Street',
          'city': 'Crystal River',
          'state': 'FL',
          'zipCode': '34428',
          'phone': '(352) 555-0100',
          'website': '',
          'bio': '',
          'mainImageUrl': '',
          'businessHours': <Map<String, dynamic>>[],
        });
        _expectNoNullValues(payload);
        _expectNoTrustedOrIdentityFields(payload!);
      },
    );

    test('owner and admin blank optional fields use B1 clear values', () async {
      final payloads = <Map<String, dynamic>>[];
      final service = BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          payloads.add(payload);
          return <String, dynamic>{
            'documentId': payload['documentId'] as String? ?? 'signed-in-owner',
            'approvalStatus': 'approved',
            'profileVersion': (payload['expectedProfileVersion'] as int) + 1,
          };
        },
      );

      await service.saveProfile(
        intent: BiteSaverProfileIntent.ownerUpdate,
        requestId: 'owner-request',
        expectedProfileVersion: 7,
        profile: _profile(
          website: const BiteSaverOptionalField<String>.included(''),
          bio: const BiteSaverOptionalField<String>.included(' \r\n '),
          mainImageUrl: const BiteSaverOptionalField<String>.included(null),
          businessHours:
              const BiteSaverOptionalField<
                List<RestaurantBusinessHours>
              >.included(<RestaurantBusinessHours>[]),
        ),
      );
      await service.saveProfile(
        intent: BiteSaverProfileIntent.adminUpdate,
        requestId: 'admin-request',
        documentId: 'firestore-document',
        expectedProfileVersion: 8,
        profile: _profile(
          website: const BiteSaverOptionalField<String>.included('  '),
          bio: const BiteSaverOptionalField<String>.included(' \n '),
        ),
      );

      expect(payloads[0]['intent'], 'ownerUpdate');
      expect(payloads[0]['expectedProfileVersion'], 7);
      expect(payloads[0], isNot(contains('documentId')));
      expect(payloads[0]['profile'], containsPair('website', ''));
      expect(payloads[0]['profile'], containsPair('bio', ''));
      expect(payloads[0]['profile'], containsPair('mainImageUrl', ''));
      expect(payloads[0]['profile'], containsPair('businessHours', isEmpty));
      expect(payloads[1], containsPair('intent', 'adminUpdate'));
      expect(payloads[1], containsPair('documentId', 'firestore-document'));
      expect(payloads[1], containsPair('expectedProfileVersion', 8));
      expect(payloads[1]['profile'], containsPair('website', ''));
      expect(payloads[1]['profile'], containsPair('bio', ''));
      for (final payload in payloads) {
        _expectNoNullValues(payload);
        _expectNoTrustedOrIdentityFields(payload);
      }
    });

    test(
      'business hours preserve B1 ordering and reject invalid weeks',
      () async {
        var calls = 0;
        Map<String, dynamic>? payload;
        final service = BiteSaverRestaurantLifecycleService(
          invokeCallable: (name, data) async {
            calls += 1;
            payload = data;
            return <String, dynamic>{
              'documentId': 'signed-in-owner',
              'approvalStatus': 'approved',
              'profileVersion': 4,
            };
          },
        );
        final reversedWeek = RestaurantBusinessHours.defaultWeek().reversed
            .map(
              (entry) => entry.day == 'Monday'
                  ? entry.copyWith(opensAt: ' 8:00   AM ')
                  : entry,
            )
            .toList();

        await service.saveProfile(
          intent: BiteSaverProfileIntent.ownerUpdate,
          requestId: 'hours-update',
          expectedProfileVersion: 3,
          profile: _profile(
            website: const BiteSaverOptionalField<String>.included(
              ' https://example.test ',
            ),
            bio: const BiteSaverOptionalField<String>.included(
              ' Updated   bio \r\n Second\tline ',
            ),
            mainImageUrl: const BiteSaverOptionalField<String>.included(
              ' https://images.test/restaurant.jpg ',
            ),
            businessHours:
                BiteSaverOptionalField<List<RestaurantBusinessHours>>.included(
                  reversedWeek,
                ),
          ),
        );

        final sentHours =
            (payload!['profile'] as Map<String, dynamic>)['businessHours']
                as List<dynamic>;
        final sentProfile = payload!['profile'] as Map<String, dynamic>;
        expect(sentProfile['website'], 'https://example.test');
        expect(sentProfile['bio'], 'Updated bio\nSecond line');
        expect(
          sentProfile['mainImageUrl'],
          'https://images.test/restaurant.jpg',
        );
        expect(
          sentHours.map((entry) => (entry as Map<String, dynamic>)['day']),
          reversedWeek.map((entry) => entry.day),
        );
        final sentMonday = sentHours.cast<Map<String, dynamic>>().singleWhere(
          (entry) => entry['day'] == 'Monday',
        );
        expect(sentMonday['opensAt'], '8:00 AM');
        _expectNoNullValues(payload);

        final invalidWeeks = <List<RestaurantBusinessHours>>[
          <RestaurantBusinessHours>[
            RestaurantBusinessHours.defaultDay('Sunday'),
          ],
          <RestaurantBusinessHours>[
            for (var index = 0; index < 7; index += 1)
              RestaurantBusinessHours.defaultDay('Sunday'),
          ],
          <RestaurantBusinessHours>[
            for (final entry in RestaurantBusinessHours.defaultWeek())
              entry.day == 'Monday' ? entry.copyWith(opensAt: ' ') : entry,
          ],
        ];
        for (final invalidWeek in invalidWeeks) {
          await expectLater(
            service.saveProfile(
              intent: BiteSaverProfileIntent.ownerUpdate,
              requestId: 'invalid-hours',
              expectedProfileVersion: 3,
              profile: _profile(
                businessHours:
                    BiteSaverOptionalField<
                      List<RestaurantBusinessHours>
                    >.included(invalidWeek),
              ),
            ),
            throwsA(
              isA<BiteSaverLifecycleException>()
                  .having(
                    (error) => error.kind,
                    'kind',
                    BiteSaverLifecycleFailureKind.invalidProfile,
                  )
                  .having((error) => error.code, 'code', 'invalid-argument'),
            ),
          );
        }
        expect(calls, 1);
      },
    );

    test(
      'business hours reject B1 control characters before invocation',
      () async {
        var calls = 0;
        final service = BiteSaverRestaurantLifecycleService(
          invokeCallable: (name, data) async {
            calls += 1;
            return <String, dynamic>{
              'documentId': 'signed-in-owner',
              'approvalStatus': 'approved',
              'profileVersion': 4,
            };
          },
        );
        final invalidWeeks = <List<RestaurantBusinessHours>>[
          <RestaurantBusinessHours>[
            for (final entry in RestaurantBusinessHours.defaultWeek())
              entry.day == 'Sunday' ? entry.copyWith(day: 'Sunday\n') : entry,
          ],
          <RestaurantBusinessHours>[
            for (final entry in RestaurantBusinessHours.defaultWeek())
              entry.day == 'Monday'
                  ? entry.copyWith(opensAt: '\t9:00 AM')
                  : entry,
          ],
          <RestaurantBusinessHours>[
            for (final entry in RestaurantBusinessHours.defaultWeek())
              entry.day == 'Tuesday'
                  ? entry.copyWith(closesAt: '5:00 PM\u200B')
                  : entry,
          ],
        ];

        for (var index = 0; index < invalidWeeks.length; index += 1) {
          await expectLater(
            service.saveProfile(
              intent: BiteSaverProfileIntent.ownerUpdate,
              requestId: 'control-$index',
              expectedProfileVersion: 3,
              profile: _profile(
                businessHours:
                    BiteSaverOptionalField<
                      List<RestaurantBusinessHours>
                    >.included(invalidWeeks[index]),
              ),
            ),
            throwsA(
              isA<BiteSaverLifecycleException>()
                  .having(
                    (error) => error.kind,
                    'kind',
                    BiteSaverLifecycleFailureKind.invalidProfile,
                  )
                  .having((error) => error.code, 'code', 'invalid-argument'),
            ),
          );
        }

        expect(calls, 0);
      },
    );

    test('review sends the exact protected review payload', () async {
      String? callableName;
      Map<String, dynamic>? payload;
      final service = BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, data) async {
          callableName = name;
          payload = data;
          return <String, dynamic>{
            'documentId': 'restaurant-doc',
            'approvalStatus': 'approved',
            'profileVersion': 4,
          };
        },
      );

      final result = await service.reviewApplication(
        documentId: ' restaurant-doc ',
        decision: BiteSaverApplicationDecision.approve,
        expectedProfileVersion: 4,
      );

      expect(
        callableName,
        BiteSaverRestaurantLifecycleService.reviewCallableName,
      );
      expect(payload, <String, dynamic>{
        'documentId': 'restaurant-doc',
        'decision': 'approve',
        'expectedProfileVersion': 4,
      });
      expect(result.approvalStatus, 'approved');
    });

    test(
      'malformed callable responses fail closed without retaining maps',
      () async {
        final service = BiteSaverRestaurantLifecycleService(
          invokeCallable: (name, payload) async => <String, dynamic>{
            'documentId': 'restaurant-doc',
            'approvalStatus': 'pending',
            'profileVersion': '1',
            'rawProviderPayload': 'secret',
          },
        );

        await expectLater(
          service.saveProfile(
            intent: BiteSaverProfileIntent.submitApplication,
            requestId: 'request',
            profile: _profile(),
          ),
          throwsA(
            isA<BiteSaverLifecycleException>()
                .having(
                  (error) => error.kind,
                  'kind',
                  BiteSaverLifecycleFailureKind.invalidResponse,
                )
                .having(
                  (error) => error.message,
                  'message',
                  isNot(contains('secret')),
                ),
          ),
        );
      },
    );

    test('responses fail closed on impossible version or identity', () async {
      final zeroVersionService = BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async => <String, dynamic>{
          'documentId': 'owner-1',
          'approvalStatus': 'pending',
          'profileVersion': 0,
        },
      );
      await expectLater(
        zeroVersionService.saveProfile(
          intent: BiteSaverProfileIntent.submitApplication,
          requestId: 'request',
          profile: _profile(),
        ),
        throwsA(
          isA<BiteSaverLifecycleException>().having(
            (error) => error.kind,
            'kind',
            BiteSaverLifecycleFailureKind.invalidResponse,
          ),
        ),
      );

      final mismatchedReviewService = BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async => <String, dynamic>{
          'documentId': 'different-document',
          'approvalStatus': 'rejected',
          'profileVersion': 3,
        },
      );
      await expectLater(
        mismatchedReviewService.reviewApplication(
          documentId: 'expected-document',
          decision: BiteSaverApplicationDecision.approve,
          expectedProfileVersion: 3,
        ),
        throwsA(
          isA<BiteSaverLifecycleException>().having(
            (error) => error.kind,
            'kind',
            BiteSaverLifecycleFailureKind.invalidResponse,
          ),
        ),
      );
    });

    for (final scenario
        in <
          ({
            String code,
            String message,
            BiteSaverLifecycleFailureKind kind,
            String safeText,
          })
        >[
          (
            code: 'invalid-argument',
            message: 'raw validation details',
            kind: BiteSaverLifecycleFailureKind.invalidProfile,
            safeText: 'complete United States address',
          ),
          (
            code: 'not-found',
            message: 'No matching address',
            kind: BiteSaverLifecycleFailureKind.addressNotFound,
            safeText: 'No matching restaurant address',
          ),
          (
            code: 'failed-precondition',
            message: 'Multiple matching addresses were found',
            kind: BiteSaverLifecycleFailureKind.addressAmbiguous,
            safeText: 'more specific',
          ),
          (
            code: 'failed-precondition',
            message: 'This request ID was already used',
            kind: BiteSaverLifecycleFailureKind.requestIdCollision,
            safeText: 'conflicts',
          ),
          (
            code: 'failed-precondition',
            message: 'complete trusted location',
            kind: BiteSaverLifecycleFailureKind.invalidLifecycleState,
            safeText: 'validated address',
          ),
          (
            code: 'failed-precondition',
            message: 'Restaurant address lookup is not configured.',
            kind: BiteSaverLifecycleFailureKind.geocoderUnavailable,
            safeText: 'temporarily unavailable',
          ),
          (
            code: 'aborted',
            message: 'raw latest profile',
            kind: BiteSaverLifecycleFailureKind.staleProfile,
            safeText: 'Reload',
          ),
          (
            code: 'unavailable',
            message: 'raw Google response and API key',
            kind: BiteSaverLifecycleFailureKind.geocoderUnavailable,
            safeText: 'temporarily unavailable',
          ),
          (
            code: 'permission-denied',
            message: 'raw auth token',
            kind: BiteSaverLifecycleFailureKind.permissionDenied,
            safeText: 'permission',
          ),
          (
            code: 'unauthenticated',
            message: 'raw auth state',
            kind: BiteSaverLifecycleFailureKind.unauthenticated,
            safeText: 'sign in again',
          ),
          (
            code: 'not-found',
            message: 'Restaurant account was not found.',
            kind: BiteSaverLifecycleFailureKind.missingAccount,
            safeText: 'no longer exists',
          ),
          (
            code: 'deadline-exceeded',
            message: 'raw provider timeout',
            kind: BiteSaverLifecycleFailureKind.geocoderUnavailable,
            safeText: 'temporarily unavailable',
          ),
          (
            code: 'internal',
            message: 'raw provider response',
            kind: BiteSaverLifecycleFailureKind.internal,
            safeText: 'Could not complete',
          ),
        ]) {
      test(
        'maps ${scenario.code} to a controlled ${scenario.kind.name} error',
        () async {
          final service = BiteSaverRestaurantLifecycleService(
            invokeCallable: (name, payload) async {
              throw BiteSaverCallableFailure(scenario.code, scenario.message);
            },
          );

          await expectLater(
            service.saveProfile(
              intent: BiteSaverProfileIntent.submitApplication,
              requestId: 'request',
              profile: _profile(),
            ),
            throwsA(
              isA<BiteSaverLifecycleException>()
                  .having((error) => error.kind, 'kind', scenario.kind)
                  .having(
                    (error) => error.message,
                    'message',
                    contains(scenario.safeText),
                  )
                  .having(
                    (error) => error.message,
                    'message',
                    isNot(contains('raw')),
                  ),
            ),
          );
        },
      );
    }
  });

  group('BiteSaverProfileOperationState', () {
    test('exact retry retains one ID and success clears it', () async {
      var sequence = 0;
      final state = BiteSaverProfileOperationState(
        requestIdGenerator: () => 'request-${++sequence}',
      );
      final request = BiteSaverProfileSaveRequest.submitApplication(
        profile: _profile(),
      );

      await expectLater(
        state.execute<void>(
          request: request,
          logicalTarget: 'owner-1',
          invoke: (requestId) async {
            expect(requestId, 'request-1');
            throw const BiteSaverCallableFailure('unavailable');
          },
        ),
        throwsA(isA<BiteSaverCallableFailure>()),
      );
      expect(state.retainedRequestId, 'request-1');

      await state.execute<void>(
        request: request,
        logicalTarget: 'owner-1',
        invoke: (requestId) async {
          expect(requestId, 'request-1');
        },
      );
      expect(state.retainedRequestId, isNull);

      await state.execute<void>(
        request: request,
        logicalTarget: 'owner-1',
        invoke: (requestId) async {
          expect(requestId, 'request-2');
        },
      );
    });

    test('every bound logical-request change receives a new ID', () async {
      var sequence = 0;
      final state = BiteSaverProfileOperationState(
        requestIdGenerator: () => 'id-${++sequence}',
      );
      final observed = <String>[];

      Future<void> fail(BiteSaverProfileSaveRequest request) async {
        await expectLater(
          state.execute<void>(
            request: request,
            logicalTarget: 'owner-1',
            invoke: (requestId) async {
              observed.add(requestId);
              throw const BiteSaverCallableFailure('unavailable');
            },
          ),
          throwsA(isA<BiteSaverCallableFailure>()),
        );
      }

      await fail(
        BiteSaverProfileSaveRequest.submitApplication(profile: _profile()),
      );
      await fail(
        BiteSaverProfileSaveRequest.submitApplication(
          profile: _profile(phone: 'different'),
        ),
      );
      await fail(
        BiteSaverProfileSaveRequest.ownerUpdate(
          profile: _profile(phone: 'different'),
          expectedProfileVersion: 1,
        ),
      );
      await fail(
        BiteSaverProfileSaveRequest.ownerUpdate(
          profile: _profile(phone: 'different'),
          expectedProfileVersion: 2,
        ),
      );
      await fail(
        BiteSaverProfileSaveRequest.adminUpdate(
          documentId: 'first',
          profile: _profile(phone: 'different'),
          expectedProfileVersion: 2,
        ),
      );
      await fail(
        BiteSaverProfileSaveRequest.adminUpdate(
          documentId: 'second',
          profile: _profile(phone: 'different'),
          expectedProfileVersion: 2,
        ),
      );
      await fail(
        BiteSaverProfileSaveRequest.adminUpdate(
          documentId: 'second',
          profile: _profile(
            phone: 'different',
            bio: const BiteSaverOptionalField<String>.included(null),
          ),
          expectedProfileVersion: 2,
        ),
      );
      await fail(
        BiteSaverProfileSaveRequest.adminUpdate(
          documentId: 'second',
          profile: _profile(
            phone: 'different',
            bio: const BiteSaverOptionalField<String>.included(null),
            businessHours:
                BiteSaverOptionalField<List<RestaurantBusinessHours>>.included(
                  RestaurantBusinessHours.defaultWeek(),
                ),
          ),
          expectedProfileVersion: 2,
        ),
      );

      expect(observed, <String>[
        'id-1',
        'id-2',
        'id-3',
        'id-4',
        'id-5',
        'id-6',
        'id-7',
        'id-8',
      ]);
    });

    test('implicit target changes receive a new ID', () async {
      var sequence = 0;
      final state = BiteSaverProfileOperationState(
        requestIdGenerator: () => 'target-${++sequence}',
      );
      final request = BiteSaverProfileSaveRequest.submitApplication(
        profile: _profile(),
      );
      final observed = <String>[];

      for (final target in <String>['owner-1', 'owner-1', 'owner-2']) {
        await expectLater(
          state.execute<void>(
            request: request,
            logicalTarget: target,
            invoke: (requestId) async {
              observed.add(requestId);
              throw const BiteSaverCallableFailure('unavailable');
            },
          ),
          throwsA(isA<BiteSaverCallableFailure>()),
        );
      }

      expect(observed, <String>['target-1', 'target-1', 'target-2']);
    });

    test('every submitted profile field participates in ID binding', () async {
      var sequence = 0;
      final state = BiteSaverProfileOperationState(
        requestIdGenerator: () => 'field-${++sequence}',
      );
      final changedHours = RestaurantBusinessHours.defaultWeek();
      changedHours[0] = changedHours[0].copyWith(opensAt: '8:30 AM');
      final profiles = <BiteSaverRestaurantProfileInput>[
        _profile(),
        _profile(restaurantName: 'Different Name'),
        _profile(streetAddress: '2 Main Street'),
        _profile(city: 'Homosassa'),
        _profile(state: 'GA'),
        _profile(zipCode: '34429'),
        _profile(phone: '(352) 555-9999'),
        _profile(
          website: const BiteSaverOptionalField<String>.included(
            'https://example.test',
          ),
        ),
        _profile(
          bio: const BiteSaverOptionalField<String>.included('Different bio'),
        ),
        _profile(
          mainImageUrl: const BiteSaverOptionalField<String>.included(
            'https://images.test/restaurant.jpg',
          ),
        ),
        _profile(
          businessHours:
              BiteSaverOptionalField<List<RestaurantBusinessHours>>.included(
                changedHours,
              ),
        ),
      ];
      final observed = <String>[];

      for (final profile in profiles) {
        final request = BiteSaverProfileSaveRequest.ownerUpdate(
          profile: profile,
          expectedProfileVersion: 3,
        );
        await expectLater(
          state.execute<void>(
            request: request,
            logicalTarget: 'owner-1',
            invoke: (requestId) async {
              observed.add(requestId);
              throw const BiteSaverCallableFailure('unavailable');
            },
          ),
          throwsA(isA<BiteSaverCallableFailure>()),
        );
      }

      expect(observed.toSet(), hasLength(profiles.length));
      expect(sequence, profiles.length);
    });

    test(
      'optional preserve and clear semantics bind equivalent request IDs',
      () async {
        var sequence = 0;
        final state = BiteSaverProfileOperationState(
          requestIdGenerator: () => 'optional-${++sequence}',
        );
        final observed = <String>[];

        Future<void> fail(BiteSaverRestaurantProfileInput profile) async {
          await expectLater(
            state.execute<void>(
              request: BiteSaverProfileSaveRequest.ownerUpdate(
                profile: profile,
                expectedProfileVersion: 3,
              ),
              logicalTarget: 'owner-1',
              invoke: (requestId) async {
                observed.add(requestId);
                throw const BiteSaverCallableFailure('unavailable');
              },
            ),
            throwsA(isA<BiteSaverCallableFailure>()),
          );
        }

        await fail(_profile());
        await fail(
          _profile(
            website: const BiteSaverOptionalField<String>.included(' \n '),
          ),
        );
        await fail(
          _profile(bio: const BiteSaverOptionalField<String>.included(null)),
        );
        await fail(
          _profile(
            bio: const BiteSaverOptionalField<String>.included(' \r\n '),
          ),
        );
        await fail(
          _profile(
            mainImageUrl: const BiteSaverOptionalField<String>.included(null),
          ),
        );
        await fail(
          _profile(
            mainImageUrl: const BiteSaverOptionalField<String>.included('  '),
          ),
        );
        await fail(
          _profile(
            businessHours:
                const BiteSaverOptionalField<
                  List<RestaurantBusinessHours>
                >.included(<RestaurantBusinessHours>[]),
          ),
        );
        await fail(
          _profile(
            businessHours:
                const BiteSaverOptionalField<
                  List<RestaurantBusinessHours>
                >.included(null),
          ),
        );
        await fail(
          _profile(
            businessHours:
                BiteSaverOptionalField<List<RestaurantBusinessHours>>.included(
                  RestaurantBusinessHours.defaultWeek(),
                ),
          ),
        );
        await fail(
          _profile(
            businessHours:
                BiteSaverOptionalField<List<RestaurantBusinessHours>>.included(
                  RestaurantBusinessHours.defaultWeek().reversed.toList(),
                ),
          ),
        );

        expect(observed, <String>[
          'optional-1',
          'optional-1',
          'optional-2',
          'optional-2',
          'optional-3',
          'optional-3',
          'optional-4',
          'optional-4',
          'optional-5',
          'optional-6',
        ]);
        expect(sequence, 6);
      },
    );

    test('confirmed request-ID collision rotates the next retry ID', () async {
      var sequence = 0;
      final state = BiteSaverProfileOperationState(
        requestIdGenerator: () => 'collision-${++sequence}',
      );
      final request = BiteSaverProfileSaveRequest.submitApplication(
        profile: _profile(),
      );

      await expectLater(
        state.execute<void>(
          request: request,
          logicalTarget: 'owner-1',
          invoke: (requestId) async {
            expect(requestId, 'collision-1');
            throw const BiteSaverLifecycleException(
              kind: BiteSaverLifecycleFailureKind.requestIdCollision,
              code: 'failed-precondition',
              message: 'Controlled collision.',
            );
          },
        ),
        throwsA(
          isA<BiteSaverLifecycleException>().having(
            (error) => error.kind,
            'kind',
            BiteSaverLifecycleFailureKind.requestIdCollision,
          ),
        ),
      );
      expect(state.retainedRequestId, isNull);

      await state.execute<void>(
        request: request,
        logicalTarget: 'owner-1',
        invoke: (requestId) async {
          expect(requestId, 'collision-2');
        },
      );
    });

    test('duplicate simultaneous submission is blocked', () async {
      final completer = Completer<void>();
      final state = BiteSaverProfileOperationState(
        requestIdGenerator: () => 'one-id',
      );
      final request = BiteSaverProfileSaveRequest.submitApplication(
        profile: _profile(),
      );
      final first = state.execute<void>(
        request: request,
        logicalTarget: 'owner-1',
        invoke: (requestId) => completer.future,
      );

      await expectLater(
        state.execute<void>(
          request: request,
          logicalTarget: 'owner-1',
          invoke: (requestId) async {},
        ),
        throwsA(
          isA<BiteSaverLifecycleException>().having(
            (error) => error.kind,
            'kind',
            BiteSaverLifecycleFailureKind.duplicateInFlight,
          ),
        ),
      );
      completer.complete();
      await first;
    });

    test('generated IDs are UUIDv4-style and nonconstant', () {
      final first = generateBiteSaverRequestId();
      final second = generateBiteSaverRequestId();

      expect(
        first,
        matches(
          RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          ),
        ),
      );
      expect(second, isNot(first));
    });
  });
}

void _expectNoNullValues(Object? value) {
  if (value is Map) {
    for (final entry in value.entries) {
      expect(entry.value, isNotNull, reason: '${entry.key} must not be null');
      _expectNoNullValues(entry.value);
    }
  } else if (value is Iterable) {
    for (final item in value) {
      expect(item, isNotNull);
      _expectNoNullValues(item);
    }
  }
}

BiteSaverRestaurantProfileInput _profile({
  String restaurantName = '  River   Grill ',
  String streetAddress = ' 1 Main   Street ',
  String city = ' Crystal  River ',
  String state = ' fl ',
  String zipCode = ' 34428 ',
  String phone = '(352) 555-0100',
  BiteSaverOptionalField<String> website =
      const BiteSaverOptionalField<String>.omitted(),
  BiteSaverOptionalField<String> bio =
      const BiteSaverOptionalField<String>.omitted(),
  BiteSaverOptionalField<String> mainImageUrl =
      const BiteSaverOptionalField<String>.omitted(),
  BiteSaverOptionalField<List<RestaurantBusinessHours>> businessHours =
      const BiteSaverOptionalField<List<RestaurantBusinessHours>>.omitted(),
}) {
  return BiteSaverRestaurantProfileInput(
    restaurantName: restaurantName,
    streetAddress: streetAddress,
    city: city,
    state: state,
    zipCode: zipCode,
    phone: phone,
    website: website,
    bio: bio,
    mainImageUrl: mainImageUrl,
    businessHours: businessHours,
  );
}

void _expectNoTrustedOrIdentityFields(Map<String, dynamic> payload) {
  const forbidden = <String>{
    'uid',
    'email',
    'approvalStatus',
    'applicationStatus',
    'latitude',
    'longitude',
    'location',
    'geopoint',
    'geohash',
    'formattedAddress',
    'addressFingerprint',
    'locationValidationFingerprint',
    'locationValidatedAt',
    'locationSource',
    'profileVersion',
    'locationVersion',
    'subscriptionStatus',
    'stripeCustomerId',
    'inviteToken',
  };

  void inspect(Object? value) {
    if (value is Map) {
      for (final entry in value.entries) {
        expect(forbidden, isNot(contains(entry.key)));
        inspect(entry.value);
      }
    } else if (value is Iterable) {
      for (final item in value) {
        inspect(item);
      }
    }
  }

  inspect(payload);
}
