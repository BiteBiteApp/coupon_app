import 'dart:async';
import 'dart:convert';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:http/http.dart' as http;

/// Explicit candidate transport for the existing Saver/Score service injection
/// seams. Construction never activates a backend or changes Firebase defaults.
/// Tokens are obtained for each call; identity remains server-verified.
final class CustomerSearchHttpTransport {
  CustomerSearchHttpTransport({
    required Uri serviceUrl,
    required Future<String?> Function() idToken,
    Future<String?> Function()? appCheckToken,
    http.Client? client,
    bool allowLoopbackForTesting = false,
    Duration timeout = const Duration(seconds: 30),
  }) : _serviceUrl = _validateUrl(serviceUrl, allowLoopbackForTesting),
       _idToken = idToken,
       _appCheckToken = appCheckToken,
       _client = client ?? http.Client(),
       _ownsClient = client == null,
       _timeout = timeout {
    if (timeout <= Duration.zero || timeout > const Duration(seconds: 30)) {
      throw ArgumentError.value(timeout, 'timeout');
    }
  }

  static const endpoints = <String>{
    'startCustomerBiteSaverSearchV2',
    'getCustomerBiteSaverSearchStatusV2',
    'getCustomerBiteSaverSearchPageV2',
    'getCustomerBiteSaverOfferPageV2',
    'continueCustomerBiteSaverGuestOfferCheckV2',
    'startCustomerBiteScoreSearchV2',
    'advanceCustomerBiteScoreSearchV2',
    'getCustomerBiteScoreSearchPageV2',
    'getCustomerBiteSaverFavoriteStates',
    'getCustomerBiteSaverMenuPage',
    'validateCustomerBiteSaverOfferRedemptionStart',
  };
  final Uri _serviceUrl;
  final Future<String?> Function() _idToken;
  final Future<String?> Function()? _appCheckToken;
  final http.Client _client;
  final bool _ownsClient;
  final Duration _timeout;
  bool _closed = false;

  static Uri _validateUrl(Uri url, bool local) {
    final loopback =
        local &&
        url.scheme == 'http' &&
        (url.host == '127.0.0.1' || url.host == '[::1]' || url.host == '::1');
    if ((!loopback &&
            (url.scheme != 'https' || !url.host.endsWith('.run.app'))) ||
        url.userInfo.isNotEmpty ||
        url.hasQuery ||
        url.hasFragment ||
        (url.path.isNotEmpty && url.path != '/') ||
        (!loopback && url.hasPort && url.port != 443)) {
      throw ArgumentError('An explicit HTTPS Cloud Run origin is required.');
    }
    return url.replace(path: '/');
  }

  static void _token(String? token) {
    if (token != null &&
        (token.isEmpty ||
            token.length > 16384 ||
            RegExp(r'\s').hasMatch(token))) {
      throw FirebaseFunctionsException(
        code: 'unauthenticated',
        message: 'Invalid authentication token.',
      );
    }
  }

  /// Inject this tear-off as `transport` into the unchanged existing services.
  /// No automatic retry: their request/session owners retain retry accounting.
  Future<Object?> call(String name, Map<String, Object?> data) async {
    if (_closed) throw StateError('Candidate transport is closed.');
    if (!endpoints.contains(name)) {
      throw ArgumentError.value(name, 'name', 'Unsupported candidate endpoint');
    }
    final bytes = utf8.encode(jsonEncode({'data': data}));
    if (bytes.length > 512 * 1024) {
      throw FirebaseFunctionsException(
        code: 'resource-exhausted',
        message: 'Callable size bound exceeded.',
      );
    }
    final abort = Completer<void>();
    try {
      return await (() async {
        final token = await _idToken();
        final appToken = await _appCheckToken?.call();
        _token(token);
        _token(appToken);
        if (abort.isCompleted) throw TimeoutException('Token wait expired.');
        final request =
            http.AbortableRequest(
                'POST',
                _serviceUrl.resolve(name),
                abortTrigger: abort.future,
              )
              ..followRedirects = false
              ..headers['content-type'] = 'application/json; charset=utf-8'
              ..bodyBytes = bytes;
        if (token != null) request.headers['authorization'] = 'Bearer $token';
        if (appToken != null) request.headers['x-firebase-appcheck'] = appToken;
        final response = await _client.send(request);
        final body = <int>[];
        await for (final chunk in response.stream) {
          if (body.length + chunk.length > 8 * 1024 * 1024) {
            throw FirebaseFunctionsException(
              code: 'resource-exhausted',
              message: 'Callable size bound exceeded.',
            );
          }
          body.addAll(chunk);
        }
        final value = jsonDecode(utf8.decode(body));
        if (value is! Map<String, dynamic>) throw const FormatException();
        if (value['error'] case final Map error) {
          final status = error['status'];
          if (status is! String || !RegExp(r'^[A-Z_]+$').hasMatch(status)) {
            throw const FormatException();
          }
          throw FirebaseFunctionsException(
            code: status.toLowerCase().replaceAll('_', '-'),
            message: error['message'] is String
                ? error['message'] as String
                : 'Callable request failed.',
          );
        }
        if (response.statusCode != 200 ||
            value.keys.length != 1 ||
            !value.containsKey('result')) {
          throw const FormatException('Invalid callable response.');
        }
        return value['result'];
      })().timeout(_timeout);
    } on TimeoutException {
      throw FirebaseFunctionsException(
        code: 'deadline-exceeded',
        message: 'Search request timed out.',
      );
    } on http.ClientException {
      throw FirebaseFunctionsException(
        code: 'unavailable',
        message: 'Search is temporarily unavailable.',
      );
    } finally {
      if (!abort.isCompleted) abort.complete();
    }
  }

  /// Use when one service instance also handles existing profile, Saved or
  /// redemption routes. Their original transport remains explicitly supplied by
  /// the owner; this module never creates a production Firebase client itself.
  Future<Object?> Function(String, Map<String, Object?>) withFallback(
    Future<Object?> Function(String, Map<String, Object?>) existingTransport,
  ) =>
      (name, data) => endpoints.contains(name)
      ? call(name, data)
      : existingTransport(name, data);

  /// External injected clients retain ownership; default clients are closed.
  void close() {
    _closed = true;
    if (_ownsClient) _client.close();
  }
}
