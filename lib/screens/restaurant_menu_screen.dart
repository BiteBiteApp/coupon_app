import 'package:flutter/material.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/customer_bitesaver_search.dart';
import '../services/app_mode_state_service.dart';
import '../services/customer_bitescore_reads.dart';
import '../services/customer_bitesaver_search_coordinator.dart';
import '../services/customer_bitesaver_service.dart';
import '../services/restaurant_account_service.dart';
import '../services/restaurant_menu_service.dart';
import '../widgets/bitesaver_colors.dart';
import '../widgets/persistent_bottom_navigation.dart';
import '../widgets/restaurant_menu_section_card.dart';

typedef RestaurantMenuViewerRouteOpener =
    Future<void> Function(BuildContext context, WidgetBuilder builder);

class RestaurantMenuScreen extends StatefulWidget {
  final String? restaurantUid;
  final String restaurantName;
  final RestaurantMenuSource? source;
  final Future<CustomerBiteSaverMenuPageResult> Function(String? cursor)?
  boundedPageLoader;
  final RestaurantMenuViewerRouteOpener? boundedViewerOpener;
  final Future<CustomerBiteScoreMenuPage> Function(String? cursor)?
  biteScorePageLoader;
  final AppMode mode;

  const RestaurantMenuScreen({
    super.key,
    required this.restaurantName,
    this.restaurantUid,
    this.source,
    this.boundedPageLoader,
    this.boundedViewerOpener,
    this.biteScorePageLoader,
    this.mode = AppMode.biteSaver,
  }) : assert(boundedPageLoader == null || boundedViewerOpener != null);

  const RestaurantMenuScreen.fromCustomerBiteSaver({
    super.key,
    required this.restaurantName,
    required Future<CustomerBiteSaverMenuPageResult> Function(String? cursor)
    pageLoader,
    required RestaurantMenuViewerRouteOpener openImageViewer,
  }) : restaurantUid = null,
       source = null,
       biteScorePageLoader = null,
       boundedPageLoader = pageLoader,
       boundedViewerOpener = openImageViewer,
       mode = AppMode.biteSaver;

  @override
  State<RestaurantMenuScreen> createState() => _RestaurantMenuScreenState();
}

class _RestaurantMenuScreenState extends State<RestaurantMenuScreen> {
  Future<_RestaurantMenuData>? _legacyMenuFuture;
  int _selectedImageIndex = 0;
  final Map<String, CustomerBiteSaverMenuEntry> _boundedEntries =
      <String, CustomerBiteSaverMenuEntry>{};
  CustomerBiteSaverMenuStyle? _boundedMenuStyle;
  CustomerBiteSaverMenuAvailability? _boundedAvailability;
  String? _boundedCursor;
  Object? _boundedInitialError;
  Object? _boundedAppendError;
  bool _boundedInitialLoading = false;
  bool _boundedAppendLoading = false;
  bool _boundedInvalidated = false;

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
    if (widget.boundedPageLoader == null &&
        widget.biteScorePageLoader == null) {
      _legacyMenuFuture = _loadMenu();
    } else {
      _loadBoundedInitial();
    }
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

  List<String> get _categoryOrder =>
      _source?.isSharedMenu == true ||
          _boundedMenuStyle == CustomerBiteSaverMenuStyle.biteScore
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

  Future<void> _loadBoundedInitial() async {
    if (_boundedInitialLoading) return;
    setState(() {
      _boundedInitialLoading = true;
      _boundedInitialError = null;
      _boundedAppendError = null;
      _boundedInvalidated = false;
      _boundedEntries.clear();
      _boundedCursor = null;
      _boundedAvailability = null;
      _boundedMenuStyle = null;
    });
    try {
      final page = await _loadBoundedPage(null);
      if (!mounted) return;
      setState(() => _acceptBoundedPage(page, initial: true));
    } catch (error) {
      if (!mounted) return;
      setState(() {
        if (_isBoundedAccessInvalidation(error)) {
          _boundedInvalidated = true;
          _boundedEntries.clear();
        } else {
          _boundedInitialError = error;
        }
      });
    } finally {
      if (mounted) setState(() => _boundedInitialLoading = false);
    }
  }

