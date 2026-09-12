import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/models/customer_bitesaver_favorite.dart';
import 'package:coupon_app/services/customer_bitesaver_favorite_service.dart';
import 'package:flutter_test/flutter_test.dart';

const String _fixturePath =
    'test/fixtures/customer_bitesaver_favorite_contract_v1.json';

void main() {
  late Map<String, dynamic> fixture;
  late _FakeFavoriteStore store;
  late _FakeFavoriteAuth auth;
  late CustomerBiteSaverFavoriteService service;

  setUpAll(() {
    fixture =
        jsonDecode(File(_fixturePath).readAsStringSync())
            as Map<String, dynamic>;
  });

  setUp(() {
    store = _FakeFavoriteStore();
    auth = _FakeFavoriteAuth(
      CustomerBiteSaverFavoriteUser(
        uid: fixture['userId']! as String,
        isAnonymous: false,
      ),
    );
    service = CustomerBiteSaverFavoriteService(auth: auth, store: store);
  });

  test(
    'shared fixture and typed public identities use the exact v1 contract',
    () {
      expect(
        fixture['contractVersion'],
        CustomerBiteSaverFavoriteContract.contractVersion,
      );
      expect(
        fixture['schemaVersion'],
        CustomerBiteSaverFavoriteContract.schemaVersion,
      );

      final restaurantId = CustomerBiteSaverRestaurantId(
        fixture['restaurantId']! as String,
      );
      final offerId = CustomerBiteSaverOfferId(fixture['offerId']! as String);
      expect(restaurantId.value, fixture['restaurantId']);
      expect(offerId.value, fixture['offerId']);

      for (final invalid in <String>[
        ' ${restaurantId.value}',
        '${restaurantId.value} ',
        restaurantId.value.substring(0, restaurantId.value.length - 1),
        'bsr_${'A' * 42}/',
      ]) {
        expect(
          () => CustomerBiteSaverRestaurantId(invalid),
          throwsFormatException,
          reason: invalid,
        );
      }
      for (final invalid in <String>[
        ' ${offerId.value}',
        '${offerId.value} ',
        offerId.value.substring(0, offerId.value.length - 1),
        'bso_${'B' * 42}/',
      ]) {
        expect(
          () => CustomerBiteSaverOfferId(invalid),
          throwsFormatException,
          reason: invalid,
        );
      }
    },
  );

  test('restaurant upsert matches fixture and preserves creation time', () async {
    final restaurantId = CustomerBiteSaverRestaurantId(
      fixture['restaurantId']! as String,
    );
    final identity = CustomerBiteSaverRestaurantFavoriteIdentity(
      restaurantId: restaurantId,
    );
    final path =
        'user_profiles/${fixture['userId']}/favorite_restaurants/${restaurantId.value}';

    await service.upsertRestaurantFavorite(identity);

    expect(store.readPaths, <String>[path]);
    expect(store.setWrites, hasLength(1));
    expect(store.setWrites.single.path, path);
    expect(
      _normalizedWrite(store.setWrites.single.data, fixture),
      _record(fixture['restaurantCreate']),
    );
    final createdAt = store.documents[path]!.data['createdAt'];
    expect(createdAt, store.now);
    expect(
      store.documents[path]!.data.keys.toSet(),
      CustomerBiteSaverFavoriteContract.restaurantFields,
    );

    store.now = store.now.add(const Duration(minutes: 5));
    await service.upsertRestaurantFavorite(identity);

    expect(store.setWrites, hasLength(2));
    expect(store.setWrites.last.data['createdAt'], same(createdAt));
    expect(store.setWrites.last.data['updatedAt'], isA<_ServerTimestamp>());
    expect(store.documents[path]!.data['createdAt'], same(createdAt));
    expect(store.documents[path]!.data['updatedAt'], store.now);

    await service.removeRestaurantFavorite(restaurantId);
    await service.removeRestaurantFavorite(restaurantId);
    expect(store.documents.containsKey(path), isFalse);
    expect(store.deletedPaths, <String>[path, path]);
  });

  test(
    'coupon upsert matches fixture and keeps parent identity bound',
    () async {
      final restaurantId = CustomerBiteSaverRestaurantId(
        fixture['restaurantId']! as String,
      );
      final offerId = CustomerBiteSaverOfferId(fixture['offerId']! as String);
      final identity = CustomerBiteSaverCouponFavoriteIdentity(
        restaurantId: restaurantId,
        offerId: offerId,
      );
      final path =
          'user_profiles/${fixture['userId']}/favorite_coupons/${offerId.value}';

      await service.upsertCouponFavorite(identity);

      expect(store.setWrites, hasLength(1));
      expect(store.setWrites.single.path, path);
      expect(
        _normalizedWrite(store.setWrites.single.data, fixture),
        _record(fixture['couponCreate']),
      );
      expect(
        store.documents[path]!.data.keys.toSet(),
        CustomerBiteSaverFavoriteContract.couponFields,
      );

      final createdAt = store.documents[path]!.data['createdAt'];
      store.now = store.now.add(const Duration(seconds: 1));
      await service.upsertCouponFavorite(identity);
      expect(store.setWrites.last.data['createdAt'], same(createdAt));
      expect(store.documents[path]!.data['updatedAt'], store.now);

      await service.removeCouponFavorite(offerId);
      await service.removeCouponFavorite(offerId);
      expect(store.documents.containsKey(path), isFalse);
      expect(store.deletedPaths, <String>[path, path]);
    },
  );

  test(
    'malformed existing canonical state is surfaced without overwrite',
    () async {
      final restaurantId = CustomerBiteSaverRestaurantId(
        fixture['restaurantId']! as String,
      );
      final identity = CustomerBiteSaverRestaurantFavoriteIdentity(
        restaurantId: restaurantId,
      );
      final path =
          'user_profiles/${fixture['userId']}/favorite_restaurants/${restaurantId.value}';
      store.seed(path, <String, dynamic>{
        ..._record(fixture['restaurantCreate']),
        'createdAt': store.now,
        'updatedAt': store.now,
        'unexpected': true,
      });

      await expectLater(
        service.upsertRestaurantFavorite(identity),
        throwsA(isA<CustomerBiteSaverFavoriteStateException>()),
      );
      expect(store.setWrites, isEmpty);

      final offerId = CustomerBiteSaverOfferId(fixture['offerId']! as String);
      final couponIdentity = CustomerBiteSaverCouponFavoriteIdentity(
        restaurantId: restaurantId,
        offerId: offerId,
      );
      final couponPath =
          'user_profiles/${fixture['userId']}/favorite_coupons/${offerId.value}';
      store.seed(couponPath, <String, dynamic>{
        ..._record(fixture['couponCreate']),
        'restaurantId': 'bsr_${'C' * 43}',
        'createdAt': store.now,
        'updatedAt': store.now,
      });

      await expectLater(
        service.upsertCouponFavorite(couponIdentity),
        throwsA(isA<CustomerBiteSaverFavoriteStateException>()),
      );
      expect(store.setWrites, isEmpty);
    },
  );

  test('auth and store failures are surfaced without false success', () async {
    final identity = CustomerBiteSaverRestaurantFavoriteIdentity(
      restaurantId: CustomerBiteSaverRestaurantId(
        fixture['restaurantId']! as String,
      ),
    );

    auth.current = null;
    await expectLater(
      service.upsertRestaurantFavorite(identity),
      throwsArgumentError,
    );
    auth.current = CustomerBiteSaverFavoriteUser(
      uid: fixture['userId']! as String,
      isAnonymous: true,
    );
    await expectLater(
      service.upsertRestaurantFavorite(identity),
      throwsArgumentError,
    );
    expect(store.readPaths, isEmpty);
    expect(store.setWrites, isEmpty);

    for (final invalidUserId in <String>[
      '.',
      '..',
      '__reserved__',
      'user/child',
      'é' * 751,
    ]) {
      auth.current = CustomerBiteSaverFavoriteUser(
        uid: invalidUserId,
        isAnonymous: false,
      );
      await expectLater(
        service.upsertRestaurantFavorite(identity),
        throwsA(isA<CustomerBiteSaverFavoriteStateException>()),
      );
    }

    auth.current = CustomerBiteSaverFavoriteUser(
      uid: fixture['userId']! as String,
      isAnonymous: false,
    );
    store.transactionFailure = StateError('synthetic write failure');
    await expectLater(
      service.upsertRestaurantFavorite(identity),
      throwsA(isA<StateError>()),
    );

    store.transactionFailure = null;
    store.deleteFailure = StateError('synthetic delete failure');
    await expectLater(
      service.removeRestaurantFavorite(identity.restaurantId),
      throwsA(isA<StateError>()),
    );
  });
}

