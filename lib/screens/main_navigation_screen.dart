import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/demo_redemption_store.dart';
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

String _publicCustomerRouteName(RestaurantCustomerDeepLink link) {
  return Uri(
    pathSegments: <String>['', 'r', link.side, link.restaurantId],
  ).toString();
}

String _publicInviteRouteName(RestaurantInviteDeepLink link) {
  return Uri(
    pathSegments: <String>['', 'invite', link.side, link.token],
  ).toString();
}

final MainNavigationController mainNavigationController =
    MainNavigationController();

String mainNavigationAuthRealmForUser(User? user) {
  if (user == null || user.isAnonymous) {
    return 'guest';
  }
  return 'signed:${user.uid}';
}

typedef MainNavigationAuthRealmReplaced =
    void Function(String previousRealm, String nextRealm);
typedef MainNavigationSameAuthRealmNotified = void Function();
typedef BiteSaverBrowseHomeBuilder =
    Widget Function(
      BuildContext context,
      int navigationRefreshGeneration,
      String authRealm,
    );
typedef BiteSaverSavedAccountBuilder =
    Widget Function(BuildContext context, String authRealm);

class MainNavigationController {
  // Keep the existing paired customer composition when a route reconstructs
  // the shell. Cutover is one-way for this controller's lifetime; a later shell
  // omitting the builders must not silently restore legacy coupon writers.
  BiteSaverBrowseHomeBuilder? _biteSaverBrowseHomeBuilder;
  BiteSaverSavedAccountBuilder? _biteSaverSavedAccountBuilder;

  void _retainBiteSaverCustomerPath({
    required BiteSaverBrowseHomeBuilder browse,
    required BiteSaverSavedAccountBuilder saved,
  }) {
    _biteSaverBrowseHomeBuilder = browse;
    _biteSaverSavedAccountBuilder = saved;
    // Standalone public routes and owner flows use the root controller.
    mainNavigationController._biteSaverBrowseHomeBuilder = browse;
    mainNavigationController._biteSaverSavedAccountBuilder = saved;
    DemoRedemptionStore.retireLegacyWritersForBoundedCutover();
  }

  @visibleForTesting
  void resetBiteSaverCustomerPathForTesting() {
    _biteSaverBrowseHomeBuilder = null;
    _biteSaverSavedAccountBuilder = null;
  }

  final List<_MainNavigationRegistration> _registrations =
      <_MainNavigationRegistration>[];
  final Map<NavigatorState, _MainNavigationRootContext> _rootContexts =
      <NavigatorState, _MainNavigationRootContext>{};
  final List<_MainNavigationAuthRouteRegistration> _authRouteRegistrations =
      <_MainNavigationAuthRouteRegistration>[];
  final Map<Object, _MainNavigationHomeRefreshIntent> _homeRefreshIntents =
      <Object, _MainNavigationHomeRefreshIntent>{};
  final Set<NavigatorState> _destinationSelections = <NavigatorState>{};

  Object attach({
    required NavigatorState navigator,
    required ModalRoute<dynamic> route,
    required bool Function(
      AppMode mode,
      int index,
      Set<AppMode> refreshHomeModes,
    )
    selectDestination,
    required bool Function(Set<AppMode> refreshHomeModes) refreshHomes,
    required String authRealm,
  }) {
    final token = Object();
    final rootContext = _rootContexts.putIfAbsent(
      navigator,
      () => _MainNavigationRootContext(authRealm: authRealm),
    );
    _registrations.add(
      _MainNavigationRegistration(
        token: token,
        navigator: navigator,
        route: route,
        rootContext: rootContext,
        selectDestination: selectDestination,
        refreshHomes: refreshHomes,
      ),
    );
    return token;
  }

  void detach(Object token) {
    _MainNavigationRegistration? detachedRegistration;
    _registrations.removeWhere((registration) {
      final matches = identical(registration.token, token);
      if (matches) {
        detachedRegistration = registration;
      }
      return matches;
    });
    final registration = detachedRegistration;
    if (registration == null) {
      return;
    }
    _homeRefreshIntents.removeWhere(
      (_, intent) => identical(intent.shellRegistrationToken, token),
    );
    final navigator = registration.navigator;
    if (!_registrations.any(
      (candidate) => identical(candidate.navigator, navigator),
    )) {
      _clearPendingHomeRefreshes(navigator);
      _authRouteRegistrations.removeWhere((candidate) {
        final matches = identical(candidate.navigator, navigator);
        if (matches) {
          candidate
            ..active = false
            ..version += 1;
        }
        return matches;
      });
      _rootContexts.remove(navigator);
    }
  }

