import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/daily_special.dart';
import 'package:coupon_app/models/local_coupon_store.dart';
import 'package:coupon_app/models/local_restaurant_profile_store.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/screens/restaurant_auth_screen.dart';
import 'package:coupon_app/screens/restaurant_create_coupon_screen.dart';
import 'package:coupon_app/services/bitesaver_image_upload_service.dart';
import 'package:coupon_app/services/bitesaver_restaurant_lifecycle_service.dart';
import 'package:coupon_app/services/subscription_checkout_service.dart';
import 'package:coupon_app/services/subscription_return_service.dart';
import 'package:coupon_app/widgets/bitesaver_restaurant_images.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/subscription_return_test_backend.dart';

const SubscriptionReturnOwnerScope _defaultSubscriptionReturnOwnerScope =
    SubscriptionReturnOwnerScope(uid: 'owner-1', accountDocumentId: 'owner-1');
var _subscriptionReturnDeliverySequence = 0;
late FakeSubscriptionReturnBackend _subscriptionReturnBackend;

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    _subscriptionReturnDeliverySequence = 0;
    _subscriptionReturnBackend = FakeSubscriptionReturnBackend();
    await installFakeSubscriptionReturnService(_subscriptionReturnBackend);
    LocalRestaurantProfileStore.resetProfile();
  });
  tearDown(() {
    LocalRestaurantProfileStore.resetProfile();
  });

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
      expect(payload['updateSection'], 'basicInformation');
      expect(payload['expectedProfileVersion'], 4);
      expect(payload['expectedLocationVersion'], 2);
      expect(payload['requestId'], 'owner-1');
      expect(payload, isNot(contains('documentId')));
      final profile = payload['profile'] as Map<String, dynamic>;
      expect(profile.keys.toSet(), <String>{
        'streetAddress',
        'city',
        'state',
        'zipCode',
        'phone',
        'website',
        'bio',
      });
      expect(profile['phone'], '(352) 555-0199');
      expect(profile['website'], '');
      expect(profile['bio'], '');
      expect(profile, isNot(contains('restaurantName')));
      expect(profile, isNot(contains('mainImageUrl')));
      expect(profile, isNot(contains('businessHours')));
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
        'locationVersion': 2,
      });
      await tester.pumpAndSettle();

      expect(invocations, hasLength(1));
      expect(requestSequence, 1);
      expect(find.text('Restaurant profile saved.'), findsOneWidget);
      expect(_fieldText(tester, 'Phone Number'), '(352) 555-0199');
    },
  );

  testWidgets('Basic save preserves custom Hours without sending them', (
    tester,
  ) async {
    final customHours = _customBusinessHours();
    Map<String, dynamic>? payload;
    var account = _approvedAccount(businessHours: customHours);
    final service = BiteSaverRestaurantLifecycleService(
      invokeCallable: (name, value) async {
        payload = Map<String, dynamic>.from(value);
        account = _approvedAccount(
          profileVersion: 5,
          phone: '(352) 555-0199',
          businessHours: customHours,
        );
        return <String, dynamic>{
          'documentId': 'owner-1',
          'approvalStatus': 'approved',
          'profileVersion': 5,
          'locationVersion': 2,
        };
      },
    );

    await _pumpApplicationScreen(
      tester,
      lifecycleService: service,
      loadAccount: (uid) async => account,
    );
    await _expandSection(tester, 'Hours');
    expect(find.textContaining('Sun: 10:00 AM - 4:00 PM'), findsOneWidget);

    await _expandSection(tester, 'Basic Restaurant Information');
    await tester.enterText(_fieldWithLabel('Phone Number'), '3525550199');
    final saveButton = find.widgetWithText(
      ElevatedButton,
      'Save Basic Information',
    );
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    await tester.pumpAndSettle();

    expect(payload?['updateSection'], 'basicInformation');
    final profile = payload?['profile'] as Map<String, dynamic>;
    expect(profile, isNot(contains('businessHours')));
    expect(profile, isNot(contains('mainImageUrl')));
    expect(find.textContaining('Sun: 10:00 AM - 4:00 PM'), findsOneWidget);
    expect(
      account[Restaurant.fieldBusinessHours],
      RestaurantBusinessHours.toFirestoreList(customHours),
    );
  });

  testWidgets(
    'opening default Hours is local-only and Basic never sends the defaults',
    (tester) async {
      final invocations = <Map<String, dynamic>>[];
      var account = _approvedAccount();
      final service = BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          invocations.add(Map<String, dynamic>.from(payload));
          account = _approvedAccount(profileVersion: 5);
          return <String, dynamic>{
            'documentId': 'owner-1',
            'approvalStatus': 'approved',
            'profileVersion': 5,
            'locationVersion': 2,
          };
        },
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: service,
        loadAccount: (uid) async => account,
      );
      await _expandSection(tester, 'Hours');
      expect(invocations, isEmpty);
      expect(find.text('Hours not set'), findsOneWidget);
      expect(invocations, isEmpty);

      await _expandSection(tester, 'Basic Restaurant Information');
      final saveButton = find.widgetWithText(
        ElevatedButton,
        'Save Basic Information',
      );
      await tester.ensureVisible(saveButton);
      await tester.tap(saveButton);
      await tester.pumpAndSettle();

      expect(invocations, hasLength(1));
      expect(invocations.single['updateSection'], 'basicInformation');
      expect(
        invocations.single['profile'] as Map<String, dynamic>,
        isNot(contains('businessHours')),
      );
      expect(account, isNot(contains(Restaurant.fieldBusinessHours)));
    },
  );

  testWidgets(
    'explicit Save Hours sends only exact Hours and concurrency metadata',
    (tester) async {
      final customHours = _customBusinessHours();
      Map<String, dynamic>? payload;
      var account = _approvedAccount(businessHours: customHours);
      final service = BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, value) async {
          payload = Map<String, dynamic>.from(value);
          account = _approvedAccount(
            profileVersion: 5,
            businessHours: customHours,
          );
          return <String, dynamic>{
            'documentId': 'owner-1',
            'approvalStatus': 'approved',
            'profileVersion': 5,
            'locationVersion': 2,
          };
        },
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: service,
        loadAccount: (uid) async => account,
      );
      await _expandSection(tester, 'Basic Restaurant Information');
      await tester.enterText(_fieldWithLabel('Phone Number'), '');
      await _expandSection(tester, 'Hours');

      final saveButton = find.widgetWithText(ElevatedButton, 'Save Hours');
      await tester.ensureVisible(saveButton);
      await tester.tap(saveButton);
      await tester.pumpAndSettle();

      expect(payload?['intent'], 'ownerUpdate');
      expect(payload?['updateSection'], 'businessHours');
      expect(payload?['expectedProfileVersion'], 4);
      expect(payload?['expectedLocationVersion'], 2);
      expect(payload?['requestId'], isA<String>());
      final profile = payload?['profile'] as Map<String, dynamic>;
      expect(profile.keys, <String>['businessHours']);
      final hours = profile['businessHours'] as List<dynamic>;
      expect(hours, hasLength(7));
      expect(hours.first, <String, dynamic>{
        'day': 'Sunday',
        'opensAt': '10:00 AM',
        'closesAt': '4:00 PM',
        'closed': false,
      });
      expect(_fieldText(tester, 'Phone Number'), isEmpty);
      _expectNoTrustedLocationFields(payload!);
    },
  );

  testWidgets('explicit Restaurant Image save has an image-only payload', (
    tester,
  ) async {
    final pickedImage = BiteSaverPickedImage(
      fileName: 'restaurant.png',
      bytes: _onePixelPng(),
    );
    final validatedImage = await _validatedRestaurantImage(tester, pickedImage);
    Map<String, dynamic>? payload;
    var account = _approvedAccount(
      mainImageUrl: 'https://images.example/restaurant.jpg',
    );
    final service = BiteSaverRestaurantLifecycleService(
      invokeCallable: (name, value) async {
        payload = Map<String, dynamic>.from(value);
        account = _approvedAccount(
          profileVersion: 5,
          mainImageUrl: 'https://images.example/restaurant.jpg',
        );
        return <String, dynamic>{
          'documentId': 'owner-1',
          'approvalStatus': 'approved',
          'profileVersion': 5,
          'locationVersion': 2,
        };
      },
    );

    await _pumpApplicationScreen(
      tester,
      lifecycleService: service,
      loadAccount: (uid) async => account,
      pickRestaurantImage: () async => pickedImage,
      validateRestaurantImage: (candidate) async {
        expect(identical(candidate, pickedImage), isTrue);
        return validatedImage;
      },
      uploadRestaurantImage: ({required uid, required validatedImage}) async =>
          const BiteSaverImageUploadResult(
            imageUrl: 'https://images.example/restaurant.jpg',
            storagePath: 'synthetic/restaurant.jpg',
          ),
    );
    await _expandSection(tester, 'Restaurant Image');
    await _tapRestaurantImagePicker(tester, 'Change restaurant image');
    final saveButton = find.widgetWithText(
      ElevatedButton,
      'Save Restaurant Image',
    );
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    await tester.pumpAndSettle();

    expect(payload?['updateSection'], 'mainImage');
    expect(payload?['expectedProfileVersion'], 4);
    expect(payload?['expectedLocationVersion'], 2);
    expect(payload?['profile'], <String, dynamic>{
      'mainImageUrl': 'https://images.example/restaurant.jpg',
    });
    expect(find.text('Restaurant image saved.'), findsOneWidget);
  });

  testWidgets(
    'production validator accepts supported images and rejects corrupt bytes',
    (tester) async {
      final invalidImages = <BiteSaverPickedImage>[
        BiteSaverPickedImage(
          fileName: 'corrupt.png',
          bytes: Uint8List.fromList(<int>[
            137,
            80,
            78,
            71,
            13,
            10,
            26,
            10,
            0,
            1,
          ]),
        ),
        BiteSaverPickedImage(
          fileName: 'corrupt.jpg',
          bytes: Uint8List.fromList(const <int>[0xff, 0xd8, 0xff, 0xe0, 0, 1]),
        ),
        BiteSaverPickedImage(
          fileName: 'text.jpg',
          bytes: Uint8List.fromList(utf8.encode('not an image')),
        ),
        BiteSaverPickedImage(fileName: 'empty.png', bytes: Uint8List(0)),
      ];

      for (final invalidImage in invalidImages) {
        final result = await tester.runAsync(
          () =>
              BiteSaverImageUploadService.validateRestaurantImage(invalidImage),
        );
        expect(result, isNull, reason: invalidImage.fileName);
      }

      for (final validImage in <BiteSaverPickedImage>[
        BiteSaverPickedImage(fileName: 'valid.png', bytes: _onePixelPng()),
        BiteSaverPickedImage(fileName: 'valid.jpg', bytes: _onePixelJpeg()),
      ]) {
        final result = await tester.runAsync(
          () => BiteSaverImageUploadService.validateRestaurantImage(validImage),
        );
        expect(result, isNotNull, reason: validImage.fileName);
        final validatedImage = result!;
        expect(validatedImage.wasValidatedFrom(validImage), isTrue);
        expect(
          identical(validatedImage.pickedImage.bytes, validImage.bytes),
          isFalse,
        );
        expect(
          validatedImage.pickedImage.bytes,
          orderedEquals(validImage.bytes),
        );
        expect(
          () => validatedImage.pickedImage.bytes[0] = 0,
          throwsUnsupportedError,
        );
      }
    },
  );

  testWidgets(
    'restaurant upload metadata follows validated bytes instead of filenames',
    (tester) async {
      final cases =
          <
            ({
              String name,
              String fileName,
              Uint8List Function() bytes,
              String extension,
              String contentType,
            })
          >[
            (
              name: 'matching PNG',
              fileName: 'restaurant.png',
              bytes: _onePixelPng,
              extension: 'png',
              contentType: 'image/png',
            ),
            (
              name: 'matching JPEG',
              fileName: 'restaurant.jpg',
              bytes: _onePixelJpeg,
              extension: 'jpg',
              contentType: 'image/jpeg',
            ),
            (
              name: 'uppercase PNG',
              fileName: 'restaurant.PNG',
              bytes: _onePixelPng,
              extension: 'png',
              contentType: 'image/png',
            ),
            (
              name: 'uppercase JPG',
              fileName: 'restaurant.JPG',
              bytes: _onePixelJpeg,
              extension: 'jpg',
              contentType: 'image/jpeg',
            ),
            (
              name: 'uppercase JPEG',
              fileName: 'restaurant.JPEG',
              bytes: _onePixelJpeg,
              extension: 'jpg',
              contentType: 'image/jpeg',
            ),
            (
              name: 'JPEG named PNG',
              fileName: 'restaurant.png',
              bytes: _onePixelJpeg,
              extension: 'jpg',
              contentType: 'image/jpeg',
            ),
            (
              name: 'PNG named JPEG',
              fileName: 'restaurant.jpg',
              bytes: _onePixelPng,
              extension: 'png',
              contentType: 'image/png',
            ),
            (
              name: 'PNG bytes named .jpeg',
              fileName: 'restaurant.jpeg',
              bytes: _onePixelPng,
              extension: 'png',
              contentType: 'image/png',
            ),
            (
              name: 'JPEG bytes named .PNG',
              fileName: 'restaurant.PNG',
              bytes: _onePixelJpeg,
              extension: 'jpg',
              contentType: 'image/jpeg',
            ),
            (
              name: 'extensionless PNG',
              fileName: 'restaurant',
              bytes: _onePixelPng,
              extension: 'png',
              contentType: 'image/png',
            ),
            (
              name: 'extensionless JPEG',
              fileName: 'restaurant',
              bytes: _onePixelJpeg,
              extension: 'jpg',
              contentType: 'image/jpeg',
            ),
            (
              name: 'unsupported-name PNG',
              fileName: 'restaurant.bin',
              bytes: _onePixelPng,
              extension: 'png',
              contentType: 'image/png',
            ),
            (
              name: 'unsupported-name JPEG',
              fileName: 'restaurant.data',
              bytes: _onePixelJpeg,
              extension: 'jpg',
              contentType: 'image/jpeg',
            ),
          ];

      for (final testCase in cases) {
        final sourceBytes = testCase.bytes();
        final expectedBytes = Uint8List.fromList(sourceBytes);
        final pickedImage = BiteSaverPickedImage(
          fileName: testCase.fileName,
          bytes: sourceBytes,
        );
        final validatedImage = await _validatedRestaurantImage(
          tester,
          pickedImage,
        );
        sourceBytes[0] ^= 0xff;

        var storageWrites = 0;
        String? capturedPath;
        Uint8List? capturedBytes;
        String? capturedContentType;
        final result = await BiteSaverImageUploadService.uploadRestaurantImage(
          uid: 'metadata-owner',
          validatedImage: validatedImage,
          storageWriter:
              ({
                required objectPath,
                required bytes,
                required contentType,
              }) async {
                storageWrites += 1;
                capturedPath = objectPath;
                capturedBytes = bytes;
                capturedContentType = contentType;
                return BiteSaverImageUploadResult(
                  imageUrl: 'https://images.example/${testCase.name}',
                  storagePath: objectPath,
                );
              },
        );

        expect(storageWrites, 1, reason: testCase.name);
        expect(
          capturedPath,
          matches(
            RegExp(
              '^bitesaver_restaurants/metadata-owner/restaurant_images/'
              'main_image_[0-9]+\\.${testCase.extension}\$',
            ),
          ),
          reason: testCase.name,
        );
        expect(
          capturedContentType,
          testCase.contentType,
          reason: testCase.name,
        );
        expect(
          capturedBytes,
          same(validatedImage.pickedImage.bytes),
          reason: testCase.name,
        );
        expect(
          capturedBytes,
          orderedEquals(expectedBytes),
          reason: testCase.name,
        );
        expect(
          identical(capturedBytes, pickedImage.bytes),
          isFalse,
          reason: testCase.name,
        );
        expect(result.storagePath, capturedPath, reason: testCase.name);
      }
    },
  );

  testWidgets(
    'production-default validator accepts valid PNG in the screen flow',
    (tester) => _verifyProductionDefaultValidatorAcceptsImage(
      tester,
      fileName: 'default-validator-misnamed.jpg',
      fixtureBytes: _onePixelPng(),
      expectedExtension: 'png',
      expectedContentType: 'image/png',
    ),
  );

  testWidgets(
    'production-default validator accepts valid JPEG in the screen flow',
    (tester) => _verifyProductionDefaultValidatorAcceptsImage(
      tester,
      fileName: 'default-validator-misnamed.png',
      fixtureBytes: _onePixelJpeg(),
      expectedExtension: 'jpg',
      expectedContentType: 'image/jpeg',
    ),
  );

  testWidgets(
    'production-default validator rejects unsupported and corrupt formats',
    (tester) async {
      final webpBytes = _smallValidWebp();
      await _expectFlutterCodecDecodes(
        tester,
        webpBytes,
        expectedWidth: 12,
        expectedHeight: 7,
      );
      final invalidImages = <({String name, BiteSaverPickedImage image})>[
        (
          name: 'GIF',
          image: BiteSaverPickedImage(
            fileName: 'unsupported.gif',
            bytes: _onePixelGif(),
          ),
        ),
        (
          name: 'BMP',
          image: BiteSaverPickedImage(
            fileName: 'unsupported.bmp',
            bytes: _onePixelBmp(),
          ),
        ),
        (
          name: 'WebP',
          image: BiteSaverPickedImage(
            fileName: 'unsupported.webp',
            bytes: webpBytes,
          ),
        ),
        (
          name: 'empty',
          image: BiteSaverPickedImage(
            fileName: 'empty.png',
            bytes: Uint8List(0),
          ),
        ),
        (
          name: 'TIFF',
          image: BiteSaverPickedImage(
            fileName: 'unsupported.tiff',
            bytes: Uint8List.fromList(const <int>[
              0x49,
              0x49,
              0x2a,
              0x00,
              0x08,
              0x00,
              0x00,
              0x00,
            ]),
          ),
        ),
        (
          name: 'unknown',
          image: BiteSaverPickedImage(
            fileName: 'unsupported.bin',
            bytes: Uint8List.fromList(utf8.encode('not an encoded image')),
          ),
        ),
        (
          name: 'corrupt PNG',
          image: BiteSaverPickedImage(
            fileName: 'corrupt.png',
            bytes: Uint8List.fromList(const <int>[
              0x89,
              0x50,
              0x4e,
              0x47,
              0x0d,
              0x0a,
              0x1a,
              0x0a,
              0x00,
              0x01,
            ]),
          ),
        ),
        (
          name: 'corrupt JPEG',
          image: BiteSaverPickedImage(
            fileName: 'corrupt.jpg',
            bytes: Uint8List.fromList(const <int>[
              0xff,
              0xd8,
              0xff,
              0xe0,
              0x00,
              0x01,
            ]),
          ),
        ),
      ];

      for (final testCase in invalidImages) {
        final persistedImageUrl =
            testCase.name == 'WebP' || testCase.name == 'empty'
            ? 'https://images.example/persisted-${testCase.name}.jpg'
            : null;
        var uploadCalls = 0;
        var storageWrites = 0;
        var lifecycleCalls = 0;
        await _pumpApplicationScreen(
          tester,
          lifecycleService: BiteSaverRestaurantLifecycleService(
            invokeCallable: (name, payload) async {
              lifecycleCalls += 1;
              throw StateError('No lifecycle call was expected.');
            },
          ),
          loadAccount: (uid) async => _approvedAccount(
            uid: uid,
            profileVersion: 64,
            locationVersion: 54,
            mainImageUrl: persistedImageUrl,
          ),
          pickRestaurantImage: () async => testCase.image,
          uploadRestaurantImage:
              ({required uid, required validatedImage}) async {
                uploadCalls += 1;
                return BiteSaverImageUploadService.uploadRestaurantImage(
                  uid: uid,
                  validatedImage: validatedImage,
                  storageWriter:
                      ({
                        required objectPath,
                        required bytes,
                        required contentType,
                      }) async {
                        storageWrites += 1;
                        return BiteSaverImageUploadResult(
                          imageUrl: 'https://images.example/must-not-upload',
                          storagePath: objectPath,
                        );
                      },
                );
              },
        );
        await _expandSection(tester, 'Restaurant Image');
        await _invokeRestaurantImagePickerWithRealTime(
          tester,
          persistedImageUrl == null
              ? 'Add restaurant image'
              : 'Change restaurant image',
        );

        expect(
          find.text('Please choose a valid PNG or JPEG image.'),
          findsOneWidget,
          reason: testCase.name,
        );
        expect(uploadCalls, 0, reason: testCase.name);
        expect(storageWrites, 0, reason: testCase.name);
        expect(lifecycleCalls, 0, reason: testCase.name);
        final ownerPreview = find.byKey(
          const ValueKey('restaurant-image-owner-preview'),
        );
        if (persistedImageUrl == null) {
          expect(ownerPreview, findsNothing, reason: testCase.name);
        } else {
          final preview = tester.widget<BiteSaverRestaurantImage>(ownerPreview);
          expect(preview.imageBytes, isNull, reason: testCase.name);
          expect(preview.imageUrl, persistedImageUrl, reason: testCase.name);
        }

        await _tapElevatedButton(tester, 'Save Restaurant Image');
        expect(
          find.text('Choose and upload a restaurant image before saving.'),
          findsOneWidget,
          reason: testCase.name,
        );
        expect(uploadCalls, 0, reason: testCase.name);
        expect(storageWrites, 0, reason: testCase.name);
        expect(lifecycleCalls, 0, reason: testCase.name);

        tester
            .state<ScaffoldMessengerState>(find.byType(ScaffoldMessenger))
            .clearSnackBars();
        await tester.pumpAndSettle();
        await tester.pumpWidget(const MaterialApp(home: SizedBox()));
        await tester.pumpAndSettle();
      }
    },
  );

  testWidgets(
    'empty bytes through default screen validator preserve image and versions',
    (tester) async {
      const persistedImageUrl =
          'https://images.example/persisted-before-empty.jpg';
      var account = _approvedAccount(
        profileVersion: 64,
        locationVersion: 54,
        mainImageUrl: persistedImageUrl,
      );
      final lifecyclePayloads = <Map<String, dynamic>>[];
      var uploadCalls = 0;
      var storageWrites = 0;

      await _pumpApplicationScreen(
        tester,
        lifecycleService: BiteSaverRestaurantLifecycleService(
          invokeCallable: (name, payload) async {
            lifecyclePayloads.add(Map<String, dynamic>.from(payload));
            account = _approvedAccount(
              profileVersion: 65,
              locationVersion: 54,
              mainImageUrl: persistedImageUrl,
            );
            return <String, dynamic>{
              'documentId': 'owner-1',
              'approvalStatus': 'approved',
              'profileVersion': 65,
              'locationVersion': 54,
            };
          },
        ),
        loadAccount: (uid) async => account,
        pickRestaurantImage: () async => BiteSaverPickedImage(
          fileName: 'empty-replacement.png',
          bytes: Uint8List(0),
        ),
        uploadRestaurantImage: ({required uid, required validatedImage}) async {
          uploadCalls += 1;
          return BiteSaverImageUploadService.uploadRestaurantImage(
            uid: uid,
            validatedImage: validatedImage,
            storageWriter:
                ({
                  required objectPath,
                  required bytes,
                  required contentType,
                }) async {
                  storageWrites += 1;
                  return BiteSaverImageUploadResult(
                    imageUrl: 'https://images.example/empty-must-not-upload',
                    storagePath: objectPath,
                  );
                },
          );
        },
      );
      await _expandSection(tester, 'Restaurant Image');
      await _invokeRestaurantImagePickerWithRealTime(
        tester,
        'Change restaurant image',
      );

      expect(
        find.text('Please choose a valid PNG or JPEG image.'),
        findsOneWidget,
      );
      expect(uploadCalls, 0);
      expect(storageWrites, 0);
      expect(lifecyclePayloads, isEmpty);
      var preview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
      );
      expect(preview.imageBytes, isNull);
      expect(preview.imageUrl, persistedImageUrl);

      await _tapElevatedButton(tester, 'Save Restaurant Image');
      expect(
        find.text('Choose and upload a restaurant image before saving.'),
        findsOneWidget,
      );
      expect(uploadCalls, 0);
      expect(storageWrites, 0);
      expect(lifecyclePayloads, isEmpty);
      preview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
      );
      expect(preview.imageBytes, isNull);
      expect(preview.imageUrl, persistedImageUrl);

      await _expandSection(tester, 'Customer Preview');
      final customerPreview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-customer-preview')),
      );
      expect(customerPreview.imageBytes, isNull);
      expect(customerPreview.imageUrl, persistedImageUrl);

      await _expandSection(tester, 'Hours');
      await _tapElevatedButton(tester, 'Save Hours');
      expect(lifecyclePayloads, hasLength(1));
      expect(lifecyclePayloads.single['updateSection'], 'businessHours');
      expect(lifecyclePayloads.single['expectedProfileVersion'], 64);
      expect(lifecyclePayloads.single['expectedLocationVersion'], 54);
      expect(
        lifecyclePayloads.single['profile'] as Map<String, dynamic>,
        isNot(contains('mainImageUrl')),
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'selected bytes preview before upload completes and the same bytes upload',
    (tester) async {
      final bytes = _onePixelJpeg();
      final pickedImage = BiteSaverPickedImage(
        fileName: 'restaurant.jpg',
        bytes: bytes,
      );
      final validatedRestaurantImage = await _validatedRestaurantImage(
        tester,
        pickedImage,
      );
      final uploadCompleter = Completer<BiteSaverImageUploadResult>();
      BiteSaverPickedImage? uploadedImage;
      var lifecycleCalls = 0;
      final service = BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          lifecycleCalls += 1;
          throw StateError('No lifecycle save was expected.');
        },
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: service,
        loadAccount: (uid) async => _approvedAccount(),
        pickRestaurantImage: () async => pickedImage,
        validateRestaurantImage: (candidate) async {
          expect(identical(candidate, pickedImage), isTrue);
          return validatedRestaurantImage;
        },
        uploadRestaurantImage: ({required uid, required validatedImage}) async {
          expect(identical(validatedImage, validatedRestaurantImage), isTrue);
          uploadedImage = validatedImage.pickedImage;
          return uploadCompleter.future;
        },
      );
      await _expandSection(tester, 'Restaurant Image');
      final pickButton = find.widgetWithText(
        OutlinedButton,
        'Add restaurant image',
      );
      await tester.ensureVisible(pickButton);
      await tester.tap(pickButton);
      await tester.pump();

      final preview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
      );
      final image = tester.widget<Image>(
        find.descendant(
          of: find.byKey(const ValueKey('restaurant-image-owner-preview')),
          matching: find.byType(Image),
        ),
      );

      expect(
        identical(
          preview.imageBytes,
          validatedRestaurantImage.pickedImage.bytes,
        ),
        isTrue,
      );
      expect(preview.imageBytes, orderedEquals(bytes));
      expect(image.image, isA<MemoryImage>());
      expect(
        identical(uploadedImage, validatedRestaurantImage.pickedImage),
        isTrue,
      );
      expect(
        identical((image.image as MemoryImage).bytes, uploadedImage!.bytes),
        isTrue,
      );
      expect(find.text('Uploading...'), findsOneWidget);
      expect(lifecycleCalls, 0);

      uploadCompleter.complete(
        const BiteSaverImageUploadResult(
          imageUrl: _syntheticRestaurantImageUrl,
          storagePath: 'synthetic/restaurant.png',
        ),
      );
      await tester.pumpAndSettle();

      final uploadedPreview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
      );
      expect(
        identical(
          uploadedPreview.imageBytes,
          validatedRestaurantImage.pickedImage.bytes,
        ),
        isTrue,
      );
      expect(uploadedPreview.imageUrl, _syntheticRestaurantImageUrl);
      expect(
        find.text(
          'Restaurant image uploaded. Save Restaurant Image to apply it.',
        ),
        findsOneWidget,
      );
      expect(lifecycleCalls, 0);
    },
  );

  testWidgets('rendered picker suppresses duplicate picker and upload taps', (
    tester,
  ) async {
    final pickedImage = BiteSaverPickedImage(
      fileName: 'single-flight.png',
      bytes: _onePixelPng(),
    );
    final validatedImage = await _validatedRestaurantImage(tester, pickedImage);
    final pendingUpload = Completer<BiteSaverImageUploadResult>();
    var pickerCalls = 0;
    var validationCalls = 0;
    var uploadCalls = 0;

    await _pumpApplicationScreen(
      tester,
      loadAccount: (uid) async => _approvedAccount(),
      pickRestaurantImage: () async {
        pickerCalls += 1;
        return pickedImage;
      },
      validateRestaurantImage: (candidate) async {
        validationCalls += 1;
        return validatedImage;
      },
      uploadRestaurantImage: ({required uid, required validatedImage}) {
        uploadCalls += 1;
        return pendingUpload.future;
      },
    );
    await _expandSection(tester, 'Restaurant Image');
    await tester.tap(
      find.widgetWithText(OutlinedButton, 'Add restaurant image'),
    );
    await _pumpUntil(tester, () => uploadCalls == 1);
    await tester.pump();

    final renderedBusyPicker = find.widgetWithText(
      OutlinedButton,
      'Uploading...',
    );
    expect(tester.widget<OutlinedButton>(renderedBusyPicker).onPressed, isNull);
    await tester.tap(renderedBusyPicker);
    await tester.pump();

    expect(pickerCalls, 1);
    expect(validationCalls, 1);
    expect(uploadCalls, 1);

    pendingUpload.complete(
      const BiteSaverImageUploadResult(
        imageUrl: 'https://images.example/single-flight.png',
        storagePath: 'synthetic/single-flight.png',
      ),
    );
    await tester.pumpAndSettle();

    expect(pickerCalls, 1);
    expect(validationCalls, 1);
    expect(uploadCalls, 1);
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, 'Change restaurant image'),
          )
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('replacement updates bytes and cancellation preserves them', (
    tester,
  ) async {
    final firstBytes = _onePixelPng();
    final secondBytes = Uint8List.fromList(<int>[..._onePixelPng()]);
    final firstImage = BiteSaverPickedImage(
      fileName: 'first.png',
      bytes: firstBytes,
    );
    final secondImage = BiteSaverPickedImage(
      fileName: 'second.png',
      bytes: secondBytes,
    );
    final firstValidatedImage = await _validatedRestaurantImage(
      tester,
      firstImage,
    );
    final secondValidatedImage = await _validatedRestaurantImage(
      tester,
      secondImage,
    );
    final picks = <BiteSaverPickedImage?>[firstImage, null, secondImage];
    final uploadedImages = <BiteSaverPickedImage>[];

    await _pumpApplicationScreen(
      tester,
      loadAccount: (uid) async => _approvedAccount(),
      pickRestaurantImage: () async => picks.removeAt(0),
      validateRestaurantImage: (candidate) async {
        if (identical(candidate, firstImage)) {
          return firstValidatedImage;
        }
        if (identical(candidate, secondImage)) {
          return secondValidatedImage;
        }
        fail('Unexpected restaurant image candidate.');
      },
      uploadRestaurantImage: ({required uid, required validatedImage}) async {
        final pickedImage = validatedImage.pickedImage;
        uploadedImages.add(pickedImage);
        return BiteSaverImageUploadResult(
          imageUrl: uploadedImages.length == 1
              ? 'https://images.example/first.png'
              : 'https://images.example/second.png',
          storagePath: 'synthetic/${pickedImage.fileName}',
        );
      },
    );
    await _expandSection(tester, 'Restaurant Image');

    await _tapRestaurantImagePicker(tester, 'Add restaurant image');
    var preview = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
    );
    expect(
      identical(preview.imageBytes, firstValidatedImage.pickedImage.bytes),
      isTrue,
    );

    await _tapRestaurantImagePicker(tester, 'Change restaurant image');
    preview = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
    );
    expect(
      identical(preview.imageBytes, firstValidatedImage.pickedImage.bytes),
      isTrue,
    );
    expect(preview.imageUrl, 'https://images.example/first.png');
    expect(uploadedImages, <BiteSaverPickedImage>[
      firstValidatedImage.pickedImage,
    ]);

    await _tapRestaurantImagePicker(tester, 'Change restaurant image');
    preview = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
    );
    expect(
      identical(preview.imageBytes, secondValidatedImage.pickedImage.bytes),
      isTrue,
    );
    expect(preview.imageUrl, 'https://images.example/second.png');
    expect(uploadedImages, <BiteSaverPickedImage>[
      firstValidatedImage.pickedImage,
      secondValidatedImage.pickedImage,
    ]);
  });

  testWidgets(
    'invalid bytes are rejected before a fake successful upload or save',
    (tester) async {
      final invalidImage = BiteSaverPickedImage(
        fileName: 'invalid.png',
        bytes: Uint8List.fromList(const [0, 1, 2, 3]),
      );
      final productionValidation = await tester.runAsync(
        () => BiteSaverImageUploadService.validateRestaurantImage(invalidImage),
      );
      expect(productionValidation, isNull);
      final differentValidImage = BiteSaverPickedImage(
        fileName: 'different-valid.png',
        bytes: _onePixelPng(),
      );
      final mismatchedValidatedImage = await _validatedRestaurantImage(
        tester,
        differentValidImage,
      );
      var uploadCalls = 0;
      var lifecycleCalls = 0;
      final service = BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          lifecycleCalls += 1;
          throw StateError('No lifecycle save was expected.');
        },
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: service,
        loadAccount: (uid) async => _approvedAccount(),
        pickRestaurantImage: () async => invalidImage,
        validateRestaurantImage: (candidate) async {
          expect(identical(candidate, invalidImage), isTrue);
          return mismatchedValidatedImage;
        },
        uploadRestaurantImage: ({required uid, required validatedImage}) async {
          uploadCalls += 1;
          return const BiteSaverImageUploadResult(
            imageUrl: 'https://images.example/must-not-upload.png',
            storagePath: 'synthetic/must-not-upload.png',
          );
        },
      );
      await _expandSection(tester, 'Restaurant Image');
      await _tapRestaurantImagePicker(tester, 'Add restaurant image');

      expect(
        find.text('Please choose a valid PNG or JPEG image.'),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
        findsNothing,
      );
      expect(uploadCalls, 0);
      expect(lifecycleCalls, 0);

      final saveButton = find.widgetWithText(
        ElevatedButton,
        'Save Restaurant Image',
      );
      await tester.ensureVisible(saveButton);
      await tester.tap(saveButton);
      await tester.pumpAndSettle();

      expect(
        find.text('Choose and upload a restaurant image before saving.'),
        findsOneWidget,
      );
      expect(find.text('Restaurant image saved.'), findsNothing);
      expect(lifecycleCalls, 0);
    },
  );

  testWidgets('decoder exceptions use fixed feedback and start no upload', (
    tester,
  ) async {
    final pickedImage = BiteSaverPickedImage(
      fileName: 'decoder-error.png',
      bytes: _onePixelPng(),
    );
    var uploadCalls = 0;

    await _pumpApplicationScreen(
      tester,
      loadAccount: (uid) async => _approvedAccount(),
      pickRestaurantImage: () async => pickedImage,
      validateRestaurantImage: (candidate) async {
        throw StateError('synthetic decoder provider detail');
      },
      uploadRestaurantImage: ({required uid, required validatedImage}) async {
        uploadCalls += 1;
        throw StateError('must not upload');
      },
    );
    await _expandSection(tester, 'Restaurant Image');
    await _tapRestaurantImagePicker(tester, 'Add restaurant image');

    expect(
      find.text('Please choose a valid PNG or JPEG image.'),
      findsOneWidget,
    );
    expect(find.textContaining('synthetic decoder'), findsNothing);
    expect(uploadCalls, 0);
  });

  testWidgets(
    'invalid replacement preserves prior state then accepts a valid retry',
    (tester) async {
      const savedUrl = 'https://images.example/saved-owner-image.jpg';
      const selectedUrl = 'https://images.example/valid-selection.png';
      const retryUrl = 'https://images.example/valid-retry.jpg';
      final validImage = BiteSaverPickedImage(
        fileName: 'valid.png',
        bytes: _onePixelPng(),
      );
      final invalidImage = BiteSaverPickedImage(
        fileName: 'invalid.png',
        bytes: Uint8List.fromList(const <int>[137, 80, 78, 71, 1, 2, 3]),
      );
      final retryImage = BiteSaverPickedImage(
        fileName: 'retry.jpg',
        bytes: _onePixelJpeg(),
      );
      final validatedImage = await _validatedRestaurantImage(
        tester,
        validImage,
      );
      final validatedRetryImage = await _validatedRestaurantImage(
        tester,
        retryImage,
      );
      final picks = <BiteSaverPickedImage?>[
        validImage,
        invalidImage,
        retryImage,
      ];
      var uploadCalls = 0;
      var lifecycleCalls = 0;

      await _pumpApplicationScreen(
        tester,
        lifecycleService: BiteSaverRestaurantLifecycleService(
          invokeCallable: (name, payload) async {
            lifecycleCalls += 1;
            throw StateError('No lifecycle call was expected.');
          },
        ),
        loadAccount: (uid) async => _approvedAccount(mainImageUrl: savedUrl),
        pickRestaurantImage: () async => picks.removeAt(0),
        validateRestaurantImage: (candidate) async {
          if (identical(candidate, validImage)) {
            return validatedImage;
          }
          if (identical(candidate, retryImage)) {
            return validatedRetryImage;
          }
          return null;
        },
        uploadRestaurantImage: ({required uid, required validatedImage}) async {
          uploadCalls += 1;
          final isRetry = identical(validatedImage, validatedRetryImage);
          return BiteSaverImageUploadResult(
            imageUrl: isRetry ? retryUrl : selectedUrl,
            storagePath: isRetry
                ? 'synthetic/valid-retry.jpg'
                : 'synthetic/valid-selection.png',
          );
        },
      );
      await _expandSection(tester, 'Restaurant Image');
      await _tapRestaurantImagePicker(tester, 'Change restaurant image');

      var ownerPreview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
      );
      final selectedBytes = ownerPreview.imageBytes;
      expect(
        identical(selectedBytes, validatedImage.pickedImage.bytes),
        isTrue,
      );
      expect(ownerPreview.imageUrl, selectedUrl);

      await _tapRestaurantImagePicker(tester, 'Change restaurant image');

      ownerPreview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
      );
      expect(identical(ownerPreview.imageBytes, selectedBytes), isTrue);
      expect(ownerPreview.imageUrl, selectedUrl);
      expect(uploadCalls, 1);
      expect(lifecycleCalls, 0);
      expect(
        find.text('Please choose a valid PNG or JPEG image.'),
        findsOneWidget,
      );

      await _expandSection(tester, 'Customer Preview');
      final customerPreview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-customer-preview')),
      );
      expect(customerPreview.imageUrl, savedUrl);
      expect(customerPreview.imageBytes, isNull);

      await _tapRestaurantImagePicker(tester, 'Change restaurant image');

      ownerPreview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
      );
      expect(
        identical(
          ownerPreview.imageBytes,
          validatedRetryImage.pickedImage.bytes,
        ),
        isTrue,
      );
      expect(ownerPreview.imageUrl, retryUrl);
      expect(uploadCalls, 2);
      expect(lifecycleCalls, 0);
      expect(
        find.text('Please choose a valid PNG or JPEG image.'),
        findsNothing,
      );
      expect(
        find.text(
          'Restaurant image uploaded. Save Restaurant Image to apply it.',
        ),
        findsOneWidget,
      );
      expect(
        tester
            .widget<BiteSaverRestaurantImage>(
              find.byKey(const ValueKey('restaurant-image-customer-preview')),
            )
            .imageUrl,
        savedUrl,
      );
    },
  );

  testWidgets('upload failure preserves controlled feedback and retries safely', (
    tester,
  ) async {
    const savedUrl = 'https://images.example/persisted-before-failure.jpg';
    const retryUrl = 'https://images.example/upload-retry.jpg';
    final failedImage = BiteSaverPickedImage(
      fileName: 'failed-replacement.png',
      bytes: _onePixelPng(),
    );
    final retryImage = BiteSaverPickedImage(
      fileName: 'upload-retry.jpg',
      bytes: _onePixelJpeg(),
    );
    final failedValidatedImage = await _validatedRestaurantImage(
      tester,
      failedImage,
    );
    final retryValidatedImage = await _validatedRestaurantImage(
      tester,
      retryImage,
    );
    final picks = <BiteSaverPickedImage?>[failedImage, retryImage];
    final lifecyclePayloads = <Map<String, dynamic>>[];
    var uploadCalls = 0;
    var account = _approvedAccount(mainImageUrl: savedUrl);

    await _pumpApplicationScreen(
      tester,
      lifecycleService: BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          lifecyclePayloads.add(Map<String, dynamic>.from(payload));
          final updateSection = payload['updateSection'];
          final isImageSave = updateSection == 'mainImage';
          account = _approvedAccount(
            profileVersion: isImageSave ? 6 : 5,
            mainImageUrl: isImageSave ? retryUrl : savedUrl,
          );
          return <String, dynamic>{
            'documentId': 'owner-1',
            'approvalStatus': 'approved',
            'profileVersion': isImageSave ? 6 : 5,
            'locationVersion': 2,
          };
        },
      ),
      loadAccount: (uid) async => account,
      pickRestaurantImage: () async => picks.removeAt(0),
      validateRestaurantImage: (candidate) async =>
          identical(candidate, failedImage)
          ? failedValidatedImage
          : retryValidatedImage,
      uploadRestaurantImage: ({required uid, required validatedImage}) async {
        uploadCalls += 1;
        if (uploadCalls == 1) {
          throw FirebaseException(
            plugin: 'firebase_storage',
            code: 'unavailable',
            message: 'raw synthetic storage provider details',
          );
        }
        return const BiteSaverImageUploadResult(
          imageUrl: retryUrl,
          storagePath: 'synthetic/upload-retry.jpg',
        );
      },
    );
    await _expandSection(tester, 'Restaurant Image');
    await _tapRestaurantImagePicker(tester, 'Change restaurant image');

    var ownerPreview = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
    );
    expect(
      identical(
        ownerPreview.imageBytes,
        failedValidatedImage.pickedImage.bytes,
      ),
      isTrue,
    );
    expect(ownerPreview.imageUrl, savedUrl);
    expect(uploadCalls, 1);
    expect(
      find.text('This service is temporarily unavailable. Please try again.'),
      findsOneWidget,
    );
    expect(find.textContaining('raw synthetic storage'), findsNothing);
    final retryPicker = find.widgetWithText(
      OutlinedButton,
      'Change restaurant image',
    );
    expect(tester.widget<OutlinedButton>(retryPicker).onPressed, isNotNull);
    expect(find.text('Uploading...'), findsNothing);

    await _tapElevatedButton(tester, 'Save Restaurant Image');
    expect(lifecyclePayloads, isEmpty);
    expect(
      find.text(
        'The selected restaurant image was not uploaded. Choose it again before saving.',
      ),
      findsOneWidget,
    );

    await _expandSection(tester, 'Customer Preview');
    expect(
      tester
          .widget<BiteSaverRestaurantImage>(
            find.byKey(const ValueKey('restaurant-image-customer-preview')),
          )
          .imageUrl,
      savedUrl,
    );

    await _expandSection(tester, 'Hours');
    await _tapElevatedButton(tester, 'Save Hours');
    expect(lifecyclePayloads, hasLength(1));
    expect(lifecyclePayloads.single['updateSection'], 'businessHours');
    expect(lifecyclePayloads.single['expectedProfileVersion'], 4);
    expect(lifecyclePayloads.single['expectedLocationVersion'], 2);

    await _tapRestaurantImagePicker(tester, 'Change restaurant image');
    ownerPreview = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
    );
    expect(
      identical(ownerPreview.imageBytes, retryValidatedImage.pickedImage.bytes),
      isTrue,
    );
    expect(ownerPreview.imageUrl, retryUrl);
    expect(uploadCalls, 2);
    expect(
      find.text(
        'Restaurant image uploaded. Save Restaurant Image to apply it.',
      ),
      findsOneWidget,
    );

    await _tapElevatedButton(tester, 'Save Restaurant Image');
    expect(lifecyclePayloads, hasLength(2));
    expect(lifecyclePayloads[1]['updateSection'], 'mainImage');
    expect(lifecyclePayloads[1]['expectedProfileVersion'], 5);
    expect(lifecyclePayloads[1]['expectedLocationVersion'], 2);
    expect(lifecyclePayloads[1]['profile'], <String, dynamic>{
      'mainImageUrl': retryUrl,
    });
    ownerPreview = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
    );
    expect(ownerPreview.imageBytes, isNull);
    expect(ownerPreview.imageUrl, retryUrl);
    expect(
      tester
          .widget<BiteSaverRestaurantImage>(
            find.byKey(const ValueKey('restaurant-image-customer-preview')),
          )
          .imageUrl,
      retryUrl,
    );
  });

  testWidgets('image save failure preserves one upload and exact retry state', (
    tester,
  ) async {
    const originalUrl = 'https://images.example/original.jpg';
    const replacementUrl = 'https://images.example/retry-selection.png';
    final pickedImage = BiteSaverPickedImage(
      fileName: 'retry.png',
      bytes: _onePixelPng(),
    );
    final validatedImage = await _validatedRestaurantImage(tester, pickedImage);
    final lifecyclePayloads = <Map<String, dynamic>>[];
    var uploadCalls = 0;
    var account = _approvedAccount(mainImageUrl: originalUrl);

    await _pumpApplicationScreen(
      tester,
      lifecycleService: BiteSaverRestaurantLifecycleService(
        requestIdGenerator: () => 'restaurant-image-retry-id',
        invokeCallable: (name, payload) async {
          lifecyclePayloads.add(Map<String, dynamic>.from(payload));
          if (lifecyclePayloads.length == 1) {
            throw const BiteSaverCallableFailure('unavailable');
          }
          account = _approvedAccount(
            profileVersion: 5,
            mainImageUrl: replacementUrl,
          );
          return <String, dynamic>{
            'documentId': 'owner-1',
            'approvalStatus': 'approved',
            'profileVersion': 5,
            'locationVersion': 2,
          };
        },
      ),
      loadAccount: (uid) async => account,
      pickRestaurantImage: () async => pickedImage,
      validateRestaurantImage: (candidate) async => validatedImage,
      uploadRestaurantImage: ({required uid, required validatedImage}) async {
        uploadCalls += 1;
        return const BiteSaverImageUploadResult(
          imageUrl: replacementUrl,
          storagePath: 'synthetic/retry.png',
        );
      },
    );
    await _expandSection(tester, 'Restaurant Image');
    await _tapRestaurantImagePicker(tester, 'Change restaurant image');
    await _tapElevatedButton(tester, 'Save Restaurant Image');

    expect(lifecyclePayloads, hasLength(1));
    expect(lifecyclePayloads.single['expectedProfileVersion'], 4);
    expect(lifecyclePayloads.single['expectedLocationVersion'], 2);
    expect(lifecyclePayloads.single['updateSection'], 'mainImage');
    expect(lifecyclePayloads.single['profile'], <String, dynamic>{
      'mainImageUrl': replacementUrl,
    });
    expect(find.text('Restaurant image saved.'), findsNothing);
    var preview = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
    );
    expect(
      identical(preview.imageBytes, validatedImage.pickedImage.bytes),
      isTrue,
    );
    expect(preview.imageUrl, replacementUrl);

    await _expandSection(tester, 'Customer Preview');
    final customerPreviewBeforeRetry = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-customer-preview')),
    );
    expect(customerPreviewBeforeRetry.imageBytes, isNull);
    expect(customerPreviewBeforeRetry.imageUrl, originalUrl);

    await _tapElevatedButton(tester, 'Save Restaurant Image');

    expect(lifecyclePayloads, hasLength(2));
    expect(lifecyclePayloads[1], equals(lifecyclePayloads[0]));
    expect(
      lifecyclePayloads[1]['requestId'],
      lifecyclePayloads[0]['requestId'],
    );
    expect(lifecyclePayloads[1]['expectedProfileVersion'], 4);
    expect(lifecyclePayloads[1]['expectedLocationVersion'], 2);
    for (final payload in lifecyclePayloads) {
      expect(payload['updateSection'], 'mainImage');
      expect(payload['profile'], <String, dynamic>{
        'mainImageUrl': replacementUrl,
      });
      expect(
        (payload['profile'] as Map<String, dynamic>).keys.toSet(),
        <String>{'mainImageUrl'},
      );
    }
    expect(uploadCalls, 1);
    expect(find.text('Restaurant image saved.'), findsOneWidget);
    preview = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
    );
    expect(preview.imageBytes, isNull);
    expect(preview.imageUrl, replacementUrl);
  });

  testWidgets(
    'approved owner A cache never seeds no-account owner B application',
    (tester) async {
      const ownerAName = 'A-CACHE-NAME-7Q';
      const ownerAStreet = '701 A-CACHE-STREET';
      const ownerACity = 'A-CACHE-CITY';
      const ownerAState = 'AZ';
      const ownerAZip = '99701';
      const ownerAPhone = '(907) 555-0171';
      const ownerAWebsite = 'https://a-cache-7q.example';
      const ownerABio = 'A-CACHE-BIO-7Q';
      const ownerAImage = 'https://images.example/a-cache-image-7q.jpg';
      final ownerA = _TestUser(
        uid: 'cached-profile-owner-a',
        email: 'cached-a@example.test',
      );
      final ownerB = _TestUser(
        uid: 'cached-profile-owner-b',
        email: 'cached-b@example.test',
      );
      User? currentUser = ownerA;
      var ownerBSubmitted = false;
      final userChanges = StreamController<User?>.broadcast(sync: true);
      addTearDown(userChanges.close);
      final lifecyclePayloads = <Map<String, dynamic>>[];
      final ownerAHours = _businessHoursForSunday(
        opensAt: '1:15 AM',
        closesAt: '2:45 AM',
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: BiteSaverRestaurantLifecycleService(
          invokeCallable: (name, payload) async {
            lifecyclePayloads.add(Map<String, dynamic>.from(payload));
            ownerBSubmitted = true;
            return <String, dynamic>{
              'documentId': ownerB.uid,
              'approvalStatus': 'approved',
              'profileVersion': 1,
              'locationVersion': 1,
            };
          },
        ),
        loadAccount: (uid) async {
          if (uid == ownerA.uid) {
            return _approvedAccount(
              uid: ownerA.uid,
              email: ownerA.email!,
              restaurantName: ownerAName,
              streetAddress: ownerAStreet,
              city: ownerACity,
              state: ownerAState,
              zipCode: ownerAZip,
              phone: ownerAPhone,
              website: ownerAWebsite,
              bio: ownerABio,
              mainImageUrl: ownerAImage,
              businessHours: ownerAHours,
              profileVersion: 97,
              locationVersion: 83,
              subscriptionStatus: 'inactive',
            );
          }
          if (!ownerBSubmitted) {
            return null;
          }
          return _approvedAccount(
            uid: ownerB.uid,
            email: ownerB.email!,
            restaurantName: 'B Submitted Restaurant',
            streetAddress: '82 B Street',
            city: 'B City',
            state: 'FL',
            zipCode: '34482',
            phone: '(352) 555-0182',
            website: '',
            bio: '',
            profileVersion: 1,
            locationVersion: 1,
          );
        },
        testCurrentUser: ownerA,
        currentUserProvider: () => currentUser,
        ownerUserChanges: userChanges.stream,
      );

      final cachedOwnerA = LocalRestaurantProfileStore.profile.value;
      expect(cachedOwnerA.name, ownerAName);
      expect(
        cachedOwnerA.businessHours.map((entry) => entry.toFirestoreMap()),
        ownerAHours.map((entry) => entry.toFirestoreMap()),
      );
      expect(cachedOwnerA.mainImageUrl, ownerAImage);

      currentUser = ownerB;
      userChanges.add(ownerB);
      await tester.pumpAndSettle();

      expect(lifecyclePayloads, isEmpty);
      expect(find.text('Apply for Coupon-Side Approval'), findsOneWidget);
      expect(_fieldText(tester, 'Restaurant Name'), isEmpty);
      expect(_fieldText(tester, 'Street Address'), isEmpty);
      expect(_fieldText(tester, 'City'), isEmpty);
      expect(_fieldText(tester, 'State'), isEmpty);
      expect(_fieldText(tester, 'ZIP Code'), isEmpty);
      expect(_fieldText(tester, 'Phone Number'), isEmpty);
      for (final canary in <String>[
        ownerAName,
        ownerAStreet,
        ownerACity,
        ownerAState,
        ownerAZip,
        ownerAPhone,
        ownerAWebsite,
        ownerABio,
        ownerAImage,
        '1:15 AM',
        '2:45 AM',
      ]) {
        expect(find.textContaining(canary), findsNothing, reason: canary);
      }
      expect(find.text('Customer Preview'), findsNothing);
      expect(find.text('Hours'), findsNothing);
      expect(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
        findsNothing,
      );
      final clearedProfile = LocalRestaurantProfileStore.profile.value;
      expect(clearedProfile.name, isEmpty);
      expect(clearedProfile.streetAddress, isEmpty);
      expect(clearedProfile.phone, isEmpty);
      expect(clearedProfile.website, isEmpty);
      expect(clearedProfile.bio, isEmpty);
      expect(clearedProfile.mainImageUrl, isEmpty);
      expect(clearedProfile.businessHours, isEmpty);

      await tester.enterText(
        _fieldWithLabel('Restaurant Name'),
        'B Submitted Restaurant',
      );
      await tester.enterText(_fieldWithLabel('Street Address'), '82 B Street');
      await tester.enterText(_fieldWithLabel('City'), 'B City');
      await tester.enterText(_fieldWithLabel('State'), 'FL');
      await tester.enterText(_fieldWithLabel('ZIP Code'), '34482');
      await tester.enterText(_fieldWithLabel('Phone Number'), '3525550182');
      final applyButton = find.widgetWithText(
        FilledButton,
        'Apply for a restaurant account',
      );
      await tester.ensureVisible(applyButton);
      await tester.tap(applyButton);
      await tester.pumpAndSettle();

      expect(lifecyclePayloads, hasLength(1));
      final payload = lifecyclePayloads.single;
      expect(payload['intent'], 'submitApplication');
      expect(payload, isNot(contains('expectedProfileVersion')));
      expect(payload, isNot(contains('expectedLocationVersion')));
      final profile = payload['profile'] as Map<String, dynamic>;
      expect(profile, <String, dynamic>{
        'restaurantName': 'B Submitted Restaurant',
        'streetAddress': '82 B Street',
        'city': 'B City',
        'state': 'FL',
        'zipCode': '34482',
        'phone': '(352) 555-0182',
        'website': '',
      });
      final encodedPayload = jsonEncode(payload);
      for (final canary in <String>[
        ownerAName,
        ownerAStreet,
        ownerACity,
        ownerAState,
        ownerAZip,
        ownerAPhone,
        ownerAWebsite,
        ownerABio,
        ownerAImage,
      ]) {
        expect(encodedPayload, isNot(contains(canary)), reason: canary);
      }
      expect(profile, isNot(contains('bio')));
      expect(profile, isNot(contains('businessHours')));
      expect(profile, isNot(contains('mainImageUrl')));

      await _expandSection(tester, 'Customer Preview');
      expect(find.text('B Submitted Restaurant'), findsWidgets);
      expect(find.textContaining(ownerAName), findsNothing);
      expect(find.textContaining(ownerABio), findsNothing);
      expect(find.textContaining(ownerAWebsite), findsNothing);
      await _expandSection(tester, 'Hours');
      expect(find.text('Hours not set'), findsWidgets);
      await _expandSection(tester, 'Restaurant Image');
      expect(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
        findsNothing,
      );
    },
  );

  for (final sameUidDocumentSwitch in <bool>[false, true]) {
    testWidgets(
      'owner transition loads only owner B authoritative profile '
      '(${sameUidDocumentSwitch ? 'same UID document' : 'different UID'})',
      (tester) => _verifyAuthoritativeOwnerBProfileTransition(
        tester,
        sameUidDocumentSwitch: sameUidDocumentSwitch,
      ),
    );
  }

  for (final delayedFailure in <bool>[false, true]) {
    testWidgets(
      'delayed owner A account ${delayedFailure ? 'failure' : 'success'} '
      'cannot disturb loaded owner B',
      (tester) => _verifyDelayedOwnerALoadCannotDisturbOwnerB(
        tester,
        delayedFailure: delayedFailure,
      ),
    );
  }

  testWidgets('owner switch before picker return ignores prior owner bytes', (
    tester,
  ) async {
    const ownerAUrl = 'https://images.example/owner-a-saved.jpg';
    const ownerBUrl = 'https://images.example/owner-b-saved.jpg';
    final ownerA = _TestUser(uid: 'owner-a', email: 'a@example.test');
    final ownerB = _TestUser(uid: 'owner-b', email: 'b@example.test');
    User? currentUser = ownerA;
    final userChanges = StreamController<User?>.broadcast(sync: true);
    addTearDown(userChanges.close);
    final pendingPick = Completer<BiteSaverPickedImage?>();
    var validationCalls = 0;
    var uploadCalls = 0;
    var lifecycleCalls = 0;

    await _pumpApplicationScreen(
      tester,
      lifecycleService: BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          lifecycleCalls += 1;
          throw StateError('No lifecycle call was expected.');
        },
      ),
      loadAccount: (uid) async => _approvedAccount(
        uid: uid,
        mainImageUrl: uid == ownerA.uid ? ownerAUrl : ownerBUrl,
      ),
      testCurrentUser: ownerA,
      currentUserProvider: () => currentUser,
      ownerUserChanges: userChanges.stream,
      pickRestaurantImage: () => pendingPick.future,
      validateRestaurantImage: (candidate) async {
        validationCalls += 1;
        return null;
      },
      uploadRestaurantImage: ({required uid, required validatedImage}) async {
        uploadCalls += 1;
        throw StateError('No upload was expected.');
      },
    );
    await _expandSection(tester, 'Restaurant Image');
    final pickButton = find.widgetWithText(
      OutlinedButton,
      'Change restaurant image',
    );
    await tester.ensureVisible(pickButton);
    tester.widget<OutlinedButton>(pickButton).onPressed!();
    await tester.pump();

    currentUser = ownerB;
    userChanges.add(ownerB);
    await tester.pumpAndSettle();
    pendingPick.complete(
      BiteSaverPickedImage(fileName: 'owner-a.png', bytes: _onePixelPng()),
    );
    await tester.pumpAndSettle();

    final preview = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
    );
    expect(preview.imageBytes, isNull);
    expect(preview.imageUrl, ownerBUrl);
    expect(validationCalls, 0);
    expect(uploadCalls, 0);
    expect(lifecycleCalls, 0);
    expect(
      find.textContaining('uploaded. Save Restaurant Image'),
      findsNothing,
    );
  });

  testWidgets('owner switch during validation starts no prior-owner upload', (
    tester,
  ) async {
    const ownerBUrl = 'https://images.example/validation-owner-b.jpg';
    final ownerA = _TestUser(uid: 'validation-a');
    final ownerB = _TestUser(uid: 'validation-b');
    User? currentUser = ownerA;
    final userChanges = StreamController<User?>.broadcast(sync: true);
    addTearDown(userChanges.close);
    final pickedImage = BiteSaverPickedImage(
      fileName: 'validation-a.png',
      bytes: _onePixelPng(),
    );
    final validatedImage = await _validatedRestaurantImage(tester, pickedImage);
    final pendingValidation = Completer<BiteSaverValidatedRestaurantImage?>();
    var validationCalls = 0;
    var uploadCalls = 0;

    await _pumpApplicationScreen(
      tester,
      loadAccount: (uid) async => _approvedAccount(
        uid: uid,
        mainImageUrl: uid == ownerB.uid ? ownerBUrl : null,
      ),
      testCurrentUser: ownerA,
      currentUserProvider: () => currentUser,
      ownerUserChanges: userChanges.stream,
      pickRestaurantImage: () async => pickedImage,
      validateRestaurantImage: (candidate) {
        validationCalls += 1;
        return pendingValidation.future;
      },
      uploadRestaurantImage: ({required uid, required validatedImage}) async {
        uploadCalls += 1;
        throw StateError('No upload was expected.');
      },
    );
    await _expandSection(tester, 'Restaurant Image');
    final pickButton = find.widgetWithText(
      OutlinedButton,
      'Add restaurant image',
    );
    await tester.ensureVisible(pickButton);
    tester.widget<OutlinedButton>(pickButton).onPressed!();
    await _pumpUntil(tester, () => validationCalls == 1);

    currentUser = ownerB;
    userChanges.add(ownerB);
    await tester.pumpAndSettle();
    pendingValidation.complete(validatedImage);
    await tester.pumpAndSettle();

    final preview = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
    );
    expect(preview.imageBytes, isNull);
    expect(preview.imageUrl, ownerBUrl);
    expect(uploadCalls, 0);
  });

  testWidgets('owner switch during upload ignores prior-owner completion', (
    tester,
  ) async {
    const ownerBUrl = 'https://images.example/upload-owner-b.jpg';
    final ownerA = _TestUser(uid: 'upload-a');
    final ownerB = _TestUser(uid: 'upload-b');
    User? currentUser = ownerA;
    final userChanges = StreamController<User?>.broadcast(sync: true);
    addTearDown(userChanges.close);
    final pickedImage = BiteSaverPickedImage(
      fileName: 'upload-a.png',
      bytes: _onePixelPng(),
    );
    final validatedImage = await _validatedRestaurantImage(tester, pickedImage);
    final pendingUpload = Completer<BiteSaverImageUploadResult>();
    var uploadCalls = 0;
    var lifecycleCalls = 0;

    await _pumpApplicationScreen(
      tester,
      lifecycleService: BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          lifecycleCalls += 1;
          throw StateError('No lifecycle call was expected.');
        },
      ),
      loadAccount: (uid) async => _approvedAccount(
        uid: uid,
        mainImageUrl: uid == ownerB.uid ? ownerBUrl : null,
      ),
      testCurrentUser: ownerA,
      currentUserProvider: () => currentUser,
      ownerUserChanges: userChanges.stream,
      pickRestaurantImage: () async => pickedImage,
      validateRestaurantImage: (candidate) async => validatedImage,
      uploadRestaurantImage: ({required uid, required validatedImage}) {
        uploadCalls += 1;
        return pendingUpload.future;
      },
    );
    await _expandSection(tester, 'Restaurant Image');
    final pickButton = find.widgetWithText(
      OutlinedButton,
      'Add restaurant image',
    );
    await tester.ensureVisible(pickButton);
    tester.widget<OutlinedButton>(pickButton).onPressed!();
    await _pumpUntil(tester, () => uploadCalls == 1);

    currentUser = ownerB;
    userChanges.add(ownerB);
    await tester.pumpAndSettle();
    pendingUpload.complete(
      const BiteSaverImageUploadResult(
        imageUrl: 'https://images.example/stale-owner-a-upload.png',
        storagePath: 'synthetic/stale-owner-a-upload.png',
      ),
    );
    await tester.pumpAndSettle();

    final preview = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
    );
    expect(preview.imageBytes, isNull);
    expect(preview.imageUrl, ownerBUrl);
    expect(lifecycleCalls, 0);
    expect(
      find.textContaining('uploaded. Save Restaurant Image'),
      findsNothing,
    );
  });

  testWidgets('owner switch before explicit save invalidates captured state', (
    tester,
  ) async {
    const ownerAUploadUrl = 'https://images.example/pending-owner-a.png';
    const ownerBUrl = 'https://images.example/save-owner-b.jpg';
    final ownerA = _TestUser(uid: 'save-a');
    final ownerB = _TestUser(uid: 'save-b');
    User? currentUser = ownerA;
    final userChanges = StreamController<User?>.broadcast(sync: true);
    addTearDown(userChanges.close);
    final pickedImage = BiteSaverPickedImage(
      fileName: 'save-a.png',
      bytes: _onePixelPng(),
    );
    final validatedImage = await _validatedRestaurantImage(tester, pickedImage);
    var lifecycleCalls = 0;

    await _pumpApplicationScreen(
      tester,
      lifecycleService: BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          lifecycleCalls += 1;
          throw StateError('No lifecycle call was expected.');
        },
      ),
      loadAccount: (uid) async => _approvedAccount(
        uid: uid,
        mainImageUrl: uid == ownerB.uid ? ownerBUrl : null,
      ),
      testCurrentUser: ownerA,
      currentUserProvider: () => currentUser,
      ownerUserChanges: userChanges.stream,
      pickRestaurantImage: () async => pickedImage,
      validateRestaurantImage: (candidate) async => validatedImage,
      uploadRestaurantImage: ({required uid, required validatedImage}) async =>
          const BiteSaverImageUploadResult(
            imageUrl: ownerAUploadUrl,
            storagePath: 'synthetic/pending-owner-a.png',
          ),
    );
    await _expandSection(tester, 'Restaurant Image');
    await _tapRestaurantImagePicker(tester, 'Add restaurant image');
    final staleSaveCallback = tester
        .widget<ElevatedButton>(
          find.widgetWithText(ElevatedButton, 'Save Restaurant Image'),
        )
        .onPressed!;

    currentUser = ownerB;
    userChanges.add(ownerB);
    await tester.pumpAndSettle();
    staleSaveCallback();
    await tester.pumpAndSettle();

    expect(lifecycleCalls, 0);
    final preview = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
    );
    expect(preview.imageBytes, isNull);
    expect(preview.imageUrl, ownerBUrl);
  });

  testWidgets('same UID account document switch clears prior selection', (
    tester,
  ) async {
    const sameUid = 'same-owner';
    const documentBUrl = 'https://images.example/document-b.jpg';
    final user = _TestUser(uid: sameUid);
    final userChanges = StreamController<User?>.broadcast(sync: true);
    addTearDown(userChanges.close);
    var accountDocumentId = 'restaurant-document-a';
    final pickedImage = BiteSaverPickedImage(
      fileName: 'document-a.png',
      bytes: _onePixelPng(),
    );
    final validatedImage = await _validatedRestaurantImage(tester, pickedImage);
    final pendingUpload = Completer<BiteSaverImageUploadResult>();
    var uploadCalls = 0;
    var lifecycleCalls = 0;

    await _pumpApplicationScreen(
      tester,
      lifecycleService: BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          lifecycleCalls += 1;
          throw StateError('No lifecycle call was expected.');
        },
      ),
      loadAccount: (uid) async => _approvedAccount(
        uid: uid,
        profileVersion: accountDocumentId.endsWith('b') ? 8 : 4,
        mainImageUrl: accountDocumentId.endsWith('b') ? documentBUrl : null,
      ),
      testCurrentUser: user,
      currentUserProvider: () => user,
      ownerUserChanges: userChanges.stream,
      accountDocumentIdForUid: (uid) => accountDocumentId,
      pickRestaurantImage: () async => pickedImage,
      validateRestaurantImage: (candidate) async => validatedImage,
      uploadRestaurantImage: ({required uid, required validatedImage}) {
        uploadCalls += 1;
        return pendingUpload.future;
      },
    );
    await _expandSection(tester, 'Restaurant Image');
    final pickButton = find.widgetWithText(
      OutlinedButton,
      'Add restaurant image',
    );
    await tester.ensureVisible(pickButton);
    tester.widget<OutlinedButton>(pickButton).onPressed!();
    await _pumpUntil(tester, () => uploadCalls == 1);
    final staleSaveCallback = tester
        .widget<ElevatedButton>(
          find.widgetWithText(ElevatedButton, 'Save Restaurant Image'),
        )
        .onPressed!;

    accountDocumentId = 'restaurant-document-b';
    userChanges.add(user);
    await tester.pumpAndSettle();
    pendingUpload.complete(
      const BiteSaverImageUploadResult(
        imageUrl: 'https://images.example/document-a-pending.png',
        storagePath: 'synthetic/document-a-pending.png',
      ),
    );
    await tester.pumpAndSettle();
    staleSaveCallback();
    await tester.pumpAndSettle();

    expect(lifecycleCalls, 0);
    final preview = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
    );
    expect(preview.imageBytes, isNull);
    expect(preview.imageUrl, documentBUrl);
  });

  testWidgets(
    'same UID document switch during save ignores old result and versions',
    (tester) async {
      const sameUid = 'same-save-owner';
      const documentBUrl = 'https://images.example/save-document-b.jpg';
      final user = _TestUser(uid: sameUid);
      final userChanges = StreamController<User?>.broadcast(sync: true);
      addTearDown(userChanges.close);
      var accountDocumentId = 'save-document-a';
      var documentBProfileVersion = 21;
      final pickedImage = BiteSaverPickedImage(
        fileName: 'save-document-a.png',
        bytes: _onePixelPng(),
      );
      final validatedImage = await _validatedRestaurantImage(
        tester,
        pickedImage,
      );
      final pendingDocumentASave = Completer<Object?>();
      final pendingDocumentBSave = Completer<Object?>();
      final lifecyclePayloads = <Map<String, dynamic>>[];

      await _pumpApplicationScreen(
        tester,
        lifecycleService: BiteSaverRestaurantLifecycleService(
          invokeCallable: (name, payload) {
            lifecyclePayloads.add(Map<String, dynamic>.from(payload));
            if (lifecyclePayloads.length == 1) {
              return pendingDocumentASave.future;
            }
            return pendingDocumentBSave.future;
          },
        ),
        loadAccount: (uid) async => _approvedAccount(
          uid: uid,
          profileVersion: accountDocumentId.endsWith('b')
              ? documentBProfileVersion
              : 4,
          locationVersion: accountDocumentId.endsWith('b') ? 9 : 2,
          mainImageUrl: accountDocumentId.endsWith('b') ? documentBUrl : null,
        ),
        testCurrentUser: user,
        currentUserProvider: () => user,
        ownerUserChanges: userChanges.stream,
        accountDocumentIdForUid: (uid) => accountDocumentId,
        pickRestaurantImage: () async => pickedImage,
        validateRestaurantImage: (candidate) async => validatedImage,
        uploadRestaurantImage:
            ({required uid, required validatedImage}) async =>
                const BiteSaverImageUploadResult(
                  imageUrl:
                      'https://images.example/save-document-a-pending.png',
                  storagePath: 'synthetic/save-document-a-pending.png',
                ),
      );
      await _expandSection(tester, 'Restaurant Image');
      await _tapRestaurantImagePicker(tester, 'Add restaurant image');
      final saveButton = find.widgetWithText(
        ElevatedButton,
        'Save Restaurant Image',
      );
      await tester.ensureVisible(saveButton);
      tester.widget<ElevatedButton>(saveButton).onPressed!();
      await _pumpUntil(tester, () => lifecyclePayloads.length == 1);

      accountDocumentId = 'save-document-b';
      userChanges.add(user);
      await tester.pumpAndSettle();
      await _expandSection(tester, 'Hours');
      final saveHours = find.widgetWithText(ElevatedButton, 'Save Hours');
      await tester.ensureVisible(saveHours);
      tester.widget<ElevatedButton>(saveHours).onPressed!();
      await _pumpUntil(tester, () => lifecyclePayloads.length == 2);
      expect(pendingDocumentASave.isCompleted, isFalse);
      expect(pendingDocumentBSave.isCompleted, isFalse);

      pendingDocumentASave.complete(<String, dynamic>{
        'documentId': 'save-document-a',
        'approvalStatus': 'approved',
        'profileVersion': 99,
        'locationVersion': 88,
      });
      await tester.pump();
      await tester.pump();

      expect(find.text('Restaurant image saved.'), findsNothing);
      expect(
        find.widgetWithText(ElevatedButton, 'Saving hours...'),
        findsOneWidget,
      );
      expect(
        tester
            .widget<ElevatedButton>(
              find.widgetWithText(ElevatedButton, 'Saving hours...'),
            )
            .onPressed,
        isNull,
      );
      final preview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
      );
      expect(preview.imageBytes, isNull);
      expect(preview.imageUrl, documentBUrl);

      documentBProfileVersion = 22;
      pendingDocumentBSave.complete(<String, dynamic>{
        'documentId': 'save-document-b',
        'approvalStatus': 'approved',
        'profileVersion': documentBProfileVersion,
        'locationVersion': 9,
      });
      await tester.pumpAndSettle();

      expect(lifecyclePayloads, hasLength(2));
      expect(lifecyclePayloads[1]['expectedProfileVersion'], 21);
      expect(lifecyclePayloads[1]['expectedLocationVersion'], 9);
      expect(find.text('Restaurant hours saved.'), findsOneWidget);
    },
  );

  testWidgets('sign-out makes selected bytes and uploaded URL inaccessible', (
    tester,
  ) async {
    const signedOutCanary = 'A-SIGNOUT-PROFILE-CANARY';
    final owner = _TestUser(
      uid: 'signout-owner',
      email: 'signout-a@example.test',
    );
    User? currentUser = owner;
    final userChanges = StreamController<User?>.broadcast(sync: true);
    addTearDown(userChanges.close);
    final pickedImage = BiteSaverPickedImage(
      fileName: 'signout.png',
      bytes: _onePixelPng(),
    );
    final validatedImage = await _validatedRestaurantImage(tester, pickedImage);
    var lifecycleCalls = 0;

    await _pumpApplicationScreen(
      tester,
      lifecycleService: BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          lifecycleCalls += 1;
          throw StateError('No lifecycle call was expected.');
        },
      ),
      loadAccount: (uid) async => _approvedAccount(
        uid: uid,
        email: owner.email!,
        restaurantName: signedOutCanary,
        streetAddress: '71 A Signout Street',
        city: 'A Signout City',
        state: 'AL',
        zipCode: '35771',
        phone: '(256) 555-0171',
        website: 'https://a-signout.example',
        bio: 'A signout bio',
        businessHours: _businessHoursForSunday(
          opensAt: '4:15 AM',
          closesAt: '5:45 AM',
        ),
        profileVersion: 71,
        locationVersion: 61,
      ),
      testCurrentUser: owner,
      currentUserProvider: () => currentUser,
      ownerUserChanges: userChanges.stream,
      pickRestaurantImage: () async => pickedImage,
      validateRestaurantImage: (candidate) async => validatedImage,
      uploadRestaurantImage: ({required uid, required validatedImage}) async =>
          const BiteSaverImageUploadResult(
            imageUrl: 'https://images.example/signout-pending.png',
            storagePath: 'synthetic/signout-pending.png',
          ),
    );
    await _expandSection(tester, 'Restaurant Image');
    await _tapRestaurantImagePicker(tester, 'Add restaurant image');
    final staleSaveCallback = tester
        .widget<ElevatedButton>(
          find.widgetWithText(ElevatedButton, 'Save Restaurant Image'),
        )
        .onPressed!;

    currentUser = null;
    userChanges.add(null);
    await tester.pumpAndSettle();
    final clearedProfile = LocalRestaurantProfileStore.profile.value;
    expect(clearedProfile.name, isEmpty);
    expect(clearedProfile.streetAddress, isEmpty);
    expect(clearedProfile.phone, isEmpty);
    expect(clearedProfile.website, isEmpty);
    expect(clearedProfile.bio, isEmpty);
    expect(clearedProfile.businessHours, isEmpty);
    expect(find.textContaining(signedOutCanary), findsNothing);
    expect(find.textContaining('A Signout'), findsNothing);
    expect(find.textContaining('a-signout.example'), findsNothing);
    expect(find.text('Apply for Coupon-Side Approval'), findsOneWidget);
    expect(_fieldText(tester, 'Restaurant Name'), isEmpty);
    expect(_fieldText(tester, 'Street Address'), isEmpty);
    expect(_fieldText(tester, 'City'), isEmpty);
    expect(_fieldText(tester, 'State'), isEmpty);
    expect(_fieldText(tester, 'ZIP Code'), isEmpty);
    expect(_fieldText(tester, 'Phone Number'), isEmpty);
    expect(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
      findsNothing,
    );
    staleSaveCallback();
    await tester.pumpAndSettle();
    expect(lifecycleCalls, 0);
    expect(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
      findsNothing,
    );
  });

  testWidgets(
    'owner switch during image save cannot reconcile versions or success',
    (tester) async {
      const ownerBUrl = 'https://images.example/inflight-owner-b.jpg';
      final ownerA = _TestUser(uid: 'inflight-a');
      final ownerB = _TestUser(uid: 'inflight-b');
      User? currentUser = ownerA;
      final userChanges = StreamController<User?>.broadcast(sync: true);
      addTearDown(userChanges.close);
      final pickedImage = BiteSaverPickedImage(
        fileName: 'inflight-a.png',
        bytes: _onePixelPng(),
      );
      final validatedImage = await _validatedRestaurantImage(
        tester,
        pickedImage,
      );
      final pendingOwnerASave = Completer<Object?>();
      final lifecyclePayloads = <Map<String, dynamic>>[];
      var ownerALoads = 0;
      var ownerBAccount = _approvedAccount(
        uid: ownerB.uid,
        profileVersion: 11,
        locationVersion: 7,
        mainImageUrl: ownerBUrl,
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: BiteSaverRestaurantLifecycleService(
          invokeCallable: (name, payload) {
            lifecyclePayloads.add(Map<String, dynamic>.from(payload));
            if (lifecyclePayloads.length == 1) {
              return pendingOwnerASave.future;
            }
            ownerBAccount = _approvedAccount(
              uid: ownerB.uid,
              profileVersion: 12,
              locationVersion: 7,
              mainImageUrl: ownerBUrl,
            );
            return Future<Object?>.value(<String, dynamic>{
              'documentId': ownerB.uid,
              'approvalStatus': 'approved',
              'profileVersion': 12,
              'locationVersion': 7,
            });
          },
        ),
        loadAccount: (uid) async {
          if (uid == ownerA.uid) {
            ownerALoads += 1;
            return _approvedAccount(uid: ownerA.uid);
          }
          return ownerBAccount;
        },
        testCurrentUser: ownerA,
        currentUserProvider: () => currentUser,
        ownerUserChanges: userChanges.stream,
        pickRestaurantImage: () async => pickedImage,
        validateRestaurantImage: (candidate) async => validatedImage,
        uploadRestaurantImage:
            ({required uid, required validatedImage}) async =>
                const BiteSaverImageUploadResult(
                  imageUrl: 'https://images.example/inflight-owner-a.png',
                  storagePath: 'synthetic/inflight-owner-a.png',
                ),
      );
      await _expandSection(tester, 'Restaurant Image');
      await _tapRestaurantImagePicker(tester, 'Add restaurant image');
      final saveButton = find.widgetWithText(
        ElevatedButton,
        'Save Restaurant Image',
      );
      await tester.ensureVisible(saveButton);
      final saveCallback = tester.widget<ElevatedButton>(saveButton).onPressed!;
      saveCallback();
      saveCallback();
      await _pumpUntil(tester, () => lifecyclePayloads.length == 1);
      await tester.pump();
      expect(
        tester
            .widget<ElevatedButton>(
              find.widgetWithText(ElevatedButton, 'Saving image...'),
            )
            .onPressed,
        isNull,
      );

      currentUser = ownerB;
      userChanges.add(ownerB);
      await tester.pumpAndSettle();
      pendingOwnerASave.complete(<String, dynamic>{
        'documentId': ownerA.uid,
        'approvalStatus': 'approved',
        'profileVersion': 99,
        'locationVersion': 88,
      });
      await tester.pumpAndSettle();

      expect(find.text('Restaurant image saved.'), findsNothing);
      expect(ownerALoads, 1);
      final preview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
      );
      expect(preview.imageBytes, isNull);
      expect(preview.imageUrl, ownerBUrl);

      await _expandSection(tester, 'Hours');
      await _tapElevatedButton(tester, 'Save Hours');
      expect(lifecyclePayloads, hasLength(2));
      expect(lifecyclePayloads[1]['updateSection'], 'businessHours');
      expect(lifecyclePayloads[1]['expectedProfileVersion'], 11);
      expect(lifecyclePayloads[1]['expectedLocationVersion'], 7);
    },
  );

  testWidgets(
    'transition during post-call reload hides old transient state and ignores stale reconciliation',
    (tester) async {
      const ownerATransientUrl = 'https://images.example/post-call-owner-a.png';
      const ownerBUrl = 'https://images.example/post-call-owner-b.jpg';
      final ownerA = _TestUser(uid: 'post-call-a');
      final ownerB = _TestUser(uid: 'post-call-b');
      User? currentUser = ownerA;
      final userChanges = StreamController<User?>.broadcast(sync: true);
      addTearDown(userChanges.close);
      final pickedImage = BiteSaverPickedImage(
        fileName: 'post-call-owner-a.png',
        bytes: _onePixelPng(),
      );
      final validatedImage = await _validatedRestaurantImage(
        tester,
        pickedImage,
      );
      final pendingOwnerARefresh = Completer<Map<String, dynamic>?>();
      final pendingOwnerBLoad = Completer<Map<String, dynamic>?>();
      final lifecyclePayloads = <Map<String, dynamic>>[];
      var ownerALoads = 0;
      var ownerBLoads = 0;

      await _pumpApplicationScreen(
        tester,
        lifecycleService: BiteSaverRestaurantLifecycleService(
          invokeCallable: (name, payload) async {
            lifecyclePayloads.add(Map<String, dynamic>.from(payload));
            final isOwnerAImage = lifecyclePayloads.length == 1;
            return <String, dynamic>{
              'documentId': isOwnerAImage ? ownerA.uid : ownerB.uid,
              'approvalStatus': 'approved',
              'profileVersion': isOwnerAImage ? 5 : 12,
              'locationVersion': isOwnerAImage ? 2 : 7,
            };
          },
        ),
        loadAccount: (uid) {
          if (uid == ownerA.uid) {
            ownerALoads += 1;
            if (ownerALoads == 1) {
              return Future<Map<String, dynamic>?>.value(
                _approvedAccount(
                  uid: ownerA.uid,
                  profileVersion: 4,
                  mainImageUrl:
                      'https://images.example/post-call-owner-a-old.jpg',
                ),
              );
            }
            return pendingOwnerARefresh.future;
          }
          ownerBLoads += 1;
          return pendingOwnerBLoad.future;
        },
        testCurrentUser: ownerA,
        currentUserProvider: () => currentUser,
        ownerUserChanges: userChanges.stream,
        pickRestaurantImage: () async => pickedImage,
        validateRestaurantImage: (candidate) async => validatedImage,
        uploadRestaurantImage:
            ({required uid, required validatedImage}) async =>
                const BiteSaverImageUploadResult(
                  imageUrl: ownerATransientUrl,
                  storagePath: 'synthetic/post-call-owner-a.png',
                ),
      );
      await _expandSection(tester, 'Restaurant Image');
      await _tapRestaurantImagePicker(tester, 'Change restaurant image');
      await tester.tap(
        find.widgetWithText(ElevatedButton, 'Save Restaurant Image'),
      );
      await _pumpUntil(tester, () => ownerALoads == 2);

      currentUser = ownerB;
      userChanges.add(ownerB);
      await _pumpUntil(tester, () => ownerBLoads == 1);

      expect(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
        findsNothing,
      );
      expect(find.text('Restaurant image saved.'), findsNothing);

      pendingOwnerARefresh.complete(
        _approvedAccount(
          uid: ownerA.uid,
          profileVersion: 99,
          locationVersion: 88,
          mainImageUrl: ownerATransientUrl,
        ),
      );
      await tester.pump();
      await tester.pump();

      expect(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
        findsNothing,
      );
      expect(find.text('Restaurant image saved.'), findsNothing);

      pendingOwnerBLoad.complete(
        _approvedAccount(
          uid: ownerB.uid,
          profileVersion: 11,
          locationVersion: 7,
          mainImageUrl: ownerBUrl,
        ),
      );
      await tester.pumpAndSettle();

      final ownerBPreview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
      );
      expect(ownerBPreview.imageBytes, isNull);
      expect(ownerBPreview.imageUrl, ownerBUrl);
      expect(find.text('Restaurant image saved.'), findsNothing);

      await _expandSection(tester, 'Hours');
      await _tapElevatedButton(tester, 'Save Hours');
      expect(lifecyclePayloads, hasLength(2));
      expect(lifecyclePayloads[0]['updateSection'], 'mainImage');
      expect(lifecyclePayloads[1]['updateSection'], 'businessHours');
      expect(lifecyclePayloads[1]['expectedProfileVersion'], 11);
      expect(lifecyclePayloads[1]['expectedLocationVersion'], 7);
    },
  );

  testWidgets('later selection wins when its upload completes first', (
    tester,
  ) async {
    const firstUrl = 'https://images.example/stale-first.png';
    const secondUrl = 'https://images.example/current-second.png';
    final firstImage = BiteSaverPickedImage(
      fileName: 'first-order.png',
      bytes: _onePixelPng(),
    );
    final secondImage = BiteSaverPickedImage(
      fileName: 'second-order.jpg',
      bytes: _onePixelJpeg(),
    );
    final firstValidatedImage = await _validatedRestaurantImage(
      tester,
      firstImage,
    );
    final secondValidatedImage = await _validatedRestaurantImage(
      tester,
      secondImage,
    );
    final pendingFirstUpload = Completer<BiteSaverImageUploadResult>();
    final pendingSecondUpload = Completer<BiteSaverImageUploadResult>();
    final picks = <BiteSaverPickedImage?>[firstImage, secondImage];
    final uploadedNames = <String>[];
    final lifecyclePayloads = <Map<String, dynamic>>[];
    var account = _approvedAccount();

    await _pumpApplicationScreen(
      tester,
      lifecycleService: BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          lifecyclePayloads.add(Map<String, dynamic>.from(payload));
          account = _approvedAccount(
            profileVersion: 5,
            mainImageUrl: secondUrl,
          );
          return <String, dynamic>{
            'documentId': 'owner-1',
            'approvalStatus': 'approved',
            'profileVersion': 5,
            'locationVersion': 2,
          };
        },
      ),
      loadAccount: (uid) async => account,
      pickRestaurantImage: () async => picks.removeAt(0),
      validateRestaurantImage: (candidate) async =>
          identical(candidate, firstImage)
          ? firstValidatedImage
          : secondValidatedImage,
      uploadRestaurantImage: ({required uid, required validatedImage}) {
        uploadedNames.add(validatedImage.pickedImage.fileName);
        return validatedImage.pickedImage.fileName == firstImage.fileName
            ? pendingFirstUpload.future
            : pendingSecondUpload.future;
      },
    );
    await _expandSection(tester, 'Restaurant Image');
    final pickButton = find.widgetWithText(
      OutlinedButton,
      'Add restaurant image',
    );
    await tester.ensureVisible(pickButton);
    final capturedPickCallback = tester
        .widget<OutlinedButton>(pickButton)
        .onPressed!;
    capturedPickCallback();
    await _pumpUntil(tester, () => uploadedNames.length == 1);
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, 'Uploading...'),
          )
          .onPressed,
      isNull,
    );

    capturedPickCallback();
    await _pumpUntil(tester, () => uploadedNames.length == 2);
    pendingSecondUpload.complete(
      const BiteSaverImageUploadResult(
        imageUrl: secondUrl,
        storagePath: 'synthetic/current-second.png',
      ),
    );
    await tester.pumpAndSettle();

    var preview = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
    );
    expect(
      identical(preview.imageBytes, secondValidatedImage.pickedImage.bytes),
      isTrue,
    );
    expect(preview.imageUrl, secondUrl);

    pendingFirstUpload.complete(
      const BiteSaverImageUploadResult(
        imageUrl: firstUrl,
        storagePath: 'synthetic/stale-first.png',
      ),
    );
    await tester.pumpAndSettle();

    preview = tester.widget<BiteSaverRestaurantImage>(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
    );
    expect(
      identical(preview.imageBytes, secondValidatedImage.pickedImage.bytes),
      isTrue,
    );
    expect(preview.imageUrl, secondUrl);
    expect(uploadedNames, <String>['first-order.png', 'second-order.jpg']);

    await _tapElevatedButton(tester, 'Save Restaurant Image');
    expect(lifecyclePayloads, hasLength(1));
    expect(lifecyclePayloads.single['profile'], <String, dynamic>{
      'mainImageUrl': secondUrl,
    });
  });

  testWidgets(
    'late stale upload failure cannot alter current selection or save state',
    (tester) async {
      const currentUrl = 'https://images.example/current-after-stale.jpg';
      final staleImage = BiteSaverPickedImage(
        fileName: 'stale-failure.png',
        bytes: _onePixelPng(),
      );
      final currentImage = BiteSaverPickedImage(
        fileName: 'current-after-stale.jpg',
        bytes: _onePixelJpeg(),
      );
      final staleValidatedImage = await _validatedRestaurantImage(
        tester,
        staleImage,
      );
      final currentValidatedImage = await _validatedRestaurantImage(
        tester,
        currentImage,
      );
      final pendingStaleUpload = Completer<BiteSaverImageUploadResult>();
      final pendingCurrentUpload = Completer<BiteSaverImageUploadResult>();
      final picks = <BiteSaverPickedImage?>[staleImage, currentImage];
      final uploadedNames = <String>[];
      final lifecyclePayloads = <Map<String, dynamic>>[];
      var account = _approvedAccount();

      await _pumpApplicationScreen(
        tester,
        lifecycleService: BiteSaverRestaurantLifecycleService(
          invokeCallable: (name, payload) async {
            lifecyclePayloads.add(Map<String, dynamic>.from(payload));
            account = _approvedAccount(
              profileVersion: 5,
              mainImageUrl: currentUrl,
            );
            return <String, dynamic>{
              'documentId': 'owner-1',
              'approvalStatus': 'approved',
              'profileVersion': 5,
              'locationVersion': 2,
            };
          },
        ),
        loadAccount: (uid) async => account,
        pickRestaurantImage: () async => picks.removeAt(0),
        validateRestaurantImage: (candidate) async =>
            identical(candidate, staleImage)
            ? staleValidatedImage
            : currentValidatedImage,
        uploadRestaurantImage: ({required uid, required validatedImage}) {
          final fileName = validatedImage.pickedImage.fileName;
          uploadedNames.add(fileName);
          return fileName == staleImage.fileName
              ? pendingStaleUpload.future
              : pendingCurrentUpload.future;
        },
      );
      await _expandSection(tester, 'Restaurant Image');
      final capturedPickCallback = tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, 'Add restaurant image'),
          )
          .onPressed!;
      capturedPickCallback();
      await _pumpUntil(tester, () => uploadedNames.length == 1);
      capturedPickCallback();
      await _pumpUntil(tester, () => uploadedNames.length == 2);

      pendingCurrentUpload.complete(
        const BiteSaverImageUploadResult(
          imageUrl: currentUrl,
          storagePath: 'synthetic/current-after-stale.jpg',
        ),
      );
      await tester.pumpAndSettle();

      pendingStaleUpload.completeError(
        FirebaseException(
          plugin: 'firebase_storage',
          code: 'unavailable',
          message: 'raw stale upload provider details',
        ),
      );
      await tester.pumpAndSettle();

      final preview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
      );
      expect(
        identical(preview.imageBytes, currentValidatedImage.pickedImage.bytes),
        isTrue,
      );
      expect(preview.imageUrl, currentUrl);
      expect(
        find.text(
          'Restaurant image uploaded. Save Restaurant Image to apply it.',
        ),
        findsOneWidget,
      );
      expect(
        find.text('This service is temporarily unavailable. Please try again.'),
        findsNothing,
      );
      expect(find.textContaining('raw stale upload'), findsNothing);
      expect(find.text('Uploading...'), findsNothing);
      expect(
        tester
            .widget<OutlinedButton>(
              find.widgetWithText(OutlinedButton, 'Change restaurant image'),
            )
            .onPressed,
        isNotNull,
      );
      expect(
        tester
            .widget<ElevatedButton>(
              find.widgetWithText(ElevatedButton, 'Save Restaurant Image'),
            )
            .onPressed,
        isNotNull,
      );

      await _tapElevatedButton(tester, 'Save Restaurant Image');
      expect(lifecyclePayloads, hasLength(1));
      expect(lifecyclePayloads.single['profile'], <String, dynamic>{
        'mainImageUrl': currentUrl,
      });
    },
  );

  testWidgets(
    'disposal during picker validation upload and image save is safe',
    (tester) async {
      final pickedImage = BiteSaverPickedImage(
        fileName: 'dispose.png',
        bytes: _onePixelPng(),
      );
      final validatedImage = await _validatedRestaurantImage(
        tester,
        pickedImage,
      );

      for (final boundary in <String>[
        'picker',
        'validation',
        'upload',
        'save',
      ]) {
        final pendingPick = Completer<BiteSaverPickedImage?>();
        final pendingValidation =
            Completer<BiteSaverValidatedRestaurantImage?>();
        final pendingUpload = Completer<BiteSaverImageUploadResult>();
        final pendingSave = Completer<Object?>();
        var validationCalls = 0;
        var uploadCalls = 0;
        var saveCalls = 0;
        var accountLoads = 0;

        await _pumpApplicationScreen(
          tester,
          lifecycleService: BiteSaverRestaurantLifecycleService(
            invokeCallable: (name, payload) {
              saveCalls += 1;
              return pendingSave.future;
            },
          ),
          loadAccount: (uid) async {
            accountLoads += 1;
            return _approvedAccount();
          },
          pickRestaurantImage: () => boundary == 'picker'
              ? pendingPick.future
              : Future<BiteSaverPickedImage?>.value(pickedImage),
          validateRestaurantImage: (candidate) {
            validationCalls += 1;
            return boundary == 'validation'
                ? pendingValidation.future
                : Future<BiteSaverValidatedRestaurantImage?>.value(
                    validatedImage,
                  );
          },
          uploadRestaurantImage: ({required uid, required validatedImage}) {
            uploadCalls += 1;
            return boundary == 'upload'
                ? pendingUpload.future
                : Future<BiteSaverImageUploadResult>.value(
                    const BiteSaverImageUploadResult(
                      imageUrl: 'https://images.example/dispose.png',
                      storagePath: 'synthetic/dispose.png',
                    ),
                  );
          },
        );
        await _expandSection(tester, 'Restaurant Image');

        if (boundary == 'save') {
          await _tapRestaurantImagePicker(tester, 'Add restaurant image');
          final saveButton = find.widgetWithText(
            ElevatedButton,
            'Save Restaurant Image',
          );
          await tester.ensureVisible(saveButton);
          tester.widget<ElevatedButton>(saveButton).onPressed!();
          await _pumpUntil(tester, () => saveCalls == 1);
        } else {
          final pickButton = find.widgetWithText(
            OutlinedButton,
            'Add restaurant image',
          );
          await tester.ensureVisible(pickButton);
          tester.widget<OutlinedButton>(pickButton).onPressed!();
          if (boundary == 'validation') {
            await _pumpUntil(tester, () => validationCalls == 1);
          } else if (boundary == 'upload') {
            await _pumpUntil(tester, () => uploadCalls == 1);
          } else {
            await tester.pump();
          }
          expect(
            tester
                .widget<OutlinedButton>(
                  find.widgetWithText(OutlinedButton, 'Uploading...'),
                )
                .onPressed,
            isNull,
          );
        }

        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
        switch (boundary) {
          case 'picker':
            pendingPick.complete(pickedImage);
            break;
          case 'validation':
            pendingValidation.complete(validatedImage);
            break;
          case 'upload':
            pendingUpload.complete(
              const BiteSaverImageUploadResult(
                imageUrl: 'https://images.example/disposed-upload.png',
                storagePath: 'synthetic/disposed-upload.png',
              ),
            );
            break;
          case 'save':
            pendingSave.complete(<String, dynamic>{
              'documentId': 'owner-1',
              'approvalStatus': 'approved',
              'profileVersion': 5,
              'locationVersion': 2,
            });
            break;
        }
        await tester.pumpAndSettle();

        if (boundary == 'picker') {
          expect(validationCalls, 0);
          expect(uploadCalls, 0);
        } else if (boundary == 'validation') {
          expect(uploadCalls, 0);
        }
        if (boundary != 'save') {
          expect(saveCalls, 0);
        }
        expect(accountLoads, 1);
        expect(tester.takeException(), isNull, reason: boundary);
      }
    },
  );

  testWidgets(
    'saved URL renders unchanged in owner and persisted Customer Preview',
    (tester) async {
      var lifecycleCalls = 0;
      final service = BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          lifecycleCalls += 1;
          throw StateError('Viewing an image must not save.');
        },
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: service,
        loadAccount: (uid) async =>
            _approvedAccount(mainImageUrl: _syntheticRestaurantImageUrl),
      );
      await _expandSection(tester, 'Restaurant Image');
      await _expandSection(tester, 'Customer Preview');

      final ownerPreview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
      );
      final customerPreview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-customer-preview')),
      );

      expect(ownerPreview.imageBytes, isNull);
      expect(ownerPreview.imageUrl, _syntheticRestaurantImageUrl);
      expect(customerPreview.imageBytes, isNull);
      expect(customerPreview.imageUrl, _syntheticRestaurantImageUrl);
      expect(lifecycleCalls, 0);
    },
  );

  testWidgets('empty restaurant image keeps owner and customer empty states', (
    tester,
  ) async {
    await _pumpApplicationScreen(
      tester,
      loadAccount: (uid) async => _approvedAccount(),
    );
    await _expandSection(tester, 'Restaurant Image');
    await _expandSection(tester, 'Customer Preview');

    expect(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('restaurant-image-customer-preview')),
      findsNothing,
    );
    expect(
      find.widgetWithText(OutlinedButton, 'Add restaurant image'),
      findsOneWidget,
    );
    expect(find.text('Image preview unavailable'), findsNothing);
  });

  testWidgets(
    'Basic and Hours saves cannot persist or clear a selected image preview',
    (tester) async {
      final bytes = _onePixelPng();
      final pickedImage = BiteSaverPickedImage(
        fileName: 'pending.png',
        bytes: bytes,
      );
      final validatedImage = await _validatedRestaurantImage(
        tester,
        pickedImage,
      );
      final payloads = <Map<String, dynamic>>[];
      var account = _approvedAccount();
      final service = BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          payloads.add(Map<String, dynamic>.from(payload));
          final nextProfileVersion = 4 + payloads.length;
          account = _approvedAccount(profileVersion: nextProfileVersion);
          return <String, dynamic>{
            'documentId': 'owner-1',
            'approvalStatus': 'approved',
            'profileVersion': nextProfileVersion,
            'locationVersion': 2,
          };
        },
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: service,
        loadAccount: (uid) async => account,
        pickRestaurantImage: () async => pickedImage,
        validateRestaurantImage: (candidate) async => validatedImage,
        uploadRestaurantImage:
            ({required uid, required validatedImage}) async =>
                const BiteSaverImageUploadResult(
                  imageUrl: _syntheticRestaurantImageUrl,
                  storagePath: 'synthetic/pending.png',
                ),
      );
      await _expandSection(tester, 'Restaurant Image');
      await _tapRestaurantImagePicker(tester, 'Add restaurant image');

      await _expandSection(tester, 'Basic Restaurant Information');
      await _tapElevatedButton(tester, 'Save Basic Information');
      await _expandSection(tester, 'Hours');
      await _tapElevatedButton(tester, 'Save Hours');

      expect(payloads, hasLength(2));
      expect(payloads[0]['updateSection'], 'basicInformation');
      expect(
        payloads[0]['profile'] as Map<String, dynamic>,
        isNot(contains('mainImageUrl')),
      );
      expect(payloads[1]['updateSection'], 'businessHours');
      expect(
        payloads[1]['profile'] as Map<String, dynamic>,
        isNot(contains('mainImageUrl')),
      );
      final preview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
      );
      expect(
        identical(preview.imageBytes, validatedImage.pickedImage.bytes),
        isTrue,
      );
      expect(preview.imageUrl, _syntheticRestaurantImageUrl);
    },
  );

  testWidgets(
    'explicit save persists uploaded URL once then retains location version',
    (tester) async {
      final bytes = _onePixelPng();
      final pickedImage = BiteSaverPickedImage(
        fileName: 'saved.png',
        bytes: bytes,
      );
      final validatedImage = await _validatedRestaurantImage(
        tester,
        pickedImage,
      );
      final payloads = <Map<String, dynamic>>[];
      var account = _approvedAccount();
      final service = BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          payloads.add(Map<String, dynamic>.from(payload));
          final nextProfileVersion = 4 + payloads.length;
          account = _approvedAccount(
            profileVersion: nextProfileVersion,
            mainImageUrl: _syntheticRestaurantImageUrl,
          );
          return <String, dynamic>{
            'documentId': 'owner-1',
            'approvalStatus': 'approved',
            'profileVersion': nextProfileVersion,
            'locationVersion': 2,
          };
        },
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: service,
        loadAccount: (uid) async => account,
        pickRestaurantImage: () async => pickedImage,
        validateRestaurantImage: (candidate) async => validatedImage,
        uploadRestaurantImage:
            ({required uid, required validatedImage}) async =>
                const BiteSaverImageUploadResult(
                  imageUrl: _syntheticRestaurantImageUrl,
                  storagePath: 'synthetic/saved.png',
                ),
      );
      await _expandSection(tester, 'Restaurant Image');
      await _tapRestaurantImagePicker(tester, 'Add restaurant image');
      await _tapElevatedButton(tester, 'Save Restaurant Image');

      expect(payloads, hasLength(1));
      expect(payloads.single['updateSection'], 'mainImage');
      expect(payloads.single['expectedProfileVersion'], 4);
      expect(payloads.single['expectedLocationVersion'], 2);
      expect(payloads.single['profile'], <String, dynamic>{
        'mainImageUrl': _syntheticRestaurantImageUrl,
      });
      expect(find.text('Restaurant image saved.'), findsOneWidget);

      final ownerPreview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-owner-preview')),
      );
      expect(ownerPreview.imageBytes, isNull);
      expect(ownerPreview.imageUrl, _syntheticRestaurantImageUrl);

      await _expandSection(tester, 'Customer Preview');
      final customerPreview = tester.widget<BiteSaverRestaurantImage>(
        find.byKey(const ValueKey('restaurant-image-customer-preview')),
      );
      expect(customerPreview.imageUrl, _syntheticRestaurantImageUrl);

      await _expandSection(tester, 'Hours');
      await _tapElevatedButton(tester, 'Save Hours');

      expect(payloads, hasLength(2));
      expect(payloads[1]['updateSection'], 'businessHours');
      expect(payloads[1]['expectedProfileVersion'], 5);
      expect(payloads[1]['expectedLocationVersion'], 2);
      expect(
        payloads[1]['profile'] as Map<String, dynamic>,
        isNot(contains('mainImageUrl')),
      );
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
      expect(lifecyclePayload!['updateSection'], 'basicInformation');
      expect(profile, isNot(contains('restaurantName')));
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
      expect(find.text('Restaurant profile saved.'), findsNothing);
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
      expect(find.text('Restaurant profile saved.'), findsNothing);
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
      expect(find.text('Restaurant profile saved.'), findsNothing);
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
    'stale conflict recovers after authoritative reload and uses new versions',
    (tester) async {
      final invocations = <Map<String, dynamic>>[];
      var account = _approvedAccount(
        profileVersion: 4,
        bio: 'Version four bio',
      );
      final service = BiteSaverRestaurantLifecycleService(
        invokeCallable: (name, payload) async {
          invocations.add(Map<String, dynamic>.from(payload));
          if (invocations.length == 1) {
            throw const BiteSaverCallableFailure(
              'aborted',
              'raw newer profile',
            );
          }
          account = _approvedAccount(profileVersion: 6, bio: 'Recovered save');
          return <String, dynamic>{
            'documentId': 'owner-1',
            'approvalStatus': 'approved',
            'profileVersion': 6,
            'locationVersion': 2,
          };
        },
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: service,
        loadAccount: (uid) async => account,
      );
      await _expandSection(tester, 'Basic Restaurant Information');
      await tester.enterText(_fieldWithLabel('Short Bio'), 'Stale draft');
      var saveButton = find.widgetWithText(
        ElevatedButton,
        'Save Basic Information',
      );
      await tester.ensureVisible(saveButton);
      await tester.tap(saveButton);
      await tester.pumpAndSettle();

      expect(
        find.text(
          'The restaurant profile changed. Reload the latest version and try again.',
        ),
        findsOneWidget,
      );
      expect(find.text('Restaurant profile saved.'), findsNothing);
      expect(_fieldText(tester, 'Short Bio'), 'Stale draft');

      account = _approvedAccount(
        profileVersion: 5,
        bio: 'Authoritative version five',
      );
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      await tester.pumpAndSettle();
      await _pumpApplicationScreen(
        tester,
        lifecycleService: service,
        loadAccount: (uid) async => account,
      );
      await _expandSection(tester, 'Basic Restaurant Information');
      expect(_fieldText(tester, 'Short Bio'), 'Authoritative version five');
      await tester.enterText(_fieldWithLabel('Short Bio'), 'Recovered save');
      saveButton = find.widgetWithText(
        ElevatedButton,
        'Save Basic Information',
      );
      await tester.ensureVisible(saveButton);
      await tester.tap(saveButton);
      await tester.pumpAndSettle();

      expect(invocations, hasLength(2));
      expect(invocations[1]['expectedProfileVersion'], 5);
      expect(invocations[1]['expectedLocationVersion'], 2);
      expect(find.text('Restaurant profile saved.'), findsOneWidget);
      expect(_fieldText(tester, 'Short Bio'), 'Recovered save');
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
      expect(invocations[1]['updateSection'], 'basicInformation');
      expect(invocations[1]['expectedProfileVersion'], 5);
      expect(invocations[1]['expectedLocationVersion'], 2);
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

  testWidgets(
    'stale posting-readiness load cannot install versions for a new owner',
    (tester) async {
      const ownerBExistingUrl =
          'https://images.example/readiness-owner-b-old.jpg';
      const ownerBReplacementUrl =
          'https://images.example/readiness-owner-b-new.png';
      final ownerA = _TestUser(uid: 'readiness-owner-a');
      final ownerB = _TestUser(uid: 'readiness-owner-b');
      User? currentUser = ownerA;
      final userChanges = StreamController<User?>.broadcast(sync: true);
      addTearDown(userChanges.close);
      final pendingOwnerAReadiness = Completer<Map<String, dynamic>?>();
      final pickedImage = BiteSaverPickedImage(
        fileName: 'readiness-owner-b.png',
        bytes: _onePixelPng(),
      );
      final validatedImage = await _validatedRestaurantImage(
        tester,
        pickedImage,
      );
      final lifecyclePayloads = <Map<String, dynamic>>[];
      var ownerALoads = 0;
      var ownerBLoads = 0;
      var ownerBAccount = _approvedAccount(
        uid: ownerB.uid,
        profileVersion: 11,
        locationVersion: 7,
        mainImageUrl: ownerBExistingUrl,
      );

      await _pumpApplicationScreen(
        tester,
        lifecycleService: BiteSaverRestaurantLifecycleService(
          invokeCallable: (name, payload) async {
            lifecyclePayloads.add(Map<String, dynamic>.from(payload));
            ownerBAccount = _approvedAccount(
              uid: ownerB.uid,
              profileVersion: 12,
              locationVersion: 7,
              mainImageUrl: ownerBReplacementUrl,
            );
            return <String, dynamic>{
              'documentId': ownerB.uid,
              'approvalStatus': 'approved',
              'profileVersion': 12,
              'locationVersion': 7,
            };
          },
        ),
        loadAccount: (uid) {
          if (uid == ownerA.uid) {
            ownerALoads += 1;
            if (ownerALoads == 3) {
              return pendingOwnerAReadiness.future;
            }
            return Future<Map<String, dynamic>?>.value(
              _approvedAccount(
                uid: ownerA.uid,
                profileVersion: 4,
                locationVersion: 2,
              ),
            );
          }
          ownerBLoads += 1;
          return Future<Map<String, dynamic>?>.value(ownerBAccount);
        },
        testCurrentUser: ownerA,
        currentUserProvider: () => currentUser,
        ownerUserChanges: userChanges.stream,
        pickRestaurantImage: () async => pickedImage,
        validateRestaurantImage: (candidate) async => validatedImage,
        uploadRestaurantImage: ({required uid, required validatedImage}) async {
          expect(uid, ownerB.uid);
          return const BiteSaverImageUploadResult(
            imageUrl: ownerBReplacementUrl,
            storagePath: 'synthetic/readiness-owner-b.png',
          );
        },
      );
      await _expandSection(tester, 'Coupon Management');
      await tester.tap(find.widgetWithText(ElevatedButton, 'Create Coupon'));
      await _pumpUntil(tester, () => ownerALoads == 3);

      currentUser = ownerB;
      userChanges.add(ownerB);
      await _pumpUntil(tester, () => ownerBLoads == 1);
      pendingOwnerAReadiness.complete(
        _approvedAccount(
          uid: ownerA.uid,
          profileVersion: 99,
          locationVersion: 88,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Coupon title is required.'), findsNothing);
      expect(lifecyclePayloads, isEmpty);

      await _expandSection(tester, 'Restaurant Image');
      await _tapRestaurantImagePicker(tester, 'Change restaurant image');
      await _tapElevatedButton(tester, 'Save Restaurant Image');

      expect(lifecyclePayloads, hasLength(1));
      expect(lifecyclePayloads.single['updateSection'], 'mainImage');
      expect(lifecyclePayloads.single['expectedProfileVersion'], 11);
      expect(lifecyclePayloads.single['expectedLocationVersion'], 7);
      expect(lifecyclePayloads.single['profile'], <String, dynamic>{
        'mainImageUrl': ownerBReplacementUrl,
      });
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

  for (final sameUidDocumentSwitch in <bool>[false, true]) {
    for (final failure in <bool>[false, true]) {
      testWidgets(
        'B submits immediately while pending A application '
        '${failure ? 'failure' : 'success'} is ignored after '
        '${sameUidDocumentSwitch ? 'same-UID document' : 'UID'} switch',
        (tester) => _verifyPendingApplicationCompletionIsOwnerScoped(
          tester,
          sameUidDocumentSwitch: sameUidDocumentSwitch,
          failure: failure,
        ),
      );
    }
  }

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

  testWidgets('customer portal return refreshes subscription state once', (
    tester,
  ) async {
    final refreshTransitions = <bool>[];
    var accountLoads = 0;
    await _pumpApplicationScreen(
      tester,
      loadAccount: (uid) async {
        accountLoads += 1;
        return _approvedAccount();
      },
      onSubscriptionRefreshStateChanged: refreshTransitions.add,
    );
    expect(accountLoads, 1);

    await _dispatchAndClaimNavigation(
      tester,
      SubscriptionReturnKind.customerPortal,
    );
    await tester.pump();
    await tester.pump();

    expect(accountLoads, 2);
    expect(refreshTransitions, <bool>[true, false]);
    expect(await SubscriptionReturnService.pendingEventCount, 0);

    await tester.pump(const Duration(seconds: 4));
    expect(accountLoads, 2);
    expect(refreshTransitions, <bool>[true, false]);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'checkout success refreshes immediately and again after three seconds',
    (tester) async {
      final refreshTransitions = <bool>[];
      var accountLoads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) async {
          accountLoads += 1;
          return _approvedAccount();
        },
        onSubscriptionRefreshStateChanged: refreshTransitions.add,
      );
      expect(accountLoads, 1);

      await _dispatchAndClaimNavigation(
        tester,
        SubscriptionReturnKind.checkoutSuccess,
      );
      await tester.pump();
      await tester.pump();

      expect(accountLoads, 2);
      expect(refreshTransitions, <bool>[true, false]);
      expect(await SubscriptionReturnService.pendingEventCount, 0);

      await tester.pump(const Duration(milliseconds: 2999));
      expect(accountLoads, 2);
      expect(refreshTransitions, <bool>[true, false]);

      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();
      expect(accountLoads, 3);
      expect(refreshTransitions, <bool>[true, false, true, false]);

      await tester.pump(const Duration(seconds: 4));
      expect(accountLoads, 3);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('checkout cancel preserves its single-refresh behavior', (
    tester,
  ) async {
    final refreshTransitions = <bool>[];
    var accountLoads = 0;
    await _pumpApplicationScreen(
      tester,
      loadAccount: (uid) async {
        accountLoads += 1;
        return _approvedAccount();
      },
      onSubscriptionRefreshStateChanged: refreshTransitions.add,
    );
    expect(accountLoads, 1);

    await _dispatchAndClaimNavigation(
      tester,
      SubscriptionReturnKind.checkoutCancel,
    );
    await tester.pump();
    await tester.pump();

    expect(accountLoads, 2);
    expect(refreshTransitions, <bool>[true, false]);
    expect(await SubscriptionReturnService.pendingEventCount, 0);

    await tester.pump(const Duration(seconds: 4));
    expect(accountLoads, 2);
    expect(refreshTransitions, <bool>[true, false]);
    expect(tester.takeException(), isNull);
  });

  for (final checkoutCase
      in <({SubscriptionReturnKind kind, int expectedReturnLoads})>[
        (kind: SubscriptionReturnKind.checkoutSuccess, expectedReturnLoads: 2),
        (kind: SubscriptionReturnKind.checkoutCancel, expectedReturnLoads: 1),
      ]) {
    testWidgets(
      'signed-out pending ${checkoutCase.kind.name} refreshes after an eligible Hub mounts and does not replay',
      (tester) async {
        final refreshTransitions = <bool>[];
        var accountLoads = 0;
        final event = await _dispatchAndClaimNavigation(
          tester,
          checkoutCase.kind,
        );

        expect(
          (await SubscriptionReturnService.peekPendingRefreshFor(
            _defaultSubscriptionReturnOwnerScope,
          ))?.id,
          event.id,
        );
        await tester.pumpWidget(
          MaterialApp(
            home: RestaurantAuthScreen(authStateStream: Stream.value(null)),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Restaurant Sign In'), findsOneWidget);
        expect(find.byType(RestaurantCreateCouponScreen), findsNothing);
        expect(
          (await SubscriptionReturnService.peekPendingRefreshFor(
            _defaultSubscriptionReturnOwnerScope,
          ))?.id,
          event.id,
        );
        expect(
          await SubscriptionReturnService.claimNavigationFor(
            event.id,
            _defaultSubscriptionReturnOwnerScope,
          ),
          isFalse,
        );

        await _pumpApplicationScreen(
          tester,
          loadAccount: (uid) async {
            accountLoads += 1;
            return _approvedAccount();
          },
          onSubscriptionRefreshStateChanged: refreshTransitions.add,
          settle: false,
        );

        await _pumpUntil(tester, () => accountLoads == 2);
        expect(refreshTransitions, <bool>[true, false]);
        if (checkoutCase.kind == SubscriptionReturnKind.checkoutSuccess) {
          await tester.pump(const Duration(milliseconds: 2999));
          expect(accountLoads, 2);
          expect(refreshTransitions, <bool>[true, false]);
          await tester.pump(const Duration(milliseconds: 1));
          await tester.pump();
        } else {
          await tester.pump(const Duration(seconds: 4));
        }

        expect(accountLoads, 1 + checkoutCase.expectedReturnLoads);
        expect(
          refreshTransitions,
          checkoutCase.kind == SubscriptionReturnKind.checkoutSuccess
              ? <bool>[true, false, true, false]
              : <bool>[true, false],
        );
        expect(await SubscriptionReturnService.pendingEventCount, 0);

        await tester.pumpWidget(const MaterialApp(home: SizedBox()));
        await tester.pump();

        var remountLoads = 0;
        await _pumpApplicationScreen(
          tester,
          loadAccount: (uid) async {
            remountLoads += 1;
            return _approvedAccount();
          },
        );

        expect(remountLoads, 1);
        expect(await SubscriptionReturnService.pendingEventCount, 0);
        expect(
          await SubscriptionReturnService.claimNavigationFor(
            event.id,
            _defaultSubscriptionReturnOwnerScope,
          ),
          isFalse,
        );
        expect(
          await SubscriptionReturnService.claimRefreshFor(
            event.id,
            _defaultSubscriptionReturnOwnerScope,
          ),
          isFalse,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final checkoutCase
      in <({SubscriptionReturnKind kind, int loadsAfterFailure})>[
        (kind: SubscriptionReturnKind.checkoutSuccess, loadsAfterFailure: 3),
        (kind: SubscriptionReturnKind.checkoutCancel, loadsAfterFailure: 2),
      ]) {
    testWidgets(
      '${checkoutCase.kind.name} refresh failure is nonfatal and does not poison later returns',
      (tester) async {
        final refreshTransitions = <bool>[];
        var accountLoads = 0;
        await _pumpApplicationScreen(
          tester,
          loadAccount: (uid) async {
            accountLoads += 1;
            if (accountLoads == 2) {
              throw StateError(
                'raw Firebase and Stripe details must remain hidden',
              );
            }
            return _approvedAccount();
          },
          onSubscriptionRefreshStateChanged: refreshTransitions.add,
        );

        await _dispatchAndClaimNavigation(tester, checkoutCase.kind);
        await tester.pump();
        await tester.pump();
        if (checkoutCase.kind == SubscriptionReturnKind.checkoutSuccess) {
          await tester.pump(const Duration(seconds: 3));
          await tester.pump();
        } else {
          await tester.pump(const Duration(seconds: 4));
        }

        expect(accountLoads, checkoutCase.loadsAfterFailure);
        expect(await SubscriptionReturnService.pendingEventCount, 0);

        await _dispatchAndClaimNavigation(tester, checkoutCase.kind);
        await tester.pump();
        await tester.pump();
        if (checkoutCase.kind == SubscriptionReturnKind.checkoutSuccess) {
          await tester.pump(const Duration(milliseconds: 2999));
          expect(accountLoads, checkoutCase.loadsAfterFailure + 1);
          await tester.pump(const Duration(milliseconds: 1));
          await tester.pump();
        } else {
          await tester.pump(const Duration(seconds: 4));
        }

        final laterReturnLoads =
            checkoutCase.kind == SubscriptionReturnKind.checkoutSuccess ? 2 : 1;
        expect(accountLoads, checkoutCase.loadsAfterFailure + laterReturnLoads);
        expect(
          refreshTransitions,
          checkoutCase.kind == SubscriptionReturnKind.checkoutSuccess
              ? <bool>[true, false, true, false, true, false, true, false]
              : <bool>[true, false, true, false],
        );
        expect(await SubscriptionReturnService.pendingEventCount, 0);
        expect(
          find.textContaining('raw Firebase and Stripe details'),
          findsNothing,
        );

        await tester.pumpWidget(const MaterialApp(home: SizedBox()));
        await tester.pump();
        var remountLoads = 0;
        await _pumpApplicationScreen(
          tester,
          loadAccount: (uid) async {
            remountLoads += 1;
            return _approvedAccount();
          },
        );
        expect(remountLoads, 1);
        expect(await SubscriptionReturnService.pendingEventCount, 0);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'pre-mount portal return waits for initial load and does not replay on remount',
    (tester) async {
      final initialLoad = Completer<Map<String, dynamic>?>();
      final portalRefresh = Completer<Map<String, dynamic>?>();
      final refreshTransitions = <bool>[];
      var accountLoads = 0;
      final event = await _dispatchAndClaimNavigation(
        tester,
        SubscriptionReturnKind.customerPortal,
      );

      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) {
          accountLoads += 1;
          return switch (accountLoads) {
            1 => initialLoad.future,
            2 => portalRefresh.future,
            _ => Future<Map<String, dynamic>?>.value(_approvedAccount()),
          };
        },
        onSubscriptionRefreshStateChanged: refreshTransitions.add,
        settle: false,
      );
      await _pumpUntil(tester, () => accountLoads == 1);

      expect(
        (await SubscriptionReturnService.peekPendingRefreshFor(
          _defaultSubscriptionReturnOwnerScope,
        ))?.id,
        event.id,
      );
      await tester.pump();
      expect(accountLoads, 1);
      expect(refreshTransitions, isEmpty);

      initialLoad.complete(_approvedAccount(subscriptionStatus: 'inactive'));
      await _pumpUntil(tester, () => accountLoads == 2);

      expect(
        await SubscriptionReturnService.peekPendingRefreshFor(
          _defaultSubscriptionReturnOwnerScope,
        ),
        isNull,
      );
      expect(await SubscriptionReturnService.pendingEventCount, 0);
      expect(refreshTransitions, <bool>[true]);

      portalRefresh.complete(_approvedAccount());
      await tester.pumpAndSettle();
      expect(refreshTransitions, <bool>[true, false]);
      await _expandSection(tester, 'Subscription / Billing');
      expect(find.text('Subscription active'), findsOneWidget);
      expect(find.text('Not subscribed'), findsNothing);

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      await tester.pump();

      var remountLoads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) async {
          remountLoads += 1;
          return _approvedAccount();
        },
      );

      expect(remountLoads, 1);
      expect(
        await SubscriptionReturnService.peekPendingRefreshFor(
          _defaultSubscriptionReturnOwnerScope,
        ),
        isNull,
      );
      expect(await SubscriptionReturnService.pendingEventCount, 0);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('portal return arriving during initial load is serialized', (
    tester,
  ) async {
    final initialLoad = Completer<Map<String, dynamic>?>();
    final portalRefresh = Completer<Map<String, dynamic>?>();
    final refreshTransitions = <bool>[];
    var accountLoads = 0;

    await _pumpApplicationScreen(
      tester,
      loadAccount: (uid) {
        accountLoads += 1;
        return accountLoads == 1 ? initialLoad.future : portalRefresh.future;
      },
      onSubscriptionRefreshStateChanged: refreshTransitions.add,
      settle: false,
    );
    await _pumpUntil(tester, () => accountLoads == 1);

    final event = await _dispatchAndClaimNavigation(
      tester,
      SubscriptionReturnKind.customerPortal,
    );
    await tester.pump();

    expect(accountLoads, 1);
    expect(refreshTransitions, isEmpty);
    expect(
      (await SubscriptionReturnService.peekPendingRefreshFor(
        _defaultSubscriptionReturnOwnerScope,
      ))?.id,
      event.id,
    );

    initialLoad.complete(_approvedAccount(subscriptionStatus: 'inactive'));
    await _pumpUntil(tester, () => accountLoads == 2);

    expect(refreshTransitions, <bool>[true]);
    expect(
      await SubscriptionReturnService.peekPendingRefreshFor(
        _defaultSubscriptionReturnOwnerScope,
      ),
      isNull,
    );
    portalRefresh.complete(_approvedAccount());
    await tester.pumpAndSettle();

    expect(refreshTransitions, <bool>[true, false]);
    await _expandSection(tester, 'Subscription / Billing');
    expect(find.text('Subscription active'), findsOneWidget);
    expect(find.text('Not subscribed'), findsNothing);
    expect(await SubscriptionReturnService.pendingEventCount, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'disposing before the queued refresh claim leaves it for one remount',
    (tester) async {
      final initialLoad = Completer<Map<String, dynamic>?>();
      var disposedScreenLoads = 0;
      final event = await _dispatchAndClaimNavigation(
        tester,
        SubscriptionReturnKind.customerPortal,
      );

      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) {
          disposedScreenLoads += 1;
          return initialLoad.future;
        },
        settle: false,
      );
      await _pumpUntil(tester, () => disposedScreenLoads == 1);
      expect(
        (await SubscriptionReturnService.peekPendingRefreshFor(
          _defaultSubscriptionReturnOwnerScope,
        ))?.id,
        event.id,
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      await tester.pump();
      initialLoad.complete(_approvedAccount(subscriptionStatus: 'inactive'));
      await tester.pump();
      await tester.pump();

      expect(disposedScreenLoads, 1);
      expect(
        (await SubscriptionReturnService.peekPendingRefreshFor(
          _defaultSubscriptionReturnOwnerScope,
        ))?.id,
        event.id,
      );
      expect(await SubscriptionReturnService.pendingEventCount, 1);

      var remountLoads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) async {
          remountLoads += 1;
          return _approvedAccount();
        },
      );

      expect(remountLoads, 2);
      expect(
        await SubscriptionReturnService.peekPendingRefreshFor(
          _defaultSubscriptionReturnOwnerScope,
        ),
        isNull,
      );
      expect(await SubscriptionReturnService.pendingEventCount, 0);
      expect(tester.takeException(), isNull);
      expect(find.byType(SnackBar), findsNothing);
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets(
    'genuine repeated portal events queue, survive failure, and remain processable',
    (tester) async {
      final firstRefresh = Completer<Map<String, dynamic>?>();
      final secondRefresh = Completer<Map<String, dynamic>?>();
      final refreshTransitions = <bool>[];
      var accountLoads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) {
          accountLoads += 1;
          return switch (accountLoads) {
            1 => Future<Map<String, dynamic>?>.value(_approvedAccount()),
            2 => firstRefresh.future,
            3 => secondRefresh.future,
            _ => Future<Map<String, dynamic>?>.value(_approvedAccount()),
          };
        },
        onSubscriptionRefreshStateChanged: refreshTransitions.add,
      );

      final firstEvent = await _dispatchAndClaimNavigation(
        tester,
        SubscriptionReturnKind.customerPortal,
      );
      await _pumpUntil(tester, () => accountLoads == 2);
      expect(refreshTransitions, <bool>[true]);

      final secondEvent = await _dispatchAndClaimNavigation(
        tester,
        SubscriptionReturnKind.customerPortal,
      );
      await tester.pump();
      expect(secondEvent.id, isNot(firstEvent.id));
      expect(accountLoads, 2);

      firstRefresh.completeError(StateError('test refresh failure'));
      await _pumpUntil(tester, () => accountLoads == 3);
      expect(refreshTransitions, <bool>[true, false, true]);

      secondRefresh.complete(_approvedAccount());
      await tester.pumpAndSettle();
      expect(refreshTransitions, <bool>[true, false, true, false]);
      expect(await SubscriptionReturnService.pendingEventCount, 0);

      final laterEvent = await _dispatchAndClaimNavigation(
        tester,
        SubscriptionReturnKind.customerPortal,
      );
      await tester.pump();
      await tester.pump();

      expect(laterEvent.id, isNot(firstEvent.id));
      expect(laterEvent.id, isNot(secondEvent.id));
      expect(accountLoads, 4);
      expect(refreshTransitions, <bool>[true, false, true, false, true, false]);
      expect(await SubscriptionReturnService.pendingEventCount, 0);
      expect(tester.takeException(), isNull);
      expect(find.byType(SnackBar), findsNothing);
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets(
    'failed return claim retries exactly once on the next lifecycle resume',
    (tester) async {
      var accountLoads = 0;
      _subscriptionReturnBackend
        ..addPendingEvent(
          ownerScope: _defaultSubscriptionReturnOwnerScope,
          eventId: '1',
          kind: SubscriptionReturnKind.customerPortal,
          navigationClaimed: true,
        )
        ..remainingClaimFailures = 1;
      expect(
        await _awaitSubscriptionReturnOperation(
          tester,
          SubscriptionReturnService.peekPendingRefreshFor(
            _defaultSubscriptionReturnOwnerScope,
          ),
        ),
        isNotNull,
      );
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();

      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) async {
          accountLoads += 1;
          return _approvedAccount();
        },
      );
      await _pumpUntil(
        tester,
        () => _subscriptionReturnBackend.claimCalls == 1,
      );
      expect(accountLoads, 1);
      expect(_subscriptionReturnBackend.claimCalls, 1);
      expect(await SubscriptionReturnService.pendingEventCount, 1);

      await _triggerAppResume(tester);
      await _pumpUntil(
        tester,
        () => _subscriptionReturnBackend.claimCalls == 2 && accountLoads == 2,
      );

      expect(_subscriptionReturnBackend.claimCalls, 2);
      expect(accountLoads, 2);
      expect(await SubscriptionReturnService.pendingEventCount, 0);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'permanent return claim failure attempts once per lifecycle episode',
    (tester) async {
      var accountLoads = 0;
      _subscriptionReturnBackend
        ..addPendingEvent(
          ownerScope: _defaultSubscriptionReturnOwnerScope,
          eventId: '1',
          kind: SubscriptionReturnKind.customerPortal,
          navigationClaimed: true,
        )
        ..failClaim = true;
      expect(
        await _awaitSubscriptionReturnOperation(
          tester,
          SubscriptionReturnService.peekPendingRefreshFor(
            _defaultSubscriptionReturnOwnerScope,
          ),
        ),
        isNotNull,
      );

      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) async {
          accountLoads += 1;
          return _approvedAccount();
        },
      );
      await _pumpUntil(
        tester,
        () => _subscriptionReturnBackend.claimCalls == 1,
      );
      expect(_subscriptionReturnBackend.claimCalls, 1);

      await _triggerAppResume(tester);
      await _pumpUntil(
        tester,
        () => _subscriptionReturnBackend.claimCalls == 2,
      );
      for (var attempt = 0; attempt < 8; attempt += 1) {
        await tester.pump();
      }

      expect(_subscriptionReturnBackend.claimCalls, 2);
      expect(accountLoads, 1);
      expect(await SubscriptionReturnService.pendingEventCount, 1);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'return appearing between resume peeks consumes that resume episode',
    (tester) async {
      var accountLoads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) async {
          accountLoads += 1;
          return _approvedAccount();
        },
      );
      _subscriptionReturnBackend.afterNextListResponse = () {
        _subscriptionReturnBackend.addPendingEvent(
          ownerScope: _defaultSubscriptionReturnOwnerScope,
          eventId: '1',
          kind: SubscriptionReturnKind.customerPortal,
          navigationClaimed: true,
        );
      };

      await _triggerAppResume(tester);
      await _pumpUntil(
        tester,
        () => _subscriptionReturnBackend.claimCalls == 1 && accountLoads == 2,
      );
      expect(await SubscriptionReturnService.pendingEventCount, 0);

      await _triggerAppResume(tester);
      await _pumpUntil(tester, () => accountLoads == 3);

      expect(_subscriptionReturnBackend.claimCalls, 1);
      expect(accountLoads, 3);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'pre-mount return success does not suppress a later resume episode',
    (tester) async {
      var accountLoads = 0;
      _subscriptionReturnBackend.addPendingEvent(
        ownerScope: _defaultSubscriptionReturnOwnerScope,
        eventId: '1',
        kind: SubscriptionReturnKind.customerPortal,
        navigationClaimed: true,
      );
      expect(
        await _awaitSubscriptionReturnOperation(
          tester,
          SubscriptionReturnService.peekPendingRefreshFor(
            _defaultSubscriptionReturnOwnerScope,
          ),
        ),
        isNotNull,
      );
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();

      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) async {
          accountLoads += 1;
          return _approvedAccount();
        },
      );
      await _pumpUntil(
        tester,
        () => _subscriptionReturnBackend.claimCalls == 1 && accountLoads == 2,
      );
      expect(await SubscriptionReturnService.pendingEventCount, 0);

      await _triggerAppResume(tester);
      await _pumpUntil(tester, () => accountLoads == 3);

      expect(_subscriptionReturnBackend.claimCalls, 1);
      expect(accountLoads, 3);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'failed local return refresh does not suppress the next normal resume',
    (tester) async {
      var accountLoads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) async {
          accountLoads += 1;
          if (accountLoads == 2) {
            throw StateError('synthetic return refresh failure');
          }
          return _approvedAccount();
        },
      );
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pump();

      await _dispatchAndClaimNavigation(
        tester,
        SubscriptionReturnKind.customerPortal,
      );
      await _pumpUntil(tester, () => accountLoads == 2);
      expect(await SubscriptionReturnService.pendingEventCount, 0);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await _pumpUntil(tester, () => accountLoads == 3);

      expect(accountLoads, 3);
      expect(tester.takeException(), isNull);
      expect(
        find.textContaining('synthetic return refresh failure'),
        findsNothing,
      );
    },
  );

  testWidgets(
    'resume during portal refresh does not queue a duplicate account read',
    (tester) async {
      final portalRefresh = Completer<Map<String, dynamic>?>();
      final refreshTransitions = <bool>[];
      var accountLoads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) {
          accountLoads += 1;
          return switch (accountLoads) {
            1 => Future<Map<String, dynamic>?>.value(_approvedAccount()),
            2 => portalRefresh.future,
            _ => Future<Map<String, dynamic>?>.value(_approvedAccount()),
          };
        },
        onSubscriptionRefreshStateChanged: refreshTransitions.add,
      );

      await _dispatchAndClaimNavigation(
        tester,
        SubscriptionReturnKind.customerPortal,
      );
      await _pumpUntil(tester, () => accountLoads == 2);
      expect(refreshTransitions, <bool>[true]);

      await _triggerAppResume(tester);
      await _triggerAppResume(tester);
      expect(accountLoads, 2);

      portalRefresh.complete(_approvedAccount());
      await tester.pumpAndSettle();

      expect(accountLoads, 2);
      expect(refreshTransitions, <bool>[true, false]);
      await _expandSection(tester, 'Subscription / Billing');
      expect(find.text('Subscription active'), findsOneWidget);
      expect(find.text('Not subscribed'), findsNothing);
      expect(await SubscriptionReturnService.pendingEventCount, 0);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'portal return coalesces with an in-flight lifecycle resume refresh',
    (tester) async {
      final lifecycleRefresh = Completer<Map<String, dynamic>?>();
      final refreshTransitions = <bool>[];
      var accountLoads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) {
          accountLoads += 1;
          return accountLoads == 1
              ? Future<Map<String, dynamic>?>.value(_approvedAccount())
              : lifecycleRefresh.future;
        },
        onSubscriptionRefreshStateChanged: refreshTransitions.add,
      );

      await _triggerAppResume(tester);
      expect(accountLoads, 2);
      expect(refreshTransitions, <bool>[true]);

      await _dispatchAndClaimNavigation(
        tester,
        SubscriptionReturnKind.customerPortal,
      );
      await tester.pump();
      expect(accountLoads, 2);

      lifecycleRefresh.complete(_approvedAccount());
      await tester.pumpAndSettle();

      expect(accountLoads, 2);
      expect(refreshTransitions, <bool>[true, false]);
      expect(await SubscriptionReturnService.pendingEventCount, 0);
      await tester.pump(const Duration(seconds: 4));
      expect(accountLoads, 2);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'portal return consumes a completed refresh from the same resume episode',
    (tester) async {
      final refreshTransitions = <bool>[];
      var accountLoads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) async {
          accountLoads += 1;
          return _approvedAccount();
        },
        onSubscriptionRefreshStateChanged: refreshTransitions.add,
      );

      await _triggerAppResume(tester);
      await _pumpUntil(tester, () => refreshTransitions.length == 2);
      expect(accountLoads, 2);
      expect(refreshTransitions, <bool>[true, false]);

      await _dispatchAndClaimNavigation(
        tester,
        SubscriptionReturnKind.customerPortal,
      );
      await tester.pump();
      await tester.pump();

      expect(accountLoads, 2);
      expect(refreshTransitions, <bool>[true, false]);
      expect(await SubscriptionReturnService.pendingEventCount, 0);
      await tester.pump(const Duration(seconds: 4));
      expect(accountLoads, 2);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'completed portal refresh suppresses the following resume fallback',
    (tester) async {
      final refreshTransitions = <bool>[];
      var accountLoads = 0;
      await _pumpApplicationScreen(
        tester,
        loadAccount: (uid) async {
          accountLoads += 1;
          return _approvedAccount();
        },
        onSubscriptionRefreshStateChanged: refreshTransitions.add,
      );

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pump();
      await _dispatchAndClaimNavigation(
        tester,
        SubscriptionReturnKind.customerPortal,
      );
      await tester.pump();
      await tester.pump();

      expect(accountLoads, 2);
      expect(refreshTransitions, <bool>[true, false]);
      expect(await SubscriptionReturnService.pendingEventCount, 0);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      await tester.pump();

      expect(accountLoads, 2);
      expect(refreshTransitions, <bool>[true, false]);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('two mounted Hubs globally claim one portal refresh', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1400);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);

    final refreshTransitions = <bool>[];
    var firstHubLoads = 0;
    var secondHubLoads = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: IndexedStack(
          index: 0,
          children: [
            _applicationScreen(
              loadAccount: (uid) async {
                firstHubLoads += 1;
                return _approvedAccount();
              },
              onSubscriptionRefreshStateChanged: refreshTransitions.add,
            ),
            _applicationScreen(
              loadAccount: (uid) async {
                secondHubLoads += 1;
                return _approvedAccount();
              },
              onSubscriptionRefreshStateChanged: refreshTransitions.add,
            ),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(firstHubLoads, 1);
    expect(secondHubLoads, 1);

    await _dispatchAndClaimNavigation(
      tester,
      SubscriptionReturnKind.customerPortal,
    );
    await tester.pump();
    await tester.pump();

    expect(firstHubLoads + secondHubLoads, 3);
    expect(<int>{firstHubLoads, secondHubLoads}, <int>{1, 2});
    expect(refreshTransitions, <bool>[true, false]);
    expect(await SubscriptionReturnService.pendingEventCount, 0);
    expect(tester.takeException(), isNull);
  });

  for (final checkoutCase
      in <({SubscriptionReturnKind kind, int expectedExtraLoads})>[
        (kind: SubscriptionReturnKind.checkoutSuccess, expectedExtraLoads: 2),
        (kind: SubscriptionReturnKind.checkoutCancel, expectedExtraLoads: 1),
      ]) {
    testWidgets(
      'two mounted Hubs globally claim one ${checkoutCase.kind.name} refresh sequence',
      (tester) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = const Size(900, 1400);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.view.resetPhysicalSize);

        final refreshTransitions = <bool>[];
        var firstHubLoads = 0;
        var secondHubLoads = 0;
        await tester.pumpWidget(
          MaterialApp(
            home: IndexedStack(
              index: 0,
              children: [
                _applicationScreen(
                  loadAccount: (uid) async {
                    firstHubLoads += 1;
                    return _approvedAccount();
                  },
                  onSubscriptionRefreshStateChanged: refreshTransitions.add,
                ),
                _applicationScreen(
                  loadAccount: (uid) async {
                    secondHubLoads += 1;
                    return _approvedAccount();
                  },
                  onSubscriptionRefreshStateChanged: refreshTransitions.add,
                ),
              ],
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(firstHubLoads + secondHubLoads, 2);

        await _dispatchAndClaimNavigation(tester, checkoutCase.kind);
        await tester.pump();
        await tester.pump();

        expect(firstHubLoads + secondHubLoads, 3);
        expect(<int>{firstHubLoads, secondHubLoads}, <int>{1, 2});

        if (checkoutCase.kind == SubscriptionReturnKind.checkoutSuccess) {
          await tester.pump(const Duration(milliseconds: 2999));
          expect(firstHubLoads + secondHubLoads, 3);
          await tester.pump(const Duration(milliseconds: 1));
          await tester.pump();
        } else {
          await tester.pump(const Duration(seconds: 4));
        }

        expect(
          firstHubLoads + secondHubLoads,
          2 + checkoutCase.expectedExtraLoads,
        );
        expect(
          <int>{firstHubLoads, secondHubLoads},
          checkoutCase.kind == SubscriptionReturnKind.checkoutSuccess
              ? <int>{1, 3}
              : <int>{1, 2},
        );
        expect(
          refreshTransitions,
          checkoutCase.kind == SubscriptionReturnKind.checkoutSuccess
              ? <bool>[true, false, true, false]
              : <bool>[true, false],
        );
        expect(await SubscriptionReturnService.pendingEventCount, 0);
        await tester.pump(const Duration(seconds: 4));
        expect(
          firstHubLoads + secondHubLoads,
          2 + checkoutCase.expectedExtraLoads,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'two mounted Hubs coalesce one lifecycle resume with a portal return',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1400);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);

      final lifecycleRefresh = Completer<Map<String, dynamic>?>();
      final refreshTransitions = <bool>[];
      var firstHubLoads = 0;
      var secondHubLoads = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: IndexedStack(
            index: 0,
            children: [
              _applicationScreen(
                loadAccount: (uid) {
                  firstHubLoads += 1;
                  return firstHubLoads == 1
                      ? Future<Map<String, dynamic>?>.value(_approvedAccount())
                      : lifecycleRefresh.future;
                },
                onSubscriptionRefreshStateChanged: refreshTransitions.add,
              ),
              _applicationScreen(
                loadAccount: (uid) {
                  secondHubLoads += 1;
                  return secondHubLoads == 1
                      ? Future<Map<String, dynamic>?>.value(_approvedAccount())
                      : lifecycleRefresh.future;
                },
                onSubscriptionRefreshStateChanged: refreshTransitions.add,
              ),
            ],
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(firstHubLoads + secondHubLoads, 2);

      await _triggerAppResume(tester);
      expect(firstHubLoads + secondHubLoads, 3);
      expect(<int>{firstHubLoads, secondHubLoads}, <int>{1, 2});
      expect(refreshTransitions, <bool>[true]);

      await _dispatchAndClaimNavigation(
        tester,
        SubscriptionReturnKind.customerPortal,
      );
      await tester.pump();
      expect(firstHubLoads + secondHubLoads, 3);

      lifecycleRefresh.complete(_approvedAccount());
      await tester.pumpAndSettle();

      expect(firstHubLoads + secondHubLoads, 3);
      expect(refreshTransitions, <bool>[true, false]);
      expect(await SubscriptionReturnService.pendingEventCount, 0);
      await tester.pump(const Duration(seconds: 4));
      expect(firstHubLoads + secondHubLoads, 3);
      expect(tester.takeException(), isNull);
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

  for (final hasOwnerBAccount in <bool>[false, true]) {
    testWidgets(
      'fresh State clears A legacy cache before loading '
      '${hasOwnerBAccount ? 'existing-account' : 'no-account'} owner B',
      (tester) => _verifyFreshStateNeverSeedsOwnerACache(
        tester,
        hasOwnerBAccount: hasOwnerBAccount,
      ),
    );
  }

  testWidgets('current application rejects a mismatched canonical document', (
    tester,
  ) async {
    var accountLoads = 0;
    var requestSequence = 0;
    final lifecyclePayloads = <Map<String, dynamic>>[];
    await _pumpApplicationScreen(
      tester,
      lifecycleService: BiteSaverRestaurantLifecycleService(
        requestIdGenerator: () => 'document-mismatch-${++requestSequence}',
        invokeCallable: (name, payload) async {
          lifecyclePayloads.add(Map<String, dynamic>.from(payload));
          return <String, dynamic>{
            'documentId': 'wrong-document-canary',
            'approvalStatus': 'pending',
            'profileVersion': 99,
            'locationVersion': 88,
          };
        },
      ),
      loadAccount: (uid) async {
        accountLoads += 1;
        return null;
      },
      accountDocumentIdForUid: (uid) => 'expected-document',
    );
    await _enterRequiredApplicationFields(
      tester,
      restaurantName: 'Expected Document Restaurant',
    );
    await _tapFilledButton(tester, 'Apply for a restaurant account');

    expect(accountLoads, 1);
    expect(
      find.text('Your restaurant account changed. Reload and try again.'),
      findsOneWidget,
    );
    expect(
      find.text('Coupon-side application submitted for admin review.'),
      findsNothing,
    );
    await _tapFilledButton(tester, 'Apply for a restaurant account');

    expect(lifecyclePayloads, hasLength(2));
    expect(
      lifecyclePayloads[1]['requestId'],
      lifecyclePayloads[0]['requestId'],
    );
    expect(requestSequence, 1);
    expect(accountLoads, 1);
  });

  testWidgets(
    'same-UID document switch rejects stale rendered coupon and daily edits',
    _verifyStaleRenderedEditCallbacksAreOwnerScoped,
  );

  testWidgets(
    'owner transition dismisses an open owner-scoped paywall route',
    _verifyOwnerTransitionDismissesPaywallRoute,
  );

  testWidgets(
    'same-UID widget update clears document A before document B first frame',
    _verifySynchronousWidgetOwnerTransition,
  );

  testWidgets(
    'stale rendered sign-out callback cannot sign out the current owner',
    _verifyStaleRenderedSignOutIsOwnerScoped,
  );

  for (final saveCase in <({bool sameUid, bool ownerAFails})>[
    (sameUid: false, ownerAFails: false),
    (sameUid: true, ownerAFails: true),
  ]) {
    testWidgets(
      'B coupon save starts before A completes '
      '(${saveCase.sameUid ? 'same UID/document switch' : 'UID switch'}, '
      'A ${saveCase.ownerAFails ? 'failure' : 'success'})',
      (tester) => _verifyPendingCouponSaveIsOwnerScoped(
        tester,
        sameUidDocumentSwitch: saveCase.sameUid,
        ownerAFails: saveCase.ownerAFails,
      ),
    );
  }

  testWidgets(
    'same-UID document B delete remains pending after A coupon delete completes',
    _verifyPendingCouponDeleteIsOwnerScoped,
  );

  for (final pickerBoundary in <String>['date', 'time']) {
    testWidgets(
      'same-UID document switch ignores pending A coupon $pickerBoundary picker',
      (tester) => _verifyPendingCouponPickerIsOwnerScoped(
        tester,
        pendingBoundary: pickerBoundary,
      ),
    );
  }

  for (final sameUidDocumentSwitch in <bool>[false, true]) {
    testWidgets(
      '${sameUidDocumentSwitch ? 'same-UID document' : 'UID'} switch lets B '
      'start coupon image while A remains pending',
      (tester) => _verifyPendingCouponImageIsOwnerScoped(
        tester,
        sameUidDocumentSwitch: sameUidDocumentSwitch,
      ),
    );
  }

  testWidgets(
    'B coupon image completes and saves before late A upload success',
    (tester) => _verifyCouponImageOwnerTransitionOrdering(
      tester,
      sameUidDocumentSwitch: false,
      staleOwnerAFails: false,
    ),
  );

  testWidgets(
    'stale A image failure is silent while same-UID document B stays busy',
    (tester) => _verifyCouponImageOwnerTransitionOrdering(
      tester,
      sameUidDocumentSwitch: true,
      staleOwnerAFails: true,
    ),
  );

  testWidgets(
    'UID switch before A coupon picker returns starts no stale image work',
    (tester) => _verifyCouponImageTransitionAtServiceBoundary(
      tester,
      pendingBoundary: 'picker',
    ),
  );

  testWidgets(
    'UID switch during A coupon URL retrieval discards the stale URL',
    (tester) => _verifyCouponImageTransitionAtServiceBoundary(
      tester,
      pendingBoundary: 'url',
    ),
  );

  testWidgets(
    'sign-out before A coupon picker returns isolates later owner B',
    (tester) => _verifyCouponImageTransitionAtServiceBoundary(
      tester,
      pendingBoundary: 'picker',
      signOutBeforeOwnerB: true,
    ),
  );

  testWidgets(
    'newer same-owner coupon selection supersedes the pending old draft',
    _verifyNewerSameOwnerCouponImageSelection,
  );

  testWidgets(
    'current coupon image cancellation is silent and suppresses duplicates',
    _verifyCurrentCouponImageCancellation,
  );

  testWidgets(
    'current coupon image failure clears busy and permits a successful retry',
    _verifyCurrentCouponImageFailureAndRetry,
  );

  testWidgets(
    'current coupon image failure preserves friendly mapping and retry',
    _verifyCurrentCouponImageFriendlyFailureAndRetry,
  );

  testWidgets(
    'same-UID document switch synchronously clears coupon and daily drafts',
    _verifyCouponAndDailyDraftTransitionReset,
  );

  testWidgets(
    'same-UID document switch ignores pending A daily-special time picker',
    _verifyPendingDailySpecialPickerIsOwnerScoped,
  );

  testWidgets(
    'same-UID document B daily save survives pending A failure',
    _verifyPendingDailySpecialSaveIsOwnerScoped,
  );

  testWidgets(
    'same-UID document B delete survives pending A daily-special deletion',
    _verifyPendingDailySpecialDeleteIsOwnerScoped,
  );

  testWidgets(
    'owner B can checkout while owner A preparation remains pending',
    _verifyPendingCheckoutPreparationIsOwnerScoped,
  );

  testWidgets(
    'owner B can open Portal while owner A preparation remains pending',
    (tester) => _verifyPendingCheckoutPreparationIsOwnerScoped(
      tester,
      useCustomerPortal: true,
    ),
  );

  testWidgets(
    'same-UID document change after preparation blocks A launch and preserves B',
    _verifyCheckoutScopeChangeBeforeLaunch,
  );

  testWidgets(
    'same-UID document change after Portal preparation blocks A launch',
    (tester) =>
        _verifyCheckoutScopeChangeBeforeLaunch(tester, useCustomerPortal: true),
  );

  testWidgets(
    'failed Checkout launch preserves the server return context for redemption',
    _verifyFailedLaunchPreservesServerReturnContext,
  );

  testWidgets(
    'failed Portal launch preserves the server return context for redemption',
    (tester) => _verifyFailedLaunchPreservesServerReturnContext(
      tester,
      useCustomerPortal: true,
    ),
  );

  testWidgets(
    'successful Portal launch uses its validated server-prepared session',
    _verifySuccessfulPortalLaunchUsesPreparedSession,
  );

  testWidgets(
    'Start Subscription launches an exact fragment-bearing Checkout URL',
    _verifyFragmentBearingCheckoutLaunchUsesExactUrl,
  );

  testWidgets(
    'return during pending Checkout launch redeems once and replay stays inert',
    _verifyReturnDuringPendingCheckoutLaunchIsSingleUse,
  );

  testWidgets(
    'return consumed during pending Checkout survives the same launcher failing',
    _verifyReturnDuringPendingCheckoutLaunchThenFalseIsAuthoritative,
  );

  testWidgets(
    'Paywall pending preparation is invalidated by same-UID document change',
    _verifyPaywallPendingPreparationIsOwnerScoped,
  );

  testWidgets(
    'same-UID document B checkout remains busy after A checkout completes',
    _verifyPendingCheckoutIsOwnerScoped,
  );

  testWidgets(
    'same-UID document B portal remains busy after A portal fails',
    _verifyPendingPortalIsOwnerScoped,
  );

  testWidgets(
    'late A subscription refresh cannot replace B subscription state',
    _verifyPendingSubscriptionRefreshIsOwnerScoped,
  );

  testWidgets(
    'pending A sign-out completion cannot navigate or sign out owner B',
    _verifyPendingSignOutIsOwnerScoped,
  );
}

Future<void> _triggerAppResume(WidgetTester tester) async {
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  for (var attempt = 0; attempt < 3; attempt += 1) {
    await tester.pump();
    await tester.runAsync<void>(
      () => Future<void>.delayed(const Duration(milliseconds: 1)),
    );
  }
}

Future<SubscriptionReturnEvent> _dispatchAndClaimNavigation(
  WidgetTester tester,
  SubscriptionReturnKind kind,
) async {
  final returnToken = _testReturnToken(++_subscriptionReturnDeliverySequence);
  _subscriptionReturnBackend.reserve(
    returnToken: returnToken,
    ownerScope: _defaultSubscriptionReturnOwnerScope,
    family: kind.family,
  );
  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.ingestReturnLink(
        subscriptionReturnUri(kind: kind, returnToken: returnToken),
      ),
    ),
    isTrue,
  );
  final event = await _awaitSubscriptionReturnOperation(
    tester,
    SubscriptionReturnService.peekPendingNavigationFor(
      _defaultSubscriptionReturnOwnerScope,
    ),
  );
  expect(event, isNotNull);
  final acceptedEvent = event!;
  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.claimNavigationFor(
        acceptedEvent.id,
        _defaultSubscriptionReturnOwnerScope,
      ),
    ),
    isTrue,
  );
  return acceptedEvent;
}

Future<T> _awaitSubscriptionReturnOperation<T>(
  WidgetTester tester,
  Future<T> operation,
) async {
  Object? value;
  Object? error;
  StackTrace? errorStack;
  var completed = false;
  operation.then<void>(
    (result) {
      value = result;
      completed = true;
    },
    onError: (Object caughtError, StackTrace caughtStack) {
      error = caughtError;
      errorStack = caughtStack;
      completed = true;
    },
  );
  for (var attempt = 0; attempt < 100 && !completed; attempt += 1) {
    await tester.runAsync<void>(
      () => Future<void>.delayed(const Duration(milliseconds: 1)),
    );
    await tester.pump();
  }
  if (!completed) {
    throw TestFailure('subscription-return operation timed out');
  }
  if (error != null) {
    Error.throwWithStackTrace(error!, errorStack!);
  }
  return value as T;
}

Future<void> _pumpUntil(
  WidgetTester tester,
  bool Function() condition, {
  int maxPumps = 20,
}) async {
  for (var pump = 0; pump < maxPumps && !condition(); pump += 1) {
    await tester.pump();
  }
  expect(condition(), isTrue);
}

Future<void> _pumpUntilWithRealAsync(
  WidgetTester tester,
  bool Function() condition, {
  int maxPumps = 100,
}) async {
  for (var pump = 0; pump < maxPumps && !condition(); pump += 1) {
    await tester.runAsync<void>(
      () => Future<void>.delayed(const Duration(milliseconds: 1)),
    );
    await tester.pump();
  }
  expect(condition(), isTrue);
}

Future<void> _verifyFreshStateNeverSeedsOwnerACache(
  WidgetTester tester, {
  required bool hasOwnerBAccount,
}) async {
  const ownerAName = 'FRESH-A-NAME-CANARY';
  const ownerAStreet = '901 FRESH-A-STREET-CANARY';
  const ownerAImage = 'https://images.example/fresh-a-image-canary.jpg';
  final ownerB = _TestUser(
    uid: 'fresh-state-owner-b',
    email: 'fresh-b@example.test',
  );
  final pendingAccount = Completer<Map<String, dynamic>?>();
  final lifecyclePayloads = <Map<String, dynamic>>[];
  LocalRestaurantProfileStore.updateProfile(
    RestaurantProfileData(
      name: ownerAName,
      city: 'FRESH-A-CITY-CANARY',
      state: 'AA',
      zipCode: '99991',
      distance: 'A-DISTANCE-CANARY',
      email: 'fresh-a@example.test',
      phone: '(999) 555-0191',
      streetAddress: ownerAStreet,
      website: 'https://fresh-a-canary.example',
      bio: 'FRESH-A-BIO-CANARY',
      mainImageUrl: ownerAImage,
      latitude: '11.11',
      longitude: '-22.22',
      businessHours: _businessHoursForSunday(
        opensAt: '1:15 AM',
        closesAt: '2:45 AM',
      ),
    ),
  );

  await _pumpApplicationScreen(
    tester,
    lifecycleService: BiteSaverRestaurantLifecycleService(
      invokeCallable: (name, payload) async {
        lifecyclePayloads.add(Map<String, dynamic>.from(payload));
        return <String, dynamic>{
          'documentId': ownerB.uid,
          'approvalStatus': 'pending',
          'profileVersion': 1,
          'locationVersion': 1,
        };
      },
    ),
    loadAccount: (uid) => pendingAccount.future,
    testCurrentUser: ownerB,
    settle: false,
    pumpAfterWidgetWhenUnsettled: false,
  );

  final clearedBeforeLoad = LocalRestaurantProfileStore.profile.value;
  expect(clearedBeforeLoad.name, isEmpty);
  expect(clearedBeforeLoad.streetAddress, isEmpty);
  expect(clearedBeforeLoad.mainImageUrl, isEmpty);
  expect(clearedBeforeLoad.businessHours, isEmpty);
  expect(find.textContaining(ownerAName), findsNothing);
  expect(find.textContaining(ownerAStreet), findsNothing);
  expect(find.textContaining(ownerAImage), findsNothing);

  pendingAccount.complete(
    hasOwnerBAccount
        ? _approvedAccount(
            uid: ownerB.uid,
            email: ownerB.email!,
            restaurantName: 'Fresh Owner B Restaurant',
            streetAddress: '902 Fresh B Street',
            city: 'Fresh B City',
            state: 'FL',
            zipCode: '34492',
            phone: '(352) 555-0192',
            website: 'https://fresh-b.example',
            bio: 'Fresh B bio',
            mainImageUrl: 'https://images.example/fresh-b.jpg',
            businessHours: _businessHoursForSunday(
              opensAt: '9:15 AM',
              closesAt: '8:45 PM',
            ),
            profileVersion: 12,
            locationVersion: 7,
          )
        : null,
  );
  await tester.pumpAndSettle();

  for (final canary in <String>[
    ownerAName,
    ownerAStreet,
    ownerAImage,
    'FRESH-A-CITY-CANARY',
    'FRESH-A-BIO-CANARY',
    'fresh-a@example.test',
    'A-DISTANCE-CANARY',
    '1:15 AM',
    '2:45 AM',
  ]) {
    expect(find.textContaining(canary), findsNothing, reason: canary);
  }
  if (hasOwnerBAccount) {
    await _ensureSectionExpanded(tester, 'Basic Restaurant Information');
    expect(find.text('Fresh Owner B Restaurant'), findsOneWidget);
    expect(_fieldText(tester, 'Street Address'), '902 Fresh B Street');
    await _ensureSectionExpanded(
      tester,
      'Subscription / Billing',
      visibleWhenExpanded: find.text('Subscription active'),
    );
    expect(find.text('Subscription active'), findsOneWidget);
    expect(
      LocalRestaurantProfileStore.profile.value.name,
      'Fresh Owner B Restaurant',
    );
    expect(
      LocalRestaurantProfileStore.profile.value.mainImageUrl,
      'https://images.example/fresh-b.jpg',
    );

    await _ensureSectionExpanded(tester, 'Hours');
    expect(find.textContaining('9:15 AM'), findsWidgets);
    expect(find.textContaining('8:45 PM'), findsWidgets);
    await _ensureSectionExpanded(tester, 'Restaurant Image');
    expect(
      tester
          .widget<BiteSaverRestaurantImage>(
            find.byKey(const ValueKey('restaurant-image-owner-preview')),
          )
          .imageUrl,
      'https://images.example/fresh-b.jpg',
    );
    await _ensureSectionExpanded(tester, 'Customer Preview');
    expect(find.text('Fresh B bio'), findsWidgets);
    expect(
      tester
          .widget<BiteSaverRestaurantImage>(
            find.byKey(const ValueKey('restaurant-image-customer-preview')),
          )
          .imageUrl,
      'https://images.example/fresh-b.jpg',
    );

    await _tapElevatedButton(tester, 'Save Basic Information');
    expect(lifecyclePayloads, hasLength(1));
    expect(lifecyclePayloads.single['expectedProfileVersion'], 12);
    expect(lifecyclePayloads.single['updateSection'], 'basicInformation');
    expect(jsonEncode(lifecyclePayloads.single), isNot(contains(ownerAName)));
  } else {
    expect(find.text('Apply for Coupon-Side Approval'), findsOneWidget);
    expect(_fieldText(tester, 'Restaurant Name'), isEmpty);
    expect(_fieldText(tester, 'Street Address'), isEmpty);
    expect(LocalRestaurantProfileStore.profile.value.name, isEmpty);
    expect(
      find.byKey(const ValueKey('restaurant-image-owner-preview')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('restaurant-image-customer-preview')),
      findsNothing,
    );
    expect(find.text('Customer Preview'), findsNothing);
    expect(find.text('Hours'), findsNothing);
    await _enterRequiredApplicationFields(
      tester,
      restaurantName: 'Fresh Owner B Application',
    );
    await _tapFilledButton(tester, 'Apply for a restaurant account');
    expect(lifecyclePayloads, hasLength(1));
    final encodedPayload = jsonEncode(lifecyclePayloads.single);
    expect(encodedPayload, contains('Fresh Owner B Application'));
    for (final canary in <String>[
      ownerAName,
      ownerAStreet,
      ownerAImage,
      'FRESH-A-CITY-CANARY',
      'FRESH-A-BIO-CANARY',
      'fresh-a@example.test',
      'A-DISTANCE-CANARY',
    ]) {
      expect(encodedPayload, isNot(contains(canary)), reason: canary);
    }
  }
}

Future<void> _verifyStaleRenderedEditCallbacksAreOwnerScoped(
  WidgetTester tester,
) async {
  final owner = _TestUser(
    uid: 'shared-stale-edit-owner',
    email: 'stale-edit@example.test',
  );
  const documentA = 'stale-edit-document-a';
  const documentB = 'stale-edit-document-b';
  var currentDocumentId = documentA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(
      uid: uid,
      restaurantName: currentDocumentId == documentA
          ? 'A Stale Edit Restaurant'
          : 'B Current Edit Restaurant',
    ),
    loadCoupons: (uid) async => <Coupon>[
      _ownerCoupon(
        title: currentDocumentId == documentA
            ? 'A-STALE-EDIT-COUPON-CANARY'
            : 'B Current Coupon',
      ),
    ],
    loadDailySpecials: (uid) async => <DailySpecial>[
      _ownerDailySpecial(
        uid: uid,
        title: currentDocumentId == documentA
            ? 'A-STALE-EDIT-SPECIAL-CANARY'
            : 'B Current Special',
      ),
    ],
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => currentDocumentId,
  );

  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('A-STALE-EDIT-COUPON-CANARY'),
  );
  final staleCouponEdit = tester
      .widget<TextButton>(
        find.descendant(
          of: _cardContaining('A-STALE-EDIT-COUPON-CANARY'),
          matching: find.widgetWithText(TextButton, 'Edit'),
        ),
      )
      .onPressed!;

  await _ensureSectionExpanded(
    tester,
    'Daily Specials',
    visibleWhenExpanded: find.text('A-STALE-EDIT-SPECIAL-CANARY'),
  );
  final staleDailyEdit = tester
      .widget<TextButton>(
        find.descendant(
          of: _cardContaining('A-STALE-EDIT-SPECIAL-CANARY'),
          matching: find.widgetWithText(TextButton, 'Edit'),
        ),
      )
      .onPressed!;

  currentDocumentId = documentB;
  userChanges.add(owner);
  await tester.pumpAndSettle();

  staleCouponEdit();
  staleDailyEdit();
  await tester.pump();

  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('B Current Coupon'),
  );
  await _ensureSectionExpanded(
    tester,
    'Daily Specials',
    visibleWhenExpanded: find.text('B Current Special'),
  );
  expect(_fieldText(tester, 'Coupon Title'), isEmpty);
  expect(_fieldText(tester, 'Title'), isEmpty);
  expect(find.textContaining('A-STALE-EDIT'), findsNothing);
  expect(
    LocalCouponStore.createdCoupons.value.single.title,
    'B Current Coupon',
  );
}

