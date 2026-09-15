import 'package:coupon_app/firebase_options.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/screens/restaurant_customer_deep_link_screen.dart';
import 'package:coupon_app/screens/restaurant_invite_preview_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/customer_session_service.dart';
import 'package:coupon_app/services/restaurant_customer_link_service.dart';
import 'package:coupon_app/services/restaurant_invite_service.dart';
import 'package:coupon_app/services/user_profile_service.dart';
import 'package:coupon_app/widgets/contribution_points_celebration_host.dart';
import 'package:coupon_app/widgets/local_expert_badge_celebration_host.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  await ensureUserSignedIn();

  runApp(const CouponApp());
}

Future<void> ensureUserSignedIn() async {
  final user = await CustomerSessionService.ensureAuthReady();
  if (user == null) {
    return;
  }

  try {
    await UserProfileService.upsertSignedInUserProfile(user);
  } catch (_) {}
}

class CouponApp extends StatelessWidget {
  final Widget Function(
    RestaurantCustomerDeepLink? customerLink,
    RestaurantInviteDeepLink? inviteLink,
  )?
  testNavigationBuilder;
  final Widget Function(RestaurantCustomerDeepLink link)?
  testCustomerRouteBuilder;
  final Widget Function(RestaurantInviteDeepLink link)? testInviteRouteBuilder;
  final bool testWrapCelebrationHosts;

  const CouponApp({
    super.key,
    @visibleForTesting this.testNavigationBuilder,
    @visibleForTesting this.testCustomerRouteBuilder,
    @visibleForTesting this.testInviteRouteBuilder,
    @visibleForTesting this.testWrapCelebrationHosts = true,
  });

  Widget _buildNavigationShell({
    RestaurantCustomerDeepLink? customerLink,
    RestaurantInviteDeepLink? inviteLink,
    String? initialDeepLinkRouteName,
  }) {
    final testBuilder = testNavigationBuilder;
    if (testBuilder != null) {
      return testBuilder(customerLink, inviteLink);
    }
    return MainNavigationScreen(
      initialCustomerDeepLink: customerLink,
      initialInviteDeepLink: inviteLink,
      initialDeepLinkRouteName: initialDeepLinkRouteName,
    );
  }

  Route<dynamic>? _onGenerateRoute(RouteSettings settings) {
    if (settings.name == Navigator.defaultRouteName) {
      return PageRouteBuilder<void>(
        settings: settings,
        transitionDuration: Duration.zero,
        reverseTransitionDuration: Duration.zero,
        pageBuilder: (_, _, _) => const _RetainedHomeRoute(),
      );
    }

    final inviteLink = RestaurantInviteService.parseInviteRouteName(
      settings.name,
    );
    if (inviteLink != null) {
      return MaterialPageRoute(
        settings: settings,
        builder: (_) =>
            testInviteRouteBuilder?.call(inviteLink) ??
            RestaurantInvitePreviewScreen(
              side: inviteLink.side,
              token: inviteLink.token,
            ),
      );
    }

    final restaurantLink =
        RestaurantCustomerLinkService.parseRestaurantRouteName(settings.name);
    if (restaurantLink != null) {
      return MaterialPageRoute(
        settings: settings,
        builder: (_) => _FrameworkRuntimeCustomerRouteScope(
          link: restaurantLink,
          child:
              testCustomerRouteBuilder?.call(restaurantLink) ??
              RestaurantCustomerDeepLinkScreen(
                side: restaurantLink.side,
                restaurantId: restaurantLink.restaurantId,
              ),
        ),
      );
    }

    return null;
  }

