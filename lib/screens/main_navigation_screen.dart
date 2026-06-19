import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/app_mode_state_service.dart';
import '../services/restaurant_customer_link_service.dart';
import '../services/restaurant_invite_service.dart';
import '../services/subscription_return_service.dart';
import '../widgets/app_mode_switcher_bar.dart';
import '../widgets/admin_content_insets.dart';
import 'admin_gate_screen.dart';
import 'bitescore_home_screen.dart';
import 'customer_account_screen.dart';
import 'home_screen.dart';
import 'restaurant_auth_screen.dart';
import 'restaurant_create_coupon_screen.dart';
import 'restaurant_customer_deep_link_screen.dart';
import 'restaurant_invite_preview_screen.dart';

final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<ScaffoldMessengerState> rootScaffoldMessengerKey =
    GlobalKey<ScaffoldMessengerState>();
const String _customerDeepLinkRoutePrefix = '/deep-link/customer-restaurant/';

class MainNavigationScreen extends StatefulWidget {
  final AppMode initialMode;
  final int initialIndex;

  const MainNavigationScreen({
    super.key,
    this.initialMode = AppMode.biteSaver,
    this.initialIndex = 0,
  });

  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  static const String _onboardingSeenKey = 'first_time_onboarding_seen';

  late int selectedIndex;
  late AppMode selectedMode;
  final AppLinks _appLinks = AppLinks();
  StreamSubscription<Uri>? _subscriptionReturnSubscription;
  bool _showOnboarding = false;
  int _deepLinkGeneration = 0;
  String? _lastHandledDeepLinkKey;
  DateTime? _lastHandledDeepLinkAt;

  @override
  void initState() {
    super.initState();
    selectedIndex = widget.initialIndex;
    selectedMode = widget.initialMode;
    AppModeStateService.setMode(widget.initialMode);
    AppModeStateService.selectedMode.addListener(_syncSelectedMode);
    _listenForSubscriptionReturnLinks();
    unawaited(_loadOnboardingState());
  }

  @override
  void dispose() {
    AppModeStateService.selectedMode.removeListener(_syncSelectedMode);
    _subscriptionReturnSubscription?.cancel();
    super.dispose();
  }

  Future<void> _listenForSubscriptionReturnLinks() async {
    try {
      final initialUri = await _appLinks.getInitialLink();
      _handleIncomingDeepLink(initialUri);
    } catch (_) {}

    _subscriptionReturnSubscription = _appLinks.uriLinkStream.listen(
      _handleIncomingDeepLink,
      onError: (_) {},
    );
  }

  Future<void> _loadOnboardingState() async {
    final prefs = await SharedPreferences.getInstance();
    final hasSeenOnboarding = prefs.getBool(_onboardingSeenKey) ?? false;
    if (!mounted || hasSeenOnboarding) {
      return;
    }

    setState(() {
      _showOnboarding = true;
    });
  }

