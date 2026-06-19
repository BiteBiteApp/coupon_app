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
  static RestaurantCustomerDeepLink? parseRestaurantDeepLink(Uri uri) {
    if (uri.scheme != 'bitesaver') {
      return null;
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
}