  MainNavigationAuthRouteBinding? bindAuthBoundRoute({
    required NavigatorState navigator,
    required ModalRoute<dynamic> route,
    required String originatingAuthRealm,
    bool preserveRouteOnAuthChange = false,
    bool Function()? canPreserveRouteOnAuthChange,
    bool allowGuestToSignedUpgrade = false,
    MainNavigationAuthRealmReplaced? onAuthRealmReplaced,
    MainNavigationSameAuthRealmNotified? onSameAuthRealmNotified,
    Object? privateOwner,
  }) {
    final rootContext = _rootContexts[navigator];
    if (rootContext == null) {
      return null;
    }
    final catchesUpInitialSignedRealm =
        rootContext.authGeneration == 0 &&
        rootContext.authRealm == 'guest' &&
        originatingAuthRealm.startsWith('signed:');
    final upgradesInitialGuestRealm =
        allowGuestToSignedUpgrade &&
        originatingAuthRealm == 'guest' &&
        rootContext.authRealm.startsWith('signed:');
    if (rootContext.authRealm != originatingAuthRealm &&
        !catchesUpInitialSignedRealm &&
        !upgradesInitialGuestRealm) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (route.isActive) {
          navigator.removeRoute(route);
        }
      });
      return null;
    }
    final effectiveOriginatingAuthRealm = upgradesInitialGuestRealm
        ? rootContext.authRealm
        : originatingAuthRealm;
    final token = Object();
    final owner = privateOwner ?? Object();
    final registration = _MainNavigationAuthRouteRegistration(
      token: token,
      owner: owner,
      navigator: navigator,
      route: route,
      rootContext: rootContext,
      authRealm: effectiveOriginatingAuthRealm,
      authGeneration: rootContext.authGeneration,
      preserveRouteOnAuthChange: preserveRouteOnAuthChange,
      canPreserveRouteOnAuthChange: canPreserveRouteOnAuthChange,
      allowGuestToSignedUpgrade: allowGuestToSignedUpgrade,
      onAuthRealmReplaced: onAuthRealmReplaced,
      onSameAuthRealmNotified: onSameAuthRealmNotified,
      awaitingInitialSignedCatchUp:
          rootContext.authRealm == 'guest' &&
          effectiveOriginatingAuthRealm.startsWith('signed:'),
    );
    _authRouteRegistrations.add(registration);
    return MainNavigationAuthRouteBinding._(
      controller: this,
      token: token,
      owner: owner,
    );
  }

  void unbindAuthBoundRoute(MainNavigationAuthRouteBinding binding) {
    if (!identical(binding._controller, this)) {
      return;
    }
    _authRouteRegistrations.removeWhere((registration) {
      final matches = identical(registration.token, binding._token);
      if (matches) {
        registration
          ..active = false
          ..version += 1;
      }
      return matches;
    });
  }

  bool _isAuthRouteBindingCurrent(MainNavigationAuthRouteBinding binding) {
    final registration = _authRouteRegistrationFor(binding._token);
    return registration != null &&
        _isAuthRouteRegistrationCurrent(registration);
  }

  MainNavigationAuthLease _captureAuthLease(
    MainNavigationAuthRouteBinding binding,
  ) {
    final registration = _authRouteRegistrationFor(binding._token);
    return MainNavigationAuthLease._(
      controller: this,
      token: binding._token,
      version: registration?.version,
      authRealm: registration?.authRealm,
    );
  }

  _MainNavigationAuthOverlayCapture? _captureAuthOverlay(
    MainNavigationAuthRouteBinding binding,
  ) {
    final registration = _authRouteRegistrationFor(binding._token);
    if (registration == null || !registration.active) {
      return null;
    }
    return _MainNavigationAuthOverlayCapture(
      controller: this,
      parentToken: registration.token,
      parentVersion: registration.version,
      owner: registration.owner,
      navigator: registration.navigator,
      rootContext: registration.rootContext,
      authGeneration: registration.rootContext.authGeneration,
      authRealm: registration.authRealm,
      allowGuestToSignedUpgrade: registration.allowGuestToSignedUpgrade,
      awaitingInitialSignedCatchUp: registration.awaitingInitialSignedCatchUp,
    );
  }

  bool _isAuthOverlayCaptureCurrent(_MainNavigationAuthOverlayCapture capture) {
    final registration = _authRouteRegistrationFor(capture.parentToken);
    final rootContext = _rootContexts[capture.navigator];
    if (registration == null ||
        !registration.active ||
        registration.version != capture.parentVersion ||
        !identical(registration.rootContext, capture.rootContext) ||
        !identical(rootContext, capture.rootContext)) {
      return false;
    }
    final sameGeneration =
        rootContext?.authGeneration == capture.authGeneration;
    final completedInitialSignedCatchUp =
        capture.awaitingInitialSignedCatchUp &&
        capture.authRealm.startsWith('signed:') &&
        registration.authRealm == capture.authRealm &&
        rootContext?.authRealm == capture.authRealm;
    final completedGuestUpgrade =
        capture.allowGuestToSignedUpgrade &&
        capture.authRealm == 'guest' &&
        registration.authRealm.startsWith('signed:') &&
        rootContext?.authRealm == registration.authRealm;
    return sameGeneration ||
        completedInitialSignedCatchUp ||
        completedGuestUpgrade;
  }

  String? _currentAuthRealmForOverlayCapture(
    _MainNavigationAuthOverlayCapture capture,
  ) {
    if (!_isAuthOverlayCaptureCurrent(capture)) {
      return null;
    }
    return _authRouteRegistrationFor(capture.parentToken)?.authRealm;
  }

  bool _isAuthLeaseCurrent(MainNavigationAuthLease lease) {
    final registration = _authRouteRegistrationFor(lease._token);
    final realmMatches =
        registration != null &&
        (registration.authRealm == lease.authRealm ||
            (lease.authRealm == 'guest' &&
                registration.allowGuestToSignedUpgrade &&
                registration.authRealm.startsWith('signed:')));
    return registration != null &&
        registration.version == lease._version &&
        realmMatches &&
        _isAuthRouteRegistrationCurrent(registration);
  }

  _MainNavigationAuthRouteRegistration? _authRouteRegistrationFor(
    Object token,
  ) {
    for (final registration in _authRouteRegistrations) {
      if (identical(registration.token, token)) {
        return registration;
      }
    }
    return null;
  }

  bool _isAuthRouteRegistrationCurrent(
    _MainNavigationAuthRouteRegistration registration,
  ) {
    final rootContext = _rootContexts[registration.navigator];
    if (!registration.active ||
        !registration.route.isActive ||
        rootContext == null ||
        !identical(rootContext, registration.rootContext)) {
      return false;
    }
    if (registration.awaitingInitialSignedCatchUp &&
        rootContext.authRealm == 'guest') {
      return true;
    }
    return registration.authRealm == rootContext.authRealm &&
        registration.authGeneration == rootContext.authGeneration;
  }

  void retireAuthBoundDescendants(MainNavigationAuthRouteBinding binding) {
    if (!identical(binding._controller, this)) {
      return;
    }
    final registrations = _authRouteRegistrations
        .where(
          (registration) =>
              registration.active &&
              identical(registration.owner, binding._owner) &&
              !identical(registration.token, binding._token),
        )
        .toList(growable: false)
        .reversed;
    _removeAuthRouteRegistrations(registrations);
  }

  void invalidateAuthBoundPrivateContext(
    MainNavigationAuthRouteBinding binding,
  ) {
    if (!identical(binding._controller, this)) {
      return;
    }
    final registration = _authRouteRegistrationFor(binding._token);
    if (registration == null || !registration.active) {
      return;
    }
    registration.version += 1;
    retireAuthBoundDescendants(binding);
  }

  MainNavigationAuthRouteBinding? bindPrivateDescendantRoute({
    required MainNavigationAuthRouteBinding parent,
    required NavigatorState navigator,
    required ModalRoute<dynamic> route,
    bool Function()? canPreserveRouteOnAuthChange,
    MainNavigationAuthRealmReplaced? onAuthRealmReplaced,
  }) {
    final parentRegistration = _authRouteRegistrationFor(parent._token);
    if (parentRegistration == null ||
        !parentRegistration.active ||
        !_isAuthRouteRegistrationCurrent(parentRegistration)) {
      return null;
    }
    return bindAuthBoundRoute(
      navigator: navigator,
      route: route,
      originatingAuthRealm: parentRegistration.authRealm,
      allowGuestToSignedUpgrade: parentRegistration.allowGuestToSignedUpgrade,
      privateOwner: parentRegistration.owner,
      canPreserveRouteOnAuthChange: canPreserveRouteOnAuthChange,
      onAuthRealmReplaced: onAuthRealmReplaced,
    );
  }

  void replaceAuthRealm({
    required NavigatorState navigator,
    required String previousRealm,
    required String nextRealm,
  }) {
    final rootContext = _rootContexts[navigator];
    if (rootContext == null || rootContext.authRealm == nextRealm) {
      return;
    }

    rootContext
      ..authRealm = nextRealm
      ..authGeneration += 1;
    _clearPendingHomeRefreshes(navigator);

    final matchingRegistrations = _authRouteRegistrations
        .where(
          (registration) =>
              registration.active &&
              identical(registration.navigator, navigator) &&
              identical(registration.rootContext, rootContext),
        )
        .toList(growable: false);
    final retired = <_MainNavigationAuthRouteRegistration>[];
    final callbacks = <MainNavigationAuthRealmReplaced>[];

    for (final registration in matchingRegistrations) {
      final catchesUpInitialSignedRealm =
          registration.awaitingInitialSignedCatchUp &&
          registration.authRealm == nextRealm;
      final upgradesGuestDraft =
          registration.allowGuestToSignedUpgrade &&
          registration.authRealm == 'guest' &&
          nextRealm.startsWith('signed:');
      if (catchesUpInitialSignedRealm) {
        registration
          ..authRealm = nextRealm
          ..authGeneration = rootContext.authGeneration
          ..awaitingInitialSignedCatchUp = false;
        continue;
      }

      if (upgradesGuestDraft) {
        registration
          ..authRealm = nextRealm
          ..authGeneration = rootContext.authGeneration
          ..awaitingInitialSignedCatchUp = false;
        final callback = registration.onAuthRealmReplaced;
        if (callback != null) {
          callbacks.add(callback);
        }
        continue;
      }

      if (registration.preserveRouteOnAuthChange ||
          registration.canPreserveRouteOnAuthChange?.call() == true) {
        registration
          ..version += 1
          ..authRealm = nextRealm
          ..authGeneration = rootContext.authGeneration
          ..awaitingInitialSignedCatchUp = false;
        final callback = registration.onAuthRealmReplaced;
        if (callback != null) {
          callbacks.add(callback);
        }
        continue;
      }

      if (registration.authRealm != nextRealm ||
          registration.authGeneration != rootContext.authGeneration) {
        retired.add(registration);
      }
    }

    _removeAuthRouteRegistrations(retired.reversed);
    for (final callback in callbacks) {
      callback(previousRealm, nextRealm);
    }
  }

  void notifySameAuthRealm({
    required NavigatorState navigator,
    required String authRealm,
  }) {
    final rootContext = _rootContexts[navigator];
    if (rootContext == null || rootContext.authRealm != authRealm) {
      return;
    }
    final callbacks = _authRouteRegistrations
        .where(
          (registration) =>
              registration.active &&
              identical(registration.navigator, navigator) &&
              identical(registration.rootContext, rootContext) &&
              registration.authRealm == authRealm &&
              registration.route.isActive &&
              registration.onSameAuthRealmNotified != null,
        )
        .map((registration) => registration.onSameAuthRealmNotified!)
        .toList(growable: false);
    for (final callback in callbacks) {
      callback();
    }
  }

  void _removeAuthRouteRegistrations(
    Iterable<_MainNavigationAuthRouteRegistration> registrations,
  ) {
    final removedRoutes = <ModalRoute<dynamic>>{};
    for (final registration in registrations.toList(growable: false)) {
      if (!registration.active) {
        continue;
      }
      registration
        ..active = false
        ..version += 1;
      _authRouteRegistrations.remove(registration);
      final route = registration.route;
      if (route.isActive && removedRoutes.add(route)) {
        registration.navigator.removeRoute(route);
      }
    }
  }

  void markHomeRefreshNeeded({
    required Object owner,
    required NavigatorState navigator,
    required AppMode mode,
  }) {
    final rootContext = _rootContexts[navigator];
    final shellRegistration = _activeShellRegistration(navigator);
    if (rootContext == null || shellRegistration == null) {
      return;
    }
    _homeRefreshIntents[owner] = _MainNavigationHomeRefreshIntent(
      navigator: navigator,
      mode: mode,
      shellRegistrationToken: shellRegistration.token,
      rootContext: rootContext,
      authGeneration: rootContext.authGeneration,
    );
  }

  MainNavigationHomeRefreshDelivery captureHomeRefreshDelivery(
    BuildContext context, {
    required AppMode mode,
    Object? owner,
  }) {
    final navigator = Navigator.maybeOf(context, rootNavigator: true);
    final route = ModalRoute.of(context);
    final rootContext = navigator == null ? null : _rootContexts[navigator];
    _MainNavigationRegistration? shellRegistration;
    if (navigator != null && rootContext != null) {
      for (final registration in _registrations.reversed) {
        if (identical(registration.navigator, navigator) &&
            identical(registration.rootContext, rootContext) &&
            registration.route.isActive) {
          shellRegistration = registration;
          break;
        }
      }
    }
    return MainNavigationHomeRefreshDelivery._(
      controller: this,
      navigator: navigator,
      sourceRoute: route,
      shellRegistrationToken: shellRegistration?.token,
      mode: mode,
      owner: owner ?? Object(),
      rootContext: rootContext,
      authGeneration: rootContext?.authGeneration,
    );
  }

  bool _deliverConfirmedHomeRefresh(
    MainNavigationHomeRefreshDelivery delivery,
  ) {
    final navigator = delivery._navigator;
    final rootContext = navigator == null ? null : _rootContexts[navigator];
    if (navigator == null ||
        rootContext == null ||
        !identical(rootContext, delivery._rootContext) ||
        rootContext.authGeneration != delivery._authGeneration ||
        !_registrations.any(
          (registration) =>
              identical(registration.token, delivery._shellRegistrationToken) &&
              identical(registration.navigator, navigator) &&
              identical(registration.rootContext, rootContext) &&
              registration.route.isActive,
        )) {
      return false;
    }

    _homeRefreshIntents[delivery._owner] = _MainNavigationHomeRefreshIntent(
      navigator: navigator,
      mode: delivery._mode,
      shellRegistrationToken: delivery._shellRegistrationToken!,
      rootContext: rootContext,
      authGeneration: rootContext.authGeneration,
    );
    final sourceRoute = delivery._sourceRoute;
    if (sourceRoute == null || !sourceRoute.isActive) {
      final shellIsCurrent = _registrations.any(
        (registration) =>
            identical(registration.token, delivery._shellRegistrationToken) &&
            registration.route.isCurrent,
      );
      if (shellIsCurrent) {
        applyPendingHomeRefreshes(navigator);
      }
    }
    return true;
  }

  MainNavigationHomeRefreshBatch capturePendingHomeRefreshes(
    NavigatorState navigator, {
    AppMode? mode,
  }) {
    return _capturePendingHomeRefreshesForRegistration(
      navigator,
      _activeShellRegistration(navigator)?.token,
      mode: mode,
    );
  }

  MainNavigationRouteReturnDelivery captureRouteReturnDelivery({
    required NavigatorState navigator,
    required AppMode mode,
  }) {
    final rootContext = _rootContexts[navigator];
    final shellRegistration = _activeShellRegistration(navigator);
    return MainNavigationRouteReturnDelivery._(
      controller: this,
      navigator: navigator,
      mode: mode,
      rootContext: rootContext,
      authGeneration: rootContext?.authGeneration,
      shellRegistrationToken: shellRegistration?.token,
    );
  }

  bool _deliverRouteReturn(
    MainNavigationRouteReturnDelivery delivery, {
    required bool routeReportedChange,
  }) {
    final rootContext = _rootContexts[delivery._navigator];
    _MainNavigationRegistration? shellRegistration;
    for (final registration in _registrations) {
      if (identical(registration.navigator, delivery._navigator) &&
          identical(registration.token, delivery._shellRegistrationToken) &&
          registration.route.isActive) {
        shellRegistration = registration;
        break;
      }
    }
    if (rootContext == null ||
        shellRegistration == null ||
        !identical(rootContext, delivery._rootContext) ||
        !identical(shellRegistration.rootContext, rootContext) ||
        !shellRegistration.route.isCurrent) {
      return false;
    }

    final routeChangeBelongsToCurrentAuth =
        rootContext.authGeneration == delivery._authGeneration;

    final batch = _capturePendingHomeRefreshesForRegistration(
      delivery._navigator,
      delivery._shellRegistrationToken,
      mode: delivery._mode,
    );
    if ((!routeReportedChange || !routeChangeBelongsToCurrentAuth) &&
        batch.isEmpty) {
      return false;
    }
    if (!shellRegistration.refreshHomes(<AppMode>{delivery._mode})) {
      return false;
    }
    consumePendingHomeRefreshes(batch);
    return true;
  }

  MainNavigationHomeRefreshBatch _capturePendingHomeRefreshesForRegistration(
    NavigatorState navigator,
    Object? shellRegistrationToken, {
    AppMode? mode,
  }) {
    final captured = <Object, _MainNavigationHomeRefreshIntent>{};
    for (final entry in _homeRefreshIntents.entries) {
      final intent = entry.value;
      if (identical(intent.navigator, navigator) &&
          identical(intent.shellRegistrationToken, shellRegistrationToken) &&
          (mode == null || intent.mode == mode) &&
          _isCurrentIntent(intent)) {
        captured[entry.key] = intent;
      }
    }
    return MainNavigationHomeRefreshBatch._(
      controller: this,
      navigator: navigator,
      shellRegistrationToken: shellRegistrationToken,
      intents: captured,
    );
  }

  void consumePendingHomeRefreshes(MainNavigationHomeRefreshBatch batch) {
    if (!identical(batch._controller, this) ||
        !_registrations.any(
          (registration) =>
              identical(registration.navigator, batch._navigator) &&
              identical(registration.token, batch._shellRegistrationToken),
        )) {
      return;
    }
    for (final entry in batch._intents.entries) {
      if (identical(_homeRefreshIntents[entry.key], entry.value)) {
        _homeRefreshIntents.remove(entry.key);
      }
    }
  }

  bool applyPendingHomeRefreshes(NavigatorState navigator) {
    if (_destinationSelections.contains(navigator)) {
      return false;
    }
    final activeRegistration = _activeShellRegistration(navigator);
    final orderedRegistrations = <_MainNavigationRegistration>[];
    if (activeRegistration != null) {
      orderedRegistrations.add(activeRegistration);
    }
    orderedRegistrations.addAll(
      _registrations.where(
        (registration) => !identical(registration, activeRegistration),
      ),
    );
    for (final registration in orderedRegistrations) {
      if (!identical(registration.navigator, navigator) ||
          !registration.route.isActive) {
        continue;
      }
      final batch = _capturePendingHomeRefreshesForRegistration(
        navigator,
        registration.token,
      );
      if (batch.isEmpty ||
          !registration.refreshHomes(Set<AppMode>.unmodifiable(batch.modes))) {
        continue;
      }
      consumePendingHomeRefreshes(batch);
      return true;
    }
    return false;
  }

  bool returnToExistingShell({
    required NavigatorState navigator,
    required AppMode mode,
    required int index,
    AppMode? refreshHomeMode,
  }) {
    final registration = _selectExistingShellDestination(
      navigator: navigator,
      mode: mode,
      index: index,
      refreshHomeMode: refreshHomeMode,
    );
    if (registration == null) {
      return false;
    }
    navigator.popUntil((candidate) => identical(candidate, registration.route));
    return true;
  }

  bool selectExistingShellDestination({
    required NavigatorState navigator,
    required AppMode mode,
    required int index,
    AppMode? refreshHomeMode,
  }) {
    return _selectExistingShellDestination(
          navigator: navigator,
          mode: mode,
          index: index,
          refreshHomeMode: refreshHomeMode,
        ) !=
        null;
  }

  _MainNavigationRegistration? _selectExistingShellDestination({
    required NavigatorState navigator,
    required AppMode mode,
    required int index,
    AppMode? refreshHomeMode,
  }) {
    final pendingBatches = <MainNavigationHomeRefreshBatch>[
      for (final registration in _registrations)
        if (identical(registration.navigator, navigator) &&
            registration.route.isActive)
          _capturePendingHomeRefreshesForRegistration(
            navigator,
            registration.token,
          ),
    ];
    final refreshHomeModes = <AppMode>{};
    for (final batch in pendingBatches) {
      refreshHomeModes.addAll(batch.modes);
    }
    if (refreshHomeMode != null) {
      refreshHomeModes.add(refreshHomeMode);
    }
    final immutableModes = Set<AppMode>.unmodifiable(refreshHomeModes);
    for (final registration in _registrations) {
      if (!identical(registration.navigator, navigator) ||
          !registration.route.isActive) {
        continue;
      }

      _destinationSelections.add(navigator);
      late final bool selected;
      try {
        selected = registration.selectDestination(mode, index, immutableModes);
      } finally {
        _destinationSelections.remove(navigator);
      }
      if (!selected) {
        continue;
      }

      for (final batch in pendingBatches) {
        consumePendingHomeRefreshes(batch);
      }
      return registration;
    }
    return null;
  }

  void discardPendingHomeRefreshes(NavigatorState navigator, {AppMode? mode}) {
    _homeRefreshIntents.removeWhere(
      (_, intent) =>
          identical(intent.navigator, navigator) &&
          (mode == null || intent.mode == mode),
    );
  }

  bool _isCurrentIntent(_MainNavigationHomeRefreshIntent intent) {
    final rootContext = _rootContexts[intent.navigator];
    return rootContext != null &&
        identical(rootContext, intent.rootContext) &&
        rootContext.authGeneration == intent.authGeneration &&
        _registrations.any(
          (registration) =>
              identical(registration.token, intent.shellRegistrationToken) &&
              identical(registration.navigator, intent.navigator) &&
              registration.route.isActive,
        );
  }

  _MainNavigationRegistration? _activeShellRegistration(
    NavigatorState navigator,
  ) {
    _MainNavigationRegistration? activeRegistration;
    for (final registration in _registrations.reversed) {
      if (!identical(registration.navigator, navigator) ||
          !registration.route.isActive) {
        continue;
      }
      if (registration.route.isCurrent) {
        return registration;
      }
      activeRegistration ??= registration;
    }
    return activeRegistration;
  }

  void _clearPendingHomeRefreshes(NavigatorState navigator) {
    _homeRefreshIntents.removeWhere(
      (_, intent) => identical(intent.navigator, navigator),
    );
  }
}

