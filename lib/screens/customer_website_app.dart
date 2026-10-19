import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/app_mode_state_service.dart';
import '../services/customer_website_runtime.dart';
import '../services/customer_website_routes.dart';
import '../services/restaurant_customer_link_service.dart';

/// Flutter's browser Router owns URL history; existing customer screens keep
/// their Navigator-based dialogs, auth leases and detail navigation.
class CustomerWebsiteApp extends StatefulWidget {
  const CustomerWebsiteApp({
    super.key,
    required this.navigatorKey,
    required this.messengerKey,
    required this.routeFactory,
    required this.theme,
    required this.scrollBehavior,
    required this.builder,
  });
  final GlobalKey<NavigatorState> navigatorKey;
  final GlobalKey<ScaffoldMessengerState> messengerKey;
  final RouteFactory routeFactory;
  final ThemeData theme;
  final ScrollBehavior scrollBehavior;
  final TransitionBuilder builder;

  @override
  State<CustomerWebsiteApp> createState() => _CustomerWebsiteAppState();
}

class _CustomerWebsiteAppState extends State<CustomerWebsiteApp> {
  late final _CustomerRouter delegate = _CustomerRouter(
    widget.navigatorKey,
    widget.routeFactory,
  );
  late final CustomerWebsiteRouteInformationProvider provider =
      CustomerWebsiteRouteInformationProvider(
        RouteInformation(
          uri: Uri.parse(
            WidgetsBinding.instance.platformDispatcher.defaultRouteName,
          ),
        ),
      );
  @override
  void dispose() {
    provider.dispose();
    delegate.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp.router(
    title: 'BiteStar',
    debugShowCheckedModeBanner: false,
    scaffoldMessengerKey: widget.messengerKey,
    theme: widget.theme,
    scrollBehavior: widget.scrollBehavior,
    builder: widget.builder,
    routeInformationProvider: provider,
    routerDelegate: delegate,
    routeInformationParser: const _CustomerRouteParser(),
  );
}

class _CustomerRouteParser
    extends RouteInformationParser<CustomerWebsiteLocation> {
  const _CustomerRouteParser();
  @override
  Future<CustomerWebsiteLocation> parseRouteInformation(
    RouteInformation information,
  ) async {
    final state = information.state;
    final key = state is Map ? state[CustomerWebsiteLocation.stateKey] : null;
    return CustomerWebsiteLocation(
      information.uri.toString().startsWith('/')
          ? information.uri.toString()
          : '/',
      entryKey: key is String && key.length <= 100 ? key : null,
    );
  }

  @override
  RouteInformation restoreRouteInformation(
    CustomerWebsiteLocation configuration,
  ) => RouteInformation(
    uri: Uri.parse(configuration.location),
    state: {
      if (configuration.entryKey != null)
        CustomerWebsiteLocation.stateKey: configuration.entryKey,
    },
  );
}

class _CustomerHistoryEntry {
  _CustomerHistoryEntry(this.key, this.route, this.reopen);
  final String key;
  Route<dynamic>? route;
  final Route<dynamic>? Function() reopen;
}

class _CustomerRouter extends RouterDelegate<CustomerWebsiteLocation>
    with
        ChangeNotifier,
        PopNavigatorRouterDelegateMixin<CustomerWebsiteLocation> {
  _CustomerRouter(this.navigatorKey, this.factory) {
    observer = _CustomerRouteObserver(_routeChanged, _entry);
  }
  @override
  final GlobalKey<NavigatorState> navigatorKey;
  final RouteFactory factory;
  late final _CustomerRouteObserver observer;
  CustomerWebsiteLocation _configuration = const CustomerWebsiteLocation('/');
  String get _location => _configuration.location;
  final String _session = List.generate(
    4,
    (_) => Random.secure().nextInt(0x100000000).toRadixString(16),
  ).join();
  int _nextEntry = 0;
  final Map<String, List<_CustomerHistoryEntry>> _history = {};
  _CustomerHistoryEntry? _replaying;
  String _initialLocation = '/';
  bool _applyingBrowserLocation = false;
  bool _notificationQueued = false;
  bool _initialRouteReceived = false;
  bool _disposed = false;

  @override
  CustomerWebsiteLocation? get currentConfiguration =>
      _initialRouteReceived ? _configuration : null;

  _CustomerHistoryEntry? _entry(Route<dynamic> route) {
    final replaying = _replaying;
    if (replaying != null) {
      replaying.route = route;
      return replaying;
    }
    if (route is! PageRoute) return null;
    final settings = route.settings;
    final Route<dynamic>? Function() reopen;
    if (settings is CustomerWebsiteVisitSettings) {
      reopen = settings.reopen;
    } else if (settings.name != null) {
      final name = settings.name;
      reopen = () => _route(RouteSettings(name: name));
    } else {
      return null;
    }
    return _CustomerHistoryEntry('$_session-${++_nextEntry}', route, reopen);
  }

  @override
  Future<void> setInitialRoutePath(
    CustomerWebsiteLocation configuration,
  ) async {
    _initialRouteReceived = true;
    _initialLocation = configuration.location;
    if (navigatorKey.currentState != null) {
      await setNewRoutePath(configuration);
    } else {
      _configuration = configuration;
      _scheduleMode(configuration.location);
    }
  }

  @override
  Future<void> setNewRoutePath(CustomerWebsiteLocation configuration) async {
    if (configuration == _configuration) return;
    _configuration = configuration;
    final navigator = navigatorKey.currentState;
    if (navigator == null) {
      _initialLocation = configuration.location;
      return;
    }
    _applyingBrowserLocation = true;
    try {
      final target = _history[configuration.entryKey];
      if (target != null) {
        var common = 0;
        while (common < target.length &&
            common < observer.entries.length &&
            identical(target[common], observer.entries[common])) {
          common++;
        }
        final keep = common == 0 ? null : target[common - 1].route;
        if (keep != null) {
          navigator.popUntil((route) => identical(route, keep));
        } else {
          navigator.popUntil((route) => route.isFirst);
        }
        for (final entry in target.skip(common)) {
          final route = entry.reopen();
          if (route == null) {
            break; // Expired search/auth authority: keep safe parent.
          }
          _replaying = entry;
          if (common == 0) {
            navigator.pushReplacement(route);
          } else {
            navigator.push(route);
          }
          _replaying = null;
          common++;
        }
      } else {
        // Reload/new public URL has no session registry. Re-resolve public IDs;
        // never resurrect a serialized private search or auth capability.
        navigator.popUntil((route) => route.isFirst);
        final detail = CustomerWebsiteDetailRoute.parse(configuration.location);
        final link = RestaurantCustomerLinkService.parseRestaurantRouteName(
          configuration.location,
        );
        if (link == null) {
          navigator.pushReplacementNamed(configuration.location);
        } else {
          navigator.pushReplacementNamed(
            CustomerWebsiteRuntime.homeRoute(link.isBiteScore),
          );
          if (detail != null) {
            navigator.pushNamed(detail.restaurantLocation);
          }
          navigator.pushNamed(configuration.location);
        }
      }
    } finally {
      _replaying = null;
      _applyingBrowserLocation = false;
    }
    _routeChanged();
  }

  void _routeChanged() {
    if (_disposed || _applyingBrowserLocation || observer.entries.isEmpty) {
      return;
    }
    final entries = List<_CustomerHistoryEntry>.of(observer.entries);
    final last = entries.last;
    var location = '/';
    for (final entry in entries.reversed) {
      final name = entry.route?.settings.name;
      if (name != null) {
        location = name;
        break;
      }
    }
    _configuration = CustomerWebsiteLocation(location, entryKey: last.key);
    _history[last.key] = entries;
    if (!_initialRouteReceived || _notificationQueued) return;
    _notificationQueued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _notificationQueued = false;
      if (_disposed) return;
      _syncMode(_location);
      notifyListeners();
    });
  }

  void _scheduleMode(String name) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_disposed && name == _location) _syncMode(name);
    });
  }

  void _syncMode(String name) {
    final link = RestaurantCustomerLinkService.parseRestaurantRouteName(name);
    if (name == '/browse/bitescore' || link?.isBiteScore == true) {
      AppModeStateService.setMode(AppMode.biteScore);
    } else if (name == '/' ||
        name == '/browse/coupons' ||
        name == '/account' ||
        link?.isCoupon == true) {
      AppModeStateService.setMode(AppMode.biteSaver);
    }
  }

  Route<dynamic> _route(RouteSettings settings) =>
      factory(settings) ??
      MaterialPageRoute<void>(
        settings: settings,
        builder: (context) => Scaffold(
          appBar: AppBar(title: const Text('BiteStar')),
          body: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('This page is not available.'),
                TextButton(
                  onPressed: () =>
                      Navigator.of(context).pushReplacementNamed('/'),
                  child: const Text('Go to BiteStar'),
                ),
              ],
            ),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) => Navigator(
    key: navigatorKey,
    observers: [observer],
    initialRoute: _initialLocation,
    onGenerateInitialRoutes: (_, name) {
      final link = RestaurantCustomerLinkService.parseRestaurantRouteName(name);
      final detail = CustomerWebsiteDetailRoute.parse(name);
      return [
        if (link != null)
          _route(
            RouteSettings(
              name: CustomerWebsiteRuntime.homeRoute(link.isBiteScore),
            ),
          ),
        if (detail != null)
          _route(RouteSettings(name: detail.restaurantLocation)),
        _route(RouteSettings(name: name)),
      ];
    },
    onGenerateRoute: _route,
    // Router/PlatformRouteInformationProvider owns multi-entry browser history.
    reportsRouteUpdateToEngine: false,
  );
  @override
  void dispose() {
    _disposed = true;
    _history.clear();
    super.dispose();
  }
}

