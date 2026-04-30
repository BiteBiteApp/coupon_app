import 'package:flutter/material.dart';

class BiteSaverReportDialog extends StatefulWidget {
  const BiteSaverReportDialog({super.key});

  @override
  State<BiteSaverReportDialog> createState() => _BiteSaverReportDialogState();
}

class BiteSaverReportResult {
  final String reason;
  final String note;

  const BiteSaverReportResult({required this.reason, required this.note});
}

class _BiteSaverReportDialogState extends State<BiteSaverReportDialog> {
  static const List<String> _reasons = <String>[
    'Spam or misleading',
    'Offensive content',
    'Incorrect information',
    'Expired/unavailable deal',
    'Other',
  ];

  final TextEditingController _noteController = TextEditingController();
  String? _selectedReason;

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  void _submit() {
    final reason = _selectedReason?.trim();
    if (reason == null || reason.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Choose a reason before submitting.')),
      );
      return;
    }

    Navigator.of(context).pop(
      BiteSaverReportResult(reason: reason, note: _noteController.text.trim()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Report'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _selectedReason,
              decoration: const InputDecoration(
                labelText: 'Reason',
                border: OutlineInputBorder(),
              ),
              items: _reasons
                  .map(
                    (reason) => DropdownMenuItem<String>(
                      value: reason,
                      child: Text(reason),
                    ),
                  )
                  .toList(),
              onChanged: (value) {
                setState(() {
                  _selectedReason = value;
                });
              },
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _noteController,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Note (optional)',
                border: OutlineInputBorder(),
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
        FilledButton(onPressed: _submit, child: const Text('Submit')),
      ],
    );
  }
}
