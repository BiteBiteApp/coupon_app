import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';

import '../services/app_mode_state_service.dart';
import '../widgets/app_mode_switcher_bar.dart';
import 'admin_gate_screen.dart';
import 'bitescore_home_screen.dart';
import 'customer_account_screen.dart';
import 'home_screen.dart';
import 'restaurant_auth_screen.dart';

final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<ScaffoldMessengerState> rootScaffoldMessengerKey =
    GlobalKey<ScaffoldMessengerState>();

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
  late int selectedIndex;
  late AppMode selectedMode;
  final AppLinks _appLinks = AppLinks();
  StreamSubscription<Uri>? _subscriptionReturnSubscription;

  @override
  void initState() {
    super.initState();
    selectedIndex = widget.initialIndex;
    selectedMode = widget.initialMode;
    AppModeStateService.setMode(widget.initialMode);
    AppModeStateService.selectedMode.addListener(_syncSelectedMode);
    _listenForSubscriptionReturnLinks();
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

  void _handleIncomingDeepLink(Uri? uri) {
    if (uri == null) {
      return;
    }

    if (uri.scheme == 'bitesaver' && uri.host == 'subscription-success') {
      _openMainScreenWithMessage(
        message: 'Subscription active',
        mode: AppMode.biteSaver,
      );
      return;
    }

    if (uri.scheme != 'couponapp' || uri.host != 'subscription-return') {
      return;
    }

    final status = uri.queryParameters['status']?.trim().toLowerCase();
    String? message;
    if (status == 'success') {
      message = 'Subscription started successfully';
    } else if (status == 'cancel') {
      message = 'Subscription checkout canceled';
    }

    if (message == null) {
      return;
    }

    _openMainScreenWithMessage(
      message: message,
      mode: AppMode.biteSaver,
    );
  }

  void _openMainScreenWithMessage({
    required String message,
    required AppMode mode,
  }) {
    if (mounted) {
      setState(() {
        selectedIndex = 0;
        selectedMode = mode;
      });
    }
    AppModeStateService.setMode(mode);
    rootScaffoldMessengerKey.currentState
      ?..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
        ),
      );
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

  List<Widget> get pages => [
        selectedMode == AppMode.biteSaver
            ? const HomeScreen()
            : const BiteScoreHomeScreen(),
        const RestaurantAuthScreen(),
        const AdminGateScreen(),
        const CustomerAccountScreen(),
      ];

  void _setMode(AppMode mode) {
    if (selectedMode == mode) return;
    AppModeStateService.setMode(mode);
  }

  Widget _buildCurrentPage() {
    if (selectedIndex != 0) {
      return IndexedStack(
        index: selectedIndex,
        children: pages,
      );
    }

    final slideFromRight = selectedMode == AppMode.biteScore;
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 220),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      transitionBuilder: (child, animation) {
        final beginOffset = Offset(slideFromRight ? 0.12 : -0.12, 0);
        final offsetAnimation = Tween<Offset>(
          begin: beginOffset,
          end: Offset.zero,
        ).animate(animation);

        return ClipRect(
          child: SlideTransition(
            position: offsetAnimation,
            child: FadeTransition(
              opacity: animation,
              child: child,
            ),
          ),
        );
      },
      child: KeyedSubtree(
        key: ValueKey<AppMode>(selectedMode),
        child: pages.first,
      ),
    );
  }

  Widget _buildBottomNavigationBar() {
    final isBiteScore = selectedMode == AppMode.biteScore;
    final selectedPillColor = isBiteScore
        ? const Color(0xFFEAF2FF)
        : const Color(0xFFF6E7CF);
    final selectedBorderColor = isBiteScore
        ? const Color(0xFFD6E4F8)
        : const Color(0xD1FFFFFF);
    final selectedShadowColor = isBiteScore
        ? const Color.fromRGBO(36, 76, 140, 0.12)
        : const Color.fromRGBO(0, 0, 0, 0.08);
    final selectedIconColor = isBiteScore
        ? const Color(0xFF285CC3)
        : const Color(0xFF1E4CAA);
    final selectedTextColor = isBiteScore
        ? const Color(0xFF244F9E)
        : const Color(0xFF1A469F);

    final navigationBar = SizedBox(
      height: 66,
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
                onTap: () {
                  setState(() {
                    selectedIndex = item.key;
                  });
                },
                borderRadius: BorderRadius.circular(16),
                child: Center(
                  child: SizedBox(
                    height: item.key == selectedIndex ? 60 : 54,
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        IntrinsicWidth(
                          child: Container(
                            padding: item.key == selectedIndex
                                ? const EdgeInsets.symmetric(
                                    horizontal: 16,
                                    vertical: 3,
                                  )
                                : EdgeInsets.zero,
                            decoration: item.key == selectedIndex
                                ? BoxDecoration(
                                    color: selectedPillColor,
                                    borderRadius: BorderRadius.circular(16),
                                    border: Border.all(
                                      color: selectedBorderColor,
                                      width: 1.0,
                                    ),
                                    boxShadow: [
                                      BoxShadow(
                                        color: selectedShadowColor,
                                        blurRadius: 4,
                                        offset: const Offset(0, 2),
                                      ),
                                    ],
                                  )
                                : null,
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                SizedBox(
                                  height: 24,
                                  child: Center(
                                    child: Icon(
                                      item.key == selectedIndex
                                          ? item.value.selectedIcon
                                          : item.value.icon,
                                      color: item.key == selectedIndex
                                          ? selectedIconColor
                                          : const Color(0xFF645A4C),
                                      size: 24,
                                    ),
                                  ),
                                ),
                                SizedBox(
                                  height: 28,
                                  child: Center(
                                    child: Text(
                                      item.value.label,
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        color: item.key == selectedIndex
                                            ? selectedTextColor
                                            : const Color(0xFF5E564A),
                                        fontWeight: item.key == selectedIndex
                                            ? FontWeight.w800
                                            : FontWeight.w600,
                                        fontSize: 13.5,
                                        letterSpacing: -0.1,
                                        height: 1.0,
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
      return Container(
        color: Colors.transparent,
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
        child: Container(
          decoration: BoxDecoration(
            color: const Color(0xFFF6E7CF),
            borderRadius: BorderRadius.circular(28),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.10),
                blurRadius: 6,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(28),
            child: navigationBar,
          ),
        ),
      );
    }

    return Container(
      color: Colors.transparent,
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
      child: Container(
        decoration: BoxDecoration(
          color: const Color(0xFFF7FAFE),
          borderRadius: BorderRadius.circular(28),
          border: Border.all(color: const Color(0xFFD8E4F3), width: 1),
          boxShadow: [
            BoxShadow(
              color: Color.fromRGBO(36, 76, 134, 0.13),
              blurRadius: 10,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(28),
          child: navigationBar,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBody: true,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            AppModeSwitcherBar(
              selectedMode: selectedMode,
              onModeSelected: _setMode,
            ),
            Expanded(
              child: _buildCurrentPage(),
            ),
          ],
        ),
      ),
      bottomNavigationBar: _buildBottomNavigationBar(),
    );
  }
}
