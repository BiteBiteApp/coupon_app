import 'package:flutter/material.dart';

import '../services/app_mode_state_service.dart';
import '../services/restaurant_account_service.dart';
import '../services/restaurant_menu_service.dart';
import '../widgets/persistent_bottom_navigation.dart';

class RestaurantMenuScreen extends StatefulWidget {
  final String? restaurantUid;
  final String restaurantName;
  final RestaurantMenuSource? source;
  final AppMode mode;

  const RestaurantMenuScreen({
    super.key,
    required this.restaurantName,
    this.restaurantUid,
    this.source,
    this.mode = AppMode.biteSaver,
  });

  @override
  State<RestaurantMenuScreen> createState() => _RestaurantMenuScreenState();
}

class _RestaurantMenuScreenState extends State<RestaurantMenuScreen> {
  late Future<_RestaurantMenuData> _menuFuture;
  int _selectedImageIndex = 0;

  static const List<String> _biteSaverCategoryOrder = [
    'Breakfast',
    'Lunch',
    'Dinner',
    'Lunch Specials',
    'Appetizers',
    'Sides',
    'Drinks',
    'Desserts',
    'Kids',
    'Extras',
  ];

  static const List<String> _biteScoreCategoryOrder = [
    'Breakfast',
    'Lunch',
    'Dinner',
    'Appetizers',
    'Sides',
    'Drinks',
    'Desserts',
    'Specials',
    'Extras',
  ];

  @override
  void initState() {
    super.initState();
    _menuFuture = _loadMenu();
  }

  RestaurantMenuSource? get _source {
    final providedSource = widget.source;
    if (providedSource != null) {
      return providedSource;
    }

    final uid = widget.restaurantUid?.trim();
    if (uid == null || uid.isEmpty) {
      return null;
    }
    return RestaurantMenuSource.legacyBiteSaver(uid);
  }

  List<String> get _categoryOrder => _source?.isSharedMenu == true
      ? _biteScoreCategoryOrder
      : _biteSaverCategoryOrder;

  Future<_RestaurantMenuData> _loadMenu() async {
    final source = _source;
    if (source == null || source.id.isEmpty) {
      return const _RestaurantMenuData(images: [], items: []);
    }

    final results = await Future.wait([
      RestaurantMenuService.loadMenuImages(source),
      RestaurantMenuService.loadMenuItems(source),
    ]);

    return _RestaurantMenuData(
      images: results[0] as List<RestaurantMenuImage>,
      items: results[1] as List<RestaurantMenuItem>,
    );
  }

  Map<String, List<RestaurantMenuItem>> _groupItems(
    List<RestaurantMenuItem> items,
  ) {
    final grouped = <String, List<RestaurantMenuItem>>{};
    for (final item in items) {
      grouped.putIfAbsent(item.category, () => []).add(item);
    }

    final sorted = <String, List<RestaurantMenuItem>>{};
    for (final category in _categoryOrder) {
      final categoryItems = grouped.remove(category);
      if (categoryItems != null && categoryItems.isNotEmpty) {
        sorted[category] = categoryItems;
      }
    }

    final remainingCategories = grouped.keys.toList()..sort();
    for (final category in remainingCategories) {
      sorted[category] = grouped[category]!;
    }

    return sorted;
  }