Future<void> _verifyOwnerTransitionDismissesPaywallRoute(
  WidgetTester tester,
) async {
  final ownerA = _TestUser(
    uid: 'paywall-route-owner-a',
    email: 'paywall-a@example.test',
  );
  final ownerB = _TestUser(
    uid: 'paywall-route-owner-b',
    email: 'paywall-b@example.test',
  );
  User? currentUser = ownerA;
  var ownerAHasAccess = true;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(
      uid: uid,
      email: uid == ownerA.uid ? ownerA.email! : ownerB.email!,
      restaurantName: uid == ownerA.uid
          ? 'A Paywall Route Restaurant'
          : 'B Current Route Restaurant',
      subscriptionStatus: uid == ownerA.uid && !ownerAHasAccess
          ? 'inactive'
          : 'active',
    ),
    testCurrentUser: ownerA,
    currentUserProvider: () => currentUser,
    ownerUserChanges: userChanges.stream,
  );

  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: _fieldWithLabel('Coupon Title'),
  );
  final createCoupon = tester
      .widget<ElevatedButton>(
        find.widgetWithText(ElevatedButton, 'Create Coupon'),
      )
      .onPressed!;
  ownerAHasAccess = false;
  createCoupon();
  await tester.pumpAndSettle();
  expect(
    find.text('Upgrade to Post Coupons and Daily Specials'),
    findsOneWidget,
  );

  currentUser = ownerB;
  userChanges.add(ownerB);
  await tester.pumpAndSettle();

  expect(find.text('Upgrade to Post Coupons and Daily Specials'), findsNothing);
  expect(find.text('Restaurant: Create Coupon'), findsOneWidget);
  await _ensureSectionExpanded(tester, 'Basic Restaurant Information');
  expect(find.text('B Current Route Restaurant'), findsOneWidget);
  expect(find.textContaining('A Paywall Route Restaurant'), findsNothing);
}

