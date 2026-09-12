import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/customer_bitesaver_favorite.dart';

final class CustomerBiteSaverFavoriteUser {
  final String uid;
  final bool isAnonymous;

  const CustomerBiteSaverFavoriteUser({
    required this.uid,
    required this.isAnonymous,
  });
}

abstract interface class CustomerBiteSaverFavoriteAuth {
  CustomerBiteSaverFavoriteUser? get currentUser;
}

final class FirebaseCustomerBiteSaverFavoriteAuth
    implements CustomerBiteSaverFavoriteAuth {
  final FirebaseAuth _auth;

  FirebaseCustomerBiteSaverFavoriteAuth(this._auth);

  @override
  CustomerBiteSaverFavoriteUser? get currentUser {
    final user = _auth.currentUser;
    if (user == null) {
      return null;
    }
    return CustomerBiteSaverFavoriteUser(
      uid: user.uid,
      isAnonymous: user.isAnonymous,
    );
  }
}

final class CustomerBiteSaverFavoriteStoredDocument {
  final String id;
  final String path;
  final Map<String, dynamic> data;

  const CustomerBiteSaverFavoriteStoredDocument({
    required this.id,
    required this.path,
    required this.data,
  });
}

abstract interface class CustomerBiteSaverFavoriteTransaction {
  Future<CustomerBiteSaverFavoriteStoredDocument?> getDocument(String path);

  void setDocument(String path, Map<String, dynamic> data);
}

abstract interface class CustomerBiteSaverFavoriteStore {
  Object serverTimestamp();

  DateTime? decodeTimestamp(Object? value);

  Future<T> runTransaction<T>(
    Future<T> Function(CustomerBiteSaverFavoriteTransaction transaction)
    operation,
  );

  Future<void> deleteDocument(String path);
}

final class FirestoreCustomerBiteSaverFavoriteStore
    implements CustomerBiteSaverFavoriteStore {
  final FirebaseFirestore _firestore;

  FirestoreCustomerBiteSaverFavoriteStore(this._firestore);

  @override
  Object serverTimestamp() => FieldValue.serverTimestamp();

  @override
  DateTime? decodeTimestamp(Object? value) {
    return value is Timestamp ? value.toDate() : null;
  }

  @override
  Future<T> runTransaction<T>(
    Future<T> Function(CustomerBiteSaverFavoriteTransaction transaction)
    operation,
  ) {
    return _firestore.runTransaction<T>((transaction) {
      return operation(
        _FirestoreCustomerBiteSaverFavoriteTransaction(
          firestore: _firestore,
          transaction: transaction,
        ),
      );
    });
  }

  @override
  Future<void> deleteDocument(String path) {
    return _firestore.doc(path).delete();
  }
}

final class _FirestoreCustomerBiteSaverFavoriteTransaction
    implements CustomerBiteSaverFavoriteTransaction {
  final FirebaseFirestore firestore;
  final Transaction transaction;

  const _FirestoreCustomerBiteSaverFavoriteTransaction({
    required this.firestore,
    required this.transaction,
  });

  @override
  Future<CustomerBiteSaverFavoriteStoredDocument?> getDocument(
    String path,
  ) async {
    final snapshot = await transaction.get(firestore.doc(path));
    final data = snapshot.data();
    if (!snapshot.exists || data == null) {
      return null;
    }
    return CustomerBiteSaverFavoriteStoredDocument(
      id: snapshot.id,
      path: snapshot.reference.path,
      data: data,
    );
  }

  @override
  void setDocument(String path, Map<String, dynamic> data) {
    transaction.set(firestore.doc(path), data);
  }
}

final class CustomerBiteSaverFavoriteStateException implements Exception {
  final String message;

  const CustomerBiteSaverFavoriteStateException([
    this.message = 'The saved BiteSaver item has invalid state.',
  ]);

  @override
  String toString() => 'CustomerBiteSaverFavoriteStateException: $message';
}

final class CustomerBiteSaverFavoriteService {
  static const String loginRequiredMessage = 'Please sign in to continue';

  final CustomerBiteSaverFavoriteAuth _auth;
  final CustomerBiteSaverFavoriteStore _store;

  const CustomerBiteSaverFavoriteService({
    required CustomerBiteSaverFavoriteAuth auth,
    required CustomerBiteSaverFavoriteStore store,
  }) : _auth = auth,
       _store = store;

  factory CustomerBiteSaverFavoriteService.firebase({
    FirebaseAuth? auth,
    FirebaseFirestore? firestore,
  }) {
    return CustomerBiteSaverFavoriteService(
      auth: FirebaseCustomerBiteSaverFavoriteAuth(
        auth ?? FirebaseAuth.instance,
      ),
      store: FirestoreCustomerBiteSaverFavoriteStore(
        firestore ?? FirebaseFirestore.instance,
      ),
    );
  }

