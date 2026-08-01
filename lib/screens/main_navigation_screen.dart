import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/app_mode_state_service.dart';
import '../services/restaurant_customer_link_service.dart';
import '../services/restaurant_invite_service.dart';
import '../services/subscription_return_service.dart';
import '../widgets/app_mode_switcher_bar.dart';
import '../widgets/admin_content_insets.dart';
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

typedef MainNavigationItem = ({
  String label,
  IconData icon,
  IconData selectedIcon,
});

const List<MainNavigationItem> mainNavigationItems = <MainNavigationItem>[
  (label: 'Home', icon: Icons.home_outlined, selectedIcon: Icons.home),
  (
    label: 'Restaurant\nHub',
    icon: Icons.storefront_outlined,
    selectedIcon: Icons.storefront,
  ),
  (label: 'Account', icon: Icons.person_outline, selectedIcon: Icons.person),
];

int normalizeMainNavigationIndex(int index) {
  return index >= 0 && index < mainNavigationItems.length ? index : 0;
}

class MainNavigationScreen extends StatefulWidget {
  final AppMode initialMode;
  final int initialIndex;
  final RestaurantCustomerDeepLink? initialCustomerDeepLink;
  final RestaurantInviteDeepLink? initialInviteDeepLink;
  final List<Widget> Function(AppMode mode)? testPagesBuilder;
  final bool initializePlatformServices;
  final Stream<Uri>? testIncomingDeepLinks;
  final Stream<String>? testIncomingRawDeepLinks;
  final ValueChanged<SubscriptionReturnEvent>?
  testOnSubscriptionReturnNavigationClaimed;
  final ValueChanged<String>? testOnSubscriptionReturnMessageEmitted;
  final bool testSuppressSubscriptionReturnSnackBar;
  final bool? testRestaurantUserSignedIn;
  final SubscriptionReturnOwnerScope? Function()?
  testSubscriptionReturnOwnerScopeProvider;
  final Stream<SubscriptionReturnOwnerScope?>?
  testSubscriptionReturnOwnerScopeChanges;
  final WidgetBuilder? testAuthenticatedRestaurantHubBuilder;

  const MainNavigationScreen({
    super.key,
    this.initialMode = AppMode.biteSaver,
    this.initialIndex = 0,
    this.initialCustomerDeepLink,
    this.initialInviteDeepLink,
    @visibleForTesting this.testPagesBuilder,
    @visibleForTesting this.initializePlatformServices = true,
    @visibleForTesting this.testIncomingDeepLinks,
    @visibleForTesting this.testIncomingRawDeepLinks,
    @visibleForTesting this.testOnSubscriptionReturnNavigationClaimed,
    @visibleForTesting this.testOnSubscriptionReturnMessageEmitted,
    @visibleForTesting this.testSuppressSubscriptionReturnSnackBar = false,
    @visibleForTesting this.testRestaurantUserSignedIn,
    @visibleForTesting this.testSubscriptionReturnOwnerScopeProvider,
    @visibleForTesting this.testSubscriptionReturnOwnerScopeChanges,
    @visibleForTesting this.testAuthenticatedRestaurantHubBuilder,
  });

  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  static const String _onboardingSeenKey = 'first_time_onboarding_seen';

  late int selectedIndex;
  late AppMode selectedMode;
  StreamSubscription<Uri>? _appLinkSubscription;
  StreamSubscription<void>? _subscriptionReturnSubscription;
  StreamSubscription<Object?>? _subscriptionReturnOwnerSubscription;
  bool _subscriptionReturnNavigationDrainQueued = false;
  int _subscriptionReturnNavigationRequestGeneration = 0;
  SubscriptionReturnOwnerScope? _subscriptionReturnMessageOwnerScope;
  int _subscriptionReturnMessageGeneration = 0;
  bool _showOnboarding = false;
  int _deepLinkGeneration = 0;
  String? _lastHandledDeepLinkKey;
  DateTime? _lastHandledDeepLinkAt;

