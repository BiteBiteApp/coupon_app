// ignore_for_file: depend_on_referenced_packages
import 'dart:async';
import 'dart:typed_data';

import 'package:cloud_firestore_platform_interface/cloud_firestore_platform_interface.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/dish_rating_aggregate.dart';
import 'package:coupon_app/models/dish_review.dart';
import 'package:coupon_app/screens/bitescore_create_rate_screen.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/services/bitescore_terms_service.dart';
import 'package:coupon_app/services/contribution_points_service.dart';
import 'package:coupon_app/widgets/bitescore_category_picker.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/firebase_core_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';

enum _Path { existing, newDish, manual, duplicateExisting, duplicateNew }

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final core = FirebasePlatform.instance;
  FirebasePlatform.instance = _Core();
  final firestore = FirebaseFirestorePlatform.instance;
  final picker = ImagePickerPlatform.instance;
  final store = _Store();
  setUpAll(() {
    FirebasePlatform.instance = _Core();
    FirebaseFirestorePlatform.instance = store;
    ImagePickerPlatform.instance = _Picker();
  });
  tearDownAll(() {
    FirebasePlatform.instance = core;
    FirebaseFirestorePlatform.instance = firestore;
    ImagePickerPlatform.instance = picker;
  });
  setUp(() {
    store.dishes = [];
    store.reads.clear();
  });

  for (final path in _Path.values) {
    testWidgets(
      '${path.name}: disabled Terms preserve save path without a prompt or receipt',
      (tester) async {
        final h = _Harness(store);
        await h.run(tester, path, () async {
          expect(BiteScoreTermsService.enabled, false);
          await h.submit(tester, path);
          expect(find.byType(AlertDialog), findsNothing);
          expect(h.calls, isEmpty);
          expect(h.writes, [_operation(path)]);
          expect(h.uids, ['A']);
          expect(find.byType(BiteScoreCreateRateScreen), findsNothing);
        });
      },
    );

    testWidgets(
      '${path.name}: approved acceptance precedes every public mutation',
      (tester) async {
        final h = _Harness(store, active: true);
        await h.run(tester, path, () async {
          await h.submit(tester, path);
          expect(h.writes, isEmpty);
          expect(h.calls, ['getCustomerBiteScoreTerms']);
          expect(find.text('Version: SIMULATED-APPROVED-v1'), findsOneWidget);
          expect(find.text('Simulated approved Terms only.'), findsOneWidget);
          expect(
            find.text(
              'Accept these Terms to submit your review. You can cancel and continue browsing.',
            ),
            findsOneWidget,
          );
          await tester.tap(find.widgetWithText(FilledButton, 'Accept Terms'));
          await tester.pumpAndSettle();
          expect(h.calls, [
            'getCustomerBiteScoreTerms',
            'acceptCustomerBiteScoreTerms',
          ]);
          expect(h.writes, [_operation(path)]);
          expect(h.events.last, 'write:${_operation(path)}');
          expect(find.byType(BiteScoreCreateRateScreen), findsNothing);
        });
      },
    );

    testWidgets(
      '${path.name}: cancel preserves complete draft and photo; retry reuses draft',
      (tester) async {
        final h = _Harness(store, active: true);
        await h.run(tester, path, () async {
          final addPhoto = find.widgetWithText(
            OutlinedButton,
            'Add dish image',
          );
          await tester.ensureVisible(addPhoto);
          await tester.tap(addPhoto);
          await tester.pumpAndSettle();
          expect(find.text('Dish image selected'), findsOneWidget);
          final draft = _draft(tester);
          await h.submit(tester, path);
          await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
          await tester.pumpAndSettle();
          expect(h.calls, ['getCustomerBiteScoreTerms']);
          expect(h.writes, isEmpty);
          expect(h.uids, isEmpty);
          expect(_draft(tester), draft);
          expect(find.text('Dish image selected'), findsOneWidget);
          expect(
            (tester.state(find.byType(BiteScoreCreateRateScreen)) as dynamic)
                .isSaving,
            false,
          );
          // Retry reaches the same protected boundary with the existing draft.
          await h.submit(tester, path);
          expect(find.text('Terms of Service'), findsOneWidget);
          expect(h.writes, isEmpty);
          await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
          await tester.pumpAndSettle();
          expect(_draft(tester), draft);
        });
      },
    );
  }

  testWidgets(
    'cancelling Terms produces no Home refresh, write or save result',
    (tester) async {
      final h = _Harness(store, active: true, withShell: true);
      await h.run(tester, _Path.existing, () async {
        final generation = h.homeRefreshGeneration;
        await h.submit(tester, _Path.existing);
        await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
        await tester.pumpAndSettle();
        expect(h.writes, isEmpty);
        await tester.tap(find.byTooltip('Back'));
        await tester.pumpAndSettle();
        expect(h.homeRefreshGeneration, generation);
        expect(find.byType(BiteScoreCreateRateScreen), findsNothing);
      });
    },
  );

  testWidgets(
    'expired auth lease stops pending Terms even when the same UID returns',
    (tester) async {
      final pending = Completer<Object?>();
      final h = _Harness(
        store,
        active: true,
        pending: pending,
        withShell: true,
      );
      await h.run(tester, _Path.existing, () async {
        await h.submit(tester, _Path.existing);
        h.authRealm = 'guest';
        h.authChanges.add(h.authRealm);
        await tester.pump();
        h.authRealm = 'signed:A';
        h.authChanges.add(h.authRealm);
        await tester.pump();
        pending.complete(_status(accepted: true));
        await tester.pumpAndSettle();
        expect(h.currentUser?.uid, 'A');
        expect(h.calls, ['getCustomerBiteScoreTerms']);
        expect(h.writes, isEmpty);
        expect(find.byType(AlertDialog), findsNothing);
        expect(find.byType(BiteScoreCreateRateScreen), findsNothing);
      });
    },
  );

  testWidgets('matching current receipt proceeds without asking again', (
    tester,
  ) async {
    final h = _Harness(store, active: true, accepted: true);
    await h.run(tester, _Path.existing, () async {
      await h.submit(tester, _Path.existing);
      expect(find.byType(AlertDialog), findsNothing);
      expect(h.calls, ['getCustomerBiteScoreTerms']);
      expect(h.writes, ['addReviewForDish']);
    });
  });

  for (final failure in [
    'unavailable',
    'draft',
    'malformed',
    'cross-user',
    'obsolete',
    'rejected',
  ]) {
    testWidgets('$failure Terms cannot dispatch a public mutation', (
      tester,
    ) async {
      final h = _Harness(store, active: true, failure: failure);
      await h.run(tester, _Path.existing, () async {
        await h.submit(tester, _Path.existing);
        if (failure == 'obsolete' || failure == 'rejected') {
          await tester.tap(find.widgetWithText(FilledButton, 'Accept Terms'));
          await tester.pumpAndSettle();
        } else {
          expect(find.byType(AlertDialog), findsNothing);
        }
        expect(h.writes, isEmpty);
        expect(_draft(tester)['headline'], 'Keep this headline');
        expect(
          (tester.state(find.byType(BiteScoreCreateRateScreen)) as dynamic)
              .isSaving,
          false,
        );
      });
    });
  }

  testWidgets(
    'account switch while Terms dialog is open stops receipt and review',
    (tester) async {
      final h = _Harness(store, active: true);
      await h.run(tester, _Path.existing, () async {
        await h.submit(tester, _Path.existing);
        h.currentUser = _User('B');
        await tester.tap(find.widgetWithText(FilledButton, 'Accept Terms'));
        await tester.pumpAndSettle();
        expect(h.calls, ['getCustomerBiteScoreTerms']);
        expect(h.writes, isEmpty);
      });
    },
  );

  testWidgets(
    'account switch while awaiting Terms response cannot open dialog',
    (tester) async {
      final pending = Completer<Object?>();
      final h = _Harness(store, active: true, pending: pending);
      await h.run(tester, _Path.existing, () async {
        await h.submit(tester, _Path.existing);
        h.currentUser = _User('B');
        pending.complete(_status());
        await tester.pumpAndSettle();
        expect(find.byType(AlertDialog), findsNothing);
        expect(h.writes, isEmpty);
      });
    },
  );

  testWidgets(
    'guest signs in before Terms and draft is attributed to adopted UID',
    (tester) async {
      final h = _Harness(store, active: true, accepted: true);
      h.currentUser = _User('guest', anonymous: true);
      h.signIn = () {
        h.currentUser = _User('A');
        return true;
      };
      await h.run(tester, _Path.existing, () async {
        await h.submit(tester, _Path.existing);
        expect(h.events.first, 'sign-in');
        expect(h.writes, ['addReviewForDish']);
        expect(h.uids, ['A']);
      });
    },
  );

  testWidgets('cancelled sign-in never requests Terms or writes', (
    tester,
  ) async {
    final h = _Harness(store, active: true);
    h.currentUser = null;
    h.signIn = () => false;
    await h.run(tester, _Path.existing, () async {
      await h.submit(tester, _Path.existing);
      expect(h.calls, isEmpty);
      expect(h.writes, isEmpty);
    });
  });

  testWidgets('manual validation fails before Terms or public mutation', (
    tester,
  ) async {
    final h = _Harness(store, active: true);
    await h.run(tester, _Path.manual, () async {
      final dynamic state = tester.state(
        find.byType(BiteScoreCreateRateScreen),
      );
      state.streetAddressController.clear();
      await h.submit(tester, _Path.manual);
      expect(find.text('Street address is required.'), findsOneWidget);
      expect(h.calls, isEmpty);
      expect(h.writes, isEmpty);
    });
  });

  testWidgets('missing ratings or category do not prompt or mutate', (
    tester,
  ) async {
    final h = _Harness(store, active: true);
    await h.run(tester, _Path.newDish, () async {
      final dynamic state = tester.state(
        find.byType(BiteScoreCreateRateScreen),
      );
      state.overallImpression = null;
      await h.submit(tester, _Path.newDish);
      expect(h.calls, isEmpty);
      expect(h.writes, isEmpty);
      state.overallImpression = 8.0;
      tester
          .widget<BitescoreCategoryPicker>(find.byType(BitescoreCategoryPicker))
          .onChanged(const BitescoreCategorySelection());
      await tester.pump();
      await h.submit(tester, _Path.newDish);
      expect(h.calls, isEmpty);
      expect(h.writes, isEmpty);
    });
  });
}

