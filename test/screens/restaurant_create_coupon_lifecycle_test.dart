import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/daily_special.dart';
import 'package:coupon_app/models/local_restaurant_profile_store.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/screens/restaurant_create_coupon_screen.dart';
import 'package:coupon_app/services/bitesaver_restaurant_lifecycle_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  setUp(LocalRestaurantProfileStore.resetProfile);
  tearDown(LocalRestaurantProfileStore.resetProfile);

  testWidgets('missing account is a valid coupon application state', (
    tester,
  ) async {
    var accountLoads = 0;
    await _pumpApplicationScreen(
      tester,
      loadAccount: (uid) async {
        accountLoads += 1;
        return null;
      },
    );

    expect(accountLoads, 1);
    expect(find.text('Apply for Coupon-Side Approval'), findsOneWidget);
    expect(
      find.text('Enter your restaurant information below.'),
      findsOneWidget,
    );
    expect(_fieldWithLabel('Restaurant Name'), findsOneWidget);
    expect(
      find.widgetWithText(FilledButton, 'Apply for a restaurant account'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'legacy skeleton submits through callable, retains values, and reuses exact retry ID',
    (tester) async {
      final calls = <Map<String, dynamic>>[];
      final pendingResults = <Completer<Object?>>[];
      var requestSequence = 0;
      var submitted = false;
      final service = BiteSaverRestaurantLifecycleService(
        requestIdGenerator: () => 'application-${++requestSequence}',
        invokeCallable: (name, payload) {
          expect(name, BiteSaverRestaurantLifecycleService.saveCallableName);
          calls.add(Map<String, dynamic>.from(payload));
          final completer = Completer<Object?>();
          pendingResults.add(completer);
          return completer.future;
        },
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: service,
        loadAccount: (uid) async {
          if (submitted) {
            return _submittedAccount();
          }
          return <String, dynamic>{
            Restaurant.fieldUid: uid,
            Restaurant.fieldEmail: 'owner@example.com',
            Restaurant.fieldName: 'Legacy Cafe',
            Restaurant.fieldStreetAddress: '10 Old Road',
            Restaurant.fieldCity: 'Lecanto',
            Restaurant.fieldState: 'FL',
            Restaurant.fieldZipCode: '34461',
          };
        },
      );

      expect(_fieldText(tester, 'Restaurant Name'), 'Legacy Cafe');
      expect(_fieldText(tester, 'Street Address'), '10 Old Road');
      expect(_fieldText(tester, 'Phone Number'), isEmpty);
      await tester.enterText(_fieldWithLabel('Phone Number'), '3525550110');
      expect(_fieldText(tester, 'Phone Number'), '(352) 555-0110');

      final applyButton = find.widgetWithText(
        FilledButton,
        'Apply for a restaurant account',
      );
      await tester.ensureVisible(applyButton);
      await tester.tap(applyButton);
      await tester.pump();

      expect(calls, hasLength(1));
      expect(
        find.widgetWithText(FilledButton, 'Validating location...'),
        findsOneWidget,
      );
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Validating location...'),
            )
            .onPressed,
        isNull,
      );
      final firstPayload = calls.single;
      expect(firstPayload['intent'], 'submitApplication');
      expect(firstPayload['requestId'], 'application-1');
      expect(firstPayload, isNot(contains('documentId')));
      expect(firstPayload, isNot(contains('expectedProfileVersion')));
      final firstProfile = firstPayload['profile'] as Map<String, dynamic>;
      expect(firstProfile['website'], '');
      expect(firstProfile, isNot(contains('bio')));
      expect(firstProfile, isNot(contains('mainImageUrl')));
      expect(firstProfile, isNot(contains('businessHours')));
      _expectNoNullWireValues(firstPayload);
      _expectNoTrustedLocationFields(firstPayload);

      pendingResults.first.completeError(
        const BiteSaverCallableFailure('unavailable', 'raw provider details'),
      );
      await tester.pumpAndSettle();

      expect(
        find.text(
          'Restaurant address validation is temporarily unavailable. Try again.',
        ),
        findsOneWidget,
      );
      expect(_fieldText(tester, 'Restaurant Name'), 'Legacy Cafe');
      expect(_fieldText(tester, 'Street Address'), '10 Old Road');
      expect(_fieldText(tester, 'Phone Number'), '(352) 555-0110');

      await tester.ensureVisible(applyButton);
      await tester.tap(applyButton);
      await tester.pump();
      expect(calls, hasLength(2));
      expect(calls[1]['requestId'], calls[0]['requestId']);

      submitted = true;
      pendingResults[1].complete(<String, dynamic>{
        'documentId': 'owner-1',
        'approvalStatus': 'pending',
        'profileVersion': 1,
      });
      await tester.pumpAndSettle();

      expect(find.text('Coupon-Side Approval Pending'), findsOneWidget);
      expect(find.textContaining('waiting for admin approval'), findsOneWidget);
      expect(requestSequence, 1);
    },
  );

  testWidgets(
    'owner update sends approved text and current version while blocking duplicates',
    (tester) async {
      final invocations = <Map<String, dynamic>>[];
      final pendingSave = Completer<Object?>();
      var requestSequence = 0;
      var account = _approvedAccount(website: '', bio: '');
      final service = BiteSaverRestaurantLifecycleService(
        requestIdGenerator: () => 'owner-${++requestSequence}',
        invokeCallable: (name, payload) {
          expect(name, BiteSaverRestaurantLifecycleService.saveCallableName);
          invocations.add(Map<String, dynamic>.from(payload));
          return pendingSave.future;
        },
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: service,
        loadAccount: (uid) async => account,
      );
      await _expandSection(tester, 'Basic Restaurant Information');
      await tester.enterText(_fieldWithLabel('Phone Number'), '3525550199');

      final saveButton = find.widgetWithText(
        ElevatedButton,
        'Save Basic Information',
      );
      await tester.ensureVisible(saveButton);
      final onPressed = tester.widget<ElevatedButton>(saveButton).onPressed!;
      onPressed();
      onPressed();
      await tester.pump();

      expect(invocations, hasLength(1));
      expect(
        tester
            .widget<ElevatedButton>(
              find
                  .widgetWithText(ElevatedButton, 'Validating location...')
                  .first,
            )
            .onPressed,
        isNull,
      );
      final payload = invocations.single;
      expect(payload['intent'], 'ownerUpdate');
      expect(payload['expectedProfileVersion'], 4);
      expect(payload['requestId'], 'owner-1');
      expect(payload, isNot(contains('documentId')));
      final profile = payload['profile'] as Map<String, dynamic>;
      expect(profile['restaurantName'], 'Approved Cafe');
      expect(profile['phone'], '(352) 555-0199');
      expect(profile['website'], '');
      expect(profile['bio'], '');
      expect(profile['mainImageUrl'], '');
      expect(profile['businessHours'], isA<List<dynamic>>());
      expect(profile['businessHours'], isEmpty);
      _expectNoNullWireValues(payload);
      _expectNoTrustedLocationFields(payload);

      account = _approvedAccount(
        profileVersion: 5,
        phone: '(352) 555-0199',
        website: '',
        bio: '',
      );
      pendingSave.complete(<String, dynamic>{
        'documentId': 'owner-1',
        'approvalStatus': 'approved',
        'profileVersion': 5,
      });
      await tester.pumpAndSettle();

      expect(invocations, hasLength(1));
      expect(requestSequence, 1);
      expect(find.text('Restaurant profile saved.'), findsOneWidget);
      expect(_fieldText(tester, 'Phone Number'), '(352) 555-0199');
    },
  );

  testWidgets(
    'approved name stays separate from a proposed name during owner update',
    (tester) async {
      final nameRequests =
          <({String userId, String currentName, String requestedName})>[];
      Map<String, dynamic>? lifecyclePayload;
      var account = _approvedAccount();
      final service = BiteSaverRestaurantLifecycleService(
        requestIdGenerator: () => 'owner-name-request',
        invokeCallable: (name, payload) async {
          lifecyclePayload = Map<String, dynamic>.from(payload);
          account = _approvedAccount(
            profileVersion: 5,
            phone: '(352) 555-0123',
          );
          return <String, dynamic>{
            'documentId': 'owner-1',
            'approvalStatus': 'approved',
            'profileVersion': 5,
          };
        },
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: service,
        loadAccount: (uid) async => account,
        submitNameChangeRequest:
            ({
              required userId,
              required currentRestaurantName,
              required requestedRestaurantName,
            }) async {
              nameRequests.add((
                userId: userId,
                currentName: currentRestaurantName,
                requestedName: requestedRestaurantName,
              ));
            },
      );
      await _expandSection(tester, 'Basic Restaurant Information');

      await tester.tap(find.text('Request Name Change'));
      await tester.pumpAndSettle();
      await tester.enterText(
        _fieldWithLabel('Requested Restaurant Name'),
        '  APPROVED   CAFE TWO  ',
      );

      await tester.enterText(_fieldWithLabel('Phone Number'), '3525550123');
      final saveButton = find.widgetWithText(
        ElevatedButton,
        'Save Basic Information',
      );
      await tester.ensureVisible(saveButton);
      await tester.tap(saveButton);
      await tester.pumpAndSettle();

      final profile = lifecyclePayload!['profile'] as Map<String, dynamic>;
      expect(profile['restaurantName'], 'Approved Cafe');
      expect(profile['restaurantName'], isNot('APPROVED CAFE TWO'));
      expect(nameRequests, isEmpty);
      expect(
        _fieldText(tester, 'Requested Restaurant Name'),
        '  APPROVED   CAFE TWO  ',
      );

      final submitRequest = find.widgetWithText(FilledButton, 'Submit Request');
      await tester.ensureVisible(submitRequest);
      await tester.tap(submitRequest);
      await tester.pumpAndSettle();

      expect(nameRequests, hasLength(1));
      expect(nameRequests.single.userId, 'owner-1');
      expect(nameRequests.single.currentName, 'Approved Cafe');
      expect(nameRequests.single.requestedName, 'APPROVED   CAFE TWO');
      expect(find.text('Approved Cafe'), findsWidgets);
    },
  );

  testWidgets(
    'failed name request retains proposal and cannot replace approved name',
    (tester) async {
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) async => _approvedAccount(),
        submitNameChangeRequest:
            ({
              required userId,
              required currentRestaurantName,
              required requestedRestaurantName,
            }) async {
              throw Exception('[private] write failure');
            },
      );
      await _expandSection(tester, 'Basic Restaurant Information');

      await tester.tap(find.text('Request Name Change'));
      await tester.pumpAndSettle();
      await tester.enterText(
        _fieldWithLabel('Requested Restaurant Name'),
        'Proposed Cafe',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Submit Request'));
      await tester.pumpAndSettle();

      expect(_fieldText(tester, 'Requested Restaurant Name'), 'Proposed Cafe');
      expect(find.text('Approved Cafe'), findsWidgets);
      expect(find.textContaining('private write failure'), findsNothing);
      expect(
        find.text('Could not submit the name change request right now.'),
        findsOneWidget,
      );
    },
  );

  testWidgets('case-only name changes cannot bypass name approval', (
    tester,
  ) async {
    var submissions = 0;
    await _pumpApplicationScreen(
      tester,
      loadAccount: (uid) async => _approvedAccount(),
      submitNameChangeRequest:
          ({
            required userId,
            required currentRestaurantName,
            required requestedRestaurantName,
          }) async {
            submissions += 1;
          },
    );
    await _expandSection(tester, 'Basic Restaurant Information');

    await tester.tap(find.text('Request Name Change'));
    await tester.pumpAndSettle();
    await tester.enterText(
      _fieldWithLabel('Requested Restaurant Name'),
      '  approved   cafe  ',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Submit Request'));
    await tester.pumpAndSettle();

    expect(submissions, 0);
    expect(
      find.text('Please enter a different restaurant name.'),
      findsOneWidget,
    );
    expect(find.text('Approved Cafe'), findsWidgets);
  });

  testWidgets(
    'failed and stale owner saves retain form data and bind retry IDs exactly',
    (tester) async {
      final requestIds = <String>[];
      var requestSequence = 0;
      var calls = 0;
      final service = BiteSaverRestaurantLifecycleService(
        requestIdGenerator: () => 'owner-retry-${++requestSequence}',
        invokeCallable: (name, payload) async {
          calls += 1;
          requestIds.add(payload['requestId'] as String);
          if (calls == 1) {
            throw const BiteSaverCallableFailure(
              'not-found',
              'No matching address',
            );
          }
          if (calls == 2) {
            throw const BiteSaverCallableFailure(
              'unavailable',
              'raw provider details',
            );
          }
          throw const BiteSaverCallableFailure('aborted', 'raw newer profile');
        },
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: service,
        loadAccount: (uid) async => _approvedAccount(),
      );
      await _expandSection(tester, 'Basic Restaurant Information');
      await tester.enterText(
        _fieldWithLabel('Street Address'),
        '22 Retry Road',
      );
      await tester.enterText(_fieldWithLabel('City'), 'Retry City');
      await tester.enterText(_fieldWithLabel('State'), 'GA');
      await tester.enterText(_fieldWithLabel('ZIP Code'), '30303');
      await tester.enterText(_fieldWithLabel('Phone Number'), '3525550144');
      await tester.enterText(
        _fieldWithLabel('Website'),
        'https://retry.example',
      );
      await tester.enterText(_fieldWithLabel('Short Bio'), 'Retry biography');

      Future<void> save() async {
        final button = find.widgetWithText(
          ElevatedButton,
          'Save Basic Information',
        );
        await tester.ensureVisible(button);
        await tester.tap(button);
        await tester.pumpAndSettle();
      }

      await save();
      expect(
        find.text(
          'No matching restaurant address was found. Check it and try again.',
        ),
        findsOneWidget,
      );
      expect(_fieldText(tester, 'Street Address'), '22 Retry Road');
      expect(_fieldText(tester, 'City'), 'Retry City');
      expect(_fieldText(tester, 'State'), 'GA');
      expect(_fieldText(tester, 'ZIP Code'), '30303');
      expect(_fieldText(tester, 'Phone Number'), '(352) 555-0144');
      expect(_fieldText(tester, 'Website'), 'https://retry.example');
      expect(_fieldText(tester, 'Short Bio'), 'Retry biography');

      await save();
      expect(requestIds[1], requestIds[0]);
      expect(
        find.text(
          'Restaurant address validation is temporarily unavailable. Try again.',
        ),
        findsOneWidget,
      );
      expect(_fieldText(tester, 'Street Address'), '22 Retry Road');
      expect(_fieldText(tester, 'City'), 'Retry City');
      expect(_fieldText(tester, 'State'), 'GA');
      expect(_fieldText(tester, 'ZIP Code'), '30303');
      expect(_fieldText(tester, 'Phone Number'), '(352) 555-0144');
      expect(_fieldText(tester, 'Short Bio'), 'Retry biography');

      await tester.enterText(
        _fieldWithLabel('Website'),
        'https://changed.example',
      );
      await save();

      expect(requestIds[2], isNot(requestIds[1]));
      expect(
        find.text(
          'The restaurant profile changed. Reload the latest version and try again.',
        ),
        findsOneWidget,
      );
      expect(_fieldText(tester, 'Phone Number'), '(352) 555-0144');
      expect(_fieldText(tester, 'Website'), 'https://changed.example');
      expect(_fieldText(tester, 'Street Address'), '22 Retry Road');
      expect(_fieldText(tester, 'City'), 'Retry City');
      expect(_fieldText(tester, 'State'), 'GA');
      expect(_fieldText(tester, 'ZIP Code'), '30303');
      expect(_fieldText(tester, 'Short Bio'), 'Retry biography');
      expect(requestSequence, 2);
    },
  );

  testWidgets(
    'concurrent owner edits are not overwritten by authoritative reload',
    (tester) async {
      final pendingSave = Completer<Object?>();
      final invocations = <Map<String, dynamic>>[];
      var account = _approvedAccount();
      final service = BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) {
          invocations.add(Map<String, dynamic>.from(payload));
          if (invocations.length == 1) {
            return pendingSave.future;
          }
          account = _approvedAccount(
            profileVersion: 6,
            phone: '(352) 555-0166',
            website: 'https://authoritative.example',
          );
          return Future<Object?>.value(<String, dynamic>{
            'documentId': 'owner-1',
            'approvalStatus': 'approved',
            'profileVersion': 6,
          });
        },
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: service,
        loadAccount: (uid) async => account,
      );
      await _expandSection(tester, 'Basic Restaurant Information');
      await tester.enterText(_fieldWithLabel('Phone Number'), '3525550155');
      final saveButton = find.widgetWithText(
        ElevatedButton,
        'Save Basic Information',
      );
      await tester.ensureVisible(saveButton);
      final firstSave = tester.widget<ElevatedButton>(saveButton).onPressed!;
      firstSave();
      firstSave();
      await tester.pump();
      expect(invocations, hasLength(1));

      await tester.enterText(_fieldWithLabel('Phone Number'), '3525550166');
      account = _approvedAccount(
        profileVersion: 5,
        phone: '(352) 555-0155',
        website: 'https://authoritative.example',
      );
      pendingSave.complete(<String, dynamic>{
        'documentId': 'owner-1',
        'approvalStatus': 'approved',
        'profileVersion': 5,
      });
      await tester.pumpAndSettle();

      expect(_fieldText(tester, 'Phone Number'), '(352) 555-0166');
      expect(_fieldText(tester, 'Website'), 'https://authoritative.example');
      expect(find.text('Restaurant profile saved.'), findsOneWidget);

      final secondSaveButton = find.widgetWithText(
        ElevatedButton,
        'Save Basic Information',
      );
      await tester.ensureVisible(secondSaveButton);
      await tester.tap(secondSaveButton);
      await tester.pumpAndSettle();

      expect(invocations, hasLength(2));
      expect(invocations[1]['expectedProfileVersion'], 5);
      final secondProfile = invocations[1]['profile'] as Map<String, dynamic>;
      expect(secondProfile['phone'], '(352) 555-0166');
      expect(secondProfile['website'], 'https://authoritative.example');
      expect(_fieldText(tester, 'Phone Number'), '(352) 555-0166');
      expect(_fieldText(tester, 'Website'), 'https://authoritative.example');
    },
  );

  testWidgets(
    'server-backed owner save and authoritative reload enable posting readiness',
    (tester) async {
      var account = _approvedAccount()
        ..[Restaurant.fieldAddressFingerprint] = null
        ..[Restaurant.fieldLocationVersion] = 0
        ..[Restaurant.fieldLocationValidatedAt] = null;
      final service = BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          account = _approvedAccount(profileVersion: 5);
          return <String, dynamic>{
            'documentId': 'owner-1',
            'approvalStatus': 'approved',
            'profileVersion': 5,
          };
        },
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: service,
        loadAccount: (uid) async => account,
      );
      await _expandSection(tester, 'Basic Restaurant Information');
      final saveButton = find.widgetWithText(
        ElevatedButton,
        'Save Basic Information',
      );
      await tester.ensureVisible(saveButton);
      await tester.tap(saveButton);
      await tester.pumpAndSettle();

      await _expandSection(tester, 'Coupon Management');
      final createButton = find.widgetWithText(ElevatedButton, 'Create Coupon');
      await tester.ensureVisible(createButton);
      await tester.tap(createButton);
      await tester.pumpAndSettle();

      expect(find.text('Coupon title is required.'), findsWidgets);
      expect(find.textContaining('validate its address'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  for (final scenario
      in <
        ({
          String name,
          void Function(Map<String, dynamic>) mutate,
          bool editAddress,
          bool incompleteAddress,
          void Function()? prepareLocalProfile,
        })
      >[
        (
          name: 'missing coordinates',
          mutate: (data) => data[Restaurant.fieldLatitude] = null,
          editAddress: false,
          incompleteAddress: false,
          prepareLocalProfile: null,
        ),
        (
          name: 'missing street',
          mutate: (data) => data[Restaurant.fieldStreetAddress] = '',
          editAddress: false,
          incompleteAddress: true,
          prepareLocalProfile: null,
        ),
        (
          name: 'missing city',
          mutate: (data) => data[Restaurant.fieldCity] = '',
          editAddress: false,
          incompleteAddress: true,
          prepareLocalProfile: () {
            LocalRestaurantProfileStore.updateProfile(
              LocalRestaurantProfileStore.profile.value.copyWith(city: ''),
            );
          },
        ),
        (
          name: 'missing state',
          mutate: (data) => data[Restaurant.fieldState] = '',
          editAddress: false,
          incompleteAddress: true,
          prepareLocalProfile: () {
            LocalRestaurantProfileStore.updateProfile(
              LocalRestaurantProfileStore.profile.value.copyWith(state: ''),
            );
          },
        ),
        (
          name: 'missing ZIP',
          mutate: (data) => data[Restaurant.fieldZipCode] = '',
          editAddress: false,
          incompleteAddress: true,
          prepareLocalProfile: () {
            LocalRestaurantProfileStore.updateProfile(
              LocalRestaurantProfileStore.profile.value.copyWith(zipCode: ''),
            );
          },
        ),
        (
          name: 'invalid coordinates',
          mutate: (data) => data[Restaurant.fieldLatitude] = 91,
          editAddress: false,
          incompleteAddress: false,
          prepareLocalProfile: null,
        ),
        (
          name: 'nonfinite latitude',
          mutate: (data) => data[Restaurant.fieldLatitude] = double.nan,
          editAddress: false,
          incompleteAddress: false,
          prepareLocalProfile: null,
        ),
        (
          name: 'nonfinite longitude',
          mutate: (data) => data[Restaurant.fieldLongitude] = double.infinity,
          editAddress: false,
          incompleteAddress: false,
          prepareLocalProfile: null,
        ),
        (
          name: 'exact origin',
          mutate: (data) {
            data[Restaurant.fieldLatitude] = 0;
            data[Restaurant.fieldLongitude] = 0;
          },
          editAddress: false,
          incompleteAddress: false,
          prepareLocalProfile: null,
        ),
        (
          name: 'missing fingerprint',
          mutate: (data) => data[Restaurant.fieldAddressFingerprint] = null,
          editAddress: false,
          incompleteAddress: false,
          prepareLocalProfile: null,
        ),
        (
          name: 'missing validation timestamp',
          mutate: (data) => data[Restaurant.fieldLocationValidatedAt] = null,
          editAddress: false,
          incompleteAddress: false,
          prepareLocalProfile: null,
        ),
        (
          name: 'malformed validation timestamp',
          mutate: (data) =>
              data[Restaurant.fieldLocationValidatedAt] = 'not-a-timestamp',
          editAddress: false,
          incompleteAddress: false,
          prepareLocalProfile: null,
        ),
        (
          name: 'unsupported validation timestamp shape',
          mutate: (data) => data[Restaurant.fieldLocationValidatedAt] = {
            'seconds': 1784764800,
          },
          editAddress: false,
          incompleteAddress: false,
          prepareLocalProfile: null,
        ),
        (
          name: 'missing source',
          mutate: (data) => data.remove(Restaurant.fieldLocationSource),
          editAddress: false,
          incompleteAddress: false,
          prepareLocalProfile: null,
        ),
        (
          name: 'empty source',
          mutate: (data) => data[Restaurant.fieldLocationSource] = '',
          editAddress: false,
          incompleteAddress: false,
          prepareLocalProfile: null,
        ),
        (
          name: 'untrusted source',
          mutate: (data) => data[Restaurant.fieldLocationSource] = 'client',
          editAddress: false,
          incompleteAddress: false,
          prepareLocalProfile: null,
        ),
        (
          name: 'nonpositive location version',
          mutate: (data) => data[Restaurant.fieldLocationVersion] = 0,
          editAddress: false,
          incompleteAddress: false,
          prepareLocalProfile: null,
        ),
        (
          name: 'unsaved address mismatch',
          mutate: (data) {},
          editAddress: true,
          incompleteAddress: false,
          prepareLocalProfile: null,
        ),
      ]) {
    testWidgets(
      'posting readiness blocks ${scenario.name} without coordinate repair',
      (tester) async {
        scenario.prepareLocalProfile?.call();
        final account = _approvedAccount();
        scenario.mutate(account);
        var accountLoads = 0;
        var lifecycleCalls = 0;
        await _pumpApplicationScreen(
          tester,
          lifecycleService: BiteSaverRestaurantLifecycleService(
            invokeCallable: (name, payload) async {
              lifecycleCalls += 1;
              throw StateError('No lifecycle callable was expected.');
            },
          ),
          loadAccount: (uid) async {
            accountLoads += 1;
            return account;
          },
        );

        await _expandSection(tester, 'Basic Restaurant Information');
        if (scenario.editAddress) {
          await tester.enterText(
            _fieldWithLabel('Street Address'),
            '2 Unsaved Street',
          );
        }
        const profileFieldLabels = <String>[
          'Street Address',
          'City',
          'State',
          'ZIP Code',
          'Phone Number',
          'Email Address',
          'Website',
          'Short Bio',
        ];
        final expectedProfileValues = <String, String>{
          for (final label in profileFieldLabels)
            label: _fieldText(tester, label),
        };

        await _expandSection(tester, 'Coupon Management');
        await tester.enterText(
          _fieldWithLabel('Coupon Title'),
          'Keep this typed coupon',
        );
        await tester.enterText(
          _fieldWithLabel('Coupon Description (Optional)'),
          'Keep these typed details',
        );
        await tester.enterText(
          _fieldWithLabel('Optional Coupon Code'),
          'KEEP123',
        );
        final createButton = find.widgetWithText(
          ElevatedButton,
          'Create Coupon',
        );
        await tester.ensureVisible(createButton);
        await tester.tap(createButton);
        await tester.pumpAndSettle();

        expect(
          accountLoads,
          scenario.incompleteAddress ? 2 : 3,
          reason: scenario.name,
        );
        expect(lifecycleCalls, 0, reason: scenario.name);
        expect(find.text('Coupon title is required.'), findsNothing);
        expect(find.text('Coupon end time is required.'), findsNothing);
        expect(
          find.text(
            scenario.incompleteAddress
                ? 'Please complete your restaurant address before posting coupons or daily specials.'
                : scenario.editAddress
                ? 'Your restaurant profile has unsaved changes. Save and validate it before posting.'
                : 'Save the restaurant profile to validate its address before posting.',
          ),
          findsOneWidget,
        );
        expect(_fieldText(tester, 'Coupon Title'), 'Keep this typed coupon');
        expect(
          _fieldText(tester, 'Coupon Description (Optional)'),
          'Keep these typed details',
        );
        expect(_fieldText(tester, 'Optional Coupon Code'), 'KEEP123');
        for (final entry in expectedProfileValues.entries) {
          expect(
            _fieldText(tester, entry.key),
            entry.value,
            reason: '${scenario.name}: ${entry.key}',
          );
        }
        expect(find.byType(AlertDialog), findsNothing);
        expect(find.text('Coupon Created'), findsNothing);
        expect(find.text('Coupon Updated'), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('initial account load may complete after disposal safely', (
    tester,
  ) async {
    final pendingLoad = Completer<Map<String, dynamic>?>();
    await _pumpApplicationScreen(
      tester,
      loadAccount: (uid) => pendingLoad.future,
      settle: false,
    );

    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    pendingLoad.complete(_approvedAccount());
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('application submission may complete after disposal safely', (
    tester,
  ) async {
    final pendingSave = Completer<Object?>();
    final service = BiteSaverRestaurantLifecycleService(
      invokeCallable: (name, payload) => pendingSave.future,
    );
    await _pumpApplicationScreen(
      tester,
      lifecycleService: service,
      loadAccount: (uid) async => null,
    );
    await tester.enterText(_fieldWithLabel('Restaurant Name'), 'New Cafe');
    await tester.enterText(_fieldWithLabel('Street Address'), '1 Main Street');
    await tester.enterText(_fieldWithLabel('City'), 'Crystal River');
    await tester.enterText(_fieldWithLabel('State'), 'FL');
    await tester.enterText(_fieldWithLabel('ZIP Code'), '34428');
    await tester.enterText(_fieldWithLabel('Phone Number'), '3525550100');
    final applyButton = find.widgetWithText(
      FilledButton,
      'Apply for a restaurant account',
    );
    await tester.ensureVisible(applyButton);
    await tester.tap(applyButton);
    await tester.pump();

    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    pendingSave.complete(<String, dynamic>{
      'documentId': 'owner-1',
      'approvalStatus': 'pending',
      'profileVersion': 1,
    });
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.byType(SnackBar), findsNothing);
  });

  for (final failure in <bool>[false, true]) {
    testWidgets(
      'owner save ${failure ? 'failure' : 'success'} may complete after disposal safely',
      (tester) async {
        final pendingSave = Completer<Object?>();
        final service = BiteSaverRestaurantLifecycleService(
          invokeCallable: (name, payload) => pendingSave.future,
        );
        await _pumpApplicationScreen(
          tester,
          lifecycleService: service,
          loadAccount: (uid) async => _approvedAccount(),
        );
        await _expandSection(tester, 'Basic Restaurant Information');
        final saveButton = find.widgetWithText(
          ElevatedButton,
          'Save Basic Information',
        );
        await tester.ensureVisible(saveButton);
        await tester.tap(saveButton);
        await tester.pump();

        await tester.pumpWidget(const MaterialApp(home: SizedBox()));
        if (failure) {
          pendingSave.completeError(
            const BiteSaverCallableFailure(
              'unavailable',
              'raw provider details',
            ),
          );
        } else {
          pendingSave.complete(<String, dynamic>{
            'documentId': 'owner-1',
            'approvalStatus': 'approved',
            'profileVersion': 5,
          });
        }
        await tester.pump();

        expect(tester.takeException(), isNull);
        expect(find.byType(SnackBar), findsNothing);
      },
    );
  }

  testWidgets('authoritative owner reload may complete after disposal safely', (
    tester,
  ) async {
    final pendingReload = Completer<Map<String, dynamic>?>();
    var loads = 0;
    final service = BiteSaverRestaurantLifecycleService(
      invokeCallable: (name, payload) async => <String, dynamic>{
        'documentId': 'owner-1',
        'approvalStatus': 'approved',
        'profileVersion': 5,
      },
    );
    await _pumpApplicationScreen(
      tester,
      lifecycleService: service,
      loadAccount: (uid) {
        loads += 1;
        return loads == 1
            ? Future<Map<String, dynamic>?>.value(_approvedAccount())
            : pendingReload.future;
      },
    );
    await _expandSection(tester, 'Basic Restaurant Information');
    final saveButton = find.widgetWithText(
      ElevatedButton,
      'Save Basic Information',
    );
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    for (var i = 0; i < 4 && loads < 2; i += 1) {
      await tester.pump();
    }
    expect(loads, 2);

    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    pendingReload.complete(_approvedAccount(profileVersion: 5));
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets(
    'posting-readiness account load may complete after disposal safely',
    (tester) async {
      final pendingReadiness = Completer<Map<String, dynamic>?>();
      var loads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) {
          loads += 1;
          if (loads < 3) {
            return Future<Map<String, dynamic>?>.value(_approvedAccount());
          }
          return pendingReadiness.future;
        },
      );
      await _expandSection(tester, 'Coupon Management');
      final createButton = find.widgetWithText(ElevatedButton, 'Create Coupon');
      await tester.ensureVisible(createButton);
      await tester.tap(createButton);
      for (var i = 0; i < 5 && loads < 3; i += 1) {
        await tester.pump();
      }
      expect(loads, 3);

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      pendingReadiness.complete(_approvedAccount());
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(find.byType(SnackBar), findsNothing);
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets(
    'subscription refresh completion after disposal does not mutate screen state',
    (tester) async {
      final pendingRefresh = Completer<Map<String, dynamic>?>();
      final refreshTransitions = <bool>[];
      var accountLoads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) {
          accountLoads += 1;
          return accountLoads == 1
              ? Future<Map<String, dynamic>?>.value(_approvedAccount())
              : pendingRefresh.future;
        },
        onSubscriptionRefreshStateChanged: refreshTransitions.add,
      );
      expect(accountLoads, 1);

      await _triggerAppResume(tester);
      expect(accountLoads, 2);
      expect(refreshTransitions, <bool>[true]);

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      pendingRefresh.complete(_approvedAccount());
      await tester.pump();

      expect(accountLoads, 2);
      expect(refreshTransitions, <bool>[true]);
      expect(tester.takeException(), isNull);
      expect(find.byType(SnackBar), findsNothing);
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  for (final failure in <bool>[false, true]) {
    testWidgets(
      'mounted subscription refresh ${failure ? 'failure' : 'success'} clears duplicate suppression',
      (tester) async {
        final pendingRefresh = Completer<Map<String, dynamic>?>();
        final refreshTransitions = <bool>[];
        var accountLoads = 0;
        await _pumpApplicationScreen(
          tester,
          loadAccount: (uid) {
            accountLoads += 1;
            if (accountLoads == 1) {
              return Future<Map<String, dynamic>?>.value(_approvedAccount());
            }
            if (accountLoads == 2) {
              return pendingRefresh.future;
            }
            return Future<Map<String, dynamic>?>.value(_approvedAccount());
          },
          onSubscriptionRefreshStateChanged: refreshTransitions.add,
        );

        await _triggerAppResume(tester);
        expect(accountLoads, 2);
        expect(refreshTransitions, <bool>[true]);
        await _triggerAppResume(tester);
        expect(accountLoads, 2);
        expect(refreshTransitions, <bool>[true]);

        if (failure) {
          pendingRefresh.completeError(StateError('test refresh failure'));
        } else {
          pendingRefresh.complete(_approvedAccount());
        }
        await tester.pump();
        await tester.pump();
        expect(refreshTransitions, <bool>[true, false]);

        await _triggerAppResume(tester);
        expect(accountLoads, 3);
        expect(refreshTransitions, <bool>[true, false, true, false]);
        expect(tester.takeException(), isNull);
        expect(find.byType(SnackBar), findsNothing);
        expect(find.byType(AlertDialog), findsNothing);
      },
    );
  }

  testWidgets(
    'daily-special save completion after disposal does not start refresh',
    (tester) async {
      final pendingSave = Completer<void>();
      var saves = 0;
      var specialLoads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) async => _approvedAccount(),
        loadDailySpecials: (uid) async {
          specialLoads += 1;
          return const <DailySpecial>[];
        },
        createDailySpecial: ({required uid, required dailySpecial}) {
          saves += 1;
          return pendingSave.future;
        },
      );
      expect(specialLoads, 1);

      await _startDailySpecialSave(tester, title: 'Dispose before save');
      for (var i = 0; i < 5 && saves < 1; i += 1) {
        await tester.pump();
      }
      expect(saves, 1);

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      pendingSave.complete();
      await tester.pump();

      expect(specialLoads, 1);
      expect(tester.takeException(), isNull);
      expect(find.byType(SnackBar), findsNothing);
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets(
    'daily-special refresh completion after disposal does not mutate UI',
    (tester) async {
      final pendingRefresh = Completer<List<DailySpecial>>();
      var specialLoads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) async => _approvedAccount(),
        loadDailySpecials: (uid) {
          specialLoads += 1;
          return specialLoads == 1
              ? Future<List<DailySpecial>>.value(const <DailySpecial>[])
              : pendingRefresh.future;
        },
        createDailySpecial: ({required uid, required dailySpecial}) async {},
      );

      await _startDailySpecialSave(tester, title: 'Dispose during refresh');
      for (var i = 0; i < 6 && specialLoads < 2; i += 1) {
        await tester.pump();
      }
      expect(specialLoads, 2);

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      pendingRefresh.complete(const <DailySpecial>[]);
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(find.byType(SnackBar), findsNothing);
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets(
    'daily-special save failure after disposal does not access context',
    (tester) async {
      final pendingSave = Completer<void>();
      var saves = 0;
      var specialLoads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) async => _approvedAccount(),
        loadDailySpecials: (uid) async {
          specialLoads += 1;
          return const <DailySpecial>[];
        },
        createDailySpecial: ({required uid, required dailySpecial}) {
          saves += 1;
          return pendingSave.future;
        },
      );

      await _startDailySpecialSave(tester, title: 'Disposed failure');
      for (var i = 0; i < 5 && saves < 1; i += 1) {
        await tester.pump();
      }
      expect(saves, 1);

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      pendingSave.completeError(StateError('test save failure'));
      await tester.pump();

      expect(specialLoads, 1);
      expect(tester.takeException(), isNull);
      expect(find.byType(SnackBar), findsNothing);
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets(
    'mounted daily-special save refreshes once and suppresses duplicates',
    (tester) async {
      final pendingSave = Completer<void>();
      var saves = 0;
      var specialLoads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) async => _approvedAccount(),
        loadDailySpecials: (uid) async {
          specialLoads += 1;
          return specialLoads == 1
              ? const <DailySpecial>[]
              : const <DailySpecial>[
                  DailySpecial(
                    id: 'special-1',
                    restaurantId: 'owner-1',
                    ownerUid: 'owner-1',
                    title: 'Mounted Special',
                  ),
                ];
        },
        createDailySpecial: ({required uid, required dailySpecial}) {
          saves += 1;
          return pendingSave.future;
        },
      );

      final save = await _dailySpecialSaveCallback(
        tester,
        title: 'Mounted Special',
      );
      save();
      save();
      for (var i = 0; i < 5 && saves < 1; i += 1) {
        await tester.pump();
      }
      expect(saves, 1);
      expect(
        tester
            .widget<ElevatedButton>(
              find.widgetWithText(ElevatedButton, 'Saving...'),
            )
            .onPressed,
        isNull,
      );

      pendingSave.complete();
      for (var i = 0; i < 6 && specialLoads < 2; i += 1) {
        await tester.pump();
      }
      await tester.pump();

      expect(saves, 1);
      expect(specialLoads, 2);
      expect(find.text('Mounted Special'), findsOneWidget);
      expect(find.text('Daily special created.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}

Future<void> _triggerAppResume(WidgetTester tester) async {
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  await tester.pump();
}

Future<void> _startDailySpecialSave(
  WidgetTester tester, {
  required String title,
}) async {
  final save = await _dailySpecialSaveCallback(tester, title: title);
  save();
  await tester.pump();
}

Future<VoidCallback> _dailySpecialSaveCallback(
  WidgetTester tester, {
  required String title,
}) async {
  await _expandSection(tester, 'Daily Specials');
  await tester.enterText(_fieldWithLabel('Title'), title);
  final saveButton = find.widgetWithText(ElevatedButton, 'Save Daily Special');
  await tester.ensureVisible(saveButton);
  return tester.widget<ElevatedButton>(saveButton).onPressed!;
}

Future<void> _pumpApplicationScreen(
  WidgetTester tester, {
  BiteSaverRestaurantLifecycleService? lifecycleService,
  required Future<Map<String, dynamic>?> Function(String uid) loadAccount,
  Future<List<Coupon>> Function(String uid)? loadCoupons,
  Future<List<DailySpecial>> Function(String uid)? loadDailySpecials,
  DailySpecialSaver? createDailySpecial,
  DailySpecialSaver? updateDailySpecial,
  RestaurantNameChangeSubmitter? submitNameChangeRequest,
  ValueChanged<bool>? onSubscriptionRefreshStateChanged,
  bool settle = true,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(900, 1400);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);

  await tester.pumpWidget(
    MaterialApp(
      home: RestaurantCreateCouponScreen(
        lifecycleService:
            lifecycleService ??
            BiteSaverRestaurantLifecycleService(
              invokeCallable: (name, payload) async {
                throw StateError('No callable was expected.');
              },
            ),
        loadAccount: loadAccount,
        loadCoupons: loadCoupons ?? (uid) async => const <Coupon>[],
        loadDailySpecials:
            loadDailySpecials ?? (uid) async => const <DailySpecial>[],
        createDailySpecial: createDailySpecial,
        updateDailySpecial: updateDailySpecial,
        loadMenuRoutingState: () async => const BiteSaverMenuRoutingState(
          usesBiteRater: false,
          matchedBiteScoreRestaurant: null,
          isAlreadyUsedByOtherSide: false,
        ),
        submitNameChangeRequest: submitNameChangeRequest,
        onSubscriptionRefreshStateChanged: onSubscriptionRefreshStateChanged,
        testCurrentUser: _TestUser(),
      ),
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
}

Future<void> _expandSection(WidgetTester tester, String title) async {
  final sectionTitle = find.text(title);
  await tester.ensureVisible(sectionTitle);
  await tester.tap(sectionTitle);
  await tester.pumpAndSettle();
}

Finder _fieldWithLabel(String label) {
  return find.byWidgetPredicate(
    (widget) => widget is TextField && widget.decoration?.labelText == label,
  );
}

String _fieldText(WidgetTester tester, String label) {
  return tester.widget<TextField>(_fieldWithLabel(label)).controller!.text;
}

Map<String, dynamic> _submittedAccount() {
  return <String, dynamic>{
    Restaurant.fieldUid: 'owner-1',
    Restaurant.fieldEmail: 'owner@example.com',
    Restaurant.fieldName: 'Legacy Cafe',
    Restaurant.fieldStreetAddress: '10 Old Road',
    Restaurant.fieldCity: 'Lecanto',
    Restaurant.fieldState: 'FL',
    Restaurant.fieldZipCode: '34461',
    Restaurant.fieldPhone: '(352) 555-0110',
    Restaurant.fieldProfileVersion: 1,
    Restaurant.fieldApprovalStatus: 'pending',
    'couponApplicationSubmitted': true,
  };
}

Map<String, dynamic> _approvedAccount({
  int profileVersion = 4,
  double? latitude = 28.8517,
  double? longitude = -82.487,
  String? addressFingerprint,
  int locationVersion = 2,
  Object? locationValidatedAt,
  String? locationSource = 'google_geocoding',
  String streetAddress = '1 Main Street',
  String city = 'Crystal River',
  String state = 'FL',
  String zipCode = '34428',
  String phone = '(352) 555-0100',
  String website = 'https://approved.example',
  String bio = 'Approved profile',
}) {
  return <String, dynamic>{
    Restaurant.fieldUid: 'owner-1',
    Restaurant.fieldEmail: 'owner@example.com',
    Restaurant.fieldName: 'Approved Cafe',
    Restaurant.fieldStreetAddress: streetAddress,
    Restaurant.fieldCity: city,
    Restaurant.fieldState: state,
    Restaurant.fieldZipCode: zipCode,
    Restaurant.fieldPhone: phone,
    Restaurant.fieldWebsite: website,
    Restaurant.fieldBio: bio,
    Restaurant.fieldProfileVersion: profileVersion,
    Restaurant.fieldApprovalStatus: 'approved',
    'couponApplicationSubmitted': true,
    'subscriptionStatus': 'active',
    Restaurant.fieldLatitude: latitude,
    Restaurant.fieldLongitude: longitude,
    Restaurant.fieldAddressFingerprint:
        addressFingerprint ?? List<String>.filled(64, 'a').join(),
    Restaurant.fieldLocationVersion: locationVersion,
    Restaurant.fieldLocationValidatedAt:
        locationValidatedAt ?? Timestamp.fromDate(DateTime.utc(2026, 7, 23)),
    Restaurant.fieldLocationSource: locationSource,
  };
}

void _expectNoTrustedLocationFields(Map<String, dynamic> payload) {
  const forbidden = <String>{
    'uid',
    'email',
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
    'locationVersion',
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

void _expectNoNullWireValues(Object? value) {
  expect(value, isNotNull);
  if (value is Map) {
    for (final entry in value.entries) {
      _expectNoNullWireValues(entry.key);
      _expectNoNullWireValues(entry.value);
    }
  } else if (value is Iterable) {
    for (final item in value) {
      _expectNoNullWireValues(item);
    }
  }
}

class _TestUser extends Fake implements User {
  @override
  String get uid => 'owner-1';

  @override
  String? get email => 'owner@example.com';

  @override
  bool get emailVerified => true;

  @override
  bool get isAnonymous => false;

  @override
  List<UserInfo> get providerData => const <UserInfo>[];
}
