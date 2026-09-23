import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../services/account_deletion_service.dart';
import '../services/customer_auth_service.dart';
import '../widgets/phone_auth_sheet.dart';

typedef DeletionReauthenticate =
    Future<bool> Function(BuildContext context, User user);

class AccountDeletionScreen extends StatefulWidget {
  final AccountDeletionService? service;
  final AccountDeletionReceiptStore? receipts;
  final User? Function()? currentUser;
  final Stream<User?>? authChanges;
  final DeletionReauthenticate? reauthenticate;
  final Future<void> Function(String provider)? signIn;
  const AccountDeletionScreen({
    super.key,
    this.service,
    this.receipts,
    this.currentUser,
    this.authChanges,
    this.reauthenticate,
    this.signIn,
  });
  @override
  State<AccountDeletionScreen> createState() => _AccountDeletionScreenState();
}

class _AccountDeletionScreenState extends State<AccountDeletionScreen> {
  late final AccountDeletionService _service =
      widget.service ?? AccountDeletionService.production();
  late final AccountDeletionReceiptStore _receipts =
      widget.receipts ?? LocalAccountDeletionReceiptStore();
  User? get _user =>
      widget.currentUser?.call() ??
      (widget.currentUser == null ? FirebaseAuth.instance.currentUser : null);
  StreamSubscription<User?>? _subscription;
  final _email = TextEditingController(), _password = TextEditingController();
  String? _uid, _message;
  int _epoch = 0;
  int _receiptGeneration = 0;
  bool _busy = false;
  AccountDeletionReceipt? _receipt;
  AccountDeletionStatus? _status;
  @override
  void initState() {
    super.initState();
    _uid = _user?.uid;
    _subscription =
        (widget.authChanges ?? FirebaseAuth.instance.authStateChanges()).listen(
          (user) {
            if (!mounted || user?.uid == _uid) return;
            setState(() {
              _uid = user?.uid;
              _epoch++;
              _busy = false;
              _receipt = null;
              _status = null;
              _message = null;
              _password.clear();
            });
            unawaited(_restore());
          },
        );
    unawaited(_restore());
  }

  bool _current(int epoch, String? uid) =>
      mounted && epoch == _epoch && _user?.uid == uid;
  Future<void> _restore() async {
    final epoch = _epoch, uid = _user?.uid;
    final generation = ++_receiptGeneration;
    try {
      final receipt = await _receipts.load(uid);
      if (_current(epoch, uid) && generation == _receiptGeneration) {
        setState(() => _receipt = receipt);
      }
    } catch (_) {
      if (_current(epoch, uid)) {
        setState(() => _message = 'Could not restore the saved receipt.');
      }
    }
  }

