// ignore_for_file: avoid_web_libraries_in_flutter

import 'dart:async';
import 'dart:js_interop';

import 'package:web/web.dart' as web;

final StreamController<String> _locationController =
    StreamController<String>.broadcast(sync: true);
JSFunction? _hashChangeListener;

String? captureInitialSubscriptionReturnWebLocation() {
  _ensureListening();
  return _captureAndCleanCandidate();
}

Stream<String> get subscriptionReturnWebLocationChanges {
  _ensureListening();
  return _locationController.stream;
}

Future<void> disposeSubscriptionReturnWebLocationSource() async {
  final listener = _hashChangeListener;
  if (listener != null) {
    web.window.removeEventListener('hashchange', listener);
    _hashChangeListener = null;
  }
}

void _ensureListening() {
  if (_hashChangeListener != null) {
    return;
  }
  final listener = ((web.Event _) {
    final location = _captureAndCleanCandidate();
    if (location != null && !_locationController.isClosed) {
      _locationController.add(location);
    }
  }).toJS;
  _hashChangeListener = listener;
  web.window.addEventListener('hashchange', listener);
}

String? _captureAndCleanCandidate() {
  final rawLocation = web.window.location.href;
  final fragmentIndex = rawLocation.indexOf('#');
  final fragment = fragmentIndex < 0
      ? ''
      : rawLocation.substring(fragmentIndex + 1);
  final isCandidate =
      fragment.startsWith('/subscription-return/') ||
      fragment.contains('return_token') ||
      rawLocation.contains('?return_token=');
  if (!isCandidate) {
    return null;
  }

  // Capture first, then synchronously replace the current history entry before
  // any validation or asynchronous work can retain a token-bearing address.
  web.window.history.replaceState(null, '', '/');
  return rawLocation;
}