class _CustomerRouteObserver extends NavigatorObserver {
  _CustomerRouteObserver(this.changed, this.createEntry);
  final VoidCallback changed;
  final _CustomerHistoryEntry? Function(Route<dynamic>) createEntry;
  final List<_CustomerHistoryEntry> entries = [];
  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    final entry = createEntry(route);
    if (entry != null) entries.add(entry);
    changed();
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    _releaseRoute(route);
    changed();
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    _releaseRoute(route);
    changed();
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    final index = entries.indexWhere(
      (entry) => identical(entry.route, oldRoute),
    );
    if (index >= 0) entries[index].route = null;
    final entry = newRoute == null ? null : createEntry(newRoute);
    if (index >= 0) {
      if (entry == null) {
        entries.removeAt(index);
      } else {
        entries[index] = entry;
      }
    } else if (entry != null) {
      entries.add(entry);
    }
    changed();
  }

  void _releaseRoute(Route<dynamic> route) {
    entries.removeWhere((entry) {
      if (!identical(entry.route, route)) return false;
      // Forward retains its factory/key, not a disposed route's captured state.
      entry.route = null;
      return true;
    });
  }
}

/// Flutter 3.44's web URI history handler decodes percent escapes again when
/// processing its `uri` field (engine/window.dart:679). The supported raw
/// `location` field preserves the exact encoded route. Keep this web-only
/// adapter until the engine no longer changes permanent document identities.
class CustomerWebsiteRouteInformationProvider extends RouteInformationProvider
    with WidgetsBindingObserver, ChangeNotifier {
  CustomerWebsiteRouteInformationProvider(this._value);
  RouteInformation _value;
  bool _browserArrival = false;
  bool _hasReported = false;
  @override
  RouteInformation get value => _value;

  @override
  void routerReportsNewRouteInformation(
    RouteInformation routeInformation, {
    RouteInformationReportingType type = RouteInformationReportingType.none,
  }) {
    final replace = switch (type) {
      RouteInformationReportingType.neglect => true,
      RouteInformationReportingType.navigate => false,
      RouteInformationReportingType.none =>
        (!_hasReported && _value.uri == routeInformation.uri) ||
            _browserArrival ||
            (_value.uri == routeInformation.uri &&
                _entryKey(_value.state) == _entryKey(routeInformation.state)),
    };
    _browserArrival = false;
    _hasReported = true;
    SystemNavigator.selectMultiEntryHistory();
    SystemChannels.navigation.invokeMethod<void>('routeInformationUpdated', {
      'location': routeInformation.uri.toString(),
      'state': routeInformation.state,
      'replace': replace,
    });
    _value = routeInformation;
  }

  Object? _entryKey(Object? state) =>
      state is Map ? state[CustomerWebsiteLocation.stateKey] : null;

  @override
  Future<bool> didPushRouteInformation(
    RouteInformation routeInformation,
  ) async {
    _browserArrival = true;
    _value = routeInformation;
    notifyListeners();
    return true;
  }

  @override
  void addListener(VoidCallback listener) {
    if (!hasListeners) WidgetsBinding.instance.addObserver(this);
    super.addListener(listener);
  }

  @override
  void removeListener(VoidCallback listener) {
    super.removeListener(listener);
    if (!hasListeners) WidgetsBinding.instance.removeObserver(this);
  }

  @override
  void dispose() {
    if (hasListeners) WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}
