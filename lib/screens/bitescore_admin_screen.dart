import 'package:flutter/material.dart';

import '../models/bitescore_dish.dart';
import '../models/bitescore_restaurant.dart';
import '../models/dish_review.dart';
import '../models/restaurant_claim_request.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_service.dart';
import '../widgets/biterater_theme.dart';
import 'bitescore_restaurant_dishes_screen.dart';

class BiteScoreAdminScreen extends StatefulWidget {
  const BiteScoreAdminScreen({super.key});

  @override
  State<BiteScoreAdminScreen> createState() => _BiteScoreAdminScreenState();
}

class _BiteScoreAdminScreenState extends State<BiteScoreAdminScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  BitescoreRestaurant? _selectedDishRestaurant;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 9, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  void _openRestaurantDishes(BitescoreRestaurant restaurant) {
    setState(() {
      _selectedDishRestaurant = restaurant;
    });
    _tabController.animateTo(1);
  }

  @override
  Widget build(BuildContext context) {
    final adminTheme = Theme.of(context).copyWith(
      cardTheme: Theme.of(context).cardTheme.copyWith(
            color: Colors.white,
            elevation: 0,
            surfaceTintColor: Colors.transparent,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
              side: BorderSide(
                color: BiteRaterTheme.grape.withOpacity(0.14),
              ),
            ),
          ),
    );

    return Theme(
      data: adminTheme,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: BiteRaterTheme.liftedCard(
              radius: 16,
              borderColor: BiteRaterTheme.grape.withOpacity(0.16),
              child: TabBar(
                controller: _tabController,
                isScrollable: true,
                labelColor: BiteRaterTheme.grape,
                unselectedLabelColor: BiteRaterTheme.mutedInk,
                indicatorColor: BiteRaterTheme.coral,
                tabs: const [
                  Tab(text: 'Restaurants'),
                  Tab(text: 'Dishes'),
                  Tab(text: 'Reviews'),
                  Tab(text: 'Reported Reviews'),
                  Tab(text: 'Data Reports'),
                  Tab(text: 'Claims'),
                  Tab(text: 'Dish Suggestions'),
                  Tab(text: 'Claimed Restaurants'),
                  Tab(text: 'Users'),
                ],
              ),
            ),
          ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
            children: [
              _BiteScoreRestaurantAdminList(
                onManageDishes: _openRestaurantDishes,
              ),
              _BiteScoreDishAdminList(
                selectedRestaurant: _selectedDishRestaurant,
              ),
              const _BiteScoreReviewAdminList(),
              const _BiteScoreReportedReviewAdminList(),
              const _BiteScoreDataReportsAdminList(),
              const _BiteScoreClaimAdminList(),
              const _BiteScoreDishSuggestionAdminList(),
              const _BiteScoreApprovedOwnershipAdminList(),
              const _BiteScoreUsersAdminList(),
            ],
            ),
          ),
        ],
      ),
    );
  }
}

String _normalizeAdminSearchText(String value) {
  return value.toLowerCase().trim();
}

bool _matchesAdminQuery(String query, Iterable<String?> values) {
  final normalizedQuery = _normalizeAdminSearchText(query);
  if (normalizedQuery.isEmpty) {
    return true;
  }

  for (final value in values) {
    if (value == null) {
      continue;
    }
    if (_normalizeAdminSearchText(value).contains(normalizedQuery)) {
      return true;
    }
  }

  return false;
}

class _AdminSearchField extends StatefulWidget {
  final TextEditingController controller;
  final String label;
  final ValueChanged<String> onChanged;

  const _AdminSearchField({
    required this.controller,
    required this.label,
    required this.onChanged,
  });

  @override
  State<_AdminSearchField> createState() => _AdminSearchFieldState();
}

class _AdminSearchFieldState extends State<_AdminSearchField> {
  late final FocusNode _focusNode;

  @override
  void initState() {
    super.initState();
    _focusNode = FocusNode();
  }

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  void _submitSearch() {
    widget.onChanged(widget.controller.text);
    _focusNode.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: widget.controller,
      focusNode: _focusNode,
      onSubmitted: (_) => _submitSearch(),
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        prefixIcon: const Icon(
          Icons.search,
          color: BiteRaterTheme.grape,
        ),
        suffixIcon: IconButton(
          tooltip: 'Search',
          onPressed: _submitSearch,
          icon: const Icon(
            Icons.arrow_forward,
            color: BiteRaterTheme.coral,
          ),
        ),
        labelText: widget.label,
        filled: true,
        fillColor: Colors.white,
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: BiteRaterTheme.lineBlue),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(
            color: BiteRaterTheme.grape,
            width: 1.4,
          ),
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
        ),
      ),
    );
  }
}

class _AdminEmptyStateCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String message;

  const _AdminEmptyStateCard({
    required this.icon,
    required this.title,
    required this.message,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: BiteRaterTheme.liftedCard(
            radius: 22,
            borderColor: BiteRaterTheme.grape.withOpacity(0.16),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    icon,
                    size: 44,
                    color: BiteRaterTheme.grape,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    title,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: BiteRaterTheme.ink,
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    message,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: BiteRaterTheme.mutedInk,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _BiteScoreRestaurantAdminList extends StatefulWidget {
  final ValueChanged<BitescoreRestaurant> onManageDishes;

  const _BiteScoreRestaurantAdminList({
    required this.onManageDishes,
  });

  @override
  State<_BiteScoreRestaurantAdminList> createState() =>
      _BiteScoreRestaurantAdminListState();
}

class _BiteScoreRestaurantAdminListState
    extends State<_BiteScoreRestaurantAdminList> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<bool> _confirmDelete(
    BuildContext context, {
    required String title,
    required String message,
  }) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Delete'),
            ),
          ],
        );
      },
    );

    return confirmed == true;
  }

  Future<void> _deleteRestaurant(
    BuildContext context,
    BitescoreRestaurant restaurant,
  ) async {
    final confirmed = await _confirmDelete(
      context,
      title: 'Delete Restaurant',
      message: 'Delete ${restaurant.name} and its related dishes and reviews?',
    );
    if (!confirmed || !context.mounted) {
      return;
    }

    try {
      await BiteScoreService.deleteRestaurantAsAdmin(restaurant.id);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, '${restaurant.name} deleted.');
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not delete the restaurant right now.',
        ),
      );
    }
  }

  Future<void> _editRestaurant(
    BuildContext context,
    BitescoreRestaurant restaurant,
  ) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) {
        return _BiteScoreRestaurantEditDialog(restaurant: restaurant);
      },
    );

    if (saved == true && context.mounted) {
      _showSnackBar(context, '${restaurant.name} updated.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<BitescoreRestaurant>>(
      stream: BiteScoreService.restaurantsAdminStream(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                AppErrorText.load('BiteScore restaurants'),
                textAlign: TextAlign.center,
              ),
            ),
          );
        }

        final restaurants = snapshot.data ?? const <BitescoreRestaurant>[];
        final filteredRestaurants = restaurants
            .where(
              (restaurant) => _matchesAdminQuery(
                _searchController.text,
                [
                  restaurant.name,
                  restaurant.address,
                  restaurant.city,
                  restaurant.state,
                  restaurant.zipCode,
                  restaurant.phone,
                  restaurant.ownerUserId,
                ],
              ),
            )
            .toList(growable: false);

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _AdminSearchField(
              controller: _searchController,
              label: 'Search restaurants',
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            if (restaurants.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.storefront_outlined,
                title: 'No Restaurants Yet',
                message:
                    'Newly added BiteScore restaurants will appear here for admin review and maintenance.',
              )
            else if (filteredRestaurants.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.search_off,
                title: 'No Matching Restaurants',
                message: 'Try a different restaurant name, city, or ZIP search.',
              )
            else
              ...filteredRestaurants.map((restaurant) {
            final subtitleLines = <String>[
              if (restaurant.address.trim().isNotEmpty) restaurant.address.trim(),
              [
                restaurant.city.trim(),
                restaurant.state.trim(),
                restaurant.zipCode.trim(),
              ].where((part) => part.isNotEmpty).join(', '),
              if ((restaurant.phone ?? '').trim().isNotEmpty)
                'Phone: ${restaurant.phone!.trim()}',
              'Status: ${restaurant.isActive ? 'Active' : 'Hidden'}',
            ].where((line) => line.trim().isNotEmpty).toList();

            return BiteRaterTheme.liftedCard(
              margin: const EdgeInsets.only(bottom: 12),
              child: ListTile(
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 10,
                ),
                title: Text(
                  restaurant.name,
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                subtitle: Text(subtitleLines.join('\n')),
                isThreeLine: subtitleLines.length > 1,
                trailing: Wrap(
                  spacing: 4,
                  children: [
                    IconButton(
                      tooltip: 'Manage this restaurant\'s dishes',
                      icon: const Icon(Icons.restaurant_menu_outlined),
                      onPressed: () => widget.onManageDishes(restaurant),
                    ),
                    IconButton(
                      tooltip: 'Edit restaurant',
                      icon: const Icon(Icons.edit_outlined),
                      onPressed: () => _editRestaurant(context, restaurant),
                    ),
                    IconButton(
                      tooltip: 'Delete restaurant',
                      icon: const Icon(Icons.delete_outline),
                      onPressed: () => _deleteRestaurant(context, restaurant),
                    ),
                  ],
                ),
              ),
            );
              }),
          ],
        );
      },
    );
  }
}