  Future<String?> _passwordPrompt() async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Confirm your password'),
        content: TextField(
          controller: controller,
          obscureText: true,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Password'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Authenticate'),
          ),
        ],
      ),
    );
    // The route may finish its exit animation after the result is delivered.
    Future<void>.delayed(const Duration(seconds: 1), controller.dispose);
    return result;
  }

  Future<AuthCredential> _googleCredential() async {
    await GoogleSignIn.instance.initialize(
      serverClientId: CustomerAuthService.webServerClientId,
    );
    final account = await GoogleSignIn.instance.authenticate();
    final token = account.authentication.idToken;
    if (token == null) throw StateError('Google authentication unavailable.');
    return GoogleAuthProvider.credential(idToken: token);
  }

  Future<bool> _reauthenticate(User user) async {
    final epoch = _epoch;
    if (user.isAnonymous && user.providerData.isEmpty) {
      await user.getIdToken(true);
      return _current(epoch, user.uid);
    }
    final providers = user.providerData.map((item) => item.providerId).toSet();
    if (providers.contains('password') && user.email != null) {
      final password = await _passwordPrompt();
      if (password == null || !_current(epoch, user.uid)) return false;
      await user.reauthenticateWithCredential(
        EmailAuthProvider.credential(email: user.email!, password: password),
      );
    } else if (providers.contains('google.com')) {
      if (kIsWeb) {
        await user.reauthenticateWithPopup(GoogleAuthProvider());
      } else {
        final credential = await _googleCredential();
        if (!_current(epoch, user.uid)) return false;
        await user.reauthenticateWithCredential(credential);
      }
    } else if (providers.contains('phone')) {
      final ok = await showPhoneAuthSheet(
        context: context,
        initialPhoneNumber: user.phoneNumber,
        onVerifiedCredential: (credential) async {
          if (!_current(epoch, user.uid)) throw StateError('Account changed.');
          await user.reauthenticateWithCredential(credential);
        },
      );
      if (ok != true) return false;
    } else {
      throw StateError('This authentication provider needs account recovery.');
    }
    if (!_current(epoch, user.uid)) return false;
    await user.getIdToken(true);
    return _current(epoch, user.uid);
  }

  Future<void> _request() async {
    final user = _user;
    if (user == null || _busy) return;
    final epoch = _epoch;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Permanently delete this account?'),
        content: const Text(
          'This cannot be undone once processing begins. Your personal contributions and saved activity will be removed. If you own a BiteSaver business, it and its coupons, specials and menu become unavailable when the request is accepted. We request immediate subscription cancellation, not cancellation at the end of the paid period. Cancellation stays pending until confirmed. This action initiates no automatic refund. Necessary billing and security records, independent shared catalog facts and other people’s content remain.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Confirm permanent deletion'),
          ),
        ],
      ),
    );
    if (!mounted || confirmed != true || !_current(epoch, user.uid)) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final authenticated =
          await (widget.reauthenticate?.call(context, user) ??
              _reauthenticate(user));
      if (!authenticated || !_current(epoch, user.uid)) return;
      final previous = await _receipts.load(user.uid);
      if (!_current(epoch, user.uid)) return;
      final receipt = previous ?? AccountDeletionReceipt.create(user.uid);
      await _receipts.save(
        receipt,
      ); // Persist BEFORE an ambiguous request response.
      if (!_current(epoch, user.uid)) return;
      _receiptGeneration++;
      setState(() => _receipt = receipt);
      final status = await _service.request(user.uid, receipt.value);
      if (_current(epoch, user.uid)) setState(() => _status = status);
    } catch (_) {
      if (_current(epoch, user.uid)) {
        setState(
          () => _message =
              'The request could not be confirmed. Check the saved receipt before retrying. You may need to authenticate again.',
        );
      }
    } finally {
      if (_current(epoch, user.uid)) setState(() => _busy = false);
    }
  }

  Future<void> _refresh() async {
    final receipt = _receipt, uid = _user?.uid, epoch = _epoch;
    if (receipt == null || (uid != null && receipt.uid != uid) || _busy) return;
    setState(() => _busy = true);
    try {
      final status = await _service.status(receipt.value);
      if (_current(epoch, uid)) {
        setState(() {
          _status = status;
          _message = null;
        });
      }
    } catch (_) {
      if (_current(epoch, uid)) {
        setState(
          () => _message =
              'Status is unavailable. Keep this browser or app receipt and try again.',
        );
      }
    } finally {
      if (_current(epoch, uid)) setState(() => _busy = false);
    }
  }

  Future<void> _signIn(String provider) async {
    if (_busy) return;
    final epoch = _epoch;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      if (widget.signIn != null) {
        await widget.signIn!(provider);
        return;
      }
      if (provider == 'password') {
        await FirebaseAuth.instance.signInWithEmailAndPassword(
          email: _email.text.trim(),
          password: _password.text,
        );
      } else if (provider == 'google') {
        if (kIsWeb) {
          await FirebaseAuth.instance.signInWithPopup(GoogleAuthProvider());
        } else {
          final credential = await _googleCredential();
          if (!_current(epoch, null)) return;
          await FirebaseAuth.instance.signInWithCredential(credential);
        }
      } else {
        await showPhoneAuthSheet(
          context: context,
          onVerifiedCredential: (credential) async {
            if (!_current(epoch, null)) throw StateError('Account changed.');
            await FirebaseAuth.instance.signInWithCredential(credential);
          },
        );
      }
    } catch (_) {
      if (mounted && epoch == _epoch) {
        setState(
          () => _message =
              'Could not sign in. Check your credentials or try again.',
        );
      }
    } finally {
      if (mounted && epoch == _epoch) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final user = _user;
    return Scaffold(
      appBar: AppBar(title: const Text('Delete Account')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 540),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Permanently delete your BiteStar account',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Your personal reviews, ratings, votes, photos and saved activity will be removed. Your BiteSaver business, coupons, specials and menu become unavailable once the request is accepted. We automatically request immediate cancellation of your BiteStar subscription, without waiting for the paid period to end. Cancellation remains pending until confirmed. This action does not initiate an automatic refund. Necessary billing/security records, independent shared catalog facts and other people’s content remain. Processing continues after you close the app.',
                ),
                const SizedBox(height: 16),
                if (user == null) ...[
                  const Text(
                    'Sign in with your existing account to request deletion. You do not need the mobile app.',
                  ),
                  TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(labelText: 'Email'),
                  ),
                  TextField(
                    controller: _password,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: 'Password'),
                  ),
                  FilledButton(
                    onPressed: _busy ? null : () => _signIn('password'),
                    child: const Text('Sign in with email'),
                  ),
                  OutlinedButton(
                    onPressed: _busy ? null : () => _signIn('google'),
                    child: const Text('Sign in with Google'),
                  ),
                  OutlinedButton(
                    onPressed: _busy ? null : () => _signIn('phone'),
                    child: const Text('Sign in with phone'),
                  ),
                ] else ...[
                  Text(
                    user.isAnonymous
                        ? 'This will delete the guest account on this device.'
                        : 'Signed in as ${user.email ?? user.phoneNumber ?? 'your account'}',
                  ),
                  FilledButton(
                    onPressed: _busy || _status?.state == 'complete'
                        ? null
                        : _request,
                    child: const Text('Delete Account'),
                  ),
                ],
                if (_receipt != null)
                  OutlinedButton(
                    onPressed: _busy ? null : _refresh,
                    child: const Text('Check deletion status'),
                  ),
                if (_status != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      _status!.state == 'complete'
                          ? 'Deletion complete.'
                          : _status!.state == 'pending'
                          ? 'Deletion is pending: ${_reason(_status!.reason)}. It is not complete.'
                          : 'Deletion requested. Processing continues securely in the background.',
                      semanticsLabel:
                          'Account deletion status: ${_status!.state}',
                    ),
                  ),
                if (_message != null) Text(_message!),
                if (_busy) const LinearProgressIndicator(),
                const SizedBox(height: 12),
                const Text(
                  'Keep this app or browser’s saved receipt to check completion after sign-out. Clearing local app/browser data removes that receipt. This does not promise immediate removal from backups, caches or other people’s copies.',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _reason(String? reason) => switch (reason) {
    'billing' => 'subscription cancellation has not yet been confirmed; your BiteSaver business remains unavailable',
    'ownership' => 'account or business ownership needs resolution',
    'media' => 'photo ownership needs verification',
    'provider' => 'authentication-provider recovery is needed',
    'accepted_work' => 'previously accepted work needs reconciliation',
    'identity_changed' => 'account identity requires recovery',
    _ => 'a temporary processing problem will be retried',
  };
}