Map<String, dynamic> _record(Object? value) {
  return Map<String, dynamic>.from(value! as Map);
}

Map<String, dynamic> _normalizedWrite(
  Map<String, dynamic> data,
  Map<String, dynamic> fixture,
) {
  return data.map((key, value) {
    return MapEntry(
      key,
      value is _ServerTimestamp ? fixture['serverTimestampMarker'] : value,
    );
  });
}

final class _FakeFavoriteAuth implements CustomerBiteSaverFavoriteAuth {
  CustomerBiteSaverFavoriteUser? current;

  _FakeFavoriteAuth(this.current);

  @override
  CustomerBiteSaverFavoriteUser? get currentUser => current;
}

final class _ServerTimestamp {
  const _ServerTimestamp();
}

final class _CapturedWrite {
  final String path;
  final Map<String, dynamic> data;

  const _CapturedWrite({required this.path, required this.data});
}

final class _FakeFavoriteStore implements CustomerBiteSaverFavoriteStore {
  static const _ServerTimestamp _serverTimestamp = _ServerTimestamp();

  DateTime now = DateTime.utc(2026, 9, 11, 22);
  final Map<String, CustomerBiteSaverFavoriteStoredDocument> documents =
      <String, CustomerBiteSaverFavoriteStoredDocument>{};
  final List<String> readPaths = <String>[];
  final List<_CapturedWrite> setWrites = <_CapturedWrite>[];
  final List<String> deletedPaths = <String>[];
  Object? transactionFailure;
  Object? deleteFailure;

