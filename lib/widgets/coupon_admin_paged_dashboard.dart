import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/coupon.dart';
import '../models/coupon_admin_paging_models.dart';
import '../models/pagination/paged_models.dart';
import '../models/restaurant.dart';
import '../services/app_error_text.dart';
import '../services/bitesaver_restaurant_lifecycle_service.dart';
import '../services/coupon_admin_paging_service.dart';
import '../services/paged_query_controller.dart';
import '../services/restaurant_account_service.dart';
import '../services/restaurant_invite_service.dart';
import 'admin_pagination_bar.dart';
import 'clickable_phone_text.dart';
import 'paged_directory_view.dart';

typedef CouponAdminAccountLoader =
    Future<Map<String, dynamic>?> Function(String documentId);
typedef CouponAdminApplicationReviewAction =
    Future<BiteSaverApplicationReviewResult> Function({
      required String documentId,
      required BiteSaverApplicationDecision decision,
      required int expectedProfileVersion,
    });
typedef CouponAdminDeleteCouponAction =
    Future<void> Function({
      required String documentId,
      required String couponId,
    });
typedef CouponAdminEditAccountAction =
    Future<bool?> Function({
      required BuildContext context,
      required String documentId,
      required Map<String, dynamic> data,
    });
typedef CouponAdminCreateInviteAction =
    Future<RestaurantInviteCreationResult> Function({
      required String restaurantId,
      required String restaurantName,
      required String streetAddress,
      required String city,
      required String state,
      required String zipCode,
      required String phone,
      required String website,
      required double? latitude,
      required double? longitude,
    });
typedef CouponAdminManualInviteCreator =
    Future<RestaurantInviteCreationResult> Function({
      required String restaurantName,
      String? restaurantId,
      String? biteScoreCatalogRestaurantId,
      String? streetAddress,
      String? city,
      String? state,
      String? zipCode,
      String? phone,
      String? website,
      double? latitude,
      double? longitude,
    });
typedef CouponAdminManualInviteAction =
    Future<RestaurantInviteCreationResult?> Function(BuildContext context);
typedef CouponAdminSetVisibilityAction =
    Future<void> Function({
      required String documentId,
      required bool expectedAdminHidden,
      required bool adminHidden,
    });

class CouponAdminPagedDashboard extends StatefulWidget {
  const CouponAdminPagedDashboard({
    super.key,
    this.pagingService,
    this.lifecycleService,
    this.loadAccount,
    this.reviewApplication,
    this.deleteCoupon,
    this.editAccount,
    this.createCouponInvite,
    this.createManualInvite,
    this.setRestaurantVisibility,
  });

  final CouponAdminPagingService? pagingService;
  final BiteSaverRestaurantLifecycleService? lifecycleService;
  final CouponAdminAccountLoader? loadAccount;
  final CouponAdminApplicationReviewAction? reviewApplication;
  final CouponAdminDeleteCouponAction? deleteCoupon;
  final CouponAdminEditAccountAction? editAccount;
  final CouponAdminCreateInviteAction? createCouponInvite;
  final CouponAdminManualInviteAction? createManualInvite;
  final CouponAdminSetVisibilityAction? setRestaurantVisibility;

  @override
  State<CouponAdminPagedDashboard> createState() =>
      _CouponAdminPagedDashboardState();
}

