import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/admin_restaurant_link_record.dart';
import '../models/bitescore_dish.dart';
import '../models/bitescore_restaurant.dart';
import '../models/contribution_point_ledger_entry.dart';
import '../models/dish_review.dart';
import '../models/restaurant_claim_request.dart';
import '../services/app_error_text.dart';
import '../services/admin_link_generation_service.dart';
import '../services/bitescore_service.dart';
import '../services/contribution_points_service.dart';
import '../services/restaurant_invite_service.dart';
import '../utils/phone_number_formatter.dart';
import '../widgets/bitescore_category_picker.dart';
import '../widgets/biterater_theme.dart';
import '../widgets/clickable_phone_text.dart';
import '../widgets/restaurant_invite_admin_panel.dart';
import 'bitescore_restaurant_dishes_screen.dart';
import 'expert_badge_gallery_screen.dart';

typedef AdminBiteScoreRestaurantSearchCallback =
    Future<AdminRestaurantLinkSearchResult> Function({
      required String locationQuery,
      required int radiusMiles,
      required String? restaurantName,
      required Set<AdminRestaurantLinkSource> sources,
      required AdminBiteScoreStatus biteScoreStatus,
    });
typedef AdminBiteScoreRestaurantLoader =
    Future<BitescoreRestaurant?> Function(String documentId);
typedef AdminBiteScoreRestaurantDeleteAction =
    Future<void> Function(String documentId);
typedef AdminBiteScoreInviteAction =
    Future<RestaurantInviteCreationResult> Function({
      required String restaurantId,
    });
typedef AdminBiteScoreDishLoader =
    Future<List<BitescoreDish>> Function(String restaurantId);

class BiteScoreAdminScreen extends StatefulWidget {
  final AdminBiteScoreRestaurantSearchCallback? searchRestaurants;
  final AdminBiteScoreRestaurantLoader? loadRestaurant;
  final AdminBiteScoreRestaurantDeleteAction? deleteRestaurant;
  final AdminBiteScoreInviteAction? createClaimInvite;
  final AdminBiteScoreDishLoader? loadRestaurantDishes;

  const BiteScoreAdminScreen({
    super.key,
    @visibleForTesting this.searchRestaurants,
    @visibleForTesting this.loadRestaurant,
    @visibleForTesting this.deleteRestaurant,
    @visibleForTesting this.createClaimInvite,
    @visibleForTesting this.loadRestaurantDishes,
  });

  @override
  State<BiteScoreAdminScreen> createState() => _BiteScoreAdminScreenState();
}

class _BiteScoreAdminScreenState extends State<BiteScoreAdminScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  AdminRestaurantLinkRecord? _selectedDishRestaurant;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: kDebugMode ? 11 : 10, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  void _openRestaurantDishes(AdminRestaurantLinkRecord restaurant) {
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
          side: BorderSide(color: BiteRaterTheme.grape.withValues(alpha: 0.14)),
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
              borderColor: BiteRaterTheme.grape.withValues(alpha: 0.16),
              child: TabBar(
                controller: _tabController,
                isScrollable: true,
                labelColor: BiteRaterTheme.grape,
                unselectedLabelColor: BiteRaterTheme.mutedInk,
                indicatorColor: BiteRaterTheme.coral,
                tabs: [
                  const Tab(text: 'Restaurants'),
                  const Tab(text: 'Dishes'),
                  const Tab(text: 'Reviews'),
                  const Tab(text: 'Reported Reviews'),
                  const Tab(text: 'Data Reports'),
                  const Tab(text: 'Claims'),
                  const Tab(text: 'Dish Suggestions'),
                  const Tab(text: 'Claimed Restaurants'),
                  const Tab(text: 'Users'),
                  const Tab(text: 'User Points'),
                  if (kDebugMode) const Tab(text: 'Expert Badges'),
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
                  searchRestaurants: widget.searchRestaurants,
                  loadRestaurant: widget.loadRestaurant,
                  deleteRestaurant: widget.deleteRestaurant,
                  createClaimInvite: widget.createClaimInvite,
                ),
                _BiteScoreDishAdminList(
                  selectedRestaurant: _selectedDishRestaurant,
                  loadDishes: widget.loadRestaurantDishes,
                ),
                const _BiteScoreReviewAdminList(),
                const _BiteScoreReportedReviewAdminList(),
                const _BiteScoreDataReportsAdminList(),
                const _BiteScoreClaimAdminList(),
                const _BiteScoreDishSuggestionAdminList(),
                const _BiteScoreApprovedOwnershipAdminList(),
                const _BiteScoreUsersAdminList(),
                const _BiteScoreUserPointsAdminList(),
                if (kDebugMode)
                  const ExpertBadgeGalleryScreen(showPreviewControls: true),
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
        prefixIcon: const Icon(Icons.search, color: BiteRaterTheme.grape),
        suffixIcon: IconButton(
          tooltip: 'Search',
          onPressed: _submitSearch,
          icon: const Icon(Icons.arrow_forward, color: BiteRaterTheme.coral),
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
          borderSide: const BorderSide(color: BiteRaterTheme.grape, width: 1.4),
        ),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
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
            borderColor: BiteRaterTheme.grape.withValues(alpha: 0.16),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 44, color: BiteRaterTheme.grape),
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
  final ValueChanged<AdminRestaurantLinkRecord> onManageDishes;
  final AdminBiteScoreRestaurantSearchCallback? searchRestaurants;
  final AdminBiteScoreRestaurantLoader? loadRestaurant;
  final AdminBiteScoreRestaurantDeleteAction? deleteRestaurant;
  final AdminBiteScoreInviteAction? createClaimInvite;

  const _BiteScoreRestaurantAdminList({
    required this.onManageDishes,
    this.searchRestaurants,
    this.loadRestaurant,
    this.deleteRestaurant,
    this.createClaimInvite,
  });

  @override
  State<_BiteScoreRestaurantAdminList> createState() =>
      _BiteScoreRestaurantAdminListState();
}