  Future<void> _openImageViewer(
    List<RestaurantMenuImage> images,
    int initialIndex,
  ) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _RestaurantMenuImageViewer(
          images: images,
          initialIndex: initialIndex,
          restaurantName: widget.restaurantName,
        ),
      ),
    );
  }

  Widget _buildImageThumbs(List<RestaurantMenuImage> images) {
    if (images.isEmpty) {
      return const SizedBox.shrink();
    }

    final visibleImages = images.take(3).toList();
    final hiddenImageCount = images.length - visibleImages.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: 74,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: visibleImages.length,
            separatorBuilder: (context, index) => const SizedBox(width: 9),
            itemBuilder: (context, index) {
              return InkWell(
                onTap: () => _openImageViewer(images, index),
                borderRadius: BorderRadius.circular(12),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.network(
                    visibleImages[index].imageUrl,
                    width: 84,
                    height: 74,
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) => Container(
                      width: 84,
                      height: 74,
                      alignment: Alignment.center,
                      color: const Color(0xFFF3E8DD),
                      child: const Icon(Icons.menu_book_outlined),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        if (hiddenImageCount > 0) ...[
          const SizedBox(height: 6),
          TextButton.icon(
            onPressed: () => _openImageViewer(images, visibleImages.length),
            style: TextButton.styleFrom(
              foregroundColor: const Color(0xFF2563EB),
              padding: EdgeInsets.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            icon: const Icon(Icons.photo_library_outlined, size: 17),
            label: Text(
              'View more images (+$hiddenImageCount)',
              style: const TextStyle(
                decoration: TextDecoration.underline,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildGroupedItems(_RestaurantMenuData data) {
    final groupedItems = _groupItems(data.items);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      children: [
        if (data.images.isNotEmpty) ...[
          _buildImageThumbs(data.images),
          const SizedBox(height: 18),
        ],
        for (final entry in groupedItems.entries) ...[
          Text(
            entry.key,
            style: const TextStyle(
              color: Color(0xFF2B1D14),
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 7),
          for (final item in entry.value)
            Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: const Color(0xFFFFFEFB),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFFE8D8C8)),
                  boxShadow: const [
                    BoxShadow(
                      color: Color.fromRGBO(64, 42, 22, 0.06),
                      blurRadius: 10,
                      offset: Offset(0, 4),
                    ),
                  ],
                ),
                child: Padding(
                  padding: const EdgeInsets.all(11),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              item.name,
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                                fontSize: 15,
                                color: Color(0xFF2B1D14),
                              ),
                            ),
                          ),
                          if (item.price.trim().isNotEmpty)
                            Text(
                              item.price,
                              style: const TextStyle(
                                color: Color(0xFF4D7F22),
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                        ],
                      ),
                      if (item.description.trim().isNotEmpty) ...[
                        const SizedBox(height: 5),
                        Text(
                          item.description,
                          style: const TextStyle(
                            color: Color(0xFF7F6D5F),
                            height: 1.25,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          const SizedBox(height: 7),
        ],
      ],
    );
  }

  Widget _buildImageMenu(List<RestaurantMenuImage> images) {
    final selectedImage =
        images[_selectedImageIndex.clamp(0, images.length - 1)];
    final hasMultipleImages = images.length > 1;

    return Column(
      children: [
        Expanded(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(18),
              child: InteractiveViewer(
                minScale: 1,
                maxScale: 4,
                child: Image.network(
                  selectedImage.imageUrl,
                  width: double.infinity,
                  fit: BoxFit.contain,
                  errorBuilder: (context, error, stackTrace) => Container(
                    alignment: Alignment.center,
                    color: const Color(0xFFF3E8DD),
                    child: const Text('Menu image unavailable'),
                  ),
                ),
              ),
            ),
          ),
        ),
        if (hasMultipleImages)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _selectedImageIndex == 0
                        ? null
                        : () => setState(() => _selectedImageIndex -= 1),
                    style: OutlinedButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                    ),
                    icon: const Icon(Icons.chevron_left),
                    label: const Text('Previous'),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Text('${_selectedImageIndex + 1} / ${images.length}'),
                ),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _selectedImageIndex >= images.length - 1
                        ? null
                        : () => setState(() => _selectedImageIndex += 1),
                    style: OutlinedButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                    ),
                    icon: const Icon(Icons.chevron_right),
                    label: const Text('Next'),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildEmptyState() {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Text(
          'Menu not available yet.',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Color(0xFF7F6D5F),
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8F1EA),
      appBar: AppBar(
        title: Text('${widget.restaurantName} Menu'),
        backgroundColor: const Color(0xFFF8F1EA),
        surfaceTintColor: const Color(0xFFF8F1EA),
        elevation: 0,
      ),
      bottomNavigationBar: PersistentBottomNavigation(mode: widget.mode),
      body: FutureBuilder<_RestaurantMenuData>(
        future: _menuFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text('Could not load this menu right now.'),
              ),
            );
          }

          final data = snapshot.data;
          if (data == null || (data.images.isEmpty && data.items.isEmpty)) {
            return _buildEmptyState();
          }

          if (data.items.isNotEmpty) {
            return _buildGroupedItems(data);
          }

          return _buildImageMenu(data.images);
        },
      ),
    );
  }
}

