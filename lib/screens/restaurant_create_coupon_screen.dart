import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';

import '../models/coupon.dart';
import '../models/local_coupon_store.dart';
import '../models/local_restaurant_profile_store.dart';
import '../models/restaurant.dart';
import '../services/app_error_text.dart';
import '../services/customer_session_service.dart';
import '../services/restaurant_account_service.dart';
import '../services/restaurant_auth_service.dart';
import '../services/subscription_checkout_service.dart';
import 'paywall_screen.dart';

class RestaurantCreateCouponScreen extends StatefulWidget {
  const RestaurantCreateCouponScreen({super.key});

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

  String selectedUsageRule = 'Once per customer';
  String selectedCouponType = 'Normal coupon';
  String selectedProximityRadius = '1 mile';
  String? editingCouponId;

  bool profileLoading = true;
  bool profileSaving = false;
  bool couponsLoading = true;
  bool couponSaving = false;
  bool _hoursExpanded = false;
  bool _businessHoursDirty = false;
  bool _subscriptionCheckoutLoading = false;
  bool _customerPortalLoading = false;
  bool _subscriptionStateRefreshing = false;
  bool _hasCouponPostingAccess = false;
  bool _hasUsedTrial = false;
  bool _showNameChangeRequest = false;
  bool _submittingNameChangeRequest = false;
  String _subscriptionStatus = 'inactive';
  DateTime? _trialEndsAt;
  DateTime? couponStartTime;
  DateTime? couponEndTime;
  List<RestaurantBusinessHours> businessHours =
      RestaurantBusinessHours.defaultWeek();
  final Map<String, bool> copyPreviousDay = {
    for (final day in Restaurant.businessDayNames) day: false,
  };
  _CouponAccountAccessState _couponAccessState =
      _CouponAccountAccessState.loading;
  String _couponAccessMessage = '';

  bool get isProximityCoupon => selectedCouponType == 'Proximity-only coupon';
  bool get isEditingCoupon => editingCouponId != null;
  User? get currentUser => FirebaseAuth.instance.currentUser;

