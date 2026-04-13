import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/services/customer_session_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../models/bitescore_restaurant.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_service.dart';
import '../services/restaurant_account_service.dart';
import '../services/restaurant_auth_service.dart';
import 'main_navigation_screen.dart';
import 'restaurant_create_coupon_screen.dart';
import 'restaurant_owner_hub_screen.dart';

class RestaurantAuthScreen extends StatefulWidget {
  const RestaurantAuthScreen({super.key});

  @override
  State<RestaurantAuthScreen> createState() => _RestaurantAuthScreenState();
}

class _RestaurantAuthScreenState extends State<RestaurantAuthScreen>
    with WidgetsBindingObserver {
  final TextEditingController emailController = TextEditingController();
  final TextEditingController passwordController = TextEditingController();

  bool isLoginMode = true;
  bool isLoading = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    emailController.dispose();
    passwordController.dispose();
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

  Future<void> submit() async {
    final email = emailController.text.trim();
    final password = passwordController.text.trim();

    if (email.isEmpty || password.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter both email and password.'),
        ),
      );
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
      await _refreshLiveVerificationState();

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Signed in with Google successfully.'),
        ),
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

  Future<void> resendVerificationEmail(User user) async {
    try {
      await user.sendEmailVerification();

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Verification email sent.'),
        ),
      );
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
    await CustomerSessionService.restoreGuestSession();
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

  Widget buildAuthForm() {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    isLoginMode
                        ? 'Restaurant Sign In'
                        : 'Create Restaurant Account',
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    isLoginMode
                        ? 'Sign in with your restaurant email/password or Google account.'
                        : 'Create a restaurant account with email/password, or continue with Google. You will still need approval before posting coupons.',
                    style: const TextStyle(color: Colors.black54),
                  ),
                  const SizedBox(height: 20),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: isLoading ? null : continueWithGoogle,
                      icon: const Icon(Icons.login),
                      label: Text(
                        isLoading
                            ? 'Please wait...'
                            : 'Continue with Google',
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Divider(),
                  const SizedBox(height: 16),
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
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: TextButton(
                      onPressed: isLoading
                          ? null
                          : () {
                              setState(() {
                                isLoginMode = !isLoginMode;
                              });
                            },
                      child: Text(
                        isLoginMode
                            ? 'Need an account? Create one'
                            : 'Already have an account? Sign in',
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
        padding: const EdgeInsets.all(24),
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
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'A verification email has been sent to ${user.email ?? 'your email address'}. Please verify your email before continuing.',
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
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.hourglass_top, size: 52),
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
        ),
      ),
    );
  }

  Widget buildRejectedScreen(User user) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
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
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                    ),
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

  Widget buildNoApprovedAccountsScreen(User user) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
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
                        'Apply to post coupons for your restaurant and manage BiteSaver offers.',
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 18),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: () {
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => const RestaurantCreateCouponScreen(),
                              ),
                            );
                          },
                          child: const Text('Apply for Coupon Side'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.restaurant_outlined, size: 48),
                      const SizedBox(height: 14),
                      const Text(
                        'BiteRater Side',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 10),
                      const Text(
                        'Claim your restaurant on the rating side to manage dishes and restaurant tools.',
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 18),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton(
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
                          child: const Text('Browse BiteRater and Claim'),
                        ),
                      ),
                      const SizedBox(height: 10),
                      const Text(
                        'If you don\'t see your restaurant, use Create & Rate to add it.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.black54,
                          height: 1.35,
                        ),
                      ),
                    ],
                  ),
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
    );
  }

  Widget buildOwnerAccessLoadErrorScreen() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
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
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                    ),
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

  Widget buildRestaurantGate(User user) {
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: RestaurantAccountService.accountStream(user.uid),
      builder: (context, accountSnapshot) {
        if (accountSnapshot.connectionState == ConnectionState.waiting &&
            !accountSnapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }

        final data = accountSnapshot.data?.data();
        final hasCouponAccount = data != null;
        final emailVerified = user.emailVerified;
        final approvalStatus =
            (data?['approvalStatus'] as String?) ?? 'pending';
        final hasCouponAccess =
            hasCouponAccount && emailVerified && approvalStatus == 'approved';

        return FutureBuilder<List<BitescoreRestaurant>>(
          future: BiteScoreService.loadOwnedRestaurantsForUser(user.uid),
          builder: (context, ownerSnapshot) {
            if (ownerSnapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            final ownedRestaurants =
                ownerSnapshot.data ?? const <BitescoreRestaurant>[];
            final hasBiteScoreAccess = ownedRestaurants.isNotEmpty;

            if (hasCouponAccess || hasBiteScoreAccess) {
              return RestaurantOwnerHubScreen(currentUser: user);
            }

            if (!hasCouponAccount) {
              return buildNoApprovedAccountsScreen(user);
            }

            if (!emailVerified) {
              return buildEmailVerificationScreen(user);
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

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.userChanges(),
      builder: (context, snapshot) {
        final user = snapshot.data;

        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            body: Center(
              child: CircularProgressIndicator(),
            ),
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