class _CouponAdminPagedDashboardState extends State<CouponAdminPagedDashboard>
    with SingleTickerProviderStateMixin {
  static const List<int> _radiusOptions = <int>[1, 3, 5, 10, 15, 20, 30, 50];

  late final CouponAdminPagingService _service;
  late final BiteSaverRestaurantLifecycleService _lifecycleService;
  late final TabController _tabController;
  late final PagedQueryController<CouponAdminQueueRecord> _pendingController;
  late final PagedQueryController<CouponAdminQueueRecord> _nameController;
  late final PagedQueryController<CouponAdminQueueRecord> _reportController;
  final TextEditingController _locationController = TextEditingController();
  final TextEditingController _restaurantNameController =
      TextEditingController();
  final GlobalKey<FormState> _searchFormKey = GlobalKey<FormState>();
  final Set<String> _busyActions = <String>{};
  final Map<String, PagedQueryController<CouponAdminCouponRecord>>
  _couponControllers =
      <String, PagedQueryController<CouponAdminCouponRecord>>{};
  final Set<String> _expandedRestaurants = <String>{};

  PagedQueryController<CouponAdminRestaurantRecord>? _restaurantController;
  CouponAdminRestaurantSearchMode _searchMode =
      CouponAdminRestaurantSearchMode.nearbyRadius;
  int _radiusMiles = 10;
  int _searchGeneration = 0;
  bool _searchSubmitting = false;
  Map<String, Object?>? _activeSearchCriteria;
  int _lastTabIndex = 0;
  String? _criteriaSummary;

  @override
  void initState() {
    super.initState();
    _service = widget.pagingService ?? CouponAdminPagingService();
    _lifecycleService =
        widget.lifecycleService ?? BiteSaverRestaurantLifecycleService();
    _tabController = TabController(length: 4, vsync: this)
      ..addListener(_handleTabChange);
    _pendingController = _queueController(
      CouponAdminQueueKind.pendingApplications,
    );
    _nameController = _queueController(CouponAdminQueueKind.nameChanges);
    _reportController = _queueController(CouponAdminQueueKind.openReports);
  }

  PagedQueryController<CouponAdminQueueRecord> _queueController(
    CouponAdminQueueKind kind,
  ) {
    return PagedQueryController<CouponAdminQueueRecord>(
      pageLoader: _service.loadQueuePage,
      criteria: <String, Object?>{'queueKind': kind.wireName},
      pageSize: CouponAdminPagingService.queuePageSize,
      requestExactCount: true,
    );
  }

  void _handleTabChange() {
    if (_tabController.indexIsChanging) return;
    if (_lastTabIndex != _tabController.index) {
      switch (_lastTabIndex) {
        case 1:
          _invalidateQueueRequestIfLoading(
            _pendingController,
            CouponAdminQueueKind.pendingApplications,
          );
        case 2:
          _invalidateQueueRequestIfLoading(
            _nameController,
            CouponAdminQueueKind.nameChanges,
          );
        case 3:
          _invalidateQueueRequestIfLoading(
            _reportController,
            CouponAdminQueueKind.openReports,
          );
      }
      _lastTabIndex = _tabController.index;
    }
    switch (_tabController.index) {
      case 1:
        unawaited(_pendingController.loadInitial());
      case 2:
        unawaited(_nameController.loadInitial());
      case 3:
        unawaited(_reportController.loadInitial());
    }
  }

  void _invalidateQueueRequestIfLoading(
    PagedQueryController<CouponAdminQueueRecord> controller,
    CouponAdminQueueKind kind,
  ) {
    if (!controller.isLoading) return;
    unawaited(
      controller.updateCriteria(<String, Object?>{
        'queueKind': kind.wireName,
      }, load: false),
    );
  }

  @override
  void dispose() {
    _searchGeneration += 1;
    _tabController
      ..removeListener(_handleTabChange)
      ..dispose();
    _locationController.dispose();
    _restaurantNameController.dispose();
    _restaurantController?.dispose();
    _pendingController.dispose();
    _nameController.dispose();
    _reportController.dispose();
    for (final controller in _couponControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _submitSearch() async {
    if (!(_searchFormKey.currentState?.validate() ?? false)) return;
    Map<String, Object?> criteria;
    try {
      criteria = CouponAdminPagingService.restaurantCriteria(
        mode: _searchMode,
        location: _locationController.text,
        radiusMiles: _radiusMiles,
        restaurantName: _restaurantNameController.text,
      );
    } on CouponAdminPagingException catch (error) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.message)));
      return;
    }
    final activeInputCriteria = _activeSearchCriteria == null
        ? null
        : (Map<String, Object?>.from(_activeSearchCriteria!)
            ..remove('searchInstanceId'));
    if (_searchSubmitting && mapEquals(criteria, activeInputCriteria)) {
      return;
    }
    FocusScope.of(context).unfocus();
    await _startRestaurantSearch(criteria);
  }

  Future<void> _startRestaurantSearch(Map<String, Object?> criteria) async {
    final generation = ++_searchGeneration;
    if (criteria['mode'] == 'nearbyRadius') {
      criteria = <String, Object?>{...criteria, 'searchInstanceId': generation};
    }
    final oldController = _restaurantController;
    final controller = PagedQueryController<CouponAdminRestaurantRecord>(
      pageLoader: _service.loadRestaurantPage,
      criteria: criteria,
      pageSize: CouponAdminPagingService.restaurantPageSize,
      requestExactCount: true,
    );
    setState(() {
      _searchSubmitting = true;
      _activeSearchCriteria = Map<String, Object?>.unmodifiable(criteria);
      _restaurantController = controller;
      _criteriaSummary = _buildCriteriaSummary(criteria);
      _clearCouponControllers();
    });
    oldController?.dispose();
    try {
      await controller.loadInitial();
      await _continueRadiusPreparation(controller, generation);
    } finally {
      if (mounted && generation == _searchGeneration) {
        setState(() => _searchSubmitting = false);
      }
    }
  }

  Future<void> _refreshRestaurantDirectory() async {
    final criteria = _activeSearchCriteria;
    final controller = _restaurantController;
    if (criteria == null || controller == null) return;
    if (criteria['mode'] != 'nearbyRadius') {
      await controller.refreshCurrentPage();
      return;
    }
    final refreshedCriteria = Map<String, Object?>.from(criteria)
      ..remove('searchInstanceId');
    await _startRestaurantSearch(refreshedCriteria);
  }

  String _buildCriteriaSummary(Map<String, Object?> criteria) {
    final modeLabel = switch (criteria['mode']) {
      'nearbyRadius' => CouponAdminRestaurantSearchMode.nearbyRadius.label,
      'exactZip' => CouponAdminRestaurantSearchMode.exactZip.label,
      'exactCity' => CouponAdminRestaurantSearchMode.exactCity.label,
      _ => 'Restaurant search',
    };
    final name = criteria['restaurantName'];
    final location =
        criteria['zipCode'] ??
        (criteria.containsKey('city')
            ? '${criteria['city']}, ${criteria['state']}'
            : criteria['locationQuery']);
    final radius = criteria['radiusMiles'];
    return '$modeLabel: $location'
        '${radius == null ? '' : ' • $radius miles'}'
        '${name == null ? '' : ' • Name: $name'}';
  }

  Future<void> _continueRadiusPreparation(
    PagedQueryController<CouponAdminRestaurantRecord> controller,
    int generation,
  ) async {
    while (mounted &&
        generation == _searchGeneration &&
        identical(controller, _restaurantController) &&
        controller.page?.preparation?.state == PagePreparationState.preparing &&
        controller.error == null) {
      await Future<void>.delayed(const Duration(milliseconds: 350));
      if (!mounted || generation != _searchGeneration) return;
      await controller.nextPage();
    }
  }

  void _clearCouponControllers() {
    for (final controller in _couponControllers.values) {
      controller.dispose();
    }
    _couponControllers.clear();
    _expandedRestaurants.clear();
  }

  PagedQueryController<CouponAdminCouponRecord> _couponController(String id) {
    return _couponControllers.putIfAbsent(
      id,
      () => PagedQueryController<CouponAdminCouponRecord>(
        pageLoader: _service.loadCouponPage,
        criteria: <String, Object?>{'restaurantAccountId': id},
        pageSize: CouponAdminPagingService.couponPageSize,
        requestExactCount: true,
      ),
    );
  }

  void _toggleCoupons(String restaurantId, bool expanded) {
    if (expanded) {
      setState(() => _expandedRestaurants.add(restaurantId));
      unawaited(_couponController(restaurantId).loadInitial());
      return;
    }
    final controller = _couponControllers.remove(restaurantId);
    controller?.dispose();
    setState(() => _expandedRestaurants.remove(restaurantId));
  }

  String _actionKey(String entity, String id, String action) =>
      '$entity:$id:$action';

  Future<void> _busy(
    String entity,
    String id,
    String action,
    Future<void> Function() callback,
  ) async {
    final key = _actionKey(entity, id, action);
    if (_busyActions.contains(key)) return;
    setState(() => _busyActions.add(key));
    try {
      await callback();
    } finally {
      if (mounted) setState(() => _busyActions.remove(key));
    }
  }

  bool _isBusy(String entity, String id, String action) =>
      _busyActions.contains(_actionKey(entity, id, action));

  Future<Map<String, dynamic>?> _loadAccount(String id) {
    return widget.loadAccount?.call(id) ??
        RestaurantAccountService.loadAccountByDocumentId(id);
  }

  Future<void> _reviewApplication(
    CouponAdminQueueRecord record,
    bool approved,
  ) async {
    await _busy('pending', record.id, approved ? 'approve' : 'reject', () async {
      try {
        final data = await _loadAccount(record.id);
        if (data == null) {
          throw const BiteSaverLifecycleException(
            kind: BiteSaverLifecycleFailureKind.missingAccount,
            code: 'not-found',
            message:
                'This restaurant account no longer exists. Refresh and retry.',
          );
        }
        final profileVersion =
            record.integer('profileVersion') ??
            Restaurant.fromFirestore(
              data,
              documentId: record.id,
              coupons: const <Coupon>[],
            ).profileVersion;
        final decision = approved
            ? BiteSaverApplicationDecision.approve
            : BiteSaverApplicationDecision.reject;
        if (widget.reviewApplication != null) {
          await widget.reviewApplication!(
            documentId: record.id,
            decision: decision,
            expectedProfileVersion: profileVersion,
          );
        } else {
          await _lifecycleService.reviewApplication(
            documentId: record.id,
            decision: decision,
            expectedProfileVersion: profileVersion,
          );
        }
        if (!mounted) return;
        _message(approved ? 'Restaurant approved.' : 'Restaurant rejected.');
        await _refreshAfterRemoval(_pendingController);
      } on BiteSaverLifecycleException catch (error) {
        if (mounted) _message(error.message);
      } catch (error) {
        if (mounted) {
          _message(
            AppErrorText.friendly(
              error,
              fallback: 'Could not update the approval status right now.',
            ),
          );
        }
      }
    });
  }

  Future<void> _reviewSearchRestaurant(
    CouponAdminRestaurantRecord record,
    bool approved,
  ) async {
    await _busy(
      'restaurant',
      record.documentId,
      approved ? 'approve' : 'reject',
      () async {
        try {
          final data = await _loadAccount(record.documentId);
          if (data == null) throw StateError('Missing restaurant');
          final restaurant = Restaurant.fromFirestore(
            data,
            documentId: record.documentId,
            coupons: const <Coupon>[],
          );
          final decision = approved
              ? BiteSaverApplicationDecision.approve
              : BiteSaverApplicationDecision.reject;
          if (widget.reviewApplication != null) {
            await widget.reviewApplication!(
              documentId: record.documentId,
              decision: decision,
              expectedProfileVersion: restaurant.profileVersion,
            );
          } else {
            await _lifecycleService.reviewApplication(
              documentId: record.documentId,
              decision: decision,
              expectedProfileVersion: restaurant.profileVersion,
            );
          }
          if (!mounted) return;
          _message(approved ? 'Restaurant approved.' : 'Restaurant rejected.');
          await _restaurantController?.refreshCurrentPage();
        } catch (error) {
          if (mounted) {
            _message(
              AppErrorText.friendly(
                error,
                fallback: 'Could not update the approval status right now.',
              ),
            );
          }
        }
      },
    );
  }

  Future<void> _refreshAfterRemoval<T>(
    PagedQueryController<T> controller,
  ) async {
    await controller.refreshCurrentPage();
    if (controller.items.isEmpty && (controller.currentPageNumber ?? 1) > 1) {
      await controller.previousPage();
      await controller.refreshCurrentPage();
    }
  }

  Future<void> _approveName(CouponAdminQueueRecord record) async {
    await _busy('name', record.id, 'approve', () async {
      try {
        await RestaurantAccountService.approveRestaurantNameChangeRequest(
          requestId: record.id,
          uid: record.text('userId'),
          requestedRestaurantName: record.text('requestedRestaurantName'),
        );
        if (!mounted) return;
        _message('Restaurant name change approved.');
        await _refreshAfterRemoval(_nameController);
      } catch (error) {
        if (mounted) {
          _message(
            AppErrorText.friendly(
              error,
              fallback:
                  'Could not approve the restaurant name change right now.',
            ),
          );
        }
      }
    });
  }

  Future<void> _rejectName(CouponAdminQueueRecord record) async {
    await _busy('name', record.id, 'reject', () async {
      try {
        await RestaurantAccountService.rejectRestaurantNameChangeRequest(
          record.id,
        );
        if (!mounted) return;
        _message('Restaurant name change rejected.');
        await _refreshAfterRemoval(_nameController);
      } catch (error) {
        if (mounted) {
          _message(
            AppErrorText.friendly(
              error,
              fallback:
                  'Could not reject the restaurant name change right now.',
            ),
          );
        }
      }
    });
  }

  Future<void> _updateReport(
    CouponAdminQueueRecord record,
    String status,
  ) async {
    await _busy('report', record.id, status, () async {
      try {
        await FirebaseFirestore.instance
            .collection('bitesaver_reports')
            .doc(record.id)
            .set(<String, Object?>{
              'status': status,
              'updatedAt': FieldValue.serverTimestamp(),
            }, SetOptions(merge: true));
        if (!mounted) return;
        _message('Report marked $status.');
        await _refreshAfterRemoval(_reportController);
      } catch (error) {
        if (mounted) {
          _message(
            AppErrorText.friendly(
              error,
              fallback: 'Could not update this report right now.',
            ),
          );
        }
      }
    });
  }

  Future<void> _editRestaurant(
    String documentId, {
    PagedQueryController<CouponAdminQueueRecord>? queueController,
  }) async {
    await _busy('restaurant', documentId, 'edit', () async {
      try {
        final data = await _loadAccount(documentId);
        if (!mounted) return;
        if (data == null) {
          _message('Restaurant account was not found.');
          return;
        }
        final saved = widget.editAccount != null
            ? await widget.editAccount!(
                context: context,
                documentId: documentId,
                data: data,
              )
            : await showDialog<bool>(
                context: context,
                builder: (context) => _CouponAdminRestaurantEditDialog(
                  documentId: documentId,
                  data: data,
                  lifecycleService: _lifecycleService,
                ),
              );
        if (saved == true && mounted) {
          _message('Restaurant updated.');
          if (queueController != null) {
            await queueController.refreshCurrentPage();
          } else {
            await _restaurantController?.refreshCurrentPage();
          }
        }
      } catch (error) {
        if (mounted) _message(AppErrorText.load('restaurant account'));
      }
    });
  }

  Future<void> _deleteCoupon(String restaurantId, String couponId) async {
    await _busy('coupon:$restaurantId', couponId, 'delete', () async {
      final confirmed = await _confirmDelete(
        title: 'Delete Coupon',
        message: 'Delete this coupon?',
      );
      if (!confirmed || !mounted) return;
      try {
        if (widget.deleteCoupon != null) {
          await widget.deleteCoupon!(
            documentId: restaurantId,
            couponId: couponId,
          );
        } else {
          await RestaurantAccountService.deleteCoupon(
            uid: restaurantId,
            couponId: couponId,
          );
        }
        if (!mounted) return;
        _message('Coupon deleted.');
        final controller = _couponControllers[restaurantId];
        if (controller != null) await _refreshAfterRemoval(controller);
      } catch (error) {
        if (mounted) {
          _message(
            AppErrorText.friendly(
              error,
              fallback: 'Could not delete the coupon right now.',
            ),
          );
        }
      }
    });
  }

  Future<void> _createInvite(CouponAdminRestaurantRecord record) async {
    await _busy('restaurant', record.documentId, 'invite', () async {
      try {
        final result = widget.createCouponInvite != null
            ? await widget.createCouponInvite!(
                restaurantId: record.actionId,
                restaurantName: record.restaurantName,
                streetAddress: record.streetAddress,
                city: record.city,
                state: record.state,
                zipCode: record.zipCode,
                phone: record.phone,
                website: record.website,
                latitude: record.latitude,
                longitude: record.longitude,
              )
            : await RestaurantInviteService.createCouponInvite(
                restaurantId: record.actionId,
                restaurantName: record.restaurantName,
                streetAddress: record.streetAddress,
                city: record.city,
                state: record.state,
                zipCode: record.zipCode,
                phone: record.phone,
                website: record.website,
                latitude: record.latitude,
                longitude: record.longitude,
              );
        if (mounted) await _showInviteLink(result);
      } catch (error) {
        if (mounted) {
          _message(
            AppErrorText.friendly(
              error,
              fallback: 'Could not create the coupon invite right now.',
            ),
          );
        }
      }
    });
  }

  Future<void> _setRestaurantVisibility(
    CouponAdminRestaurantRecord record,
  ) async {
    await _busy('restaurant', record.documentId, 'visibility', () async {
      final targetAdminHidden = !record.adminHidden;
      final confirmed =
          await showDialog<bool>(
            context: context,
            builder: (dialogContext) => AlertDialog(
              title: Text(
                targetAdminHidden
                    ? 'Hide “${record.restaurantName}” from BiteSaver?'
                    : 'Restore “${record.restaurantName}” to BiteSaver?',
              ),
              content: Text(
                targetAdminHidden
                    ? 'Customers will no longer see this restaurant or its '
                          'BiteSaver offers. Existing restaurant account, '
                          'coupon, daily-special, owner, and billing data will '
                          'remain stored.\n\nThis does not cancel or change the '
                          "restaurant's Stripe subscription or billing.\n\n"
                          'You can restore the restaurant later.'
                    : 'The Admin visibility block will be removed. The '
                          'restaurant will become visible to customers only '
                          'if its existing BiteSaver subscription and '
                          'publication requirements also allow it.',
              ),
              actions: <Widget>[
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(false),
                  child: const Text('Cancel'),
                ),
                FilledButton(
                  onPressed: () => Navigator.of(dialogContext).pop(true),
                  child: Text(
                    targetAdminHidden
                        ? 'Hide Restaurant'
                        : 'Restore Restaurant',
                  ),
                ),
              ],
            ),
          ) ==
          true;
      if (!confirmed || !mounted) return;

      try {
        final update = widget.setRestaurantVisibility;
        if (update != null) {
          await update(
            documentId: record.documentId,
            expectedAdminHidden: record.adminHidden,
            adminHidden: targetAdminHidden,
          );
        } else {
          await RestaurantAccountService.setAdminHiddenAsAdmin(
            documentId: record.documentId,
            expectedAdminHidden: record.adminHidden,
            adminHidden: targetAdminHidden,
          );
        }
        if (!mounted) return;
        _message(
          targetAdminHidden
              ? '${record.restaurantName} hidden from BiteSaver.'
              : '${record.restaurantName} restored to BiteSaver.',
        );
        await _restaurantController?.refreshCurrentPage();
      } on RestaurantAccountAdminVisibilityException catch (error) {
        if (mounted) _message(error.message);
      } catch (error) {
        if (mounted) {
          _message(
            AppErrorText.friendly(
              error,
              fallback: targetAdminHidden
                  ? 'Could not hide the restaurant right now.'
                  : 'Could not restore the restaurant right now.',
            ),
          );
        }
      }
    });
  }

  Future<void> _createPendingInvite(CouponAdminQueueRecord record) async {
    final data = record.toRestaurantData();
    final restaurant = CouponAdminRestaurantRecord(
      documentId: record.id,
      actionId: record.text('uid').isEmpty ? record.id : record.text('uid'),
      restaurantName: record.text('restaurantName'),
      streetAddress: record.text('streetAddress'),
      city: record.text('city'),
      state: record.text('state'),
      zipCode: record.text('zipCode'),
      phone: record.text('applicantPhone'),
      website: record.text('website'),
      latitude: data['latitude'] as double?,
      longitude: data['longitude'] as double?,
      distanceMiles: null,
      approvalStatus: record.text('approvalStatus'),
      couponApplicationSubmitted: record.flag('couponApplicationSubmitted'),
      uid: record.text('uid'),
      linkedBiteScoreRestaurantId: null,
      adminHidden: false,
    );
    await _createInvite(restaurant);
  }

  Future<bool> _confirmDelete({
    required String title,
    required String message,
  }) async {
    return await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(title),
            content: Text(message),
            actions: <Widget>[
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Delete'),
              ),
            ],
          ),
        ) ==
        true;
  }

  Future<void> _showInviteLink(RestaurantInviteCreationResult result) async {
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Coupon Invite Created'),
        content: SizedBox(width: 460, child: SelectableText(result.inviteUrl)),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
          FilledButton.icon(
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: result.inviteUrl));
              if (context.mounted) _message('Invite link copied.');
            },
            icon: const Icon(Icons.copy),
            label: const Text('Copy Link'),
          ),
        ],
      ),
    );
  }

  Future<void> _createManualInvite() async {
    final result = widget.createManualInvite != null
        ? await widget.createManualInvite!(context)
        : await showDialog<RestaurantInviteCreationResult>(
            context: context,
            builder: (context) => const CouponAdminManualInviteDialog(),
          );
    if (result != null && mounted) {
      await _showInviteLink(result);
    }
  }

  void _message(String value) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
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
            '$label: $value',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
        IconButton(
          key: ValueKey(copyKey),
          tooltip: 'Copy $label',
          constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
          onPressed: () async {
            await Clipboard.setData(ClipboardData(text: value));
            if (mounted) _message('$label copied.');
          },
          icon: const Icon(Icons.copy_outlined, size: 20),
        ),
      ],
    );
  }

  String _dateLabel(DateTime? value) {
    if (value == null) return 'Recent';
    final local = value.toLocal();
    return '${local.month}/${local.day}/${local.year}';
  }

  Widget _header(
    String title,
    String description, {
    List<Widget> actions = const <Widget>[],
  }) {
    return Card(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                ...actions,
              ],
            ),
            const SizedBox(height: 6),
            Text(description, style: const TextStyle(color: Colors.black54)),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: TabBar(
            controller: _tabController,
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: const <Tab>[
              Tab(text: 'Restaurants'),
              Tab(text: 'Pending Applications'),
              Tab(text: 'Name Changes'),
              Tab(text: 'Reports'),
            ],
          ),
        ),
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: <Widget>[
              _restaurantsTab(),
              _pendingTab(),
              _nameTab(),
              _reportsTab(),
            ],
          ),
        ),
      ],
    );
  }

  Widget _restaurantsTab() {
    final controller = _restaurantController;
    return LayoutBuilder(
      builder: (context, constraints) => Column(
        children: <Widget>[
          ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: constraints.maxHeight * 0.58,
            ),
            child: SingleChildScrollView(
              child: Column(
                children: <Widget>[
                  _header(
                    'Find Restaurants',
                    'Search approved coupon-side accounts with true server pages.',
                  ),
                  _searchControls(),
                  if (_criteriaSummary != null)
                    Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 6,
                      ),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text('Current search: $_criteriaSummary'),
                      ),
                    ),
                ],
              ),
            ),
          ),
          Expanded(
            child: controller == null
                ? const Center(
                    child: Text('Choose search criteria to find restaurants.'),
                  )
                : _restaurantResults(controller),
          ),
        ],
      ),
    );
  }

  Widget _searchControls() {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _searchFormKey,
          child: LayoutBuilder(
            builder: (context, constraints) {
              final narrow = constraints.maxWidth < 680;
              final width = narrow
                  ? constraints.maxWidth
                  : (constraints.maxWidth - 12) / 2;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  SingleChildScrollView(
                    key: const ValueKey('coupon-admin-mode-scroll'),
                    scrollDirection: Axis.horizontal,
                    child: SegmentedButton<CouponAdminRestaurantSearchMode>(
                      key: const ValueKey('coupon-admin-search-mode'),
                      showSelectedIcon: false,
                      segments: CouponAdminRestaurantSearchMode.values
                          .map(
                            (mode) =>
                                ButtonSegment<CouponAdminRestaurantSearchMode>(
                                  value: mode,
                                  label: Text(mode.label),
                                ),
                          )
                          .toList(growable: false),
                      selected: <CouponAdminRestaurantSearchMode>{_searchMode},
                      onSelectionChanged: (selection) {
                        setState(() => _searchMode = selection.single);
                      },
                    ),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: <Widget>[
                      SizedBox(
                        width: width,
                        child: TextFormField(
                          key: const ValueKey('coupon-admin-location-field'),
                          controller: _locationController,
                          textInputAction: TextInputAction.search,
                          onFieldSubmitted: (_) => _submitSearch(),
                          validator: (value) {
                            try {
                              CouponAdminPagingService.restaurantCriteria(
                                mode: _searchMode,
                                location: value ?? '',
                                radiusMiles: _radiusMiles,
                                restaurantName: _restaurantNameController.text,
                              );
                              return null;
                            } on CouponAdminPagingException catch (error) {
                              return error.message;
                            }
                          },
                          decoration: InputDecoration(
                            labelText: switch (_searchMode) {
                              CouponAdminRestaurantSearchMode.nearbyRadius =>
                                'Location',
                              CouponAdminRestaurantSearchMode.exactZip =>
                                'ZIP code',
                              CouponAdminRestaurantSearchMode.exactCity =>
                                'City, ST',
                            },
                            border: const OutlineInputBorder(),
                          ),
                        ),
                      ),
                      SizedBox(
                        width: width,
                        child: TextFormField(
                          key: const ValueKey(
                            'coupon-admin-restaurant-name-field',
                          ),
                          controller: _restaurantNameController,
                          textInputAction: TextInputAction.search,
                          onFieldSubmitted: (_) => _submitSearch(),
                          decoration: const InputDecoration(
                            labelText: 'Restaurant name',
                            hintText: 'Optional word prefix',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                      if (_searchMode ==
                          CouponAdminRestaurantSearchMode.nearbyRadius)
                        SizedBox(
                          width: narrow ? constraints.maxWidth : 220,
                          child: DropdownButtonFormField<int>(
                            key: const ValueKey('coupon-admin-radius-field'),
                            initialValue: _radiusMiles,
                            isExpanded: true,
                            decoration: const InputDecoration(
                              labelText: 'Radius',
                              border: OutlineInputBorder(),
                            ),
                            items: _radiusOptions
                                .map(
                                  (radius) => DropdownMenuItem<int>(
                                    value: radius,
                                    child: Text(
                                      '$radius ${radius == 1 ? 'mile' : 'miles'}',
                                    ),
                                  ),
                                )
                                .toList(growable: false),
                            onChanged: (value) {
                              if (value != null) {
                                setState(() => _radiusMiles = value);
                              }
                            },
                          ),
                        ),
                      FilledButton.icon(
                        key: const ValueKey('coupon-admin-search-button'),
                        onPressed: _submitSearch,
                        icon: const Icon(Icons.search),
                        label: const Text('Search'),
                      ),
                    ],
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _restaurantResults(
    PagedQueryController<CouponAdminRestaurantRecord> controller,
  ) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final preparation = controller.page?.preparation;
        if (preparation?.state == PagePreparationState.preparing) {
          final total = preparation?.totalUnits;
          return Center(
            key: const ValueKey('coupon-admin-radius-preparing'),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                const CircularProgressIndicator(),
                const SizedBox(height: 12),
                Text(
                  preparation?.message ?? 'Preparing complete nearby results…',
                ),
                if (total != null)
                  Text(
                    '${preparation!.completedUnits} of $total search ranges complete',
                  ),
              ],
            ),
          );
        }
        return PagedDirectoryView<CouponAdminRestaurantRecord>(
          controller: controller,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          onRefresh: _refreshRestaurantDirectory,
          itemBuilder: (context, record, index) => _restaurantCard(record),
          emptyBuilder: (_) =>
              const Text('No matching coupon-side restaurants found.'),
        );
      },
    );
  }

  Widget _pendingTab() {
    return Column(
      children: <Widget>[
        _header(
          'Pending Applications',
          'Review coupon-side applications in pages of 25.',
          actions: <Widget>[
            IconButton(
              tooltip: 'Create Coupon Invite',
              constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
              onPressed: _createManualInvite,
              icon: const Icon(Icons.add_link),
            ),
            IconButton(
              key: const ValueKey('coupon-admin-manage-invites'),
              tooltip: 'Manage Coupon Invites',
              constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
              onPressed: () => _showInviteManager(),
              icon: const Icon(Icons.manage_search),
            ),
          ],
        ),
        Expanded(
          child: PagedDirectoryView<CouponAdminQueueRecord>(
            controller: _pendingController,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            onRefresh: _pendingController.refreshCurrentPage,
            itemBuilder: (context, record, index) => _pendingCard(record),
            emptyBuilder: (_) =>
                const Text('No pending restaurant approvals found.'),
          ),
        ),
      ],
    );
  }

  Widget _nameTab() => Column(
    children: <Widget>[
      _header(
        'Pending Restaurant Name Changes',
        'Review requested coupon-side restaurant name updates.',
      ),
      Expanded(
        child: PagedDirectoryView<CouponAdminQueueRecord>(
          controller: _nameController,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          onRefresh: _nameController.refreshCurrentPage,
          itemBuilder: (context, record, index) => _nameCard(record),
          emptyBuilder: (_) => const Text(
            'No pending restaurant name change requests right now.',
          ),
        ),
      ),
    ],
  );

  Widget _reportsTab() => Column(
    children: <Widget>[
      _header(
        'BiteSaver Reports',
        'Review restaurant and coupon reports submitted by users.',
      ),
      Expanded(
        child: PagedDirectoryView<CouponAdminQueueRecord>(
          controller: _reportController,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          onRefresh: _reportController.refreshCurrentPage,
          itemBuilder: (context, record, index) => _reportCard(record),
          emptyBuilder: (_) => const Text('No BiteSaver reports right now.'),
        ),
      ),
    ],
  );

  Widget _restaurantCard(CouponAdminRestaurantRecord record) {
    final locality = <String>[
      record.city,
      record.state,
      record.zipCode,
    ].where((part) => part.isNotEmpty).join(', ');
    return Card(
      key: ValueKey(record.recordKey),
      margin: const EdgeInsets.only(bottom: 14),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              record.restaurantName,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            if (record.streetAddress.isNotEmpty) Text(record.streetAddress),
            if (locality.isNotEmpty) Text(locality),
            if (record.distanceMiles != null)
              Text('${record.distanceMiles!.toStringAsFixed(1)} miles away'),
            if (record.phone.isNotEmpty)
              ClickablePhoneText(phone: record.phone, prefix: 'Phone: '),
            if (record.website.isNotEmpty) Text('Website: ${record.website}'),
            const SizedBox(height: 6),
            _identifierRow(
              label: 'Account ID',
              value: record.documentId,
              copyKey: 'coupon-admin-copy-account-id-${record.documentId}',
            ),
            if (record.uid?.trim().isNotEmpty == true)
              _identifierRow(
                label: 'Owner UID',
                value: record.uid!,
                copyKey: 'coupon-admin-copy-owner-uid-${record.documentId}',
              )
            else
              SelectableText(
                'Owner UID: Not available',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            const SizedBox(height: 10),
            Text(
              'Status: ${record.approvalStatus.isEmpty ? 'Unknown' : record.approvalStatus}',
            ),
            Text(
              'Application submitted: ${record.couponApplicationSubmitted ? 'Yes' : 'No'}',
            ),
            if (record.adminHidden) ...<Widget>[
              const SizedBox(height: 6),
              Chip(
                key: ValueKey('coupon-admin-hidden-chip-${record.documentId}'),
                avatar: const Icon(Icons.visibility_off_outlined, size: 18),
                label: const Text('Hidden'),
              ),
            ],
            const SizedBox(height: 10),
            _restaurantActions(record),
            _couponExpansion(
              record.documentId,
              record.restaurantName,
              record.recordKey,
            ),
          ],
        ),
      ),
    );
  }

  Widget _pendingCard(CouponAdminQueueRecord record) {
    final name = record.text('restaurantName').isEmpty
        ? 'Unnamed Restaurant'
        : record.text('restaurantName');
    final phone = record.text('phone').isEmpty
        ? record.text('applicantPhone')
        : record.text('phone');
    final location = <String>[
      record.text('city'),
      record.text('state'),
      record.text('zipCode'),
    ].where((value) => value.isNotEmpty).join(', ');
    return Card(
      key: ValueKey('pending:${record.id}'),
      margin: const EdgeInsets.only(bottom: 14),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              name,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            if (record.text('email').isNotEmpty) Text(record.text('email')),
            if (phone.isNotEmpty)
              ClickablePhoneText(phone: phone, prefix: 'Phone: '),
            if (record.text('streetAddress').isNotEmpty)
              Text('Street: ${record.text('streetAddress')}'),
            if (location.isNotEmpty) Text('Location: $location'),
            if (record.text('website').isNotEmpty)
              Text('Website: ${record.text('website')}'),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                ElevatedButton(
                  onPressed: _isBusy('pending', record.id, 'approve')
                      ? null
                      : () => _reviewApplication(record, true),
                  child: const Text('Approve'),
                ),
                OutlinedButton(
                  onPressed: _isBusy('pending', record.id, 'reject')
                      ? null
                      : () => _reviewApplication(record, false),
                  child: const Text('Reject'),
                ),
                OutlinedButton.icon(
                  onPressed: () => _editRestaurant(
                    record.id,
                    queueController: _pendingController,
                  ),
                  icon: const Icon(Icons.edit_outlined),
                  label: const Text('Edit Restaurant'),
                ),
                OutlinedButton.icon(
                  onPressed: () => _createPendingInvite(record),
                  icon: const Icon(Icons.add_link),
                  label: const Text('Create Invite'),
                ),
              ],
            ),
            _couponExpansion(record.id, name, 'pending:${record.id}'),
          ],
        ),
      ),
    );
  }

  Widget _nameCard(CouponAdminQueueRecord record) => Card(
    key: ValueKey('name:${record.id}'),
    margin: const EdgeInsets.only(bottom: 14),
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            record.text('currentRestaurantName').isEmpty
                ? 'Unnamed Restaurant'
                : record.text('currentRestaurantName'),
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
          ),
          Text('Requested: ${record.text('requestedRestaurantName')}'),
          if (record.text('userId').isNotEmpty)
            Text('User ID: ${record.text('userId')}'),
          Text('Submitted: ${_dateLabel(record.date('createdAtMillis'))}'),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              ElevatedButton(
                onPressed:
                    record.text('userId').isEmpty ||
                        record.text('requestedRestaurantName').isEmpty
                    ? null
                    : () => _approveName(record),
                child: const Text('Approve'),
              ),
              OutlinedButton(
                onPressed: () => _rejectName(record),
                child: const Text('Reject'),
              ),
            ],
          ),
        ],
      ),
    ),
  );

  Widget _reportCard(CouponAdminQueueRecord record) => Card(
    key: ValueKey('report:${record.id}'),
    margin: const EdgeInsets.only(bottom: 14),
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            record.text('reportType').isEmpty
                ? 'Report'
                : record.text('reportType'),
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
          ),
          if (record.text('restaurantName').isNotEmpty)
            Text('Restaurant: ${record.text('restaurantName')}'),
          if (record.text('couponTitle').isNotEmpty)
            Text('Coupon: ${record.text('couponTitle')}'),
          Text(
            'Reason: ${record.text('reason').isEmpty ? 'Unknown' : record.text('reason')}',
          ),
          if (record.text('note').isNotEmpty)
            Text('Note: ${record.text('note')}'),
          if (record.text('reporterUid').isNotEmpty)
            Text('Reporter: ${record.text('reporterUid')}'),
          Text('Submitted: ${_dateLabel(record.date('createdAtMillis'))}'),
          Text('Status: ${record.text('status')}'),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              ElevatedButton(
                onPressed: () => _updateReport(record, 'reviewed'),
                child: const Text('Mark reviewed'),
              ),
              OutlinedButton(
                onPressed: () => _updateReport(record, 'dismissed'),
                child: const Text('Dismiss'),
              ),
            ],
          ),
        ],
      ),
    ),
  );

  Widget _restaurantActions(CouponAdminRestaurantRecord record) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: <Widget>[
      ElevatedButton(
        onPressed: () => _reviewSearchRestaurant(record, true),
        child: const Text('Approve'),
      ),
      OutlinedButton(
        onPressed: () => _reviewSearchRestaurant(record, false),
        child: const Text('Reject'),
      ),
      OutlinedButton.icon(
        onPressed: () => _editRestaurant(record.documentId),
        icon: const Icon(Icons.edit_outlined),
        label: const Text('Edit Restaurant'),
      ),
      OutlinedButton.icon(
        onPressed: _isBusy('restaurant', record.documentId, 'visibility')
            ? null
            : () => _setRestaurantVisibility(record),
        icon: Icon(
          record.adminHidden
              ? Icons.visibility_outlined
              : Icons.visibility_off_outlined,
        ),
        label: Text(
          record.adminHidden ? 'Restore to BiteSaver' : 'Hide from BiteSaver',
        ),
      ),
      OutlinedButton.icon(
        onPressed: () => _createInvite(record),
        icon: const Icon(Icons.add_link),
        label: const Text('Create Invite'),
      ),
    ],
  );

  Widget _couponExpansion(
    String restaurantId,
    String restaurantName,
    String sectionKey,
  ) {
    final expanded = _expandedRestaurants.contains(restaurantId);
    return ExpansionTile(
      key: PageStorageKey<String>('coupons:$sectionKey'),
      tilePadding: EdgeInsets.zero,
      onExpansionChanged: (value) => _toggleCoupons(restaurantId, value),
      title: const Text(
        'Coupons',
        style: TextStyle(fontWeight: FontWeight.w600),
      ),
      subtitle: const Text('View restaurant coupons in pages of 25'),
      children: <Widget>[
        if (expanded)
          _CouponPageSection(
            controller: _couponController(restaurantId),
            restaurantId: restaurantId,
            restaurantName: restaurantName,
            onDelete: _deleteCoupon,
          ),
      ],
    );
  }

  Future<void> _showInviteManager() async {
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Coupon Invites'),
        content: SizedBox(
          width: 620,
          height: 560,
          child: _CouponInviteHistory(service: _service),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }
}

