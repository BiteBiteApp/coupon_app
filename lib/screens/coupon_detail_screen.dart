import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../models/coupon.dart';
import '../models/customer_bitesaver_search.dart';
import '../models/demo_redemption_store.dart';
import '../models/restaurant.dart';
import '../services/app_error_text.dart';
import '../services/app_mode_state_service.dart';
import '../services/bitesaver_report_service.dart';
import '../services/bitescore_sign_in_gate.dart';
import '../services/bitescore_service.dart';
import '../services/customer_bitesaver_search_coordinator.dart';
import '../services/customer_bitesaver_saved_coordinator.dart';
import '../services/restaurant_account_service.dart';
import '../widgets/app_mode_switcher_bar.dart';
import '../widgets/bitesaver_colors.dart';
import '../widgets/bitesaver_report_dialog.dart';
import '../widgets/persistent_bottom_navigation.dart';
import 'customer_account_screen.dart';
import 'restaurant_profile_screen.dart';

typedef CouponFavoriteStateLoader = Future<bool> Function(String couponId);
typedef CouponCustomerVisibilityLoader =
    Future<bool> Function(Coupon coupon, Restaurant? restaurant);
typedef CouponRedemptionStoreInitializer = Future<void> Function();
typedef CustomerBiteSaverDetailAction =
    Future<void> Function(BuildContext context);
typedef CustomerBiteSaverDetailUseAction =
    Future<CustomerBiteSaverRedemptionPresentation> Function(
      BuildContext context,
    );

@immutable
final class CustomerBiteSaverOfferPresentation {
  const CustomerBiteSaverOfferPresentation._({
    required this.offerTypeLabel,
    required this.availabilityLabel,
    required this.scheduleLabel,
    required this.startsLabel,
    required this.endsLabel,
    required this.expiresLabel,
    required this.usageLabel,
  });

  factory CustomerBiteSaverOfferPresentation.fromOffer(
    CustomerBiteSaverOffer offer,
  ) {
    final availabilityMode = offer.availabilityMode?.trim();
    final availabilityLabel = switch (availabilityMode) {
      'todayOnly' => 'Today only',
      'specificDays' => 'Specific days',
      final String value when value.isNotEmpty => value,
      _ => null,
    };
    final scheduleParts = <String>[
      if (offer.daysOfWeek.isNotEmpty)
        offer.daysOfWeek.map(_weekdayLabel).join(', '),
      if (offer.allDay == true)
        'All day'
      else if (offer.allDay == false &&
          offer.startTime?.trim().isNotEmpty == true &&
          offer.endTime?.trim().isNotEmpty == true)
        '${offer.startTime!.trim()}–${offer.endTime!.trim()}'
      else if (offer.allDay == false &&
          offer.startTime?.trim().isNotEmpty == true)
        'Starts ${offer.startTime!.trim()}'
      else if (offer.allDay == false &&
          offer.endTime?.trim().isNotEmpty == true)
        'Ends ${offer.endTime!.trim()}',
    ];
    return CustomerBiteSaverOfferPresentation._(
      offerTypeLabel: offer.offerType == CustomerBiteSaverOfferType.dailySpecial
          ? 'Daily special'
          : 'Coupon',
      availabilityLabel: availabilityLabel,
      scheduleLabel: scheduleParts.isEmpty ? null : scheduleParts.join(' · '),
      startsLabel: _absoluteLabel(offer.startAtMillis),
      endsLabel: _absoluteLabel(offer.endAtMillis),
      expiresLabel:
          _nonEmpty(offer.expiresText) ??
          _absoluteLabel(offer.expiresAtMillis, monthDayOnly: true),
      usageLabel:
          _nonEmpty(offer.redemptionPolicyLabel) ??
          _nonEmpty(offer.usageRule) ??
          _usagePolicyLabel(offer.usagePolicy),
    );
  }

  final String offerTypeLabel;
  final String? availabilityLabel;
  final String? scheduleLabel;
  final String? startsLabel;
  final String? endsLabel;
  final String? expiresLabel;
  final String? usageLabel;

  static String? _nonEmpty(String? value) {
    final trimmed = value?.trim();
    return trimmed == null || trimmed.isEmpty ? null : trimmed;
  }

  static String? _usagePolicyLabel(CustomerBiteSaverUsagePolicy? policy) =>
      switch (policy) {
        CustomerBiteSaverUsagePolicy.oncePerCustomer => 'Once per customer',
        CustomerBiteSaverUsagePolicy.oncePerDay => 'Once per day',
        CustomerBiteSaverUsagePolicy.unlimited => 'Unlimited',
        CustomerBiteSaverUsagePolicy.reusableAfterTimer =>
          'Reusable after timer',
        null => null,
      };

  static String? _absoluteLabel(int? millis, {bool monthDayOnly = false}) {
    if (millis == null) return null;
    final instant = DateTime.fromMillisecondsSinceEpoch(millis, isUtc: true);
    return monthDayOnly
        ? Coupon.formatMonthDayTime(instant)
        : Coupon.formatDateTime(instant);
  }

  static String _weekdayLabel(int weekday) => switch (weekday) {
    DateTime.monday => 'Mon',
    DateTime.tuesday => 'Tue',
    DateTime.wednesday => 'Wed',
    DateTime.thursday => 'Thu',
    DateTime.friday => 'Fri',
    DateTime.saturday => 'Sat',
    DateTime.sunday => 'Sun',
    _ => weekday.toString(),
  };
}

class CouponDetailScreen extends StatefulWidget {
  static const ValueKey<String> boundedOfferTypeKey = ValueKey(
    'bitesaver_bounded_offer_type',
  );
  static const ValueKey<String> boundedAvailabilityKey = ValueKey(
    'bitesaver_bounded_offer_availability',
  );
  static const ValueKey<String> boundedScheduleKey = ValueKey(
    'bitesaver_bounded_offer_schedule',
  );
  static const ValueKey<String> boundedStartsKey = ValueKey(
    'bitesaver_bounded_offer_starts',
  );
  static const ValueKey<String> boundedEndsKey = ValueKey(
    'bitesaver_bounded_offer_ends',
  );

  final Coupon coupon;
  final Restaurant? restaurant;
  final CouponFavoriteStateLoader? loadFavoriteState;
  final CouponCustomerVisibilityLoader? loadCustomerVisibility;
  final CouponRedemptionStoreInitializer? initializeRedemptionStore;
  final CustomerBiteSaverRestaurant? boundedRestaurant;
  final CustomerBiteSaverOffer? boundedOffer;
  final CustomerBiteSaverSearchCoordinator? boundedSession;
  final CustomerBiteSaverSavedCoordinator? boundedSavedCoordinator;
  final CustomerBiteSaverSavedAccess? boundedSavedAccess;
  final CustomerBiteSaverBrowseAccess? boundedAccess;
  final CustomerBiteSaverDetailAction? openBoundedRestaurant;
  final CustomerBiteSaverDetailUseAction? useBoundedCoupon;

