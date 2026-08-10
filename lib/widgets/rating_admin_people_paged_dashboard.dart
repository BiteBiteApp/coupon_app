import 'package:flutter/material.dart';

import '../models/rating_admin_people_paging_models.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_service.dart';
import '../services/paged_query_controller.dart';
import '../services/rating_admin_people_paging_service.dart';
import 'biterater_theme.dart';
import 'paged_directory_view.dart';

typedef RatingAdminDeleteUserRecords =
    Future<void> Function(BiteScoreAdminUserEntry user);

class RatingAdminUsersPagedView extends StatefulWidget {
  const RatingAdminUsersPagedView({
    super.key,
    this.service,
    this.deleteUserRecords,
  });

  final RatingAdminPeoplePagingService? service;
  final RatingAdminDeleteUserRecords? deleteUserRecords;

  @override
  State<RatingAdminUsersPagedView> createState() =>
      _RatingAdminUsersPagedViewState();
}

class _RatingAdminUsersPagedViewState extends State<RatingAdminUsersPagedView> {
  late final RatingAdminPeoplePagingService _service;
  final TextEditingController _searchController = TextEditingController();
  RatingAdminUserSearchMode _draftMode = RatingAdminUserSearchMode.viewAll;
  late PagedQueryController<RatingAdminUserRecord> _controller;
  String _activeCriteriaLabel = 'View All';
  int _usersGeneration = 0;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? RatingAdminPeoplePagingService();
    final generation = ++_usersGeneration;
    _controller = _newController(
      RatingAdminPeoplePagingService.usersCriteria(
        mode: RatingAdminUserSearchMode.viewAll,
      ),
      generation,
    );
    _controller.addListener(_handleControllerChanged);
    _controller.loadInitial();
  }

  void _handleControllerChanged() {
    if (mounted) setState(() {});
  }

  PagedQueryController<RatingAdminUserRecord> _newController(
    Map<String, Object?> criteria,
    int generation,
  ) {
    late final PagedQueryController<RatingAdminUserRecord> controller;
    controller = PagedQueryController<RatingAdminUserRecord>(
      pageLoader: (request) => _service.loadLogicalUsersPage(
        request,
        canContinue: () =>
            mounted &&
            generation == _usersGeneration &&
            identical(controller, _controller),
      ),
      criteria: criteria,
      pageSize: RatingAdminPeoplePagingService.pageSize,
      requestExactCount: true,
    );
    return controller;
  }

  @override
  void dispose() {
    _usersGeneration++;
    _searchController.dispose();
    _controller.removeListener(_handleControllerChanged);
    _controller.dispose();
    super.dispose();
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _submit() async {
    Map<String, Object?> criteria;
    try {
      criteria = RatingAdminPeoplePagingService.usersCriteria(
        mode: _draftMode,
        value: _searchController.text,
      );
    } on RatingAdminPeoplePagingException catch (error) {
      _showMessage(error.message);
      return;
    }
    if (_controller.isLoading &&
        _sameCriteria(criteria, _controller.criteria)) {
      return;
    }
    final generation = ++_usersGeneration;
    final next = _newController(criteria, generation);
    final previous = _controller;
    previous.removeListener(_handleControllerChanged);
    next.addListener(_handleControllerChanged);
    setState(() {
      _controller = next;
      _activeCriteriaLabel = _draftMode == RatingAdminUserSearchMode.viewAll
          ? _draftMode.label
          : '${_draftMode.label}: ${_searchController.text.trim()}';
    });
    previous.dispose();
    await next.loadInitial();
  }

  bool _sameCriteria(Map<String, Object?> first, Map<String, Object?> second) {
    return first.length == second.length &&
        first.entries.every((entry) => second[entry.key] == entry.value);
  }

  Future<void> _clear() async {
    _searchController.clear();
    setState(() => _draftMode = RatingAdminUserSearchMode.viewAll);
    await _submit();
  }

  BiteScoreAdminUserEntry _legacyUser(RatingAdminUserRecord user) {
    return BiteScoreAdminUserEntry(
      uid: user.uid,
      email: user.email,
      phoneNumber: user.phoneNumber,
      displayName: user.displayName,
      claimedRestaurantNames: user.claimedRestaurantNames.toSet(),
      hasRestaurantAccount: user.hasRestaurantAccount,
      hasBiteScoreOwnership: user.hasBiteScoreOwnership,
      isAdmin: user.isAdmin,
      isEmailVerified: user.isEmailVerified,
      restaurantAccountStatus: user.restaurantAccountStatus,
      activityTags: user.activityTags,
    );
  }

  Future<void> _showDetails(RatingAdminUserRecord user) async {
    final claimed = user.claimedRestaurantNames.isEmpty
        ? null
        : '${user.claimedRestaurantNames.join(', ')}'
              '${user.hasMoreClaimedRestaurants ? ' (+ more)' : ''}';
    final lines = <String>[
      if (user.email != null)
        'Email: ${user.email}'
      else
        'Email: No email available',
      if (user.phoneNumber != null) 'Phone: ${user.phoneNumber}',
      'Name: ${user.displayName}',
      'UID: ${user.uid}',
      'Roles: ${user.roleLabel}',
      if (claimed != null) 'Claimed restaurants: $claimed',
      'Email verified: ${user.isEmailVerified ? 'Yes' : 'No or unknown'}',
      'Coupon account status: ${user.restaurantAccountStatus}',
      if (user.activityTags.isNotEmpty)
        'Activity: ${user.activityTags.join(', ')}',
    ];
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(user.displayName),
        content: SingleChildScrollView(child: Text(lines.join('\n'))),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Future<void> _delete(RatingAdminUserRecord user) async {
    final originatingController = _controller;
    final originatingGeneration = _usersGeneration;
    final actionUid = user.uid;
    final legacyUser = _legacyUser(user);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete User Account Records'),
        content: Text(
          'Delete admin-visible owner records for '
          '${user.email ?? user.phoneNumber ?? user.displayName}? '
          'This removes coupon owner account data and unclaims BiteScore '
          'restaurants owned by this user, but it does not delete the '
          'Firebase Auth login itself.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete Records'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await (widget.deleteUserRecords?.call(legacyUser) ??
          BiteScoreService.deleteUserAccountRecordsAsAdmin(legacyUser));
      if (!mounted) return;
      _showMessage('User account records deleted.');
      if (legacyUser.uid == actionUid &&
          originatingGeneration == _usersGeneration &&
          identical(originatingController, _controller) &&
          !originatingController.isDisposed) {
        await originatingController.refreshCurrentPage();
      }
    } catch (error) {
      if (!mounted) return;
      _showMessage(
        AppErrorText.friendly(
          error,
          fallback: 'Could not delete this user\'s account records right now.',
        ),
      );
    }
  }

  Widget _controls() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              ConstrainedBox(
                constraints: const BoxConstraints(minWidth: 150),
                child: Semantics(
                  label: 'User search mode',
                  child: DropdownButton<RatingAdminUserSearchMode>(
                    key: const ValueKey<String>(
                      'rating-admin-user-search-mode',
                    ),
                    value: _draftMode,
                    isExpanded: true,
                    items: RatingAdminUserSearchMode.values
                        .map(
                          (mode) => DropdownMenuItem<RatingAdminUserSearchMode>(
                            value: mode,
                            child: Text(mode.label),
                          ),
                        )
                        .toList(growable: false),
                    onChanged: (mode) {
                      if (mode != null) {
                        setState(() => _draftMode = mode);
                      }
                    },
                  ),
                ),
              ),
              if (_draftMode != RatingAdminUserSearchMode.viewAll)
                ConstrainedBox(
                  constraints: const BoxConstraints(
                    minWidth: 180,
                    maxWidth: 420,
                  ),
                  child: TextField(
                    key: const ValueKey<String>(
                      'rating-admin-user-search-value',
                    ),
                    controller: _searchController,
                    textInputAction: TextInputAction.search,
                    decoration: InputDecoration(
                      labelText: _draftMode.label,
                      hintText: 'Enter ${_draftMode.label.toLowerCase()}',
                    ),
                    onSubmitted: (_) => _submit(),
                  ),
                ),
              FilledButton.icon(
                key: const ValueKey<String>('rating-admin-user-search-submit'),
                style: FilledButton.styleFrom(minimumSize: const Size(48, 48)),
                onPressed: _submit,
                icon: const Icon(Icons.search),
                label: Text(
                  _draftMode == RatingAdminUserSearchMode.viewAll
                      ? 'View All'
                      : 'Search',
                ),
              ),
              OutlinedButton(
                key: const ValueKey<String>('rating-admin-user-search-clear'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(48, 48),
                ),
                onPressed: _clear,
                child: const Text('Clear'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Semantics(
            liveRegion: true,
            label: 'Active user results: $_activeCriteriaLabel',
            child: Text(
              'Showing: $_activeCriteriaLabel',
              key: const ValueKey<String>('rating-admin-user-active-criteria'),
              style: const TextStyle(
                color: BiteRaterTheme.mutedInk,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _card(RatingAdminUserRecord user) {
    final claimed = user.claimedRestaurantNames.isEmpty
        ? null
        : '${user.claimedRestaurantNames.join(', ')}'
              '${user.hasMoreClaimedRestaurants ? ' • + more' : ''}';
    final lines = <String>[
      if (user.email != null)
        'Email: ${user.email}'
      else if (user.phoneNumber != null)
        'Phone: ${user.phoneNumber}'
      else
        'Email: No email available',
      if (user.email != null && user.phoneNumber != null)
        'Phone: ${user.phoneNumber}',
      'Name: ${user.displayName}',
      'UID: ${user.uid}',
      'Role: ${user.roleLabel}',
      if (claimed != null) 'Claimed restaurant: $claimed',
      if (user.hasRestaurantAccount)
        'Coupon account status: ${user.restaurantAccountStatus}',
    ];
    return KeyedSubtree(
      key: ValueKey<String>('rating-admin-user-${user.uid}'),
      child: BiteRaterTheme.liftedCard(
        margin: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                user.displayName,
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 6),
              SelectableText(lines.join('\n')),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: <Widget>[
                  IconButton.filledTonal(
                    tooltip: 'View user details',
                    constraints: const BoxConstraints(
                      minWidth: 48,
                      minHeight: 48,
                    ),
                    onPressed: () => _showDetails(user),
                    icon: const Icon(Icons.info_outline),
                  ),
                  IconButton.filledTonal(
                    tooltip: 'Delete account records',
                    constraints: const BoxConstraints(
                      minWidth: 48,
                      minHeight: 48,
                    ),
                    onPressed: user.isAdmin ? null : () => _delete(user),
                    icon: const Icon(Icons.delete_outline),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        _controls(),
        Expanded(
          child: PagedDirectoryView<RatingAdminUserRecord>(
            key: ValueKey<PagedQueryController<RatingAdminUserRecord>>(
              _controller,
            ),
            controller: _controller,
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
            onRefresh: _controller.refreshCurrentPage,
            emptyBuilder: (context) => const Center(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: Text('No matching user records found.'),
              ),
            ),
            errorBuilder: (context, error, retry) => Center(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(AppErrorText.load('admin users')),
                    const SizedBox(height: 12),
                    OutlinedButton(
                      onPressed: retry,
                      child: const Text('Try Again'),
                    ),
                  ],
                ),
              ),
            ),
            itemBuilder: (context, user, index) => _card(user),
          ),
        ),
      ],
    );
  }
}

class RatingAdminUserPointsPagedView extends StatefulWidget {
  const RatingAdminUserPointsPagedView({super.key, this.service});

  final RatingAdminPeoplePagingService? service;

  @override
  State<RatingAdminUserPointsPagedView> createState() =>
      _RatingAdminUserPointsPagedViewState();
}

class _RatingAdminUserPointsPagedViewState
    extends State<RatingAdminUserPointsPagedView> {
  late final RatingAdminPeoplePagingService _service;
  RatingAdminUserPointsSort _sort = RatingAdminUserPointsSort.mostPoints;
  late PagedQueryController<RatingAdminUserPointsRecord> _pointsController;
  PagedQueryController<RatingAdminContributionLedgerRecord>? _ledgerController;
  String? _expandedUserId;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? RatingAdminPeoplePagingService();
    _pointsController = _newPointsController(_sort);
    _pointsController.addListener(_handlePointsChanged);
    _pointsController.loadInitial();
  }

  PagedQueryController<RatingAdminUserPointsRecord> _newPointsController(
    RatingAdminUserPointsSort sort,
  ) => PagedQueryController<RatingAdminUserPointsRecord>(
    pageLoader: _service.loadUserPointsPage,
    criteria: RatingAdminPeoplePagingService.userPointsCriteria(sort),
    pageSize: RatingAdminPeoplePagingService.pageSize,
    requestExactCount: true,
  );

  PagedQueryController<RatingAdminContributionLedgerRecord>
  _newLedgerController(String userId) =>
      PagedQueryController<RatingAdminContributionLedgerRecord>(
        pageLoader: _service.loadContributionLedgerPage,
        criteria: RatingAdminPeoplePagingService.contributionLedgerCriteria(
          userId,
        ),
        pageSize: RatingAdminPeoplePagingService.pageSize,
        requestExactCount: true,
      );

  void _handlePointsChanged() {
    final expanded = _expandedUserId;
    if (expanded != null &&
        _pointsController.page != null &&
        _pointsController.items.every((item) => item.userId != expanded)) {
      _disposeLedger();
    }
    if (mounted) setState(() {});
  }

  void _disposeLedger() {
    _ledgerController?.dispose();
    _ledgerController = null;
    _expandedUserId = null;
  }

  @override
  void dispose() {
    _pointsController.removeListener(_handlePointsChanged);
    _pointsController.dispose();
    _disposeLedger();
    super.dispose();
  }

  Future<void> _setSort(RatingAdminUserPointsSort sort) async {
    if (sort == _sort || _pointsController.isLoading) return;
    final next = _newPointsController(sort);
    final previous = _pointsController;
    previous.removeListener(_handlePointsChanged);
    _disposeLedger();
    setState(() {
      _sort = sort;
      _pointsController = next;
    });
    previous.dispose();
    next.addListener(_handlePointsChanged);
    await next.loadInitial();
  }

  Future<void> _toggleExpanded(String userId) async {
    if (_expandedUserId == userId) {
      setState(_disposeLedger);
      return;
    }
    _disposeLedger();
    final next = _newLedgerController(userId);
    setState(() {
      _expandedUserId = userId;
      _ledgerController = next;
    });
    await next.loadInitial();
  }

  String _dateLabel(DateTime date) {
    final local = date.toLocal();
    return '${local.month}/${local.day}/${local.year} '
        '${local.hour.toString().padLeft(2, '0')}:'
        '${local.minute.toString().padLeft(2, '0')}';
  }

  Widget _sortControl() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Align(
        alignment: Alignment.centerLeft,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Semantics(
            label: 'User Points sort',
            child: DropdownButton<RatingAdminUserPointsSort>(
              key: const ValueKey<String>('rating-admin-user-points-sort'),
              value: _sort,
              isExpanded: true,
              items: RatingAdminUserPointsSort.values
                  .map(
                    (sort) => DropdownMenuItem<RatingAdminUserPointsSort>(
                      value: sort,
                      child: Text(sort.label),
                    ),
                  )
                  .toList(growable: false),
              onChanged: _pointsController.isLoading
                  ? null
                  : (sort) {
                      if (sort != null) _setSort(sort);
                    },
            ),
          ),
        ),
      ),
    );
  }

  Widget _summaryCard(RatingAdminUserPointsRecord summary) {
    final expanded = summary.userId == _expandedUserId;
    return KeyedSubtree(
      key: ValueKey<String>('rating-admin-points-${summary.userId}'),
      child: BiteRaterTheme.liftedCard(
        margin: const EdgeInsets.only(bottom: 12),
        child: Column(
          children: <Widget>[
            ListTile(
              minVerticalPadding: 12,
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
              trailing: Semantics(
                button: true,
                expanded: expanded,
                label: expanded
                    ? 'Collapse point history'
                    : 'Expand point history',
                child: SizedBox(
                  width: 48,
                  height: 48,
                  child: Icon(
                    expanded ? Icons.expand_less : Icons.expand_more,
                    color: BiteRaterTheme.grape,
                  ),
                ),
              ),
            ),
            if (expanded) _ledgerView(summary.userId),
          ],
        ),
      ),
    );
  }

  Widget _ledgerView(String userId) {
    final controller = _ledgerController;
    if (controller == null || _expandedUserId != userId) {
      return const SizedBox.shrink();
    }
    return SizedBox(
      key: ValueKey<String>('rating-admin-ledger-$userId'),
      height: 520,
      child: PagedDirectoryView<RatingAdminContributionLedgerRecord>(
        controller: controller,
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        onRefresh: controller.refreshCurrentPage,
        emptyBuilder: (context) =>
            const Center(child: Text('No point history found.')),
        errorBuilder: (context, error, retry) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(AppErrorText.load('point history')),
              const SizedBox(height: 8),
              OutlinedButton(onPressed: retry, child: const Text('Try Again')),
            ],
          ),
        ),
        itemBuilder: (context, entry, index) => _ledgerRow(entry),
      ),
    );
  }

  Widget _ledgerRow(RatingAdminContributionLedgerRecord entry) {
    final isReversal = entry.pointsDelta < 0;
    final amount = entry.pointsDelta > 0
        ? '+${entry.pointsDelta}'
        : entry.pointsDelta.toString();
    final details = <String>[
      _dateLabel(entry.createdAt),
      if ((entry.dishName ?? '').isNotEmpty) 'Dish: ${entry.dishName}',
      if ((entry.restaurantName ?? '').isNotEmpty)
        'Restaurant: ${entry.restaurantName}',
      if ((entry.restaurantCity ?? '').isNotEmpty ||
          (entry.restaurantState ?? '').isNotEmpty)
        'Location: ${[entry.restaurantCity, entry.restaurantState].where((part) => (part ?? '').isNotEmpty).join(', ')}',
      if ((entry.restaurantAddress ?? '').isNotEmpty)
        'Address: ${entry.restaurantAddress}',
      if ((entry.restaurantPhone ?? '').isNotEmpty)
        'Phone: ${entry.restaurantPhone}',
      if ((entry.dishId ?? '').isNotEmpty) 'Dish ID: ${entry.dishId}',
      if ((entry.restaurantId ?? '').isNotEmpty)
        'Restaurant ID: ${entry.restaurantId}',
      if ((entry.requestId ?? '').isNotEmpty) 'Request ID: ${entry.requestId}',
      if ((entry.reason ?? '').isNotEmpty) 'Reason: ${entry.reason}',
    ];
    return Container(
      key: ValueKey<String>('rating-admin-ledger-entry-${entry.id}'),
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
        children: <Widget>[
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
              children: <Widget>[
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
    return Column(
      children: <Widget>[
        _sortControl(),
        Expanded(
          child: PagedDirectoryView<RatingAdminUserPointsRecord>(
            key: ValueKey<PagedQueryController<RatingAdminUserPointsRecord>>(
              _pointsController,
            ),
            controller: _pointsController,
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
            onRefresh: _pointsController.refreshCurrentPage,
            emptyBuilder: (context) => const Center(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: Text('No User Points activity found.'),
              ),
            ),
            errorBuilder: (context, error, retry) => Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(AppErrorText.load('user points')),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: retry,
                    child: const Text('Try Again'),
                  ),
                ],
              ),
            ),
            itemBuilder: (context, summary, index) => _summaryCard(summary),
          ),
        ),
      ],
    );
  }
}
