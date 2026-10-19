@TestOn('browser')
library;

import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:coupon_app/screens/coupon_detail_screen.dart';
import 'package:coupon_app/widgets/customer_website_frame.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../customer_website_fixture/main.dart'
    show fixtureProfile, fixtureCoupon;

void main() {
  for (final width in [390.0, 768.0, 1440.0]) {
    for (final policy in [
      'unlimited',
      'oncePerDay',
      'oncePerCustomer',
      'reusableAfterTimer',
      'special',
    ]) {
      testWidgets('$width browser $policy stays display-only', (tester) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = Size(width, 1000);
        addTearDown(tester.view.reset);
        final profile = fixtureProfile('permanent%identity');
        addTearDown(profile.dispose);
        final offer = profile.offers.firstWhere(
          (o) => policy == 'special'
              ? o.offerType == CustomerBiteSaverOfferType.dailySpecial
              : o.usagePolicy?.name == policy,
        );
        var uses = 0;
        await tester.pumpWidget(
          MaterialApp(
            builder: (_, child) => CustomerWebsiteFrame(child: child!),
            home: fixtureCoupon(
              profile,
              offer,
              use: (_) async {
                uses++;
                throw StateError('Unexpected native coupon use');
              },
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Use Coupon'), findsNothing);
        expect(find.text('Redeem Coupon'), findsNothing);
        if (policy == 'unlimited') {
          await tester.ensureVisible(find.text('Show coupon full screen'));
          await tester.tap(find.text('Show coupon full screen'));
          await tester.pumpAndSettle();
          expect(find.text('Show coupon'), findsOneWidget);
          final presentation = CustomerBiteSaverOfferPresentation.fromOffer(
            offer,
          );
          expect(find.text(presentation.scheduleLabel!), findsWidgets);
          expect(find.text(presentation.expiresLabel!), findsWidgets);
          expect(find.text(offer.title), findsWidgets);
          await tester.tap(find.byType(CloseButton));
          await tester.pumpAndSettle();
          expect(find.text('Use in BiteStar App'), findsNothing);
        } else if (policy != 'special') {
          await tester.ensureVisible(find.text('Use in BiteStar App'));
          await tester.tap(find.text('Use in BiteStar App'));
          await tester.pumpAndSettle();
          expect(
            find.textContaining('download links are not available yet'),
            findsOneWidget,
          );
          expect(find.text('Use this coupon now?'), findsNothing);
        } else {
          expect(find.text('Use in BiteStar App'), findsNothing);
          expect(find.text('Show coupon full screen'), findsNothing);
        }
        expect(uses, 0);
        expect(tester.takeException(), isNull);
      });
    }
  }
  testWidgets('legacy display text cannot grant unlimited browser use', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: CouponDetailScreen(
          coupon: const Coupon(
            id: 'legacy',
            restaurant: 'Cafe',
            title: 'Legacy',
            distance: '',
            usageRule: 'Unlimited',
          ),
          loadFavoriteState: (_) async => false,
          loadCustomerVisibility: (_, _) async => true,
          initializeRedemptionStore: () async =>
              throw StateError('No browser redemption initialization'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Show coupon full screen'), findsNothing);
    expect(find.text('Use in BiteStar App'), findsOneWidget);
  });
}
