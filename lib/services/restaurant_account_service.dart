import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import '../models/coupon.dart';
import '../models/daily_special.dart';
import '../models/restaurant.dart';

class ResolvedRestaurantAccount {
  final String documentId;
  final String accountUid;
  final Map<String, dynamic> accountData;

  const ResolvedRestaurantAccount({
    required this.documentId,
    required this.accountUid,
    required this.accountData,
  });
}

enum RestaurantAccountAdminVisibilityFailureKind { missingAccount, staleState }

class RestaurantAccountAdminVisibilityException implements Exception {
  const RestaurantAccountAdminVisibilityException({
    required this.kind,
    required this.message,
  });

  final RestaurantAccountAdminVisibilityFailureKind kind;
  final String message;

  @override
  String toString() => message;
}

class RestaurantAccountService {
  static const String adminHiddenField = 'adminHidden';
  static const String restaurantSearchIndexCollection =
      'restaurant_search_index';
  static const String customerPublicProjectionVersion =
      'bitestar.bitesaver-public-restaurant.v1';
  static const String publicProjectionVersionField = 'publicProjectionVersion';
  static const String publicVisibleField = 'publicVisible';
  static const String offerCatalogUpdatedAtField = 'offerCatalogUpdatedAt';
  static const String projectionEntityTypeField = 'entityType';
  static const String projectionSourceField = 'source';
  static const String projectionSourceDocumentIdField = 'sourceDocumentId';
  static const String projectionIndexDocumentIdField = 'indexDocumentId';
  static const String projectionDisplayNameField = 'displayName';
  static const String projectionPrimaryImageUrlField = 'primaryImageUrl';
  static const int maxCouponNumberGenerationAttempts = 10000;
  static const String _couponNumberReservationsCollection =
      'coupon_number_reservations';
  static const String _couponCodeReservationsCollection =
      'coupon_code_reservations';
  static const String _couponNumberReservationCouponIdField = 'couponId';
  static const String _couponNumberReservationCouponNumberField =
      'couponNumber';
  static const String _couponCodeReservationCouponCodeField = 'couponCode';
  static const String _couponCodeReservationNormalizedCouponCodeField =
      'normalizedCouponCode';
  static const String _couponNumberReservationCreatedAtField = 'createdAt';
  static const String _couponNumberReservationUpdatedAtField = 'updatedAt';

  static final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  static Query<Map<String, dynamic>> _customerRestaurantProjectionQuery() {
    return _firestore
        .collection(restaurantSearchIndexCollection)
        .where(projectionSourceField, isEqualTo: 'biteSaver')
        .where(projectionEntityTypeField, isEqualTo: 'restaurant')
        .where(
          publicProjectionVersionField,
          isEqualTo: customerPublicProjectionVersion,
        )
        .where(publicVisibleField, isEqualTo: true);
  }

  static DocumentReference<Map<String, dynamic>> docForUser(String uid) {
    return _firestore.collection('restaurant_accounts').doc(uid);
  }

  static CollectionReference<Map<String, dynamic>> couponsCollection(
    String uid,
  ) {
    return docForUser(uid).collection('coupons');
  }

  static CollectionReference<Map<String, dynamic>>
  couponNumberReservationsCollection(String uid) {
    return docForUser(uid).collection(_couponNumberReservationsCollection);
  }

  static CollectionReference<Map<String, dynamic>>
  couponCodeReservationsCollection(String uid) {
    return docForUser(uid).collection(_couponCodeReservationsCollection);
  }

  static CollectionReference<Map<String, dynamic>> dailySpecialsCollection(
    String uid,
  ) {
    return docForUser(uid).collection('daily_specials');
  }

  static CollectionReference<Map<String, dynamic>> menuImagesCollection(
    String uid,
  ) {
    return docForUser(uid).collection('menu_images');
  }

  static CollectionReference<Map<String, dynamic>> menuItemsCollection(
    String uid,
  ) {
    return docForUser(uid).collection('menu_items');
  }

  static CollectionReference<Map<String, dynamic>> menuSectionsCollection(
    String uid,
  ) {
    return docForUser(uid).collection('menu_sections');
  }

  static CollectionReference<Map<String, dynamic>>
  restaurantNameChangeRequestsCollection() {
    return _firestore.collection('restaurant_name_change_requests');
  }

  @Deprecated(
    'Authentication must not create restaurant accounts. '
    'This helper updates identity metadata on existing accounts only. '
    'Use saveBiteSaverRestaurantProfile for application and profile writes.',
  )
  static Future<void> createOrUpdateAccountRecord(
    User user, {
    String? restaurantName,
    String? streetAddress,
    String? city,
    String? state,
    String? zipCode,
    String? phone,
    bool markApplicationSubmitted = false,
  }) async {
    final doc = docForUser(user.uid);
    await updateLegacyAccountIdentityIfPresent(
      user: user,
      accountExists: () async => (await doc.get()).exists,
      updateAccount: doc.update,
      updatedAt: FieldValue.serverTimestamp(),
    );
  }

  @visibleForTesting
  static Future<bool> updateLegacyAccountIdentityIfPresent({
    required User user,
    required Future<bool> Function() accountExists,
    required Future<void> Function(Map<String, dynamic> fields) updateAccount,
    required Object updatedAt,
  }) async {
    final trimmedEmail = user.email?.trim();
    final trimmedPhoneNumber = user.phoneNumber?.trim();
    final trimmedDisplayName = user.displayName?.trim();

    return updateExistingAccountOnly(
      accountExists: accountExists,
      updateAccount: () => updateAccount({
        Restaurant.fieldUid: user.uid,
        if (trimmedEmail != null && trimmedEmail.isNotEmpty)
          Restaurant.fieldEmail: trimmedEmail,
        if (trimmedPhoneNumber != null && trimmedPhoneNumber.isNotEmpty)
          'phoneNumber': trimmedPhoneNumber,
        if (trimmedDisplayName != null && trimmedDisplayName.isNotEmpty)
          'displayName': trimmedDisplayName,
        'emailVerified': user.emailVerified,
        Restaurant.fieldUpdatedAt: updatedAt,
      }),
    );
  }

  static Future<void> syncEmailVerified(User user) async {
    final doc = docForUser(user.uid);
    await syncExistingAccountIdentityIfChanged(
      user: user,
      loadAccount: () async => (await doc.get()).data(),
      updateAccount: doc.update,
    );
  }

  @visibleForTesting
  static Future<bool> syncExistingAccountIdentityIfChanged({
    required User user,
    required Future<Map<String, dynamic>?> Function() loadAccount,
    required Future<void> Function(Map<String, dynamic> fields) updateAccount,
  }) async {
    final existing = await loadAccount();
    if (existing == null) {
      return false;
    }

    final changedFields = _changedAuthIdentityFields(user, existing);
    if (changedFields.isEmpty) {
      return false;
    }

    try {
      await updateAccount(changedFields);
      return true;
    } on FirebaseException catch (error) {
      // The existing document may be deleted between the read and update.
      // Identity synchronization must never recreate a restaurant account.
      if (error.code == 'not-found') {
        return false;
      }
      rethrow;
    }
  }

