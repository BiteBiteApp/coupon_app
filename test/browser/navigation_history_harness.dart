import 'dart:async';
import 'dart:js_interop';

import 'package:coupon_app/main.dart' as production_app;
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/restaurant_customer_link_service.dart';
import 'package:coupon_app/services/restaurant_invite_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:web/web.dart' as web;

const String _cspProbeUrl =
    'https://navigation-history-harness.invalid/blocked-probe';

const _HarnessLink _primaryCustomerLink = _HarnessLink(
  kind: _HarnessDestinationKind.customer,
  label: 'customer:bitescore:history-review',
  publicRoute: '/r/bitescore/history-review',
  rawLink: 'https://go.bitestar.app/r/bitescore/history-review',
  mode: AppMode.biteScore,
);

const _HarnessLink _alternateCustomerLink = _HarnessLink(
  kind: _HarnessDestinationKind.customer,
  label: 'customer:bitescore:history-alternate',
  publicRoute: '/r/bitescore/history-alternate',
  rawLink: 'https://go.bitestar.app/r/bitescore/history-alternate',
  mode: AppMode.biteScore,
);

const _HarnessLink _runtimeBiteScoreCustomerLink = _HarnessLink(
  kind: _HarnessDestinationKind.customer,
  label: 'customer:bitescore:runtime-bitescore',
  publicRoute: '/r/bitescore/runtime-bitescore',
  rawLink: 'https://go.bitestar.app/r/bitescore/runtime-bitescore',
  mode: AppMode.biteScore,
);

const _HarnessLink _runtimeBiteSaverCustomerLink = _HarnessLink(
  kind: _HarnessDestinationKind.customer,
  label: 'customer:coupons:runtime-bitesaver',
  publicRoute: '/r/coupons/runtime-bitesaver',
  rawLink: 'https://go.bitestar.app/r/coupons/runtime-bitesaver',
  mode: AppMode.biteSaver,
);

const _HarnessLink _inviteLink = _HarnessLink(
  kind: _HarnessDestinationKind.invite,
  label: 'invite:bitescore:history-invite-token',
  publicRoute: '/invite/bitescore/history-invite-token',
  rawLink: 'https://go.bitestar.app/invite/bitescore/history-invite-token',
  mode: AppMode.biteScore,
);

/// Browser-only entrypoint for the isolated navigation/history regression.
///
/// This deliberately does not call `production_app.main()`: Firebase and the
/// normal authentication bootstrap therefore never run. The server paired
/// with this entrypoint supplies the pre-load network boundary and request
/// ledger.
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SharedPreferences.setMockInitialValues(<String, Object>{});
  runApp(const _NavigationHistoryHarnessApp());
}

class _NavigationHistoryHarnessApp extends StatefulWidget {
  const _NavigationHistoryHarnessApp();

  @override
  State<_NavigationHistoryHarnessApp> createState() =>
      _NavigationHistoryHarnessAppState();
}

class _NavigationHistoryHarnessAppState
    extends State<_NavigationHistoryHarnessApp> {
  late final StreamController<String> _incomingLinks;
  late final _HarnessLedger _ledger;
  late final SemanticsHandle _semanticsHandle;
  late final VoidCallback _selectedModeListener;

  @override
  void initState() {
    super.initState();
    _semanticsHandle = SemanticsBinding.instance.ensureSemantics();
    _incomingLinks = StreamController<String>.broadcast(sync: true);
    _ledger = _HarnessLedger(
      selectedMode: AppModeStateService.selectedMode.value,
    );
    _selectedModeListener = () {
      _ledger.recordSelectedMode(AppModeStateService.selectedMode.value);
    };
    AppModeStateService.selectedMode.addListener(_selectedModeListener);
  }

  @override
  void dispose() {
    unawaited(_incomingLinks.close());
    AppModeStateService.selectedMode.removeListener(_selectedModeListener);
    _ledger.dispose();
    _semanticsHandle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return production_app.CouponApp(
      testWrapCelebrationHosts: false,
      testCustomerRouteBuilder: (link) => _HarnessDestinationPage(
        link: _HarnessLink.fromCustomer(link),
        ledger: _ledger,
        incomingLinks: _incomingLinks,
      ),
      testInviteRouteBuilder: (link) => _HarnessDestinationPage(
        link: _HarnessLink.fromInvite(link),
        ledger: _ledger,
        incomingLinks: _incomingLinks,
      ),
      testNavigationBuilder: (customerLink, inviteLink) {
        return _HarnessNavigationShell(
          ledger: _ledger,
          incomingLinks: _incomingLinks,
          initialCustomerLink: customerLink,
          initialInviteLink: inviteLink,
        );
      },
    );
  }
}

