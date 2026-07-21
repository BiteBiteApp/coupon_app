import 'dart:async';

import 'package:coupon_app/screens/admin_gate_screen.dart';
import 'package:coupon_app/screens/customer_account_screen.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  testWidgets('authorized administrator sees Admin Workspace', (tester) async {
    await tester.pumpWidget(_testApp(Stream<User?>.value(_adminUser())));
    await tester.pumpAndSettle();

    expect(find.text('Admin Workspace'), findsOneWidget);
  });

  testWidgets('authenticated non-admin does not see Admin Workspace', (
    tester,
  ) async {
    await tester.pumpWidget(
      _testApp(Stream<User?>.value(_user(email: 'person@example.com'))),
    );
    await tester.pumpAndSettle();

    expect(find.text('Admin Workspace'), findsNothing);
  });

  testWidgets('anonymous and signed-out users do not see Admin Workspace', (
    tester,
  ) async {
    await tester.pumpWidget(
      _testApp(Stream<User?>.value(_user(email: null, isAnonymous: true))),
    );
    await tester.pumpAndSettle();
    expect(find.text('Admin Workspace'), findsNothing);

    await tester.pumpWidget(_testApp(Stream<User?>.value(null)));
    await tester.pumpAndSettle();
    expect(find.text('Admin Workspace'), findsNothing);
  });

  testWidgets('loading and auth error states fail closed', (tester) async {
    final loadingController = StreamController<User?>();
    addTearDown(loadingController.close);

    await tester.pumpWidget(_testApp(loadingController.stream));
    await tester.pump();
    expect(find.text('Admin Workspace'), findsNothing);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pumpWidget(
      _testApp(Stream<User?>.error(StateError('Injected auth error'))),
    );
    await tester.pumpAndSettle();
    expect(find.text('Admin Workspace'), findsNothing);
  });

  testWidgets('Admin Workspace opens the independently enforcing gate', (
    tester,
  ) async {
    final nonAdmin = _user(email: 'person@example.com');

    await tester.pumpWidget(
      _testApp(
        Stream<User?>.value(_adminUser()),
        adminDestinationBuilder: (_) =>
            AdminGateScreen(userStream: Stream<User?>.value(nonAdmin)),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Admin Workspace'));
    await tester.pumpAndSettle();

    expect(find.byType(AdminGateScreen), findsOneWidget);
    expect(find.text('Admin Access Denied'), findsOneWidget);
  });
}

Widget _testApp(
  Stream<User?> userStream, {
  WidgetBuilder? adminDestinationBuilder,
}) {
  return MaterialApp(
    home: CustomerAccountScreen(
      userStream: userStream,
      adminDestinationBuilder: adminDestinationBuilder,
    ),
  );
}

User _adminUser() => _user(email: 'schuyler.cole@gmail.com');

User _user({required String? email, bool isAnonymous = false}) {
  return _TestUser(email: email, isAnonymous: isAnonymous);
}

class _TestUser extends Fake implements User {
  @override
  final String? email;

  @override
  final bool isAnonymous;

  _TestUser({required this.email, required this.isAnonymous});

  @override
  String get uid => 'test-user';

  @override
  String? get displayName => null;

  @override
  bool get emailVerified => true;

  @override
  List<UserInfo> get providerData => const <UserInfo>[];
}
