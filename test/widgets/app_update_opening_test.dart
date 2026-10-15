import 'dart:async';
import 'dart:convert';

import 'package:coupon_app/main.dart';

import 'package:coupon_app/services/app_update/app_update_service.dart';
import 'package:coupon_app/widgets/app_update_opening.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../services/app_update/app_update_service_test.dart'
    show MemoryUpdateStorage, FakeUpdatePlatform;

void main() {
  late MemoryUpdateStorage storage;
  late FakeUpdatePlatform platform;
  late DateTime now;
  late AppUpdateService service;
  final navigator = GlobalKey<NavigatorState>();
  setUp(() {
    now = DateTime.utc(2026, 10, 14);
    storage = MemoryUpdateStorage();
    platform = FakeUpdatePlatform();
    storage.data[AppUpdateOpeningSafety.key] = jsonEncode({
      'foreground': false,
      'at': now.subtract(const Duration(minutes: 6)).millisecondsSinceEpoch,
    });
    service = AppUpdateService(
      platform: platform,
      storage: storage,
      clock: () => now,
    );
  });
  Widget app({bool enabled = true, double scale = 1}) => MaterialApp(
    navigatorKey: navigator,
    home: AppUpdateOpening(
      service: service,
      safety: AppUpdateOpeningSafety(storage, clock: () => now),
      enabled: enabled,
      child: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const Scaffold(
                  body: Text('Protected editing / timer / auth'),
                ),
              ),
            ),
            child: const Text('Open work'),
          ),
        ),
      ),
    ),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(scale)),
      child: child!,
    ),
  );
  Future<void> open(
    WidgetTester tester, {
    bool required = false,
    double scale = 1,
  }) async {
    platform.release = AppUpdateRelease(build: 10, urgent: required);
    await tester.pumpWidget(app(scale: scale));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'real dialog postpones once through rebuilds and repeated resume',
    (tester) async {
      await open(tester);
      expect(find.text('Update BiteStar'), findsOneWidget);
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);
      await tester.tap(find.text('Remind Me Tomorrow'));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      final data = jsonDecode(
        storage.data['app_update.v1.android:com.colesmart.bitestar:10']!,
      );
      expect(data['count'], 1);
      expect(data['at'], now.millisecondsSinceEpoch);
      now = now.add(const Duration(days: 2));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets('ordinary Back dismisses without counting a postponement', (
    tester,
  ) async {
    await open(tester);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    expect(
      storage.data.keys.where((k) => k.startsWith('app_update.v1.')),
      isEmpty,
    );
  });

  testWidgets(
    'required Back stays gated; cancellation allows manual retry only',
    (tester) async {
      await open(tester, required: true);
      expect(find.text('Remind Me Tomorrow'), findsNothing);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('Update required'), findsOneWidget);
      await tester.tap(find.text('Update Now'));
      await tester.pumpAndSettle();
      expect(platform.opens, 1);
      expect(find.textContaining('not been installed'), findsOneWidget);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(platform.opens, 1);
      expect(find.text('Update required'), findsOneWidget);
    },
  );

  for (final kind in ['failure', 'updated', 'offline', 'unavailable']) {
    testWidgets(
      '$kind store return releases required gate without consuming choices',
      (tester) async {
        platform.onOpen = () async {
          if (kind == 'failure') return AppUpdateHandoff.failed;
          if (kind == 'offline') {
            platform.onCheck = () => Future.error(StateError('offline'));
          } else {
            platform.release = null;
          }
          return AppUpdateHandoff.returned;
        };
        await open(tester, required: true);
        await tester.tap(find.text('Update Now'));
        await tester.pumpAndSettle();
        expect(find.byType(AlertDialog), findsNothing);
        expect(
          storage.data.keys.where((k) => k.startsWith('app_update.v1.')),
          isEmpty,
        );
      },
    );
  }

  testWidgets(
    'late check cannot interrupt a user interaction or nested protected route',
    (tester) async {
      final completer = Completer<AppUpdateRelease?>();
      platform.onCheck = () => completer.future;
      await tester.pumpWidget(app());
      await tester.pump();
      await tester.tap(find.text('Open work'));
      await tester.pumpAndSettle();
      completer.complete(platform.release);
      await tester.pumpAndSettle();
      expect(find.text('Protected editing / timer / auth'), findsOneWidget);
      expect(find.byType(AlertDialog), findsNothing);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets(
    'existing modal is not interrupted and recent session protects timer',
    (tester) async {
      final completer = Completer<AppUpdateRelease?>();
      platform.onCheck = () => completer.future;
      await tester.pumpWidget(app());
      await tester.pump();
      unawaited(
        showDialog<void>(
          context: navigator.currentContext!,
          builder: (_) => const AlertDialog(title: Text('Verify account')),
        ),
      );
      await tester.pumpAndSettle();
      completer.complete(platform.release);
      await tester.pumpAndSettle();
      expect(find.text('Verify account'), findsOneWidget);
      expect(find.text('Update BiteStar'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      storage.data[AppUpdateOpeningSafety.key] = jsonEncode({
        'foreground': false,
        'at': now.subtract(const Duration(minutes: 4)).millisecondsSinceEpoch,
      });
      platform.onCheck = null;
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets(
    'background during availability and external return cannot start dialog',
    (tester) async {
      final completer = Completer<AppUpdateRelease?>();
      platform.onCheck = () => completer.future;
      await tester.pumpWidget(app());
      await tester.pump();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      completer.complete(platform.release);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets(
    'narrow landscape and large text keep actions scrollable and accessible',
    (tester) async {
      tester.view.physicalSize = const Size(320, 480);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await open(tester, scale: 2.5);
      expect(tester.takeException(), null);
      await tester.ensureVisible(find.text('Remind Me Tomorrow'));
      await tester.tap(find.text('Remind Me Tomorrow'));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(tester.takeException(), null);
    },
  );

  testWidgets('disabled deep-link opening preserves ordinary navigation', (
    tester,
  ) async {
    await tester.pumpWidget(app(enabled: false));
    await tester.pumpAndSettle();
    expect(platform.checks, 0);
    await tester.tap(find.text('Open work'));
    await tester.pumpAndSettle();
    expect(find.text('Protected editing / timer / auth'), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Open work'), findsOneWidget);
  });
  testWidgets(
    'CouponApp initial factory wires reminder and excludes account/deep links',
    (tester) async {
      Widget realApp() => CouponApp(
        testInitializePlatformServices: false,
        testWrapCelebrationHosts: false,
        testUpdateService: service,
        testUpdateSafety: AppUpdateOpeningSafety(storage, clock: () => now),
        testNavigationBuilder: (_, _) => const Scaffold(body: Text('App home')),
        testAccountDeletionBuilder: (_) =>
            const Scaffold(body: Text('Account deletion')),
      );
      await tester.pumpWidget(realApp());
      await tester.pumpAndSettle();
      expect(find.text('Update BiteStar'), findsOneWidget);
      await tester.tap(find.text('Remind Me Tomorrow'));
      await tester.pumpAndSettle();
      expect(find.text('App home'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      tester.platformDispatcher.defaultRouteNameTestValue =
          '/r/bitesaver/example';
      addTearDown(tester.platformDispatcher.clearDefaultRouteNameTestValue);
      final checks = platform.checks;
      await tester.pumpWidget(realApp());
      await tester.pumpAndSettle();
      expect(platform.checks, checks);
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets(
    'both persisted dialog choices lead to required gate only after final boundary',
    (tester) async {
      Future<void> reopen() async {
        await tester.pumpWidget(const SizedBox());
        storage.data[AppUpdateOpeningSafety.key] = jsonEncode({
          'foreground': false,
          'at': now.subtract(const Duration(minutes: 6)).millisecondsSinceEpoch,
        });
        await tester.pumpWidget(app());
        await tester.pumpAndSettle();
      }

      await open(tester);
      await tester.tap(find.text('Remind Me Tomorrow'));
      await tester.pumpAndSettle();
      now = now.add(const Duration(hours: 24));
      await reopen();
      expect(
        find.text('This is your final reminder postponement.'),
        findsOneWidget,
      );
      await tester.tap(find.text('Remind Me Tomorrow'));
      await tester.pumpAndSettle();
      now = now.add(
        const Duration(hours: 24) - const Duration(milliseconds: 1),
      );
      await reopen();
      expect(find.byType(AlertDialog), findsNothing);
      now = now.add(const Duration(milliseconds: 1));
      await reopen();
      expect(find.text('Update required'), findsOneWidget);
      expect(find.text('Remind Me Tomorrow'), findsNothing);
    },
  );
  testWidgets(
    'link-started session retires stale marker before a recent normal restart',
    (tester) async {
      await tester.pumpWidget(app(enabled: false));
      await tester.pumpAndSettle();
      expect(platform.checks, 0);
      expect(
        jsonDecode(storage.data[AppUpdateOpeningSafety.key]!)['foreground'],
        true,
      );
      await tester.pumpWidget(const SizedBox());
      // Simulate a crash while the link-started coupon screen is foreground.
      now = now.add(const Duration(minutes: 1));
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      expect(platform.checks, 0);
      expect(find.byType(AlertDialog), findsNothing);
    },
  );
  testWidgets(
    'delayed external return suppresses prompt before any destination is pushed',
    (tester) async {
      final response = Completer<AppUpdateRelease?>();
      platform.onCheck = () => response.future;
      await tester.pumpWidget(app());
      await tester.pump();
      // Native ACTION_VIEW arrives while the real return handler is still awaiting
      // its inbox/owner checks; the route is deliberately still current Home.
      platform.interrupt.add(null);
      await tester.pump();
      response.complete(platform.release);
      await tester.pumpAndSettle();
      expect(find.text('Open work'), findsOneWidget);
      expect(find.byType(AlertDialog), findsNothing);
    },
  );

  testWidgets(
    'external entry removes only update dialog and preserves a later modal',
    (tester) async {
      await open(tester, required: true);
      unawaited(
        showDialog<void>(
          context: navigator.currentContext!,
          builder: (_) =>
              const AlertDialog(title: Text('External return confirmation')),
        ),
      );
      await tester.pumpAndSettle();
      platform.interrupt.add(null);
      await tester.pumpAndSettle();
      expect(find.text('Update required'), findsNothing);
      expect(find.text('External return confirmation'), findsOneWidget);
    },
  );

  testWidgets('dialog actions have accessible labels and touch targets', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await open(tester);
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    semantics.dispose();
  });
  for (final action in ['postpone', 'handoff']) {
    testWidgets(
      'delayed $action completion closes only its own covered route',
      (tester) async {
        final pending = Completer<void>();
        if (action == 'postpone') {
          storage.beforeWrite = (key) async {
            if (key.startsWith('app_update.v1.')) await pending.future;
          };
        } else {
          platform.onOpen = () async {
            await pending.future;
            return AppUpdateHandoff.failed;
          };
        }
        await open(tester);
        await tester.tap(
          find.text(action == 'postpone' ? 'Remind Me Tomorrow' : 'Update Now'),
        );
        await tester.pump();
        unawaited(
          showDialog<void>(
            context: navigator.currentContext!,
            builder: (_) =>
                const AlertDialog(title: Text('Keep this confirmation')),
          ),
        );
        await tester.pump(const Duration(milliseconds: 400));
        pending.complete();
        await tester.pumpAndSettle();
        expect(find.text('Keep this confirmation'), findsOneWidget);
        expect(find.text('Update BiteStar'), findsNothing);
      },
    );
  }
}
