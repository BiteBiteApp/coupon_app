import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/firebase_options.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const ios = DefaultFirebaseOptions.ios;
  final plist = File('ios/Runner/GoogleService-Info.plist').readAsStringSync();

  test('FlutterFire metadata identifies the current BiteStar iOS app', () {
    final config = jsonDecode(File('firebase.json').readAsStringSync());
    final platforms = config['flutter']['platforms'] as Map<String, dynamic>;
    final nativeMetadata = platforms['ios']['default'];
    final dartMetadata = platforms['dart']['lib/firebase_options.dart'];

    expect(ios.appId, '1:253983587346:ios:9e02bea4dfc6bdb548accb');
    expect(nativeMetadata['appId'], ios.appId);
    expect(dartMetadata['configurations']['ios'], ios.appId);
    expect(_plistString(plist, 'GOOGLE_APP_ID'), ios.appId);
    expect(ios.iosBundleId, 'com.colesmart.bitestar');
    expect(_plistString(plist, 'BUNDLE_ID'), ios.iosBundleId);
    expect(nativeMetadata['projectId'], ios.projectId);
    expect(dartMetadata['projectId'], ios.projectId);
  });

  test('Dart iOS SDK fields agree with the native Firebase plist', () {
    final fields = <String, String?>{
      'GOOGLE_APP_ID': ios.appId,
      'BUNDLE_ID': ios.iosBundleId,
      'API_KEY': ios.apiKey,
      'GCM_SENDER_ID': ios.messagingSenderId,
      'PROJECT_ID': ios.projectId,
      'STORAGE_BUCKET': ios.storageBucket,
      'CLIENT_ID': ios.iosClientId,
      'ANDROID_CLIENT_ID': ios.androidClientId,
    };

    for (final field in fields.entries) {
      expect(
        field.value != null && field.value!.isNotEmpty,
        isTrue,
        reason: '${field.key} must be represented in Dart iOS options.',
      );
      // Compare booleans so failures do not print API keys or client values.
      expect(
        field.value == _plistString(plist, field.key),
        isTrue,
        reason: '${field.key} differs between Dart iOS options and the plist.',
      );
    }
  });
}

// These SDK identity fields are plain XML strings in the checked-in plist.
String _plistString(String plist, String key) {
  final matches = RegExp(
    '<key>${RegExp.escape(key)}</key>\\s*<string>([^<]*)</string>',
  ).allMatches(plist).toList();
  expect(matches, hasLength(1), reason: 'Expected one plist string for $key.');
  return matches.single.group(1)!;
}
