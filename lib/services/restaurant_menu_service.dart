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

class RestaurantMenuLinkSuggestion {
  final RestaurantMenuAppSide currentSide;
  final String currentRestaurantId;
  final RestaurantMenuSource currentSource;
  final RestaurantMenuAppSide targetSide;
  final String targetRestaurantId;
  final RestaurantMenuSource targetSource;
  final String targetRestaurantName;
  final String? targetRestaurantAddress;
  final String actionLabel;

  const RestaurantMenuLinkSuggestion({
    required this.currentSide,
    required this.currentRestaurantId,
    required this.currentSource,
    required this.targetSide,
    required this.targetRestaurantId,
    required this.targetSource,
    required this.targetRestaurantName,
    this.targetRestaurantAddress,
    required this.actionLabel,
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

  static RestaurantMenuSource sourceForBiteSaverAccountData({
    required String uid,
    required Map<String, dynamic>? accountData,
  }) {
    final sharedMenuId = _readString(
      accountData?[Restaurant.fieldSharedMenuId],
    );
    if (sharedMenuId != null && sharedMenuId.isNotEmpty) {
      return RestaurantMenuSource.sharedMenu(sharedMenuId);
    }
    return RestaurantMenuSource.legacyBiteSaver(uid);
  }

  static Future<RestaurantMenuLinkSuggestion?> findLinkSuggestion({
    required String currentUserId,
    required RestaurantMenuSource currentSource,
    Map<String, dynamic>? biteSaverAccountData,
    BitescoreRestaurant? biteScoreRestaurant,
  }) async {
    final userId = currentUserId.trim();
    if (userId.isEmpty) {
      return null;
    }

    if (biteScoreRestaurant != null) {
      return _findBiteSaverSuggestionForBiteScore(
        userId: userId,
        currentSource: currentSource,
        biteScoreRestaurant: biteScoreRestaurant,
      );
    }

    if (biteSaverAccountData != null) {
      return _findBiteScoreSuggestionForBiteSaver(
        userId: userId,
        currentSource: currentSource,
        biteSaverAccountData: biteSaverAccountData,
      );
    }

    return null;
  }

  static Future<RestaurantMenuSource> linkSuggestedSharedMenu(
    RestaurantMenuLinkSuggestion suggestion,
  ) async {
    final currentHasContent = await hasMenuContent(suggestion.currentSource);
    final targetHasContent = await hasMenuContent(suggestion.targetSource);
    if (currentHasContent &&
        targetHasContent &&
        suggestion.currentSource.id != suggestion.targetSource.id) {
      throw StateError(
        'Both matching menus already have content. Manual menu resolution is needed.',
      );
    }

    final menuId = suggestion.targetSource.isLegacyBiteSaver
        ? await _createSharedMenuFromLegacyBiteSaverSuggestion(suggestion)
        : suggestion.targetSource.id;
    final batch = _firestore.batch();

    _setSharedMenuIdForSide(
      batch: batch,
      side: suggestion.currentSide,
      restaurantId: suggestion.currentRestaurantId,
      menuId: menuId,
    );
    _setSharedMenuIdForSide(
      batch: batch,
      side: suggestion.targetSide,
      restaurantId: suggestion.targetRestaurantId,
      menuId: menuId,
    );

    batch.set(sharedMenusCollection().doc(menuId), {
      if (suggestion.currentSide == RestaurantMenuAppSide.biteSaver)
        'bitesaverUid': suggestion.currentRestaurantId,
      if (suggestion.currentSide == RestaurantMenuAppSide.biteScore)
        'bitescoreRestaurantId': suggestion.currentRestaurantId,
      if (suggestion.targetSide == RestaurantMenuAppSide.biteSaver)
        'bitesaverUid': suggestion.targetRestaurantId,
      if (suggestion.targetSide == RestaurantMenuAppSide.biteScore)
        'bitescoreRestaurantId': suggestion.targetRestaurantId,
      'linkStatus': 'manual_linked',
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    await batch.commit();
    return RestaurantMenuSource.sharedMenu(menuId);
  }

  static Future<bool> hasMenuContent(RestaurantMenuSource source) async {
    if (source.id.isEmpty) {
      return false;
    }
    final imageSnapshot = await _menuImagesCollection(source).limit(1).get();
    if (imageSnapshot.docs.isNotEmpty) {
      return true;
    }
    final itemSnapshot = await _menuItemsCollection(source).limit(1).get();
    return itemSnapshot.docs.isNotEmpty;
  }

  static Future<void> _touchSharedMenu(String menuId) async {
    if (menuId.trim().isEmpty) {
      return;
    }
    await sharedMenusCollection().doc(menuId.trim()).set({
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<RestaurantMenuLinkSuggestion?>
  _findBiteSaverSuggestionForBiteScore({
    required String userId,
    required RestaurantMenuSource currentSource,
    required BitescoreRestaurant biteScoreRestaurant,
  }) async {
    final accountSnapshot = await RestaurantAccountService.docForUser(
      userId,
    ).get();
    final accountData = accountSnapshot.data();
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

    final targetMenuId = biteSaverRestaurant.sharedMenuId?.trim();
    RestaurantMenuSource targetSource;
    if (targetMenuId != null && targetMenuId.isNotEmpty) {
      if (currentSource.isSharedMenu && currentSource.id == targetMenuId) {
        return null;
      }
      targetSource = RestaurantMenuSource.sharedMenu(targetMenuId);
    } else {
      targetSource = RestaurantMenuSource.legacyBiteSaver(userId);
      final legacyHasContent = await hasMenuContent(targetSource);
      if (!legacyHasContent) {
        return null;
      }
    }

    return RestaurantMenuLinkSuggestion(
      currentSide: RestaurantMenuAppSide.biteScore,
      currentRestaurantId: biteScoreRestaurant.id,
      currentSource: currentSource,
      targetSide: RestaurantMenuAppSide.biteSaver,
      targetRestaurantId: userId,
      targetSource: targetSource,
      targetRestaurantName: biteSaverRestaurant.name,
      targetRestaurantAddress: _biteSaverAddressLabel(biteSaverRestaurant),
      actionLabel: 'Use existing menu from BiteSaver',
    );
  }

  static Future<RestaurantMenuLinkSuggestion?>
  _findBiteScoreSuggestionForBiteSaver({
    required String userId,
    required RestaurantMenuSource currentSource,
    required Map<String, dynamic> biteSaverAccountData,
  }) async {
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

      final targetMenuId = biteScoreRestaurant.sharedMenuId?.trim();
      if (targetMenuId == null || targetMenuId.isEmpty) {
        continue;
      }
      if (currentSource.isSharedMenu && currentSource.id == targetMenuId) {
        return null;
      }

      return RestaurantMenuLinkSuggestion(
        currentSide: RestaurantMenuAppSide.biteSaver,
        currentRestaurantId: userId,
        currentSource: currentSource,
        targetSide: RestaurantMenuAppSide.biteScore,
        targetRestaurantId: biteScoreRestaurant.id,
        targetSource: RestaurantMenuSource.sharedMenu(targetMenuId),
        targetRestaurantName: biteScoreRestaurant.name,
        targetRestaurantAddress: _biteScoreAddressLabel(biteScoreRestaurant),
        actionLabel: 'Use existing menu from BiteRater',
      );
    }

    return null;
  }

  static void _setSharedMenuIdForSide({
    required WriteBatch batch,
    required RestaurantMenuAppSide side,
    required String restaurantId,
    required String menuId,
  }) {
    if (side == RestaurantMenuAppSide.biteSaver) {
      batch.set(RestaurantAccountService.docForUser(restaurantId), {
        Restaurant.fieldSharedMenuId: menuId,
        Restaurant.fieldUpdatedAt: FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
      return;
    }

    batch.set(
      _firestore
          .collection(BitescoreRestaurant.collectionName)
          .doc(restaurantId),
      {'sharedMenuId': menuId, 'updatedAt': FieldValue.serverTimestamp()},
      SetOptions(merge: true),
    );
  }

  static Future<String> _createSharedMenuFromLegacyBiteSaverSuggestion(
    RestaurantMenuLinkSuggestion suggestion,
  ) async {
    if (!suggestion.targetSource.isLegacyBiteSaver) {
      return suggestion.targetSource.id;
    }

    final legacyImages = await loadMenuImages(suggestion.targetSource);
    final legacyItems = await loadMenuItems(suggestion.targetSource);
    if (legacyImages.isEmpty && legacyItems.isEmpty) {
      throw StateError('The BiteSaver menu no longer has content to link.');
    }

    final menuDoc = sharedMenusCollection().doc();
    final menuId = menuDoc.id;
    final batch = _firestore.batch();

    batch.set(menuDoc, {
      'restaurantName': suggestion.targetRestaurantName.trim(),
      'normalizedName': _normalizeKeyPart(suggestion.targetRestaurantName),
      'bitesaverUid': suggestion.targetRestaurantId,
      if (suggestion.currentSide == RestaurantMenuAppSide.biteScore)
        'bitescoreRestaurantId': suggestion.currentRestaurantId,
      'createdByUserId': suggestion.targetRestaurantId,
      'linkStatus': 'manual_linked',
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });

    for (final image in legacyImages) {
      final imageRef = menuDoc.collection('menu_images').doc(image.id);
      batch.set(imageRef, {
        RestaurantMenuImage.fieldId: image.id,
        RestaurantMenuImage.fieldImageUrl: image.imageUrl,
        RestaurantMenuImage.fieldStoragePath: image.storagePath,
        RestaurantMenuImage.fieldSortOrder: image.sortOrder,
        RestaurantMenuImage.fieldCreatedAt: FieldValue.serverTimestamp(),
        RestaurantMenuImage.fieldUpdatedAt: FieldValue.serverTimestamp(),
      });
    }

    for (final item in legacyItems) {
      final itemRef = menuDoc.collection('menu_items').doc(item.id);
      batch.set(itemRef, {
        RestaurantMenuItem.fieldId: item.id,
        RestaurantMenuItem.fieldName: item.name,
        RestaurantMenuItem.fieldDescription: item.description,
        RestaurantMenuItem.fieldPrice: item.price,
        RestaurantMenuItem.fieldCategory: item.category,
        RestaurantMenuItem.fieldSortOrder: item.sortOrder,
        RestaurantMenuItem.fieldCreatedAt: FieldValue.serverTimestamp(),
        RestaurantMenuItem.fieldUpdatedAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    return menuId;
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

  static String? _readString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }
    return null;
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

  static String _normalizedAddressKey(BitescoreRestaurant restaurant) {
    return [
      restaurant.address,
      restaurant.city,
      restaurant.state,
      restaurant.zipCode,
    ].map(_normalizeKeyPart).where((part) => part.isNotEmpty).join('|');
  }

  static String _normalizeKeyPart(String value) {
    return value
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
  }
}