class _CouponPageSection extends StatelessWidget {
  const _CouponPageSection({
    required this.controller,
    required this.restaurantId,
    required this.restaurantName,
    required this.onDelete,
  });

  final PagedQueryController<CouponAdminCouponRecord> controller;
  final String restaurantId;
  final String restaurantName;
  final Future<void> Function(String restaurantId, String couponId) onDelete;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        if (controller.page == null && controller.isLoading) {
          return const Padding(
            padding: EdgeInsets.all(16),
            child: CircularProgressIndicator(),
          );
        }
        if (controller.page == null && controller.error != null) {
          return TextButton(
            onPressed: controller.retry,
            child: const Text('Retry coupon load'),
          );
        }
        final page = controller.page;
        if (page == null) return const SizedBox.shrink();
        return Column(
          children: <Widget>[
            if (controller.isRefreshing) const LinearProgressIndicator(),
            if (controller.items.isEmpty)
              const Padding(
                padding: EdgeInsets.all(12),
                child: Text('No coupons found for this restaurant.'),
              )
            else
              for (final record in controller.items)
                Card(
                  color: Colors.grey.shade50,
                  child: ListTile(
                    title: Text(record.coupon.title),
                    subtitle: Text(
                      '$restaurantName\n${record.coupon.endsLabel ?? record.coupon.expires} - '
                      '${record.coupon.usageRule}',
                    ),
                    isThreeLine: true,
                    trailing: IconButton(
                      tooltip: 'Delete coupon',
                      constraints: const BoxConstraints(
                        minWidth: 48,
                        minHeight: 48,
                      ),
                      onPressed: () => onDelete(restaurantId, record.coupon.id),
                      icon: const Icon(Icons.delete_outline),
                    ),
                  ),
                ),
            AdminPaginationBar(
              currentPageNumber: controller.currentPageNumber ?? 1,
              visitedPageNumbers: controller.visitedPageNumbers,
              pageSize: page.pageSize,
              total: page.total,
              capabilities: page.capabilities,
              loading: controller.isLoading,
              onFirst: controller.firstPage,
              onPrevious: controller.previousPage,
              onVisitedPage: controller.goToVisitedPage,
              onNext: controller.nextPage,
              onLast: controller.lastPage,
            ),
          ],
        );
      },
    );
  }
}

