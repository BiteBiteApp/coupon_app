import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/demo_redemption_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

// Executes the real Dart finalizer through the existing injection seam. Only
// transport is adapted to Firestore REST; this is not native SDK qualification.
void main() {
  if (Platform.environment['BITESTAR_GUEST_LIFECYCLE_EMULATOR_TEST'] != '1') {
    test(
      'guest lifecycle real Firestore integration requires explicit opt-in',
      () {},
      skip: 'Requires the guarded local demo Firestore emulator.',
    );
    return;
  }
  final host = Platform.environment['FIRESTORE_EMULATOR_HOST'] ?? '';
  final project = Platform.environment['GCLOUD_PROJECT'] ?? '';
  final secondProject = Platform.environment['GOOGLE_CLOUD_PROJECT'];
  final match = RegExp(
    r'^(127\.0\.0\.1|localhost):([1-9][0-9]{0,4})$',
  ).firstMatch(host);
  if (match == null ||
      int.parse(match.group(2)!) > 65535 ||
      project != 'demo-bs-retention-lifecycle' ||
      (secondProject != null && secondProject != project) ||
      Platform.environment.containsKey('GOOGLE_APPLICATION_CREDENTIALS')) {
    throw StateError(
      'Requires explicit loopback, demo-bs-retention-lifecycle, '
      'matching project settings, and no credential file.',
    );
  }
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'real Firestore finalization preserves guest-only and unrelated state',
    () => HttpOverrides.runWithHttpOverrides(() async {
      final namespace =
          'guest_lifecycle_${DateTime.now().microsecondsSinceEpoch}_'
          '${Random.secure().nextInt(1 << 32)}';
      final userId = '${namespace}_A';
      final base = 'customer_redemptions/$userId/coupon_redemptions';
      final otherPath =
          'customer_redemptions/${namespace}_B/coupon_redemptions/coupon';
      final devicePath = 'private_bitesaver_device_coupon_usage/$namespace';
      final allowedPaths = {
        '$base/absent',
        '$base/matching',
        '$base/mismatched',
        otherPath,
        devicePath,
      };
      final database = _RestFirestore(host, project, allowedPaths);
      final anchor = DateTime.now().subtract(const Duration(minutes: 10));
      final newerAnchor = DateTime.now().subtract(const Duration(minutes: 1));
      final previousUse = anchor.subtract(const Duration(days: 1));
      final guestHistory = jsonEncode({
        for (final id in ['absent', 'matching', 'mismatched'])
          id: {'timerStartedAt': anchor.toIso8601String()},
      });
      try {
        await database.seed('$base/matching', {
          'timerStartedAt': Timestamp.fromDate(anchor),
          'redeemedCount': 2,
        });
        await database.seed('$base/mismatched', {
          'timerStartedAt': Timestamp.fromDate(newerAnchor),
          'redeemedCount': 4,
        });
        await database.seed(otherPath, {
          'owner': 'unrelated',
          'redeemedCount': 8,
        });
        await database.seed(devicePath, {
          'deviceBinding': 'synthetic-device-only',
          'lastUsedAt': Timestamp.fromDate(previousUse),
        });
        final otherBefore = await database.read(otherPath);
        final deviceBefore = await database.read(devicePath);
        SharedPreferences.setMockInitialValues({
          'guest_coupon_redemptions_guest-test-device': guestHistory,
        });
        await DemoRedemptionStore.resetForTesting();
        DemoRedemptionStore.configureForTesting(
          currentAuthSnapshot: () => (uid: userId, isAnonymous: false),
          firestore: database,
        );

        // Refresh reads local guest timers and invokes the actual finalizer.
        await DemoRedemptionStore.refreshFromFirestore();

        expect(await database.read('$base/absent'), isNull);
        final matching = (await database.read('$base/matching'))!;
        expect(matching['timerStartedAt'], isNull);
        expect(matching['redeemedCount'], 3);
        expect(
          matching['lastRedeemedAt'],
          Timestamp.fromDate(anchor.add(DemoRedemptionStore.redeemWindow)),
        );
        expect((await database.read('$base/mismatched'))!['redeemedCount'], 4);
        expect(
          (await database.read('$base/mismatched'))!['timerStartedAt'],
          Timestamp.fromDate(newerAnchor),
        );
        expect(database.committedFinalizations, 1);
        expect(database.rolledBackReads, 2);
        expect(
          DemoRedemptionStore.isAvailable('absent', 'Once per customer'),
          isFalse,
        );
        final preferences = await SharedPreferences.getInstance();
        expect(
          preferences.getString('guest_coupon_redemptions_guest-test-device'),
          guestHistory,
        );
        expect(await database.read(otherPath), otherBefore);
        expect(await database.read(devicePath), deviceBefore);

        // Repeating completion cannot increment a matching account twice.
        DemoRedemptionStore.seedMemoryForTesting(
          loadedUid: userId,
          timerStartedAtByCoupon: {'matching': anchor},
        );
        DemoRedemptionStore.hasActiveRedeemTimer('matching');
        await database.waitForTransactions();
        expect((await database.read('$base/matching'))!['redeemedCount'], 3);
        expect(database.committedFinalizations, 1);
      } finally {
        await DemoRedemptionStore.resetForTesting();
        await database.waitForTransactions();
        for (final path in allowedPaths) {
          await database.remove(path);
          expect(await database.read(path), isNull);
        }
        database.close();
      }
    }, _EmulatorHttpOverrides()),
    timeout: const Timeout(Duration(seconds: 45)),
  );
}

