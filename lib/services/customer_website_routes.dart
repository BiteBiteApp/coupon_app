import 'package:flutter/material.dart';

/// A session-only visit. The callback must create a fresh route and recheck the
/// original authority; it is never serialized into browser history or storage.
class CustomerWebsiteVisitSettings extends RouteSettings {
  const CustomerWebsiteVisitSettings({required this.reopen});
  final Route<dynamic>? Function() reopen;
}

class CustomerWebsiteLocation {
  const CustomerWebsiteLocation(this.location, {this.entryKey});
  final String location;
  final String? entryKey;
  static const stateKey = 'bitestarCustomerVisit';

  @override
  bool operator ==(Object other) =>
      other is CustomerWebsiteLocation &&
      location == other.location &&
      entryKey == other.entryKey;
  @override
  int get hashCode => Object.hash(location, entryKey);
}

enum CustomerWebsiteDetailKind { menu, offer, dish, reviews }

/// Public nested destinations use public catalog/dish/offer IDs, never account
/// IDs inferred from search cards or a serialized search/access capability.
class CustomerWebsiteDetailRoute {
  const CustomerWebsiteDetailRoute(
    this.side,
    this.restaurantId,
    this.kind, {
    this.detailId,
  });
  final String side;
  final String restaurantId;
  final CustomerWebsiteDetailKind kind;
  final String? detailId;
  bool get isBiteScore => side == 'bitescore';
  String get restaurantLocation =>
      Uri(pathSegments: ['', 'r', side, restaurantId]).toString();
  String get location => Uri(
    pathSegments: [
      '',
      'r',
      side,
      restaurantId,
      if (kind == CustomerWebsiteDetailKind.menu)
        'menu'
      else if (kind == CustomerWebsiteDetailKind.offer) ...[
        'offer',
        detailId!,
      ] else ...[
        'dish',
        detailId!,
        if (kind == CustomerWebsiteDetailKind.reviews) 'reviews',
      ],
    ],
  ).toString();

  static CustomerWebsiteDetailRoute? parse(String? value) {
    final uri = Uri.tryParse(value ?? '');
    if (uri == null ||
        uri.hasScheme ||
        uri.hasAuthority ||
        uri.hasQuery ||
        uri.hasFragment) {
      return null;
    }
    final s = uri.pathSegments;
    if (s.length < 4 ||
        s[0] != 'r' ||
        !['coupons', 'bitescore'].contains(s[1]) ||
        s.any(
          (v) =>
              v.isEmpty || v.trim() != v || v.contains('/') || v.contains('\\'),
        )) {
      return null;
    }
    if (s.length == 4 && s[3] == 'menu') {
      return CustomerWebsiteDetailRoute(
        s[1],
        s[2],
        CustomerWebsiteDetailKind.menu,
      );
    }
    if (s[1] == 'coupons' && s.length == 5 && s[3] == 'offer') {
      return CustomerWebsiteDetailRoute(
        s[1],
        s[2],
        CustomerWebsiteDetailKind.offer,
        detailId: s[4],
      );
    }
    if (s[1] == 'bitescore' &&
        s[3] == 'dish' &&
        (s.length == 5 || (s.length == 6 && s[5] == 'reviews'))) {
      return CustomerWebsiteDetailRoute(
        s[1],
        s[2],
        s.length == 6
            ? CustomerWebsiteDetailKind.reviews
            : CustomerWebsiteDetailKind.dish,
        detailId: s[4],
      );
    }
    return null;
  }
}
