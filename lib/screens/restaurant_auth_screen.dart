import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/services/customer_session_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/bitescore_restaurant.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_service.dart';
import '../services/restaurant_account_service.dart';
import '../services/restaurant_auth_service.dart';
import '../services/user_profile_service.dart';
import '../widgets/phone_auth_sheet.dart';
import 'bitescore_owner_screen.dart';
import 'main_navigation_screen.dart';
import 'restaurant_create_coupon_screen.dart';
import 'restaurant_owner_hub_screen.dart';

class RestaurantAuthScreen extends StatefulWidget {
  final String? emailVerificationMessage;
  final String? postVerificationBiteScoreRestaurantId;

  const RestaurantAuthScreen({
    super.key,
    this.emailVerificationMessage,
    this.postVerificationBiteScoreRestaurantId,
  });

  @override
  State<RestaurantAuthScreen> createState() => _RestaurantAuthScreenState();
}

class _RestaurantAuthScreenState extends State<RestaurantAuthScreen>
    with WidgetsBindingObserver {
  static const String _lastSignInMethodKey = 'last_restaurant_sign_in_method';
  static const String _biteScoreClaimHelperText =
      'Don’t see your restaurant? Use the Add a Dish button to create it.';

  final TextEditingController phoneController = TextEditingController();
  final TextEditingController emailController = TextEditingController();
  final TextEditingController passwordController = TextEditingController();
  final TextEditingController confirmPasswordController =
      TextEditingController();

  bool isLoginMode = true;
  bool isLoading = false;
  String? _lastUsedMethod;
  bool _handledPostVerificationRedirect = false;
  bool _shownPostVerificationFallbackMessage = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadLastUsedMethod();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    phoneController.dispose();
    emailController.dispose();
    passwordController.dispose();
    confirmPasswordController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshLiveVerificationState();
    }
  }

  Future<User?> _refreshLiveVerificationState() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      return null;
    }

    try {
      await user.reload();
      final refreshedUser = FirebaseAuth.instance.currentUser;
      await refreshedUser?.getIdToken(true);
      if (refreshedUser != null) {
        await RestaurantAccountService.syncEmailVerified(refreshedUser);
      }
      if (mounted) {
        setState(() {});
      }
      return refreshedUser;
    } catch (_) {
      return FirebaseAuth.instance.currentUser;
    }
  }

  Future<void> _loadLastUsedMethod() async {
    final prefs = await SharedPreferences.getInstance();
    final lastUsedMethod = prefs.getString(_lastSignInMethodKey);
    if (!mounted) {
      return;
    }
    setState(() {
      _lastUsedMethod = lastUsedMethod;
    });
  }

  Future<void> _rememberLastUsedMethod(String method) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_lastSignInMethodKey, method);
    if (!mounted) {
      return;
    }
    setState(() {
      _lastUsedMethod = method;
    });
  }

  Future<void> submit() async {
    final email = emailController.text.trim();
    final password = passwordController.text.trim();
    final confirmPassword = confirmPasswordController.text.trim();

    if (email.isEmpty || password.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter both email and password.')),
      );
      return;
    }

    if (!isLoginMode && confirmPassword.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please confirm your password.')),
      );
      return;
    }

    if (!isLoginMode && password != confirmPassword) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Passwords do not match.')));
      return;
    }

    setState(() {
      isLoading = true;
    });

    try {
      UserCredential credential;

      if (isLoginMode) {
        credential = await FirebaseAuth.instance.signInWithEmailAndPassword(
          email: email,
          password: password,
        );
      } else {
        credential = await FirebaseAuth.instance.createUserWithEmailAndPassword(
          email: email,
          password: password,
        );

        final user = credential.user;
        if (user != null && !user.emailVerified) {
          await user.sendEmailVerification();
        }
      }

      final user = credential.user;
      if (user != null) {
        await user.reload();
        await FirebaseAuth.instance.currentUser?.getIdToken(true);
        final refreshedUser = FirebaseAuth.instance.currentUser ?? user;
        await RestaurantAccountService.createOrUpdateAccountRecord(
          refreshedUser,
        );
        await RestaurantAccountService.syncEmailVerified(refreshedUser);
        await UserProfileService.upsertSignedInUserProfile(refreshedUser);
        await _rememberLastUsedMethod('email');
      }

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            isLoginMode
                ? 'Signed in successfully.'
                : 'Account created. Please verify your email.',
          ),
        ),
      );
    } on FirebaseAuthException catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              e,
              fallback: 'Authentication failed. Please try again.',
            ),
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not complete restaurant sign-in right now.',
            ),
          ),
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  Future<void> continueWithGoogle() async {
    setState(() {
      isLoading = true;
    });

    try {
      await RestaurantAuthService.signInWithGoogle();
      await _rememberLastUsedMethod('google');
      await _refreshLiveVerificationState();

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Signed in with Google successfully.')),
      );
    } on FirebaseAuthException catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              e,
              fallback: 'Google sign-in failed. Please try again.',
            ),
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not complete Google sign-in right now.',
            ),
          ),
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  Future<void> continueWithPhone() async {
    if (kIsWeb) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Phone sign-in is available in the native app.'),
        ),
      );
      return;
    }

    final normalizedPhoneNumber = normalizePhoneNumber(phoneController.text);
    if (normalizedPhoneNumber == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid phone number')),
      );
      return;
    }

    phoneController.value = TextEditingValue(
      text: normalizedPhoneNumber,
      selection: TextSelection.collapsed(offset: normalizedPhoneNumber.length),
    );

    final signedIn = await showPhoneAuthSheet(
      context: context,
      onVerifiedCredential: RestaurantAuthService.signInWithPhoneCredential,
      initialPhoneNumber: normalizedPhoneNumber,
      sendCodeImmediately: true,
    );

    if (signedIn == true) {
      await _rememberLastUsedMethod('phone');
      await _refreshLiveVerificationState();
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Signed in with phone successfully.')),
      );
    }
  }

  Future<void> resendVerificationEmail(User user) async {
    try {
      await user.sendEmailVerification();

      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Verification email sent.')));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not send the verification email right now.',
            ),
          ),
        ),
      );
    }
  }

  Future<void> refreshVerifiedStatus(User user) async {
    try {
      await _refreshLiveVerificationState();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not refresh verification status right now.',
            ),
          ),
        ),
      );
    }
  }

  Future<void> signOut() async {
    await CustomerSessionService.signOutToSignedOut();
  }

  Future<void> _applyForRestaurantAccount(User user) async {
    setState(() {
      isLoading = true;
    });

    try {
      await RestaurantAccountService.createOrUpdateAccountRecord(user);
      await RestaurantAccountService.syncEmailVerified(user);

      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Restaurant account application submitted.'),
        ),
      );
      setState(() {});
    } catch (error) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback:
                  'Could not submit your restaurant account application right now.',
            ),
          ),
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  Widget _buildOrSeparator() {
    return const Text(
      '--- or ---',
      textAlign: TextAlign.center,
      style: TextStyle(fontSize: 13, color: Colors.black45),
    );
  }

  Widget _buildLastUsedMarker(String method) {
    final isLastUsed = _lastUsedMethod == method;

    return SizedBox(
      width: 14,
      child: Align(
        alignment: const Alignment(-0.55, 0),
        child: isLastUsed
            ? Container(
                width: 14,
                height: 14,
                decoration: BoxDecoration(
                  color: const Color(0xFFE2ECFA),
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0xFFC7D7EF)),
                ),
                child: const Icon(
                  Icons.check,
                  size: 10,
                  color: Color(0xFF48627E),
                ),
              )
            : const SizedBox.shrink(),
      ),
    );
  }

  BoxDecoration? _lastUsedHighlightDecoration(String method) {
    if (_lastUsedMethod != method) {
      return null;
    }

    return BoxDecoration(
      color: const Color(0xFFF8FBFF),
      borderRadius: BorderRadius.zero,
      border: Border.all(color: const Color(0xFFD9E4F3)),
    );
  }

  Widget _buildOptionWithLastUsed({
    required String method,
    required Widget child,
    CrossAxisAlignment crossAxisAlignment = CrossAxisAlignment.center,
  }) {
    return Container(
      width: double.infinity,
      margin: EdgeInsets.zero,
      decoration: _lastUsedHighlightDecoration(method),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
      child: Row(
        crossAxisAlignment: crossAxisAlignment,
        children: [
          _buildLastUsedMarker(method),
          const SizedBox(width: 2),
          Expanded(child: child),
        ],
      ),
    );
  }

  Widget _buildCardInset(Widget child) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: child,
    );
  }

  EdgeInsets _screenPadding(BuildContext context) {
    return EdgeInsets.fromLTRB(
      24,
      24,
      24,
      96 + MediaQuery.of(context).viewPadding.bottom,
    );
  }

  Widget buildAuthForm() {
    return Center(
      child: SingleChildScrollView(
        padding: _screenPadding(context),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildCardInset(
                    Text(
                      isLoginMode
                          ? 'Restaurant Sign In'
                          : 'Create Restaurant Account',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  _buildOptionWithLastUsed(
                    method: 'phone',
                    child: TextField(
                      controller: phoneController,
                      keyboardType: TextInputType.phone,
                      enabled: !isLoading,
                      autofillHints: const [AutofillHints.telephoneNumber],
                      decoration: InputDecoration(
                        hintText: 'Phone number',
                        border: const OutlineInputBorder(),
                        prefixIcon: const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 12),
                          child: Icon(Icons.phone_iphone_outlined),
                        ),
                        prefixIconConstraints: const BoxConstraints(
                          minWidth: 48,
                          minHeight: 48,
                        ),
                        suffixIcon: TextButton(
                          onPressed: isLoading ? null : continueWithPhone,
                          child: const Text('Send Code'),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  _buildCardInset(_buildOrSeparator()),
                  const SizedBox(height: 12),
                  _buildOptionWithLastUsed(
                    method: 'google',
                    child: SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        onPressed: isLoading ? null : continueWithGoogle,
                        icon: const Icon(Icons.login),
                        label: Text(
                          isLoading ? 'Please wait...' : 'Continue with Google',
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  _buildCardInset(_buildOrSeparator()),
                  const SizedBox(height: 16),
                  _buildOptionWithLastUsed(
                    method: 'email',
                    crossAxisAlignment: CrossAxisAlignment.start,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        TextField(
                          controller: emailController,
                          keyboardType: TextInputType.emailAddress,
                          decoration: const InputDecoration(
                            labelText: 'Email',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 16),
                        TextField(
                          controller: passwordController,
                          obscureText: true,
                          decoration: const InputDecoration(
                            labelText: 'Password',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        if (!isLoginMode) ...[
                          const SizedBox(height: 16),
                          TextField(
                            controller: confirmPasswordController,
                            obscureText: true,
                            decoration: const InputDecoration(
                              labelText: 'Confirm Password',
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ],
                        const SizedBox(height: 20),
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton(
                            onPressed: isLoading ? null : submit,
                            child: Text(
                              isLoading
                                  ? 'Please wait...'
                                  : isLoginMode
                                  ? 'Sign In'
                                  : 'Create Account',
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildCardInset(
                    SizedBox(
                      width: double.infinity,
                      child: TextButton(
                        onPressed: isLoading
                            ? null
                            : () {
                                setState(() {
                                  isLoginMode = !isLoginMode;
                                  confirmPasswordController.clear();
                                });
                              },
                        child: Text(
                          isLoginMode
                              ? 'Need an account? Create one'
                              : 'Already have an account? Sign in',
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget buildEmailVerificationScreen(User user) {
    return Center(
      child: Padding(
        padding: _screenPadding(context),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 500),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.mark_email_read, size: 52),
                  const SizedBox(height: 16),
                  const Text(
                    'Verify Your Email',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    widget.emailVerificationMessage?.trim().isNotEmpty == true
                        ? widget.emailVerificationMessage!.trim()
                        : 'A verification email has been sent to ${user.email ?? 'your email address'}. Please verify your email before continuing.',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 20),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: () => resendVerificationEmail(user),
                      child: const Text('Resend Verification Email'),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: () => refreshVerifiedStatus(user),
                      child: const Text('Refresh Verification'),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: TextButton(
                      onPressed: signOut,
                      child: const Text('Sign Out'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget buildPendingApprovalScreen(User user) {
    return Center(
      child: SingleChildScrollView(
        padding: _screenPadding(context),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.orange.shade600.withOpacity(0.1),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.hourglass_top,
                          size: 52,
                          color: Colors.orange.shade600,
                        ),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'Pending Approval',
                        style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'Your restaurant account (${user.email ?? 'unknown email'}) has been verified but is still waiting for admin approval before you can post coupons.',
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 20),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton(
                          onPressed: () async {
                            await _refreshLiveVerificationState();
                          },
                          child: const Text('Refresh Status'),
                        ),
                      ),
                      const SizedBox(height: 12),
                      SizedBox(
                        width: double.infinity,
                        child: TextButton(
                          onPressed: signOut,
                          child: const Text('Sign Out'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              _buildBiteRaterAccessCard(
                title: 'Claim Your Restaurant on BiteScore',
                message:
                    'While your coupon-side application is being reviewed, you can still browse BiteScore and claim your restaurant on the rating side.',
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget buildRejectedScreen(User user) {
    return Center(
      child: Padding(
        padding: _screenPadding(context),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.block, size: 52),
                  const SizedBox(height: 16),
                  const Text(
                    'Account Not Approved',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Your restaurant account (${user.email ?? 'unknown email'}) was not approved for posting coupons.',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 20),
                  SizedBox(
                    width: double.infinity,
                    child: TextButton(
                      onPressed: signOut,
                      child: const Text('Sign Out'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildBiteRaterAccessCard({
    String title = 'BiteScore Side',
    String message =
        'Claim your restaurant on the rating side to manage dishes and restaurant tools.',
  }) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.blue.shade600.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.restaurant_outlined,
                size: 48,
                color: Colors.blue.shade600,
              ),
            ),
            const SizedBox(height: 14),
            Text(
              title,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 10),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => MainNavigationScreen(
                        initialMode: AppMode.biteScore,
                        initialIndex: 0,
                      ),
                    ),
                  );
                },
                style: _restaurantHubActionButtonStyle(),
                child: const Text(
                  'Browse BiteScore and Claim',
                  textAlign: TextAlign.center,
                ),
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              _biteScoreClaimHelperText,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13,
                color: Colors.black54,
                height: 1.35,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget buildNoApprovedAccountsScreen(User user) {
    return Center(
      child: SingleChildScrollView(
        padding: _screenPadding(context),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.local_offer_outlined, size: 48),
                      const SizedBox(height: 14),
                      const Text(
                        'Coupon Side',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 10),
                      const Text(
                        'Apply to post coupons and specials for your restaurant.',
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 18),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: () {
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                settings: const RouteSettings(
                                  name: RestaurantCreateCouponScreen.routeName,
                                ),
                                builder: (_) =>
                                    const RestaurantCreateCouponScreen(),
                              ),
                            );
                          },
                          style: _restaurantHubActionButtonStyle(),
                          child: const Text(
                            'Apply for Coupon Side',
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              _buildBiteRaterAccessCard(),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: TextButton(
                  onPressed: signOut,
                  child: const Text('Sign Out'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget buildOwnerAccessLoadErrorScreen() {
    return Center(
      child: Padding(
        padding: _screenPadding(context),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.error_outline, size: 52),
                  const SizedBox(height: 16),
                  const Text(
                    'Could Not Check Owner Access',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'We couldn\'t verify your Restaurant Hub access right now. Please refresh and try again.',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 20),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: () {
                        _refreshLiveVerificationState();
                      },
                      child: const Text('Refresh Status'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  String? get _postVerificationBiteScoreRestaurantId {
    final trimmed = widget.postVerificationBiteScoreRestaurantId?.trim();
    return trimmed == null || trimmed.isEmpty ? null : trimmed;
  }

  Widget? _buildPostVerificationBiteScoreRedirect({
    required User user,
    required List<BitescoreRestaurant> ownedRestaurants,
  }) {
    final requestedRestaurantId = _postVerificationBiteScoreRestaurantId;
    if (requestedRestaurantId == null) {
      return null;
    }

    BitescoreRestaurant? targetRestaurant;
    for (final restaurant in ownedRestaurants) {
      if (restaurant.id == requestedRestaurantId) {
        targetRestaurant = restaurant;
        break;
      }
    }
    if (targetRestaurant == null && ownedRestaurants.length == 1) {
      targetRestaurant = ownedRestaurants.first;
    }

    if (targetRestaurant == null) {
      if (!_shownPostVerificationFallbackMessage) {
        _shownPostVerificationFallbackMessage = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) {
            return;
          }
          ScaffoldMessenger.of(context)
            ..hideCurrentSnackBar()
            ..showSnackBar(
              const SnackBar(
                content: Text(
                  'Your email is verified. Open BiteScore tools from the Restaurant Hub.',
                ),
              ),
            );
        });
      }
      return null;
    }

    if (!_handledPostVerificationRedirect) {
      _handledPostVerificationRedirect = true;
      final targetRestaurantId = targetRestaurant.id;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) {
          return;
        }
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => BiteScoreOwnerScreen(
              currentUser: user,
              initialRestaurantId: targetRestaurantId,
            ),
          ),
        );
      });
    }

    return const Center(child: CircularProgressIndicator());
  }

  Widget buildRestaurantGate(User user) {
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: RestaurantAccountService.accountStream(user.uid),
      builder: (context, accountSnapshot) {
        if (accountSnapshot.connectionState == ConnectionState.waiting &&
            !accountSnapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }

        final data = accountSnapshot.data?.data();
        final hasCouponApplication =
            RestaurantAccountService.hasSubmittedCouponApplication(data);
        final requiresEmailVerification =
            RestaurantAuthService.requiresEmailVerification(user);
        final approvalStatus =
            (data?['approvalStatus'] as String?) ?? 'pending';
        final hasCouponAccess =
            hasCouponApplication &&
            !requiresEmailVerification &&
            approvalStatus == 'approved';

        return FutureBuilder<List<BitescoreRestaurant>>(
          future: BiteScoreService.loadOwnedRestaurantsForUser(user.uid),
          builder: (context, ownerSnapshot) {
            if (ownerSnapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            final ownedRestaurants =
                ownerSnapshot.data ?? const <BitescoreRestaurant>[];
            final hasBiteScoreAccess = ownedRestaurants.isNotEmpty;

            if (!requiresEmailVerification) {
              final redirect = _buildPostVerificationBiteScoreRedirect(
                user: user,
                ownedRestaurants: ownedRestaurants,
              );
              if (redirect != null) {
                return redirect;
              }
            }

            if (!requiresEmailVerification &&
                (hasCouponAccess || hasBiteScoreAccess)) {
              return RestaurantOwnerHubScreen(currentUser: user);
            }

            if (requiresEmailVerification) {
              return buildEmailVerificationScreen(user);
            }

            if (!hasCouponApplication) {
              return buildNoApprovedAccountsScreen(user);
            }

            if (approvalStatus == 'pending') {
              return buildPendingApprovalScreen(user);
            }

            if (approvalStatus == 'rejected') {
              return buildRejectedScreen(user);
            }

            if (ownerSnapshot.hasError) {
              return buildOwnerAccessLoadErrorScreen();
            }

            return buildNoApprovedAccountsScreen(user);
          },
        );
      },
    );
  }

  ButtonStyle _restaurantHubActionButtonStyle() {
    return ElevatedButton.styleFrom(
      backgroundColor: Colors.blue.shade700,
      foregroundColor: Colors.white,
      elevation: 4,
      shadowColor: Colors.blue.shade900.withValues(alpha: 0.22),
      minimumSize: const Size.fromHeight(48),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      textStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.userChanges(),
      builder: (context, snapshot) {
        final user = snapshot.data;

        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        if (user == null || user.isAnonymous) {
          return Scaffold(
            appBar: AppBar(
              title: const Text('Restaurant Hub'),
              centerTitle: true,
            ),
            body: buildAuthForm(),
          );
        }

        return Scaffold(
          appBar: AppBar(
            title: const Text('Restaurant Hub'),
            centerTitle: true,
          ),
          body: buildRestaurantGate(user),
        );
      },
    );
  }
}