class _EmulatorHttpOverrides extends HttpOverrides {}

// Deliberately small emulator-only transport; no Firebase initialization, ADC,
// native host, production fallback, collection scans, or recursive deletion.
class _RestFirestore extends Fake implements FirebaseFirestore {
  _RestFirestore(String host, String project, this.allowedPaths)
    : prefix = 'projects/$project/databases/(default)/documents',
      endpoint = Uri.parse('http://$host/v1/');
  final String prefix;
  final Uri endpoint;
  final Set<String> allowedPaths;
  final HttpClient client = HttpClient();
  int committedFinalizations = 0;
  int rolledBackReads = 0;
  final List<Future<void>> _pending = [];

  String name(String path) {
    if (!allowedPaths.contains(path)) {
      throw StateError('Unowned emulator path.');
    }
    return '$prefix/$path';
  }

  Future<dynamic> request(
    String method,
    String resource, [
    Object? body,
  ]) async {
    final request = await client.openUrl(method, endpoint.resolve(resource));
    request.followRedirects = false;
    // Fixed emulator-only Admin marker, never a real credential.
    request.headers.set(HttpHeaders.authorizationHeader, 'Bearer owner');
    if (body != null) {
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode(body));
    }
    final response = await request.close();
    final text = await response.transform(utf8.decoder).join();
    if (response.statusCode == 404) return null;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Local emulator HTTP ${response.statusCode}.');
    }
    return text.isEmpty ? null : jsonDecode(text);
  }

  Future<void> seed(String path, Map<String, dynamic> data) async {
    await request('PATCH', name(path), {
      'fields': {
        for (final entry in data.entries) entry.key: _encode(entry.value),
      },
    });
  }

  Future<Map<String, dynamic>?> read(String path) async {
    final document = await request('GET', name(path));
    return document == null ? null : _fields(document['fields']);
  }

  Future<void> remove(String path) async => request('DELETE', name(path));
  void close() => client.close(force: true);
  Future<void> waitForTransactions() async {
    // Finalization is deliberately scheduled after an auth-read Future.
    await Future<void>.delayed(Duration.zero);
    await Future.wait(_pending);
  }

  @override
  CollectionReference<Map<String, dynamic>> collection(String path) =>
      _RestCollection(this, path);

  @override
  Future<T> runTransaction<T>(
    TransactionHandler<T> handler, {
    Duration timeout = const Duration(seconds: 30),
    int maxAttempts = 5,
  }) {
    final future = _runTransaction(handler);
    _pending.add(future.then<void>((_) {}));
    return future;
  }

  Future<T> _runTransaction<T>(TransactionHandler<T> handler) async {
    final begun = await request('POST', '$prefix:beginTransaction', {
      'options': {'readWrite': {}},
    });
    final transaction = _RestTransaction(this, begun['transaction'] as String);
    try {
      final result = await handler(transaction);
      if (transaction.writes.isEmpty) {
        await request('POST', '$prefix:rollback', {
          'transaction': transaction.token,
        });
        rolledBackReads++;
      } else {
        await request('POST', '$prefix:commit', {
          'transaction': transaction.token,
          'writes': transaction.writes,
        });
        committedFinalizations++;
      }
      return result;
    } catch (_) {
      await request('POST', '$prefix:rollback', {
        'transaction': transaction.token,
      });
      rethrow;
    }
  }
}

