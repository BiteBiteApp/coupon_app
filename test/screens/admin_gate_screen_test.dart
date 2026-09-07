import 'package:coupon_app/screens/admin_gate_screen.dart';
import 'package:coupon_app/screens/admin_link_generation_screen.dart';
import 'package:coupon_app/widgets/admin_content_insets.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('authorized administrator sees and opens all three admin tabs', (
    tester,
  ) async {
    await _pumpGate(tester, user: _user(email: 'schuyler.cole@gmail.com'));

    expect(find.text('Coupon Side'), findsOneWidget);
    expect(find.text('Rating Side'), findsOneWidget);
    expect(find.text('Link Generation'), findsOneWidget);
    expect(find.text('Coupon destination'), findsOneWidget);

    await tester.tap(find.text('Link Generation'));
    await tester.pumpAndSettle();

    expect(find.text('Link generation destination'), findsOneWidget);
  });

  testWidgets('unauthorized users remain blocked before destinations build', (
    tester,
  ) async {
    var destinationBuilds = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: AdminGateScreen(
          userStream: Stream<User?>.value(_user(email: 'user@example.com')),
          couponAdminBuilder: (_) {
            destinationBuilds += 1;
            return const SizedBox();
          },
          ratingAdminBuilder: (_) {
            destinationBuilds += 1;
            return const SizedBox();
          },
          linkGenerationBuilder: (_) {
            destinationBuilds += 1;
            return const SizedBox();
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Admin Access Denied'), findsOneWidget);
    expect(find.text('Link Generation'), findsNothing);
    expect(destinationBuilds, 0);
  });

  testWidgets('three-tab layout remains overflow-free when narrow and scaled', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(320, 700);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpGate(
      tester,
      user: _user(email: 'schuyler.cole@gmail.com'),
      textScale: 2,
    );

    expect(find.text('Coupon Side'), findsOneWidget);
    expect(find.text('Rating Side'), findsOneWidget);
    expect(find.text('Link Generation'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('authorized route has no phantom customer-navigation dead band', (
    tester,
  ) async {
    await _setViewSize(tester, const Size(800, 700));
    await _pumpGate(tester, user: _user(email: 'schuyler.cole@gmail.com'));

    final workspace = tester.getRect(
      find.byKey(const ValueKey('admin-workspace')),
    );
    expect(
      workspace.bottom,
      closeTo(700 - AdminContentInsets.bottomBreathingRoom, 0.01),
    );
  });

  testWidgets('authorized route preserves one genuine system bottom inset', (
    tester,
  ) async {
    await _setViewSize(tester, const Size(800, 700));
    await _pumpGate(
      tester,
      user: _user(email: 'schuyler.cole@gmail.com'),
      bottomViewPadding: 34,
    );

    final workspace = tester.getRect(
      find.byKey(const ValueKey('admin-workspace')),
    );
    expect(
      workspace.bottom,
      closeTo(700 - 34 - AdminContentInsets.bottomBreathingRoom, 0.01),
    );
  });

  testWidgets('shared workspace bounds and centers every admin tab', (
    tester,
  ) async {
    await _setViewSize(tester, const Size(1920, 900));
    await _pumpGate(
      tester,
      user: _user(email: 'schuyler.cole@gmail.com'),
      keyedDestinations: true,
    );

    _expectCenteredWorkspace(tester, viewportWidth: 1920);
    _expectDestinationMatchesWorkspace(tester, 'coupon-destination');

    await tester.tap(find.text('Rating Side'));
    await tester.pumpAndSettle();
    _expectDestinationMatchesWorkspace(tester, 'rating-destination');

    await tester.tap(find.text('Link Generation'));
    await tester.pumpAndSettle();
    _expectDestinationMatchesWorkspace(tester, 'link-destination');

    await _setViewSize(tester, const Size(1440, 900), registerReset: false);
    await tester.pumpAndSettle();
    _expectCenteredWorkspace(tester, viewportWidth: 1440);
    _expectDestinationMatchesWorkspace(tester, 'link-destination');
  });

  testWidgets('shared workspace preserves narrow widths and text scaling', (
    tester,
  ) async {
    const widths = <double>[320, 360, 390, 430, 600, 768, 1024, 1280];
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    tester.view.devicePixelRatio = 1;

    for (final width in widths) {
      tester.view.physicalSize = Size(width, 900);
      await _pumpGate(
        tester,
        user: _user(email: 'schuyler.cole@gmail.com'),
        textScale: width == 320 ? 2 : 1,
        keyedDestinations: true,
      );

      final workspace = tester.getRect(
        find.byKey(const ValueKey('admin-workspace')),
      );
      final expectedWidth = width.clamp(
        0,
        AdminContentInsets.maxAdminWorkspaceWidth,
      );
      expect(
        workspace.width,
        closeTo(expectedWidth, 0.01),
        reason: 'width $width',
      );
      expect(
        workspace.center.dx,
        closeTo(width / 2, 0.01),
        reason: 'width $width',
      );
      expect(tester.takeException(), isNull, reason: 'width $width');
    }
  });

  testWidgets(
    'Link Generation keeps its existing lazy list and inner padding',
    (tester) async {
      await _setViewSize(tester, const Size(1920, 900));
      await _pumpGate(
        tester,
        user: _user(email: 'schuyler.cole@gmail.com'),
        linkGenerationBuilder: (_) => AdminLinkGenerationScreen(
          searchRestaurants:
              ({
                required locationQuery,
                required radiusMiles,
                required restaurantName,
                required sources,
              }) =>
                  throw UnimplementedError('Search is not triggered by layout'),
        ),
      );

      await tester.tap(find.text('Link Generation'));
      await tester.pumpAndSettle();

      final workspace = tester.getRect(
        find.byKey(const ValueKey('admin-workspace')),
      );
      final searchCard = find.ancestor(
        of: find.text('Find restaurants'),
        matching: find.byType(Card),
      );
      expect(find.byType(ListView), findsWidgets);
      expect(
        tester.getSize(searchCard.first).width,
        closeTo(workspace.width - 32, 0.01),
      );
      expect(tester.takeException(), isNull);
    },
  );
}

Future<void> _pumpGate(
  WidgetTester tester, {
  required User user,
  double textScale = 1,
  double bottomViewPadding = 0,
  bool keyedDestinations = false,
  WidgetBuilder? linkGenerationBuilder,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(textScale),
          viewPadding: EdgeInsets.only(bottom: bottomViewPadding),
        ),
        child: child!,
      ),
      home: AdminGateScreen(
        userStream: Stream<User?>.value(user),
        couponAdminBuilder: (_) => keyedDestinations
            ? const SizedBox.expand(key: ValueKey('coupon-destination'))
            : const Center(child: Text('Coupon destination')),
        ratingAdminBuilder: (_) => keyedDestinations
            ? const SizedBox.expand(key: ValueKey('rating-destination'))
            : const Center(child: Text('Rating destination')),
        linkGenerationBuilder:
            linkGenerationBuilder ??
            (_) => keyedDestinations
                ? const SizedBox.expand(key: ValueKey('link-destination'))
                : const Center(child: Text('Link generation destination')),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _setViewSize(
  WidgetTester tester,
  Size size, {
  bool registerReset = true,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
  if (registerReset) {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }
}

void _expectCenteredWorkspace(
  WidgetTester tester, {
  required double viewportWidth,
}) {
  final workspace = tester.getRect(
    find.byKey(const ValueKey('admin-workspace')),
  );
  expect(
    workspace.width,
    closeTo(AdminContentInsets.maxAdminWorkspaceWidth, 0.01),
  );
  expect(workspace.center.dx, closeTo(viewportWidth / 2, 0.01));
}

void _expectDestinationMatchesWorkspace(WidgetTester tester, String key) {
  final workspace = tester.getRect(
    find.byKey(const ValueKey('admin-workspace')),
  );
  final destination = tester.getRect(find.byKey(ValueKey(key)));
  expect(destination.left, closeTo(workspace.left, 0.01));
  expect(destination.right, closeTo(workspace.right, 0.01));
}

User _user({required String email}) => _TestUser(email: email);

class _TestUser extends Fake implements User {
  @override
  final String email;

  _TestUser({required this.email});

  @override
  bool get isAnonymous => false;

  @override
  String get uid => 'test-user';
}
