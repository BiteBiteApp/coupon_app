import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/app_error_text.dart';
import '../services/customer_auth_service.dart';
import 'customer_profile_screen.dart';

class CustomerAccountScreen extends StatefulWidget {
  const CustomerAccountScreen({super.key});

  @override
  State<CustomerAccountScreen> createState() => _CustomerAccountScreenState();
}

class _CustomerAccountScreenState extends State<CustomerAccountScreen> {
  final TextEditingController emailController = TextEditingController();
  final TextEditingController passwordController = TextEditingController();
  final TextEditingController confirmPasswordController =
      TextEditingController();

  bool isCreateMode = false;
  bool isSubmitting = false;

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
    emailController.dispose();
    passwordController.dispose();
    confirmPasswordController.dispose();
    super.dispose();
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          duration: const Duration(seconds: 3),
        ),
      );
  }

  bool _hasUnverifiedPasswordAccount(User user) {
    return !user.emailVerified &&
        user.providerData.any(
          (provider) => provider.providerId == 'password',
        );
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

  String _customerSubtitle(User? user) {
    if (user == null || user.isAnonymous) {
      return 'Sign in with Google or email to keep your coupon history across sessions and devices.';
    }

    return 'Your coupon history is tied to your signed-in customer account.';
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

    return 'Signed in';
  }

  Future<void> _handleGoogleSignIn() async {
    setState(() {
      isSubmitting = true;
    });

    try {
      await CustomerAuthService.signInOrLinkWithGoogle();
      await FirebaseAuth.instance.currentUser?.reload();

      if (!mounted) return;

      _showSnackBar('Signed in with Google successfully.');
    } catch (error) {
      if (!mounted) return;

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

      final currentUser = FirebaseAuth.instance.currentUser;
      final needsEmailVerification = currentUser != null &&
          !currentUser.isAnonymous &&
          !currentUser.emailVerified &&
          currentUser.providerData.any(
            (provider) => provider.providerId == 'password',
          );

      if (!mounted) return;

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
      if (!mounted) return;

      _showSnackBar(
        AppErrorText.friendly(
          e,
          fallback: 'Authentication failed. Please try again.',
        ),
      );
    } catch (error) {
      if (!mounted) return;

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

      if (!mounted) return;

      _showSnackBar('Signed out.');
    } catch (error) {
      if (!mounted) return;

      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not sign out right now.',
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
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.bold,
            ),
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
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            CircleAvatar(
              radius: 32,
              child: Text(
                user == null || user.isAnonymous ? 'G' : 'A',
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
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _customerSubtitle(user),
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.black54,
              ),
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: isSubmitting ? null : _handleGoogleSignIn,
                icon: const Icon(Icons.login),
                label: Text(
                  isSubmitting ? 'Please wait...' : 'Continue with Google',
                ),
              ),
            ),
            const SizedBox(height: 20),
            const Divider(),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                isCreateMode ? 'Create account with email' : 'Sign in with email',
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
            const SizedBox(height: 8),
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
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _providerLabel(user),
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.black54,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _customerSubtitle(user),
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.black54,
              ),
            ),
            if (user.email != null && user.email!.trim().isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                user.email!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.black54,
                ),
              ),
            ],
            _buildEmailVerificationBanner(user),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: isSubmitting
                    ? null
                    : () {
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => const CustomerProfileScreen(),
                          ),
                        );
                      },
                icon: const Icon(Icons.person_outline),
                label: const Text('My Profile'),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: isSubmitting ? null : _handleSignOut,
                icon: const Icon(Icons.logout),
                label: Text(
                  isSubmitting ? 'Please wait...' : 'Sign Out',
                ),
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
            body: Center(
              child: CircularProgressIndicator(),
            ),
          );
        }

        final user = snapshot.data;
        final isGuest = user == null || user.isAnonymous;

        return Scaffold(
          appBar: AppBar(
            title: const Text('Account'),
            centerTitle: true,
          ),
          body: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 500),
                child: isGuest ? _buildGuestCard(user) : _buildSignedInCard(user!),
              ),
            ),
          ),
        );
      },
    );
  }
}