class _BiteScoreRestaurantAdminListState
    extends State<_BiteScoreRestaurantAdminList> {
  static const int _resultPageSize = 25;
  static const String _truncatedResultsMessage =
      'Results were limited. Narrow the radius or add a restaurant name to '
      'refine the search.';

  final GlobalKey<FormState> _searchFormKey = GlobalKey<FormState>();
  final TextEditingController _locationController = TextEditingController();
  final TextEditingController _restaurantNameController =
      TextEditingController();
  final AdminLinkGenerationService _searchService =
      AdminLinkGenerationService();
  final Set<String> _busyActions = <String>{};

  int _radiusMiles = AdminLinkGenerationService.defaultRadiusMiles;
  AdminBiteScoreStatus _status = AdminBiteScoreStatus.all;
  int _visibleResultCount = _resultPageSize;
  bool _isSearching = false;
  bool _hasSubmittedSearch = false;
  AdminRestaurantLinkSearchResult? _searchResult;
  String? _searchError;
  String? _selectedRestaurantLoadingId;
  String? _selectedRestaurantLoadError;

  @override
  void dispose() {
    _locationController.dispose();
    _restaurantNameController.dispose();
    super.dispose();
  }

  String? get _normalizedOptionalRestaurantName {
    final value = _restaurantNameController.text.trim();
    return value.isEmpty ? null : value;
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
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
    AdminRestaurantLinkRecord restaurant,
  ) async {
    final actionKey = 'delete:${restaurant.documentId}';
    if (_busyActions.contains(actionKey)) {
      return;
    }
    final confirmed = await _confirmDelete(
      context,
      title: 'Delete Restaurant',
      message:
          'Delete ${restaurant.restaurantName} and its related dishes and reviews?',
    );
    if (!confirmed || !context.mounted) {
      return;
    }

    setState(() {
      _busyActions.add(actionKey);
    });
    try {
      final delete = widget.deleteRestaurant;
      if (delete != null) {
        await delete(restaurant.documentId);
      } else {
        await BiteScoreService.deleteRestaurantAsAdmin(restaurant.documentId);
      }
      if (!context.mounted) {
        return;
      }
      final result = _searchResult;
      if (result != null) {
        final remaining = result.results
            .where((record) => record.documentId != restaurant.documentId)
            .toList(growable: false);
        setState(() {
          _searchResult = AdminRestaurantLinkSearchResult(
            searchCenter: result.searchCenter,
            radiusMiles: result.radiusMiles,
            results: remaining,
            resultsMayBeTruncated: result.resultsMayBeTruncated,
            returnedCount: remaining.length,
            queriedSources: result.queriedSources,
          );
        });
      }
      _showSnackBar(context, '${restaurant.restaurantName} deleted.');
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
    } finally {
      if (mounted) {
        setState(() {
          _busyActions.remove(actionKey);
        });
      }
    }
  }

  Future<void> _editRestaurant(AdminRestaurantLinkRecord record) async {
    if (_selectedRestaurantLoadingId != null) {
      return;
    }
    setState(() {
      _selectedRestaurantLoadingId = record.documentId;
      _selectedRestaurantLoadError = null;
    });

    try {
      final load = widget.loadRestaurant;
      final restaurant = load != null
          ? await load(record.documentId)
          : await BiteScoreService.loadRestaurantById(record.documentId);
      if (!mounted) {
        return;
      }
      if (restaurant == null || restaurant.id != record.documentId) {
        setState(() {
          _selectedRestaurantLoadError =
              'This restaurant could not be loaded. It may no longer exist.';
        });
        return;
      }
      setState(() {
        _selectedRestaurantLoadingId = null;
      });

      final saved = await showDialog<bool>(
        context: context,
        builder: (context) {
          return _BiteScoreRestaurantEditDialog(restaurant: restaurant);
        },
      );

      if (saved == true && mounted) {
        _showSnackBar(context, '${restaurant.name} updated.');
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _selectedRestaurantLoadError =
              'Could not load this restaurant right now. Please try again.';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _selectedRestaurantLoadingId = null;
        });
      }
    }
  }

  Future<void> _showGeneratedInviteLink(
    BuildContext context,
    RestaurantInviteCreationResult result,
  ) async {
    await showDialog<void>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('BiteScore Claim Invite Created'),
          content: SizedBox(
            width: 460,
            child: SelectableText(result.inviteUrl),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Close'),
            ),
            FilledButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: result.inviteUrl));
                if (!context.mounted) {
                  return;
                }
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Invite link copied.')),
                );
              },
              icon: const Icon(Icons.copy),
              label: const Text('Copy Link'),
            ),
          ],
        );
      },
    );
  }

  Future<void> _createClaimInvite(
    BuildContext context,
    AdminRestaurantLinkRecord restaurant,
  ) async {
    if (restaurant.isClaimed == true) {
      _showSnackBar(context, 'This restaurant is already claimed.');
      return;
    }
    final actionKey = 'invite:${restaurant.documentId}';
    if (_busyActions.contains(actionKey)) {
      return;
    }
    setState(() {
      _busyActions.add(actionKey);
    });
    try {
      final createInvite = widget.createClaimInvite;
      final result = createInvite != null
          ? await createInvite(restaurantId: restaurant.documentId)
          : await RestaurantInviteService.createBiteScoreClaimInvite(
              restaurantId: restaurant.documentId,
            );
      if (!context.mounted) {
        return;
      }
      await _showGeneratedInviteLink(context, result);
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      _showSnackBar(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not create the BiteScore claim invite right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _busyActions.remove(actionKey);
        });
      }
    }
  }

  Future<void> _showClaimInviteManager(BuildContext context) async {
    await showDialog<void>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('BiteScore Claim Invites'),
          content: const SizedBox(
            width: 560,
            height: 520,
            child: RestaurantInviteAdminPanel(side: 'bitescore'),
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

  Future<void> _submitSearch() async {
    if (_isSearching) {
      return;
    }
    final valid = _searchFormKey.currentState?.validate() ?? false;
    if (!valid) {
      setState(() {
        _hasSubmittedSearch = true;
      });
      return;
    }

    FocusScope.of(context).unfocus();
    setState(() {
      _hasSubmittedSearch = true;
      _isSearching = true;
      _searchResult = null;
      _searchError = null;
      _selectedRestaurantLoadError = null;
      _visibleResultCount = _resultPageSize;
    });

    try {
      final search = widget.searchRestaurants;
      final result = search != null
          ? await search(
              locationQuery: _locationController.text,
              radiusMiles: _radiusMiles,
              restaurantName: _normalizedOptionalRestaurantName,
              sources: const <AdminRestaurantLinkSource>{
                AdminRestaurantLinkSource.biteScore,
              },
              biteScoreStatus: _status,
            )
          : await _searchService.search(
              locationQuery: _locationController.text,
              radiusMiles: _radiusMiles,
              restaurantName: _normalizedOptionalRestaurantName,
              sources: const <AdminRestaurantLinkSource>{
                AdminRestaurantLinkSource.biteScore,
              },
              biteScoreStatus: _status,
            );
      if (!mounted) {
        return;
      }

      final biteScoreResults = result.results
          .where((record) => record.isBiteScore)
          .toList(growable: false);
      setState(() {
        _searchResult = AdminRestaurantLinkSearchResult(
          searchCenter: result.searchCenter,
          radiusMiles: result.radiusMiles,
          results: biteScoreResults,
          resultsMayBeTruncated: result.resultsMayBeTruncated,
          returnedCount: biteScoreResults.length,
          queriedSources: const <AdminRestaurantLinkSource>[
            AdminRestaurantLinkSource.biteScore,
          ],
        );
      });
    } on AdminLinkGenerationException catch (error) {
      if (mounted) {
        setState(() {
          _searchError = error.message;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _searchError =
              'Could not search BiteScore restaurants right now. Please try again.';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSearching = false;
        });
      }
    }
  }

  Widget _buildRestaurantSearchControls() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _searchFormKey,
          child: LayoutBuilder(
            builder: (context, constraints) {
              final isNarrow = constraints.maxWidth < 680;
              final fieldWidth = isNarrow
                  ? constraints.maxWidth
                  : (constraints.maxWidth - 12) / 2;
              final selectorWidth = isNarrow
                  ? constraints.maxWidth
                  : (constraints.maxWidth - 12) / 2;

              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      SizedBox(
                        width: fieldWidth,
                        child: TextFormField(
                          key: const ValueKey('rating-admin-location-field'),
                          controller: _locationController,
                          enabled: !_isSearching,
                          textInputAction: TextInputAction.search,
                          onFieldSubmitted: (_) => _submitSearch(),
                          validator: (value) =>
                              AdminLinkGenerationService.locationValidationError(
                                value ?? '',
                              ),
                          decoration: const InputDecoration(
                            labelText: 'Location',
                            hintText: 'ZIP code or City, ST',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                      SizedBox(
                        width: fieldWidth,
                        child: TextFormField(
                          key: const ValueKey(
                            'rating-admin-restaurant-name-field',
                          ),
                          controller: _restaurantNameController,
                          enabled: !_isSearching,
                          textInputAction: TextInputAction.search,
                          onFieldSubmitted: (_) => _submitSearch(),
                          validator: (value) {
                            if ((value ?? '').trim().length > 100) {
                              return 'Restaurant name must be no more than 100 characters.';
                            }
                            return null;
                          },
                          decoration: const InputDecoration(
                            labelText: 'Restaurant name',
                            hintText: 'Optional',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                      SizedBox(
                        width: selectorWidth,
                        child: DropdownButtonFormField<int>(
                          key: const ValueKey('rating-admin-radius-field'),
                          initialValue: _radiusMiles,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            labelText: 'Radius',
                            border: OutlineInputBorder(),
                          ),
                          items: AdminLinkGenerationService.radiusOptionsMiles
                              .map(
                                (radius) => DropdownMenuItem<int>(
                                  value: radius,
                                  child: Text(
                                    '$radius ${radius == 1 ? 'mile' : 'miles'}',
                                  ),
                                ),
                              )
                              .toList(growable: false),
                          onChanged: _isSearching
                              ? null
                              : (value) {
                                  if (value != null) {
                                    setState(() {
                                      _radiusMiles = value;
                                    });
                                  }
                                },
                        ),
                      ),
                      SizedBox(
                        width: selectorWidth,
                        child: DropdownButtonFormField<AdminBiteScoreStatus>(
                          key: const ValueKey('rating-admin-status-field'),
                          initialValue: _status,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            labelText: 'Status',
                            border: OutlineInputBorder(),
                          ),
                          items:
                              const <AdminBiteScoreStatus>[
                                    AdminBiteScoreStatus.all,
                                    AdminBiteScoreStatus.active,
                                    AdminBiteScoreStatus.inactive,
                                  ]
                                  .map(
                                    (status) => DropdownMenuItem(
                                      value: status,
                                      child: Text(status.label),
                                    ),
                                  )
                                  .toList(growable: false),
                          onChanged: _isSearching
                              ? null
                              : (value) {
                                  if (value != null) {
                                    setState(() {
                                      _status = value;
                                    });
                                  }
                                },
                        ),
                      ),
                      FilledButton.icon(
                        key: const ValueKey('rating-admin-search-button'),
                        onPressed: _isSearching ? null : _submitSearch,
                        icon: _isSearching
                            ? const SizedBox.square(
                                dimension: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.search),
                        label: Text(_isSearching ? 'Searching...' : 'Search'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'Only BiteScore restaurants with valid location data appear in geographic search.',
                    style: TextStyle(color: BiteRaterTheme.mutedInk),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            return Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 12,
              runSpacing: 8,
              children: [
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxWidth: constraints.maxWidth < 640
                        ? constraints.maxWidth
                        : 420,
                  ),
                  child: const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Find Restaurants',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      SizedBox(height: 4),
                      Text(
                        'Enter a ZIP code or City, ST to find Rating-side BiteScore restaurants.',
                      ),
                    ],
                  ),
                ),
                OutlinedButton.icon(
                  onPressed: () => _showClaimInviteManager(context),
                  icon: const Icon(Icons.manage_search),
                  label: const Text('Manage Claim Invites'),
                ),
              ],
            );
          },
        ),
        const SizedBox(height: 12),
        _buildRestaurantSearchControls(),
        const SizedBox(height: 12),
        _buildSearchState(),
      ],
    );
  }

  Widget _buildSearchState() {
    if (!_hasSubmittedSearch) {
      return const _AdminEmptyStateCard(
        icon: Icons.storefront_outlined,
        title: 'Find Restaurants',
        message:
            'Enter a ZIP code or City, ST to search. Valid location data is required.',
      );
    }
    if (_isSearching) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(20),
          child: Center(child: CircularProgressIndicator()),
        ),
      );
    }
    if (_searchError != null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(_searchError!, style: const TextStyle(color: Colors.red)),
        ),
      );
    }

    final result = _searchResult;
    if (result == null) {
      return const SizedBox.shrink();
    }
    if (result.results.isEmpty) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (result.resultsMayBeTruncated) _buildTruncationNotice(),
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                'No matching BiteScore restaurants were found within this search area.',
              ),
            ),
          ),
        ],
      );
    }

    final visibleResults = result.results
        .take(_visibleResultCount)
        .toList(growable: false);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (result.resultsMayBeTruncated) _buildTruncationNotice(),
        if (_selectedRestaurantLoadingId != null)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Row(
                children: [
                  SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  SizedBox(width: 12),
                  Expanded(child: Text('Loading selected restaurant...')),
                ],
              ),
            ),
          ),
        if (_selectedRestaurantLoadError != null)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                _selectedRestaurantLoadError!,
                style: const TextStyle(color: Colors.red),
              ),
            ),
          ),
        Text(
          'Showing ${visibleResults.length} of ${result.results.length} returned restaurants.',
          style: const TextStyle(color: BiteRaterTheme.mutedInk),
        ),
        const SizedBox(height: 10),
        ...visibleResults.map(_buildSearchResultCard),
        if (visibleResults.length < result.results.length)
          Align(
            alignment: Alignment.center,
            child: OutlinedButton.icon(
              key: const ValueKey('rating-admin-show-more-button'),
              onPressed: () {
                setState(() {
                  _visibleResultCount += _resultPageSize;
                });
              },
              icon: const Icon(Icons.expand_more),
              label: const Text('Show 25 More'),
            ),
          ),
      ],
    );
  }

  Widget _buildTruncationNotice() {
    return Card(
      color: Colors.amber.shade50,
      child: const Padding(
        padding: EdgeInsets.all(16),
        child: Text(_truncatedResultsMessage),
      ),
    );
  }

  Widget _buildSearchResultCard(AdminRestaurantLinkRecord restaurant) {
    final cityLine = [
      restaurant.city,
      restaurant.state,
      restaurant.zipCode,
    ].where((part) => part.trim().isNotEmpty).join(', ');
    final inviteBusy = _busyActions.contains('invite:${restaurant.documentId}');
    final deleteBusy = _busyActions.contains('delete:${restaurant.documentId}');
    final editBusy = _selectedRestaurantLoadingId == restaurant.documentId;

    return KeyedSubtree(
      key: ValueKey('rating-admin-result-${restaurant.documentId}'),
      child: BiteRaterTheme.liftedCard(
        margin: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                restaurant.restaurantName,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  const Chip(label: Text('BiteScore')),
                  Chip(
                    label: Text(
                      restaurant.isActive == true ? 'Active' : 'Hidden',
                    ),
                  ),
                  Chip(
                    label: Text(
                      restaurant.isClaimed == true ? 'Claimed' : 'Unclaimed',
                    ),
                  ),
                  Chip(
                    label: Text(
                      '${restaurant.distanceMiles.toStringAsFixed(1)} miles',
                    ),
                  ),
                ],
              ),
              if (restaurant.streetAddress.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(restaurant.streetAddress),
              ],
              if (cityLine.isNotEmpty) Text(cityLine),
              if (restaurant.phone.isNotEmpty) ...[
                const SizedBox(height: 4),
                ClickablePhoneText(phone: restaurant.phone, prefix: 'Phone: '),
              ],
              if (restaurant.website.isNotEmpty)
                Text('Website: ${restaurant.website}'),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  OutlinedButton.icon(
                    onPressed: restaurant.isClaimed == true || inviteBusy
                        ? null
                        : () => _createClaimInvite(context, restaurant),
                    icon: const Icon(Icons.add_link),
                    label: Text(
                      restaurant.isClaimed == true
                          ? 'Already Claimed'
                          : 'Create Claim Invite',
                    ),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => widget.onManageDishes(restaurant),
                    icon: const Icon(Icons.restaurant_menu_outlined),
                    label: const Text('Manage Dishes'),
                  ),
                  OutlinedButton.icon(
                    onPressed: editBusy
                        ? null
                        : () => _editRestaurant(restaurant),
                    icon: const Icon(Icons.edit_outlined),
                    label: const Text('Edit'),
                  ),
                  OutlinedButton.icon(
                    onPressed: deleteBusy
                        ? null
                        : () => _deleteRestaurant(context, restaurant),
                    icon: const Icon(Icons.delete_outline),
                    label: const Text('Delete'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BiteScoreDishAdminList extends StatefulWidget {
  final AdminRestaurantLinkRecord? selectedRestaurant;
  final AdminBiteScoreDishLoader? loadDishes;

  const _BiteScoreDishAdminList({
    required this.selectedRestaurant,
    this.loadDishes,
  });

  @override
  State<_BiteScoreDishAdminList> createState() =>
      _BiteScoreDishAdminListState();
}

class _BiteScoreDishAdminListState extends State<_BiteScoreDishAdminList> {
  final TextEditingController _searchController = TextEditingController();
  Future<List<BitescoreDish>>? _dishesFuture;

  @override
  void initState() {
    super.initState();
    _refreshDishes();
  }

  @override
  void didUpdateWidget(covariant _BiteScoreDishAdminList oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selectedRestaurant?.documentId !=
        widget.selectedRestaurant?.documentId) {
      _searchController.clear();
      _refreshDishes();
    }
  }

  void _refreshDishes() {
    final restaurant = widget.selectedRestaurant;
    if (restaurant == null) {
      _dishesFuture = null;
      return;
    }
    final load = widget.loadDishes;
    _dishesFuture = load != null
        ? load(restaurant.documentId)
        : BiteScoreService.loadDishesForRestaurant(
            restaurant.documentId,
            includeInactive: true,
          );
  }

  void _reloadDishes() {
    setState(_refreshDishes);
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
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
      _reloadDishes();
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
      _reloadDishes();
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
      _reloadDishes();
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

    return FutureBuilder<List<BitescoreDish>>(
      future: _dishesFuture,
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
            .where(
              (dish) =>
                  dish.restaurantId == selectedRestaurant.documentId &&
                  !dish.isMerged,
            )
            .toList(growable: false);
        final filteredDishes = dishes
            .where(
              (dish) => _matchesAdminQuery(_searchController.text, [
                dish.name,
                dish.category,
                dish.priceLabel,
                dish.restaurantName,
              ]),
            )
            .toList(growable: false);

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              'Managing dishes for ${selectedRestaurant.restaurantName}',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
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
                title: 'No Dishes for ${selectedRestaurant.restaurantName}',
                message: 'This restaurant does not have BiteScore dishes yet.',
              )
            else if (filteredDishes.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.search_off,
                title: 'No Matching Dishes',
                message:
                    'Try a different dish name, category, or price search.',
              )
            else
              ...filteredDishes.map((dish) {
                final subtitleLines = <String>[
                  dish.restaurantName,
                  if ((dish.category ?? '').trim().isNotEmpty)
                    dish.category!.trim(),
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
                            dish.isActive
                                ? Icons.visibility_off
                                : Icons.visibility,
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
  bool _showAllBiteScoreReviews = false;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
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

  Widget _buildReviewSearchControls() {
    return Column(
      children: [
        _AdminSearchField(
          controller: _searchController,
          label: 'Search reviews',
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerRight,
          child: OutlinedButton(
            onPressed: () {
              setState(() {
                _showAllBiteScoreReviews = !_showAllBiteScoreReviews;
              });
            },
            child: Text(
              _showAllBiteScoreReviews
                  ? 'Hide All Reviews'
                  : 'View All Reviews',
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final isSearching = _searchController.text.trim().isNotEmpty;
    final shouldLoadReviews = _showAllBiteScoreReviews || isSearching;

    if (!shouldLoadReviews) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildReviewSearchControls(),
          const SizedBox(height: 12),
          const _AdminEmptyStateCard(
            icon: Icons.rate_review_outlined,
            title: 'Find Reviews',
            message: 'Search for a review or tap View All Reviews.',
          ),
        ],
      );
    }

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
              (entry) => _matchesAdminQuery(_searchController.text, [
                entry.review.userId,
                entry.reviewerDisplayName,
                entry.dishName,
                entry.restaurantName,
                entry.review.headline,
                entry.review.notes,
                entry.review.overallImpression.toStringAsFixed(1),
                entry.review.overallBiteScore.toStringAsFixed(0),
              ]),
            )
            .toList(growable: false);

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _buildReviewSearchControls(),
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
                      'Review by ${entry.reviewerDisplayName}',
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
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
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
              (entry) => _matchesAdminQuery(_searchController.text, [
                entry.review.userId,
                entry.reviewerDisplayName,
                entry.dishName,
                entry.restaurantName,
                entry.reportStatus,
                entry.distinctReasons.join(' '),
                entry.review.headline,
                entry.review.notes,
              ]),
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
                          'Review by ${entry.reviewerDisplayName}',
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

class _BiteScoreDataReportsAdminList extends StatefulWidget {
  const _BiteScoreDataReportsAdminList();

  @override
  State<_BiteScoreDataReportsAdminList> createState() =>
      _BiteScoreDataReportsAdminListState();
}

class _BiteScoreDataReportsAdminListState
    extends State<_BiteScoreDataReportsAdminList> {
  bool _showAllDataReports = false;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: OutlinedButton(
            onPressed: () {
              setState(() {
                _showAllDataReports = !_showAllDataReports;
              });
            },
            child: Text(
              _showAllDataReports ? 'Show Pending Only' : 'View All Reports',
            ),
          ),
        ),
        const SizedBox(height: 12),
        _BiteScoreReportedRestaurantsSection(
          showAllReports: _showAllDataReports,
        ),
        const SizedBox(height: 20),
        _BiteScoreReportedDishesSection(showAllReports: _showAllDataReports),
        const SizedBox(height: 20),
        _BiteScoreDuplicateRestaurantsSection(
          showAllReports: _showAllDataReports,
        ),
      ],
    );
  }
}

class _BiteScoreReportedRestaurantsSection extends StatefulWidget {
  final bool showAllReports;

  const _BiteScoreReportedRestaurantsSection({required this.showAllReports});

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
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
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
        stream: BiteScoreService.reportedRestaurantsAdminStream(
          pendingOnly: !widget.showAllReports,
        ),
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
                (entry) => _matchesAdminQuery(_searchController.text, [
                  entry.restaurant.name,
                  entry.restaurant.city,
                  entry.restaurant.state,
                  entry.restaurant.address,
                  entry.restaurant.id,
                  entry.reportStatus,
                  entry.distinctReasons.join(' '),
                  entry.reportIds.join(' '),
                  entry.reporterUserIds.join(' '),
                  ...entry.reports.map((report) => report.restaurantName),
                ]),
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
                  message:
                      'Try a different restaurant name, city, or reason search.',
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
                              if (reasons.isNotEmpty)
                                'Reasons: ${reasons.join(', ')}',
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
                                onPressed: () => _deleteRestaurant(
                                  context,
                                  entry.restaurant,
                                ),
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
  final bool showAllReports;

  const _BiteScoreReportedDishesSection({required this.showAllReports});

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
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
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
        stream: BiteScoreService.reportedDishesAdminStream(
          pendingOnly: !widget.showAllReports,
        ),
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
                (entry) => _matchesAdminQuery(_searchController.text, [
                  entry.dish.name,
                  entry.dish.restaurantName,
                  entry.restaurant?.name,
                  entry.dish.id,
                  entry.dish.restaurantId,
                  entry.reportStatus,
                  entry.distinctReasons.join(' '),
                  entry.reportIds.join(' '),
                  entry.reporterUserIds.join(' '),
                  ...entry.reports.map((report) => report.dishName),
                ]),
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
                  message:
                      'Try a different dish, restaurant, or reason search.',
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
                              if (reasons.isNotEmpty)
                                'Reasons: ${reasons.join(', ')}',
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
                                onPressed: () =>
                                    _deleteDish(context, entry.dish),
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
  final bool showAllReports;

  const _BiteScoreDuplicateRestaurantsSection({required this.showAllReports});

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
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
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
        stream: BiteScoreService.duplicateRestaurantReportsAdminStream(
          pendingOnly: !widget.showAllReports,
        ),
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
                (entry) => _matchesAdminQuery(_searchController.text, [
                  entry.restaurant.name,
                  entry.restaurant.city,
                  entry.restaurant.state,
                  entry.restaurant.address,
                  entry.restaurant.id,
                  entry.reportStatus,
                  entry.distinctReasons.join(' '),
                  entry.reportIds.join(' '),
                  entry.reporterUserIds.join(' '),
                  ...entry.reports.map((report) => report.restaurantName),
                ]),
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
                              if (reasons.isNotEmpty)
                                'Reasons: ${reasons.join(', ')}',
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
                                onPressed: () =>
                                    _mergeRestaurant(context, entry),
                                child: const Text('Merge Into...'),
                              ),
                              FilledButton.tonal(
                                onPressed: () =>
                                    _resolveReports(context, entry),
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

  const _BiteScoreDataReportSection({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: BiteRaterTheme.ocean.withValues(alpha: 0.16)),
        boxShadow: [
          BoxShadow(
            color: BiteRaterTheme.ocean.withValues(alpha: 0.08),
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

  const _BiteScoreRestaurantMergeDialog({required this.duplicateRestaurant});

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
                  initialValue: _selectedRestaurantId,
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
  bool _showAllClaims = false;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
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
    final isSearching = _searchController.text.trim().isNotEmpty;
    final showingAllClaims = _showAllClaims || isSearching;

    return StreamBuilder<List<BiteScoreAdminClaimEntry>>(
      stream: BiteScoreService.claimRequestsAdminStream(
        pendingOnly: !showingAllClaims,
      ),
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
        final visibleEntries = showingAllClaims
            ? entries
            : entries
                  .where((entry) => entry.request.status == 'pending')
                  .toList(growable: false);
        final matchingEntries = visibleEntries
            .where(
              (entry) => _matchesAdminQuery(_searchController.text, [
                entry.request.restaurantName,
                entry.request.claimantName,
                entry.request.email,
                entry.request.phone,
                entry.request.requesterUserId,
                entry.request.message,
                entry.request.status,
                entry.restaurant?.address,
                entry.restaurant?.city,
                entry.restaurant?.state,
                entry.restaurant?.zipCode,
                [
                  entry.restaurant?.address,
                  entry.restaurant?.city,
                  entry.restaurant?.state,
                  entry.restaurant?.zipCode,
                ].whereType<String>().join(' '),
              ]),
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
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton(
                onPressed: () {
                  setState(() {
                    _showAllClaims = !_showAllClaims;
                  });
                },
                child: Text(
                  _showAllClaims ? 'Show Pending Only' : 'View All Claims',
                ),
              ),
            ),
            const SizedBox(height: 12),
            if (visibleEntries.isEmpty)
              _AdminEmptyStateCard(
                icon: Icons.verified_user_outlined,
                title: showingAllClaims ? 'No Claims' : 'No Pending Claims',
                message: showingAllClaims
                    ? 'Restaurant claim requests will appear here once owners ask to manage a BiteScore profile.'
                    : 'Restaurant claim requests will appear here when owners ask to manage a BiteScore profile.',
              )
            else if (matchingEntries.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.search_off,
                title: 'No Matching Claims',
                message:
                    'Try a different restaurant name, claimant name, email, or user ID search.',
              )
            else
              ...matchingEntries.map((entry) {
                final request = entry.request;
                final restaurant = entry.restaurant;
                final isPending = request.status == 'pending';

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
                        ClickablePhoneText(
                          phone: request.phone,
                          prefix: 'Phone: ',
                        ),
                        if ((request.requesterUserId ?? '').trim().isNotEmpty)
                          Text('User ID: ${request.requesterUserId!}'),
                        if (showingAllClaims || !isPending)
                          Text('Status: ${request.status}'),
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
                              onPressed: isPending
                                  ? () => _approveClaim(context, request)
                                  : null,
                              child: const Text('Approve'),
                            ),
                            OutlinedButton(
                              onPressed: isPending
                                  ? () => _rejectClaim(context, request)
                                  : null,
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
  bool _showAllDishSuggestions = false;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
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
    final isSearching = _searchController.text.trim().isNotEmpty;
    final showingAllSuggestions = _showAllDishSuggestions || isSearching;

    return StreamBuilder<List<DishEditSuggestionAdminEntry>>(
      stream: BiteScoreService.dishEditSuggestionsAdminStream(
        pendingOnly: !showingAllSuggestions,
      ),
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
              (entry) => _matchesAdminQuery(_searchController.text, [
                entry.restaurantId,
                entry.targetDish?.name,
                entry.targetDish?.restaurantName,
                entry.mergeTargetDish?.name,
                entry.mergeTargetDish?.restaurantName,
                entry.proposedName,
                entry.type,
                entry.invalidReason,
                ...entry.proposals.expand(
                  (proposal) => [
                    proposal.userId,
                    proposal.status,
                    proposal.reason,
                    proposal.proposedName,
                  ],
                ),
              ]),
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
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton(
                onPressed: () {
                  setState(() {
                    _showAllDishSuggestions = !_showAllDishSuggestions;
                  });
                },
                child: Text(
                  _showAllDishSuggestions
                      ? 'Show Pending Only'
                      : 'View All Suggestions',
                ),
              ),
            ),
            const SizedBox(height: 12),
            if (entries.isEmpty)
              _AdminEmptyStateCard(
                icon: Icons.edit_note_outlined,
                title: showingAllSuggestions
                    ? 'No Dish Suggestions'
                    : 'No Pending Dish Suggestions',
                message: showingAllSuggestions
                    ? 'Rename and merge suggestions from users will appear here once they are submitted.'
                    : 'Rename and merge suggestions from users will appear here when there is something to review.',
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
                final statuses =
                    entry.proposals
                        .map((proposal) => proposal.status.trim())
                        .where((status) => status.isNotEmpty)
                        .toSet()
                        .toList()
                      ..sort();
                final isPending =
                    statuses.length == 1 && statuses.contains('pending');
                final subtitleLines = <String>[
                  'Type: ${entry.isRename ? 'Rename' : 'Merge'}',
                  'Restaurant ID: ${entry.restaurantId}',
                  'Source dish: $targetDishName',
                  if (entry.isRename &&
                      (entry.proposedName ?? '').trim().isNotEmpty)
                    'Proposed name: ${entry.proposedName!.trim()}',
                  if (entry.isMerge)
                    'Merge into: ${entry.mergeTargetDish?.name ?? 'Unknown dish'}',
                  'Supporters: ${entry.supporterCount}',
                  'Status: ${entry.isInvalid
                      ? 'Invalid'
                      : statuses.isEmpty
                      ? 'Pending'
                      : statuses.join(', ')}',
                  'Created: ${_dateLabel(entry.oldestCreatedAt)}',
                  _autoApplyLabel(entry),
                  if (entry.isInvalid)
                    'Invalid reason: ${entry.invalidReason!}',
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
                              onPressed: entry.isInvalid || !isPending
                                  ? null
                                  : () => _approveSuggestion(context, entry),
                              child: const Text('Approve'),
                            ),
                            OutlinedButton(
                              onPressed: isPending
                                  ? () => _rejectSuggestion(context, entry)
                                  : null,
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
  bool _showAllClaimedRestaurants = false;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
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

  Widget _buildClaimedRestaurantSearchControls() {
    return Column(
      children: [
        _AdminSearchField(
          controller: _searchController,
          label: 'Search claimed restaurants',
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerRight,
          child: OutlinedButton(
            onPressed: () {
              setState(() {
                _showAllClaimedRestaurants = !_showAllClaimedRestaurants;
              });
            },
            child: Text(
              _showAllClaimedRestaurants
                  ? 'Hide All Claimed Restaurants'
                  : 'View All Claimed Restaurants',
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final isSearching = _searchController.text.trim().isNotEmpty;
    final shouldLoadClaimedRestaurants =
        _showAllClaimedRestaurants || isSearching;

    if (!shouldLoadClaimedRestaurants) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildClaimedRestaurantSearchControls(),
          const SizedBox(height: 12),
          const _AdminEmptyStateCard(
            icon: Icons.verified_outlined,
            title: 'Find Claimed Restaurants',
            message:
                'Search for a claimed restaurant or tap View All Claimed Restaurants.',
          ),
        ],
      );
    }

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
              (entry) => _matchesAdminQuery(_searchController.text, [
                entry.restaurant.name,
                entry.restaurant.city,
                entry.restaurant.state,
                entry.restaurant.zipCode,
                entry.restaurant.address,
                entry.restaurant.phone,
                entry.restaurant.website,
                entry.restaurant.id,
                entry.restaurant.ownerUserId,
                entry.approvedClaim?.status,
                entry.approvedClaim?.requesterUserId,
                entry.approvedClaim?.restaurantId,
                entry.approvedClaim?.email,
                entry.approvedClaim?.phone,
                entry.approvedClaim?.claimantName,
              ]),
            )
            .toList(growable: false);

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _buildClaimedRestaurantSearchControls(),
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
                final ownerPhone = request?.phone.trim();
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
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        for (final line in subtitleLines) Text(line),
                        if (ownerPhone != null && ownerPhone.isNotEmpty)
                          ClickablePhoneText(
                            phone: ownerPhone,
                            prefix: 'Owner phone: ',
                          ),
                      ],
                    ),
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
  Future<List<BiteScoreAdminUserEntry>>? _usersFuture;
  bool _showAllUsers = false;

  @override
  void initState() {
    super.initState();
    _searchController.addListener(_handleSearchChanged);
  }

  @override
  void dispose() {
    _searchController.removeListener(_handleSearchChanged);
    _searchController.dispose();
    super.dispose();
  }

  void _handleSearchChanged() {
    if (!mounted) {
      return;
    }
    setState(() {});
  }

  void _refreshUsers() {
    _usersFuture = BiteScoreService.loadUsersForAdmin();
  }

  void _showSnackBar(BuildContext context, String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _showUserDetails(
    BuildContext context,
    BiteScoreAdminUserEntry user,
  ) async {
    await showDialog<void>(
      context: context,
      builder: (context) {
        final contactLabel = user.email ?? user.phoneNumber ?? user.uid;
        final contactLine = user.email != null
            ? 'Email: ${user.email}'
            : user.phoneNumber != null
            ? 'Phone: ${user.phoneNumber}'
            : 'Email: No email available';
        final lines = <String>[
          contactLine,
          if (user.email != null && user.phoneNumber != null)
            'Phone: ${user.phoneNumber}',
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
          title: Text(user.displayName ?? contactLabel),
          content: SingleChildScrollView(child: Text(lines.join('\n'))),
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
            '${user.email ?? user.phoneNumber ?? user.displayName ?? user.uid}? '
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
      if (_showAllUsers) {
        setState(_refreshUsers);
      }
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

  Widget _buildUserSearchControls({required bool includeRefresh}) {
    return Column(
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
            if (includeRefresh) ...[
              const SizedBox(width: 8),
              IconButton(
                tooltip: 'Refresh users',
                onPressed: () => setState(_refreshUsers),
                icon: const Icon(Icons.refresh),
              ),
            ],
          ],
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerRight,
          child: OutlinedButton(
            onPressed: () {
              setState(() {
                _showAllUsers = !_showAllUsers;
                if (_showAllUsers) {
                  _refreshUsers();
                } else {
                  _usersFuture = null;
                }
              });
            },
            child: Text(_showAllUsers ? 'Hide All Users' : 'View All Users'),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_showAllUsers) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildUserSearchControls(includeRefresh: false),
          const SizedBox(height: 12),
          const _AdminEmptyStateCard(
            icon: Icons.people_alt_outlined,
            title: 'Find Users',
            message: 'Search for a user or tap View All Users.',
          ),
        ],
      );
    }

    _usersFuture ??= BiteScoreService.loadUsersForAdmin();

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
              (user) => _matchesAdminQuery(_searchController.text, [
                user.uid,
                user.email,
                user.phoneNumber,
                user.displayName,
                user.roleLabel,
                user.claimedRestaurantNames.join(' '),
                user.restaurantAccountStatus,
                user.activityTags.join(' '),
              ]),
            )
            .toList(growable: false);

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _buildUserSearchControls(includeRefresh: true),
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
                final contactLine = user.email != null
                    ? 'Email: ${user.email}'
                    : user.phoneNumber != null
                    ? 'Phone: ${user.phoneNumber}'
                    : 'Email: No email available';
                final subtitleLines = <String>[
                  contactLine,
                  if (user.email != null && user.phoneNumber != null)
                    'Phone: ${user.phoneNumber}',
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
                      user.displayName ??
                          user.email ??
                          user.phoneNumber ??
                          user.uid,
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

class _BiteScoreUserPointsAdminList extends StatefulWidget {
  const _BiteScoreUserPointsAdminList();

  @override
  State<_BiteScoreUserPointsAdminList> createState() =>
      _BiteScoreUserPointsAdminListState();
}

class _BiteScoreUserPointsAdminListState
    extends State<_BiteScoreUserPointsAdminList> {
  ContributionPointSort _sort = ContributionPointSort.mostPoints;
  Future<List<ContributionPointUserSummary>>? _summaryFuture;
  String? _expandedUserId;
  final Map<String, Future<List<ContributionPointLedgerEntry>>> _ledgerFutures =
      <String, Future<List<ContributionPointLedgerEntry>>>{};

  @override
  void initState() {
    super.initState();
    _summaryFuture = ContributionPointsService.loadUserPointSummaries(
      sort: _sort,
    );
  }

  void _refresh() {
    _summaryFuture = ContributionPointsService.loadUserPointSummaries(
      sort: _sort,
    );
    _ledgerFutures.clear();
  }

  void _setSort(ContributionPointSort sort) {
    setState(() {
      _sort = sort;
      _refresh();
    });
  }

  void _toggleExpanded(String userId) {
    setState(() {
      _expandedUserId = _expandedUserId == userId ? null : userId;
      if (_expandedUserId == userId) {
        _ledgerFutures.putIfAbsent(
          userId,
          () => ContributionPointsService.loadLedgerForAdmin(userId),
        );
      }
    });
  }

  String _sortLabel(ContributionPointSort sort) {
    return switch (sort) {
      ContributionPointSort.mostPoints => 'Most points',
      ContributionPointSort.fewestPoints => 'Fewest points',
      ContributionPointSort.displayNameAz => 'Display name A-Z',
      ContributionPointSort.mostRecentActivity => 'Most recent point activity',
    };
  }

  String _dateLabel(DateTime? date) {
    if (date == null) {
      return 'No date';
    }
    final local = date.toLocal();
    return '${local.month}/${local.day}/${local.year} '
        '${local.hour.toString().padLeft(2, '0')}:'
        '${local.minute.toString().padLeft(2, '0')}';
  }

  Widget _buildSortControl() {
    return Row(
      children: [
        const Text(
          'Sort',
          style: TextStyle(
            color: BiteRaterTheme.mutedInk,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(width: 10),
        DropdownButton<ContributionPointSort>(
          value: _sort,
          onChanged: (value) {
            if (value != null) {
              _setSort(value);
            }
          },
          items: ContributionPointSort.values
              .map(
                (sort) => DropdownMenuItem<ContributionPointSort>(
                  value: sort,
                  child: Text(_sortLabel(sort)),
                ),
              )
              .toList(),
        ),
        const Spacer(),
        IconButton(
          tooltip: 'Refresh points',
          onPressed: () => setState(_refresh),
          icon: const Icon(Icons.refresh),
        ),
      ],
    );
  }

  Widget _buildSummaryCard(ContributionPointUserSummary summary) {
    final isExpanded = _expandedUserId == summary.userId;
    return BiteRaterTheme.liftedCard(
      margin: const EdgeInsets.only(bottom: 12),
      child: Column(
        children: [
          ListTile(
            onTap: () => _toggleExpanded(summary.userId),
            title: Text(
              summary.displayName,
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
            subtitle: Text('UID: ${summary.userId}'),
            leading: CircleAvatar(
              backgroundColor: BiteRaterTheme.ocean.withValues(alpha: 0.18),
              child: Text(
                summary.totalPoints.toString(),
                style: const TextStyle(
                  color: BiteRaterTheme.grape,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            trailing: Icon(
              isExpanded ? Icons.expand_less : Icons.expand_more,
              color: BiteRaterTheme.grape,
            ),
          ),
          if (isExpanded) _buildLedgerDetails(summary.userId),
        ],
      ),
    );
  }

  Widget _buildLedgerDetails(String userId) {
    final future = _ledgerFutures[userId];
    if (future == null) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: CircularProgressIndicator(),
      );
    }

    return FutureBuilder<List<ContributionPointLedgerEntry>>(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.all(16),
            child: LinearProgressIndicator(),
          );
        }
        if (snapshot.hasError) {
          return Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Text(AppErrorText.load('point history')),
          );
        }

        final entries = snapshot.data ?? const <ContributionPointLedgerEntry>[];
        if (entries.isEmpty) {
          return const Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Text('No point history found.'),
          );
        }

        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(children: entries.map(_buildLedgerRow).toList()),
        );
      },
    );
  }

  Widget _buildLedgerRow(ContributionPointLedgerEntry entry) {
    final isReversal = entry.pointsDelta < 0;
    final amount = entry.pointsDelta > 0
        ? '+${entry.pointsDelta}'
        : entry.pointsDelta.toString();
    final details = <String>[
      _dateLabel(entry.createdAt),
      if ((entry.dishName ?? '').trim().isNotEmpty) 'Dish: ${entry.dishName}',
      if ((entry.restaurantName ?? '').trim().isNotEmpty)
        'Restaurant: ${entry.restaurantName}',
      if ((entry.restaurantCity ?? '').trim().isNotEmpty ||
          (entry.restaurantState ?? '').trim().isNotEmpty)
        'Location: ${[entry.restaurantCity, entry.restaurantState].where((part) => (part ?? '').trim().isNotEmpty).join(', ')}',
      if ((entry.restaurantAddress ?? '').trim().isNotEmpty)
        'Address: ${entry.restaurantAddress}',
      if ((entry.restaurantPhone ?? '').trim().isNotEmpty)
        'Phone: ${entry.restaurantPhone}',
      if ((entry.dishId ?? '').trim().isNotEmpty) 'Dish ID: ${entry.dishId}',
      if ((entry.restaurantId ?? '').trim().isNotEmpty)
        'Restaurant ID: ${entry.restaurantId}',
      if ((entry.requestId ?? '').trim().isNotEmpty)
        'Request ID: ${entry.requestId}',
      if ((entry.reason ?? '').trim().isNotEmpty) 'Reason: ${entry.reason}',
    ];

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isReversal ? Colors.red.shade50 : Colors.blue.shade50,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isReversal ? Colors.red.shade200 : Colors.blue.shade100,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            amount,
            style: TextStyle(
              color: isReversal ? Colors.red.shade800 : Colors.blue.shade900,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  entry.description,
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 4),
                Text(
                  details.join('\n'),
                  style: const TextStyle(
                    color: BiteRaterTheme.mutedInk,
                    fontSize: 12,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<ContributionPointUserSummary>>(
      future: _summaryFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(AppErrorText.load('user points')),
            ),
          );
        }

        final summaries =
            snapshot.data ?? const <ContributionPointUserSummary>[];
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _buildSortControl(),
            const SizedBox(height: 12),
            if (summaries.isEmpty)
              const _AdminEmptyStateCard(
                icon: Icons.emoji_events_outlined,
                title: 'No User Points Yet',
                message:
                    'Contribution point activity will appear here after users earn or lose points.',
              )
            else
              ...summaries.map(_buildSummaryCard),
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
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;

  const _AdminTextField({
    required this.controller,
    required this.label,
    this.hint,
    this.maxLines = 1,
    this.keyboardType,
    this.inputFormatters,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      maxLines: maxLines,
      keyboardType: keyboardType,
      inputFormatters: inputFormatters,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }
}

class _BiteScoreRestaurantEditDialog extends StatefulWidget {
  final BitescoreRestaurant restaurant;

  const _BiteScoreRestaurantEditDialog({required this.restaurant});

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
    _phoneController = TextEditingController(
      text: formatPhoneNumberForDisplay(widget.restaurant.phone),
    );
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
        website: widget.restaurant.website ?? '',
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
                      keyboardType: TextInputType.phone,
                      inputFormatters: usPhoneNumberInputFormatters,
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

  const _BiteScoreDishEditDialog({required this.dish});

  @override
  State<_BiteScoreDishEditDialog> createState() =>
      _BiteScoreDishEditDialogState();
}

class _BiteScoreDishEditDialogState extends State<_BiteScoreDishEditDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _priceController;
  late BitescoreCategorySelection _categorySelection;
  late bool _isActive;
  bool _isSaving = false;
  bool _showCategoryValidation = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.dish.name);
    _categorySelection = BitescoreCategorySelection.fromDish(widget.dish);
    _priceController = TextEditingController(
      text: widget.dish.priceLabel ?? '',
    );
    _isActive = widget.dish.isActive;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final categoryValidationError = _categorySelection.validate();
    if (categoryValidationError != null) {
      setState(() {
        _showCategoryValidation = true;
      });
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(categoryValidationError)));
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      await BiteScoreService.updateDishAsAdmin(
        dish: widget.dish,
        name: _nameController.text,
        category: _categorySelection.categoryForSave ?? '',
        subcategory: _categorySelection.subcategoryForSave,
        categoryManualKeywords: _categorySelection.manualKeywordsForSave,
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
              _AdminTextField(controller: _nameController, label: 'Dish name'),
              const SizedBox(height: 12),
              BitescoreCategoryPicker(
                selection: _categorySelection,
                showError: _showCategoryValidation,
                onChanged: (selection) {
                  setState(() {
                    _categorySelection = selection;
                    _showCategoryValidation = false;
                  });
                },
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
