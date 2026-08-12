import 'package:flutter/material.dart';

import '../models/rating_destructive_operation_models.dart';
import '../services/rating_destructive_operations_service.dart';

Future<void> showRatingDestructiveOperationStatusDialog(
  BuildContext context, {
  required RatingDestructiveOperationsService service,
  required RatingDestructiveOperationSummary initialSummary,
  Future<void> Function()? onComplete,
}) {
  return showDialog<void>(
    context: context,
    builder: (context) => RatingDestructiveOperationStatusDialog(
      service: service,
      initialSummary: initialSummary,
      onComplete: onComplete,
    ),
  );
}

void showRatingDestructiveOperationFeedback(
  BuildContext context, {
  required RatingDestructiveOperationsService service,
  required RatingDestructiveOperationSummary summary,
  Future<void> Function()? onComplete,
}) {
  final messenger = ScaffoldMessenger.of(context);
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(summary.feedbackMessage),
        action: SnackBarAction(
          label: 'View Status',
          onPressed: () {
            if (!context.mounted) return;
            showRatingDestructiveOperationStatusDialog(
              context,
              service: service,
              initialSummary: summary,
              onComplete: onComplete,
            );
          },
        ),
      ),
    );
}

class RatingDestructiveOperationStatusDialog extends StatefulWidget {
  const RatingDestructiveOperationStatusDialog({
    super.key,
    required this.service,
    required this.initialSummary,
    this.onComplete,
  });

  final RatingDestructiveOperationsService service;
  final RatingDestructiveOperationSummary initialSummary;
  final Future<void> Function()? onComplete;

  @override
  State<RatingDestructiveOperationStatusDialog> createState() =>
      _RatingDestructiveOperationStatusDialogState();
}

class _RatingDestructiveOperationStatusDialogState
    extends State<RatingDestructiveOperationStatusDialog> {
  late RatingDestructiveOperationSummary _summary;
  bool _refreshing = false;
  bool _completionNotified = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _summary = widget.initialSummary;
    _completionNotified = _summary.complete;
  }

  Future<void> _refresh() async {
    if (_refreshing) return;
    setState(() {
      _refreshing = true;
      _error = null;
    });
    try {
      final next = await widget.service.getOperationStatus(
        _summary.operationId,
      );
      if (!mounted) return;
      if (next.operationId != _summary.operationId ||
          next.operation != _summary.operation) {
        throw const RatingDestructiveOperationsException(
          RatingDestructiveFailureKind.unavailable,
          'BiteStar returned a mismatched operation status.',
        );
      }
      setState(() => _summary = next);
      if (next.complete && !_completionNotified) {
        _completionNotified = true;
        await widget.onComplete?.call();
      }
    } on RatingDestructiveOperationsException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Status could not be refreshed. Try again.');
      }
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  String _timestamp(BuildContext context, DateTime value) {
    final material = MaterialLocalizations.of(context);
    return '${material.formatMediumDate(value)} '
        '${material.formatTimeOfDay(TimeOfDay.fromDateTime(value))}';
  }

  String get _statusExplanation => switch (_summary.status) {
    RatingDestructiveStatus.active =>
      'BiteStar is processing this operation in bounded server steps.',
    RatingDestructiveStatus.retryable =>
      'BiteStar will retry automatically. You do not need to keep this screen open.',
    RatingDestructiveStatus.manualReviewRequired =>
      'This operation remains paused and protected until a separate safe review is completed.',
    RatingDestructiveStatus.complete => 'This operation is complete.',
  };

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_summary.operation.label),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: SingleChildScrollView(
          child: Semantics(
            container: true,
            liveRegion: true,
            label:
                '${_summary.operation.label}. ${_summary.status.label}. '
                '${_summary.progressCategory.label}.',
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    Chip(label: Text(_summary.status.label)),
                    Text(
                      _summary.progressCategory.label,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(_statusExplanation),
                const SizedBox(height: 12),
                SelectableText('Operation ID: ${_summary.operationId}'),
                const SizedBox(height: 8),
                Text('Processed: ${_summary.processedCount}'),
                Text('Created: ${_timestamp(context, _summary.createdAt)}'),
                Text('Updated: ${_timestamp(context, _summary.updatedAt)}'),
                if (_error != null) ...<Widget>[
                  const SizedBox(height: 12),
                  Semantics(
                    liveRegion: true,
                    child: Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
                if (_refreshing) ...<Widget>[
                  const SizedBox(height: 12),
                  const LinearProgressIndicator(),
                ],
              ],
            ),
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(
          style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
          onPressed: _refreshing ? null : () => Navigator.of(context).pop(),
          child: const Text('Close'),
        ),
        if (!_summary.complete)
          FilledButton.icon(
            key: const ValueKey<String>('rating-operation-manual-refresh'),
            style: FilledButton.styleFrom(minimumSize: const Size(48, 48)),
            onPressed: _refreshing ? null : _refresh,
            icon: const Icon(Icons.refresh),
            label: Text(_refreshing ? 'Refreshing...' : 'Refresh'),
          ),
      ],
    );
  }
}