class _BiteScoreDishAdminList extends StatefulWidget {
  final BitescoreRestaurant? selectedRestaurant;

  const _BiteScoreDishAdminList({
    required this.selectedRestaurant,
  });

  @override
  State<_BiteScoreDishAdminList> createState() => _BiteScoreDishAdminListState();
}

class _BiteScoreDishAdminListState extends State<_BiteScoreDishAdminList> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<void> _deleteDish(BuildContext context, BitescoreDish dish) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Delete Dish'),
          content: Text('Delete ${dish.name}?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Delete'),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !context.mounted) {
      return;
    }

    try {
      await BiteScoreService.deleteDishAsAdmin(dish.id);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, '${dish.name} deleted.');
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not delete the dish right now.',
        ),
      );
    }
  }

  Future<void> _editDish(BuildContext context, BitescoreDish dish) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) {
        return _BiteScoreDishEditDialog(dish: dish);
      },
    );

    if (saved == true && context.mounted) {
      _showSnackBar(context, '${dish.name} updated.');
    }
  }

  Future<void> _toggleAvailability(
    BuildContext context,
    BitescoreDish dish,
  ) async {
    try {
      await BiteScoreService.setDishAvailabilityAsAdmin(
        dish: dish,
        isActive: !dish.isActive,
      );
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        dish.isActive
            ? '${dish.name} marked unavailable.'
            : '${dish.name} marked available.',
      );
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not update dish availability right now.',
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final selectedRestaurant = widget.selectedRestaurant;
    if (selectedRestaurant == null) {
      return const _AdminEmptyStateCard(
        icon: Icons.restaurant_menu_outlined,
        title: 'Choose a Restaurant First',
        message:
            'Open the Restaurants tab, search for a restaurant, and tap the menu icon to manage that restaurant\'s dishes.',
      );
    }

    return StreamBuilder<List<BitescoreDish>>(
      stream: BiteScoreService.dishesAdminStream(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                AppErrorText.load('BiteScore dishes'),
                textAlign: TextAlign.center,
              ),
            ),
          );
        }

        final dishes = (snapshot.data ?? const <BitescoreDish>[])
            .where((dish) => dish.restaurantId == selectedRestaurant.id)
            .toList(growable: false);
        final filteredDishes = dishes
            .where(
              (dish) => _matchesAdminQuery(
                _searchController.text,
                [
                  dish.name,
                  dish.category,
                  dish.priceLabel,
                  dish.restaurantName,
                ],
              ),
            )
            .toList(growable: false);

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              'Managing dishes for ${selectedRestaurant.name}',
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            _AdminSearchField(
              controller: _searchController,
              label: 'Search this restaurant\'s dishes',
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            if (dishes.isEmpty)
              _AdminEmptyStateCard(
                icon: Icons.restaurant_menu_outlined,
                title: 'No Dishes for ${selectedRestaurant.name}',
                message:
                    'This restaurant does not have BiteScore dishes yet.',
              )
            else if (filteredDishes.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.search_off,
                title: 'No Matching Dishes',
                message: 'Try a different dish name, category, or price search.',
              )
            else
              ...filteredDishes.map((dish) {
            final subtitleLines = <String>[
              dish.restaurantName,
              if ((dish.category ?? '').trim().isNotEmpty) dish.category!.trim(),
              if ((dish.priceLabel ?? '').trim().isNotEmpty)
                dish.priceLabel!.trim(),
              'Status: ${dish.isActive ? 'Available' : 'Unavailable'}',
            ];

            return BiteRaterTheme.liftedCard(
              margin: const EdgeInsets.only(bottom: 12),
              child: ListTile(
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 10,
                ),
                title: Text(
                  dish.name,
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                subtitle: Text(subtitleLines.join('\n')),
                isThreeLine: true,
                trailing: Wrap(
                  spacing: 4,
                  children: [
                    IconButton(
                      tooltip: dish.isActive
                          ? 'Mark unavailable'
                          : 'Mark available',
                      icon: Icon(
                        dish.isActive ? Icons.visibility_off : Icons.visibility,
                      ),
                      onPressed: () => _toggleAvailability(context, dish),
                    ),
                    IconButton(
                      tooltip: 'Edit dish',
                      icon: const Icon(Icons.edit_outlined),
                      onPressed: () => _editDish(context, dish),
                    ),
                    IconButton(
                      tooltip: 'Delete dish',
                      icon: const Icon(Icons.delete_outline),
                      onPressed: () => _deleteDish(context, dish),
                    ),
                  ],
                ),
              ),
            );
              }),
          ],
        );
      },
    );
  }
}

class _BiteScoreReviewAdminList extends StatefulWidget {
  const _BiteScoreReviewAdminList();

  @override
  State<_BiteScoreReviewAdminList> createState() =>
      _BiteScoreReviewAdminListState();
}