Map<String, Object?> _status({bool accepted = false}) => {
  'schemaVersion': 1,
  'userId': 'A',
  'enabled': true,
  'version': 'SIMULATED-APPROVED-v1',
  'text': 'Simulated approved Terms only.',
  'accepted': accepted,
};

String _operation(_Path path) => switch (path) {
  _Path.existing || _Path.duplicateExisting => 'addReviewForDish',
  _Path.newDish || _Path.duplicateNew => 'createDishAndRateForRestaurant',
  _Path.manual => 'createAndRate',
};

Map<String, Object?> _draft(WidgetTester tester) {
  final dynamic s = tester.state(find.byType(BiteScoreCreateRateScreen));
  return {
    'restaurant': s.restaurantNameController.text,
    'address': s.streetAddressController.text,
    'city': s.cityController.text,
    'state': s.stateController.text,
    'zip': s.zipCodeController.text,
    'dish': s.dishNameController.text,
    'price': s.priceLabelController.text,
    'headline': s.headlineController.text,
    'notes': s.notesController.text,
    'overall': s.overallImpression,
    'tastiness': s.tastinessScore,
    'quality': s.qualityScore,
    'value': s.valueScore,
    'category': find.byType(BitescoreCategoryPicker).evaluate().isEmpty
        ? 'Burgers'
        : tester
              .widget<BitescoreCategoryPicker>(
                find.byType(BitescoreCategoryPicker),
              )
              .selection
              .categoryForSave,
  };
}