  List<Route<dynamic>> _onGenerateInitialRoutes(String initialRoute) {
    final inviteLink = RestaurantInviteService.parseInviteRouteName(
      initialRoute,
    );
    final restaurantLink =
        RestaurantCustomerLinkService.parseRestaurantRouteName(initialRoute);
    if (inviteLink != null || restaurantLink != null) {
      return <Route<dynamic>>[
        MaterialPageRoute(
          settings: const RouteSettings(name: Navigator.defaultRouteName),
          builder: (_) => _buildNavigationShell(
            customerLink: restaurantLink,
            inviteLink: inviteLink,
            initialDeepLinkRouteName: initialRoute,
          ),
        ),
      ];
    }
    return <Route<dynamic>>[
      MaterialPageRoute(
        settings: const RouteSettings(name: Navigator.defaultRouteName),
        builder: (_) => _buildNavigationShell(),
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    const colorScheme = ColorScheme(
      brightness: Brightness.light,
      primary: Color(0xFF111111),
      onPrimary: Colors.white,
      secondary: Color(0xFF2A2A2A),
      onSecondary: Colors.white,
      error: Color(0xFFB3261E),
      onError: Colors.white,
      surface: Color(0xFFF5F5F3),
      onSurface: Color(0xFF111111),
      onSurfaceVariant: Color(0xFF4B4B47),
      outline: Color(0xFF8E8E88),
      outlineVariant: Color(0xFFD7D7D1),
      shadow: Color(0x1F000000),
      scrim: Color(0x52000000),
      inverseSurface: Color(0xFF1A1A18),
      onInverseSurface: Color(0xFFF3F3EF),
      inversePrimary: Color(0xFFE3E3DD),
      surfaceTint: Color(0xFF1C1C1A),
    );

    return MaterialApp(
      title: 'BiteStar',
      debugShowCheckedModeBanner: false,
      navigatorKey: rootNavigatorKey,
      scaffoldMessengerKey: rootScaffoldMessengerKey,
      onGenerateRoute: _onGenerateRoute,
      onGenerateInitialRoutes: _onGenerateInitialRoutes,
      builder: (context, child) {
        if (!testWrapCelebrationHosts) {
          return child ?? const SizedBox.shrink();
        }
        return LocalExpertBadgeCelebrationHost(
          child: ContributionPointsCelebrationHost(
            child: child ?? const SizedBox.shrink(),
          ),
        );
      },
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: colorScheme,
        scaffoldBackgroundColor: const Color(0xFFEDEDE8),
        canvasColor: const Color(0xFFEDEDE8),
        dividerColor: colorScheme.outlineVariant,
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFFF5F5F3),
          foregroundColor: Color(0xFF111111),
          elevation: 0,
          surfaceTintColor: Colors.transparent,
          centerTitle: true,
        ),
        cardTheme: CardThemeData(
          color: const Color(0xFFFCFCFA),
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          margin: EdgeInsets.zero,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: const BorderSide(color: Color(0xFFD7D7D1)),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: const Color(0xFFF8F8F5),
          labelStyle: const TextStyle(color: Color(0xFF4B4B47)),
          hintStyle: const TextStyle(color: Color(0xFF7C7C76)),
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 14,
            vertical: 14,
          ),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFD7D7D1)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFD7D7D1)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFF111111), width: 1.2),
          ),
        ),
        navigationBarTheme: NavigationBarThemeData(
          backgroundColor: const Color(0xFFF5F5F3),
          surfaceTintColor: Colors.transparent,
          indicatorColor: const Color(0xFFE3E7FF),
          elevation: 0,
          labelTextStyle: WidgetStateProperty.resolveWith((states) {
            return TextStyle(
              color: states.contains(WidgetState.selected)
                  ? const Color(0xFF111111)
                  : const Color(0xFF6E6E68),
              fontWeight: states.contains(WidgetState.selected)
                  ? FontWeight.w700
                  : FontWeight.w600,
            );
          }),
          iconTheme: WidgetStateProperty.resolveWith((states) {
            return IconThemeData(
              color: states.contains(WidgetState.selected)
                  ? const Color(0xFF2F5BFF)
                  : const Color(0xFF6E6E68),
            );
          }),
        ),
        dividerTheme: const DividerThemeData(
          color: Color(0xFFD7D7D1),
          thickness: 1,
          space: 1,
        ),
      ),
    );
  }
}

class _FrameworkRuntimeCustomerRouteScope extends StatefulWidget {
  final RestaurantCustomerDeepLink link;
  final Widget child;

  const _FrameworkRuntimeCustomerRouteScope({
    required this.link,
    required this.child,
  });

  @override
  State<_FrameworkRuntimeCustomerRouteScope> createState() =>
      _FrameworkRuntimeCustomerRouteScopeState();
}

class _FrameworkRuntimeCustomerRouteScopeState
    extends State<_FrameworkRuntimeCustomerRouteScope> {
  ModalRoute<dynamic>? _scheduledRoute;
  MainNavigationRouteReturnDelivery? _returnDelivery;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    final navigator = Navigator.maybeOf(context, rootNavigator: true);
    if (route == null ||
        navigator == null ||
        identical(route, _scheduledRoute)) {
      return;
    }
    _scheduledRoute = route;
    _returnDelivery = mainNavigationController.captureRouteReturnDelivery(
      navigator: navigator,
      mode: widget.link.isBiteScore ? AppMode.biteScore : AppMode.biteSaver,
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted ||
          !identical(ModalRoute.of(context), route) ||
          !route.isCurrent) {
        return;
      }
      mainNavigationController.selectExistingShellDestination(
        navigator: navigator,
        mode: widget.link.isBiteScore ? AppMode.biteScore : AppMode.biteSaver,
        index: 0,
      );
    });
  }

  @override
  void dispose() {
    final returnDelivery = _returnDelivery;
    if (returnDelivery != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        returnDelivery.complete(routeReportedChange: false);
      });
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

class _RetainedHomeRoute extends StatefulWidget {
  const _RetainedHomeRoute();

  @override
  State<_RetainedHomeRoute> createState() => _RetainedHomeRouteState();
}

class _RetainedHomeRouteState extends State<_RetainedHomeRoute> {
  bool _redirectQueued = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_redirectQueued) {
      return;
    }
    _redirectQueued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      openMainNavigationDestination(
        context,
        mode: AppModeStateService.selectedMode.value,
        index: 0,
      );
    });
  }

  @override
  Widget build(BuildContext context) => const SizedBox.expand();
}
