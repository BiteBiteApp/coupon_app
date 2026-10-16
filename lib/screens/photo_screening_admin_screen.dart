import 'dart:convert';
import 'dart:ui' as ui;
import 'main_navigation_screen.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../services/photo_screening_service.dart';
import '../services/app_error_text.dart';

/// Bounded pre-publication queue, separate from customer Report Photo cases.
class PhotoScreeningAdminScreen extends StatefulWidget {
  const PhotoScreeningAdminScreen({super.key, this.service, this.expectedUid});
  final PhotoScreeningService? service;
  final String? expectedUid;
  @override
  State<PhotoScreeningAdminScreen> createState() =>
      _PhotoScreeningAdminScreenState();
}

class _PhotoScreeningAdminScreenState extends State<PhotoScreeningAdminScreen> {
  late final PhotoScreeningService _service =
      widget.service ?? PhotoScreeningService();
  late final String _uid =
      widget.expectedUid ?? FirebaseAuth.instance.currentUser!.uid;
  List<Map> _items = [];
  String? _cursor, _error;
  bool _busy = false;
  MainNavigationAuthRouteBinding? _binding;
  ModalRoute<dynamic>? _route;
  BuildContext? _overlayContext;
  String _status(Map item) {
    final created = item['createdAtMillis'];
    final now = item['serverNowMillis'];
    final age = created is int && now is int
        ? '\nAge: ${((now - created) / Duration.millisecondsPerDay).floor().clamp(0, 100000)} days'
        : '';
    final expires = item['expiresAtMillis'];
    final expiration = expires is int
        ? '\nExpires: ${DateTime.fromMillisecondsSinceEpoch(expires, isUtc: true).toIso8601String()} UTC'
        : '';
    final cleanup = switch (item['cleanupStatus']) {
      'complete' => 'Image bytes confirmed absent',
      'attention' => 'Deletion needs attention; image remains private',
      'retry' => 'Deletion will retry automatically; image remains private',
      'running' => 'Deleting private image',
      'pending' => 'Private image deletion scheduled',
      _ => null,
    };
    return '${item['state']}$age$expiration${cleanup == null ? '' : '\n$cleanup'}';
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
    if (_binding != null) {
      _binding!.retirePrivateOverlays();
      mainNavigationController.unbindAuthBoundRoute(_binding!);
    }
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool more = false}) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final page = await _service.request('listAdminScreeningPhotos', _uid, {
        'after': more ? _cursor : null,
      });
      if (!mounted || !_service.isCurrent(_uid)) return;
      setState(() {
        _items = (page['items'] as List).cast<Map>();
        _cursor = page['nextCursor'] as String?;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _items = [];
          _error = AppErrorText.friendly(
            e,
            fallback: 'Could not load held photographs.',
          );
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _review(Map item) async {
    setState(() => _busy = true);
    try {
      Map? preview;
      String? previewError;
      final canDecide = item['canDecide'] == true;
      try {
        if (!canDecide) {
          throw StateError(
            'This photograph is not available for a publication decision.',
          );
        }
        preview = await _service.request('previewAdminScreeningPhoto', _uid, {
          'imageId': item['imageId'],
          'generation': item['generation'],
        });
        final codec = await ui.instantiateImageCodec(
          base64Decode(preview['bytesBase64'] as String),
        );
        try {
          final frame = await codec.getNextFrame();
          frame.image.dispose();
        } finally {
          codec.dispose();
        }
      } catch (e) {
        preview = null;
        previewError = AppErrorText.friendly(
          e,
          fallback: 'This exact photograph is unavailable.',
        );
      }
      if (!mounted || !_service.isCurrent(_uid)) return;
      final decision = await showDialog<String>(
        context: _overlayContext ?? context,
        builder: (context) => AlertDialog(
          title: Text('${item['dishName']} · ${item['restaurantName']}'),
          content: SizedBox(
            width: 500,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (preview != null)
                    Image.memory(
                      base64Decode(preview['bytesBase64'] as String),
                      height: 280,
                      fit: BoxFit.contain,
                      errorBuilder: (_, _, _) => const Text(
                        'Photo could not be displayed. Do not approve.',
                      ),
                    )
                  else
                    Text(previewError ?? 'Photo unavailable.'),
                  Text(
                    'Status: ${_status(item)}\nScreening: ${item['scanStatus']}',
                  ),
                  if (item['likelihoods'] != null)
                    Text('${item['likelihoods']}'),
                  const Text(
                    'Approve only after inspecting the photograph. Medical or spoof likelihood alone is not a reason to reject.',
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: canDecide
                  ? () => Navigator.pop(context, 'rejected')
                  : null,
              child: const Text('Reject'),
            ),
            FilledButton(
              onPressed: preview == null || !canDecide
                  ? null
                  : () => Navigator.pop(context, 'approved'),
              child: const Text('Approve'),
            ),
            if (item['cleanupStatus'] == 'attention')
              TextButton(
                onPressed: () => Navigator.pop(context, 'retry_cleanup'),
                child: const Text('Retry deletion'),
              ),
          ],
        ),
      );
      if (decision == null || !mounted || !_service.isCurrent(_uid)) return;
      final result = await _service.request('decideAdminScreeningPhoto', _uid, {
        'imageId': item['imageId'],
        'generation': item['generation'],
        'decision': decision,
      });
      if (mounted && _service.isCurrent(_uid)) {
        final state = result['state'];
        final message = state == 'approved'
            ? 'Photograph published.'
            : '${state == 'rejected' ? 'Photograph rejected.' : 'Photograph cannot be published.'} ${result['cleanupStatus'] == 'complete' ? 'Image bytes confirmed absent.' : 'Deletion is pending; the image remains private.'}';
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(message)));
        await _load();
      }
    } catch (e) {
      if (mounted && _service.isCurrent(_uid)) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              AppErrorText.friendly(
                e,
                fallback: 'Could not save the photo decision.',
              ),
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final content = Scaffold(
      appBar: AppBar(
        title: const Text('Photographs awaiting publication'),
        actions: [
          IconButton(
            onPressed: _busy ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Private screening queue. These photographs have not been published. Customer photo reports remain in Review & Photo Reports.',
          ),
          if (_busy) const LinearProgressIndicator(),
          if (_error != null) Text(_error!),
          if (!_busy && _items.isEmpty && _error == null)
            const Text('No photographs awaiting review.'),
          for (final item in _items)
            ListTile(
              title: Text('${item['dishName']} · ${item['restaurantName']}'),
              subtitle: Text(_status(item)),
              trailing: TextButton(
                onPressed: _busy ? null : () => _review(item),
                child: const Text('Inspect'),
              ),
            ),
          if (_cursor != null)
            TextButton(
              onPressed: _busy ? null : () => _load(more: true),
              child: const Text('Load more'),
            ),
        ],
      ),
    );
    if (_binding == null) return content;
    return MainNavigationAuthBoundOverlayScope(
      binding: _binding!,
      child: Builder(
        builder: (context) {
          _overlayContext = context;
          return content;
        },
      ),
    );
  }
}