Future<void> _verifySynchronousWidgetOwnerTransition(
  WidgetTester tester,
) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(900, 1400);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);

  final owner = _TestUser(
    uid: 'shared-widget-update-owner',
    email: 'widget-update@example.test',
  );
  const documentA = 'widget-update-document-a';
  const documentB = 'widget-update-document-b';
  var currentDocumentId = documentA;
  final ownerBAccount = Completer<Map<String, dynamic>?>();
  final lifecycleService = BiteSaverRestaurantLifecycleService(
    invokeCallable: (name, payload) async {
      throw StateError('No lifecycle save was expected.');
    },
  );

  Future<Map<String, dynamic>?> loadAccount(String uid) {
    if (currentDocumentId == documentA) {
      return Future<Map<String, dynamic>?>.value(
        _approvedAccount(
          uid: uid,
          restaurantName: 'A-WIDGET-FIRST-FRAME-CANARY',
          streetAddress: '801 A Widget Street',
        ),
      );
    }
    return ownerBAccount.future;
  }

  String resolveDocument(String uid) => currentDocumentId;
  User? currentUser() => owner;

  Widget harness() {
    return MaterialApp(
      home: RestaurantCreateCouponScreen(
        key: const ValueKey('synchronous-widget-owner-hub'),
        lifecycleService: lifecycleService,
        loadAccount: loadAccount,
        loadCoupons: (uid) async => const <Coupon>[],
        loadDailySpecials: (uid) async => const <DailySpecial>[],
        loadMenuRoutingState: () async => const BiteSaverMenuRoutingState(
          usesBiteRater: false,
          matchedBiteScoreRestaurant: null,
          isAlreadyUsedByOtherSide: false,
        ),
        testCurrentUser: owner,
        currentUserProvider: currentUser,
        accountDocumentIdForUid: resolveDocument,
      ),
    );
  }

  await tester.pumpWidget(harness());
  await tester.pumpAndSettle();
  await _ensureSectionExpanded(tester, 'Basic Restaurant Information');
  expect(find.text('A-WIDGET-FIRST-FRAME-CANARY'), findsOneWidget);

  currentDocumentId = documentB;
  await tester.pumpWidget(harness());

  expect(find.textContaining('A-WIDGET-FIRST-FRAME-CANARY'), findsNothing);
  expect(find.textContaining('801 A Widget Street'), findsNothing);
  expect(LocalRestaurantProfileStore.profile.value.name, isEmpty);
  expect(find.byType(CircularProgressIndicator), findsOneWidget);

  ownerBAccount.complete(
    _approvedAccount(
      uid: owner.uid,
      restaurantName: 'B Current Widget Restaurant',
      streetAddress: '802 B Widget Street',
    ),
  );
  await tester.pumpAndSettle();
  await _ensureSectionExpanded(
    tester,
    'Basic Restaurant Information',
    visibleWhenExpanded: find.text('B Current Widget Restaurant'),
  );
  expect(find.text('B Current Widget Restaurant'), findsOneWidget);
  expect(_fieldText(tester, 'Street Address'), '802 B Widget Street');
  expect(find.textContaining('A-WIDGET-FIRST-FRAME-CANARY'), findsNothing);
}