  const CouponDetailScreen({
    super.key,
    required this.coupon,
    this.restaurant,
    @visibleForTesting this.loadFavoriteState,
    @visibleForTesting this.loadCustomerVisibility,
    @visibleForTesting this.initializeRedemptionStore,
  }) : boundedRestaurant = null,
       boundedOffer = null,
       boundedSession = null,
       boundedSavedCoordinator = null,
       boundedSavedAccess = null,
       boundedAccess = null,
       openBoundedRestaurant = null,
       useBoundedCoupon = null;

  CouponDetailScreen.fromCustomerBiteSaver({
    super.key,
    required CustomerBiteSaverRestaurant restaurant,
    required CustomerBiteSaverOffer offer,
    required CustomerBiteSaverSearchCoordinator session,
    required CustomerBiteSaverBrowseAccess access,
    required this.openBoundedRestaurant,
    this.useBoundedCoupon,
  }) : coupon = _customerBiteSaverCouponDetailView(restaurant, offer),
       restaurant = _customerBiteSaverRestaurantDetailView(restaurant),
       boundedRestaurant = restaurant,
       boundedOffer = offer,
       boundedSession = session,
       boundedSavedCoordinator = null,
       boundedSavedAccess = null,
       boundedAccess = access,
       loadFavoriteState = null,
       loadCustomerVisibility = null,
       initializeRedemptionStore = null {
    final current = session.currentAcceptedOfferSelectionForAccess(
      access,
      restaurant.restaurantId,
      offer.offerId,
    );
    if (!identical(current?.restaurant, restaurant) ||
        !identical(current?.offer, offer) ||
        current?.offer.offerOccurrence != offer.offerOccurrence) {
      throw const CustomerBiteSaverFreshSearchRequiredException();
    }
  }

  CouponDetailScreen.fromCustomerBiteSaverSaved({
    super.key,
    required CustomerBiteSaverRestaurant restaurant,
    required CustomerBiteSaverOffer offer,
    required CustomerBiteSaverSavedCoordinator savedCoordinator,
    required CustomerBiteSaverSavedAccess savedAccess,
    required this.openBoundedRestaurant,
    this.useBoundedCoupon,
  }) : coupon = _customerBiteSaverCouponDetailView(restaurant, offer),
       restaurant = _customerBiteSaverRestaurantDetailView(restaurant),
       boundedRestaurant = restaurant,
       boundedOffer = offer,
       boundedSession = null,
       boundedSavedCoordinator = savedCoordinator,
       boundedSavedAccess = savedAccess,
       boundedAccess = null,
       loadFavoriteState = null,
       loadCustomerVisibility = null,
       initializeRedemptionStore = null;

  @override
  State<CouponDetailScreen> createState() => _CouponDetailScreenState();
}

class BiteSaverCouponDetailInfoSection extends StatefulWidget {
  static const ValueKey<String> titleKey = ValueKey(
    'bitesaver_coupon_detail_title',
  );
  static const ValueKey<String> detailsKey = ValueKey(
    'bitesaver_coupon_detail_details',
  );
  static const ValueKey<String> expiresKey = ValueKey(
    'bitesaver_coupon_detail_expires',
  );
  static const ValueKey<String> restaurantPillKey = ValueKey(
    'bitesaver_coupon_detail_restaurant_pill',
  );
  static const ValueKey<String> usageKey = ValueKey(
    'bitesaver_coupon_detail_usage',
  );
  static const ValueKey<String> statusKey = ValueKey(
    'bitesaver_coupon_detail_status',
  );
  static const ValueKey<String> detailsToggleKey = ValueKey(
    'bitesaver_coupon_detail_details_toggle',
  );

  final String title;
  final String? details;
  final String expiresLabel;
  final String restaurantName;
  final String usageRule;
  final bool showUnlimitedUsage;
  final String? unavailableStatus;
  final bool isOpeningRestaurant;
  final VoidCallback? onOpenRestaurant;
  final Widget? trailingTitleAction;

  const BiteSaverCouponDetailInfoSection({
    super.key,
    required this.title,
    required this.details,
    required this.expiresLabel,
    required this.restaurantName,
    required this.usageRule,
    this.showUnlimitedUsage = false,
    required this.unavailableStatus,
    required this.isOpeningRestaurant,
    required this.onOpenRestaurant,
    this.trailingTitleAction,
  });

  static bool hasMeaningfulDetails(String? details) =>
      details != null && details.trim().isNotEmpty;

  static bool isUnlimitedUsage(String usageRule) =>
      usageRule.trim().toLowerCase() == 'unlimited';

  @override
  State<BiteSaverCouponDetailInfoSection> createState() =>
      _BiteSaverCouponDetailInfoSectionState();
}

class _BiteSaverCouponDetailInfoSectionState
    extends State<BiteSaverCouponDetailInfoSection> {
  static const int _collapsedDetailsLines = 3;
  static const int _longDetailsCharacterHint = 130;

  bool _detailsExpanded = false;

  @override
  Widget build(BuildContext context) {
    final details = widget.details;
    final showDetails = BiteSaverCouponDetailInfoSection.hasMeaningfulDetails(
      details,
    );
    final detailsText = details?.trim() ?? '';
    final trimmedRestaurantName = widget.restaurantName.trim();
    final showRestaurantPill = trimmedRestaurantName.isNotEmpty;
    final showExpires = widget.expiresLabel.trim().isNotEmpty;
    final showUsage =
        widget.usageRule.trim().isNotEmpty &&
        (widget.showUnlimitedUsage ||
            !BiteSaverCouponDetailInfoSection.isUnlimitedUsage(
              widget.usageRule,
            ));
    final status = widget.unavailableStatus?.trim();
    final showDetailsToggle =
        showDetails && detailsText.length > _longDetailsCharacterHint;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                widget.title,
                key: BiteSaverCouponDetailInfoSection.titleKey,
                style: const TextStyle(
                  color: BiteSaverColors.ink,
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  height: 1.08,
                  letterSpacing: 0.05,
                ),
              ),
            ),
            if (widget.trailingTitleAction != null) ...[
              const SizedBox(width: 8),
              widget.trailingTitleAction!,
            ],
          ],
        ),
        if (showDetails) ...[
          const SizedBox(height: 7),
          RichText(
            key: BiteSaverCouponDetailInfoSection.detailsKey,
            maxLines: _detailsExpanded ? null : _collapsedDetailsLines,
            overflow: _detailsExpanded
                ? TextOverflow.visible
                : TextOverflow.ellipsis,
            text: TextSpan(
              style: const TextStyle(
                color: BiteSaverColors.valueInk,
                fontSize: 14,
                height: 1.25,
                fontWeight: FontWeight.w500,
              ),
              children: [
                const TextSpan(
                  text: 'Details: ',
                  style: TextStyle(
                    color: BiteSaverColors.labelInk,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.08,
                  ),
                ),
                TextSpan(text: detailsText),
              ],
            ),
          ),
          if (showDetailsToggle)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: TextButton(
                key: BiteSaverCouponDetailInfoSection.detailsToggleKey,
                onPressed: () {
                  setState(() {
                    _detailsExpanded = !_detailsExpanded;
                  });
                },
                style: TextButton.styleFrom(
                  foregroundColor: BiteSaverColors.blue,
                  padding: EdgeInsets.zero,
                  minimumSize: const Size(44, 30),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  alignment: Alignment.centerLeft,
                  textStyle: const TextStyle(fontWeight: FontWeight.w800),
                ),
                child: Text(_detailsExpanded ? 'Less' : 'More'),
              ),
            ),
        ],
        const SizedBox(height: 7),
        Wrap(
          spacing: 16,
          runSpacing: 3,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            if (showExpires)
              _InlineCouponDetail(
                key: BiteSaverCouponDetailInfoSection.expiresKey,
                label: 'Expires',
                value: widget.expiresLabel,
              ),
            if (showUsage)
              _InlineCouponDetail(
                key: BiteSaverCouponDetailInfoSection.usageKey,
                label: 'Usage',
                value: widget.usageRule,
              ),
          ],
        ),
        if (status != null && status.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 5),
            child: _CouponDetailLine(
              key: BiteSaverCouponDetailInfoSection.statusKey,
              label: 'Status',
              value: status,
              valueColor: Colors.red,
              labelColor: Colors.red,
            ),
          ),
        if (showRestaurantPill) ...[
          const SizedBox(height: 8),
          BiteSaverCouponRestaurantLink(
            key: BiteSaverCouponDetailInfoSection.restaurantPillKey,
            restaurantName: trimmedRestaurantName,
            isOpening: widget.isOpeningRestaurant,
            onTap: widget.isOpeningRestaurant ? null : widget.onOpenRestaurant,
          ),
        ],
      ],
    );
  }
}