class MainNavigationHomeRefreshDelivery {
  final MainNavigationController _controller;
  final NavigatorState? _navigator;
  final ModalRoute<dynamic>? _sourceRoute;
  final Object? _shellRegistrationToken;
  final AppMode _mode;
  final Object _owner;
  final _MainNavigationRootContext? _rootContext;
  final int? _authGeneration;
  bool _confirmed = false;

  MainNavigationHomeRefreshDelivery._({
    required MainNavigationController controller,
    required NavigatorState? navigator,
    required ModalRoute<dynamic>? sourceRoute,
    required Object? shellRegistrationToken,
    required AppMode mode,
    required Object owner,
    required _MainNavigationRootContext? rootContext,
    required int? authGeneration,
  }) : _controller = controller,
       _navigator = navigator,
       _sourceRoute = sourceRoute,
       _shellRegistrationToken = shellRegistrationToken,
       _mode = mode,
       _owner = owner,
       _rootContext = rootContext,
       _authGeneration = authGeneration;

  bool confirm() {
    if (_confirmed) {
      return false;
    }
    _confirmed = true;
    return _controller._deliverConfirmedHomeRefresh(this);
  }
}

class MainNavigationHomeRefreshBatch {
  final MainNavigationController _controller;
  final NavigatorState _navigator;
  final Object? _shellRegistrationToken;
  final Map<Object, _MainNavigationHomeRefreshIntent> _intents;

