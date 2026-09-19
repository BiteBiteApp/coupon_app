import 'dart:async';
import 'package:coupon_app/screens/customer_profile_screen.dart';
import 'package:coupon_app/screens/public_reviewer_profile_screen.dart';
import 'package:coupon_app/screens/local_expert_reviews_screen.dart';
import 'package:coupon_app/services/customer_bitescore_profile_service.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/customer_bitescore_profile_service_test.dart'
    show profileReview, profileSummary;
import '../services/customer_bitescore_search_service_test.dart'
    show FakeSearchApi, response;

class _User implements User {
  @override
  String get uid => 'reviewer';
  @override
  bool get isAnonymous => false;
  @override
  String? get email => 'reviewer@example.com';
  @override
  String? get displayName => 'Reviewer';
  @override
  bool get emailVerified => true;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  setUp(() {
    CustomerBiteScoreRuntime.testEnabled = true;
    SharedPreferences.setMockInitialValues({});
    SharedLocationStateService.resetForTesting();
  });
  tearDown(() {
    CustomerBiteScoreRuntime.testEnabled = null;
    SharedLocationStateService.resetForTesting();
  });
  testWidgets('public profile presents bounded pages and authoritative count', (
    tester,
  ) async {
    final api = FakeSearchApi((name, request) async {
      if (name.contains('Summary')) return profileSummary();
      if (name.startsWith('start')) return response();
      return response(
        items: [profileReview(request['cursor'] == null ? 'one' : 'two')],
        cursor: request['cursor'] == null ? 'next' : null,
      );
    });
    await tester.pumpWidget(
      MaterialApp(
        home: PublicReviewerProfileScreen(
          userId: 'reviewer',
          boundedProfileService: CustomerBiteScoreProfileService(api: api),
          badgesLoader: (_) async => [],
          canEditReview: (_) => false,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('93 reviews'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Load more'),
      400,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Load more'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('Dish two'),
      350,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Dish two'), findsOneWidget);
    expect(tester.takeException(), isNull);
    expect(
      api.calls
          .where((name) => name == 'getCustomerBiteScoreProfileListPage')
          .length,
      2,
    );
  });
  testWidgets('Local Expert sort issues a new globally prepared query', (
    tester,
  ) async {
    final sorts = <String>[];
    final api = FakeSearchApi((name, request) async {
      if (name.startsWith('start')) {
        sorts.add((request['criteria'] as Map)['sort'] as String);
        return response();
      }
      return response(items: [profileReview(sorts.last)]);
    });
    await tester.pumpWidget(
      MaterialApp(
        home: LocalExpertReviewsScreen(
          reviewerUserId: 'reviewer',
          reviewerDisplayName: 'Public Reviewer',
          expertTypeId: 'burger',
          expertDisplayName: 'Burger',
          boundedProfileService: CustomerBiteScoreProfileService(api: api),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byType(DropdownButtonFormField<LocalExpertReviewSort>),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Most recent').last);
    await tester.pumpAndSettle();
    expect(sorts, ['highestRated', 'mostRecent']);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'bounded BiteScore profile preserves independent legacy BiteSaver loader',
    (tester) async {
      var legacyCalls = 0, identityCalls = 0;
      final api = FakeSearchApi(
        (name, request) async =>
            name.contains('Summary') ? profileSummary() : response(),
      );
      final summary = await CustomerBiteScoreProfileService(
        api: api,
      ).summary('reviewer');
      final user = _User();
      await tester.pumpWidget(
        MaterialApp(
          home: CustomerProfileScreen(
            currentUser: user,
            testCurrentUserProvider: () => user,
            boundedProfileService: CustomerBiteScoreProfileService(
              api: api,
              actorKey: () => 'user:reviewer',
            ),
            testPrepareProfileIdentity: () async {
              identityCalls++;
            },
            testLocalExpertBadgesLoader: (_) async => [],
            testLegacyBiteSaverLoader: () async {
              legacyCalls++;
              return CustomerBiteScoreProfileService.ownProfile(summary);
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(legacyCalls, 1);
      expect(identityCalls, 1);
      expect(
        api.calls
            .where((name) => name == 'startCustomerBiteScoreProfileList')
            .length,
        2,
      );
      expect(find.text('My Profile'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'default profile retains its supplied legacy loader and never starts sessions',
    (tester) async {
      CustomerBiteScoreRuntime.testEnabled = false;
      final api = FakeSearchApi(
        (name, _) async => throw StateError('Unexpected bounded request'),
      );
      final user = _User();
      var legacyCalls = 0;
      final profile = CustomerBiteScoreProfileService.ownProfile(
        await CustomerBiteScoreProfileService(
          api: FakeSearchApi((_, _) async => profileSummary()),
        ).summary('reviewer'),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: CustomerProfileScreen(
            currentUser: user,
            testCurrentUserProvider: () => user,
            boundedProfileService: CustomerBiteScoreProfileService(api: api),
            testProfileLoader: (_) async {
              legacyCalls++;
              return profile;
            },
            testLocalExpertBadgesLoader: (_) async => [],
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(legacyCalls, 1);
      expect(api.calls, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'reused public profile fences a delayed previous reviewer session',
    (tester) async {
      final delayed = Completer<Map<String, dynamic>>();
      final api = FakeSearchApi((name, request) async {
        if (name.contains('Summary')) {
          return profileSummary(userId: request['userId'] as String);
        }
        if (name.startsWith('start')) {
          final userId = (request['criteria'] as Map)['userId'];
          return userId == 'old' ? delayed.future : response(session: 'new');
        }
        return response(
          session: 'new',
          items: [profileReview('new', userId: 'new')],
        );
      });
      final service = CustomerBiteScoreProfileService(api: api);
      Widget page(String userId) => MaterialApp(
        home: PublicReviewerProfileScreen(
          key: const ValueKey('same-profile'),
          userId: userId,
          boundedProfileService: service,
          badgesLoader: (_) async => [],
          canEditReview: (_) => false,
        ),
      );
      await tester.pumpWidget(page('old'));
      await tester.pump();
      await tester.pumpWidget(page('new'));
      await tester.pumpAndSettle();
      delayed.complete(response(session: 'old'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Dish new'),
        350,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Dish new'), findsOneWidget);
      expect(
        api.calls
            .where((name) => name == 'getCustomerBiteScoreProfileListPage')
            .length,
        1,
      );
      expect(tester.takeException(), isNull);
    },
  );
}