class _HarnessNavigationShell extends StatefulWidget {
  final _HarnessLedger ledger;
  final StreamController<String> incomingLinks;
  final RestaurantCustomerDeepLink? initialCustomerLink;
  final RestaurantInviteDeepLink? initialInviteLink;

  const _HarnessNavigationShell({
    required this.ledger,
    required this.incomingLinks,
    required this.initialCustomerLink,
    required this.initialInviteLink,
  });

  @override
  State<_HarnessNavigationShell> createState() =>
      _HarnessNavigationShellState();
}

class _HarnessNavigationShellState extends State<_HarnessNavigationShell> {
  final Object _shellToken = Object();

  @override
  void initState() {
    super.initState();
    widget.ledger.mountShell(_shellToken);
  }

  @override
  void dispose() {
    widget.ledger.unmountShell(_shellToken);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MainNavigationScreen(
      initialCustomerDeepLink: widget.initialCustomerLink,
      initialInviteDeepLink: widget.initialInviteLink,
      initializePlatformServices: false,
      testIncomingRawDeepLinks: widget.incomingLinks.stream,
      testRestaurantUserSignedIn: false,
      testSubscriptionReturnOwnerScopeProvider: () => null,
      testSuppressSubscriptionReturnSnackBar: true,
      testCustomerAuthRealmProvider: () => 'guest',
      testPagesBuilder: (mode) => <Widget>[
        _HarnessHomePage(
          mode: mode,
          ledger: widget.ledger,
          incomingLinks: widget.incomingLinks,
        ),
        _HarnessStaticPage(
          title: '${mode.name} synthetic Restaurant Hub',
          ledger: widget.ledger,
        ),
        _HarnessStaticPage(
          title: '${mode.name} synthetic Account',
          ledger: widget.ledger,
          frameworkRuntimeLink: mode == AppMode.biteSaver
              ? _runtimeBiteScoreCustomerLink
              : _runtimeBiteSaverCustomerLink,
        ),
      ],
      testCustomerDeepLinkBuilder: (link) => _HarnessDestinationPage(
        link: _HarnessLink.fromCustomer(link),
        ledger: widget.ledger,
        incomingLinks: widget.incomingLinks,
      ),
      testInviteDeepLinkBuilder: (link) => _HarnessDestinationPage(
        link: _HarnessLink.fromInvite(link),
        ledger: widget.ledger,
        incomingLinks: widget.incomingLinks,
      ),
    );
  }
}

class _HarnessHomePage extends StatelessWidget {
  final AppMode mode;
  final _HarnessLedger ledger;
  final StreamController<String> incomingLinks;

  const _HarnessHomePage({
    required this.mode,
    required this.ledger,
    required this.incomingLinks,
  });

  void _emit(_HarnessLink link) {
    ledger.recordAction('emit:${link.label}');
    if (!incomingLinks.isClosed) {
      incomingLinks.add(link.rawLink);
    }
  }

  Future<void> _runCspProbe() async {
    ledger.recordProbe('pending');
    try {
      final response = await web.window
          .fetch(_cspProbeUrl.toJS)
          .toDart
          .timeout(const Duration(seconds: 4));
      ledger.recordProbe('UNEXPECTED_HTTP_${response.status}');
    } catch (_) {
      ledger.recordProbe('blocked');
    }
  }

