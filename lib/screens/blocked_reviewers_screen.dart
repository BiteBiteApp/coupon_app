import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/reviewer_safety_service.dart';
import 'main_navigation_screen.dart';

class BlockedReviewersScreen extends StatefulWidget {
  const BlockedReviewersScreen({
    super.key,
    required this.expectedUserId,
    this.service,
    this.testCurrentUserProvider,
  });
  final String expectedUserId;
  final ReviewerSafetyService? service;
  final User? Function()? testCurrentUserProvider;

  @override
  State<BlockedReviewersScreen> createState() => _BlockedReviewersScreenState();
}

class _BlockedReviewersScreenState extends State<BlockedReviewersScreen> {
  late final _service = widget.service ?? ReviewerSafetyService();
  final _items = <BlockedReviewer>[];
  String? _cursor;
  bool _loading = false;
  String? _unblocking;
  String? _error;
  MainNavigationAuthRouteBinding? _binding;
  ModalRoute<dynamic>? _route;

  User? get _user =>
      widget.testCurrentUserProvider?.call() ??
      (widget.testCurrentUserProvider == null
          ? FirebaseAuth.instance.currentUser
          : null);
  bool _current([MainNavigationAuthLease? lease]) =>
      mounted &&
      ReviewerSafetyCustomerUi.isEnabled &&
      _user != null &&
      !_user!.isAnonymous &&
      _user!.uid == widget.expectedUserId &&
      (lease == null || lease.matchesUser(_user));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (identical(route, _route)) return;
    _route = route;
    final navigator = Navigator.maybeOf(context, rootNavigator: true);
    if (navigator != null && route != null) {
      _binding = mainNavigationController.bindAuthBoundRoute(
        navigator: navigator,
        route: route,
        originatingAuthRealm: 'signed:${widget.expectedUserId}',
      );
    }
    _load();
  }

  @override
  void dispose() {
    if (_binding != null) {
      mainNavigationController.unbindAuthBoundRoute(_binding!);
    }
    super.dispose();
  }

  Future<void> _load({bool more = false}) async {
    final lease = _binding?.captureLease();
    if (!_current(lease) || _loading || _unblocking != null) return;
    setState(() {
      _loading = true;
      _error = null;
      if (!more) {
        _items.clear();
        _cursor = null;
      }
    });
    try {
      final page = await _service.blockedReviewers(
        expectedUserId: widget.expectedUserId,
        afterUserId: more ? _cursor : null,
        leaseIsCurrent: () => _current(lease),
      );
      if (!_current(lease)) return;
      setState(() {
        _items.addAll(page.items);
        _cursor = page.nextCursor;
      });
    } catch (error) {
      if (_current(lease)) {
        setState(
          () => _error =
              'Could not load blocked reviewers. Please refresh and try again.',
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
          if (!_current(lease)) _items.clear();
        });
      }
    }
  }

  Future<void> _unblock(BlockedReviewer reviewer) async {
    final lease = _binding?.captureLease();
    if (!_current(lease) || _unblocking != null || _loading) return;
    setState(() {
      _unblocking = reviewer.targetUserId;
      _error = null;
    });
    try {
      final status = await _service.status(
        expectedUserId: widget.expectedUserId,
        targetUserId: reviewer.targetUserId,
        leaseIsCurrent: () => _current(lease),
      );
      if (!_current(lease)) return;
      if (status.blocked) {
        final result = await _service.unblock(
          expectedUserId: widget.expectedUserId,
          targetUserId: reviewer.targetUserId,
          expectedRevision: status.revision,
          leaseIsCurrent: () => _current(lease),
        );
        if (!_current(lease)) return;
        if (result.blocked) throw StateError('Reviewer preferences changed.');
      } else {
        // Another device may already have removed this still-visible row.
        _service.notifyPreferencesChanged(
          expectedUserId: widget.expectedUserId,
          targetUserId: reviewer.targetUserId,
          leaseIsCurrent: () => _current(lease),
        );
      }
      setState(
        () => _items.removeWhere(
          (item) => item.targetUserId == reviewer.targetUserId,
        ),
      );
    } catch (error) {
      if (_current(lease)) {
        setState(() => _error = ReviewerSafetyService.errorMessage(error));
      }
    } finally {
      if (mounted) {
        setState(() {
          _unblocking = null;
          if (!_current(lease)) _items.clear();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_current()) {
      return const Scaffold(
        body: Center(child: Text('Reviewer safety session changed.')),
      );
    }
    return Scaffold(
      appBar: AppBar(
        title: const Text('Blocked Reviewers'),
        actions: [
          IconButton(
            tooltip: 'Refresh blocked reviewers',
            onPressed: _loading || _unblocking != null ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_error != null) ...[
            Text(_error!),
            TextButton(
              onPressed: _loading || _unblocking != null ? null : _load,
              child: const Text('Refresh'),
            ),
          ],
          if (_items.isEmpty && !_loading && _error == null && _cursor == null)
            const Text('You have no blocked reviewers.'),
          for (final reviewer in _items)
            ListTile(
              title: const Text('Reviewer'),
              subtitle: Text(reviewer.targetUserId),
              trailing: TextButton(
                onPressed: _loading || _unblocking != null
                    ? null
                    : () => _unblock(reviewer),
                child: Text(
                  _unblocking == reviewer.targetUserId
                      ? 'Unblocking…'
                      : 'Unblock',
                ),
              ),
            ),
          if (_loading) const Center(child: CircularProgressIndicator()),
          if (_cursor != null)
            TextButton(
              onPressed: _loading || _unblocking != null
                  ? null
                  : () => _load(more: true),
              child: const Text('Load more'),
            ),
        ],
      ),
    );
  }
}
