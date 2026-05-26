import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/bitescore_restaurant.dart';
import '../models/restaurant.dart';
import 'restaurant_account_service.dart';

enum RestaurantMenuSourceType { legacyBiteSaver, sharedMenu }

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

enum RestaurantMenuAppSide { biteSaver, biteScore }

class RestaurantMenuMatchSuggestion {
  final RestaurantMenuAppSide currentSide;
  final RestaurantMenuAppSide matchedSide;
  final String matchedRestaurantName;
  final String matchedRestaurantAddress;

  const RestaurantMenuMatchSuggestion({
    required this.currentSide,
    required this.matchedSide,
    required this.matchedRestaurantName,
    required this.matchedRestaurantAddress,
  });
}

class RestaurantMenuService {
  static final FirebaseFirestore _firestore = FirebaseFirestore.instance;

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

  static RestaurantMenuSource sourceForBiteSaverAccountData({
    required String uid,
    required Map<String, dynamic>? accountData,
  }) {
    final sharedMenuId = _readString(accountData?['sharedMenuId']);
    if (sharedMenuId != null && sharedMenuId.isNotEmpty) {
      return RestaurantMenuSource.sharedMenu(sharedMenuId);
    }
    return RestaurantMenuSource.legacyBiteSaver(uid);
  }

  static Future<RestaurantMenuSource> resolveBiteSaverMenuSource({
    required String uid,
  }) async {
    final trimmedUid = uid.trim();
    if (trimmedUid.isEmpty) {
      return RestaurantMenuSource.legacyBiteSaver(trimmedUid);
    }

    final accountData = await RestaurantAccountService.getAccountData(
      trimmedUid,
    );
    return sourceForBiteSaverAccountData(
      uid: trimmedUid,
      accountData: accountData,
    );
  }

  static Future<RestaurantMenuSource?> resolveBiteScorePublicMenuSource({
    required String restaurantId,
  }) async {
    final trimmedRestaurantId = restaurantId.trim();
    if (trimmedRestaurantId.isEmpty) {
      return null;
    }

    final snapshot = await _firestore
        .collection(BitescoreRestaurant.collectionName)
        .doc(trimmedRestaurantId)
        .get();
    final restaurant =
        BitescoreRestaurant.tryFromFirestore(
          snapshot.data(),
          fallbackId: snapshot.id,
        ) ??
        BitescoreRestaurant.tryFromFinderFirestore(
          snapshot.data(),
          fallbackId: snapshot.id,
        );
    final menuId = restaurant?.sharedMenuId?.trim();
    if (menuId == null || menuId.isEmpty) {
      return null;
    }
    return RestaurantMenuSource.sharedMenu(menuId);
  }