  Future<void> _dismissOnboarding() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_onboardingSeenKey, true);
    if (!mounted) {
      return;
    }

    setState(() {
      _showOnboarding = false;
      selectedIndex = 0;
      selectedMode = AppMode.biteSaver;
    });
    AppModeStateService.setMode(AppMode.biteSaver);
  }

  void _handleIncomingDeepLink(Uri? uri) {
    if (uri == null) {
      return;
    }

    if (_isDuplicateDeepLink(uri)) {
      return;
    }

    final generation = ++_deepLinkGeneration;
    final inviteLink = RestaurantInviteService.parseInviteDeepLink(uri);
    if (inviteLink != null) {
      _handleInviteLink(inviteLink, generation: generation);
      return;
    }

    final restaurantLink =
        RestaurantCustomerLinkService.parseRestaurantDeepLink(uri);
    if (restaurantLink != null) {
      _handleRestaurantLink(restaurantLink, generation: generation);
      return;
    }

    if (uri.scheme == 'bitesaver' && uri.host == 'subscription-success') {
      _handleSubscriptionReturn(SubscriptionCheckoutReturnStatus.success);
      return;
    }

    if (uri.scheme == 'bitesaver' && uri.host == 'subscription-cancel') {
      _handleSubscriptionReturn(SubscriptionCheckoutReturnStatus.cancel);
      return;
    }

    if (uri.scheme == 'couponapp' && uri.host == 'open') {
      return;
    }

    if (uri.scheme != 'couponapp' || uri.host != 'subscription-return') {
      return;
    }

    final status = uri.queryParameters['status']?.trim().toLowerCase();
    if (status == 'success') {
      _handleSubscriptionReturn(SubscriptionCheckoutReturnStatus.success);
    } else if (status == 'cancel') {
      _handleSubscriptionReturn(SubscriptionCheckoutReturnStatus.cancel);
    }
  }

  bool _isDuplicateDeepLink(Uri uri) {
    final key = uri.toString();
    final now = DateTime.now();
    final lastAt = _lastHandledDeepLinkAt;
    if (_lastHandledDeepLinkKey == key &&
        lastAt != null &&
        now.difference(lastAt) < const Duration(milliseconds: 750)) {
      return true;
    }

    _lastHandledDeepLinkKey = key;
    _lastHandledDeepLinkAt = now;
    return false;
  }

  void _handleInviteLink(
    RestaurantInviteDeepLink inviteLink, {
    required int generation,
  }) {
    _pushDeepLinkRoute(
      MaterialPageRoute(
        builder: (_) => RestaurantInvitePreviewScreen(
          side: inviteLink.side,
          token: inviteLink.token,
        ),
      ),
      generation: generation,
    );
  }

  void _handleRestaurantLink(
    RestaurantCustomerDeepLink restaurantLink, {
    required int generation,
  }) {
    if (!mounted || generation != _deepLinkGeneration) {
      return;
    }

    final nextMode = restaurantLink.isBiteScore
        ? AppMode.biteScore
        : AppMode.biteSaver;
    if (selectedIndex != 0 || selectedMode != nextMode) {
      setState(() {
        selectedIndex = 0;
        selectedMode = nextMode;
      });
    }
    AppModeStateService.setMode(nextMode);

    _pushDeepLinkRoute(
      MaterialPageRoute(
        settings: RouteSettings(
          name:
              '$_customerDeepLinkRoutePrefix${restaurantLink.side}/${restaurantLink.restaurantId}',
        ),
        builder: (_) => RestaurantCustomerDeepLinkScreen(
          side: restaurantLink.side,
          restaurantId: restaurantLink.restaurantId,
        ),
      ),
      generation: generation,
      replaceCustomerDeepLinks: true,
    );
  }

  void _pushDeepLinkRoute(
    Route<void> route, {
    required int generation,
    bool replaceCustomerDeepLinks = false,
    int attempt = 0,
  }) {
    if (!mounted || generation != _deepLinkGeneration) {
      return;
    }

    final navigator =
        rootNavigatorKey.currentState ??
        Navigator.maybeOf(context, rootNavigator: true);
    if (navigator != null) {
      if (replaceCustomerDeepLinks) {
        navigator.pushAndRemoveUntil(route, (existingRoute) {
          final name = existingRoute.settings.name;
          return name == null || !name.startsWith(_customerDeepLinkRoutePrefix);
        });
      } else {
        navigator.push(route);
      }
      return;
    }

    if (attempt >= 8) {
      return;
    }

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _pushDeepLinkRoute(
        route,
        generation: generation,
        replaceCustomerDeepLinks: replaceCustomerDeepLinks,
        attempt: attempt + 1,
      );
    });
  }

  void _handleSubscriptionReturn(SubscriptionCheckoutReturnStatus status) {
    final message = switch (status) {
      SubscriptionCheckoutReturnStatus.success =>
        'Subscription started successfully. Refreshing restaurant tools...',
      SubscriptionCheckoutReturnStatus.cancel =>
        'Subscription checkout canceled.',
    };

    if (mounted) {
      setState(() {
        selectedIndex = 1;
        selectedMode = AppMode.biteSaver;
      });
    }
    AppModeStateService.setMode(AppMode.biteSaver);
    unawaited(SubscriptionReturnService.dispatchReturn(status));

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }

      if (SubscriptionReturnService.hasActiveRestaurantHub) {
        rootNavigatorKey.currentState?.popUntil(
          (route) =>
              route.isFirst ||
              route.settings.name == RestaurantCreateCouponScreen.routeName,
        );
      } else {
        rootNavigatorKey.currentState?.pushAndRemoveUntil(
          MaterialPageRoute(
            settings: const RouteSettings(
              name: RestaurantCreateCouponScreen.routeName,
            ),
            builder: (_) => const RestaurantCreateCouponScreen(),
          ),
          (route) => route.isFirst,
        );
      }
    });

    rootScaffoldMessengerKey.currentState
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  void _syncSelectedMode() {
    final nextMode = AppModeStateService.selectedMode.value;
    if (selectedMode == nextMode || !mounted) {
      return;
    }
    setState(() {
      selectedMode = nextMode;
      selectedIndex = 0;
    });
  }

  Widget _buildModeHomePage() {
    return selectedMode == AppMode.biteSaver
        ? const HomeScreen(key: ValueKey('bitesaver-home'))
        : const BiteScoreHomeScreen(key: ValueKey('bitescore-home'));
  }

  List<Widget> get pages => [
    _buildModeHomePage(),
    const RestaurantAuthScreen(),
    const AdminGateScreen(),
    const CustomerAccountScreen(),
  ];

  void _setMode(AppMode mode) {
    if (selectedMode == mode) return;
    AppModeStateService.setMode(mode);
  }

  void _selectTab(int index) {
    setState(() {
      selectedIndex = index;
    });
  }

  Widget _buildBiteSaverMenuButton() {
    return PopupMenuButton<int>(
      tooltip: 'Menu',
      onSelected: _selectTab,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      color: const Color(0xFFFFFEFC),
      itemBuilder: (context) => const [
        PopupMenuItem(value: 0, child: Text('Home')),
        PopupMenuItem(value: 2, child: Text('Admin')),
        PopupMenuItem(value: 1, child: Text('Restaurant Hub')),
        PopupMenuItem(value: 3, child: Text('Account')),
      ],
      child: Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
          color: const Color(0xFFFFFBF2),
          borderRadius: BorderRadius.circular(19),
          border: Border.all(color: const Color(0xFFEFE1D1)),
          boxShadow: const [
            BoxShadow(
              color: Color.fromRGBO(64, 42, 22, 0.08),
              blurRadius: 10,
              offset: Offset(0, 5),
            ),
          ],
        ),
        child: const Icon(Icons.menu, color: Color(0xFF24170F), size: 21),
      ),
    );
  }

  Widget _buildCurrentPage() {
    if (selectedIndex != 0) {
      return IndexedStack(index: selectedIndex, children: pages);
    }

    return _buildModeHomePage();
  }

  Widget _buildBottomNavigationBar() {
    final mediaQuery = MediaQuery.of(context);
    final extraBottomInset =
        mediaQuery.viewPadding.bottom > mediaQuery.padding.bottom
        ? mediaQuery.viewPadding.bottom - mediaQuery.padding.bottom
        : 0.0;
    final isBiteScore = selectedMode == AppMode.biteScore;
    final selectedIconColor = isBiteScore
        ? const Color(0xFF285CC3)
        : const Color(0xFF5F8F25);
    final selectedTextColor = isBiteScore
        ? const Color(0xFF244F9E)
        : const Color(0xFF4F7D1F);

    final navigationBar = SizedBox(
      height: AdminContentInsets.bottomNavigationHeight,
      child: Row(
        children: [
          for (final item in [
            (
              label: 'Home',
              icon: Icons.home_outlined,
              selectedIcon: Icons.home,
            ),
            (
              label: 'Restaurant\nHub',
              icon: Icons.storefront_outlined,
              selectedIcon: Icons.storefront,
            ),
            (
              label: 'Admin',
              icon: Icons.admin_panel_settings_outlined,
              selectedIcon: Icons.admin_panel_settings,
            ),
            (
              label: 'Account',
              icon: Icons.person_outline,
              selectedIcon: Icons.person,
            ),
          ].asMap().entries)
            Expanded(
              child: InkWell(
                onTap: () => _selectTab(item.key),
                borderRadius: BorderRadius.circular(13),
                child: Center(
                  child: SizedBox(
                    height: 43,
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        IntrinsicWidth(
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 5,
                              vertical: 1,
                            ),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                SizedBox(
                                  height: 19,
                                  child: Center(
                                    child: Icon(
                                      item.key == selectedIndex
                                          ? item.value.selectedIcon
                                          : item.value.icon,
                                      color: item.key == selectedIndex
                                          ? selectedIconColor
                                          : const Color(0xFF766D61),
                                      size: item.key == selectedIndex
                                          ? 21
                                          : 19.5,
                                    ),
                                  ),
                                ),
                                SizedBox(
                                  height: 22,
                                  child: Center(
                                    child: Text(
                                      item.value.label,
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        color: item.key == selectedIndex
                                            ? selectedTextColor
                                            : const Color(0xFF766D61),
                                        fontWeight: item.key == selectedIndex
                                            ? FontWeight.w700
                                            : FontWeight.w500,
                                        fontSize: 11.3,
                                        letterSpacing: 0,
                                        height: 0.96,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );

    if (!isBiteScore) {
      return SafeArea(
        bottom: true,
        top: false,
        child: Container(
          color: Colors.transparent,
          padding: EdgeInsets.fromLTRB(
            22,
            0,
            22,
            AdminContentInsets.bottomNavigationOuterPadding + extraBottomInset,
          ),
          child: Container(
            decoration: BoxDecoration(
              color: const Color(0xFFFFFEFC),
              borderRadius: BorderRadius.circular(21),
              border: Border.all(color: const Color(0xFFEFE1D1)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.045),
                  blurRadius: 13,
                  offset: const Offset(0, 5),
                ),
              ],
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(21),
              child: navigationBar,
            ),
          ),
        ),
      );
    }

    return SafeArea(
      bottom: true,
      top: false,
      child: Container(
        color: Colors.transparent,
        padding: EdgeInsets.fromLTRB(
          16,
          0,
          16,
          AdminContentInsets.bottomNavigationOuterPadding + extraBottomInset,
        ),
        child: Container(
          decoration: BoxDecoration(
            color: const Color(0xFFF7FAFE),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFFD8E4F3), width: 1),
            boxShadow: [
              BoxShadow(
                color: Color.fromRGBO(36, 76, 134, 0.075),
                blurRadius: 7,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: navigationBar,
          ),
        ),
      ),
    );
  }

  Widget _buildOnboardingOverlay() {
    return Positioned.fill(
      child: Material(
        color: const Color.fromRGBO(31, 26, 22, 0.48),
        child: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Container(
                width: double.infinity,
                constraints: const BoxConstraints(maxWidth: 420),
                padding: const EdgeInsets.fromLTRB(22, 22, 22, 20),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFFCF8),
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: const [
                    BoxShadow(
                      color: Color.fromRGBO(42, 25, 14, 0.18),
                      blurRadius: 24,
                      offset: Offset(0, 12),
                    ),
                  ],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Find dishes worth trying',
                      style: TextStyle(
                        color: Color(0xFF1F1A16),
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        height: 1.12,
                      ),
                    ),
                    const SizedBox(height: 10),
                    const Text(
                      'See highly rated dishes, find local deals, and save places you want to visit.',
                      style: TextStyle(
                        color: Color(0xFF5E564A),
                        fontSize: 14.5,
                        fontWeight: FontWeight.w500,
                        height: 1.35,
                      ),
                    ),
                    const SizedBox(height: 18),
                    const _OnboardingPoint(
                      icon: Icons.search,
                      text: 'Search dishes, restaurants, or cities',
                    ),
                    const _OnboardingPoint(
                      icon: Icons.star_border,
                      text: 'Use BiteScore to find standout dishes',
                    ),
                    const _OnboardingPoint(
                      icon: Icons.local_offer_outlined,
                      text: 'Save deals before you go',
                    ),
                    const SizedBox(height: 20),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: _dismissOnboarding,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFFB7613F),
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(48),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                          textStyle: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        child: const Text('Got it'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Scaffold(
          extendBody: true,
          body: SafeArea(
            bottom: false,
            child: Column(
              children: [
                Container(
                  width: double.infinity,
                  color: selectedMode == AppMode.biteScore
                      ? const Color(0xFFEFF4FA)
                      : const Color(0xFFFFFEFC),
                  child: Row(
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(left: 16, right: 4),
                        child: _buildBiteSaverMenuButton(),
                      ),
                      Expanded(
                        child: AppModeSwitcherBar(
                          selectedMode: selectedMode,
                          onModeSelected: _setMode,
                        ),
                      ),
                    ],
                  ),
                ),
                Expanded(child: _buildCurrentPage()),
              ],
            ),
          ),
          bottomNavigationBar: _buildBottomNavigationBar(),
        ),
        if (_showOnboarding) _buildOnboardingOverlay(),
      ],
    );
  }
}

class _OnboardingPoint extends StatelessWidget {
  final IconData icon;
  final String text;

  const _OnboardingPoint({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: const Color(0x1AB7613F),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Icon(icon, size: 16, color: const Color(0xFFB7613F)),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                color: Color(0xFF2B1D14),
                fontSize: 14,
                fontWeight: FontWeight.w600,
                height: 1.2,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