  Future<void> upsertRestaurantFavorite(
    CustomerBiteSaverRestaurantFavoriteIdentity identity,
  ) async {
    final userId = _requireCurrentUserId();
    final path = _restaurantPath(userId, identity.restaurantId);
    await _store.runTransaction<void>((transaction) async {
      final existing = await transaction.getDocument(path);
      final createdAt = _createdAtForRestaurantUpdate(
        existing: existing,
        expectedPath: path,
        userId: userId,
        identity: identity,
      );
      final serverTimestamp = _store.serverTimestamp();
      transaction.setDocument(
        path,
        CustomerBiteSaverFavoriteContract.restaurantDocument(
          userId: userId,
          identity: identity,
          createdAt: createdAt ?? serverTimestamp,
          updatedAt: serverTimestamp,
        ),
      );
    });
  }

  Future<void> removeRestaurantFavorite(
    CustomerBiteSaverRestaurantId restaurantId,
  ) async {
    final userId = _requireCurrentUserId();
    await _store.deleteDocument(_restaurantPath(userId, restaurantId));
  }

  Future<void> upsertCouponFavorite(
    CustomerBiteSaverCouponFavoriteIdentity identity,
  ) async {
    final userId = _requireCurrentUserId();
    final path = _couponPath(userId, identity.offerId);
    await _store.runTransaction<void>((transaction) async {
      final existing = await transaction.getDocument(path);
      final createdAt = _createdAtForCouponUpdate(
        existing: existing,
        expectedPath: path,
        userId: userId,
        identity: identity,
      );
      final serverTimestamp = _store.serverTimestamp();
      transaction.setDocument(
        path,
        CustomerBiteSaverFavoriteContract.couponDocument(
          userId: userId,
          identity: identity,
          createdAt: createdAt ?? serverTimestamp,
          updatedAt: serverTimestamp,
        ),
      );
    });
  }

  Future<void> removeCouponFavorite(CustomerBiteSaverOfferId offerId) async {
    final userId = _requireCurrentUserId();
    await _store.deleteDocument(_couponPath(userId, offerId));
  }

  Object? _createdAtForRestaurantUpdate({
    required CustomerBiteSaverFavoriteStoredDocument? existing,
    required String expectedPath,
    required String userId,
    required CustomerBiteSaverRestaurantFavoriteIdentity identity,
  }) {
    if (existing == null) {
      return null;
    }
    if (existing.id != identity.restaurantId.value ||
        existing.path != expectedPath ||
        !CustomerBiteSaverFavoriteContract.isValidRestaurantDocument(
          data: existing.data,
          userId: userId,
          identity: identity,
          decodeTimestamp: _store.decodeTimestamp,
        )) {
      throw const CustomerBiteSaverFavoriteStateException();
    }
    return existing.data['createdAt'];
  }

  Object? _createdAtForCouponUpdate({
    required CustomerBiteSaverFavoriteStoredDocument? existing,
    required String expectedPath,
    required String userId,
    required CustomerBiteSaverCouponFavoriteIdentity identity,
  }) {
    if (existing == null) {
      return null;
    }
    if (existing.id != identity.offerId.value ||
        existing.path != expectedPath ||
        !CustomerBiteSaverFavoriteContract.isValidCouponDocument(
          data: existing.data,
          userId: userId,
          identity: identity,
          decodeTimestamp: _store.decodeTimestamp,
        )) {
      throw const CustomerBiteSaverFavoriteStateException();
    }
    return existing.data['createdAt'];
  }

  String _requireCurrentUserId() {
    final user = _auth.currentUser;
    if (user == null || user.isAnonymous) {
      throw ArgumentError(loginRequiredMessage);
    }
    final userId = user.uid;
    if (userId.isEmpty ||
        userId == '.' ||
        userId == '..' ||
        RegExp(r'^__.*__$').hasMatch(userId) ||
        userId.contains('/')) {
      throw const CustomerBiteSaverFavoriteStateException(
        'The signed-in customer identity is invalid.',
      );
    }
    try {
      if (utf8.encode(userId).length > 1500) {
        throw const CustomerBiteSaverFavoriteStateException(
          'The signed-in customer identity is invalid.',
        );
      }
    } on FormatException {
      throw const CustomerBiteSaverFavoriteStateException(
        'The signed-in customer identity is invalid.',
      );
    }
    return userId;
  }

  static String _restaurantPath(
    String userId,
    CustomerBiteSaverRestaurantId restaurantId,
  ) {
    return 'user_profiles/$userId/favorite_restaurants/${restaurantId.value}';
  }

  static String _couponPath(String userId, CustomerBiteSaverOfferId offerId) {
    return 'user_profiles/$userId/favorite_coupons/${offerId.value}';
  }
}