class _CouponInviteHistory extends StatefulWidget {
  const _CouponInviteHistory({required this.service});

  final CouponAdminPagingService service;

  @override
  State<_CouponInviteHistory> createState() => _CouponInviteHistoryState();
}

class _CouponInviteHistoryState extends State<_CouponInviteHistory> {
  late final PagedQueryController<CouponAdminInviteRecord> _controller;
  final Set<String> _revoking = <String>{};

  @override
  void initState() {
    super.initState();
    _controller = PagedQueryController<CouponAdminInviteRecord>(
      pageLoader: widget.service.loadCouponInviteHistoryPage,
      criteria: const <String, Object?>{'side': 'coupon'},
      pageSize: CouponAdminPagingService.invitePageSize,
      requestExactCount: true,
    );
    unawaited(_controller.loadInitial());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _revoke(CouponAdminInviteRecord invite) async {
    if (_revoking.contains(invite.id)) return;
    setState(() => _revoking.add(invite.id));
    try {
      await RestaurantInviteService.revokeInvite(invite.id);
      if (mounted) await _controller.refreshCurrentPage();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              AppErrorText.friendly(
                error,
                fallback: 'Could not revoke this invite right now.',
              ),
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _revoking.remove(invite.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    return PagedDirectoryView<CouponAdminInviteRecord>(
      controller: _controller,
      onRefresh: _controller.refreshCurrentPage,
      emptyBuilder: (_) => const Text('No coupon invites found.'),
      itemBuilder: (context, invite, index) => Card(
        key: ValueKey('coupon-invite:${invite.id}'),
        child: ListTile(
          title: Text(
            invite.restaurantName.isEmpty
                ? 'Coupon invite'
                : invite.restaurantName,
          ),
          subtitle: Text(
            'Status: ${invite.status}\nCreated by: '
            '${invite.createdByEmail.isEmpty ? 'Admin' : invite.createdByEmail}',
          ),
          trailing: invite.status == 'active'
              ? TextButton(
                  onPressed: _revoking.contains(invite.id)
                      ? null
                      : () => _revoke(invite),
                  child: Text(
                    _revoking.contains(invite.id) ? 'Revoking…' : 'Revoke',
                  ),
                )
              : null,
        ),
      ),
    );
  }
}

class _CouponAdminField extends StatelessWidget {
  const _CouponAdminField({
    required this.controller,
    required this.label,
    this.maxLines = 1,
    this.keyboardType,
  });

  final TextEditingController controller;
  final String label;
  final int maxLines;
  final TextInputType? keyboardType;

  @override
  Widget build(BuildContext context) => TextField(
    controller: controller,
    maxLines: maxLines,
    keyboardType: keyboardType,
    decoration: InputDecoration(
      labelText: label,
      border: const OutlineInputBorder(),
    ),
  );
}

class CouponAdminManualInviteDialog extends StatefulWidget {
  const CouponAdminManualInviteDialog({super.key, this.createInvite});

  final CouponAdminManualInviteCreator? createInvite;

  @override
  State<CouponAdminManualInviteDialog> createState() =>
      _CouponAdminManualInviteDialogState();
}

class _CouponAdminManualInviteDialogState
    extends State<CouponAdminManualInviteDialog> {
  final List<TextEditingController> _controllers =
      List<TextEditingController>.generate(10, (_) => TextEditingController());
  bool _saving = false;

  @override
  void dispose() {
    for (final controller in _controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_controllers[1].text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Restaurant name is required.')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      final createInvite =
          widget.createInvite ?? RestaurantInviteService.createCouponInvite;
      final restaurantIdInput = _controllers[0].text;
      final result = await createInvite(
        restaurantId: restaurantIdInput.isEmpty ? null : restaurantIdInput,
        restaurantName: _controllers[1].text,
        streetAddress: _controllers[2].text,
        city: _controllers[3].text,
        state: _controllers[4].text,
        zipCode: _controllers[5].text,
        phone: _controllers[6].text,
        website: _controllers[7].text,
        latitude: double.tryParse(_controllers[8].text.trim()),
        longitude: double.tryParse(_controllers[9].text.trim()),
      );
      if (mounted) Navigator.of(context).pop(result);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not create the coupon invite right now.',
            ),
          ),
        ),
      );
      setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const labels = <String>[
      'Restaurant ID / key (optional)',
      'Restaurant name',
      'Street address',
      'City',
      'State',
      'ZIP',
      'Phone',
      'Website',
      'Latitude',
      'Longitude',
    ];
    return AlertDialog(
      title: const Text('Create Coupon Invite'),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              for (var index = 0; index < labels.length; index++) ...<Widget>[
                _CouponAdminField(
                  controller: _controllers[index],
                  label: labels[index],
                  keyboardType: index == 6 ? TextInputType.phone : null,
                ),
                if (index != labels.length - 1) const SizedBox(height: 12),
              ],
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton.icon(
          onPressed: _saving ? null : _save,
          icon: const Icon(Icons.add_link),
          label: Text(_saving ? 'Creating…' : 'Create Invite'),
        ),
      ],
    );
  }
}

