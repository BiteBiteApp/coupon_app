import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/bitescore_restaurant.dart';
import '../models/restaurant.dart';
import 'restaurant_account_service.dart';

enum RestaurantMenuSourceType { legacyBiteSaver, sharedMenu }

enum RestaurantMenuAppSide { biteSaver, biteScore }

class RestaurantMenuSource {
  final RestaurantMenuSourceType type;
  final String id;

  const RestaurantMenuSource._({required this.type, required this.id});

  factory RestaurantMenuSource.legacyBiteSaver(String uid) {
    return RestaurantMenuSource._(
      type: RestaurantMenuSourceType.legacyBiteSaver,
      id: uid.trim(),
    );
  }

  factory RestaurantMenuSource.sharedMenu(String menuId) {
    return RestaurantMenuSource._(
      type: RestaurantMenuSourceType.sharedMenu,
      id: menuId.trim(),
    );
  }

  bool get isLegacyBiteSaver =>
      type == RestaurantMenuSourceType.legacyBiteSaver;
  bool get isSharedMenu => type == RestaurantMenuSourceType.sharedMenu;
}

class RestaurantMenuManageAccess {
  final RestaurantMenuSource? source;
  final bool isBlocked;
  final RestaurantMenuAppSide? managedBy;
  final String? message;

  const RestaurantMenuManageAccess._({
    required this.source,
    required this.isBlocked,
    this.managedBy,
    this.message,
  });

  factory RestaurantMenuManageAccess.allowed(RestaurantMenuSource source) {
    return RestaurantMenuManageAccess._(source: source, isBlocked: false);
  }

  factory RestaurantMenuManageAccess.blocked({
    required RestaurantMenuAppSide managedBy,
    required String message,
  }) {
    return RestaurantMenuManageAccess._(
      source: null,
      isBlocked: true,
      managedBy: managedBy,
      message: message,
    );
  }
}

class RestaurantMenuService {
  static final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  static const String menuSourceSideField = 'menuSourceSide';
  static const String linkedBiteScoreRestaurantIdField =
      'linkedBiteScoreRestaurantId';
  static const String linkedBiteSaverUidField = 'linkedBiteSaverUid';
  static const String menuSourceUpdatedAtField = 'menuSourceUpdatedAt';
  static const String menuSourceUpdatedByField = 'menuSourceUpdatedBy';
  static const String menuSourceBiteSaver = 'biteSaver';
  static const String menuSourceBiteScore = 'biteScore';

  static CollectionReference<Map<String, dynamic>> sharedMenusCollection() {
    return _firestore.collection('restaurant_menus');
  }

  static CollectionReference<Map<String, dynamic>> _menuImagesCollection(
    RestaurantMenuSource source,
  ) {
    if (source.isLegacyBiteSaver) {
      return RestaurantAccountService.menuImagesCollection(source.id);
    }
    return sharedMenusCollection().doc(source.id).collection('menu_images');
  }

  static CollectionReference<Map<String, dynamic>> _menuItemsCollection(
    RestaurantMenuSource source,
  ) {
    if (source.isLegacyBiteSaver) {
      return RestaurantAccountService.menuItemsCollection(source.id);
    }
    return sharedMenusCollection().doc(source.id).collection('menu_items');
  }

  static CollectionReference<Map<String, dynamic>> _menuSectionsCollection(
    RestaurantMenuSource source,
  ) {
    if (source.isLegacyBiteSaver) {
      return RestaurantAccountService.menuSectionsCollection(source.id);
    }
    return sharedMenusCollection().doc(source.id).collection('menu_sections');
  }

  static Future<RestaurantMenuSource?> resolveBiteSaverPublicMenuSource({
    required String uid,
  }) async {
    final trimmedUid = uid.trim();
    if (trimmedUid.isEmpty) {
      return null;
    }

    final accountData = await _loadBiteSaverAccountData(trimmedUid);
    final sourceSide = _readString(accountData?[menuSourceSideField]);
    if (sourceSide == menuSourceBiteScore) {
      final biteScoreRestaurantId = _readString(
        accountData?[linkedBiteScoreRestaurantIdField],
      );
      final biteScoreRestaurant = await _loadBiteScoreRestaurantById(
        biteScoreRestaurantId,
      );
      final sharedMenuId = biteScoreRestaurant?.sharedMenuId?.trim();
      if (sharedMenuId == null || sharedMenuId.isEmpty) {
        return null;
      }
      return RestaurantMenuSource.sharedMenu(sharedMenuId);
    }

    return RestaurantMenuSource.legacyBiteSaver(trimmedUid);
  }

