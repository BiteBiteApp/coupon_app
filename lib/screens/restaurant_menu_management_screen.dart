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
  final bool requireBiteSaverPostingAccess;
  final String? biteSaverAccessUid;
  final BitescoreRestaurant? biteScoreRestaurant;

  const RestaurantMenuManagementScreen({
    super.key,
    this.source,
    this.restaurantName,
    this.requireBiteSaverPostingAccess = false,
    this.biteSaverAccessUid,
    this.biteScoreRestaurant,
  });

  @override
  State<RestaurantMenuManagementScreen> createState() =>
      _RestaurantMenuManagementScreenState();
}

class _RestaurantMenuManagementScreenState
    extends State<RestaurantMenuManagementScreen> {
  static const List<String> _biteSaverCategories = [
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

  static const List<String> _biteScoreCategories = [
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

  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _descriptionController = TextEditingController();
  final TextEditingController _priceController = TextEditingController();

  String _selectedCategory = _biteSaverCategories.first;
  bool _isLoading = true;
  bool _isSavingItem = false;
  bool _isUploadingImage = false;
  bool _hasPostingAccess = false;
  RestaurantMenuSource? _activeSource;
  RestaurantMenuMatchSuggestion? _matchSuggestion;
  List<RestaurantMenuImage> _images = const [];
  List<RestaurantMenuItem> _items = const [];

  User? get _currentUser => FirebaseAuth.instance.currentUser;

  List<String> get _categories =>
      _sourceForUser(_currentUser)?.isSharedMenu == true
      ? _biteScoreCategories
      : _biteSaverCategories;

  RestaurantMenuSource? _sourceForUser(User? user) {
    final activeSource = _activeSource;
    if (activeSource != null) {
      return activeSource;
    }
    final providedSource = widget.source;
    if (providedSource != null) {
      return providedSource;
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
      final source = _sourceForUser(user);
      if (source == null || source.id.isEmpty) {
        throw StateError('Menu source is unavailable.');
      }

      var hasAccess = true;
      Map<String, dynamic>? accountData;
      if (widget.requireBiteSaverPostingAccess) {
        final accessUid = widget.biteSaverAccessUid?.trim().isNotEmpty == true
            ? widget.biteSaverAccessUid!.trim()
            : user.uid;
        accountData = await RestaurantAccountService.getAccountData(accessUid);
        hasAccess = RestaurantAccountService.hasCouponPostingAccess(
          accountData,
        );
      } else if (source.isLegacyBiteSaver) {
        accountData = await RestaurantAccountService.getAccountData(user.uid);
        hasAccess = RestaurantAccountService.hasCouponPostingAccess(
          accountData,
        );
      }
      final results = await Future.wait([
        RestaurantMenuService.loadMenuImages(source),
        RestaurantMenuService.loadMenuItems(source),
      ]);
      final matchSuggestion = await RestaurantMenuService.findLikelyMenuMatch(
        currentUserId: user.uid,
        biteSaverAccountData: accountData,
        biteScoreRestaurant: widget.biteScoreRestaurant,
      );

      if (!mounted) return;
      setState(() {
        _activeSource = source;
        _matchSuggestion = matchSuggestion;
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
      if (source == null || source.id.isEmpty) {
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
      if (source == null || source.id.isEmpty) {
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
    if (source == null || source.id.isEmpty) return;

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
    if (source == null || source.id.isEmpty) return;

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

  Widget _buildMasterMenuPreviewSection() {
    final suggestion = _matchSuggestion;
    if (suggestion == null) {
      return const SizedBox.shrink();
    }

    final matchedSideLabel =
        suggestion.matchedSide == RestaurantMenuAppSide.biteSaver
        ? 'BiteSaver'
        : 'BiteRater';

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
            'Use one menu for both sides',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          const Text(
            'This looks like the same restaurant on BiteSaver and BiteRater. You can choose one menu later so both sides stay consistent.',
            style: TextStyle(color: Colors.black54, height: 1.3),
          ),
          const SizedBox(height: 10),
          Text(
            suggestion.matchedRestaurantName,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          if (suggestion.matchedRestaurantAddress.trim().isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                '$matchedSideLabel • ${suggestion.matchedRestaurantAddress}',
                style: const TextStyle(color: Colors.black54, height: 1.25),
              ),
            ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton(
                onPressed: _showMenuSelectionComingSoon,
                child: const Text('Use BiteSaver menu'),
              ),
              OutlinedButton(
                onPressed: _showMenuSelectionComingSoon,
                child: const Text('Use BiteRater menu'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _showMenuSelectionComingSoon() {
    _showSnackBar('Menu selection is coming next.');
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
                _buildMasterMenuPreviewSection(),
                if (_matchSuggestion != null) const SizedBox(height: 16),
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