  const MainNavigationHomeRefreshBatch._({
    required MainNavigationController controller,
    required NavigatorState navigator,
    required Object? shellRegistrationToken,
    required Map<Object, _MainNavigationHomeRefreshIntent> intents,
  }) : _controller = controller,
       _navigator = navigator,
       _shellRegistrationToken = shellRegistrationToken,
       _intents = intents;

  bool get isNotEmpty => _intents.isNotEmpty;
  bool get isEmpty => _intents.isEmpty;

  Set<AppMode> get modes => <AppMode>{
    for (final intent in _intents.values) intent.mode,
  };

  bool requestsMode(AppMode mode) {
    return _intents.values.any((intent) => intent.mode == mode);
  }
}

class MainNavigationRouteReturnDelivery {
  final MainNavigationController _controller;
  final NavigatorState _navigator;
  final AppMode _mode;
  final _MainNavigationRootContext? _rootContext;
  final int? _authGeneration;
  final Object? _shellRegistrationToken;
  bool _completed = false;

  MainNavigationRouteReturnDelivery._({
    required MainNavigationController controller,
    required NavigatorState navigator,
    required AppMode mode,
    required _MainNavigationRootContext? rootContext,
    required int? authGeneration,
    required Object? shellRegistrationToken,
  }) : _controller = controller,
       _navigator = navigator,
       _mode = mode,
       _rootContext = rootContext,
       _authGeneration = authGeneration,
       _shellRegistrationToken = shellRegistrationToken;

  bool complete({required bool routeReportedChange}) {
    if (_completed) {
      return false;
    }
    _completed = true;
    return _controller._deliverRouteReturn(
      this,
      routeReportedChange: routeReportedChange,
    );
  }
}

class _MainNavigationRootContext {
  String authRealm;
  int authGeneration = 0;

  _MainNavigationRootContext({required this.authRealm});
}

class _MainNavigationAuthRouteRegistration {
  final Object token;
  final Object owner;
  final NavigatorState navigator;
  final ModalRoute<dynamic> route;
  final _MainNavigationRootContext rootContext;
  String authRealm;
  int authGeneration;
  final bool preserveRouteOnAuthChange;
  final bool Function()? canPreserveRouteOnAuthChange;
  final bool allowGuestToSignedUpgrade;
  final MainNavigationAuthRealmReplaced? onAuthRealmReplaced;
  final MainNavigationSameAuthRealmNotified? onSameAuthRealmNotified;
  bool awaitingInitialSignedCatchUp;
  bool active = true;
  int version = 0;

  _MainNavigationAuthRouteRegistration({
    required this.token,
    required this.owner,
    required this.navigator,
    required this.route,
    required this.rootContext,
    required this.authRealm,
    required this.authGeneration,
    required this.preserveRouteOnAuthChange,
    required this.canPreserveRouteOnAuthChange,
    required this.allowGuestToSignedUpgrade,
    required this.onAuthRealmReplaced,
    required this.onSameAuthRealmNotified,
    required this.awaitingInitialSignedCatchUp,
  });
}

class MainNavigationAuthRouteBinding {
  final MainNavigationController _controller;
  final Object _token;
  final Object _owner;

  const MainNavigationAuthRouteBinding._({
    required MainNavigationController controller,
    required Object token,
    required Object owner,
  }) : _controller = controller,
       _token = token,
       _owner = owner;

  bool get isCurrent => _controller._isAuthRouteBindingCurrent(this);

  MainNavigationAuthLease captureLease() {
    return _controller._captureAuthLease(this);
  }

  void retirePrivateOverlays() {
    _controller.invalidateAuthBoundPrivateContext(this);
  }

  MainNavigationAuthRouteBinding? bindPrivateDescendantRoute({
    required NavigatorState navigator,
    required ModalRoute<dynamic> route,
    bool Function()? canPreserveRouteOnAuthChange,
    MainNavigationAuthRealmReplaced? onAuthRealmReplaced,
  }) {
    return _controller.bindPrivateDescendantRoute(
      parent: this,
      navigator: navigator,
      route: route,
      canPreserveRouteOnAuthChange: canPreserveRouteOnAuthChange,
      onAuthRealmReplaced: onAuthRealmReplaced,
    );
  }
}