class _BiteScoreReviewAdminListState extends State<_BiteScoreReviewAdminList> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<void> _deleteReview(
    BuildContext context,
    BiteScoreAdminReviewEntry entry,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Delete Review'),
          content: Text(
            'Delete this review for ${entry.dishName} at ${entry.restaurantName}? '
            'Dish aggregates will be rebuilt automatically.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Delete'),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !context.mounted) {
      return;
    }

    try {
      await BiteScoreService.deleteReviewAsAdmin(entry.review);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, 'Review deleted and aggregate updated.');
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not delete the review right now.',
        ),
      );
    }
  }

  String _reviewDateLabel(DishReview review) {
    final createdAt = review.createdAt;
    if (createdAt == null) {
      return 'Date unavailable';
    }

    final month = createdAt.month.toString().padLeft(2, '0');
    final day = createdAt.day.toString().padLeft(2, '0');
    return '$month/$day/${createdAt.year}';
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<BiteScoreAdminReviewEntry>>(
      stream: BiteScoreService.reviewsAdminStream(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                AppErrorText.load('BiteScore reviews'),
                textAlign: TextAlign.center,
              ),
            ),
          );
        }

        final entries = snapshot.data ?? const <BiteScoreAdminReviewEntry>[];
        final filteredEntries = entries
            .where(
              (entry) => _matchesAdminQuery(
                _searchController.text,
                [
                  entry.review.userId,
                  entry.dishName,
                  entry.restaurantName,
                  entry.review.headline,
                  entry.review.notes,
                ],
              ),
            )
            .toList(growable: false);

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _AdminSearchField(
              controller: _searchController,
              label: 'Search reviews',
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            if (entries.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.rate_review_outlined,
                title: 'No Reviews Yet',
                message:
                    'BiteScore reviews will show up here once customers begin rating dishes.',
              )
            else if (filteredEntries.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.search_off,
                title: 'No Matching Reviews',
                message:
                    'Try a different dish, restaurant, user ID, or review text search.',
              )
            else
              ...filteredEntries.map((entry) {
            final review = entry.review;
            final subtitleLines = <String>[
              '${entry.restaurantName} • ${entry.dishName}',
              'Enjoyment: ${review.overallImpression.toStringAsFixed(1)}',
              'BiteScore: ${review.overallBiteScore.toStringAsFixed(0)}',
              _reviewDateLabel(review),
              if ((review.headline ?? '').trim().isNotEmpty)
                'Headline: ${review.headline!.trim()}',
              if ((review.notes ?? '').trim().isNotEmpty)
                'Notes: ${review.notes!.trim()}',
            ];

            return BiteRaterTheme.liftedCard(
              margin: const EdgeInsets.only(bottom: 12),
              child: ListTile(
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 10,
                ),
                title: Text(
                  'Review by ${review.userId}',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                subtitle: Text(subtitleLines.join('\n')),
                isThreeLine: true,
                trailing: IconButton(
                  tooltip: 'Delete review',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => _deleteReview(context, entry),
                ),
              ),
            );
              }),
          ],
        );
      },
    );
  }
}

class _BiteScoreReportedReviewAdminList extends StatefulWidget {
  const _BiteScoreReportedReviewAdminList();

  @override
  State<_BiteScoreReportedReviewAdminList> createState() =>
      _BiteScoreReportedReviewAdminListState();
}

class _BiteScoreReportedReviewAdminListState
    extends State<_BiteScoreReportedReviewAdminList> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<void> _dismissReports(
    BuildContext context,
    BiteScoreReportedReviewAdminEntry entry,
  ) async {
    try {
      await BiteScoreService.dismissReportedReviewAsAdmin(entry);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, 'Report dismissed.');
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not dismiss this report right now.',
        ),
      );
    }
  }

  Future<void> _deleteReview(
    BuildContext context,
    BiteScoreReportedReviewAdminEntry entry,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Delete Review'),
          content: Text(
            'Delete this reported review for ${entry.dishName} at '
            '${entry.restaurantName}? Dish aggregates will be rebuilt automatically.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Delete'),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !context.mounted) {
      return;
    }

    try {
      await BiteScoreService.deleteReviewAsAdmin(entry.review);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, 'Review deleted and aggregate updated.');
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not delete the review right now.',
        ),
      );
    }
  }

  String _reviewDateLabel(DishReview review) {
    final createdAt = review.createdAt;
    if (createdAt == null) {
      return 'Date unavailable';
    }

    final month = createdAt.month.toString().padLeft(2, '0');
    final day = createdAt.day.toString().padLeft(2, '0');
    return '$month/$day/${createdAt.year}';
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<BiteScoreReportedReviewAdminEntry>>(
      stream: BiteScoreService.reportedReviewsAdminStream(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                AppErrorText.load('reported BiteScore reviews'),
                textAlign: TextAlign.center,
              ),
            ),
          );
        }

        final entries =
            snapshot.data ?? const <BiteScoreReportedReviewAdminEntry>[];
        final filteredEntries = entries
            .where(
              (entry) => _matchesAdminQuery(
                _searchController.text,
                [
                  entry.review.userId,
                  entry.dishName,
                  entry.restaurantName,
                  entry.reportStatus,
                  entry.distinctReasons.join(' '),
                  entry.review.headline,
                  entry.review.notes,
                ],
              ),
            )
            .toList(growable: false);

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _AdminSearchField(
              controller: _searchController,
              label: 'Search reported reviews',
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            if (entries.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.report_outlined,
                title: 'No Reported Reviews',
                message:
                    'Review reports from users will appear here when something needs a moderation look.',
              )
            else if (filteredEntries.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.search_off,
                title: 'No Matching Reported Reviews',
                message:
                    'Try a different restaurant, dish, user ID, or reason search.',
              )
            else
              ...filteredEntries.map((entry) {
            final review = entry.review;
            final subtitleLines = <String>[
              '${entry.restaurantName} - ${entry.dishName}',
              'Reports: ${entry.reportCount}',
              'Status: ${entry.reportStatus}',
              'Enjoyment: ${review.overallImpression.toStringAsFixed(1)}',
              'BiteScore: ${review.overallBiteScore.toStringAsFixed(0)}',
              _reviewDateLabel(review),
              if (entry.distinctReasons.isNotEmpty)
                'Reasons: ${entry.distinctReasons.join(', ')}',
              if ((review.headline ?? '').trim().isNotEmpty)
                'Headline: ${review.headline!.trim()}',
              if ((review.notes ?? '').trim().isNotEmpty)
                'Notes: ${review.notes!.trim()}',
            ];

            return BiteRaterTheme.liftedCard(
              margin: const EdgeInsets.only(bottom: 12),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Review by ${review.userId}',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(subtitleLines.join('\n')),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        OutlinedButton(
                          onPressed: () => _dismissReports(context, entry),
                          child: const Text('Dismiss Report'),
                        ),
                        ElevatedButton(
                          onPressed: () => _deleteReview(context, entry),
                          child: const Text('Delete Review'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
              }),
          ],
        );
      },
    );
  }
}

class _BiteScoreDataReportsAdminList extends StatelessWidget {
  const _BiteScoreDataReportsAdminList();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: const [
        _BiteScoreReportedRestaurantsSection(),
        SizedBox(height: 20),
        _BiteScoreReportedDishesSection(),
        SizedBox(height: 20),
        _BiteScoreDuplicateRestaurantsSection(),
      ],
    );
  }
}

class _BiteScoreReportedRestaurantsSection extends StatefulWidget {
  const _BiteScoreReportedRestaurantsSection();

  @override
  State<_BiteScoreReportedRestaurantsSection> createState() =>
      _BiteScoreReportedRestaurantsSectionState();
}