  static Future<RestaurantMenuMatchSuggestion?> findLikelyMenuMatch({
    required String currentUserId,
    Map<String, dynamic>? biteSaverAccountData,
    BitescoreRestaurant? biteScoreRestaurant,
  }) async {
    final userId = currentUserId.trim();
    if (userId.isEmpty) {
      return null;
    }

    if (biteScoreRestaurant != null) {
      final accountData = await RestaurantAccountService.getAccountData(userId);
      if (accountData == null) {
        return null;
      }
      final biteSaverRestaurant = Restaurant.fromFirestore({
        ...accountData,
        Restaurant.fieldUid: userId,
      }, coupons: const []);
      if (!_isLikelySameRestaurant(
        biteSaverName: biteSaverRestaurant.name,
        biteSaverAddress: biteSaverRestaurant.streetAddress ?? '',
        biteSaverCity: biteSaverRestaurant.city,
        biteSaverState: biteSaverRestaurant.state,
        biteSaverZip: biteSaverRestaurant.zipCode,
        biteScoreRestaurant: biteScoreRestaurant,
      )) {
        return null;
      }

      return RestaurantMenuMatchSuggestion(
        currentSide: RestaurantMenuAppSide.biteScore,
        matchedSide: RestaurantMenuAppSide.biteSaver,
        matchedRestaurantName: biteSaverRestaurant.name,
        matchedRestaurantAddress: _biteSaverAddressLabel(biteSaverRestaurant),
      );
    }

    if (biteSaverAccountData == null) {
      return null;
    }

    final biteSaverRestaurant = Restaurant.fromFirestore({
      ...biteSaverAccountData,
      Restaurant.fieldUid: userId,
    }, coupons: const []);
    final snapshot = await _firestore
        .collection(BitescoreRestaurant.collectionName)
        .where('ownerUserId', isEqualTo: userId)
        .get();

    for (final doc in snapshot.docs) {
      final biteScoreRestaurant =
          BitescoreRestaurant.tryFromFirestore(
            doc.data(),
            fallbackId: doc.id,
          ) ??
          BitescoreRestaurant.tryFromFinderFirestore(
            doc.data(),
            fallbackId: doc.id,
          );
      if (biteScoreRestaurant == null || !biteScoreRestaurant.isClaimed) {
        continue;
      }
      if (!_isLikelySameRestaurant(
        biteSaverName: biteSaverRestaurant.name,
        biteSaverAddress: biteSaverRestaurant.streetAddress ?? '',
        biteSaverCity: biteSaverRestaurant.city,
        biteSaverState: biteSaverRestaurant.state,
        biteSaverZip: biteSaverRestaurant.zipCode,
        biteScoreRestaurant: biteScoreRestaurant,
      )) {
        continue;
      }

      return RestaurantMenuMatchSuggestion(
        currentSide: RestaurantMenuAppSide.biteSaver,
        matchedSide: RestaurantMenuAppSide.biteScore,
        matchedRestaurantName: biteScoreRestaurant.name,
        matchedRestaurantAddress: _biteScoreAddressLabel(biteScoreRestaurant),
      );
    }

    return null;
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

  static String _normalizedAddressKey(BitescoreRestaurant restaurant) {
    return [
      restaurant.address,
      restaurant.city,
      restaurant.state,
      restaurant.zipCode,
    ].map(_normalizeKeyPart).where((part) => part.isNotEmpty).join('|');
  }

  static bool _isLikelySameRestaurant({
    required String biteSaverName,
    required String biteSaverAddress,
    required String biteSaverCity,
    required String biteSaverState,
    required String biteSaverZip,
    required BitescoreRestaurant biteScoreRestaurant,
  }) {
    final namesMatch = _namesSimilar(biteSaverName, biteScoreRestaurant.name);
    final addressMatches =
        _normalizeKeyPart(biteSaverAddress) ==
            _normalizeKeyPart(biteScoreRestaurant.address) &&
        _normalizeKeyPart(biteSaverCity) ==
            _normalizeKeyPart(biteScoreRestaurant.city) &&
        _normalizeKeyPart(biteSaverState) ==
            _normalizeKeyPart(biteScoreRestaurant.state) &&
        _normalizeZip(biteSaverZip) ==
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

  static String _biteSaverAddressLabel(Restaurant restaurant) {
    final parts = <String>[
      restaurant.streetAddress ?? '',
      restaurant.city,
      [
        restaurant.state,
        restaurant.zipCode,
      ].map((part) => part.trim()).where((part) => part.isNotEmpty).join(' '),
    ].map((part) => part.trim()).where((part) => part.isNotEmpty).toList();
    return parts.join(', ');
  }

  static String _biteScoreAddressLabel(BitescoreRestaurant restaurant) {
    final parts = <String>[
      restaurant.address,
      restaurant.city,
      [
        restaurant.state,
        restaurant.zipCode,
      ].map((part) => part.trim()).where((part) => part.isNotEmpty).join(' '),
    ].map((part) => part.trim()).where((part) => part.isNotEmpty).toList();
    return parts.join(', ');
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