Future<void> _verifyStaleRenderedSignOutIsOwnerScoped(
  WidgetTester tester,
) async {
  final ownerA = _TestUser(
    uid: 'stale-signout-owner-a',
    email: 'stale-signout-a@example.test',
  );
  final ownerB = _TestUser(
    uid: 'stale-signout-owner-b',
    email: 'stale-signout-b@example.test',
  );
  User? currentUser = ownerA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  var signOutCalls = 0;

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(
      uid: uid,
      email: uid == ownerA.uid ? ownerA.email! : ownerB.email!,
      restaurantName: uid == ownerA.uid
          ? 'A Stale Signout Restaurant'
          : 'B Current Signout Restaurant',
    ),
    signOutRestaurantSession: () async {
      signOutCalls += 1;
    },
    testCurrentUser: ownerA,
    currentUserProvider: () => currentUser,
    ownerUserChanges: userChanges.stream,
  );
  final staleSignOut = tester
      .widget<TextButton>(find.widgetWithText(TextButton, 'Sign Out'))
      .onPressed!;

  currentUser = ownerB;
  userChanges.add(ownerB);
  await tester.pumpAndSettle();
  staleSignOut();
  await tester.pump();

  expect(signOutCalls, 0);
  expect(find.text('Restaurant: Create Coupon'), findsOneWidget);
  await _ensureSectionExpanded(tester, 'Basic Restaurant Information');
  expect(find.text('B Current Signout Restaurant'), findsOneWidget);
  expect(find.textContaining('A Stale Signout Restaurant'), findsNothing);
}

