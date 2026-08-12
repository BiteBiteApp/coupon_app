import 'dart:async';

import 'package:flutter/material.dart';

import '../models/rating_destructive_operation_models.dart';
import '../services/paged_query_controller.dart';
import '../services/rating_destructive_operations_service.dart';
import 'paged_directory_view.dart';
import 'rating_destructive_operation_status_dialog.dart';

class RatingAdminDestructiveOperationsPagedView extends StatefulWidget {
  const RatingAdminDestructiveOperationsPagedView({
    super.key,
    required this.isActive,
    this.service,
  });

  final bool isActive;
  final RatingDestructiveOperationsService? service;

  @override
  State<RatingAdminDestructiveOperationsPagedView> createState() =>
      _RatingAdminDestructiveOperationsPagedViewState();
}

class _RatingAdminDestructiveOperationsPagedViewState
    extends State<RatingAdminDestructiveOperationsPagedView> {
  late final RatingDestructiveOperationsService _service;
  late final PagedQueryController<RatingAdminDestructiveOperationRecord>
  _controller;
  final Set<String> _openingStatus = <String>{};

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? RatingDestructiveOperationsService();
    _controller = PagedQueryController<RatingAdminDestructiveOperationRecord>(
      pageLoader: _service.loadAdminOperationsPage,
      criteria: RatingDestructiveOperationsService.adminOperationsCriteria,
      pageSize: ratingDestructiveAdminPageSize,
      requestExactCount: true,
    );
    if (widget.isActive) unawaited(_controller.loadInitial());
  }

  @override
  void didUpdateWidget(
    covariant RatingAdminDestructiveOperationsPagedView oldWidget,
  ) {
    super.didUpdateWidget(oldWidget);
    if (!oldWidget.isActive && widget.isActive) {
      unawaited(_controller.loadInitial());
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _viewStatus(RatingAdminDestructiveOperationRecord record) async {
    if (!_openingStatus.add(record.operationId)) return;
    setState(() {});
    try {
      final summary = await _service.getOperationStatus(record.operationId);
      if (!mounted) return;
      if (summary.operationId != record.operationId ||
          summary.operation != record.operation) {
        throw const RatingDestructiveOperationsException(
          RatingDestructiveFailureKind.unavailable,
          'BiteStar returned a mismatched operation status.',
        );
      }
      await showRatingDestructiveOperationStatusDialog(
        context,
        service: _service,
        initialSummary: summary,
        onComplete: _controller.refreshCurrentPage,
      );
    } on RatingDestructiveOperationsException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Status could not be opened.')),
        );
      }
    } finally {
      if (mounted) setState(() => _openingStatus.remove(record.operationId));
    }
  }

  String _timestamp(BuildContext context, DateTime value) {
    final material = MaterialLocalizations.of(context);
    return '${material.formatMediumDate(value)} '
        '${material.formatTimeOfDay(TimeOfDay.fromDateTime(value))}';
  }

  Widget _card(
    BuildContext context,
    RatingAdminDestructiveOperationRecord record,
  ) {
    final opening = _openingStatus.contains(record.operationId);
    return Semantics(
      container: true,
      label:
          '${record.operation.label}. ${record.status.label}. '
          'Operation ${record.operationId}.',
      child: Card(
        margin: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: <Widget>[
                  Text(
                    record.operation.label,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Chip(label: Text(record.status.label)),
                ],
              ),
              const SizedBox(height: 8),
              for (final label in record.identityLabels)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: SelectableText(label),
                ),
              SelectableText('Operation ID: ${record.operationId}'),
              const SizedBox(height: 8),
              Text(record.progressCategory.label),
              Text('Current step: ${record.phaseCategory.label}'),
              Text(
                'Processed: ${record.processedCount} '
                '(current step: ${record.phaseProcessedCount})',
              ),
              Text('Created: ${_timestamp(context, record.createdAt)}'),
              Text('Updated: ${_timestamp(context, record.updatedAt)}'),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton.icon(
                  key: ValueKey<String>(
                    'rating-operation-view-status-${record.operationId}',
                  ),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(48, 48),
                  ),
                  onPressed: opening ? null : () => _viewStatus(record),
                  icon: opening
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.visibility_outlined),
                  label: Text(opening ? 'Opening...' : 'View Status'),
                ),
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
      child: PagedDirectoryView<RatingAdminDestructiveOperationRecord>(
        controller: _controller,
        padding: const EdgeInsets.only(top: 4),
        onRefresh: _controller.refreshCurrentPage,
        emptyBuilder: (context) => const Center(
          child: Text('No Rating destructive operations found.'),
        ),
        errorBuilder: (context, error, retry) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Text('Operations could not be loaded.'),
              const SizedBox(height: 8),
              FilledButton(
                style: FilledButton.styleFrom(minimumSize: const Size(48, 48)),
                onPressed: retry,
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
        itemBuilder: (context, record, _) => _card(context, record),
      ),
    );
  }
}
