import 'dart:async';

import 'package:coupon_app/models/customer_bitescore_search.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/customer_bitescore_reads.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/customer_bitescore_search_service_test.dart'
    show dishProjection, restaurantProjection;

class _ReviewUser extends Fake implements User {
  @override
  final String uid;
  _ReviewUser(this.uid);
  @override
  bool get isAnonymous => false;
  @override
  bool get emailVerified => true;
  @override
  String? get email => '$uid@example.test';
}

void main() {
  testWidgets(
    'auth refresh retires an in-flight photo append without disabling the new page',
    (tester) async {
      CustomerBiteScoreRuntime.testEnabled = true;
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(900, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      addTearDown(() => CustomerBiteScoreRuntime.testEnabled = null);
      addTearDown(() => AppModeStateService.setMode(AppMode.biteSaver));
      final authChanges = StreamController<String>.broadcast(sync: true);
      addTearDown(authChanges.close);
      var authRealm = 'signed:A';
      User currentUser = _ReviewUser('A');
      final staleAppend = Completer<Object?>();
      var firstPageLoads = 0;
      final cursors = <String>[];
      final reads = CustomerBiteScoreReads(
        actorKey: () => authRealm,
        boundary: (name, request) async {
          if (name == 'getCustomerBiteScoreDetail') {
            return {
              'kind': 'dish',
              'dish': dishProjection('dish'),
              'restaurant': restaurantProjection('restaurant-1'),
              'isFavorite': false,
              'canManage': false,
            };
          }
          if (name == 'pageCustomerBiteScoreReviews') {
            return {'items': [], 'nextCursor': null};
          }
          expect(name, 'pageCustomerBiteScoreImages');
          final cursor = request['cursor'] as String?;
          if (cursor == null) {
            firstPageLoads++;
            return {
              'items': [],
              'nextCursor': firstPageLoads == 1 ? 'A-next' : 'B-next',
            };
          }
          cursors.add(cursor);
          if (cursor == 'A-next') return staleAppend.future;
          return {'items': [], 'nextCursor': null};
        },
      );
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialMode: AppMode.biteScore,
            initializePlatformServices: false,
            testCustomerAuthRealmProvider: () => authRealm,
            testCustomerAuthRealmChanges: authChanges.stream,
            testModeHomeBuilder: (_, _) => const SizedBox.shrink(),
            testPagesBuilder: (_) => const [
              SizedBox.shrink(),
              SizedBox.shrink(),
              SizedBox.shrink(),
            ],
          ),
        ),
      );
      await tester.pumpAndSettle();
      rootNavigatorKey.currentState!.push<void>(
        MaterialPageRoute(
          builder: (_) => BiteScoreDishDetailScreen(
            entry: CustomerBiteScorePublicData.entry(dishProjection('dish')),
            testCustomerReads: reads,
            testCurrentUserProvider: () => currentUser,
          ),
        ),
      );
      await tester.pumpAndSettle();
      final more = find.widgetWithText(OutlinedButton, 'Load more photos');
      await tester.ensureVisible(more);
      await tester.tap(more);
      await tester.pump();
      expect(cursors, ['A-next']);
      expect(tester.widget<OutlinedButton>(more).onPressed, isNull);

      currentUser = _ReviewUser('B');
      authRealm = 'signed:B';
      authChanges.add(authRealm);
      await tester.pumpAndSettle();
      expect(firstPageLoads, 2);
      staleAppend.complete({'items': [], 'nextCursor': null});
      await tester.pumpAndSettle();
      await tester.ensureVisible(more);
      expect(tester.widget<OutlinedButton>(more).onPressed, isNotNull);
      await tester.tap(more);
      await tester.pumpAndSettle();
      expect(cursors, ['A-next', 'B-next']);
      expect(more, findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