class _Harness {
  _Harness(
    this.store, {
    this.active,
    this.accepted = false,
    this.failure,
    this.pending,
    this.withShell = false,
  });
  final _Store store;
  final bool? active;
  final bool accepted;
  final String? failure;
  final Completer<Object?>? pending;
  final bool withShell;
  String authRealm = 'signed:A';
  final authChanges = StreamController<String>.broadcast(sync: true);
  int homeRefreshGeneration = 0;
  User? currentUser = _User('A');
  bool Function()? signIn;
  final calls = <String>[];
  final writes = <String>[];
  final uids = <String>[];
  final events = <String>[];

  Future<Object?> transport(String name, Map<String, Object?> request) async {
    expect(request['expectedUserId'], 'A');
    calls.add(name);
    events.add(name);
    if (pending != null) return pending!.future;
    if (failure == 'unavailable') {
      throw StateError('Unavailable');
    }
    if (failure == 'draft') {
      return {'schemaVersion': 1, 'userId': 'A', 'enabled': false};
    }
    if (failure == 'malformed') return {..._status(), 'text': null};
    if (failure == 'cross-user') return {..._status(), 'userId': 'B'};
    if (name == 'acceptCustomerBiteScoreTerms') {
      expect(request['version'], 'SIMULATED-APPROVED-v1');
      if (failure == 'rejected') throw StateError('Rejected');
      return {
        ..._status(accepted: true),
        if (failure == 'obsolete') 'version': 'SIMULATED-APPROVED-v2',
      };
    }
    return _status(accepted: accepted);
  }