  @override
  Widget build(BuildContext context) {
    final routeName = ModalRoute.of(context)?.settings.name ?? '<unnamed>';
    return _HarnessScaffold(
      title: 'Synthetic ${mode.name} Home',
      ledger: ledger,
      children: <Widget>[
        const Text(
          'SYNTHETIC OFFLINE NAVIGATION HARNESS',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        Text('Current route name: $routeName'),
        const Text(
          'Use these controls after cold-start, reload, Back, or Safe Home. '
          'No production Home, owner, auth, mutation, or Firebase service is '
          'constructed by this entrypoint.',
        ),
        FilledButton(
          key: const ValueKey('emit-primary-customer-link'),
          onPressed: () => _emit(_primaryCustomerLink),
          child: const Text('Emit primary customer link'),
        ),
        FilledButton.tonal(
          key: const ValueKey('emit-alternate-customer-link'),
          onPressed: () => _emit(_alternateCustomerLink),
          child: const Text('Emit alternate customer link'),
        ),
        FilledButton.tonal(
          key: const ValueKey('emit-invite-link'),
          onPressed: () => _emit(_inviteLink),
          child: const Text('Emit invite link'),
        ),
        OutlinedButton(
          key: const ValueKey('run-csp-denial-probe'),
          onPressed: _runCspProbe,
          child: const Text('Run intentional CSP denial probe'),
        ),
      ],
    );
  }
}

class _HarnessDestinationPage extends StatefulWidget {
  final _HarnessLink link;
  final _HarnessLedger ledger;
  final StreamController<String> incomingLinks;

  const _HarnessDestinationPage({
    required this.link,
    required this.ledger,
    required this.incomingLinks,
  });

  @override
  State<_HarnessDestinationPage> createState() =>
      _HarnessDestinationPageState();
}

class _HarnessDestinationPageState extends State<_HarnessDestinationPage> {
  final Object _destinationToken = Object();

  @override
  void initState() {
    super.initState();
    widget.ledger.mountDestination(_destinationToken, widget.link);
  }

  @override
  void dispose() {
    widget.ledger.unmountDestination(_destinationToken);
    super.dispose();
  }

  void _emit(_HarnessLink link) {
    widget.ledger.recordAction('emit:${link.label}');
    if (!widget.incomingLinks.isClosed) {
      widget.incomingLinks.add(link.rawLink);
    }
  }

  void _openSafeHome() {
    widget.ledger.recordAction('safe-home:${widget.link.label}');
    openMainNavigationDestination(context, mode: widget.link.mode, index: 0);
  }

  Future<void> _ordinaryPop() async {
    widget.ledger.recordAction('ordinary-pop:${widget.link.label}');
    await Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final routeName = ModalRoute.of(context)?.settings.name ?? '<unnamed>';
    final distinctCustomer =
        widget.link.publicRoute == _primaryCustomerLink.publicRoute
        ? _alternateCustomerLink
        : _primaryCustomerLink;
    return _HarnessScaffold(
      title: 'Synthetic destination',
      ledger: widget.ledger,
      children: <Widget>[
        Text(
          widget.link.label,
          key: const ValueKey('active-destination-label'),
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        Text('Current route name: $routeName'),
        Text('Expected public route: ${widget.link.publicRoute}'),
        FilledButton(
          key: const ValueKey('safe-home'),
          onPressed: _openSafeHome,
          child: const Text('Safe Home (retain shell)'),
        ),
        OutlinedButton(
          key: const ValueKey('ordinary-route-pop'),
          onPressed: _ordinaryPop,
          child: const Text('Ordinary route pop'),
        ),
        FilledButton.tonal(
          key: const ValueKey('emit-matching-link'),
          onPressed: () => _emit(widget.link),
          child: const Text('Emit matching link'),
        ),
        FilledButton.tonal(
          key: const ValueKey('emit-distinct-customer-link'),
          onPressed: () => _emit(distinctCustomer),
          child: const Text('Emit distinct customer link'),
        ),
      ],
    );
  }
}

class _HarnessStaticPage extends StatelessWidget {
  final String title;
  final _HarnessLedger ledger;
  final _HarnessLink? frameworkRuntimeLink;

  const _HarnessStaticPage({
    required this.title,
    required this.ledger,
    this.frameworkRuntimeLink,
  });

