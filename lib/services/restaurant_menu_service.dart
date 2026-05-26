import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/bitescore_restaurant.dart';
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

  static String _normalizeKeyPart(String value) {
    return value
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
  }
}