  Future<void> run(
    WidgetTester tester,
    _Path path,
    Future<void> Function() body,
  ) async {
    addTearDown(authChanges.close);
    tester.view.physicalSize = const Size(900, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    store.dishes = path == _Path.duplicateExisting || path == _Path.duplicateNew
        ? [_dish]
        : [];
    await BiteScoreService.runWithAccountContinuityTestSeams<void>(
      currentUserProvider: () => currentUser,
      reloadUser: (_) async {},
      refreshIdToken: (_) async {},
      write: (operation, uid) async {
        writes.add(operation);
        uids.add(uid);
        events.add('write:$operation');
        return _result;
      },
      body: () async {
        final open = Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => BiteScoreCreateRateScreen(
                    existingEntry: path == _Path.existing ? _entry : null,
                    existingRestaurant:
                        path != _Path.existing && path != _Path.manual
                        ? _restaurant
                        : null,
                    testRestaurantFinderLoader: () async => [],
                    testCurrentUserProvider: () => currentUser,
                    testWriteGate: (_) async {
                      events.add('sign-in');
                      return signIn?.call() ?? true;
                    },
                    testTermsAcceptance: active == null
                        ? null
                        : ({
                            required expectedUserId,
                            required isCurrent,
                            required confirm,
                          }) => BiteScoreTermsService.ensureAccepted(
                            expectedUserId: expectedUserId,
                            isCurrent: isCurrent,
                            confirm: confirm,
                            active: active!,
                            transport: transport,
                          ),
                  ),
                ),
              ),
              child: const Text('Open'),
            ),
          ),
        );
        await tester.pumpWidget(
          MaterialApp(
            navigatorKey: rootNavigatorKey,
            home: withShell
                ? MainNavigationScreen(
                    initialMode: AppMode.biteScore,
                    initializePlatformServices: false,
                    testCustomerAuthRealmProvider: () => authRealm,
                    testCustomerAuthRealmChanges: authChanges.stream,
                    testModeHomeBuilder: (mode, generation) {
                      if (mode == AppMode.biteScore) {
                        homeRefreshGeneration = generation;
                      }
                      return open;
                    },
                    testPagesBuilder: (_) => const [
                      SizedBox.shrink(),
                      SizedBox.shrink(),
                      SizedBox.shrink(),
                    ],
                  )
                : open,
          ),
        );
        await tester.tap(find.text('Open'));
        await tester.pumpAndSettle();
        final dynamic state = tester.state(
          find.byType(BiteScoreCreateRateScreen),
        );
        if (path == _Path.manual) {
          state.restaurantNameController.text = 'Manual Kitchen';
          state.stateController.text = 'FL';
          final button = find.text('Continue adding a new restaurant');
          await tester.ensureVisible(button);
          await tester.tap(button);
          await tester.pumpAndSettle();
          state.streetAddressController.text = '2 Main St';
          state.cityController.text = 'Ocala';
          state.zipCodeController.text = '34470';
        }
        state.dishNameController.text = 'Boundary Burger';
        state.priceLabelController.text = r'$12';
        state.headlineController.text = 'Keep this headline';
        state.notesController.text = 'Keep these notes';
        if (path != _Path.existing) {
          tester
              .widget<BitescoreCategoryPicker>(
                find.byType(BitescoreCategoryPicker),
              )
              .onChanged(
                BitescoreCategorySelection.fromValues(category: 'Burgers'),
              );
        }
        for (final slider in tester.widgetList<Slider>(find.byType(Slider))) {
          slider.onChanged?.call(8);
        }
        await tester.pump();
        await body();
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      },
    );
  }

  Future<void> submit(WidgetTester tester, _Path path) async {
    final button = find.widgetWithText(
      ElevatedButton,
      path == _Path.existing ? 'Save Review' : 'Save Dish & Rating',
    );
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pumpAndSettle();
    if ((path == _Path.duplicateExisting || path == _Path.duplicateNew) &&
        find.text('Did you mean one of these?').evaluate().isNotEmpty) {
      expect(find.byType(AlertDialog), findsNothing);
      expect(writes, isEmpty);
      await tester.tap(
        path == _Path.duplicateExisting
            ? find.text(_dish.name).last
            : find.text('No, create new dish anyway'),
      );
      await tester.pumpAndSettle();
    }
  }
}

