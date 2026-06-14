import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../models/coupon.dart';
import '../models/demo_redemption_store.dart';
import '../models/restaurant.dart';
import '../services/app_error_text.dart';
import '../services/app_mode_state_service.dart';
import '../services/bitesaver_report_service.dart';
import '../services/bitescore_sign_in_gate.dart';
import '../services/bitescore_service.dart';
import '../services/restaurant_account_service.dart';
import '../widgets/app_mode_switcher_bar.dart';
import '../widgets/bitesaver_colors.dart';
import '../widgets/bitesaver_report_dialog.dart';
import '../widgets/persistent_bottom_navigation.dart';
import 'customer_account_screen.dart';
import 'restaurant_profile_screen.dart';

class CouponDetailScreen extends StatefulWidget {
  final Coupon coupon;
  final Restaurant? restaurant;

  const CouponDetailScreen({super.key, required this.coupon, this.restaurant});

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
    final showUsage = !BiteSaverCouponDetailInfoSection.isUnlimitedUsage(
      widget.usageRule,
    );
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
  Timer? _countdownTicker;

  bool get _supportsRedeemTimer =>
      DemoRedemptionStore.supportsRedeemTimer(widget.coupon.usageRule);

  String _displayText(String value, String fallback) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? fallback : trimmed;
  }

  @override
  void initState() {
    super.initState();
    DemoRedemptionStore.changes.addListener(_handleRedemptionStoreChange);
    _initializeRedemptionState();
  }

  @override
  void dispose() {
    DemoRedemptionStore.changes.removeListener(_handleRedemptionStoreChange);
    _countdownTicker?.cancel();
    super.dispose();
  }

  Future<void> _initializeRedemptionState() async {
    try {
      await DemoRedemptionStore.ensureInitialized();
      _isFavoriteCoupon = await BiteScoreService.isCouponFavoritedByCurrentUser(
        widget.coupon.id,
      );
      _syncCountdownTicker();
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
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

  void _handleRedemptionStoreChange() {
    if (!mounted) return;
    _syncCountdownTicker();
    setState(() {});
  }

  void _syncCountdownTicker() {
    _countdownTicker?.cancel();

    if (!_supportsRedeemTimer ||
        !DemoRedemptionStore.hasActiveRedeemTimer(widget.coupon.id)) {
      _countdownTicker = null;
      return;
    }

    _countdownTicker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;

      if (!DemoRedemptionStore.hasActiveRedeemTimer(widget.coupon.id)) {
        _countdownTicker?.cancel();
        _countdownTicker = null;
      }

      setState(() {});
    });
  }

  Future<void> _startRedeemTimer() async {
    if (isRedeeming || !_supportsRedeemTimer) return;

    if (FirebaseAuth.instance.currentUser == null) {
      await Navigator.of(
        context,
      ).push(MaterialPageRoute(builder: (_) => const CustomerAccountScreen()));

      if (!mounted || FirebaseAuth.instance.currentUser == null) {
        return;
      }
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
    if (_isSubmittingReport) {
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
    final restaurants =
        await RestaurantAccountService.loadApprovedRestaurantsWithCoupons();
    final couponRestaurant = coupon.restaurant.trim().toLowerCase();
    if (couponRestaurant.isEmpty) {
      return null;
    }

    for (final restaurant in restaurants) {
      if (restaurant.name.trim().toLowerCase() == couponRestaurant) {
        return restaurant;
      }
    }

    return null;
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

  String? _unavailableStatusText({
    required DateTime now,
    required bool isWithinSchedule,
    required bool isAvailableByUsage,
    required bool hasActiveTimer,
  }) {
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
    return IconButton(
      tooltip: _isFavoriteCoupon ? 'Unsave coupon' : 'Save coupon',
      onPressed: _isSavingFavoriteCoupon ? null : _toggleCouponFavorite,
      icon: Icon(
        _isFavoriteCoupon ? Icons.favorite : Icons.favorite_border,
        color: _isFavoriteCoupon ? Colors.red.shade400 : _detailAccent,
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

  Widget _detailLine(String label, String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return const SizedBox.shrink();
    }

    return Padding(
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
          title: const Text('Coupon Details'),
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

    final now = DateTime.now();
    final isWithinSchedule = coupon.isActiveAt(now);
    final hasActiveTimer =
        _supportsRedeemTimer &&
        DemoRedemptionStore.hasActiveRedeemTimer(coupon.id);
    final isAvailableByUsage =
        !_supportsRedeemTimer ||
        DemoRedemptionStore.isAvailable(coupon.id, coupon.usageRule);
    final canStartRedeemTimer =
        _supportsRedeemTimer &&
        isWithinSchedule &&
        isAvailableByUsage &&
        !hasActiveTimer;
    final showExpiredMessage =
        _supportsRedeemTimer &&
        isWithinSchedule &&
        !hasActiveTimer &&
        !isAvailableByUsage;
    final remaining = hasActiveTimer
        ? DemoRedemptionStore.activeTimerRemaining(coupon.id)
        : null;
    final titleLabel = _displayText(coupon.title, 'Untitled coupon');
    final restaurantLabel = _displayText(
      coupon.restaurant,
      widget.restaurant?.name ?? '',
    );
    final usageRuleLabel = _displayText(
      coupon.usageRule,
      Coupon.defaultUsageRule,
    );
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
              hasActiveTimer: hasActiveTimer,
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
        title: const Text('Coupon Details'),
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
                              expiresLabel: coupon.shortExpiresLabel,
                              restaurantName: restaurantLabel,
                              usageRule: usageRuleLabel,
                              unavailableStatus: unavailableStatus,
                              isOpeningRestaurant: _isOpeningRestaurant,
                              onOpenRestaurant: restaurantLabel.trim().isEmpty
                                  ? null
                                  : _openRestaurantProfile,
                              trailingTitleAction: _buildFavoriteAction(),
                            ),
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
                            BiteSaverCouponReportRow(
                              isSubmittingReport: _isSubmittingReport,
                              onReport: _reportCoupon,
                              couponNumberLabel: visibleCouponNumberLabel,
                            ),
                          ],
                        ),
                      ),
                    ),
                    if (_supportsRedeemTimer) ...[
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        child: _redeemButtonShell(
                          enabled: canStartRedeemTimer && !isRedeeming,
                          child: ElevatedButton(
                            onPressed: (canStartRedeemTimer && !isRedeeming)
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
                                  ? 'Starting Timer...'
                                  : hasActiveTimer
                                  ? 'Redeem Timer Active'
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
                      else if (showExpiredMessage)
                        Text(
                          _expiredMessage(),
                          style: const TextStyle(
                            color: Colors.red,
                            fontWeight: FontWeight.w600,
                          ),
                        )
                      else if (canStartRedeemTimer)
                        const Text(
                          'Tapping redeem starts a 5-minute timer. Tap when ready to pay.',
                          style: TextStyle(color: _detailMutedInk),
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