  Future<void> _deliverFrameworkRuntimeLink(_HarnessLink link) async {
    ledger.recordFrameworkRoute(link, status: 'pending');
    // This test-only web harness intentionally exercises the same framework
    // entry point used by a host-delivered runtime route.
    // ignore: invalid_use_of_protected_member
    final handled = await WidgetsBinding.instance.handlePushRoute(
      link.publicRoute,
    );
    ledger.recordFrameworkRoute(
      link,
      status: handled ? 'handled' : 'unhandled',
    );
  }

  @override
  Widget build(BuildContext context) {
    final runtimeLink = frameworkRuntimeLink;
    final runtimeModeLabel = runtimeLink?.mode == AppMode.biteScore
        ? 'BiteScore'
        : 'BiteSaver';
    return _HarnessScaffold(
      title: title,
      ledger: ledger,
      children: <Widget>[
        const Text(
          'Synthetic data only. No owner or account service is active.',
        ),
        if (runtimeLink != null)
          FilledButton(
            key: ValueKey('deliver-framework-runtime-${runtimeLink.mode.name}'),
            onPressed: () => _deliverFrameworkRuntimeLink(runtimeLink),
            child: Text('Deliver framework runtime $runtimeModeLabel link'),
          ),
      ],
    );
  }
}

class _HarnessScaffold extends StatelessWidget {
  final String title;
  final _HarnessLedger ledger;
  final List<Widget> children;

  const _HarnessScaffold({
    required this.title,
    required this.ledger,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 680),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  _HarnessStatus(ledger: ledger),
                  const SizedBox(height: 18),
                  for (final child in children) ...<Widget>[
                    child,
                    const SizedBox(height: 12),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _HarnessStatus extends StatelessWidget {
  final _HarnessLedger ledger;

  const _HarnessStatus({required this.ledger});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: ledger,
      builder: (context, _) {
        return Semantics(
          container: true,
          liveRegion: true,
          label: ledger.summary,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: SelectableText(
                ledger.summary,
                key: const ValueKey('navigation-history-harness-status'),
              ),
            ),
          ),
        );
      },
    );
  }
}

enum _HarnessDestinationKind { customer, invite }

class _HarnessLink {
  final _HarnessDestinationKind kind;
  final String label;
  final String publicRoute;
  final String rawLink;
  final AppMode mode;

  const _HarnessLink({
    required this.kind,
    required this.label,
    required this.publicRoute,
    required this.rawLink,
    required this.mode,
  });

  factory _HarnessLink.fromCustomer(RestaurantCustomerDeepLink link) {
    final segments = <String>['r', link.side, link.restaurantId];
    return _HarnessLink(
      kind: _HarnessDestinationKind.customer,
      label: 'customer:${link.side}:${link.restaurantId}',
      publicRoute: Uri(pathSegments: <String>['', ...segments]).toString(),
      rawLink: Uri(
        scheme: 'https',
        host: 'go.bitestar.app',
        pathSegments: segments,
      ).toString(),
      mode: link.isBiteScore ? AppMode.biteScore : AppMode.biteSaver,
    );
  }

  factory _HarnessLink.fromInvite(RestaurantInviteDeepLink link) {
    final segments = <String>['invite', link.side, link.token];
    return _HarnessLink(
      kind: _HarnessDestinationKind.invite,
      label: 'invite:${link.side}:${link.token}',
      publicRoute: Uri(pathSegments: <String>['', ...segments]).toString(),
      rawLink: Uri(
        scheme: 'https',
        host: 'go.bitestar.app',
        pathSegments: segments,
      ).toString(),
      mode: link.side == 'bitescore' ? AppMode.biteScore : AppMode.biteSaver,
    );
  }
}

class _HarnessLedger extends ChangeNotifier {
  final Set<Object> _shells = <Object>{};
  final Map<Object, _HarnessLink> _destinations = <Object, _HarnessLink>{};
  int _shellMounts = 0;
  int _destinationMounts = 0;
  int _customerMounts = 0;
  int _inviteMounts = 0;
  AppMode _selectedMode;
  String _frameworkRoute = 'not-run';
  String _lastAction = 'boot';
  String _probe = 'not-run';
  bool _publishQueued = false;
  bool _disposed = false;

