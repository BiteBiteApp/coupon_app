// ignore_for_file: prefer_interpolation_to_compose_strings

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/admin_restaurant_link_record.dart';
import '../models/bitescore_dish.dart';
import '../models/bitescore_restaurant.dart';
import '../models/dish_report.dart';
import '../models/duplicate_restaurant_report.dart';
import '../models/pagination/paged_models.dart';
import '../models/rating_admin_paging_models.dart';
import '../models/rating_destructive_operation_models.dart';
import '../models/restaurant_report.dart';
import '../models/review_report.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_service.dart';
import '../services/paged_query_controller.dart';
import '../services/rating_admin_paging_service.dart';
import '../services/rating_destructive_operations_service.dart';
import '../services/restaurant_invite_service.dart';
import 'biterater_theme.dart';
import 'clickable_phone_text.dart';
import 'paged_directory_view.dart';
import 'rating_destructive_operation_status_dialog.dart';

typedef RatingAdminEditRestaurant =
    Future<bool?> Function(BitescoreRestaurant restaurant);
typedef RatingAdminEditDish = Future<bool?> Function(BitescoreDish dish);

Future<bool> _confirm(
  BuildContext context, {
  required String title,
  required String message,
  String action = 'Delete',
}) async {
  return await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(action),
            ),
          ],
        ),
      ) ==
      true;
}

void _snack(BuildContext context, String message) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}

Future<void> _refreshAndRefill<T>(PagedQueryController<T> controller) async {
  await controller.refreshCurrentPage();
  if (controller.items.isEmpty && (controller.currentPageNumber ?? 1) > 1) {
    await controller.previousPage();
  }
}

Widget _empty(String title, String message, IconData icon) {
  return Center(
    child: SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 42),
            const SizedBox(height: 8),
            Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            Text(message, textAlign: TextAlign.center),
          ],
        ),
      ),
    ),
  );
}

class RatingAdminRestaurantPagedView extends StatefulWidget {
  const RatingAdminRestaurantPagedView({
    super.key,
    required this.onManageDishes,
    required this.onEditRestaurant,
    this.service,
    this.operationsService,
    this.loadRestaurant,
    this.deleteRestaurant,
    this.createClaimInvite,
  });

  final ValueChanged<AdminRestaurantLinkRecord> onManageDishes;
  final RatingAdminEditRestaurant onEditRestaurant;
  final RatingAdminPagingService? service;
  final RatingDestructiveOperationsService? operationsService;
  final Future<BitescoreRestaurant?> Function(String id)? loadRestaurant;
  final Future<void> Function(String id)? deleteRestaurant;
  final Future<RestaurantInviteCreationResult> Function({
    required String restaurantId,
  })?
  createClaimInvite;

  @override
  State<RatingAdminRestaurantPagedView> createState() =>
      _RatingAdminRestaurantPagedViewState();
}

