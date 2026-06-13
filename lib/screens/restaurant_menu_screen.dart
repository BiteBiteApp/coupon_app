import 'package:flutter/material.dart';

import '../services/app_mode_state_service.dart';
import '../services/restaurant_account_service.dart';
import '../services/restaurant_menu_service.dart';
import '../widgets/bitesaver_colors.dart';
import '../widgets/persistent_bottom_navigation.dart';
import '../widgets/restaurant_menu_section_card.dart';

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
    'Anytime',
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
    'Anytime',
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
      RestaurantMenuService.loadMenuSections(source),
    ]);

    return _RestaurantMenuData(
      images: results[0] as List<RestaurantMenuImage>,
      items: results[1] as List<RestaurantMenuItem>,
      sections: results[2] as List<RestaurantMenuSection>,
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
          height: 76,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: visibleImages.length,
            separatorBuilder: (context, index) => const SizedBox(width: 10),
            itemBuilder: (context, index) {
              return InkWell(
                onTap: () => _openImageViewer(images, index),
                borderRadius: BorderRadius.circular(12),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.network(
                    visibleImages[index].imageUrl,
                    width: 86,
                    height: 76,
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) => Container(
                      width: 86,
                      height: 76,
                      alignment: Alignment.center,
                      color: BiteSaverColors.imageFallback,
                      child: const Icon(Icons.menu_book_outlined),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        if (hiddenImageCount > 0) ...[
          const SizedBox(height: 8),
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
      padding: const EdgeInsets.all(16),
      children: [
        if (data.images.isNotEmpty) ...[
          _buildImageThumbs(data.images),
          const SizedBox(height: 20),
        ],
        for (final entry in groupedItems.entries) ...[
          Text(
            entry.key,
            style: const TextStyle(
              color: BiteSaverColors.ink,
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          for (final item in entry.value)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: BiteSaverColors.surface,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: BiteSaverColors.border),
                  boxShadow: const [
                    BoxShadow(
                      color: Color.fromRGBO(15, 23, 42, 0.06),
                      blurRadius: 10,
                      offset: Offset(0, 4),
                    ),
                  ],
                ),
                child: Padding(
                  padding: const EdgeInsets.all(12),
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
                                color: BiteSaverColors.ink,
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
                            color: BiteSaverColors.mutedInk,
                            height: 1.25,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          const SizedBox(height: 8),
        ],
        if (data.sections.isNotEmpty) ...[
          if (groupedItems.isNotEmpty) const SizedBox(height: 8),
          for (final section in data.sections)
            RestaurantMenuSectionCard(
              title: section.title,
              body: section.body,
              margin: const EdgeInsets.only(bottom: 12),
            ),
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
            padding: const EdgeInsets.all(16),
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
                    color: BiteSaverColors.imageFallback,
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
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.menu_book_outlined, color: Color(0xFFD08A2D), size: 38),
            SizedBox(height: 12),
            Text(
              'Menu not available yet.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: BiteSaverColors.ink,
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
            SizedBox(height: 6),
            Text(
              'Please check back later.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: BiteSaverColors.mutedInk,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BiteSaverColors.pageBackground,
      appBar: AppBar(
        title: Text('${widget.restaurantName} Menu'),
        backgroundColor: BiteSaverColors.pageBackground,
        surfaceTintColor: BiteSaverColors.pageBackground,
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
          if (data == null ||
              (data.images.isEmpty &&
                  data.items.isEmpty &&
                  data.sections.isEmpty)) {
            return _buildEmptyState();
          }

          if (data.items.isNotEmpty || data.sections.isNotEmpty) {
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
  final List<RestaurantMenuSection> sections;

  const _RestaurantMenuData({
    required this.images,
    required this.items,
    this.sections = const [],
  });
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
      backgroundColor: BiteSaverColors.pageBackground,
      appBar: AppBar(
        title: Text('${widget.restaurantName} Menu'),
        backgroundColor: BiteSaverColors.pageBackground,
        surfaceTintColor: BiteSaverColors.pageBackground,
        elevation: 0,
      ),
      body: Column(
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(16),
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
                      color: BiteSaverColors.imageFallback,
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
                              : BiteSaverColors.border,
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
                                color: BiteSaverColors.imageFallback,
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