class _BiteScoreReportedRestaurantsSectionState
    extends State<_BiteScoreReportedRestaurantsSection> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<void> _dismissReports(
    BuildContext context,
    BiteScoreReportedRestaurantAdminEntry entry,
  ) async {
    try {
      await BiteScoreService.dismissReportedRestaurantAsAdmin(entry);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, 'Restaurant report dismissed.');
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not dismiss this restaurant report right now.',
        ),
      );
    }
  }

  Future<void> _editRestaurant(
    BuildContext context,
    BitescoreRestaurant restaurant,
  ) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) {
        return _BiteScoreRestaurantEditDialog(restaurant: restaurant);
      },
    );

    if (saved == true && context.mounted) {
      _showSnackBar(context, '${restaurant.name} updated.');
    }
  }

  Future<void> _deleteRestaurant(
    BuildContext context,
    BitescoreRestaurant restaurant,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Delete Restaurant'),
          content: Text(
            'Delete ${restaurant.name} and its related dishes and reviews?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Delete'),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !context.mounted) {
      return;
    }

    try {
      await BiteScoreService.deleteRestaurantAsAdmin(restaurant.id);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, '${restaurant.name} deleted.');
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not delete the restaurant right now.',
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return _BiteScoreDataReportSection(
      title: 'Reported Restaurants',
      child: StreamBuilder<List<BiteScoreReportedRestaurantAdminEntry>>(
        stream: BiteScoreService.reportedRestaurantsAdminStream(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
            return Text(AppErrorText.load('reported restaurants'));
          }

          final entries =
              snapshot.data ?? const <BiteScoreReportedRestaurantAdminEntry>[];
          final filteredEntries = entries
              .where(
                (entry) => _matchesAdminQuery(
                  _searchController.text,
                  [
                    entry.restaurant.name,
                    entry.restaurant.city,
                    entry.restaurant.state,
                    entry.restaurant.address,
                    entry.reportStatus,
                    entry.distinctReasons.join(' '),
                  ],
                ),
              )
              .toList(growable: false);

          return Column(
            children: [
              _AdminSearchField(
                controller: _searchController,
                label: 'Search restaurant reports',
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 12),
              if (entries.isEmpty)
                const _AdminEmptyStateCard(
                  icon: Icons.storefront_outlined,
                  title: 'No Restaurant Reports',
                  message:
                      'Reported restaurant issues will appear here when users flag data that needs review.',
                )
              else if (filteredEntries.isEmpty)
                const _AdminEmptyStateCard(
                  icon: Icons.search_off,
                  title: 'No Matching Restaurant Reports',
                  message: 'Try a different restaurant name, city, or reason search.',
                )
              else
                ...filteredEntries.map((entry) {
              final reasons = entry.distinctReasons;
              return BiteRaterTheme.liftedCard(
                margin: const EdgeInsets.only(top: 12),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        entry.restaurant.name,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        [
                          '${entry.restaurant.city}, ${entry.restaurant.state}',
                          'Reports: ${entry.reportCount}',
                          'Status: ${entry.reportStatus}',
                          if (reasons.isNotEmpty) 'Reasons: ${reasons.join(', ')}',
                        ].join('\n'),
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          OutlinedButton(
                            onPressed: () =>
                                _dismissReports(context, entry),
                            child: const Text('Dismiss'),
                          ),
                          OutlinedButton(
                            onPressed: () =>
                                _editRestaurant(context, entry.restaurant),
                            child: const Text('Edit Restaurant'),
                          ),
                          FilledButton.tonal(
                            onPressed: () =>
                                _deleteRestaurant(context, entry.restaurant),
                            child: const Text('Delete Restaurant'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
                }),
            ],
          );
        },
      ),
    );
  }
}

class _BiteScoreReportedDishesSection extends StatefulWidget {
  const _BiteScoreReportedDishesSection();

  @override
  State<_BiteScoreReportedDishesSection> createState() =>
      _BiteScoreReportedDishesSectionState();
}

class _BiteScoreReportedDishesSectionState
    extends State<_BiteScoreReportedDishesSection> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<void> _dismissReports(
    BuildContext context,
    BiteScoreReportedDishAdminEntry entry,
  ) async {
    try {
      await BiteScoreService.dismissReportedDishAsAdmin(entry);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, 'Dish report dismissed.');
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not dismiss this dish report right now.',
        ),
      );
    }
  }

  Future<void> _deleteDish(BuildContext context, BitescoreDish dish) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Delete Dish'),
          content: Text('Delete ${dish.name}?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Delete'),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !context.mounted) {
      return;
    }

    try {
      await BiteScoreService.deleteDishAsAdmin(dish.id);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, '${dish.name} deleted.');
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not delete the dish right now.',
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return _BiteScoreDataReportSection(
      title: 'Reported Dishes',
      child: StreamBuilder<List<BiteScoreReportedDishAdminEntry>>(
        stream: BiteScoreService.reportedDishesAdminStream(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
            return Text(AppErrorText.load('reported dishes'));
          }

          final entries =
              snapshot.data ?? const <BiteScoreReportedDishAdminEntry>[];
          final filteredEntries = entries
              .where(
                (entry) => _matchesAdminQuery(
                  _searchController.text,
                  [
                    entry.dish.name,
                    entry.dish.restaurantName,
                    entry.restaurant?.name,
                    entry.reportStatus,
                    entry.distinctReasons.join(' '),
                  ],
                ),
              )
              .toList(growable: false);

          return Column(
            children: [
              _AdminSearchField(
                controller: _searchController,
                label: 'Search dish reports',
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 12),
              if (entries.isEmpty)
                const _AdminEmptyStateCard(
                  icon: Icons.restaurant_menu_outlined,
                  title: 'No Dish Reports',
                  message:
                      'Reported dish issues will appear here when users flag incorrect or low-quality dish data.',
                )
              else if (filteredEntries.isEmpty)
                const _AdminEmptyStateCard(
                  icon: Icons.search_off,
                  title: 'No Matching Dish Reports',
                  message: 'Try a different dish, restaurant, or reason search.',
                )
              else
                ...filteredEntries.map((entry) {
              final reasons = entry.distinctReasons;
              final restaurantName =
                  entry.restaurant?.name ?? entry.dish.restaurantName;
              return BiteRaterTheme.liftedCard(
                margin: const EdgeInsets.only(top: 12),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        entry.dish.name,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        [
                          'Restaurant: $restaurantName',
                          'Reports: ${entry.reportCount}',
                          'Status: ${entry.reportStatus}',
                          if (reasons.isNotEmpty) 'Reasons: ${reasons.join(', ')}',
                        ].join('\n'),
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          OutlinedButton(
                            onPressed: () =>
                                _dismissReports(context, entry),
                            child: const Text('Dismiss'),
                          ),
                          FilledButton.tonal(
                            onPressed: () => _deleteDish(context, entry.dish),
                            child: const Text('Delete Dish'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
                }),
            ],
          );
        },
      ),
    );
  }
}

class _BiteScoreDuplicateRestaurantsSection extends StatefulWidget {
  const _BiteScoreDuplicateRestaurantsSection();

  @override
  State<_BiteScoreDuplicateRestaurantsSection> createState() =>
      _BiteScoreDuplicateRestaurantsSectionState();
}

