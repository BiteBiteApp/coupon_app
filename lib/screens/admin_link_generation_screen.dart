import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/admin_restaurant_link_record.dart';
import '../models/admin_restaurant_qr_batch.dart';
import '../models/pagination/paged_models.dart';
import '../services/admin_link_generation_service.dart';
import '../services/app_error_text.dart';
import '../services/firestore_document_id.dart';
import '../services/restaurant_customer_link_service.dart';
import '../services/restaurant_invite_service.dart';
import '../services/restaurant_qr_export.dart';
import '../services/restaurant_qr_image_service.dart';
import '../widgets/admin_restaurant_qr_batch_dialog.dart';
import '../widgets/restaurant_qr_preview_dialog.dart';

typedef AdminRestaurantSearchCallback =
    Future<AdminRestaurantLinkSearchResult> Function({
      required String locationQuery,
      required int radiusMiles,
      required String? restaurantName,
      required Set<AdminRestaurantLinkSource> sources,
    });

typedef AdminRestaurantPagedSearchCallback =
    Future<AdminRestaurantLinkPagedResult> Function({
      required String locationQuery,
      required int radiusMiles,
      required String? restaurantName,
      required Set<AdminRestaurantLinkSource> sources,
      required String searchInstanceId,
      required String clientRequestId,
      required bool needsQrPreparation,
      String? cursor,
      AdminRestaurantSearchCenter? resolvedSearchCenter,
    });

typedef AdminCouponInviteCallback =
    Future<RestaurantInviteCreationResult> Function({
      required String restaurantName,
      required String? restaurantId,
      required String? biteScoreCatalogRestaurantId,
      required String streetAddress,
      required String city,
      required String state,
      required String zipCode,
      required String phone,
      required String website,
      required double latitude,
      required double longitude,
    });

typedef AdminBiteScoreClaimInviteCallback =
    Future<RestaurantInviteCreationResult> Function({
      required String restaurantId,
    });

typedef AdminClipboardWriteCallback = Future<void> Function(String text);
typedef AdminQrImageRenderCallback =
    Future<RestaurantQrImageResult> Function({
      required String restaurantName,
      required String url,
      required RestaurantQrLinkType linkType,
    });
typedef AdminPreparationUpdateCallback =
    Future<AdminRestaurantPreparationState> Function({
      required String catalogRestaurantId,
      required AdminRestaurantPreparationType type,
      required bool prepared,
      required AdminBiteSaverCatalogBindingState biteSaverCatalogBindingState,
      required AdminRestaurantClaimState claimState,
      String? expectedInviteId,
    });

class AdminRestaurantQrBatchSelectionException implements Exception {
  const AdminRestaurantQrBatchSelectionException(this.message);

  final String message;

  @override
  String toString() => message;
}

@visibleForTesting
List<String> freezeAdminRestaurantQrBatchSelection({
  required Set<String> selectedCatalogRestaurantIds,
  required Iterable<AdminRestaurantLinkRecord> displayedRecords,
  required bool Function(AdminRestaurantLinkRecord record)
  isCurrentlySelectable,
}) {
  if (selectedCatalogRestaurantIds.isEmpty) {
    throw const AdminRestaurantQrBatchSelectionException(
      'Select at least one canonical restaurant.',
    );
  }
  final selectedSnapshot = Set<String>.unmodifiable(
    selectedCatalogRestaurantIds,
  );
  if (selectedSnapshot.any((id) => exactFirestoreDocumentId(id) != id)) {
    throw const AdminRestaurantQrBatchSelectionException(
      'The selected restaurants are inconsistent. Run a fresh Search.',
    );
  }

  final selectedOccurrenceCounts = <String, int>{
    for (final id in selectedSnapshot) id: 0,
  };
  final frozen = <String>[];
  for (final record in displayedRecords) {
    final catalogId = record.documentId;
    if (!selectedSnapshot.contains(catalogId)) {
      continue;
    }
    final occurrenceCount = selectedOccurrenceCounts[catalogId]! + 1;
    selectedOccurrenceCounts[catalogId] = occurrenceCount;
    if (occurrenceCount != 1) {
      throw const AdminRestaurantQrBatchSelectionException(
        'The selected restaurants changed unexpectedly. Run a fresh Search.',
      );
    }
    if (!record.isBiteScore ||
        exactFirestoreDocumentId(catalogId) != catalogId ||
        record.actionId != catalogId ||
        record.preparation.canonicalCatalogRestaurantId != catalogId ||
        !isCurrentlySelectable(record)) {
      throw const AdminRestaurantQrBatchSelectionException(
        'The selected restaurants are inconsistent. Run a fresh Search.',
      );
    }
    frozen.add(catalogId);
  }
  if (selectedOccurrenceCounts.values.any((count) => count != 1) ||
      frozen.length != selectedSnapshot.length) {
    throw const AdminRestaurantQrBatchSelectionException(
      'The selected restaurants changed unexpectedly. Run a fresh Search.',
    );
  }
  return List<String>.unmodifiable(frozen);
}

enum _AdminLinkPageRequestKind { initial, preparation, checking, loadMore }

class _PendingAdminLinkPageRequest {
  const _PendingAdminLinkPageRequest({
    required this.generation,
    required this.cursor,
    required this.clientRequestId,
    required this.kind,
  });

  final int generation;
  final String? cursor;
  final String clientRequestId;
  final _AdminLinkPageRequestKind kind;
}

class AdminLinkGenerationScreen extends StatefulWidget {
  final AdminRestaurantSearchCallback? searchRestaurants;
  final AdminRestaurantPagedSearchCallback? searchRestaurantPage;
  final AdminCouponInviteCallback? createCouponInvite;
  final AdminBiteScoreClaimInviteCallback? createBiteScoreClaimInvite;
  final AdminClipboardWriteCallback? writeClipboard;
  final AdminQrImageRenderCallback? renderQrImage;
  final RestaurantQrExporter? qrExporter;
  final AdminPreparationUpdateCallback? updatePreparation;
  final AdminRestaurantQrBatchDialogDependencies? qrBatchDependencies;

  const AdminLinkGenerationScreen({
    super.key,
    @visibleForTesting this.searchRestaurants,
    @visibleForTesting this.searchRestaurantPage,
    @visibleForTesting this.createCouponInvite,
    @visibleForTesting this.createBiteScoreClaimInvite,
    @visibleForTesting this.writeClipboard,
    @visibleForTesting this.renderQrImage,
    @visibleForTesting this.qrExporter,
    @visibleForTesting this.updatePreparation,
    @visibleForTesting this.qrBatchDependencies,
  });

  @override
  State<AdminLinkGenerationScreen> createState() =>
      _AdminLinkGenerationScreenState();
}

class _AdminLinkGenerationScreenState extends State<AdminLinkGenerationScreen> {
  final _formKey = GlobalKey<FormState>();
  final _locationController = TextEditingController();
  final _restaurantNameController = TextEditingController();
  final _scrollController = ScrollController();
  final _searchService = AdminLinkGenerationService();
  final Set<AdminRestaurantLinkSource> _selectedSources = {
    AdminRestaurantLinkSource.biteScore,
    AdminRestaurantLinkSource.biteSaver,
  };
  final Set<String> _busyActions = <String>{};
  final Map<String, AdminRestaurantPreparationState> _preparationOverrides = {};
  final Set<String> _busyPreparationCatalogIds = <String>{};
  final Map<String, int> _preparationMutationGenerations = <String, int>{};
  final Set<String> _suppressedCompletedCatalogIds = <String>{};
  final Set<String> _selectedCatalogRestaurantIds = <String>{};

  int _radiusMiles = AdminLinkGenerationService.defaultRadiusMiles;
  int _searchGeneration = 0;
  bool _isSearching = false;
  bool _isContinuing = false;
  bool _isLoadingMore = false;
  bool _hasSubmitted = false;
  AdminRestaurantLinkSearchResult? _searchResult;
  String? _searchError;
  String? _appendError;
  String? _nextCursor;
  String? _searchInstanceId;
  AdminRestaurantSearchCenter? _resolvedSearchCenter;
  bool _isPreparing = false;
  bool _searchExpired = false;
  bool _needsQrPreparation = false;
  bool _preparationUnavailableEncountered = false;
  bool _continueChecking = false;
  bool _isQrBatchActive = false;
  int _requestSequence = 0;
  _PendingAdminLinkPageRequest? _pendingPageRequest;
  String? _activeLocationQuery;
  String? _activeRestaurantName;
  int? _activeRadiusMiles;
  Set<AdminRestaurantLinkSource>? _activeSources;
  bool? _activeNeedsQrPreparation;
  String? _queryFingerprint;
  AdminRestaurantMaterializedOrder? _consumedBoundary;