class MainNavigationAuthLease {
  final MainNavigationController _controller;
  final Object _token;
  final int? _version;
  final String? authRealm;

  const MainNavigationAuthLease._({
    required MainNavigationController controller,
    required Object token,
    required int? version,
    required this.authRealm,
  }) : _controller = controller,
       _token = token,
       _version = version;

  bool get isCurrent => _controller._isAuthLeaseCurrent(this);

  bool matchesUser(User? user, {bool allowGuestToSignedUpgrade = false}) {
    if (!isCurrent) {
      return false;
    }
    final realm = authRealm;
    if (realm == null) {
      return true;
    }
    if (realm == 'guest') {
      return user == null ||
          user.isAnonymous ||
          (allowGuestToSignedUpgrade && !user.isAnonymous);
    }
    return user != null && !user.isAnonymous && realm == 'signed:${user.uid}';
  }
}

class _MainNavigationAuthOverlayCapture {
  final MainNavigationController controller;
  final Object parentToken;
  final int parentVersion;
  final Object owner;
  final NavigatorState navigator;
  final _MainNavigationRootContext rootContext;
  final int authGeneration;
  final String authRealm;
  final bool allowGuestToSignedUpgrade;
  final bool awaitingInitialSignedCatchUp;

  const _MainNavigationAuthOverlayCapture({
    required this.controller,
    required this.parentToken,
    required this.parentVersion,
    required this.owner,
    required this.navigator,
    required this.rootContext,
    required this.authGeneration,
    required this.authRealm,
    required this.allowGuestToSignedUpgrade,
    required this.awaitingInitialSignedCatchUp,
  });

  bool get isCurrent => controller._isAuthOverlayCaptureCurrent(this);

  String? get currentAuthRealm =>
      controller._currentAuthRealmForOverlayCapture(this);
}

class MainNavigationAuthBoundOverlayScope extends InheritedTheme {
  final MainNavigationAuthRouteBinding binding;
  final _MainNavigationAuthOverlayCapture? _capture;

  MainNavigationAuthBoundOverlayScope({
    super.key,
    required this.binding,
    required super.child,
  }) : _capture = binding._controller._captureAuthOverlay(binding);

  static MainNavigationAuthRouteBinding? maybeOf(BuildContext context) {
    return context
        .dependOnInheritedWidgetOfExactType<
          MainNavigationAuthBoundOverlayScope
        >()
        ?.binding;
  }

  @override
  Widget wrap(BuildContext context, Widget child) {
    return _MainNavigationCapturedAuthOverlay(capture: _capture, child: child);
  }

  @override
  bool updateShouldNotify(MainNavigationAuthBoundOverlayScope oldWidget) {
    return !identical(binding, oldWidget.binding);
  }
}

class _MainNavigationCapturedAuthOverlay extends StatefulWidget {
  final _MainNavigationAuthOverlayCapture? capture;
  final Widget child;

  const _MainNavigationCapturedAuthOverlay({
    required this.capture,
    required this.child,
  });

  @override
  State<_MainNavigationCapturedAuthOverlay> createState() =>
      _MainNavigationCapturedAuthOverlayState();
}

class _MainNavigationCapturedAuthOverlayState
    extends State<_MainNavigationCapturedAuthOverlay> {
  MainNavigationAuthRouteBinding? _binding;
  ModalRoute<dynamic>? _route;
  bool _retirementScheduled = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    final navigator = Navigator.maybeOf(context, rootNavigator: true);
    if (route == null || navigator == null || identical(route, _route)) {
      return;
    }
    _unbind();
    _route = route;
    final capture = widget.capture;
    final currentAuthRealm = capture?.currentAuthRealm;
    if (capture == null || currentAuthRealm == null) {
      _scheduleRetirement(navigator, route);
      return;
    }
    _binding = capture.controller.bindAuthBoundRoute(
      navigator: navigator,
      route: route,
      originatingAuthRealm: currentAuthRealm,
      allowGuestToSignedUpgrade: capture.allowGuestToSignedUpgrade,
      privateOwner: capture.owner,
    );
  }

  void _scheduleRetirement(
    NavigatorState navigator,
    ModalRoute<dynamic> route,
  ) {
    if (_retirementScheduled) {
      return;
    }
    _retirementScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (route.isActive) {
        navigator.removeRoute(route);
      }
    });
  }

  @override
  void dispose() {
    _unbind();
    super.dispose();
  }

  void _unbind() {
    final binding = _binding;
    if (binding != null) {
      binding._controller.unbindAuthBoundRoute(binding);
    }
    _binding = null;
    _route = null;
  }

  @override
  Widget build(BuildContext context) {
    final capture = widget.capture;
    if (capture == null || !capture.isCurrent || _retirementScheduled) {
      return const SizedBox.shrink();
    }
    final binding = _binding;
    if (binding == null) {
      return widget.child;
    }
    return MainNavigationAuthBoundOverlayScope(
      binding: binding,
      child: widget.child,
    );
  }
}

Future<T?> pushMainNavigationPrivateRoute<T>(
  BuildContext context, {
  required MainNavigationAuthRouteBinding? parentBinding,
  String? originatingAuthRealm,
  bool allowGuestToSignedUpgrade = false,
  bool Function()? canPreserveRouteOnAuthChange,
  MainNavigationAuthRealmReplaced? onAuthRealmReplaced,
  required WidgetBuilder builder,
}) async {
  final navigator = Navigator.of(context, rootNavigator: true);
  MainNavigationAuthRouteBinding? childBinding;
  late final MaterialPageRoute<T> route;
  route = MaterialPageRoute<T>(
    builder: (routeContext) {
      final child = builder(routeContext);
      final binding = childBinding;
      if (binding == null) {
        return child;
      }
      return MainNavigationAuthBoundOverlayScope(
        binding: binding,
        child: child,
      );
    },
  );
  if (parentBinding != null) {
    childBinding = parentBinding.bindPrivateDescendantRoute(
      navigator: navigator,
      route: route,
      canPreserveRouteOnAuthChange: canPreserveRouteOnAuthChange,
      onAuthRealmReplaced: onAuthRealmReplaced,
    );
  } else if (originatingAuthRealm != null) {
    childBinding = mainNavigationController.bindAuthBoundRoute(
      navigator: navigator,
      route: route,
      originatingAuthRealm: originatingAuthRealm,
      allowGuestToSignedUpgrade: allowGuestToSignedUpgrade,
      canPreserveRouteOnAuthChange: canPreserveRouteOnAuthChange,
      onAuthRealmReplaced: onAuthRealmReplaced,
    );
  }
  if ((parentBinding != null || originatingAuthRealm != null) &&
      childBinding == null) {
    return null;
  }
  try {
    return await navigator.push<T>(route);
  } finally {
    final binding = childBinding;
    if (binding != null) {
      binding._controller.unbindAuthBoundRoute(binding);
    }
  }
}

void openMainNavigationDestination(
  BuildContext context, {
  required AppMode mode,
  required int index,
  MainNavigationController? controller,
  Widget Function(AppMode mode, int index)? fallbackBuilder,
  AppMode? refreshHomeMode,
}) {
  final navigator = Navigator.of(context, rootNavigator: true);
  final effectiveController = controller ?? mainNavigationController;
  if (effectiveController.returnToExistingShell(
    navigator: navigator,
    mode: mode,
    index: index,
    refreshHomeMode: refreshHomeMode,
  )) {
    return;
  }

  effectiveController.discardPendingHomeRefreshes(navigator);
  navigator.pushAndRemoveUntil(
    MaterialPageRoute(
      builder: (_) =>
          fallbackBuilder?.call(mode, index) ??
          MainNavigationScreen(
            initialMode: mode,
            initialIndex: index,
            navigationController: effectiveController,
          ),
    ),
    (route) => false,
  );
}

class _MainNavigationRegistration {
  final Object token;
  final NavigatorState navigator;
  final ModalRoute<dynamic> route;
  final _MainNavigationRootContext rootContext;
  final bool Function(AppMode mode, int index, Set<AppMode> refreshHomeModes)
  selectDestination;
  final bool Function(Set<AppMode> refreshHomeModes) refreshHomes;