  _HarnessLedger({required AppMode selectedMode})
    : _selectedMode = selectedMode {
    _schedulePublish();
  }

  String get _view =>
      _destinations.isEmpty ? 'home' : _destinations.values.last.label;

  String get summary =>
      'BiteStarNavHarness '
      'view=$_view '
      'mode=${_selectedMode.name} '
      'shellMounts=$_shellMounts '
      'activeShells=${_shells.length} '
      'destinationMounts=$_destinationMounts '
      'activeDestinations=${_destinations.length} '
      'customerMounts=$_customerMounts '
      'inviteMounts=$_inviteMounts '
      'frameworkRoute=$_frameworkRoute '
      'probe=$_probe '
      'last=$_lastAction';

  void recordSelectedMode(AppMode mode) {
    if (_disposed || _selectedMode == mode) {
      return;
    }
    _selectedMode = mode;
    _schedulePublish();
  }

  void recordFrameworkRoute(_HarnessLink link, {required String status}) {
    if (_disposed) {
      return;
    }
    _frameworkRoute = '$status:${link.label}';
    _lastAction = 'framework-route:$status:${link.label}';
    _schedulePublish();
  }

  void mountShell(Object token) {
    if (_disposed || !_shells.add(token)) {
      return;
    }
    _shellMounts += 1;
    _lastAction = 'shell-mounted';
    _schedulePublish();
  }

  void unmountShell(Object token) {
    if (_disposed || !_shells.remove(token)) {
      return;
    }
    _lastAction = 'shell-unmounted';
    _schedulePublish();
  }

  void mountDestination(Object token, _HarnessLink link) {
    if (_disposed || _destinations.containsKey(token)) {
      return;
    }
    _destinations[token] = link;
    _destinationMounts += 1;
    switch (link.kind) {
      case _HarnessDestinationKind.customer:
        _customerMounts += 1;
      case _HarnessDestinationKind.invite:
        _inviteMounts += 1;
    }
    _lastAction = 'destination-mounted:${link.label}';
    _schedulePublish();
  }

  void unmountDestination(Object token) {
    if (_disposed) {
      return;
    }
    final removed = _destinations.remove(token);
    if (removed == null) {
      return;
    }
    _lastAction = 'destination-unmounted:${removed.label}';
    _schedulePublish();
  }

  void recordAction(String action) {
    if (_disposed) {
      return;
    }
    _lastAction = action;
    _schedulePublish();
  }

  void recordProbe(String result) {
    if (_disposed) {
      return;
    }
    _probe = result;
    _lastAction = 'csp-probe:$result';
    _schedulePublish();
  }

  void _schedulePublish() {
    if (_disposed || _publishQueued) {
      return;
    }
    _publishQueued = true;
    scheduleMicrotask(() {
      _publishQueued = false;
      if (_disposed) {
        return;
      }
      final currentSummary = summary;
      web.document.title = currentSummary;
      final root = web.document.documentElement;
      root?.setAttribute('data-navigation-harness-ready', 'true');
      root?.setAttribute('data-navigation-harness-view', _view);
      root?.setAttribute('data-navigation-harness-mode', _selectedMode.name);
      root?.setAttribute(
        'data-navigation-harness-shell-mounts',
        '$_shellMounts',
      );
      root?.setAttribute(
        'data-navigation-harness-active-shells',
        '${_shells.length}',
      );
      root?.setAttribute(
        'data-navigation-harness-destination-mounts',
        '$_destinationMounts',
      );
      root?.setAttribute(
        'data-navigation-harness-active-destinations',
        '${_destinations.length}',
      );
      root?.setAttribute(
        'data-navigation-harness-framework-route',
        _frameworkRoute,
      );
      root?.setAttribute('data-navigation-harness-probe', _probe);
      root?.setAttribute('data-navigation-harness-last-action', _lastAction);
      notifyListeners();
    });
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
