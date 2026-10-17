import 'package:flutter/material.dart';

/// Only a boolean leaves this dialog. Raw input is cleared on evaluation and
/// disposed on dismissal; it is never logged, transmitted or persisted.
Future<bool> requestRegistrationAge(BuildContext context) async {
  if (!context.mounted) return false;
  return await showDialog<bool>(
        context: context,
        builder: (_) => const _RegistrationAgeDialog(),
      ) ??
      false;
}

class _RegistrationAgeDialog extends StatefulWidget {
  const _RegistrationAgeDialog();

  @override
  State<_RegistrationAgeDialog> createState() => _RegistrationAgeDialogState();
}

class _RegistrationAgeDialogState extends State<_RegistrationAgeDialog> {
  final _age = TextEditingController();
  String? _error;
  bool _unavailable = false;

  @override
  void dispose() {
    _age.clear();
    _age.dispose();
    super.dispose();
  }

  void _continue() {
    if (_unavailable) return;
    final text = _age.text.trim();
    final age = RegExp(r'^\d{1,3}$').hasMatch(text) ? int.tryParse(text) : null;
    if (age == null || age > 120) {
      setState(() => _error = 'Enter your age in whole years.');
      return;
    }
    _age.clear();
    if (age < 13) {
      setState(() {
        _unavailable = true;
        _error = null;
      });
      return;
    }
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(_unavailable ? 'Registration unavailable' : 'How old are you?'),
    content: SingleChildScrollView(
      child: _unavailable
          ? const Text('Account registration is unavailable.')
          : TextField(
              controller: _age,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.done,
              enableSuggestions: false,
              autocorrect: false,
              autofillHints: const [],
              decoration: InputDecoration(
                labelText: 'Age in years',
                errorText: _error,
              ),
              onSubmitted: (_) => _continue(),
            ),
    ),
    actions: _unavailable
        ? [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Close'),
            ),
          ]
        : [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(onPressed: _continue, child: const Text('Continue')),
          ],
  );
}
