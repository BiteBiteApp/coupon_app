class RestaurantCustomerDeepLink {
  final String side;
  final String restaurantId;

  const RestaurantCustomerDeepLink({
    required this.side,
    required this.restaurantId,
  });

  bool get isCoupon => side == 'coupons';
  bool get isBiteScore => side == 'bitescore';
}

class RestaurantCustomerLinkService {
  static const String _canonicalCustomerQrHost = 'go.bitestar.app';
  static const Set<String> _trustedHttpsHosts = {
    'go.bitestar.app',
    'app.bitestar.app',
    'go.biteranger.com',
    'app.biteranger.com',
    'go.colesmartllc.com',
    'app.colesmartllc.com',
    'colesmartllc.com',
    'www.colesmartllc.com',
  };

  static String couponRestaurantUrl(String restaurantId) {
    return _restaurantUrl(side: 'coupons', restaurantId: restaurantId);
  }

  static String biteScoreRestaurantUrl(String restaurantId) {
    return _restaurantUrl(side: 'bitescore', restaurantId: restaurantId);
  }

  static RestaurantCustomerDeepLink? parseRestaurantDeepLink(Uri uri) {
    final isCustomScheme = uri.scheme == 'bitesaver';
    final isTrustedHttps =
        uri.scheme == 'https' &&
        _trustedHttpsHosts.contains(uri.host.trim().toLowerCase());
    if (!isCustomScheme && !isTrustedHttps) {
      return null;
    }

    if (isTrustedHttps) {
      return _parseRestaurantSegments(uri.pathSegments);
    }

    final segments = _normalizedRestaurantSegments(
      host: uri.host,
      pathSegments: uri.pathSegments,
    );
    return _parseRestaurantSegments(segments);
  }

  static RestaurantCustomerDeepLink? parseRestaurantRouteName(
    String? routeName,
  ) {
    final uri = Uri.tryParse(routeName ?? '');
    if (uri == null) {
      return null;
    }

    return _parseRestaurantSegments(uri.pathSegments);
  }

  static List<String> _normalizedRestaurantSegments({
    required String host,
    required List<String> pathSegments,
  }) {
    final normalizedHost = host.trim().toLowerCase();
    if (normalizedHost == 'r') {
      return pathSegments;
    }
    if (normalizedHost.isEmpty) {
      return pathSegments;
    }

    return const <String>[];
  }

  static RestaurantCustomerDeepLink? _parseRestaurantSegments(
    List<String> rawSegments,
  ) {
    final segments = rawSegments
        .map((segment) => segment.trim())
        .where((segment) => segment.isNotEmpty)
        .toList(growable: false);

    final restaurantOffset = segments.isNotEmpty && segments.first == 'r'
        ? 1
        : 0;
    if (segments.length < restaurantOffset + 2) {
      return null;
    }

    final side = segments[restaurantOffset].trim().toLowerCase();
    final restaurantId = Uri.decodeComponent(
      segments[restaurantOffset + 1].trim(),
    );
    if ((side != 'coupons' && side != 'bitescore') || restaurantId.isEmpty) {
      return null;
    }

    return RestaurantCustomerDeepLink(side: side, restaurantId: restaurantId);
  }

  static String _restaurantUrl({
    required String side,
    required String restaurantId,
  }) {
    final trimmedRestaurantId = restaurantId.trim();
    if (trimmedRestaurantId.isEmpty) {
      throw ArgumentError('Restaurant ID is required.');
    }

    return Uri(
      scheme: 'https',
      host: _canonicalCustomerQrHost,
      pathSegments: ['r', side, trimmedRestaurantId],
    ).toString();
  }
}
