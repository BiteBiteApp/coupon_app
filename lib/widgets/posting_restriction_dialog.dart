import 'package:flutter/material.dart';
import '../services/app_error_text.dart';
import '../services/posting_restriction_service.dart';

class PostingRestrictionDialog extends StatefulWidget {
  const PostingRestrictionDialog({super.key, this.reportId, this.service});
  final String? reportId;
  final PostingRestrictionService? service;
  @override
  State<PostingRestrictionDialog> createState() =>
      _PostingRestrictionDialogState();
}

class _PostingRestrictionDialogState extends State<PostingRestrictionDialog> {
  late final _service = widget.service ?? PostingRestrictionService();
  final _uid = TextEditingController();
  PostingRestrictionStatus? _status;
  String? _error;
  bool _busy = false;
  @override
  void initState() {
    super.initState();
    if (widget.reportId != null) _load();
  }

  @override
  void dispose() {
    _uid.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _busy = true;
      _error = null;
      _status = null;
    });
    try {
      final value = await _service.inspect(
        reportId: widget.reportId,
        targetUserId: widget.reportId == null ? _uid.text : null,
      );
      if (mounted) setState(() => _status = value);
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = AppErrorText.friendly(
            error,
            fallback: 'Could not verify this contributor.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _change(String action) async {
    final current = _status!;
    final label = action == 'release'
        ? 'Release posting restriction'
        : action == 'indefinite'
        ? 'Restrict posting indefinitely'
        : 'Restrict posting for ${action == '7d' ? 7 : 14} days';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        scrollable: true,
        title: Text(label),
        content: Text(
          '$label for UID ${current.targetUserId}?\n\nThis affects new public contributions only. Existing content, account access, eligible coupons, and restaurant business functions remain available.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final value = await _service.change(
        current: current,
        action: action,
        reportId: widget.reportId,
      );
      if (mounted) setState(() => _status = value);
    } catch (error) {
      // Clear stale controls after contention or uncertain completion. A fresh
      // status is required before another action, never blind replay/extension.
      if (mounted) {
        setState(() {
          _status = null;
          _error = AppErrorText.friendly(
            error,
            fallback: 'Could not update posting access. Refresh the status.',
          );
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    scrollable: true,
    title: const Text('Public posting access'),
    content: SizedBox(
      width: 440,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (widget.reportId == null) ...[
            const Text(
              'Inspect or release an existing restriction using the exact account UID recorded during moderation.',
            ),
            TextField(
              controller: _uid,
              enabled: !_busy,
              decoration: const InputDecoration(labelText: 'Exact account UID'),
              onChanged: (_) => setState(() => _status = null),
            ),
          ],
          if (_busy) const LinearProgressIndicator(),
          if (_error != null) Text(_error!, key: const Key('posting-error')),
          if (_status case final status?) ...[
            SelectableText('Account UID: ${status.targetUserId}'),
            const SizedBox(height: 12),
            Text(status.message, key: const Key('posting-status')),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (widget.reportId != null)
                  for (final option in {
                    '7d': 'Restrict 7 days',
                    '14d': 'Restrict 14 days',
                    'indefinite': 'Restrict indefinitely',
                  }.entries)
                    OutlinedButton(
                      onPressed: _busy ? null : () => _change(option.key),
                      child: Text(option.value),
                    ),
                if (status.active)
                  FilledButton(
                    onPressed: _busy ? null : () => _change('release'),
                    child: const Text('Release restriction'),
                  ),
              ],
            ),
          ],
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: _busy ? null : _load,
        child: const Text('Refresh status'),
      ),
      TextButton(
        onPressed: _busy ? null : () => Navigator.pop(context),
        child: const Text('Close'),
      ),
    ],
  );
}