  static Map<String, dynamic> _changedAuthIdentityFields(
    User user,
    Map<String, dynamic> existing,
  ) {
    final changed = <String, dynamic>{};

    void includeChanged(String field, Object value) {
      if (existing[field] != value) {
        changed[field] = value;
      }
    }

    final email = user.email?.trim();
    if (email != null && email.isNotEmpty) {
      includeChanged(Restaurant.fieldEmail, email);
    }
    final phoneNumber = user.phoneNumber?.trim();
    if (phoneNumber != null && phoneNumber.isNotEmpty) {
      includeChanged('phoneNumber', phoneNumber);
    }
    final displayName = user.displayName?.trim();
    if (displayName != null && displayName.isNotEmpty) {
      includeChanged('displayName', displayName);
    }
    includeChanged('emailVerified', user.emailVerified);
    return changed;
  }

  @visibleForTesting
  static Future<bool> updateExistingAccountOnly({
    required Future<bool> Function() accountExists,
    required Future<void> Function() updateAccount,
  }) async {
    if (!await accountExists()) {
      return false;
    }

    try {
      await updateAccount();
      return true;
    } on FirebaseException catch (error) {
      // An existing document can be deleted between the read and update.
      // Treat only that race as a safe no-create result.
      if (error.code == 'not-found') {
        return false;
      }
      rethrow;
    }
  }

  static Stream<DocumentSnapshot<Map<String, dynamic>>> accountStream(
    String uid,
  ) {
    return docForUser(uid).snapshots();
  }

  static Stream<QuerySnapshot<Map<String, dynamic>>> allAccountsStream() {
    return _firestore.collection('restaurant_accounts').snapshots();
  }

  static Stream<QuerySnapshot<Map<String, dynamic>>> pendingAccountsStream() {
    return _firestore
        .collection('restaurant_accounts')
        .where(Restaurant.fieldApprovalStatus, isEqualTo: 'pending')
        .snapshots();
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
    return _customerRestaurantProjectionQuery().snapshots();
  }

  @Deprecated('Use reviewBiteSaverApplication instead.')
  static Future<void> approveAccount(String uid) async {
    await docForUser(uid).update({
      Restaurant.fieldApprovalStatus: 'approved',
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    });
  }

  @Deprecated('Use reviewBiteSaverApplication instead.')
  static Future<void> rejectAccount(String uid) async {
    await docForUser(uid).update({
      Restaurant.fieldApprovalStatus: 'rejected',
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    });
  }