  Future<void> _loadBoundedMore() async {
    final cursor = _boundedCursor;
    if (cursor == null || _boundedAppendLoading || _boundedInvalidated) return;
    setState(() {
      _boundedAppendLoading = true;
      _boundedAppendError = null;
    });
    try {
      final page = await _loadBoundedPage(cursor);
      if (!mounted) return;
      setState(() => _acceptBoundedPage(page, initial: false));
    } catch (error) {
      if (!mounted) return;
      setState(() {
        if (_isBoundedAccessInvalidation(error)) {
          _boundedInvalidated = true;
          _boundedEntries.clear();
          _boundedCursor = null;
        } else {
          _boundedAppendError = error;
        }
      });
    } finally {
      if (mounted) setState(() => _boundedAppendLoading = false);
    }
  }

  Future<CustomerBiteScoreMenuPage> _loadBoundedPage(String? cursor) async {
    final scoreLoader = widget.biteScorePageLoader;
    if (scoreLoader != null) return scoreLoader(cursor);
    final page = await widget.boundedPageLoader!(cursor);
    return CustomerBiteScoreMenuPage(
      availability: page.availability,
      menuStyle: page.menuStyle,
      entries: page.entries,
      nextCursor: page.nextCursor,
    );
  }

  void _acceptBoundedPage(
    CustomerBiteScoreMenuPage page, {
    required bool initial,
  }) {
    final existingStyle = _boundedMenuStyle;
    final existingAvailability = _boundedAvailability;
    if (!initial &&
        (existingStyle != page.menuStyle ||
            existingAvailability != page.availability ||
            page.availability == CustomerBiteSaverMenuAvailability.absent)) {
      _boundedInvalidated = true;
      _boundedEntries.clear();
      _boundedCursor = null;
      return;
    }
    _boundedMenuStyle = page.menuStyle;
    _boundedAvailability = page.availability;
    for (final entry in page.entries) {
      _boundedEntries[entry.key] = entry;
    }
    _boundedCursor = page.nextCursor;
    _boundedInitialError = null;
    _boundedAppendError = null;
  }

  bool _isBoundedAccessInvalidation(Object error) {
    if (error is CustomerBiteSaverFreshSearchRequiredException) return true;
    if (error is FirebaseFunctionsException) {
      return {
        'failed-precondition',
        'permission-denied',
        'not-found',
        'unauthenticated',
        'invalid-argument',
      }.contains(error.code);
    }
    if (error is! CustomerBiteSaverServiceException ||
        error.kind == CustomerBiteSaverServiceFailureKind.transport ||
        error.kind == CustomerBiteSaverServiceFailureKind.invalidResponse) {
      return false;
    }
    final code = error.code.startsWith('functions/')
        ? error.code.substring('functions/'.length)
        : error.code;
    return const <String>{
      'failed-precondition',
      'permission-denied',
      'not-found',
      'unauthenticated',
      'invalid-argument',
    }.contains(code);
  }

