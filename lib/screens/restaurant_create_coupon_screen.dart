import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../models/bitescore_restaurant.dart';
import '../models/coupon.dart';
import '../models/daily_special.dart';
import '../models/local_coupon_store.dart';
import '../models/local_restaurant_profile_store.dart';
import '../models/restaurant.dart';
import '../services/app_error_text.dart';
import '../services/bitesaver_image_upload_service.dart';
import '../services/bitesaver_restaurant_lifecycle_service.dart';
import '../services/customer_session_service.dart';
import '../services/restaurant_account_service.dart';
import '../services/restaurant_auth_service.dart';
import '../services/restaurant_menu_service.dart';
import '../services/subscription_checkout_service.dart';
import '../services/subscription_return_service.dart';
import '../utils/phone_number_formatter.dart';
import '../widgets/clickable_phone_text.dart';
import '../widgets/bitesaver_restaurant_images.dart';
import 'restaurant_menu_management_screen.dart';
import 'paywall_screen.dart';

typedef RestaurantNameChangeSubmitter =
    Future<void> Function({
      required String userId,
      required String currentRestaurantName,
      required String requestedRestaurantName,
    });

typedef DailySpecialSaver =
    Future<void> Function({
      required String uid,
      required DailySpecial dailySpecial,
    });

typedef CouponSaver =
    Future<Coupon> Function({required String uid, required Coupon coupon});

typedef CouponDeleter =
    Future<void> Function({required String uid, required String couponId});

typedef DailySpecialDeleter =
    Future<void> Function({
      required String uid,
      required String dailySpecialId,
    });

typedef CouponDatePicker =
    Future<DateTime?> Function({
      required DateTime initialDate,
      required DateTime firstDate,
      required DateTime lastDate,
    });

typedef OwnerTimePicker =
    Future<TimeOfDay?> Function({required TimeOfDay initialTime});

typedef CouponImagePickerUploader =
    Future<BiteSaverCouponImageUploadResult> Function({
      required String uid,
      required String couponKey,
      required bool Function() isCurrent,
    });

typedef CouponImagePersister =
    Future<void> Function({
      required String uid,
      required String couponId,
      required String imageUrl,
    });

typedef RestaurantOwnerAction = Future<void> Function();

typedef RestaurantImagePicker = Future<BiteSaverPickedImage?> Function();

typedef RestaurantImageValidator =
    Future<BiteSaverValidatedRestaurantImage?> Function(
      BiteSaverPickedImage pickedImage,
    );

typedef RestaurantImageUploader =
    Future<BiteSaverImageUploadResult> Function({
      required String uid,
      required BiteSaverValidatedRestaurantImage validatedImage,
    });

typedef RestaurantCurrentUserProvider = User? Function();

typedef RestaurantAccountDocumentIdResolver = String Function(String uid);

@immutable
class _RestaurantOwnerIdentity {
  final String uid;
  final String accountDocumentId;

  const _RestaurantOwnerIdentity({
    required this.uid,
    required this.accountDocumentId,
  });

  @override
  bool operator ==(Object other) =>
      other is _RestaurantOwnerIdentity &&
      other.uid == uid &&
      other.accountDocumentId == accountDocumentId;

  @override
  int get hashCode => Object.hash(uid, accountDocumentId);
}

@immutable
class _RestaurantOwnerScope {
  final _RestaurantOwnerIdentity identity;
  final int ownerGeneration;

  const _RestaurantOwnerScope({
    required this.identity,
    required this.ownerGeneration,
  });

  String logicalTarget({required String operation}) {
    return jsonEncode(<Object>[
      identity.uid,
      identity.accountDocumentId,
      ownerGeneration,
      operation,
    ]);
  }

  @override
  bool operator ==(Object other) =>
      other is _RestaurantOwnerScope &&
      other.identity == identity &&
      other.ownerGeneration == ownerGeneration;

  @override
  int get hashCode => Object.hash(identity, ownerGeneration);
}

@immutable
class _OwnerActionScope {
  final _RestaurantOwnerScope ownerScope;
  final _OwnerActionKind kind;
  final int operationGeneration;

  const _OwnerActionScope({
    required this.ownerScope,
    required this.kind,
    required this.operationGeneration,
  });
}

@immutable
class _CouponImageOperationScope {
  final _OwnerActionScope action;
  final int draftGeneration;
  final String? editingCouponId;

  const _CouponImageOperationScope({
    required this.action,
    required this.draftGeneration,
    required this.editingCouponId,
  });
}

@immutable
class _OwnerBoundRestaurantImageSelection {
  final _RestaurantOwnerIdentity ownerIdentity;
  final int ownerIdentityGeneration;
  final int selectionGeneration;
  final BiteSaverValidatedRestaurantImage validatedImage;
  final String? uploadedUrl;

  const _OwnerBoundRestaurantImageSelection({
    required this.ownerIdentity,
    required this.ownerIdentityGeneration,
    required this.selectionGeneration,
    required this.validatedImage,
    this.uploadedUrl,
  });

  _OwnerBoundRestaurantImageSelection withUploadedUrl(String uploadedUrl) {
    return _OwnerBoundRestaurantImageSelection(
      ownerIdentity: ownerIdentity,
      ownerIdentityGeneration: ownerIdentityGeneration,
      selectionGeneration: selectionGeneration,
      validatedImage: validatedImage,
      uploadedUrl: uploadedUrl,
    );
  }
}

class RestaurantCreateCouponScreen extends StatefulWidget {
  static const String routeName = '/restaurant-hub/coupon-side';

  final BiteSaverRestaurantLifecycleService? lifecycleService;
  final Future<Map<String, dynamic>?> Function(String uid)? loadAccount;
  final Future<List<Coupon>> Function(String uid)? loadCoupons;
  final Future<List<DailySpecial>> Function(String uid)? loadDailySpecials;
  final DailySpecialSaver? createDailySpecial;
  final DailySpecialSaver? updateDailySpecial;
  final CouponSaver? createCoupon;
  final CouponSaver? updateCoupon;
  final CouponDeleter? deleteCoupon;
  final DailySpecialDeleter? deleteDailySpecial;
  final CouponDatePicker? pickCouponDate;
  final OwnerTimePicker? pickCouponTime;
  final OwnerTimePicker? pickDailySpecialTime;
  final CouponImagePickerUploader? pickAndUploadCouponImage;
  final CouponImagePersister? persistCouponImage;
  final SubscriptionCheckoutService? subscriptionCheckoutService;
  final RestaurantOwnerAction? signOutRestaurantSession;
  final Future<BiteSaverMenuRoutingState> Function()? loadMenuRoutingState;
  final RestaurantNameChangeSubmitter? submitNameChangeRequest;
  final ValueChanged<bool>? onSubscriptionRefreshStateChanged;
  final User? testCurrentUser;
  final RestaurantCurrentUserProvider? currentUserProvider;
  final Stream<User?>? ownerUserChanges;
  final RestaurantAccountDocumentIdResolver? accountDocumentIdForUid;
  final RestaurantImagePicker? pickRestaurantImage;
  final RestaurantImageValidator? validateRestaurantImage;
  final RestaurantImageUploader? uploadRestaurantImage;

  const RestaurantCreateCouponScreen({
    super.key,
    @visibleForTesting this.lifecycleService,
    @visibleForTesting this.loadAccount,
    @visibleForTesting this.loadCoupons,
    @visibleForTesting this.loadDailySpecials,
    @visibleForTesting this.createDailySpecial,
    @visibleForTesting this.updateDailySpecial,
    @visibleForTesting this.createCoupon,
    @visibleForTesting this.updateCoupon,
    @visibleForTesting this.deleteCoupon,
    @visibleForTesting this.deleteDailySpecial,
    @visibleForTesting this.pickCouponDate,
    @visibleForTesting this.pickCouponTime,
    @visibleForTesting this.pickDailySpecialTime,
    @visibleForTesting this.pickAndUploadCouponImage,
    @visibleForTesting this.persistCouponImage,
    @visibleForTesting this.subscriptionCheckoutService,
    @visibleForTesting this.signOutRestaurantSession,
    @visibleForTesting this.loadMenuRoutingState,
    @visibleForTesting this.submitNameChangeRequest,
    @visibleForTesting this.onSubscriptionRefreshStateChanged,
    @visibleForTesting this.testCurrentUser,
    @visibleForTesting this.currentUserProvider,
    @visibleForTesting this.ownerUserChanges,
    @visibleForTesting this.accountDocumentIdForUid,
    @visibleForTesting this.pickRestaurantImage,
    @visibleForTesting this.validateRestaurantImage,
    @visibleForTesting this.uploadRestaurantImage,
  });

  @override
  State<RestaurantCreateCouponScreen> createState() =>
      _RestaurantCreateCouponScreenState();
}