  static Future<RestaurantMenuSource?> resolveBiteScorePublicMenuSource({
    required String restaurantId,
  }) async {
    final restaurant = await _loadBiteScoreRestaurantById(restaurantId);
    if (restaurant == null) {
      return null;
    }

    final snapshot = await _firestore
        .collection(BitescoreRestaurant.collectionName)
        .doc(restaurant.id)
        .get();
    final data = snapshot.data();
    final sourceSide = _readString(data?[menuSourceSideField]);
    if (sourceSide == menuSourceBiteSaver) {
      final biteSaverUid = _readString(data?[linkedBiteSaverUidField]);
      if (biteSaverUid == null || biteSaverUid.isEmpty) {
        return null;
      }
      return RestaurantMenuSource.legacyBiteSaver(biteSaverUid);
    }

    final sharedMenuId = restaurant.sharedMenuId?.trim();
    if (sharedMenuId == null || sharedMenuId.isEmpty) {
      return null;
    }
    return RestaurantMenuSource.sharedMenu(sharedMenuId);
  }

  static Future<RestaurantMenuManageAccess> resolveBiteSaverManageMenuAccess({
    required String uid,
  }) async {
    final trimmedUid = uid.trim();
    if (trimmedUid.isEmpty) {
      return RestaurantMenuManageAccess.blocked(
        managedBy: RestaurantMenuAppSide.biteSaver,
        message: 'Menu source is unavailable.',
      );
    }

    final accountData = await _loadBiteSaverAccountData(trimmedUid);
    final sourceSide = _readString(accountData?[menuSourceSideField]);
    if (sourceSide == menuSourceBiteScore) {
      return RestaurantMenuManageAccess.blocked(
        managedBy: RestaurantMenuAppSide.biteScore,
        message: 'Menu is managed on BiteScore',
      );
    }

    return RestaurantMenuManageAccess.allowed(
      RestaurantMenuSource.legacyBiteSaver(trimmedUid),
    );
  }

  static Future<RestaurantMenuManageAccess> resolveBiteScoreManageMenuAccess({
    required BitescoreRestaurant restaurant,
    required String ownerUserId,
  }) async {
    final latestRestaurant =
        await _loadBiteScoreRestaurantById(restaurant.id) ?? restaurant;
    final snapshot = await _firestore
        .collection(BitescoreRestaurant.collectionName)
        .doc(latestRestaurant.id)
        .get();
    final data = snapshot.data();
    final sourceSide = _readString(data?[menuSourceSideField]);
    if (sourceSide == menuSourceBiteSaver) {
      return RestaurantMenuManageAccess.blocked(
        managedBy: RestaurantMenuAppSide.biteSaver,
        message: 'Menu is managed on BiteSaver',
      );
    }

    final source = await ensureSharedMenuForBiteScoreRestaurant(
      restaurant: latestRestaurant,
      ownerUserId: ownerUserId,
    );
    return RestaurantMenuManageAccess.allowed(source);
  }

  static Future<BitescoreRestaurant?> findLikelyBiteScoreMatchForBiteSaver({
    required String uid,
  }) async {
    final trimmedUid = uid.trim();
    if (trimmedUid.isEmpty) {
      return null;
    }
    final accountData = await _loadBiteSaverAccountData(trimmedUid);
    if (accountData == null) {
      return null;
    }
    final biteSaverRestaurant = Restaurant.fromFirestore({
      ...accountData,
      Restaurant.fieldUid: trimmedUid,
    }, coupons: const []);
    final snapshot = await _firestore
        .collection(BitescoreRestaurant.collectionName)
        .where('ownerUserId', isEqualTo: trimmedUid)
        .get();

    for (final doc in snapshot.docs) {
      final biteScoreRestaurant = _parseBiteScoreRestaurant(
        doc.data(),
        fallbackId: doc.id,
      );
      if (biteScoreRestaurant == null || !biteScoreRestaurant.isClaimed) {
        continue;
      }
      if (_isLikelySameRestaurant(
        biteSaverRestaurant: biteSaverRestaurant,
        biteScoreRestaurant: biteScoreRestaurant,
      )) {
        return biteScoreRestaurant;
      }
    }
    return null;
  }