Coupon _ownerCoupon({
  required String title,
  String id = 'shared-coupon-id',
  String? imageUrl,
}) {
  final now = DateTime.now();
  return Coupon(
    id: id,
    restaurant: title.contains('A')
        ? 'Owner A Restaurant'
        : 'Owner B Restaurant',
    title: title,
    distance: '0.8 miles away',
    startTime: now.subtract(const Duration(hours: 1)),
    endTime: now.add(const Duration(days: 2)),
    usageRule: 'Unlimited',
    details: '$title details',
    imageUrl: imageUrl,
  );
}

DailySpecial _ownerDailySpecial({
  required String uid,
  required String title,
  String id = 'shared-daily-id',
}) {
  return DailySpecial(id: id, restaurantId: uid, ownerUid: uid, title: title);
}

Finder _cardContaining(String text) {
  return find.ancestor(of: find.text(text), matching: find.byType(Card)).first;
}

Finder _networkImageWithUrl(String imageUrl) {
  return find.byWidgetPredicate(
    (widget) =>
        widget is Image &&
        widget.image is NetworkImage &&
        (widget.image as NetworkImage).url == imageUrl,
  );
}

Future<void> _tapCardAction(
  WidgetTester tester, {
  required String cardText,
  required String actionText,
}) async {
  final action = find.descendant(
    of: _cardContaining(cardText),
    matching: find.widgetWithText(TextButton, actionText),
  );
  await tester.ensureVisible(action);
  await tester.tap(action);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

Future<void> _ensureSectionExpanded(
  WidgetTester tester,
  String title, {
  Finder? visibleWhenExpanded,
}) async {
  final content = visibleWhenExpanded;
  if (content != null && content.evaluate().isNotEmpty) {
    return;
  }
  await _expandSection(tester, title);
}

Future<void> _ensureSubscriptionActionVisible(
  WidgetTester tester, {
  required bool useCustomerPortal,
}) {
  if (useCustomerPortal) {
    return _ensureSectionExpanded(
      tester,
      'Subscription / Billing',
      visibleWhenExpanded: find.widgetWithText(
        OutlinedButton,
        'Manage Subscription',
      ),
    );
  }
  return _ensureSectionExpanded(
    tester,
    'Coupon Management / Daily Specials',
    visibleWhenExpanded: find.widgetWithText(
      FilledButton,
      'Start Subscription',
    ),
  );
}

Future<void> _invokeSubscriptionAction(
  WidgetTester tester, {
  required bool useCustomerPortal,
}) {
  if (useCustomerPortal) {
    return _invokeOutlinedButton(tester, 'Manage Subscription');
  }
  return _invokeFilledButton(tester, 'Start Subscription');
}

Future<void> _invokeElevatedButton(WidgetTester tester, String label) async {
  final finder = find.widgetWithText(ElevatedButton, label);
  await tester.ensureVisible(finder);
  tester.widget<ElevatedButton>(finder).onPressed!();
  await tester.pump();
}

Future<void> _invokeFilledButton(WidgetTester tester, String label) async {
  final finder = find.widgetWithText(FilledButton, label);
  await tester.ensureVisible(finder);
  tester.widget<FilledButton>(finder).onPressed!();
  await tester.pump();
}

Future<void> _tapFilledButton(WidgetTester tester, String label) async {
  final finder = find.widgetWithText(FilledButton, label);
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> _invokeOutlinedButton(WidgetTester tester, String label) async {
  final finder = find.widgetWithText(OutlinedButton, label);
  await tester.ensureVisible(finder);
  tester.widget<OutlinedButton>(finder).onPressed!();
  await tester.pump();
}

Future<void> _invokeCouponDateTimeField(
  WidgetTester tester,
  String label,
) async {
  final field = find.byWidgetPredicate(
    (widget) =>
        widget is InputDecorator && widget.decoration.labelText == label,
  );
  final inkWell = find
      .ancestor(of: field, matching: find.byType(InkWell))
      .first;
  await tester.ensureVisible(inkWell);
  tester.widget<InkWell>(inkWell).onTap!();
  await tester.pump();
}

Future<void> _verifyAuthoritativeOwnerBProfileTransition(
  WidgetTester tester, {
  required bool sameUidDocumentSwitch,
}) async {
  const ownerAName = 'A-AUTHORITATIVE-CANARY';
  const ownerBName = 'B Authoritative Restaurant';
  const ownerAImage = 'https://images.example/a-authoritative-canary.jpg';
  const ownerBImage = 'https://images.example/b-authoritative.jpg';
  final ownerA = _TestUser(
    uid: sameUidDocumentSwitch ? 'shared-authoritative-owner' : 'authority-a',
    email: 'authority-a@example.test',
  );
  final ownerB = sameUidDocumentSwitch
      ? ownerA
      : _TestUser(uid: 'authority-b', email: 'authority-b@example.test');
  final documentA = sameUidDocumentSwitch
      ? 'authoritative-document-a'
      : ownerA.uid;
  final documentB = sameUidDocumentSwitch
      ? 'authoritative-document-b'
      : ownerB.uid;
  User? currentUser = ownerA;
  var currentDocumentId = documentA;
  var ownerBProfileVersion = 41;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final lifecyclePayloads = <Map<String, dynamic>>[];
  final ownerAHours = _businessHoursForSunday(
    opensAt: '3:15 AM',
    closesAt: '4:45 AM',
  );
  final ownerBHours = _businessHoursForSunday(
    opensAt: '8:15 AM',
    closesAt: '9:45 AM',
  );

  Map<String, dynamic> accountFor(String resolvedDocumentId) {
    if (resolvedDocumentId == documentA) {
      return _approvedAccount(
        uid: ownerA.uid,
        email: ownerA.email!,
        restaurantName: ownerAName,
        streetAddress: '31 A-AUTHORITATIVE-STREET',
        city: 'A-AUTHORITATIVE-CITY',
        state: 'GA',
        zipCode: '30303',
        phone: '(404) 555-0131',
        website: 'https://a-authoritative.example',
        bio: 'A-AUTHORITATIVE-BIO',
        mainImageUrl: ownerAImage,
        businessHours: ownerAHours,
        profileVersion: 93,
        locationVersion: 73,
        subscriptionStatus: 'inactive',
      );
    }
    return _approvedAccount(
      uid: ownerB.uid,
      email: ownerB.email!,
      restaurantName: ownerBName,
      streetAddress: '42 B Authority Avenue',
      city: 'B Authority City',
      state: 'FL',
      zipCode: '34442',
      phone: '(352) 555-0142',
      website: 'https://b-authoritative.example',
      bio: 'B authoritative bio',
      mainImageUrl: ownerBImage,
      businessHours: ownerBHours,
      profileVersion: ownerBProfileVersion,
      locationVersion: 31,
      subscriptionStatus: 'active',
    );
  }

  await _pumpApplicationScreen(
    tester,
    lifecycleService: BiteSaverRestaurantLifecycleService(
      invokeCallable: (name, payload) async {
        lifecyclePayloads.add(Map<String, dynamic>.from(payload));
        ownerBProfileVersion = 42;
        return <String, dynamic>{
          'documentId': documentB,
          'approvalStatus': 'approved',
          'profileVersion': ownerBProfileVersion,
          'locationVersion': 31,
        };
      },
    ),
    loadAccount: (uid) async {
      final resolvedDocumentId = sameUidDocumentSwitch
          ? currentDocumentId
          : uid;
      return accountFor(resolvedDocumentId);
    },
    testCurrentUser: ownerA,
    currentUserProvider: () => currentUser,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) =>
        sameUidDocumentSwitch ? currentDocumentId : uid,
  );

  expect(LocalRestaurantProfileStore.profile.value.name, ownerAName);
  currentDocumentId = documentB;
  if (!sameUidDocumentSwitch) {
    currentUser = ownerB;
  }
  userChanges.add(ownerB);
  await tester.pumpAndSettle();

  expect(lifecyclePayloads, isEmpty);
  await _expandSection(tester, 'Basic Restaurant Information');
  expect(find.text(ownerBName), findsOneWidget);
  expect(_fieldText(tester, 'Email Address'), ownerB.email);
  expect(_fieldText(tester, 'Phone Number'), '(352) 555-0142');
  expect(_fieldText(tester, 'Street Address'), '42 B Authority Avenue');
  expect(_fieldText(tester, 'City'), 'B Authority City');
  expect(_fieldText(tester, 'State'), 'FL');
  expect(_fieldText(tester, 'ZIP Code'), '34442');
  expect(_fieldText(tester, 'Website'), 'https://b-authoritative.example');
  expect(_fieldText(tester, 'Short Bio'), 'B authoritative bio');
  for (final canary in <String>[
    ownerAName,
    '31 A-AUTHORITATIVE-STREET',
    'A-AUTHORITATIVE-CITY',
    '(404) 555-0131',
    'https://a-authoritative.example',
    'A-AUTHORITATIVE-BIO',
    ownerAImage,
    '3:15 AM',
    '4:45 AM',
  ]) {
    expect(find.textContaining(canary), findsNothing, reason: canary);
  }

  final ownerBProfile = LocalRestaurantProfileStore.profile.value;
  expect(ownerBProfile.name, ownerBName);
  expect(ownerBProfile.streetAddress, '42 B Authority Avenue');
  expect(ownerBProfile.city, 'B Authority City');
  expect(ownerBProfile.state, 'FL');
  expect(ownerBProfile.zipCode, '34442');
  expect(ownerBProfile.phone, '(352) 555-0142');
  expect(ownerBProfile.website, 'https://b-authoritative.example');
  expect(ownerBProfile.bio, 'B authoritative bio');
  expect(ownerBProfile.mainImageUrl, ownerBImage);
  final ownerBSunday = ownerBProfile.businessHours.firstWhere(
    (entry) => entry.day == 'Sunday',
  );
  expect(ownerBSunday.opensAt, '8:15 AM');
  expect(ownerBSunday.closesAt, '9:45 AM');

  await _expandSection(tester, 'Hours');
  expect(find.textContaining('8:15 AM - 9:45 AM'), findsOneWidget);
  expect(find.textContaining('3:15 AM - 4:45 AM'), findsNothing);
  await _expandSection(tester, 'Restaurant Image');
  final ownerBPreview = tester.widget<BiteSaverRestaurantImage>(
    find.byKey(const ValueKey('restaurant-image-owner-preview')),
  );
  expect(ownerBPreview.imageBytes, isNull);
  expect(ownerBPreview.imageUrl, ownerBImage);
  await _expandSection(tester, 'Customer Preview');
  expect(find.text('B authoritative bio'), findsWidgets);
  expect(find.text('Website: https://b-authoritative.example'), findsOneWidget);
  expect(find.textContaining('A-AUTHORITATIVE'), findsNothing);
  await _expandSection(tester, 'Subscription / Billing');
  expect(find.text('Subscription active'), findsOneWidget);
  expect(lifecyclePayloads, isEmpty);

  await _tapElevatedButton(tester, 'Save Hours');
  expect(lifecyclePayloads, hasLength(1));
  expect(lifecyclePayloads.single['intent'], 'ownerUpdate');
  expect(lifecyclePayloads.single['updateSection'], 'businessHours');
  expect(lifecyclePayloads.single['expectedProfileVersion'], 41);
  expect(lifecyclePayloads.single['expectedLocationVersion'], 31);
}

Future<void> _verifyDelayedOwnerALoadCannotDisturbOwnerB(
  WidgetTester tester, {
  required bool delayedFailure,
}) async {
  const ownerAName = 'A-DELAYED-ACCOUNT-CANARY';
  const ownerBName = 'B Loaded Before A';
  final ownerA = _TestUser(
    uid: 'delayed-account-a',
    email: 'delayed-a@example.test',
  );
  final ownerB = _TestUser(
    uid: 'delayed-account-b',
    email: 'delayed-b@example.test',
  );
  User? currentUser = ownerA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final pendingOwnerAAccount = Completer<Map<String, dynamic>?>();
  var ownerALoads = 0;
  var ownerBLoads = 0;
  var lifecycleCalls = 0;

  await _pumpApplicationScreen(
    tester,
    lifecycleService: BiteSaverRestaurantLifecycleService(
      invokeCallable: (name, payload) async {
        lifecycleCalls += 1;
        throw StateError('No lifecycle call was expected.');
      },
    ),
    loadAccount: (uid) {
      if (uid == ownerA.uid) {
        ownerALoads += 1;
        return pendingOwnerAAccount.future;
      }
      ownerBLoads += 1;
      return Future<Map<String, dynamic>?>.value(
        _approvedAccount(
          uid: ownerB.uid,
          email: ownerB.email!,
          restaurantName: ownerBName,
          streetAddress: '52 B Ready Road',
          city: 'B Ready City',
          state: 'FL',
          zipCode: '34452',
          phone: '(352) 555-0152',
          website: 'https://b-ready.example',
          bio: 'B remains usable',
          mainImageUrl: 'https://images.example/b-ready.jpg',
          businessHours: _businessHoursForSunday(
            opensAt: '10:15 AM',
            closesAt: '6:45 PM',
          ),
          profileVersion: 51,
          locationVersion: 32,
        ),
      );
    },
    testCurrentUser: ownerA,
    currentUserProvider: () => currentUser,
    ownerUserChanges: userChanges.stream,
    settle: false,
  );
  await _pumpUntil(tester, () => ownerALoads == 1);

  currentUser = ownerB;
  userChanges.add(ownerB);
  await _pumpUntil(tester, () => ownerBLoads == 1);
  await _pumpUntil(
    tester,
    () => find.text('Restaurant: Create Coupon').evaluate().isNotEmpty,
    maxPumps: 40,
  );
  expect(pendingOwnerAAccount.isCompleted, isFalse);
  await _expandSection(tester, 'Basic Restaurant Information');
  expect(find.text(ownerBName), findsOneWidget);
  expect(_fieldText(tester, 'Street Address'), '52 B Ready Road');

  if (delayedFailure) {
    pendingOwnerAAccount.completeError(StateError('A-DELAYED-ERROR-CANARY'));
  } else {
    pendingOwnerAAccount.complete(
      _approvedAccount(
        uid: ownerA.uid,
        email: ownerA.email!,
        restaurantName: ownerAName,
        streetAddress: '61 A Delayed Street',
        city: 'A Delayed City',
        state: 'AK',
        zipCode: '99561',
        phone: '(907) 555-0161',
        website: 'https://a-delayed.example',
        bio: 'A delayed bio',
        mainImageUrl: 'https://images.example/a-delayed.jpg',
        businessHours: _businessHoursForSunday(
          opensAt: '2:15 AM',
          closesAt: '3:45 AM',
        ),
        profileVersion: 99,
        locationVersion: 88,
      ),
    );
  }
  await tester.pumpAndSettle();

  expect(find.text(ownerBName), findsOneWidget);
  expect(find.textContaining(ownerAName), findsNothing);
  expect(find.textContaining('A-DELAYED'), findsNothing);
  expect(find.text('Could Not Load Coupon Tools'), findsNothing);
  expect(find.byType(SnackBar), findsNothing);
  expect(_fieldText(tester, 'Street Address'), '52 B Ready Road');
  expect(_fieldText(tester, 'Website'), 'https://b-ready.example');
  expect(_fieldText(tester, 'Short Bio'), 'B remains usable');
  expect(LocalRestaurantProfileStore.profile.value.name, ownerBName);
  expect(
    LocalRestaurantProfileStore.profile.value.mainImageUrl,
    'https://images.example/b-ready.jpg',
  );
  expect(ownerALoads, 1);
  expect(ownerBLoads, 1);
  expect(lifecycleCalls, 0);

  await _expandSection(tester, 'Hours');
  final saveHours = find.widgetWithText(ElevatedButton, 'Save Hours');
  expect(tester.widget<ElevatedButton>(saveHours).onPressed, isNotNull);
}

Future<void> _verifyProductionDefaultValidatorAcceptsImage(
  WidgetTester tester, {
  required String fileName,
  required Uint8List fixtureBytes,
  required String expectedExtension,
  required String expectedContentType,
}) async {
  final expectedBytes = Uint8List.fromList(fixtureBytes);
  final pickedImage = BiteSaverPickedImage(
    fileName: fileName,
    bytes: fixtureBytes,
  );
  final uploadedUrl =
      'https://images.example/default-validator.$expectedExtension';
  var uploadCalls = 0;
  var storageWrites = 0;
  var lifecycleCalls = 0;
  BiteSaverValidatedRestaurantImage? uploadedValidatedImage;
  Uint8List? uploadedBytes;
  String? uploadedObjectPath;
  String? uploadedContentType;

  await _pumpApplicationScreen(
    tester,
    lifecycleService: BiteSaverRestaurantLifecycleService(
      invokeCallable: (name, payload) async {
        lifecycleCalls += 1;
        throw StateError('No lifecycle save was expected.');
      },
    ),
    loadAccount: (uid) async => _approvedAccount(uid: uid),
    pickRestaurantImage: () async => pickedImage,
    uploadRestaurantImage: ({required uid, required validatedImage}) async {
      uploadCalls += 1;
      uploadedValidatedImage = validatedImage;
      return BiteSaverImageUploadService.uploadRestaurantImage(
        uid: uid,
        validatedImage: validatedImage,
        storageWriter:
            ({
              required objectPath,
              required bytes,
              required contentType,
            }) async {
              storageWrites += 1;
              uploadedObjectPath = objectPath;
              uploadedBytes = bytes;
              uploadedContentType = contentType;
              return BiteSaverImageUploadResult(
                imageUrl: uploadedUrl,
                storagePath: objectPath,
              );
            },
      );
    },
  );
  await _expandSection(tester, 'Restaurant Image');
  await _invokeRestaurantImagePickerWithRealTime(
    tester,
    'Add restaurant image',
  );

  final validatedImage = uploadedValidatedImage;
  expect(validatedImage, isNotNull);
  expect(validatedImage!.wasValidatedFrom(pickedImage), isTrue);
  expect(uploadCalls, 1);
  expect(storageWrites, 1);
  expect(
    uploadedObjectPath,
    matches(
      RegExp(
        '^bitesaver_restaurants/owner-1/restaurant_images/'
        'main_image_[0-9]+\\.$expectedExtension\$',
      ),
    ),
  );
  expect(uploadedContentType, expectedContentType);
  expect(uploadedBytes, same(validatedImage.pickedImage.bytes));
  expect(uploadedBytes, orderedEquals(expectedBytes));
  expect(identical(uploadedBytes, fixtureBytes), isFalse);
  expect(() => validatedImage.pickedImage.bytes[0] = 0, throwsUnsupportedError);

  final preview = tester.widget<BiteSaverRestaurantImage>(
    find.byKey(const ValueKey('restaurant-image-owner-preview')),
  );
  expect(preview.imageBytes, same(validatedImage.pickedImage.bytes));
  expect(preview.imageUrl, uploadedUrl);
  expect(
    find.text('Restaurant image uploaded. Save Restaurant Image to apply it.'),
    findsOneWidget,
  );
  expect(lifecycleCalls, 0);
}

Future<void> _verifyPendingApplicationCompletionIsOwnerScoped(
  WidgetTester tester, {
  required bool sameUidDocumentSwitch,
  required bool failure,
}) async {
  final ownerA = _TestUser(
    uid: sameUidDocumentSwitch ? 'shared-application-owner' : 'application-a',
    email: 'application-a@example.test',
  );
  final ownerB = sameUidDocumentSwitch
      ? ownerA
      : _TestUser(uid: 'application-b', email: 'application-b@example.test');
  final documentA = sameUidDocumentSwitch
      ? 'application-document-a'
      : ownerA.uid;
  final documentB = sameUidDocumentSwitch
      ? 'application-document-b'
      : ownerB.uid;
  User? currentUser = ownerA;
  var currentDocumentId = documentA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final pendingOwnerAApplication = Completer<Object?>();
  final pendingOwnerBApplication = Completer<Object?>();
  final lifecyclePayloads = <Map<String, dynamic>>[];
  var ownerALoads = 0;
  var ownerBLoads = 0;
  var ownerBSubmitted = false;

  final service = BiteSaverRestaurantLifecycleService(
    invokeCallable: (name, payload) {
      lifecyclePayloads.add(Map<String, dynamic>.from(payload));
      if (lifecyclePayloads.length == 1) {
        return pendingOwnerAApplication.future;
      }
      return pendingOwnerBApplication.future;
    },
  );

  await _pumpApplicationScreen(
    tester,
    lifecycleService: service,
    loadAccount: (uid) async {
      final resolvedDocumentId = sameUidDocumentSwitch
          ? currentDocumentId
          : uid;
      if (resolvedDocumentId == documentA) {
        ownerALoads += 1;
        return null;
      }
      ownerBLoads += 1;
      if (!ownerBSubmitted) {
        return null;
      }
      return <String, dynamic>{
        Restaurant.fieldUid: ownerB.uid,
        Restaurant.fieldEmail: 'application-b-document@example.test',
        Restaurant.fieldName: 'Owner B Submitted Restaurant',
        Restaurant.fieldStreetAddress: '2 B Application Street',
        Restaurant.fieldCity: 'B Application City',
        Restaurant.fieldState: 'FL',
        Restaurant.fieldZipCode: '34422',
        Restaurant.fieldPhone: '(352) 555-0122',
        Restaurant.fieldProfileVersion: 1,
        Restaurant.fieldApprovalStatus: 'pending',
        'couponApplicationSubmitted': true,
      };
    },
    testCurrentUser: ownerA,
    currentUserProvider: () => currentUser,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) =>
        sameUidDocumentSwitch ? currentDocumentId : uid,
  );
  expect(ownerALoads, 1);
  await _enterRequiredApplicationFields(
    tester,
    restaurantName: 'Owner A Restaurant',
  );

  final applyButton = find.widgetWithText(
    FilledButton,
    'Apply for a restaurant account',
  );
  await tester.ensureVisible(applyButton);
  await tester.tap(applyButton);
  await _pumpUntil(tester, () => lifecyclePayloads.length == 1);
  expect(lifecyclePayloads.single['intent'], 'submitApplication');

  currentDocumentId = documentB;
  if (!sameUidDocumentSwitch) {
    currentUser = ownerB;
  }
  userChanges.add(ownerB);
  await _pumpUntil(tester, () => ownerBLoads == 1);
  await tester.pumpAndSettle();

  expect(find.text('Apply for Coupon-Side Approval'), findsOneWidget);
  await _enterRequiredApplicationFields(
    tester,
    restaurantName: 'Owner B Submitted Restaurant',
  );
  await _invokeFilledButton(tester, 'Apply for a restaurant account');
  await _pumpUntil(tester, () => lifecyclePayloads.length == 2);
  expect(pendingOwnerAApplication.isCompleted, isFalse);
  expect(pendingOwnerBApplication.isCompleted, isFalse);
  final ownerBProfile = lifecyclePayloads[1]['profile'] as Map<String, dynamic>;
  expect(ownerBProfile['restaurantName'], 'Owner B Submitted Restaurant');
  expect(jsonEncode(ownerBProfile), isNot(contains('Owner A Restaurant')));

  if (failure) {
    pendingOwnerAApplication.completeError(
      const BiteSaverCallableFailure(
        'unavailable',
        'raw owner A application provider detail',
      ),
    );
  } else {
    pendingOwnerAApplication.complete(<String, dynamic>{
      'documentId': documentA,
      'approvalStatus': 'pending',
      'profileVersion': 99,
      'locationVersion': 88,
    });
  }
  await tester.pump();
  await tester.pump();

  expect(
    find.text('Coupon-side application submitted for admin review.'),
    findsNothing,
  );
  expect(
    find.text(
      'Restaurant address validation is temporarily unavailable. Try again.',
    ),
    findsNothing,
  );
  expect(find.textContaining('raw owner A'), findsNothing);
  expect(find.text('Owner A Restaurant'), findsNothing);
  expect(ownerALoads, 1);
  expect(ownerBLoads, 1);
  expect(lifecyclePayloads, hasLength(2));
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

  ownerBSubmitted = true;
  pendingOwnerBApplication.complete(<String, dynamic>{
    'documentId': documentB,
    'approvalStatus': 'pending',
    'profileVersion': 1,
    'locationVersion': 1,
  });
  await tester.pumpAndSettle();

  expect(ownerBLoads, 2);
  expect(find.text('Coupon-Side Approval Pending'), findsOneWidget);
  expect(
    find.text('Coupon-side application submitted for admin review.'),
    findsOneWidget,
  );
  expect(find.textContaining('Owner A Restaurant'), findsNothing);
}

