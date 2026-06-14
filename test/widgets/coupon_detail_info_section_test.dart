import 'package:coupon_app/screens/coupon_detail_screen.dart';
import 'package:coupon_app/widgets/bitesaver_colors.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BiteSaverCouponDetailInfoSection', () {
    testWidgets('renders coupon information in the requested order', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BiteSaverCouponDetailInfoSection(
              title: 'Free Dessert',
              details: 'Valid with any dinner entree.',
              expiresLabel: 'Exp. Jun 30, 8:00 PM',
              restaurantName: 'BiteSaver Cafe',
              usageRule: 'Once per customer',
              unavailableStatus: 'Currently unavailable',
              isOpeningRestaurant: false,
              onOpenRestaurant: () {},
            ),
          ),
        ),
      );

      final titleTop = tester.getTopLeft(find.text('Free Dessert')).dy;
      final detailsTop = tester
          .getTopLeft(
            _richTextContaining('Details: Valid with any dinner entree.'),
          )
          .dy;
      final expiresTop = tester
          .getTopLeft(_richTextContaining('Expires: Exp. Jun 30, 8:00 PM'))
          .dy;
      final usageTop = tester
          .getTopLeft(_richTextContaining('Usage: Once per customer'))
          .dy;
      final statusTop = tester
          .getTopLeft(_richTextContaining('Status: Currently unavailable'))
          .dy;
      final restaurantTop = tester.getTopLeft(find.text('BiteSaver Cafe')).dy;

      expect(titleTop, lessThan(detailsTop));
      expect(detailsTop, lessThan(expiresTop));
      expect(expiresTop, lessThanOrEqualTo(usageTop));
      expect(usageTop, lessThan(statusTop));
      expect(statusTop, lessThan(restaurantTop));
    });

    testWidgets('omits blank details without leaving a details row', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BiteSaverCouponDetailInfoSection(
              title: 'Lunch Deal',
              details: '   ',
              expiresLabel: 'Exp. Jun 30, 8:00 PM',
              restaurantName: 'BiteSaver Cafe',
              usageRule: 'Once per customer',
              unavailableStatus: null,
              isOpeningRestaurant: false,
              onOpenRestaurant: () {},
            ),
          ),
        ),
      );

      expect(
        find.byKey(BiteSaverCouponDetailInfoSection.detailsKey),
        findsNothing,
      );
      expect(find.textContaining('No details'), findsNothing);
      expect(find.byKey(BiteSaverCouponDetailInfoSection.expiresKey), findsOne);
    });

    testWidgets(
      'restaurant link displays blue name, chevron, and is tappable',
      (tester) async {
        var opened = false;

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: BiteSaverCouponDetailInfoSection(
                title: 'Lunch Deal',
                details: null,
                expiresLabel: 'Exp. Jun 30, 8:00 PM',
                restaurantName: 'BiteSaver Cafe',
                usageRule: 'Once per customer',
                unavailableStatus: null,
                isOpeningRestaurant: false,
                onOpenRestaurant: () {
                  opened = true;
                },
              ),
            ),
          ),
        );

        expect(find.text('BiteSaver Cafe'), findsOneWidget);
        expect(find.byIcon(Icons.chevron_right), findsOneWidget);
        expect(find.text('View Restaurant'), findsNothing);
        expect(find.byType(BiteSaverCouponRestaurantLink), findsOneWidget);

        final restaurantText = tester.widget<Text>(find.text('BiteSaver Cafe'));
        expect(restaurantText.style?.color, BiteSaverColors.blue);

        await tester.tap(find.byType(InkWell));

        expect(opened, isTrue);
      },
    );

    testWidgets('long details collapse and toggle More and Less', (
      tester,
    ) async {
      final longDetails = List.filled(
        8,
        'This coupon has a longer explanation for guests.',
      ).join(' ');

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: SizedBox(
                width: 320,
                child: BiteSaverCouponDetailInfoSection(
                  title: 'Dinner Deal',
                  details: longDetails,
                  expiresLabel: 'Exp. Jun 30, 8:00 PM',
                  restaurantName: 'BiteSaver Cafe',
                  usageRule: 'Once per customer',
                  unavailableStatus: null,
                  isOpeningRestaurant: false,
                  onOpenRestaurant: () {},
                ),
              ),
            ),
          ),
        ),
      );

      var detailsRichText = tester.widget<RichText>(
        _richTextContaining('Details: This coupon has a longer explanation'),
      );
      expect(detailsRichText.maxLines, 3);
      expect(find.text('More'), findsOneWidget);

      await tester.tap(
        find.byKey(BiteSaverCouponDetailInfoSection.detailsToggleKey),
      );
      await tester.pump();

      detailsRichText = tester.widget<RichText>(
        _richTextContaining('Details: This coupon has a longer explanation'),
      );
      expect(detailsRichText.maxLines, isNull);
      expect(find.text('Less'), findsOneWidget);

      await tester.tap(
        find.byKey(BiteSaverCouponDetailInfoSection.detailsToggleKey),
      );
      await tester.pump();

      detailsRichText = tester.widget<RichText>(
        _richTextContaining('Details: This coupon has a longer explanation'),
      );
      expect(detailsRichText.maxLines, 3);
      expect(find.text('More'), findsOneWidget);
    });

    testWidgets('long restaurant names do not overflow', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 320,
              child: BiteSaverCouponDetailInfoSection(
                title: 'Lunch Deal',
                details: null,
                expiresLabel: 'Exp. Jun 30, 8:00 PM',
                restaurantName:
                    'A Very Long Restaurant Name That Should Wrap Cleanly',
                usageRule: 'Once per customer',
                unavailableStatus: null,
                isOpeningRestaurant: false,
                onOpenRestaurant: () {},
              ),
            ),
          ),
        ),
      );

      expect(tester.takeException(), isNull);
    });

    testWidgets('unlimited usage and available status rows are hidden', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BiteSaverCouponDetailInfoSection(
              title: 'Open Deal',
              details: null,
              expiresLabel: 'Exp. Jun 30, 8:00 PM',
              restaurantName: 'BiteSaver Cafe',
              usageRule: 'Unlimited',
              unavailableStatus: null,
              isOpeningRestaurant: false,
              onOpenRestaurant: () {},
            ),
          ),
        ),
      );

      expect(
        find.byKey(BiteSaverCouponDetailInfoSection.usageKey),
        findsNothing,
      );
      expect(
        find.byKey(BiteSaverCouponDetailInfoSection.statusKey),
        findsNothing,
      );
      expect(find.textContaining('Available now'), findsNothing);
    });

    testWidgets('restricted usage rows remain visible', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                BiteSaverCouponDetailInfoSection(
                  title: 'Dinner Deal',
                  details: null,
                  expiresLabel: 'Exp. Jun 30, 8:00 PM',
                  restaurantName: 'BiteSaver Cafe',
                  usageRule: 'Once per customer',
                  unavailableStatus: null,
                  isOpeningRestaurant: false,
                  onOpenRestaurant: () {},
                ),
                BiteSaverCouponDetailInfoSection(
                  title: 'Daily Deal',
                  details: null,
                  expiresLabel: 'Exp. Jun 30, 8:00 PM',
                  restaurantName: 'BiteSaver Cafe',
                  usageRule: 'Once per day',
                  unavailableStatus: null,
                  isOpeningRestaurant: false,
                  onOpenRestaurant: () {},
                ),
              ],
            ),
          ),
        ),
      );

      expect(_richTextContaining('Usage: Once per customer'), findsOneWidget);
      expect(_richTextContaining('Usage: Once per day'), findsOneWidget);
    });

    testWidgets('expires and restricted usage share a compact row', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BiteSaverCouponDetailInfoSection(
              title: 'Dinner Deal',
              details: null,
              expiresLabel: 'Exp. Jun 30, 8:00 PM',
              restaurantName: 'BiteSaver Cafe',
              usageRule: 'Once per day',
              unavailableStatus: null,
              isOpeningRestaurant: false,
              onOpenRestaurant: () {},
            ),
          ),
        ),
      );

      final expiresTop = tester
          .getTopLeft(_richTextContaining('Expires: Exp. Jun 30, 8:00 PM'))
          .dy;
      final usageTop = tester
          .getTopLeft(_richTextContaining('Usage: Once per day'))
          .dy;

      expect(usageTop, expiresTop);
    });

    testWidgets('unavailable status is red and available status is absent', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BiteSaverCouponDetailInfoSection(
              title: 'Paused Deal',
              details: null,
              expiresLabel: 'Exp. Jun 30, 8:00 PM',
              restaurantName: 'BiteSaver Cafe',
              usageRule: 'Unlimited',
              unavailableStatus: 'Currently unavailable',
              isOpeningRestaurant: false,
              onOpenRestaurant: () {},
            ),
          ),
        ),
      );

      final statusRichText = tester.widget<RichText>(
        _richTextContaining('Status: Currently unavailable'),
      );
      final statusSpan = statusRichText.text as TextSpan;

      expect(statusSpan.toPlainText(), 'Status: Currently unavailable');
      expect(statusSpan.style?.color, Colors.red);
      expect(find.textContaining('Available now'), findsNothing);
    });

    testWidgets('favorite action slot remains available beside title', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BiteSaverCouponDetailInfoSection(
              title: 'Saved Deal',
              details: null,
              expiresLabel: 'Exp. Jun 30, 8:00 PM',
              restaurantName: 'BiteSaver Cafe',
              usageRule: 'Unlimited',
              unavailableStatus: null,
              isOpeningRestaurant: false,
              onOpenRestaurant: () {},
              trailingTitleAction: IconButton(
                tooltip: 'Save coupon',
                onPressed: () {},
                icon: const Icon(Icons.favorite_border),
              ),
            ),
          ),
        ),
      );

      expect(find.byTooltip('Save coupon'), findsOneWidget);
      expect(find.byIcon(Icons.favorite_border), findsOneWidget);
    });

    testWidgets('restaurant row appears above Report action', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                BiteSaverCouponDetailInfoSection(
                  title: 'Dinner Deal',
                  details: null,
                  expiresLabel: 'Exp. Jun 30, 8:00 PM',
                  restaurantName: 'BiteSaver Cafe',
                  usageRule: 'Unlimited',
                  unavailableStatus: null,
                  isOpeningRestaurant: false,
                  onOpenRestaurant: () {},
                ),
                TextButton.icon(
                  onPressed: () {},
                  icon: const Icon(Icons.flag_outlined),
                  label: const Text('Report'),
                ),
              ],
            ),
          ),
        ),
      );

      expect(
        tester.getTopLeft(find.text('BiteSaver Cafe')).dy,
        lessThan(tester.getTopLeft(find.text('Report')).dy),
      );
      expect(find.byIcon(Icons.flag_outlined), findsOneWidget);
    });

    testWidgets('unlimited coupon number appears beside Report', (
      tester,
    ) async {
      var reported = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BiteSaverCouponReportRow(
              isSubmittingReport: false,
              onReport: () {
                reported = true;
              },
              couponNumberLabel: '47',
            ),
          ),
        ),
      );

      expect(find.text('Report'), findsOneWidget);
      expect(find.text('Code: 0047'), findsOneWidget);
      expect(
        tester.getTopLeft(find.text('Report')).dx,
        lessThan(tester.getTopLeft(find.text('Code: 0047')).dx),
      );

      await tester.tap(find.byKey(BiteSaverCouponReportRow.reportButtonKey));

      expect(reported, isTrue);
    });

    testWidgets('limited coupon number is hidden before redemption', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: BiteSaverCouponReportRow(
              isSubmittingReport: false,
              onReport: null,
              couponNumberLabel: null,
            ),
          ),
        ),
      );

      expect(find.text('Report'), findsOneWidget);
      expect(
        find.byKey(BiteSaverCouponReportRow.couponNumberKey),
        findsNothing,
      );
      expect(find.textContaining('Code:'), findsNothing);
    });

    test('coupon number visibility follows redemption timer state', () {
      expect(
        BiteSaverCouponNumberVisibility.shouldShow(
          supportsRedeemTimer: false,
          hasActiveTimer: false,
        ),
        isTrue,
      );
      expect(
        BiteSaverCouponNumberVisibility.shouldShow(
          supportsRedeemTimer: true,
          hasActiveTimer: false,
        ),
        isFalse,
      );
      expect(
        BiteSaverCouponNumberVisibility.shouldShow(
          supportsRedeemTimer: true,
          hasActiveTimer: true,
        ),
        isTrue,
      );
    });

    test('usage visibility helper preserves restricted rules', () {
      expect(
        BiteSaverCouponDetailInfoSection.isUnlimitedUsage('Unlimited'),
        isTrue,
      );
      expect(
        BiteSaverCouponDetailInfoSection.isUnlimitedUsage(' unlimited '),
        isTrue,
      );
      expect(
        BiteSaverCouponDetailInfoSection.isUnlimitedUsage('Once per customer'),
        isFalse,
      );
      expect(
        BiteSaverCouponDetailInfoSection.isUnlimitedUsage('Once per day'),
        isFalse,
      );
      expect(
        BiteSaverCouponDetailInfoSection.isUnlimitedUsage('Limited quantity'),
        isFalse,
      );
    });

    test('uses existing BiteSaver palette for readable text', () {
      expect(BiteSaverColors.ink, const Color(0xFF111827));
      expect(BiteSaverColors.valueInk, const Color(0xFF475569));
      expect(BiteSaverColors.orangeDark, const Color(0xFFB7542D));
    });
  });
}

Finder _richTextContaining(String text) {
  return find.byWidgetPredicate(
    (widget) => widget is RichText && widget.text.toPlainText().contains(text),
  );
}
