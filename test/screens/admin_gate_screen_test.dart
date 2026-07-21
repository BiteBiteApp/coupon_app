import 'package:coupon_app/screens/admin_gate_screen.dart';
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
}

Future<void> _pumpGate(
  WidgetTester tester, {
  required User user,
  double textScale = 1,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: AdminGateScreen(
        userStream: Stream<User?>.value(user),
        couponAdminBuilder: (_) =>
            const Center(child: Text('Coupon destination')),
        ratingAdminBuilder: (_) =>
            const Center(child: Text('Rating destination')),
        linkGenerationBuilder: (_) =>
            const Center(child: Text('Link generation destination')),
      ),
    ),
  );
  await tester.pumpAndSettle();
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