  const _MainNavigationRegistration({
    required this.token,
    required this.navigator,
    required this.route,
    required this.rootContext,
    required this.selectDestination,
    required this.refreshHomes,
  });
}

class _MainNavigationHomeRefreshIntent {
  final NavigatorState navigator;
  final AppMode mode;
  final Object shellRegistrationToken;
  final _MainNavigationRootContext rootContext;
  final int authGeneration;

  const _MainNavigationHomeRefreshIntent({
    required this.navigator,
    required this.mode,
    required this.shellRegistrationToken,
    required this.rootContext,
    required this.authGeneration,
  });
}

class _StartupDeepLinkGuard {
  final String key;

  const _StartupDeepLinkGuard(this.key);
}

class MainNavigationScreen extends StatefulWidget {
  final AppMode initialMode;
  final int initialIndex;
  final RestaurantCustomerDeepLink? initialCustomerDeepLink;
  final RestaurantInviteDeepLink? initialInviteDeepLink;
  final String? initialDeepLinkRouteName;
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
  final Widget Function(RestaurantCustomerDeepLink link)?
  testCustomerDeepLinkBuilder;
  final Widget Function(RestaurantInviteDeepLink link)?
  testInviteDeepLinkBuilder;
  final Widget Function(AppMode mode, int navigationRefreshGeneration)?
  testModeHomeBuilder;
  final MainNavigationController? navigationController;
  final String Function()? testCustomerAuthRealmProvider;
  final Stream<String>? testCustomerAuthRealmChanges;

  /// The explicit opt-in composition point for the bounded BiteSaver browse
  /// entry. Leaving this null preserves the current production Home path.
  final BiteSaverBrowseHomeBuilder? biteSaverBrowseHomeBuilder;

  /// Paired with [biteSaverBrowseHomeBuilder] so the opt-in bounded browse
  /// path never exposes a legacy-only Saved reader.
  final BiteSaverSavedAccountBuilder? biteSaverSavedAccountBuilder;

  const MainNavigationScreen({
    super.key,
    this.initialMode = AppMode.biteSaver,
    this.initialIndex = 0,
    this.initialCustomerDeepLink,
    this.initialInviteDeepLink,
    this.initialDeepLinkRouteName,
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
    @visibleForTesting this.testCustomerDeepLinkBuilder,
    @visibleForTesting this.testInviteDeepLinkBuilder,
    @visibleForTesting this.testModeHomeBuilder,
    this.navigationController,
    @visibleForTesting this.testCustomerAuthRealmProvider,
    @visibleForTesting this.testCustomerAuthRealmChanges,
    this.biteSaverBrowseHomeBuilder,
    this.biteSaverSavedAccountBuilder,
  }) : assert(
         testPagesBuilder != null ||
             (biteSaverBrowseHomeBuilder == null) ==
                 (biteSaverSavedAccountBuilder == null),
         'Bounded BiteSaver Home and Saved/Account must be selected together.',
       );

  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  static const String _onboardingSeenKey = 'first_time_onboarding_seen';

  late int selectedIndex;
  late AppMode selectedMode;
  late AppMode _retainedHomeMode;
  final List<int> _homeRefreshGenerations = List<int>.filled(
    AppMode.values.length,
    0,
  );
  StreamSubscription<Uri>? _appLinkSubscription;
  StreamSubscription<void>? _subscriptionReturnSubscription;
  StreamSubscription<Object?>? _subscriptionReturnOwnerSubscription;
  StreamSubscription<String>? _customerAuthRealmSubscription;
  bool _subscriptionReturnNavigationDrainQueued = false;
  int _subscriptionReturnNavigationRequestGeneration = 0;
  SubscriptionReturnOwnerScope? _subscriptionReturnMessageOwnerScope;
  int _subscriptionReturnMessageGeneration = 0;
  bool _showOnboarding = false;
  int _deepLinkGeneration = 0;
  _StartupDeepLinkGuard? _startupDeepLinkGuard;
  String? _lastHandledDeepLinkKey;
  DateTime? _lastHandledDeepLinkAt;
  late String _customerAuthRealm;
  int _authCacheGeneration = 0;
  MainNavigationController? _registeredNavigationController;
  Object? _navigationRegistrationToken;
  NavigatorState? _registeredNavigator;
  ModalRoute<dynamic>? _registeredRoute;