class _BiteScoreDuplicateRestaurantsSectionState
    extends State<_BiteScoreDuplicateRestaurantsSection> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<void> _resolveReports(
    BuildContext context,
    BiteScoreDuplicateRestaurantReportAdminEntry entry,
  ) async {
    try {
      await BiteScoreService.resolveDuplicateRestaurantReportAsAdmin(entry);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, 'Duplicate restaurant report resolved.');
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not resolve this duplicate report right now.',
        ),
      );
    }
  }

  Future<void> _editRestaurant(
    BuildContext context,
    BitescoreRestaurant restaurant,
  ) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) {
        return _BiteScoreRestaurantEditDialog(restaurant: restaurant);
      },
    );

    if (saved == true && context.mounted) {
      _showSnackBar(context, '${restaurant.name} updated.');
    }
  }

  Future<void> _mergeRestaurant(
    BuildContext context,
    BiteScoreDuplicateRestaurantReportAdminEntry entry,
  ) async {
    final survivingRestaurant = await showDialog<BitescoreRestaurant>(
      context: context,
      builder: (context) {
        return _BiteScoreRestaurantMergeDialog(
          duplicateRestaurant: entry.restaurant,
        );
      },
    );

    if (survivingRestaurant == null || !context.mounted) {
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Confirm Merge'),
          content: Text(
            'Merge ${entry.restaurant.name} into ${survivingRestaurant.name}?\n\n'
            'The selected surviving restaurant will keep its page, and the duplicate restaurant will be retired. Dishes, reviews, aggregates, claims, and related moderation data will be reassigned where supported.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Merge'),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !context.mounted) {
      return;
    }

    try {
      await BiteScoreService.mergeRestaurantsAsAdmin(
        duplicateRestaurant: entry.restaurant,
        survivingRestaurant: survivingRestaurant,
      );
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        '${entry.restaurant.name} merged into ${survivingRestaurant.name}.',
      );
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not merge these restaurants right now.',
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return _BiteScoreDataReportSection(
      title: 'Duplicate Restaurant Reports',
      child: StreamBuilder<List<BiteScoreDuplicateRestaurantReportAdminEntry>>(
        stream: BiteScoreService.duplicateRestaurantReportsAdminStream(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
            return Text(AppErrorText.load('duplicate restaurant reports'));
          }

          final entries =
              snapshot.data ??
                  const <BiteScoreDuplicateRestaurantReportAdminEntry>[];
          final filteredEntries = entries
              .where(
                (entry) => _matchesAdminQuery(
                  _searchController.text,
                  [
                    entry.restaurant.name,
                    entry.restaurant.city,
                    entry.restaurant.state,
                    entry.restaurant.address,
                    entry.reportStatus,
                    entry.distinctReasons.join(' '),
                  ],
                ),
              )
              .toList(growable: false);

          return Column(
            children: [
              _AdminSearchField(
                controller: _searchController,
                label: 'Search duplicate reports',
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 12),
              if (entries.isEmpty)
                const _AdminEmptyStateCard(
                  icon: Icons.merge_type,
                  title: 'No Duplicate Reports',
                  message:
                      'Duplicate restaurant reports will appear here when users flag possible duplicate listings.',
                )
              else if (filteredEntries.isEmpty)
                const _AdminEmptyStateCard(
                  icon: Icons.search_off,
                  title: 'No Matching Duplicate Reports',
                  message:
                      'Try a different restaurant name, market, or reason search.',
                )
              else
                ...filteredEntries.map((entry) {
              final reasons = entry.distinctReasons;
              return BiteRaterTheme.liftedCard(
                margin: const EdgeInsets.only(top: 12),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        entry.restaurant.name,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        [
                          '${entry.restaurant.address}, ${entry.restaurant.city}, ${entry.restaurant.state}',
                          'Reports: ${entry.reportCount}',
                          'Status: ${entry.reportStatus}',
                          if (reasons.isNotEmpty) 'Reasons: ${reasons.join(', ')}',
                        ].join('\n'),
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          OutlinedButton(
                            onPressed: () =>
                                _editRestaurant(context, entry.restaurant),
                            child: const Text('Edit Restaurant'),
                          ),
                          OutlinedButton(
                            onPressed: () => _mergeRestaurant(context, entry),
                            child: const Text('Merge Into...'),
                          ),
                          FilledButton.tonal(
                            onPressed: () => _resolveReports(context, entry),
                            child: const Text('Resolve'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
                }),
            ],
          );
        },
      ),
    );
  }
}

class _BiteScoreDataReportSection extends StatelessWidget {
  final String title;
  final Widget child;

  const _BiteScoreDataReportSection({
    required this.title,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: BiteRaterTheme.ocean.withOpacity(0.16),
        ),
        boxShadow: [
          BoxShadow(
            color: BiteRaterTheme.ocean.withOpacity(0.08),
            blurRadius: 14,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: BiteRaterTheme.ink,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          child,
        ],
      ),
    );
  }
}

class _BiteScoreRestaurantMergeDialog extends StatefulWidget {
  final BitescoreRestaurant duplicateRestaurant;

  const _BiteScoreRestaurantMergeDialog({
    required this.duplicateRestaurant,
  });

  @override
  State<_BiteScoreRestaurantMergeDialog> createState() =>
      _BiteScoreRestaurantMergeDialogState();
}

class _BiteScoreRestaurantMergeDialogState
    extends State<_BiteScoreRestaurantMergeDialog> {
  late final Future<List<BitescoreRestaurant>> _candidatesFuture;
  String? _selectedRestaurantId;

  @override
  void initState() {
    super.initState();
    _candidatesFuture = BiteScoreService.loadRestaurantMergeCandidates(
      duplicateRestaurant: widget.duplicateRestaurant,
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Merge Duplicate Restaurant'),
      content: SizedBox(
        width: 420,
        child: FutureBuilder<List<BitescoreRestaurant>>(
          future: _candidatesFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const SizedBox(
                height: 120,
                child: Center(child: CircularProgressIndicator()),
              );
            }

            if (snapshot.hasError) {
              return Text(AppErrorText.load('restaurant merge options'));
            }

            final candidates = snapshot.data ?? const <BitescoreRestaurant>[];
            if (candidates.isEmpty) {
              return const Text(
                'No other active BiteScore restaurants are available to merge into.',
              );
            }

            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Duplicate restaurant: ${widget.duplicateRestaurant.name}',
                ),
                const SizedBox(height: 6),
                Text(
                  '${widget.duplicateRestaurant.address}, ${widget.duplicateRestaurant.city}, ${widget.duplicateRestaurant.state}',
                  style: const TextStyle(color: Colors.black54),
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  value: _selectedRestaurantId,
                  decoration: const InputDecoration(
                    labelText: 'Surviving restaurant',
                    border: OutlineInputBorder(),
                  ),
                  items: candidates
                      .map(
                        (restaurant) => DropdownMenuItem<String>(
                          value: restaurant.id,
                          child: Text(
                            '${restaurant.name} • ${restaurant.city}, ${restaurant.state}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    setState(() {
                      _selectedRestaurantId = value;
                    });
                  },
                ),
              ],
            );
          },
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(null),
          child: const Text('Cancel'),
        ),
        FutureBuilder<List<BitescoreRestaurant>>(
          future: _candidatesFuture,
          builder: (context, snapshot) {
            final candidates = snapshot.data ?? const <BitescoreRestaurant>[];
            final selectedRestaurant = candidates.where(
              (restaurant) => restaurant.id == _selectedRestaurantId,
            );
            return FilledButton(
              onPressed: selectedRestaurant.isEmpty
                  ? null
                  : () => Navigator.of(context).pop(selectedRestaurant.first),
              child: const Text('Continue'),
            );
          },
        ),
      ],
    );
  }
}

class _BiteScoreClaimAdminList extends StatefulWidget {
  const _BiteScoreClaimAdminList();

