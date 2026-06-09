import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/coupon.dart';
import '../models/daily_special.dart';
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
    final snapshot = await doc.get();
    final trimmedRestaurantName = restaurantName?.trim();
    final trimmedStreetAddress = streetAddress?.trim();
    final trimmedCity = city?.trim();
    final trimmedState = state?.trim();
    final trimmedZipCode = zipCode?.trim();
    final trimmedPhone = phone?.trim();
    final trimmedEmail = user.email?.trim();
    final trimmedPhoneNumber = user.phoneNumber?.trim();
    final trimmedDisplayName = user.displayName?.trim();

    if (!snapshot.exists) {
      await doc.set({
        Restaurant.fieldUid: user.uid,
        if (trimmedEmail != null && trimmedEmail.isNotEmpty)
          Restaurant.fieldEmail: trimmedEmail,
        if (trimmedPhoneNumber != null && trimmedPhoneNumber.isNotEmpty)
          'phoneNumber': trimmedPhoneNumber,
        if (trimmedDisplayName != null && trimmedDisplayName.isNotEmpty)
          'displayName': trimmedDisplayName,
        if (trimmedRestaurantName != null && trimmedRestaurantName.isNotEmpty)
          Restaurant.fieldName: trimmedRestaurantName,
        if (trimmedStreetAddress != null && trimmedStreetAddress.isNotEmpty)
          Restaurant.fieldStreetAddress: trimmedStreetAddress,
        if (trimmedCity != null && trimmedCity.isNotEmpty)
          Restaurant.fieldCity: trimmedCity,
        if (trimmedState != null && trimmedState.isNotEmpty)
          Restaurant.fieldState: trimmedState,
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
      if (trimmedEmail != null && trimmedEmail.isNotEmpty)
        Restaurant.fieldEmail: trimmedEmail,
      if (trimmedPhoneNumber != null && trimmedPhoneNumber.isNotEmpty)
        'phoneNumber': trimmedPhoneNumber,
      if (trimmedDisplayName != null && trimmedDisplayName.isNotEmpty)
        'displayName': trimmedDisplayName,
      if (trimmedRestaurantName != null && trimmedRestaurantName.isNotEmpty)
        Restaurant.fieldName: trimmedRestaurantName,
      if (trimmedStreetAddress != null && trimmedStreetAddress.isNotEmpty)
        Restaurant.fieldStreetAddress: trimmedStreetAddress,
      if (trimmedCity != null && trimmedCity.isNotEmpty)
        Restaurant.fieldCity: trimmedCity,
      if (trimmedState != null && trimmedState.isNotEmpty)
        Restaurant.fieldState: trimmedState,
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
    final trimmedEmail = user.email?.trim();
    final trimmedPhoneNumber = user.phoneNumber?.trim();
    final trimmedDisplayName = user.displayName?.trim();
    await docForUser(user.uid).set({
      'emailVerified': user.emailVerified,
      if (trimmedEmail != null && trimmedEmail.isNotEmpty)
        Restaurant.fieldEmail: trimmedEmail,
      if (trimmedPhoneNumber != null && trimmedPhoneNumber.isNotEmpty)
        'phoneNumber': trimmedPhoneNumber,
      if (trimmedDisplayName != null && trimmedDisplayName.isNotEmpty)
        'displayName': trimmedDisplayName,
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
        (_readString(data[Restaurant.fieldState]) ?? '').isNotEmpty &&
        (_readString(data[Restaurant.fieldZipCode]) ?? '').isNotEmpty &&
        (_readString(data[Restaurant.fieldPhone]) ?? '').isNotEmpty;
  }

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

    await docForUser(trimmedUid).set({
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
    }, SetOptions(merge: true));
  }

  static Future<void> saveRestaurantCoordinates({
    required String uid,
    required double latitude,
    required double longitude,
  }) async {
    await docForUser(uid).set({
      Restaurant.fieldLatitude: latitude,
      Restaurant.fieldLongitude: longitude,
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
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

    final doc = couponsCollection(uid).doc();
    await _ensureNoDuplicateCoupon(
      uid: uid,
      title: sanitizedCoupon.title,
      startTime: sanitizedCoupon.startTime!,
      endTime: sanitizedCoupon.endTime!,
    );

    await doc.set({
      ...sanitizedCoupon.toFirestoreMap(id: doc.id),
      Coupon.fieldCreatedAt: FieldValue.serverTimestamp(),
      Coupon.fieldUpdatedAt: FieldValue.serverTimestamp(),
    });

    await docForUser(uid).set({
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    return sanitizedCoupon.copyWith(id: doc.id);
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

    await couponsCollection(uid).doc(couponId).set({
      ...sanitizedCoupon.toFirestoreMap(id: couponId),
      Coupon.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    await docForUser(uid).set({
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    return sanitizedCoupon;
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
    final sanitizedSpecial = dailySpecial
        .copyWith(id: doc.id, restaurantId: trimmedUid, ownerUid: trimmedUid)
        .sanitizedForSave(id: doc.id);
    final validationError = sanitizedSpecial.validateForSave();
    if (validationError != null) {
      throw ArgumentError(validationError);
    }

    await doc.set({
      ...sanitizedSpecial.toFirestoreMap(id: doc.id),
      DailySpecial.fieldCreatedAt: FieldValue.serverTimestamp(),
      DailySpecial.fieldUpdatedAt: FieldValue.serverTimestamp(),
    });

    await docForUser(trimmedUid).set({
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

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

    final sanitizedSpecial = dailySpecial
        .copyWith(id: specialId, restaurantId: trimmedUid, ownerUid: trimmedUid)
        .sanitizedForSave(id: specialId);
    final validationError = sanitizedSpecial.validateForSave();
    if (validationError != null) {
      throw ArgumentError(validationError);
    }

    await dailySpecialsCollection(trimmedUid).doc(specialId).set({
      ...sanitizedSpecial.toFirestoreMap(id: specialId),
      DailySpecial.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    await docForUser(trimmedUid).set({
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

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

  static Future<List<Coupon>> loadCoupons(String uid) async {
    final snapshot = await couponsCollection(
      uid,
    ).orderBy(Coupon.fieldCreatedAt, descending: true).get();

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

    for (final doc in snapshot.docs) {
      try {
        final special = DailySpecial.tryFromFirestore(
          doc.data(),
          fallbackId: doc.id,
          fallbackRestaurantId: trimmedUid,
        );
        if (special != null) {
          specials.add(special);
        }
      } catch (_) {
        continue;
      }
    }

    return specials;
  }

  static Future<List<DailySpecial>> loadActiveDailySpecialsForRestaurant(
    String uid,
  ) async {
    final specials = await loadDailySpecialsForRestaurant(uid);
    return specials.where((special) => special.isActive).toList();
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

    await docForUser(trimmedUid).set({
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
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

    await docForUser(uid).set({
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

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

    await docForUser(uid).set({
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

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

    await docForUser(uid).set({
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

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
    await docForUser(uid).set({
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<void> deleteMenuItem({
    required String uid,
    required String itemId,
  }) async {
    await _ensureCanPostCoupons(uid);
    await menuItemsCollection(uid).doc(itemId.trim()).delete();
    await docForUser(uid).set({
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<void> deleteMenuSection({
    required String uid,
    required String sectionId,
  }) async {
    await _ensureCanPostCoupons(uid);
    await menuSectionsCollection(uid).doc(sectionId.trim()).delete();
    await docForUser(uid).set({
      Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<void> deleteRestaurantAccount(String uid) async {
    final couponsSnapshot = await couponsCollection(uid).get();
    final dailySpecialsSnapshot = await dailySpecialsCollection(uid).get();

    if (couponsSnapshot.docs.isNotEmpty ||
        dailySpecialsSnapshot.docs.isNotEmpty) {
      final batch = _firestore.batch();

      for (final doc in couponsSnapshot.docs) {
        batch.delete(doc.reference);
      }

      for (final doc in dailySpecialsSnapshot.docs) {
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
        final uid = _readString(normalizedData[Restaurant.fieldUid]) ?? doc.id;

        final coupons = await loadCoupons(uid);
        final dailySpecials = await loadDailySpecialsForRestaurant(uid);
        final restaurant = Restaurant.fromFirestore(
          normalizedData,
          coupons: coupons,
          dailySpecials: dailySpecials,
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
      Restaurant.fieldApprovalStatus:
          _readString(data[Restaurant.fieldApprovalStatus]) ?? 'pending',
      'couponApplicationSubmitted': _readBool(
        data['couponApplicationSubmitted'],
      ),
      'subscriptionStatus':
          _readString(data['subscriptionStatus']) ?? 'inactive',
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

    final approvalStatus =
        (_readString(data[Restaurant.fieldApprovalStatus]) ?? 'pending')
            .toLowerCase();
    if (approvalStatus != 'approved') {
      return false;
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
