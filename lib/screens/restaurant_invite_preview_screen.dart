import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/app_error_text.dart';
import '../services/restaurant_invite_service.dart';
import '../services/user_profile_service.dart';
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

  String get _disabledActionLabel => 'Claim setup coming next';

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
      return FirebaseAuth.instance.currentUser ?? currentUser;
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
    if (!user.emailVerified) {
      await user.sendEmailVerification();
    }
    await user.reload();
    await FirebaseAuth.instance.currentUser?.getIdToken(true);
    final refreshedUser = FirebaseAuth.instance.currentUser ?? user;
    await UserProfileService.upsertSignedInUserProfile(refreshedUser);
    return refreshedUser;
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

      final navigator = Navigator.of(context);
      final scaffoldMessenger = ScaffoldMessenger.of(context);
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

  Widget _buildCouponRedemptionForm() {
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
            onPressed: _isRedeeming ? null : _redeemCouponInvite,
            child: Text(
              _isRedeeming
                  ? 'Creating Account...'
                  : 'Create Restaurant Account',
            ),
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
          onPressed: _isRedeeming ? null : _redeemCouponInvite,
          child: Text(_isRedeeming ? 'Creating Account...' : 'Create Account'),
        ),
      ],
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
          FilledButton(onPressed: null, child: Text(_disabledActionLabel)),
          const SizedBox(height: 10),
          const Text(
            'Full BiteScore claim redemption will be available in a later stage.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.black54),
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