  @override
  Object serverTimestamp() => _serverTimestamp;

  @override
  DateTime? decodeTimestamp(Object? value) => value is DateTime ? value : null;

  @override
  Future<T> runTransaction<T>(
    Future<T> Function(CustomerBiteSaverFavoriteTransaction transaction)
    operation,
  ) async {
    final failure = transactionFailure;
    if (failure != null) {
      throw failure;
    }
    return operation(_FakeFavoriteTransaction(this));
  }

  @override
  Future<void> deleteDocument(String path) async {
    final failure = deleteFailure;
    if (failure != null) {
      throw failure;
    }
    deletedPaths.add(path);
    documents.remove(path);
  }

  void seed(String path, Map<String, dynamic> data) {
    documents[path] = CustomerBiteSaverFavoriteStoredDocument(
      id: path.split('/').last,
      path: path,
      data: Map<String, dynamic>.from(data),
    );
  }

  void captureSet(String path, Map<String, dynamic> data) {
    final captured = Map<String, dynamic>.from(data);
    setWrites.add(_CapturedWrite(path: path, data: captured));
    documents[path] = CustomerBiteSaverFavoriteStoredDocument(
      id: path.split('/').last,
      path: path,
      data: captured.map((key, value) {
        return MapEntry(key, value is _ServerTimestamp ? now : value);
      }),
    );
  }
}

final class _FakeFavoriteTransaction
    implements CustomerBiteSaverFavoriteTransaction {
  final _FakeFavoriteStore store;

  const _FakeFavoriteTransaction(this.store);

  @override
  Future<CustomerBiteSaverFavoriteStoredDocument?> getDocument(
    String path,
  ) async {
    store.readPaths.add(path);
    return store.documents[path];
  }

  @override
  void setDocument(String path, Map<String, dynamic> data) {
    store.captureSet(path, data);
  }
}