class BiteSaverCouponRestaurantLink extends StatelessWidget {
  final String restaurantName;
  final bool isOpening;
  final VoidCallback? onTap;

  const BiteSaverCouponRestaurantLink({
    super.key,
    required this.restaurantName,
    required this.isOpening,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      enabled: onTap != null,
      label: 'Restaurant: $restaurantName',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Row(
            children: [
              const Text(
                'Restaurant: ',
                style: TextStyle(
                  color: BiteSaverColors.labelInk,
                  fontWeight: FontWeight.w800,
                  fontSize: 14,
                ),
              ),
              Expanded(
                child: Text(
                  restaurantName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: BiteSaverColors.blue,
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                    height: 1.2,
                  ),
                ),
              ),
              const SizedBox(width: 4),
              if (isOpening)
                const SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                const Icon(
                  Icons.chevron_right,
                  color: BiteSaverColors.blue,
                  size: 18,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class BiteSaverCouponReportRow extends StatelessWidget {
  static const ValueKey<String> reportButtonKey = ValueKey(
    'bitesaver_coupon_report_button',
  );
  static const ValueKey<String> couponNumberKey = ValueKey(
    'bitesaver_coupon_number',
  );

  final bool isSubmittingReport;
  final VoidCallback? onReport;
  final String? couponNumberLabel;

  const BiteSaverCouponReportRow({
    super.key,
    required this.isSubmittingReport,
    required this.onReport,
    required this.couponNumberLabel,
  });

  @override
  Widget build(BuildContext context) {
    final formattedNumber = Coupon.formatCouponNumber(couponNumberLabel);

    return Row(
      children: [
        TextButton.icon(
          key: reportButtonKey,
          onPressed: isSubmittingReport ? null : onReport,
          style: TextButton.styleFrom(
            foregroundColor: BiteSaverColors.mutedInk,
            padding: EdgeInsets.zero,
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
          icon: const Icon(Icons.flag_outlined, size: 16),
          label: const Text('Report'),
        ),
        const Spacer(),
        if (formattedNumber != null)
          Flexible(
            child: Text(
              'Code: $formattedNumber',
              key: couponNumberKey,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.right,
              style: const TextStyle(
                color: BiteSaverColors.secondaryText,
                fontSize: 13,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
      ],
    );
  }
}

class BiteSaverCouponNumberVisibility {
  const BiteSaverCouponNumberVisibility._();

  static bool shouldShow({
    required bool supportsRedeemTimer,
    required bool hasActiveTimer,
  }) {
    return !supportsRedeemTimer || hasActiveTimer;
  }
}

class _InlineCouponDetail extends StatelessWidget {
  final String label;
  final String value;

  const _InlineCouponDetail({
    super.key,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return const SizedBox.shrink();
    }

    return RichText(
      text: TextSpan(
        style: const TextStyle(
          color: BiteSaverColors.valueInk,
          fontSize: 14,
          height: 1.25,
          fontWeight: FontWeight.w500,
        ),
        children: [
          TextSpan(
            text: '$label: ',
            style: const TextStyle(
              color: BiteSaverColors.labelInk,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.08,
            ),
          ),
          TextSpan(text: trimmed),
        ],
      ),
    );
  }
}

class _CouponDetailLine extends StatelessWidget {
  final String label;
  final String value;
  final Color valueColor;
  final Color labelColor;

  const _CouponDetailLine({
    super.key,
    required this.label,
    required this.value,
    this.valueColor = BiteSaverColors.valueInk,
    this.labelColor = BiteSaverColors.labelInk,
  });

  @override
  Widget build(BuildContext context) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return const SizedBox.shrink();
    }

    return RichText(
      text: TextSpan(
        style: TextStyle(
          color: valueColor,
          fontSize: 14,
          height: 1.25,
          fontWeight: FontWeight.w500,
        ),
        children: [
          TextSpan(
            text: '$label: ',
            style: TextStyle(
              color: labelColor,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.08,
            ),
          ),
          TextSpan(text: trimmed),
        ],
      ),
    );
  }
}

class _CouponDetailScreenState extends State<CouponDetailScreen> {
  static const Color _pageBackground = BiteSaverColors.pageBackground;
  static const Color _detailLabelInk = BiteSaverColors.labelInk;
  static const Color _detailValueInk = BiteSaverColors.valueInk;
  static const Color _detailMutedInk = BiteSaverColors.mutedInk;
  static const Color _detailAccent = BiteSaverColors.orangeDark;

  bool isLoading = true;
  bool isRedeeming = false;
  bool _isFavoriteCoupon = false;
  bool _isSavingFavoriteCoupon = false;
  bool _isSubmittingReport = false;
  bool _isOpeningRestaurant = false;
  bool _isConfirmingUse = false;
  bool _isCustomerVisibleOffer = false;
  Timer? _countdownTicker;
  CustomerBiteSaverRedemptionPresentation? _confirmedRedemption;

  bool get _supportsRedeemTimer =>
      (widget.boundedOffer?.offerType == CustomerBiteSaverOfferType.coupon &&
          widget.boundedOffer?.usagePolicy !=
              CustomerBiteSaverUsagePolicy.unlimited) ||
      (widget.boundedOffer == null &&
          DemoRedemptionStore.supportsRedeemTimer(widget.coupon.usageRule));

  bool get _supportsCouponUse =>
      widget.boundedOffer?.offerType == CustomerBiteSaverOfferType.coupon ||
      (widget.boundedOffer == null && _supportsRedeemTimer);

  CustomerBiteSaverRedemptionPresentation? get _boundedRedemption {
    final offer = widget.boundedOffer;
    if (offer == null) return null;
    final retained =
        _confirmedRedemption ??
        widget.boundedSession?.redemptionPresentationFor(offer.offerId) ??
        widget.boundedSavedCoordinator?.redemptionPresentationFor(
          offer.offerId,
        );
    if (retained != null) {
      final active = retained.isActiveAt(_redemptionNowMillis);
      final occurrenceCanRefresh =
          retained.usagePolicy == CustomerBiteSaverUsagePolicy.oncePerDay ||
          retained.usagePolicy ==
              CustomerBiteSaverUsagePolicy.reusableAfterTimer;
      if (active ||
          !occurrenceCanRefresh ||
          retained.offerOccurrence == offer.offerOccurrence) {
        return retained;
      }
    }
    final expiresAt = offer.activeTimerExpiresAtMillis;
    if (expiresAt == null) return null;
    return CustomerBiteSaverRedemptionPresentation(
      restaurantId: widget.boundedRestaurant!.restaurantId,
      offerId: offer.offerId,
      offerOccurrence: offer.offerOccurrence,
      status: CustomerBiteSaverRedemptionPresentationStatus.active,
      usagePolicy:
          offer.usagePolicy ?? CustomerBiteSaverUsagePolicy.oncePerCustomer,
      timerStartedAtMillis:
          expiresAt -
          CustomerBiteSaverSearchContract.redemptionTimerMilliseconds,
      timerExpiresAtMillis: expiresAt,
    );
  }

  int get _redemptionNowMillis =>
      widget.boundedSession?.redemptionPresentationNowMillis ??
      widget.boundedSavedCoordinator?.redemptionPresentationNowMillis ??
      DateTime.now().millisecondsSinceEpoch;

  bool get _boundedSelectionCurrent {
    final boundedRestaurant = widget.boundedRestaurant;
    final boundedOffer = widget.boundedOffer;
    final savedAccess = widget.boundedSavedAccess;
    if (boundedRestaurant == null || boundedOffer == null) {
      return false;
    }
    if (savedAccess != null) {
      return savedAccess.isCurrent &&
          identical(savedAccess.restaurant, boundedRestaurant) &&
          identical(savedAccess.offer, boundedOffer) &&
          savedAccess.restaurant.restaurantId ==
              boundedRestaurant.restaurantId &&
          savedAccess.offer?.offerId == boundedOffer.offerId &&
          savedAccess.offer?.offerOccurrence == boundedOffer.offerOccurrence;
    }
    final session = widget.boundedSession;
    final access = widget.boundedAccess;
    if (session == null || access == null) {
      return false;
    }
    final current = session.currentAcceptedOfferSelectionForAccess(
      access,
      boundedRestaurant.restaurantId,
      boundedOffer.offerId,
    );
    return current != null &&
        current.offer.offerOccurrence == boundedOffer.offerOccurrence;
  }

  String _displayText(String value, String fallback) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? fallback : trimmed;
  }

  @override
  void initState() {
    super.initState();
    if (widget.boundedOffer != null) {
      widget.boundedSession?.addListener(_handleBoundedFavoriteChange);
      widget.boundedSavedCoordinator?.addListener(_handleBoundedFavoriteChange);
      _isCustomerVisibleOffer =
          _boundedSelectionCurrent &&
          (widget.boundedSavedAccess != null || widget.boundedOffer!.available);
      isLoading = false;
      _syncCountdownTicker();
      return;
    }
    DemoRedemptionStore.changes.addListener(_handleRedemptionStoreChange);
    _initializeRedemptionState();
  }

  @override
  void dispose() {
    widget.boundedSession?.removeListener(_handleBoundedFavoriteChange);
    widget.boundedSavedCoordinator?.removeListener(
      _handleBoundedFavoriteChange,
    );
    if (widget.boundedOffer == null) {
      DemoRedemptionStore.changes.removeListener(_handleRedemptionStoreChange);
    }
    _countdownTicker?.cancel();
    super.dispose();
  }

  void _handleBoundedFavoriteChange() {
    if (!mounted) return;
    _syncCountdownTicker();
    setState(() {});
  }

  CustomerBiteSaverFavoriteState get _boundedFavoriteState {
    final offer = widget.boundedOffer;
    if (offer == null) {
      return _isFavoriteCoupon
          ? CustomerBiteSaverFavoriteState.favorite
          : CustomerBiteSaverFavoriteState.notFavorite;
    }
    return widget.boundedSession?.offerFavoriteState(offer.offerId) ??
        widget.boundedSavedCoordinator?.offerFavoriteState(offer.offerId) ??
        CustomerBiteSaverFavoriteState.unknown;
  }

  Future<void> _initializeRedemptionState() async {
    try {
      final redemptionStoreInitializer = widget.initializeRedemptionStore;
      if (redemptionStoreInitializer == null) {
        await DemoRedemptionStore.ensureInitialized();
      } else {
        await redemptionStoreInitializer();
      }
      final favoriteLoader = widget.loadFavoriteState;
      _isFavoriteCoupon = favoriteLoader == null
          ? await BiteScoreService.isCouponFavoritedByCurrentUser(
              widget.coupon.id,
            )
          : await favoriteLoader(widget.coupon.id);
      try {
        final visibilityLoader = widget.loadCustomerVisibility;
        _isCustomerVisibleOffer = visibilityLoader == null
            ? await RestaurantAccountService.isCouponCustomerVisible(
                widget.coupon,
                restaurant: widget.restaurant,
              )
            : await visibilityLoader(widget.coupon, widget.restaurant);
      } catch (_) {
        _isCustomerVisibleOffer = false;
      }
      _syncCountdownTicker();
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  Future<bool> _refreshCustomerVisibleOffer() async {
    final boundedOffer = widget.boundedOffer;
    if (boundedOffer != null) {
      final available = _boundedSelectionCurrent && boundedOffer.available;
      if (mounted) {
        setState(() => _isCustomerVisibleOffer = available);
      }
      return available;
    }
    try {
      final visibilityLoader = widget.loadCustomerVisibility;
      final isCustomerVisibleOffer = visibilityLoader == null
          ? await RestaurantAccountService.isCouponCustomerVisible(
              widget.coupon,
              restaurant: widget.restaurant,
            )
          : await visibilityLoader(widget.coupon, widget.restaurant);
      if (mounted) {
        setState(() {
          _isCustomerVisibleOffer = isCustomerVisibleOffer;
        });
      }
      return isCustomerVisibleOffer;
    } catch (_) {
      return false;
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

  void _handleRedemptionStoreChange() {
    if (!mounted) return;
    _syncCountdownTicker();
    setState(() {});
  }

  void _syncCountdownTicker() {
    _countdownTicker?.cancel();

    final bounded = _boundedRedemption;
    final boundedActive =
        bounded != null &&
        !bounded.isUnlimited &&
        bounded.isActiveAt(_redemptionNowMillis);
    final legacyActive =
        widget.boundedOffer == null &&
        _supportsRedeemTimer &&
        DemoRedemptionStore.hasActiveRedeemTimer(widget.coupon.id);
    if (!boundedActive && !legacyActive) {
      _countdownTicker = null;
      return;
    }

    _countdownTicker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;

      final currentBounded = _boundedRedemption;
      final currentBoundedActive =
          currentBounded != null &&
          !currentBounded.isUnlimited &&
          currentBounded.isActiveAt(_redemptionNowMillis);
      final currentLegacyActive =
          widget.boundedOffer == null &&
          DemoRedemptionStore.hasActiveRedeemTimer(widget.coupon.id);
      if (!currentBoundedActive && !currentLegacyActive) {
        _countdownTicker?.cancel();
        _countdownTicker = null;
      }

      setState(() {});
    });
  }

  Future<void> _startRedeemTimer() async {
    if (isRedeeming || _isConfirmingUse || !_supportsCouponUse) return;
    if (!_isCustomerVisibleOffer) {
      _showSnackBar('This offer is no longer available.');
      return;
    }

    final boundedAction = widget.useBoundedCoupon;
    if (widget.boundedOffer != null) {
      if (boundedAction == null || !_boundedSelectionCurrent) return;
      setState(() => _isConfirmingUse = true);
      try {
        final confirmed = await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('Use this coupon now?'),
            content: Text(
              _supportsRedeemTimer
                  ? 'Using it starts the five-minute coupon timer. Start only when you are ready to pay.'
                  : 'Show this coupon when you are ready to pay.',
            ),
            actions: [
              TextButton(
                key: const ValueKey<String>('bitesaver_use_cancel'),
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                key: const ValueKey<String>('bitesaver_use_confirm'),
                onPressed: () => Navigator.of(dialogContext).pop(true),
                child: const Text('Use Coupon'),
              ),
            ],
          ),
        );
        if (!mounted || confirmed != true) return;
        setState(() {
          _isConfirmingUse = false;
          isRedeeming = true;
        });
        final presentation = await boundedAction(context);
        if (!mounted) return;
        setState(() => _confirmedRedemption = presentation);
        _syncCountdownTicker();
        _showSnackBar(
          presentation.isUnlimited
              ? 'Your coupon is ready to show.'
              : presentation.status ==
                    CustomerBiteSaverRedemptionPresentationStatus.active
              ? 'Your existing coupon timer is still active.'
              : 'Your 5-minute coupon timer has started.',
        );
      } on CustomerBiteSaverRedemptionDeniedException catch (error) {
        if (mounted) _showSnackBar(_redemptionDenialMessage(error.decision));
      } catch (error) {
        if (mounted) {
          _showSnackBar(
            AppErrorText.friendly(
              error,
              fallback: 'Could not use this coupon right now. Try again.',
            ),
          );
        }
      } finally {
        if (mounted) {
          setState(() {
            _isConfirmingUse = false;
            isRedeeming = false;
          });
        }
      }
      return;
    }

    if (FirebaseAuth.instance.currentUser == null) {
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => const CustomerAccountScreen(showAppBar: true),
        ),
      );

      if (!mounted || FirebaseAuth.instance.currentUser == null) {
        return;
      }
    }

    final isCustomerVisibleOffer = await _refreshCustomerVisibleOffer();
    if (!mounted) {
      return;
    }
    if (!isCustomerVisibleOffer) {
      _showSnackBar('This offer is no longer available.');
      return;
    }

    setState(() {
      isRedeeming = true;
    });

    try {
      await DemoRedemptionStore.startRedeemTimer(widget.coupon);
      _syncCountdownTicker();

      if (!mounted) return;

      _showSnackBar('Your 5-minute redeem timer has started.');
    } catch (error) {
      if (!mounted) return;

      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not start the redeem timer right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          isRedeeming = false;
        });
      }
    }
  }

  Future<void> _toggleCouponFavorite() async {
    final boundedOffer = widget.boundedOffer;
    final boundedRestaurant = widget.boundedRestaurant;
    if (boundedOffer != null && boundedRestaurant != null) {
      if (boundedOffer.offerType != CustomerBiteSaverOfferType.coupon ||
          _isSavingFavoriteCoupon ||
          _boundedFavoriteState == CustomerBiteSaverFavoriteState.unknown) {
        return;
      }
      final nextIsFavorite =
          _boundedFavoriteState != CustomerBiteSaverFavoriteState.favorite;
      setState(() => _isSavingFavoriteCoupon = true);
      try {
        final session = widget.boundedSession;
        if (session != null) {
          await session.setOfferFavorite(boundedOffer.offerId, nextIsFavorite);
        } else {
          await widget.boundedSavedCoordinator!.setOfferFavorite(
            boundedRestaurant,
            boundedOffer,
            nextIsFavorite,
          );
        }
        if (!mounted) return;
        _showSnackBar(
          nextIsFavorite
              ? 'Saved coupon to your profile.'
              : 'Removed coupon from your saved list.',
        );
      } catch (error) {
        if (!mounted) return;
        _showSnackBar(
          AppErrorText.friendly(
            error,
            fallback: 'Could not update this saved coupon right now.',
          ),
        );
      } finally {
        if (mounted) setState(() => _isSavingFavoriteCoupon = false);
      }
      return;
    }
    final canSave = await BiteScoreSignInGate.ensureSignedInForFavorites(
      context,
      returnToOriginAfterSignIn: true,
    );
    if (!canSave || !mounted || _isSavingFavoriteCoupon) {
      return;
    }

    final nextIsFavorite = !_isFavoriteCoupon;

    setState(() {
      _isSavingFavoriteCoupon = true;
      _isFavoriteCoupon = nextIsFavorite;
    });

    try {
      await BiteScoreService.setCouponFavorite(
        coupon: widget.coupon,
        isFavorite: nextIsFavorite,
        restaurant: widget.restaurant,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar(
        nextIsFavorite
            ? 'Saved coupon to your profile.'
            : 'Removed coupon from your saved list.',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _isFavoriteCoupon = !nextIsFavorite;
      });
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not update this saved coupon right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSavingFavoriteCoupon = false;
        });
      }
    }
  }

  Future<void> _reportCoupon() async {
    if (widget.boundedOffer != null || _isSubmittingReport) {
      return;
    }

    final report = await showDialog<BiteSaverReportResult>(
      context: context,
      builder: (context) => const BiteSaverReportDialog(),
    );

    if (report == null || !mounted) {
      return;
    }

    setState(() {
      _isSubmittingReport = true;
    });

    try {
      await BiteSaverReportService.submitReport(
        reportType: 'coupon',
        couponId: widget.coupon.id,
        reason: report.reason,
        note: report.note,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar('Thanks — we’ll review this.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not submit this report right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSubmittingReport = false;
        });
      }
    }
  }

  Future<void> _openRestaurantProfile() async {
    if (_isOpeningRestaurant) {
      return;
    }

    setState(() {
      _isOpeningRestaurant = true;
    });

    try {
      final boundedOpener = widget.openBoundedRestaurant;
      if (widget.boundedOffer != null) {
        if (boundedOpener != null && _boundedSelectionCurrent) {
          await boundedOpener(context);
        }
        return;
      }
      final restaurant =
          widget.restaurant ?? await _findRestaurantForCoupon(widget.coupon);
      if (!mounted) {
        return;
      }

      if (restaurant == null) {
        _showSnackBar('Restaurant profile is not available right now.');
        return;
      }

      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => RestaurantProfileScreen(restaurant: restaurant),
        ),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not open this restaurant right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isOpeningRestaurant = false;
        });
      }
    }
  }

  Future<Restaurant?> _findRestaurantForCoupon(Coupon coupon) async {
    final accountDocumentId = coupon.restaurantAccountId?.trim();
    if (accountDocumentId == null || accountDocumentId.isEmpty) {
      return null;
    }
    final projectionData =
        await RestaurantAccountService.loadCustomerRestaurantProjectionById(
          accountDocumentId,
        );
    if (RestaurantAccountService.customerRestaurantFromProjectionData(
          projectionData,
          expectedRestaurantId: accountDocumentId,
        ) ==
        null) {
      return null;
    }
    final coupons = await RestaurantAccountService.loadCoupons(
      accountDocumentId,
    );
    return RestaurantAccountService.customerRestaurantFromProjectionData(
      projectionData,
      expectedRestaurantId: accountDocumentId,
      coupons: coupons,
    );
  }

  String _expiredMessage() {
    return switch (widget.coupon.usageRule.trim().toLowerCase()) {
      'once per customer' =>
        'This coupon has expired and is no longer available.',
      'once per day' =>
        'This coupon has expired for today and will be available again tomorrow.',
      _ => 'This coupon is no longer available.',
    };
  }

  String _redemptionDenialMessage(
    CustomerBiteSaverRedemptionDecision decision,
  ) => switch (decision.reason) {
    'used' || 'localUsageUnavailable' =>
      decision.nextAvailableAtMillis == null
          ? 'This coupon has already been used.'
          : 'This coupon is not available again yet.',
    'outsideProximity' =>
      'Move within this coupon’s required distance and try again.',
    'missingFreshLocation' || 'typedLocation' =>
      'A fresh current location is required to use this coupon.',
    'expired' => 'This coupon has expired.',
    'notStarted' ||
    'outsideTimeWindow' ||
    'wrongDay' => 'This coupon is not available at this time.',
    'usageUnknown' =>
      'Coupon-use history could not be verified. Try again before using it.',
    _ => 'This coupon is no longer available to use.',
  };

  String? _unavailableStatusText({
    required DateTime now,
    required bool isWithinSchedule,
    required bool isAvailableByUsage,
    required bool hasActiveTimer,
  }) {
    final boundedOffer = widget.boundedOffer;
    if (boundedOffer != null) {
      final presentation = _boundedRedemption;
      if (presentation != null &&
          presentation.isActiveAt(_redemptionNowMillis)) {
        return null;
      }
      return (widget.boundedSavedAccess != null || boundedOffer.available) &&
              _boundedSelectionCurrent
          ? null
          : 'This offer is no longer available.';
    }
    if (!_isCustomerVisibleOffer) {
      return 'This offer is no longer available.';
    }

    if (widget.coupon.isScheduledForFutureAt(now)) {
      return widget.coupon.startsLabel ?? 'Currently unavailable';
    }

    if (widget.coupon.isExpiredAt(now)) {
      return 'Coupon expired';
    }

    if (!isWithinSchedule) {
      return 'Currently unavailable';
    }

    if (_supportsRedeemTimer && !hasActiveTimer && !isAvailableByUsage) {
      return _expiredMessage();
    }

    return null;
  }

  String _formatDuration(Duration duration) {
    final totalSeconds = duration.inSeconds.clamp(0, 999999);
    final minutes = totalSeconds ~/ 60;
    final seconds = totalSeconds % 60;
    return '${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
  }

  Widget _buildFavoriteAction() {
    final state = _boundedFavoriteState;
    final known = state != CustomerBiteSaverFavoriteState.unknown;
    final favorite = state == CustomerBiteSaverFavoriteState.favorite;
    return IconButton(
      tooltip: known
          ? favorite
                ? 'Unsave coupon'
                : 'Save coupon'
          : 'Saved status unavailable',
      onPressed: _isSavingFavoriteCoupon || !known
          ? null
          : _toggleCouponFavorite,
      icon: Icon(
        known
            ? favorite
                  ? Icons.favorite
                  : Icons.favorite_border
            : Icons.help_outline,
        color: favorite ? Colors.red.shade400 : _detailAccent,
      ),
    );
  }

  Widget _couponSurface({required Widget child}) {
    final radius = BorderRadius.circular(22);

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: radius,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            BiteSaverColors.surface,
            BiteSaverColors.secondaryBackground,
            BiteSaverColors.subtleSurface,
          ],
        ),
        border: Border.all(color: BiteSaverColors.border, width: 1.15),
        boxShadow: const [
          BoxShadow(
            color: Color.fromRGBO(15, 23, 42, 0.10),
            blurRadius: 18,
            offset: Offset(0, 9),
          ),
          BoxShadow(
            color: Color.fromRGBO(15, 23, 42, 0.05),
            blurRadius: 0,
            offset: Offset(0, 3),
          ),
          BoxShadow(
            color: Color.fromRGBO(255, 255, 255, 0.72),
            blurRadius: 2,
            offset: Offset(0, -1),
          ),
        ],
      ),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: radius,
          border: Border.all(color: const Color(0xEFFFFFFF), width: 0.8),
        ),
        child: child,
      ),
    );
  }

  Widget _detailLine(String label, String value, {Key? key}) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return const SizedBox.shrink();
    }

    return Padding(
      key: key,
      padding: const EdgeInsets.only(top: 7),
      child: RichText(
        text: TextSpan(
          style: const TextStyle(
            color: _detailValueInk,
            fontSize: 14,
            height: 1.25,
            fontWeight: FontWeight.w500,
          ),
          children: [
            TextSpan(
              text: '$label: ',
              style: const TextStyle(
                color: _detailLabelInk,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.08,
              ),
            ),
            TextSpan(text: trimmed),
          ],
        ),
      ),
    );
  }

  Widget _redeemButtonShell({required Widget child, required bool enabled}) {
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        gradient: enabled
            ? const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Color(0xFFE6A06A),
                  Color(0xFFD06C3B),
                  Color(0xFFB7542D),
                ],
              )
            : const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [BiteSaverColors.subtleSurface, BiteSaverColors.border],
              ),
        border: Border.all(
          color: enabled
              ? const Color(0xFFFFD2B4)
              : BiteSaverColors.borderStrong,
          width: 0.8,
        ),
        boxShadow: enabled
            ? const [
                BoxShadow(
                  color: Color.fromRGBO(15, 23, 42, 0.16),
                  blurRadius: 12,
                  offset: Offset(0, 7),
                ),
                BoxShadow(
                  color: Color.fromRGBO(255, 255, 255, 0.26),
                  blurRadius: 1.5,
                  offset: Offset(0, -0.5),
                ),
              ]
            : const [],
      ),
      child: child,
    );
  }

  @override
  Widget build(BuildContext context) {
    final coupon = widget.coupon;
    final boundedOffer = widget.boundedOffer;
    final boundedPresentation = boundedOffer == null
        ? null
        : CustomerBiteSaverOfferPresentation.fromOffer(boundedOffer);

    if (isLoading) {
      return Scaffold(
        backgroundColor: _pageBackground,
        appBar: AppBar(
          leadingWidth: 64,
          leading: IconButton(
            tooltip: MaterialLocalizations.of(context).backButtonTooltip,
            onPressed: () => Navigator.of(context).maybePop(),
            padding: const EdgeInsets.all(16),
            constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
            icon: const BackButtonIcon(),
          ),
          title: Text(
            boundedOffer == null ? 'Coupon Details' : 'Offer Details',
          ),
          centerTitle: true,
          backgroundColor: _pageBackground,
          surfaceTintColor: _pageBackground,
          elevation: 0,
        ),
        bottomNavigationBar: const PersistentBottomNavigation(
          mode: AppMode.biteSaver,
        ),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    final now = widget.boundedOffer == null
        ? DateTime.now()
        : DateTime.fromMillisecondsSinceEpoch(_redemptionNowMillis);
    final boundedRedemption = _boundedRedemption;
    final boundedActive =
        boundedRedemption != null &&
        !boundedRedemption.isUnlimited &&
        boundedRedemption.isActiveAt(now.millisecondsSinceEpoch);
    final boundedUnlimitedReady = boundedRedemption?.isUnlimited == true;
    final isWithinSchedule = boundedOffer == null
        ? coupon.isActiveAt(now)
        : widget.boundedSavedAccess != null || boundedOffer.available;
    final hasActiveTimer = boundedOffer == null
        ? _supportsRedeemTimer &&
              DemoRedemptionStore.hasActiveRedeemTimer(coupon.id)
        : boundedActive;
    final isAvailableByUsage = boundedOffer == null
        ? (!_supportsRedeemTimer ||
              DemoRedemptionStore.isAvailable(coupon.id, coupon.usageRule))
        : boundedRedemption == null ||
              boundedRedemption.usagePolicy !=
                  CustomerBiteSaverUsagePolicy.oncePerCustomer;
    final canStartRedeemTimer =
        _supportsCouponUse &&
        _isCustomerVisibleOffer &&
        isWithinSchedule &&
        isAvailableByUsage &&
        !hasActiveTimer &&
        !boundedUnlimitedReady &&
        (boundedOffer == null || widget.useBoundedCoupon != null);
    final showExpiredMessage =
        boundedOffer == null &&
        _supportsRedeemTimer &&
        isWithinSchedule &&
        !hasActiveTimer &&
        !isAvailableByUsage;
    final remaining = !hasActiveTimer
        ? null
        : boundedOffer == null
        ? DemoRedemptionStore.activeTimerRemaining(coupon.id)
        : Duration(
            milliseconds:
                boundedRedemption!.timerExpiresAtMillis! -
                now.millisecondsSinceEpoch,
          );
    final titleLabel = _displayText(
      coupon.title,
      boundedOffer == null ? 'Untitled coupon' : 'Untitled offer',
    );
    final restaurantLabel = _displayText(
      coupon.restaurant,
      widget.restaurant?.name ?? '',
    );
    final usageRuleLabel =
        boundedPresentation?.usageLabel ??
        (boundedOffer == null
            ? _displayText(coupon.usageRule, Coupon.defaultUsageRule)
            : '');
    final unavailableStatus = _unavailableStatusText(
      now: now,
      isWithinSchedule: isWithinSchedule,
      isAvailableByUsage: isAvailableByUsage,
      hasActiveTimer: hasActiveTimer,
    );
    final couponNumberLabel = coupon.formattedCouponNumber;
    final visibleCouponNumberLabel =
        couponNumberLabel != null &&
            BiteSaverCouponNumberVisibility.shouldShow(
              supportsRedeemTimer: _supportsRedeemTimer,
              hasActiveTimer: hasActiveTimer || boundedUnlimitedReady,
            )
        ? couponNumberLabel
        : null;

    return Scaffold(
      backgroundColor: _pageBackground,
      appBar: AppBar(
        leadingWidth: 64,
        leading: IconButton(
          tooltip: MaterialLocalizations.of(context).backButtonTooltip,
          onPressed: () => Navigator.of(context).maybePop(),
          padding: const EdgeInsets.all(16),
          constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
          icon: const BackButtonIcon(),
        ),
        title: Text(boundedOffer == null ? 'Coupon Details' : 'Offer Details'),
        centerTitle: true,
        backgroundColor: _pageBackground,
        surfaceTintColor: _pageBackground,
        elevation: 0,
      ),
      bottomNavigationBar: const PersistentBottomNavigation(
        mode: AppMode.biteSaver,
      ),
      body: Column(
        children: [
          buildPersistentAppModeSwitcher(context),
          Expanded(
            child: DecoratedBox(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    _pageBackground,
                    BiteSaverColors.secondaryBackground,
                  ],
                ),
              ),
              child: SingleChildScrollView(
                padding: EdgeInsets.fromLTRB(
                  16,
                  16,
                  16,
                  16 + MediaQuery.of(context).viewPadding.bottom,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _couponSurface(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (coupon.imageUrl != null &&
                                coupon.imageUrl!.trim().isNotEmpty) ...[
                              ClipRRect(
                                borderRadius: BorderRadius.circular(16),
                                child: Image.network(
                                  coupon.imageUrl!,
                                  width: double.infinity,
                                  height: 168,
                                  fit: BoxFit.cover,
                                  errorBuilder: (context, error, stackTrace) =>
                                      Container(
                                        height: 168,
                                        alignment: Alignment.center,
                                        color: BiteSaverColors.imageFallback,
                                        child: const Icon(
                                          Icons.local_offer_outlined,
                                          color: _detailAccent,
                                          size: 34,
                                        ),
                                      ),
                                ),
                              ),
                              const SizedBox(height: 12),
                            ],
                            BiteSaverCouponDetailInfoSection(
                              title: titleLabel,
                              details: coupon.details,
                              expiresLabel: boundedPresentation == null
                                  ? coupon.shortExpiresLabel
                                  : boundedPresentation.expiresLabel ?? '',
                              restaurantName: restaurantLabel,
                              usageRule: usageRuleLabel,
                              showUnlimitedUsage: boundedOffer != null,
                              unavailableStatus: unavailableStatus,
                              isOpeningRestaurant: _isOpeningRestaurant,
                              onOpenRestaurant: restaurantLabel.trim().isEmpty
                                  ? null
                                  : _openRestaurantProfile,
                              trailingTitleAction:
                                  boundedOffer == null ||
                                      boundedOffer.offerType ==
                                          CustomerBiteSaverOfferType.coupon
                                  ? _buildFavoriteAction()
                                  : null,
                            ),
                            if (boundedPresentation != null) ...[
                              _detailLine(
                                'Offer type',
                                boundedPresentation.offerTypeLabel,
                                key: CouponDetailScreen.boundedOfferTypeKey,
                              ),
                              if (boundedPresentation.availabilityLabel != null)
                                _detailLine(
                                  'Availability',
                                  boundedPresentation.availabilityLabel!,
                                  key:
                                      CouponDetailScreen.boundedAvailabilityKey,
                                ),
                              if (boundedPresentation.scheduleLabel != null)
                                _detailLine(
                                  'Schedule',
                                  boundedPresentation.scheduleLabel!,
                                  key: CouponDetailScreen.boundedScheduleKey,
                                ),
                              if (boundedPresentation.startsLabel != null)
                                _detailLine(
                                  'Starts',
                                  boundedPresentation.startsLabel!,
                                  key: CouponDetailScreen.boundedStartsKey,
                                ),
                              if (boundedPresentation.endsLabel != null)
                                _detailLine(
                                  'Ends',
                                  boundedPresentation.endsLabel!,
                                  key: CouponDetailScreen.boundedEndsKey,
                                ),
                            ],
                            if (coupon.couponCode != null &&
                                coupon.couponCode!.trim().isNotEmpty) ...[
                              _detailLine('Code', coupon.couponCode!),
                            ],
                            if (coupon.isProximityOnly) ...[
                              const SizedBox(height: 16),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 10,
                                  vertical: 6,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.red.shade50,
                                  borderRadius: BorderRadius.circular(999),
                                  border: Border.all(
                                    color: Colors.red.shade200,
                                  ),
                                ),
                                child: const Text(
                                  'Proximity-only coupon',
                                  style: TextStyle(
                                    color: Colors.red,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ],
                            const SizedBox(height: 4),
                            if (boundedOffer == null)
                              BiteSaverCouponReportRow(
                                isSubmittingReport: _isSubmittingReport,
                                onReport: _reportCoupon,
                                couponNumberLabel: visibleCouponNumberLabel,
                              ),
                          ],
                        ),
                      ),
                    ),
                    if (_supportsCouponUse) ...[
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        child: _redeemButtonShell(
                          enabled:
                              canStartRedeemTimer &&
                              !isRedeeming &&
                              !_isConfirmingUse,
                          child: ElevatedButton(
                            onPressed:
                                (canStartRedeemTimer &&
                                    !isRedeeming &&
                                    !_isConfirmingUse)
                                ? _startRedeemTimer
                                : null,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.transparent,
                              disabledBackgroundColor: Colors.transparent,
                              foregroundColor: Colors.white,
                              disabledForegroundColor: _detailMutedInk,
                              elevation: 0,
                              shadowColor: Colors.transparent,
                              padding: const EdgeInsets.symmetric(vertical: 15),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(999),
                              ),
                              textStyle: const TextStyle(
                                fontWeight: FontWeight.w800,
                                fontSize: 15,
                              ),
                            ),
                            child: Text(
                              isRedeeming
                                  ? 'Preparing Coupon...'
                                  : _isConfirmingUse
                                  ? 'Confirm Use'
                                  : boundedOffer != null &&
                                        widget.useBoundedCoupon == null
                                  ? 'Use Coupon Unavailable'
                                  : hasActiveTimer
                                  ? 'Redeem Timer Active'
                                  : boundedUnlimitedReady
                                  ? 'Coupon Ready'
                                  : boundedOffer != null
                                  ? 'Use Coupon'
                                  : canStartRedeemTimer
                                  ? 'Redeem Coupon'
                                  : 'Not Available',
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      if (hasActiveTimer && remaining != null)
                        Text(
                          'Timer active: ${_formatDuration(remaining)} remaining.',
                          style: const TextStyle(
                            color: _detailAccent,
                            fontWeight: FontWeight.w700,
                          ),
                        )
                      else if (boundedUnlimitedReady)
                        const Text(
                          'Coupon ready to show at checkout.',
                          style: TextStyle(
                            color: _detailAccent,
                            fontWeight: FontWeight.w700,
                          ),
                        )
                      else if (showExpiredMessage)
                        Text(
                          _expiredMessage(),
                          style: const TextStyle(
                            color: Colors.red,
                            fontWeight: FontWeight.w600,
                          ),
                        )
                      else if (!_isCustomerVisibleOffer)
                        const Text(
                          'This offer is no longer available.',
                          style: TextStyle(
                            color: Colors.red,
                            fontWeight: FontWeight.w600,
                          ),
                        )
                      else if (boundedOffer != null &&
                          widget.useBoundedCoupon == null)
                        const Text(
                          'Coupon use is unavailable until customer time is configured.',
                          style: TextStyle(color: _detailMutedInk),
                        )
                      else if (canStartRedeemTimer)
                        Text(
                          _supportsRedeemTimer
                              ? 'Using this coupon starts a 5-minute timer. Tap when ready to pay.'
                              : 'Tap Use Coupon when you are ready to show it.',
                          style: const TextStyle(color: _detailMutedInk),
                        ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

Coupon _customerBiteSaverCouponDetailView(
  CustomerBiteSaverRestaurant restaurant,
  CustomerBiteSaverOffer offer,
) => Coupon(
  id: offer.offerId.value,
  restaurant: restaurant.displayName,
  title: offer.title,
  distance: '${restaurant.distanceMiles} miles',
  expires: offer.expiresText,
  startTime: offer.startAtMillis == null
      ? null
      : DateTime.fromMillisecondsSinceEpoch(
          offer.startAtMillis!,
          isUtc: true,
        ).toLocal(),
  endTime: offer.endAtMillis == null
      ? null
      : DateTime.fromMillisecondsSinceEpoch(
          offer.endAtMillis!,
          isUtc: true,
        ).toLocal(),
  usageRule: offer.redemptionPolicyLabel ?? offer.usageRule ?? '',
  couponCode: offer.couponCode,
  couponNumber: offer.couponNumber,
  isProximityOnly: offer.isProximityOnly,
  proximityRadiusMiles: offer.proximityRadiusMiles,
  details: offer.details,
  imageUrl: offer.imageUrl,
);

Restaurant _customerBiteSaverRestaurantDetailView(
  CustomerBiteSaverRestaurant restaurant,
) => Restaurant(
  name: restaurant.displayName,
  distance: '${restaurant.distanceMiles} miles',
  city: restaurant.city,
  state: restaurant.state,
  zipCode: restaurant.zipCode,
  coupons: const <Coupon>[],
  phone: restaurant.phone,
  streetAddress: restaurant.streetAddress,
  website: restaurant.website,
  bio: restaurant.bio,
  mainImageUrl: restaurant.imageUrl,
  businessHours: restaurant.businessHours
      .map(
        (hours) => RestaurantBusinessHours(
          day: hours.day,
          opensAt: hours.opensAt,
          closesAt: hours.closesAt,
          closed: hours.closed,
        ),
      )
      .toList(growable: false),
  formattedAddress: restaurant.formattedAddress,
);
