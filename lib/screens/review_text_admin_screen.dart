import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../services/app_error_text.dart';
import '../services/review_text_moderation_service.dart';
import 'main_navigation_screen.dart';

class ReviewTextAdminScreen extends StatefulWidget {
  const ReviewTextAdminScreen({
    super.key,
    this.service,
    this.expectedUid,
    this.authChanges,
  });
  final ReviewTextModerationService? service;
  final String? expectedUid;
  final Stream<String?>? authChanges;
  @override
  State<ReviewTextAdminScreen> createState() => _ReviewTextAdminScreenState();
}

class _ReviewTextAdminScreenState extends State<ReviewTextAdminScreen> {
  late final _service = widget.service ?? ReviewTextModerationService();
  late final _uid =
      widget.expectedUid ?? FirebaseAuth.instance.currentUser!.uid;
  StreamSubscription<String?>? _auth;
  MainNavigationAuthRouteBinding? _binding;
  ModalRoute<dynamic>? _route;
  List<Map> _items = [];
  String? _cursor, _error;
  bool _busy = false, _retired = false;
  bool get _current => mounted && !_retired && _service.isCurrent(_uid);
  @override
  void initState() {
    super.initState();
    _auth =
        (widget.authChanges ??
                FirebaseAuth.instance.authStateChanges().map((u) => u?.uid))
            .listen((uid) {
              if (uid != _uid && mounted) {
                setState(() {
                  _retired = true;
                  _items = [];
                  _cursor = null;
                  _error = 'The signed-in account changed.';
                });
              }
            });
    _load();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route == null || identical(route, _route)) return;
    _route = route;
    _binding = mainNavigationController.bindAuthBoundRoute(
      navigator: Navigator.of(context, rootNavigator: true),
      route: route,
      originatingAuthRealm: 'signed:$_uid',
    );
  }

  @override
  void dispose() {
    _auth?.cancel();
    if (_binding != null) {
      mainNavigationController.unbindAuthBoundRoute(_binding!);
    }
    super.dispose();
  }

  Future<void> _load({bool more = false}) async {
    if (!_current) return;
    setState(() {
      _busy = true;
      _error = null;
      _items = [];
    });
    try {
      final page = await _service.request('listBiteScoreReviewText', _uid, {
        'cursor': more ? _cursor : null,
      });
      if (!_current) return;
      setState(() {
        _items = (page['items'] as List).cast<Map>();
        _cursor = page['nextCursor'] as String?;
      });
    } catch (e) {
      if (_current) {
        setState(
          () => _error = AppErrorText.friendly(
            e,
            fallback: 'Could not load proposed review text.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _decide(Map item, String action) async {
    if (!_current || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _service.request('decideBiteScoreReviewText', _uid, {
        'reviewId': item['reviewId'],
        'version': item['version'],
        'action': action,
      });
      if (!mounted || !_current) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            action == 'approve'
                ? 'Proposed words published. Rating unchanged.'
                : 'Proposed words rejected. Rating unchanged.',
          ),
        ),
      );
      await _load();
    } catch (e) {
      if (_current) {
        setState(
          () => _error = AppErrorText.friendly(
            e,
            fallback: 'Decision failed. Refresh and try again.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Review text awaiting publication')),
    body: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text(
          'These are proposed words, separate from reports about published reviews. A model flag is a signal for human review, not proof of misconduct. Ordinary criticism and mild profanity are allowed.',
        ),
        if (_busy) const LinearProgressIndicator(),
        if (_error != null)
          Text(_error!, key: const Key('text-moderation-error')),
        if (!_busy && _items.isEmpty && _error == null)
          const Text('No proposed text on this page.'),
        for (final item in _items)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Status: ${item['status']}'),
                  Text(
                    'Dish: ${item['dishId']}\nRestaurant: ${item['restaurantId']}\nReview: ${item['reviewId']}\nAuthor: ${item['userId']}',
                  ),
                  const SizedBox(height: 12),
                  SelectableText(
                    '${item['headline'] ?? ''}\n\n${item['notes'] ?? ''}',
                  ),
                  const SizedBox(height: 12),
                  Text(
                    item['signal'] == null
                        ? 'No completed model assessment.'
                        : 'Model: ${item['signal']['model']}\nFlagged: ${item['signal']['flagged']}\nFlagged categories: ${(item['signal']['categories'] as Map).entries.where((e) => e.value == true).map((e) => e.key).join(', ')}',
                  ),
                  Text('Policy: ${item['policyVersion']}'),
                  Wrap(
                    spacing: 12,
                    children: [
                      TextButton(
                        onPressed: _busy || _retired
                            ? null
                            : () => _decide(item, 'reject'),
                        child: const Text('Reject words'),
                      ),
                      FilledButton(
                        onPressed: _busy || _retired
                            ? null
                            : () => _decide(item, 'approve'),
                        child: const Text('Approve words'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        Wrap(
          spacing: 12,
          children: [
            TextButton(
              onPressed: _busy || _retired ? null : () => _load(),
              child: const Text('Refresh'),
            ),
            if (_cursor != null)
              TextButton(
                onPressed: _busy || _retired ? null : () => _load(more: true),
                child: const Text('Next page'),
              ),
          ],
        ),
      ],
    ),
  );
}
