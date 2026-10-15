import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/app_update/app_update_service.dart';

/// A single cold-opening opportunity. Never starts a reminder on resume, on
/// navigation back to Home, or during an already interactive session.
class AppUpdateOpening extends StatefulWidget {
  const AppUpdateOpening({
    super.key,
    required this.child,
    this.service,
    this.safety,
    this.enabled = true,
  });
  final Widget child;
  final AppUpdateService? service;
  final AppUpdateOpeningSafety? safety;
  final bool enabled;
  @override
  State<AppUpdateOpening> createState() => _AppUpdateOpeningState();
}

class _AppUpdateOpeningState extends State<AppUpdateOpening>
    with WidgetsBindingObserver {
  static bool _productionOpeningConsumed = false;
  late final AppUpdateService _service;
  late final AppUpdateOpeningSafety _safety;
  StreamSubscription<void>? _interruptions;
  DialogRoute<void>? _dialog;
  bool _interacted = false;
  bool _foreground = true;

  @override
  void initState() {
    super.initState();
    final storage = PreferencesAppUpdateStorage();
    _service =
        widget.service ??
        AppUpdateService(
          platform: const StoreAppUpdatePlatform(),
          storage: storage,
        );
    _safety = widget.safety ?? AppUpdateOpeningSafety(storage);
    _foreground =
        WidgetsBinding.instance.lifecycleState == null ||
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
    _interruptions = _service.platform.interruptions.listen((_) {
      _interacted = true;
      final dialog = _dialog;
      if (dialog != null && dialog.isActive) {
        dialog.navigator?.removeRoute(dialog);
      }
    });
    WidgetsBinding.instance.addObserver(this);
    HardwareKeyboard.instance.addHandler(_onKey);
    final consumed = widget.service == null && _productionOpeningConsumed;
    if (widget.service == null) _productionOpeningConsumed = true;
    if (!consumed) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _checkOpening());
    }
  }

  bool _onKey(KeyEvent event) {
    _interacted = true;
    return false;
  }

  bool get _safe {
    if (!mounted || _interacted || !_foreground) return false;
    final route = ModalRoute.of(context);
    return route?.isFirst == true &&
        route?.isCurrent == true &&
        FocusManager.instance.primaryFocus?.context?.widget is! EditableText;
  }

  Future<void> _checkOpening() async {
    // Independent of Firebase identity; fail open if any local/platform check
    // stalls. Late results cannot show a dialog after this opportunity ends.
    try {
      final safe = await _safety.begin().timeout(const Duration(seconds: 5));
      if (!widget.enabled || !safe || !_safe) return;
      final decision = await _service.check().timeout(
        const Duration(seconds: 5),
      );
      if (decision == null || !_safe) return;
      if (!mounted) return;
      final dialog = DialogRoute<void>(
        context: context,
        barrierDismissible: !decision.required,
        builder: (_) => _AppUpdateDialog(service: _service, decision: decision),
      );
      _dialog = dialog;
      await Navigator.of(context, rootNavigator: true).push(dialog);
      _dialog = null;
    } catch (_) {
      /* Ordinary use stays available. */
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _foreground = false;
      _interacted = true; // A later resume is never a new prompt opportunity.
      unawaited(_safety.markForeground(false));
    } else if (state == AppLifecycleState.resumed) {
      _foreground = true;
      unawaited(_safety.markForeground(true));
    } else {
      _foreground = false;
      _interacted = true;
    }
  }

  @override
  void dispose() {
    unawaited(_interruptions?.cancel());
    WidgetsBinding.instance.removeObserver(this);
    HardwareKeyboard.instance.removeHandler(_onKey);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Listener(
    onPointerDown: (_) => _interacted = true,
    onPointerSignal: (_) => _interacted = true,
    child: widget.child,
  );
}

class _AppUpdateDialog extends StatefulWidget {
  const _AppUpdateDialog({required this.service, required this.decision});
  final AppUpdateService service;
  final AppUpdateDecision decision;
  @override
  State<_AppUpdateDialog> createState() => _AppUpdateDialogState();
}

class _AppUpdateDialogState extends State<_AppUpdateDialog> {
  bool _busy = false;
  String? _message;
  bool get _active => mounted && ModalRoute.of(context)?.isActive == true;

  void _close() {
    if (!_active) return;
    final route = ModalRoute.of(context)!;
    final navigator = route.navigator;
    if (route.isCurrent) {
      navigator?.pop();
    } else {
      navigator?.removeRoute(route);
    }
  }

  Future<void> _postpone() async {
    if (_busy) return;
    setState(() => _busy = true);
    await widget.service.postpone(widget.decision);
    _close(); // Persistence failure must not lock out ordinary use.
  }

  Future<void> _update() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      // Revalidate before handoff; never act on a stale eligibility result.
      final current = await widget.service.check();
      if (!mounted || !_active) return;
      if (current == null ||
          current.release.key != widget.decision.release.key) {
        _close();
        return;
      }
      if (ModalRoute.of(context)?.isCurrent != true) {
        _close();
        return;
      }
      final result = await widget.service.platform.open(current.release);
      if (!mounted || !_active) return;
      if (result == AppUpdateHandoff.failed) {
        _close();
        return;
      }
      // Store return is not proof of installation. Re-read installed build and
      // availability. Cancellation keeps a required prompt, with manual retry;
      // it never automatically launches the store again or spends a snooze.
      final after = await widget.service.check();
      if (!mounted || !_active) return;
      if (after == null || after.release.key != current.release.key) {
        _close();
        return;
      }
      setState(() {
        _busy = false;
        _message = 'The update has not been installed. You can try again.';
      });
    } catch (_) {
      _close();
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !widget.decision.required && !_busy,
    child: AlertDialog(
      scrollable: true,
      title: Text(
        widget.decision.required ? 'Update required' : 'Update BiteStar',
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            widget.decision.required
                ? 'A newer version is available. Update BiteStar to continue.'
                : 'A newer version of BiteStar is available. Update now, or ask us to remind you in 24 hours.',
          ),
          if (!widget.decision.required && widget.decision.postponements == 1)
            const Padding(
              padding: EdgeInsets.only(top: 12),
              child: Text('This is your final reminder postponement.'),
            ),
          if (_message != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(_message!, semanticsLabel: _message),
            ),
          if (_busy)
            const Padding(
              padding: EdgeInsets.only(top: 12),
              child: LinearProgressIndicator(semanticsLabel: 'Checking update'),
            ),
        ],
      ),
      actions: [
        if (!widget.decision.required)
          TextButton(
            onPressed: _busy ? null : _postpone,
            child: const Text('Remind Me Tomorrow'),
          ),
        FilledButton(
          onPressed: _busy ? null : _update,
          child: const Text('Update Now'),
        ),
      ],
    ),
  );
}