  bool get _pageBusy => _isSearching || _isContinuing || _isLoadingMore;

  @override
  void dispose() {
    _locationController.dispose();
    _restaurantNameController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _submitSearch() async {
    if (_isSearching) {
      return;
    }
    final formIsValid = _formKey.currentState?.validate() ?? false;
    if (!formIsValid || _selectedSources.isEmpty) {
      setState(() {
        _searchError = _selectedSources.isEmpty
            ? 'Select at least one restaurant source.'
            : null;
      });
      return;
    }

    FocusScope.of(context).unfocus();
    final generation = _searchGeneration + 1;
    final searchInstanceId =
        'admin-link-${DateTime.now().microsecondsSinceEpoch}-$generation';
    final locationQuery = _locationController.text;
    final restaurantName = _normalizedOptionalName;
    final sources = Set<AdminRestaurantLinkSource>.unmodifiable(
      _selectedSources,
    );
    final needsQrPreparation = _needsQrPreparation;
    if (_scrollController.hasClients) {
      _scrollController.jumpTo(0);
    }
    setState(() {
      _searchGeneration = generation;
      _hasSubmitted = true;
      _isSearching = true;
      _isContinuing = false;
      _isLoadingMore = false;
      _searchResult = null;
      _searchError = null;
      _appendError = null;
      _nextCursor = null;
      _isPreparing = false;
      _searchExpired = false;
      _preparationUnavailableEncountered = false;
      _continueChecking = false;
      _searchInstanceId = searchInstanceId;
      _resolvedSearchCenter = null;
      _activeLocationQuery = locationQuery;
      _activeRestaurantName = restaurantName;
      _activeRadiusMiles = _radiusMiles;
      _activeSources = sources;
      _activeNeedsQrPreparation = needsQrPreparation;
      _pendingPageRequest = null;
      _preparationOverrides.clear();
      _suppressedCompletedCatalogIds.clear();
      _selectedCatalogRestaurantIds.clear();
      _queryFingerprint = null;
      _consumedBoundary = null;
    });

    if (widget.searchRestaurants == null) {
      final pending = _newPendingPageRequest(
        generation: generation,
        cursor: null,
        kind: _AdminLinkPageRequestKind.initial,
      );
      await _performPageRequest(pending);
      return;
    }

    try {
      final search = widget.searchRestaurants;
      final result = await search!(
        locationQuery: locationQuery,
        radiusMiles: _radiusMiles,
        restaurantName: restaurantName,
        sources: sources,
      );
      if (!mounted || _searchGeneration != generation) {
        return;
      }
      setState(() {
        _searchResult = result;
        _searchError = null;
      });
    } catch (error) {
      if (!mounted || _searchGeneration != generation) {
        return;
      }
      setState(() {
        _searchResult = null;
        _searchError = error is AdminLinkGenerationException
            ? error.message
            : AppErrorText.friendly(
                error,
                fallback: 'Could not search restaurants right now.',
              );
      });
    } finally {
      if (mounted && _searchGeneration == generation) {
        setState(() {
          _isSearching = false;
        });
      }
    }
  }

  _PendingAdminLinkPageRequest _newPendingPageRequest({
    required int generation,
    required String? cursor,
    required _AdminLinkPageRequestKind kind,
  }) {
    _requestSequence += 1;
    final pending = _PendingAdminLinkPageRequest(
      generation: generation,
      cursor: cursor,
      clientRequestId:
          '${_searchInstanceId ?? 'admin-link'}-request-$_requestSequence',
      kind: kind,
    );
    _pendingPageRequest = pending;
    return pending;
  }

  Future<void> _performPageRequest(_PendingAdminLinkPageRequest pending) async {
    if (!mounted || pending.generation != _searchGeneration) {
      return;
    }
    final isInitial = pending.kind == _AdminLinkPageRequestKind.initial;
    final wasPreparing = pending.kind == _AdminLinkPageRequestKind.preparation;
    setState(() {
      if (isInitial) {
        _isSearching = true;
      } else if (wasPreparing) {
        _isContinuing = true;
      } else {
        _isLoadingMore = true;
      }
      _searchError = null;
      _appendError = null;
    });
    try {
      final callback = widget.searchRestaurantPage;
      final result = callback != null
          ? await callback(
              locationQuery: _activeLocationQuery!,
              radiusMiles: _activeRadiusMiles!,
              restaurantName: _activeRestaurantName,
              sources: _activeSources!,
              searchInstanceId: _searchInstanceId!,
              clientRequestId: pending.clientRequestId,
              needsQrPreparation: _activeNeedsQrPreparation!,
              cursor: pending.cursor,
              resolvedSearchCenter: pending.cursor == null
                  ? null
                  : _resolvedSearchCenter,
            )
          : await _searchService.searchPage(
              locationQuery: _activeLocationQuery!,
              radiusMiles: _activeRadiusMiles!,
              restaurantName: _activeRestaurantName,
              sources: _activeSources!,
              searchInstanceId: _searchInstanceId!,
              clientRequestId: pending.clientRequestId,
              needsQrPreparation: _activeNeedsQrPreparation!,
              cursor: pending.cursor,
              resolvedSearchCenter: pending.cursor == null
                  ? null
                  : _resolvedSearchCenter,
            );
      if (!mounted || pending.generation != _searchGeneration) {
        return;
      }
      _applyPageResult(result, pending);
    } catch (error) {
      if (!mounted || pending.generation != _searchGeneration) {
        return;
      }
      final message = error is AdminLinkGenerationException
          ? error.message
          : AppErrorText.friendly(
              error,
              fallback: 'Could not continue this restaurant search right now.',
            );
      setState(() {
        if (error is AdminLinkSearchExpiredException) {
          _searchExpired = true;
          _nextCursor = null;
          _appendError = null;
          _searchError = null;
        } else if (isInitial) {
          _searchError = message;
        } else {
          _appendError = message;
        }
      });
    } finally {
      if (mounted && pending.generation == _searchGeneration) {
        setState(() {
          _isSearching = false;
          _isContinuing = false;
          _isLoadingMore = false;
        });
      }
    }
  }

  void _applyPageResult(
    AdminRestaurantLinkPagedResult pageResult,
    _PendingAdminLinkPageRequest pending,
  ) {
    final existing =
        _searchResult?.results ?? const <AdminRestaurantLinkRecord>[];
    final queryFingerprint = pageResult.page.queryFingerprint;
    if (pageResult.radiusMiles != _activeRadiusMiles ||
        !_sameSources(pageResult.queriedSources, _activeSources!) ||
        (pageResult.needsQrPreparation != null &&
            pageResult.needsQrPreparation != _activeNeedsQrPreparation) ||
        (_activeNeedsQrPreparation == true &&
            pageResult.needsQrPreparation != true)) {
      throw const AdminLinkGenerationException(
        'Restaurant search returned an invalid page.',
      );
    }
    if (pending.cursor != null &&
        (_queryFingerprint == null || queryFingerprint != _queryFingerprint)) {
      throw const AdminLinkGenerationException(
        'Restaurant search returned an invalid continuation page.',
      );
    }
    if (pending.cursor != null && _resolvedSearchCenter != null) {
      final center = pageResult.searchCenter;
      final expectedCenter = _resolvedSearchCenter!;
      if (center.latitude != expectedCenter.latitude ||
          center.longitude != expectedCenter.longitude ||
          center.displayName != expectedCenter.displayName) {
        throw const AdminLinkGenerationException(
          'Restaurant search returned an invalid continuation page.',
        );
      }
    }
    if (_activeNeedsQrPreparation != true) {
      final loadedKeys = existing.map((record) => record.recordKey).toSet();
      for (final record in pageResult.page.items) {
        if (!loadedKeys.add(record.recordKey)) {
          throw const AdminLinkGenerationException(
            'Restaurant search returned duplicate records. Refresh the search.',
          );
        }
      }
    }
    final pageBoundary = pageResult.consumedBoundary;
    if (pending.kind == _AdminLinkPageRequestKind.loadMore ||
        pending.kind == _AdminLinkPageRequestKind.checking) {
      final previousBoundary = _consumedBoundary;
      final firstPageOrder = pageResult.page.items.isEmpty
          ? null
          : pageResult.page.items.first.materializedOrder;
      if (!pageResult.isReady ||
          previousBoundary == null ||
          pageBoundary == null ||
          pageBoundary.compareTo(previousBoundary) <= 0 ||
          (pageResult.page.items.isNotEmpty &&
              (firstPageOrder == null ||
                  firstPageOrder.compareTo(previousBoundary) <= 0))) {
        throw const AdminLinkGenerationException(
          'Restaurant search returned an invalid continuation page.',
        );
      }
    }
    AdminRestaurantMaterializedOrder? previousPageOrder;
    for (final record in pageResult.page.items) {
      final order = record.materializedOrder;
      if (order == null ||
          !order.matchesRecord(record) ||
          !_activeSources!.contains(record.source) ||
          (previousPageOrder != null &&
              order.compareTo(previousPageOrder) <= 0) ||
          pageBoundary == null ||
          order.compareTo(pageBoundary) > 0) {
        throw const AdminLinkGenerationException(
          'Restaurant search returned an invalid page.',
        );
      }
      previousPageOrder = order;
    }
    final loadedKeys = existing
        .map(
          (record) => _activeNeedsQrPreparation == true
              ? record.documentId
              : record.recordKey,
        )
        .toSet();
    final acceptedItems = <AdminRestaurantLinkRecord>[];
    for (final record in pageResult.page.items) {
      if (_activeNeedsQrPreparation == true) {
        if (!record.isBiteScore ||
            record.actionId != record.documentId ||
            record.preparation.canonicalCatalogRestaurantId !=
                record.documentId ||
            !record.preparation.needsPreparation) {
          throw const AdminLinkGenerationException(
            'Restaurant search returned an invalid filtered page.',
          );
        }
        final override = _preparationOverrides[record.documentId];
        if (_suppressedCompletedCatalogIds.contains(record.documentId) ||
            override?.isComplete == true) {
          _suppressedCompletedCatalogIds.add(record.documentId);
          continue;
        }
      }
      final identity = _activeNeedsQrPreparation == true
          ? record.documentId
          : record.recordKey;
      if (!loadedKeys.add(identity)) {
        throw const AdminLinkGenerationException(
          'Restaurant search returned duplicate records. Refresh the search.',
        );
      }
      acceptedItems.add(record);
    }
    final accumulated = <AdminRestaurantLinkRecord>[
      ...existing,
      ...acceptedItems,
    ];
    setState(() {
      _resolvedSearchCenter = pageResult.searchCenter;
      _isPreparing = pageResult.isPreparing;
      _nextCursor = pageResult.nextCursor;
      _continueChecking =
          _activeNeedsQrPreparation == true &&
          pageResult.hasNext &&
          acceptedItems.length < adminDirectoryDefaultPageSize;
      _preparationUnavailableEncountered =
          _preparationUnavailableEncountered ||
          pageResult.preparationUnavailableEncountered;
      _searchResult = pageResult.asAccumulatedResult(accumulated);
      _searchError = pageResult.isFailed
          ? pageResult.preparationMessage ??
                'Restaurant search preparation failed. Run the search again.'
          : null;
      _appendError = null;
      _searchExpired = false;
      _pendingPageRequest = null;
      _queryFingerprint = queryFingerprint;
      if (pageResult.isReady) {
        _consumedBoundary = pageBoundary;
      }
    });
  }

  bool _sameSources(
    List<AdminRestaurantLinkSource> first,
    Set<AdminRestaurantLinkSource> second,
  ) {
    final orderedSecond = AdminRestaurantLinkSource.values
        .where(second.contains)
        .toList(growable: false);
    if (first.length != orderedSecond.length) {
      return false;
    }
    for (var index = 0; index < first.length; index += 1) {
      if (first[index] != orderedSecond[index]) {
        return false;
      }
    }
    return true;
  }

  Future<void> _continueSearch() async {
    if (_pageBusy || !_isPreparing || _nextCursor == null) {
      return;
    }
    await _performPageRequest(
      _newPendingPageRequest(
        generation: _searchGeneration,
        cursor: _nextCursor,
        kind: _AdminLinkPageRequestKind.preparation,
      ),
    );
  }

  Future<void> _loadMore() async {
    if (_pageBusy || _isPreparing || _nextCursor == null) {
      return;
    }
    await _performPageRequest(
      _newPendingPageRequest(
        generation: _searchGeneration,
        cursor: _nextCursor,
        kind: _continueChecking
            ? _AdminLinkPageRequestKind.checking
            : _AdminLinkPageRequestKind.loadMore,
      ),
    );
  }

  Future<void> _retryPendingPage() async {
    final pending = _pendingPageRequest;
    if (_pageBusy ||
        pending == null ||
        pending.generation != _searchGeneration) {
      return;
    }
    await _performPageRequest(pending);
  }

  String? get _normalizedOptionalName {
    final value = _restaurantNameController.text.trim();
    return value.isEmpty ? null : value;
  }

  void _toggleSource(AdminRestaurantLinkSource source, bool selected) {
    if (_pageBusy) {
      return;
    }
    if (source == AdminRestaurantLinkSource.biteScore &&
        _needsQrPreparation &&
        !selected) {
      _showSnackBar(
        'BiteScore is required while Needs QR preparation is selected.',
      );
      return;
    }
    if (!selected && _selectedSources.length == 1) {
      _showSnackBar('Select at least one restaurant source.');
      return;
    }
    setState(() {
      if (selected) {
        _selectedSources.add(source);
      } else {
        _selectedSources.remove(source);
      }
      _invalidateSearchForCriteriaChange();
    });
  }

  void _toggleNeedsQrPreparation(bool selected) {
    if (_pageBusy || selected == _needsQrPreparation) {
      return;
    }
    setState(() {
      _needsQrPreparation = selected;
      if (selected) {
        _selectedSources.add(AdminRestaurantLinkSource.biteScore);
      }
      _invalidateSearchForCriteriaChange();
    });
  }

  void _invalidateSearchForCriteriaChange() {
    _searchGeneration += 1;
    _isSearching = false;
    _isContinuing = false;
    _isLoadingMore = false;
    _hasSubmitted = false;
    _searchResult = null;
    _searchError = null;
    _appendError = null;
    _nextCursor = null;
    _searchInstanceId = null;
    _resolvedSearchCenter = null;
    _isPreparing = false;
    _searchExpired = false;
    _pendingPageRequest = null;
    _activeLocationQuery = null;
    _activeRestaurantName = null;
    _activeRadiusMiles = null;
    _activeSources = null;
    _activeNeedsQrPreparation = null;
    _queryFingerprint = null;
    _consumedBoundary = null;
    _preparationUnavailableEncountered = false;
    _continueChecking = false;
    _preparationOverrides.clear();
    _suppressedCompletedCatalogIds.clear();
    _selectedCatalogRestaurantIds.clear();
  }

  String? _selectableCatalogRestaurantId(
    AdminRestaurantLinkRecord record, {
    required bool forNewSelection,
  }) {
    if (!record.isBiteScore ||
        exactFirestoreDocumentId(record.documentId) != record.documentId ||
        record.isActive != true ||
        record.actionId != record.documentId ||
        (forNewSelection && _searchExpired) ||
        _suppressedCompletedCatalogIds.contains(record.documentId)) {
      return null;
    }
    final loadedRecords = _searchResult?.results;
    if (loadedRecords == null ||
        !loadedRecords.any((loaded) => identical(loaded, record))) {
      return null;
    }
    final preparation = _preparationFor(record);
    if (preparation.isUnavailable ||
        preparation.canonicalCatalogRestaurantId != record.documentId ||
        !preparation.isValidForParticipation(
          biteSaverCatalogBindingState: record.biteSaverCatalogBindingState,
          claimState: record.claimState,
        )) {
      return null;
    }
    return record.documentId;
  }

  Set<String> _loadedSelectableCatalogRestaurantIds({
    required bool forNewSelection,
  }) {
    final records = _searchResult?.results;
    if (records == null) {
      return <String>{};
    }
    return records
        .map(
          (record) => _selectableCatalogRestaurantId(
            record,
            forNewSelection: forNewSelection,
          ),
        )
        .whereType<String>()
        .toSet();
  }

  void _setRestaurantSelected(AdminRestaurantLinkRecord record, bool selected) {
    final wasSelected = _selectedCatalogRestaurantIds.contains(
      record.documentId,
    );
    final catalogId = _selectableCatalogRestaurantId(
      record,
      forNewSelection: selected && !wasSelected,
    );
    if (catalogId == null) {
      return;
    }
    setState(() {
      if (selected) {
        _selectedCatalogRestaurantIds.add(catalogId);
      } else {
        _selectedCatalogRestaurantIds.remove(catalogId);
      }
    });
  }

  void _selectAllLoaded() {
    final selectableIds = _loadedSelectableCatalogRestaurantIds(
      forNewSelection: true,
    );
    if (selectableIds.isEmpty) {
      return;
    }
    setState(() {
      _selectedCatalogRestaurantIds.addAll(selectableIds);
    });
  }

  void _deselectAll() {
    if (_selectedCatalogRestaurantIds.isEmpty) {
      return;
    }
    setState(_selectedCatalogRestaurantIds.clear);
  }

  Future<void> _generateQrLabelPdf() async {
    if (_isQrBatchActive || _selectedCatalogRestaurantIds.isEmpty) {
      return;
    }
    final displayedRecords = _searchResult?.results;
    if (displayedRecords == null) {
      _showSnackBar(
        'The selected restaurants changed unexpectedly. Run a fresh Search.',
      );
      return;
    }

    late final List<String> frozenCatalogRestaurantIds;
    try {
      frozenCatalogRestaurantIds = freezeAdminRestaurantQrBatchSelection(
        selectedCatalogRestaurantIds: Set<String>.of(
          _selectedCatalogRestaurantIds,
        ),
        displayedRecords: displayedRecords,
        isCurrentlySelectable: (record) =>
            _selectableCatalogRestaurantId(record, forNewSelection: false) ==
            record.documentId,
      );
    } on AdminRestaurantQrBatchSelectionException catch (error) {
      _showSnackBar(error.message);
      return;
    }

    final searchGeneration = _searchGeneration;
    setState(() {
      _isQrBatchActive = true;
    });
    AdminRestaurantQrBatchReconciliation? pendingReconciliation;
    try {
      await showAdminRestaurantQrBatchDialog(
        context: context,
        frozenCatalogRestaurantIds: frozenCatalogRestaurantIds,
        dependencies: widget.qrBatchDependencies,
        onReconciled: (reconciliation) {
          pendingReconciliation = reconciliation;
        },
      );
      final reconciliation = pendingReconciliation;
      if (reconciliation != null) {
        _reconcileQrBatch(
          reconciliation,
          expectedSearchGeneration: searchGeneration,
          expectedFrozenCatalogRestaurantIds: frozenCatalogRestaurantIds,
        );
      }
    } catch (error) {
      if (mounted) {
        _showSnackBar(
          AppErrorText.friendly(
            error,
            fallback: 'Could not start QR label PDF generation.',
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isQrBatchActive = false;
        });
      }
    }
  }

  void _reconcileQrBatch(
    AdminRestaurantQrBatchReconciliation reconciliation, {
    required int expectedSearchGeneration,
    required Iterable<String> expectedFrozenCatalogRestaurantIds,
  }) {
    if (!mounted || _searchGeneration != expectedSearchGeneration) {
      return;
    }
    final frozenIds = expectedFrozenCatalogRestaurantIds.toSet();
    final preparationStates = <String, AdminRestaurantPreparationState>{
      for (final entry in reconciliation.preparationProjections.entries)
        if (frozenIds.contains(entry.key))
          entry.key: _preparationStateFromBatchProjection(entry.value),
    };
    final unresolvedIds = reconciliation.unresolvedCatalogRestaurantIds
        .intersection(frozenIds);
    final problemIds = reconciliation.problemCatalogRestaurantIds.intersection(
      frozenIds,
    );
    final retentionCandidates = unresolvedIds.union(problemIds);
    final recordsByRetentionCandidate =
        <String, List<AdminRestaurantLinkRecord>>{
          for (final id in retentionCandidates)
            id: <AdminRestaurantLinkRecord>[],
        };
    for (final record
        in _searchResult?.results ?? const <AdminRestaurantLinkRecord>[]) {
      recordsByRetentionCandidate[record.documentId]?.add(record);
    }
    final idsToKeepSelected = <String>{
      for (final entry in recordsByRetentionCandidate.entries)
        if (entry.value.length == 1 &&
            _selectableCatalogRestaurantId(
                  entry.value.single,
                  forNewSelection: false,
                ) ==
                entry.key)
          entry.key,
    };
    final preparationStatesToApply =
        Map<String, AdminRestaurantPreparationState>.of(preparationStates);
    for (final id in idsToKeepSelected) {
      final candidateState = preparationStatesToApply[id];
      final record = recordsByRetentionCandidate[id]!.single;
      if (candidateState != null &&
          (candidateState.isUnavailable ||
              candidateState.canonicalCatalogRestaurantId !=
                  record.documentId ||
              !candidateState.isValidForParticipation(
                biteSaverCatalogBindingState:
                    record.biteSaverCatalogBindingState,
                claimState: record.claimState,
              ))) {
        preparationStatesToApply.remove(id);
      }
    }
    final idsToDeselect = reconciliation.resolvedCatalogRestaurantIds
        .intersection(frozenIds)
        .difference(unresolvedIds)
        .difference(problemIds);
    final completedIds = preparationStates.entries
        .where(
          (entry) =>
              entry.value.isComplete && idsToDeselect.contains(entry.key),
        )
        .map((entry) => entry.key)
        .toSet();

    setState(() {
      _preparationOverrides.addAll(preparationStatesToApply);
      _selectedCatalogRestaurantIds
        ..removeAll(retentionCandidates)
        ..addAll(idsToKeepSelected);
      _selectedCatalogRestaurantIds.removeAll(idsToDeselect);

      if (_activeNeedsQrPreparation == true && completedIds.isNotEmpty) {
        _suppressedCompletedCatalogIds.addAll(completedIds);
        final currentResult = _searchResult;
        if (currentResult != null) {
          final remaining = currentResult.results
              .where((record) => !completedIds.contains(record.documentId))
              .toList(growable: false);
          if (remaining.length != currentResult.results.length) {
            _searchResult = AdminRestaurantLinkSearchResult(
              searchCenter: currentResult.searchCenter,
              radiusMiles: currentResult.radiusMiles,
              results: List<AdminRestaurantLinkRecord>.unmodifiable(remaining),
              resultsMayBeTruncated: currentResult.resultsMayBeTruncated,
              returnedCount: remaining.length,
              queriedSources: currentResult.queriedSources,
            );
            if (remaining.isEmpty && _nextCursor != null) {
              _continueChecking = true;
            }
          }
        }
      }
    });
  }

  AdminRestaurantPreparationState _preparationStateFromBatchProjection(
    AdminRestaurantQrPreparationProjection projection,
  ) {
    AdminRestaurantPreparationStatus convert(
      AdminRestaurantQrPreparationStatus status,
    ) => switch (status) {
      AdminRestaurantQrPreparationStatus.prepared =>
        AdminRestaurantPreparationStatus.prepared,
      AdminRestaurantQrPreparationStatus.unprepared =>
        AdminRestaurantPreparationStatus.unprepared,
      AdminRestaurantQrPreparationStatus.notRequired =>
        AdminRestaurantPreparationStatus.notRequired,
      AdminRestaurantQrPreparationStatus.unavailable =>
        AdminRestaurantPreparationStatus.unavailable,
    };

    return AdminRestaurantPreparationState(
      canonicalCatalogRestaurantId: projection.canonicalCatalogRestaurantId,
      ownerInvite: convert(projection.ownerInvite),
      claimInvite: convert(projection.claimInvite),
      biteSaverCustomer: convert(projection.biteSaverCustomer),
      biteScoreCustomer: convert(projection.biteScoreCustomer),
    );
  }

  String _actionKey(AdminRestaurantLinkRecord record, String action) {
    return '${record.recordKey}:$action';
  }

  bool _isActionBusy(AdminRestaurantLinkRecord record, String action) {
    return _busyActions.contains(_actionKey(record, action));
  }

  Future<void> _runBusyAction(
    AdminRestaurantLinkRecord record,
    String action,
    Future<void> Function() callback,
  ) async {
    final key = _actionKey(record, action);
    if (_busyActions.contains(key)) {
      return;
    }
    setState(() {
      _busyActions.add(key);
    });
    try {
      await callback();
    } finally {
      if (mounted) {
        setState(() {
          _busyActions.remove(key);
        });
      }
    }
  }

  AdminRestaurantPreparationState _preparationFor(
    AdminRestaurantLinkRecord record,
  ) {
    final canonicalId = record.preparation.canonicalCatalogRestaurantId;
    return canonicalId == null
        ? record.preparation
        : _preparationOverrides[canonicalId] ?? record.preparation;
  }

  bool _isPreparationBusy(AdminRestaurantLinkRecord record) {
    final canonicalId = record.preparation.canonicalCatalogRestaurantId;
    return canonicalId != null &&
        _busyPreparationCatalogIds.contains(canonicalId);
  }

  Future<AdminRestaurantPreparationState> _persistPreparation({
    required AdminRestaurantLinkRecord record,
    required AdminRestaurantPreparationType type,
    required bool prepared,
    String? expectedInviteId,
  }) async {
    if (!mounted) {
      throw const AdminLinkGenerationException(
        'Preparation tracking is no longer available.',
      );
    }
    final canonicalId = record.preparation.canonicalCatalogRestaurantId;
    if (canonicalId == null) {
      throw const AdminLinkGenerationException(
        'Preparation tracking is unavailable for this restaurant record.',
      );
    }
    if (_busyPreparationCatalogIds.contains(canonicalId)) {
      throw const AdminLinkGenerationException(
        'Another preparation update is already in progress for this restaurant.',
      );
    }
    final searchGeneration = _searchGeneration;
    final mutationGeneration =
        (_preparationMutationGenerations[canonicalId] ?? 0) + 1;
    _preparationMutationGenerations[canonicalId] = mutationGeneration;
    setState(() {
      _busyPreparationCatalogIds.add(canonicalId);
    });
    try {
      final update = widget.updatePreparation;
      final state = update != null
          ? await update(
              catalogRestaurantId: canonicalId,
              type: type,
              prepared: prepared,
              biteSaverCatalogBindingState: record.biteSaverCatalogBindingState,
              claimState: record.claimState,
              expectedInviteId: expectedInviteId,
            )
          : await _searchService.updatePreparation(
              catalogRestaurantId: canonicalId,
              type: type,
              prepared: prepared,
              biteSaverCatalogBindingState: record.biteSaverCatalogBindingState,
              claimState: record.claimState,
              expectedInviteId: expectedInviteId,
            );
      if (state.canonicalCatalogRestaurantId != canonicalId ||
          !state.isValidForParticipation(
            biteSaverCatalogBindingState: record.biteSaverCatalogBindingState,
            claimState: record.claimState,
          )) {
        throw const AdminLinkGenerationException(
          'Preparation status returned an invalid response.',
        );
      }
      if (mounted &&
          _searchGeneration == searchGeneration &&
          _preparationMutationGenerations[canonicalId] == mutationGeneration) {
        setState(() {
          _preparationOverrides[canonicalId] = state;
          if (_activeNeedsQrPreparation == true && state.isComplete) {
            _suppressedCompletedCatalogIds.add(canonicalId);
            _selectedCatalogRestaurantIds.remove(canonicalId);
            final currentResult = _searchResult;
            if (currentResult != null) {
              final remaining = currentResult.results
                  .where((item) => item.documentId != canonicalId)
                  .toList(growable: false);
              _searchResult = AdminRestaurantLinkSearchResult(
                searchCenter: currentResult.searchCenter,
                radiusMiles: currentResult.radiusMiles,
                results: List.unmodifiable(remaining),
                resultsMayBeTruncated: currentResult.resultsMayBeTruncated,
                returnedCount: remaining.length,
                queriedSources: currentResult.queriedSources,
              );
              if (remaining.isEmpty && _nextCursor != null) {
                _continueChecking = true;
              }
            }
          }
        });
      }
      return state;
    } finally {
      _busyPreparationCatalogIds.remove(canonicalId);
      if (mounted) {
        setState(() {});
      }
    }
  }

  Future<void> _togglePreparation(
    AdminRestaurantLinkRecord record,
    AdminRestaurantPreparationType type,
    bool prepared,
  ) async {
    await _runBusyAction(record, 'preparation-${type.marker}', () async {
      try {
        await _persistPreparation(
          record: record,
          type: type,
          prepared: prepared,
        );
        if (mounted) {
          _showSnackBar(
            '${type.marker} preparation ${prepared ? 'marked' : 'cleared'}.',
          );
        }
      } catch (error) {
        if (mounted) {
          _showSnackBar(
            AppErrorText.friendly(
              error,
              fallback: 'Could not update preparation status right now.',
            ),
          );
        }
      }
    });
  }

  Future<RestaurantQrImageResult> _renderQrImage({
    required String restaurantName,
    required String url,
    required RestaurantQrLinkType linkType,
  }) {
    final render = widget.renderQrImage;
    if (render != null) {
      return render(
        restaurantName: restaurantName,
        url: url,
        linkType: linkType,
      );
    }
    return const RestaurantQrImageService().render(
      restaurantName: restaurantName,
      url: url,
      linkType: linkType,
    );
  }

  Future<void> _generateBiteSaverOwnerInvite(
    AdminRestaurantLinkRecord record,
  ) async {
    if (record.isBiteScore && !record.canCreateBiteSaverOwnerInvite) {
      return;
    }
    await _runBusyAction(record, 'coupon-invite', () async {
      try {
        final createInvite = widget.createCouponInvite;
        final result = createInvite != null
            ? await createInvite(
                restaurantName: record.restaurantName,
                restaurantId: record.isBiteSaver ? record.actionId : null,
                biteScoreCatalogRestaurantId: record.isBiteScore
                    ? record.documentId
                    : null,
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
                restaurantName: record.restaurantName,
                restaurantId: record.isBiteSaver ? record.actionId : null,
                biteScoreCatalogRestaurantId: record.isBiteScore
                    ? record.documentId
                    : null,
                streetAddress: record.streetAddress,
                city: record.city,
                state: record.state,
                zipCode: record.zipCode,
                phone: record.phone,
                website: record.website,
                latitude: record.latitude,
                longitude: record.longitude,
              );
        if (!mounted) {
          return;
        }
        await _showLinkActionDialog(
          record: record,
          title: 'BiteSaver Owner Invite Created',
          linkUrl: result.inviteUrl,
          restaurantName: record.restaurantName,
          linkType: RestaurantQrLinkType.couponInvite,
          isSensitive: true,
          preparationType: AdminRestaurantPreparationType.ownerInvite,
          expectedInviteId: result.inviteId,
        );
      } catch (error) {
        if (!mounted) {
          return;
        }
        _showSnackBar(
          AppErrorText.friendly(
            error,
            fallback: 'Could not create the BiteSaver owner invite right now.',
          ),
        );
      }
    });
  }

  Future<void> _generateBiteScoreClaimInvite(
    AdminRestaurantLinkRecord record,
  ) async {
    if (!record.canCreateBiteScoreClaimInvite) {
      return;
    }
    await _runBusyAction(record, 'claim-invite', () async {
      try {
        final createInvite = widget.createBiteScoreClaimInvite;
        final result = createInvite != null
            ? await createInvite(restaurantId: record.documentId)
            : await RestaurantInviteService.createBiteScoreClaimInvite(
                restaurantId: record.documentId,
              );
        if (!mounted) {
          return;
        }
        await _showLinkActionDialog(
          record: record,
          title: 'BiteScore Claim Invite Created',
          linkUrl: result.inviteUrl,
          restaurantName: record.restaurantName,
          linkType: RestaurantQrLinkType.biteScoreClaimInvite,
          isSensitive: true,
          preparationType: AdminRestaurantPreparationType.claimInvite,
          expectedInviteId: result.inviteId,
        );
      } catch (error) {
        if (!mounted) {
          return;
        }
        _showSnackBar(
          AppErrorText.friendly(
            error,
            fallback: 'Could not create the BiteScore claim invite right now.',
          ),
        );
      }
    });
  }

  Future<void> _openCustomerBiteSaverLink(
    AdminRestaurantLinkRecord record,
  ) async {
    if (!record.canCopyCatalogBiteSaverCustomerLink &&
        !record.canCopyCouponCustomerLink) {
      return;
    }
    await _runBusyAction(record, 'customer-bitesaver-link', () async {
      try {
        final link = RestaurantCustomerLinkService.couponRestaurantUrl(
          record.documentId,
        );
        await _showLinkActionDialog(
          record: record,
          title: 'Customer BiteSaver Link',
          linkUrl: link,
          restaurantName: record.restaurantName,
          linkType: RestaurantQrLinkType.customerBiteSaver,
          isSensitive: false,
          preparationType: AdminRestaurantPreparationType.biteSaverCustomer,
        );
      } catch (_) {
        if (mounted) {
          _showSnackBar('Could not open the customer link.');
        }
      }
    });
  }

  Future<void> _openCustomerBiteScoreLink(
    AdminRestaurantLinkRecord record,
  ) async {
    if (!record.isBiteScore || record.isActive != true) {
      return;
    }
    await _runBusyAction(record, 'customer-bitescore-link', () async {
      try {
        final link = RestaurantCustomerLinkService.biteScoreRestaurantUrl(
          record.documentId,
        );
        await _showLinkActionDialog(
          record: record,
          title: 'Customer BiteScore Link',
          linkUrl: link,
          restaurantName: record.restaurantName,
          linkType: RestaurantQrLinkType.customerBiteScore,
          isSensitive: false,
          preparationType: AdminRestaurantPreparationType.biteScoreCustomer,
        );
      } catch (_) {
        if (mounted) {
          _showSnackBar('Could not open the customer link.');
        }
      }
    });
  }

  Future<void> _writeClipboard(String text) async {
    final writeClipboard = widget.writeClipboard;
    if (writeClipboard != null) {
      await writeClipboard(text);
      return;
    }
    await Clipboard.setData(ClipboardData(text: text));
  }

  Future<void> _copyMailingAddress(AdminRestaurantLinkRecord record) async {
    await _runBusyAction(record, 'copy-mailing-address', () async {
      final restaurantName = record.restaurantName.trim();
      final streetAddress = record.streetAddress.trim();
      final city = record.city.trim();
      final state = record.state.trim();
      final zipCode = record.zipCode.trim();
      if (restaurantName.isEmpty ||
          streetAddress.isEmpty ||
          city.isEmpty ||
          state.isEmpty ||
          zipCode.isEmpty) {
        _showSnackBar('Mailing address is incomplete.');
        return;
      }

      final mailingAddress =
          '$restaurantName\n$streetAddress\n$city, $state $zipCode';
      try {
        await _writeClipboard(mailingAddress);
        if (mounted) {
          _showSnackBar('Mailing address copied.');
        }
      } catch (_) {
        if (mounted) {
          _showSnackBar('Could not copy the mailing address.');
        }
      }
    });
  }

  Future<void> _showLinkActionDialog({
    required AdminRestaurantLinkRecord record,
    required String title,
    required String linkUrl,
    required String restaurantName,
    required RestaurantQrLinkType linkType,
    required bool isSensitive,
    required AdminRestaurantPreparationType preparationType,
    String? expectedInviteId,
  }) async {
    while (mounted) {
      final image = await showDialog<RestaurantQrImageResult>(
        context: context,
        builder: (dialogContext) {
          var isCopying = false;
          var isCreatingQr = false;
          return StatefulBuilder(
            builder: (context, setDialogState) {
              return AlertDialog(
                key: const ValueKey('admin-link-action-dialog'),
                scrollable: true,
                insetPadding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 24,
                ),
                title: Text(title),
                content: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 600),
                  child: SelectableText(
                    linkUrl,
                    key: const ValueKey('admin-link-action-url'),
                  ),
                ),
                actions: [
                  TextButton(
                    key: const ValueKey('close-link-action-dialog'),
                    onPressed: () => Navigator.of(dialogContext).pop(),
                    child: const Text('Close'),
                  ),
                  OutlinedButton.icon(
                    key: const ValueKey('create-link-qr'),
                    onPressed: isCreatingQr
                        ? null
                        : () async {
                            setDialogState(() {
                              isCreatingQr = true;
                            });
                            try {
                              final generatedImage = await _renderQrImage(
                                restaurantName: restaurantName,
                                url: linkUrl,
                                linkType: linkType,
                              );
                              if (dialogContext.mounted) {
                                Navigator.of(dialogContext).pop(generatedImage);
                              }
                            } catch (error) {
                              if (mounted) {
                                _showSnackBar(
                                  error is RestaurantQrImageException
                                      ? error.message
                                      : 'Could not create the QR image.',
                                );
                              }
                              if (dialogContext.mounted) {
                                setDialogState(() {
                                  isCreatingQr = false;
                                });
                              }
                            }
                          },
                    icon: isCreatingQr
                        ? const SizedBox.square(
                            dimension: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.qr_code_2),
                    label: Text(
                      isCreatingQr ? 'Creating...' : 'Create QR Image',
                    ),
                  ),
                  FilledButton.icon(
                    key: const ValueKey('copy-link-action'),
                    onPressed: isCopying
                        ? null
                        : () async {
                            setDialogState(() {
                              isCopying = true;
                            });
                            try {
                              await _writeClipboard(linkUrl);
                              if (mounted) {
                                _showSnackBar('Link copied.');
                              }
                            } catch (_) {
                              if (mounted) {
                                _showSnackBar('Could not copy the link.');
                              }
                            } finally {
                              if (dialogContext.mounted) {
                                setDialogState(() {
                                  isCopying = false;
                                });
                              }
                            }
                          },
                    icon: isCopying
                        ? const SizedBox.square(
                            dimension: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.copy),
                    label: Text(isCopying ? 'Copying...' : 'Copy Link'),
                  ),
                ],
              );
            },
          );
        },
      );
      if (!mounted || image == null) {
        return;
      }
      final exit = await showRestaurantQrPreviewDialog(
        context: context,
        image: image,
        isSensitive: isSensitive,
        showBack: true,
        exporter: widget.qrExporter,
        onExportSucceeded:
            record.preparation.canonicalCatalogRestaurantId == null
            ? null
            : () async {
                await _persistPreparation(
                  record: record,
                  type: preparationType,
                  prepared: true,
                  expectedInviteId: expectedInviteId,
                );
              },
      );
      if (!mounted || exit != RestaurantQrPreviewExit.back) {
        return;
      }
    }
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
      );
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final result = _searchResult;
        final records =
            !_isSearching &&
                _searchError == null &&
                !_isPreparing &&
                result != null &&
                result.results.isNotEmpty
            ? result.results
            : const <AdminRestaurantLinkRecord>[];
        final rendersRecords = records.isNotEmpty;
        final recordOccurrences = <String, int>{};
        final duplicateIndices = records
            .map((record) {
              final occurrence = recordOccurrences[record.recordKey] ?? 0;
              recordOccurrences[record.recordKey] = occurrence + 1;
              return occurrence;
            })
            .toList(growable: false);
        final itemCount = rendersRecords ? records.length + 5 : 3;
        return ListView.builder(
          key: const ValueKey('admin-link-generation-scroll-view'),
          controller: _scrollController,
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          itemCount: itemCount,
          itemBuilder: (context, index) {
            Widget child;
            if (index == 0) {
              child = _buildSearchCard();
            } else if (index == 1) {
              child = const SizedBox(height: 16);
            } else if (!rendersRecords) {
              child = _buildSearchState();
            } else if (index == 2) {
              child = _buildResultsSummary(result!);
            } else if (index == 3) {
              child = _buildSelectionStrip();
            } else if (index < records.length + 4) {
              final recordIndex = index - 4;
              final record = records[recordIndex];
              child = _buildResultCard(
                record,
                duplicateIndex: duplicateIndices[recordIndex],
              );
            } else {
              child = _buildResultsFooter();
            }
            return Align(
              alignment: Alignment.topCenter,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1120),
                child: SizedBox(width: double.infinity, child: child),
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildResultsSummary(AdminRestaurantLinkSearchResult result) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '${result.results.length} restaurant ${result.results.length == 1 ? 'record' : 'records'} near ${result.searchCenter.displayName}',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        if (result.resultsMayBeTruncated) ...[
          const SizedBox(height: 12),
          Card(
            key: const ValueKey('admin-link-truncated-state'),
            color: Theme.of(context).colorScheme.tertiaryContainer,
            child: const Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                'Results were limited. Narrow the radius or add a restaurant name to refine the search.',
              ),
            ),
          ),
        ],
        if (_preparationUnavailableEncountered) ...[
          const SizedBox(height: 12),
          _buildPreparationUnavailableWarning(),
        ],
        if (_searchExpired) ...[
          const SizedBox(height: 12),
          _buildExpiredState(),
        ],
        const SizedBox(height: 12),
      ],
    );
  }

  Widget _buildSelectionStrip() {
    final selectableIds = _loadedSelectableCatalogRestaurantIds(
      forNewSelection: false,
    );
    final loadedCount = _searchResult?.results.length ?? 0;
    final selectableCount = selectableIds.length;
    final selectedCount = _selectedCatalogRestaurantIds.length;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Wrap(
        spacing: 12,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          OutlinedButton(
            key: const ValueKey('admin-link-select-all-loaded'),
            onPressed: _searchExpired || selectableCount == 0
                ? null
                : _selectAllLoaded,
            child: const Text('Select All Loaded'),
          ),
          TextButton(
            key: const ValueKey('admin-link-deselect-all'),
            onPressed: selectedCount == 0 ? null : _deselectAll,
            child: const Text('Deselect All'),
          ),
          FilledButton.icon(
            key: const ValueKey('admin-link-generate-qr-label-pdf'),
            onPressed: selectedCount == 0 || _isQrBatchActive
                ? null
                : _generateQrLabelPdf,
            icon: _isQrBatchActive
                ? const SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.picture_as_pdf_outlined),
            label: const Text('Generate QR Label PDF'),
          ),
          Text(
            '$selectedCount selected',
            key: const ValueKey('admin-link-selected-count'),
            style: Theme.of(context).textTheme.titleSmall,
          ),
          if (selectableCount != loadedCount)
            Text(
              '$selectableCount selectable of $loadedCount loaded',
              key: const ValueKey('admin-link-selectable-loaded-count'),
              style: Theme.of(context).textTheme.bodySmall,
            ),
        ],
      ),
    );
  }

  Widget _buildResultsFooter() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_appendError != null) ...[
          Card(
            key: const ValueKey('admin-link-append-error-state'),
            color: Theme.of(context).colorScheme.errorContainer,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(_appendError!),
            ),
          ),
          const SizedBox(height: 8),
        ],
        if (_nextCursor != null) _buildLoadMoreButton(),
      ],
    );
  }

  Widget _buildPreparationUnavailableWarning() {
    return Card(
      key: const ValueKey('admin-link-preparation-unavailable-warning'),
      color: Theme.of(context).colorScheme.tertiaryContainer,
      child: const Padding(
        padding: EdgeInsets.all(16),
        child: Text(
          'Some restaurant records could not be assessed for QR preparation and are not shown.',
        ),
      ),
    );
  }

  Widget _buildSearchCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Find restaurants',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 6),
              const Text(
                'Search the bounded BiteScore and BiteSaver catalogs before generating or copying a link.',
              ),
              const SizedBox(height: 16),
              LayoutBuilder(
                builder: (context, constraints) {
                  final wide = constraints.maxWidth >= 760;
                  final fieldWidth = wide
                      ? (constraints.maxWidth - 24) / 3
                      : constraints.maxWidth;
                  return Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: [
                      SizedBox(
                        width: fieldWidth,
                        child: TextFormField(
                          key: const ValueKey('admin-link-location-field'),
                          controller: _locationController,
                          enabled: !_pageBusy,
                          decoration: const InputDecoration(
                            labelText: 'ZIP code or City, ST',
                            hintText: '34428 or Crystal River, FL',
                            border: OutlineInputBorder(),
                          ),
                          textInputAction: TextInputAction.search,
                          validator: (value) =>
                              AdminLinkGenerationService.locationValidationError(
                                value ?? '',
                              ),
                          onChanged: (_) {
                            setState(_invalidateSearchForCriteriaChange);
                          },
                          onFieldSubmitted: (_) => _submitSearch(),
                        ),
                      ),
                      SizedBox(
                        width: fieldWidth,
                        child: TextFormField(
                          key: const ValueKey(
                            'admin-link-restaurant-name-field',
                          ),
                          controller: _restaurantNameController,
                          enabled: !_pageBusy,
                          decoration: const InputDecoration(
                            labelText: 'Restaurant name (optional)',
                            border: OutlineInputBorder(),
                          ),
                          textInputAction: TextInputAction.search,
                          validator: (value) =>
                              (value ?? '').trim().length > 100
                              ? 'Use no more than 100 characters.'
                              : null,
                          onChanged: (_) {
                            setState(_invalidateSearchForCriteriaChange);
                          },
                          onFieldSubmitted: (_) => _submitSearch(),
                        ),
                      ),
                      SizedBox(
                        width: fieldWidth,
                        child: DropdownButtonFormField<int>(
                          key: const ValueKey('admin-link-radius-field'),
                          isExpanded: true,
                          initialValue: _radiusMiles,
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
                          onChanged: _pageBusy
                              ? null
                              : (value) {
                                  if (value != null && value != _radiusMiles) {
                                    setState(() {
                                      _radiusMiles = value;
                                      _invalidateSearchForCriteriaChange();
                                    });
                                  }
                                },
                        ),
                      ),
                    ],
                  );
                },
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    'Sources',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  ...AdminRestaurantLinkSource.values.map((source) {
                    return FilterChip(
                      key: ValueKey(
                        'admin-link-source-${source.callableValue}',
                      ),
                      label: Text(source.label),
                      selected: _selectedSources.contains(source),
                      onSelected:
                          _pageBusy ||
                              (_needsQrPreparation &&
                                  source == AdminRestaurantLinkSource.biteScore)
                          ? null
                          : (selected) => _toggleSource(source, selected),
                    );
                  }),
                ],
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    'Filters',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  FilterChip(
                    key: const ValueKey(
                      'admin-link-filter-needs-qr-preparation',
                    ),
                    label: const Text('Needs QR preparation'),
                    selected: _needsQrPreparation,
                    onSelected: _pageBusy ? null : _toggleNeedsQrPreparation,
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 12,
                runSpacing: 8,
                children: [
                  FilledButton.icon(
                    key: const ValueKey('admin-link-search-button'),
                    onPressed: _isSearching ? null : _submitSearch,
                    icon: _isSearching
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.search),
                    label: Text(_isSearching ? 'Searching...' : 'Search'),
                  ),
                  const Text('Maximum radius: 50 miles'),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSearchState() {
    if (_isSearching) {
      return const Center(
        key: ValueKey('admin-link-loading-state'),
        child: Padding(
          padding: EdgeInsets.all(24),
          child: CircularProgressIndicator(),
        ),
      );
    }
    if (_searchExpired) {
      return _buildExpiredState();
    }
    if (_searchError != null) {
      return Card(
        key: const ValueKey('admin-link-error-state'),
        color: Theme.of(context).colorScheme.errorContainer,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_searchError!),
              if (_pendingPageRequest != null) ...[
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  key: const ValueKey('admin-link-retry-search-button'),
                  onPressed: _pageBusy ? null : _retryPendingPage,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Retry'),
                ),
              ],
            ],
          ),
        ),
      );
    }
    if (!_hasSubmitted) {
      return const Card(
        key: ValueKey('admin-link-initial-state'),
        child: Padding(
          padding: EdgeInsets.all(20),
          child: Text('Enter a ZIP code or City, ST to find restaurants.'),
        ),
      );
    }

    if (_isPreparing) {
      return Card(
        key: const ValueKey('admin-link-preparing-state'),
        color: Theme.of(context).colorScheme.secondaryContainer,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Preparing complete nearby results…',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 6),
              const Text(
                'BiteStar is safely checking the remaining nearby restaurants.',
              ),
              if (_appendError != null) ...[
                const SizedBox(height: 10),
                Text(_appendError!),
              ],
              const SizedBox(height: 12),
              FilledButton.icon(
                key: const ValueKey('admin-link-continue-search-button'),
                onPressed: _isContinuing
                    ? null
                    : _appendError == null
                    ? _continueSearch
                    : _retryPendingPage,
                icon: _isContinuing
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.manage_search),
                label: Text(
                  _isContinuing
                      ? 'Continuing...'
                      : _appendError == null
                      ? 'Continue search'
                      : 'Retry',
                ),
              ),
            ],
          ),
        ),
      );
    }

    final hasMore = _nextCursor != null;
    final filterActive = _activeNeedsQrPreparation == true;
    return Card(
      key: ValueKey(
        hasMore
            ? 'admin-link-sparse-results-state'
            : 'admin-link-no-results-state',
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              filterActive && hasMore
                  ? 'Checking which restaurants still need QR preparation…'
                  : filterActive && _preparationUnavailableEncountered
                  ? 'No assessed restaurants need QR preparation. Some records could not be assessed and are not shown.'
                  : filterActive
                  ? 'No restaurants need QR preparation in this search area.'
                  : hasMore
                  ? 'Some nearby records changed while this page was loading. Continue for more current results.'
                  : 'No matching restaurants were found within this search area.',
            ),
            if (_appendError != null) ...[
              const SizedBox(height: 10),
              Text(_appendError!),
            ],
            if (hasMore) ...[
              const SizedBox(height: 12),
              _buildLoadMoreButton(),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildExpiredState() {
    return Card(
      key: const ValueKey('admin-link-expired-state'),
      color: Theme.of(context).colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'This search expired. Run it again to see current results.',
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              key: const ValueKey('admin-link-expired-search-button'),
              onPressed: _pageBusy ? null : _submitSearch,
              icon: const Icon(Icons.refresh),
              label: const Text('Search again'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLoadMoreButton() {
    final checking = _activeNeedsQrPreparation == true && _continueChecking;
    return Align(
      alignment: Alignment.center,
      child: OutlinedButton.icon(
        key: const ValueKey('admin-link-load-more-button'),
        onPressed: _isLoadingMore
            ? null
            : _appendError == null
            ? _loadMore
            : _retryPendingPage,
        icon: _isLoadingMore
            ? const SizedBox.square(
                dimension: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.expand_more),
        label: Text(
          _isLoadingMore
              ? checking
                    ? 'Checking which restaurants still need QR preparation…'
                    : 'Loading more...'
              : _appendError == null
              ? checking
                    ? 'Continue checking'
                    : 'Load More'
              : checking
              ? 'Retry checking'
              : 'Retry Load More',
        ),
      ),
    );
  }

  Widget _buildPreparationStatus(AdminRestaurantLinkRecord record) {
    final preparation = _preparationFor(record);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('QR preparation', style: Theme.of(context).textTheme.labelLarge),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: AdminRestaurantPreparationType.values
              .map((type) {
                final status = preparation.statusFor(type);
                final busy = _isPreparationBusy(record);
                final canToggle =
                    preparation.canonicalCatalogRestaurantId != null &&
                    (status == AdminRestaurantPreparationStatus.prepared ||
                        status == AdminRestaurantPreparationStatus.unprepared);
                return FilterChip(
                  key: ValueKey(
                    '${record.recordKey}:preparation-${type.marker}',
                  ),
                  selected: status == AdminRestaurantPreparationStatus.prepared,
                  onSelected: !canToggle || busy
                      ? null
                      : (selected) =>
                            _togglePreparation(record, type, selected),
                  avatar: busy
                      ? const SizedBox.square(
                          dimension: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : null,
                  label: Text('${type.marker} · ${status.label}'),
                );
              })
              .toList(growable: false),
        ),
      ],
    );
  }

  Widget _buildResultCard(
    AdminRestaurantLinkRecord record, {
    int duplicateIndex = 0,
  }) {
    final selected = _selectedCatalogRestaurantIds.contains(record.documentId);
    final selectableCatalogId = _selectableCatalogRestaurantId(
      record,
      forNewSelection: !selected,
    );
    final stateAndZip = [
      record.state,
      record.zipCode,
    ].where((value) => value.isNotEmpty).join(' ');
    final locality = [
      record.city,
      stateAndZip,
    ].where((value) => value.isNotEmpty).join(', ');
    final isCouponInviteBusy = _isActionBusy(record, 'coupon-invite');
    final isClaimInviteBusy = _isActionBusy(record, 'claim-invite');
    final isCustomerBiteSaverLinkBusy = _isActionBusy(
      record,
      'customer-bitesaver-link',
    );
    final isCustomerBiteScoreLinkBusy = _isActionBusy(
      record,
      'customer-bitescore-link',
    );
    final isMailingAddressBusy = _isActionBusy(record, 'copy-mailing-address');

    final cardKey = 'admin-link-record-${record.recordKey}';
    return Card(
      key: ValueKey(duplicateIndex == 0 ? cardKey : '$cardKey#$duplicateIndex'),
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 10,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (record.isBiteScore)
                  selectableCatalogId != null
                      ? Semantics(
                          container: true,
                          label:
                              'Select ${record.restaurantName} for batch work',
                          checked: selected,
                          enabled: true,
                          onTap: () =>
                              _setRestaurantSelected(record, !selected),
                          child: ExcludeSemantics(
                            child: Checkbox(
                              key: ValueKey(
                                '${record.recordKey}:batch-selection'
                                '${duplicateIndex == 0 ? '' : '#$duplicateIndex'}',
                              ),
                              value: selected,
                              onChanged: (value) => _setRestaurantSelected(
                                record,
                                value ?? false,
                              ),
                            ),
                          ),
                        )
                      : Tooltip(
                          message: 'Batch selection unavailable',
                          child: Semantics(
                            container: true,
                            label: 'Batch selection unavailable',
                            enabled: false,
                            child: ExcludeSemantics(
                              child: Checkbox(
                                key: ValueKey(
                                  '${record.recordKey}:batch-selection-unavailable'
                                  '${duplicateIndex == 0 ? '' : '#$duplicateIndex'}',
                                ),
                                value: selected,
                                onChanged: null,
                              ),
                            ),
                          ),
                        ),
                Text(
                  record.restaurantName,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Chip(
                  key: ValueKey('admin-link-source-label-${record.recordKey}'),
                  label: Text(record.source.label),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (record.streetAddress.isNotEmpty) Text(record.streetAddress),
            if (locality.isNotEmpty) Text(locality),
            const SizedBox(height: 6),
            Text('${record.distanceMiles.toStringAsFixed(1)} miles away'),
            if (record.phone.isNotEmpty) Text('Phone: ${record.phone}'),
            if (record.website.isNotEmpty) Text('Website: ${record.website}'),
            const SizedBox(height: 8),
            if (record.isBiteScore)
              Text(
                '${record.isActive == true ? 'Active' : 'Inactive'} • '
                '${record.claimState.label} • '
                'BiteSaver ${record.biteSaverCatalogBindingState.label}',
                key: ValueKey('admin-link-status-${record.recordKey}'),
              )
            else
              Text(
                'Approval: ${_approvalLabel(record.approvalStatus)}',
                key: ValueKey('admin-link-status-${record.recordKey}'),
              ),
            const SizedBox(height: 12),
            _buildPreparationStatus(record),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, actionConstraints) {
                final compactLabels =
                    actionConstraints.maxWidth < 420 ||
                    MediaQuery.textScalerOf(context).scale(14) > 21;
                return Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (record.isBiteSaver ||
                        record.canCreateBiteSaverOwnerInvite)
                      FilledButton.icon(
                        key: ValueKey('${record.recordKey}:coupon-invite'),
                        onPressed: isCouponInviteBusy
                            ? null
                            : () => _generateBiteSaverOwnerInvite(record),
                        icon: isCouponInviteBusy
                            ? const SizedBox.square(
                                dimension: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.link),
                        label: Text(
                          isCouponInviteBusy
                              ? 'Generating...'
                              : compactLabels
                              ? 'Owner Invite'
                              : 'BiteSaver Owner Invite',
                        ),
                      ),
                    if (record.canCreateBiteScoreClaimInvite)
                      OutlinedButton.icon(
                        key: ValueKey('${record.recordKey}:claim-invite'),
                        onPressed: isClaimInviteBusy
                            ? null
                            : () => _generateBiteScoreClaimInvite(record),
                        icon: isClaimInviteBusy
                            ? const SizedBox.square(
                                dimension: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.verified_user_outlined),
                        label: Text(
                          isClaimInviteBusy
                              ? 'Generating...'
                              : compactLabels
                              ? 'Claim Invite'
                              : 'BiteScore Claim Invite',
                        ),
                      ),
                    if (record.isBiteScore &&
                        record.claimState == AdminRestaurantClaimState.claimed)
                      const Chip(label: Text('Already claimed')),
                    if (record.canCopyCatalogBiteSaverCustomerLink ||
                        record.canCopyCouponCustomerLink)
                      OutlinedButton.icon(
                        key: ValueKey(
                          '${record.recordKey}:customer-bitesaver-link',
                        ),
                        onPressed: isCustomerBiteSaverLinkBusy
                            ? null
                            : () => _openCustomerBiteSaverLink(record),
                        icon: const Icon(Icons.link),
                        label: Text(
                          isCustomerBiteSaverLinkBusy
                              ? 'Opening...'
                              : compactLabels
                              ? 'BiteSaver'
                              : 'Customer BiteSaver',
                        ),
                      ),
                    if (record.isBiteScore && record.isActive == true)
                      OutlinedButton.icon(
                        key: ValueKey(
                          '${record.recordKey}:customer-bitescore-link',
                        ),
                        onPressed: isCustomerBiteScoreLinkBusy
                            ? null
                            : () => _openCustomerBiteScoreLink(record),
                        icon: const Icon(Icons.link),
                        label: Text(
                          isCustomerBiteScoreLinkBusy
                              ? 'Opening...'
                              : compactLabels
                              ? 'BiteScore'
                              : 'Customer BiteScore',
                        ),
                      ),
                    OutlinedButton.icon(
                      key: ValueKey('${record.recordKey}:copy-mailing-address'),
                      onPressed: isMailingAddressBusy
                          ? null
                          : () => _copyMailingAddress(record),
                      icon: isMailingAddressBusy
                          ? const SizedBox.square(
                              dimension: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.content_copy_outlined),
                      label: Text(
                        isMailingAddressBusy
                            ? 'Copying...'
                            : compactLabels
                            ? 'Address'
                            : 'Copy Mailing Address',
                      ),
                    ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  String _approvalLabel(String? status) {
    final normalized = status?.trim().toLowerCase() ?? '';
    if (normalized.isEmpty) {
      return 'Unknown';
    }
    return '${normalized[0].toUpperCase()}${normalized.substring(1)}';
  }
}