  static Future<String?> findLikelyBiteSaverMatchForBiteScore({
    required String ownerUserId,
    required BitescoreRestaurant restaurant,
  }) async {
    final ownerId = ownerUserId.trim();
    if (ownerId.isEmpty) {
      return null;
    }
    final accountData = await _loadBiteSaverAccountData(ownerId);
    if (accountData == null) {
      return null;
    }
    final biteSaverRestaurant = Restaurant.fromFirestore({
      ...accountData,
      Restaurant.fieldUid: ownerId,
    }, coupons: const []);
    if (!_isLikelySameRestaurant(
      biteSaverRestaurant: biteSaverRestaurant,
      biteScoreRestaurant: restaurant,
    )) {
      return null;
    }
    return ownerId;
  }

  static Future<bool> biteSaverUsesBiteScoreMenu(String uid) async {
    final accountData = await _loadBiteSaverAccountData(uid);
    return _readString(accountData?[menuSourceSideField]) ==
        menuSourceBiteScore;
  }

  static Future<bool> biteScoreUsesBiteSaverMenu(String restaurantId) async {
    final data = await _loadBiteScoreRestaurantData(restaurantId);
    return _readString(data?[menuSourceSideField]) == menuSourceBiteSaver;
  }

  static Future<void> setBiteSaverMenuSourceToBiteScore({
    required String uid,
    required String biteScoreRestaurantId,
    required String updatedBy,
  }) async {
    final trimmedUid = uid.trim();
    final trimmedRestaurantId = biteScoreRestaurantId.trim();
    if (trimmedUid.isEmpty || trimmedRestaurantId.isEmpty) {
      throw ArgumentError('Matching BiteScore restaurant is required.');
    }
    final biteScoreRestaurant = await _loadBiteScoreRestaurantById(
      trimmedRestaurantId,
    );
    if (biteScoreRestaurant == null ||
        biteScoreRestaurant.ownerUserId?.trim() != trimmedUid ||
        !biteScoreRestaurant.isClaimed) {
      throw StateError('Matching BiteScore restaurant is required.');
    }
    if (await biteScoreUsesBiteSaverMenu(trimmedRestaurantId)) {
      throw StateError('This menu is already being used by the other side.');
    }
    await ensureSharedMenuForBiteScoreRestaurant(
      restaurant: biteScoreRestaurant,
      ownerUserId: trimmedUid,
    );
    await RestaurantAccountService.docForUser(trimmedUid).set({
      menuSourceSideField: menuSourceBiteScore,
      linkedBiteScoreRestaurantIdField: trimmedRestaurantId,
      menuSourceUpdatedAtField: FieldValue.serverTimestamp(),
      menuSourceUpdatedByField: updatedBy.trim(),
    }, SetOptions(merge: true));
  }

  static Future<void> clearBiteSaverMenuSourceRouting({
    required String uid,
    required String updatedBy,
  }) async {
    final trimmedUid = uid.trim();
    if (trimmedUid.isEmpty) {
      return;
    }
    await RestaurantAccountService.docForUser(trimmedUid).set({
      menuSourceSideField: menuSourceBiteSaver,
      linkedBiteScoreRestaurantIdField: FieldValue.delete(),
      menuSourceUpdatedAtField: FieldValue.serverTimestamp(),
      menuSourceUpdatedByField: updatedBy.trim(),
    }, SetOptions(merge: true));
  }

