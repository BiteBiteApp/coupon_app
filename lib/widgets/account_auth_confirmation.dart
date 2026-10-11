import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../services/account_provider_service.dart';
import '../services/registration_diagnostics.dart';
import 'google_confirmation_button_stub.dart'
    if (dart.library.js_interop) 'google_confirmation_button_web.dart';

/// Auth changes recreate the shell's private pages. The enclosing route remains
/// the sign-in's lifetime, so that rebuild is not mistaken for cancellation.
bool Function() captureAccountSignInActivity(BuildContext context) {
  final route = ModalRoute.of(context);
  return () => route?.isActive ?? context.mounted;
}

Future<String?> confirmExistingAccountPassword(
  BuildContext context,
  String email,
) => showDialog<String>(
  context: context,
  builder: (_) => _AccountPasswordDialog(email: email),
);

class _AccountPasswordDialog extends StatefulWidget {
  const _AccountPasswordDialog({required this.email});

  final String email;

  @override
  State<_AccountPasswordDialog> createState() => _AccountPasswordDialogState();
}

class _AccountPasswordDialogState extends State<_AccountPasswordDialog> {
  final _password = TextEditingController();
  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  void _submit() {
    if (_password.text.isNotEmpty) Navigator.of(context).pop(_password.text);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Confirm your existing account'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(widget.email),
          const SizedBox(height: 12),
          const Text(
            'To add Google sign-in, confirm your existing BiteStar password once. '
            'If you use another sign-in method, cancel and sign in with that method first.',
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _password,
            obscureText: true,
            autocorrect: false,
            enableSuggestions: false,
            autofillHints: const [AutofillHints.password],
            decoration: const InputDecoration(labelText: 'BiteStar password'),
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Cancel'),
      ),
      FilledButton(onPressed: _submit, child: const Text('Confirm')),
    ],
  );
}

/// Confirms ownership without ending the original email form submission. Native
/// registration goes directly to Google; web needs Google's rendered button.
/// The entered password is never sent to Google.
Future<String?> confirmGoogleForEmail(
  BuildContext context,
  String email, {
  bool forRegistration = false,
}) async {
  if (forRegistration && !kIsWeb) {
    final route = ModalRoute.of(context);
    bool canComplete() => route?.isCurrent ?? context.mounted;
    try {
      registrationDiagnostic(
        RegistrationStage.nativeGoogle,
        RegistrationCheck.started,
      );
      await AccountProviderService.initializeGoogle();
      if (!canComplete()) {
        registrationDiagnostic(
          RegistrationStage.nativeGoogle,
          RegistrationCheck.cancelled,
        );
        return null;
      }
      final account = await GoogleSignIn.instance.authenticate();
      if (!canComplete()) {
        registrationDiagnostic(
          RegistrationStage.nativeGoogle,
          RegistrationCheck.cancelled,
        );
        return null;
      }
      if (account.email.toLowerCase() != email.toLowerCase()) {
        registrationDiagnostic(
          RegistrationStage.nativeGoogle,
          RegistrationCheck.emailMismatch,
        );
        throw FirebaseAuthException(code: 'email-mismatch');
      }
      final token = account.authentication.idToken;
      if (token == null || token.isEmpty) {
        registrationDiagnostic(
          RegistrationStage.nativeGoogle,
          RegistrationCheck.missingToken,
        );
        throw FirebaseAuthException(code: 'invalid-credential');
      }
      registrationDiagnostic(
        RegistrationStage.nativeGoogle,
        RegistrationCheck.accepted,
      );
      return token;
    } catch (error) {
      if (!canComplete() || AccountProviderService.wasCancelled(error)) {
        registrationDiagnostic(
          RegistrationStage.nativeGoogle,
          RegistrationCheck.cancelled,
        );
        return null;
      }
      registrationDiagnostic(
        RegistrationStage.nativeGoogle,
        RegistrationCheck.nativeFailure,
      );
      rethrow;
    }
  }
  return showDialog<String>(
    context: context,
    builder: (_) => _GoogleEmailConfirmation(email: email),
  );
}

class _GoogleEmailConfirmation extends StatefulWidget {
  const _GoogleEmailConfirmation({required this.email});
  final String email;
  @override
  State<_GoogleEmailConfirmation> createState() =>
      _GoogleEmailConfirmationState();
}

class _GoogleEmailConfirmationState extends State<_GoogleEmailConfirmation> {
  StreamSubscription<GoogleSignInAuthenticationEvent>? _events;
  bool _ready = !kIsWeb;
  bool _busy = false;
  bool _finished = false;
  ModalRoute<dynamic>? _route;
  String? _error;

  bool get _canComplete => mounted && !_finished && _route?.isCurrent == true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _route = ModalRoute.of(context);
  }

  void _cancel() {
    if (!_canComplete) return;
    _finished = true;
    Navigator.of(context).pop();
  }

  @override
  void initState() {
    super.initState();
    if (kIsWeb) _initializeWeb();
  }

  Future<void> _initializeWeb() async {
    try {
      await AccountProviderService.initializeGoogle();
      if (!mounted) return;
      _events = GoogleSignIn.instance.authenticationEvents.listen((event) {
        if (event is GoogleSignInAuthenticationEventSignIn) {
          _complete(event.user);
        }
      }, onError: _fail);
      setState(() => _ready = true);
    } catch (error) {
      _fail(error);
    }
  }

  void _fail(Object error) {
    if (!_canComplete) return;
    setState(() {
      _busy = false;
      _error = AccountProviderService.wasCancelled(error)
          ? 'Google confirmation cancelled.'
          : 'Could not confirm with Google. Please try again.';
    });
  }

  void _complete(GoogleSignInAccount account) {
    if (!_canComplete) return;
    if (account.email.toLowerCase() != widget.email.toLowerCase()) {
      setState(() {
        _busy = false;
        _error = 'Choose the Google account for ${widget.email}.';
      });
      return;
    }
    final token = account.authentication.idToken;
    if (token == null) {
      _fail(StateError('Missing Google confirmation'));
      return;
    }
    _finished = true;
    Navigator.of(context).pop(token);
  }

  Future<void> _confirmNative() async {
    if (_busy || !_canComplete) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AccountProviderService.initializeGoogle();
      if (!_canComplete) return;
      _complete(await GoogleSignIn.instance.authenticate());
    } catch (error) {
      _fail(error);
    }
  }

  @override
  void dispose() {
    _events?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Finish signing in'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(widget.email),
          const SizedBox(height: 12),
          const Text(
            'If you joined with Google, confirm your account to add this '
            'password and finish signing in.',
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          if (kIsWeb && _ready) ...[
            const SizedBox(height: 16),
            googleConfirmationButton(),
          ],
        ],
      ),
    ),
    actions: [
      TextButton(onPressed: _cancel, child: const Text('Cancel')),
      if (!kIsWeb)
        FilledButton(
          onPressed: _busy ? null : _confirmNative,
          child: Text(_busy ? 'Confirming…' : 'Continue with Google'),
        ),
    ],
  );
}