Future<void> _verifyPendingCouponSaveIsOwnerScoped(
  WidgetTester tester, {
  required bool sameUidDocumentSwitch,
  required bool ownerAFails,
}) async {
  final ownerA = _TestUser(
    uid: sameUidDocumentSwitch ? 'shared-coupon-save-owner' : 'coupon-save-a',
    email: 'coupon-save-a@example.test',
  );
  final ownerB = sameUidDocumentSwitch
      ? ownerA
      : _TestUser(uid: 'coupon-save-b', email: 'coupon-save-b@example.test');
  final documentA = sameUidDocumentSwitch
      ? 'coupon-save-document-a'
      : ownerA.uid;
  final documentB = sameUidDocumentSwitch
      ? 'coupon-save-document-b'
      : ownerB.uid;
  final ownerACoupon = _ownerCoupon(title: 'A-COUPON-ORIGINAL-CANARY');
  final ownerBCoupon = _ownerCoupon(title: 'B Coupon Original');
  User? currentUser = ownerA;
  var currentDocumentId = documentA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final ownerASave = Completer<Coupon>();
  final ownerBSave = Completer<Coupon>();
  final saveRequests = <({String uid, Coupon coupon})>[];

  String resolvedDocument(String uid) =>
      sameUidDocumentSwitch ? currentDocumentId : uid;

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async {
      final documentId = resolvedDocument(uid);
      return <String, dynamic>{
        ..._approvedAccount(
          uid: uid,
          email: documentId == documentA
              ? 'coupon-account-a@example.test'
              : 'coupon-account-b@example.test',
          restaurantName: documentId == documentA
              ? 'A-RESTAURANT-NAME-CANARY'
              : 'B Authoritative Restaurant',
          profileVersion: documentId == documentA ? 11 : 21,
          locationVersion: documentId == documentA ? 12 : 22,
        ),
        Restaurant.fieldDistance: documentId == documentA
            ? 'A-DISTANCE-CANARY'
            : 'B authoritative distance',
      };
    },
    loadCoupons: (uid) async => resolvedDocument(uid) == documentA
        ? <Coupon>[ownerACoupon]
        : <Coupon>[ownerBCoupon],
    updateCoupon: ({required uid, required coupon}) {
      saveRequests.add((uid: uid, coupon: coupon));
      return saveRequests.length == 1 ? ownerASave.future : ownerBSave.future;
    },
    testCurrentUser: ownerA,
    currentUserProvider: () => currentUser,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => resolvedDocument(uid),
  );

  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('A-COUPON-ORIGINAL-CANARY'),
  );
  await _tapCardAction(
    tester,
    cardText: 'A-COUPON-ORIGINAL-CANARY',
    actionText: 'Edit',
  );
  await tester.enterText(
    _fieldWithLabel('Coupon Title'),
    'A-COUPON-SAVE-CANARY',
  );
  await _invokeElevatedButton(tester, 'Save Coupon Changes');
  await _pumpUntil(tester, () => saveRequests.length == 1);

  currentDocumentId = documentB;
  if (!sameUidDocumentSwitch) {
    currentUser = ownerB;
  }
  userChanges.add(ownerB);
  await tester.pumpAndSettle();

  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('B Coupon Original'),
  );
  expect(_fieldText(tester, 'Coupon Title'), isEmpty);
  await _tapCardAction(
    tester,
    cardText: 'B Coupon Original',
    actionText: 'Edit',
  );
  await tester.enterText(
    _fieldWithLabel('Coupon Title'),
    'B Coupon Pending Save',
  );
  await _invokeElevatedButton(tester, 'Save Coupon Changes');
  await _pumpUntil(tester, () => saveRequests.length == 2);
  expect(ownerASave.isCompleted, isFalse);
  expect(ownerBSave.isCompleted, isFalse);

  if (ownerAFails) {
    ownerASave.completeError(StateError('A-COUPON-SAVE-ERROR-CANARY'));
  } else {
    ownerASave.complete(
      saveRequests.first.coupon.copyWith(title: 'A-SAVED-COUPON-CANARY'),
    );
  }
  await tester.pump();
  await tester.pump();

  expect(
    find.widgetWithText(ElevatedButton, 'Saving Changes...'),
    findsOneWidget,
  );
  expect(
    tester
        .widget<ElevatedButton>(
          find.widgetWithText(ElevatedButton, 'Saving Changes...'),
        )
        .onPressed,
    isNull,
  );
  expect(LocalCouponStore.createdCoupons.value, hasLength(1));
  expect(
    LocalCouponStore.createdCoupons.value.single.title,
    'B Coupon Original',
  );
  expect(find.textContaining('A-SAVED-COUPON-CANARY'), findsNothing);
  expect(find.textContaining('A-COUPON-SAVE-ERROR-CANARY'), findsNothing);
  expect(find.byType(AlertDialog), findsNothing);

  ownerBSave.complete(saveRequests[1].coupon.copyWith(title: 'B Coupon Saved'));
  await tester.pumpAndSettle();

  expect(saveRequests[0].coupon.restaurant, 'A-RESTAURANT-NAME-CANARY');
  expect(saveRequests[0].coupon.distance, 'A-DISTANCE-CANARY');
  expect(saveRequests[1].coupon.restaurant, 'B Authoritative Restaurant');
  expect(saveRequests[1].coupon.distance, 'B authoritative distance');
  expect(LocalCouponStore.createdCoupons.value, hasLength(1));
  expect(LocalCouponStore.createdCoupons.value.single.title, 'B Coupon Saved');
  expect(find.text('Coupon Updated'), findsOneWidget);
  final couponDialog = find.byType(AlertDialog);
  expect(
    find.descendant(
      of: couponDialog,
      matching: find.textContaining('Restaurant: B Authoritative Restaurant'),
    ),
    findsOneWidget,
  );
  expect(
    find.descendant(
      of: couponDialog,
      matching: find.textContaining('Email: coupon-account-b@example.test'),
    ),
    findsOneWidget,
  );
  expect(find.textContaining('A-RESTAURANT-NAME-CANARY'), findsNothing);
  await tester.tap(find.widgetWithText(TextButton, 'OK'));
  await tester.pumpAndSettle();
  expect(_fieldText(tester, 'Coupon Title'), isEmpty);
}

Future<void> _verifyPendingCouponDeleteIsOwnerScoped(
  WidgetTester tester,
) async {
  final owner = _TestUser(
    uid: 'shared-coupon-delete-owner',
    email: 'coupon-delete@example.test',
  );
  const documentA = 'coupon-delete-document-a';
  const documentB = 'coupon-delete-document-b';
  var currentDocumentId = documentA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final ownerADelete = Completer<void>();
  final ownerBDelete = Completer<void>();
  var deleteCalls = 0;

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(
      uid: uid,
      restaurantName: currentDocumentId == documentA
          ? 'A Delete Restaurant'
          : 'B Delete Restaurant',
    ),
    loadCoupons: (uid) async => <Coupon>[
      _ownerCoupon(
        title: currentDocumentId == documentA
            ? 'A-DELETE-COUPON-CANARY'
            : 'B Coupon Must Remain',
      ),
    ],
    deleteCoupon: ({required uid, required couponId}) {
      deleteCalls += 1;
      return deleteCalls == 1 ? ownerADelete.future : ownerBDelete.future;
    },
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => currentDocumentId,
  );

  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('A-DELETE-COUPON-CANARY'),
  );
  await _tapCardAction(
    tester,
    cardText: 'A-DELETE-COUPON-CANARY',
    actionText: 'Remove',
  );
  await _pumpUntil(tester, () => deleteCalls == 1);

  currentDocumentId = documentB;
  userChanges.add(owner);
  await tester.pumpAndSettle();
  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('B Coupon Must Remain'),
  );
  await _tapCardAction(
    tester,
    cardText: 'B Coupon Must Remain',
    actionText: 'Remove',
  );
  await _pumpUntil(tester, () => deleteCalls == 2);

  ownerADelete.complete();
  await tester.pump();
  await tester.pump();
  expect(find.text('B Coupon Must Remain'), findsOneWidget);
  expect(
    LocalCouponStore.createdCoupons.value.single.title,
    'B Coupon Must Remain',
  );
  expect(find.text('Coupon removed.'), findsNothing);
  final bRemove = find.descendant(
    of: _cardContaining('B Coupon Must Remain'),
    matching: find.widgetWithText(TextButton, 'Remove'),
  );
  expect(tester.widget<TextButton>(bRemove).onPressed, isNull);

  ownerBDelete.complete();
  await tester.pumpAndSettle();
  expect(find.text('B Coupon Must Remain'), findsNothing);
  expect(LocalCouponStore.createdCoupons.value, isEmpty);
  expect(find.text('Coupon removed.'), findsOneWidget);
}

Future<void> _verifyPendingCouponPickerIsOwnerScoped(
  WidgetTester tester, {
  required String pendingBoundary,
}) async {
  final owner = _TestUser(
    uid: 'shared-coupon-picker-owner',
    email: 'coupon-picker@example.test',
  );
  const documentA = 'coupon-picker-document-a';
  const documentB = 'coupon-picker-document-b';
  var currentDocumentId = documentA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final ownerACoupon = _ownerCoupon(title: 'A-PICKER-COUPON-CANARY');
  final ownerBCoupon = _ownerCoupon(title: 'B Picker Coupon');
  final pendingDate = Completer<DateTime?>();
  final pendingTime = Completer<TimeOfDay?>();
  var dateCalls = 0;
  var timeCalls = 0;

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(uid: uid),
    loadCoupons: (uid) async => <Coupon>[
      currentDocumentId == documentA ? ownerACoupon : ownerBCoupon,
    ],
    pickCouponDate:
        ({required initialDate, required firstDate, required lastDate}) {
          dateCalls += 1;
          return pendingBoundary == 'date'
              ? pendingDate.future
              : Future<DateTime?>.value(DateTime(2031, 4, 5));
        },
    pickCouponTime: ({required initialTime}) {
      timeCalls += 1;
      return pendingTime.future;
    },
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => currentDocumentId,
  );
  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('A-PICKER-COUPON-CANARY'),
  );
  await _tapCardAction(
    tester,
    cardText: 'A-PICKER-COUPON-CANARY',
    actionText: 'Edit',
  );
  await _invokeCouponDateTimeField(tester, 'End Time');
  await _pumpUntil(
    tester,
    () => pendingBoundary == 'date' ? dateCalls == 1 : timeCalls == 1,
  );

  currentDocumentId = documentB;
  userChanges.add(owner);
  await tester.pumpAndSettle();
  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('B Picker Coupon'),
  );
  await _tapCardAction(tester, cardText: 'B Picker Coupon', actionText: 'Edit');
  final expectedBEndText = Coupon.formatDateTime(ownerBCoupon.endTime!);
  expect(find.text(expectedBEndText), findsOneWidget);

  if (pendingBoundary == 'date') {
    pendingDate.complete(DateTime(2032, 6, 7));
  } else {
    pendingTime.complete(const TimeOfDay(hour: 4, minute: 32));
  }
  await tester.pump();
  await tester.pump();

  expect(find.text(expectedBEndText), findsOneWidget);
  expect(_fieldText(tester, 'Coupon Title'), 'B Picker Coupon');
  expect(find.textContaining('2032'), findsNothing);
  if (pendingBoundary == 'date') {
    expect(timeCalls, 0);
  } else {
    expect(timeCalls, 1);
  }
  expect(find.byType(SnackBar), findsNothing);
}

Future<void> _verifyPendingCouponImageIsOwnerScoped(
  WidgetTester tester, {
  required bool sameUidDocumentSwitch,
}) async {
  final ownerA = _TestUser(
    uid: sameUidDocumentSwitch
        ? 'shared-coupon-image-owner'
        : 'coupon-image-owner-a',
    email: 'coupon-image-a@example.test',
  );
  final ownerB = sameUidDocumentSwitch
      ? ownerA
      : _TestUser(
          uid: 'coupon-image-owner-b',
          email: 'coupon-image-b@example.test',
        );
  const documentA = 'coupon-image-document-a';
  const documentB = 'coupon-image-document-b';
  User? currentUser = ownerA;
  var currentDocumentId = documentA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final ownerAUpload = Completer<BiteSaverCouponImageUploadReceipt>();
  final ownerBUpload = Completer<BiteSaverCouponImageUploadReceipt>();
  final persistenceCalls = <({String uid, String couponId, String imageUrl})>[];
  final saveRequests = <({String uid, Coupon coupon})>[];
  var ownerARetrievalCalls = 0;
  var ownerBRetrievalCalls = 0;
  var uploadCalls = 0;

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(uid: uid),
    loadCoupons: (uid) async => <Coupon>[
      _ownerCoupon(
        title: currentDocumentId == documentA
            ? 'A-IMAGE-COUPON-CANARY'
            : 'B Image Coupon',
      ),
    ],
    updateCoupon: ({required uid, required coupon}) async {
      saveRequests.add((uid: uid, coupon: coupon));
      return coupon;
    },
    pickAndUploadCouponImage:
        ({required uid, required couponKey, required isCurrent}) async {
          uploadCalls += 1;
          final isOwnerAOperation = uploadCalls == 1;
          return BiteSaverImageUploadService.pickAndUploadCouponImage(
            uid: uid,
            couponKey: couponKey,
            isCurrent: isCurrent,
            dependencies: BiteSaverCouponImageUploadDependencies(
              pickImage: () async => BiteSaverCouponImageSource(
                fileName: isOwnerAOperation ? 'owner-a.jpg' : 'owner-b.jpg',
                readAsBytes: () async => Uint8List.fromList(<int>[1, 2, 3]),
              ),
              uploadImage:
                  ({
                    required objectPath,
                    required bytes,
                    required contentType,
                  }) => isOwnerAOperation
                  ? ownerAUpload.future
                  : ownerBUpload.future,
            ),
          );
        },
    persistCouponImage:
        ({required uid, required couponId, required imageUrl}) async {
          persistenceCalls.add((
            uid: uid,
            couponId: couponId,
            imageUrl: imageUrl,
          ));
        },
    testCurrentUser: ownerA,
    currentUserProvider: () => currentUser,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => currentDocumentId,
  );
  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('A-IMAGE-COUPON-CANARY'),
  );
  await _tapCardAction(
    tester,
    cardText: 'A-IMAGE-COUPON-CANARY',
    actionText: 'Edit',
  );
  await _invokeOutlinedButton(tester, 'Add coupon image');
  await _pumpUntil(tester, () => uploadCalls == 1);

  currentUser = ownerB;
  currentDocumentId = documentB;
  userChanges.add(ownerB);
  await tester.pumpAndSettle();
  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('B Image Coupon'),
  );
  await _tapCardAction(tester, cardText: 'B Image Coupon', actionText: 'Edit');
  await _invokeOutlinedButton(tester, 'Add coupon image');
  await _pumpUntil(tester, () => uploadCalls == 2);

  ownerAUpload.complete(
    BiteSaverCouponImageUploadReceipt(
      retrieveDownloadUrl: () async {
        ownerARetrievalCalls += 1;
        return 'https://images.example/A-IMAGE-URL-CANARY.jpg';
      },
    ),
  );
  await tester.pump();
  await tester.pump();
  expect(ownerARetrievalCalls, 0);
  expect(persistenceCalls, isEmpty);
  expect(find.widgetWithText(OutlinedButton, 'Uploading...'), findsOneWidget);
  expect(
    tester
        .widget<ElevatedButton>(
          find.widgetWithText(ElevatedButton, 'Save Coupon Changes'),
        )
        .onPressed,
    isNull,
  );
  expect(find.textContaining('A-IMAGE-URL-CANARY'), findsNothing);

  ownerBUpload.complete(
    BiteSaverCouponImageUploadReceipt(
      retrieveDownloadUrl: () async {
        ownerBRetrievalCalls += 1;
        return 'https://images.example/b-coupon-image.jpg';
      },
    ),
  );
  await tester.pumpAndSettle();
  expect(ownerBRetrievalCalls, 1);
  expect(persistenceCalls, hasLength(1));
  expect(persistenceCalls.single.uid, ownerB.uid);
  expect(persistenceCalls.single.couponId, 'shared-coupon-id');
  expect(
    persistenceCalls.single.imageUrl,
    'https://images.example/b-coupon-image.jpg',
  );
  expect(
    find.widgetWithText(OutlinedButton, 'Change coupon image'),
    findsOneWidget,
  );
  expect(find.text('Coupon image saved.'), findsOneWidget);
  expect(find.textContaining('A-IMAGE-URL-CANARY'), findsNothing);
  final saveButton = find.widgetWithText(ElevatedButton, 'Save Coupon Changes');
  expect(tester.widget<ElevatedButton>(saveButton).onPressed, isNotNull);
  await _invokeElevatedButton(tester, 'Save Coupon Changes');
  await _pumpUntil(tester, () => saveRequests.length == 1);
  expect(saveRequests.single.uid, ownerB.uid);
  expect(
    saveRequests.single.coupon.imageUrl,
    'https://images.example/b-coupon-image.jpg',
  );
}

Future<void> _verifyCouponImageOwnerTransitionOrdering(
  WidgetTester tester, {
  required bool sameUidDocumentSwitch,
  required bool staleOwnerAFails,
}) async {
  final ownerA = _TestUser(
    uid: sameUidDocumentSwitch
        ? 'shared-ordered-image-owner'
        : 'ordered-image-owner-a',
    email: 'ordered-image-a@example.test',
  );
  final ownerB = sameUidDocumentSwitch
      ? ownerA
      : _TestUser(
          uid: 'ordered-image-owner-b',
          email: 'ordered-image-b@example.test',
        );
  const documentA = 'ordered-image-document-a';
  const documentB = 'ordered-image-document-b';
  const ownerAExistingUrl =
      'https://images.example/A-EXISTING-IMAGE-CANARY.jpg';
  const ownerBExistingUrl = 'https://images.example/b-existing-image.jpg';
  const ownerALateUrl = 'https://images.example/A-LATE-IMAGE-URL-CANARY.jpg';
  const ownerBUrl = 'https://images.example/b-ordered-image.jpg';
  const ownerAErrorCanary =
      'A-SENSITIVE-UPLOAD-ERROR-CANARY owner-a-storage/provider/path';
  User? currentUser = ownerA;
  var currentDocumentId = documentA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final ownerAUpload = Completer<BiteSaverCouponImageUploadReceipt>();
  final ownerBUpload = Completer<BiteSaverCouponImageUploadReceipt>();
  final persistenceCalls =
      <({String uid, String documentId, String couponId, String imageUrl})>[];
  final saveRequests = <({String uid, String documentId, Coupon coupon})>[];
  var operationCalls = 0;
  var uploadBoundaryCalls = 0;
  var ownerARetrievalCalls = 0;
  var ownerBRetrievalCalls = 0;

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async {
      final isOwnerAAccount = currentDocumentId == documentA;
      return <String, dynamic>{
        ..._approvedAccount(
          uid: uid,
          email: isOwnerAAccount
              ? 'A-ACCOUNT-EMAIL-CANARY@example.test'
              : 'b-account@example.test',
          restaurantName: isOwnerAAccount
              ? 'A-RESTAURANT-NAME-CANARY'
              : 'B Ordered Restaurant',
          profileVersion: isOwnerAAccount ? 31 : 41,
          locationVersion: isOwnerAAccount ? 32 : 42,
        ),
        Restaurant.fieldDistance: isOwnerAAccount
            ? 'A-DISTANCE-CANARY'
            : 'B ordered distance',
      };
    },
    loadCoupons: (uid) async => <Coupon>[
      _ownerCoupon(
        title: currentDocumentId == documentA
            ? 'A-ORDERED-COUPON-CANARY'
            : 'B Ordered Coupon',
        imageUrl: currentDocumentId == documentA
            ? ownerAExistingUrl
            : ownerBExistingUrl,
      ),
    ],
    updateCoupon: ({required uid, required coupon}) async {
      saveRequests.add((
        uid: uid,
        documentId: currentDocumentId,
        coupon: coupon,
      ));
      return coupon.copyWith(title: 'B Ordered Coupon Saved');
    },
    pickAndUploadCouponImage:
        ({required uid, required couponKey, required isCurrent}) {
          operationCalls += 1;
          final isOwnerAOperation = operationCalls == 1;
          return BiteSaverImageUploadService.pickAndUploadCouponImage(
            uid: uid,
            couponKey: couponKey,
            isCurrent: isCurrent,
            dependencies: BiteSaverCouponImageUploadDependencies(
              pickImage: () async => BiteSaverCouponImageSource(
                fileName: isOwnerAOperation ? 'owner-a.jpg' : 'owner-b.jpg',
                readAsBytes: () async => Uint8List.fromList(
                  isOwnerAOperation ? <int>[21, 22, 23] : <int>[31, 32, 33],
                ),
              ),
              uploadImage:
                  ({
                    required objectPath,
                    required bytes,
                    required contentType,
                  }) {
                    uploadBoundaryCalls += 1;
                    return isOwnerAOperation
                        ? ownerAUpload.future
                        : ownerBUpload.future;
                  },
            ),
          );
        },
    persistCouponImage:
        ({required uid, required couponId, required imageUrl}) async {
          persistenceCalls.add((
            uid: uid,
            documentId: currentDocumentId,
            couponId: couponId,
            imageUrl: imageUrl,
          ));
        },
    testCurrentUser: ownerA,
    currentUserProvider: () => currentUser,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => currentDocumentId,
  );

  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('A-ORDERED-COUPON-CANARY'),
  );
  await _tapCardAction(
    tester,
    cardText: 'A-ORDERED-COUPON-CANARY',
    actionText: 'Edit',
  );
  await _invokeOutlinedButton(tester, 'Change coupon image');
  await _pumpUntil(tester, () => uploadBoundaryCalls == 1);
  expect(ownerAUpload.isCompleted, isFalse);

  currentDocumentId = documentB;
  if (!sameUidDocumentSwitch) {
    currentUser = ownerB;
  }
  userChanges.add(ownerB);
  await tester.pumpAndSettle();

  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('B Ordered Coupon'),
  );
  await _tapCardAction(
    tester,
    cardText: 'B Ordered Coupon',
    actionText: 'Edit',
  );
  expect(_networkImageWithUrl(ownerBExistingUrl), findsWidgets);
  expect(_networkImageWithUrl(ownerAExistingUrl), findsNothing);
  await _invokeOutlinedButton(tester, 'Change coupon image');
  await _pumpUntil(tester, () => uploadBoundaryCalls == 2);

  expect(operationCalls, 2);
  expect(ownerAUpload.isCompleted, isFalse);
  expect(ownerBUpload.isCompleted, isFalse);
  expect(find.widgetWithText(OutlinedButton, 'Uploading...'), findsOneWidget);
  expect(
    tester
        .widget<ElevatedButton>(
          find.widgetWithText(ElevatedButton, 'Save Coupon Changes'),
        )
        .onPressed,
    isNull,
  );

  if (staleOwnerAFails) {
    ownerAUpload.completeError(
      FirebaseException(
        plugin: 'firebase_storage',
        code: 'unavailable',
        message: ownerAErrorCanary,
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(ownerAUpload.isCompleted, isTrue);
    expect(ownerBUpload.isCompleted, isFalse);
    expect(persistenceCalls, isEmpty);
    expect(saveRequests, isEmpty);
    expect(find.byType(SnackBar), findsNothing);
    expect(
      find.text('Could not upload the coupon image right now.'),
      findsNothing,
    );
    expect(
      find.text('This service is temporarily unavailable. Please try again.'),
      findsNothing,
    );
    expect(find.textContaining(ownerAErrorCanary), findsNothing);
    expect(find.widgetWithText(OutlinedButton, 'Uploading...'), findsOneWidget);
    expect(
      tester
          .widget<ElevatedButton>(
            find.widgetWithText(ElevatedButton, 'Save Coupon Changes'),
          )
          .onPressed,
      isNull,
    );
    expect(_fieldText(tester, 'Coupon Title'), 'B Ordered Coupon');
    expect(_networkImageWithUrl(ownerBExistingUrl), findsWidgets);
    expect(_networkImageWithUrl(ownerAExistingUrl), findsNothing);
  }

  ownerBUpload.complete(
    BiteSaverCouponImageUploadReceipt(
      retrieveDownloadUrl: () async {
        ownerBRetrievalCalls += 1;
        return ownerBUrl;
      },
    ),
  );
  await tester.pumpAndSettle();

  expect(ownerBRetrievalCalls, 1);
  expect(persistenceCalls, hasLength(1));
  expect(persistenceCalls.single.uid, ownerB.uid);
  expect(persistenceCalls.single.documentId, documentB);
  expect(persistenceCalls.single.couponId, 'shared-coupon-id');
  expect(persistenceCalls.single.imageUrl, ownerBUrl);
  expect(_fieldText(tester, 'Coupon Title'), 'B Ordered Coupon');
  expect(_networkImageWithUrl(ownerBUrl), findsWidgets);
  expect(_networkImageWithUrl(ownerAExistingUrl), findsNothing);
  expect(find.textContaining(ownerALateUrl), findsNothing);
  expect(find.text('Coupon image saved.'), findsOneWidget);
  expect(find.text('Uploading...'), findsNothing);
  final saveButton = find.widgetWithText(ElevatedButton, 'Save Coupon Changes');
  expect(tester.widget<ElevatedButton>(saveButton).onPressed, isNotNull);
  if (!staleOwnerAFails) {
    expect(ownerAUpload.isCompleted, isFalse);
  }

  await _invokeElevatedButton(tester, 'Save Coupon Changes');
  await _pumpUntil(tester, () => saveRequests.length == 1);
  await tester.pumpAndSettle();

  final ownerBSave = saveRequests.single;
  expect(ownerBSave.uid, ownerB.uid);
  expect(ownerBSave.documentId, documentB);
  expect(ownerBSave.coupon.id, 'shared-coupon-id');
  expect(ownerBSave.coupon.restaurant, 'B Ordered Restaurant');
  expect(ownerBSave.coupon.title, 'B Ordered Coupon');
  expect(ownerBSave.coupon.distance, 'B ordered distance');
  expect(ownerBSave.coupon.details, 'B Ordered Coupon details');
  expect(ownerBSave.coupon.imageUrl, ownerBUrl);
  final ownerBRequestText = <String?>[
    ownerBSave.uid,
    ownerBSave.documentId,
    ownerBSave.coupon.restaurant,
    ownerBSave.coupon.title,
    ownerBSave.coupon.distance,
    ownerBSave.coupon.details,
    ownerBSave.coupon.imageUrl,
  ].join('|');
  final ownerACanaries = <String>[
    if (!sameUidDocumentSwitch) ownerA.uid,
    documentA,
    'A-ACCOUNT-EMAIL-CANARY@example.test',
    'A-RESTAURANT-NAME-CANARY',
    'A-DISTANCE-CANARY',
    'A-ORDERED-COUPON-CANARY',
    ownerAExistingUrl,
    ownerALateUrl,
  ];
  for (final ownerACanary in ownerACanaries) {
    expect(ownerBRequestText, isNot(contains(ownerACanary)));
    expect(find.textContaining(ownerACanary), findsNothing);
  }
  expect(LocalCouponStore.createdCoupons.value, hasLength(1));
  expect(
    LocalCouponStore.createdCoupons.value.single.title,
    'B Ordered Coupon Saved',
  );
  expect(LocalCouponStore.createdCoupons.value.single.imageUrl, ownerBUrl);
  expect(find.text('Coupon Updated'), findsOneWidget);
  final couponDialog = find.byType(AlertDialog);
  expect(
    find.descendant(
      of: couponDialog,
      matching: find.textContaining('Restaurant: B Ordered Restaurant'),
    ),
    findsOneWidget,
  );
  expect(
    find.descendant(
      of: couponDialog,
      matching: find.textContaining('Email: b-account@example.test'),
    ),
    findsOneWidget,
  );

  await tester.pump(const Duration(seconds: 4));
  await tester.pumpAndSettle();
  expect(find.text('Coupon image saved.'), findsNothing);

  if (!staleOwnerAFails) {
    ownerAUpload.complete(
      BiteSaverCouponImageUploadReceipt(
        retrieveDownloadUrl: () async {
          ownerARetrievalCalls += 1;
          return ownerALateUrl;
        },
      ),
    );
    await tester.pump();
    await tester.pump();
  }

  expect(ownerARetrievalCalls, 0);
  expect(ownerBRetrievalCalls, 1);
  expect(persistenceCalls, hasLength(1));
  expect(saveRequests, hasLength(1));
  expect(LocalCouponStore.createdCoupons.value, hasLength(1));
  expect(
    LocalCouponStore.createdCoupons.value.single.title,
    'B Ordered Coupon Saved',
  );
  expect(LocalCouponStore.createdCoupons.value.single.imageUrl, ownerBUrl);
  expect(_fieldText(tester, 'Coupon Title'), 'B Ordered Coupon');
  expect(_networkImageWithUrl(ownerBUrl), findsWidgets);
  for (final ownerACanary in ownerACanaries) {
    expect(find.textContaining(ownerACanary), findsNothing);
  }
  expect(find.textContaining(ownerAErrorCanary), findsNothing);
  expect(find.text('Coupon image saved.'), findsNothing);
  expect(
    find.text('Could not upload the coupon image right now.'),
    findsNothing,
  );
  expect(
    find.text('This service is temporarily unavailable. Please try again.'),
    findsNothing,
  );
  expect(find.text('Uploading...'), findsNothing);
  expect(tester.widget<ElevatedButton>(saveButton).onPressed, isNotNull);
  expect(find.text('Coupon Updated'), findsOneWidget);
  expect(
    find.descendant(
      of: couponDialog,
      matching: find.textContaining('Restaurant: B Ordered Restaurant'),
    ),
    findsOneWidget,
  );
}

Future<void> _verifyCouponImageTransitionAtServiceBoundary(
  WidgetTester tester, {
  required String pendingBoundary,
  bool signOutBeforeOwnerB = false,
}) async {
  assert(pendingBoundary == 'picker' || pendingBoundary == 'url');
  final ownerA = _TestUser(
    uid: 'coupon-boundary-owner-a',
    email: 'coupon-boundary-a@example.test',
  );
  final ownerB = _TestUser(
    uid: 'coupon-boundary-owner-b',
    email: 'coupon-boundary-b@example.test',
  );
  const documentA = 'coupon-boundary-document-a';
  const documentB = 'coupon-boundary-document-b';
  const ownerAUrl = 'https://images.example/A-BOUNDARY-IMAGE-URL-CANARY.jpg';
  const ownerBUrl = 'https://images.example/b-boundary-image.jpg';
  User? currentUser = ownerA;
  var currentDocumentId = documentA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final pendingPicker = Completer<BiteSaverCouponImageSource?>();
  final pendingUrl = Completer<String>();
  final persistenceCalls = <({String uid, String couponId, String imageUrl})>[];
  var operationCalls = 0;
  var ownerAPickerCalls = 0;
  var ownerAReadCalls = 0;
  var ownerAUploadCalls = 0;
  var ownerAUrlCalls = 0;

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(uid: uid),
    loadCoupons: (uid) async => <Coupon>[
      _ownerCoupon(
        title: currentDocumentId == documentA
            ? 'A-BOUNDARY-COUPON-CANARY'
            : 'B Boundary Coupon',
      ),
    ],
    pickAndUploadCouponImage:
        ({required uid, required couponKey, required isCurrent}) {
          operationCalls += 1;
          final isOwnerAOperation = operationCalls == 1;
          return BiteSaverImageUploadService.pickAndUploadCouponImage(
            uid: uid,
            couponKey: couponKey,
            isCurrent: isCurrent,
            dependencies: BiteSaverCouponImageUploadDependencies(
              pickImage: () {
                if (isOwnerAOperation) {
                  ownerAPickerCalls += 1;
                  if (pendingBoundary == 'picker') {
                    return pendingPicker.future;
                  }
                }
                return Future<BiteSaverCouponImageSource?>.value(
                  BiteSaverCouponImageSource(
                    fileName: isOwnerAOperation ? 'owner-a.jpg' : 'owner-b.jpg',
                    readAsBytes: () async {
                      if (isOwnerAOperation) {
                        ownerAReadCalls += 1;
                      }
                      return Uint8List.fromList(<int>[4, 5, 6]);
                    },
                  ),
                );
              },
              uploadImage:
                  ({
                    required objectPath,
                    required bytes,
                    required contentType,
                  }) async {
                    if (isOwnerAOperation) {
                      ownerAUploadCalls += 1;
                    }
                    return BiteSaverCouponImageUploadReceipt(
                      retrieveDownloadUrl: () {
                        if (isOwnerAOperation) {
                          ownerAUrlCalls += 1;
                          if (pendingBoundary == 'url') {
                            return pendingUrl.future;
                          }
                        }
                        return Future<String>.value(
                          isOwnerAOperation ? ownerAUrl : ownerBUrl,
                        );
                      },
                    );
                  },
            ),
          );
        },
    persistCouponImage:
        ({required uid, required couponId, required imageUrl}) async {
          persistenceCalls.add((
            uid: uid,
            couponId: couponId,
            imageUrl: imageUrl,
          ));
        },
    testCurrentUser: ownerA,
    currentUserProvider: () => currentUser,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => currentDocumentId,
  );
  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('A-BOUNDARY-COUPON-CANARY'),
  );
  await _tapCardAction(
    tester,
    cardText: 'A-BOUNDARY-COUPON-CANARY',
    actionText: 'Edit',
  );
  await _invokeOutlinedButton(tester, 'Add coupon image');
  await _pumpUntil(
    tester,
    () => pendingBoundary == 'picker'
        ? ownerAPickerCalls == 1
        : ownerAUrlCalls == 1,
  );

  if (signOutBeforeOwnerB) {
    currentUser = null;
    userChanges.add(null);
    await tester.pumpAndSettle();
    expect(find.textContaining('A-BOUNDARY-COUPON-CANARY'), findsNothing);
  }
  currentUser = ownerB;
  currentDocumentId = documentB;
  userChanges.add(ownerB);
  await tester.pumpAndSettle();
  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('B Boundary Coupon'),
  );
  await _tapCardAction(
    tester,
    cardText: 'B Boundary Coupon',
    actionText: 'Edit',
  );
  await _invokeOutlinedButton(tester, 'Add coupon image');
  await _pumpUntil(tester, () => persistenceCalls.length == 1);

  if (pendingBoundary == 'picker') {
    pendingPicker.complete(
      BiteSaverCouponImageSource(
        fileName: 'late-owner-a.jpg',
        readAsBytes: () async {
          ownerAReadCalls += 1;
          return Uint8List.fromList(<int>[7, 8, 9]);
        },
      ),
    );
  } else {
    pendingUrl.complete(ownerAUrl);
  }
  await tester.pump();
  await tester.pump();

  expect(operationCalls, 2);
  expect(persistenceCalls, hasLength(1));
  expect(persistenceCalls.single.uid, ownerB.uid);
  expect(persistenceCalls.single.imageUrl, ownerBUrl);
  expect(ownerAReadCalls, pendingBoundary == 'picker' ? 0 : 1);
  expect(ownerAUploadCalls, pendingBoundary == 'picker' ? 0 : 1);
  expect(ownerAUrlCalls, pendingBoundary == 'picker' ? 0 : 1);
  expect(_networkImageWithUrl(ownerBUrl), findsOneWidget);
  expect(_networkImageWithUrl(ownerAUrl), findsNothing);
  expect(find.textContaining('A-BOUNDARY-IMAGE-URL-CANARY'), findsNothing);
}

Future<void> _verifyNewerSameOwnerCouponImageSelection(
  WidgetTester tester,
) async {
  final owner = _TestUser(
    uid: 'same-owner-newer-image',
    email: 'same-owner-newer-image@example.test',
  );
  const staleUrl = 'https://images.example/A-OLDER-SELECTION-CANARY.jpg';
  const currentUrl = 'https://images.example/current-newer-selection.jpg';
  final staleUpload = Completer<BiteSaverCouponImageUploadReceipt>();
  final persistenceCalls = <({String uid, String couponId, String imageUrl})>[];
  final saveRequests = <Coupon>[];
  var operationCalls = 0;
  var staleRetrievalCalls = 0;

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(uid: uid),
    loadCoupons: (uid) async => <Coupon>[
      _ownerCoupon(title: 'Older Coupon Draft', id: 'older-coupon-id'),
      _ownerCoupon(title: 'Newer Coupon Draft', id: 'newer-coupon-id'),
    ],
    updateCoupon: ({required uid, required coupon}) async {
      saveRequests.add(coupon);
      return coupon;
    },
    pickAndUploadCouponImage:
        ({required uid, required couponKey, required isCurrent}) {
          operationCalls += 1;
          final isOlderOperation = operationCalls == 1;
          return BiteSaverImageUploadService.pickAndUploadCouponImage(
            uid: uid,
            couponKey: couponKey,
            isCurrent: isCurrent,
            dependencies: BiteSaverCouponImageUploadDependencies(
              pickImage: () async => BiteSaverCouponImageSource(
                fileName: isOlderOperation ? 'older.jpg' : 'newer.jpg',
                readAsBytes: () async => Uint8List.fromList(<int>[10, 11, 12]),
              ),
              uploadImage:
                  ({
                    required objectPath,
                    required bytes,
                    required contentType,
                  }) {
                    if (isOlderOperation) {
                      return staleUpload.future;
                    }
                    return Future<BiteSaverCouponImageUploadReceipt>.value(
                      BiteSaverCouponImageUploadReceipt(
                        retrieveDownloadUrl: () async => currentUrl,
                      ),
                    );
                  },
            ),
          );
        },
    persistCouponImage:
        ({required uid, required couponId, required imageUrl}) async {
          persistenceCalls.add((
            uid: uid,
            couponId: couponId,
            imageUrl: imageUrl,
          ));
        },
    testCurrentUser: owner,
    currentUserProvider: () => owner,
  );
  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('Older Coupon Draft'),
  );
  await _tapCardAction(
    tester,
    cardText: 'Older Coupon Draft',
    actionText: 'Edit',
  );
  await _invokeOutlinedButton(tester, 'Add coupon image');
  await _pumpUntil(tester, () => operationCalls == 1);

  await _tapCardAction(
    tester,
    cardText: 'Newer Coupon Draft',
    actionText: 'Edit',
  );
  expect(
    tester
        .widget<OutlinedButton>(
          find.widgetWithText(OutlinedButton, 'Add coupon image'),
        )
        .onPressed,
    isNotNull,
  );
  await _invokeOutlinedButton(tester, 'Add coupon image');
  await _pumpUntil(tester, () => persistenceCalls.length == 1);
  expect(persistenceCalls.single.couponId, 'newer-coupon-id');
  expect(persistenceCalls.single.imageUrl, currentUrl);

  staleUpload.complete(
    BiteSaverCouponImageUploadReceipt(
      retrieveDownloadUrl: () async {
        staleRetrievalCalls += 1;
        return staleUrl;
      },
    ),
  );
  await tester.pump();
  await tester.pump();

  expect(staleRetrievalCalls, 0);
  expect(persistenceCalls, hasLength(1));
  expect(_fieldText(tester, 'Coupon Title'), 'Newer Coupon Draft');
  expect(find.textContaining('A-OLDER-SELECTION-CANARY'), findsNothing);
  await _invokeElevatedButton(tester, 'Save Coupon Changes');
  await _pumpUntil(tester, () => saveRequests.length == 1);
  expect(saveRequests.single.id, 'newer-coupon-id');
  expect(saveRequests.single.imageUrl, currentUrl);
}

