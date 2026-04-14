import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/coupon.dart';
import '../models/restaurant.dart';

class RestaurantAccountService {
  static final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  static DocumentReference<Map<String, dynamic>> docForUser(String uid) {
    return _firestore.collection('restaurant_accounts').doc(uid);
  }

  static CollectionReference<Map<String, dynamic>> couponsCollection(
    String uid,
  ) {
    return docForUser(uid).collection('coupons');
  }

  static CollectionReference<Map<String, dynamic>>
  restaurantNameChangeRequestsCollection() {
    return _firestore.collection('restaurant_name_change_requests');
  }

  static Future<void> createOrUpdateAccountRecord(
    User user, {
    String? restaurantName,
    String? streetAddress,
    String? city,
    String? zipCode,
    String? phone,
    bool markApplicationSubmitted = false,
  }) async {
    final doc = docForUser(user.uid);
    final snapshot = await doc.get();
    final trimmedRestaurantName = restaurantName?.trim();
    final trimmedStreetAddress = streetAddress?.trim();
    final trimmedCity = city?.trim();
    final trimmedZipCode = zipCode?.trim();
    final trimmedPhone = phone?.trim();

    if (!snapshot.exists) {
      await doc.set({
        Restaurant.fieldUid: user.uid,
        Restaurant.fieldEmail: user.email,
        if (trimmedRestaurantName != null && trimmedRestaurantName.isNotEmpty)
          Restaurant.fieldName: trimmedRestaurantName,
        if (trimmedStreetAddress != null && trimmedStreetAddress.isNotEmpty)
          Restaurant.fieldStreetAddress: trimmedStreetAddress,
        if (trimmedCity != null && trimmedCity.isNotEmpty)
          Restaurant.fieldCity: trimmedCity,
        if (trimmedZipCode != null && trimmedZipCode.isNotEmpty)
          Restaurant.fieldZipCode: trimmedZipCode,
        if (trimmedPhone != null && trimmedPhone.isNotEmpty)
          Restaurant.fieldPhone: trimmedPhone,
        'emailVerified': user.emailVerified,
        if (markApplicationSubmitted) 'couponApplicationSubmitted': true,
        if (markApplicationSubmitted) Restaurant.fieldApprovalStatus: 'pending',
        Restaurant.fieldCreatedAt: FieldValue.serverTimestamp(),
        Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    await doc.set({
      Restaurant.fieldUid: user.uid,
      Restaurant.fieldEmail: user.email,
      if (trimmedRestaurantName != null && trimmedRestaurantName.isNotEmpty)
        Restaurant.fieldName: trimmedRestaurantName,
      if (trimmedStreetAddress != null && trimmedStreetAddress.isNotEmpty)
        Restaurant.fieldStreetAddress: trimmedStreetAddress,
      if (trimmedCity != null && trimmedCity.isNotEmpty)
        Restaurant.fieldCity: trimmedCity,
      if (trimmedZipCode != null && trimmedZipCode.isNotEmpty)
        Restaurant.fieldZipCode: trimmedZipCode,
      if (trimmedPhone != null && trimmedPhone.isNotEmpty)
        Restaurant.fieldPhone: trimmedPhone,
      'emailVerified': user.emailVerified,
      if (markApplicationSubmitted) 'couponApplicationSubmitted': true,
      if (markApplicationSubmitted) Restaurant.fieldApprovalStatus: 'pending',
      if (snapshot.data()?[Restaurant.fieldCreatedAt] == null)
        Restaurant.fieldCreatedAt: FieldValue.serverTimestamp(),
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<void> syncEmailVerified(User user) async {
    await docForUser(user.uid).set({
      'emailVerified': user.emailVerified,
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Stream<DocumentSnapshot<Map<String, dynamic>>> accountStream(
    String uid,
  ) {
    return docForUser(uid).snapshots();
  }

  static Stream<QuerySnapshot<Map<String, dynamic>>> allAccountsStream() {
    return _firestore.collection('restaurant_accounts').snapshots();
  }

  static Stream<QuerySnapshot<Map<String, dynamic>>>
  couponApplicationsAdminStream() {
    return _firestore
        .collection('restaurant_accounts')
        .where('couponApplicationSubmitted', isEqualTo: true)
        .snapshots();
  }

  static Stream<QuerySnapshot<Map<String, dynamic>>>
  pendingRestaurantNameChangeRequestsStream() {
    return restaurantNameChangeRequestsCollection()
        .where('status', isEqualTo: 'pending')
        .snapshots();
  }

  static Stream<QuerySnapshot<Map<String, dynamic>>> approvedAccountsStream() {
    return _firestore
        .collection('restaurant_accounts')
        .where(Restaurant.fieldApprovalStatus, isEqualTo: 'approved')
        .snapshots();
  }

  static Future<void> approveAccount(String uid) async {
    await docForUser(uid).set({
      Restaurant.fieldApprovalStatus: 'approved',
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<void> rejectAccount(String uid) async {
    await docForUser(uid).set({
      Restaurant.fieldApprovalStatus: 'rejected',
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<void> approveRestaurantNameChangeRequest({
    required String requestId,
    required String uid,
    required String requestedRestaurantName,
  }) async {
    final batch = _firestore.batch();
    batch.set(docForUser(uid), {
      Restaurant.fieldName: requestedRestaurantName.trim(),
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
    batch.set(restaurantNameChangeRequestsCollection().doc(requestId), {
      'status': 'approved',
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
    await batch.commit();
  }

  static Future<void> rejectRestaurantNameChangeRequest(String requestId) async {
    await restaurantNameChangeRequestsCollection().doc(requestId).set({
      'status': 'rejected',
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<Map<String, dynamic>?> getAccountData(String uid) async {
    final snapshot = await docForUser(uid).get();
    final data = snapshot.data();
    if (data == null) {
      return null;
    }

    return _normalizedRestaurantAccountData(data, fallbackUid: uid);
  }

  static Future<bool> canPostCoupons(String uid) async {
    final data = await getAccountData(uid);
    return hasCouponPostingAccess(data);
  }

  static bool hasCouponPostingAccess(Map<String, dynamic>? data) {
    return _canPostCouponsFromData(data);
  }

  static bool hasSubmittedCouponApplication(Map<String, dynamic>? data) {
    if (data == null) {
      return false;
    }

    final explicitFlag = _readBool(data['couponApplicationSubmitted']);
    if (explicitFlag == true) {
      return true;
    }

    final approvalStatus =
        (_readString(data[Restaurant.fieldApprovalStatus]) ?? 'pending')
            .toLowerCase();
    if (approvalStatus == 'approved' || approvalStatus == 'rejected') {
      return true;
    }

    return (_readString(data[Restaurant.fieldName]) ?? '').isNotEmpty &&
        (_readString(data[Restaurant.fieldStreetAddress]) ?? '').isNotEmpty &&
        (_readString(data[Restaurant.fieldCity]) ?? '').isNotEmpty &&
        (_readString(data[Restaurant.fieldZipCode]) ?? '').isNotEmpty &&
        (_readString(data[Restaurant.fieldPhone]) ?? '').isNotEmpty;
  }

  static Future<void> saveRestaurantProfile({
    required String uid,
    required String name,
    required String city,
    required String zipCode,
    required String email,
    required String phone,
    required String streetAddress,
    required String website,
    required String bio,
    required List<RestaurantBusinessHours> businessHours,
    required double? latitude,
    required double? longitude,
  }) async {
    final restaurant = Restaurant(
      name: name.trim(),
      distance: Restaurant.defaultDistanceLabel,
      city: city.trim(),
      zipCode: zipCode.trim(),
      coupons: const [],
      phone: phone.trim().isEmpty ? null : phone.trim(),
      streetAddress: streetAddress.trim().isEmpty ? null : streetAddress.trim(),
      website: website.trim().isEmpty ? null : website.trim(),
      bio: bio.trim().isEmpty ? null : bio.trim(),
      businessHours: businessHours.isEmpty
          ? const []
          : RestaurantBusinessHours.normalizedWeek(businessHours),
      latitude: latitude,
      longitude: longitude,
    );

    final validationError = restaurant.validateRequiredFields();
    if (validationError != null || email.trim().isEmpty) {
      throw ArgumentError(
        validationError ?? 'Restaurant email is required.',
      );
    }

    await docForUser(uid).set({
      Restaurant.fieldUid: uid,
      ...restaurant.toProfileFirestoreMap(
        email: email,
        phone: phone,
        streetAddress: streetAddress,
        website: website,
        bio: bio,
        businessHours: businessHours,
        latitude: latitude,
        longitude: longitude,
      ),
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<Coupon> saveCoupon({
    required String uid,
    required Coupon coupon,
  }) async {
    final validationError = coupon.validateForSave();
    if (validationError != null) {
      throw ArgumentError(validationError);
    }

    final doc = couponsCollection(uid).doc();
    await _ensureNoDuplicateCoupon(
      uid: uid,
      title: coupon.title.trim(),
      startTime: coupon.startTime!,
      endTime: coupon.endTime!,
    );

    await doc.set({
      ...coupon.toFirestoreMap(id: doc.id),
      Coupon.fieldCreatedAt: FieldValue.serverTimestamp(),
      Coupon.fieldUpdatedAt: FieldValue.serverTimestamp(),
    });

    await docForUser(uid).set({
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    return coupon.copyWith(id: doc.id);
  }

  static Future<Coupon> updateCoupon({
    required String uid,
    required Coupon coupon,
  }) async {
    final validationError = coupon.validateForSave();
    if (validationError != null) {
      throw ArgumentError(validationError);
    }

    final couponId = coupon.id.trim();
    if (couponId.isEmpty) {
      throw ArgumentError('Coupon ID is required for updates.');
    }

    await couponsCollection(uid).doc(couponId).set({
      ...coupon.toFirestoreMap(id: couponId),
      Coupon.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    await docForUser(uid).set({
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    return coupon;
  }

  static Future<List<Coupon>> loadCoupons(String uid) async {
    final snapshot = await couponsCollection(uid)
        .orderBy(Coupon.fieldCreatedAt, descending: true)
        .get();

    final coupons = <Coupon>[];

    for (final doc in snapshot.docs) {
      try {
        final coupon = Coupon.tryFromFirestore(doc.data(), fallbackId: doc.id);
        if (coupon != null) {
          coupons.add(coupon);
        }
      } catch (_) {
        continue;
      }
    }

    return coupons;
  }

  static Future<void> deleteCoupon({
    required String uid,
    required String couponId,
  }) async {
    await couponsCollection(uid).doc(couponId).delete();

    await docForUser(uid).set({
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<void> deleteRestaurantAccount(String uid) async {
    final couponsSnapshot = await couponsCollection(uid).get();

    if (couponsSnapshot.docs.isNotEmpty) {
      final batch = _firestore.batch();

      for (final doc in couponsSnapshot.docs) {
        batch.delete(doc.reference);
      }

      await batch.commit();
    }

    await docForUser(uid).delete();
  }

  static Future<void> _ensureNoDuplicateCoupon({
    required String uid,
    required String title,
    required DateTime startTime,
    required DateTime endTime,
  }) async {
    final duplicateSnapshot = await couponsCollection(uid)
        .where(Coupon.fieldTitle, isEqualTo: title)
        .where(
          Coupon.fieldStartTime,
          isEqualTo: Timestamp.fromDate(startTime),
        )
        .where(
          Coupon.fieldEndTime,
          isEqualTo: Timestamp.fromDate(endTime),
        )
        .limit(1)
        .get();

    if (duplicateSnapshot.docs.isNotEmpty) {
      throw ArgumentError(
        'A coupon with the same title and schedule already exists.',
      );
    }
  }

  static Future<List<Restaurant>> loadApprovedRestaurantsWithCoupons() async {
    final accountsSnapshot = await _firestore
        .collection('restaurant_accounts')
        .where(Restaurant.fieldApprovalStatus, isEqualTo: 'approved')
        .get();

    final restaurants = <Restaurant>[];

    for (final doc in accountsSnapshot.docs) {
      try {
        final normalizedData = _normalizedRestaurantAccountData(
          doc.data(),
          fallbackUid: doc.id,
        );
        final uid =
            _readString(normalizedData[Restaurant.fieldUid]) ?? doc.id;

        final coupons = await loadCoupons(uid);
        final restaurant = Restaurant.fromFirestore(
          normalizedData,
          coupons: coupons,
        );

        if (!restaurant.hasValidRequiredFields) {
          continue;
        }

        restaurants.add(restaurant);
      } catch (_) {
        continue;
      }
    }

    return restaurants;
  }

  static Map<String, dynamic> _normalizedRestaurantAccountData(
    Map<String, dynamic> data, {
    required String fallbackUid,
  }) {
    return {
      Restaurant.fieldUid:
          _readString(data[Restaurant.fieldUid]) ?? fallbackUid,
      Restaurant.fieldName:
          _readString(data[Restaurant.fieldName]) ??
          _readString(data[Restaurant.legacyFieldName]) ??
          '',
      Restaurant.fieldDistance: Restaurant.defaultDistanceLabel,
      Restaurant.fieldCity: _readString(data[Restaurant.fieldCity]) ?? '',
      Restaurant.fieldZipCode:
          _readString(data[Restaurant.fieldZipCode]) ??
          _readString(data[Restaurant.legacyFieldZipCode]) ??
          '',
      Restaurant.fieldEmail: _readString(data[Restaurant.fieldEmail]) ?? '',
      Restaurant.fieldPhone: _readString(data[Restaurant.fieldPhone]),
      Restaurant.fieldStreetAddress:
          _readString(data[Restaurant.fieldStreetAddress]) ??
          _readString(data[Restaurant.legacyFieldStreetAddress]),
      Restaurant.fieldWebsite: _readString(data[Restaurant.fieldWebsite]),
      Restaurant.fieldBio: _readString(data[Restaurant.fieldBio]),
      Restaurant.fieldBusinessHours: data[Restaurant.fieldBusinessHours],
      Restaurant.fieldLatitude: _readDouble(data[Restaurant.fieldLatitude]),
      Restaurant.fieldLongitude: _readDouble(data[Restaurant.fieldLongitude]),
      Restaurant.fieldApprovalStatus:
          _readString(data[Restaurant.fieldApprovalStatus]) ?? 'pending',
      'couponApplicationSubmitted': _readBool(
        data['couponApplicationSubmitted'],
      ),
      'subscriptionStatus': _readString(data['subscriptionStatus']) ?? 'inactive',
      'trialEndsAt': data['trialEndsAt'],
      'subscriptionEndsAt': data['subscriptionEndsAt'],
      'billingPlanName': _readString(data['billingPlanName']),
      'hasUsedTrial': _readBool(data['hasUsedTrial']),
      'couponPostingEnabled': _readBool(data['couponPostingEnabled']),
      'stripeCustomerId': _readString(data['stripeCustomerId']),
      'stripeSubscriptionId': _readString(data['stripeSubscriptionId']),
      Restaurant.fieldCreatedAt: data[Restaurant.fieldCreatedAt],
      Restaurant.fieldUpdatedAt: data[Restaurant.fieldUpdatedAt],
    };
  }

  static bool _canPostCouponsFromData(Map<String, dynamic>? data) {
    if (data == null) {
      return false;
    }

    final couponPostingEnabled = _readBool(data['couponPostingEnabled']);
    if (couponPostingEnabled == true) {
      return true;
    }

    final status = (_readString(data['subscriptionStatus']) ?? 'inactive')
        .toLowerCase();
    if (status == 'active') {
      return true;
    }

    if (status == 'trialing') {
      final trialEndsAt = _readDateTime(data['trialEndsAt']);
      if (trialEndsAt != null && trialEndsAt.isAfter(DateTime.now())) {
        return true;
      }
    }

    return false;
  }

  static String? _readString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }

    return null;
  }

  static double? _readDouble(dynamic value) {
    if (value is num) {
      return value.toDouble();
    }

    if (value is String) {
      return double.tryParse(value.trim());
    }

    return null;
  }

  static bool? _readBool(dynamic value) {
    if (value is bool) {
      return value;
    }

    if (value is num) {
      return value != 0;
    }

    if (value is String) {
      final normalized = value.trim().toLowerCase();
      if (normalized == 'true') {
        return true;
      }
      if (normalized == 'false') {
        return false;
      }
    }

    return null;
  }

  static DateTime? _readDateTime(dynamic value) {
    if (value is Timestamp) {
      return value.toDate();
    }

    if (value is DateTime) {
      return value;
    }

    return null;
  }
}