  @override
  State<_BiteScoreClaimAdminList> createState() =>
      _BiteScoreClaimAdminListState();
}

class _BiteScoreClaimAdminListState extends State<_BiteScoreClaimAdminList> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<void> _approveClaim(
    BuildContext context,
    RestaurantClaimRequest request,
  ) async {
    try {
      await BiteScoreService.approveClaimAsAdmin(request);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, 'Claim approved.');
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not approve the claim right now.',
        ),
      );
    }
  }

  Future<void> _rejectClaim(
    BuildContext context,
    RestaurantClaimRequest request,
  ) async {
    try {
      await BiteScoreService.rejectClaimAsAdmin(request);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, 'Claim rejected.');
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not reject the claim right now.',
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<BiteScoreAdminClaimEntry>>(
      stream: BiteScoreService.claimRequestsAdminStream(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                AppErrorText.load('claim requests'),
                textAlign: TextAlign.center,
              ),
            ),
          );
        }

        final entries = snapshot.data ?? const <BiteScoreAdminClaimEntry>[];
        final pendingEntries = entries
            .where((entry) => entry.request.status == 'pending')
            .toList(growable: false);
        final filteredEntries = pendingEntries
            .where(
              (entry) => _matchesAdminQuery(
                _searchController.text,
                [
                  entry.request.restaurantName,
                  entry.request.claimantName,
                  entry.request.email,
                  entry.request.phone,
                  entry.request.requesterUserId,
                  entry.request.message,
                  entry.restaurant?.address,
                  entry.restaurant?.city,
                  entry.restaurant?.state,
                ],
              ),
            )
            .toList(growable: false);

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _AdminSearchField(
              controller: _searchController,
              label: 'Search claim requests',
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            if (pendingEntries.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.verified_user_outlined,
                title: 'No Pending Claims',
                message:
                    'Restaurant claim requests will appear here when owners ask to manage a BiteScore profile.',
              )
            else if (filteredEntries.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.search_off,
                title: 'No Matching Claims',
                message:
                    'Try a different restaurant name, claimant name, email, or user ID search.',
              )
            else
              ...filteredEntries.map((entry) {
            final request = entry.request;
            final restaurant = entry.restaurant;

            return BiteRaterTheme.liftedCard(
              margin: const EdgeInsets.only(bottom: 12),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      request.restaurantName,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text('Claimant: ${request.claimantName}'),
                    Text('Email: ${request.email}'),
                    Text('Phone: ${request.phone}'),
                    if ((request.requesterUserId ?? '').trim().isNotEmpty)
                      Text('User ID: ${request.requesterUserId!}'),
                    if (restaurant != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        '${restaurant.address}, ${restaurant.city}, ${restaurant.state} ${restaurant.zipCode}',
                        style: const TextStyle(color: Colors.black54),
                      ),
                    ],
                    if ((request.message ?? '').trim().isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text('Message: ${request.message!.trim()}'),
                    ],
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        ElevatedButton(
                          onPressed: () => _approveClaim(context, request),
                          child: const Text('Approve'),
                        ),
                        OutlinedButton(
                          onPressed: () => _rejectClaim(context, request),
                          child: const Text('Reject'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
              }),
          ],
        );
      },
    );
  }
}

class _BiteScoreDishSuggestionAdminList extends StatefulWidget {
  const _BiteScoreDishSuggestionAdminList();

  @override
  State<_BiteScoreDishSuggestionAdminList> createState() =>
      _BiteScoreDishSuggestionAdminListState();
}

class _BiteScoreDishSuggestionAdminListState
    extends State<_BiteScoreDishSuggestionAdminList> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  String _dateLabel(DateTime? value) {
    if (value == null) {
      return 'Date unavailable';
    }
    final month = value.month.toString().padLeft(2, '0');
    final day = value.day.toString().padLeft(2, '0');
    return '$month/$day/${value.year}';
  }

  String _autoApplyLabel(DishEditSuggestionAdminEntry entry) {
    final oldestCreatedAt = entry.oldestCreatedAt;
    if (oldestCreatedAt == null) {
      return 'Auto-approval date unavailable';
    }

    final dueAt = oldestCreatedAt.add(const Duration(days: 3));
    final prefix = entry.isMerge && entry.supporterCount < 2
        ? 'Needs 2 matching users before auto-approval'
        : 'Auto-approves after';
    return '$prefix ${_dateLabel(dueAt)}';
  }

  Future<void> _approveSuggestion(
    BuildContext context,
    DishEditSuggestionAdminEntry entry,
  ) async {
    try {
      await BiteScoreService.approveDishEditSuggestionAsAdmin(entry);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, 'Suggestion approved.');
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not approve the suggestion right now.',
        ),
      );
    }
  }

  Future<void> _rejectSuggestion(
    BuildContext context,
    DishEditSuggestionAdminEntry entry,
  ) async {
    try {
      await BiteScoreService.rejectDishEditSuggestionAsAdmin(entry);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, 'Suggestion rejected.');
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not reject the suggestion right now.',
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<DishEditSuggestionAdminEntry>>(
      stream: BiteScoreService.dishEditSuggestionsAdminStream(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                AppErrorText.load('dish edit suggestions'),
                textAlign: TextAlign.center,
              ),
            ),
          );
        }

        final entries = snapshot.data ?? const <DishEditSuggestionAdminEntry>[];
        final filteredEntries = entries
            .where(
              (entry) => _matchesAdminQuery(
                _searchController.text,
                [
                  entry.restaurantId,
                  entry.targetDish?.name,
                  entry.targetDish?.restaurantName,
                  entry.mergeTargetDish?.name,
                  entry.proposedName,
                  entry.type,
                  entry.invalidReason,
                ],
              ),
            )
            .toList(growable: false);

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _AdminSearchField(
              controller: _searchController,
              label: 'Search dish suggestions',
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            if (entries.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.edit_note_outlined,
                title: 'No Dish Suggestions',
                message:
                    'Rename and merge suggestions from users will appear here when there is something to review.',
              )
            else if (filteredEntries.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.search_off,
                title: 'No Matching Suggestions',
                message:
                    'Try a different dish name, restaurant ID, or proposed name search.',
              )
            else
              ...filteredEntries.map((entry) {
            final targetDishName = entry.targetDish?.name ?? 'Unknown dish';
            final subtitleLines = <String>[
              'Type: ${entry.isRename ? 'Rename' : 'Merge'}',
              'Restaurant ID: ${entry.restaurantId}',
              'Source dish: $targetDishName',
              if (entry.isRename && (entry.proposedName ?? '').trim().isNotEmpty)
                'Proposed name: ${entry.proposedName!.trim()}',
              if (entry.isMerge)
                'Merge into: ${entry.mergeTargetDish?.name ?? 'Unknown dish'}',
              'Supporters: ${entry.supporterCount}',
              'Status: ${entry.isInvalid ? 'Invalid' : 'Pending'}',
              'Created: ${_dateLabel(entry.oldestCreatedAt)}',
              _autoApplyLabel(entry),
              if (entry.isInvalid) 'Invalid reason: ${entry.invalidReason!}',
            ];

            return BiteRaterTheme.liftedCard(
              margin: const EdgeInsets.only(bottom: 12),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      entry.targetDish?.restaurantName ??
                          entry.mergeTargetDish?.restaurantName ??
                          'Dish Suggestion',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(subtitleLines.join('\n')),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        ElevatedButton(
                          onPressed: entry.isInvalid
                              ? null
                              : () => _approveSuggestion(context, entry),
                          child: const Text('Approve'),
                        ),
                        OutlinedButton(
                          onPressed: () => _rejectSuggestion(context, entry),
                          child: const Text('Reject'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
              }),
          ],
        );
      },
    );
  }
}