Future<void> _verifyCurrentCouponImageCancellation(WidgetTester tester) async {
  final owner = _TestUser(
    uid: 'coupon-image-cancel-owner',
    email: 'coupon-image-cancel@example.test',
  );
  const existingUrl = 'https://images.example/existing-coupon-image.jpg';
  final pickerResult = Completer<BiteSaverCouponImageSource?>();
  final persistenceCalls = <String>[];
  var pickerCalls = 0;
  var uploadCalls = 0;

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(uid: uid),
    loadCoupons: (uid) async => <Coupon>[
      _ownerCoupon(title: 'Cancellation Coupon', imageUrl: existingUrl),
    ],
    pickAndUploadCouponImage:
        ({required uid, required couponKey, required isCurrent}) =>
            BiteSaverImageUploadService.pickAndUploadCouponImage(
              uid: uid,
              couponKey: couponKey,
              isCurrent: isCurrent,
              dependencies: BiteSaverCouponImageUploadDependencies(
                pickImage: () {
                  pickerCalls += 1;
                  return pickerResult.future;
                },
                uploadImage:
                    ({
                      required objectPath,
                      required bytes,
                      required contentType,
                    }) async {
                      uploadCalls += 1;
                      throw StateError('upload must not start after cancel');
                    },
              ),
            ),
    persistCouponImage:
        ({required uid, required couponId, required imageUrl}) async {
          persistenceCalls.add(imageUrl);
        },
    testCurrentUser: owner,
    currentUserProvider: () => owner,
  );
  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('Cancellation Coupon'),
  );
  await _tapCardAction(
    tester,
    cardText: 'Cancellation Coupon',
    actionText: 'Edit',
  );
  final startImage = tester
      .widget<OutlinedButton>(
        find.widgetWithText(OutlinedButton, 'Change coupon image'),
      )
      .onPressed!;
  startImage();
  startImage();
  await tester.pump();
  await _pumpUntil(tester, () => pickerCalls == 1);
  expect(
    tester
        .widget<ElevatedButton>(
          find.widgetWithText(ElevatedButton, 'Save Coupon Changes'),
        )
        .onPressed,
    isNull,
  );

  pickerResult.complete(null);
  await tester.pumpAndSettle();

  expect(pickerCalls, 1);
  expect(uploadCalls, 0);
  expect(persistenceCalls, isEmpty);
  expect(find.byType(SnackBar), findsNothing);
  expect(_networkImageWithUrl(existingUrl), findsWidgets);
  expect(
    tester
        .widget<ElevatedButton>(
          find.widgetWithText(ElevatedButton, 'Save Coupon Changes'),
        )
        .onPressed,
    isNotNull,
  );
}

Future<void> _verifyCurrentCouponImageFailureAndRetry(
  WidgetTester tester,
) async {
  final owner = _TestUser(
    uid: 'coupon-image-retry-owner',
    email: 'coupon-image-retry@example.test',
  );
  const retryUrl = 'https://images.example/coupon-image-retry.jpg';
  final persistenceCalls = <String>[];
  var operationCalls = 0;

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(uid: uid),
    loadCoupons: (uid) async => <Coupon>[_ownerCoupon(title: 'Retry Coupon')],
    pickAndUploadCouponImage:
        ({required uid, required couponKey, required isCurrent}) {
          operationCalls += 1;
          final shouldFail = operationCalls == 1;
          return BiteSaverImageUploadService.pickAndUploadCouponImage(
            uid: uid,
            couponKey: couponKey,
            isCurrent: isCurrent,
            dependencies: BiteSaverCouponImageUploadDependencies(
              pickImage: () async => BiteSaverCouponImageSource(
                fileName: 'retry.jpg',
                readAsBytes: () async => Uint8List.fromList(<int>[13, 14, 15]),
              ),
              uploadImage:
                  ({
                    required objectPath,
                    required bytes,
                    required contentType,
                  }) async {
                    if (shouldFail) {
                      throw StateError(
                        'package:RAW-COUPON-IMAGE-FAILURE-CANARY',
                      );
                    }
                    return BiteSaverCouponImageUploadReceipt(
                      retrieveDownloadUrl: () async => retryUrl,
                    );
                  },
            ),
          );
        },
    persistCouponImage:
        ({required uid, required couponId, required imageUrl}) async {
          persistenceCalls.add(imageUrl);
        },
    testCurrentUser: owner,
    currentUserProvider: () => owner,
  );
  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('Retry Coupon'),
  );
  await _tapCardAction(tester, cardText: 'Retry Coupon', actionText: 'Edit');
  await _invokeOutlinedButton(tester, 'Add coupon image');
  await tester.pumpAndSettle();

  expect(operationCalls, 1);
  expect(
    find.text('Could not upload the coupon image right now.'),
    findsOneWidget,
  );
  expect(find.textContaining('RAW-COUPON-IMAGE-FAILURE-CANARY'), findsNothing);
  expect(
    tester
        .widget<ElevatedButton>(
          find.widgetWithText(ElevatedButton, 'Save Coupon Changes'),
        )
        .onPressed,
    isNotNull,
  );

  await _invokeOutlinedButton(tester, 'Add coupon image');
  await tester.pumpAndSettle();
  expect(operationCalls, 2);
  expect(persistenceCalls, <String>[retryUrl]);
  expect(find.text('Coupon image saved.'), findsOneWidget);
  expect(_networkImageWithUrl(retryUrl), findsOneWidget);
}

Future<void> _verifyCurrentCouponImageFriendlyFailureAndRetry(
  WidgetTester tester,
) async {
  final owner = _TestUser(
    uid: 'coupon-image-friendly-error-owner',
    email: 'coupon-image-friendly-error@example.test',
  );
  const existingUrl =
      'https://images.example/existing-friendly-error-image.jpg';
  const retryUrl =
      'https://images.example/coupon-image-friendly-error-retry.jpg';
  const rawProviderCanary =
      'CURRENT-OWNER-RAW-PROVIDER-CANARY storage/provider/path';
  final persistenceCalls = <String>[];
  var operationCalls = 0;

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(uid: uid),
    loadCoupons: (uid) async => <Coupon>[
      _ownerCoupon(title: 'Friendly Error Retry Coupon', imageUrl: existingUrl),
    ],
    pickAndUploadCouponImage:
        ({required uid, required couponKey, required isCurrent}) {
          operationCalls += 1;
          final shouldFail = operationCalls == 1;
          return BiteSaverImageUploadService.pickAndUploadCouponImage(
            uid: uid,
            couponKey: couponKey,
            isCurrent: isCurrent,
            dependencies: BiteSaverCouponImageUploadDependencies(
              pickImage: () async => BiteSaverCouponImageSource(
                fileName: 'friendly-retry.jpg',
                readAsBytes: () async => Uint8List.fromList(<int>[41, 42, 43]),
              ),
              uploadImage:
                  ({
                    required objectPath,
                    required bytes,
                    required contentType,
                  }) async {
                    if (shouldFail) {
                      throw FirebaseException(
                        plugin: 'firebase_storage',
                        code: 'unavailable',
                        message: rawProviderCanary,
                      );
                    }
                    return BiteSaverCouponImageUploadReceipt(
                      retrieveDownloadUrl: () async => retryUrl,
                    );
                  },
            ),
          );
        },
    persistCouponImage:
        ({required uid, required couponId, required imageUrl}) async {
          persistenceCalls.add(imageUrl);
        },
    testCurrentUser: owner,
    currentUserProvider: () => owner,
  );
  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('Friendly Error Retry Coupon'),
  );
  await _tapCardAction(
    tester,
    cardText: 'Friendly Error Retry Coupon',
    actionText: 'Edit',
  );
  await _invokeOutlinedButton(tester, 'Change coupon image');
  await tester.pumpAndSettle();

  expect(operationCalls, 1);
  expect(
    find.text('This service is temporarily unavailable. Please try again.'),
    findsOneWidget,
  );
  expect(
    find.text('Could not upload the coupon image right now.'),
    findsNothing,
  );
  expect(find.textContaining(rawProviderCanary), findsNothing);
  expect(find.textContaining('firebase_storage'), findsNothing);
  expect(find.textContaining('FirebaseException'), findsNothing);
  expect(find.text('Uploading...'), findsNothing);
  expect(_fieldText(tester, 'Coupon Title'), 'Friendly Error Retry Coupon');
  expect(_networkImageWithUrl(existingUrl), findsWidgets);
  expect(persistenceCalls, isEmpty);
  final retryButton = find.widgetWithText(
    OutlinedButton,
    'Change coupon image',
  );
  expect(tester.widget<OutlinedButton>(retryButton).onPressed, isNotNull);
  expect(
    tester
        .widget<ElevatedButton>(
          find.widgetWithText(ElevatedButton, 'Save Coupon Changes'),
        )
        .onPressed,
    isNotNull,
  );

  await _invokeOutlinedButton(tester, 'Change coupon image');
  await tester.pumpAndSettle();

  expect(operationCalls, 2);
  expect(persistenceCalls, <String>[retryUrl]);
  expect(find.text('Coupon image saved.'), findsOneWidget);
  expect(_networkImageWithUrl(retryUrl), findsOneWidget);
  expect(_networkImageWithUrl(existingUrl), findsWidgets);
}

Future<void> _verifyCouponAndDailyDraftTransitionReset(
  WidgetTester tester,
) async {
  final owner = _TestUser(
    uid: 'shared-draft-reset-owner',
    email: 'draft-reset@example.test',
  );
  const documentA = 'draft-reset-document-a';
  const documentB = 'draft-reset-document-b';
  var currentDocumentId = documentA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final now = DateTime.now();
  final ownerACoupon = Coupon(
    id: 'draft-reset-coupon',
    restaurant: 'A-DRAFT-RESTAURANT-CANARY',
    title: 'A-DRAFT-COUPON-CANARY',
    distance: 'A-DRAFT-DISTANCE-CANARY',
    startTime: now.subtract(const Duration(hours: 2)),
    endTime: now.add(const Duration(days: 3)),
    usageRule: 'Once per day',
    couponCode: 'A-DRAFT-CODE-CANARY',
    isProximityOnly: true,
    proximityRadiusMiles: 7,
    details: 'A-DRAFT-DETAILS-CANARY',
    imageUrl: 'https://images.example/A-DRAFT-IMAGE-CANARY.jpg',
  );
  final ownerASpecial = DailySpecial(
    id: 'draft-reset-special',
    restaurantId: owner.uid,
    ownerUid: owner.uid,
    title: 'A-DAILY-DRAFT-CANARY',
    details: 'A-DAILY-DETAILS-CANARY',
    availabilityMode: DailySpecialAvailabilityMode.specificDays,
    daysOfWeek: const <int>[DateTime.monday, DateTime.wednesday],
    allDay: false,
    startTime: '09:15',
    endTime: '14:45',
    hideWhenUnavailable: false,
  );

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(uid: uid),
    loadCoupons: (uid) async => currentDocumentId == documentA
        ? <Coupon>[ownerACoupon]
        : const <Coupon>[],
    loadDailySpecials: (uid) async => currentDocumentId == documentA
        ? <DailySpecial>[ownerASpecial]
        : const <DailySpecial>[],
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => currentDocumentId,
  );
  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: find.text('A-DRAFT-COUPON-CANARY'),
  );
  await _tapCardAction(
    tester,
    cardText: 'A-DRAFT-COUPON-CANARY',
    actionText: 'Edit',
  );
  await _ensureSectionExpanded(
    tester,
    'Daily Specials',
    visibleWhenExpanded: find.text('A-DAILY-DRAFT-CANARY'),
  );
  await _tapCardAction(
    tester,
    cardText: 'A-DAILY-DRAFT-CANARY',
    actionText: 'Edit',
  );
  expect(_fieldText(tester, 'Coupon Title'), 'A-DRAFT-COUPON-CANARY');
  expect(_fieldText(tester, 'Title'), 'A-DAILY-DRAFT-CANARY');

  currentDocumentId = documentB;
  userChanges.add(owner);
  await tester.pumpAndSettle();

  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: _fieldWithLabel('Coupon Title'),
  );
  expect(_fieldText(tester, 'Coupon Title'), isEmpty);
  expect(_fieldText(tester, 'Coupon Description (Optional)'), isEmpty);
  expect(_fieldText(tester, 'Optional Coupon Code'), isEmpty);
  expect(find.text('Create a New Coupon'), findsOneWidget);
  expect(
    find.widgetWithText(OutlinedButton, 'Add coupon image'),
    findsOneWidget,
  );
  expect(find.text('Select expiration date'), findsWidgets);
  expect(find.text('Unlimited'), findsWidgets);
  expect(find.text('Normal coupon'), findsWidgets);

  await _ensureSectionExpanded(
    tester,
    'Daily Specials',
    visibleWhenExpanded: _fieldWithLabel('Title'),
  );
  expect(_fieldText(tester, 'Title'), isEmpty);
  expect(_fieldText(tester, 'Details (Optional)'), isEmpty);
  expect(find.widgetWithText(OutlinedButton, 'Clear Form'), findsOneWidget);
  expect(_fieldWithLabel('Start time'), findsNothing);
  for (final canary in <String>[
    'A-DRAFT-RESTAURANT-CANARY',
    'A-DRAFT-COUPON-CANARY',
    'A-DRAFT-DISTANCE-CANARY',
    'A-DRAFT-CODE-CANARY',
    'A-DRAFT-DETAILS-CANARY',
    'A-DRAFT-IMAGE-CANARY',
    'A-DAILY-DRAFT-CANARY',
    'A-DAILY-DETAILS-CANARY',
  ]) {
    expect(find.textContaining(canary), findsNothing, reason: canary);
  }
}

Future<void> _verifyPendingDailySpecialPickerIsOwnerScoped(
  WidgetTester tester,
) async {
  final owner = _TestUser(
    uid: 'shared-daily-picker-owner',
    email: 'daily-picker@example.test',
  );
  const documentA = 'daily-picker-document-a';
  const documentB = 'daily-picker-document-b';
  var currentDocumentId = documentA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final pendingOwnerATime = Completer<TimeOfDay?>();
  var pickerCalls = 0;

  DailySpecial specialFor({required String title, required String startTime}) {
    return DailySpecial(
      id: 'shared-daily-picker-id',
      restaurantId: owner.uid,
      ownerUid: owner.uid,
      title: title,
      allDay: false,
      startTime: startTime,
      endTime: '16:45',
    );
  }

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(uid: uid),
    loadDailySpecials: (uid) async => <DailySpecial>[
      currentDocumentId == documentA
          ? specialFor(title: 'A-DAILY-PICKER-CANARY', startTime: '03:15')
          : specialFor(title: 'B Daily Picker', startTime: '11:15'),
    ],
    pickDailySpecialTime: ({required initialTime}) {
      pickerCalls += 1;
      return pendingOwnerATime.future;
    },
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => currentDocumentId,
  );
  await _ensureSectionExpanded(
    tester,
    'Daily Specials',
    visibleWhenExpanded: find.text('A-DAILY-PICKER-CANARY'),
  );
  await _tapCardAction(
    tester,
    cardText: 'A-DAILY-PICKER-CANARY',
    actionText: 'Edit',
  );
  await _invokeCouponDateTimeField(tester, 'Start time');
  await _pumpUntil(tester, () => pickerCalls == 1);

  currentDocumentId = documentB;
  userChanges.add(owner);
  await tester.pumpAndSettle();
  await _ensureSectionExpanded(
    tester,
    'Daily Specials',
    visibleWhenExpanded: find.text('B Daily Picker'),
  );
  await _tapCardAction(tester, cardText: 'B Daily Picker', actionText: 'Edit');
  expect(find.text('11:15 AM'), findsOneWidget);

  pendingOwnerATime.complete(const TimeOfDay(hour: 4, minute: 20));
  await tester.pump();
  await tester.pump();
  expect(find.text('11:15 AM'), findsOneWidget);
  expect(find.text('4:20 AM'), findsNothing);
  expect(_fieldText(tester, 'Title'), 'B Daily Picker');
}

Future<void> _verifyPendingDailySpecialSaveIsOwnerScoped(
  WidgetTester tester,
) async {
  final owner = _TestUser(
    uid: 'shared-daily-save-owner',
    email: 'daily-save@example.test',
  );
  const documentA = 'daily-save-document-a';
  const documentB = 'daily-save-document-b';
  var currentDocumentId = documentA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final ownerASave = Completer<void>();
  final ownerBSave = Completer<void>();
  final saveRequests = <DailySpecial>[];
  var ownerBSaved = false;
  var specialLoads = 0;

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(
      uid: uid,
      restaurantName: currentDocumentId == documentA
          ? 'A Daily Save Restaurant'
          : 'B Daily Save Restaurant',
    ),
    loadDailySpecials: (uid) async {
      specialLoads += 1;
      if (currentDocumentId == documentB && ownerBSaved) {
        return <DailySpecial>[
          _ownerDailySpecial(uid: uid, title: 'B Daily Saved'),
        ];
      }
      return const <DailySpecial>[];
    },
    createDailySpecial: ({required uid, required dailySpecial}) {
      saveRequests.add(dailySpecial);
      return saveRequests.length == 1 ? ownerASave.future : ownerBSave.future;
    },
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => currentDocumentId,
  );
  await _startDailySpecialSave(tester, title: 'A-DAILY-SAVE-CANARY');
  await _pumpUntil(tester, () => saveRequests.length == 1);

  currentDocumentId = documentB;
  userChanges.add(owner);
  await tester.pumpAndSettle();
  expect(_fieldText(tester, 'Title'), isEmpty);
  await _startDailySpecialSave(tester, title: 'B Daily Pending');
  await _pumpUntil(tester, () => saveRequests.length == 2);
  expect(ownerASave.isCompleted, isFalse);
  expect(ownerBSave.isCompleted, isFalse);

  ownerASave.completeError(StateError('A-DAILY-SAVE-ERROR-CANARY'));
  await tester.pump();
  await tester.pump();
  expect(find.widgetWithText(ElevatedButton, 'Saving...'), findsOneWidget);
  expect(_fieldText(tester, 'Title'), 'B Daily Pending');
  expect(find.textContaining('A-DAILY-SAVE-ERROR-CANARY'), findsNothing);
  expect(specialLoads, 2);

  ownerBSaved = true;
  ownerBSave.complete();
  await tester.pumpAndSettle();
  expect(specialLoads, 3);
  expect(find.text('B Daily Saved'), findsOneWidget);
  expect(_fieldText(tester, 'Title'), isEmpty);
  expect(find.text('Daily special created.'), findsOneWidget);
  expect(saveRequests[0].title, 'A-DAILY-SAVE-CANARY');
  expect(saveRequests[1].title, 'B Daily Pending');
}

Future<void> _verifyPendingDailySpecialDeleteIsOwnerScoped(
  WidgetTester tester,
) async {
  final owner = _TestUser(
    uid: 'shared-daily-delete-owner',
    email: 'daily-delete@example.test',
  );
  const documentA = 'daily-delete-document-a';
  const documentB = 'daily-delete-document-b';
  var currentDocumentId = documentA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final ownerADelete = Completer<void>();
  final ownerBDelete = Completer<void>();
  var deleteCalls = 0;
  var ownerBDeleted = false;

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(uid: uid),
    loadDailySpecials: (uid) async {
      if (currentDocumentId == documentB && ownerBDeleted) {
        return const <DailySpecial>[];
      }
      return <DailySpecial>[
        _ownerDailySpecial(
          uid: uid,
          title: currentDocumentId == documentA
              ? 'A-DAILY-DELETE-CANARY'
              : 'B Daily Must Remain',
        ),
      ];
    },
    deleteDailySpecial: ({required uid, required dailySpecialId}) {
      deleteCalls += 1;
      return deleteCalls == 1 ? ownerADelete.future : ownerBDelete.future;
    },
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => currentDocumentId,
  );
  await _ensureSectionExpanded(
    tester,
    'Daily Specials',
    visibleWhenExpanded: find.text('A-DAILY-DELETE-CANARY'),
  );
  await _tapCardAction(
    tester,
    cardText: 'A-DAILY-DELETE-CANARY',
    actionText: 'Delete',
  );
  await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
  await tester.pump();
  await _pumpUntil(tester, () => deleteCalls == 1);

  currentDocumentId = documentB;
  userChanges.add(owner);
  await tester.pumpAndSettle();
  await _ensureSectionExpanded(
    tester,
    'Daily Specials',
    visibleWhenExpanded: find.text('B Daily Must Remain'),
  );
  await _tapCardAction(
    tester,
    cardText: 'B Daily Must Remain',
    actionText: 'Delete',
  );
  await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
  await tester.pump();
  await _pumpUntil(tester, () => deleteCalls == 2);

  ownerADelete.complete();
  await tester.pump();
  await tester.pump();
  expect(find.text('B Daily Must Remain'), findsOneWidget);
  expect(find.text('Daily special removed.'), findsNothing);
  final bDelete = find.descendant(
    of: _cardContaining('B Daily Must Remain'),
    matching: find.widgetWithText(TextButton, 'Delete'),
  );
  expect(tester.widget<TextButton>(bDelete).onPressed, isNull);

  ownerBDeleted = true;
  ownerBDelete.complete();
  await tester.pumpAndSettle();
  expect(find.text('B Daily Must Remain'), findsNothing);
  expect(find.text('Daily special removed.'), findsOneWidget);
}

Future<void> _verifyPendingCheckoutPreparationIsOwnerScoped(
  WidgetTester tester, {
  bool useCustomerPortal = false,
}) async {
  final callableName = useCustomerPortal
      ? 'createCustomerPortalSession'
      : 'createCheckoutSession';
  final ownerAUrl = useCustomerPortal
      ? 'https://billing.stripe.com/p/session/owner-a-stale-preparation'
      : 'https://checkout.stripe.com/c/pay/owner-a-stale-preparation';
  final ownerBUrl = useCustomerPortal
      ? 'https://billing.stripe.com/p/session/owner-b-preparation'
      : 'https://checkout.stripe.com/c/pay/owner-b-preparation';
  final owner = _TestUser(
    uid: 'pending-checkout-preparation-owner',
    email: 'pending-checkout-preparation@example.test',
  );
  const documentA = 'pending-checkout-preparation-a';
  const documentB = 'pending-checkout-preparation-b';
  final tokenA = _testReturnToken(21);
  final tokenB = _testReturnToken(22);
  var currentDocumentId = documentA;
  var preparationCalls = 0;
  final ownerAPreparation = Completer<Map<String, Object?>>();
  final launchedUrls = <Uri>[];
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final checkoutService = SubscriptionCheckoutService(
    invokeCallable: (name, payload) {
      expect(name, callableName);
      expect(payload, <String, Object?>{
        'returnProtocolVersion': 2,
        'restaurantAccountDocumentId': currentDocumentId,
      });
      preparationCalls += 1;
      if (preparationCalls == 1) {
        return ownerAPreparation.future;
      }
      return Future<Map<String, Object?>>.value(<String, Object?>{
        'url': ownerBUrl,
        'returnToken': tokenB,
        'returnProtocolVersion': 2,
      });
    },
    launchExternalUrl: (url) async {
      launchedUrls.add(url);
      return true;
    },
  );

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(
      uid: uid,
      restaurantName: currentDocumentId == documentA
          ? 'A Pending Preparation Restaurant'
          : 'B Current Preparation Restaurant',
      subscriptionStatus: useCustomerPortal ? 'active' : 'inactive',
    ),
    subscriptionCheckoutService: checkoutService,
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => currentDocumentId,
  );
  await _ensureSubscriptionActionVisible(
    tester,
    useCustomerPortal: useCustomerPortal,
  );
  await _invokeSubscriptionAction(tester, useCustomerPortal: useCustomerPortal);
  expect(preparationCalls, 1);
  expect(launchedUrls, isEmpty);

  currentDocumentId = documentB;
  userChanges.add(owner);
  await tester.pumpAndSettle();
  await _ensureSubscriptionActionVisible(
    tester,
    useCustomerPortal: useCustomerPortal,
  );
  await _invokeSubscriptionAction(tester, useCustomerPortal: useCustomerPortal);
  await _pumpUntilWithRealAsync(tester, () => launchedUrls.length == 1);

  expect(launchedUrls.single, Uri.parse(ownerBUrl));

  ownerAPreparation.complete(<String, Object?>{
    'url': ownerAUrl,
    'returnToken': tokenA,
    'returnProtocolVersion': 2,
  });
  await tester.pumpAndSettle();

  expect(launchedUrls, hasLength(1));
  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.pendingLocalDeliveryCount,
    ),
    0,
  );
  expect(find.text('Something went wrong'), findsNothing);
  if (useCustomerPortal) {
    expect(
      find.widgetWithText(OutlinedButton, 'Manage Subscription'),
      findsOneWidget,
    );
  } else {
    expect(
      find.widgetWithText(FilledButton, 'Start Subscription'),
      findsOneWidget,
    );
  }
}

Future<void> _verifyCheckoutScopeChangeBeforeLaunch(
  WidgetTester tester, {
  bool useCustomerPortal = false,
}) async {
  final callableName = useCustomerPortal
      ? 'createCustomerPortalSession'
      : 'createCheckoutSession';
  final ownerAUrl = useCustomerPortal
      ? 'https://billing.stripe.com/p/session/owner-a-before-launch'
      : 'https://checkout.stripe.com/c/pay/owner-a-before-launch';
  final ownerBUrl = useCustomerPortal
      ? 'https://billing.stripe.com/p/session/owner-b-before-launch'
      : 'https://checkout.stripe.com/c/pay/owner-b-before-launch';
  final owner = _TestUser(
    uid: 'before-launch-owner',
    email: 'before-launch-owner@example.test',
  );
  const documentA = 'before-launch-document-a';
  const documentB = 'before-launch-document-b';
  final tokenA = _testReturnToken(23);
  final tokenB = _testReturnToken(24);
  var currentDocumentId = documentA;
  var preparationCalls = 0;
  var beforeLaunchCalls = 0;
  final launchedUrls = <Uri>[];
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final checkoutService = _BeforeLaunchHookSubscriptionCheckoutService(
    invokeCallable: (name, payload) async {
      expect(name, callableName);
      expect(payload, <String, Object?>{
        'returnProtocolVersion': 2,
        'restaurantAccountDocumentId': currentDocumentId,
      });
      preparationCalls += 1;
      final isOwnerA = preparationCalls == 1;
      return <String, Object?>{
        'url': isOwnerA ? ownerAUrl : ownerBUrl,
        'returnToken': isOwnerA ? tokenA : tokenB,
        'returnProtocolVersion': 2,
      };
    },
    launchExternalUrl: (url) async {
      launchedUrls.add(url);
      return true;
    },
    beforeLaunch: (prepared) {
      beforeLaunchCalls += 1;
      if (prepared.returnToken == tokenA) {
        currentDocumentId = documentB;
        userChanges.add(owner);
      }
    },
  );

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(
      uid: uid,
      restaurantName: currentDocumentId == documentA
          ? 'A Post Registration Restaurant'
          : 'B Post Registration Restaurant',
      subscriptionStatus: useCustomerPortal ? 'active' : 'inactive',
    ),
    subscriptionCheckoutService: checkoutService,
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => currentDocumentId,
  );
  await _ensureSubscriptionActionVisible(
    tester,
    useCustomerPortal: useCustomerPortal,
  );
  await _invokeSubscriptionAction(tester, useCustomerPortal: useCustomerPortal);
  await _pumpUntilWithRealAsync(tester, () => beforeLaunchCalls == 1);

  expect(launchedUrls, isEmpty);
  await tester.pumpAndSettle();
  expect(find.text('Something went wrong'), findsNothing);

  await _ensureSubscriptionActionVisible(
    tester,
    useCustomerPortal: useCustomerPortal,
  );
  await _invokeSubscriptionAction(tester, useCustomerPortal: useCustomerPortal);
  await _pumpUntilWithRealAsync(tester, () => launchedUrls.length == 1);
  expect(beforeLaunchCalls, 2);
  expect(launchedUrls.single, Uri.parse(ownerBUrl));
  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.pendingLocalDeliveryCount,
    ),
    0,
  );
}

Future<void> _verifyFailedLaunchPreservesServerReturnContext(
  WidgetTester tester, {
  bool useCustomerPortal = false,
}) async {
  final callableName = useCustomerPortal
      ? 'createCustomerPortalSession'
      : 'createCheckoutSession';
  final failingUrl = useCustomerPortal
      ? 'https://billing.stripe.com/p/session/failing-launch'
      : 'https://checkout.stripe.com/c/pay/failing-launch';
  final family = useCustomerPortal
      ? SubscriptionReturnFamily.customerPortal
      : SubscriptionReturnFamily.checkout;
  final owner = _TestUser(
    uid: 'checkout-launch-failure-owner',
    email: 'checkout-launch-failure@example.test',
  );
  final token = _testReturnToken(25);
  const accountDocumentId = 'checkout-launch-failure-document';
  final ownerScope = SubscriptionReturnOwnerScope(
    uid: owner.uid,
    accountDocumentId: accountDocumentId,
  );
  Uri? launchedUrl;
  final checkoutService = SubscriptionCheckoutService(
    invokeCallable: (name, payload) async {
      expect(name, callableName);
      expect(payload, <String, Object?>{
        'returnProtocolVersion': 2,
        'restaurantAccountDocumentId': accountDocumentId,
      });
      _subscriptionReturnBackend.reserve(
        returnToken: token,
        ownerScope: ownerScope,
        family: family,
      );
      return <String, Object?>{
        'url': failingUrl,
        'returnToken': token,
        'returnProtocolVersion': 2,
      };
    },
    launchExternalUrl: (url) async {
      launchedUrl = url;
      return false;
    },
  );

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(
      uid: uid,
      subscriptionStatus: useCustomerPortal ? 'active' : 'inactive',
    ),
    subscriptionCheckoutService: checkoutService,
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    accountDocumentIdForUid: (uid) => accountDocumentId,
  );
  await _ensureSubscriptionActionVisible(
    tester,
    useCustomerPortal: useCustomerPortal,
  );
  await _invokeSubscriptionAction(tester, useCustomerPortal: useCustomerPortal);
  await _pumpUntilWithRealAsync(
    tester,
    () => find.text('Something went wrong').evaluate().isNotEmpty,
  );

  expect(launchedUrl, Uri.parse(failingUrl));
  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.pendingLocalDeliveryCount,
    ),
    0,
  );
  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.ingestReturnLink(
        subscriptionReturnUri(
          kind: useCustomerPortal
              ? SubscriptionReturnKind.customerPortal
              : SubscriptionReturnKind.checkoutCancel,
          returnToken: token,
        ),
      ),
    ),
    isTrue,
  );
  final navigation = await _awaitSubscriptionReturnOperation(
    tester,
    SubscriptionReturnService.peekPendingNavigationFor(ownerScope),
  );
  expect(navigation, isNotNull);
  if (useCustomerPortal) {
    expect(
      find.widgetWithText(OutlinedButton, 'Manage Subscription'),
      findsOneWidget,
    );
  } else {
    expect(
      find.widgetWithText(FilledButton, 'Start Subscription'),
      findsOneWidget,
    );
  }
}

Future<void> _verifySuccessfulPortalLaunchUsesPreparedSession(
  WidgetTester tester,
) async {
  final owner = _TestUser(
    uid: 'successful-portal-owner',
    email: 'successful-portal@example.test',
  );
  final token = _testReturnToken(26);
  const accountDocumentId = 'successful-portal-document';
  Uri? launchedUrl;
  final portalService = SubscriptionCheckoutService(
    invokeCallable: (name, payload) async {
      expect(name, 'createCustomerPortalSession');
      expect(payload, <String, Object?>{
        'returnProtocolVersion': 2,
        'restaurantAccountDocumentId': accountDocumentId,
      });
      return <String, Object?>{
        'url': 'https://billing.stripe.com/p/session/successful-launch',
        'returnToken': token,
        'returnProtocolVersion': 2,
      };
    },
    launchExternalUrl: (url) async {
      launchedUrl = url;
      return true;
    },
  );

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(uid: uid),
    subscriptionCheckoutService: portalService,
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    accountDocumentIdForUid: (uid) => accountDocumentId,
  );
  await _ensureSectionExpanded(
    tester,
    'Subscription / Billing',
    visibleWhenExpanded: find.widgetWithText(
      OutlinedButton,
      'Manage Subscription',
    ),
  );
  await _invokeOutlinedButton(tester, 'Manage Subscription');
  await _pumpUntilWithRealAsync(tester, () => launchedUrl != null);
  expect(
    launchedUrl,
    Uri.parse('https://billing.stripe.com/p/session/successful-launch'),
  );
  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.pendingLocalDeliveryCount,
    ),
    0,
  );
  expect(find.text('Something went wrong'), findsNothing);
}

Future<void> _verifyFragmentBearingCheckoutLaunchUsesExactUrl(
  WidgetTester tester,
) async {
  final owner = _TestUser(
    uid: 'fragment-checkout-owner',
    email: 'fragment-checkout@example.test',
  );
  const accountDocumentId = 'fragment-checkout-document';
  const checkoutUrl =
      'https://checkout.stripe.com/c/pay/cs_test_screen'
      '#fidkdWxSyntheticOpaque_letters_123-%2F-%2B';
  final token = _testReturnToken(40);
  final ownerScope = SubscriptionReturnOwnerScope(
    uid: owner.uid,
    accountDocumentId: accountDocumentId,
  );
  var preparationCalls = 0;
  var launchCalls = 0;
  Uri? launchedUrl;
  final checkoutService = SubscriptionCheckoutService(
    invokeCallable: (name, payload) async {
      preparationCalls += 1;
      expect(name, 'createCheckoutSession');
      expect(payload, <String, Object?>{
        'returnProtocolVersion': 2,
        'restaurantAccountDocumentId': accountDocumentId,
      });
      _subscriptionReturnBackend.reserve(
        returnToken: token,
        ownerScope: ownerScope,
        family: SubscriptionReturnFamily.checkout,
      );
      return <String, Object?>{
        'url': checkoutUrl,
        'returnToken': token,
        'returnProtocolVersion': 2,
      };
    },
    launchExternalUrl: (url) async {
      launchCalls += 1;
      launchedUrl = url;
      return true;
    },
  );

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async =>
        _approvedAccount(uid: uid, subscriptionStatus: 'inactive'),
    subscriptionCheckoutService: checkoutService,
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    accountDocumentIdForUid: (uid) => accountDocumentId,
  );
  await _ensureSubscriptionActionVisible(tester, useCustomerPortal: false);
  await _invokeSubscriptionAction(tester, useCustomerPortal: false);
  await _pumpUntilWithRealAsync(tester, () => launchCalls == 1);

  expect(preparationCalls, 1);
  expect(launchCalls, 1);
  expect(launchedUrl?.toString(), checkoutUrl);
  expect(find.text('Something went wrong'), findsNothing);
  expect(
    find.widgetWithText(FilledButton, 'Start Subscription'),
    findsOneWidget,
  );
}

Future<void> _verifyReturnDuringPendingCheckoutLaunchIsSingleUse(
  WidgetTester tester,
) async {
  final owner = _TestUser(
    uid: 'duplicate-checkout-owner',
    email: 'duplicate-checkout@example.test',
  );
  const ownerScope = SubscriptionReturnOwnerScope(
    uid: 'duplicate-checkout-owner',
    accountDocumentId: 'duplicate-checkout-document',
  );
  final token = _testReturnToken(27);
  _subscriptionReturnBackend.reserve(
    returnToken: token,
    ownerScope: ownerScope,
    family: SubscriptionReturnFamily.checkout,
  );
  final launcher = Completer<bool>();
  var launchCalls = 0;
  final checkoutService = SubscriptionCheckoutService(
    invokeCallable: (name, payload) async {
      expect(name, 'createCheckoutSession');
      expect(payload, <String, Object?>{
        'returnProtocolVersion': 2,
        'restaurantAccountDocumentId': ownerScope.accountDocumentId,
      });
      return <String, Object?>{
        'url': 'https://checkout.stripe.com/c/pay/pending-return',
        'returnToken': token,
        'returnProtocolVersion': 2,
      };
    },
    launchExternalUrl: (_) {
      launchCalls += 1;
      return launcher.future;
    },
  );

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async =>
        _approvedAccount(uid: uid, subscriptionStatus: 'inactive'),
    subscriptionCheckoutService: checkoutService,
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    accountDocumentIdForUid: (uid) => ownerScope.accountDocumentId,
  );
  await _ensureSectionExpanded(
    tester,
    'Coupon Management / Daily Specials',
    visibleWhenExpanded: find.widgetWithText(
      FilledButton,
      'Start Subscription',
    ),
  );
  await _invokeFilledButton(tester, 'Start Subscription');
  await _pumpUntilWithRealAsync(tester, () => launchCalls == 1);

  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.ingestReturnLink(
        subscriptionReturnUri(
          kind: SubscriptionReturnKind.checkoutSuccess,
          returnToken: token,
        ),
      ),
    ),
    isTrue,
  );
  final event = await _awaitSubscriptionReturnOperation(
    tester,
    SubscriptionReturnService.peekPendingNavigationFor(ownerScope),
  );
  expect(event, isNotNull);
  expect(_subscriptionReturnBackend.eventCountFor(ownerScope), 1);

  launcher.complete(true);
  await tester.pumpAndSettle();
  expect(find.text('Something went wrong'), findsNothing);

  await _awaitSubscriptionReturnOperation(
    tester,
    SubscriptionReturnService.ingestReturnLink(
      subscriptionReturnUri(
        kind: SubscriptionReturnKind.checkoutSuccess,
        returnToken: token,
      ),
    ),
  );
  await _awaitSubscriptionReturnOperation(
    tester,
    SubscriptionReturnService.peekPendingNavigationFor(ownerScope),
  );
  expect(_subscriptionReturnBackend.eventCountFor(ownerScope), 1);
  await tester.pump(const Duration(seconds: 3));
  await tester.pump();
}