// ignore: subtype_of_sealed_class
class _RestCollection extends Fake
    implements CollectionReference<Map<String, dynamic>> {
  _RestCollection(this.database, this.path);
  final _RestFirestore database;
  @override
  final String path;
  @override
  DocumentReference<Map<String, dynamic>> doc([String? id]) =>
      _RestDocument(database, '$path/$id');
}

// ignore: subtype_of_sealed_class
class _RestDocument extends Fake
    implements DocumentReference<Map<String, dynamic>> {
  _RestDocument(this.database, this.path);
  final _RestFirestore database;
  @override
  final String path;
  @override
  CollectionReference<Map<String, dynamic>> collection(String child) =>
      _RestCollection(database, '$path/$child');
}

// ignore: subtype_of_sealed_class
class _RestSnapshot<T extends Object?> extends Fake
    implements DocumentSnapshot<T> {
  _RestSnapshot(this.value);
  final T? value;
  @override
  T? data() => value;
}

class _RestTransaction extends Fake implements Transaction {
  _RestTransaction(this.database, this.token);
  final _RestFirestore database;
  final String token;
  final List<Map<String, dynamic>> writes = [];
  @override
  Future<DocumentSnapshot<T>> get<T extends Object?>(
    DocumentReference<T> ref,
  ) async {
    final result = await database.request(
      'POST',
      '${database.prefix}:batchGet',
      {
        'documents': [database.name(ref.path)],
        'transaction': token,
      },
    );
    final found = (result as List).single['found'];
    return _RestSnapshot<T>(
      found == null ? null : _fields(found['fields']) as T,
    );
  }

  @override
  Transaction set<T>(DocumentReference<T> ref, T data, [SetOptions? options]) {
    if (options?.merge != true) {
      throw StateError('Only merge writes supported.');
    }
    final fields = <String, dynamic>{};
    final mask = <String>[];
    final transforms = <Map<String, dynamic>>[];
    for (final entry in (data as Map<String, dynamic>).entries) {
      final value = entry.value;
      if (value == FieldValue.serverTimestamp()) {
        transforms.add({
          'fieldPath': entry.key,
          'setToServerValue': 'REQUEST_TIME',
        });
      } else if (value == FieldValue.increment(1)) {
        transforms.add({
          'fieldPath': entry.key,
          'increment': {'integerValue': '1'},
        });
      } else {
        mask.add(entry.key);
        if (value != FieldValue.delete()) fields[entry.key] = _encode(value);
      }
    }
    writes.add({
      'update': {'name': database.name(ref.path), 'fields': fields},
      'updateMask': {'fieldPaths': mask},
      if (transforms.isNotEmpty) 'updateTransforms': transforms,
    });
    return this;
  }
}

Map<String, dynamic> _encode(dynamic value) => switch (value) {
  String text => {'stringValue': text},
  int number => {'integerValue': '$number'},
  Timestamp timestamp => {
    'timestampValue': timestamp.toDate().toUtc().toIso8601String(),
  },
  _ => throw StateError('Unsupported emulator fixture value.'),
};
Map<String, dynamic> _fields(dynamic fields) => {
  for (final entry in (fields as Map<String, dynamic>).entries)
    entry.key: switch (entry.value) {
      {'stringValue': final String text} => text,
      {'integerValue': final String integer} => int.parse(integer),
      {'timestampValue': final String timestamp} => Timestamp.fromDate(
        DateTime.parse(timestamp),
      ),
      _ => throw StateError('Unsupported emulator response value.'),
    },
};
