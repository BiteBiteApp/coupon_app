import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/app_error_text.dart';
import '../services/restaurant_invite_service.dart';
import '../services/restaurant_auth_service.dart';
import '../services/user_profile_service.dart';
import 'bitescore_owner_screen.dart';
import 'restaurant_auth_screen.dart';
import 'restaurant_create_coupon_screen.dart';

class RestaurantInvitePreviewScreen extends StatefulWidget {
  final String side;
  final String token;

  const RestaurantInvitePreviewScreen({
    super.key,
    required this.side,
    required this.token,
  });

  @override
  State<RestaurantInvitePreviewScreen> createState() =>
      _RestaurantInvitePreviewScreenState();
}

class _RestaurantInvitePreviewScreenState
    extends State<RestaurantInvitePreviewScreen> {
  late Future<RestaurantInvitePreview> _previewFuture;
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  final TextEditingController _confirmPasswordController =
      TextEditingController();
  bool _isRedeeming = false;

  @override
  void initState() {
    super.initState();
    _previewFuture = RestaurantInviteService.previewInvite(
      token: widget.token,
      side: widget.side,
    );
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  String get _title {
    return widget.side == 'bitescore'
        ? 'BiteScore Claim Invite'
        : 'Coupon Invite';
  }

  static const String _couponInviteVerificationMessage =
      'Your restaurant was verified by invite. Please verify your email to protect your account.';
  static const String _biteScoreInviteVerificationMessage =
      'Your restaurant claim is approved. Please verify your email before using owner tools.';

  Widget _buildInvalidInvite() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: const [
            Icon(Icons.link_off_outlined, size: 56),
            SizedBox(height: 16),
            Text(
              'This invite link is no longer valid.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            SizedBox(height: 10),
            Text(
              'Please request a new invite.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.black54),
            ),
          ],
        ),
      ),
    );
  }

  Widget _detailLine(String label, String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return const SizedBox.shrink();
    }

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 84,
            child: Text(
              label,
              style: const TextStyle(
                color: Colors.black54,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Expanded(child: Text(trimmed)),
        ],
      ),
    );
  }

  Widget _buildCouponDetails(RestaurantInvitePreview preview) {
    final prefill = preview.couponPrefill;
    final location = [
      prefill?.city ?? '',
      prefill?.state ?? '',
      prefill?.zipCode ?? '',
    ].where((part) => part.trim().isNotEmpty).join(', ');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _detailLine('Address', prefill?.streetAddress ?? ''),
        _detailLine('Location', location),
        _detailLine('Phone', prefill?.phone ?? ''),
        _detailLine('Website', prefill?.website ?? ''),
      ],
    );
  }

  Widget _buildBiteScoreDetails(RestaurantInvitePreview preview) {
    return _detailLine('Address', preview.restaurantAddressSummary);
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<User?> _ensureInviteUser() async {
    final currentUser = FirebaseAuth.instance.currentUser;
    if (currentUser != null && !currentUser.isAnonymous) {
      await currentUser.reload();
      await FirebaseAuth.instance.currentUser?.getIdToken(true);
      final refreshedUser = FirebaseAuth.instance.currentUser ?? currentUser;
      await _sendVerificationEmailIfNeeded(refreshedUser);
      return refreshedUser;
    }

    final email = _emailController.text.trim();
    final password = _passwordController.text.trim();
    final confirmPassword = _confirmPasswordController.text.trim();
    if (email.isEmpty || password.isEmpty) {
      _showSnackBar('Please enter both email and password.');
      return null;
    }
    if (confirmPassword.isEmpty) {
      _showSnackBar('Please confirm your password.');
      return null;
    }
    if (password != confirmPassword) {
      _showSnackBar('Passwords do not match.');
      return null;
    }

    final credential = await FirebaseAuth.instance
        .createUserWithEmailAndPassword(email: email, password: password);
    final user = credential.user;
    if (user == null) {
      throw StateError('Could not create your account.');
    }
    await _sendVerificationEmailIfNeeded(user);
    await user.reload();
    await FirebaseAuth.instance.currentUser?.getIdToken(true);
    final refreshedUser = FirebaseAuth.instance.currentUser ?? user;
    await UserProfileService.upsertSignedInUserProfile(refreshedUser);
    return refreshedUser;
  }

  Future<void> _sendVerificationEmailIfNeeded(User user) async {
    if (!RestaurantAuthService.requiresEmailVerification(user)) {
      return;
    }
    try {
      await user.sendEmailVerification();
    } catch (_) {
      // Redemption still succeeds; the verification gate offers resend.
    }
  }

  Future<User> _refreshedCurrentUser(User fallbackUser) async {
    await FirebaseAuth.instance.currentUser?.reload();
    await FirebaseAuth.instance.currentUser?.getIdToken(true);
    return FirebaseAuth.instance.currentUser ?? fallbackUser;
  }

  void _openVerificationGate(String message) {
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(
        builder: (_) => RestaurantAuthScreen(emailVerificationMessage: message),
      ),
      (route) => route.isFirst,
    );
  }

  void _openBiteScoreVerificationGate({
    required String message,
    required String restaurantId,
  }) {
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(
        builder: (_) => RestaurantAuthScreen(
          emailVerificationMessage: message,
          postVerificationBiteScoreRestaurantId: restaurantId,
        ),
      ),
      (route) => route.isFirst,
    );
  }

  Future<void> _redeemCouponInvite() async {
    if (_isRedeeming) {
      return;
    }

    setState(() {
      _isRedeeming = true;
    });

    try {
      final user = await _ensureInviteUser();
      if (user == null) {
        return;
      }

      await RestaurantInviteService.redeemCouponInvite(token: widget.token);
      if (!mounted) {
        return;
      }

      final refreshedUser = await _refreshedCurrentUser(user);
      if (!mounted) {
        return;
      }

      final navigator = Navigator.of(context);
      final scaffoldMessenger = ScaffoldMessenger.of(context);
      if (RestaurantAuthService.requiresEmailVerification(refreshedUser)) {
        _openVerificationGate(_couponInviteVerificationMessage);
        scaffoldMessenger
          ..hideCurrentSnackBar()
          ..showSnackBar(
            const SnackBar(
              content: Text(
                'Restaurant account approved. Please verify your email.',
              ),
            ),
          );
        return;
      }

      navigator.pushAndRemoveUntil(
        MaterialPageRoute(
          settings: const RouteSettings(
            name: RestaurantCreateCouponScreen.routeName,
          ),
          builder: (_) => const RestaurantCreateCouponScreen(),
        ),
        (route) => route.isFirst,
      );
      scaffoldMessenger
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            content: Text('Restaurant account created. Welcome to BiteSaver.'),
          ),
        );
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not redeem this invite right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isRedeeming = false;
        });
      }
    }
  }

  Future<void> _redeemBiteScoreInvite() async {
    if (_isRedeeming) {
      return;
    }

    setState(() {
      _isRedeeming = true;
    });

    try {
      final user = await _ensureInviteUser();
      if (user == null) {
        return;
      }

      final redemption =
          await RestaurantInviteService.redeemBiteScoreClaimInvite(
            token: widget.token,
          );
      if (!mounted) {
        return;
      }

      final refreshedUser = await _refreshedCurrentUser(user);
      if (!mounted) {
        return;
      }

      final navigator = Navigator.of(context);
      final scaffoldMessenger = ScaffoldMessenger.of(context);
      if (RestaurantAuthService.requiresEmailVerification(refreshedUser)) {
        _openBiteScoreVerificationGate(
          message: _biteScoreInviteVerificationMessage,
          restaurantId: redemption.restaurantId,
        );
        scaffoldMessenger
          ..hideCurrentSnackBar()
          ..showSnackBar(
            const SnackBar(
              content: Text(
                'Restaurant claim approved. Please verify your email.',
              ),
            ),
          );
        return;
      }

      navigator.pushAndRemoveUntil(
        MaterialPageRoute(
          builder: (_) => BiteScoreOwnerScreen(
            currentUser: refreshedUser,
            initialRestaurantId: redemption.restaurantId,
          ),
        ),
        (route) => route.isFirst,
      );
      scaffoldMessenger
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            content: Text('Restaurant claimed. Welcome to BiteScore.'),
          ),
        );
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not redeem this invite right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isRedeeming = false;
        });
      }
    }
  }

  Widget _buildInviteAccountForm({
    required String signedInButtonLabel,
    required String signedInBusyLabel,
    required String signedOutButtonLabel,
    required String signedOutBusyLabel,
    required VoidCallback onRedeem,
  }) {
    final currentUser = FirebaseAuth.instance.currentUser;
    final signedInUser = currentUser != null && !currentUser.isAnonymous
        ? currentUser
        : null;

    if (signedInUser != null) {
      final email = signedInUser.email?.trim();
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            email?.isNotEmpty == true
                ? 'Signed in as $email'
                : 'Signed in to BiteSaver',
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _isRedeeming ? null : onRedeem,
            child: Text(_isRedeeming ? signedInBusyLabel : signedInButtonLabel),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _emailController,
          keyboardType: TextInputType.emailAddress,
          textInputAction: TextInputAction.next,
          autofillHints: const [AutofillHints.email],
          decoration: const InputDecoration(labelText: 'Email'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _passwordController,
          obscureText: true,
          textInputAction: TextInputAction.next,
          autofillHints: const [AutofillHints.newPassword],
          decoration: const InputDecoration(labelText: 'Password'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _confirmPasswordController,
          obscureText: true,
          textInputAction: TextInputAction.done,
          autofillHints: const [AutofillHints.newPassword],
          decoration: const InputDecoration(labelText: 'Confirm password'),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _isRedeeming ? null : onRedeem,
          child: Text(_isRedeeming ? signedOutBusyLabel : signedOutButtonLabel),
        ),
      ],
    );
  }

  Widget _buildCouponRedemptionForm() {
    return _buildInviteAccountForm(
      signedInButtonLabel: 'Create Restaurant Account',
      signedInBusyLabel: 'Creating Account...',
      signedOutButtonLabel: 'Create Account',
      signedOutBusyLabel: 'Creating Account...',
      onRedeem: _redeemCouponInvite,
    );
  }

  Widget _buildBiteScoreRedemptionForm() {
    return _buildInviteAccountForm(
      signedInButtonLabel: 'Claim Restaurant',
      signedInBusyLabel: 'Claiming Restaurant...',
      signedOutButtonLabel: 'Create Account & Claim Restaurant',
      signedOutBusyLabel: 'Creating Account...',
      onRedeem: _redeemBiteScoreInvite,
    );
  }

  Widget _buildPreview(RestaurantInvitePreview preview) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'This invite is for:',
                  style: TextStyle(fontSize: 15, color: Colors.black54),
                ),
                const SizedBox(height: 8),
                Text(
                  preview.restaurantName.isEmpty
                      ? 'Restaurant'
                      : preview.restaurantName,
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                if (preview.isCoupon)
                  _buildCouponDetails(preview)
                else
                  _buildBiteScoreDetails(preview),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        if (preview.isCoupon) ...[
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'This invite verifies your restaurant for BiteSaver. You may still need to verify your email.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.black54),
                  ),
                  const SizedBox(height: 16),
                  _buildCouponRedemptionForm(),
                ],
              ),
            ),
          ),
        ] else ...[
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'This invite verifies your restaurant claim for BiteScore. You may still need to verify your email.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.black54),
                  ),
                  const SizedBox(height: 16),
                  _buildBiteScoreRedemptionForm(),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_title)),
      body: FutureBuilder<RestaurantInvitePreview>(
        future: _previewFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError || snapshot.data == null) {
            return _buildInvalidInvite();
          }

          return _buildPreview(snapshot.data!);
        },
      ),
    );
  }
}