Future<void> _verifyReturnDuringPendingCheckoutLaunchThenFalseIsAuthoritative(
  WidgetTester tester,
) async {
  final owner = _TestUser(
    uid: 'pending-false-owner',
    email: 'pending-false-owner@example.test',
  );
  const ownerScope = SubscriptionReturnOwnerScope(
    uid: 'pending-false-owner',
    accountDocumentId: 'pending-false-owner',
  );
  const wrongOwnerScope = SubscriptionReturnOwnerScope(
    uid: 'pending-false-other-owner',
    accountDocumentId: 'pending-false-other-owner',
  );
  final token = _testReturnToken(30);
  const checkoutUrl =
      'https://checkout.stripe.com/c/pay/pending-return-late-false';
  final launcher = Completer<bool>();
  final incoming = StreamController<String>.broadcast(sync: true);
  final navigationClaims = <SubscriptionReturnEvent>[];
  final eventAnnouncements = <SubscriptionReturnEvent>[];
  final messages = <String>[];
  final refreshTransitions = <bool>[];
  var accountLoads = 0;
  var accountIsActive = false;
  var preparationCalls = 0;
  var registrationCalls = 0;
  var launchCalls = 0;
  Uri? launchedUrl;
  addTearDown(incoming.close);
  final eventSubscription = SubscriptionReturnService.events.listen(
    eventAnnouncements.add,
  );
  addTearDown(eventSubscription.cancel);

  final checkoutService = SubscriptionCheckoutService(
    invokeCallable: (name, payload) async {
      expect(name, 'createCheckoutSession');
      expect(payload, <String, Object?>{
        'returnProtocolVersion': subscriptionReturnProtocolVersion,
        'restaurantAccountDocumentId': ownerScope.accountDocumentId,
      });
      preparationCalls += 1;
      registrationCalls += 1;
      _subscriptionReturnBackend.reserve(
        returnToken: token,
        ownerScope: ownerScope,
        family: SubscriptionReturnFamily.checkout,
      );
      return <String, Object?>{
        'url': checkoutUrl,
        'returnToken': token,
        'returnProtocolVersion': subscriptionReturnProtocolVersion,
      };
    },
    launchExternalUrl: (url) {
      launchedUrl = url;
      launchCalls += 1;
      return launcher.future;
    },
  );

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async {
      accountLoads += 1;
      return _approvedAccount(
        uid: uid,
        subscriptionStatus: accountIsActive ? 'active' : 'inactive',
      );
    },
    subscriptionCheckoutService: checkoutService,
    onSubscriptionRefreshStateChanged: refreshTransitions.add,
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    accountDocumentIdForUid: (_) => ownerScope.accountDocumentId,
  );
  await _ensureSectionExpanded(
    tester,
    'Coupon Management / Daily Specials',
    visibleWhenExpanded: find.widgetWithText(
      FilledButton,
      'Start Subscription',
    ),
  );
  await _invokeFilledButton(tester, 'Start Subscription');
  await _pumpUntilWithRealAsync(tester, () => preparationCalls == 1);
  expect(registrationCalls, 1);
  await _pumpUntilWithRealAsync(
    tester,
    () =>
        launchCalls == 1 ||
        find.text('Something went wrong').evaluate().isNotEmpty,
  );
  expect(find.text('Something went wrong'), findsNothing);
  expect(launchCalls, 1);
  expect(launchedUrl, Uri.parse(checkoutUrl));

  expect(preparationCalls, 1);
  expect(registrationCalls, 1);
  expect(launcher.isCompleted, isFalse);
  expect(
    find.widgetWithText(FilledButton, 'Opening Checkout...'),
    findsOneWidget,
  );
  expect(_subscriptionReturnBackend.redeemCalls, 0);
  expect(_subscriptionReturnBackend.eventCountFor(ownerScope), 0);
  expect(navigationClaims, isEmpty);
  expect(messages, isEmpty);

  _subscriptionReturnBackend.releaseClaim = Completer<void>();
  final rawReturn = subscriptionReturnUri(
    kind: SubscriptionReturnKind.checkoutSuccess,
    returnToken: token,
  );
  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.ingestReturnLink(rawReturn),
    ),
    isTrue,
  );
  await _pumpUntilWithRealAsync(
    tester,
    () =>
        _subscriptionReturnBackend.redeemCalls == 1 &&
        _subscriptionReturnBackend.claimCalls == 1,
  );

  final eventBeforeFalse = await _awaitSubscriptionReturnOperation(
    tester,
    SubscriptionReturnService.peekPendingNavigationFor(ownerScope),
  );
  expect(eventBeforeFalse, isNotNull);
  expect(eventBeforeFalse!.id, '1');
  expect(eventBeforeFalse.kind, SubscriptionReturnKind.checkoutSuccess);
  expect(eventBeforeFalse.ownerScope, ownerScope);
  expect(eventBeforeFalse.navigationClaimed, isFalse);
  expect(eventBeforeFalse.refreshClaimed, isFalse);
  expect(_subscriptionReturnBackend.eventCountFor(ownerScope), 1);
  expect(await SubscriptionReturnService.pendingEventCount, 1);
  expect(await SubscriptionReturnService.pendingLocalDeliveryCount, 0);
  expect(eventAnnouncements, <SubscriptionReturnEvent>[eventBeforeFalse]);
  expect(
    <String>[
      eventBeforeFalse.id,
      eventBeforeFalse.kind.name,
      eventBeforeFalse.ownerScope.uid,
      eventBeforeFalse.ownerScope.accountDocumentId,
    ].join('|'),
    isNot(contains(token)),
  );

  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.ingestReturnLink(rawReturn),
    ),
    isTrue,
  );
  expect(await SubscriptionReturnService.pendingLocalDeliveryCount, 1);
  final replayBeforeFalse = await _awaitSubscriptionReturnOperation(
    tester,
    SubscriptionReturnService.peekPendingNavigationFor(ownerScope),
  );
  expect(replayBeforeFalse?.id, eventBeforeFalse.id);
  expect(_subscriptionReturnBackend.redeemCalls, 2);
  expect(_subscriptionReturnBackend.eventCountFor(ownerScope), 1);
  expect(await SubscriptionReturnService.pendingLocalDeliveryCount, 0);
  expect(eventAnnouncements, <SubscriptionReturnEvent>[eventBeforeFalse]);
  expect(launcher.isCompleted, isFalse);
  expect(navigationClaims, isEmpty);
  expect(messages, isEmpty);

  launcher.complete(false);
  await _pumpUntilWithRealAsync(
    tester,
    () => find.text('Something went wrong').evaluate().isNotEmpty,
  );

  expect(launcher.isCompleted, isTrue);
  expect(find.text('Something went wrong'), findsOneWidget);
  expect(
    find.widgetWithText(FilledButton, 'Start Subscription'),
    findsOneWidget,
  );
  expect(preparationCalls, 1);
  expect(registrationCalls, 1);
  expect(launchCalls, 1);
  expect(_subscriptionReturnBackend.redeemCalls, 2);
  expect(_subscriptionReturnBackend.claimCalls, 1);
  expect(_subscriptionReturnBackend.eventCountFor(ownerScope), 1);
  expect(_subscriptionReturnBackend.eventCountFor(wrongOwnerScope), 0);
  expect(await SubscriptionReturnService.pendingEventCount, 1);
  expect(eventAnnouncements, <SubscriptionReturnEvent>[eventBeforeFalse]);
  expect(navigationClaims, isEmpty);
  expect(messages, isEmpty);
  expect(find.textContaining(token), findsNothing);

  final eventAfterFalse = await _awaitSubscriptionReturnOperation(
    tester,
    SubscriptionReturnService.peekPendingNavigationFor(ownerScope),
  );
  expect(eventAfterFalse?.id, eventBeforeFalse.id);
  expect(eventAfterFalse?.kind, SubscriptionReturnKind.checkoutSuccess);
  expect(_subscriptionReturnBackend.eventCountFor(ownerScope), 1);

  accountIsActive = true;
  _subscriptionReturnBackend.releaseClaim!.complete();
  await _pumpUntilWithRealAsync(
    tester,
    () => accountLoads >= 2 && refreshTransitions.length == 2,
  );
  expect(navigationClaims, isEmpty);
  expect(messages, isEmpty);
  expect(_subscriptionReturnBackend.claimCalls, 1);

  await tester.pump(const Duration(seconds: 3));
  await tester.pumpAndSettle();
  await _ensureSectionExpanded(
    tester,
    'Subscription / Billing',
    visibleWhenExpanded: find.text('Subscription active'),
  );
  expect(find.text('Subscription active'), findsOneWidget);
  expect(refreshTransitions, <bool>[true, false, true, false]);

  await tester.pumpWidget(
    MaterialApp(
      navigatorKey: rootNavigatorKey,
      scaffoldMessengerKey: rootScaffoldMessengerKey,
      home: MainNavigationScreen(
        initializePlatformServices: false,
        testIncomingRawDeepLinks: incoming.stream,
        testSubscriptionReturnOwnerScopeProvider: () => ownerScope,
        testOnSubscriptionReturnNavigationClaimed: navigationClaims.add,
        testOnSubscriptionReturnMessageEmitted: messages.add,
        testSuppressSubscriptionReturnSnackBar: true,
        testAuthenticatedRestaurantHubBuilder: (_) =>
            const Text('Recreated authenticated restaurant hub'),
        testPagesBuilder: (_) => const <Widget>[
          SizedBox(),
          SizedBox(),
          SizedBox(),
        ],
      ),
    ),
  );
  await _pumpUntilWithRealAsync(
    tester,
    () => navigationClaims.length == 1 && messages.length == 1,
  );
  expect(navigationClaims.single.id, eventBeforeFalse.id);
  expect(navigationClaims.single.ownerScope, ownerScope);
  expect(messages, <String>[
    'Subscription started successfully. Refreshing restaurant tools...',
  ]);
  expect(_subscriptionReturnBackend.claimCalls, 2);
  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.claimNavigationFor(
        eventBeforeFalse.id,
        ownerScope,
      ),
    ),
    isFalse,
  );
  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.claimRefreshFor(
        eventBeforeFalse.id,
        ownerScope,
      ),
    ),
    isFalse,
  );
  expect(_subscriptionReturnBackend.claimCalls, 2);

  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.ingestReturnLink(rawReturn),
    ),
    isTrue,
  );
  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.peekPendingNavigationFor(ownerScope),
    ),
    isNull,
  );
  expect(_subscriptionReturnBackend.redeemCalls, 3);
  expect(await SubscriptionReturnService.pendingLocalDeliveryCount, 0);
  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.peekPendingRefreshFor(ownerScope),
    ),
    isNull,
  );
  expect(_subscriptionReturnBackend.eventCountFor(ownerScope), 0);
  expect(_subscriptionReturnBackend.eventCountFor(wrongOwnerScope), 0);
  expect(_subscriptionReturnBackend.claimCalls, 2);
  expect(navigationClaims, hasLength(1));
  expect(messages, hasLength(1));
  expect(eventAnnouncements, hasLength(1));
  expect(find.textContaining(token), findsNothing);

  final redeemCallsAfterReplay = _subscriptionReturnBackend.redeemCalls;
  final claimCallsAfterReplay = _subscriptionReturnBackend.claimCalls;
  final accountLoadsAfterRefresh = accountLoads;
  await tester.pump(const Duration(seconds: 4));
  await tester.pump();
  expect(_subscriptionReturnBackend.redeemCalls, redeemCallsAfterReplay);
  expect(_subscriptionReturnBackend.claimCalls, claimCallsAfterReplay);
  expect(accountLoads, accountLoadsAfterRefresh);
  expect(navigationClaims, hasLength(1));
  expect(messages, hasLength(1));
  expect(eventAnnouncements, hasLength(1));
  expect(tester.takeException(), isNull);
}

Future<void> _verifyPaywallPendingPreparationIsOwnerScoped(
  WidgetTester tester,
) async {
  final owner = _TestUser(
    uid: 'paywall-pending-preparation-owner',
    email: 'paywall-pending-preparation@example.test',
  );
  const documentA = 'paywall-pending-preparation-document-a';
  const documentB = 'paywall-pending-preparation-document-b';
  final tokenA = _testReturnToken(28);
  final tokenB = _testReturnToken(29);
  var currentDocumentId = documentA;
  var ownerAHasAccess = true;
  var preparationCalls = 0;
  final ownerAPreparation = Completer<Map<String, Object?>>();
  final launchedUrls = <Uri>[];
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final checkoutService = SubscriptionCheckoutService(
    invokeCallable: (name, payload) {
      expect(name, 'createCheckoutSession');
      expect(payload, <String, Object?>{
        'returnProtocolVersion': 2,
        'restaurantAccountDocumentId': currentDocumentId,
      });
      preparationCalls += 1;
      if (preparationCalls == 1) {
        return ownerAPreparation.future;
      }
      return Future<Map<String, Object?>>.value(<String, Object?>{
        'url': 'https://checkout.stripe.com/c/pay/paywall-owner-b',
        'returnToken': tokenB,
        'returnProtocolVersion': 2,
      });
    },
    launchExternalUrl: (url) async {
      launchedUrls.add(url);
      return true;
    },
  );

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(
      uid: uid,
      restaurantName: currentDocumentId == documentA
          ? 'A Paywall Pending Restaurant'
          : 'B Paywall Current Restaurant',
      subscriptionStatus: currentDocumentId == documentA && ownerAHasAccess
          ? 'active'
          : 'inactive',
    ),
    subscriptionCheckoutService: checkoutService,
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => currentDocumentId,
  );
  await _ensureSectionExpanded(
    tester,
    'Coupon Management',
    visibleWhenExpanded: _fieldWithLabel('Coupon Title'),
  );
  final createCoupon = tester
      .widget<ElevatedButton>(
        find.widgetWithText(ElevatedButton, 'Create Coupon'),
      )
      .onPressed!;
  ownerAHasAccess = false;
  createCoupon();
  await tester.pumpAndSettle();
  expect(
    find.text('Upgrade to Post Coupons and Daily Specials'),
    findsOneWidget,
  );

  await _invokeFilledButton(tester, 'Start Subscription');
  expect(preparationCalls, 1);
  expect(launchedUrls, isEmpty);

  currentDocumentId = documentB;
  userChanges.add(owner);
  await tester.pumpAndSettle();
  expect(find.text('Upgrade to Post Coupons and Daily Specials'), findsNothing);
  expect(find.text('Something went wrong'), findsNothing);

  await _ensureSubscriptionActionVisible(tester, useCustomerPortal: false);
  await _invokeSubscriptionAction(tester, useCustomerPortal: false);
  await _pumpUntilWithRealAsync(tester, () => launchedUrls.length == 1);
  expect(
    launchedUrls.single,
    Uri.parse('https://checkout.stripe.com/c/pay/paywall-owner-b'),
  );

  ownerAPreparation.complete(<String, Object?>{
    'url': 'https://checkout.stripe.com/c/pay/paywall-owner-a-stale',
    'returnToken': tokenA,
    'returnProtocolVersion': 2,
  });
  await tester.pumpAndSettle();

  expect(launchedUrls, hasLength(1));
  expect(
    await _awaitSubscriptionReturnOperation(
      tester,
      SubscriptionReturnService.pendingLocalDeliveryCount,
    ),
    0,
  );
  expect(find.text('Something went wrong'), findsNothing);
}

Future<void> _verifyPendingCheckoutIsOwnerScoped(WidgetTester tester) async {
  final owner = _TestUser(
    uid: 'shared-checkout-owner',
    email: 'checkout@example.test',
  );
  const documentA = 'checkout-document-a';
  const documentB = 'checkout-document-b';
  var currentDocumentId = documentA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final ownerACheckout = Completer<void>();
  final ownerBCheckout = Completer<void>();
  var checkoutCalls = 0;
  var preparationCalls = 0;
  final checkoutService = SubscriptionCheckoutService(
    invokeCallable: (name, payload) async {
      expect(name, 'createCheckoutSession');
      expect(payload, <String, Object?>{
        'returnProtocolVersion': 2,
        'restaurantAccountDocumentId': currentDocumentId,
      });
      preparationCalls += 1;
      return <String, Object?>{
        'url': 'https://checkout.stripe.com/c/pay/synthetic-$preparationCalls',
        'returnToken': _testReturnToken(preparationCalls),
        'returnProtocolVersion': 2,
      };
    },
    launchExternalUrl: (_) async {
      checkoutCalls += 1;
      if (checkoutCalls == 1) {
        await ownerACheckout.future;
      } else {
        await ownerBCheckout.future;
      }
      return true;
    },
  );

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(
      uid: uid,
      restaurantName: currentDocumentId == documentA
          ? 'A Checkout Restaurant'
          : 'B Checkout Restaurant',
      subscriptionStatus: 'inactive',
    ),
    subscriptionCheckoutService: checkoutService,
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => currentDocumentId,
  );
  await _ensureSectionExpanded(
    tester,
    'Coupon Management / Daily Specials',
    visibleWhenExpanded: find.widgetWithText(
      FilledButton,
      'Start Subscription',
    ),
  );
  await _invokeFilledButton(tester, 'Start Subscription');
  await _pumpUntilWithRealAsync(tester, () => checkoutCalls == 1);

  currentDocumentId = documentB;
  userChanges.add(owner);
  await tester.pumpAndSettle();
  await _ensureSectionExpanded(
    tester,
    'Coupon Management / Daily Specials',
    visibleWhenExpanded: find.widgetWithText(
      FilledButton,
      'Start Subscription',
    ),
  );
  await _invokeFilledButton(tester, 'Start Subscription');
  await _pumpUntilWithRealAsync(tester, () => checkoutCalls == 2);

  ownerACheckout.complete();
  await tester.pump();
  await tester.pump();
  expect(
    find.widgetWithText(FilledButton, 'Opening Checkout...'),
    findsOneWidget,
  );
  expect(
    tester
        .widget<FilledButton>(
          find.widgetWithText(FilledButton, 'Opening Checkout...'),
        )
        .onPressed,
    isNull,
  );
  expect(find.text('Something went wrong'), findsNothing);

  ownerBCheckout.complete();
  await tester.pumpAndSettle();
  expect(
    find.widgetWithText(FilledButton, 'Start Subscription'),
    findsOneWidget,
  );
  expect(checkoutCalls, 2);
  expect(preparationCalls, 2);
}

Future<void> _verifyPendingPortalIsOwnerScoped(WidgetTester tester) async {
  final owner = _TestUser(
    uid: 'shared-portal-owner',
    email: 'portal@example.test',
  );
  const documentA = 'portal-document-a';
  const documentB = 'portal-document-b';
  var currentDocumentId = documentA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final ownerAPortal = Completer<void>();
  final ownerBPortal = Completer<void>();
  var portalCalls = 0;
  var preparationCalls = 0;
  final portalService = SubscriptionCheckoutService(
    invokeCallable: (name, payload) async {
      expect(name, 'createCustomerPortalSession');
      expect(payload, <String, Object?>{
        'returnProtocolVersion': 2,
        'restaurantAccountDocumentId': currentDocumentId,
      });
      preparationCalls += 1;
      return <String, Object?>{
        'url':
            'https://billing.stripe.com/p/session/synthetic-$preparationCalls',
        'returnToken': _testReturnToken(preparationCalls + 4),
        'returnProtocolVersion': 2,
      };
    },
    launchExternalUrl: (_) async {
      portalCalls += 1;
      if (portalCalls == 1) {
        await ownerAPortal.future;
      } else {
        await ownerBPortal.future;
      }
      return true;
    },
  );

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(
      uid: uid,
      restaurantName: currentDocumentId == documentA
          ? 'A Portal Restaurant'
          : 'B Portal Restaurant',
    ),
    subscriptionCheckoutService: portalService,
    testCurrentUser: owner,
    currentUserProvider: () => owner,
    ownerUserChanges: userChanges.stream,
    accountDocumentIdForUid: (uid) => currentDocumentId,
  );
  await _ensureSectionExpanded(
    tester,
    'Subscription / Billing',
    visibleWhenExpanded: find.widgetWithText(
      OutlinedButton,
      'Manage Subscription',
    ),
  );
  await _invokeOutlinedButton(tester, 'Manage Subscription');
  await _pumpUntilWithRealAsync(tester, () => portalCalls == 1);

  currentDocumentId = documentB;
  userChanges.add(owner);
  await tester.pumpAndSettle();
  await _ensureSectionExpanded(
    tester,
    'Subscription / Billing',
    visibleWhenExpanded: find.widgetWithText(
      OutlinedButton,
      'Manage Subscription',
    ),
  );
  await _invokeOutlinedButton(tester, 'Manage Subscription');
  await _pumpUntilWithRealAsync(tester, () => portalCalls == 2);

  ownerAPortal.completeError(StateError('A-PORTAL-ERROR-CANARY'));
  await tester.pump();
  await tester.pump();
  expect(find.widgetWithText(OutlinedButton, 'Opening...'), findsOneWidget);
  expect(
    tester
        .widget<OutlinedButton>(
          find.widgetWithText(OutlinedButton, 'Opening...'),
        )
        .onPressed,
    isNull,
  );
  expect(find.text('Something went wrong'), findsNothing);
  expect(find.textContaining('A-PORTAL-ERROR-CANARY'), findsNothing);

  ownerBPortal.complete();
  await tester.pumpAndSettle();
  expect(
    find.widgetWithText(OutlinedButton, 'Manage Subscription'),
    findsOneWidget,
  );
  expect(portalCalls, 2);
  expect(preparationCalls, 2);
}

Future<void> _verifyPendingSubscriptionRefreshIsOwnerScoped(
  WidgetTester tester,
) async {
  final ownerA = _TestUser(
    uid: 'subscription-refresh-a',
    email: 'subscription-refresh-a@example.test',
  );
  final ownerB = _TestUser(
    uid: 'subscription-refresh-b',
    email: 'subscription-refresh-b@example.test',
  );
  User? currentUser = ownerA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final pendingOwnerARefresh = Completer<Map<String, dynamic>?>();
  var ownerALoads = 0;

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) {
      if (uid == ownerA.uid) {
        ownerALoads += 1;
        if (ownerALoads == 2) {
          return pendingOwnerARefresh.future;
        }
        return Future<Map<String, dynamic>?>.value(
          _approvedAccount(
            uid: uid,
            subscriptionStatus: 'inactive',
            restaurantName: 'A-REFRESH-CANARY',
          ),
        );
      }
      return Future<Map<String, dynamic>?>.value(
        _approvedAccount(
          uid: uid,
          subscriptionStatus: 'active',
          restaurantName: 'B Refresh Restaurant',
        ),
      );
    },
    testCurrentUser: ownerA,
    currentUserProvider: () => currentUser,
    ownerUserChanges: userChanges.stream,
  );
  await _triggerAppResume(tester);
  await _pumpUntil(tester, () => ownerALoads == 2);

  currentUser = ownerB;
  userChanges.add(ownerB);
  await tester.pumpAndSettle();
  await _ensureSectionExpanded(
    tester,
    'Subscription / Billing',
    visibleWhenExpanded: find.text('Subscription active'),
  );
  expect(find.text('Subscription active'), findsOneWidget);

  pendingOwnerARefresh.complete(
    _approvedAccount(
      uid: ownerA.uid,
      subscriptionStatus: 'inactive',
      restaurantName: 'A-LATE-REFRESH-CANARY',
    ),
  );
  await tester.pump();
  await tester.pump();
  expect(find.text('Subscription active'), findsOneWidget);
  expect(find.textContaining('A-LATE-REFRESH-CANARY'), findsNothing);
  expect(find.text('Not subscribed'), findsNothing);
}

Future<void> _verifyPendingSignOutIsOwnerScoped(WidgetTester tester) async {
  final ownerA = _TestUser(
    uid: 'pending-signout-a',
    email: 'pending-signout-a@example.test',
  );
  final ownerB = _TestUser(
    uid: 'pending-signout-b',
    email: 'pending-signout-b@example.test',
  );
  User? currentUser = ownerA;
  final userChanges = StreamController<User?>.broadcast(sync: true);
  addTearDown(userChanges.close);
  final pendingSignOut = Completer<void>();
  var signOutCalls = 0;

  await _pumpApplicationScreen(
    tester,
    loadAccount: (uid) async => _approvedAccount(
      uid: uid,
      email: uid == ownerA.uid ? ownerA.email! : ownerB.email!,
      restaurantName: uid == ownerA.uid
          ? 'A-SIGNOUT-CANARY'
          : 'B Signout Restaurant',
    ),
    signOutRestaurantSession: () {
      signOutCalls += 1;
      return pendingSignOut.future;
    },
    testCurrentUser: ownerA,
    currentUserProvider: () => currentUser,
    ownerUserChanges: userChanges.stream,
  );
  final signOutButton = find.widgetWithText(TextButton, 'Sign Out');
  await tester.tap(signOutButton);
  await _pumpUntil(tester, () => signOutCalls == 1);

  currentUser = ownerB;
  userChanges.add(ownerB);
  await tester.pumpAndSettle();
  await _ensureSectionExpanded(tester, 'Basic Restaurant Information');
  expect(find.text('B Signout Restaurant'), findsOneWidget);

  pendingSignOut.complete();
  await tester.pumpAndSettle();
  expect(signOutCalls, 1);
  expect(find.text('Restaurant: Create Coupon'), findsOneWidget);
  expect(find.text('B Signout Restaurant'), findsOneWidget);
  expect(find.textContaining('A-SIGNOUT-CANARY'), findsNothing);
}

Future<void> _enterRequiredApplicationFields(
  WidgetTester tester, {
  required String restaurantName,
}) async {
  await tester.enterText(_fieldWithLabel('Restaurant Name'), restaurantName);
  await tester.enterText(_fieldWithLabel('Street Address'), '1 Main Street');
  await tester.enterText(_fieldWithLabel('City'), 'Crystal River');
  await tester.enterText(_fieldWithLabel('State'), 'FL');
  await tester.enterText(_fieldWithLabel('ZIP Code'), '34428');
  await tester.enterText(_fieldWithLabel('Phone Number'), '3525550100');
}

String _testReturnToken(int index) {
  final alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  final character = alphabet[index % alphabet.length];
  return List<String>.filled(43, character).join();
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
  await _ensureSectionExpanded(
    tester,
    'Daily Specials',
    visibleWhenExpanded: _fieldWithLabel('Title'),
  );
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
  CouponSaver? createCoupon,
  CouponSaver? updateCoupon,
  CouponDeleter? deleteCoupon,
  DailySpecialDeleter? deleteDailySpecial,
  CouponDatePicker? pickCouponDate,
  OwnerTimePicker? pickCouponTime,
  OwnerTimePicker? pickDailySpecialTime,
  CouponImagePickerUploader? pickAndUploadCouponImage,
  CouponImagePersister? persistCouponImage,
  SubscriptionCheckoutService? subscriptionCheckoutService,
  RestaurantOwnerAction? signOutRestaurantSession,
  RestaurantNameChangeSubmitter? submitNameChangeRequest,
  ValueChanged<bool>? onSubscriptionRefreshStateChanged,
  User? testCurrentUser,
  RestaurantCurrentUserProvider? currentUserProvider,
  Stream<User?>? ownerUserChanges,
  RestaurantAccountDocumentIdResolver? accountDocumentIdForUid,
  RestaurantImagePicker? pickRestaurantImage,
  RestaurantImageValidator? validateRestaurantImage,
  RestaurantImageUploader? uploadRestaurantImage,
  bool settle = true,
  bool pumpAfterWidgetWhenUnsettled = true,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(900, 1400);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);

  await tester.pumpWidget(
    MaterialApp(
      home: _applicationScreen(
        lifecycleService: lifecycleService,
        loadAccount: loadAccount,
        loadCoupons: loadCoupons,
        loadDailySpecials: loadDailySpecials,
        createDailySpecial: createDailySpecial,
        updateDailySpecial: updateDailySpecial,
        createCoupon: createCoupon,
        updateCoupon: updateCoupon,
        deleteCoupon: deleteCoupon,
        deleteDailySpecial: deleteDailySpecial,
        pickCouponDate: pickCouponDate,
        pickCouponTime: pickCouponTime,
        pickDailySpecialTime: pickDailySpecialTime,
        pickAndUploadCouponImage: pickAndUploadCouponImage,
        persistCouponImage: persistCouponImage,
        subscriptionCheckoutService: subscriptionCheckoutService,
        signOutRestaurantSession: signOutRestaurantSession,
        submitNameChangeRequest: submitNameChangeRequest,
        onSubscriptionRefreshStateChanged: onSubscriptionRefreshStateChanged,
        testCurrentUser: testCurrentUser,
        currentUserProvider: currentUserProvider,
        ownerUserChanges: ownerUserChanges,
        accountDocumentIdForUid: accountDocumentIdForUid,
        pickRestaurantImage: pickRestaurantImage,
        validateRestaurantImage: validateRestaurantImage,
        uploadRestaurantImage: uploadRestaurantImage,
      ),
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else if (pumpAfterWidgetWhenUnsettled) {
    await tester.pump();
  }
}

class _BeforeLaunchHookSubscriptionCheckoutService
    extends SubscriptionCheckoutService {
  final void Function(PreparedSubscriptionSession prepared) beforeLaunch;

  _BeforeLaunchHookSubscriptionCheckoutService({
    required super.invokeCallable,
    required super.launchExternalUrl,
    required this.beforeLaunch,
  });

  @override
  Future<SubscriptionExternalLaunchResult> launchPreparedSubscriptionUrl(
    PreparedSubscriptionSession prepared, {
    required bool Function() isCurrent,
  }) {
    beforeLaunch(prepared);
    return super.launchPreparedSubscriptionUrl(prepared, isCurrent: isCurrent);
  }
}

RestaurantCreateCouponScreen _applicationScreen({
  BiteSaverRestaurantLifecycleService? lifecycleService,
  required Future<Map<String, dynamic>?> Function(String uid) loadAccount,
  Future<List<Coupon>> Function(String uid)? loadCoupons,
  Future<List<DailySpecial>> Function(String uid)? loadDailySpecials,
  DailySpecialSaver? createDailySpecial,
  DailySpecialSaver? updateDailySpecial,
  CouponSaver? createCoupon,
  CouponSaver? updateCoupon,
  CouponDeleter? deleteCoupon,
  DailySpecialDeleter? deleteDailySpecial,
  CouponDatePicker? pickCouponDate,
  OwnerTimePicker? pickCouponTime,
  OwnerTimePicker? pickDailySpecialTime,
  CouponImagePickerUploader? pickAndUploadCouponImage,
  CouponImagePersister? persistCouponImage,
  SubscriptionCheckoutService? subscriptionCheckoutService,
  RestaurantOwnerAction? signOutRestaurantSession,
  RestaurantNameChangeSubmitter? submitNameChangeRequest,
  ValueChanged<bool>? onSubscriptionRefreshStateChanged,
  User? testCurrentUser,
  RestaurantCurrentUserProvider? currentUserProvider,
  Stream<User?>? ownerUserChanges,
  RestaurantAccountDocumentIdResolver? accountDocumentIdForUid,
  RestaurantImagePicker? pickRestaurantImage,
  RestaurantImageValidator? validateRestaurantImage,
  RestaurantImageUploader? uploadRestaurantImage,
}) {
  return RestaurantCreateCouponScreen(
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
    createCoupon: createCoupon,
    updateCoupon: updateCoupon,
    deleteCoupon: deleteCoupon,
    deleteDailySpecial: deleteDailySpecial,
    pickCouponDate: pickCouponDate,
    pickCouponTime: pickCouponTime,
    pickDailySpecialTime: pickDailySpecialTime,
    pickAndUploadCouponImage: pickAndUploadCouponImage,
    persistCouponImage: persistCouponImage,
    subscriptionCheckoutService: subscriptionCheckoutService,
    signOutRestaurantSession: signOutRestaurantSession,
    loadMenuRoutingState: () async => const BiteSaverMenuRoutingState(
      usesBiteRater: false,
      matchedBiteScoreRestaurant: null,
      isAlreadyUsedByOtherSide: false,
    ),
    submitNameChangeRequest: submitNameChangeRequest,
    onSubscriptionRefreshStateChanged: onSubscriptionRefreshStateChanged,
    currentUserProvider: currentUserProvider,
    ownerUserChanges: ownerUserChanges,
    accountDocumentIdForUid: accountDocumentIdForUid,
    pickRestaurantImage: pickRestaurantImage,
    validateRestaurantImage: validateRestaurantImage,
    uploadRestaurantImage: uploadRestaurantImage,
    testCurrentUser: testCurrentUser ?? _TestUser(),
  );
}

Future<void> _expandSection(WidgetTester tester, String title) async {
  final sectionTitle = find.text(title);
  await tester.ensureVisible(sectionTitle);
  await tester.tap(sectionTitle);
  await tester.pumpAndSettle();
}

Future<void> _tapRestaurantImagePicker(
  WidgetTester tester,
  String buttonLabel,
) async {
  final button = find.widgetWithText(OutlinedButton, buttonLabel);
  await tester.ensureVisible(button);
  await tester.tap(button);
  await tester.pumpAndSettle();
}

Future<void> _invokeRestaurantImagePickerWithRealTime(
  WidgetTester tester,
  String buttonLabel,
) async {
  final button = find.widgetWithText(OutlinedButton, buttonLabel);
  await tester.ensureVisible(button);
  final callback = tester.widget<OutlinedButton>(button).onPressed!;
  await tester.runAsync(() async {
    final dynamic asyncCallback = callback;
    await asyncCallback();
  });
  await tester.pumpAndSettle();
}

Future<void> _tapElevatedButton(WidgetTester tester, String buttonLabel) async {
  final button = find.widgetWithText(ElevatedButton, buttonLabel);
  await tester.ensureVisible(button);
  await tester.tap(button);
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
  String uid = 'owner-1',
  String email = 'owner@example.com',
  String restaurantName = 'Approved Cafe',
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
  String? mainImageUrl,
  List<RestaurantBusinessHours>? businessHours,
  String subscriptionStatus = 'active',
}) {
  return <String, dynamic>{
    Restaurant.fieldUid: uid,
    Restaurant.fieldEmail: email,
    Restaurant.fieldName: restaurantName,
    Restaurant.fieldStreetAddress: streetAddress,
    Restaurant.fieldCity: city,
    Restaurant.fieldState: state,
    Restaurant.fieldZipCode: zipCode,
    Restaurant.fieldPhone: phone,
    Restaurant.fieldWebsite: website,
    Restaurant.fieldBio: bio,
    Restaurant.fieldMainImageUrl: ?mainImageUrl,
    if (businessHours != null)
      Restaurant.fieldBusinessHours: RestaurantBusinessHours.toFirestoreList(
        businessHours,
      ),
    Restaurant.fieldProfileVersion: profileVersion,
    Restaurant.fieldApprovalStatus: 'approved',
    'couponApplicationSubmitted': true,
    'subscriptionStatus': subscriptionStatus,
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

List<RestaurantBusinessHours> _customBusinessHours() {
  return _businessHoursForSunday(opensAt: '10:00 AM', closesAt: '4:00 PM');
}

List<RestaurantBusinessHours> _businessHoursForSunday({
  required String opensAt,
  required String closesAt,
}) {
  return [
    for (final entry in RestaurantBusinessHours.defaultWeek())
      entry.day == 'Sunday'
          ? entry.copyWith(opensAt: opensAt, closesAt: closesAt, closed: false)
          : entry,
  ];
}

const String _syntheticRestaurantImageUrl =
    'https://firebasestorage.googleapis.com/v0/b/example.appspot.com/o/'
    'bitesaver_restaurants%2Fowner-1%2Frestaurant_images%2F'
    'main_image.jpg?alt=media&token=synthetic-token';

Future<BiteSaverValidatedRestaurantImage> _validatedRestaurantImage(
  WidgetTester tester,
  BiteSaverPickedImage pickedImage,
) async {
  final validated = await tester.runAsync(
    () => BiteSaverImageUploadService.validateRestaurantImage(pickedImage),
  );
  expect(validated, isNotNull);
  return validated!;
}

Future<void> _expectFlutterCodecDecodes(
  WidgetTester tester,
  Uint8List bytes, {
  required int expectedWidth,
  required int expectedHeight,
}) async {
  await tester.runAsync<void>(() async {
    final codec = await ui.instantiateImageCodec(bytes);
    ui.Image? decodedImage;
    try {
      final frame = await codec.getNextFrame();
      decodedImage = frame.image;
      expect(decodedImage.width, expectedWidth);
      expect(decodedImage.height, expectedHeight);
    } finally {
      decodedImage?.dispose();
      codec.dispose();
    }
  });
}

Uint8List _onePixelPng() {
  return base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4'
    'z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  );
}

Uint8List _onePixelJpeg() {
  return base64Decode(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUD'
    'BAMEBgUGBgYFBQUGBwkIBgcIBwUFCAsICAkJCgoKBgcLDAsKDAkKCgr/2wBDAQIC'
    'AgICAgUDAwUKBgUGCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoK'
    'CgoKCgoKCgoKCgoKCgr/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAA'
    'AAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAA'
    'AAAACAn/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCFgA+uA//Z',
  );
}

Uint8List _smallValidWebp() {
  return base64Decode(
    'UklGRmIAAABXRUJQVlA4IFYAAADwAgCdASoMAAcAAgA0JbACdLoB8gFKA+wCuAAP'
    'QBPAQAD+zgeDPr1Nt++xzMd++pP/lXpu/V9e3k9vx/4zXuAijaP/6TI74hwoeND/'
    'W7C9rod3/GrgAA==',
  );
}

Uint8List _onePixelGif() {
  return base64Decode('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==');
}

Uint8List _onePixelBmp() {
  return Uint8List.fromList(const <int>[
    0x42,
    0x4d,
    0x3a,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x36,
    0x00,
    0x00,
    0x00,
    0x28,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x18,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x04,
    0x00,
    0x00,
    0x00,
    0x13,
    0x0b,
    0x00,
    0x00,
    0x13,
    0x0b,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0xff,
    0x00,
  ]);
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
  final String _uid;
  final String? _email;

  _TestUser({String uid = 'owner-1', String? email = 'owner@example.com'})
    : _uid = uid,
      _email = email;

  @override
  String get uid => _uid;

  @override
  String? get email => _email;

  @override
  bool get emailVerified => true;

  @override
  bool get isAnonymous => false;

  @override
  List<UserInfo> get providerData => const <UserInfo>[];
}