class _CouponAdminRestaurantEditDialog extends StatefulWidget {
  const _CouponAdminRestaurantEditDialog({
    required this.documentId,
    required this.data,
    required this.lifecycleService,
  });

  final String documentId;
  final Map<String, dynamic> data;
  final BiteSaverRestaurantLifecycleService lifecycleService;

  @override
  State<_CouponAdminRestaurantEditDialog> createState() =>
      _CouponAdminRestaurantEditDialogState();
}

class _CouponAdminRestaurantEditDialogState
    extends State<_CouponAdminRestaurantEditDialog> {
  late final List<TextEditingController> _controllers;
  late final BiteSaverProfileOperationState _operationState;
  late final int _profileVersion;
  bool _saving = false;

  String _read(String field) {
    final value = widget.data[field];
    return value is String ? value.trim() : '';
  }

  @override
  void initState() {
    super.initState();
    _controllers = <TextEditingController>[
      TextEditingController(text: _read(Restaurant.fieldName)),
      TextEditingController(text: _read(Restaurant.fieldStreetAddress)),
      TextEditingController(text: _read(Restaurant.fieldCity)),
      TextEditingController(text: _read(Restaurant.fieldState)),
      TextEditingController(text: _read(Restaurant.fieldZipCode)),
      TextEditingController(text: _read(Restaurant.fieldPhone)),
      TextEditingController(text: _read(Restaurant.fieldWebsite)),
      TextEditingController(text: _read(Restaurant.fieldBio)),
    ];
    _operationState = widget.lifecycleService.createOperationState();
    _profileVersion = Restaurant.fromFirestore(
      widget.data,
      documentId: widget.documentId,
      coupons: const <Coupon>[],
    ).profileVersion;
  }

  @override
  void dispose() {
    for (final controller in _controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_controllers
        .take(6)
        .any((controller) => controller.text.trim().isEmpty)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Complete the restaurant name, address, and phone before saving.',
          ),
        ),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      final request = BiteSaverProfileSaveRequest.adminUpdate(
        documentId: widget.documentId,
        expectedProfileVersion: _profileVersion,
        profile: BiteSaverRestaurantProfileInput(
          restaurantName: _controllers[0].text,
          streetAddress: _controllers[1].text,
          city: _controllers[2].text,
          state: _controllers[3].text,
          zipCode: _controllers[4].text,
          phone: _controllers[5].text,
          website: BiteSaverOptionalField<String>.included(
            _controllers[6].text,
          ),
          bio: BiteSaverOptionalField<String>.included(_controllers[7].text),
        ),
      );
      await _operationState.execute(
        request: request,
        logicalTarget: widget.documentId,
        invoke: (requestId) =>
            widget.lifecycleService.save(request, requestId: requestId),
      );
      if (mounted) Navigator.of(context).pop(true);
    } on BiteSaverLifecycleException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.message)));
      setState(() => _saving = false);
    } catch (error) {
      if (!mounted) return;
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
      setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const labels = <String>[
      'Restaurant name',
      'Street address',
      'City',
      'State',
      'ZIP code',
      'Phone',
      'Website',
      'Bio',
    ];
    return AlertDialog(
      title: const Text('Edit Restaurant'),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              for (var index = 0; index < labels.length; index++) ...<Widget>[
                _CouponAdminField(
                  controller: _controllers[index],
                  label: labels[index],
                  maxLines: index == 7 ? 3 : 1,
                  keyboardType: index == 5 ? TextInputType.phone : null,
                ),
                if (index != labels.length - 1) const SizedBox(height: 12),
              ],
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: Text(_saving ? 'Saving…' : 'Save'),
        ),
      ],
    );
  }
}