class _BiteScoreApprovedOwnershipAdminList extends StatefulWidget {
  const _BiteScoreApprovedOwnershipAdminList();

  @override
  State<_BiteScoreApprovedOwnershipAdminList> createState() =>
      _BiteScoreApprovedOwnershipAdminListState();
}

class _BiteScoreApprovedOwnershipAdminListState
    extends State<_BiteScoreApprovedOwnershipAdminList> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  String _approvalDateLabel(RestaurantClaimRequest? request) {
    final approvedAt = request?.updatedAt ?? request?.createdAt;
    if (approvedAt == null) {
      return 'Date unavailable';
    }

    final month = approvedAt.month.toString().padLeft(2, '0');
    final day = approvedAt.day.toString().padLeft(2, '0');
    return '$month/$day/${approvedAt.year}';
  }

  Future<void> _viewRestaurant(
    BuildContext context,
    BitescoreRestaurant restaurant,
  ) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => BiteScoreRestaurantDishesScreen(
          restaurant: restaurant,
          entries: const <BiteScoreHomeEntry>[],
        ),
      ),
    );
  }

  Future<void> _unclaimRestaurant(
    BuildContext context,
    BiteScoreApprovedOwnershipEntry entry,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Remove Owner'),
          content: Text(
            'Remove the approved owner from ${entry.restaurant.name}? '
            'The restaurant will become unclaimed.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Remove Owner'),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !context.mounted) {
      return;
    }

    try {
      await BiteScoreService.unclaimRestaurantAsAdmin(entry.restaurant);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, '${entry.restaurant.name} is now unclaimed.');
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not remove the owner right now.',
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<BiteScoreApprovedOwnershipEntry>>(
      stream: BiteScoreService.approvedOwnershipsAdminStream(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                AppErrorText.load('claimed restaurants'),
                textAlign: TextAlign.center,
              ),
            ),
          );
        }

        final entries =
            snapshot.data ?? const <BiteScoreApprovedOwnershipEntry>[];
        final filteredEntries = entries
            .where(
              (entry) => _matchesAdminQuery(
                _searchController.text,
                [
                  entry.restaurant.name,
                  entry.restaurant.city,
                  entry.restaurant.state,
                  entry.restaurant.ownerUserId,
                  entry.approvedClaim?.email,
                  entry.approvedClaim?.claimantName,
                ],
              ),
            )
            .toList(growable: false);

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _AdminSearchField(
              controller: _searchController,
              label: 'Search claimed restaurants',
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            if (entries.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.verified_outlined,
                title: 'No Claimed Restaurants',
                message:
                    'Approved BiteScore restaurant ownerships will appear here once claims are accepted.',
              )
            else if (filteredEntries.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.search_off,
                title: 'No Matching Claimed Restaurants',
                message:
                    'Try a different restaurant name, owner email, or owner user ID search.',
              )
            else
              ...filteredEntries.map((entry) {
            final restaurant = entry.restaurant;
            final request = entry.approvedClaim;
            final ownerUserId = restaurant.ownerUserId?.trim();
            final ownerEmail = request?.email.trim();
            final subtitleLines = <String>[
              if (ownerEmail != null && ownerEmail.isNotEmpty)
                'Owner email: $ownerEmail',
              if (ownerUserId != null && ownerUserId.isNotEmpty)
                'Owner user ID: $ownerUserId',
              'Approval status: Approved',
              'Approval date: ${_approvalDateLabel(request)}',
            ];

            return BiteRaterTheme.liftedCard(
              margin: const EdgeInsets.only(bottom: 12),
              child: ListTile(
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 10,
                ),
                title: Text(
                  restaurant.name,
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                subtitle: Text(subtitleLines.join('\n')),
                isThreeLine: true,
                trailing: Wrap(
                  spacing: 4,
                  children: [
                    IconButton(
                      tooltip: 'View restaurant',
                      icon: const Icon(Icons.open_in_new),
                      onPressed: () => _viewRestaurant(context, restaurant),
                    ),
                    IconButton(
                      tooltip: 'Remove owner',
                      icon: const Icon(Icons.person_remove_outlined),
                      onPressed: () => _unclaimRestaurant(context, entry),
                    ),
                  ],
                ),
              ),
            );
              }),
          ],
        );
      },
    );
  }
}

class _BiteScoreUsersAdminList extends StatefulWidget {
  const _BiteScoreUsersAdminList();

  @override
  State<_BiteScoreUsersAdminList> createState() =>
      _BiteScoreUsersAdminListState();
}

class _BiteScoreUsersAdminListState extends State<_BiteScoreUsersAdminList> {
  final TextEditingController _searchController = TextEditingController();
  late Future<List<BiteScoreAdminUserEntry>> _usersFuture;

  @override
  void initState() {
    super.initState();
    _usersFuture = BiteScoreService.loadUsersForAdmin();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _refreshUsers() {
    _usersFuture = BiteScoreService.loadUsersForAdmin();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<void> _showUserDetails(
    BuildContext context,
    BiteScoreAdminUserEntry user,
  ) async {
    await showDialog<void>(
      context: context,
      builder: (context) {
        final lines = <String>[
          'Email: ${user.email ?? 'No email available'}',
          'Name: ${user.displayName ?? 'No display name available'}',
          'UID: ${user.uid}',
          'Roles: ${user.roleLabel}',
          if (user.claimedRestaurantNames.isNotEmpty)
            'Claimed restaurants: ${user.claimedRestaurantNames.join(', ')}',
          'Email verified: ${user.isEmailVerified ? 'Yes' : 'No or unknown'}',
          'Coupon account status: ${user.restaurantAccountStatus}',
          if (user.activityTags.isNotEmpty)
            'Activity: ${user.activityTags.join(', ')}',
        ];

        return AlertDialog(
          title: Text(user.displayName ?? user.email ?? user.uid),
          content: SingleChildScrollView(
            child: Text(lines.join('\n')),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Close'),
            ),
          ],
        );
      },
    );
  }

  Future<void> _deleteUserRecords(
    BuildContext context,
    BiteScoreAdminUserEntry user,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Delete User Account Records'),
          content: Text(
            'Delete admin-visible owner records for '
            '${user.email ?? user.displayName ?? user.uid}? '
            'This removes coupon owner account data and unclaims BiteScore restaurants '
            'owned by this user, but it does not delete the Firebase Auth login itself.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Delete Records'),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !context.mounted) {
      return;
    }

    try {
      await BiteScoreService.deleteUserAccountRecordsAsAdmin(user);
      if (!context.mounted) {
        return;
      }
      _showSnackBar(context, 'User account records deleted.');
      setState(_refreshUsers);
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not delete this user\'s account records right now.',
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<BiteScoreAdminUserEntry>>(
      future: _usersFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    AppErrorText.load('admin users'),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: () => setState(_refreshUsers),
                    child: const Text('Try Again'),
                  ),
                ],
              ),
            ),
          );
        }

        final users = snapshot.data ?? const <BiteScoreAdminUserEntry>[];
        final filteredUsers = users
            .where(
              (user) => _matchesAdminQuery(
                _searchController.text,
                [
                  user.uid,
                  user.email,
                  user.displayName,
                  user.roleLabel,
                  user.claimedRestaurantNames.join(' '),
                  user.restaurantAccountStatus,
                  user.activityTags.join(' '),
                ],
              ),
            )
            .toList(growable: false);

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Expanded(
                  child: _AdminSearchField(
                    controller: _searchController,
                    label: 'Search users',
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  tooltip: 'Refresh users',
                  onPressed: () => setState(_refreshUsers),
                  icon: const Icon(Icons.refresh),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (users.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.people_alt_outlined,
                title: 'No User Records Yet',
                message:
                    'Users will appear here once the app can see them through account, claim, review, report, or suggestion records.',
              )
            else if (filteredUsers.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.search_off,
                title: 'No Matching Users',
                message:
                    'Try a different email, display name, role, or user ID search.',
              )
            else
              ...filteredUsers.map((user) {
                final subtitleLines = <String>[
                  'Email: ${user.email ?? 'No email available'}',
                  'Name: ${user.displayName ?? 'No display name available'}',
                  'UID: ${user.uid}',
                  'Role: ${user.roleLabel}',
                  if (user.claimedRestaurantNames.isNotEmpty)
                    'Claimed restaurant: ${user.claimedRestaurantNames.join(', ')}',
                  if (user.hasRestaurantAccount)
                    'Coupon account status: ${user.restaurantAccountStatus}',
                ];

                return BiteRaterTheme.liftedCard(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 10,
                    ),
                    title: Text(
                      user.displayName ?? user.email ?? user.uid,
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    subtitle: Text(subtitleLines.join('\n')),
                    isThreeLine: true,
                    trailing: Wrap(
                      spacing: 4,
                      children: [
                        IconButton(
                          tooltip: 'View user details',
                          onPressed: () => _showUserDetails(context, user),
                          icon: const Icon(Icons.info_outline),
                        ),
                        IconButton(
                          tooltip: 'Delete account records',
                          onPressed: user.isAdmin
                              ? null
                              : () => _deleteUserRecords(context, user),
                          icon: const Icon(Icons.delete_outline),
                        ),
                      ],
                    ),
                  ),
                );
              }),
          ],
        );
      },
    );
  }
}