  @override
  void initState() {
    super.initState();
    final initialCustomerDeepLink = widget.initialCustomerDeepLink;
    final initialInviteDeepLink = widget.initialInviteDeepLink;
    final initialInviteIsBiteScore = initialInviteDeepLink?.side == 'bitescore';
    selectedIndex =
        initialCustomerDeepLink == null && initialInviteDeepLink == null
        ? normalizeMainNavigationIndex(widget.initialIndex)
        : 0;
    selectedMode =
        initialCustomerDeepLink?.isBiteScore == true || initialInviteIsBiteScore
        ? AppMode.biteScore
        : widget.initialMode;
    AppModeStateService.setMode(selectedMode);
    AppModeStateService.selectedMode.addListener(_syncSelectedMode);
    if (widget.initializePlatformServices ||
        widget.testIncomingDeepLinks != null ||
        widget.testIncomingRawDeepLinks != null) {
      _listenForAppLinks();
    }
    if (initialCustomerDeepLink != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final generation = ++_deepLinkGeneration;
        _handleRestaurantLink(initialCustomerDeepLink, generation: generation);
      });
    } else if (initialInviteDeepLink != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final generation = ++_deepLinkGeneration;
        _handleInviteLink(initialInviteDeepLink, generation: generation);
      });
    }
    if (widget.initializePlatformServices) {
      unawaited(_loadOnboardingState());
    }
  }

  @override
  void dispose() {
    AppModeStateService.selectedMode.removeListener(_syncSelectedMode);
    _appLinkSubscription?.cancel();
    _subscriptionReturnSubscription?.cancel();
    _subscriptionReturnOwnerSubscription?.cancel();
    super.dispose();
  }

  void _listenForAppLinks() {
    _appLinkSubscription = SubscriptionReturnService.appLinks.listen(
      _handleIncomingDeepLink,
      onError: (_) {},
    );
    _subscriptionReturnSubscription = SubscriptionReturnService.changes.listen(
      (_) => _schedulePendingSubscriptionReturnNavigation(),
      onError: (_) {},
    );
    final ownerScopeChanges = widget.testSubscriptionReturnOwnerScopeChanges;
    if (ownerScopeChanges != null) {
      _subscriptionReturnOwnerSubscription = ownerScopeChanges.listen(
        (_) => _handleSubscriptionReturnOwnerChanged(),
        onError: (_) {},
      );
    } else if (widget.initializePlatformServices) {
      _subscriptionReturnOwnerSubscription = FirebaseAuth.instance
          .userChanges()
          .listen(
            (_) => _handleSubscriptionReturnOwnerChanged(),
            onError: (_) {},
          );
    }
    SubscriptionReturnService.startAppLinkIngestion(
      links: widget.testIncomingDeepLinks,
      rawLinks: widget.testIncomingRawDeepLinks,
    );
    _schedulePendingSubscriptionReturnNavigation();
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

    // Subscription returns are normalized once by the app-wide coordinator.
    // Individual navigation shells must never create their own logical event.
    if (parseSubscriptionReturnUri(uri) != null) {
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

    if (uri.scheme == 'couponapp' && uri.host == 'open') {
      return;
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

  void _schedulePendingSubscriptionReturnNavigation() {
    _subscriptionReturnNavigationRequestGeneration += 1;
    _startPendingSubscriptionReturnNavigationDrainIfNeeded();
  }

  void _startPendingSubscriptionReturnNavigationDrainIfNeeded() {
    if (_subscriptionReturnNavigationDrainQueued) {
      return;
    }
    _subscriptionReturnNavigationDrainQueued = true;
    unawaited(_drainPendingSubscriptionReturnNavigation());
  }

  Future<void> _drainPendingSubscriptionReturnNavigation() async {
    var handledRequestGeneration =
        _subscriptionReturnNavigationRequestGeneration;
    try {
      final ownerScope = _currentSubscriptionReturnOwnerScope;
      if (ownerScope == null) {
        if (await SubscriptionReturnService.hasPendingLocalDelivery() &&
            mounted &&
            _currentSubscriptionReturnOwnerScope == null) {
          _handleSignedOutSubscriptionReturn();
        }
        return;
      }

      while (mounted && ownerScope == _currentSubscriptionReturnOwnerScope) {
        final event = await SubscriptionReturnService.peekPendingNavigationFor(
          ownerScope,
          isCurrent: () =>
              mounted && ownerScope == _currentSubscriptionReturnOwnerScope,
        );
        if (!mounted || ownerScope != _currentSubscriptionReturnOwnerScope) {
          return;
        }
        // Listing a previously unseen server event emits a synchronous change
        // notification. Absorb that notification before the claim so a
        // permanent claim failure cannot cause this drain to retry itself.
        // A genuinely new notification arriving while the claim is blocked
        // advances the generation again and is handled by one later drain.
        handledRequestGeneration =
            _subscriptionReturnNavigationRequestGeneration;
        if (event == null ||
            !await SubscriptionReturnService.claimNavigationFor(
              event.id,
              ownerScope,
              isCurrent: () =>
                  mounted && ownerScope == _currentSubscriptionReturnOwnerScope,
            )) {
          return;
        }
        if (!mounted || ownerScope != _currentSubscriptionReturnOwnerScope) {
          return;
        }
        widget.testOnSubscriptionReturnNavigationClaimed?.call(event);
        if (!mounted || ownerScope != _currentSubscriptionReturnOwnerScope) {
          return;
        }
        _handleSubscriptionReturn(event);
      }
    } finally {
      _subscriptionReturnNavigationDrainQueued = false;
      if (mounted &&
          _subscriptionReturnNavigationRequestGeneration >
              handledRequestGeneration) {
        _startPendingSubscriptionReturnNavigationDrainIfNeeded();
      }
    }
  }

  void _handleSubscriptionReturnOwnerChanged() {
    final messageOwnerScope = _subscriptionReturnMessageOwnerScope;
    if (messageOwnerScope != null &&
        messageOwnerScope != _currentSubscriptionReturnOwnerScope) {
      _subscriptionReturnMessageOwnerScope = null;
      _subscriptionReturnMessageGeneration += 1;
      rootScaffoldMessengerKey.currentState?.hideCurrentSnackBar();
    }
    _schedulePendingSubscriptionReturnNavigation();
  }

  void _handleSignedOutSubscriptionReturn() {
    if (!mounted || _currentSubscriptionReturnOwnerScope != null) {
      return;
    }
    setState(() {
      selectedIndex = 1;
      selectedMode = AppMode.biteSaver;
    });
    AppModeStateService.setMode(AppMode.biteSaver);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        rootNavigatorKey.currentState?.popUntil((route) => route.isFirst);
      }
    });
  }

  void _handleSubscriptionReturn(SubscriptionReturnEvent event) {
    if (!mounted || event.ownerScope != _currentSubscriptionReturnOwnerScope) {
      return;
    }
    final message = switch (event.kind) {
      SubscriptionReturnKind.checkoutSuccess =>
        'Subscription started successfully. Refreshing restaurant tools...',
      SubscriptionReturnKind.checkoutCancel =>
        'Subscription checkout canceled.',
      SubscriptionReturnKind.customerPortal =>
        'Returned from subscription management. Refreshing your subscription status.',
    };

    if (mounted) {
      setState(() {
        selectedIndex = 1;
        selectedMode = AppMode.biteSaver;
      });
    }
    AppModeStateService.setMode(AppMode.biteSaver);

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted ||
          event.ownerScope != _currentSubscriptionReturnOwnerScope) {
        return;
      }

      final navigator = rootNavigatorKey.currentState;
      if (!_hasSignedInRestaurantUser) {
        navigator?.popUntil((route) => route.isFirst);
      } else if (SubscriptionReturnService.hasActiveRestaurantHub) {
        navigator?.popUntil(
          (route) =>
              route.isFirst ||
              route.settings.name == RestaurantCreateCouponScreen.routeName,
        );
      } else if (event.kind == SubscriptionReturnKind.customerPortal) {
        navigator?.popUntil((route) => route.isFirst);
      } else {
        navigator?.pushAndRemoveUntil(
          MaterialPageRoute(
            settings: const RouteSettings(
              name: RestaurantCreateCouponScreen.routeName,
            ),
            builder:
                widget.testAuthenticatedRestaurantHubBuilder ??
                (_) => const RestaurantCreateCouponScreen(),
          ),
          (route) => route.isFirst,
        );
      }
    });

    widget.testOnSubscriptionReturnMessageEmitted?.call(message);
    if (widget.testSuppressSubscriptionReturnSnackBar) {
      return;
    }
    final messenger = rootScaffoldMessengerKey.currentState;
    if (messenger == null) {
      return;
    }
    messenger.hideCurrentSnackBar();
    _subscriptionReturnMessageOwnerScope = event.ownerScope;
    final messageGeneration = ++_subscriptionReturnMessageGeneration;
    final controller = messenger.showSnackBar(SnackBar(content: Text(message)));
    unawaited(
      controller.closed.then((_) {
        if (messageGeneration == _subscriptionReturnMessageGeneration) {
          _subscriptionReturnMessageOwnerScope = null;
        }
      }),
    );
  }

  bool get _hasSignedInRestaurantUser {
    return _currentSubscriptionReturnOwnerScope != null;
  }

  SubscriptionReturnOwnerScope? get _currentSubscriptionReturnOwnerScope {
    final testProvider = widget.testSubscriptionReturnOwnerScopeProvider;
    if (testProvider != null) {
      return testProvider();
    }
    final testSignedIn = widget.testRestaurantUserSignedIn;
    if (testSignedIn != null) {
      return testSignedIn
          ? const SubscriptionReturnOwnerScope(
              uid: 'test-restaurant-owner',
              accountDocumentId: 'test-restaurant-owner',
            )
          : null;
    }

    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null || user.isAnonymous) {
        return null;
      }
      final uid = user.uid.trim();
      if (uid.isEmpty) {
        return null;
      }
      return SubscriptionReturnOwnerScope(uid: uid, accountDocumentId: uid);
    } catch (_) {
      return null;
    }
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

  List<Widget> get pages {
    final testPages = widget.testPagesBuilder?.call(selectedMode);
    if (testPages != null) {
      assert(testPages.length == mainNavigationItems.length);
      return testPages;
    }

    return [
      _buildModeHomePage(),
      const RestaurantAuthScreen(),
      const CustomerAccountScreen(),
    ];
  }

  void _setMode(AppMode mode) {
    if (selectedMode == mode) return;
    AppModeStateService.setMode(mode);
  }

  void _selectTab(int index) {
    setState(() {
      selectedIndex = normalizeMainNavigationIndex(index);
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
        PopupMenuItem(value: 1, child: Text('Restaurant Hub')),
        PopupMenuItem(value: 2, child: Text('Account')),
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
    final currentPages = pages;
    if (selectedIndex != 0) {
      return IndexedStack(index: selectedIndex, children: currentPages);
    }

    return widget.testPagesBuilder == null
        ? _buildModeHomePage()
        : currentPages.first;
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
          for (final item in mainNavigationItems.asMap().entries)
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
                                  child: FittedBox(
                                    fit: BoxFit.scaleDown,
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