class _RatingAdminRestaurantPagedViewState
    extends State<RatingAdminRestaurantPagedView> {
  static const List<int> _radiusOptions = <int>[1, 3, 5, 10, 15, 20, 30, 50];

  late final RatingAdminPagingService _service;
  late final RatingDestructiveOperationsService _operationsService;
  final _formKey = GlobalKey<FormState>();
  final _locationController = TextEditingController();
  final _nameController = TextEditingController();
  final Set<String> _busy = <String>{};
  PagedQueryController<RatingAdminRestaurantRecord>? _controller;
  RatingAdminRestaurantSearchMode _mode =
      RatingAdminRestaurantSearchMode.nearbyRadius;
  AdminBiteScoreStatus _status = AdminBiteScoreStatus.all;
  int _radius = 10;
  int _generation = 0;
  String? _activeSummary;
  PagedQueryController<RatingAdminRestaurantRecord>? _preparingController;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? RatingAdminPagingService();
    _operationsService =
        widget.operationsService ?? RatingDestructiveOperationsService();
  }

  @override
  void dispose() {
    _generation++;
    _locationController.dispose();
    _nameController.dispose();
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    Map<String, Object?> criteria;
    try {
      criteria = RatingAdminPagingService.restaurantCriteria(
        mode: _mode,
        location: _locationController.text,
        radiusMiles: _radius,
        status: _status,
        restaurantName: _nameController.text,
      );
    } on RatingAdminPagingException catch (error) {
      _snack(context, error.message);
      return;
    }
    final generation = ++_generation;
    if (_mode == RatingAdminRestaurantSearchMode.nearbyRadius) {
      criteria = <String, Object?>{...criteria, 'searchInstanceId': generation};
    }
    final next = PagedQueryController<RatingAdminRestaurantRecord>(
      pageLoader: _service.loadRestaurantPage,
      criteria: criteria,
      pageSize: RatingAdminPagingService.restaurantPageSize,
      requestExactCount: true,
    );
    final previous = _controller;
    setState(() {
      _controller = next;
      _activeSummary =
          _mode.label +
          ' • ' +
          _locationController.text.trim() +
          ' • ' +
          _status.label +
          (_nameController.text.trim().isEmpty
              ? ''
              : ' • ' + _nameController.text.trim());
    });
    previous?.dispose();
    await next.loadInitial();
    await _continuePreparation(next, generation);
  }

  Future<void> _continuePreparation(
    PagedQueryController<RatingAdminRestaurantRecord> controller,
    int generation,
  ) async {
    if (identical(_preparingController, controller)) return;
    _preparingController = controller;
    try {
      while (_shouldContinuePreparation(controller, generation)) {
        await Future<void>.delayed(const Duration(milliseconds: 750));
        if (!_shouldContinuePreparation(controller, generation)) {
          return;
        }
        await controller.nextPage();
        if (!_shouldContinuePreparation(controller, generation)) {
          return;
        }
      }
    } finally {
      if (identical(_preparingController, controller)) {
        _preparingController = null;
      }
    }
  }

  bool _shouldContinuePreparation(
    PagedQueryController<RatingAdminRestaurantRecord> controller,
    int generation,
  ) {
    return mounted &&
        generation == _generation &&
        identical(controller, _controller) &&
        controller.error == null &&
        controller.page?.preparation?.state == PagePreparationState.preparing &&
        controller.page?.hasNext == true;
  }

  Future<void> _refreshResults(
    PagedQueryController<RatingAdminRestaurantRecord> controller,
  ) async {
    if (controller.criteria['mode'] != 'nearbyRadius') {
      await controller.refreshCurrentPage();
      return;
    }
    final generation = ++_generation;
    await controller.updateCriteria(<String, Object?>{
      ...controller.criteria,
      'searchInstanceId': generation,
    });
    await _continuePreparation(controller, generation);
  }

  Future<void> _edit(RatingAdminRestaurantRecord record) async {
    final key = 'edit:' + record.documentId;
    if (!_busy.add(key)) return;
    setState(() {});
    try {
      final restaurant =
          await (widget.loadRestaurant?.call(record.documentId) ??
              BiteScoreService.loadRestaurantById(record.documentId));
      if (!mounted) return;
      if (restaurant == null || restaurant.id != record.documentId) {
        _snack(context, 'This restaurant is no longer available.');
        return;
      }
      if (await widget.onEditRestaurant(restaurant) == true && mounted) {
        _snack(context, restaurant.name + ' updated.');
        await _controller?.refreshCurrentPage();
      }
    } catch (error) {
      if (mounted) {
        _snack(
          context,
          AppErrorText.friendly(
            error,
            fallback: 'Could not edit the restaurant right now.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  Future<void> _delete(RatingAdminRestaurantRecord record) async {
    if (!await _confirm(
      context,
      title: 'Delete Restaurant',
      message:
          'Delete ' +
          record.restaurantName +
          ' and its related dishes and reviews?',
    )) {
      return;
    }
    final key = 'delete:' + record.documentId;
    if (!_busy.add(key)) return;
    final originatingController = _controller;
    var refreshed = false;
    Future<void> refreshOriginOnce() async {
      if (refreshed ||
          !mounted ||
          originatingController == null ||
          !identical(originatingController, _controller)) {
        return;
      }
      refreshed = true;
      await _refreshAndRefill(originatingController);
    }

    setState(() {});
    try {
      if (widget.deleteRestaurant != null) {
        await widget.deleteRestaurant!(record.documentId);
        if (!mounted || !identical(originatingController, _controller)) return;
        _snack(context, record.restaurantName + ' deleted.');
        await refreshOriginOnce();
        return;
      }
      final summary = await _operationsService.startRestaurantDelete(
        restaurantId: record.documentId,
        expectedRestaurantRevision: record.restaurantWriteRevision,
      );
      if (!mounted) return;
      if (!identical(originatingController, _controller)) return;
      if (summary.complete) await refreshOriginOnce();
      if (!mounted || !identical(originatingController, _controller)) return;
      showRatingDestructiveOperationFeedback(
        context,
        service: _operationsService,
        summary: summary,
        onComplete: refreshOriginOnce,
      );
    } on RatingDestructiveOperationsException catch (error) {
      if (mounted && identical(originatingController, _controller)) {
        _snack(context, error.message);
      }
    } catch (error) {
      if (mounted && identical(originatingController, _controller)) {
        _snack(
          context,
          AppErrorText.friendly(
            error,
            fallback: 'Could not delete the restaurant right now.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  Future<void> _invite(RatingAdminRestaurantRecord record) async {
    if (!record.canCreateClaimInvite) return;
    final key = 'invite:' + record.documentId;
    if (!_busy.add(key)) return;
    setState(() {});
    try {
      final result =
          await (widget.createClaimInvite?.call(
                restaurantId: record.documentId,
              ) ??
              RestaurantInviteService.createBiteScoreClaimInvite(
                restaurantId: record.documentId,
              ));
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
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
                if (context.mounted) _snack(context, 'Invite link copied.');
              },
              icon: const Icon(Icons.copy),
              label: const Text('Copy Link'),
            ),
          ],
        ),
      );
    } catch (error) {
      if (mounted) {
        _snack(
          context,
          AppErrorText.friendly(
            error,
            fallback: 'Could not create a claim invite right now.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  Widget _identifierRow({
    required String label,
    required String value,
    required String copyKey,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: <Widget>[
        Expanded(
          child: SelectableText(
            label + ': ' + value,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
        IconButton(
          key: ValueKey(copyKey),
          tooltip: 'Copy ' + label,
          constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
          onPressed: () async {
            await Clipboard.setData(ClipboardData(text: value));
            if (mounted) _snack(context, label + ' copied.');
          },
          icon: const Icon(Icons.copy_outlined, size: 20),
        ),
      ],
    );
  }

  void _showInvites() {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('BiteScore Claim Invites'),
        content: SizedBox(
          width: 680,
          height: 560,
          child: RatingAdminInviteHistoryPanel(service: _service),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 270),
            child: SingleChildScrollView(
              child: Form(
                key: _formKey,
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final width = constraints.maxWidth < 680
                        ? constraints.maxWidth
                        : (constraints.maxWidth - 12) / 2;
                    return Wrap(
                      spacing: 12,
                      runSpacing: 12,
                      children: [
                        SizedBox(
                          width: width,
                          child:
                              DropdownButtonFormField<
                                RatingAdminRestaurantSearchMode
                              >(
                                key: const ValueKey('rating-admin-search-mode'),
                                isExpanded: true,
                                initialValue: _mode,
                                decoration: const InputDecoration(
                                  labelText: 'Search mode',
                                  border: OutlineInputBorder(),
                                ),
                                items: RatingAdminRestaurantSearchMode.values
                                    .map(
                                      (mode) => DropdownMenuItem(
                                        value: mode,
                                        child: Text(mode.label),
                                      ),
                                    )
                                    .toList(),
                                onChanged: (value) {
                                  if (value != null) {
                                    setState(() => _mode = value);
                                  }
                                },
                              ),
                        ),
                        SizedBox(
                          width: width,
                          child: TextFormField(
                            key: const ValueKey('rating-admin-location-field'),
                            controller: _locationController,
                            decoration: InputDecoration(
                              labelText: switch (_mode) {
                                RatingAdminRestaurantSearchMode.exactZip =>
                                  'ZIP code',
                                RatingAdminRestaurantSearchMode.exactCity =>
                                  'City, ST',
                                RatingAdminRestaurantSearchMode.nearbyRadius =>
                                  'Location',
                              },
                              border: const OutlineInputBorder(),
                            ),
                            validator: (value) => value?.trim().isEmpty == true
                                ? 'Required'
                                : null,
                          ),
                        ),
                        SizedBox(
                          width: width,
                          child: TextFormField(
                            key: const ValueKey('rating-admin-name-field'),
                            controller: _nameController,
                            decoration: const InputDecoration(
                              labelText: 'Restaurant name (optional)',
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ),
                        SizedBox(
                          width: width,
                          child: DropdownButtonFormField<AdminBiteScoreStatus>(
                            key: const ValueKey('rating-admin-status-field'),
                            isExpanded: true,
                            initialValue: _status,
                            decoration: const InputDecoration(
                              labelText: 'Status',
                              border: OutlineInputBorder(),
                            ),
                            items: AdminBiteScoreStatus.values
                                .map(
                                  (status) => DropdownMenuItem(
                                    value: status,
                                    child: Text(status.label),
                                  ),
                                )
                                .toList(),
                            onChanged: (value) {
                              if (value != null) {
                                setState(() => _status = value);
                              }
                            },
                          ),
                        ),
                        if (_mode ==
                            RatingAdminRestaurantSearchMode.nearbyRadius)
                          SizedBox(
                            width: width,
                            child: DropdownButtonFormField<int>(
                              isExpanded: true,
                              initialValue: _radius,
                              decoration: const InputDecoration(
                                labelText: 'Radius',
                                border: OutlineInputBorder(),
                              ),
                              items: _radiusOptions
                                  .map(
                                    (radius) => DropdownMenuItem(
                                      value: radius,
                                      child: Text(radius.toString() + ' miles'),
                                    ),
                                  )
                                  .toList(),
                              onChanged: (value) {
                                if (value != null) {
                                  setState(() => _radius = value);
                                }
                              },
                            ),
                          ),
                        FilledButton.icon(
                          key: const ValueKey('rating-admin-search-button'),
                          onPressed: controller?.isLoading == true
                              ? null
                              : _search,
                          icon: const Icon(Icons.search),
                          label: const Text('Search'),
                        ),
                        OutlinedButton.icon(
                          onPressed: _showInvites,
                          icon: const Icon(Icons.manage_search),
                          label: const Text('Manage Claim Invites'),
                        ),
                      ],
                    );
                  },
                ),
              ),
            ),
          ),
          if (_activeSummary != null) ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'Current results: ' + _activeSummary!,
                key: const ValueKey('rating-admin-active-criteria'),
              ),
            ),
          ],
          const SizedBox(height: 10),
          Expanded(
            child: controller == null
                ? _empty(
                    'Find Restaurants',
                    'Choose a mode and location to find restaurants.',
                    Icons.storefront_outlined,
                  )
                : PagedDirectoryView<RatingAdminRestaurantRecord>(
                    controller: controller,
                    onRefresh: () => _refreshResults(controller),
                    emptyBuilder: (_) => _empty(
                      'No Restaurants',
                      'No restaurants match the submitted criteria.',
                      Icons.search_off,
                    ),
                    itemBuilder: (context, record, _) {
                      final cityLine = <String>[
                        record.city,
                        record.state,
                        record.zipCode,
                      ].where((part) => part.isNotEmpty).join(', ');
                      return KeyedSubtree(
                        key: ValueKey(
                          'rating-admin-result-' + record.documentId,
                        ),
                        child: BiteRaterTheme.liftedCard(
                          margin: const EdgeInsets.only(bottom: 12),
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  record.restaurantName,
                                  style: const TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                                if (record.streetAddress.isNotEmpty)
                                  Text(record.streetAddress),
                                if (cityLine.isNotEmpty) Text(cityLine),
                                if (record.phone.isNotEmpty)
                                  ClickablePhoneText(
                                    phone: record.phone,
                                    prefix: 'Phone: ',
                                  ),
                                const SizedBox(height: 6),
                                _identifierRow(
                                  label: 'Restaurant ID',
                                  value: record.documentId,
                                  copyKey:
                                      'rating-admin-copy-restaurant-id-' +
                                      record.documentId,
                                ),
                                if (record.isClaimed &&
                                    record.ownerUserId?.trim().isNotEmpty ==
                                        true)
                                  _identifierRow(
                                    label: 'Owner UID',
                                    value: record.ownerUserId!,
                                    copyKey:
                                        'rating-admin-copy-owner-uid-' +
                                        record.documentId,
                                  ),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 6,
                                  children: [
                                    Chip(
                                      label: Text(
                                        record.isActive ? 'Active' : 'Hidden',
                                      ),
                                    ),
                                    Chip(label: Text(record.claimState.label)),
                                    if (record.distanceMiles != null)
                                      Chip(
                                        label: Text(
                                          record.distanceMiles!.toStringAsFixed(
                                                1,
                                              ) +
                                              ' miles',
                                        ),
                                      ),
                                  ],
                                ),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: [
                                    OutlinedButton.icon(
                                      onPressed:
                                          !record.canCreateClaimInvite ||
                                              _busy.contains(
                                                'invite:' + record.documentId,
                                              )
                                          ? null
                                          : () => _invite(record),
                                      icon: const Icon(Icons.add_link),
                                      label: Text(switch (record.claimState) {
                                        AdminRestaurantClaimState.claimed =>
                                          'Already Claimed',
                                        AdminRestaurantClaimState.available =>
                                          'Create Claim Invite',
                                        AdminRestaurantClaimState.unavailable =>
                                          'Claim unavailable',
                                      }),
                                    ),
                                    OutlinedButton.icon(
                                      onPressed: () => widget.onManageDishes(
                                        record.toAdminLinkRecord(),
                                      ),
                                      icon: const Icon(
                                        Icons.restaurant_menu_outlined,
                                      ),
                                      label: const Text('Manage Dishes'),
                                    ),
                                    OutlinedButton.icon(
                                      onPressed:
                                          _busy.contains(
                                            'edit:' + record.documentId,
                                          )
                                          ? null
                                          : () => _edit(record),
                                      icon: const Icon(Icons.edit_outlined),
                                      label: const Text('Edit'),
                                    ),
                                    OutlinedButton.icon(
                                      onPressed:
                                          _busy.contains(
                                            'delete:' + record.documentId,
                                          )
                                          ? null
                                          : () => _delete(record),
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
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class RatingAdminInviteHistoryPanel extends StatefulWidget {
  const RatingAdminInviteHistoryPanel({super.key, this.service});

  final RatingAdminPagingService? service;

  @override
  State<RatingAdminInviteHistoryPanel> createState() =>
      _RatingAdminInviteHistoryPanelState();
}

class _RatingAdminInviteHistoryPanelState
    extends State<RatingAdminInviteHistoryPanel> {
  late final PagedQueryController<RatingAdminInviteRecord> _controller;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    final service = widget.service ?? RatingAdminPagingService();
    _controller = PagedQueryController<RatingAdminInviteRecord>(
      pageLoader: service.loadInviteHistoryPage,
      criteria: RatingAdminPagingService.inviteCriteria,
      pageSize: RatingAdminPagingService.invitePageSize,
      requestExactCount: true,
    );
    unawaited(_controller.loadInitial());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  String _date(DateTime? value) {
    if (value == null) return 'Unknown';
    final local = value.toLocal();
    return local.month.toString().padLeft(2, '0') +
        '/' +
        local.day.toString().padLeft(2, '0') +
        '/' +
        local.year.toString();
  }

  Future<void> _revoke(RatingAdminInviteRecord invite) async {
    if (_busyId != null) return;
    setState(() => _busyId = invite.id);
    try {
      await RestaurantInviteService.revokeInvite(invite.id);
      if (!mounted) return;
      _snack(context, 'Invite revoked.');
      await _refreshAndRefill(_controller);
    } catch (error) {
      if (mounted) {
        _snack(
          context,
          AppErrorText.friendly(
            error,
            fallback: 'Could not revoke this invite right now.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PagedDirectoryView<RatingAdminInviteRecord>(
      controller: _controller,
      onRefresh: _controller.refreshCurrentPage,
      emptyBuilder: (_) =>
          _empty('No Invites', 'No BiteScore claim invites yet.', Icons.link),
      itemBuilder: (context, invite, _) => ListTile(
        key: ValueKey('rating-invite-' + invite.id),
        title: Text(
          invite.restaurantName.isEmpty
              ? 'Unnamed restaurant'
              : invite.restaurantName,
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Text(
          <String>[
            'BiteScore',
            if (invite.type.isNotEmpty) invite.type,
            'Status: ' + invite.status,
            'Uses: ' +
                invite.useCount.toString() +
                '/' +
                invite.maxUses.toString(),
            'Created: ' + _date(invite.createdAt),
            'Expires: ' + _date(invite.expiresAt),
            if (invite.restaurantId.isNotEmpty)
              'Restaurant ID: ' + invite.restaurantId,
            if (invite.createdByEmail.isNotEmpty)
              'By: ' + invite.createdByEmail,
          ].join(' • '),
        ),
        trailing: invite.isActive
            ? TextButton(
                onPressed: _busyId == null ? () => _revoke(invite) : null,
                child: Text(_busyId == invite.id ? 'Revoking...' : 'Revoke'),
              )
            : null,
      ),
    );
  }
}

class RatingAdminDishPagedView extends StatefulWidget {
  const RatingAdminDishPagedView({
    super.key,
    required this.selectedRestaurant,
    required this.onEditDish,
    this.service,
    this.operationsService,
  });

  final AdminRestaurantLinkRecord? selectedRestaurant;
  final RatingAdminEditDish onEditDish;
  final RatingAdminPagingService? service;
  final RatingDestructiveOperationsService? operationsService;

  @override
  State<RatingAdminDishPagedView> createState() =>
      _RatingAdminDishPagedViewState();
}

class _RatingAdminDishPagedViewState extends State<RatingAdminDishPagedView> {
  late final RatingAdminPagingService _service;
  late final RatingDestructiveOperationsService _operationsService;
  final _nameController = TextEditingController();
  PagedQueryController<RatingAdminDishRecord>? _controller;
  AdminBiteScoreStatus _status = AdminBiteScoreStatus.all;
  final Set<String> _busy = <String>{};

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? RatingAdminPagingService();
    _operationsService =
        widget.operationsService ?? RatingDestructiveOperationsService();
    _replaceController();
  }

  @override
  void didUpdateWidget(covariant RatingAdminDishPagedView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selectedRestaurant?.documentId !=
        widget.selectedRestaurant?.documentId) {
      _nameController.clear();
      _status = AdminBiteScoreStatus.all;
      _replaceController();
    }
  }

  void _replaceController() {
    final old = _controller;
    final restaurant = widget.selectedRestaurant;
    if (restaurant == null) {
      _controller = null;
      old?.dispose();
      return;
    }
    final next = PagedQueryController<RatingAdminDishRecord>(
      pageLoader: _service.loadDishPage,
      criteria: RatingAdminPagingService.dishCriteria(
        restaurantId: restaurant.documentId,
        status: _status,
        dishName: _nameController.text,
      ),
      pageSize: RatingAdminPagingService.directoryPageSize,
      requestExactCount: true,
    );
    _controller = next;
    old?.dispose();
    unawaited(next.loadInitial());
  }

  Future<void> _applyCriteria() async {
    final restaurant = widget.selectedRestaurant;
    if (restaurant == null || _controller == null) return;
    await _controller!.updateCriteria(
      RatingAdminPagingService.dishCriteria(
        restaurantId: restaurant.documentId,
        status: _status,
        dishName: _nameController.text,
      ),
    );
  }

  Future<void> _edit(BitescoreDish dish) async {
    final key = 'edit:' + dish.id;
    if (!_busy.add(key)) return;
    setState(() {});
    try {
      if (await widget.onEditDish(dish) == true && mounted) {
        _snack(context, dish.name + ' updated.');
        await _controller?.refreshCurrentPage();
      }
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  Future<void> _toggle(BitescoreDish dish) async {
    final key = 'toggle:' + dish.id;
    if (!_busy.add(key)) return;
    setState(() {});
    try {
      await BiteScoreService.setDishAvailabilityAsAdmin(
        dish: dish,
        isActive: !dish.isActive,
      );
      if (!mounted) return;
      _snack(
        context,
        dish.name +
            (dish.isActive ? ' marked unavailable.' : ' marked available.'),
      );
      final controller = _controller;
      if (controller != null) await _refreshAndRefill(controller);
    } catch (error) {
      if (mounted) {
        _snack(
          context,
          AppErrorText.friendly(
            error,
            fallback: 'Could not update dish availability right now.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  Future<void> _delete(BitescoreDish dish) async {
    if (!await _confirm(
      context,
      title: 'Delete Dish',
      message: 'Delete ' + dish.name + '?',
    )) {
      return;
    }
    final key = 'delete:' + dish.id;
    if (!_busy.add(key)) return;
    final originatingController = _controller;
    var refreshed = false;
    Future<void> refreshOriginOnce() async {
      if (refreshed ||
          !mounted ||
          originatingController == null ||
          !identical(originatingController, _controller)) {
        return;
      }
      refreshed = true;
      await _refreshAndRefill(originatingController);
    }

    setState(() {});
    try {
      final summary = await _operationsService.startDishDelete(dishId: dish.id);
      if (!mounted) return;
      if (!identical(originatingController, _controller)) return;
      if (summary.complete) await refreshOriginOnce();
      if (!mounted || !identical(originatingController, _controller)) return;
      showRatingDestructiveOperationFeedback(
        context,
        service: _operationsService,
        summary: summary,
        onComplete: refreshOriginOnce,
      );
    } on RatingDestructiveOperationsException catch (error) {
      if (mounted && identical(originatingController, _controller)) {
        _snack(context, error.message);
      }
    } catch (error) {
      if (mounted && identical(originatingController, _controller)) {
        _snack(
          context,
          AppErrorText.friendly(
            error,
            fallback: 'Could not delete the dish right now.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final restaurant = widget.selectedRestaurant;
    final controller = _controller;
    if (restaurant == null || controller == null) {
      return _empty(
        'Choose a Restaurant First',
        'Search Restaurants and choose Manage Dishes.',
        Icons.restaurant_menu_outlined,
      );
    }
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'Managing dishes for ' + restaurant.restaurantName,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              SizedBox(
                width: 320,
                child: TextField(
                  controller: _nameController,
                  onSubmitted: (_) => _applyCriteria(),
                  decoration: const InputDecoration(
                    labelText: 'Dish name prefix',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              SizedBox(
                width: 180,
                child: DropdownButtonFormField<AdminBiteScoreStatus>(
                  initialValue: _status,
                  decoration: const InputDecoration(
                    labelText: 'Status',
                    border: OutlineInputBorder(),
                  ),
                  items: AdminBiteScoreStatus.values
                      .map(
                        (status) => DropdownMenuItem(
                          value: status,
                          child: Text(status.label),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) {
                      setState(() => _status = value);
                      unawaited(_applyCriteria());
                    }
                  },
                ),
              ),
              FilledButton.icon(
                onPressed: controller.isLoading ? null : _applyCriteria,
                icon: const Icon(Icons.search),
                label: const Text('Search'),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Expanded(
            child: PagedDirectoryView<RatingAdminDishRecord>(
              controller: controller,
              onRefresh: controller.refreshCurrentPage,
              emptyBuilder: (_) => _empty(
                'No Dishes',
                'No dishes match for this restaurant.',
                Icons.restaurant_menu_outlined,
              ),
              itemBuilder: (context, record, _) {
                final dish = record.dish;
                return BiteRaterTheme.liftedCard(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: ListTile(
                    key: ValueKey(
                      'rating-dish-' + dish.restaurantId + ':' + dish.id,
                    ),
                    title: Text(
                      dish.name,
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    subtitle: Text(
                      <String>[
                        dish.restaurantName,
                        if ((dish.category ?? '').isNotEmpty) dish.category!,
                        if ((dish.priceLabel ?? '').isNotEmpty)
                          dish.priceLabel!,
                        'Status: ' +
                            (dish.isActive ? 'Available' : 'Unavailable'),
                      ].join('\n'),
                    ),
                    trailing: Wrap(
                      children: [
                        IconButton(
                          tooltip: dish.isActive
                              ? 'Mark unavailable'
                              : 'Mark available',
                          onPressed: _busy.contains('toggle:' + dish.id)
                              ? null
                              : () => _toggle(dish),
                          icon: Icon(
                            dish.isActive
                                ? Icons.visibility_off
                                : Icons.visibility,
                          ),
                        ),
                        IconButton(
                          tooltip: 'Edit dish',
                          onPressed: _busy.contains('edit:' + dish.id)
                              ? null
                              : () => _edit(dish),
                          icon: const Icon(Icons.edit_outlined),
                        ),
                        IconButton(
                          tooltip: 'Delete dish',
                          onPressed: _busy.contains('delete:' + dish.id)
                              ? null
                              : () => _delete(dish),
                          icon: const Icon(Icons.delete_outline),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class RatingAdminReviewPagedView extends StatefulWidget {
  const RatingAdminReviewPagedView({super.key, this.service});

  final RatingAdminPagingService? service;

  @override
  State<RatingAdminReviewPagedView> createState() =>
      _RatingAdminReviewPagedViewState();
}

class _RatingAdminReviewPagedViewState
    extends State<RatingAdminReviewPagedView> {
  late final PagedQueryController<RatingAdminReviewRecord> _controller;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    final service = widget.service ?? RatingAdminPagingService();
    _controller = PagedQueryController<RatingAdminReviewRecord>(
      pageLoader: service.loadReviewPage,
      criteria: RatingAdminPagingService.reviewCriteria,
      pageSize: RatingAdminPagingService.directoryPageSize,
      requestExactCount: true,
    );
    unawaited(_controller.loadInitial());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  String _date(DateTime? date) {
    if (date == null) return 'Date unavailable';
    return date.month.toString().padLeft(2, '0') +
        '/' +
        date.day.toString().padLeft(2, '0') +
        '/' +
        date.year.toString();
  }

  Future<void> _delete(RatingAdminReviewRecord entry) async {
    if (!await _confirm(
      context,
      title: 'Delete Review',
      message:
          'Delete this review for ' +
          entry.dishName +
          ' at ' +
          entry.restaurantName +
          '? Dish aggregates will be rebuilt automatically.',
    )) {
      return;
    }
    if (_busyId != null) return;
    setState(() => _busyId = entry.review.id);
    try {
      await BiteScoreService.deleteReviewAsAdmin(entry.review);
      if (!mounted) return;
      _snack(context, 'Review deleted and aggregate updated.');
      await _refreshAndRefill(_controller);
    } catch (error) {
      if (mounted) {
        _snack(
          context,
          AppErrorText.friendly(
            error,
            fallback: 'Could not delete the review right now.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: PagedDirectoryView<RatingAdminReviewRecord>(
        controller: _controller,
        onRefresh: _controller.refreshCurrentPage,
        emptyBuilder: (_) => _empty(
          'No Reviews Yet',
          'BiteScore reviews will appear here.',
          Icons.rate_review_outlined,
        ),
        itemBuilder: (context, entry, _) {
          final review = entry.review;
          return BiteRaterTheme.liftedCard(
            margin: const EdgeInsets.only(bottom: 12),
            child: ListTile(
              key: ValueKey('rating-review-' + review.id),
              title: Text(
                'Review by ' + entry.reviewerDisplayName,
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
              subtitle: Text(
                <String>[
                  entry.restaurantName + ' • ' + entry.dishName,
                  'Enjoyment: ' + review.overallImpression.toStringAsFixed(1),
                  'BiteScore: ' + review.overallBiteScore.toStringAsFixed(0),
                  _date(review.createdAt),
                  if ((review.headline ?? '').isNotEmpty)
                    'Headline: ' + review.headline!,
                  if ((review.notes ?? '').isNotEmpty)
                    'Notes: ' + review.notes!,
                ].join('\n'),
              ),
              trailing: IconButton(
                tooltip: 'Delete review',
                onPressed: _busyId == null ? () => _delete(entry) : null,
                icon: const Icon(Icons.delete_outline),
              ),
            ),
          );
        },
      ),
    );
  }
}

class RatingAdminQueuePagedView extends StatefulWidget {
  const RatingAdminQueuePagedView({
    super.key,
    required this.kind,
    required this.onEditRestaurant,
    required this.onEditDish,
    this.service,
    this.operationsService,
    this.loadRestaurant,
  });

  final RatingAdminQueueKind kind;
  final RatingAdminEditRestaurant onEditRestaurant;
  final RatingAdminEditDish onEditDish;
  final RatingAdminPagingService? service;
  final RatingDestructiveOperationsService? operationsService;
  final Future<BitescoreRestaurant?> Function(String id)? loadRestaurant;

  @override
  State<RatingAdminQueuePagedView> createState() =>
      _RatingAdminQueuePagedViewState();
}

class _RatingAdminQueuePagedViewState extends State<RatingAdminQueuePagedView> {
  late final RatingAdminPagingService _service;
  late final RatingDestructiveOperationsService _operationsService;
  late PagedQueryController<RatingAdminQueueRecord> _controller;
  final Set<String> _busy = <String>{};

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? RatingAdminPagingService();
    _operationsService =
        widget.operationsService ?? RatingDestructiveOperationsService();
    _controller = _newController(widget.kind);
    unawaited(_controller.loadInitial());
  }

  @override
  void didUpdateWidget(covariant RatingAdminQueuePagedView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.kind != widget.kind) {
      final old = _controller;
      _controller = _newController(widget.kind);
      old.dispose();
      unawaited(_controller.loadInitial());
    }
  }

  PagedQueryController<RatingAdminQueueRecord> _newController(
    RatingAdminQueueKind kind,
  ) {
    return PagedQueryController<RatingAdminQueueRecord>(
      pageLoader: _service.loadQueuePage,
      criteria: RatingAdminPagingService.queueCriteria(kind),
      pageSize: RatingAdminPagingService.queuePageSize,
      requestExactCount: true,
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _run(
    RatingAdminQueueRecord record,
    Future<void> Function() action,
    String success,
    String failure,
  ) async {
    final key = record.kind.wireName + ':' + record.id;
    if (!_busy.add(key)) return;
    setState(() {});
    try {
      await action();
      if (!mounted) return;
      _snack(context, success);
      await _refreshAndRefill(_controller);
    } catch (error) {
      if (mounted) {
        _snack(context, AppErrorText.friendly(error, fallback: failure));
      }
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  Future<void> _runDestructive(
    RatingAdminQueueRecord record,
    Future<RatingDestructiveOperationSummary> Function() action,
    String failure,
  ) async {
    final key = 'destructive:' + record.kind.wireName + ':' + record.id;
    if (!_busy.add(key)) return;
    final originatingController = _controller;
    var refreshed = false;
    Future<void> refreshOriginOnce() async {
      if (refreshed ||
          !mounted ||
          !identical(originatingController, _controller)) {
        return;
      }
      refreshed = true;
      await _refreshAndRefill(originatingController);
    }

    setState(() {});
    try {
      final summary = await action();
      if (!mounted || !identical(originatingController, _controller)) return;
      if (summary.complete) await refreshOriginOnce();
      if (!mounted || !identical(originatingController, _controller)) return;
      showRatingDestructiveOperationFeedback(
        context,
        service: _operationsService,
        summary: summary,
        onComplete: refreshOriginOnce,
      );
    } on RatingDestructiveOperationsException catch (error) {
      if (mounted && identical(originatingController, _controller)) {
        _snack(context, error.message);
      }
    } catch (error) {
      if (mounted && identical(originatingController, _controller)) {
        _snack(context, AppErrorText.friendly(error, fallback: failure));
      }
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  BiteScoreReportedReviewAdminEntry _reportedReviewEntry(
    RatingAdminQueueRecord record,
  ) {
    final review = record.reportedReview;
    return BiteScoreReportedReviewAdminEntry(
      review: review.review,
      dishName: review.dishName,
      restaurantName: review.restaurantName,
      reviewerDisplayName: review.reviewerDisplayName,
      reports: <ReviewReport>[record.reviewReport],
    );
  }

  BiteScoreReportedRestaurantAdminEntry _restaurantEntry(
    RatingAdminQueueRecord record,
  ) {
    return BiteScoreReportedRestaurantAdminEntry(
      restaurant: record.restaurant!,
      reports: <RestaurantReport>[record.restaurantReport],
    );
  }

  BiteScoreReportedDishAdminEntry _dishEntry(RatingAdminQueueRecord record) {
    return BiteScoreReportedDishAdminEntry(
      dish: record.dish,
      restaurant: record.restaurant,
      reports: <DishReport>[record.dishReport],
    );
  }

  BiteScoreDuplicateRestaurantReportAdminEntry _duplicateEntry(
    RatingAdminQueueRecord record,
  ) {
    return BiteScoreDuplicateRestaurantReportAdminEntry(
      restaurant: record.restaurant!,
      reports: <DuplicateRestaurantReport>[record.duplicateRestaurantReport],
    );
  }

  Future<void> _editRestaurant(
    RatingAdminQueueRecord record,
    String restaurantDocumentId,
  ) async {
    if (restaurantDocumentId.isEmpty) {
      _snack(context, 'This restaurant is no longer available.');
      return;
    }
    final key = record.kind.wireName + ':' + record.id;
    if (!_busy.add(key)) return;
    setState(() {});
    try {
      final restaurant =
          await (widget.loadRestaurant?.call(restaurantDocumentId) ??
              BiteScoreService.loadRestaurantById(restaurantDocumentId));
      if (!mounted) return;
      if (restaurant == null || restaurant.id != restaurantDocumentId) {
        _snack(context, 'This restaurant is no longer available.');
        return;
      }
      if (await widget.onEditRestaurant(restaurant) == true && mounted) {
        _snack(context, restaurant.name + ' updated.');
        await _controller.refreshCurrentPage();
      }
    } catch (error) {
      if (mounted) {
        _snack(
          context,
          AppErrorText.friendly(
            error,
            fallback: 'Could not edit the restaurant right now.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  Future<void> _merge(RatingAdminQueueRecord record) async {
    final duplicate = record.restaurant;
    if (duplicate == null) return;
    final surviving = await showDialog<BitescoreRestaurant>(
      context: context,
      builder: (context) => RatingAdminMergeCandidateDialog(
        duplicateRestaurant: duplicate,
        service: _service,
        loadRestaurant: widget.loadRestaurant,
      ),
    );
    if (surviving == null || !mounted) return;
    final confirmed = await _confirm(
      context,
      title: 'Confirm Merge',
      message:
          'Merge ' +
          duplicate.name +
          ' into ' +
          surviving.name +
          '? The selected restaurant will survive.',
      action: 'Merge',
    );
    if (!confirmed || !mounted) return;
    await _runDestructive(
      record,
      () => _operationsService.startRestaurantMerge(
        sourceRestaurantId: duplicate.id,
        targetRestaurantId: surviving.id,
        expectedSourceRestaurantRevision: duplicate.restaurantWriteRevision,
        expectedTargetRestaurantRevision: surviving.restaurantWriteRevision,
      ),
      'Could not merge these restaurants right now.',
    );
  }

  Widget _reportedReviewCard(RatingAdminQueueRecord record) {
    final entry = _reportedReviewEntry(record);
    final review = entry.review;
    return _card(
      record,
      'Review by ' + entry.reviewerDisplayName,
      <String>[
        entry.restaurantName + ' - ' + entry.dishName,
        'Report ID: ' + record.id,
        'Status: ' + record.status,
        if ((record.reason ?? '').isNotEmpty) 'Reason: ' + record.reason!,
        if ((review.headline ?? '').isNotEmpty) 'Headline: ' + review.headline!,
        if ((review.notes ?? '').isNotEmpty) 'Notes: ' + review.notes!,
      ],
      <Widget>[
        OutlinedButton(
          onPressed: () => _run(
            record,
            () => BiteScoreService.dismissReportedReviewAsAdmin(entry),
            'Report dismissed.',
            'Could not dismiss this report right now.',
          ),
          child: const Text('Dismiss Report'),
        ),
        FilledButton(
          onPressed: () async {
            if (!await _confirm(
              context,
              title: 'Delete Review',
              message: 'Delete this reported review?',
            )) {
              return;
            }
            await _run(
              record,
              () => BiteScoreService.deleteReviewAsAdmin(review),
              'Review deleted and aggregate updated.',
              'Could not delete the review right now.',
            );
          },
          child: const Text('Delete Review'),
        ),
      ],
    );
  }

  Widget _restaurantReportCard(RatingAdminQueueRecord record) {
    final entry = _restaurantEntry(record);
    return _card(
      record,
      entry.restaurant.name,
      <String>[
        entry.restaurant.city + ', ' + entry.restaurant.state,
        'Report ID: ' + record.id,
        if ((record.reason ?? '').isNotEmpty) 'Reason: ' + record.reason!,
      ],
      <Widget>[
        OutlinedButton(
          onPressed: () => _run(
            record,
            () => BiteScoreService.dismissReportedRestaurantAsAdmin(entry),
            'Restaurant report dismissed.',
            'Could not dismiss this restaurant report right now.',
          ),
          child: const Text('Dismiss'),
        ),
        OutlinedButton(
          onPressed: () =>
              _editRestaurant(record, record.restaurantReport.restaurantId),
          child: const Text('Edit Restaurant'),
        ),
        FilledButton.tonal(
          onPressed: () async {
            if (!await _confirm(
              context,
              title: 'Delete Restaurant',
              message: 'Delete ' + entry.restaurant.name + '?',
            )) {
              return;
            }
            await _runDestructive(
              record,
              () => _operationsService.startRestaurantDelete(
                restaurantId: entry.restaurant.id,
                expectedRestaurantRevision:
                    entry.restaurant.restaurantWriteRevision,
              ),
              'Could not delete the restaurant right now.',
            );
          },
          child: const Text('Delete Restaurant'),
        ),
      ],
    );
  }

  Widget _dishReportCard(RatingAdminQueueRecord record) {
    final entry = _dishEntry(record);
    return _card(
      record,
      entry.dish.name,
      <String>[
        'Restaurant: ' + (entry.restaurant?.name ?? entry.dish.restaurantName),
        'Report ID: ' + record.id,
        if ((record.reason ?? '').isNotEmpty) 'Reason: ' + record.reason!,
      ],
      <Widget>[
        OutlinedButton(
          onPressed: () => _run(
            record,
            () => BiteScoreService.dismissReportedDishAsAdmin(entry),
            'Dish report dismissed.',
            'Could not dismiss this dish report right now.',
          ),
          child: const Text('Dismiss'),
        ),
        FilledButton.tonal(
          onPressed: () async {
            if (!await _confirm(
              context,
              title: 'Delete Dish',
              message: 'Delete ' + entry.dish.name + '?',
            )) {
              return;
            }
            await _runDestructive(
              record,
              () => _operationsService.startDishDelete(dishId: entry.dish.id),
              'Could not delete the dish right now.',
            );
          },
          child: const Text('Delete Dish'),
        ),
      ],
    );
  }

  Widget _duplicateCard(RatingAdminQueueRecord record) {
    final entry = _duplicateEntry(record);
    return _card(
      record,
      entry.restaurant.name,
      <String>[
        entry.restaurant.address +
            ', ' +
            entry.restaurant.city +
            ', ' +
            entry.restaurant.state,
        'Report ID: ' + record.id,
        if ((record.reason ?? '').isNotEmpty) 'Reason: ' + record.reason!,
      ],
      <Widget>[
        OutlinedButton(
          onPressed: () => _editRestaurant(
            record,
            record.duplicateRestaurantReport.restaurantId,
          ),
          child: const Text('Edit Restaurant'),
        ),
        OutlinedButton(
          onPressed: () => _merge(record),
          child: const Text('Merge Into...'),
        ),
        FilledButton.tonal(
          onPressed: () => _run(
            record,
            () =>
                BiteScoreService.resolveDuplicateRestaurantReportAsAdmin(entry),
            'Duplicate restaurant report resolved.',
            'Could not resolve this duplicate report right now.',
          ),
          child: const Text('Resolve'),
        ),
      ],
    );
  }

  Widget _claimCard(RatingAdminQueueRecord record) {
    final request = record.claim;
    final restaurant = record.restaurant;
    return _card(
      record,
      request.restaurantName,
      <String>[
        'Claimant: ' + request.claimantName,
        'Email: ' + request.email,
        'Phone: ' + request.phone,
        if ((request.requesterUserId ?? '').isNotEmpty)
          'User ID: ' + request.requesterUserId!,
        if (restaurant != null)
          restaurant.address +
              ', ' +
              restaurant.city +
              ', ' +
              restaurant.state +
              ' ' +
              restaurant.zipCode,
        if ((request.message ?? '').isNotEmpty) 'Message: ' + request.message!,
      ],
      <Widget>[
        ElevatedButton(
          onPressed: () => _run(
            record,
            () => BiteScoreService.approveClaimAsAdmin(request),
            'Claim approved.',
            'Could not approve the claim right now.',
          ),
          child: const Text('Approve'),
        ),
        OutlinedButton(
          onPressed: () => _run(
            record,
            () => BiteScoreService.rejectClaimAsAdmin(request),
            'Claim rejected.',
            'Could not reject the claim right now.',
          ),
          child: const Text('Reject'),
        ),
      ],
    );
  }

  Widget _card(
    RatingAdminQueueRecord record,
    String title,
    List<String> lines,
    List<Widget> actions,
  ) {
    final busy = _busy.contains(record.kind.wireName + ':' + record.id);
    return IgnorePointer(
      ignoring: busy,
      child: BiteRaterTheme.liftedCard(
        margin: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(lines.join('\n')),
              const SizedBox(height: 12),
              Wrap(spacing: 8, runSpacing: 8, children: actions),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final title = switch (widget.kind) {
      RatingAdminQueueKind.reportedReviews => 'No Reported Reviews',
      RatingAdminQueueKind.restaurantReports => 'No Restaurant Reports',
      RatingAdminQueueKind.dishReports => 'No Dish Reports',
      RatingAdminQueueKind.duplicateRestaurantReports => 'No Duplicate Reports',
      RatingAdminQueueKind.claims => 'No Pending Claims',
    };
    return Padding(
      padding: const EdgeInsets.all(16),
      child: PagedDirectoryView<RatingAdminQueueRecord>(
        controller: _controller,
        onRefresh: _controller.refreshCurrentPage,
        emptyBuilder: (_) => _empty(
          title,
          'There are no pending items in this queue.',
          Icons.inbox_outlined,
        ),
        itemBuilder: (context, record, _) => switch (record.kind) {
          RatingAdminQueueKind.reportedReviews => _reportedReviewCard(record),
          RatingAdminQueueKind.restaurantReports => _restaurantReportCard(
            record,
          ),
          RatingAdminQueueKind.dishReports => _dishReportCard(record),
          RatingAdminQueueKind.duplicateRestaurantReports => _duplicateCard(
            record,
          ),
          RatingAdminQueueKind.claims => _claimCard(record),
        },
      ),
    );
  }
}

class RatingAdminDataReportsPagedView extends StatefulWidget {
  const RatingAdminDataReportsPagedView({
    super.key,
    required this.onEditRestaurant,
    required this.onEditDish,
    this.service,
    this.operationsService,
  });

  final RatingAdminEditRestaurant onEditRestaurant;
  final RatingAdminEditDish onEditDish;
  final RatingAdminPagingService? service;
  final RatingDestructiveOperationsService? operationsService;

  @override
  State<RatingAdminDataReportsPagedView> createState() =>
      _RatingAdminDataReportsPagedViewState();
}

class _RatingAdminDataReportsPagedViewState
    extends State<RatingAdminDataReportsPagedView> {
  RatingAdminQueueKind _kind = RatingAdminQueueKind.restaurantReports;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          child: DropdownButtonFormField<RatingAdminQueueKind>(
            key: const ValueKey('rating-data-report-kind'),
            initialValue: _kind,
            decoration: const InputDecoration(
              labelText: 'Report queue',
              border: OutlineInputBorder(),
            ),
            items: const <DropdownMenuItem<RatingAdminQueueKind>>[
              DropdownMenuItem(
                value: RatingAdminQueueKind.restaurantReports,
                child: Text('Restaurant Reports'),
              ),
              DropdownMenuItem(
                value: RatingAdminQueueKind.dishReports,
                child: Text('Dish Reports'),
              ),
              DropdownMenuItem(
                value: RatingAdminQueueKind.duplicateRestaurantReports,
                child: Text('Duplicate-Restaurant Reports'),
              ),
            ],
            onChanged: (value) {
              if (value != null) setState(() => _kind = value);
            },
          ),
        ),
        Expanded(
          child: RatingAdminQueuePagedView(
            key: ValueKey(_kind.wireName),
            kind: _kind,
            service: widget.service,
            operationsService: widget.operationsService,
            onEditRestaurant: widget.onEditRestaurant,
            onEditDish: widget.onEditDish,
          ),
        ),
      ],
    );
  }
}

class RatingAdminClaimedRestaurantsPagedView extends StatefulWidget {
  const RatingAdminClaimedRestaurantsPagedView({
    super.key,
    required this.onViewRestaurant,
    this.service,
  });

  final Future<void> Function(BitescoreRestaurant restaurant) onViewRestaurant;
  final RatingAdminPagingService? service;

  @override
  State<RatingAdminClaimedRestaurantsPagedView> createState() =>
      _RatingAdminClaimedRestaurantsPagedViewState();
}

class _RatingAdminClaimedRestaurantsPagedViewState
    extends State<RatingAdminClaimedRestaurantsPagedView> {
  late final PagedQueryController<RatingAdminClaimedRestaurantRecord>
  _controller;
  final _nameController = TextEditingController();
  String? _busyId;

  @override
  void initState() {
    super.initState();
    final service = widget.service ?? RatingAdminPagingService();
    _controller = PagedQueryController<RatingAdminClaimedRestaurantRecord>(
      pageLoader: service.loadClaimedRestaurantPage,
      criteria: RatingAdminPagingService.claimedRestaurantCriteria(),
      pageSize: RatingAdminPagingService.directoryPageSize,
      requestExactCount: true,
    );
    unawaited(_controller.loadInitial());
  }

  @override
  void dispose() {
    _nameController.dispose();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _search() {
    return _controller.updateCriteria(
      RatingAdminPagingService.claimedRestaurantCriteria(
        restaurantName: _nameController.text,
      ),
    );
  }

  String _date(RatingAdminClaimedRestaurantRecord entry) {
    final value =
        entry.approvedClaim?.updatedAt ?? entry.approvedClaim?.createdAt;
    if (value == null) return 'Date unavailable';
    return value.month.toString().padLeft(2, '0') +
        '/' +
        value.day.toString().padLeft(2, '0') +
        '/' +
        value.year.toString();
  }

  Future<void> _unclaim(RatingAdminClaimedRestaurantRecord record) async {
    if (!await _confirm(
      context,
      title: 'Remove Owner',
      message:
          'Remove the approved owner from ' +
          record.restaurant.name +
          '? The restaurant will become unclaimed.',
      action: 'Remove Owner',
    )) {
      return;
    }
    if (_busyId != null) return;
    setState(() => _busyId = record.restaurant.id);
    try {
      await BiteScoreService.unclaimRestaurantAsAdmin(record.restaurant);
      if (!mounted) return;
      _snack(context, record.restaurant.name + ' is now unclaimed.');
      await _refreshAndRefill(_controller);
    } catch (error) {
      if (mounted) {
        _snack(
          context,
          AppErrorText.friendly(
            error,
            fallback: 'Could not remove the owner right now.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _nameController,
                  onSubmitted: (_) => _search(),
                  decoration: const InputDecoration(
                    labelText: 'Restaurant name prefix',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                tooltip: 'Search claimed restaurants',
                constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                onPressed: _controller.isLoading ? null : _search,
                icon: const Icon(Icons.search),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Expanded(
            child: PagedDirectoryView<RatingAdminClaimedRestaurantRecord>(
              controller: _controller,
              onRefresh: _controller.refreshCurrentPage,
              emptyBuilder: (_) => _empty(
                'No Claimed Restaurants',
                'No claimed restaurants match the current name.',
                Icons.verified_outlined,
              ),
              itemBuilder: (context, record, _) {
                final restaurant = record.restaurant;
                final claim = record.approvedClaim;
                return BiteRaterTheme.liftedCard(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: ListTile(
                    key: ValueKey('rating-claimed-' + restaurant.id),
                    title: Text(
                      restaurant.name,
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if ((claim?.email ?? '').isNotEmpty)
                          Text('Owner email: ' + claim!.email),
                        if ((restaurant.ownerUserId ?? '').isNotEmpty)
                          Text('Owner user ID: ' + restaurant.ownerUserId!),
                        const Text('Approval status: Approved'),
                        Text('Approval date: ' + _date(record)),
                        if ((claim?.phone ?? '').isNotEmpty)
                          ClickablePhoneText(
                            phone: claim!.phone,
                            prefix: 'Owner phone: ',
                          ),
                      ],
                    ),
                    trailing: Wrap(
                      children: [
                        IconButton(
                          tooltip: 'View restaurant',
                          onPressed: () => widget.onViewRestaurant(restaurant),
                          icon: const Icon(Icons.open_in_new),
                        ),
                        IconButton(
                          tooltip: 'Remove owner',
                          onPressed: _busyId == null
                              ? () => _unclaim(record)
                              : null,
                          icon: const Icon(Icons.person_remove_outlined),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class RatingAdminMergeCandidateDialog extends StatefulWidget {
  const RatingAdminMergeCandidateDialog({
    super.key,
    required this.duplicateRestaurant,
    required this.service,
    this.loadRestaurant,
  });

  final BitescoreRestaurant duplicateRestaurant;
  final RatingAdminPagingService service;
  final Future<BitescoreRestaurant?> Function(String id)? loadRestaurant;

  @override
  State<RatingAdminMergeCandidateDialog> createState() =>
      _RatingAdminMergeCandidateDialogState();
}

class _RatingAdminMergeCandidateDialogState
    extends State<RatingAdminMergeCandidateDialog> {
  late final TextEditingController _locationController;
  final _nameController = TextEditingController();
  RatingAdminRestaurantSearchMode _mode =
      RatingAdminRestaurantSearchMode.exactZip;
  PagedQueryController<RatingAdminRestaurantRecord>? _controller;
  String? _loadingId;

  @override
  void initState() {
    super.initState();
    final zip = widget.duplicateRestaurant.zipCode.trim();
    if (RegExp(r'^\d{5}(?:-\d{4})?$').hasMatch(zip)) {
      _locationController = TextEditingController(text: zip);
    } else {
      _mode = RatingAdminRestaurantSearchMode.exactCity;
      _locationController = TextEditingController(
        text:
            widget.duplicateRestaurant.city +
            ', ' +
            widget.duplicateRestaurant.state,
      );
    }
    unawaited(_search());
  }

  @override
  void dispose() {
    _locationController.dispose();
    _nameController.dispose();
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    Map<String, Object?> criteria;
    try {
      criteria = RatingAdminPagingService.restaurantCriteria(
        mode: _mode,
        location: _locationController.text,
        radiusMiles: 10,
        status: AdminBiteScoreStatus.active,
        restaurantName: _nameController.text,
      );
    } on RatingAdminPagingException catch (error) {
      if (mounted) _snack(context, error.message);
      return;
    }
    final next = PagedQueryController<RatingAdminRestaurantRecord>(
      pageLoader: widget.service.loadRestaurantPage,
      criteria: criteria,
      pageSize: RatingAdminPagingService.restaurantPageSize,
      requestExactCount: true,
    );
    final old = _controller;
    setState(() => _controller = next);
    old?.dispose();
    await next.loadInitial();
  }

  Future<void> _choose(RatingAdminRestaurantRecord record) async {
    if (record.documentId == widget.duplicateRestaurant.id ||
        _loadingId != null) {
      return;
    }
    setState(() => _loadingId = record.documentId);
    try {
      final restaurant =
          await (widget.loadRestaurant?.call(record.documentId) ??
              BiteScoreService.loadRestaurantById(record.documentId));
      if (!mounted) return;
      if (restaurant == null || restaurant.id != record.documentId) {
        _snack(context, 'This restaurant is no longer available.');
        return;
      }
      Navigator.of(context).pop(restaurant);
    } finally {
      if (mounted) setState(() => _loadingId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return AlertDialog(
      title: const Text('Merge Duplicate Restaurant'),
      content: SizedBox(
        width: 720,
        height: 600,
        child: Column(
          children: [
            Text(
              'Choose a surviving restaurant for ' +
                  widget.duplicateRestaurant.name +
                  '.',
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                SizedBox(
                  width: 180,
                  child:
                      DropdownButtonFormField<RatingAdminRestaurantSearchMode>(
                        isExpanded: true,
                        initialValue: _mode,
                        decoration: const InputDecoration(
                          labelText: 'Mode',
                          border: OutlineInputBorder(),
                        ),
                        items:
                            const <
                              DropdownMenuItem<RatingAdminRestaurantSearchMode>
                            >[
                              DropdownMenuItem(
                                value: RatingAdminRestaurantSearchMode.exactZip,
                                child: Text(
                                  'Exact ZIP',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              DropdownMenuItem(
                                value:
                                    RatingAdminRestaurantSearchMode.exactCity,
                                child: Text(
                                  'Exact City',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                        onChanged: (value) {
                          if (value != null) setState(() => _mode = value);
                        },
                      ),
                ),
                SizedBox(
                  width: 220,
                  child: TextField(
                    controller: _locationController,
                    decoration: const InputDecoration(
                      labelText: 'ZIP or City, ST',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                SizedBox(
                  width: 220,
                  child: TextField(
                    controller: _nameController,
                    onSubmitted: (_) => _search(),
                    decoration: const InputDecoration(
                      labelText: 'Name prefix (optional)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                FilledButton.icon(
                  onPressed: controller?.isLoading == true ? null : _search,
                  icon: const Icon(Icons.search),
                  label: const Text('Search'),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Expanded(
              child: controller == null
                  ? const Center(child: CircularProgressIndicator())
                  : PagedDirectoryView<RatingAdminRestaurantRecord>(
                      controller: controller,
                      onRefresh: controller.refreshFirstPage,
                      emptyBuilder: (_) => _empty(
                        'No Candidates',
                        'Search another ZIP, city, or name.',
                        Icons.merge_type,
                      ),
                      itemBuilder: (context, record, _) {
                        final isDuplicate =
                            record.documentId == widget.duplicateRestaurant.id;
                        return ListTile(
                          key: ValueKey('merge-candidate-' + record.documentId),
                          title: Text(record.restaurantName),
                          subtitle: Text(
                            record.streetAddress +
                                '\n' +
                                record.city +
                                ', ' +
                                record.state +
                                ' ' +
                                record.zipCode,
                          ),
                          trailing: FilledButton(
                            onPressed: isDuplicate || _loadingId != null
                                ? null
                                : () => _choose(record),
                            child: Text(
                              isDuplicate ? 'Current duplicate' : 'Select',
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
      ],
    );
  }
}