class _AdminTextField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final String? hint;
  final int maxLines;

  const _AdminTextField({
    required this.controller,
    required this.label,
    this.hint,
    this.maxLines = 1,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      maxLines: maxLines,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
        ),
      ),
    );
  }
}

class _BiteScoreRestaurantEditDialog extends StatefulWidget {
  final BitescoreRestaurant restaurant;

  const _BiteScoreRestaurantEditDialog({
    required this.restaurant,
  });

  @override
  State<_BiteScoreRestaurantEditDialog> createState() =>
      _BiteScoreRestaurantEditDialogState();
}

class _BiteScoreRestaurantEditDialogState
    extends State<_BiteScoreRestaurantEditDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _addressController;
  late final TextEditingController _cityController;
  late final TextEditingController _stateController;
  late final TextEditingController _zipController;
  late final TextEditingController _phoneController;
  late final TextEditingController _bioController;
  late final TextEditingController _cuisineController;
  late bool _isActive;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.restaurant.name);
    _addressController = TextEditingController(text: widget.restaurant.address);
    _cityController = TextEditingController(text: widget.restaurant.city);
    _stateController = TextEditingController(text: widget.restaurant.state);
    _zipController = TextEditingController(text: widget.restaurant.zipCode);
    _phoneController =
        TextEditingController(text: widget.restaurant.phone ?? '');
    _bioController = TextEditingController(text: widget.restaurant.bio ?? '');
    _cuisineController = TextEditingController(
      text: widget.restaurant.cuisineTags.join(', '),
    );
    _isActive = widget.restaurant.isActive;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _addressController.dispose();
    _cityController.dispose();
    _stateController.dispose();
    _zipController.dispose();
    _phoneController.dispose();
    _bioController.dispose();
    _cuisineController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _isSaving = true;
    });

    try {
      await BiteScoreService.updateRestaurantAsAdmin(
        restaurant: widget.restaurant,
        name: _nameController.text,
        address: _addressController.text,
        city: _cityController.text,
        state: _stateController.text,
        zipCode: _zipController.text,
        phone: _phoneController.text,
        bio: _bioController.text,
        cuisineTags: _cuisineController.text,
        isActive: _isActive,
      );
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not update the restaurant right now.',
            ),
          ),
        ),
      );
      setState(() {
        _isSaving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit Restaurant'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _AdminTextField(
                controller: _nameController,
                label: 'Restaurant name',
              ),
              const SizedBox(height: 12),
              _AdminTextField(
                controller: _addressController,
                label: 'Street address',
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _AdminTextField(
                      controller: _cityController,
                      label: 'City',
                    ),
                  ),
                  const SizedBox(width: 12),
                  SizedBox(
                    width: 90,
                    child: _AdminTextField(
                      controller: _stateController,
                      label: 'State',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _AdminTextField(
                      controller: _zipController,
                      label: 'ZIP code',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _AdminTextField(
                      controller: _phoneController,
                      label: 'Phone',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _AdminTextField(
                controller: _cuisineController,
                label: 'Cuisine tags',
                hint: 'Comma-separated',
              ),
              const SizedBox(height: 12),
              _AdminTextField(
                controller: _bioController,
                label: 'Bio / Hours / Notes',
                maxLines: 4,
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _isActive,
                title: const Text('Visible in BiteScore'),
                onChanged: (value) {
                  setState(() {
                    _isActive = value;
                  });
                },
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _isSaving ? null : _save,
          child: Text(_isSaving ? 'Saving...' : 'Save'),
        ),
      ],
    );
  }
}

class _BiteScoreDishEditDialog extends StatefulWidget {
  final BitescoreDish dish;

  const _BiteScoreDishEditDialog({
    required this.dish,
  });

  @override
  State<_BiteScoreDishEditDialog> createState() =>
      _BiteScoreDishEditDialogState();
}

class _BiteScoreDishEditDialogState extends State<_BiteScoreDishEditDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _categoryController;
  late final TextEditingController _priceController;
  late bool _isActive;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.dish.name);
    _categoryController =
        TextEditingController(text: widget.dish.category ?? '');
    _priceController = TextEditingController(text: widget.dish.priceLabel ?? '');
    _isActive = widget.dish.isActive;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _categoryController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _isSaving = true;
    });

    try {
      await BiteScoreService.updateDishAsAdmin(
        dish: widget.dish,
        name: _nameController.text,
        category: _categoryController.text,
        priceLabel: _priceController.text,
        isActive: _isActive,
      );
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not update the dish right now.',
            ),
          ),
        ),
      );
      setState(() {
        _isSaving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit Dish'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _AdminTextField(
                controller: _nameController,
                label: 'Dish name',
              ),
              const SizedBox(height: 12),
              _AdminTextField(
                controller: _categoryController,
                label: 'Category',
              ),
              const SizedBox(height: 12),
              _AdminTextField(
                controller: _priceController,
                label: 'Price label',
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _isActive,
                title: const Text('Dish available'),
                subtitle: const Text(
                  'Unavailable dishes stay in admin but drop out of user-facing lists.',
                ),
                onChanged: (value) {
                  setState(() {
                    _isActive = value;
                  });
                },
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _isSaving ? null : _save,
          child: Text(_isSaving ? 'Saving...' : 'Save'),
        ),
      ],
    );
  }
}
