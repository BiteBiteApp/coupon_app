import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';

import '../services/app_mode_state_service.dart';
import '../widgets/app_mode_switcher_bar.dart';
import '../widgets/biterater_theme.dart';
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
                        Container(
                          padding: item.key == selectedIndex
                              ? const EdgeInsets.symmetric(
                                  horizontal: 22,
                                  vertical: 4,
                                )
                              : EdgeInsets.zero,
                          decoration: item.key == selectedIndex
                              ? BoxDecoration(
                                  color: const Color(0xFFE7E4FB),
                                  borderRadius: BorderRadius.circular(16),
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
                                        ? const Color(0xFF2458D6)
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
                                          ? const Color(0xFF184FCC)
                                          : const Color(0xFF5E564A),
                                      fontWeight: item.key == selectedIndex
                                          ? FontWeight.w700
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
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );

    if (selectedMode != AppMode.biteScore) {
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

    return Theme(
      data: Theme.of(context).copyWith(
        navigationBarTheme: NavigationBarThemeData(
          backgroundColor: BiteRaterTheme.cardSurface,
          surfaceTintColor: Colors.transparent,
          indicatorColor: BiteRaterTheme.softSearchBlue,
          elevation: 0,
          labelTextStyle: WidgetStateProperty.resolveWith((states) {
            return TextStyle(
              color: states.contains(WidgetState.selected)
                  ? BiteRaterTheme.ink
                  : BiteRaterTheme.mutedInk,
              fontWeight: states.contains(WidgetState.selected)
                  ? FontWeight.w800
                  : FontWeight.w600,
            );
          }),
          iconTheme: WidgetStateProperty.resolveWith((states) {
            return IconThemeData(
              color: states.contains(WidgetState.selected)
                  ? BiteRaterTheme.ocean
                  : BiteRaterTheme.mutedInk,
            );
          }),
        ),
      ),
      child: navigationBar,
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
