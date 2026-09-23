import 'dart:convert';
import 'dart:math';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:shared_preferences/shared_preferences.dart';

const accountDeletionRoute = '/account/delete';
typedef AccountDeletionInvoker =
    Future<Object?> Function(String name, Map<String, Object?> payload);

class AccountDeletionStatus {
  final String operationId;
  final String state;
  final String? reason;
  const AccountDeletionStatus(this.operationId, this.state, this.reason);
  factory AccountDeletionStatus.parse(Object? raw) {
    if (raw is! Map ||
        raw['schemaVersion'] != 1 ||
        raw['receiptAccepted'] != true ||
        raw['operationId'] is! String ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(raw['operationId'] as String) ||
        !const [
          'requested',
          'processing',
          'pending',
          'complete',
        ].contains(raw['state']) ||
        !const [
          null,
          'billing',
          'ownership',
          'media',
          'provider',
          'accepted_work',
          'temporary_failure',
          'identity_changed',
        ].contains(raw['reason'])) {
      throw const FormatException('Deletion status is unavailable.');
    }
    return AccountDeletionStatus(
      raw['operationId'] as String,
      raw['state'] as String,
      raw['reason'] as String?,
    );
  }
}

class AccountDeletionService {
  final AccountDeletionInvoker invoke;
  const AccountDeletionService(this.invoke);
  factory AccountDeletionService.production() => AccountDeletionService((
    name,
    payload,
  ) async {
    FirebaseFunctions functions;
    if (name == 'getAccountDeletionStatus') {
      // A separate unauthenticated local SDK instance prevents an expired A
      // token from blocking receipt recovery after Auth is removed. No user is
      // ever signed into this instance, and it cannot submit deletion requests.
      const receiptAppName = 'bitestar-deletion-receipt';
      final matching = Firebase.apps.where((app) => app.name == receiptAppName);
      final app = matching.isNotEmpty
          ? matching.first
          : await Firebase.initializeApp(
              name: receiptAppName,
              options: Firebase.app().options,
            );
      functions = FirebaseFunctions.instanceFor(
        app: app,
        region: 'us-central1',
      );
    } else {
      functions = FirebaseFunctions.instanceFor(region: 'us-central1');
    }
    return (await functions.httpsCallable(name).call<Object?>(payload)).data;
  });
  Future<AccountDeletionStatus> request(
    String expectedUid,
    String receipt,
  ) async => AccountDeletionStatus.parse(
    await invoke('requestAccountDeletion', {
      'schemaVersion': 1,
      'expectedUid': expectedUid,
      'confirmation': 'DELETE',
      'receipt': receipt,
    }),
  );
  Future<AccountDeletionStatus> status(String receipt) async =>
      AccountDeletionStatus.parse(
        await invoke('getAccountDeletionStatus', {
          'schemaVersion': 1,
          'receipt': receipt,
        }),
      );
}

class AccountDeletionReceipt {
  final String uid;
  final String value;
  const AccountDeletionReceipt(this.uid, this.value);
  static AccountDeletionReceipt create(String uid) => AccountDeletionReceipt(
    uid,
    base64UrlEncode(
      List<int>.generate(32, (_) => Random.secure().nextInt(256)),
    ).replaceAll('=', ''),
  );
}

abstract class AccountDeletionReceiptStore {
  Future<AccountDeletionReceipt?> load(String? uid);
  Future<void> save(AccountDeletionReceipt receipt);
}

class LocalAccountDeletionReceiptStore implements AccountDeletionReceiptStore {
  static const _key = 'bitestar.accountDeletion.receipts.v1';
  @override
  Future<AccountDeletionReceipt?> load(String? uid) async {
    final prefs = await SharedPreferences.getInstance();
    final rows = prefs.getStringList(_key) ?? [];
    for (final row in rows.reversed) {
      try {
        final data = jsonDecode(row) as Map<String, dynamic>;
        if ((uid == null || data['uid'] == uid) &&
            data['uid'] is String &&
            data['receipt'] is String &&
            RegExp(
              r'^[A-Za-z0-9_-]{43}$',
            ).hasMatch(data['receipt'] as String)) {
          return AccountDeletionReceipt(
            data['uid'] as String,
            data['receipt'] as String,
          );
        }
      } catch (_) {
        /* Malformed local data grants no authority. */
      }
    }
    return null;
  }

  @override
  Future<void> save(AccountDeletionReceipt receipt) async {
    final prefs = await SharedPreferences.getInstance();
    final rows = (prefs.getStringList(_key) ?? []).where((row) {
      try {
        return (jsonDecode(row) as Map)['uid'] != receipt.uid;
      } catch (_) {
        return false;
      }
    }).toList();
    rows.add(jsonEncode({'uid': receipt.uid, 'receipt': receipt.value}));
    if (!await prefs.setStringList(_key, rows)) {
      throw StateError('Could not save deletion receipt.');
    }
  }
}