class _RestaurantMenuData {
  final List<RestaurantMenuImage> images;
  final List<RestaurantMenuItem> items;

  const _RestaurantMenuData({required this.images, required this.items});
}

class _RestaurantMenuImageViewer extends StatefulWidget {
  final List<RestaurantMenuImage> images;
  final int initialIndex;
  final String restaurantName;

  const _RestaurantMenuImageViewer({
    required this.images,
    required this.initialIndex,
    required this.restaurantName,
  });

  @override
  State<_RestaurantMenuImageViewer> createState() =>
      _RestaurantMenuImageViewerState();
}

class _RestaurantMenuImageViewerState
    extends State<_RestaurantMenuImageViewer> {
  late int _selectedIndex;

  @override
  void initState() {
    super.initState();
    _selectedIndex = widget.initialIndex.clamp(0, widget.images.length - 1);
  }

  @override
  Widget build(BuildContext context) {
    final image = widget.images[_selectedIndex];
    final hasMultipleImages = widget.images.length > 1;

    return Scaffold(
      backgroundColor: const Color(0xFFF8F1EA),
      appBar: AppBar(
        title: Text('${widget.restaurantName} Menu'),
        backgroundColor: const Color(0xFFF8F1EA),
        surfaceTintColor: const Color(0xFFF8F1EA),
        elevation: 0,
      ),
      body: Column(
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(18),
                child: InteractiveViewer(
                  minScale: 1,
                  maxScale: 4,
                  child: Image.network(
                    image.imageUrl,
                    width: double.infinity,
                    fit: BoxFit.contain,
                    errorBuilder: (context, error, stackTrace) => Container(
                      alignment: Alignment.center,
                      color: const Color(0xFFF3E8DD),
                      child: const Text('Menu image unavailable'),
                    ),
                  ),
                ),
              ),
            ),
          ),
          if (hasMultipleImages)
            SizedBox(
              height: 58,
              child: ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                scrollDirection: Axis.horizontal,
                itemCount: widget.images.length,
                separatorBuilder: (context, index) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final isSelected = index == _selectedIndex;
                  return InkWell(
                    onTap: () => setState(() => _selectedIndex = index),
                    borderRadius: BorderRadius.circular(10),
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: isSelected
                              ? const Color(0xFF2563EB)
                              : const Color(0xFFE8D8C8),
                          width: isSelected ? 2 : 1,
                        ),
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.network(
                          widget.images[index].imageUrl,
                          width: 54,
                          height: 48,
                          fit: BoxFit.cover,
                          errorBuilder: (context, error, stackTrace) =>
                              Container(
                                width: 54,
                                height: 48,
                                alignment: Alignment.center,
                                color: const Color(0xFFF3E8DD),
                                child: const Icon(
                                  Icons.menu_book_outlined,
                                  size: 16,
                                ),
                              ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: !hasMultipleImages || _selectedIndex == 0
                        ? null
                        : () => setState(() => _selectedIndex -= 1),
                    style: OutlinedButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                    ),
                    icon: const Icon(Icons.chevron_left),
                    label: const Text('Previous'),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Text(
                    '${_selectedIndex + 1} / ${widget.images.length}',
                  ),
                ),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed:
                        !hasMultipleImages ||
                            _selectedIndex >= widget.images.length - 1
                        ? null
                        : () => setState(() => _selectedIndex += 1),
                    style: OutlinedButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                    ),
                    icon: const Icon(Icons.chevron_right),
                    label: const Text('Next'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