  static Future<void> setBiteScoreMenuSourceToBiteSaver({
    required String restaurantId,
    required String biteSaverUid,
    required String updatedBy,
  }) async {
    final trimmedRestaurantId = restaurantId.trim();
    final trimmedUid = biteSaverUid.trim();
    if (trimmedRestaurantId.isEmpty || trimmedUid.isEmpty) {
      throw ArgumentError('Matching BiteSaver restaurant is required.');
    }
    final restaurant = await _loadBiteScoreRestaurantById(trimmedRestaurantId);
    if (restaurant == null ||
        restaurant.ownerUserId?.trim() != trimmedUid ||
        !restaurant.isClaimed) {
      throw StateError('Matching BiteSaver restaurant is required.');
    }
    final matchedUid = await findLikelyBiteSaverMatchForBiteScore(
      ownerUserId: trimmedUid,
      restaurant: restaurant,
    );
    if (matchedUid == null) {
      throw StateError('Matching BiteSaver restaurant is required.');
    }
    if (await biteSaverUsesBiteScoreMenu(matchedUid)) {
      throw StateError('This menu is already being used by the other side.');
    }
    await _firestore
        .collection(BitescoreRestaurant.collectionName)
        .doc(trimmedRestaurantId)
        .set({
          menuSourceSideField: menuSourceBiteSaver,
          linkedBiteSaverUidField: matchedUid,
          menuSourceUpdatedAtField: FieldValue.serverTimestamp(),
          menuSourceUpdatedByField: updatedBy.trim(),
        }, SetOptions(merge: true));
  }

  static Future<void> clearBiteScoreMenuSourceRouting({
    required String restaurantId,
    required String updatedBy,
  }) async {
    final trimmedRestaurantId = restaurantId.trim();
    if (trimmedRestaurantId.isEmpty) {
      return;
    }
    await _firestore
        .collection(BitescoreRestaurant.collectionName)
        .doc(trimmedRestaurantId)
        .set({
          menuSourceSideField: menuSourceBiteScore,
          linkedBiteSaverUidField: FieldValue.delete(),
          menuSourceUpdatedAtField: FieldValue.serverTimestamp(),
          menuSourceUpdatedByField: updatedBy.trim(),
        }, SetOptions(merge: true));
  }

  static Future<List<RestaurantMenuImage>> loadMenuImages(
    RestaurantMenuSource source,
  ) async {
    if (source.id.isEmpty) {
      return const <RestaurantMenuImage>[];
    }
    if (source.isLegacyBiteSaver) {
      return RestaurantAccountService.loadMenuImages(source.id);
    }

    final snapshot = await _menuImagesCollection(source).get();
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

  static Future<List<RestaurantMenuItem>> loadMenuItems(
    RestaurantMenuSource source,
  ) async {
    if (source.id.isEmpty) {
      return const <RestaurantMenuItem>[];
    }
    if (source.isLegacyBiteSaver) {
      return RestaurantAccountService.loadMenuItems(source.id);
    }

    final snapshot = await _menuItemsCollection(source).get();
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
    RestaurantMenuSource source,
  ) async {
    if (source.id.isEmpty) {
      return const <RestaurantMenuSection>[];
    }
    if (source.isLegacyBiteSaver) {
      return RestaurantAccountService.loadMenuSections(source.id);
    }

    final snapshot = await _menuSectionsCollection(source).get();
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
    required RestaurantMenuSource source,
    required String imageUrl,
    String? storagePath,
  }) async {
    if (source.isLegacyBiteSaver) {
      return RestaurantAccountService.saveMenuImage(
        uid: source.id,
        imageUrl: imageUrl,
      );
    }

    final trimmedUrl = imageUrl.trim();
    if (trimmedUrl.isEmpty) {
      throw ArgumentError('Menu image URL is required.');
    }

    final doc = _menuImagesCollection(source).doc();
    final sortOrder = DateTime.now().millisecondsSinceEpoch;
    await doc.set({
      RestaurantMenuImage.fieldId: doc.id,
      RestaurantMenuImage.fieldImageUrl: trimmedUrl,
      RestaurantMenuImage.fieldStoragePath: storagePath?.trim(),
      RestaurantMenuImage.fieldSortOrder: sortOrder,
      RestaurantMenuImage.fieldCreatedAt: FieldValue.serverTimestamp(),
      RestaurantMenuImage.fieldUpdatedAt: FieldValue.serverTimestamp(),
    });
    await _touchSharedMenu(source.id);

    return RestaurantMenuImage(
      id: doc.id,
      imageUrl: trimmedUrl,
      storagePath: storagePath?.trim(),
      sortOrder: sortOrder,
    );
  }