  _RestaurantMenuData get _boundedMenuData {
    final images = <RestaurantMenuImage>[];
    final items = <RestaurantMenuItem>[];
    final sections = <RestaurantMenuSection>[];
    for (final entry in _boundedEntries.values) {
      switch (entry) {
        case CustomerBiteSaverMenuImageEntry image:
          images.add(
            RestaurantMenuImage(
              id: image.key,
              imageUrl: image.imageUrl,
              sortOrder: image.sortOrder,
            ),
          );
        case CustomerBiteSaverMenuItemEntry item:
          items.add(
            RestaurantMenuItem(
              id: item.key,
              name: item.name,
              description: item.description,
              price: item.price,
              category: item.category,
              sortOrder: item.sortOrder,
            ),
          );
        case CustomerBiteSaverMenuSectionEntry section:
          sections.add(
            RestaurantMenuSection(
              id: section.key,
              title: section.title,
              body: section.body,
              sortOrder: section.sortOrder,
            ),
          );
      }
    }
    if (widget.biteScorePageLoader != null) {
      return _RestaurantMenuData(
        images: images,
        items: items,
        sections: sections,
      );
    }
    images.sort((left, right) {
      final order = left.sortOrder.compareTo(right.sortOrder);
      return order != 0 ? order : left.id.compareTo(right.id);
    });
    items.sort((left, right) {
      final category = left.category.compareTo(right.category);
      if (category != 0) return category;
      final order = left.sortOrder.compareTo(right.sortOrder);
      if (order != 0) return order;
      final name = left.name.compareTo(right.name);
      return name != 0 ? name : left.id.compareTo(right.id);
    });
    sections.sort((left, right) {
      final order = left.sortOrder.compareTo(right.sortOrder);
      if (order != 0) return order;
      final title = left.title.compareTo(right.title);
      return title != 0 ? title : left.id.compareTo(right.id);
    });
    return _RestaurantMenuData(
      images: images,
      items: items,
      sections: sections,
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
    Widget builder(BuildContext _) => _RestaurantMenuImageViewer(
      images: images,
      initialIndex: initialIndex,
      restaurantName: widget.restaurantName,
    );
    final boundedViewerOpener = widget.boundedViewerOpener;
    if (boundedViewerOpener != null) {
      await boundedViewerOpener(context, builder);
      return;
    }
    await Navigator.of(context).push(MaterialPageRoute(builder: builder));
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

  Widget _buildGroupedItems(
    _RestaurantMenuData data, {
    List<Widget> footer = const <Widget>[],
  }) {
    final groupedItems = _groupItems(data.items);
    final rows = <WidgetBuilder>[];
    if (data.images.isNotEmpty) {
      rows
        ..add((_) => _buildImageThumbs(data.images))
        ..add((_) => const SizedBox(height: 20));
    }
    for (final entry in groupedItems.entries) {
      rows
        ..add(
          (_) => Text(
            entry.key,
            style: const TextStyle(
              color: BiteSaverColors.ink,
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
        )
        ..add((_) => const SizedBox(height: 8));
      for (final item in entry.value) {
        rows.add((_) => _buildMenuItemCard(item));
      }
      rows.add((_) => const SizedBox(height: 8));
    }
    if (data.sections.isNotEmpty) {
      if (groupedItems.isNotEmpty) {
        rows.add((_) => const SizedBox(height: 8));
      }
      for (final section in data.sections) {
        rows.add(
          (_) => RestaurantMenuSectionCard(
            title: section.title,
            body: section.body,
            margin: const EdgeInsets.only(bottom: 12),
          ),
        );
      }
    }
    for (final widget in footer) {
      rows.add((_) => widget);
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: rows.length,
      itemBuilder: (context, index) => rows[index](context),
    );
  }

  Widget _buildMenuItemCard(RestaurantMenuItem item) {
    return Padding(
      key: ValueKey<String>('menu-item-${item.id}'),
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
                    color: BiteSaverColors.secondaryText,
                    height: 1.25,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildImageMenu(List<RestaurantMenuImage> images, {Widget? footer}) {
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
        if (footer != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: footer,
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
                color: BiteSaverColors.secondaryText,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBoundedContinuationControl() {
    if (_boundedAppendLoading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (_boundedAppendError != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Column(
          children: [
            const Text(
              'Could not load more menu entries.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: _loadBoundedMore,
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }
    if (_boundedCursor == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: OutlinedButton(
        onPressed: _loadBoundedMore,
        child: const Text('Load more'),
      ),
    );
  }

  Widget _buildBoundedBody() {
    if (_boundedInitialLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_boundedInvalidated) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'This menu access changed. Return to search and try again.',
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    if (_boundedInitialError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Could not load this menu right now.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: _loadBoundedInitial,
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }
    final data = _boundedMenuData;
    if (_boundedAvailability == CustomerBiteSaverMenuAvailability.absent ||
        (data.images.isEmpty &&
            data.items.isEmpty &&
            data.sections.isEmpty &&
            _boundedCursor == null)) {
      return _buildEmptyState();
    }
    final continuation = _buildBoundedContinuationControl();
    if (data.items.isNotEmpty || data.sections.isNotEmpty) {
      return _buildGroupedItems(data, footer: <Widget>[continuation]);
    }
    if (data.images.isNotEmpty) {
      return _buildImageMenu(data.images, footer: continuation);
    }
    return ListView(
      padding: const EdgeInsets.all(24),
      children: <Widget>[
        const Text(
          'No visible menu entries were found on this page.',
          textAlign: TextAlign.center,
        ),
        continuation,
      ],
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
      body:
          widget.boundedPageLoader != null || widget.biteScorePageLoader != null
          ? _buildBoundedBody()
          : FutureBuilder<_RestaurantMenuData>(
              future: _legacyMenuFuture,
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
