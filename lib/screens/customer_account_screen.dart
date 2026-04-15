import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/app_error_text.dart';
import '../services/customer_auth_service.dart';
import '../widgets/phone_auth_sheet.dart';
import 'customer_profile_screen.dart';

class CustomerAccountScreen extends StatefulWidget {
  const CustomerAccountScreen({super.key});

  @override
  State<CustomerAccountScreen> createState() => _CustomerAccountScreenState();
}

class _CustomerAccountScreenState extends State<CustomerAccountScreen> {
  static const String _lastSignInMethodKey = 'last_customer_sign_in_method';

  final TextEditingController phoneController = TextEditingController();
  final TextEditingController emailController = TextEditingController();
  final TextEditingController passwordController = TextEditingController();
  final TextEditingController confirmPasswordController =
      TextEditingController();

  bool isCreateMode = false;
  bool isSubmitting = false;
  String? _lastUsedMethod;

  @override
  void initState() {
    super.initState();
    _loadLastUsedMethod();
  }

  Future<void> _refreshVerificationStatus() async {
    try {
      await FirebaseAuth.instance.currentUser?.reload();
      await FirebaseAuth.instance.currentUser?.getIdToken(true);
      if (!mounted) {
        return;
      }
      setState(() {});
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not refresh verification status right now.',
        ),
      );
    }
  }

  @override
  void dispose() {
    phoneController.dispose();
    emailController.dispose();
    passwordController.dispose();
    confirmPasswordController.dispose();
    super.dispose();
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

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
      );
  }

  bool _hasUnverifiedPasswordAccount(User user) {
    return !user.emailVerified &&
        user.providerData.any((provider) => provider.providerId == 'password');
  }

  Future<void> _resendCustomerVerificationEmail(User user) async {
    try {
      await user.sendEmailVerification();
      _showSnackBar('Verification email sent.');
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not send the verification email right now.',
        ),
      );
    }
  }

  String _customerStatusText(User? user) {
    if (user == null) {
      return 'Not signed in';
    }

    if (user.isAnonymous) {
      return 'Browsing as guest';
    }

    if (user.displayName != null && user.displayName!.trim().isNotEmpty) {
      return user.displayName!;
    }

    if (user.email != null && user.email!.trim().isNotEmpty) {
      return user.email!;
    }

    return 'Signed in';
  }

  String _providerLabel(User? user) {
    if (user == null || user.isAnonymous) {
      return 'Guest';
    }

    final providers = user.providerData.map((e) => e.providerId).toList();

    if (providers.contains('google.com')) {
      return 'Signed in with Google';
    }

    if (providers.contains('password')) {
      return 'Signed in with email and password';
    }

    if (providers.contains('phone')) {
      return 'Signed in with phone';
    }

    return 'Signed in';
  }

  Future<void> _handleGoogleSignIn() async {
    setState(() {
      isSubmitting = true;
    });

    try {
      await CustomerAuthService.signInOrLinkWithGoogle();
      await FirebaseAuth.instance.currentUser?.reload();
      await _rememberLastUsedMethod('google');

      if (!mounted) {
        return;
      }

      _showSnackBar('Signed in with Google successfully.');
    } catch (error) {
      if (!mounted) {
        return;
      }

      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not complete Google sign-in right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          isSubmitting = false;
        });
      }
    }
  }

  Future<void> _handlePhoneSignIn() async {
    if (kIsWeb) {
      _showSnackBar('Phone sign-in is available in the native app.');
      return;
    }

    final normalizedPhoneNumber = normalizePhoneNumber(phoneController.text);
    if (normalizedPhoneNumber == null) {
      _showSnackBar('Enter a valid phone number');
      return;
    }

    phoneController.value = TextEditingValue(
      text: normalizedPhoneNumber,
      selection: TextSelection.collapsed(offset: normalizedPhoneNumber.length),
    );

    final signedIn = await showPhoneAuthSheet(
      context: context,
      onVerifiedCredential: CustomerAuthService.signInOrLinkWithPhoneCredential,
      initialPhoneNumber: normalizedPhoneNumber,
      sendCodeImmediately: true,
    );

    if (signedIn == true) {
      await _rememberLastUsedMethod('phone');
      if (!mounted) {
        return;
      }
      _showSnackBar('Signed in with phone successfully.');
    }
  }

  Future<void> _handleEmailAuth() async {
    final email = emailController.text.trim();
    final password = passwordController.text;
    final confirmPassword = confirmPasswordController.text;

    if (email.isEmpty || password.isEmpty) {
      _showSnackBar('Please enter both email and password.');
      return;
    }

    if (isCreateMode && password != confirmPassword) {
      _showSnackBar('Passwords do not match.');
      return;
    }

    setState(() {
      isSubmitting = true;
    });

    try {
      if (isCreateMode) {
        await CustomerAuthService.createAccountWithEmailPassword(
          email: email,
          password: password,
        );
      } else {
        await CustomerAuthService.signInWithEmailPassword(
          email: email,
          password: password,
        );
      }

      await FirebaseAuth.instance.currentUser?.reload();
      await _rememberLastUsedMethod('email');

      final currentUser = FirebaseAuth.instance.currentUser;
      final needsEmailVerification =
          currentUser != null &&
          !currentUser.isAnonymous &&
          !currentUser.emailVerified &&
          currentUser.providerData.any(
            (provider) => provider.providerId == 'password',
          );

      if (!mounted) {
        return;
      }

      _showSnackBar(
        needsEmailVerification
            ? isCreateMode
                  ? 'Customer account created. Please check your email to verify it.'
                  : 'Signed in. Please check your email to verify this account.'
            : isCreateMode
            ? 'Customer account created successfully.'
            : 'Signed in successfully.',
      );

      passwordController.clear();
      confirmPasswordController.clear();
    } on FirebaseAuthException catch (e) {
      if (!mounted) {
        return;
      }

      _showSnackBar(
        AppErrorText.friendly(
          e,
          fallback: 'Authentication failed. Please try again.',
        ),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }

      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not complete sign-in right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          isSubmitting = false;
        });
      }
    }
  }

  Future<void> _handleSignOut() async {
    setState(() {
      isSubmitting = true;
    });

    try {
      await CustomerAuthService.signOutCustomer();

      if (!mounted) {
        return;
      }

      _showSnackBar('Signed out.');
    } catch (error) {
      if (!mounted) {
        return;
      }

      _showSnackBar(
        AppErrorText.friendly(error, fallback: 'Could not sign out right now.'),
      );
    } finally {
      if (mounted) {
        setState(() {
          isSubmitting = false;
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

  Widget _buildPhoneSignInIcon() {
    return SizedBox(
      width: 20,
      height: 20,
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Icon(
            Icons.phone_iphone_outlined,
            size: 20,
            color: Color(0xFF1E6BFF),
          ),
          ShaderMask(
            shaderCallback: (bounds) {
              return const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0xFFF3F4F6), Color(0xFFB8BDC7)],
              ).createShader(bounds);
            },
            child: const SizedBox(
              width: 8,
              height: 12,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.all(Radius.circular(2)),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmailVerificationBanner(User user) {
    if (!_hasUnverifiedPasswordAccount(user)) {
      return const SizedBox.shrink();
    }

    return SizedBox(
      width: double.infinity,
      child: Card(
        margin: const EdgeInsets.only(top: 16),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.mark_email_read_outlined, size: 44),
              const SizedBox(height: 14),
              const Text(
                'Verify Your Email',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 10),
              Text(
                'Please verify ${user.email ?? 'your email address'} before continuing.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.black54, height: 1.35),
              ),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: isSubmitting
                      ? null
                      : () => _resendCustomerVerificationEmail(user),
                  child: const Text('Resend verification email'),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: isSubmitting ? null : _refreshVerificationStatus,
                  child: const Text('Refresh Verification'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildGuestCard(User? user) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 20),
        child: Column(
          children: [
            _buildOptionWithLastUsed(
              method: 'phone',
              child: TextField(
                controller: phoneController,
                keyboardType: TextInputType.phone,
                enabled: !isSubmitting,
                autofillHints: const [AutofillHints.telephoneNumber],
                decoration: InputDecoration(
                  hintText: 'Phone number',
                  border: const OutlineInputBorder(),
                  prefixIcon: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: _buildPhoneSignInIcon(),
                  ),
                  prefixIconConstraints: const BoxConstraints(
                    minWidth: 48,
                    minHeight: 48,
                  ),
                  suffixIcon: TextButton(
                    onPressed: isSubmitting ? null : _handlePhoneSignIn,
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
                child: OutlinedButton.icon(
                  onPressed: isSubmitting ? null : _handleGoogleSignIn,
                  icon: const Icon(Icons.login, color: Color(0xFF2F5FB3)),
                  label: Text(
                    isSubmitting ? 'Please wait...' : 'Continue with Google',
                    style: const TextStyle(
                      color: Color(0xFF2F5FB3),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFFD3DEF4)),
                    backgroundColor: const Color(0xFFF7FAFF),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 14,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
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
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      isCreateMode
                          ? 'Create account with email'
                          : 'Sign in with email',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: emailController,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      labelText: 'Email',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: passwordController,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Password',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  if (isCreateMode) ...[
                    const SizedBox(height: 12),
                    TextField(
                      controller: confirmPasswordController,
                      obscureText: true,
                      decoration: const InputDecoration(
                        labelText: 'Confirm Password',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: isSubmitting ? null : _handleEmailAuth,
                      child: Text(
                        isSubmitting
                            ? 'Please wait...'
                            : isCreateMode
                            ? 'Create Customer Account'
                            : 'Sign In',
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            _buildCardInset(
              TextButton(
                onPressed: isSubmitting
                    ? null
                    : () {
                        setState(() {
                          isCreateMode = !isCreateMode;
                          passwordController.clear();
                          confirmPasswordController.clear();
                        });
                      },
                child: Text(
                  isCreateMode
                      ? 'Already have an account? Sign in'
                      : 'Need an account? Create one',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSignedInCard(User user) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            CircleAvatar(
              radius: 32,
              child: Text(
                'A',
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              _customerStatusText(user),
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              _providerLabel(user),
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.black54),
            ),
            if (user.email != null && user.email!.trim().isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                user.email!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.black54),
              ),
            ],
            _buildEmailVerificationBanner(user),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: isSubmitting
                    ? null
                    : () {
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => const CustomerProfileScreen(),
                          ),
                        );
                      },
                icon: const Icon(
                  Icons.account_circle,
                  size: 28,
                  color: Colors.white,
                ),
                label: const Text('My Profile'),
                style: FilledButton.styleFrom(
                  backgroundColor: Colors.blue,
                  foregroundColor: Colors.white,
                  elevation: 1,
                  padding: const EdgeInsets.symmetric(vertical: 18),
                  textStyle: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: isSubmitting ? null : _handleSignOut,
                icon: const Icon(Icons.logout),
                label: Text(isSubmitting ? 'Please wait...' : 'Sign Out'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.userChanges(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            appBar: null,
            body: Center(child: CircularProgressIndicator()),
          );
        }

        final user = snapshot.data;
        final isGuest = user == null || user.isAnonymous;

        return Scaffold(
          body: SafeArea(
            child: LayoutBuilder(
              builder: (context, constraints) {
                return SingleChildScrollView(
                  padding: const EdgeInsets.all(24),
                  child: ConstrainedBox(
                    constraints: BoxConstraints(
                      minHeight: constraints.maxHeight - 48,
                    ),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 500),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            if (isGuest) ...[
                              const Text(
                                'Sign in to save coupons and rate dishes',
                                textAlign: TextAlign.center,
                              ),
                              const SizedBox(height: 16),
                            ],
                            isGuest
                                ? _buildGuestCard(user)
                                : _buildSignedInCard(user),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        );
      },
    );
  }
}
