import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../models/bitescore_restaurant.dart';
import '../services/app_error_text.dart';
import '../services/bitesaver_image_upload_service.dart';
import '../services/restaurant_account_service.dart';
import '../services/restaurant_menu_service.dart';

class RestaurantMenuManagementScreen extends StatefulWidget {
  final RestaurantMenuSource? source;
  final String? restaurantName;
  final BitescoreRestaurant? biteScoreRestaurant;

  const RestaurantMenuManagementScreen({
    super.key,
    this.source,
    this.restaurantName,
    this.biteScoreRestaurant,
  });

  @override
  State<RestaurantMenuManagementScreen> createState() =>
      _RestaurantMenuManagementScreenState();
}

class _RestaurantMenuManagementScreenState
    extends State<RestaurantMenuManagementScreen> {
  static const List<String> _categories = [
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

  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _descriptionController = TextEditingController();
  final TextEditingController _priceController = TextEditingController();

  String _selectedCategory = _categories.first;
  bool _isLoading = true;
  bool _isSavingItem = false;
  bool _isUploadingImage = false;
  bool _isLinkingMenu = false;
  bool _hasPostingAccess = false;
  RestaurantMenuSource? _activeSource;
  RestaurantMenuLinkSuggestion? _linkSuggestion;
  List<RestaurantMenuImage> _images = const [];
  List<RestaurantMenuItem> _items = const [];

  User? get _currentUser => FirebaseAuth.instance.currentUser;

  RestaurantMenuSource? _sourceForUser(User? user) {
    final activeSource = _activeSource;
    if (activeSource != null) {
      return activeSource;
    }
    if (user == null) {
      return null;
    }
    return RestaurantMenuSource.legacyBiteSaver(user.uid);
  }

  @override
  void initState() {
    super.initState();
    _loadMenu();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  Future<void> _loadMenu() async {
    final user = _currentUser;
    if (user == null) {
      setState(() {
        _isLoading = false;
        _hasPostingAccess = false;
      });
      return;
    }

    try {
      final accountData = widget.biteScoreRestaurant == null
          ? await RestaurantAccountService.getAccountData(user.uid)
          : null;
      final source =
          _activeSource ??
          widget.source ??
          RestaurantMenuService.sourceForBiteSaverAccountData(
            uid: user.uid,
            accountData: accountData,
          );

      var hasAccess = true;
      if (widget.biteScoreRestaurant == null) {
        hasAccess = RestaurantAccountService.hasCouponPostingAccess(
          accountData,
        );
      }
      final results = await Future.wait([
        RestaurantMenuService.loadMenuImages(source),
        RestaurantMenuService.loadMenuItems(source),
      ]);
      final suggestion = await RestaurantMenuService.findLinkSuggestion(
        currentUserId: user.uid,
        currentSource: source,
        biteSaverAccountData: accountData,
        biteScoreRestaurant: widget.biteScoreRestaurant,
      );

      if (!mounted) return;
      setState(() {
        _activeSource = source;
        _linkSuggestion = suggestion;
        _hasPostingAccess = hasAccess;
        _images = results[0] as List<RestaurantMenuImage>;
        _items = results[1] as List<RestaurantMenuItem>;
        _isLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
      });
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not load menu tools right now.',
        ),
      );
    }
  }

  Future<void> _linkSuggestedMenu(
    RestaurantMenuLinkSuggestion suggestion,
  ) async {
    if (_isLinkingMenu) {
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Use existing menu?'),
        content: Text(
          'This will make this restaurant use the same menu as '
          '${suggestion.targetRestaurantName}. Future menu edits will be shared '
          'between both profiles.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Use Menu'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) {
      return;
    }

    setState(() {
      _isLinkingMenu = true;
    });
    try {
      final linkedSource = await RestaurantMenuService.linkSuggestedSharedMenu(
        suggestion,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar('Menu linked.');
      setState(() {
        _activeSource = linkedSource;
        _linkSuggestion = null;
        _isLoading = true;
      });
      await _loadMenu();
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback:
              'Could not link menus. If both menus already have content, manual resolution is needed.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLinkingMenu = false;
        });
      }
    }
  }

  void _showSnackBar(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _uploadMenuImage() async {
    final user = _currentUser;
    if (user == null) {
      _showSnackBar('Please sign in to manage your menu.');
      return;
    }

    setState(() {
      _isUploadingImage = true;
    });

    try {
      final source = _sourceForUser(user);
      if (source == null) {
        _showSnackBar('Please sign in to manage your menu.');
        return;
      }

      String? imageUrl;
      String? storagePath;
      if (source.isSharedMenu) {
        final upload =
            await BiteSaverImageUploadService.pickAndUploadSharedMenuImage(
              menuId: source.id,
            );
        imageUrl = upload?.imageUrl;
        storagePath = upload?.storagePath;
      } else {
        imageUrl = await BiteSaverImageUploadService.pickAndUploadMenuImage(
          uid: source.id,
        );
      }
      if (imageUrl == null) {
        return;
      }

      final savedImage = await RestaurantMenuService.saveMenuImage(
        source: source,
        imageUrl: imageUrl,
        storagePath: storagePath,
      );
      if (!mounted) return;
      setState(() {
        _images = [..._images, savedImage]
          ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      });
      _showSnackBar('Menu image uploaded.');
    } catch (error) {
      if (!mounted) return;
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not upload the menu image right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isUploadingImage = false;
        });
      }
    }
  }

  Future<void> _addMenuItem() async {
    final user = _currentUser;
    if (user == null) {
      _showSnackBar('Please sign in to manage your menu.');
      return;
    }

    final name = _nameController.text.trim();
    if (name.isEmpty) {
      _showSnackBar('Menu item name is required.');
      return;
    }

    setState(() {
      _isSavingItem = true;
    });

    try {
      final source = _sourceForUser(user);
      if (source == null) {
        _showSnackBar('Please sign in to manage your menu.');
        return;
      }
      final savedItem = await RestaurantMenuService.saveMenuItem(
        source: source,
        name: name,
        description: _descriptionController.text,
        price: _priceController.text,
        category: _selectedCategory,
      );
      if (!mounted) return;
      setState(() {
        _items = [..._items, savedItem];
        _nameController.clear();
        _descriptionController.clear();
        _priceController.clear();
      });
      _showSnackBar('Menu item added.');
    } catch (error) {
      if (!mounted) return;
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not save the menu item right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSavingItem = false;
        });
      }
    }
  }

  Future<void> _deleteImage(RestaurantMenuImage image) async {
    final user = _currentUser;
    if (user == null) return;
    final source = _sourceForUser(user);
    if (source == null) return;

    try {
      await RestaurantMenuService.deleteMenuImage(
        source: source,
        imageId: image.id,
      );
      if (!mounted) return;
      setState(() {
        _images = _images.where((entry) => entry.id != image.id).toList();
      });
    } catch (error) {
      if (!mounted) return;
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not delete that menu image.',
        ),
      );
    }
  }

  Future<void> _deleteItem(RestaurantMenuItem item) async {
    final user = _currentUser;
    if (user == null) return;
    final source = _sourceForUser(user);
    if (source == null) return;

    try {
      await RestaurantMenuService.deleteMenuItem(
        source: source,
        itemId: item.id,
      );
      if (!mounted) return;
      setState(() {
        _items = _items.where((entry) => entry.id != item.id).toList();
      });
    } catch (error) {
      if (!mounted) return;
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not delete that menu item.',
        ),
      );
    }
  }

  Map<String, List<RestaurantMenuItem>> _itemsByCategory() {
    final grouped = <String, List<RestaurantMenuItem>>{};
    for (final item in _items) {
      grouped.putIfAbsent(item.category, () => []).add(item);
    }
    return grouped;
  }

  InputDecoration _inputDecoration(String label, String hint) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
    );
  }

  Widget _buildAccessNotice() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7ED),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFFED7AA)),
      ),
      child: const Text(
        'Your BiteSaver restaurant account must be approved and active before managing a menu.',
        style: TextStyle(color: Color(0xFF9A3412), height: 1.35),
      ),
    );
  }

  Widget _buildMenuSourceSection() {
    final suggestion = _linkSuggestion;
    if (suggestion == null) {
      return const SizedBox.shrink();
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Menu source',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          const Text(
            'This restaurant may match a profile on the other side of the app.',
            style: TextStyle(color: Colors.black54, height: 1.3),
          ),
          const SizedBox(height: 8),
          Text(
            suggestion.targetRestaurantName,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          if (suggestion.targetRestaurantAddress?.trim().isNotEmpty == true)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                suggestion.targetRestaurantAddress!.trim(),
                style: const TextStyle(color: Colors.black54, height: 1.25),
              ),
            ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: _isLinkingMenu
                ? null
                : () => _linkSuggestedMenu(suggestion),
            icon: _isLinkingMenu
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.link),
            label: Text(_isLinkingMenu ? 'Linking...' : suggestion.actionLabel),
          ),
        ],
      ),
    );
  }

  Widget _buildImageList() {
    if (_images.isEmpty) {
      return const Text(
        'No menu images uploaded yet.',
        style: TextStyle(color: Colors.black54),
      );
    }

    return SizedBox(
      height: 106,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _images.length,
        separatorBuilder: (context, index) => const SizedBox(width: 10),
        itemBuilder: (context, index) {
          final image = _images[index];
          return SizedBox(
            width: 108,
            child: Stack(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.network(
                    image.imageUrl,
                    width: 108,
                    height: 106,
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) => Container(
                      width: 108,
                      height: 106,
                      color: const Color(0xFFF3E8DD),
                      child: const Icon(Icons.menu_book_outlined),
                    ),
                  ),
                ),
                Positioned(
                  right: 2,
                  top: 2,
                  child: IconButton.filledTonal(
                    onPressed: _hasPostingAccess
                        ? () => _deleteImage(image)
                        : null,
                    icon: const Icon(Icons.close, size: 16),
                    visualDensity: VisualDensity.compact,
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildItemList() {
    if (_items.isEmpty) {
      return const Text(
        'No manual menu items added yet.',
        style: TextStyle(color: Colors.black54),
      );
    }

    final grouped = _itemsByCategory();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final category in _categories)
          if (grouped[category]?.isNotEmpty == true) ...[
            Padding(
              padding: const EdgeInsets.only(top: 10, bottom: 6),
              child: Text(
                category,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            for (final item in grouped[category]!)
              Card(
                child: ListTile(
                  title: Text(item.name),
                  subtitle: Text(
                    [
                      if (item.price.trim().isNotEmpty) item.price,
                      if (item.description.trim().isNotEmpty) item.description,
                    ].join('\n'),
                  ),
                  trailing: IconButton(
                    tooltip: 'Delete menu item',
                    onPressed: _hasPostingAccess
                        ? () => _deleteItem(item)
                        : null,
                    icon: const Icon(Icons.delete_outline),
                  ),
                ),
              ),
          ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.restaurantName?.trim().isNotEmpty == true
              ? '${widget.restaurantName!.trim()} Menu'
              : 'Manage Menu',
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (!_hasPostingAccess) ...[
                  _buildAccessNotice(),
                  const SizedBox(height: 16),
                ],
                _buildMenuSourceSection(),
                if (_linkSuggestion != null) const SizedBox(height: 16),
                const Text(
                  'Menu Images',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                _buildImageList(),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: _hasPostingAccess && !_isUploadingImage
                      ? _uploadMenuImage
                      : null,
                  icon: _isUploadingImage
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.image_outlined),
                  label: Text(
                    _isUploadingImage ? 'Uploading...' : 'Upload menu image',
                  ),
                ),
                const SizedBox(height: 24),
                const Divider(),
                const SizedBox(height: 16),
                const Text(
                  'Manual Menu Item',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _nameController,
                  decoration: _inputDecoration('Item name', 'Pancakes'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _descriptionController,
                  minLines: 2,
                  maxLines: 4,
                  decoration: _inputDecoration(
                    'Description',
                    'Buttermilk pancakes with syrup',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _priceController,
                  keyboardType: TextInputType.text,
                  decoration: _inputDecoration('Price', r'$8.99'),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: _selectedCategory,
                  decoration: _inputDecoration('Category', ''),
                  items: _categories
                      .map(
                        (category) => DropdownMenuItem(
                          value: category,
                          child: Text(category),
                        ),
                      )
                      .toList(),
                  onChanged: _hasPostingAccess
                      ? (value) {
                          if (value != null) {
                            setState(() => _selectedCategory = value);
                          }
                        }
                      : null,
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: _hasPostingAccess && !_isSavingItem
                      ? _addMenuItem
                      : null,
                  icon: _isSavingItem
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.add),
                  label: Text(_isSavingItem ? 'Saving...' : 'Add menu item'),
                ),
                const SizedBox(height: 24),
                const Text(
                  'Current Menu Items',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                _buildItemList(),
              ],
            ),
    );
  }
}