  @override
  void initState() {
    super.initState();
    _retainBiteSaverCustomerPath();
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
    _retainedHomeMode = selectedMode;
    final initialDeepLinkKey = initialCustomerDeepLink != null
        ? _customerDeepLinkDeduplicationKey(initialCustomerDeepLink)
        : initialInviteDeepLink != null
        ? _inviteDeepLinkDeduplicationKey(initialInviteDeepLink)
        : null;
    final startupGuard = initialDeepLinkKey == null
        ? null
        : _StartupDeepLinkGuard(initialDeepLinkKey);
    _startupDeepLinkGuard = startupGuard;
    AppModeStateService.setMode(selectedMode);
    AppModeStateService.selectedMode.addListener(_syncSelectedMode);
    _customerAuthRealm = _currentCustomerAuthRealm;
    _listenForCustomerAuthChanges();
    if (widget.initializePlatformServices ||
        widget.testIncomingDeepLinks != null ||
        widget.testIncomingRawDeepLinks != null) {
      _listenForAppLinks();
    }
    if (initialCustomerDeepLink != null) {
      final generation = ++_deepLinkGeneration;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _handleRestaurantLink(
          initialCustomerDeepLink,
          generation: generation,
          startupGuard: startupGuard,
          routeName: widget.initialDeepLinkRouteName,
        );
      });
    } else if (initialInviteDeepLink != null) {
      final generation = ++_deepLinkGeneration;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _handleInviteLink(
          initialInviteDeepLink,
          generation: generation,
          startupGuard: startupGuard,
          routeName: widget.initialDeepLinkRouteName,
        );
      });
    }
    if (widget.initializePlatformServices) {
      unawaited(_loadOnboardingState());
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _registerNavigationShell();
  }

  @override
  void didUpdateWidget(covariant MainNavigationScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    _retainBiteSaverCustomerPath();
    final oldController =
        oldWidget.navigationController ?? mainNavigationController;
    if (!identical(oldController, _effectiveNavigationController)) {
      _unregisterNavigationShell();
      _registerNavigationShell();
    }
  }

  @override
  void dispose() {
    _invalidateDeepLinkContext();
    _unregisterNavigationShell();
    AppModeStateService.selectedMode.removeListener(_syncSelectedMode);
    _appLinkSubscription?.cancel();
    _subscriptionReturnSubscription?.cancel();
    _subscriptionReturnOwnerSubscription?.cancel();
    _customerAuthRealmSubscription?.cancel();
    super.dispose();
  }

  MainNavigationController get _effectiveNavigationController =>
      widget.navigationController ?? mainNavigationController;

  BiteSaverBrowseHomeBuilder? get _biteSaverBrowseHomeBuilder =>
      widget.biteSaverBrowseHomeBuilder ??
      _effectiveNavigationController._biteSaverBrowseHomeBuilder ??
      mainNavigationController._biteSaverBrowseHomeBuilder;

  BiteSaverSavedAccountBuilder? get _biteSaverSavedAccountBuilder =>
      widget.biteSaverSavedAccountBuilder ??
      _effectiveNavigationController._biteSaverSavedAccountBuilder ??
      mainNavigationController._biteSaverSavedAccountBuilder;

  void _retainBiteSaverCustomerPath() {
    if (widget.testPagesBuilder == null &&
        (widget.biteSaverBrowseHomeBuilder == null) !=
            (widget.biteSaverSavedAccountBuilder == null)) {
      throw StateError(
        'Bounded BiteSaver Home and Saved/Account must be selected together.',
      );
    }
    final browse = _biteSaverBrowseHomeBuilder;
    final saved = _biteSaverSavedAccountBuilder;
    if (browse != null && saved != null) {
      _effectiveNavigationController._retainBiteSaverCustomerPath(
        browse: browse,
        saved: saved,
      );
    }
  }

  void _registerNavigationShell() {
    final navigator = Navigator.maybeOf(context, rootNavigator: true);
    final route = ModalRoute.of(context);
    final controller = _effectiveNavigationController;
    if (navigator == null || route == null) {
      return;
    }
    if (identical(_registeredNavigationController, controller) &&
        identical(_registeredNavigator, navigator) &&
        identical(_registeredRoute, route)) {
      return;
    }

    _unregisterNavigationShell();
    _registeredNavigationController = controller;
    _registeredNavigator = navigator;
    _registeredRoute = route;
    _navigationRegistrationToken = controller.attach(
      navigator: navigator,
      route: route,
      selectDestination: _selectRootDestination,
      refreshHomes: _refreshRootHomes,
      authRealm: _customerAuthRealm,
    );
  }

  void _unregisterNavigationShell() {
    final controller = _registeredNavigationController;
    final token = _navigationRegistrationToken;
    if (controller != null && token != null) {
      controller.detach(token);
    }
    _registeredNavigationController = null;
    _navigationRegistrationToken = null;
    _registeredNavigator = null;
    _registeredRoute = null;
  }

  bool _selectRootDestination(
    AppMode mode,
    int index,
    Set<AppMode> refreshHomeModes,
  ) {
    if (!mounted) {
      return false;
    }
    final normalizedIndex = normalizeMainNavigationIndex(index);
    if (selectedMode != mode ||
        selectedIndex != normalizedIndex ||
        refreshHomeModes.isNotEmpty) {
      setState(() {
        selectedMode = mode;
        selectedIndex = normalizedIndex;
        if (normalizedIndex == 0) {
          _retainedHomeMode = mode;
        }
        for (final refreshHomeMode in refreshHomeModes) {
          _homeRefreshGenerations[refreshHomeMode.index] += 1;
        }
      });
    }
    AppModeStateService.setMode(mode);
    return true;
  }

  bool _refreshRootHomes(Set<AppMode> refreshHomeModes) {
    if (!mounted) {
      return false;
    }
    if (refreshHomeModes.isNotEmpty) {
      setState(() {
        for (final refreshHomeMode in refreshHomeModes) {
          _homeRefreshGenerations[refreshHomeMode.index] += 1;
        }
      });
    }
    return true;
  }

  void _listenForCustomerAuthChanges() {
    final testChanges = widget.testCustomerAuthRealmChanges;
    if (testChanges != null) {
      _customerAuthRealmSubscription = testChanges.listen(
        _handleCustomerAuthRealmChanged,
        onError: (_) {},
      );
      return;
    }
    if (!widget.initializePlatformServices) {
      return;
    }

    _customerAuthRealmSubscription = FirebaseAuth.instance
        .userChanges()
        .map(_customerAuthRealmForUser)
        .listen(_handleCustomerAuthRealmChanged, onError: (_) {});
  }

  String get _currentCustomerAuthRealm {
    final testProvider = widget.testCustomerAuthRealmProvider;
    if (testProvider != null) {
      return testProvider();
    }
    try {
      return mainNavigationAuthRealmForUser(FirebaseAuth.instance.currentUser);
    } catch (_) {
      return 'guest';
    }
  }

  String _customerAuthRealmForUser(User? user) {
    return mainNavigationAuthRealmForUser(user);
  }

  void _handleCustomerAuthRealmChanged(String realm) {
    if (!mounted) {
      return;
    }
    if (realm == _customerAuthRealm) {
      final navigator = _registeredNavigator;
      if (navigator != null) {
        _effectiveNavigationController.notifySameAuthRealm(
          navigator: navigator,
          authRealm: realm,
        );
      }
      return;
    }
    final previousRealm = _customerAuthRealm;
    _invalidateDeepLinkContext();
    _subscriptionReturnNavigationRequestGeneration += 1;
    final navigator = _registeredNavigator;
    if (navigator != null) {
      _effectiveNavigationController.replaceAuthRealm(
        navigator: navigator,
        previousRealm: previousRealm,
        nextRealm: realm,
      );
    }
    setState(() {
      _customerAuthRealm = realm;
      _authCacheGeneration += 1;
    });
  }

  void _invalidateDeepLinkContext() {
    _deepLinkGeneration += 1;
    _startupDeepLinkGuard = null;
    _lastHandledDeepLinkKey = null;
    _lastHandledDeepLinkAt = null;
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
      _retainedHomeMode = AppMode.biteSaver;
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
    final inviteLink = RestaurantInviteService.parseInviteDeepLink(uri);
    final customerLink = RestaurantCustomerLinkService.parseRestaurantDeepLink(
      uri,
    );
    final key = inviteLink != null
        ? _inviteDeepLinkDeduplicationKey(inviteLink)
        : customerLink != null
        ? _customerDeepLinkDeduplicationKey(customerLink)
        : uri.toString();
    final isRecognizedLink = inviteLink != null || customerLink != null;
    final startupGuard = _startupDeepLinkGuard;
    if (startupGuard != null && isRecognizedLink) {
      // The platform may deliver the same cold-start link through its stream
      // while its exact initial destination is still active. Keep this guard
      // tied to that route's lifecycle instead of a timeout or permanent URL
      // cache. A distinct recognized link supersedes the startup navigation.
      if (key == startupGuard.key) {
        return true;
      }
      if (identical(_startupDeepLinkGuard, startupGuard)) {
        _startupDeepLinkGuard = null;
      }
    }
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

  String _inviteDeepLinkDeduplicationKey(RestaurantInviteDeepLink link) {
    return 'invite:${link.side}:${link.token}';
  }

  String _customerDeepLinkDeduplicationKey(RestaurantCustomerDeepLink link) {
    return 'restaurant:${link.side}:${link.restaurantId}';
  }

  void _handleInviteLink(
    RestaurantInviteDeepLink inviteLink, {
    required int generation,
    _StartupDeepLinkGuard? startupGuard,
    String? routeName,
  }) {
    _pushDeepLinkRoute(
      MaterialPageRoute<void>(
        settings: RouteSettings(
          name: routeName ?? _publicInviteRouteName(inviteLink),
        ),
        builder: (_) =>
            widget.testInviteDeepLinkBuilder?.call(inviteLink) ??
            RestaurantInvitePreviewScreen(
              side: inviteLink.side,
              token: inviteLink.token,
            ),
      ),
      generation: generation,
      startupGuard: startupGuard,
    );
  }

  void _handleRestaurantLink(
    RestaurantCustomerDeepLink restaurantLink, {
    required int generation,
    _StartupDeepLinkGuard? startupGuard,
    String? routeName,
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
        _retainedHomeMode = nextMode;
      });
    }
    AppModeStateService.setMode(nextMode);

    _pushDeepLinkRoute(
      MaterialPageRoute<bool>(
        settings: RouteSettings(
          name: routeName ?? _publicCustomerRouteName(restaurantLink),
        ),
        builder: (_) =>
            widget.testCustomerDeepLinkBuilder?.call(restaurantLink) ??
            RestaurantCustomerDeepLinkScreen(
              side: restaurantLink.side,
              restaurantId: restaurantLink.restaurantId,
            ),
      ),
      generation: generation,
      replaceCustomerDeepLinks: true,
      startupGuard: startupGuard,
      returnRefreshMode: nextMode,
    );
  }

  void _pushDeepLinkRoute<T>(
    Route<T> route, {
    required int generation,
    bool replaceCustomerDeepLinks = false,
    _StartupDeepLinkGuard? startupGuard,
    AppMode? returnRefreshMode,
    int attempt = 0,
  }) {
    if (!mounted || generation != _deepLinkGeneration) {
      return;
    }

    final navigator =
        rootNavigatorKey.currentState ??
        Navigator.maybeOf(context, rootNavigator: true);
    if (navigator != null) {
      final returnDelivery = returnRefreshMode == null
          ? null
          : _effectiveNavigationController.captureRouteReturnDelivery(
              navigator: navigator,
              mode: returnRefreshMode,
            );
      late final Future<T?> routeCompletion;
      if (replaceCustomerDeepLinks) {
        routeCompletion = navigator.pushAndRemoveUntil<T>(route, (
          existingRoute,
        ) {
          final name = existingRoute.settings.name;
          return RestaurantCustomerLinkService.parseRestaurantRouteName(name) ==
              null;
        });
      } else {
        routeCompletion = navigator.push<T>(route);
      }
      unawaited(
        routeCompletion
            .then((result) {
              if (returnDelivery != null) {
                returnDelivery.complete(routeReportedChange: result == true);
              }
            })
            .whenComplete(() {
              if (startupGuard != null) {
                _clearStartupDeepLinkGuard(startupGuard);
              }
            }),
      );
      return;
    }

    if (attempt >= 8) {
      if (startupGuard != null) {
        _clearStartupDeepLinkGuard(startupGuard);
      }
      return;
    }

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _pushDeepLinkRoute(
        route,
        generation: generation,
        replaceCustomerDeepLinks: replaceCustomerDeepLinks,
        startupGuard: startupGuard,
        returnRefreshMode: returnRefreshMode,
        attempt: attempt + 1,
      );
    });
  }

  void _clearStartupDeepLinkGuard(_StartupDeepLinkGuard guard) {
    if (mounted && identical(_startupDeepLinkGuard, guard)) {
      _startupDeepLinkGuard = null;
    }
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
    final authGeneration = _authCacheGeneration;
    var handledRequestGeneration =
        _subscriptionReturnNavigationRequestGeneration;
    try {
      final ownerScope = _currentSubscriptionReturnOwnerScope;
      if (ownerScope == null) {
        if (await SubscriptionReturnService.hasPendingLocalDelivery() &&
            mounted &&
            authGeneration == _authCacheGeneration &&
            _currentSubscriptionReturnOwnerScope == null) {
          _handleSignedOutSubscriptionReturn();
        }
        return;
      }

      while (mounted &&
          authGeneration == _authCacheGeneration &&
          ownerScope == _currentSubscriptionReturnOwnerScope) {
        final event = await SubscriptionReturnService.peekPendingNavigationFor(
          ownerScope,
          isCurrent: () =>
              mounted &&
              authGeneration == _authCacheGeneration &&
              ownerScope == _currentSubscriptionReturnOwnerScope,
        );
        if (!mounted ||
            authGeneration != _authCacheGeneration ||
            ownerScope != _currentSubscriptionReturnOwnerScope) {
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
                  mounted &&
                  authGeneration == _authCacheGeneration &&
                  ownerScope == _currentSubscriptionReturnOwnerScope,
            )) {
          return;
        }
        if (!mounted ||
            authGeneration != _authCacheGeneration ||
            ownerScope != _currentSubscriptionReturnOwnerScope) {
          return;
        }
        widget.testOnSubscriptionReturnNavigationClaimed?.call(event);
        if (!mounted ||
            authGeneration != _authCacheGeneration ||
            ownerScope != _currentSubscriptionReturnOwnerScope) {
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
    final authGeneration = _authCacheGeneration;
    setState(() {
      selectedIndex = 1;
      selectedMode = AppMode.biteSaver;
    });
    AppModeStateService.setMode(AppMode.biteSaver);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted &&
          authGeneration == _authCacheGeneration &&
          _currentSubscriptionReturnOwnerScope == null) {
        final navigator = rootNavigatorKey.currentState;
        if (navigator != null) {
          _effectiveNavigationController.selectExistingShellDestination(
            navigator: navigator,
            mode: AppMode.biteSaver,
            index: 1,
          );
          navigator.popUntil((route) => route.isFirst);
        }
      }
    });
  }

  void _handleSubscriptionReturn(SubscriptionReturnEvent event) {
    if (!mounted || event.ownerScope != _currentSubscriptionReturnOwnerScope) {
      return;
    }
    final authGeneration = _authCacheGeneration;
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
          authGeneration != _authCacheGeneration ||
          event.ownerScope != _currentSubscriptionReturnOwnerScope) {
        return;
      }

      final navigator = rootNavigatorKey.currentState;
      if (navigator != null) {
        _effectiveNavigationController.selectExistingShellDestination(
          navigator: navigator,
          mode: AppMode.biteSaver,
          index: 1,
        );
      }
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
    _applyPendingHomeRefreshes();
    setState(() {
      selectedMode = nextMode;
      selectedIndex = 0;
      _retainedHomeMode = nextMode;
    });
  }

  void _applyPendingHomeRefreshes() {
    final navigator = _registeredNavigator;
    if (navigator != null) {
      _effectiveNavigationController.applyPendingHomeRefreshes(navigator);
    }
  }

  Widget _buildModeHomePage(AppMode mode) {
    final navigationRefreshGeneration = _homeRefreshGenerations[mode.index];
    final testBuilder = widget.testModeHomeBuilder;
    if (testBuilder != null) {
      return testBuilder(mode, navigationRefreshGeneration);
    }
    final boundedBuilder = _biteSaverBrowseHomeBuilder;
    if (mode == AppMode.biteSaver && boundedBuilder != null) {
      return boundedBuilder(
        context,
        navigationRefreshGeneration,
        _customerAuthRealm,
      );
    }
    return mode == AppMode.biteSaver
        ? HomeScreen(
            key: const ValueKey('bitesaver-home'),
            navigationRefreshGeneration: navigationRefreshGeneration,
          )
        : BiteScoreHomeScreen(
            key: const ValueKey('bitescore-home'),
            navigationRefreshGeneration: navigationRefreshGeneration,
          );
  }

  Widget _buildPage(AppMode mode, int index) {
    if (index == 0 &&
        (widget.testModeHomeBuilder != null ||
            (mode == AppMode.biteSaver &&
                _biteSaverBrowseHomeBuilder != null))) {
      return _buildModeHomePage(mode);
    }
    final testPages = widget.testPagesBuilder?.call(mode);
    if (testPages != null) {
      assert(testPages.length == mainNavigationItems.length);
      return testPages[index];
    }

    // Account exposes BiteSaver Saved in both modes.
    if (index == 2 && _biteSaverBrowseHomeBuilder != null) {
      final accountBuilder = _biteSaverSavedAccountBuilder;
      if (accountBuilder == null) {
        throw StateError(
          'Bounded BiteSaver Home requires its canonical Saved/Account builder.',
        );
      }
      return accountBuilder(context, _customerAuthRealm);
    }

    return switch (index) {
      0 => _buildModeHomePage(mode),
      1 => const RestaurantAuthScreen(),
      2 => const CustomerAccountScreen(),
      _ => const SizedBox.shrink(),
    };
  }

  void _setMode(AppMode mode) {
    if (selectedMode == mode) return;
    _applyPendingHomeRefreshes();
    AppModeStateService.setMode(mode);
  }

  void _selectTab(int index) {
    final normalizedIndex = normalizeMainNavigationIndex(index);
    _applyPendingHomeRefreshes();
    setState(() {
      selectedIndex = normalizedIndex;
      if (normalizedIndex == 0) {
        _retainedHomeMode = selectedMode;
      }
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
    return _LazyIndexedStack(
      key: ValueKey<int>(_authCacheGeneration),
      index: selectedIndex,
      itemCount: mainNavigationItems.length,
      itemBuilder: (context, index) {
        if (index != 0) {
          return _buildPage(selectedMode, index);
        }
        return _LazyIndexedStack(
          index: _retainedHomeMode.index,
          itemCount: AppMode.values.length,
          itemBuilder: (context, modeIndex) {
            return _buildPage(AppMode.values[modeIndex], 0);
          },
        );
      },
    );
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

class _LazyIndexedStack extends StatefulWidget {
  final int index;
  final int itemCount;
  final IndexedWidgetBuilder itemBuilder;

  const _LazyIndexedStack({
    super.key,
    required this.index,
    required this.itemCount,
    required this.itemBuilder,
  });

  @override
  State<_LazyIndexedStack> createState() => _LazyIndexedStackState();
}

class _LazyIndexedStackState extends State<_LazyIndexedStack> {
  final Set<int> _visitedIndexes = <int>{};

  @override
  void initState() {
    super.initState();
    _visitedIndexes.add(widget.index);
  }

  @override
  void didUpdateWidget(covariant _LazyIndexedStack oldWidget) {
    super.didUpdateWidget(oldWidget);
    _visitedIndexes.add(widget.index);
  }

  @override
  Widget build(BuildContext context) {
    assert(widget.itemCount > 0);
    assert(widget.index >= 0 && widget.index < widget.itemCount);
    return IndexedStack(
      index: widget.index,
      children: <Widget>[
        for (var index = 0; index < widget.itemCount; index += 1)
          if (_visitedIndexes.contains(index))
            KeyedSubtree(
              key: ValueKey<int>(index),
              child: widget.itemBuilder(context, index),
            )
          else
            SizedBox.shrink(key: ValueKey<int>(index)),
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