  static Future<void> approveRestaurantNameChangeRequest({
    required String requestId,
    required String uid,
    required String requestedRestaurantName,
  }) async {
    final batch = _firestore.batch();
    batch.update(docForUser(uid), {
      Restaurant.fieldName: requestedRestaurantName.trim(),
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(
      restaurantNameChangeRequestsCollection().doc(requestId),
      {'status': 'approved', 'updatedAt': FieldValue.serverTimestamp()},
      SetOptions(merge: true),
    );
    await batch.commit();
  }

  static Future<void> rejectRestaurantNameChangeRequest(
    String requestId,
  ) async {
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

  static Future<Map<String, dynamic>?> loadAccountByDocumentId(
    String documentId,
  ) async {
    final trimmedDocumentId = documentId.trim();
    if (trimmedDocumentId.isEmpty) {
      throw ArgumentError('Restaurant document ID is required.');
    }

    final snapshot = await _firestore
        .collection('restaurant_accounts')
        .doc(trimmedDocumentId)
        .get();
    final data = snapshot.data();
    if (data == null) {
      return null;
    }
    return _normalizedRestaurantAccountData(
      data,
      fallbackUid: trimmedDocumentId,
    );
  }

  static Future<Map<String, dynamic>?> loadCustomerRestaurantProjectionById(
    String restaurantId,
  ) async {
    final canonicalRestaurantId = restaurantId.trim();
    if (canonicalRestaurantId.isEmpty || canonicalRestaurantId.contains('/')) {
      return null;
    }

    final snapshot = await _customerRestaurantProjectionQuery()
        .where(
          projectionSourceDocumentIdField,
          isEqualTo: canonicalRestaurantId,
        )
        .limit(2)
        .get();
    if (snapshot.docs.length != 1) {
      return null;
    }
    final data = snapshot.docs.single.data();
    return customerRestaurantFromProjectionData(
              data,
              expectedRestaurantId: canonicalRestaurantId,
              projectionDocumentId: snapshot.docs.single.id,
            ) ==
            null
        ? null
        : Map<String, dynamic>.unmodifiable(data);
  }

  static Restaurant? customerRestaurantFromProjectionData(
    Map<String, dynamic>? data, {
    String? expectedRestaurantId,
    String? projectionDocumentId,
    List<Coupon> coupons = const <Coupon>[],
    List<DailySpecial> dailySpecials = const <DailySpecial>[],
  }) {
    if (data == null ||
        data[publicProjectionVersionField] != customerPublicProjectionVersion ||
        data[projectionEntityTypeField] != 'restaurant' ||
        data[projectionSourceField] != 'biteSaver' ||
        data[publicVisibleField] != true) {
      return null;
    }

    final restaurantId = _readString(data[projectionSourceDocumentIdField]);
    final indexDocumentId = _readString(data[projectionIndexDocumentIdField]);
    final expectedId = _readString(expectedRestaurantId);
    final expectedIndexId = _readString(projectionDocumentId);
    if (restaurantId == null ||
        restaurantId.contains('/') ||
        indexDocumentId == null ||
        indexDocumentId.contains('/') ||
        (expectedId != null && restaurantId != expectedId) ||
        (expectedIndexId != null && indexDocumentId != expectedIndexId)) {
      return null;
    }

    final latitude = _readDouble(data[Restaurant.fieldLatitude]);
    final longitude = _readDouble(data[Restaurant.fieldLongitude]);
    final hasValidCoordinates =
        latitude != null &&
        longitude != null &&
        latitude.isFinite &&
        longitude.isFinite &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180 &&
        (latitude != 0 || longitude != 0);
    final restaurant = Restaurant(
      documentId: restaurantId,
      name: _readString(data[projectionDisplayNameField]) ?? '',
      distance: Restaurant.defaultDistanceLabel,
      city: _readString(data[Restaurant.fieldCity]) ?? '',
      state: _readString(data[Restaurant.fieldState]) ?? '',
      zipCode: _readString(data[Restaurant.fieldZipCode]) ?? '',
      phone: _readString(data[Restaurant.fieldPhone]),
      streetAddress: _readString(data[Restaurant.fieldStreetAddress]),
      website: _readString(data[Restaurant.fieldWebsite]),
      bio: _readString(data[Restaurant.fieldBio]),
      mainImageUrl: _readString(data[projectionPrimaryImageUrlField]),
      businessHours: RestaurantBusinessHours.listFromFirestore(
        data[Restaurant.fieldBusinessHours],
      ),
      coupons: coupons,
      dailySpecials: dailySpecials,
      latitude: hasValidCoordinates ? latitude : null,
      longitude: hasValidCoordinates ? longitude : null,
      formattedAddress: _readString(data[Restaurant.fieldFormattedAddress]),
    );
    return restaurant.hasValidRequiredFields ? restaurant : null;
  }

  static Future<void> setAdminHiddenAsAdmin({
    required String documentId,
    required bool expectedAdminHidden,
    required bool adminHidden,
  }) async {
    final canonicalDocumentId = documentId.trim();
    if (canonicalDocumentId.isEmpty || adminHidden == expectedAdminHidden) {
      throw ArgumentError('A valid restaurant visibility change is required.');
    }

    final accountRef = _firestore
        .collection('restaurant_accounts')
        .doc(canonicalDocumentId);
    await _firestore.runTransaction<void>((transaction) async {
      final currentSnapshot = await transaction.get(accountRef);
      final fields = _adminVisibilityWrite(
        currentData: currentSnapshot.data(),
        expectedAdminHidden: expectedAdminHidden,
        adminHidden: adminHidden,
        updatedAt: FieldValue.serverTimestamp(),
      );
      transaction.update(accountRef, fields);
    });
  }

  static Map<String, dynamic> _adminVisibilityWrite({
    required Map<String, dynamic>? currentData,
    required bool expectedAdminHidden,
    required bool adminHidden,
    required Object updatedAt,
  }) {
    if (currentData == null) {
      throw const RestaurantAccountAdminVisibilityException(
        kind: RestaurantAccountAdminVisibilityFailureKind.missingAccount,
        message:
            'This restaurant account no longer exists. Refresh and try again.',
      );
    }
    if (isAdminHidden(currentData) != expectedAdminHidden) {
      throw const RestaurantAccountAdminVisibilityException(
        kind: RestaurantAccountAdminVisibilityFailureKind.staleState,
        message:
            'Restaurant visibility changed since this result loaded. Refresh and try again.',
      );
    }
    if (adminHidden == expectedAdminHidden) {
      throw ArgumentError('A visibility change is required.');
    }
    return <String, dynamic>{
      adminHiddenField: adminHidden,
      Restaurant.fieldUpdatedAt: updatedAt,
    };
  }

  @visibleForTesting
  static Map<String, dynamic> adminVisibilityWriteForTesting({
    required Map<String, dynamic>? currentData,
    required bool expectedAdminHidden,
    required bool adminHidden,
    required Object updatedAt,
  }) => _adminVisibilityWrite(
    currentData: currentData,
    expectedAdminHidden: expectedAdminHidden,
    adminHidden: adminHidden,
    updatedAt: updatedAt,
  );

  static Future<ResolvedRestaurantAccount?> resolveCustomerRestaurantAccount(
    String restaurantId,
  ) async {
    final trimmedRestaurantId = restaurantId.trim();
    if (trimmedRestaurantId.isEmpty || trimmedRestaurantId.contains('/')) {
      return null;
    }

    final projection = await loadCustomerRestaurantProjectionById(
      trimmedRestaurantId,
    );
    if (projection == null) {
      return null;
    }
    return ResolvedRestaurantAccount(
      documentId: trimmedRestaurantId,
      accountUid: trimmedRestaurantId,
      accountData: projection,
    );
  }

  static Future<bool> canPostCoupons(String uid) async {
    final data = await getAccountData(uid);
    return hasCouponPostingAccess(data);
  }

  static bool hasCouponPostingAccess(Map<String, dynamic>? data) {
    return _canPostCouponsFromData(data);
  }

  static bool isAdminHidden(Map<String, dynamic>? data) {
    return data?[adminHiddenField] == true;
  }

  static bool isCustomerVisibleAccountData(Map<String, dynamic>? data) {
    return hasCouponPostingAccess(data) && !isAdminHidden(data);
  }

  static bool isCustomerVisibleProjectionData(Map<String, dynamic>? data) {
    return customerRestaurantFromProjectionData(data) != null;
  }

  static List<Coupon> customerVisibleCouponsForAccountData(
    Map<String, dynamic>? data,
    List<Coupon> coupons,
  ) {
    if (!isCustomerVisibleAccountData(data)) {
      return const <Coupon>[];
    }

    return coupons;
  }

  static List<Coupon> customerVisibleCouponsForProjectionData(
    Map<String, dynamic>? data,
    List<Coupon> coupons,
  ) {
    if (!isCustomerVisibleProjectionData(data)) {
      return const <Coupon>[];
    }
    return coupons;
  }

  static Future<bool> isCouponCustomerVisible(
    Coupon coupon, {
    Restaurant? restaurant,
    @visibleForTesting
    Future<Map<String, dynamic>?> Function(String accountDocumentId)?
    projectionDataLoader,
    @visibleForTesting
    Future<Map<String, dynamic>?> Function(
      String accountDocumentId,
      String couponId,
    )?
    couponDataLoader,
  }) async {
    if (!coupon.isActiveAt(DateTime.now())) {
      return false;
    }

    final restaurantDocumentId = restaurant?.accountDocumentId?.trim();
    final couponRestaurantDocumentId = coupon.restaurantAccountId?.trim();
    if (restaurantDocumentId != null &&
        restaurantDocumentId.isNotEmpty &&
        couponRestaurantDocumentId != null &&
        couponRestaurantDocumentId.isNotEmpty &&
        restaurantDocumentId != couponRestaurantDocumentId) {
      return false;
    }
    final accountDocumentId =
        restaurantDocumentId ?? couponRestaurantDocumentId;
    if (accountDocumentId == null || accountDocumentId.isEmpty) {
      return false;
    }
    final data =
        await (projectionDataLoader ?? loadCustomerRestaurantProjectionById)(
          accountDocumentId,
        );
    if (customerRestaurantFromProjectionData(
          data,
          expectedRestaurantId: accountDocumentId,
        ) ==
        null) {
      return false;
    }

    if (restaurant != null) {
      return true;
    }

    final couponId = coupon.id.trim();
    if (couponId.isEmpty || couponId.contains('/')) {
      return false;
    }
    final currentCouponData =
        await (couponDataLoader ?? _loadCustomerCouponDataById)(
          accountDocumentId,
          couponId,
        );
    return Coupon.tryFromFirestore(currentCouponData, fallbackId: couponId) !=
        null;
  }

  static Future<Map<String, dynamic>?> _loadCustomerCouponDataById(
    String accountDocumentId,
    String couponId,
  ) async {
    final snapshot = await couponsCollection(
      accountDocumentId,
    ).doc(couponId).get();
    return snapshot.data();
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
        (_readString(data[Restaurant.fieldState]) ?? '').isNotEmpty &&
        (_readString(data[Restaurant.fieldZipCode]) ?? '').isNotEmpty &&
        (_readString(data[Restaurant.fieldPhone]) ?? '').isNotEmpty;
  }

  @Deprecated(
    'Use saveBiteSaverRestaurantProfile ownerUpdate or adminUpdate instead.',
  )
  static Future<void> saveRestaurantProfile({
    required String uid,
    required String name,
    required String city,
    required String state,
    required String zipCode,
    required String email,
    required String phone,
    required String streetAddress,
    required String website,
    required String bio,
    String mainImageUrl = '',
    required List<RestaurantBusinessHours> businessHours,
    required double? latitude,
    required double? longitude,
  }) async {
    final trimmedUid = uid.trim();
    if (trimmedUid.isEmpty) {
      throw ArgumentError('Restaurant user ID is required.');
    }

    final trimmedEmail = email.trim();
    final restaurant = Restaurant(
      name: name.trim(),
      distance: Restaurant.defaultDistanceLabel,
      city: city.trim(),
      state: state.trim(),
      zipCode: zipCode.trim(),
      coupons: const [],
      phone: phone.trim().isEmpty ? null : phone.trim(),
      streetAddress: streetAddress.trim().isEmpty ? null : streetAddress.trim(),
      website: website.trim().isEmpty ? null : website.trim(),
      bio: bio.trim().isEmpty ? null : bio.trim(),
      mainImageUrl: mainImageUrl.trim().isEmpty ? null : mainImageUrl.trim(),
      businessHours: businessHours.isEmpty
          ? const []
          : RestaurantBusinessHours.normalizedWeek(businessHours),
      latitude: latitude,
      longitude: longitude,
    );

    final validationError = restaurant.validateRequiredFields();
    if (validationError != null || trimmedEmail.isEmpty) {
      throw ArgumentError(validationError ?? 'Restaurant email is required.');
    }

    await docForUser(trimmedUid).update({
      Restaurant.fieldUid: trimmedUid,
      ...restaurant.toProfileFirestoreMap(
        email: trimmedEmail,
        phone: phone,
        streetAddress: streetAddress,
        website: website,
        bio: bio,
        mainImageUrl: mainImageUrl,
        businessHours: businessHours,
        latitude: latitude,
        longitude: longitude,
      ),
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    });
  }

  @Deprecated(
    'Trusted BiteSaver coordinates must be written only by the backend.',
  )
  static Future<void> saveRestaurantCoordinates({
    required String uid,
    required double latitude,
    required double longitude,
  }) async {
    await docForUser(uid).update({
      Restaurant.fieldLatitude: latitude,
      Restaurant.fieldLongitude: longitude,
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    });
  }

  static Future<Coupon> saveCoupon({
    required String uid,
    required Coupon coupon,
  }) async {
    await _ensureCanPostCoupons(uid);

    final sanitizedCoupon = _sanitizeCouponForSave(coupon);
    final validationError = sanitizedCoupon.validateForSave();
    if (validationError != null) {
      throw ArgumentError(validationError);
    }

    await _ensureNoDuplicateCoupon(
      uid: uid,
      title: sanitizedCoupon.title,
      startTime: sanitizedCoupon.startTime!,
      endTime: sanitizedCoupon.endTime!,
    );
    await _ensureNoDuplicateCouponCode(
      uid: uid,
      couponCode: sanitizedCoupon.couponCode,
    );

    final doc = couponsCollection(uid).doc();
    return _createCouponWithUniqueNumber(
      uid: uid,
      doc: doc,
      coupon: sanitizedCoupon,
    );
  }

  static Future<Coupon> updateCoupon({
    required String uid,
    required Coupon coupon,
  }) async {
    await _ensureCanPostCoupons(uid);

    final couponId = coupon.id.trim();
    if (couponId.isEmpty) {
      throw ArgumentError('Coupon ID is required for updates.');
    }

    final sanitizedCoupon = _sanitizeCouponForSave(coupon, id: couponId);
    final validationError = sanitizedCoupon.validateForSave();
    if (validationError != null) {
      throw ArgumentError(validationError);
    }
    await _ensureNoDuplicateCouponCode(
      uid: uid,
      couponCode: sanitizedCoupon.couponCode,
      excludeCouponId: couponId,
    );
    final existingCouponNumber = sanitizedCoupon.formattedCouponNumber;
    if (existingCouponNumber == null) {
      return _updateCouponWithGeneratedNumber(
        uid: uid,
        couponId: couponId,
        coupon: sanitizedCoupon,
      );
    }
    return _updateCouponWithExistingNumber(
      uid: uid,
      couponId: couponId,
      coupon: sanitizedCoupon.copyWith(couponNumber: existingCouponNumber),
    );
  }

  static Future<DailySpecial> createDailySpecial({
    required String uid,
    required DailySpecial dailySpecial,
  }) async {
    await _ensureCanPostCoupons(uid);

    final trimmedUid = uid.trim();
    if (trimmedUid.isEmpty) {
      throw ArgumentError('Restaurant user ID is required.');
    }

    final doc = dailySpecialsCollection(trimmedUid).doc();
    final now = DateTime.now();
    final sanitizedSpecial = dailySpecial
        .copyWith(id: doc.id, restaurantId: trimmedUid, ownerUid: trimmedUid)
        .sanitizedForSave(id: doc.id, now: now);
    final validationError = sanitizedSpecial.validateForSave();
    if (validationError != null) {
      throw ArgumentError(validationError);
    }

    await doc.set({
      ...sanitizedSpecial.toFirestoreMap(id: doc.id, now: now),
      DailySpecial.fieldCreatedAt: FieldValue.serverTimestamp(),
      DailySpecial.fieldUpdatedAt: FieldValue.serverTimestamp(),
    });

    await docForUser(
      trimmedUid,
    ).update({Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp()});

    return sanitizedSpecial;
  }

  static Future<DailySpecial> updateDailySpecial({
    required String uid,
    required DailySpecial dailySpecial,
  }) async {
    await _ensureCanPostCoupons(uid);

    final trimmedUid = uid.trim();
    if (trimmedUid.isEmpty) {
      throw ArgumentError('Restaurant user ID is required.');
    }

    final specialId = dailySpecial.id.trim();
    if (specialId.isEmpty) {
      throw ArgumentError('Daily special ID is required for updates.');
    }

    final now = DateTime.now();
    final sanitizedSpecial = dailySpecial
        .copyWith(id: specialId, restaurantId: trimmedUid, ownerUid: trimmedUid)
        .sanitizedForSave(id: specialId, now: now);
    final validationError = sanitizedSpecial.validateForSave();
    if (validationError != null) {
      throw ArgumentError(validationError);
    }

    await dailySpecialsCollection(trimmedUid).doc(specialId).set({
      ...sanitizedSpecial.toFirestoreMap(id: specialId, now: now),
      DailySpecial.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    await docForUser(
      trimmedUid,
    ).update({Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp()});

    return sanitizedSpecial;
  }

  static Coupon _sanitizeCouponForSave(Coupon coupon, {String? id}) {
    final trimmedCouponCode = coupon.couponCode?.trim();
    final trimmedDetails = coupon.details?.trim();
    final trimmedExpires = coupon.expiresText?.trim();
    final trimmedUsageRule = coupon.usageRule.trim();

    return Coupon(
      id: id ?? coupon.id.trim(),
      restaurant: coupon.restaurant.trim(),
      title: coupon.title.trim(),
      distance: coupon.distance.trim(),
      expires: trimmedExpires == null || trimmedExpires.isEmpty
          ? null
          : trimmedExpires,
      startTime: coupon.startTime,
      endTime: coupon.endTime,
      usageRule: trimmedUsageRule.isEmpty
          ? Coupon.defaultUsageRule
          : trimmedUsageRule,
      couponCode: trimmedCouponCode == null || trimmedCouponCode.isEmpty
          ? null
          : trimmedCouponCode,
      couponNumber: Coupon.formatCouponNumber(coupon.couponNumber),
      isProximityOnly: coupon.isProximityOnly,
      proximityRadiusMiles: coupon.proximityRadiusMiles,
      details: trimmedDetails == null || trimmedDetails.isEmpty
          ? null
          : trimmedDetails,
      imageUrl: coupon.imageUrl?.trim().isEmpty == true
          ? null
          : coupon.imageUrl?.trim(),
    );
  }

  static Future<Set<String>> _loadExistingCouponNumbers(
    String uid, {
    String? excludeCouponId,
  }) async {
    final snapshot = await couponsCollection(uid).get();
    final usedNumbers = <String>{};

    for (final doc in snapshot.docs) {
      if (excludeCouponId != null && doc.id == excludeCouponId) {
        continue;
      }
      final formattedNumber = Coupon.formatCouponNumber(
        doc.data()[Coupon.fieldCouponNumber]?.toString(),
      );
      if (formattedNumber != null) {
        usedNumbers.add(formattedNumber);
      }
    }

    return usedNumbers;
  }

  static Future<Coupon> _createCouponWithUniqueNumber({
    required String uid,
    required DocumentReference<Map<String, dynamic>> doc,
    required Coupon coupon,
  }) async {
    final usedNumbers = await _loadExistingCouponNumbers(uid);

    return _firestore.runTransaction<Coupon>((transaction) async {
      final existingCouponDoc = await transaction.get(doc);
      if (existingCouponDoc.exists) {
        throw StateError('Could not create a unique coupon record.');
      }

      return _writeCouponWithReservedNumber(
        transaction: transaction,
        uid: uid,
        couponId: doc.id,
        doc: doc,
        coupon: coupon,
        reservedNumbers: usedNumbers,
        isCreate: true,
      );
    });
  }

  static Future<Coupon> _updateCouponWithGeneratedNumber({
    required String uid,
    required String couponId,
    required Coupon coupon,
  }) async {
    final usedNumbers = await _loadExistingCouponNumbers(
      uid,
      excludeCouponId: couponId,
    );
    final doc = couponsCollection(uid).doc(couponId);

    return _firestore.runTransaction<Coupon>((transaction) async {
      final existingCouponDoc = await transaction.get(doc);
      if (!existingCouponDoc.exists) {
        throw ArgumentError('Coupon ID is required for updates.');
      }

      final existingCouponNumber = Coupon.formatCouponNumber(
        existingCouponDoc.data()?[Coupon.fieldCouponNumber]?.toString(),
      );
      if (existingCouponNumber != null) {
        final numberedCoupon = coupon.copyWith(
          id: couponId,
          couponNumber: existingCouponNumber,
        );
        transaction.set(doc, {
          ...numberedCoupon.toFirestoreMap(id: couponId),
          Coupon.fieldUpdatedAt: FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
        transaction.update(docForUser(uid), {
          Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
        });
        return numberedCoupon;
      }

      return _writeCouponWithReservedNumber(
        transaction: transaction,
        uid: uid,
        couponId: couponId,
        doc: doc,
        coupon: coupon,
        reservedNumbers: usedNumbers,
        isCreate: false,
      );
    });
  }

  static Future<Coupon> _updateCouponWithExistingNumber({
    required String uid,
    required String couponId,
    required Coupon coupon,
  }) async {
    final doc = couponsCollection(uid).doc(couponId);

    return _firestore.runTransaction<Coupon>((transaction) async {
      final existingCouponDoc = await transaction.get(doc);
      if (!existingCouponDoc.exists) {
        throw ArgumentError('Coupon ID is required for updates.');
      }

      await _reserveManualCouponCodeIfNeeded(
        transaction: transaction,
        uid: uid,
        couponId: couponId,
        couponCode: coupon.couponCode,
      );

      transaction.set(doc, {
        ...coupon.toFirestoreMap(id: couponId),
        Coupon.fieldUpdatedAt: FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
      transaction.update(docForUser(uid), {
        Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
      });
      return coupon;
    });
  }

  static Future<Coupon> _writeCouponWithReservedNumber({
    required Transaction transaction,
    required String uid,
    required String couponId,
    required DocumentReference<Map<String, dynamic>> doc,
    required Coupon coupon,
    required Set<String> reservedNumbers,
    required bool isCreate,
  }) async {
    for (
      var attempt = 0;
      attempt < maxCouponNumberGenerationAttempts;
      attempt += 1
    ) {
      final candidate = couponNumberCandidateForId(couponId, attempt: attempt);
      if (reservedNumbers.contains(candidate)) {
        continue;
      }

      final reservationRef = couponNumberReservationsCollection(
        uid,
      ).doc(candidate);
      final reservationDoc = await transaction.get(reservationRef);
      if (reservationDoc.exists) {
        continue;
      }

      final numberedCoupon = coupon.copyWith(
        id: couponId,
        couponNumber: candidate,
      );
      await _reserveManualCouponCodeIfNeeded(
        transaction: transaction,
        uid: uid,
        couponId: couponId,
        couponCode: numberedCoupon.couponCode,
      );
      transaction.set(reservationRef, {
        _couponNumberReservationCouponIdField: couponId,
        _couponNumberReservationCouponNumberField: candidate,
        if (isCreate)
          _couponNumberReservationCreatedAtField: FieldValue.serverTimestamp(),
        _couponNumberReservationUpdatedAtField: FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
      transaction.set(doc, {
        ...numberedCoupon.toFirestoreMap(id: couponId),
        if (isCreate) Coupon.fieldCreatedAt: FieldValue.serverTimestamp(),
        Coupon.fieldUpdatedAt: FieldValue.serverTimestamp(),
      }, SetOptions(merge: !isCreate));
      transaction.update(docForUser(uid), {
        Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
      });
      return numberedCoupon;
    }

    throw StateError(
      'No unique coupon number is available for this restaurant right now.',
    );
  }

  static Future<void> _reserveManualCouponCodeIfNeeded({
    required Transaction transaction,
    required String uid,
    required String couponId,
    required String? couponCode,
  }) async {
    final normalizedCouponCode = normalizedCouponCodeForComparison(couponCode);
    if (normalizedCouponCode == null) {
      return;
    }

    final reservationRef = couponCodeReservationsCollection(
      uid,
    ).doc(Uri.encodeComponent(normalizedCouponCode));
    final reservationDoc = await transaction.get(reservationRef);
    final existingCouponId = reservationDoc
        .data()?[_couponNumberReservationCouponIdField]
        ?.toString()
        .trim();
    if (reservationDoc.exists &&
        existingCouponId != null &&
        existingCouponId.isNotEmpty &&
        existingCouponId != couponId) {
      throw ArgumentError(
        'That coupon code is already used by this restaurant.',
      );
    }

    transaction.set(reservationRef, {
      _couponNumberReservationCouponIdField: couponId,
      _couponCodeReservationCouponCodeField: couponCode?.trim(),
      _couponCodeReservationNormalizedCouponCodeField: normalizedCouponCode,
      if (!reservationDoc.exists)
        _couponNumberReservationCreatedAtField: FieldValue.serverTimestamp(),
      _couponNumberReservationUpdatedAtField: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static String stableCouponNumberForId(
    String couponId, {
    Set<String> reservedNumbers = const <String>{},
    int maxAttempts = maxCouponNumberGenerationAttempts,
  }) {
    for (var attempt = 0; attempt < maxAttempts; attempt += 1) {
      final candidate = couponNumberCandidateForId(couponId, attempt: attempt);
      if (!reservedNumbers.contains(candidate)) {
        return candidate;
      }
    }

    throw StateError(
      'No unique coupon number is available for this restaurant right now.',
    );
  }

  static String couponNumberCandidateForId(
    String couponId, {
    required int attempt,
  }) {
    if (attempt < 0 || attempt >= maxCouponNumberGenerationAttempts) {
      throw RangeError.range(
        attempt,
        0,
        maxCouponNumberGenerationAttempts - 1,
        'attempt',
      );
    }

    var hash = 0;
    for (final codeUnit in couponId.trim().codeUnits) {
      hash = ((hash * 31) + codeUnit) & 0x7fffffff;
    }

    return ((hash + attempt) % 10000).toString().padLeft(4, '0');
  }

  static String? normalizedCouponCodeForComparison(String? couponCode) {
    final normalized = couponCode?.trim().toUpperCase();
    return normalized == null || normalized.isEmpty ? null : normalized;
  }

  static Future<List<Coupon>> loadCoupons(String uid) async {
    final trimmedUid = uid.trim();
    if (trimmedUid.isEmpty) {
      return const <Coupon>[];
    }
    final snapshot = await couponsCollection(
      trimmedUid,
    ).orderBy(Coupon.fieldCreatedAt, descending: true).get();

    final coupons = <Coupon>[];
    final usedCouponNumbers = <String>{};
    final parsedCoupons =
        <({QueryDocumentSnapshot<Map<String, dynamic>> doc, Coupon coupon})>[];

    for (final doc in snapshot.docs) {
      try {
        final coupon = Coupon.tryFromFirestore(doc.data(), fallbackId: doc.id);
        if (coupon != null) {
          parsedCoupons.add((doc: doc, coupon: coupon));
          final formattedNumber = coupon.formattedCouponNumber;
          if (formattedNumber != null) {
            usedCouponNumbers.add(formattedNumber);
          }
        }
      } catch (_) {
        continue;
      }
    }

    WriteBatch? backfillBatch;
    for (final entry in parsedCoupons) {
      final formattedNumber = entry.coupon.formattedCouponNumber;
      if (formattedNumber != null) {
        coupons.add(entry.coupon.copyWith(restaurantAccountId: trimmedUid));
        continue;
      }

      backfillBatch ??= _firestore.batch();
      final doc = entry.doc;
      final coupon = entry.coupon;
      final couponNumber = stableCouponNumberForId(
        doc.id,
        reservedNumbers: usedCouponNumbers,
      );
      usedCouponNumbers.add(couponNumber);
      coupons.add(
        coupon.copyWith(
          couponNumber: couponNumber,
          restaurantAccountId: trimmedUid,
        ),
      );
      backfillBatch.set(doc.reference, {
        Coupon.fieldCouponNumber: couponNumber,
      }, SetOptions(merge: true));
    }

    if (backfillBatch != null) {
      unawaited(backfillBatch.commit().catchError((_) {}));
    }

    return coupons;
  }

  static Future<List<DailySpecial>> loadDailySpecialsForRestaurant(
    String uid,
  ) async {
    final trimmedUid = uid.trim();
    if (trimmedUid.isEmpty) {
      return const [];
    }

    final snapshot = await dailySpecialsCollection(
      trimmedUid,
    ).orderBy(DailySpecial.fieldCreatedAt, descending: true).get();

    final specials = <DailySpecial>[];
    final expiredDocRefs = <DocumentReference<Map<String, dynamic>>>[];
    final now = DateTime.now();

    for (final doc in snapshot.docs) {
      try {
        final special = DailySpecial.tryFromFirestore(
          doc.data(),
          fallbackId: doc.id,
          fallbackRestaurantId: trimmedUid,
        );
        if (special != null) {
          if (DailySpecial.shouldCleanupExpiredTodayOnly(special, now: now)) {
            expiredDocRefs.add(doc.reference);
            continue;
          }
          specials.add(special);
        }
      } catch (_) {
        continue;
      }
    }

    unawaited(
      _deleteExpiredDailySpecialDocs(expiredDocRefs).catchError((_) {}),
    );
    return specials;
  }

  static Future<List<DailySpecial>> loadActiveDailySpecialsForRestaurant(
    String uid,
  ) async {
    final specials = await loadDailySpecialsForRestaurant(uid);
    final now = DateTime.now();
    return specials
        .where((special) => special.isActive && !special.isExpiredAt(now))
        .toList();
  }

  static Future<void> cleanupExpiredTodayOnlyDailySpecialsForRestaurant(
    String uid, {
    DateTime? now,
  }) async {
    final trimmedUid = uid.trim();
    if (trimmedUid.isEmpty) {
      return;
    }

    final snapshot = await dailySpecialsCollection(trimmedUid)
        .where(
          DailySpecial.fieldAvailabilityMode,
          isEqualTo: DailySpecialAvailabilityMode.todayOnly.firestoreValue,
        )
        .get();
    final effectiveNow = now ?? DateTime.now();
    final expiredDocRefs = <DocumentReference<Map<String, dynamic>>>[];

    for (final doc in snapshot.docs) {
      try {
        final special = DailySpecial.tryFromFirestore(
          doc.data(),
          fallbackId: doc.id,
          fallbackRestaurantId: trimmedUid,
        );
        if (special != null &&
            DailySpecial.shouldCleanupExpiredTodayOnly(
              special,
              now: effectiveNow,
            )) {
          expiredDocRefs.add(doc.reference);
        }
      } catch (_) {
        continue;
      }
    }

    await _deleteExpiredDailySpecialDocs(expiredDocRefs);
  }

  static Future<void> _deleteExpiredDailySpecialDocs(
    List<DocumentReference<Map<String, dynamic>>> docRefs,
  ) async {
    if (docRefs.isEmpty) {
      return;
    }

    final batch = _firestore.batch();
    for (final docRef in docRefs) {
      batch.delete(docRef);
    }
    await batch.commit();
  }

  static Future<void> deleteDailySpecial({
    required String uid,
    required String dailySpecialId,
  }) async {
    final trimmedUid = uid.trim();
    final trimmedSpecialId = dailySpecialId.trim();
    if (trimmedUid.isEmpty) {
      throw ArgumentError('Restaurant user ID is required.');
    }
    if (trimmedSpecialId.isEmpty) {
      throw ArgumentError('Daily special ID is required.');
    }

    await dailySpecialsCollection(trimmedUid).doc(trimmedSpecialId).delete();

    await docForUser(
      trimmedUid,
    ).update({Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp()});
  }

  static Future<void> deleteCoupon({
    required String uid,
    required String couponId,
  }) async {
    final batch = _firestore.batch();
    batch.delete(couponsCollection(uid).doc(couponId));
    batch.update(docForUser(uid), {
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
  }

  static Future<List<RestaurantMenuImage>> loadMenuImages(String uid) async {
    final snapshot = await menuImagesCollection(uid).get();
    final images = <RestaurantMenuImage>[];

    for (final doc in snapshot.docs) {
      final image = RestaurantMenuImage.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      if (image != null) {
        images.add(image);
      }
    }

    images.sort((a, b) {
      final sortComparison = a.sortOrder.compareTo(b.sortOrder);
      if (sortComparison != 0) {
        return sortComparison;
      }
      return a.id.compareTo(b.id);
    });
    return images;
  }

  static Future<List<RestaurantMenuItem>> loadMenuItems(String uid) async {
    final snapshot = await menuItemsCollection(uid).get();
    final items = <RestaurantMenuItem>[];

    for (final doc in snapshot.docs) {
      final item = RestaurantMenuItem.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      if (item != null) {
        items.add(item);
      }
    }

    items.sort((a, b) {
      final categoryComparison = a.category.compareTo(b.category);
      if (categoryComparison != 0) {
        return categoryComparison;
      }
      final sortComparison = a.sortOrder.compareTo(b.sortOrder);
      if (sortComparison != 0) {
        return sortComparison;
      }
      return a.name.compareTo(b.name);
    });
    return items;
  }

  static Future<List<RestaurantMenuSection>> loadMenuSections(
    String uid,
  ) async {
    final snapshot = await menuSectionsCollection(uid).get();
    final sections = <RestaurantMenuSection>[];

    for (final doc in snapshot.docs) {
      final section = RestaurantMenuSection.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      if (section != null) {
        sections.add(section);
      }
    }

    sections.sort((a, b) {
      final sortComparison = a.sortOrder.compareTo(b.sortOrder);
      if (sortComparison != 0) {
        return sortComparison;
      }
      return a.title.compareTo(b.title);
    });
    return sections;
  }

  static Future<RestaurantMenuImage> saveMenuImage({
    required String uid,
    required String imageUrl,
  }) async {
    await _ensureCanPostCoupons(uid);

    final trimmedUrl = imageUrl.trim();
    if (trimmedUrl.isEmpty) {
      throw ArgumentError('Menu image URL is required.');
    }

    final doc = menuImagesCollection(uid).doc();
    final sortOrder = DateTime.now().millisecondsSinceEpoch;
    await doc.set({
      RestaurantMenuImage.fieldId: doc.id,
      RestaurantMenuImage.fieldImageUrl: trimmedUrl,
      RestaurantMenuImage.fieldSortOrder: sortOrder,
      RestaurantMenuImage.fieldCreatedAt: FieldValue.serverTimestamp(),
      RestaurantMenuImage.fieldUpdatedAt: FieldValue.serverTimestamp(),
    });

    await docForUser(
      uid,
    ).update({Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp()});

    return RestaurantMenuImage(
      id: doc.id,
      imageUrl: trimmedUrl,
      sortOrder: sortOrder,
    );
  }

  static Future<RestaurantMenuItem> saveMenuItem({
    required String uid,
    required String name,
    required String description,
    required String price,
    required String category,
  }) async {
    await _ensureCanPostCoupons(uid);

    final trimmedName = name.trim();
    final trimmedCategory = category.trim();
    if (trimmedName.isEmpty) {
      throw ArgumentError('Menu item name is required.');
    }
    if (trimmedCategory.isEmpty) {
      throw ArgumentError('Menu item category is required.');
    }

    final doc = menuItemsCollection(uid).doc();
    final sortOrder = DateTime.now().millisecondsSinceEpoch;
    await doc.set({
      RestaurantMenuItem.fieldId: doc.id,
      RestaurantMenuItem.fieldName: trimmedName,
      RestaurantMenuItem.fieldDescription: description.trim(),
      RestaurantMenuItem.fieldPrice: price.trim(),
      RestaurantMenuItem.fieldCategory: trimmedCategory,
      RestaurantMenuItem.fieldSortOrder: sortOrder,
      RestaurantMenuItem.fieldCreatedAt: FieldValue.serverTimestamp(),
      RestaurantMenuItem.fieldUpdatedAt: FieldValue.serverTimestamp(),
    });

    await docForUser(
      uid,
    ).update({Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp()});

    return RestaurantMenuItem(
      id: doc.id,
      name: trimmedName,
      description: description.trim(),
      price: price.trim(),
      category: trimmedCategory,
      sortOrder: sortOrder,
    );
  }

  static Future<RestaurantMenuSection> saveMenuSection({
    required String uid,
    required String title,
    required String body,
    String? existingSectionId,
  }) async {
    await _ensureCanPostCoupons(uid);

    final trimmedTitle = title.trim();
    final trimmedBody = body.trim();
    if (trimmedTitle.isEmpty) {
      throw ArgumentError('Section title is required.');
    }
    if (trimmedBody.isEmpty) {
      throw ArgumentError('Menu section text is required.');
    }

    final trimmedId = existingSectionId?.trim();
    final isEditing = trimmedId != null && trimmedId.isNotEmpty;
    final doc = isEditing
        ? menuSectionsCollection(uid).doc(trimmedId)
        : menuSectionsCollection(uid).doc();
    var sortOrder = DateTime.now().millisecondsSinceEpoch;
    DateTime? createdAt;
    if (isEditing) {
      final existingSnapshot = await doc.get();
      final existingSection = RestaurantMenuSection.tryFromFirestore(
        existingSnapshot.data(),
        fallbackId: doc.id,
      );
      sortOrder = existingSection?.sortOrder ?? sortOrder;
      createdAt = existingSection?.createdAt;
    }

    await doc.set({
      RestaurantMenuSection.fieldId: doc.id,
      RestaurantMenuSection.fieldTitle: trimmedTitle,
      RestaurantMenuSection.fieldBody: trimmedBody,
      RestaurantMenuSection.fieldSortOrder: sortOrder,
      if (!isEditing)
        RestaurantMenuSection.fieldCreatedAt: FieldValue.serverTimestamp(),
      RestaurantMenuSection.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    await docForUser(
      uid,
    ).update({Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp()});

    return RestaurantMenuSection(
      id: doc.id,
      title: trimmedTitle,
      body: trimmedBody,
      sortOrder: sortOrder,
      createdAt: createdAt,
      updatedAt: DateTime.now(),
    );
  }

  static Future<void> deleteMenuImage({
    required String uid,
    required String imageId,
  }) async {
    await _ensureCanPostCoupons(uid);
    await menuImagesCollection(uid).doc(imageId.trim()).delete();
    await docForUser(
      uid,
    ).update({Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp()});
  }

  static Future<void> deleteMenuItem({
    required String uid,
    required String itemId,
  }) async {
    await _ensureCanPostCoupons(uid);
    await menuItemsCollection(uid).doc(itemId.trim()).delete();
    await docForUser(
      uid,
    ).update({Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp()});
  }

  static Future<void> deleteMenuSection({
    required String uid,
    required String sectionId,
  }) async {
    await _ensureCanPostCoupons(uid);
    await menuSectionsCollection(uid).doc(sectionId.trim()).delete();
    await docForUser(
      uid,
    ).update({Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp()});
  }

  static Future<void> _ensureNoDuplicateCoupon({
    required String uid,
    required String title,
    required DateTime startTime,
    required DateTime endTime,
  }) async {
    final duplicateSnapshot = await couponsCollection(uid)
        .where(Coupon.fieldTitle, isEqualTo: title)
        .where(Coupon.fieldStartTime, isEqualTo: Timestamp.fromDate(startTime))
        .where(Coupon.fieldEndTime, isEqualTo: Timestamp.fromDate(endTime))
        .limit(1)
        .get();

    if (duplicateSnapshot.docs.isNotEmpty) {
      throw ArgumentError(
        'A coupon with the same title and schedule already exists.',
      );
    }
  }

  static Future<void> _ensureNoDuplicateCouponCode({
    required String uid,
    required String? couponCode,
    String? excludeCouponId,
  }) async {
    final normalizedCouponCode = normalizedCouponCodeForComparison(couponCode);
    if (normalizedCouponCode == null) {
      return;
    }

    final snapshot = await couponsCollection(uid).get();
    for (final doc in snapshot.docs) {
      if (excludeCouponId != null && doc.id == excludeCouponId) {
        continue;
      }

      final existingCouponCode = normalizedCouponCodeForComparison(
        doc.data()[Coupon.fieldCouponCode]?.toString(),
      );
      if (existingCouponCode == normalizedCouponCode) {
        throw ArgumentError(
          'That coupon code is already used by this restaurant.',
        );
      }
    }
  }

  static Future<List<Restaurant>> loadApprovedRestaurantsWithCoupons() async {
    final accountsSnapshot = await _customerRestaurantProjectionQuery().get();

    final restaurants = <Restaurant>[];

    for (final doc in accountsSnapshot.docs) {
      try {
        final projectionData = doc.data();
        final publicRestaurant = customerRestaurantFromProjectionData(
          projectionData,
          projectionDocumentId: doc.id,
        );
        final accountDocumentId = publicRestaurant?.accountDocumentId;
        if (publicRestaurant == null || accountDocumentId == null) {
          continue;
        }

        final allCoupons = await loadCoupons(accountDocumentId);
        final coupons = customerVisibleCouponsForProjectionData(
          projectionData,
          allCoupons,
        );
        final dailySpecials = await loadDailySpecialsForRestaurant(
          accountDocumentId,
        );
        final restaurant = customerRestaurantFromProjectionData(
          projectionData,
          expectedRestaurantId: accountDocumentId,
          projectionDocumentId: doc.id,
          coupons: coupons,
          dailySpecials: dailySpecials,
        );

        if (restaurant == null) {
          continue;
        }

        restaurants.add(restaurant);
      } catch (_) {
        continue;
      }
    }

    return restaurants;
  }

  @visibleForTesting
  static String canonicalAccountUidForAccountData(
    Map<String, dynamic> data, {
    required String fallbackUid,
  }) {
    final normalizedData = _normalizedRestaurantAccountData(
      data,
      fallbackUid: fallbackUid,
    );
    return _canonicalAccountUidFromNormalizedData(
      normalizedData,
      fallbackUid: fallbackUid,
    );
  }

  @visibleForTesting
  static Map<String, dynamic> normalizedAccountDataForTesting(
    Map<String, dynamic> data, {
    required String fallbackUid,
  }) {
    return _normalizedRestaurantAccountData(data, fallbackUid: fallbackUid);
  }

  static String _canonicalAccountUidFromNormalizedData(
    Map<String, dynamic> normalizedData, {
    required String fallbackUid,
  }) {
    return _readString(normalizedData[Restaurant.fieldUid]) ?? fallbackUid;
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
      Restaurant.fieldState: _readString(data[Restaurant.fieldState]) ?? '',
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
      Restaurant.fieldMainImageUrl:
          _readString(data[Restaurant.fieldMainImageUrl]) ??
          _readString(data[Restaurant.legacyFieldImageUrl]),
      Restaurant.fieldBusinessHours: data[Restaurant.fieldBusinessHours],
      Restaurant.fieldLatitude: _readDouble(data[Restaurant.fieldLatitude]),
      Restaurant.fieldLongitude: _readDouble(data[Restaurant.fieldLongitude]),
      Restaurant.fieldProfileVersion: data[Restaurant.fieldProfileVersion],
      Restaurant.fieldLocationVersion: data[Restaurant.fieldLocationVersion],
      Restaurant.fieldFormattedAddress: _readString(
        data[Restaurant.fieldFormattedAddress],
      ),
      Restaurant.fieldAddressFingerprint: _readString(
        data[Restaurant.fieldAddressFingerprint],
      ),
      Restaurant.fieldLocationValidatedAt:
          data[Restaurant.fieldLocationValidatedAt],
      Restaurant.fieldLocationSource: _readString(
        data[Restaurant.fieldLocationSource],
      ),
      Restaurant.fieldApprovalStatus:
          _readString(data[Restaurant.fieldApprovalStatus]) ?? 'pending',
      'couponApplicationSubmitted': _readBool(
        data['couponApplicationSubmitted'],
      ),
      'subscriptionStatus':
          _readString(data['subscriptionStatus']) ?? 'inactive',
      'cancelAtPeriodEnd': _readBool(data['cancelAtPeriodEnd']),
      'trialEndsAt': data['trialEndsAt'],
      'subscriptionEndsAt': data['subscriptionEndsAt'],
      'billingPlanName': _readString(data['billingPlanName']),
      'hasUsedTrial': _readBool(data['hasUsedTrial']),
      'couponPostingEnabled': data['couponPostingEnabled'] is bool
          ? data['couponPostingEnabled'] as bool
          : null,
      adminHiddenField: isAdminHidden(data),
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

    final approvalStatus =
        (_readString(data[Restaurant.fieldApprovalStatus]) ?? 'pending')
            .toLowerCase();
    if (approvalStatus != 'approved') {
      return false;
    }

    return data['couponPostingEnabled'] == true;
  }

  static Future<void> _ensureCanPostCoupons(String uid) async {
    final data = await getAccountData(uid);
    if (_canPostCouponsFromData(data)) {
      return;
    }

    throw StateError(
      'An approved active subscription is required before posting coupons or daily specials.',
    );
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

class RestaurantMenuImage {
  static const String fieldId = 'id';
  static const String fieldImageUrl = 'imageUrl';
  static const String fieldStoragePath = 'storagePath';
  static const String fieldSortOrder = 'sortOrder';
  static const String fieldCreatedAt = 'createdAt';
  static const String fieldUpdatedAt = 'updatedAt';

  final String id;
  final String imageUrl;
  final String? storagePath;
  final int sortOrder;

  const RestaurantMenuImage({
    required this.id,
    required this.imageUrl,
    this.storagePath,
    required this.sortOrder,
  });

  static RestaurantMenuImage? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final imageUrl = RestaurantAccountService._readString(data[fieldImageUrl]);
    if (imageUrl == null) {
      return null;
    }

    return RestaurantMenuImage(
      id: RestaurantAccountService._readString(data[fieldId]) ?? fallbackId,
      imageUrl: imageUrl,
      storagePath: RestaurantAccountService._readString(data[fieldStoragePath]),
      sortOrder: _readInt(data[fieldSortOrder]) ?? 0,
    );
  }
}

class RestaurantMenuItem {
  static const String fieldId = 'id';
  static const String fieldName = 'name';
  static const String fieldDescription = 'description';
  static const String fieldPrice = 'price';
  static const String fieldCategory = 'category';
  static const String fieldSortOrder = 'sortOrder';
  static const String fieldCreatedAt = 'createdAt';
  static const String fieldUpdatedAt = 'updatedAt';

  final String id;
  final String name;
  final String description;
  final String price;
  final String category;
  final int sortOrder;

  const RestaurantMenuItem({
    required this.id,
    required this.name,
    required this.description,
    required this.price,
    required this.category,
    required this.sortOrder,
  });

  static RestaurantMenuItem? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final name = RestaurantAccountService._readString(data[fieldName]);
    final category = RestaurantAccountService._readString(data[fieldCategory]);
    if (name == null || category == null) {
      return null;
    }

    return RestaurantMenuItem(
      id: RestaurantAccountService._readString(data[fieldId]) ?? fallbackId,
      name: name,
      description:
          RestaurantAccountService._readString(data[fieldDescription]) ?? '',
      price: RestaurantAccountService._readString(data[fieldPrice]) ?? '',
      category: category,
      sortOrder: _readInt(data[fieldSortOrder]) ?? 0,
    );
  }
}

class RestaurantMenuSection {
  static const String fieldId = 'id';
  static const String fieldTitle = 'title';
  static const String fieldBody = 'body';
  static const String fieldSortOrder = 'sortOrder';
  static const String fieldCreatedAt = 'createdAt';
  static const String fieldUpdatedAt = 'updatedAt';

  final String id;
  final String title;
  final String body;
  final int sortOrder;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const RestaurantMenuSection({
    required this.id,
    required this.title,
    required this.body,
    required this.sortOrder,
    this.createdAt,
    this.updatedAt,
  });

  static RestaurantMenuSection? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final title = RestaurantAccountService._readString(data[fieldTitle]);
    final body = RestaurantAccountService._readString(data[fieldBody]);
    if (title == null || body == null) {
      return null;
    }

    return RestaurantMenuSection(
      id: RestaurantAccountService._readString(data[fieldId]) ?? fallbackId,
      title: title,
      body: body,
      sortOrder: _readInt(data[fieldSortOrder]) ?? 0,
      createdAt: RestaurantAccountService._readDateTime(data[fieldCreatedAt]),
      updatedAt: RestaurantAccountService._readDateTime(data[fieldUpdatedAt]),
    );
  }
}

int? _readInt(dynamic value) {
  if (value is int) {
    return value;
  }
  if (value is num) {
    return value.toInt();
  }
  if (value is String) {
    return int.tryParse(value.trim());
  }
  return null;
}
