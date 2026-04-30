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
        color: _isFavoriteCoupon ? Colors.red.shade400 : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final coupon = widget.coupon;

    if (isLoading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Coupon Details'), centerTitle: true),
        body: Column(
          children: [
            buildPersistentAppModeSwitcher(context),
            const Expanded(child: Center(child: CircularProgressIndicator())),
          ],
        ),
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
      appBar: AppBar(title: const Text('Coupon Details'), centerTitle: true),
      body: Column(
        children: [
          buildPersistentAppModeSwitcher(context),
          Expanded(
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
                  Card(
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
                                    fontSize: 22,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              _buildFavoriteAction(),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Text('Restaurant: $restaurantLabel'),
                          const SizedBox(height: 6),
                          Text(coupon.shortExpiresLabel),
                          const SizedBox(height: 6),
                          Text('Usage rule: $usageRuleLabel'),
                          const SizedBox(height: 6),
                          Text('Status: ${_availabilityText()}'),
                          if (coupon.couponCode != null &&
                              coupon.couponCode!.trim().isNotEmpty) ...[
                            const SizedBox(height: 6),
                            Text('Code: ${coupon.couponCode!}'),
                          ],
                          if (coupon.details != null &&
                              coupon.details!.trim().isNotEmpty) ...[
                            const SizedBox(height: 16),
                            const Text(
                              'Details',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(coupon.details!),
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
                                border: Border.all(color: Colors.red.shade200),
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
                                foregroundColor: Colors.black54,
                                padding: EdgeInsets.zero,
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
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
                      child: ElevatedButton(
                        onPressed: (canStartRedeemTimer && !isRedeeming)
                            ? _startRedeemTimer
                            : null,
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
                    const SizedBox(height: 10),
                    if (hasActiveTimer && remaining != null)
                      Text(
                        'Timer active: ${_formatDuration(remaining)} remaining.',
                        style: const TextStyle(
                          color: Colors.deepOrange,
                          fontWeight: FontWeight.w600,
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
                        style: TextStyle(color: Colors.black54),
                      ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