  Future<void> _openPaywallScreen() async {
    await Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const PaywallScreen()));
  }

  Future<void> _openSubscriptionSignupScreen() async {
    if (_subscriptionCheckoutLoading) {
      return;
    }

    setState(() {
      _subscriptionCheckoutLoading = true;
    });

    try {
      await SubscriptionCheckoutService.startCheckout();
    } catch (_) {
      if (!mounted) {
        return;
      }
      _showSnackBar('Something went wrong');
    } finally {
      if (mounted) {
        setState(() {
          _subscriptionCheckoutLoading = false;
        });
      }
    }
  }

  Future<void> _openManageSubscription() async {
    if (_customerPortalLoading) {
      return;
    }

    setState(() {
      _customerPortalLoading = true;
    });

    try {
      await SubscriptionCheckoutService.openCustomerPortal();
    } catch (_) {
      if (!mounted) {
        return;
      }
      _showSnackBar('Something went wrong');
    } finally {
      if (mounted) {
        setState(() {
          _customerPortalLoading = false;
        });
      }
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
    WidgetsBinding.instance.addObserver(this);
    _resetCouponSchedule();
    _loadSavedProfileAndCoupons();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    stateController.dispose();
    requestedRestaurantNameController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshSubscriptionStateOnly();
    }
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
    final existingValue = isStart ? couponStartTime : couponEndTime;
    final initialValue = existingValue ?? DateTime.now();

    final pickedDate = await showDatePicker(
      context: context,
      initialDate: initialValue,
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now().add(const Duration(days: 3650)),
    );
    if (pickedDate == null || !mounted) return;

    final pickedTime = await showTimePicker(
      context: context,
      initialTime: isStart
          ? TimeOfDay.fromDateTime(initialValue)
          : const TimeOfDay(hour: 23, minute: 59),
    );
    if (pickedTime == null || !mounted) return;

    final selectedDateTime = DateTime(
      pickedDate.year,
      pickedDate.month,
      pickedDate.day,
      pickedTime.hour,
      pickedTime.minute,
    );

    setState(() {
      if (isStart) {
        couponStartTime = selectedDateTime;
      } else {
        couponEndTime = selectedDateTime;
      }
    });
  }

  Widget buildDateTimeField({
    required String label,
    required String hint,
    required DateTime? value,
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

  Future<void> _loadSavedProfileAndCoupons() async {
    final localProfile = LocalRestaurantProfileStore.profile.value;
    restaurantNameController.text = localProfile.name;
    cityController.text = localProfile.city;
    stateController.text = localProfile.state;
    zipCodeController.text = localProfile.zipCode;
    distanceController.text = '';
    emailController.text = currentUser?.email ?? localProfile.email;
    phoneController.text = localProfile.phone;
    streetAddressController.text = localProfile.streetAddress;
    websiteController.text = localProfile.website;
    bioController.text = localProfile.bio;
    businessHours = _hoursForEditing(localProfile.businessHours);
    _businessHoursDirty = localProfile.businessHours.isNotEmpty;

    LocalCouponStore.clearCoupons();

    final user = await _reloadCurrentRestaurantUser() ?? currentUser;
    if (user == null) {
      _couponAccessState = _CouponAccountAccessState.noAccount;
      _couponAccessMessage = _couponAccessMessageFor(
        state: _couponAccessState,
        email: null,
      );
      _hasCouponPostingAccess = false;
      _hasUsedTrial = false;
      _subscriptionStatus = 'inactive';
      _trialEndsAt = null;
      if (mounted) {
        setState(() {
          profileLoading = false;
          couponsLoading = false;
        });
      }
      return;
    }

    try {
      final data = await RestaurantAccountService.getAccountData(user.uid);
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
      _subscriptionStatus =
          ((data?['subscriptionStatus'] as String?) ?? 'inactive')
              .trim()
              .toLowerCase();
      final rawTrialEndsAt = data?['trialEndsAt'];
      _trialEndsAt = rawTrialEndsAt is Timestamp
          ? rawTrialEndsAt.toDate()
          : rawTrialEndsAt as DateTime?;

      if (_couponAccessState != _CouponAccountAccessState.approved) {
        if (mounted) {
          setState(() {
            profileLoading = false;
            couponsLoading = false;
          });
        }
        return;
      }

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
            ? data['phone'] as String
            : phoneController.text;
        streetAddressController.text =
            (data['streetAddress'] as String?)?.trim().isNotEmpty == true
            ? data['streetAddress'] as String
            : streetAddressController.text;
        websiteController.text =
            (data['website'] as String?)?.trim().isNotEmpty == true
            ? data['website'] as String
            : websiteController.text;
        bioController.text = (data['bio'] as String?)?.trim().isNotEmpty == true
            ? data['bio'] as String
            : bioController.text;
        final loadedBusinessHours = RestaurantBusinessHours.listFromFirestore(
          data[Restaurant.fieldBusinessHours],
        );
        businessHours = _hoursForEditing(loadedBusinessHours);
        _businessHoursDirty = loadedBusinessHours.isNotEmpty;
      }

      final loadedCoupons = await RestaurantAccountService.loadCoupons(
        user.uid,
      );
      for (final coupon in loadedCoupons.reversed) {
        LocalCouponStore.addCoupon(coupon);
      }

      final persistedBusinessHours = _hoursForPersistence();
      LocalRestaurantProfileStore.updateProfile(
        RestaurantProfileData(
          name: restaurantNameController.text.trim().isEmpty
              ? 'Your Restaurant Preview'
              : restaurantNameController.text.trim(),
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
          latitude: _stringFromCoordinateValue(data?[Restaurant.fieldLatitude]),
          longitude: _stringFromCoordinateValue(
            data?[Restaurant.fieldLongitude],
          ),
          businessHours: persistedBusinessHours,
        ),
      );
    } catch (_) {
      _couponAccessState = _CouponAccountAccessState.loadFailed;
      _couponAccessMessage =
          'Could not load your BiteSaver owner tools right now. Please try again.';
      _hasCouponPostingAccess = false;
      _hasUsedTrial = false;
      _subscriptionStatus = 'inactive';
      _trialEndsAt = null;
    }

    if (mounted) {
      setState(() {
        profileLoading = false;
        couponsLoading = false;
      });
    }
  }

  Future<void> _refreshSubscriptionStateOnly() async {
    final user = await _reloadCurrentRestaurantUser() ?? currentUser;
    if (user == null || _subscriptionStateRefreshing) {
      return;
    }

    _subscriptionStateRefreshing = true;
    try {
      final data = await RestaurantAccountService.getAccountData(user.uid);
      if (!mounted || data == null) {
        return;
      }

      final subscriptionStatus =
          ((data['subscriptionStatus'] as String?) ?? 'inactive')
              .trim()
              .toLowerCase();
      final rawTrialEndsAt = data['trialEndsAt'];
      final trialEndsAt = rawTrialEndsAt is Timestamp
          ? rawTrialEndsAt.toDate()
          : rawTrialEndsAt as DateTime?;
      final hasCouponPostingAccess =
          RestaurantAccountService.hasCouponPostingAccess(data);
      final hasUsedTrial = data['hasUsedTrial'] == true;

      setState(() {
        _hasUsedTrial = hasUsedTrial;
        _subscriptionStatus = subscriptionStatus;
        _trialEndsAt = trialEndsAt;
        _hasCouponPostingAccess = hasCouponPostingAccess;
      });
    } catch (_) {
      // Keep the current screen state if the refresh fails.
    } finally {
      _subscriptionStateRefreshing = false;
    }
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

  Future<void> _refreshCouponAccessState() async {
    setState(() {
      profileLoading = true;
      couponsLoading = true;
      _couponAccessState = _CouponAccountAccessState.loading;
    });
    await _loadSavedProfileAndCoupons();
  }

  Future<void> _applyForCouponSideAccount() async {
    final user = currentUser;
    if (user == null) {
      _showSnackBar('Please sign in to continue.');
      return;
    }

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
      await RestaurantAccountService.createOrUpdateAccountRecord(
        user,
        restaurantName: restaurantName,
        streetAddress: streetAddress,
        city: city,
        state: state,
        zipCode: zipCode,
        phone: phone,
        markApplicationSubmitted: true,
      );
      await RestaurantAccountService.syncEmailVerified(user);
      if (!mounted) {
        return;
      }
      _showSnackBar('Coupon-side application submitted for admin review.');
      await _refreshCouponAccessState();
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not submit your coupon-side application right now.',
        ),
      );
    } finally {
      if (mounted) {
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

    final currentRestaurantName = restaurantNameController.text.trim();
    final requestedRestaurantName = requestedRestaurantNameController.text
        .trim();

    if (requestedRestaurantName.isEmpty) {
      _showSnackBar('Please enter the requested restaurant name.');
      return;
    }

    if (requestedRestaurantName.toLowerCase() ==
        currentRestaurantName.toLowerCase()) {
      _showSnackBar('Please enter a different restaurant name.');
      return;
    }

    setState(() {
      _submittingNameChangeRequest = true;
    });

    try {
      await FirebaseFirestore.instance
          .collection('restaurant_name_change_requests')
          .add({
            'userId': user.uid,
            'currentRestaurantName': currentRestaurantName,
            'requestedRestaurantName': requestedRestaurantName,
            'createdAt': FieldValue.serverTimestamp(),
            'status': 'pending',
          });

      if (!mounted) {
        return;
      }

      requestedRestaurantNameController.clear();
      setState(() {
        _showNameChangeRequest = false;
      });
      _showSnackBar('Name change request submitted.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not submit the name change request right now.',
        ),
      );
    } finally {
      if (mounted) {
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
      message = remainingDays <= 0
          ? 'Trial ends ${_formatShortDate(_trialEndsAt!)}'
          : 'Ends ${_formatShortDate(_trialEndsAt!)} • $remainingDays day${remainingDays == 1 ? '' : 's'} remaining';
      accentColor = const Color(0xFF2563EB);
      icon = Icons.schedule_outlined;
    } else if (_subscriptionStatus == 'active' || _hasCouponPostingAccess) {
      title = 'Subscription active';
      message = 'Your restaurant can post coupons right now.';
      accentColor = const Color(0xFF15803D);
      icon = Icons.verified_outlined;
    } else {
      title = 'Not subscribed';
      message = 'Start a subscription when you are ready to post coupons.';
      accentColor = const Color(0xFF64748B);
      icon = Icons.credit_card_off_outlined;
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accentColor.withOpacity(0.18)),
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
                  color: accentColor.withOpacity(0.10),
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
                onPressed: _customerPortalLoading
                    ? null
                    : _openManageSubscription,
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

  String? _validateProfileInput() {
    final name = restaurantNameController.text.trim();
    final streetAddress = streetAddressController.text.trim();
    final city = cityController.text.trim();
    final state = stateController.text.trim();
    final zipCode = zipCodeController.text.trim();
    final email = emailController.text.trim();

    if (name.isEmpty ||
        streetAddress.isEmpty ||
        city.isEmpty ||
        state.isEmpty ||
        zipCode.isEmpty ||
        email.isEmpty) {
      return 'Please complete the required profile fields: name, street, city, state, ZIP, and email.';
    }

    return null;
  }

  String? _validateCouponInput() {
    final draftCoupon = _buildDraftCoupon();

    return draftCoupon.validateForSave();
  }

  Coupon _buildDraftCoupon() {
    final profile = LocalRestaurantProfileStore.profile.value;

    return Coupon(
      id: editingCouponId ?? '',
      restaurant: profile.name,
      title: titleController.text.trim(),
      distance: profile.distance,
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
    );
  }

  Future<void> saveRestaurantProfile() async {
    final user = currentUser;
    if (user == null) {
      _showSnackBar('Please sign in to continue.');
      return;
    }

    FocusScope.of(context).unfocus();

    final profileError = _validateProfileInput();
    if (profileError != null) {
      _showSnackBar(profileError);
      return;
    }

    final name = restaurantNameController.text.trim();
    final city = cityController.text.trim();
    final state = stateController.text.trim();
    final zipCode = zipCodeController.text.trim();
    final email = emailController.text.trim();
    final phone = phoneController.text.trim();
    final streetAddress = streetAddressController.text.trim();
    final website = websiteController.text.trim();
    final bio = bioController.text.trim();
    final fullAddress = '$streetAddress, $city, $state $zipCode';

    double? latitude;
    double? longitude;

    try {
      final locations = await locationFromAddress(fullAddress);
      if (locations.isNotEmpty) {
        latitude = locations.first.latitude;
        longitude = locations.first.longitude;
      }
    } catch (_) {
      if (!mounted) return;
      _showSnackBar('Could not find location for that address.');
      return;
    }

    setState(() {
      profileSaving = true;
    });

    try {
      final persistedBusinessHours = _hoursForPersistence();

      await RestaurantAccountService.saveRestaurantProfile(
        uid: user.uid,
        name: name,
        city: city,
        state: state,
        zipCode: zipCode,
        email: email,
        phone: phone,
        streetAddress: streetAddress,
        website: website,
        bio: bio,
        businessHours: persistedBusinessHours,
        latitude: latitude,
        longitude: longitude,
      );

      _businessHoursDirty = persistedBusinessHours.isNotEmpty;
      LocalRestaurantProfileStore.updateProfile(
        RestaurantProfileData(
          name: name,
          city: city,
          state: state,
          zipCode: zipCode,
          distance: '',
          email: email,
          phone: phone,
          streetAddress: streetAddress,
          website: website,
          bio: bio,
          latitude: latitude?.toString() ?? '',
          longitude: longitude?.toString() ?? '',
          businessHours: persistedBusinessHours,
        ),
      );

      if (!mounted) return;
      _showSnackBar('Restaurant profile saved.');
      setState(() {});
    } catch (error) {
      if (!mounted) return;
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not save the restaurant profile right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          profileSaving = false;
        });
      }
    }
  }

  Future<bool> _ensureRestaurantAddressReadyForCoupons(User user) async {
    final streetAddress = streetAddressController.text.trim();
    final city = cityController.text.trim();
    final state = stateController.text.trim();
    final zipCode = zipCodeController.text.trim();

    if (streetAddress.isEmpty ||
        city.isEmpty ||
        state.isEmpty ||
        zipCode.isEmpty) {
      _showSnackBar(
        'Please complete your restaurant address before posting coupons.',
      );
      return false;
    }

    final savedProfile = LocalRestaurantProfileStore.profile.value;
    final savedLatitude = double.tryParse(savedProfile.latitude.trim());
    final savedLongitude = double.tryParse(savedProfile.longitude.trim());
    if (savedLatitude != null && savedLongitude != null) {
      return true;
    }

    final fullAddress = '$streetAddress, $city, $state $zipCode';

    try {
      final locations = await locationFromAddress(fullAddress);
      if (locations.isEmpty) {
        _showSnackBar('Could not find location for that address.');
        return false;
      }

      final latitude = locations.first.latitude;
      final longitude = locations.first.longitude;

      await RestaurantAccountService.saveRestaurantCoordinates(
        uid: user.uid,
        latitude: latitude,
        longitude: longitude,
      );

      LocalRestaurantProfileStore.updateProfile(
        savedProfile.copyWith(
          streetAddress: streetAddress,
          city: city,
          state: state,
          zipCode: zipCode,
          latitude: latitude.toString(),
          longitude: longitude.toString(),
        ),
      );

      return true;
    } catch (_) {
      _showSnackBar('Could not find location for that address.');
      return false;
    }
  }

  Future<void> createOrUpdateCoupon() async {
    final user = currentUser;
    if (user == null) {
      _showSnackBar('Please sign in to continue.');
      return;
    }

    final accountData = await RestaurantAccountService.getAccountData(user.uid);
    final canPostCoupons = RestaurantAccountService.hasCouponPostingAccess(
      accountData,
    );
    if (!canPostCoupons) {
      await _openPaywallScreen();
      return;
    }

    final addressReady = await _ensureRestaurantAddressReadyForCoupons(user);
    if (!addressReady) {
      return;
    }

    if (couponEndTime == null) {
      _showSnackBar('Please select an expiration date');
      return;
    }

    final couponError = _validateCouponInput();
    if (couponError != null) {
      _showSnackBar(couponError);
      return;
    }

    final title = titleController.text.trim();
    final couponCode = couponCodeController.text.trim();
    final couponDetails = couponDetailsController.text.trim();
    final profile = LocalRestaurantProfileStore.profile.value;
    final wasEditingCoupon = isEditingCoupon;

    setState(() {
      couponSaving = true;
    });

    try {
      final draftCoupon = _buildDraftCoupon();

      final savedCoupon = wasEditingCoupon
          ? await RestaurantAccountService.updateCoupon(
              uid: user.uid,
              coupon: draftCoupon,
            )
          : await RestaurantAccountService.saveCoupon(
              uid: user.uid,
              coupon: draftCoupon,
            );

      LocalCouponStore.upsertCoupon(savedCoupon);

      if (!mounted) return;
      showDialog(
        context: context,
        builder: (context) {
          final summary = StringBuffer()
            ..writeln('Restaurant: ${profile.name}')
            ..writeln('Email: ${profile.email}')
            ..writeln('Title: $title')
            ..writeln(savedCoupon.shortExpiresLabel)
            ..writeln('Usage: $selectedUsageRule')
            ..writeln('Type: $selectedCouponType');

          if (isProximityCoupon) {
            summary.writeln('Visible within: $selectedProximityRadius');
          }
          if (couponCode.isNotEmpty) {
            summary.writeln('Code: $couponCode');
          }
          if (couponDetails.isNotEmpty) {
            summary.writeln('Details: $couponDetails');
          }

          return AlertDialog(
            title: Text(wasEditingCoupon ? 'Coupon Updated' : 'Coupon Created'),
            content: Text(summary.toString().trim()),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.pop(context);
                  clearCouponForm();
                },
                child: const Text('OK'),
              ),
            ],
          );
        },
      );
    } catch (error) {
      if (!mounted) return;
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not save the coupon right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          couponSaving = false;
        });
      }
    }
  }

  Future<void> _signOutAndExitRestaurantHub() async {
    await CustomerSessionService.signOutToSignedOut();
    if (!mounted) {
      return;
    }

    final navigator = Navigator.of(context);
    if (navigator.canPop()) {
      navigator.pop();
    }
  }

  void editCoupon(Coupon coupon) {
    setState(() {
      editingCouponId = coupon.id;
      titleController.text = coupon.title;
      couponCodeController.text = coupon.couponCode ?? '';
      couponDetailsController.text = coupon.details ?? '';
      couponStartTime = coupon.startTime;
      couponEndTime = coupon.endTime;
      selectedUsageRule = coupon.usageRule;
      selectedCouponType = coupon.isProximityOnly
          ? 'Proximity-only coupon'
          : 'Normal coupon';
      selectedProximityRadius =
          coupon.isProximityOnly && coupon.proximityRadiusMiles != null
          ? '${coupon.proximityRadiusMiles!.toStringAsFixed(0)} ${coupon.proximityRadiusMiles == 1 ? 'mile' : 'miles'}'
          : '1 mile';
    });
  }

  void clearCouponForm() {
    setState(() {
      editingCouponId = null;
      titleController.clear();
      couponCodeController.clear();
      couponDetailsController.clear();
      selectedUsageRule = 'Once per customer';
      selectedCouponType = 'Normal coupon';
      selectedProximityRadius = '1 mile';
      _resetCouponSchedule();
    });
  }

  Future<void> removeCoupon(Coupon coupon) async {
    final user = currentUser;
    if (user == null) return;

    try {
      await RestaurantAccountService.deleteCoupon(
        uid: user.uid,
        couponId: coupon.id,
      );
      LocalCouponStore.removeCoupon(coupon.id);
      if (editingCouponId == coupon.id) {
        clearCouponForm();
      }
      if (!mounted) return;
      _showSnackBar('Coupon removed.');
    } catch (error) {
      if (!mounted) return;
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not remove the coupon right now.',
        ),
      );
    }
  }

  void _updateBusinessHoursEntry(
    int dayIndex,
    RestaurantBusinessHours updatedEntry,
  ) {
    setState(() {
      _businessHoursDirty = true;
      businessHours = [
        for (var index = 0; index < businessHours.length; index += 1)
          index == dayIndex ? updatedEntry : businessHours[index],
      ];
    });
  }

  void _setBusinessDayClosed(int dayIndex, bool closed) {
    _updateBusinessHoursEntry(
      dayIndex,
      businessHours[dayIndex].copyWith(closed: closed),
    );
  }

  void _copyPreviousBusinessDayHours(int dayIndex, bool shouldCopy) {
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

  Widget _buildBusinessHoursEditor() {
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
                (index) => _buildBusinessDayRow(index),
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

  Widget _buildBusinessDayRow(int dayIndex) {
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
                  _setBusinessDayClosed(dayIndex, value);
                },
              ),
            ],
          ),
          CheckboxListTile(
            value: copiedFromPrevious,
            onChanged: (value) {
              _copyPreviousBusinessDayHours(dayIndex, value ?? false);
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
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
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
                  TextButton.icon(
                    onPressed: () {
                      editCoupon(coupon);
                    },
                    icon: const Icon(Icons.edit_outlined),
                    label: const Text('Edit'),
                  ),
                  TextButton.icon(
                    onPressed: () {
                      removeCoupon(coupon);
                    },
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
            if (hasPhone) Text('Phone: ${profile.phone}'),
            if (hasWebsite) Text('Website: ${profile.website}'),
            if (profile.email.trim().isNotEmpty)
              Text('Email: ${profile.email}'),
          ],
        ),
      ),
    );
  }

  Widget _buildSubscriptionPromoSection() {
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
            color: Colors.black.withOpacity(0.05),
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
                ? 'Subscribe to post coupons'
                : 'Start your free trial to post coupons',
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: Color(0xFF111827),
            ),
          ),
          const SizedBox(height: 16),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFFE2E8F0)),
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
                  style: TextStyle(fontSize: 13, color: Color(0xFF64748B)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'Post coupons and reach nearby customers with targeted local deals.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 14,
              color: Color(0xFF475569),
              height: 1.4,
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
              onPressed: _subscriptionCheckoutLoading
                  ? null
                  : _openSubscriptionSignupScreen,
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF111827),
                foregroundColor: Colors.white,
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
            'Subscription is only required when you are ready to post a coupon.',
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
                              ? 'Submitting...'
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
                        onPressed: _refreshCouponAccessState,
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

  InputDecoration buildInputDecoration(String label, String hint) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final savedProfile = LocalRestaurantProfileStore.profile.value;

    if (profileLoading || couponsLoading) {
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

    return Scaffold(
      appBar: AppBar(
        title: const Text('Restaurant: Create Coupon'),
        centerTitle: true,
        actions: [
          TextButton.icon(
            onPressed: () async {
              await _signOutAndExitRestaurantHub();
            },
            icon: const Icon(Icons.logout),
            label: const Text('Sign Out'),
            style: TextButton.styleFrom(foregroundColor: Colors.black87),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Restaurant Profile',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
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
                      : _submitRestaurantNameChangeRequest,
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
            const SizedBox(height: 16),
            _buildBusinessHoursEditor(),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: profileSaving ? null : saveRestaurantProfile,
                child: Text(
                  profileSaving ? 'Saving...' : 'Save Restaurant Profile',
                ),
              ),
            ),
            const SizedBox(height: 24),
            const Divider(),
            const SizedBox(height: 16),
            const Text(
              'Customer View Preview',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            buildCustomerProfilePreview(savedProfile),
            const SizedBox(height: 16),
            _buildSubscriptionStatusSection(),
            const SizedBox(height: 16),
            if (!_hasCouponPostingAccess) ...[
              _buildSubscriptionPromoSection(),
              const SizedBox(height: 32),
              const Divider(),
              const SizedBox(height: 16),
            ],
            Text(
              isEditingCoupon ? 'Edit Coupon' : 'Create a New Coupon',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            if (isEditingCoupon) ...[
              const SizedBox(height: 8),
              const Text(
                'Update the fields below and save your changes.',
                style: TextStyle(fontSize: 12, color: Colors.black54),
              ),
            ],
            const SizedBox(height: 16),
            TextField(
              controller: titleController,
              decoration: buildInputDecoration(
                'Coupon Title',
                'Example: 50% Off Any Large Pizza',
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: couponDetailsController,
              minLines: 3,
              maxLines: 5,
              decoration: buildInputDecoration(
                'Coupon Description (Optional)',
                'Optional details, exclusions, or redemption notes.',
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Coupon title and valid start/end times are required. Description is optional.',
              style: TextStyle(fontSize: 12, color: Colors.black54),
            ),
            const SizedBox(height: 16),
            buildDateTimeField(
              label: 'Start Time',
              hint: 'Select when this coupon becomes active',
              value: couponStartTime,
              onTap: () {
                _pickCouponDateTime(isStart: true);
              },
            ),
            const SizedBox(height: 16),
            buildDateTimeField(
              label: 'End Time',
              hint: 'Select expiration date',
              value: couponEndTime,
              onTap: () {
                _pickCouponDateTime(isStart: false);
              },
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
                if (value != null) {
                  setState(() {
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
                if (value != null) {
                  setState(() {
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
                  if (value != null) {
                    setState(() {
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
                onPressed: couponSaving ? null : createOrUpdateCoupon,
                child: Text(
                  couponSaving
                      ? (isEditingCoupon
                            ? 'Saving Changes...'
                            : 'Saving Coupon...')
                      : (isEditingCoupon
                            ? 'Save Coupon Changes'
                            : 'Create Coupon'),
                ),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: clearCouponForm,
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
            ValueListenableBuilder<List<Coupon>>(
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
                    child: const Text(
                      'No coupons created yet.',
                      style: TextStyle(fontSize: 16),
                    ),
                  );
                }

                return Column(children: coupons.map(buildPreviewCard).toList());
              },
            ),
          ],
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