class _Core extends FirebasePlatform {
  @override
  FirebaseAppPlatform app([String name = '[DEFAULT]']) => FirebaseAppPlatform(
    name,
    const FirebaseOptions(
      apiKey: 'synthetic',
      appId: 'synthetic',
      messagingSenderId: 'synthetic',
      projectId: 'synthetic',
      storageBucket: 'synthetic.appspot.com',
    ),
  );
}

class _Store extends FirebaseFirestorePlatform {
  List<BitescoreDish> dishes = [];
  final reads = <String>[];
  @override
  FirebaseFirestorePlatform delegateFor({
    required FirebaseApp app,
    required String databaseId,
  }) => this;
  @override
  CollectionReferencePlatform collection(String path) =>
      _Collection(this, path);
}

class _Collection extends CollectionReferencePlatform {
  _Collection(super.firestore, super.path) {
    parameters.addAll({
      'where': <List<dynamic>>[],
      'orderBy': <List<dynamic>>[],
    });
  }
  @override
  QueryPlatform where(List<List<dynamic>> conditions) => this;
  @override
  Future<QuerySnapshotPlatform> get([
    GetOptions options = const GetOptions(),
  ]) async {
    final store = firestore as _Store;
    store.reads.add(path);
    expect(path, 'bitescore_dishes');
    final metadata = SnapshotMetadataPlatform(false, false);
    return QuerySnapshotPlatform(
      [
        for (final dish in store.dishes)
          DocumentSnapshotPlatform(
            firestore,
            '$path/${dish.id}',
            dish.toFirestoreMap(),
            InternalSnapshotMetadata(
              hasPendingWrites: false,
              isFromCache: false,
            ),
          ),
      ],
      [],
      metadata,
    );
  }
}

class _Picker extends ImagePickerPlatform {
  @override
  Future<XFile?> getImageFromSource({
    required ImageSource source,
    ImagePickerOptions options = const ImagePickerOptions(),
  }) async => XFile.fromData(
    Uint8List.fromList([1, 2, 3]),
    name: 'draft.jpg',
    path: '/synthetic/draft.jpg',
    mimeType: 'image/jpeg',
  );
}

class _User extends Fake implements User {
  _User(this.uid, {this.anonymous = false});
  @override
  final String uid;
  final bool anonymous;
  @override
  bool get isAnonymous => anonymous;
  @override
  bool get emailVerified => true;
  @override
  String get email => 'test@example.invalid';
  @override
  List<UserInfo> get providerData => [];
}

const _restaurant = BitescoreRestaurant(
  id: 'restaurant-1',
  name: 'Boundary Kitchen',
  normalizedName: 'boundary kitchen',
  address: '1 Main St',
  city: 'Ocala',
  state: 'FL',
  zipCode: '34470',
  location: GeoPoint(29, -82),
  restaurantWriteRevision: 0,
);
const _dish = BitescoreDish(
  id: 'dish-1',
  restaurantId: 'restaurant-1',
  restaurantName: 'Boundary Kitchen',
  name: 'Boundary Burger',
  normalizedName: 'boundary burger',
  category: 'Burgers',
  categoryTags: ['burger'],
);
const _entry = BiteScoreHomeEntry(
  dish: _dish,
  restaurant: _restaurant,
  aggregate: DishRatingAggregate(
    dishId: 'dish-1',
    restaurantId: 'restaurant-1',
  ),
);
final _result = BiteScoreReviewSaveResult(
  dish: _dish,
  restaurant: _restaurant,
  review: const DishReview(
    id: 'review-1',
    dishId: 'dish-1',
    restaurantId: 'restaurant-1',
    userId: 'A',
    overallImpression: 8,
    tastinessScore: 8,
    qualityScore: 8,
    valueScore: 8,
    overallBiteScore: 80,
  ),
  contributionPointAward: const ContributionPointAwardResult(),
);
