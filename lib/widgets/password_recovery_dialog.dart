import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/account_provider_service.dart';

Future<void> showPasswordRecoveryDialog(
  BuildContext context, {
  required String initialEmail,
}) => showDialog<void>(
  context: context,
  builder: (_) => _PasswordRecoveryDialog(initialEmail: initialEmail),
);

class _PasswordRecoveryDialog extends StatefulWidget {
  const _PasswordRecoveryDialog({required this.initialEmail});

  final String initialEmail;

  @override
  State<_PasswordRecoveryDialog> createState() =>
      _PasswordRecoveryDialogState();
}

class _PasswordRecoveryDialogState extends State<_PasswordRecoveryDialog> {
  final _form = GlobalKey<FormState>();
  late final _email = TextEditingController(text: widget.initialEmail.trim());
  bool _busy = false;
  bool _accepted = false;
  String? _error;

  bool get _active => mounted && ModalRoute.of(context)?.isActive == true;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || _accepted || !_form.currentState!.validate()) return;
    final email = _email.text.trim();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AccountProviderService.instance.sendPasswordResetEmail(email);
      if (_active) setState(() => _accepted = true);
    } catch (error) {
      if (_active) {
        setState(() {
          _error = switch (error) {
            FirebaseAuthException(code: 'invalid-email') =>
              'Enter a valid email address.',
            FirebaseAuthException(code: 'network-request-failed') =>
              'Check your connection and try again.',
            FirebaseAuthException(code: 'too-many-requests') =>
              'Please wait before trying again.',
            _ =>
              'Could not request a password reset right now. Try again later.',
          };
        });
      }
    } finally {
      if (_active) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(_accepted ? 'Check your email' : 'Reset password'),
    content: SingleChildScrollView(
      child: _accepted
          ? const Text(
              'If this address is eligible for password recovery, you will '
              'receive reset instructions. Check your inbox and spam folder.',
            )
          : Form(
              key: _form,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('Enter the email address you use for BiteStar.'),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _email,
                    enabled: !_busy,
                    autofocus: true,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.done,
                    autofillHints: const [AutofillHints.email],
                    autocorrect: false,
                    decoration: const InputDecoration(labelText: 'Email'),
                    validator: (value) =>
                        AccountProviderService.isPasswordResetEmailValid(
                          value ?? '',
                        )
                        ? null
                        : 'Enter a valid email address.',
                    onFieldSubmitted: (_) => _submit(),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Semantics(liveRegion: true, child: Text(_error!)),
                  ],
                ],
              ),
            ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: Text(_accepted ? 'Done' : 'Cancel'),
      ),
      if (!_accepted)
        FilledButton(
          onPressed: _busy ? null : _submit,
          child: Text(_busy ? 'Requesting...' : 'Request reset email'),
        ),
    ],
  );
}
