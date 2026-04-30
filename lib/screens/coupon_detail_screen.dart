import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../models/coupon.dart';
import '../models/demo_redemption_store.dart';
import '../services/app_error_text.dart';
import '../services/bitesaver_report_service.dart';
import '../services/bitescore_sign_in_gate.dart';
import '../services/bitescore_service.dart';
import '../widgets/app_mode_switcher_bar.dart';
import '../widgets/bitesaver_report_dialog.dart';
import 'customer_account_screen.dart';

class CouponDetailScreen extends StatefulWidget {
  final Coupon coupon;

  const CouponDetailScreen({super.key, required this.coupon});

  @override
  State<CouponDetailScreen> createState() => _CouponDetailScreenState();
}

class _CouponDetailScreenState extends State<CouponDetailScreen> {
  static const Color _pageBackground = Color(0xFFFFFEFC);
  static const Color _warmInk = Color(0xFF1E120B);
  static const Color _warmLabelInk = Color(0xFF332014);
  static const Color _warmValueInk = Color(0xFF665040);
  static const Color _warmMutedInk = Color(0xFF6F5A4A);
  static const Color _warmAccent = Color(0xFFB7613F);

  bool isLoading = true;
  bool isRedeeming = false;
  bool _isFavoriteCoupon = false;
  bool _isSavingFavoriteCoupon = false;
  bool _isSubmittingReport = false;
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

  String _availabilityText() {
    final now = DateTime.now();

    if (widget.coupon.isScheduledForFutureAt(now)) {
      return widget.coupon.startsLabel ?? 'Scheduled';
    }

    if (widget.coupon.isExpiredAt(now)) {
      return 'Expired';
    }

    if (!_supportsRedeemTimer) {
      return 'Available now';
    }

    if (DemoRedemptionStore.hasActiveRedeemTimer(widget.coupon.id)) {
      final remaining = DemoRedemptionStore.activeTimerRemaining(
        widget.coupon.id,
      );
      if (remaining == null) {
        return _expiredMessage();
      }

      return 'Redeem timer: ${_formatDuration(remaining)} remaining';
    }

    final available = DemoRedemptionStore.isAvailable(
      widget.coupon.id,
      widget.coupon.usageRule,
    );

    if (available) {
      return 'Available now';
    }

    return _expiredMessage();
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
        color: _isFavoriteCoupon ? Colors.red.shade400 : _warmAccent,
      ),
    );
  }

  Widget _couponSurface({required Widget child}) {
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFFFFFEFB), Color(0xFFFAF2EA), Color(0xFFF2E4D6)],
        ),
        border: Border.all(color: const Color(0xFFE5D2C2), width: 1),
        boxShadow: const [
          BoxShadow(
            color: Color.fromRGBO(120, 80, 40, 0.20),
            blurRadius: 18,
            offset: Offset(0, 11),
          ),
          BoxShadow(
            color: Color.fromRGBO(120, 80, 40, 0.12),
            blurRadius: 0,
            offset: Offset(0, 2),
          ),
          BoxShadow(
            color: Color.fromRGBO(255, 255, 255, 0.55),
            blurRadius: 2,
            offset: Offset(0, -1),
          ),
        ],
      ),
      child: child,
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
            color: _warmValueInk,
            fontSize: 14,
            height: 1.25,
          ),
          children: [
            TextSpan(
              text: '$label: ',
              style: const TextStyle(
                color: _warmLabelInk,
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
                colors: [Color(0xFFEADFD5), Color(0xFFD8C9BC)],
              ),
        border: Border.all(
          color: enabled ? const Color(0xFFFFD2B4) : const Color(0xFFD7C7B9),
          width: 0.8,
        ),
        boxShadow: enabled
            ? const [
                BoxShadow(
                  color: Color.fromRGBO(90, 42, 18, 0.22),
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
          title: const Text('Coupon Details'),
          centerTitle: true,
          backgroundColor: _pageBackground,
          surfaceTintColor: _pageBackground,
          elevation: 0,
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
    final restaurantLabel = _displayText(coupon.restaurant, 'Restaurant');
    final usageRuleLabel = _displayText(
      coupon.usageRule,
      Coupon.defaultUsageRule,
    );

    return Scaffold(
      backgroundColor: _pageBackground,
      appBar: AppBar(
        title: const Text('Coupon Details'),
        centerTitle: true,
        backgroundColor: _pageBackground,
        surfaceTintColor: _pageBackground,
        elevation: 0,
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
                  colors: [_pageBackground, Color(0xFFF8F1E9)],
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
                        padding: const EdgeInsets.all(18),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: Text(
                                    titleLabel,
                                    style: const TextStyle(
                                      color: _warmInk,
                                      fontSize: 22,
                                      fontWeight: FontWeight.w800,
                                      height: 1.08,
                                      letterSpacing: 0.05,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                _buildFavoriteAction(),
                              ],
                            ),
                            const SizedBox(height: 10),
                            _detailLine('Restaurant', restaurantLabel),
                            _detailLine('Expires', coupon.shortExpiresLabel),
                            _detailLine('Usage', usageRuleLabel),
                            _detailLine('Status', _availabilityText()),
                            if (coupon.couponCode != null &&
                                coupon.couponCode!.trim().isNotEmpty) ...[
                              _detailLine('Code', coupon.couponCode!),
                            ],
                            if (coupon.details != null &&
                                coupon.details!.trim().isNotEmpty) ...[
                              const SizedBox(height: 16),
                              const Text(
                                'Details',
                                style: TextStyle(
                                  color: _warmInk,
                                  fontSize: 16,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                coupon.details!,
                                style: const TextStyle(
                                  color: _warmValueInk,
                                  height: 1.35,
                                ),
                              ),
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
                            const SizedBox(height: 10),
                            Align(
                              alignment: Alignment.centerLeft,
                              child: TextButton.icon(
                                onPressed: _isSubmittingReport
                                    ? null
                                    : _reportCoupon,
                                style: TextButton.styleFrom(
                                  foregroundColor: _warmMutedInk,
                                  padding: EdgeInsets.zero,
                                  tapTargetSize:
                                      MaterialTapTargetSize.shrinkWrap,
                                ),
                                icon: const Icon(Icons.flag_outlined, size: 16),
                                label: const Text('Report'),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    if (_supportsRedeemTimer) ...[
                      const SizedBox(height: 20),
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
                              disabledForegroundColor: _warmMutedInk,
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
                            color: _warmAccent,
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
                          style: TextStyle(color: _warmMutedInk),
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