class _RestaurantCreateCouponScreenState
    extends State<RestaurantCreateCouponScreen>
    with WidgetsBindingObserver {
  final TextEditingController restaurantNameController =
      TextEditingController();
  final TextEditingController cityController = TextEditingController();
  final TextEditingController stateController = TextEditingController();
  final TextEditingController zipCodeController = TextEditingController();
  final TextEditingController distanceController = TextEditingController();
  final TextEditingController emailController = TextEditingController();
  final TextEditingController phoneController = TextEditingController();
  final TextEditingController streetAddressController = TextEditingController();
  final TextEditingController websiteController = TextEditingController();
  final TextEditingController bioController = TextEditingController();
  final TextEditingController titleController = TextEditingController();
  final TextEditingController couponCodeController = TextEditingController();
  final TextEditingController couponDetailsController = TextEditingController();
  final TextEditingController requestedRestaurantNameController =
      TextEditingController();
  final TextEditingController dailySpecialTitleController =
      TextEditingController();
  final TextEditingController dailySpecialDetailsController =
      TextEditingController();
  final ScrollController _hubScrollController = ScrollController();
  final GlobalKey _couponEditorKey = GlobalKey();
  final GlobalKey _couponTitleFieldKey = GlobalKey();
  final GlobalKey _couponStartTimeFieldKey = GlobalKey();
  final GlobalKey _couponEndTimeFieldKey = GlobalKey();
  final GlobalKey _dailySpecialEditorKey = GlobalKey();

  String selectedUsageRule = 'Unlimited';
  String selectedCouponType = 'Normal coupon';
  String selectedProximityRadius = '1 mile';
  String? editingCouponId;
  String? restaurantImageUrl;
  String? couponImageUrl;
  _OwnerBoundRestaurantImageSelection? _selectedRestaurantImage;

  bool profileLoading = true;
  bool profileSaving = false;
  bool restaurantImageUploading = false;
  bool couponsLoading = true;
  bool couponSaving = false;
  bool couponImageUploading = false;
  bool _couponDeleteInFlight = false;
  bool _hoursExpanded = false;
  bool _basicInfoSectionExpanded = false;
  bool _restaurantImageSectionExpanded = false;
  bool _hoursSectionExpanded = false;
  bool _menuManagementSectionExpanded = false;
  bool _subscriptionBillingSectionExpanded = false;
  bool _dailySpecialsSectionExpanded = false;
  bool _couponManagementSectionExpanded = false;
  bool _customerPreviewSectionExpanded = false;
  bool _couponSubmitAttempted = false;
  bool _businessHoursDirty = false;
  bool _subscriptionCheckoutLoading = false;
  bool _customerPortalLoading = false;
  bool _subscriptionStateRefreshing = false;
  bool _dailySpecialsLoading = true;
  bool _dailySpecialSaving = false;
  bool _dailySpecialSaveInFlight = false;
  bool _dailySpecialDeleteInFlight = false;
  bool _signOutInFlight = false;
  bool _hasCouponPostingAccess = false;
  bool _hasUsedTrial = false;
  bool _cancelAtPeriodEnd = false;
  bool _showNameChangeRequest = false;
  bool _submittingNameChangeRequest = false;
  bool _allowProfileClose = false;
  String _subscriptionStatus = 'inactive';
  DateTime? _trialEndsAt;
  DateTime? _subscriptionEndsAt;
  DateTime? couponStartTime;
  DateTime? couponEndTime;
  String? editingDailySpecialId;
  bool _dailySpecialIsActive = true;
  DailySpecialAvailabilityMode _dailySpecialAvailabilityMode =
      DailySpecialAvailabilityMode.todayOnly;
  final Set<int> _dailySpecialDaysOfWeek = <int>{};
  bool _dailySpecialAllDay = true;
  TimeOfDay? _dailySpecialStartTime;
  TimeOfDay? _dailySpecialEndTime;
  bool _dailySpecialHideWhenUnavailable = true;
  List<DailySpecial> _dailySpecials = const [];
  List<RestaurantBusinessHours> businessHours =
      RestaurantBusinessHours.defaultWeek();
  List<RestaurantBusinessHours> _initialProfileBusinessHours =
      RestaurantBusinessHours.defaultWeek();
  Map<TextEditingController, String> _initialProfileTextValues = {};
  String? _initialRestaurantImageUrl;
  Set<_CouponValidationField> _couponValidationHighlights =
      <_CouponValidationField>{};
  final Map<String, bool> copyPreviousDay = {
    for (final day in Restaurant.businessDayNames) day: false,
  };
  _CouponAccountAccessState _couponAccessState =
      _CouponAccountAccessState.loading;
  String _couponAccessMessage = '';
  late final BiteSaverRestaurantLifecycleService _lifecycleService;
  late final SubscriptionCheckoutService _subscriptionCheckoutService;
  late BiteSaverProfileOperationState _applicationOperation;
  late BiteSaverProfileOperationState _ownerProfileOperation;
  StreamSubscription<void>? _subscriptionReturnSubscription;
  StreamSubscription<User?>? _ownerUserSubscription;
  Future<void> _accountOperationTail = Future<void>.value();
  bool _subscriptionReturnDrainQueued = false;
  int _subscriptionReturnDrainRequestGeneration = 0;
  Object _lifecycleRefreshOwner = Object();
  Completer<bool>? _lifecycleRefreshAttempt;
  final Map<Route<dynamic>, NavigatorState> _ownerModalRoutes =
      <Route<dynamic>, NavigatorState>{};
  final Map<Route<dynamic>, NavigatorState> _ownerPageRoutes =
      <Route<dynamic>, NavigatorState>{};
  final Map<_OwnerActionKind, int> _ownerActionGenerations =
      <_OwnerActionKind, int>{};
  int _profileVersion = 0;
  int _locationVersion = 0;
  int _applicationOperationGeneration = 0;
  int _ownerSaveGeneration = 0;
  int _ownerIdentityGeneration = 0;
  int _couponDraftGeneration = 0;
  int _dailySpecialDraftGeneration = 0;
  int _signOutOperationGeneration = 0;
  int _restaurantImageOperationGeneration = 0;
  int _restaurantImageSelectionGeneration = 0;
  int _restaurantImageSaveGeneration = 0;
  _RestaurantOwnerIdentity? _activeOwnerIdentity;
  _RestaurantOwnerIdentity? _trustedProfileOwnerIdentity;
  int? _trustedProfileOwnerGeneration;
  User? _observedOwnerUser;
  bool _hasObservedOwnerUser = false;
  bool _hasTrustedSearchableLocation = false;
  String _storedRestaurantName = '';

  bool get isProximityCoupon => selectedCouponType == 'Proximity-only coupon';
  bool get isEditingCoupon => editingCouponId != null;
  User? get currentUser {
    if (widget.ownerUserChanges != null && _hasObservedOwnerUser) {
      return _observedOwnerUser;
    }
    final currentUserProvider = widget.currentUserProvider;
    if (currentUserProvider != null) {
      return currentUserProvider();
    }
    return widget.testCurrentUser ?? FirebaseAuth.instance.currentUser;
  }

  _RestaurantOwnerIdentity? _ownerIdentityFor(User? user) {
    if (user == null || user.isAnonymous) {
      return null;
    }
    final uid = user.uid.trim();
    if (uid.isEmpty) {
      return null;
    }
    final accountDocumentId = (widget.accountDocumentIdForUid?.call(uid) ?? uid)
        .trim();
    if (accountDocumentId.isEmpty) {
      return null;
    }
    return _RestaurantOwnerIdentity(
      uid: uid,
      accountDocumentId: accountDocumentId,
    );
  }

  _RestaurantOwnerIdentity? get _currentOwnerIdentity =>
      _ownerIdentityFor(currentUser);

  _RestaurantOwnerScope? get _activeOwnerScope {
    final identity = _activeOwnerIdentity;
    if (identity == null) {
      return null;
    }
    return _RestaurantOwnerScope(
      identity: identity,
      ownerGeneration: _ownerIdentityGeneration,
    );
  }

  bool _isCurrentExactOwnerScope(_RestaurantOwnerScope scope) {
    return _isCurrentOwnerScope(scope.identity, scope.ownerGeneration);
  }

  SubscriptionReturnOwnerScope _subscriptionReturnOwnerScope(
    _RestaurantOwnerScope scope,
  ) {
    return SubscriptionReturnOwnerScope(
      uid: scope.identity.uid,
      accountDocumentId: scope.identity.accountDocumentId,
    );
  }

  _OwnerActionScope? _beginOwnerAction(
    _OwnerActionKind kind, {
    _RestaurantOwnerScope? expectedOwnerScope,
  }) {
    if (!_synchronizeCurrentOwnerIdentity()) {
      return null;
    }
    final ownerScope = _activeOwnerScope;
    if (ownerScope == null ||
        (expectedOwnerScope != null && ownerScope != expectedOwnerScope)) {
      return null;
    }
    final operationGeneration = (_ownerActionGenerations[kind] ?? 0) + 1;
    _ownerActionGenerations[kind] = operationGeneration;
    return _OwnerActionScope(
      ownerScope: ownerScope,
      kind: kind,
      operationGeneration: operationGeneration,
    );
  }

  bool _isCurrentOwnerAction(_OwnerActionScope action) {
    return mounted &&
        _isCurrentExactOwnerScope(action.ownerScope) &&
        _ownerActionGenerations[action.kind] == action.operationGeneration;
  }

  bool _isCurrentCouponImageOperation(_CouponImageOperationScope operation) {
    return _isCurrentOwnerAction(operation.action) &&
        operation.draftGeneration == _couponDraftGeneration &&
        operation.editingCouponId == editingCouponId?.trim();
  }

  bool _isCurrentOwnerScope(
    _RestaurantOwnerIdentity identity,
    int identityGeneration,
  ) {
    return _activeOwnerIdentity == identity &&
        _ownerIdentityGeneration == identityGeneration &&
        _currentOwnerIdentity == identity;
  }

  bool _isTrustedProfileScope(
    _RestaurantOwnerIdentity identity,
    int identityGeneration,
  ) {
    return _trustedProfileOwnerIdentity == identity &&
        _trustedProfileOwnerGeneration == identityGeneration;
  }

  _OwnerBoundRestaurantImageSelection? get _currentRestaurantImageSelection {
    final selectedImage = _selectedRestaurantImage;
    if (selectedImage == null ||
        !_isCurrentOwnerScope(
          selectedImage.ownerIdentity,
          selectedImage.ownerIdentityGeneration,
        )) {
      return null;
    }
    return selectedImage;
  }

  void _listenForOwnerChanges() {
    final injectedChanges = widget.ownerUserChanges;
    final Stream<User?>? ownerChanges =
        injectedChanges ??
        (widget.currentUserProvider == null && widget.testCurrentUser == null
            ? FirebaseAuth.instance.userChanges()
            : null);
    if (ownerChanges == null) {
      return;
    }
    _ownerUserSubscription = ownerChanges.listen(
      _handleOwnerUserChange,
      onError: (_) {},
    );
  }

  void _handleOwnerUserChange(User? user) {
    if (!mounted) {
      return;
    }
    _observedOwnerUser = user;
    _hasObservedOwnerUser = true;
    _transitionOwnerIdentityIfNeeded(_ownerIdentityFor(user));
  }

  bool _synchronizeCurrentOwnerIdentity() {
    final currentIdentity = _currentOwnerIdentity;
    if (currentIdentity != _activeOwnerIdentity) {
      _transitionOwnerIdentityIfNeeded(currentIdentity);
      return false;
    }
    return currentIdentity != null;
  }

  void _transitionOwnerIdentityIfNeeded(
    _RestaurantOwnerIdentity? nextIdentity, {
    bool reload = true,
    bool preserveSignOutOperation = false,
  }) {
    if (!mounted || nextIdentity == _activeOwnerIdentity) {
      return;
    }

    _dismissTrackedOwnerRoutes(_ownerModalRoutes);
    _dismissTrackedOwnerPageRoutes();
    final previousLifecycleRefreshOwner = _lifecycleRefreshOwner;
    final previousLifecycleRefreshAttempt = _lifecycleRefreshAttempt;
    _activeOwnerIdentity = nextIdentity;
    _ownerIdentityGeneration += 1;
    _applicationOperationGeneration += 1;
    _ownerSaveGeneration += 1;
    _couponDraftGeneration += 1;
    _dailySpecialDraftGeneration += 1;
    if (!preserveSignOutOperation) {
      _signOutOperationGeneration += 1;
    }
    _restaurantImageOperationGeneration += 1;
    _restaurantImageSelectionGeneration += 1;
    _restaurantImageSaveGeneration += 1;
    _ownerActionGenerations.clear();
    _applicationOperation = _lifecycleService.createOperationState();
    _ownerProfileOperation = _lifecycleService.createOperationState();
    _accountOperationTail = Future<void>.value();
    _lifecycleRefreshAttempt = null;
    _lifecycleRefreshOwner = Object();
    if (previousLifecycleRefreshAttempt != null &&
        !previousLifecycleRefreshAttempt.isCompleted) {
      previousLifecycleRefreshAttempt.complete(false);
    }
    SubscriptionReturnService.finishRestaurantHubLifecycleRefresh(
      previousLifecycleRefreshOwner,
    );
    _clearOwnerScopedProfilePresentation(
      email: nextIdentity != null && _currentOwnerIdentity == nextIdentity
          ? currentUser?.email
          : null,
      resetLocalProfile: true,
    );
    _resetCouponDraftState();
    _resetDailySpecialDraftState();

    ScaffoldMessenger.maybeOf(context)?.clearSnackBars();
    setState(() {
      restaurantImageUploading = false;
      profileSaving = false;
      couponSaving = false;
      couponImageUploading = false;
      _couponDeleteInFlight = false;
      _dailySpecialSaving = false;
      _dailySpecialSaveInFlight = false;
      _dailySpecialDeleteInFlight = false;
      _subscriptionCheckoutLoading = false;
      _customerPortalLoading = false;
      _signOutInFlight = false;
      _allowProfileClose = false;
      profileLoading = true;
      couponsLoading = true;
      _dailySpecialsLoading = true;
    });
    if (reload) {
      // A new owner must not wait behind a prior owner's pending account
      // read. The identity generation guards inside the loader keep both
      // completions scoped to the owner that started them.
      unawaited(
        _loadSavedProfileAndCoupons().whenComplete(() {
          if (mounted) {
            _schedulePendingSubscriptionReturnRefresh();
          }
        }),
      );
    }
  }

  void _clearOwnerScopedProfilePresentation({
    required String? email,
    required bool resetLocalProfile,
  }) {
    if (resetLocalProfile) {
      // This legacy cache has no owner key. Never carry its contents across a
      // State initialization or an exact UID/account-document transition.
      LocalRestaurantProfileStore.resetProfile();
    }
    LocalCouponStore.clearCoupons();

    restaurantNameController.clear();
    streetAddressController.clear();
    cityController.clear();
    stateController.clear();
    zipCodeController.clear();
    distanceController.clear();
    emailController.text = email?.trim() ?? '';
    phoneController.clear();
    websiteController.clear();
    bioController.clear();
    requestedRestaurantNameController.clear();

    businessHours = RestaurantBusinessHours.defaultWeek();
    _businessHoursDirty = false;
    for (final day in copyPreviousDay.keys) {
      copyPreviousDay[day] = false;
    }
    _hoursExpanded = false;

    _selectedRestaurantImage = null;
    restaurantImageUrl = null;
    _initialRestaurantImageUrl = null;
    _clearTrustedProfileState();

    _showNameChangeRequest = false;
    _submittingNameChangeRequest = false;
    _couponAccessState = _CouponAccountAccessState.loading;
    _couponAccessMessage = '';
    _hasCouponPostingAccess = false;
    _hasUsedTrial = false;
    _cancelAtPeriodEnd = false;
    _subscriptionStatus = 'inactive';
    _trialEndsAt = null;
    _subscriptionEndsAt = null;
    _dailySpecials = const [];
    if (_subscriptionStateRefreshing) {
      _subscriptionStateRefreshing = false;
      widget.onSubscriptionRefreshStateChanged?.call(false);
    }

    _captureRestaurantProfileSnapshot();
  }

  void _resetCouponDraftState() {
    editingCouponId = null;
    titleController.clear();
    couponCodeController.clear();
    couponDetailsController.clear();
    couponImageUrl = null;
    selectedUsageRule = 'Unlimited';
    selectedCouponType = 'Normal coupon';
    selectedProximityRadius = '1 mile';
    couponStartTime = DateTime.now();
    couponEndTime = null;
    _couponSubmitAttempted = false;
    _couponValidationHighlights = <_CouponValidationField>{};
  }

  void _resetDailySpecialDraftState() {
    editingDailySpecialId = null;
    dailySpecialTitleController.clear();
    dailySpecialDetailsController.clear();
    _dailySpecialIsActive = true;
    _dailySpecialAvailabilityMode = DailySpecialAvailabilityMode.todayOnly;
    _dailySpecialDaysOfWeek.clear();
    _dailySpecialAllDay = true;
    _dailySpecialStartTime = null;
    _dailySpecialEndTime = null;
    _dailySpecialHideWhenUnavailable = true;
  }

  void _dismissTrackedOwnerRoutes(
    Map<Route<dynamic>, NavigatorState> trackedRoutes,
  ) {
    for (final entry in trackedRoutes.entries.toList().reversed) {
      if (entry.key.isActive) {
        entry.value.removeRoute(entry.key);
      }
    }
    trackedRoutes.clear();
  }

  void _dismissTrackedOwnerPageRoutes() {
    for (final entry in _ownerPageRoutes.entries.toList().reversed) {
      final ownerPageRoute = entry.key;
      if (!ownerPageRoute.isActive) {
        continue;
      }
      for (
        var routesRemoved = 0;
        routesRemoved < 100 && ownerPageRoute.isActive;
        routesRemoved += 1
      ) {
        Route<dynamic>? currentTopRoute;
        entry.value.popUntil((route) {
          currentTopRoute = route;
          return true;
        });
        final routeToRemove = currentTopRoute;
        if (routeToRemove == null || identical(routeToRemove, ownerPageRoute)) {
          break;
        }
        entry.value.removeRoute(routeToRemove);
      }
      if (ownerPageRoute.isActive) {
        entry.value.removeRoute(ownerPageRoute);
      }
    }
    _ownerPageRoutes.clear();
  }

  Future<T?> _showOwnerScopedDialog<T>({
    required _RestaurantOwnerScope expectedOwnerScope,
    required WidgetBuilder builder,
  }) async {
    if (!mounted || !_isCurrentExactOwnerScope(expectedOwnerScope)) {
      return null;
    }
    final navigator = Navigator.of(context, rootNavigator: true);
    final route = DialogRoute<T>(
      context: context,
      builder: builder,
      themes: InheritedTheme.capture(from: context, to: navigator.context),
    );
    _ownerModalRoutes[route] = navigator;
    try {
      return await navigator.push<T>(route);
    } finally {
      _ownerModalRoutes.remove(route);
    }
  }

  Future<DateTime?> _showOwnerScopedDatePicker({
    required _RestaurantOwnerScope expectedOwnerScope,
    required DateTime initialDate,
    required DateTime firstDate,
    required DateTime lastDate,
  }) {
    return _showOwnerScopedDialog<DateTime>(
      expectedOwnerScope: expectedOwnerScope,
      builder: (_) => DatePickerDialog(
        initialDate: initialDate,
        firstDate: firstDate,
        lastDate: lastDate,
      ),
    );
  }

  Future<TimeOfDay?> _showOwnerScopedTimePicker({
    required _RestaurantOwnerScope expectedOwnerScope,
    required TimeOfDay initialTime,
  }) {
    return _showOwnerScopedDialog<TimeOfDay>(
      expectedOwnerScope: expectedOwnerScope,
      builder: (_) => TimePickerDialog(initialTime: initialTime),
    );
  }

  Future<T?> _pushOwnerScopedPage<T>({
    required _RestaurantOwnerScope expectedOwnerScope,
    required WidgetBuilder builder,
  }) async {
    if (!mounted || !_isCurrentExactOwnerScope(expectedOwnerScope)) {
      return null;
    }
    final navigator = Navigator.of(context);
    final route = MaterialPageRoute<T>(builder: builder);
    _ownerPageRoutes[route] = navigator;
    try {
      return await navigator.push<T>(route);
    } finally {
      _ownerPageRoutes.remove(route);
    }
  }

  bool get _hasUnsavedRestaurantProfileChanges {
    final textChanged = _initialProfileTextValues.entries.any(
      (entry) => entry.key.text != entry.value,
    );
    return textChanged ||
        _currentRestaurantImageSelection != null ||
        restaurantImageUrl != _initialRestaurantImageUrl ||
        !_businessHoursMatch(_initialProfileBusinessHours);
  }

  void _captureRestaurantProfileSnapshot() {
    _initialProfileTextValues = {
      restaurantNameController: restaurantNameController.text,
      cityController: cityController.text,
      stateController: stateController.text,
      zipCodeController: zipCodeController.text,
      emailController: emailController.text,
      phoneController: phoneController.text,
      streetAddressController: streetAddressController.text,
      websiteController: websiteController.text,
      bioController: bioController.text,
    };
    _initialProfileBusinessHours = [
      for (final entry in businessHours) entry.copyWith(),
    ];
    _initialRestaurantImageUrl = restaurantImageUrl;
  }

  bool _businessHoursMatch(List<RestaurantBusinessHours> original) {
    if (businessHours.length != original.length) {
      return false;
    }

    for (var index = 0; index < businessHours.length; index += 1) {
      final current = businessHours[index];
      final initial = original[index];
      if (current.day != initial.day ||
          current.opensAt != initial.opensAt ||
          current.closesAt != initial.closesAt ||
          current.closed != initial.closed) {
        return false;
      }
    }
    return true;
  }

  Future<bool> _confirmLeaveRestaurantProfileChanges(
    _RestaurantOwnerScope expectedOwnerScope,
  ) async {
    if (!_isCurrentExactOwnerScope(expectedOwnerScope)) {
      return false;
    }
    if (!_hasUnsavedRestaurantProfileChanges) {
      return true;
    }

    final shouldLeave = await _showOwnerScopedDialog<bool>(
      expectedOwnerScope: expectedOwnerScope,
      builder: (context) => AlertDialog(
        title: const Text('Unsaved changes'),
        content: const Text(
          'You have unsaved restaurant profile changes.\nLeave without saving?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Stay'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Leave without saving'),
          ),
        ],
      ),
    );

    return shouldLeave == true && _isCurrentExactOwnerScope(expectedOwnerScope);
  }

  Future<void> _openPaywallScreen(
    _RestaurantOwnerScope expectedOwnerScope,
  ) async {
    await _pushOwnerScopedPage<void>(
      expectedOwnerScope: expectedOwnerScope,
      builder: (_) => PaywallScreen(
        startSubscription: () =>
            _openSubscriptionSignupScreen(expectedOwnerScope),
      ),
    );
  }

  Future<void> _openSubscriptionSignupScreen(
    _RestaurantOwnerScope expectedOwnerScope,
  ) async {
    if (_subscriptionCheckoutLoading) {
      return;
    }
    final action = _beginOwnerAction(
      _OwnerActionKind.checkout,
      expectedOwnerScope: expectedOwnerScope,
    );
    if (action == null) {
      return;
    }

    setState(() {
      _subscriptionCheckoutLoading = true;
    });

    try {
      final prepared = await _subscriptionCheckoutService
          .prepareSubscriptionCheckout(
            restaurantAccountDocumentId:
                action.ownerScope.identity.accountDocumentId,
          );
      if (!_isCurrentOwnerAction(action)) {
        return;
      }
      final launchResult = await _subscriptionCheckoutService
          .launchPreparedSubscriptionUrl(
            prepared,
            isCurrent: () => _isCurrentOwnerAction(action),
          );
      if (launchResult == SubscriptionExternalLaunchResult.launched ||
          launchResult == SubscriptionExternalLaunchResult.launchedStale) {
        return;
      }
      if (!_isCurrentOwnerAction(action)) {
        return;
      }
      if (launchResult == SubscriptionExternalLaunchResult.failed) {
        _showSnackBar('Something went wrong');
      }
    } catch (_) {
      if (!_isCurrentOwnerAction(action)) {
        return;
      }
      _showSnackBar('Something went wrong');
    } finally {
      if (_isCurrentOwnerAction(action)) {
        setState(() {
          _subscriptionCheckoutLoading = false;
        });
      }
    }
  }

  Future<void> _openManageSubscription(
    _RestaurantOwnerScope expectedOwnerScope,
  ) async {
    if (_customerPortalLoading) {
      return;
    }
    final action = _beginOwnerAction(
      _OwnerActionKind.portal,
      expectedOwnerScope: expectedOwnerScope,
    );
    if (action == null) {
      return;
    }

    setState(() {
      _customerPortalLoading = true;
    });

    try {
      final prepared = await _subscriptionCheckoutService.prepareCustomerPortal(
        restaurantAccountDocumentId:
            action.ownerScope.identity.accountDocumentId,
      );
      if (!_isCurrentOwnerAction(action)) {
        return;
      }
      final launchResult = await _subscriptionCheckoutService
          .launchPreparedSubscriptionUrl(
            prepared,
            isCurrent: () => _isCurrentOwnerAction(action),
          );
      if (launchResult == SubscriptionExternalLaunchResult.launched ||
          launchResult == SubscriptionExternalLaunchResult.launchedStale) {
        return;
      }
      if (!_isCurrentOwnerAction(action)) {
        return;
      }
      if (launchResult == SubscriptionExternalLaunchResult.failed) {
        _showSnackBar('Something went wrong');
      }
    } catch (_) {
      if (!_isCurrentOwnerAction(action)) {
        return;
      }
      _showSnackBar('Something went wrong');
    } finally {
      if (_isCurrentOwnerAction(action)) {
        setState(() {
          _customerPortalLoading = false;
        });
      }
    }
  }

  Future<void> _openMenuManagement(
    _RestaurantOwnerScope expectedOwnerScope,
  ) async {
    final action = _beginOwnerAction(
      _OwnerActionKind.menuOpen,
      expectedOwnerScope: expectedOwnerScope,
    );
    if (action == null) {
      _showSnackBar('Please sign in to manage your menu.');
      return;
    }

    try {
      final access =
          await RestaurantMenuService.resolveBiteSaverManageMenuAccess(
            uid: action.ownerScope.identity.uid,
          );
      if (!_isCurrentOwnerAction(action)) {
        return;
      }
      if (access.isBlocked) {
        _showSnackBar(access.message ?? 'Menu is managed elsewhere.');
        return;
      }
      final source = access.source;
      if (source == null) {
        _showSnackBar('Could not open menu tools right now.');
        return;
      }
      await _pushOwnerScopedPage<void>(
        expectedOwnerScope: action.ownerScope,
        builder: (_) => RestaurantMenuManagementScreen(source: source),
      );
      if (!_isCurrentOwnerAction(action)) {
        return;
      }
    } catch (error) {
      if (!_isCurrentOwnerAction(action)) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not open menu tools right now.',
        ),
      );
    }
  }

  Future<BiteSaverMenuRoutingState> _loadBiteSaverMenuRoutingState(
    _RestaurantOwnerScope expectedOwnerScope,
  ) async {
    final action = _beginOwnerAction(
      _OwnerActionKind.menuRead,
      expectedOwnerScope: expectedOwnerScope,
    );
    if (action == null) {
      return const BiteSaverMenuRoutingState(
        usesBiteRater: false,
        matchedBiteScoreRestaurant: null,
        isAlreadyUsedByOtherSide: false,
      );
    }
    final injectedLoader = widget.loadMenuRoutingState;
    if (injectedLoader != null) {
      final state = await injectedLoader();
      return _isCurrentOwnerAction(action)
          ? state
          : const BiteSaverMenuRoutingState(
              usesBiteRater: false,
              matchedBiteScoreRestaurant: null,
              isAlreadyUsedByOtherSide: false,
            );
    }
    final uid = action.ownerScope.identity.uid;
    final usesBiteRater =
        await RestaurantMenuService.biteSaverUsesBiteScoreMenu(uid);
    if (!_isCurrentOwnerAction(action)) {
      return const BiteSaverMenuRoutingState(
        usesBiteRater: false,
        matchedBiteScoreRestaurant: null,
        isAlreadyUsedByOtherSide: false,
      );
    }
    final matchedRestaurant =
        await RestaurantMenuService.findLikelyBiteScoreMatchForBiteSaver(
          uid: uid,
        );
    if (!_isCurrentOwnerAction(action)) {
      return const BiteSaverMenuRoutingState(
        usesBiteRater: false,
        matchedBiteScoreRestaurant: null,
        isAlreadyUsedByOtherSide: false,
      );
    }
    final isAlreadyUsedByOtherSide = matchedRestaurant == null
        ? false
        : await RestaurantMenuService.biteScoreUsesBiteSaverMenu(
            matchedRestaurant.id,
          );
    if (!_isCurrentOwnerAction(action)) {
      return const BiteSaverMenuRoutingState(
        usesBiteRater: false,
        matchedBiteScoreRestaurant: null,
        isAlreadyUsedByOtherSide: false,
      );
    }
    return BiteSaverMenuRoutingState(
      usesBiteRater: usesBiteRater,
      matchedBiteScoreRestaurant: matchedRestaurant,
      isAlreadyUsedByOtherSide: isAlreadyUsedByOtherSide,
    );
  }

  Future<void> _toggleBiteSaverUsesBiteRaterMenu({
    required bool enabled,
    required String? matchedBiteScoreRestaurantId,
    required _RestaurantOwnerScope expectedOwnerScope,
  }) async {
    final action = _beginOwnerAction(
      _OwnerActionKind.menuWrite,
      expectedOwnerScope: expectedOwnerScope,
    );
    if (action == null) {
      _showSnackBar('Please sign in to update menu settings.');
      return;
    }
    final uid = action.ownerScope.identity.uid;

    try {
      if (enabled) {
        final restaurantId = matchedBiteScoreRestaurantId?.trim();
        if (restaurantId == null || restaurantId.isEmpty) {
          _showSnackBar('Matching BiteScore restaurant is required.');
          return;
        }
        if (await RestaurantMenuService.biteScoreUsesBiteSaverMenu(
          restaurantId,
        )) {
          if (!_isCurrentOwnerAction(action)) {
            return;
          }
          _showSnackBar('This menu is already being used by the other side.');
          return;
        }
        if (!_isCurrentOwnerAction(action)) {
          return;
        }
        await RestaurantMenuService.setBiteSaverMenuSourceToBiteScore(
          uid: uid,
          biteScoreRestaurantId: restaurantId,
          updatedBy: uid,
        );
        if (!_isCurrentOwnerAction(action)) {
          return;
        }
        _showSnackBar('Menu is managed on BiteScore.');
      } else {
        await RestaurantMenuService.clearBiteSaverMenuSourceRouting(
          uid: uid,
          updatedBy: uid,
        );
        if (!_isCurrentOwnerAction(action)) {
          return;
        }
        _showSnackBar('BiteSaver menu management restored.');
      }
      setState(() {});
    } catch (error) {
      if (!_isCurrentOwnerAction(action)) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not update menu source right now.',
        ),
      );
    }
  }

  List<String> get businessHourOptions {
    return const [
      '12:00 AM',
      '12:30 AM',
      '1:00 AM',
      '1:30 AM',
      '2:00 AM',
      '2:30 AM',
      '3:00 AM',
      '3:30 AM',
      '4:00 AM',
      '4:30 AM',
      '5:00 AM',
      '5:30 AM',
      '6:00 AM',
      '6:30 AM',
      '7:00 AM',
      '7:30 AM',
      '8:00 AM',
      '8:30 AM',
      '9:00 AM',
      '9:30 AM',
      '10:00 AM',
      '10:30 AM',
      '11:00 AM',
      '11:30 AM',
      '12:00 PM',
      '12:30 PM',
      '1:00 PM',
      '1:30 PM',
      '2:00 PM',
      '2:30 PM',
      '3:00 PM',
      '3:30 PM',
      '4:00 PM',
      '4:30 PM',
      '5:00 PM',
      '5:30 PM',
      '6:00 PM',
      '6:30 PM',
      '7:00 PM',
      '7:30 PM',
      '8:00 PM',
      '8:30 PM',
      '9:00 PM',
      '9:30 PM',
      '10:00 PM',
      '10:30 PM',
      '11:00 PM',
      '11:30 PM',
    ];
  }

  @override
  void initState() {
    super.initState();
    if (widget.ownerUserChanges != null) {
      _observedOwnerUser =
          widget.currentUserProvider?.call() ?? widget.testCurrentUser;
      _hasObservedOwnerUser = true;
    }
    _ownerIdentityGeneration = 1;
    _activeOwnerIdentity = _currentOwnerIdentity;
    _lifecycleService =
        widget.lifecycleService ?? BiteSaverRestaurantLifecycleService();
    _subscriptionCheckoutService =
        widget.subscriptionCheckoutService ??
        SubscriptionCheckoutService.production();
    _applicationOperation = _lifecycleService.createOperationState();
    _ownerProfileOperation = _lifecycleService.createOperationState();
    _clearOwnerScopedProfilePresentation(
      email: currentUser?.email,
      resetLocalProfile: true,
    );
    WidgetsBinding.instance.addObserver(this);
    SubscriptionReturnService.registerRestaurantHub();
    SubscriptionReturnService.noteRestaurantHubMounted(
      isResumed:
          WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed,
    );
    _subscriptionReturnSubscription = SubscriptionReturnService.changes.listen(
      (_) => _schedulePendingSubscriptionReturnRefresh(),
      onError: (_) {},
    );
    _listenForOwnerChanges();
    _resetCouponSchedule();
    unawaited(
      _enqueueAccountOperation(_loadSavedProfileAndCoupons).whenComplete(() {
        if (mounted) {
          _schedulePendingSubscriptionReturnRefresh();
        }
      }),
    );
  }

  @override
  void didUpdateWidget(covariant RestaurantCreateCouponScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.ownerUserChanges != widget.ownerUserChanges ||
        oldWidget.currentUserProvider != widget.currentUserProvider ||
        oldWidget.testCurrentUser != widget.testCurrentUser) {
      final previousSubscription = _ownerUserSubscription;
      _ownerUserSubscription = null;
      if (previousSubscription != null) {
        unawaited(previousSubscription.cancel());
      }
      if (widget.ownerUserChanges != null) {
        _observedOwnerUser =
            widget.currentUserProvider?.call() ?? widget.testCurrentUser;
        _hasObservedOwnerUser = true;
      } else {
        _observedOwnerUser = null;
        _hasObservedOwnerUser = false;
      }
      _listenForOwnerChanges();
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _synchronizeCurrentOwnerIdentity();
      }
    });
  }

  @override
  void dispose() {
    _applicationOperationGeneration += 1;
    _ownerSaveGeneration += 1;
    _couponDraftGeneration += 1;
    _dailySpecialDraftGeneration += 1;
    _signOutOperationGeneration += 1;
    _ownerModalRoutes.clear();
    _ownerPageRoutes.clear();
    _ownerActionGenerations.clear();
    _restaurantImageOperationGeneration += 1;
    _restaurantImageSelectionGeneration += 1;
    _restaurantImageSaveGeneration += 1;
    _selectedRestaurantImage = null;
    WidgetsBinding.instance.removeObserver(this);
    _subscriptionReturnSubscription?.cancel();
    _ownerUserSubscription?.cancel();
    final lifecycleRefreshAttempt = _lifecycleRefreshAttempt;
    if (lifecycleRefreshAttempt != null &&
        !lifecycleRefreshAttempt.isCompleted) {
      lifecycleRefreshAttempt.complete(false);
    }
    SubscriptionReturnService.finishRestaurantHubLifecycleRefresh(
      _lifecycleRefreshOwner,
    );
    SubscriptionReturnService.unregisterRestaurantHub();
    _hubScrollController.dispose();
    restaurantNameController.dispose();
    cityController.dispose();
    zipCodeController.dispose();
    distanceController.dispose();
    emailController.dispose();
    phoneController.dispose();
    streetAddressController.dispose();
    websiteController.dispose();
    bioController.dispose();
    titleController.dispose();
    couponCodeController.dispose();
    couponDetailsController.dispose();
    dailySpecialTitleController.dispose();
    dailySpecialDetailsController.dispose();
    stateController.dispose();
    requestedRestaurantNameController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) {
      SubscriptionReturnService.noteRestaurantHubLifecycleNotResumed();
      return;
    }
    unawaited(_handleRestaurantHubResumed());
  }

  Future<void> _handleRestaurantHubResumed() async {
    final ownerScope = _activeOwnerScope;
    if (ownerScope == null) {
      return;
    }
    final subscriptionOwnerScope = _subscriptionReturnOwnerScope(ownerScope);
    final pendingReturn = await SubscriptionReturnService.peekPendingRefreshFor(
      subscriptionOwnerScope,
      isCurrent: () => mounted && _isCurrentExactOwnerScope(ownerScope),
    );
    if (!mounted || !_isCurrentExactOwnerScope(ownerScope)) {
      return;
    }
    if (pendingReturn != null) {
      if (SubscriptionReturnService.claimRestaurantHubReturnRetryForResume(
        subscriptionOwnerScope,
      )) {
        _schedulePendingSubscriptionReturnRefresh();
      }
      return;
    }
    if (!await SubscriptionReturnService.claimRestaurantHubLifecycleRefreshFor(
      _lifecycleRefreshOwner,
      subscriptionOwnerScope,
    )) {
      // A pending return may have appeared between the first list and the
      // lifecycle reservation. Give that return one normal resume-triggered
      // drain without recursively retrying a failed claim.
      if (_isCurrentExactOwnerScope(ownerScope) &&
          SubscriptionReturnService.claimRestaurantHubReturnRetryForResume(
            subscriptionOwnerScope,
          )) {
        _schedulePendingSubscriptionReturnRefresh();
      }
      return;
    }
    final action = _beginOwnerAction(
      _OwnerActionKind.subscriptionLifecycle,
      expectedOwnerScope: ownerScope,
    );
    if (action == null) {
      SubscriptionReturnService.finishRestaurantHubLifecycleRefresh(
        _lifecycleRefreshOwner,
      );
      return;
    }

    final refreshAttempt = Completer<bool>();
    final lifecycleRefreshOwner = _lifecycleRefreshOwner;
    _lifecycleRefreshAttempt = refreshAttempt;
    SubscriptionReturnService.registerRestaurantHubLifecycleRefresh(
      lifecycleRefreshOwner,
      refreshAttempt.future,
    );
    unawaited(
      _enqueueAccountOperation(() async {
        if (refreshAttempt.isCompleted || !_isCurrentOwnerAction(action)) {
          return;
        }
        try {
          await _refreshSubscriptionStateOnlyNow(
            expectedOwnerScope: action.ownerScope,
          );
        } finally {
          if (!refreshAttempt.isCompleted) {
            refreshAttempt.complete(_isCurrentOwnerAction(action));
          }
        }
      }).whenComplete(() {
        if (!refreshAttempt.isCompleted) {
          refreshAttempt.complete(false);
        }
        if (_isCurrentOwnerAction(action) &&
            identical(_lifecycleRefreshAttempt, refreshAttempt)) {
          _lifecycleRefreshAttempt = null;
        }
        SubscriptionReturnService.finishRestaurantHubLifecycleRefresh(
          lifecycleRefreshOwner,
        );
      }),
    );
  }

  Future<void> _enqueueAccountOperation(Future<void> Function() operation) {
    final next = _accountOperationTail.then((_) async {
      if (!mounted) {
        return;
      }
      await operation();
    });
    _accountOperationTail = next.then<void>((_) {}, onError: (_, _) {});
    return _accountOperationTail;
  }

  void _schedulePendingSubscriptionReturnRefresh() {
    final ownerScope = _activeOwnerScope;
    if (!mounted ||
        ownerScope == null ||
        !_isCurrentExactOwnerScope(ownerScope)) {
      return;
    }

    _subscriptionReturnDrainRequestGeneration += 1;
    if (_subscriptionReturnDrainQueued) {
      return;
    }

    final action = _beginOwnerAction(
      _OwnerActionKind.subscriptionReturn,
      expectedOwnerScope: ownerScope,
    );
    if (action == null) {
      return;
    }
    _subscriptionReturnDrainQueued = true;
    unawaited(_startPendingSubscriptionReturnRefreshDrain(action));
  }

  Future<void> _startPendingSubscriptionReturnRefreshDrain(
    _OwnerActionScope action,
  ) async {
    var handledRequestGeneration = _subscriptionReturnDrainRequestGeneration;
    try {
      final initialPending =
          await SubscriptionReturnService.peekPendingRefreshFor(
            _subscriptionReturnOwnerScope(action.ownerScope),
            isCurrent: () => _isCurrentOwnerAction(action),
          );
      if (!_isCurrentOwnerAction(action) || initialPending == null) {
        return;
      }
      handledRequestGeneration = _subscriptionReturnDrainRequestGeneration;

      await _enqueueAccountOperation(() async {
        while (_isCurrentOwnerAction(action)) {
          final refreshCandidate =
              await SubscriptionReturnService.peekPendingRefreshCandidateFor(
                _subscriptionReturnOwnerScope(action.ownerScope),
                isCurrent: () => _isCurrentOwnerAction(action),
              );
          if (!_isCurrentOwnerAction(action) || refreshCandidate == null) {
            return;
          }
          handledRequestGeneration = _subscriptionReturnDrainRequestGeneration;
          final lifecycleRefresh = refreshCandidate.coalescedLifecycleRefresh;
          final immediateRefreshAlreadyAttempted =
              lifecycleRefresh != null && await lifecycleRefresh;
          if (!_isCurrentOwnerAction(action)) {
            return;
          }
          if (!await SubscriptionReturnService.claimRefreshFor(
            refreshCandidate.event.id,
            _subscriptionReturnOwnerScope(action.ownerScope),
            isCurrent: () => _isCurrentOwnerAction(action),
          )) {
            // Leave the server event unclaimed. A later lifecycle, mount, or
            // delivery notification may retry; this drain never recurses.
            return;
          }
          var refreshSucceeded = false;
          try {
            refreshSucceeded = await _refreshAfterSubscriptionReturn(
              refreshCandidate.event.kind,
              expectedAction: action,
              immediateRefreshAlreadyAttempted:
                  immediateRefreshAlreadyAttempted,
            );
          } finally {
            SubscriptionReturnService.finishRefresh(
              refreshCandidate.event,
              refreshSucceeded: refreshSucceeded,
            );
          }
        }
      });
    } finally {
      _subscriptionReturnDrainQueued = false;
      if (mounted &&
          _subscriptionReturnDrainRequestGeneration >
              handledRequestGeneration) {
        _schedulePendingSubscriptionReturnRefresh();
      }
    }
  }

  Future<bool> _refreshAfterSubscriptionReturn(
    SubscriptionReturnKind kind, {
    required _OwnerActionScope expectedAction,
    bool immediateRefreshAlreadyAttempted = false,
  }) async {
    if (!_isCurrentOwnerAction(expectedAction)) {
      return false;
    }
    var anyRefreshSucceeded = immediateRefreshAlreadyAttempted;
    if (!immediateRefreshAlreadyAttempted) {
      anyRefreshSucceeded = await _refreshSubscriptionStateOnlyNow(
        expectedOwnerScope: expectedAction.ownerScope,
      );
      if (!_isCurrentOwnerAction(expectedAction)) {
        return false;
      }
    }
    if (kind != SubscriptionReturnKind.checkoutSuccess) {
      return anyRefreshSucceeded;
    }

    await Future<void>.delayed(const Duration(seconds: 3));
    if (!_isCurrentOwnerAction(expectedAction)) {
      return false;
    }
    anyRefreshSucceeded =
        await _refreshSubscriptionStateOnlyNow(
          expectedOwnerScope: expectedAction.ownerScope,
        ) ||
        anyRefreshSucceeded;
    return anyRefreshSucceeded;
  }

  void _resetCouponSchedule() {
    couponStartTime = DateTime.now();
    couponEndTime = null;
  }

  List<RestaurantBusinessHours> _hoursForEditing(
    List<RestaurantBusinessHours> hours,
  ) {
    if (hours.isEmpty) {
      return RestaurantBusinessHours.defaultWeek();
    }

    return RestaurantBusinessHours.normalizedWeek(hours);
  }

  List<RestaurantBusinessHours> _hoursForPersistence() {
    final normalized = RestaurantBusinessHours.normalizedWeek(businessHours);
    if (!_businessHoursDirty && normalized.every((entry) => entry.closed)) {
      return const [];
    }

    return normalized;
  }

  Future<Map<String, dynamic>?> _loadRestaurantAccount(String uid) {
    final loadAccount = widget.loadAccount;
    if (loadAccount != null) {
      return loadAccount(uid);
    }
    return RestaurantAccountService.getAccountData(uid);
  }

  Future<List<Coupon>> _loadRestaurantCoupons(String uid) {
    final loadCoupons = widget.loadCoupons;
    if (loadCoupons != null) {
      return loadCoupons(uid);
    }
    return RestaurantAccountService.loadCoupons(uid);
  }

  Future<List<DailySpecial>> _loadRestaurantDailySpecials(String uid) {
    final loadDailySpecials = widget.loadDailySpecials;
    if (loadDailySpecials != null) {
      return loadDailySpecials(uid);
    }
    return RestaurantAccountService.loadDailySpecialsForRestaurant(uid);
  }

  Restaurant? _restaurantFromAccountData(
    String documentId,
    Map<String, dynamic>? data,
  ) {
    if (data == null) {
      return null;
    }
    return Restaurant.fromFirestore(
      data,
      documentId: documentId,
      coupons: const <Coupon>[],
    );
  }

  void _clearTrustedProfileState() {
    _profileVersion = 0;
    _locationVersion = 0;
    _hasTrustedSearchableLocation = false;
    _storedRestaurantName = '';
    _trustedProfileOwnerIdentity = null;
    _trustedProfileOwnerGeneration = null;
  }

  void _recordTrustedProfileState(
    Restaurant restaurant, {
    required _RestaurantOwnerIdentity ownerIdentity,
    required int ownerIdentityGeneration,
  }) {
    _profileVersion = restaurant.profileVersion;
    _locationVersion = restaurant.locationVersion;
    _hasTrustedSearchableLocation = restaurant.hasTrustedSearchableLocation;
    _storedRestaurantName = restaurant.name.trim();
    _trustedProfileOwnerIdentity = ownerIdentity;
    _trustedProfileOwnerGeneration = ownerIdentityGeneration;
  }

  String _normalizedRestaurantNameForComparison(String value) {
    return value.trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase();
  }

  BiteSaverBasicInformationProfileInput _basicInformationProfileInput() {
    return BiteSaverBasicInformationProfileInput(
      streetAddress: streetAddressController.text,
      city: cityController.text,
      state: stateController.text,
      zipCode: zipCodeController.text,
      phone: phoneController.text,
      website: websiteController.text,
      bio: bioController.text,
    );
  }

  BiteSaverRestaurantProfileInput _applicationProfileInput({
    required String restaurantName,
  }) {
    return BiteSaverRestaurantProfileInput(
      restaurantName: restaurantName,
      streetAddress: streetAddressController.text,
      city: cityController.text,
      state: stateController.text,
      zipCode: zipCodeController.text,
      phone: phoneController.text,
    );
  }

  String _stringFromCoordinateValue(dynamic value) {
    if (value is num) {
      return value.toString();
    }

    if (value is String) {
      return value.trim();
    }

    return '';
  }

  Future<User?> _reloadCurrentRestaurantUser() async {
    if (widget.ownerUserChanges != null && _hasObservedOwnerUser) {
      return currentUser;
    }
    if (widget.currentUserProvider != null) {
      return currentUser;
    }
    if (widget.testCurrentUser != null) {
      return widget.testCurrentUser;
    }
    final user = currentUser;
    if (user == null) {
      return null;
    }

    try {
      await user.reload();
      final refreshedUser = FirebaseAuth.instance.currentUser;
      await refreshedUser?.getIdToken(true);
      if (refreshedUser != null) {
        await RestaurantAccountService.syncEmailVerified(refreshedUser);
      }
      return refreshedUser;
    } catch (_) {
      return FirebaseAuth.instance.currentUser;
    }
  }

  Future<void> _pickCouponDateTime({required bool isStart}) async {
    final action = _beginOwnerAction(_OwnerActionKind.couponDateTime);
    if (action == null) {
      return;
    }
    final draftGeneration = _couponDraftGeneration;
    final existingValue = isStart ? couponStartTime : couponEndTime;
    final initialValue = existingValue ?? DateTime.now();

    final now = DateTime.now();
    final firstDate = now.subtract(const Duration(days: 365));
    final lastDate = now.add(const Duration(days: 3650));
    final pickDate = widget.pickCouponDate;
    final pickedDate = pickDate != null
        ? await pickDate(
            initialDate: initialValue,
            firstDate: firstDate,
            lastDate: lastDate,
          )
        : await _showOwnerScopedDatePicker(
            expectedOwnerScope: action.ownerScope,
            initialDate: initialValue,
            firstDate: firstDate,
            lastDate: lastDate,
          );
    if (pickedDate == null ||
        !_isCurrentOwnerAction(action) ||
        draftGeneration != _couponDraftGeneration) {
      return;
    }
    if (!mounted) {
      return;
    }

    final initialTime = isStart
        ? TimeOfDay.fromDateTime(initialValue)
        : const TimeOfDay(hour: 23, minute: 59);
    final pickTime = widget.pickCouponTime;
    final pickedTime = pickTime != null
        ? await pickTime(initialTime: initialTime)
        : await _showOwnerScopedTimePicker(
            expectedOwnerScope: action.ownerScope,
            initialTime: initialTime,
          );
    if (pickedTime == null ||
        !_isCurrentOwnerAction(action) ||
        draftGeneration != _couponDraftGeneration) {
      return;
    }

    final selectedDateTime = DateTime(
      pickedDate.year,
      pickedDate.month,
      pickedDate.day,
      pickedTime.hour,
      pickedTime.minute,
    );

    setState(() {
      _advanceCouponDraftGeneration();
      if (isStart) {
        couponStartTime = selectedDateTime;
      } else {
        couponEndTime = selectedDateTime;
      }
      if (_couponSubmitAttempted) {
        _couponValidationHighlights = _invalidCouponFields();
      }
    });
  }

  Widget buildDateTimeField({
    required String label,
    required String hint,
    required DateTime? value,
    required VoidCallback onTap,
    String? errorText,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: InputDecorator(
        decoration: buildInputDecoration(label, hint, errorText: errorText),
        child: Row(
          children: [
            Expanded(
              child: Text(
                value == null ? hint : Coupon.formatDateTime(value),
                style: TextStyle(
                  color: value == null ? Colors.black45 : Colors.black87,
                ),
              ),
            ),
            const Icon(Icons.schedule),
          ],
        ),
      ),
    );
  }

  Future<void> _pickDailySpecialTime({required bool isStart}) async {
    final action = _beginOwnerAction(_OwnerActionKind.dailySpecialTime);
    if (action == null) {
      return;
    }
    final draftGeneration = _dailySpecialDraftGeneration;
    final initialTime = isStart
        ? _dailySpecialStartTime ?? const TimeOfDay(hour: 9, minute: 0)
        : _dailySpecialEndTime ?? const TimeOfDay(hour: 17, minute: 0);
    final pickTime = widget.pickDailySpecialTime;
    final pickedTime = pickTime != null
        ? await pickTime(initialTime: initialTime)
        : await _showOwnerScopedTimePicker(
            expectedOwnerScope: action.ownerScope,
            initialTime: initialTime,
          );
    if (pickedTime == null ||
        !_isCurrentOwnerAction(action) ||
        draftGeneration != _dailySpecialDraftGeneration) {
      return;
    }

    setState(() {
      _dailySpecialDraftGeneration += 1;
      if (isStart) {
        _dailySpecialStartTime = pickedTime;
      } else {
        _dailySpecialEndTime = pickedTime;
      }
    });
  }

  Widget _buildTimeOfDayField({
    required String label,
    required String hint,
    required TimeOfDay? value,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: InputDecorator(
        decoration: buildInputDecoration(label, hint),
        child: Row(
          children: [
            Expanded(
              child: Text(
                value == null ? hint : value.format(context),
                style: TextStyle(
                  color: value == null ? Colors.black45 : Colors.black87,
                ),
              ),
            ),
            const Icon(Icons.schedule),
          ],
        ),
      ),
    );
  }

  String? _formatSpecialTimeForFirestore(TimeOfDay? time) {
    if (time == null) {
      return null;
    }

    return '${time.hour.toString().padLeft(2, '0')}:'
        '${time.minute.toString().padLeft(2, '0')}';
  }

  TimeOfDay? _timeOfDayFromSpecialTime(String? value) {
    if (value == null) {
      return null;
    }

    final parts = value.split(':');
    if (parts.length != 2) {
      return null;
    }

    final hour = int.tryParse(parts[0]);
    final minute = int.tryParse(parts[1]);
    if (hour == null ||
        minute == null ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59) {
      return null;
    }

    return TimeOfDay(hour: hour, minute: minute);
  }

  String _dailySpecialScheduleSummary(DailySpecial special) {
    return special.scheduleSummaryText();
  }

  Future<void> _loadSavedProfileAndCoupons() async {
    final loadOwnerIdentity = _activeOwnerIdentity;
    final loadOwnerIdentityGeneration = _ownerIdentityGeneration;
    if (_currentOwnerIdentity != loadOwnerIdentity) {
      _transitionOwnerIdentityIfNeeded(_currentOwnerIdentity);
      return;
    }

    LocalCouponStore.clearCoupons();

    final user = await _reloadCurrentRestaurantUser() ?? currentUser;
    if (!mounted) {
      return;
    }
    final reloadedOwnerIdentity = _ownerIdentityFor(user);
    if (reloadedOwnerIdentity != loadOwnerIdentity ||
        (loadOwnerIdentity != null &&
            !_isCurrentOwnerScope(
              loadOwnerIdentity,
              loadOwnerIdentityGeneration,
            ))) {
      _transitionOwnerIdentityIfNeeded(reloadedOwnerIdentity);
      return;
    }
    if (user == null) {
      _clearOwnerScopedProfilePresentation(
        email: null,
        resetLocalProfile: true,
      );
      _couponAccessState = _CouponAccountAccessState.noAccount;
      _couponAccessMessage = _couponAccessMessageFor(
        state: _couponAccessState,
        email: null,
      );
      _hasCouponPostingAccess = false;
      _hasUsedTrial = false;
      _cancelAtPeriodEnd = false;
      _subscriptionStatus = 'inactive';
      _trialEndsAt = null;
      _subscriptionEndsAt = null;
      if (mounted) {
        setState(() {
          profileLoading = false;
          couponsLoading = false;
          _dailySpecialsLoading = false;
        });
      }
      return;
    }

    try {
      final data = await _loadRestaurantAccount(user.uid);
      if (!mounted ||
          loadOwnerIdentity == null ||
          !_isCurrentOwnerScope(
            loadOwnerIdentity,
            loadOwnerIdentityGeneration,
          )) {
        return;
      }
      if (data == null) {
        _clearOwnerScopedProfilePresentation(
          email: user.email,
          resetLocalProfile: true,
        );
      }
      final loadedRestaurant = _restaurantFromAccountData(
        loadOwnerIdentity.accountDocumentId,
        data,
      );
      if (loadedRestaurant == null) {
        _clearTrustedProfileState();
      } else {
        _recordTrustedProfileState(
          loadedRestaurant,
          ownerIdentity: loadOwnerIdentity,
          ownerIdentityGeneration: loadOwnerIdentityGeneration,
        );
      }
      final hasSubmittedApplication =
          RestaurantAccountService.hasSubmittedCouponApplication(data);
      final approvalStatus =
          (data?['approvalStatus'] as String?)?.trim() ?? 'pending';
      final requiresEmailVerification =
          RestaurantAuthService.requiresEmailVerification(user);

      _couponAccessState = _resolveCouponAccessState(
        hasSubmittedApplication: hasSubmittedApplication,
        requiresEmailVerification: requiresEmailVerification,
        approvalStatus: approvalStatus,
      );
      _couponAccessMessage = _couponAccessMessageFor(
        state: _couponAccessState,
        email: user.email,
      );
      _hasCouponPostingAccess = RestaurantAccountService.hasCouponPostingAccess(
        data,
      );
      _hasUsedTrial = data?['hasUsedTrial'] == true;
      _cancelAtPeriodEnd = data?['cancelAtPeriodEnd'] == true;
      _subscriptionStatus =
          ((data?['subscriptionStatus'] as String?) ?? 'inactive')
              .trim()
              .toLowerCase();
      final rawTrialEndsAt = data?['trialEndsAt'];
      _trialEndsAt = rawTrialEndsAt is Timestamp
          ? rawTrialEndsAt.toDate()
          : rawTrialEndsAt as DateTime?;
      final rawSubscriptionEndsAt = data?['subscriptionEndsAt'];
      _subscriptionEndsAt = rawSubscriptionEndsAt is Timestamp
          ? rawSubscriptionEndsAt.toDate()
          : rawSubscriptionEndsAt as DateTime?;

      if (data != null) {
        restaurantNameController.text =
            (data['restaurantName'] as String?)?.trim().isNotEmpty == true
            ? data['restaurantName'] as String
            : restaurantNameController.text;
        cityController.text =
            (data['city'] as String?)?.trim().isNotEmpty == true
            ? data['city'] as String
            : cityController.text;
        stateController.text =
            (data[Restaurant.fieldState] as String?)?.trim().isNotEmpty == true
            ? data[Restaurant.fieldState] as String
            : stateController.text;
        zipCodeController.text =
            (data['zipCode'] as String?)?.trim().isNotEmpty == true
            ? data['zipCode'] as String
            : zipCodeController.text;
        emailController.text =
            (data['email'] as String?)?.trim().isNotEmpty == true
            ? data['email'] as String
            : emailController.text;
        phoneController.text =
            (data['phone'] as String?)?.trim().isNotEmpty == true
            ? formatPhoneNumberForDisplay(data['phone'] as String)
            : phoneController.text;
        streetAddressController.text =
            (data['streetAddress'] as String?)?.trim().isNotEmpty == true
            ? data['streetAddress'] as String
            : streetAddressController.text;
        websiteController.text =
            (data[Restaurant.fieldWebsite] as String?)?.trim() ?? '';
        bioController.text =
            (data[Restaurant.fieldBio] as String?)?.trim() ?? '';
        final storedImageUrl =
            (data[Restaurant.fieldMainImageUrl] as String?)?.trim() ?? '';
        restaurantImageUrl = storedImageUrl.isEmpty ? null : storedImageUrl;
        final loadedBusinessHours = RestaurantBusinessHours.listFromFirestore(
          data[Restaurant.fieldBusinessHours],
        );
        businessHours = _hoursForEditing(loadedBusinessHours);
        _businessHoursDirty = loadedBusinessHours.isNotEmpty;
      }

      if (_couponAccessState != _CouponAccountAccessState.approved) {
        _captureRestaurantProfileSnapshot();
        if (mounted) {
          setState(() {
            profileLoading = false;
            couponsLoading = false;
            _dailySpecialsLoading = false;
          });
        }
        return;
      }

      final loadedCoupons = await _loadRestaurantCoupons(user.uid);
      if (!mounted ||
          !_isCurrentOwnerScope(
            loadOwnerIdentity,
            loadOwnerIdentityGeneration,
          )) {
        return;
      }
      for (final coupon in loadedCoupons.reversed) {
        LocalCouponStore.addCoupon(coupon);
      }
      final loadedDailySpecials = await _loadRestaurantDailySpecials(user.uid);
      if (!mounted ||
          !_isCurrentOwnerScope(
            loadOwnerIdentity,
            loadOwnerIdentityGeneration,
          )) {
        return;
      }
      _dailySpecials = loadedDailySpecials;

      final persistedBusinessHours = _hoursForPersistence();
      LocalRestaurantProfileStore.updateProfile(
        RestaurantProfileData(
          name: restaurantNameController.text.trim(),
          city: cityController.text.trim().isEmpty
              ? 'Lecanto'
              : cityController.text.trim(),
          state: stateController.text.trim().isEmpty
              ? 'FL'
              : stateController.text.trim(),
          zipCode: zipCodeController.text.trim().isEmpty
              ? '34461'
              : zipCodeController.text.trim(),
          distance: distanceController.text.trim().isEmpty
              ? '0.8 miles away'
              : distanceController.text.trim(),
          email: emailController.text.trim(),
          phone: phoneController.text.trim(),
          streetAddress: streetAddressController.text.trim(),
          website: websiteController.text.trim(),
          bio: bioController.text.trim(),
          mainImageUrl: restaurantImageUrl ?? '',
          latitude: _stringFromCoordinateValue(data?[Restaurant.fieldLatitude]),
          longitude: _stringFromCoordinateValue(
            data?[Restaurant.fieldLongitude],
          ),
          businessHours: persistedBusinessHours,
        ),
      );
    } catch (_) {
      if (!mounted ||
          loadOwnerIdentity == null ||
          !_isCurrentOwnerScope(
            loadOwnerIdentity,
            loadOwnerIdentityGeneration,
          )) {
        return;
      }
      _clearTrustedProfileState();
      _couponAccessState = _CouponAccountAccessState.loadFailed;
      _couponAccessMessage =
          'Could not load your BiteSaver owner tools right now. Please try again.';
      _hasCouponPostingAccess = false;
      _hasUsedTrial = false;
      _cancelAtPeriodEnd = false;
      _subscriptionStatus = 'inactive';
      _trialEndsAt = null;
      _subscriptionEndsAt = null;
    }

    if (mounted &&
        _isCurrentOwnerScope(loadOwnerIdentity, loadOwnerIdentityGeneration)) {
      _captureRestaurantProfileSnapshot();
      setState(() {
        profileLoading = false;
        couponsLoading = false;
        _dailySpecialsLoading = false;
      });
    }
  }

  Future<bool> _refreshSubscriptionStateOnlyNow({
    _RestaurantOwnerScope? expectedOwnerScope,
  }) async {
    final action = _beginOwnerAction(
      _OwnerActionKind.subscriptionRefresh,
      expectedOwnerScope: expectedOwnerScope,
    );
    if (action == null) {
      return false;
    }
    final user = await _reloadCurrentRestaurantUser() ?? currentUser;
    if (!_isCurrentOwnerAction(action) ||
        user == null ||
        user.uid.trim() != action.ownerScope.identity.uid) {
      return false;
    }

    _setSubscriptionStateRefreshing(true);
    try {
      final data = await _loadRestaurantAccount(action.ownerScope.identity.uid);
      if (!_isCurrentOwnerAction(action) || data == null) {
        return false;
      }

      final subscriptionStatus =
          ((data['subscriptionStatus'] as String?) ?? 'inactive')
              .trim()
              .toLowerCase();
      final rawTrialEndsAt = data['trialEndsAt'];
      final trialEndsAt = rawTrialEndsAt is Timestamp
          ? rawTrialEndsAt.toDate()
          : rawTrialEndsAt as DateTime?;
      final rawSubscriptionEndsAt = data['subscriptionEndsAt'];
      final subscriptionEndsAt = rawSubscriptionEndsAt is Timestamp
          ? rawSubscriptionEndsAt.toDate()
          : rawSubscriptionEndsAt as DateTime?;
      final hasCouponPostingAccess =
          RestaurantAccountService.hasCouponPostingAccess(data);
      final hasUsedTrial = data['hasUsedTrial'] == true;
      final cancelAtPeriodEnd = data['cancelAtPeriodEnd'] == true;

      if (_isCurrentOwnerAction(action)) {
        setState(() {
          _hasUsedTrial = hasUsedTrial;
          _cancelAtPeriodEnd = cancelAtPeriodEnd;
          _subscriptionStatus = subscriptionStatus;
          _trialEndsAt = trialEndsAt;
          _subscriptionEndsAt = subscriptionEndsAt;
          _hasCouponPostingAccess = hasCouponPostingAccess;
        });
        return true;
      }
    } catch (_) {
      // Keep the current screen state if the refresh fails.
    } finally {
      if (_isCurrentOwnerAction(action)) {
        _setSubscriptionStateRefreshing(false);
      }
    }
    return false;
  }

  void _setSubscriptionStateRefreshing(bool isRefreshing) {
    if (_subscriptionStateRefreshing == isRefreshing) {
      return;
    }
    _subscriptionStateRefreshing = isRefreshing;
    widget.onSubscriptionRefreshStateChanged?.call(isRefreshing);
  }

  _CouponAccountAccessState _resolveCouponAccessState({
    required bool hasSubmittedApplication,
    required bool requiresEmailVerification,
    required String approvalStatus,
  }) {
    if (!hasSubmittedApplication) {
      return _CouponAccountAccessState.noAccount;
    }
    if (requiresEmailVerification) {
      return _CouponAccountAccessState.unverified;
    }
    if (approvalStatus == 'approved') {
      return _CouponAccountAccessState.approved;
    }
    if (approvalStatus == 'rejected') {
      return _CouponAccountAccessState.rejected;
    }
    return _CouponAccountAccessState.pending;
  }

  String _couponAccessMessageFor({
    required _CouponAccountAccessState state,
    required String? email,
  }) {
    final accountEmail = email?.trim().isNotEmpty == true
        ? email!.trim()
        : 'your restaurant account';

    switch (state) {
      case _CouponAccountAccessState.noAccount:
        return 'Enter your restaurant information below.';
      case _CouponAccountAccessState.unverified:
        return 'Please verify the email for $accountEmail before managing '
            'BiteSaver coupons.';
      case _CouponAccountAccessState.pending:
        return 'Your BiteSaver coupon-side restaurant account for '
            '$accountEmail is still waiting for admin approval.';
      case _CouponAccountAccessState.rejected:
        return 'Your BiteSaver coupon-side restaurant account for '
            '$accountEmail was not approved.';
      case _CouponAccountAccessState.loadFailed:
        return 'Could not load your BiteSaver owner tools right now. Please try again.';
      case _CouponAccountAccessState.approved:
      case _CouponAccountAccessState.loading:
        return '';
    }
  }

  String _couponAccessTitle() {
    switch (_couponAccessState) {
      case _CouponAccountAccessState.noAccount:
        return 'Apply for Coupon-Side Approval';
      case _CouponAccountAccessState.unverified:
        return 'Email Verification Required';
      case _CouponAccountAccessState.pending:
        return 'Coupon-Side Approval Pending';
      case _CouponAccountAccessState.rejected:
        return 'Coupon-Side Access Not Approved';
      case _CouponAccountAccessState.loadFailed:
        return 'Could Not Load Coupon Tools';
      case _CouponAccountAccessState.approved:
      case _CouponAccountAccessState.loading:
        return '';
    }
  }

  IconData _couponAccessIcon() {
    switch (_couponAccessState) {
      case _CouponAccountAccessState.noAccount:
        return Icons.storefront_outlined;
      case _CouponAccountAccessState.unverified:
        return Icons.mark_email_read_outlined;
      case _CouponAccountAccessState.pending:
        return Icons.hourglass_top;
      case _CouponAccountAccessState.rejected:
        return Icons.block_outlined;
      case _CouponAccountAccessState.loadFailed:
        return Icons.error_outline;
      case _CouponAccountAccessState.approved:
      case _CouponAccountAccessState.loading:
        return Icons.storefront_outlined;
    }
  }

  Future<void> _refreshCouponAccessState({
    required _RestaurantOwnerScope expectedOwnerScope,
    required int applicationOperationGeneration,
  }) async {
    await _enqueueAccountOperation(() async {
      if (!mounted ||
          !_isCurrentExactOwnerScope(expectedOwnerScope) ||
          applicationOperationGeneration != _applicationOperationGeneration) {
        return;
      }
      setState(() {
        profileLoading = true;
        couponsLoading = true;
        _couponAccessState = _CouponAccountAccessState.loading;
      });
      await _loadSavedProfileAndCoupons();
    });
  }

  Future<void> _refreshCurrentCouponAccessState() async {
    final ownerScope = _activeOwnerScope;
    if (ownerScope == null || !_isCurrentExactOwnerScope(ownerScope)) {
      return;
    }
    await _refreshCouponAccessState(
      expectedOwnerScope: ownerScope,
      applicationOperationGeneration: _applicationOperationGeneration,
    );
  }

  Future<void> _applyForCouponSideAccount() async {
    if (profileSaving || _applicationOperation.isInFlight) {
      return;
    }

    final user = currentUser;
    if (user == null) {
      _showSnackBar('Please sign in to continue.');
      return;
    }
    final ownerScope = _activeOwnerScope;
    if (ownerScope == null ||
        ownerScope.identity.uid != user.uid ||
        !_isCurrentExactOwnerScope(ownerScope)) {
      _showSnackBar('Your restaurant account changed. Reload and try again.');
      return;
    }
    final operationGeneration = _applicationOperationGeneration;
    final applicationOperation = _applicationOperation;
    bool ownerOperationIsCurrent() =>
        mounted &&
        operationGeneration == _applicationOperationGeneration &&
        _isCurrentExactOwnerScope(ownerScope);

    final restaurantName = restaurantNameController.text.trim();
    final streetAddress = streetAddressController.text.trim();
    final city = cityController.text.trim();
    final state = stateController.text.trim();
    final zipCode = zipCodeController.text.trim();
    final phone = phoneController.text.trim();

    if (restaurantName.isEmpty) {
      _showSnackBar('Restaurant name is required.');
      return;
    }
    if (streetAddress.isEmpty) {
      _showSnackBar('Street address is required.');
      return;
    }
    if (city.isEmpty) {
      _showSnackBar('City is required.');
      return;
    }
    if (state.isEmpty) {
      _showSnackBar('State is required.');
      return;
    }
    if (zipCode.isEmpty) {
      _showSnackBar('ZIP code is required.');
      return;
    }
    if (phone.isEmpty) {
      _showSnackBar('Phone number is required.');
      return;
    }

    setState(() {
      profileSaving = true;
    });

    try {
      final request = BiteSaverProfileSaveRequest.submitApplication(
        profile: _applicationProfileInput(restaurantName: restaurantName),
      );
      final result = await applicationOperation.execute(
        request: request,
        logicalTarget: ownerScope.logicalTarget(operation: 'application'),
        invoke: (requestId) async {
          final result = await _lifecycleService.save(
            request,
            requestId: requestId,
          );
          if (result.documentId.trim() !=
              ownerScope.identity.accountDocumentId) {
            throw const BiteSaverLifecycleException(
              kind: BiteSaverLifecycleFailureKind.staleProfile,
              code: 'failed-precondition',
              message: 'Your restaurant account changed. Reload and try again.',
            );
          }
          return result;
        },
      );
      if (!ownerOperationIsCurrent()) {
        return;
      }
      if (result.documentId.trim() != ownerScope.identity.accountDocumentId) {
        _showSnackBar('Your restaurant account changed. Reload and try again.');
        return;
      }
      _profileVersion = result.profileVersion;
      if (result.locationVersion != null) {
        _locationVersion = result.locationVersion!;
      }
      _showSnackBar('Coupon-side application submitted for admin review.');
      await _refreshCouponAccessState(
        expectedOwnerScope: ownerScope,
        applicationOperationGeneration: operationGeneration,
      );
    } on BiteSaverLifecycleException catch (error) {
      if (!ownerOperationIsCurrent()) {
        return;
      }
      _showSnackBar(error.message);
    } catch (error) {
      if (!ownerOperationIsCurrent()) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not submit your coupon-side application right now.',
        ),
      );
    } finally {
      if (ownerOperationIsCurrent()) {
        setState(() {
          profileSaving = false;
        });
      }
    }
  }

  Future<void> _submitRestaurantNameChangeRequest() async {
    final user = currentUser;
    if (user == null) {
      _showSnackBar('Please sign in to continue.');
      return;
    }
    final ownerIdentity = _activeOwnerIdentity;
    final ownerIdentityGeneration = _ownerIdentityGeneration;
    if (ownerIdentity == null ||
        user.uid.trim() != ownerIdentity.uid ||
        !_isCurrentOwnerScope(ownerIdentity, ownerIdentityGeneration)) {
      _showSnackBar('Your restaurant account changed. Reload and try again.');
      return;
    }
    bool ownerOperationIsCurrent() =>
        mounted && _isCurrentOwnerScope(ownerIdentity, ownerIdentityGeneration);

    final currentRestaurantName = _storedRestaurantName.isNotEmpty
        ? _storedRestaurantName
        : restaurantNameController.text.trim();
    final requestedRestaurantName = requestedRestaurantNameController.text
        .trim();

    if (requestedRestaurantName.isEmpty) {
      _showSnackBar('Please enter the requested restaurant name.');
      return;
    }

    if (_normalizedRestaurantNameForComparison(requestedRestaurantName) ==
        _normalizedRestaurantNameForComparison(currentRestaurantName)) {
      _showSnackBar('Please enter a different restaurant name.');
      return;
    }

    setState(() {
      _submittingNameChangeRequest = true;
    });

    try {
      final submitNameChangeRequest = widget.submitNameChangeRequest;
      if (submitNameChangeRequest != null) {
        await submitNameChangeRequest(
          userId: user.uid,
          currentRestaurantName: currentRestaurantName,
          requestedRestaurantName: requestedRestaurantName,
        );
      } else {
        await FirebaseFirestore.instance
            .collection('restaurant_name_change_requests')
            .add({
              'userId': user.uid,
              'currentRestaurantName': currentRestaurantName,
              'requestedRestaurantName': requestedRestaurantName,
              'createdAt': FieldValue.serverTimestamp(),
              'status': 'pending',
            });
      }

      if (!ownerOperationIsCurrent()) {
        return;
      }

      requestedRestaurantNameController.clear();
      setState(() {
        _showNameChangeRequest = false;
      });
      _showSnackBar('Name change request submitted.');
    } catch (error) {
      if (!ownerOperationIsCurrent()) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not submit the name change request right now.',
        ),
      );
    } finally {
      if (ownerOperationIsCurrent()) {
        setState(() {
          _submittingNameChangeRequest = false;
        });
      }
    }
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
      );
  }

  String _formatShortDate(DateTime value) {
    return MaterialLocalizations.of(context).formatMediumDate(value.toLocal());
  }

  Widget _buildSubscriptionStatusSection() {
    final renderedOwnerScope = _activeOwnerScope;
    final now = DateTime.now();
    final hasValidTrial =
        _subscriptionStatus == 'trialing' &&
        _trialEndsAt != null &&
        _trialEndsAt!.isAfter(now);
    final canManageSubscription =
        _subscriptionStatus == 'active' || hasValidTrial;

    late final String title;
    late final String message;
    late final Color accentColor;
    late final IconData icon;

    if (hasValidTrial) {
      final remainingDays = _trialEndsAt!.difference(now).inDays.clamp(0, 9999);
      title = 'Trial active';
      if (_cancelAtPeriodEnd) {
        message =
            'Cancels at end of trial • ${_formatShortDate(_trialEndsAt!)} • '
            '$remainingDays day${remainingDays == 1 ? '' : 's'} remaining';
      } else {
        message = remainingDays <= 0
            ? 'Trial ends ${_formatShortDate(_trialEndsAt!)}'
            : 'Ends ${_formatShortDate(_trialEndsAt!)} • $remainingDays day${remainingDays == 1 ? '' : 's'} remaining';
      }
      accentColor = const Color(0xFF2563EB);
      icon = Icons.schedule_outlined;
    } else if (_subscriptionStatus == 'active') {
      title = 'Subscription active';
      message = !_hasCouponPostingAccess
          ? 'Coupon and daily-special posting is unavailable right now. Manage your subscription for details.'
          : _cancelAtPeriodEnd
          ? _subscriptionEndsAt == null
                ? 'Cancels at end of billing period.'
                : 'Cancels at end of billing period • ${_formatShortDate(_subscriptionEndsAt!)}'
          : 'Your restaurant can post coupons and daily specials right now.';
      accentColor = const Color(0xFF15803D);
      icon = Icons.verified_outlined;
    } else if (_hasCouponPostingAccess) {
      title = 'Posting access active';
      message =
          'Your restaurant can post coupons and daily specials right now.';
      accentColor = const Color(0xFF15803D);
      icon = Icons.verified_outlined;
    } else {
      title = 'Not subscribed';
      message =
          'Start a subscription when you are ready to post coupons or daily specials.';
      accentColor = const Color(0xFF64748B);
      icon = Icons.credit_card_off_outlined;
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accentColor.withValues(alpha: 0.18)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: accentColor.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: accentColor),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      message,
                      style: const TextStyle(
                        fontSize: 13,
                        color: Color(0xFF64748B),
                        height: 1.35,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (canManageSubscription) ...[
            const SizedBox(height: 14),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton(
                onPressed: _customerPortalLoading || renderedOwnerScope == null
                    ? null
                    : () => _openManageSubscription(renderedOwnerScope),
                child: Text(
                  _customerPortalLoading ? 'Opening...' : 'Manage Subscription',
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  double proximityRadiusToMiles(String radiusText) {
    return double.tryParse(radiusText.split(' ').first) ?? 1.0;
  }

  String? _validateBasicInformationInput() {
    final streetAddress = streetAddressController.text.trim();
    final city = cityController.text.trim();
    final state = stateController.text.trim();
    final zipCode = zipCodeController.text.trim();
    final phone = phoneController.text.trim();

    if (streetAddress.isEmpty ||
        city.isEmpty ||
        state.isEmpty ||
        zipCode.isEmpty ||
        phone.isEmpty) {
      return 'Please complete the required profile fields: street, city, state, ZIP, and phone.';
    }

    return null;
  }

  String? _validateCouponInput(Coupon draftCoupon) {
    return draftCoupon.validateForSave();
  }

  Set<_CouponValidationField> _invalidCouponFields() {
    final invalidFields = <_CouponValidationField>{};
    final title = titleController.text.trim();
    final startTime = couponStartTime;
    final endTime = couponEndTime;

    if (title.isEmpty) {
      invalidFields.add(_CouponValidationField.title);
    }
    if (startTime == null) {
      invalidFields.add(_CouponValidationField.startTime);
    }
    if (endTime == null) {
      invalidFields.add(_CouponValidationField.endTime);
    } else if (startTime != null && !endTime.isAfter(startTime)) {
      invalidFields.add(_CouponValidationField.endTime);
    }

    return invalidFields;
  }

  String _couponValidationMessage(Set<_CouponValidationField> invalidFields) {
    if (invalidFields.contains(_CouponValidationField.title)) {
      return 'Coupon title is required.';
    }
    if (invalidFields.contains(_CouponValidationField.startTime)) {
      return 'Coupon start time is required.';
    }
    if (invalidFields.contains(_CouponValidationField.endTime)) {
      return couponEndTime == null
          ? 'Coupon end time is required.'
          : 'Coupon end time must be after the start time.';
    }
    return 'Please complete the required coupon fields.';
  }

  GlobalKey? _firstInvalidCouponFieldKey(
    Set<_CouponValidationField> invalidFields,
  ) {
    if (invalidFields.contains(_CouponValidationField.title)) {
      return _couponTitleFieldKey;
    }
    if (invalidFields.contains(_CouponValidationField.startTime)) {
      return _couponStartTimeFieldKey;
    }
    if (invalidFields.contains(_CouponValidationField.endTime)) {
      return _couponEndTimeFieldKey;
    }
    return null;
  }

  void _refreshCouponValidationHighlights() {
    _markCouponDraftChanged();
    if (!_couponSubmitAttempted) {
      return;
    }

    setState(() {
      _couponValidationHighlights = _invalidCouponFields();
    });
  }

  void _advanceCouponDraftGeneration({
    bool preserveCouponImageOperation = false,
  }) {
    _couponDraftGeneration += 1;
    if (preserveCouponImageOperation || !couponImageUploading) {
      return;
    }
    _ownerActionGenerations[_OwnerActionKind.couponImage] =
        (_ownerActionGenerations[_OwnerActionKind.couponImage] ?? 0) + 1;
    couponImageUploading = false;
  }

  void _markCouponDraftChanged({bool notify = true}) {
    final wasUploading = couponImageUploading;
    _advanceCouponDraftGeneration();
    if (notify && wasUploading && mounted) {
      setState(() {});
    }
  }

  void _markDailySpecialDraftChanged() {
    _dailySpecialDraftGeneration += 1;
  }

  void _scrollToKey(GlobalKey key, {double alignment = 0.12}) {
    final ownerScope = _activeOwnerScope;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await Future<void>.delayed(const Duration(milliseconds: 320));
      if (!mounted ||
          ownerScope == null ||
          !_isCurrentExactOwnerScope(ownerScope)) {
        return;
      }

      final targetContext = key.currentContext;
      if (targetContext == null || !targetContext.mounted) {
        return;
      }

      await Scrollable.ensureVisible(
        targetContext,
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeOutCubic,
        alignment: alignment,
      );
    });
  }

  void _scrollToFirstInvalidCouponField(
    Set<_CouponValidationField> invalidFields,
  ) {
    final key = _firstInvalidCouponFieldKey(invalidFields);
    if (key != null) {
      _scrollToKey(key, alignment: 0.18);
    }
  }

  String? _couponTitleErrorText() {
    if (!_couponValidationHighlights.contains(_CouponValidationField.title)) {
      return null;
    }
    return 'Coupon title is required.';
  }

  String? _couponStartTimeErrorText() {
    if (!_couponValidationHighlights.contains(
      _CouponValidationField.startTime,
    )) {
      return null;
    }
    return 'Coupon start time is required.';
  }

  String? _couponEndTimeErrorText() {
    if (!_couponValidationHighlights.contains(_CouponValidationField.endTime)) {
      return null;
    }
    return couponEndTime == null
        ? 'Coupon end time is required.'
        : 'End time must be after start time.';
  }

  Coupon _buildDraftCoupon({
    required String restaurantName,
    required String distance,
  }) {
    return Coupon(
      id: editingCouponId ?? '',
      restaurant: restaurantName,
      title: titleController.text.trim(),
      distance: distance,
      startTime: couponStartTime,
      endTime: couponEndTime,
      usageRule: selectedUsageRule,
      couponCode: couponCodeController.text.trim().isEmpty
          ? null
          : couponCodeController.text.trim(),
      isProximityOnly: isProximityCoupon,
      proximityRadiusMiles: isProximityCoupon
          ? proximityRadiusToMiles(selectedProximityRadius)
          : null,
      details: couponDetailsController.text.trim().isEmpty
          ? null
          : couponDetailsController.text.trim(),
      imageUrl: couponImageUrl,
    );
  }

  Future<void> _pickRestaurantImage() async {
    if (profileSaving || _ownerProfileOperation.isInFlight) {
      return;
    }
    if (!_synchronizeCurrentOwnerIdentity()) {
      if (_currentOwnerIdentity == null) {
        _showSnackBar('Please sign in to add a restaurant image.');
      }
      return;
    }
    final ownerIdentity = _activeOwnerIdentity;
    final user = currentUser;
    if (ownerIdentity == null ||
        user == null ||
        user.uid.trim() != ownerIdentity.uid) {
      _showSnackBar('Please sign in to add a restaurant image.');
      return;
    }
    final ownerIdentityGeneration = _ownerIdentityGeneration;
    final operationGeneration = ++_restaurantImageOperationGeneration;

    setState(() {
      restaurantImageUploading = true;
    });

    try {
      final injectedPicker = widget.pickRestaurantImage;
      final pickedImage = injectedPicker != null
          ? await injectedPicker()
          : await BiteSaverImageUploadService.pickRestaurantImage(
              isCurrent: () =>
                  mounted &&
                  _isCurrentOwnerScope(
                    ownerIdentity,
                    ownerIdentityGeneration,
                  ) &&
                  operationGeneration == _restaurantImageOperationGeneration,
            );
      if (!mounted ||
          !_isCurrentOwnerScope(ownerIdentity, ownerIdentityGeneration) ||
          operationGeneration != _restaurantImageOperationGeneration) {
        return;
      }
      if (pickedImage == null) {
        return;
      }

      BiteSaverValidatedRestaurantImage? validatedImage;
      try {
        final validateImage =
            widget.validateRestaurantImage ??
            BiteSaverImageUploadService.validateRestaurantImage;
        validatedImage = await validateImage(pickedImage);
      } catch (_) {
        validatedImage = null;
      }
      if (!mounted ||
          !_isCurrentOwnerScope(ownerIdentity, ownerIdentityGeneration) ||
          operationGeneration != _restaurantImageOperationGeneration) {
        return;
      }
      if (validatedImage == null ||
          !validatedImage.wasValidatedFrom(pickedImage)) {
        _showSnackBar('Please choose a valid PNG or JPEG image.');
        return;
      }

      final selectedImage = _OwnerBoundRestaurantImageSelection(
        ownerIdentity: ownerIdentity,
        ownerIdentityGeneration: ownerIdentityGeneration,
        selectionGeneration: ++_restaurantImageSelectionGeneration,
        validatedImage: validatedImage,
      );
      setState(() {
        _selectedRestaurantImage = selectedImage;
      });

      final uploadImage =
          widget.uploadRestaurantImage ??
          BiteSaverImageUploadService.uploadRestaurantImage;
      final uploadResult = await uploadImage(
        uid: ownerIdentity.uid,
        validatedImage: validatedImage,
      );
      final uploadedUrl = uploadResult.imageUrl;
      if (uploadedUrl.trim().isEmpty) {
        throw StateError('Restaurant image upload returned no URL.');
      }
      if (!mounted ||
          !_isCurrentOwnerScope(ownerIdentity, ownerIdentityGeneration) ||
          operationGeneration != _restaurantImageOperationGeneration ||
          !identical(_selectedRestaurantImage, selectedImage)) {
        return;
      }
      setState(() {
        _selectedRestaurantImage = selectedImage.withUploadedUrl(uploadedUrl);
      });
      _showSnackBar(
        'Restaurant image uploaded. Save Restaurant Image to apply it.',
      );
    } catch (error) {
      if (!mounted ||
          !_isCurrentOwnerScope(ownerIdentity, ownerIdentityGeneration) ||
          operationGeneration != _restaurantImageOperationGeneration) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not upload the restaurant image right now.',
        ),
      );
    } finally {
      if (mounted &&
          _isCurrentOwnerScope(ownerIdentity, ownerIdentityGeneration) &&
          operationGeneration == _restaurantImageOperationGeneration) {
        setState(() {
          restaurantImageUploading = false;
        });
      }
    }
  }

  Future<void> _pickCouponImage() async {
    if (couponImageUploading) {
      return;
    }
    final user = currentUser;
    if (user == null) {
      _showSnackBar('Please sign in to add a coupon image.');
      return;
    }
    final action = _beginOwnerAction(_OwnerActionKind.couponImage);
    if (action == null || action.ownerScope.identity.uid != user.uid.trim()) {
      return;
    }
    final draftGeneration = _couponDraftGeneration;
    final submittedEditingCouponId = editingCouponId?.trim();
    final operation = _CouponImageOperationScope(
      action: action,
      draftGeneration: draftGeneration,
      editingCouponId: submittedEditingCouponId,
    );
    final couponKey = submittedEditingCouponId?.isNotEmpty == true
        ? submittedEditingCouponId!
        : DateTime.now().microsecondsSinceEpoch.toString();
    bool operationIsCurrent() => _isCurrentCouponImageOperation(operation);
    int? installedDraftGeneration;
    String? installedImageUrl;
    bool installedResultIsCurrent() =>
        installedDraftGeneration != null &&
        _isCurrentOwnerAction(action) &&
        installedDraftGeneration == _couponDraftGeneration &&
        editingCouponId?.trim() == submittedEditingCouponId &&
        couponImageUrl == installedImageUrl;

    setState(() {
      couponImageUploading = true;
    });

    try {
      final pickAndUpload =
          widget.pickAndUploadCouponImage ??
          BiteSaverImageUploadService.pickAndUploadCouponImage;
      final result = await pickAndUpload(
        uid: action.ownerScope.identity.uid,
        couponKey: couponKey,
        isCurrent: operationIsCurrent,
      );
      if (result is! BiteSaverCouponImageUploadCompleted) {
        return;
      }
      if (!operationIsCurrent()) {
        return;
      }
      final uploadedUrl = result.imageUrl;
      setState(() {
        _advanceCouponDraftGeneration(preserveCouponImageOperation: true);
        installedDraftGeneration = _couponDraftGeneration;
        installedImageUrl = uploadedUrl;
        couponImageUrl = uploadedUrl;
      });
      if (submittedEditingCouponId?.isNotEmpty == true) {
        final persistImage = widget.persistCouponImage;
        if (persistImage != null) {
          await persistImage(
            uid: action.ownerScope.identity.uid,
            couponId: submittedEditingCouponId!,
            imageUrl: uploadedUrl,
          );
        } else {
          await RestaurantAccountService.couponsCollection(
            action.ownerScope.identity.uid,
          ).doc(submittedEditingCouponId!).set({
            Coupon.fieldImageUrl: uploadedUrl,
            Coupon.fieldUpdatedAt: FieldValue.serverTimestamp(),
          }, SetOptions(merge: true));
        }
        if (!_isCurrentOwnerAction(action) ||
            installedDraftGeneration != _couponDraftGeneration ||
            editingCouponId?.trim() != submittedEditingCouponId ||
            couponImageUrl != uploadedUrl) {
          return;
        }
      }
      _showSnackBar(
        submittedEditingCouponId?.isNotEmpty != true
            ? 'Coupon image added. Save the coupon to keep it.'
            : 'Coupon image saved.',
      );
    } catch (error) {
      if (!operationIsCurrent() && !installedResultIsCurrent()) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not upload the coupon image right now.',
        ),
      );
    } finally {
      if ((operationIsCurrent() || installedResultIsCurrent()) &&
          couponImageUploading) {
        setState(() {
          couponImageUploading = false;
        });
      }
    }
  }

  Future<void> _saveBasicRestaurantInformation() async {
    if (profileSaving || _ownerProfileOperation.isInFlight) {
      return;
    }
    final user = currentUser;
    if (user == null) {
      _showSnackBar('Please sign in to continue.');
      return;
    }

    FocusScope.of(context).unfocus();
    final profileError = _validateBasicInformationInput();
    if (profileError != null) {
      _showSnackBar(profileError);
      return;
    }

    final city = cityController.text.trim();
    final state = stateController.text.trim();
    final zipCode = zipCodeController.text.trim();
    final phone = phoneController.text.trim();
    final streetAddress = streetAddressController.text.trim();
    final website = websiteController.text.trim();
    final bio = bioController.text.trim();
    final submittedTextValues = <TextEditingController, String>{
      cityController: cityController.text,
      stateController: stateController.text,
      zipCodeController: zipCodeController.text,
      phoneController: phoneController.text,
      streetAddressController: streetAddressController.text,
      websiteController: websiteController.text,
      bioController: bioController.text,
    };
    final request = BiteSaverProfileSaveRequest.ownerBasicInformationUpdate(
      profile: _basicInformationProfileInput(),
      expectedProfileVersion: _profileVersion,
      expectedLocationVersion: _locationVersion,
    );

    await _executeOwnerSectionSave(
      user: user,
      request: request,
      successMessage: 'Restaurant profile saved.',
      reconcile: (authoritativeRestaurant) {
        final authoritativeTextValues = <TextEditingController, String>{
          cityController:
              authoritativeRestaurant?.city ??
              submittedTextValues[cityController]!,
          stateController:
              authoritativeRestaurant?.state ??
              submittedTextValues[stateController]!,
          zipCodeController:
              authoritativeRestaurant?.zipCode ??
              submittedTextValues[zipCodeController]!,
          phoneController: authoritativeRestaurant == null
              ? submittedTextValues[phoneController]!
              : formatPhoneNumberForDisplay(
                  authoritativeRestaurant.phone ?? '',
                ),
          streetAddressController:
              authoritativeRestaurant?.streetAddress ??
              submittedTextValues[streetAddressController]!,
          websiteController: authoritativeRestaurant == null
              ? submittedTextValues[websiteController]!
              : authoritativeRestaurant.website ?? '',
          bioController: authoritativeRestaurant == null
              ? submittedTextValues[bioController]!
              : authoritativeRestaurant.bio ?? '',
        };
        for (final entry in authoritativeTextValues.entries) {
          if (entry.key.text == submittedTextValues[entry.key]) {
            entry.key.text = entry.value;
          }
          _initialProfileTextValues[entry.key] = entry.value;
        }

        final localProfile = LocalRestaurantProfileStore.profile.value;
        LocalRestaurantProfileStore.updateProfile(
          localProfile.copyWith(
            city: authoritativeRestaurant?.city ?? city,
            state: authoritativeRestaurant?.state ?? state,
            zipCode: authoritativeRestaurant?.zipCode ?? zipCode,
            phone: authoritativeRestaurant?.phone ?? phone,
            streetAddress:
                authoritativeRestaurant?.streetAddress ?? streetAddress,
            website: authoritativeRestaurant == null
                ? website
                : authoritativeRestaurant.website ?? '',
            bio: authoritativeRestaurant == null
                ? bio
                : authoritativeRestaurant.bio ?? '',
            latitude:
                authoritativeRestaurant?.latitude?.toString() ??
                localProfile.latitude,
            longitude:
                authoritativeRestaurant?.longitude?.toString() ??
                localProfile.longitude,
          ),
        );
      },
    );
  }

  Future<void> _saveBusinessHours() async {
    if (profileSaving || _ownerProfileOperation.isInFlight) {
      return;
    }
    final user = currentUser;
    if (user == null) {
      _showSnackBar('Please sign in to continue.');
      return;
    }

    FocusScope.of(context).unfocus();
    final submittedBusinessHours = [
      for (final entry in businessHours) entry.copyWith(),
    ];
    final persistedBusinessHours = _hoursForPersistence();
    final request = BiteSaverProfileSaveRequest.ownerBusinessHoursUpdate(
      profile: BiteSaverBusinessHoursProfileInput(
        businessHours: persistedBusinessHours,
      ),
      expectedProfileVersion: _profileVersion,
      expectedLocationVersion: _locationVersion,
    );

    await _executeOwnerSectionSave(
      user: user,
      request: request,
      successMessage: 'Restaurant hours saved.',
      reconcile: (authoritativeRestaurant) {
        final authoritativePersistedHours =
            authoritativeRestaurant?.businessHours ?? persistedBusinessHours;
        final authoritativeEditingHours = _hoursForEditing(
          authoritativePersistedHours,
        );
        if (_businessHoursMatch(submittedBusinessHours)) {
          businessHours = [
            for (final entry in authoritativeEditingHours) entry.copyWith(),
          ];
          _businessHoursDirty = authoritativePersistedHours.isNotEmpty;
        }
        _initialProfileBusinessHours = [
          for (final entry in authoritativeEditingHours) entry.copyWith(),
        ];
        LocalRestaurantProfileStore.updateProfile(
          LocalRestaurantProfileStore.profile.value.copyWith(
            businessHours: authoritativePersistedHours,
          ),
        );
      },
    );
  }

  Future<void> _saveRestaurantImage() async {
    if (profileSaving || _ownerProfileOperation.isInFlight) {
      return;
    }
    if (restaurantImageUploading) {
      _showSnackBar('Wait for the restaurant image upload to finish.');
      return;
    }
    if (!_synchronizeCurrentOwnerIdentity()) {
      if (_currentOwnerIdentity == null) {
        _showSnackBar('Please sign in to continue.');
      }
      return;
    }
    final ownerIdentity = _activeOwnerIdentity;
    final user = currentUser;
    if (ownerIdentity == null ||
        user == null ||
        user.uid.trim() != ownerIdentity.uid) {
      _showSnackBar('Please sign in to continue.');
      return;
    }
    final ownerIdentityGeneration = _ownerIdentityGeneration;

    final submittedSelectedImage = _selectedRestaurantImage;
    if (submittedSelectedImage == null) {
      _showSnackBar('Choose and upload a restaurant image before saving.');
      return;
    }
    final submittedSelectionUploadUrl = submittedSelectedImage.uploadedUrl;
    if (submittedSelectedImage.ownerIdentity != ownerIdentity ||
        submittedSelectedImage.ownerIdentityGeneration !=
            ownerIdentityGeneration ||
        submittedSelectedImage.selectionGeneration !=
            _restaurantImageSelectionGeneration ||
        submittedSelectionUploadUrl == null ||
        submittedSelectionUploadUrl.trim().isEmpty) {
      _showSnackBar(
        'The selected restaurant image was not uploaded. Choose it again before saving.',
      );
      return;
    }
    if (!_isTrustedProfileScope(ownerIdentity, ownerIdentityGeneration)) {
      _showSnackBar('Your restaurant account changed. Reload and try again.');
      return;
    }

    final submittedImageUrl = submittedSelectionUploadUrl;
    final imageSaveGeneration = ++_restaurantImageSaveGeneration;
    final request = BiteSaverProfileSaveRequest.ownerMainImageUpdate(
      profile: BiteSaverMainImageProfileInput(mainImageUrl: submittedImageUrl),
      expectedProfileVersion: _profileVersion,
      expectedLocationVersion: _locationVersion,
    );

    await _executeOwnerSectionSave(
      user: user,
      request: request,
      successMessage: 'Restaurant image saved.',
      continuationGuard: () =>
          imageSaveGeneration == _restaurantImageSaveGeneration &&
          identical(_selectedRestaurantImage, submittedSelectedImage) &&
          submittedSelectedImage.selectionGeneration ==
              _restaurantImageSelectionGeneration &&
          submittedSelectedImage.uploadedUrl == submittedImageUrl,
      reconcile: (authoritativeRestaurant) {
        final authoritativeImageUrl =
            authoritativeRestaurant?.mainImageUrl ?? submittedImageUrl;
        restaurantImageUrl = authoritativeImageUrl;
        if (identical(_selectedRestaurantImage, submittedSelectedImage)) {
          _selectedRestaurantImage = null;
        }
        _initialRestaurantImageUrl = authoritativeImageUrl;
        LocalRestaurantProfileStore.updateProfile(
          LocalRestaurantProfileStore.profile.value.copyWith(
            mainImageUrl: authoritativeImageUrl,
          ),
        );
      },
    );
  }

  Future<void> _executeOwnerSectionSave({
    required User user,
    required BiteSaverProfileSaveRequest request,
    required String successMessage,
    required void Function(Restaurant? authoritativeRestaurant) reconcile,
    bool Function()? continuationGuard,
  }) async {
    if (!_synchronizeCurrentOwnerIdentity()) {
      return;
    }
    final ownerIdentity = _activeOwnerIdentity;
    final ownerIdentityGeneration = _ownerIdentityGeneration;
    if (ownerIdentity == null ||
        user.uid.trim() != ownerIdentity.uid ||
        !_isCurrentOwnerScope(ownerIdentity, ownerIdentityGeneration) ||
        !_isTrustedProfileScope(ownerIdentity, ownerIdentityGeneration) ||
        !(continuationGuard?.call() ?? true)) {
      _showSnackBar('Your restaurant account changed. Reload and try again.');
      return;
    }

    final operationGeneration = ++_ownerSaveGeneration;
    final ownerScope = _RestaurantOwnerScope(
      identity: ownerIdentity,
      ownerGeneration: ownerIdentityGeneration,
    );
    final ownerProfileOperation = _ownerProfileOperation;
    final previousLocationVersion = _locationVersion;
    bool ownerOperationIsCurrent() =>
        mounted &&
        operationGeneration == _ownerSaveGeneration &&
        _isCurrentOwnerScope(ownerIdentity, ownerIdentityGeneration);
    bool canContinue() =>
        ownerOperationIsCurrent() &&
        _isTrustedProfileScope(ownerIdentity, ownerIdentityGeneration) &&
        (continuationGuard?.call() ?? true);
    setState(() {
      profileSaving = true;
    });

    try {
      if (!canContinue()) {
        return;
      }
      final result = await ownerProfileOperation.execute(
        request: request,
        logicalTarget: ownerScope.logicalTarget(operation: 'ownerProfile'),
        invoke: (requestId) async {
          final result = await _lifecycleService.save(
            request,
            requestId: requestId,
          );
          if (result.documentId.trim() != ownerIdentity.accountDocumentId) {
            throw const BiteSaverLifecycleException(
              kind: BiteSaverLifecycleFailureKind.staleProfile,
              code: 'failed-precondition',
              message: 'Your restaurant account changed. Reload and try again.',
            );
          }
          return result;
        },
      );
      if (!canContinue()) {
        return;
      }
      if (result.documentId.trim() != ownerIdentity.accountDocumentId) {
        _showSnackBar('Your restaurant account changed. Reload and try again.');
        return;
      }

      Map<String, dynamic>? refreshedData;
      try {
        refreshedData = await _loadRestaurantAccount(ownerIdentity.uid);
      } catch (_) {
        // The callable write is already confirmed. A later refresh can
        // repopulate authoritative section data if this read is unavailable.
      }
      if (!canContinue()) {
        return;
      }
      final refreshedRestaurant = _restaurantFromAccountData(
        ownerIdentity.accountDocumentId,
        refreshedData,
      );
      final authoritativeRestaurant =
          refreshedRestaurant != null &&
              refreshedRestaurant.profileVersion >= result.profileVersion
          ? refreshedRestaurant
          : null;
      if (!canContinue()) {
        return;
      }
      if (authoritativeRestaurant != null) {
        _recordTrustedProfileState(
          authoritativeRestaurant,
          ownerIdentity: ownerIdentity,
          ownerIdentityGeneration: ownerIdentityGeneration,
        );
      }
      if (result.profileVersion > _profileVersion) {
        _profileVersion = result.profileVersion;
      }
      final resultLocationVersion = result.locationVersion;
      if (resultLocationVersion != null &&
          resultLocationVersion > _locationVersion) {
        _locationVersion = resultLocationVersion;
      }
      if (authoritativeRestaurant == null &&
          resultLocationVersion != null &&
          resultLocationVersion != previousLocationVersion) {
        _hasTrustedSearchableLocation = false;
      }

      reconcile(authoritativeRestaurant);
      if (!ownerOperationIsCurrent()) {
        return;
      }
      _showSnackBar(successMessage);
      setState(() {});
    } on BiteSaverLifecycleException catch (error) {
      if (!canContinue()) {
        return;
      }
      _showSnackBar(error.message);
    } catch (error) {
      if (!canContinue()) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not save the restaurant profile right now.',
        ),
      );
    } finally {
      if (mounted &&
          operationGeneration == _ownerSaveGeneration &&
          _isCurrentOwnerScope(ownerIdentity, ownerIdentityGeneration)) {
        setState(() {
          profileSaving = false;
        });
      }
    }
  }

  Future<bool> _ensureRestaurantAddressReadyForPosting(
    User user, {
    _RestaurantOwnerScope? expectedOwnerScope,
  }) async {
    final ownerScope = _activeOwnerScope;
    if (ownerScope == null ||
        (expectedOwnerScope != null && ownerScope != expectedOwnerScope) ||
        ownerScope.identity.uid != user.uid ||
        !_isCurrentExactOwnerScope(ownerScope)) {
      return false;
    }
    final ownerIdentity = ownerScope.identity;
    final ownerIdentityGeneration = ownerScope.ownerGeneration;
    final streetAddress = streetAddressController.text.trim();
    final city = cityController.text.trim();
    final state = stateController.text.trim();
    final zipCode = zipCodeController.text.trim();

    if (streetAddress.isEmpty ||
        city.isEmpty ||
        state.isEmpty ||
        zipCode.isEmpty) {
      _showSnackBar(
        'Please complete your restaurant address before posting coupons or daily specials.',
      );
      return false;
    }

    try {
      final data = await _loadRestaurantAccount(ownerIdentity.uid);
      if (!mounted ||
          !_isCurrentOwnerScope(ownerIdentity, ownerIdentityGeneration)) {
        return false;
      }
      final restaurant = _restaurantFromAccountData(
        ownerIdentity.accountDocumentId,
        data,
      );
      if (restaurant == null) {
        _clearTrustedProfileState();
      } else {
        _recordTrustedProfileState(
          restaurant,
          ownerIdentity: ownerIdentity,
          ownerIdentityGeneration: ownerIdentityGeneration,
        );
      }
      final addressMatchesSavedProfile =
          restaurant != null &&
          restaurant.matchesStructuredAddress(
            streetAddress: streetAddress,
            city: city,
            state: state,
            zipCode: zipCode,
          );

      if (addressMatchesSavedProfile &&
          _hasTrustedSearchableLocation &&
          !_hasUnsavedRestaurantProfileChanges) {
        return true;
      }

      if (mounted) {
        setState(() {
          _basicInfoSectionExpanded = true;
        });
      }
      _showSnackBar(
        addressMatchesSavedProfile && !_hasUnsavedRestaurantProfileChanges
            ? 'Save the restaurant profile to validate its address before posting.'
            : 'Your restaurant profile has unsaved changes. Save and validate it before posting.',
      );
      return false;
    } catch (_) {
      if (!mounted ||
          !_isCurrentOwnerScope(ownerIdentity, ownerIdentityGeneration)) {
        return false;
      }
      _showSnackBar(
        'Could not verify the saved restaurant location. Refresh and try again.',
      );
      return false;
    }
  }

  Future<void> createOrUpdateCoupon() async {
    if (couponSaving) {
      return;
    }
    final user = currentUser;
    if (user == null) {
      _showSnackBar('Please sign in to continue.');
      return;
    }
    final action = _beginOwnerAction(_OwnerActionKind.couponSave);
    if (action == null || action.ownerScope.identity.uid != user.uid.trim()) {
      return;
    }
    final draftGeneration = _couponDraftGeneration;
    final submittedEditingCouponId = editingCouponId?.trim();
    final capturedAuthEmail = user.email?.trim() ?? '';

    setState(() {
      couponSaving = true;
    });

    try {
      final accountData = await _loadRestaurantAccount(
        action.ownerScope.identity.uid,
      );
      if (!_isCurrentOwnerAction(action) ||
          draftGeneration != _couponDraftGeneration ||
          editingCouponId?.trim() != submittedEditingCouponId) {
        return;
      }
      final canPostCoupons = RestaurantAccountService.hasCouponPostingAccess(
        accountData,
      );
      if (!canPostCoupons) {
        await _openPaywallScreen(action.ownerScope);
        if (!_isCurrentOwnerAction(action)) {
          return;
        }
        return;
      }

      final addressReady = await _ensureRestaurantAddressReadyForPosting(
        user,
        expectedOwnerScope: action.ownerScope,
      );
      if (!_isCurrentOwnerAction(action) ||
          draftGeneration != _couponDraftGeneration ||
          editingCouponId?.trim() != submittedEditingCouponId ||
          !addressReady) {
        return;
      }

      final invalidCouponFields = _invalidCouponFields();
      if (invalidCouponFields.isNotEmpty) {
        setState(() {
          _couponSubmitAttempted = true;
          _couponValidationHighlights = invalidCouponFields;
          _couponManagementSectionExpanded = true;
        });
        _scrollToFirstInvalidCouponField(invalidCouponFields);
        _showSnackBar(_couponValidationMessage(invalidCouponFields));
        return;
      }

      final authoritativeRestaurant = _restaurantFromAccountData(
        action.ownerScope.identity.accountDocumentId,
        accountData,
      );
      final restaurantName = authoritativeRestaurant?.name.trim() ?? '';
      final authoritativeDistance =
          authoritativeRestaurant?.distance.trim() ?? '';
      final restaurantDistance = authoritativeDistance.isEmpty
          ? '0.8 miles away'
          : authoritativeDistance;
      final accountEmail =
          (accountData?[Restaurant.fieldEmail] as String?)?.trim() ?? '';
      final restaurantEmail = accountEmail.isEmpty
          ? capturedAuthEmail
          : accountEmail;
      final draftCoupon = _buildDraftCoupon(
        restaurantName: restaurantName,
        distance: restaurantDistance,
      );
      final couponError = _validateCouponInput(draftCoupon);
      if (couponError != null) {
        setState(() {
          _couponSubmitAttempted = true;
        });
        _showSnackBar(couponError);
        return;
      }

      final wasEditingCoupon = submittedEditingCouponId?.isNotEmpty == true;
      final saveCoupon = wasEditingCoupon
          ? widget.updateCoupon
          : widget.createCoupon;
      final savedCoupon = saveCoupon != null
          ? await saveCoupon(
              uid: action.ownerScope.identity.uid,
              coupon: draftCoupon,
            )
          : wasEditingCoupon
          ? await RestaurantAccountService.updateCoupon(
              uid: action.ownerScope.identity.uid,
              coupon: draftCoupon,
            )
          : await RestaurantAccountService.saveCoupon(
              uid: action.ownerScope.identity.uid,
              coupon: draftCoupon,
            );

      if (!_isCurrentOwnerAction(action) ||
          draftGeneration != _couponDraftGeneration ||
          editingCouponId?.trim() != submittedEditingCouponId) {
        return;
      }
      LocalCouponStore.upsertCoupon(savedCoupon);

      final title = draftCoupon.title;
      final couponCode = draftCoupon.couponCode ?? '';
      final couponDetails = draftCoupon.details ?? '';
      final usageRule = draftCoupon.usageRule;
      final isProximityOnly = draftCoupon.isProximityOnly;
      final proximityRadius = selectedProximityRadius;
      if (!mounted) {
        return;
      }
      unawaited(
        _showOwnerScopedDialog<void>(
          expectedOwnerScope: action.ownerScope,
          builder: (context) {
            final summary = StringBuffer()
              ..writeln('Restaurant: $restaurantName')
              ..writeln('Email: $restaurantEmail')
              ..writeln('Title: $title')
              ..writeln(savedCoupon.shortExpiresLabel)
              ..writeln('Usage: $usageRule')
              ..writeln(
                'Type: ${isProximityOnly ? 'Proximity-only coupon' : 'Normal coupon'}',
              );

            if (isProximityOnly) {
              summary.writeln('Visible within: $proximityRadius');
            }
            if (couponCode.isNotEmpty) {
              summary.writeln('Code: $couponCode');
            }
            if (couponDetails.isNotEmpty) {
              summary.writeln('Details: $couponDetails');
            }

            return AlertDialog(
              title: Text(
                wasEditingCoupon ? 'Coupon Updated' : 'Coupon Created',
              ),
              content: Text(summary.toString().trim()),
              actions: [
                TextButton(
                  onPressed: () {
                    Navigator.pop(context);
                    if (_isCurrentOwnerAction(action) &&
                        draftGeneration == _couponDraftGeneration &&
                        editingCouponId?.trim() == submittedEditingCouponId) {
                      clearCouponForm();
                    }
                  },
                  child: const Text('OK'),
                ),
              ],
            );
          },
        ),
      );
    } catch (error) {
      if (!_isCurrentOwnerAction(action) ||
          draftGeneration != _couponDraftGeneration) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not save the coupon right now.',
        ),
      );
    } finally {
      if (_isCurrentOwnerAction(action)) {
        setState(() {
          couponSaving = false;
        });
      }
    }
  }

  Future<bool> _refreshDailySpecials({
    required _RestaurantOwnerScope expectedOwnerScope,
    _OwnerActionScope? expectedAction,
  }) async {
    if (!mounted ||
        !_isCurrentExactOwnerScope(expectedOwnerScope) ||
        (expectedAction != null && !_isCurrentOwnerAction(expectedAction))) {
      return false;
    }

    final specials = await _loadRestaurantDailySpecials(
      expectedOwnerScope.identity.uid,
    );
    if (!mounted ||
        !_isCurrentExactOwnerScope(expectedOwnerScope) ||
        (expectedAction != null && !_isCurrentOwnerAction(expectedAction))) {
      return false;
    }

    setState(() {
      _dailySpecials = specials;
    });
    return true;
  }

  DailySpecial _buildDraftDailySpecial({required String uid}) {
    return DailySpecial(
      id: editingDailySpecialId ?? '',
      restaurantId: uid,
      ownerUid: uid,
      title: dailySpecialTitleController.text.trim(),
      details: dailySpecialDetailsController.text.trim().isEmpty
          ? null
          : dailySpecialDetailsController.text.trim(),
      isActive: _dailySpecialIsActive,
      availabilityMode: _dailySpecialAvailabilityMode,
      daysOfWeek: _dailySpecialDaysOfWeek.toList(),
      allDay: _dailySpecialAllDay,
      startTime: _dailySpecialAllDay
          ? null
          : _formatSpecialTimeForFirestore(_dailySpecialStartTime),
      endTime: _dailySpecialAllDay
          ? null
          : _formatSpecialTimeForFirestore(_dailySpecialEndTime),
      hideWhenUnavailable: _dailySpecialHideWhenUnavailable,
    );
  }

  Future<void> createOrUpdateDailySpecial() async {
    if (!mounted || _dailySpecialSaveInFlight) {
      return;
    }
    final user = currentUser;
    if (user == null) {
      _showSnackBar('Please sign in to continue.');
      return;
    }
    final action = _beginOwnerAction(_OwnerActionKind.dailySpecialSave);
    if (action == null || action.ownerScope.identity.uid != user.uid.trim()) {
      return;
    }
    final draftGeneration = _dailySpecialDraftGeneration;
    final submittedEditingId = editingDailySpecialId?.trim();

    if (!_hasCouponPostingAccess) {
      await _openPaywallScreen(action.ownerScope);
      if (!_isCurrentOwnerAction(action)) {
        return;
      }
      return;
    }

    _dailySpecialSaveInFlight = true;

    try {
      final addressReady = await _ensureRestaurantAddressReadyForPosting(
        user,
        expectedOwnerScope: action.ownerScope,
      );
      if (!_isCurrentOwnerAction(action) ||
          draftGeneration != _dailySpecialDraftGeneration ||
          editingDailySpecialId?.trim() != submittedEditingId ||
          !addressReady) {
        return;
      }
      if (!mounted) {
        return;
      }

      FocusScope.of(context).unfocus();

      final wasEditing = submittedEditingId?.isNotEmpty == true;
      final draftSpecial = _buildDraftDailySpecial(
        uid: action.ownerScope.identity.uid,
      );
      final validationError = draftSpecial.validateForSave();
      if (validationError != null) {
        _showSnackBar(validationError);
        return;
      }

      setState(() {
        _dailySpecialSaving = true;
      });

      if (wasEditing) {
        final updateDailySpecial = widget.updateDailySpecial;
        if (updateDailySpecial != null) {
          await updateDailySpecial(
            uid: action.ownerScope.identity.uid,
            dailySpecial: draftSpecial,
          );
        } else {
          await RestaurantAccountService.updateDailySpecial(
            uid: action.ownerScope.identity.uid,
            dailySpecial: draftSpecial,
          );
        }
      } else {
        final createDailySpecial = widget.createDailySpecial;
        if (createDailySpecial != null) {
          await createDailySpecial(
            uid: action.ownerScope.identity.uid,
            dailySpecial: draftSpecial,
          );
        } else {
          await RestaurantAccountService.createDailySpecial(
            uid: action.ownerScope.identity.uid,
            dailySpecial: draftSpecial,
          );
        }
      }

      if (!_isCurrentOwnerAction(action) ||
          draftGeneration != _dailySpecialDraftGeneration ||
          editingDailySpecialId?.trim() != submittedEditingId) {
        return;
      }
      final refreshed = await _refreshDailySpecials(
        expectedOwnerScope: action.ownerScope,
        expectedAction: action,
      );
      if (!refreshed ||
          !_isCurrentOwnerAction(action) ||
          draftGeneration != _dailySpecialDraftGeneration ||
          editingDailySpecialId?.trim() != submittedEditingId) {
        return;
      }
      clearDailySpecialForm();
      _showSnackBar(
        wasEditing ? 'Daily special updated.' : 'Daily special created.',
      );
    } catch (error) {
      if (!_isCurrentOwnerAction(action) ||
          draftGeneration != _dailySpecialDraftGeneration) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not save the daily special right now.',
        ),
      );
    } finally {
      if (_isCurrentOwnerAction(action)) {
        setState(() {
          _dailySpecialSaveInFlight = false;
          _dailySpecialSaving = false;
        });
      }
    }
  }

  void editDailySpecial(
    DailySpecial special, {
    required _RestaurantOwnerScope expectedOwnerScope,
  }) {
    if (!mounted || !_isCurrentExactOwnerScope(expectedOwnerScope)) {
      return;
    }
    setState(() {
      _dailySpecialDraftGeneration += 1;
      editingDailySpecialId = special.id;
      dailySpecialTitleController.text = special.title;
      dailySpecialDetailsController.text = special.details ?? '';
      _dailySpecialIsActive = special.isActive;
      _dailySpecialAvailabilityMode = special.availabilityMode;
      _dailySpecialDaysOfWeek
        ..clear()
        ..addAll(special.daysOfWeek);
      _dailySpecialAllDay = special.allDay;
      _dailySpecialStartTime = _timeOfDayFromSpecialTime(special.startTime);
      _dailySpecialEndTime = _timeOfDayFromSpecialTime(special.endTime);
      _dailySpecialHideWhenUnavailable = special.hideWhenUnavailable;
      _dailySpecialsSectionExpanded = true;
    });
    _scrollToKey(_dailySpecialEditorKey);
  }

  void clearDailySpecialForm() {
    setState(() {
      _dailySpecialDraftGeneration += 1;
      _resetDailySpecialDraftState();
    });
  }

  Future<void> removeDailySpecial(
    DailySpecial special, {
    _RestaurantOwnerScope? renderedOwnerScope,
  }) async {
    if (_dailySpecialDeleteInFlight) {
      return;
    }
    final user = currentUser;
    if (user == null) {
      return;
    }
    final action = _beginOwnerAction(
      _OwnerActionKind.dailySpecialDelete,
      expectedOwnerScope: renderedOwnerScope,
    );
    if (action == null || action.ownerScope.identity.uid != user.uid.trim()) {
      return;
    }
    final submittedSpecialId = special.id.trim();
    final draftGeneration = _dailySpecialDraftGeneration;

    final shouldDelete = await _showOwnerScopedDialog<bool>(
      expectedOwnerScope: action.ownerScope,
      builder: (context) => AlertDialog(
        title: const Text('Delete Daily Special?'),
        content: Text('Remove "${special.title}" from your daily specials?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (shouldDelete != true ||
        !_isCurrentOwnerAction(action) ||
        draftGeneration != _dailySpecialDraftGeneration) {
      return;
    }

    setState(() {
      _dailySpecialDeleteInFlight = true;
    });
    try {
      final deleteDailySpecial = widget.deleteDailySpecial;
      if (deleteDailySpecial != null) {
        await deleteDailySpecial(
          uid: action.ownerScope.identity.uid,
          dailySpecialId: submittedSpecialId,
        );
      } else {
        await RestaurantAccountService.deleteDailySpecial(
          uid: action.ownerScope.identity.uid,
          dailySpecialId: submittedSpecialId,
        );
      }
      if (!_isCurrentOwnerAction(action) ||
          draftGeneration != _dailySpecialDraftGeneration) {
        return;
      }
      if (editingDailySpecialId?.trim() == submittedSpecialId) {
        clearDailySpecialForm();
      }
      final refreshed = await _refreshDailySpecials(
        expectedOwnerScope: action.ownerScope,
        expectedAction: action,
      );
      if (!refreshed || !_isCurrentOwnerAction(action)) {
        return;
      }
      _showSnackBar('Daily special removed.');
    } catch (error) {
      if (!_isCurrentOwnerAction(action)) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not remove the daily special right now.',
        ),
      );
    } finally {
      if (_isCurrentOwnerAction(action)) {
        setState(() {
          _dailySpecialDeleteInFlight = false;
        });
      }
    }
  }

  Future<void> _signOutAndExitRestaurantHub(
    _RestaurantOwnerScope expectedOwnerScope,
  ) async {
    if (_signOutInFlight) {
      return;
    }
    if (!_isCurrentExactOwnerScope(expectedOwnerScope)) {
      return;
    }
    final ownerScope = expectedOwnerScope;
    final signOutOperationGeneration = ++_signOutOperationGeneration;
    final shouldLeave = await _confirmLeaveRestaurantProfileChanges(ownerScope);
    if (!mounted ||
        !shouldLeave ||
        signOutOperationGeneration != _signOutOperationGeneration ||
        !_isCurrentExactOwnerScope(ownerScope)) {
      return;
    }

    setState(() {
      _signOutInFlight = true;
    });
    _transitionOwnerIdentityIfNeeded(
      null,
      reload: false,
      preserveSignOutOperation: true,
    );
    try {
      final signOut =
          widget.signOutRestaurantSession ??
          CustomerSessionService.signOutToSignedOut;
      await signOut();
      if (!mounted ||
          signOutOperationGeneration != _signOutOperationGeneration ||
          _currentOwnerIdentity != null) {
        return;
      }

      _allowProfileClose = true;
      final navigator = Navigator.of(context);
      if (navigator.canPop()) {
        navigator.pop();
      }
    } catch (error) {
      if (!mounted ||
          signOutOperationGeneration != _signOutOperationGeneration) {
        return;
      }
      final currentIdentity = _currentOwnerIdentity;
      if (currentIdentity == ownerScope.identity) {
        _transitionOwnerIdentityIfNeeded(currentIdentity);
        _showSnackBar(
          AppErrorText.friendly(
            error,
            fallback: 'Could not sign out right now.',
          ),
        );
      }
    } finally {
      if (mounted &&
          signOutOperationGeneration == _signOutOperationGeneration &&
          _activeOwnerIdentity == ownerScope.identity) {
        setState(() {
          _signOutInFlight = false;
        });
      }
    }
  }

  void editCoupon(
    Coupon coupon, {
    required _RestaurantOwnerScope expectedOwnerScope,
  }) {
    if (!mounted || !_isCurrentExactOwnerScope(expectedOwnerScope)) {
      return;
    }
    setState(() {
      _advanceCouponDraftGeneration();
      editingCouponId = coupon.id;
      titleController.text = coupon.title;
      couponCodeController.text = coupon.couponCode ?? '';
      couponDetailsController.text = coupon.details ?? '';
      couponStartTime = coupon.startTime;
      couponEndTime = coupon.endTime;
      selectedUsageRule = coupon.usageRule;
      couponImageUrl = coupon.imageUrl;
      selectedCouponType = coupon.isProximityOnly
          ? 'Proximity-only coupon'
          : 'Normal coupon';
      selectedProximityRadius =
          coupon.isProximityOnly && coupon.proximityRadiusMiles != null
          ? '${coupon.proximityRadiusMiles!.toStringAsFixed(0)} ${coupon.proximityRadiusMiles == 1 ? 'mile' : 'miles'}'
          : '1 mile';
      _couponSubmitAttempted = false;
      _couponValidationHighlights = <_CouponValidationField>{};
      _couponManagementSectionExpanded = true;
    });
    _scrollToKey(_couponEditorKey);
  }

  void clearCouponForm() {
    setState(() {
      _advanceCouponDraftGeneration();
      _resetCouponDraftState();
    });
  }

  Future<void> removeCoupon(
    Coupon coupon, {
    _RestaurantOwnerScope? renderedOwnerScope,
  }) async {
    if (_couponDeleteInFlight) {
      return;
    }
    final user = currentUser;
    if (user == null) {
      return;
    }
    final action = _beginOwnerAction(
      _OwnerActionKind.couponDelete,
      expectedOwnerScope: renderedOwnerScope,
    );
    if (action == null || action.ownerScope.identity.uid != user.uid.trim()) {
      return;
    }
    final submittedCouponId = coupon.id.trim();
    final draftGeneration = _couponDraftGeneration;

    setState(() {
      _couponDeleteInFlight = true;
    });
    try {
      final deleteCoupon = widget.deleteCoupon;
      if (deleteCoupon != null) {
        await deleteCoupon(
          uid: action.ownerScope.identity.uid,
          couponId: submittedCouponId,
        );
      } else {
        await RestaurantAccountService.deleteCoupon(
          uid: action.ownerScope.identity.uid,
          couponId: submittedCouponId,
        );
      }
      if (!_isCurrentOwnerAction(action) ||
          draftGeneration != _couponDraftGeneration) {
        return;
      }
      LocalCouponStore.removeCoupon(submittedCouponId);
      if (editingCouponId?.trim() == submittedCouponId) {
        clearCouponForm();
      }
      _showSnackBar('Coupon removed.');
    } catch (error) {
      if (!_isCurrentOwnerAction(action)) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not remove the coupon right now.',
        ),
      );
    } finally {
      if (_isCurrentOwnerAction(action)) {
        setState(() {
          _couponDeleteInFlight = false;
        });
      }
    }
  }

  void _updateBusinessHoursEntry(
    int dayIndex,
    RestaurantBusinessHours updatedEntry,
    _RestaurantOwnerScope expectedOwnerScope,
  ) {
    if (!mounted || !_isCurrentExactOwnerScope(expectedOwnerScope)) {
      return;
    }
    setState(() {
      _businessHoursDirty = true;
      businessHours = [
        for (var index = 0; index < businessHours.length; index += 1)
          index == dayIndex ? updatedEntry : businessHours[index],
      ];
    });
  }

  void _setBusinessDayClosed(
    int dayIndex,
    bool closed,
    _RestaurantOwnerScope expectedOwnerScope,
  ) {
    if (!_isCurrentExactOwnerScope(expectedOwnerScope)) {
      return;
    }
    _updateBusinessHoursEntry(
      dayIndex,
      businessHours[dayIndex].copyWith(closed: closed),
      expectedOwnerScope,
    );
  }

  void _copyPreviousBusinessDayHours(
    int dayIndex,
    bool shouldCopy,
    _RestaurantOwnerScope expectedOwnerScope,
  ) {
    if (!mounted || !_isCurrentExactOwnerScope(expectedOwnerScope)) {
      return;
    }
    final day = Restaurant.businessDayNames[dayIndex];
    final previousDayIndex =
        (dayIndex - 1 + businessHours.length) % businessHours.length;
    setState(() {
      _businessHoursDirty = true;
      copyPreviousDay[day] = shouldCopy;
      if (shouldCopy) {
        final previousEntry = businessHours[previousDayIndex];
        businessHours = [
          for (var index = 0; index < businessHours.length; index += 1)
            index == dayIndex
                ? businessHours[index].copyWith(
                    opensAt: previousEntry.opensAt,
                    closesAt: previousEntry.closesAt,
                    closed: previousEntry.closed,
                  )
                : businessHours[index],
        ];
      }
    });
  }

  Widget _buildBusinessHoursEditor(_RestaurantOwnerScope expectedOwnerScope) {
    return Card(
      margin: const EdgeInsets.only(top: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Hours',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                ),
                TextButton(
                  onPressed: () {
                    if (!_isCurrentExactOwnerScope(expectedOwnerScope)) {
                      return;
                    }
                    setState(() {
                      _hoursExpanded = !_hoursExpanded;
                    });
                  },
                  child: Text(_hoursExpanded ? 'Collapse' : 'Edit Hours'),
                ),
              ],
            ),
            const SizedBox(height: 6),
            if (_hoursExpanded) ...[
              const Text(
                'Set your weekly business hours. Use copy previous day to fill repeat schedules quickly.',
                style: TextStyle(fontSize: 12, color: Colors.black54),
              ),
              const SizedBox(height: 12),
              ...List.generate(
                businessHours.length,
                (index) => _buildBusinessDayRow(index, expectedOwnerScope),
              ),
            ] else
              Text(
                _hoursSummaryText(),
                style: const TextStyle(fontSize: 13, color: Colors.black87),
              ),
          ],
        ),
      ),
    );
  }

  String _hoursSummaryText() {
    final persistedHours = _hoursForPersistence();
    if (persistedHours.isEmpty) {
      return 'Hours not set';
    }

    final normalized = RestaurantBusinessHours.normalizedWeek(persistedHours);
    final segments = <String>[];
    var index = 0;

    while (index < normalized.length) {
      final current = normalized[index];
      var end = index;
      while (end + 1 < normalized.length &&
          normalized[end + 1].summaryLabel == current.summaryLabel) {
        end += 1;
      }

      final startDay = _shortDayLabel(normalized[index].day);
      final endDay = _shortDayLabel(normalized[end].day);
      final dayLabel = index == end ? startDay : '$startDay-$endDay';
      segments.add('$dayLabel: ${current.summaryLabel}');
      index = end + 1;
    }

    return segments.join(' • ');
  }

  String _shortDayLabel(String day) {
    switch (day) {
      case 'Sunday':
        return 'Sun';
      case 'Monday':
        return 'Mon';
      case 'Tuesday':
        return 'Tue';
      case 'Wednesday':
        return 'Wed';
      case 'Thursday':
        return 'Thu';
      case 'Friday':
        return 'Fri';
      case 'Saturday':
        return 'Sat';
      default:
        return day;
    }
  }

  Widget _buildBusinessDayRow(
    int dayIndex,
    _RestaurantOwnerScope expectedOwnerScope,
  ) {
    final entry = businessHours[dayIndex];
    final previousDayIndex =
        (dayIndex - 1 + businessHours.length) % businessHours.length;
    final copiedFromPrevious = copyPreviousDay[entry.day] ?? false;

    return Container(
      margin: EdgeInsets.only(
        bottom: dayIndex == businessHours.length - 1 ? 0 : 12,
      ),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.grey.shade100,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  entry.day,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const Text(
                'Closed',
                style: TextStyle(fontSize: 13, color: Colors.black87),
              ),
              const SizedBox(width: 6),
              Switch(
                value: entry.closed,
                onChanged: (value) {
                  _setBusinessDayClosed(dayIndex, value, expectedOwnerScope);
                },
              ),
            ],
          ),
          CheckboxListTile(
            value: copiedFromPrevious,
            onChanged: (value) {
              _copyPreviousBusinessDayHours(
                dayIndex,
                value ?? false,
                expectedOwnerScope,
              );
            },
            dense: true,
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            visualDensity: VisualDensity.compact,
            title: Text(
              'Copy ${businessHours[previousDayIndex].day}',
              style: const TextStyle(fontSize: 13),
            ),
          ),
          if (!entry.closed) ...[
            const SizedBox(height: 8),
            LayoutBuilder(
              builder: (context, constraints) {
                final openField = DropdownButtonFormField<String>(
                  key: ValueKey('${entry.day}-open-${entry.opensAt}'),
                  isExpanded: true,
                  initialValue: businessHourOptions.contains(entry.opensAt)
                      ? entry.opensAt
                      : '9:00 AM',
                  decoration: buildInputDecoration('Open', ''),
                  items: businessHourOptions
                      .map(
                        (option) => DropdownMenuItem(
                          value: option,
                          child: Text(option, overflow: TextOverflow.ellipsis),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value == null) {
                      return;
                    }
                    _updateBusinessHoursEntry(
                      dayIndex,
                      entry.copyWith(opensAt: value),
                      expectedOwnerScope,
                    );
                  },
                );

                final closeField = DropdownButtonFormField<String>(
                  key: ValueKey('${entry.day}-close-${entry.closesAt}'),
                  isExpanded: true,
                  initialValue: businessHourOptions.contains(entry.closesAt)
                      ? entry.closesAt
                      : '5:00 PM',
                  decoration: buildInputDecoration('Close', ''),
                  items: businessHourOptions
                      .map(
                        (option) => DropdownMenuItem(
                          value: option,
                          child: Text(option, overflow: TextOverflow.ellipsis),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value == null) {
                      return;
                    }
                    _updateBusinessHoursEntry(
                      dayIndex,
                      entry.copyWith(closesAt: value),
                      expectedOwnerScope,
                    );
                  },
                );

                if (constraints.maxWidth < 420) {
                  return Column(
                    children: [
                      openField,
                      const SizedBox(height: 10),
                      closeField,
                    ],
                  );
                }

                return Row(
                  children: [
                    Expanded(child: openField),
                    const SizedBox(width: 10),
                    Expanded(child: closeField),
                  ],
                );
              },
            ),
          ],
        ],
      ),
    );
  }

  Widget buildPreviewCard(Coupon coupon) {
    final renderedOwnerScope = _activeOwnerScope;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (coupon.imageUrl != null && coupon.imageUrl!.trim().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _buildNetworkImagePreview(coupon.imageUrl!, height: 120),
              ),
            Text(
              coupon.title,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            Text('Restaurant: ${coupon.restaurant}'),
            const SizedBox(height: 4),
            Text('Distance: ${coupon.distance}'),
            const SizedBox(height: 4),
            Text(coupon.shortExpiresLabel),
            const SizedBox(height: 4),
            Text('Usage: ${coupon.usageRule}'),
            const SizedBox(height: 4),
            Text(
              'Type: ${coupon.isProximityOnly ? 'Proximity-only coupon' : 'Normal coupon'}',
            ),
            if (coupon.isProximityOnly &&
                coupon.proximityRadiusMiles != null) ...[
              const SizedBox(height: 4),
              Text(
                'Visible within: ${coupon.proximityRadiusMiles!.toStringAsFixed(0)} ${coupon.proximityRadiusMiles == 1 ? 'mile' : 'miles'}',
              ),
            ],
            if (coupon.couponCode != null && coupon.couponCode!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text('Code: ${coupon.couponCode!}'),
            ],
            if (coupon.details != null && coupon.details!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text('Details added'),
            ],
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: Wrap(
                spacing: 8,
                children: [
                  if (_hasCouponPostingAccess)
                    TextButton.icon(
                      onPressed: renderedOwnerScope == null
                          ? null
                          : () => editCoupon(
                              coupon,
                              expectedOwnerScope: renderedOwnerScope,
                            ),
                      icon: const Icon(Icons.edit_outlined),
                      label: const Text('Edit'),
                    ),
                  TextButton.icon(
                    onPressed:
                        _couponDeleteInFlight || renderedOwnerScope == null
                        ? null
                        : () => removeCoupon(
                            coupon,
                            renderedOwnerScope: renderedOwnerScope,
                          ),
                    icon: const Icon(Icons.delete_outline),
                    label: const Text('Remove'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildImageUploadField({
    required String title,
    required String buttonLabel,
    required String? imageUrl,
    required bool uploading,
    required VoidCallback onPressed,
    Uint8List? imageBytes,
    bool useRestaurantImageRenderer = false,
    bool enabled = true,
  }) {
    final hasImage =
        imageBytes != null || (imageUrl != null && imageUrl.trim().isNotEmpty);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFBF5),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE6D7C8)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
          if (hasImage) ...[
            const SizedBox(height: 10),
            if (useRestaurantImageRenderer)
              _buildRestaurantImagePreview(
                key: const ValueKey('restaurant-image-owner-preview'),
                imageBytes: imageBytes,
                imageUrl: imageUrl,
                height: 132,
                semanticLabel: 'Selected restaurant image preview',
              )
            else
              _buildNetworkImagePreview(imageUrl!, height: 132),
          ],
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: uploading || !enabled ? null : onPressed,
            icon: uploading
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.image_outlined),
            label: Text(uploading ? 'Uploading...' : buttonLabel),
          ),
        ],
      ),
    );
  }

  Widget _buildNetworkImagePreview(String imageUrl, {required double height}) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Image.network(
        imageUrl,
        width: double.infinity,
        height: height,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) => Container(
          height: height,
          alignment: Alignment.center,
          color: const Color(0xFFF3E8DD),
          child: const Text(
            'Image preview unavailable',
            style: TextStyle(color: Colors.black54),
          ),
        ),
      ),
    );
  }

  Widget _buildRestaurantImagePreview({
    required Key key,
    required Uint8List? imageBytes,
    required String? imageUrl,
    required double height,
    required String semanticLabel,
  }) {
    Widget buildNeutralState(BuildContext context) {
      return Container(
        width: double.infinity,
        height: height,
        color: const Color(0xFFF3E8DD),
      );
    }

    Widget buildErrorState(BuildContext context) {
      return Container(
        width: double.infinity,
        height: height,
        alignment: Alignment.center,
        color: const Color(0xFFF3E8DD),
        child: const Text(
          'Image preview unavailable',
          style: TextStyle(color: Colors.black54),
        ),
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: BiteSaverRestaurantImage(
        key: key,
        imageBytes: imageBytes,
        imageUrl: imageUrl,
        width: double.infinity,
        height: height,
        fit: BoxFit.cover,
        semanticLabel: semanticLabel,
        loadingBuilder: buildNeutralState,
        errorBuilder: buildErrorState,
        emptyBuilder: buildErrorState,
      ),
    );
  }

  Widget buildCustomerProfilePreview(RestaurantProfileData profile) {
    final hasPhone = profile.phone.trim().isNotEmpty;
    final hasWebsite = profile.website.trim().isNotEmpty;
    final hasAddress = profile.streetAddress.trim().isNotEmpty;
    final hasBio = profile.bio.trim().isNotEmpty;
    final todayHours = profile.businessHours.isEmpty
        ? null
        : RestaurantBusinessHours.normalizedWeek(
            profile.businessHours,
          )[DateTime.now().weekday % 7];

    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (profile.mainImageUrl.trim().isNotEmpty) ...[
              _buildRestaurantImagePreview(
                key: const ValueKey('restaurant-image-customer-preview'),
                imageBytes: null,
                imageUrl: profile.mainImageUrl,
                height: 150,
                semanticLabel: '${profile.name} restaurant image',
              ),
              const SizedBox(height: 12),
            ],
            Text(
              profile.name,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            Text(
              [
                profile.distance,
                '${profile.city}, ${profile.zipCode}',
              ].where((part) => part.trim().isNotEmpty).join(' • '),
              style: const TextStyle(fontSize: 14, color: Colors.black54),
            ),
            const SizedBox(height: 12),
            Text(
              todayHours == null
                  ? 'Hours not set'
                  : todayHours.closed
                  ? 'Closed today'
                  : 'Open today: ${todayHours.opensAt} - ${todayHours.closesAt}',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
            ),
            if (hasBio) ...[
              const SizedBox(height: 16),
              const Text(
                'About',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 6),
              Text(profile.bio),
            ],
            const SizedBox(height: 16),
            const Text(
              'Restaurant Info',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            if (hasAddress) Text('Address: ${profile.streetAddress}'),
            Text('City: ${profile.city}'),
            Text('State: ${profile.state}'),
            Text('ZIP: ${profile.zipCode}'),
            if (hasPhone)
              ClickablePhoneText(phone: profile.phone, prefix: 'Phone: '),
            if (hasWebsite) Text('Website: ${profile.website}'),
            if (profile.email.trim().isNotEmpty)
              Text('Email: ${profile.email}'),
          ],
        ),
      ),
    );
  }

  Widget _buildSubscriptionPromoSection() {
    final renderedOwnerScope = _activeOwnerScope;
    final VoidCallback? startSubscription =
        _subscriptionCheckoutLoading || renderedOwnerScope == null
        ? null
        : () => _openSubscriptionSignupScreen(renderedOwnerScope);

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 24),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: const Color(0xFF111827),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(
              Icons.workspace_premium_outlined,
              color: Colors.white,
              size: 22,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            _hasUsedTrial
                ? 'Subscribe to post coupons and daily specials'
                : 'Start your free trial to post coupons and daily specials',
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: Color(0xFF111827),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: Material(
              color: Colors.white,
              elevation: 2,
              shadowColor: const Color(0xFF2563EB).withValues(alpha: 0.14),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: const BorderSide(color: Color(0xFFBFDBFE), width: 1.2),
              ),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: startSubscription,
                splashColor: const Color(0xFF2563EB).withValues(alpha: 0.10),
                highlightColor: const Color(0xFF2563EB).withValues(alpha: 0.06),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 16,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      if (!_hasUsedTrial) ...[
                        const Text(
                          'First 2 months free',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFFB45309),
                          ),
                        ),
                        const SizedBox(height: 6),
                      ],
                      const Text(
                        '\$24.95/month',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 26,
                          fontWeight: FontWeight.w800,
                          color: Color(0xFF111827),
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Cancel anytime',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 13,
                          color: Color(0xFF64748B),
                        ),
                      ),
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 7,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEFF6FF),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(color: const Color(0xFFDBEAFE)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.touch_app_outlined,
                              size: 16,
                              color: Color(0xFF2563EB),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              _subscriptionCheckoutLoading
                                  ? 'Opening checkout...'
                                  : 'Tap to start',
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w800,
                                color: Color(0xFF1D4ED8),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 14),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 10,
            runSpacing: 10,
            children: const [
              Chip(
                label: Text('Post unlimited coupons'),
                visualDensity: VisualDensity.compact,
                backgroundColor: Color(0xFFEFF6FF),
                side: BorderSide(color: Color(0xFFDBEAFE)),
                labelStyle: TextStyle(
                  color: Color(0xFF1E3A8A),
                  fontWeight: FontWeight.w600,
                ),
              ),
              Chip(
                label: Text('Add daily specials'),
                visualDensity: VisualDensity.compact,
                backgroundColor: Color(0xFFEFF6FF),
                side: BorderSide(color: Color(0xFFDBEAFE)),
                labelStyle: TextStyle(
                  color: Color(0xFF1E3A8A),
                  fontWeight: FontWeight.w600,
                ),
              ),
              Chip(
                label: Text('Reach nearby customers'),
                visualDensity: VisualDensity.compact,
                backgroundColor: Color(0xFFEFF6FF),
                side: BorderSide(color: Color(0xFFDBEAFE)),
                labelStyle: TextStyle(
                  color: Color(0xFF1E3A8A),
                  fontWeight: FontWeight.w600,
                ),
              ),
              Chip(
                label: Text('Simple monthly pricing'),
                visualDensity: VisualDensity.compact,
                backgroundColor: Color(0xFFEFF6FF),
                side: BorderSide(color: Color(0xFFDBEAFE)),
                labelStyle: TextStyle(
                  color: Color(0xFF1E3A8A),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: const Color(0xFFF0FDF4),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFFBBF7D0)),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x12000000),
                  blurRadius: 8,
                  offset: Offset(0, 2),
                ),
              ],
            ),
            child: const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: EdgeInsets.only(top: 1),
                  child: Icon(
                    Icons.verified_user,
                    size: 18,
                    color: Color(0xFF15803D),
                  ),
                ),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Payments are securely handled by Stripe. We do not store your card details.',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: Color(0xFF166534),
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: startSubscription,
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF2563EB),
                disabledBackgroundColor: const Color(0xFF93C5FD),
                foregroundColor: Colors.white,
                disabledForegroundColor: Colors.white,
                elevation: 3,
                shadowColor: const Color(0xFF2563EB).withValues(alpha: 0.28),
                padding: const EdgeInsets.symmetric(vertical: 16),
                textStyle: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: Text(
                _subscriptionCheckoutLoading
                    ? 'Opening Checkout...'
                    : 'Start Subscription',
              ),
            ),
          ),
          const SizedBox(height: 10),
          const Text(
            'Subscription is only required when you are ready to post coupons or daily specials.',
            style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
          ),
        ],
      ),
    );
  }

  Widget _buildCouponAccessStateBody() {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(_couponAccessIcon(), size: 52),
                  const SizedBox(height: 16),
                  Text(
                    _couponAccessTitle(),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(_couponAccessMessage, textAlign: TextAlign.center),
                  const SizedBox(height: 20),
                  if (_couponAccessState ==
                      _CouponAccountAccessState.noAccount) ...[
                    TextField(
                      controller: restaurantNameController,
                      textInputAction: TextInputAction.next,
                      decoration: buildInputDecoration(
                        'Restaurant Name',
                        "Example: Joe's Pizza",
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: streetAddressController,
                      textInputAction: TextInputAction.next,
                      decoration: buildInputDecoration(
                        'Street Address',
                        'Example: 123 Main St',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: cityController,
                      textInputAction: TextInputAction.next,
                      decoration: buildInputDecoration(
                        'City',
                        'Example: Lecanto',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: stateController,
                      textInputAction: TextInputAction.next,
                      decoration: buildInputDecoration('State', 'Example: FL'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: zipCodeController,
                      textInputAction: TextInputAction.next,
                      decoration: buildInputDecoration(
                        'ZIP Code',
                        'Example: 34461',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: phoneController,
                      keyboardType: TextInputType.phone,
                      textInputAction: TextInputAction.done,
                      inputFormatters: usPhoneNumberInputFormatters,
                      decoration: buildInputDecoration(
                        'Phone Number',
                        'Example: (352) 555-1234',
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'Applications are usually reviewed day of, Monday through Saturday.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.black54,
                        height: 1.4,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: profileSaving
                            ? null
                            : _applyForCouponSideAccount,
                        child: Text(
                          profileSaving
                              ? 'Validating location...'
                              : 'Apply for a restaurant account',
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (_couponAccessState ==
                          _CouponAccountAccessState.unverified ||
                      _couponAccessState == _CouponAccountAccessState.pending ||
                      _couponAccessState ==
                          _CouponAccountAccessState.loadFailed)
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton(
                        onPressed: _refreshCurrentCouponAccessState,
                        child: const Text('Refresh Status'),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration buildInputDecoration(
    String label,
    String hint, {
    String? errorText,
  }) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      errorText: errorText,
      errorMaxLines: 2,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
    );
  }

  Widget _buildOwnerExpandableSection({
    required String title,
    required bool initiallyExpanded,
    required ValueChanged<bool> onExpansionChanged,
    required List<Widget> children,
  }) {
    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      elevation: 2,
      shadowColor: const Color(0x332B1D14),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: Color(0xFFE7D5C1)),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: initiallyExpanded,
          onExpansionChanged: onExpansionChanged,
          tilePadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          iconColor: const Color(0xFF8A5A16),
          collapsedIconColor: const Color(0xFF8A5A16),
          title: Text(
            title,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w800,
              color: Color(0xFF2B1D14),
            ),
          ),
          children: children,
        ),
      ),
    );
  }

  Widget _buildBasicRestaurantInformationSection() {
    final renderedOwnerScope = _activeOwnerScope;
    if (renderedOwnerScope == null) {
      return const SizedBox.shrink();
    }
    return _buildOwnerExpandableSection(
      title: 'Basic Restaurant Information',
      initiallyExpanded: _basicInfoSectionExpanded,
      onExpansionChanged: (expanded) {
        if (!_isCurrentExactOwnerScope(renderedOwnerScope)) {
          return;
        }
        setState(() {
          _basicInfoSectionExpanded = expanded;
        });
      },
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Restaurant Name',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: Colors.black87,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              restaurantNameController.text.trim().isEmpty
                  ? 'Restaurant name not set'
                  : restaurantNameController.text.trim(),
              style: const TextStyle(
                fontSize: 16,
                color: Colors.black87,
                height: 1.35,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            onPressed: () {
              if (!_isCurrentExactOwnerScope(renderedOwnerScope)) {
                return;
              }
              setState(() {
                _showNameChangeRequest = !_showNameChangeRequest;
                if (!_showNameChangeRequest) {
                  requestedRestaurantNameController.clear();
                }
              });
            },
            child: const Text('Request Name Change'),
          ),
        ),
        if (_showNameChangeRequest) ...[
          const SizedBox(height: 8),
          TextField(
            controller: requestedRestaurantNameController,
            textInputAction: TextInputAction.done,
            decoration: buildInputDecoration(
              'Requested Restaurant Name',
              'Enter the corrected restaurant name',
            ),
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton(
              onPressed: _submittingNameChangeRequest
                  ? null
                  : () {
                      if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
                        _submitRestaurantNameChangeRequest();
                      }
                    },
              child: Text(
                _submittingNameChangeRequest
                    ? 'Submitting...'
                    : 'Submit Request',
              ),
            ),
          ),
        ],
        const SizedBox(height: 16),
        TextField(
          controller: emailController,
          readOnly: true,
          keyboardType: TextInputType.emailAddress,
          decoration: buildInputDecoration(
            'Email Address',
            'Example: owner@joespizza.com',
          ),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: phoneController,
          keyboardType: TextInputType.phone,
          inputFormatters: usPhoneNumberInputFormatters,
          decoration: buildInputDecoration(
            'Phone Number',
            'Example: (352) 555-1234',
          ),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: streetAddressController,
          decoration: buildInputDecoration(
            'Street Address',
            'Example: 123 Main St',
          ),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: cityController,
          decoration: buildInputDecoration('City', 'Example: Lecanto'),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: stateController,
          decoration: buildInputDecoration('State', 'Example: FL'),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: zipCodeController,
          decoration: buildInputDecoration('ZIP Code', 'Example: 34461'),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: websiteController,
          keyboardType: TextInputType.url,
          decoration: buildInputDecoration(
            'Website',
            'Example: https://joespizza.com',
          ),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: bioController,
          minLines: 3,
          maxLines: 5,
          decoration: buildInputDecoration(
            'Short Bio',
            'Tell customers a little about your restaurant',
          ),
        ),
        const SizedBox(height: 18),
        _buildSaveProfileButton(
          label: 'Save Basic Information',
          busyLabel: 'Validating location...',
          onPressed: () {
            if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
              _saveBasicRestaurantInformation();
            }
          },
        ),
      ],
    );
  }

  Widget _buildRestaurantImageSection() {
    final renderedOwnerScope = _activeOwnerScope;
    if (renderedOwnerScope == null) {
      return const SizedBox.shrink();
    }
    Future<void> pickImageForRenderedOwner() async {
      if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
        await _pickRestaurantImage();
      }
    }

    Future<void> saveImageForRenderedOwner() async {
      if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
        await _saveRestaurantImage();
      }
    }

    final selectedImage = _currentRestaurantImageSelection;
    return _buildOwnerExpandableSection(
      title: 'Restaurant Image',
      initiallyExpanded: _restaurantImageSectionExpanded,
      onExpansionChanged: (expanded) {
        if (!_isCurrentExactOwnerScope(renderedOwnerScope)) {
          return;
        }
        setState(() {
          _restaurantImageSectionExpanded = expanded;
        });
      },
      children: [
        _buildImageUploadField(
          title: 'Restaurant image',
          buttonLabel: selectedImage == null && restaurantImageUrl == null
              ? 'Add restaurant image'
              : 'Change restaurant image',
          imageUrl: selectedImage?.uploadedUrl ?? restaurantImageUrl,
          uploading: restaurantImageUploading,
          onPressed: pickImageForRenderedOwner,
          imageBytes: selectedImage?.validatedImage.pickedImage.bytes,
          useRestaurantImageRenderer: true,
          enabled: !profileSaving,
        ),
        const SizedBox(height: 16),
        _buildSaveProfileButton(
          label: 'Save Restaurant Image',
          busyLabel: 'Saving image...',
          onPressed: saveImageForRenderedOwner,
        ),
      ],
    );
  }

  Widget _buildHoursSection() {
    final renderedOwnerScope = _activeOwnerScope;
    if (renderedOwnerScope == null) {
      return const SizedBox.shrink();
    }
    return _buildOwnerExpandableSection(
      title: 'Hours',
      initiallyExpanded: _hoursSectionExpanded,
      onExpansionChanged: (expanded) {
        if (!_isCurrentExactOwnerScope(renderedOwnerScope)) {
          return;
        }
        setState(() {
          _hoursSectionExpanded = expanded;
        });
      },
      children: [
        _buildBusinessHoursEditor(renderedOwnerScope),
        const SizedBox(height: 16),
        _buildSaveProfileButton(
          label: 'Save Hours',
          busyLabel: 'Saving hours...',
          onPressed: () {
            if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
              _saveBusinessHours();
            }
          },
        ),
      ],
    );
  }

  Widget _buildSaveProfileButton({
    required String label,
    required String busyLabel,
    required VoidCallback onPressed,
  }) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: profileSaving ? null : onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFF2563EB),
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 15),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
        child: Text(profileSaving ? busyLabel : label),
      ),
    );
  }

  Widget _buildManageMenuButton() {
    final ownerScope = _activeOwnerScope;
    if (ownerScope == null || !_isCurrentExactOwnerScope(ownerScope)) {
      return const SizedBox.shrink();
    }
    return FutureBuilder<BiteSaverMenuRoutingState>(
      key: ValueKey<String>(
        'bitesaver-menu-${ownerScope.identity.uid}-'
        '${ownerScope.identity.accountDocumentId}-'
        '${ownerScope.ownerGeneration}',
      ),
      future: _loadBiteSaverMenuRoutingState(ownerScope),
      builder: (context, snapshot) {
        final state = snapshot.data;
        final usesBiteRater = state?.usesBiteRater == true;
        final hasMatch = state?.matchedBiteScoreRestaurant != null;
        final isAlreadyUsedByOtherSide =
            state?.isAlreadyUsedByOtherSide == true;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: usesBiteRater
                    ? const Color(0xFFEFF6FF)
                    : const Color(0xFFFFFEFB),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: usesBiteRater
                      ? const Color(0xFFBFDBFE)
                      : const Color(0xFFE8D8C8),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    value: usesBiteRater,
                    onChanged:
                        snapshot.connectionState == ConnectionState.waiting ||
                            (!usesBiteRater &&
                                (!hasMatch || isAlreadyUsedByOtherSide))
                        ? null
                        : (enabled) => _toggleBiteSaverUsesBiteRaterMenu(
                            enabled: enabled,
                            matchedBiteScoreRestaurantId:
                                state?.matchedBiteScoreRestaurant?.id,
                            expectedOwnerScope: ownerScope,
                          ),
                    title: const Text(
                      'Use BiteScore menu',
                      style: TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ),
                  Text(
                    usesBiteRater
                        ? 'Menu is managed on BiteScore'
                        : isAlreadyUsedByOtherSide
                        ? 'This menu is already being used by the other side.'
                        : hasMatch
                        ? 'This restaurant matches your BiteScore profile.'
                        : 'Matching BiteScore restaurant required.',
                    style: TextStyle(
                      color: usesBiteRater
                          ? const Color(0xFF2563EB)
                          : Colors.black54,
                      fontWeight: usesBiteRater
                          ? FontWeight.w800
                          : FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: usesBiteRater
                    ? null
                    : () => _openMenuManagement(ownerScope),
                icon: const Icon(Icons.menu_book_outlined),
                label: const Text('Manage Menu'),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildMenuManagementSection() {
    final renderedOwnerScope = _activeOwnerScope;
    if (renderedOwnerScope == null) {
      return const SizedBox.shrink();
    }
    return _buildOwnerExpandableSection(
      title: 'Menu Management',
      initiallyExpanded: _menuManagementSectionExpanded,
      onExpansionChanged: (expanded) {
        if (!_isCurrentExactOwnerScope(renderedOwnerScope)) {
          return;
        }
        setState(() {
          _menuManagementSectionExpanded = expanded;
        });
      },
      children: [_buildManageMenuButton()],
    );
  }

  Widget _buildDailySpecialsSection() {
    final renderedOwnerScope = _activeOwnerScope;
    if (renderedOwnerScope == null) {
      return const SizedBox.shrink();
    }
    return _buildOwnerExpandableSection(
      title: 'Daily Specials',
      initiallyExpanded: _dailySpecialsSectionExpanded,
      onExpansionChanged: (expanded) {
        if (!_isCurrentExactOwnerScope(renderedOwnerScope)) {
          return;
        }
        setState(() {
          _dailySpecialsSectionExpanded = expanded;
        });
      },
      children: [
        if (!_hasCouponPostingAccess)
          _buildPostingToolLockedMessage(
            message: 'Subscription required to post daily specials.',
          )
        else ...[
          if (_dailySpecialsLoading)
            const Center(child: CircularProgressIndicator())
          else if (_dailySpecials.isNotEmpty)
            Column(
              children: _dailySpecials.map(_buildDailySpecialCard).toList(),
            ),
          if (_dailySpecials.isNotEmpty) ...[
            const SizedBox(height: 12),
            const Divider(),
            const SizedBox(height: 12),
          ],
          _buildDailySpecialForm(renderedOwnerScope),
        ],
      ],
    );
  }

  Widget _buildDailySpecialCard(DailySpecial special) {
    final renderedOwnerScope = _activeOwnerScope;
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    special.title,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Chip(
                  visualDensity: VisualDensity.compact,
                  label: Text(special.isActive ? 'Active' : 'Inactive'),
                  backgroundColor: special.isActive
                      ? const Color(0xFFE7F8EE)
                      : const Color(0xFFF3F4F6),
                  labelStyle: TextStyle(
                    color: special.isActive
                        ? const Color(0xFF166534)
                        : Colors.black54,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              _dailySpecialScheduleSummary(special),
              style: const TextStyle(color: Colors.black54),
            ),
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerRight,
              child: Wrap(
                spacing: 8,
                children: [
                  TextButton.icon(
                    onPressed: renderedOwnerScope == null
                        ? null
                        : () => editDailySpecial(
                            special,
                            expectedOwnerScope: renderedOwnerScope,
                          ),
                    icon: const Icon(Icons.edit_outlined),
                    label: const Text('Edit'),
                  ),
                  TextButton.icon(
                    onPressed:
                        _dailySpecialDeleteInFlight ||
                            renderedOwnerScope == null
                        ? null
                        : () => removeDailySpecial(
                            special,
                            renderedOwnerScope: renderedOwnerScope,
                          ),
                    icon: const Icon(Icons.delete_outline),
                    label: const Text('Delete'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDailySpecialForm(_RestaurantOwnerScope renderedOwnerScope) {
    final isEditing = editingDailySpecialId != null;
    return Column(
      key: _dailySpecialEditorKey,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: dailySpecialTitleController,
          onChanged: (_) {
            if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
              _markDailySpecialDraftChanged();
            }
          },
          textInputAction: TextInputAction.next,
          decoration: buildInputDecoration(
            'Title',
            'Meatball sub + drink \$9.99',
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: dailySpecialDetailsController,
          onChanged: (_) {
            if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
              _markDailySpecialDraftChanged();
            }
          },
          minLines: 2,
          maxLines: 4,
          decoration: buildInputDecoration(
            'Details (Optional)',
            'Dine-in only. Served with chips.',
          ),
        ),
        const SizedBox(height: 8),
        SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          value: _dailySpecialIsActive,
          onChanged: (value) {
            if (!_isCurrentExactOwnerScope(renderedOwnerScope)) {
              return;
            }
            setState(() {
              _markDailySpecialDraftChanged();
              _dailySpecialIsActive = value;
            });
          },
          title: const Text(
            'Active',
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
        ),
        const SizedBox(height: 12),
        const Text(
          'Availability',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        SizedBox(
          width: double.infinity,
          child: SegmentedButton<DailySpecialAvailabilityMode>(
            segments: const [
              ButtonSegment(
                value: DailySpecialAvailabilityMode.todayOnly,
                label: Text('Today only'),
              ),
              ButtonSegment(
                value: DailySpecialAvailabilityMode.specificDays,
                label: Text('Specific days'),
              ),
            ],
            selected: {_dailySpecialAvailabilityMode},
            onSelectionChanged: (selection) {
              if (!_isCurrentExactOwnerScope(renderedOwnerScope)) {
                return;
              }
              setState(() {
                _markDailySpecialDraftChanged();
                _dailySpecialAvailabilityMode = selection.first;
              });
            },
          ),
        ),
        if (_dailySpecialAvailabilityMode ==
            DailySpecialAvailabilityMode.specificDays) ...[
          const SizedBox(height: 4),
          _buildDailySpecialDayChips(renderedOwnerScope),
        ],
        const SizedBox(height: 16),
        const Text('Time', style: TextStyle(fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        SizedBox(
          width: double.infinity,
          child: SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: true, label: Text('Available all day')),
              ButtonSegment(value: false, label: Text('Specific time window')),
            ],
            selected: {_dailySpecialAllDay},
            onSelectionChanged: (selection) {
              if (!_isCurrentExactOwnerScope(renderedOwnerScope)) {
                return;
              }
              setState(() {
                _markDailySpecialDraftChanged();
                _dailySpecialAllDay = selection.first;
              });
            },
          ),
        ),
        if (!_dailySpecialAllDay) ...[
          const SizedBox(height: 4),
          LayoutBuilder(
            builder: (context, constraints) {
              final startField = _buildTimeOfDayField(
                label: 'Start time',
                hint: 'Select start',
                value: _dailySpecialStartTime,
                onTap: () {
                  if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
                    _pickDailySpecialTime(isStart: true);
                  }
                },
              );
              final endField = _buildTimeOfDayField(
                label: 'End time',
                hint: 'Select end',
                value: _dailySpecialEndTime,
                onTap: () {
                  if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
                    _pickDailySpecialTime(isStart: false);
                  }
                },
              );
              if (constraints.maxWidth < 420) {
                return Column(
                  children: [startField, const SizedBox(height: 10), endField],
                );
              }
              return Row(
                children: [
                  Expanded(child: startField),
                  const SizedBox(width: 10),
                  Expanded(child: endField),
                ],
              );
            },
          ),
        ],
        const SizedBox(height: 16),
        const Text('Visibility', style: TextStyle(fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        SizedBox(
          width: double.infinity,
          child: SegmentedButton<bool>(
            segments: const [
              ButtonSegment(
                value: true,
                label: Text('Hide when not available'),
              ),
              ButtonSegment(
                value: false,
                label: Text('Show always with schedule'),
              ),
            ],
            selected: {_dailySpecialHideWhenUnavailable},
            onSelectionChanged: (selection) {
              if (!_isCurrentExactOwnerScope(renderedOwnerScope)) {
                return;
              }
              setState(() {
                _markDailySpecialDraftChanged();
                _dailySpecialHideWhenUnavailable = selection.first;
              });
            },
          ),
        ),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: _dailySpecialSaving
                ? null
                : () {
                    if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
                      createOrUpdateDailySpecial();
                    }
                  },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF2563EB),
              foregroundColor: Colors.white,
              disabledForegroundColor: Colors.white,
              minimumSize: const Size.fromHeight(50),
              elevation: 0,
              padding: const EdgeInsets.symmetric(vertical: 15),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
              textStyle: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w800,
              ),
            ),
            icon: _dailySpecialSaving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.local_fire_department_outlined),
            label: Text(
              _dailySpecialSaving ? 'Saving...' : 'Save Daily Special',
            ),
          ),
        ),
        const SizedBox(height: 10),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton(
            onPressed: () {
              if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
                clearDailySpecialForm();
              }
            },
            child: Text(isEditing ? 'Cancel Editing' : 'Clear Form'),
          ),
        ),
      ],
    );
  }

  Widget _buildDailySpecialDayChips(_RestaurantOwnerScope renderedOwnerScope) {
    const days = <(int, String)>[
      (DateTime.monday, 'Mon'),
      (DateTime.tuesday, 'Tue'),
      (DateTime.wednesday, 'Wed'),
      (DateTime.thursday, 'Thu'),
      (DateTime.friday, 'Fri'),
      (DateTime.saturday, 'Sat'),
      (DateTime.sunday, 'Sun'),
    ];

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: days.map((day) {
        final selected = _dailySpecialDaysOfWeek.contains(day.$1);
        return FilterChip(
          label: Text(day.$2),
          selected: selected,
          onSelected: (isSelected) {
            if (!_isCurrentExactOwnerScope(renderedOwnerScope)) {
              return;
            }
            setState(() {
              _markDailySpecialDraftChanged();
              if (isSelected) {
                _dailySpecialDaysOfWeek.add(day.$1);
              } else {
                _dailySpecialDaysOfWeek.remove(day.$1);
              }
            });
          },
        );
      }).toList(),
    );
  }

  Widget _buildCustomerPreviewSection(RestaurantProfileData profile) {
    final renderedOwnerScope = _activeOwnerScope;
    if (renderedOwnerScope == null) {
      return const SizedBox.shrink();
    }
    return _buildOwnerExpandableSection(
      title: 'Customer Preview',
      initiallyExpanded: _customerPreviewSectionExpanded,
      onExpansionChanged: (expanded) {
        if (!_isCurrentExactOwnerScope(renderedOwnerScope)) {
          return;
        }
        setState(() {
          _customerPreviewSectionExpanded = expanded;
        });
      },
      children: [buildCustomerProfilePreview(profile)],
    );
  }

  Widget _buildSubscriptionBillingSection() {
    final renderedOwnerScope = _activeOwnerScope;
    if (renderedOwnerScope == null) {
      return const SizedBox.shrink();
    }
    final now = DateTime.now();
    final hasManageableSubscription =
        _subscriptionStatus == 'active' ||
        (_subscriptionStatus == 'trialing' &&
            _trialEndsAt != null &&
            _trialEndsAt!.isAfter(now));
    return _buildOwnerExpandableSection(
      title: 'Subscription / Billing',
      initiallyExpanded: _subscriptionBillingSectionExpanded,
      onExpansionChanged: (expanded) {
        if (!_isCurrentExactOwnerScope(renderedOwnerScope)) {
          return;
        }
        setState(() {
          _subscriptionBillingSectionExpanded = expanded;
        });
      },
      children: [
        _buildSubscriptionStatusSection(),
        if (!_hasCouponPostingAccess && !hasManageableSubscription) ...[
          const SizedBox(height: 16),
          _buildSubscriptionPromoSection(),
        ],
      ],
    );
  }

  Widget _buildPostingToolLockedMessage({required String message}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7ED),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFFED7AA)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.lock_outline, size: 20, color: Color(0xFFB45309)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: Color(0xFF7C2D12),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildExistingCouponList({required String emptyMessage}) {
    return ValueListenableBuilder<List<Coupon>>(
      valueListenable: LocalCouponStore.createdCoupons,
      builder: (context, coupons, _) {
        if (coupons.isEmpty) {
          return Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.grey.shade100,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(emptyMessage, style: const TextStyle(fontSize: 16)),
          );
        }

        return Column(children: coupons.map(buildPreviewCard).toList());
      },
    );
  }

  Widget _buildCouponManagementSection() {
    final renderedOwnerScope = _activeOwnerScope;
    if (renderedOwnerScope == null) {
      return const SizedBox.shrink();
    }
    if (!_hasCouponPostingAccess) {
      return _buildOwnerExpandableSection(
        title: 'Coupon Management',
        initiallyExpanded: _couponManagementSectionExpanded,
        onExpansionChanged: (expanded) {
          if (!_isCurrentExactOwnerScope(renderedOwnerScope)) {
            return;
          }
          setState(() {
            _couponManagementSectionExpanded = expanded;
          });
        },
        children: [
          _buildPostingToolLockedMessage(
            message:
                'Posting access is required to create or edit coupons. You can still remove your existing coupons below.',
          ),
          const SizedBox(height: 24),
          const Text(
            'Existing Coupons',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          _buildExistingCouponList(emptyMessage: 'No existing coupons.'),
        ],
      );
    }

    return _buildOwnerExpandableSection(
      title: 'Coupon Management',
      initiallyExpanded: _couponManagementSectionExpanded,
      onExpansionChanged: (expanded) {
        if (!_isCurrentExactOwnerScope(renderedOwnerScope)) {
          return;
        }
        setState(() {
          _couponManagementSectionExpanded = expanded;
        });
      },
      children: [
        Text(
          key: _couponEditorKey,
          isEditingCoupon ? 'Edit Coupon' : 'Create a New Coupon',
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
        ),
        if (isEditingCoupon) ...[
          const SizedBox(height: 8),
          const Text(
            'Update the fields below and save your changes.',
            style: TextStyle(fontSize: 12, color: Colors.black54),
          ),
        ],
        const SizedBox(height: 16),
        KeyedSubtree(
          key: _couponTitleFieldKey,
          child: TextField(
            controller: titleController,
            onChanged: (_) {
              if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
                _refreshCouponValidationHighlights();
              }
            },
            decoration: buildInputDecoration(
              'Coupon Title',
              'Example: 50% Off Any Large Pizza',
              errorText: _couponTitleErrorText(),
            ),
          ),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: couponDetailsController,
          onChanged: (_) {
            if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
              _markCouponDraftChanged();
            }
          },
          minLines: 3,
          maxLines: 5,
          decoration: buildInputDecoration(
            'Coupon Description (Optional)',
            'Optional details, exclusions, or redemption notes.',
          ),
        ),
        const SizedBox(height: 8),
        _buildImageUploadField(
          title: 'Coupon image',
          buttonLabel: couponImageUrl == null
              ? 'Add coupon image'
              : 'Change coupon image',
          imageUrl: couponImageUrl,
          uploading: couponImageUploading,
          onPressed: () {
            if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
              _pickCouponImage();
            }
          },
        ),
        const SizedBox(height: 8),
        const Text(
          'Coupon title and valid start/end times are required. Description is optional.',
          style: TextStyle(fontSize: 12, color: Colors.black54),
        ),
        const SizedBox(height: 16),
        KeyedSubtree(
          key: _couponStartTimeFieldKey,
          child: buildDateTimeField(
            label: 'Start Time',
            hint: 'Select when this coupon becomes active',
            value: couponStartTime,
            errorText: _couponStartTimeErrorText(),
            onTap: () {
              if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
                _pickCouponDateTime(isStart: true);
              }
            },
          ),
        ),
        const SizedBox(height: 16),
        KeyedSubtree(
          key: _couponEndTimeFieldKey,
          child: buildDateTimeField(
            label: 'End Time',
            hint: 'Select expiration date',
            value: couponEndTime,
            errorText: _couponEndTimeErrorText(),
            onTap: () {
              if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
                _pickCouponDateTime(isStart: false);
              }
            },
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Coupons are visible only between the selected start and end times.',
          style: TextStyle(fontSize: 12, color: Colors.black54),
        ),
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          initialValue: selectedUsageRule,
          decoration: buildInputDecoration('Usage Rule', ''),
          items: const [
            DropdownMenuItem(
              value: 'Once per customer',
              child: Text('Once per customer'),
            ),
            DropdownMenuItem(
              value: 'Once per day',
              child: Text('Once per day'),
            ),
            DropdownMenuItem(value: 'Unlimited', child: Text('Unlimited')),
          ],
          onChanged: (value) {
            if (value != null &&
                _isCurrentExactOwnerScope(renderedOwnerScope)) {
              setState(() {
                _markCouponDraftChanged(notify: false);
                selectedUsageRule = value;
              });
            }
          },
        ),
        const SizedBox(height: 16),
        DropdownButtonFormField<String>(
          initialValue: selectedCouponType,
          decoration: buildInputDecoration('Coupon Type', ''),
          items: const [
            DropdownMenuItem(
              value: 'Normal coupon',
              child: Text('Normal coupon'),
            ),
            DropdownMenuItem(
              value: 'Proximity-only coupon',
              child: Text('Proximity-only coupon'),
            ),
          ],
          onChanged: (value) {
            if (value != null &&
                _isCurrentExactOwnerScope(renderedOwnerScope)) {
              setState(() {
                _markCouponDraftChanged(notify: false);
                selectedCouponType = value;
              });
            }
          },
        ),
        if (isProximityCoupon) ...[
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            initialValue: selectedProximityRadius,
            decoration: buildInputDecoration('Visible Within Radius', ''),
            items: const [
              DropdownMenuItem(value: '1 mile', child: Text('1 mile')),
              DropdownMenuItem(value: '2 miles', child: Text('2 miles')),
              DropdownMenuItem(value: '3 miles', child: Text('3 miles')),
              DropdownMenuItem(value: '4 miles', child: Text('4 miles')),
              DropdownMenuItem(value: '5 miles', child: Text('5 miles')),
              DropdownMenuItem(value: '6 miles', child: Text('6 miles')),
              DropdownMenuItem(value: '7 miles', child: Text('7 miles')),
              DropdownMenuItem(value: '8 miles', child: Text('8 miles')),
              DropdownMenuItem(value: '9 miles', child: Text('9 miles')),
              DropdownMenuItem(value: '10 miles', child: Text('10 miles')),
            ],
            onChanged: (value) {
              if (value != null &&
                  _isCurrentExactOwnerScope(renderedOwnerScope)) {
                setState(() {
                  _markCouponDraftChanged(notify: false);
                  selectedProximityRadius = value;
                });
              }
            },
          ),
          const SizedBox(height: 8),
          const Text(
            'This coupon will only be visible when the user is within the selected distance from the restaurant.',
            style: TextStyle(fontSize: 12, color: Colors.black54),
          ),
        ],
        const SizedBox(height: 16),
        TextField(
          controller: couponCodeController,
          onChanged: (_) {
            if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
              _markCouponDraftChanged();
            }
          },
          decoration: buildInputDecoration(
            'Optional Coupon Code',
            'Example: JOE50',
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Restaurants can leave this blank if no code is needed.',
          style: TextStyle(fontSize: 12, color: Colors.black54),
        ),
        const SizedBox(height: 24),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: couponSaving || couponImageUploading
                ? null
                : () {
                    if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
                      createOrUpdateCoupon();
                    }
                  },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF2563EB),
              foregroundColor: Colors.white,
              disabledForegroundColor: Colors.white,
              minimumSize: const Size.fromHeight(50),
              elevation: 0,
              padding: const EdgeInsets.symmetric(vertical: 15),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
              textStyle: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w800,
              ),
            ),
            child: Text(
              couponSaving
                  ? (isEditingCoupon ? 'Saving Changes...' : 'Saving Coupon...')
                  : (isEditingCoupon ? 'Save Coupon Changes' : 'Create Coupon'),
            ),
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton(
            onPressed: () {
              if (_isCurrentExactOwnerScope(renderedOwnerScope)) {
                clearCouponForm();
              }
            },
            child: Text(
              isEditingCoupon ? 'Cancel Editing' : 'Clear Coupon Form',
            ),
          ),
        ),
        const SizedBox(height: 32),
        const Divider(),
        const SizedBox(height: 16),
        const Text(
          'Created Coupon Preview',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        _buildExistingCouponList(emptyMessage: 'No coupons created yet.'),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_currentOwnerIdentity != _activeOwnerIdentity) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _synchronizeCurrentOwnerIdentity();
        }
      });
      return const Center(child: CircularProgressIndicator());
    }
    final savedProfile = LocalRestaurantProfileStore.profile.value;
    final renderedOwnerScope = _activeOwnerScope;

    if (profileLoading || couponsLoading || _dailySpecialsLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_couponAccessState != _CouponAccountAccessState.approved) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Coupon Side Owner'),
          centerTitle: true,
        ),
        body: _buildCouponAccessStateBody(),
      );
    }
    if (renderedOwnerScope == null) {
      return const Center(child: CircularProgressIndicator());
    }

    return PopScope(
      canPop: _allowProfileClose || !_hasUnsavedRestaurantProfileChanges,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop || _allowProfileClose || profileSaving) {
          return;
        }
        final ownerScope = renderedOwnerScope;
        if (!_isCurrentExactOwnerScope(ownerScope)) {
          return;
        }
        final action = _beginOwnerAction(
          _OwnerActionKind.leaveConfirmation,
          expectedOwnerScope: ownerScope,
        );
        if (action == null) {
          return;
        }
        final shouldLeave = await _confirmLeaveRestaurantProfileChanges(
          ownerScope,
        );
        if (!context.mounted ||
            !shouldLeave ||
            !_isCurrentOwnerAction(action)) {
          return;
        }
        _allowProfileClose = true;
        Navigator.of(context).pop();
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Restaurant: Create Coupon'),
          centerTitle: true,
          actions: [
            TextButton.icon(
              onPressed: () => _signOutAndExitRestaurantHub(renderedOwnerScope),
              icon: const Icon(Icons.logout),
              label: const Text('Sign Out'),
              style: TextButton.styleFrom(foregroundColor: Colors.black87),
            ),
          ],
        ),
        body: SingleChildScrollView(
          controller: _hubScrollController,
          padding: EdgeInsets.fromLTRB(
            16,
            16,
            16,
            16 + MediaQuery.paddingOf(context).bottom + 72,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Restaurant Profile',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              _buildBasicRestaurantInformationSection(),
              _buildHoursSection(),
              _buildRestaurantImageSection(),
              _buildSubscriptionBillingSection(),
              _buildCouponManagementSection(),
              if (_hasCouponPostingAccess) _buildDailySpecialsSection(),
              _buildMenuManagementSection(),
              _buildCustomerPreviewSection(savedProfile),
            ],
          ),
        ),
      ),
    );
  }
}

enum _CouponAccountAccessState {
  loading,
  approved,
  noAccount,
  unverified,
  pending,
  rejected,
  loadFailed,
}

enum _CouponValidationField { title, startTime, endTime }

enum _OwnerActionKind {
  checkout,
  portal,
  subscriptionLifecycle,
  subscriptionReturn,
  subscriptionRefresh,
  menuOpen,
  menuRead,
  menuWrite,
  couponDateTime,
  couponImage,
  couponSave,
  couponDelete,
  dailySpecialTime,
  dailySpecialSave,
  dailySpecialDelete,
  leaveConfirmation,
}

@visibleForTesting
class BiteSaverMenuRoutingState {
  final bool usesBiteRater;
  final BitescoreRestaurant? matchedBiteScoreRestaurant;
  final bool isAlreadyUsedByOtherSide;

  const BiteSaverMenuRoutingState({
    required this.usesBiteRater,
    required this.matchedBiteScoreRestaurant,
    required this.isAlreadyUsedByOtherSide,
  });
}
