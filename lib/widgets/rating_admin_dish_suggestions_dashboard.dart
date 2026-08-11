import 'dart:async';

import 'package:flutter/material.dart';

import '../models/rating_admin_dish_suggestion_models.dart';
import '../services/app_error_text.dart';
import '../services/paged_query_controller.dart';
import '../services/rating_admin_dish_suggestions_service.dart';
import 'biterater_theme.dart';
import 'paged_directory_view.dart';

class RatingAdminDishSuggestionsPagedView extends StatefulWidget {
  const RatingAdminDishSuggestionsPagedView({
    super.key,
    this.service,
    this.isActive = true,
  });

  final RatingAdminDishSuggestionsService? service;
  final bool isActive;

  @override
  State<RatingAdminDishSuggestionsPagedView> createState() =>
      _RatingAdminDishSuggestionsPagedViewState();
}

class _RatingAdminDishSuggestionsPagedViewState
    extends State<RatingAdminDishSuggestionsPagedView> {
  late RatingAdminDishSuggestionsService _service;
  late PagedQueryController<RatingAdminDishSuggestionRecord> _controller;
  final Set<String> _busyActions = <String>{};
  final FocusNode _remapResultsFocusNode = FocusNode(
    debugLabel: 'Dish Suggestions remapped results',
  );
  int _controllerGeneration = 0;
  int _visibilityGeneration = 0;
  int _pageGeneration = 0;
  int _actionSequence = 0;
  Object? _observedPage;
  bool _observedLoading = false;
  bool _canonicalLastPending = false;
  bool _canonicalContinuationScheduled = false;
  bool _canonicalResetRequired = false;
  bool _canonicalResetScheduled = false;
  Future<void>? _canonicalLoadInFlight;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? RatingAdminDishSuggestionsService();
    _installController(load: widget.isActive);
  }

  @override
  void didUpdateWidget(
    covariant RatingAdminDishSuggestionsPagedView oldWidget,
  ) {
    super.didUpdateWidget(oldWidget);
    final serviceChanged = !identical(oldWidget.service, widget.service);
    if (serviceChanged) {
      _disposeController(_controller);
      _service = widget.service ?? RatingAdminDishSuggestionsService();
      _installController(load: widget.isActive);
    }
    if (oldWidget.isActive != widget.isActive) {
      _visibilityGeneration++;
      if (widget.isActive && !serviceChanged) {
        _resumeActiveLoad();
      }
    }
  }

  void _disposeController(
    PagedQueryController<RatingAdminDishSuggestionRecord> controller,
  ) {
    controller.removeListener(_handleControllerChanged);
    controller.dispose();
  }

  void _installController({required bool load, bool canonicalLast = false}) {
    _controllerGeneration++;
    _pageGeneration++;
    _observedPage = null;
    _observedLoading = false;
    _canonicalLastPending = canonicalLast;
    _canonicalContinuationScheduled = false;
    _canonicalResetRequired = false;
    _canonicalLoadInFlight = null;
    _controller = PagedQueryController<RatingAdminDishSuggestionRecord>(
      pageLoader: _service.loadDishSuggestionPage,
      criteria: RatingAdminDishSuggestionsService.pageCriteria,
      pageSize: RatingAdminDishSuggestionsService.pageSize,
      requestExactCount: true,
    );
    _controller.addListener(_handleControllerChanged);
    if (load) {
      _resumeActiveLoad();
    }
  }

  void _resumeActiveLoad() {
    if (_canonicalResetRequired ||
        _controller.error
            is RatingAdminDishSuggestionsPageOutOfRangeException ||
        _hasInvalidVisitedPageAnchor(_controller)) {
      _scheduleCanonicalReset();
    } else if (_canonicalLastPending) {
      unawaited(_loadCanonicalLastPage());
    } else {
      unawaited(_controller.loadInitial());
    }
  }

  Future<void> _loadCanonicalLastPage() {
    final existing = _canonicalLoadInFlight;
    if (existing != null) {
      return existing;
    }

    final controller = _controller;
    final controllerGeneration = _controllerGeneration;
    final visibilityGeneration = _visibilityGeneration;
    final completer = Completer<void>();
    final operation = completer.future;
    _canonicalLoadInFlight = operation;
    unawaited(() async {
      try {
        if (!_sameVisibleController(
          controller: controller,
          controllerGeneration: controllerGeneration,
          visibilityGeneration: visibilityGeneration,
        )) {
          return;
        }
        if (controller.page == null) {
          await controller.loadInitial();
        }
        if (!_sameVisibleController(
              controller: controller,
              controllerGeneration: controllerGeneration,
              visibilityGeneration: visibilityGeneration,
            ) ||
            controller.error != null ||
            controller.page == null) {
          return;
        }
        if (controller.page!.capabilities.last) {
          await controller.lastPage();
        }
        if (_sameVisibleController(
              controller: controller,
              controllerGeneration: controllerGeneration,
              visibilityGeneration: visibilityGeneration,
            ) &&
            controller.error == null) {
          _canonicalLastPending = false;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (_sameVisibleController(
              controller: controller,
              controllerGeneration: controllerGeneration,
              visibilityGeneration: visibilityGeneration,
            )) {
              _remapResultsFocusNode.requestFocus();
            }
          });
        }
      } finally {
        if (identical(_canonicalLoadInFlight, operation)) {
          _canonicalLoadInFlight = null;
        }
        if (!completer.isCompleted) {
          completer.complete();
        }
      }
    }());
    return operation;
  }

  void _handleControllerChanged() {
    final page = _controller.page;
    final loading = _controller.isLoading;
    if (!identical(page, _observedPage)) {
      _observedPage = page;
      _pageGeneration++;
    }
    if (loading && !_observedLoading) {
      _pageGeneration++;
    }
    _observedLoading = loading;
    if (mounted) {
      setState(() {});
    }
    final requiresCanonicalReset =
        _controller.error
            is RatingAdminDishSuggestionsPageOutOfRangeException ||
        _hasInvalidVisitedPageAnchor(_controller);
    if (requiresCanonicalReset) {
      _canonicalResetRequired = true;
      if (widget.isActive) {
        _scheduleCanonicalReset();
      }
    }
    if (_canonicalLastPending &&
        widget.isActive &&
        page != null &&
        !loading &&
        _controller.error == null &&
        _canonicalLoadInFlight == null &&
        !_canonicalContinuationScheduled) {
      _canonicalContinuationScheduled = true;
      scheduleMicrotask(() {
        _canonicalContinuationScheduled = false;
        if (mounted && _canonicalLastPending && widget.isActive) {
          unawaited(_loadCanonicalLastPage());
        }
      });
    }
  }

  @override
  void dispose() {
    _visibilityGeneration++;
    _controllerGeneration++;
    _disposeController(_controller);
    _remapResultsFocusNode.dispose();
    super.dispose();
  }

  bool _hasInvalidVisitedPageAnchor(
    PagedQueryController<RatingAdminDishSuggestionRecord> controller,
  ) {
    final exactTotal = controller.total?.exactValue;
    if (exactTotal == null) {
      return false;
    }
    final calculatedLastPage =
        (exactTotal + controller.pageSize - 1) ~/ controller.pageSize;
    final lastPage = calculatedLastPage < 1 ? 1 : calculatedLastPage;
    return (controller.currentPageNumber ?? 1) > lastPage ||
        controller.visitedPageNumbers.any((page) => page > lastPage);
  }

  void _scheduleCanonicalReset() {
    if (_canonicalResetScheduled || _canonicalLastPending) {
      return;
    }
    _canonicalResetScheduled = true;
    scheduleMicrotask(() {
      _canonicalResetScheduled = false;
      if (!mounted || !widget.isActive || _canonicalLastPending) {
        return;
      }
      if (_canonicalResetRequired ||
          _controller.error
              is RatingAdminDishSuggestionsPageOutOfRangeException ||
          _hasInvalidVisitedPageAnchor(_controller)) {
        unawaited(_resetToCanonicalLast());
      }
    });
  }

  bool _sameController({
    required PagedQueryController<RatingAdminDishSuggestionRecord> controller,
    required int controllerGeneration,
  }) {
    return mounted &&
        controllerGeneration == _controllerGeneration &&
        identical(controller, _controller) &&
        !controller.isDisposed;
  }

  bool _sameVisibleController({
    required PagedQueryController<RatingAdminDishSuggestionRecord> controller,
    required int controllerGeneration,
    required int visibilityGeneration,
  }) {
    return _sameController(
          controller: controller,
          controllerGeneration: controllerGeneration,
        ) &&
        widget.isActive &&
        visibilityGeneration == _visibilityGeneration;
  }

  Future<void> _resetToCanonicalLast() async {
    _canonicalResetRequired = false;
    final oldController = _controller;
    _disposeController(oldController);
    _installController(load: false, canonicalLast: true);
    if (mounted) {
      setState(() {});
    }
    if (widget.isActive) {
      await _loadCanonicalLastPage();
    }
  }

  Future<void> _refreshCurrentPageWithRecovery({
    PagedQueryController<RatingAdminDishSuggestionRecord>? controller,
    int? controllerGeneration,
    int? visibilityGeneration,
  }) async {
    final targetController = controller ?? _controller;
    final targetGeneration = controllerGeneration ?? _controllerGeneration;
    final targetVisibilityGeneration =
        visibilityGeneration ?? _visibilityGeneration;
    final previousPageNumber = targetController.currentPageNumber;
    await targetController.refreshCurrentPage();
    if (!_sameController(
      controller: targetController,
      controllerGeneration: targetGeneration,
    )) {
      return;
    }
    final pageMovedBackward =
        previousPageNumber != null &&
        previousPageNumber > 1 &&
        (targetController.currentPageNumber ?? previousPageNumber) <
            previousPageNumber;
    final currentPageBecameEmpty =
        previousPageNumber != null &&
        previousPageNumber > 1 &&
        targetController.error == null &&
        targetController.items.isEmpty;
    final requiresCanonicalReset =
        targetController.error
            is RatingAdminDishSuggestionsPageOutOfRangeException ||
        pageMovedBackward ||
        currentPageBecameEmpty ||
        _hasInvalidVisitedPageAnchor(targetController);
    if (!_sameVisibleController(
      controller: targetController,
      controllerGeneration: targetGeneration,
      visibilityGeneration: targetVisibilityGeneration,
    )) {
      if (requiresCanonicalReset) {
        _canonicalResetRequired = true;
      }
      return;
    }
    if (requiresCanonicalReset) {
      await _resetToCanonicalLast();
    }
  }

  bool _sameOriginPage({
    required PagedQueryController<RatingAdminDishSuggestionRecord> controller,
    required int controllerGeneration,
    required int visibilityGeneration,
    required int pageGeneration,
  }) {
    return _sameVisibleController(
          controller: controller,
          controllerGeneration: controllerGeneration,
          visibilityGeneration: visibilityGeneration,
        ) &&
        pageGeneration == _pageGeneration;
  }

  Future<void> _runAction(
    RatingAdminDishSuggestionRecord record,
    RatingAdminDishSuggestionResolutionType resolutionType,
  ) async {
    final busyKey = '${resolutionType.wireName}:${record.actionIdentity}';
    if (!_busyActions.add(busyKey)) {
      return;
    }
    final originatingController = _controller;
    final originatingControllerGeneration = _controllerGeneration;
    final originatingVisibilityGeneration = _visibilityGeneration;
    final originatingPageGeneration = _pageGeneration;
    _actionSequence++;
    final request = RatingAdminDishSuggestionActionRequest.forRecord(
      record: record,
      clientRequestId:
          'dish-suggestion-action-$originatingControllerGeneration-$_actionSequence',
    );
    setState(() {});

    try {
      final result =
          resolutionType == RatingAdminDishSuggestionResolutionType.apply
          ? await _service.applyDishSuggestionGroup(request)
          : await _service.rejectDishSuggestionGroup(request);
      if (_sameVisibleController(
        controller: originatingController,
        controllerGeneration: originatingControllerGeneration,
        visibilityGeneration: originatingVisibilityGeneration,
      )) {
        _showMessage(_actionResultMessage(result));
      }
      if (!_sameOriginPage(
        controller: originatingController,
        controllerGeneration: originatingControllerGeneration,
        visibilityGeneration: originatingVisibilityGeneration,
        pageGeneration: originatingPageGeneration,
      )) {
        return;
      }

      await _refreshCurrentPageWithRecovery(
        controller: originatingController,
        controllerGeneration: originatingControllerGeneration,
        visibilityGeneration: originatingVisibilityGeneration,
      );
    } catch (error) {
      if (_sameVisibleController(
        controller: originatingController,
        controllerGeneration: originatingControllerGeneration,
        visibilityGeneration: originatingVisibilityGeneration,
      )) {
        _showMessage(
          AppErrorText.friendly(
            error,
            fallback: 'Could not update this dish suggestion right now.',
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _busyActions.remove(busyKey));
      }
    }
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  String _actionResultMessage(RatingAdminDishSuggestionActionResult result) {
    return switch (result.messageCategory) {
      RatingAdminDishSuggestionMessageCategory.acceptedProcessing =>
        'Dish suggestion accepted and processing.',
      RatingAdminDishSuggestionMessageCategory.acceptedComplete =>
        'Dish suggestion completed.',
      RatingAdminDishSuggestionMessageCategory.alreadyProcessing =>
        'This dish suggestion is already processing.',
      RatingAdminDishSuggestionMessageCategory.staleGroup =>
        'This dish suggestion changed. The queue has been refreshed.',
      RatingAdminDishSuggestionMessageCategory.notActionable =>
        'This dish suggestion is no longer actionable.',
      RatingAdminDishSuggestionMessageCategory.manualReviewRequired =>
        'This dish suggestion needs attention before it can continue.',
      RatingAdminDishSuggestionMessageCategory.retryableProcessing =>
        'Processing was interrupted and will be retried.',
    };
  }

  String _dateLabel(DateTime? value) {
    if (value == null) {
      return 'Date unavailable';
    }
    final local = value.toLocal();
    final month = local.month.toString().padLeft(2, '0');
    final day = local.day.toString().padLeft(2, '0');
    return '$month/$day/${local.year}';
  }

  String _resolutionLabel(RatingAdminDishSuggestionRecord record) {
    return switch (record.resolutionState) {
      RatingAdminDishSuggestionResolutionState.idle => 'Pending',
      RatingAdminDishSuggestionResolutionState.applying =>
        'Applying / Processing',
      RatingAdminDishSuggestionResolutionState.rejecting =>
        'Rejecting / Processing',
      RatingAdminDishSuggestionResolutionState.retryable =>
        'Processing issue / Will retry',
      RatingAdminDishSuggestionResolutionState.manualReviewRequired =>
        'Needs attention',
      RatingAdminDishSuggestionResolutionState.complete => 'Complete',
    };
  }

  String _automaticLabel(RatingAdminDishSuggestionRecord record) {
    final dueAt = record.dueAt;
    if (dueAt == null) {
      return 'Automatic processing date unavailable';
    }
    if (record.isMerge && !record.enoughSupporters) {
      return 'Needs 2 matching users before automatic processing • '
          '${_dateLabel(dueAt)}';
    }
    if (record.dueNow) {
      return 'Eligible for automatic processing since ${_dateLabel(dueAt)}';
    }
    return 'Automatic processing after ${_dateLabel(dueAt)}';
  }

  String? _invalidReason(RatingAdminDishSuggestionRecord record) {
    final source = record.sourceDish;
    if (source == null) {
      return 'Source dish is missing.';
    }
    if (source.restaurantId != record.restaurantId) {
      return 'Source dish does not belong to this restaurant.';
    }
    if (!source.isActive) {
      return 'Source dish is already inactive or previously merged.';
    }
    if (source.isMerged) {
      return 'Source dish was already merged into another dish.';
    }
    if (record.isRename) {
      return record.proposedDisplayName == null
          ? 'Rename suggestion is missing the proposed name.'
          : null;
    }
    final target = record.mergeTargetDish;
    if (target == null) {
      return 'Merge target dish is missing.';
    }
    if (target.restaurantId != source.restaurantId ||
        target.restaurantId != record.restaurantId) {
      return 'Merge dishes must belong to the same restaurant.';
    }
    if (!target.isActive) {
      return 'Merge target is already inactive.';
    }
    if (target.isMerged) {
      return 'Merge target was already merged into another dish.';
    }
    if (target.id == source.id) {
      return 'A dish cannot merge into itself.';
    }
    return null;
  }

  bool _canApply(RatingAdminDishSuggestionRecord record) {
    return record.isActionable && _invalidReason(record) == null;
  }

  Widget _card(RatingAdminDishSuggestionRecord record) {
    final busyPrefix = ':${record.actionIdentity}';
    final busy = _busyActions.any((key) => key.endsWith(busyPrefix));
    final sourceName = record.sourceDish?.name ?? 'Source dish unavailable';
    final targetName =
        record.mergeTargetDish?.name ?? 'Merge target unavailable';
    final title =
        record.restaurant?.name ??
        record.sourceDish?.restaurantName ??
        record.mergeTargetDish?.restaurantName ??
        'Dish Suggestion';
    final invalidReason = _invalidReason(record);
    final applyEnabled = !busy && _canApply(record);
    final rejectEnabled = !busy && record.isActionable;
    final actionContext = record.isRename
        ? '$title, source $sourceName, proposed '
              '${record.proposedDisplayName ?? 'unavailable'}'
        : '$title, source $sourceName, merge target $targetName';
    final VoidCallback? applyAction = applyEnabled
        ? () => unawaited(
            _runAction(record, RatingAdminDishSuggestionResolutionType.apply),
          )
        : null;
    final VoidCallback? rejectAction = rejectEnabled
        ? () => unawaited(
            _runAction(record, RatingAdminDishSuggestionResolutionType.reject),
          )
        : null;
    final lines = <String>[
      'Type: ${record.isRename ? 'Rename' : 'Merge'}',
      'Restaurant ID: ${record.restaurantId}',
      'Source dish: $sourceName',
      if (record.isRename)
        'Proposed name: ${record.proposedDisplayName ?? 'Unavailable'}',
      if (record.isMerge) 'Merge into: $targetName',
      'Supporters: ${record.supporterCount}',
      'Status: ${_resolutionLabel(record)}',
      'Created: ${_dateLabel(record.oldestTrustedProposalTime)}',
      _automaticLabel(record),
      if (invalidReason != null) 'Invalid reason: $invalidReason',
    ];

    return KeyedSubtree(
      key: ValueKey<String>(
        'rating-admin-dish-suggestion-${record.actionIdentity}',
      ),
      child: BiteRaterTheme.liftedCard(
        margin: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                title,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(lines.join('\n')),
              if (busy) ...<Widget>[
                const SizedBox(height: 10),
                const LinearProgressIndicator(
                  key: ValueKey<String>('dish-suggestion-action-progress'),
                ),
              ],
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: <Widget>[
                  Semantics(
                    container: true,
                    button: true,
                    enabled: applyEnabled,
                    label: 'Apply dish suggestion for $actionContext',
                    onTap: applyAction,
                    child: ExcludeSemantics(
                      child: ElevatedButton(
                        key: ValueKey<String>(
                          'dish-suggestion-apply-${record.actionIdentity}',
                        ),
                        onPressed: applyAction,
                        style: ElevatedButton.styleFrom(
                          minimumSize: const Size(48, 48),
                        ),
                        child: const Text('Apply'),
                      ),
                    ),
                  ),
                  Semantics(
                    container: true,
                    button: true,
                    enabled: rejectEnabled,
                    label: 'Reject dish suggestion for $actionContext',
                    onTap: rejectAction,
                    child: ExcludeSemantics(
                      child: OutlinedButton(
                        key: ValueKey<String>(
                          'dish-suggestion-reject-${record.actionIdentity}',
                        ),
                        onPressed: rejectAction,
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(48, 48),
                        ),
                        child: const Text('Reject'),
                      ),
                    ),
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
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Focus(
        focusNode: _remapResultsFocusNode,
        skipTraversal: true,
        child: PagedDirectoryView<RatingAdminDishSuggestionRecord>(
          key: ValueKey<PagedQueryController<RatingAdminDishSuggestionRecord>>(
            _controller,
          ),
          controller: _controller,
          onRefresh: _refreshCurrentPageWithRecovery,
          emptyBuilder: (context) => const Center(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text('No pending dish suggestions.'),
            ),
          ),
          errorBuilder: (context, error, retry) => Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(AppErrorText.load('dish suggestions')),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: retry,
                    child: const Text('Try Again'),
                  ),
                ],
              ),
            ),
          ),
          itemBuilder: (context, record, _) => _card(record),
        ),
      ),
    );
  }
}