  static Future<RestaurantMenuItem> saveMenuItem({
    required RestaurantMenuSource source,
    required String name,
    required String description,
    required String price,
    required String category,
  }) async {
    if (source.isLegacyBiteSaver) {
      return RestaurantAccountService.saveMenuItem(
        uid: source.id,
        name: name,
        description: description,
        price: price,
        category: category,
      );
    }

    final trimmedName = name.trim();
    final trimmedCategory = category.trim();
    if (trimmedName.isEmpty) {
      throw ArgumentError('Menu item name is required.');
    }
    if (trimmedCategory.isEmpty) {
      throw ArgumentError('Menu item category is required.');
    }

    final doc = _menuItemsCollection(source).doc();
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
    await _touchSharedMenu(source.id);

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
    required RestaurantMenuSource source,
    required String title,
    required String body,
    String? existingSectionId,
  }) async {
    if (source.isLegacyBiteSaver) {
      return RestaurantAccountService.saveMenuSection(
        uid: source.id,
        title: title,
        body: body,
        existingSectionId: existingSectionId,
      );
    }

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
        ? _menuSectionsCollection(source).doc(trimmedId)
        : _menuSectionsCollection(source).doc();
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
    await _touchSharedMenu(source.id);

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
    required RestaurantMenuSource source,
    required String imageId,
  }) async {
    if (source.isLegacyBiteSaver) {
      await RestaurantAccountService.deleteMenuImage(
        uid: source.id,
        imageId: imageId,
      );
      return;
    }

    await _menuImagesCollection(source).doc(imageId.trim()).delete();
    await _touchSharedMenu(source.id);
  }

  static Future<void> deleteMenuItem({
    required RestaurantMenuSource source,
    required String itemId,
  }) async {
    if (source.isLegacyBiteSaver) {
      await RestaurantAccountService.deleteMenuItem(
        uid: source.id,
        itemId: itemId,
      );
      return;
    }

    await _menuItemsCollection(source).doc(itemId.trim()).delete();
    await _touchSharedMenu(source.id);
  }

  static Future<void> deleteMenuSection({
    required RestaurantMenuSource source,
    required String sectionId,
  }) async {
    if (source.isLegacyBiteSaver) {
      await RestaurantAccountService.deleteMenuSection(
        uid: source.id,
        sectionId: sectionId,
      );
      return;
    }

    await _menuSectionsCollection(source).doc(sectionId.trim()).delete();
    await _touchSharedMenu(source.id);
  }

  static Future<RestaurantMenuSource> ensureSharedMenuForBiteScoreRestaurant({
    required BitescoreRestaurant restaurant,
    required String ownerUserId,
  }) async {
    final restaurantRef = _firestore
        .collection(BitescoreRestaurant.collectionName)
        .doc(restaurant.id);
    final latestSnapshot = await restaurantRef.get();
    final latestRestaurant =
        BitescoreRestaurant.tryFromFirestore(
          latestSnapshot.data(),
          fallbackId: latestSnapshot.id,
        ) ??
        BitescoreRestaurant.tryFromFinderFirestore(
          latestSnapshot.data(),
          fallbackId: latestSnapshot.id,
        );

    final restaurantForMenu = latestRestaurant ?? restaurant;
    final existingMenuId = restaurantForMenu.sharedMenuId?.trim();
    if (existingMenuId != null && existingMenuId.isNotEmpty) {
      return RestaurantMenuSource.sharedMenu(existingMenuId);
    }

    final ownerId = ownerUserId.trim();
    if (ownerId.isEmpty) {
      throw ArgumentError('Owner user ID is required.');
    }

    final menuDoc = sharedMenusCollection().doc();
    final menuId = menuDoc.id;
    final batch = _firestore.batch();
    batch.set(menuDoc, {
      'restaurantName': restaurantForMenu.name.trim(),
      'normalizedName': _normalizeKeyPart(restaurantForMenu.name),
      'normalizedAddressKey': _normalizedAddressKey(restaurantForMenu),
      'bitescoreRestaurantId': restaurantForMenu.id.trim(),
      'createdByUserId': ownerId,
      'linkStatus': 'bitescore_only',
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
    batch.set(restaurantRef, {
      'sharedMenuId': menuId,
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
    await batch.commit();

    return RestaurantMenuSource.sharedMenu(menuId);
  }

  static Future<void> _touchSharedMenu(String menuId) async {
    if (menuId.trim().isEmpty) {
      return;
    }
    await sharedMenusCollection().doc(menuId.trim()).set({
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<BitescoreRestaurant?> _loadBiteScoreRestaurantById(
    String? restaurantId,
  ) async {
    final trimmedId = restaurantId?.trim();
    if (trimmedId == null || trimmedId.isEmpty) {
      return null;
    }
    final snapshot = await _firestore
        .collection(BitescoreRestaurant.collectionName)
        .doc(trimmedId)
        .get();
    return _parseBiteScoreRestaurant(snapshot.data(), fallbackId: snapshot.id);
  }

  static Future<Map<String, dynamic>?> _loadBiteScoreRestaurantData(
    String? restaurantId,
  ) async {
    final trimmedId = restaurantId?.trim();
    if (trimmedId == null || trimmedId.isEmpty) {
      return null;
    }
    final snapshot = await _firestore
        .collection(BitescoreRestaurant.collectionName)
        .doc(trimmedId)
        .get();
    return snapshot.data();
  }

  static Future<Map<String, dynamic>?> _loadBiteSaverAccountData(
    String uid,
  ) async {
    final trimmedUid = uid.trim();
    if (trimmedUid.isEmpty) {
      return null;
    }
    final snapshot = await RestaurantAccountService.docForUser(
      trimmedUid,
    ).get();
    final data = snapshot.data();
    if (data == null) {
      return null;
    }
    return {...data, Restaurant.fieldUid: trimmedUid};
  }

  static BitescoreRestaurant? _parseBiteScoreRestaurant(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    return BitescoreRestaurant.tryFromFirestore(data, fallbackId: fallbackId) ??
        BitescoreRestaurant.tryFromFinderFirestore(
          data,
          fallbackId: fallbackId,
        );
  }

  static String _normalizedAddressKey(BitescoreRestaurant restaurant) {
    return [
      restaurant.address,
      restaurant.city,
      restaurant.state,
      restaurant.zipCode,
    ].map(_normalizeKeyPart).where((part) => part.isNotEmpty).join('|');
  }

  static bool _isLikelySameRestaurant({
    required Restaurant biteSaverRestaurant,
    required BitescoreRestaurant biteScoreRestaurant,
  }) {
    final namesMatch = _namesSimilar(
      biteSaverRestaurant.name,
      biteScoreRestaurant.name,
    );
    final addressMatches =
        _normalizeKeyPart(biteSaverRestaurant.streetAddress ?? '') ==
            _normalizeKeyPart(biteScoreRestaurant.address) &&
        _normalizeKeyPart(biteSaverRestaurant.city) ==
            _normalizeKeyPart(biteScoreRestaurant.city) &&
        _normalizeKeyPart(biteSaverRestaurant.state) ==
            _normalizeKeyPart(biteScoreRestaurant.state) &&
        _normalizeZip(biteSaverRestaurant.zipCode) ==
            _normalizeZip(biteScoreRestaurant.zipCode);

    return namesMatch && addressMatches;
  }

  static bool _namesSimilar(String first, String second) {
    final normalizedFirst = _normalizeRestaurantName(first);
    final normalizedSecond = _normalizeRestaurantName(second);
    if (normalizedFirst.isEmpty || normalizedSecond.isEmpty) {
      return false;
    }
    return normalizedFirst == normalizedSecond ||
        normalizedFirst.contains(normalizedSecond) ||
        normalizedSecond.contains(normalizedFirst);
  }

  static String _normalizeRestaurantName(String value) {
    const noiseWords = {'restaurant', 'cafe', 'grill', 'bar', 'the'};
    return _normalizeKeyPart(value)
        .split(' ')
        .where((word) => word.isNotEmpty && !noiseWords.contains(word))
        .join(' ');
  }

  static String _normalizeZip(String value) {
    final match = RegExp(r'\d{5}').firstMatch(value);
    return match?.group(0) ?? '';
  }

  static String _normalizeKeyPart(String value) {
    return value
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
  }

  static String? _readString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }
    return null;
  }
}
