import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/demo_redemption_store.dart';
import '../models/coupon.dart';
import '../models/restaurant.dart';
import '../services/app_error_text.dart';
import '../services/app_mode_state_service.dart';
import '../services/bitesaver_report_service.dart';
import '../services/bitescore_sign_in_gate.dart';
import '../services/bitescore_service.dart';
import '../services/restaurant_account_service.dart';
import '../services/restaurant_menu_service.dart';
import '../widgets/bitesaver_report_dialog.dart';
import '../widgets/clickable_phone_text.dart';
import '../widgets/persistent_bottom_navigation.dart';
import 'coupon_detail_screen.dart';
import 'restaurant_menu_screen.dart';

class RestaurantProfileScreen extends StatefulWidget {
  final Restaurant restaurant;

  const RestaurantProfileScreen({super.key, required this.restaurant});

  @override
  State<RestaurantProfileScreen> createState() =>
      _RestaurantProfileScreenState();
}

class _RestaurantProfileScreenState extends State<RestaurantProfileScreen> {
  static const List<String> _restaurantPlaceholderImages = [
    'assets/images/placeholder_outside.png',
    'assets/images/placeholder_kitchen.png',
    'assets/images/placeholder_dining.png',
  ];

  bool _isFavoriteRestaurant = false;
  bool _isSavingFavoriteRestaurant = false;
  bool _showRestaurantInfo = false;
  bool _isSubmittingReport = false;
  double _modeDragProgress = 0;
  AppMode? _pressedMode;
  late Restaurant _restaurant;

  Restaurant get restaurant => _restaurant;

  String _displayText(String value, String fallback) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? fallback : trimmed;
  }

  @override
  void initState() {
    super.initState();
    _restaurant = widget.restaurant;
    _loadFavoriteState();
    _refreshRestaurantDetails();
  }

  Future<void> _loadFavoriteState() async {
    final isFavorite =
        await BiteScoreService.isSaverRestaurantFavoritedByCurrentUser(
          restaurant,
        );
    if (!mounted) {
      return;
    }

    setState(() {
      _isFavoriteRestaurant = isFavorite;
    });
  }

  bool get hasPhone =>
      restaurant.phone != null && restaurant.phone!.trim().isNotEmpty;

  bool get hasWebsite =>
      restaurant.website != null && restaurant.website!.trim().isNotEmpty;

  bool get hasStreetAddress =>
      restaurant.streetAddress != null &&
      restaurant.streetAddress!.trim().isNotEmpty;

  bool get hasBio =>
      restaurant.bio != null && restaurant.bio!.trim().isNotEmpty;

  List<RestaurantBusinessHours> get weeklyHours =>
      restaurant.businessHours.isEmpty
      ? const []
      : RestaurantBusinessHours.normalizedWeek(restaurant.businessHours);

  List<_GroupedRestaurantHours> get groupedWeeklyHours {
    if (weeklyHours.isEmpty) {
      return const [];
    }

    final hoursByDay = {for (final entry in weeklyHours) entry.day: entry};
    final orderedDays = const [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ];
    final orderedHours = [
      for (final day in orderedDays)
        if (hoursByDay[day] != null) hoursByDay[day]!,
    ];

    final groups = <_GroupedRestaurantHours>[];
    for (final entry in orderedHours) {
      if (groups.isNotEmpty && groups.last.matches(entry)) {
        groups.last = groups.last.copyWith(endDay: entry.day);
      } else {
        groups.add(
          _GroupedRestaurantHours(
            startDay: entry.day,
            endDay: entry.day,
            summaryLabel: entry.summaryLabel,
            closed: entry.closed,
          ),
        );
      }
    }

    return groups;
  }

  bool _isFallbackDistanceLabel(String value) {
    return value.trim().isEmpty ||
        value.trim() == Restaurant.defaultDistanceLabel;
  }

  String _distanceLocationLine(Restaurant restaurant) {
    final parts = <String>[
      if (!_isFallbackDistanceLabel(restaurant.distance))
        restaurant.distance.trim(),
      if (restaurant.city.trim().isNotEmpty) restaurant.city.trim(),
    ];
    if (parts.isEmpty) {
      return _displayText(restaurant.zipCode, 'Location unavailable');
    }
    return parts.join(' - ');
  }

  String _couponSubtitle(Coupon coupon) {
    final parts = <String>[
      coupon.shortExpiresLabel.trim(),
      coupon.usageRule.trim(),
    ].where((part) => part.isNotEmpty).toList();
    return parts.isEmpty ? 'Coupon details unavailable' : parts.join(' - ');
  }

  Restaurant _withSafeDistanceLabel(Restaurant freshRestaurant) {
    if (!_isFallbackDistanceLabel(freshRestaurant.distance) ||
        _isFallbackDistanceLabel(restaurant.distance)) {
      return freshRestaurant;
    }

    return Restaurant(
      uid: freshRestaurant.uid,
      name: freshRestaurant.name,
      distance: restaurant.distance,
      city: freshRestaurant.city,
      state: freshRestaurant.state,
      zipCode: freshRestaurant.zipCode,
      coupons: freshRestaurant.coupons,
      dailySpecials: freshRestaurant.dailySpecials,
      phone: freshRestaurant.phone,
      streetAddress: freshRestaurant.streetAddress,
      website: freshRestaurant.website,
      bio: freshRestaurant.bio,
      mainImageUrl: freshRestaurant.mainImageUrl,
      businessHours: freshRestaurant.businessHours,
      latitude: freshRestaurant.latitude,
      longitude: freshRestaurant.longitude,
    );
  }

  Future<void> _refreshRestaurantDetails() async {
    try {
      Restaurant? freshRestaurant;

      final uid = restaurant.uid?.trim();
      if (uid != null && uid.isNotEmpty) {
        final accountData = await RestaurantAccountService.getAccountData(uid);
        if (accountData != null) {
          freshRestaurant = Restaurant.fromFirestore(
            accountData,
            coupons: restaurant.coupons,
            dailySpecials: restaurant.dailySpecials,
          );
        }
      }

      freshRestaurant ??= await _findMatchingApprovedRestaurant();

      if (!mounted || freshRestaurant == null) {
        return;
      }

      setState(() {
        _restaurant = _withSafeDistanceLabel(freshRestaurant!);
      });
    } catch (_) {
      return;
    }
  }

  Future<Restaurant?> _findMatchingApprovedRestaurant() async {
    final approvedRestaurants =
        await RestaurantAccountService.loadApprovedRestaurantsWithCoupons();

    for (final candidate in approvedRestaurants) {
      if (_matchesRestaurantIdentity(candidate, restaurant)) {
        return candidate;
      }
    }

    return null;
  }

  bool _matchesRestaurantIdentity(
    Restaurant candidate,
    Restaurant currentRestaurant,
  ) {
    return _normalizeRestaurantIdentity(candidate.name) ==
            _normalizeRestaurantIdentity(currentRestaurant.name) &&
        _normalizeRestaurantIdentity(candidate.city) ==
            _normalizeRestaurantIdentity(currentRestaurant.city) &&
        _normalizeRestaurantIdentity(candidate.zipCode) ==
            _normalizeRestaurantIdentity(currentRestaurant.zipCode) &&
        _normalizeRestaurantIdentity(candidate.streetAddress ?? '') ==
            _normalizeRestaurantIdentity(currentRestaurant.streetAddress ?? '');
  }

  String _normalizeRestaurantIdentity(String value) {
    return value.trim().toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '');
  }

  String _placeholderImageForRestaurant(Restaurant restaurant) {
    final stableKey = restaurant.uid?.trim().isNotEmpty == true
        ? restaurant.uid!.trim()
        : '${restaurant.name}|${restaurant.city}|${restaurant.zipCode}';
    final hash = stableKey.codeUnits.fold<int>(
      0,
      (value, unit) => (value * 31 + unit) & 0x7fffffff,
    );
    return _restaurantPlaceholderImages[hash %
        _restaurantPlaceholderImages.length];
  }

  Future<void> _showLaunchError(BuildContext context, String message) async {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
      );
  }

  Future<void> _callRestaurant(BuildContext context) async {
    if (!hasPhone) {
      await _showLaunchError(context, 'No phone number available.');
      return;
    }

    final cleanedPhone = restaurant.phone!.replaceAll(RegExp(r'[^0-9+]'), '');
    final uri = Uri(scheme: 'tel', path: cleanedPhone);

    final launched = await launchUrl(uri);
    if (!launched && context.mounted) {
      await _showLaunchError(context, 'Could not open the phone dialer.');
    }
  }

  Future<void> _openWebsite(BuildContext context) async {
    if (!hasWebsite) {
      await _showLaunchError(context, 'No website available.');
      return;
    }

    final rawWebsite = restaurant.website!.trim();
    final normalizedWebsite =
        rawWebsite.startsWith('http://') || rawWebsite.startsWith('https://')
        ? rawWebsite
        : 'https://$rawWebsite';

    final uri = Uri.parse(normalizedWebsite);

    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);

    if (!launched && context.mounted) {
      await _showLaunchError(context, 'Could not open the website.');
    }
  }

  Future<void> _openMenu(BuildContext context) async {
    final uid = restaurant.uid?.trim();
    final source = uid == null || uid.isEmpty
        ? null
        : await RestaurantMenuService.resolveBiteSaverPublicMenuSource(
            uid: uid,
          );

    if (!context.mounted) {
      return;
    }

    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => RestaurantMenuScreen(
          restaurantUid: uid,
          restaurantName: _displayText(restaurant.name, 'Restaurant'),
          source: source,
        ),
      ),
    );
  }

  Future<void> _getDirections(BuildContext context) async {
    final fullAddress = hasStreetAddress
        ? '${restaurant.streetAddress}, ${restaurant.city}, ${restaurant.zipCode}'
        : '${restaurant.city}, ${restaurant.zipCode}';

    final uri = Uri.parse(
      'https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(fullAddress)}',
    );

    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);

    if (!launched && context.mounted) {
      await _showLaunchError(context, 'Could not open directions.');
    }
  }

  Future<void> _toggleRestaurantFavorite() async {
    final canSave = await BiteScoreSignInGate.ensureSignedInForFavorites(
      context,
      returnToOriginAfterSignIn: true,
    );
    if (!canSave || !mounted || _isSavingFavoriteRestaurant) {
      return;
    }

    final nextIsFavorite = !_isFavoriteRestaurant;

    setState(() {
      _isSavingFavoriteRestaurant = true;
      _isFavoriteRestaurant = nextIsFavorite;
    });

    try {
      await BiteScoreService.setSaverRestaurantFavorite(
        restaurant: restaurant,
        isFavorite: nextIsFavorite,
      );
      if (!mounted) {
        return;
      }
      await _showLaunchError(
        context,
        nextIsFavorite
            ? 'Saved restaurant to your profile.'
            : 'Removed restaurant from your saved list.',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _isFavoriteRestaurant = !nextIsFavorite;
      });
      await _showLaunchError(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not update this saved restaurant right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSavingFavoriteRestaurant = false;
        });
      }
    }
  }

  Future<void> _reportRestaurant() async {
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
        reportType: 'restaurant',
        restaurantId: restaurant.uid,
        reason: report.reason,
        note: report.note,
      );
      if (!mounted) {
        return;
      }
      await _showLaunchError(context, 'Thanks — we’ll review this.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      await _showLaunchError(
        context,
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

  List<BoxShadow> _biteSaverTileShadows({double strength = 0.9}) {
    return [
      BoxShadow(
        color: Color.fromRGBO(84, 48, 18, 0.16 * strength),
        blurRadius: 14,
        offset: const Offset(0, 8),
      ),
      BoxShadow(
        color: Color.fromRGBO(120, 80, 40, 0.10 * strength),
        blurRadius: 3,
        offset: const Offset(0, 2),
      ),
      BoxShadow(
        color: Color.fromRGBO(255, 255, 255, 0.35 * strength),
        blurRadius: 1.5,
        offset: const Offset(0, -0.5),
      ),
    ];
  }

  Widget _biteSaverRaisedSurface({
    required Widget child,
    BorderRadius? borderRadius,
    EdgeInsetsGeometry innerMargin = const EdgeInsets.all(1.8),
    double shadowStrength = 0.9,
  }) {
    final shellRadius = borderRadius ?? BorderRadius.circular(16);

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: shellRadius,
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Color(0xFFEEDBC9),
            Color(0xFFD8BEA3),
            Color(0xFFC7A17B),
            Color(0xFFB58B63),
          ],
          stops: [0.0, 0.34, 0.72, 1.0],
        ),
        border: Border.all(color: const Color(0x66EED8B2), width: 1),
        boxShadow: [
          const BoxShadow(
            color: Color.fromRGBO(120, 80, 40, 0.30),
            offset: Offset(0, 2),
            blurRadius: 0,
          ),
          ..._biteSaverTileShadows(strength: shadowStrength),
        ],
      ),
      child: Padding(
        padding: innerMargin,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: shellRadius,
            gradient: const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFFFFFBF8), Color(0xFFF7EDE3), Color(0xFFEEDDCB)],
            ),
            border: Border.all(color: const Color(0xF7FFFFFF), width: 0.7),
          ),
          child: child,
        ),
      ),
    );
  }

  Widget _buildCompactActionButton({
    required IconData icon,
    required String label,
    required bool enabled,
    required VoidCallback onPressed,
  }) {
    return SizedBox(
      width: double.infinity,
      child: _biteSaverRaisedSurface(
        borderRadius: BorderRadius.circular(999),
        innerMargin: const EdgeInsets.all(1.2),
        shadowStrength: enabled ? 0.56 : 0.2,
        child: ElevatedButton.icon(
          onPressed: enabled ? onPressed : null,
          icon: Icon(icon, size: 16),
          label: Text(label, overflow: TextOverflow.ellipsis),
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.transparent,
            foregroundColor: const Color(0xFF9F4F34),
            disabledBackgroundColor: Colors.transparent,
            disabledForegroundColor: const Color(0xFF9A8B80),
            elevation: 0,
            shadowColor: Colors.transparent,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
            minimumSize: const Size(0, 40),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            textStyle: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(999),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildRestaurantProfileImage() {
    final imageUrl = restaurant.mainImageUrl?.trim();
    final fallbackAsset = _placeholderImageForRestaurant(restaurant);

    return _biteSaverRaisedSurface(
      borderRadius: BorderRadius.circular(18),
      innerMargin: const EdgeInsets.all(1.3),
      shadowStrength: 0.52,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: AspectRatio(
          aspectRatio: 1.08,
          child: imageUrl != null && imageUrl.isNotEmpty
              ? Image.network(
                  imageUrl,
                  fit: BoxFit.cover,
                  errorBuilder: (context, error, stackTrace) =>
                      Image.asset(fallbackAsset, fit: BoxFit.cover),
                )
              : Image.asset(fallbackAsset, fit: BoxFit.cover),
        ),
      ),
    );
  }

  Widget _buildCompactProfileActions() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        _buildCompactActionButton(
          icon: Icons.call,
          label: 'Call',
          enabled: hasPhone,
          onPressed: () {
            _callRestaurant(context);
          },
        ),
        const SizedBox(height: 7),
        _buildCompactActionButton(
          icon: Icons.directions,
          label: 'Directions',
          enabled: true,
          onPressed: () {
            _getDirections(context);
          },
        ),
        const SizedBox(height: 7),
        _buildRestaurantInformationTile(compact: true),
      ],
    );
  }

  Widget _buildExpandableInfoTile({
    required String title,
    required bool isExpanded,
    required ValueChanged<bool> onExpansionChanged,
    required Widget child,
    bool compact = false,
  }) {
    return _biteSaverRaisedSurface(
      borderRadius: BorderRadius.circular(18),
      innerMargin: const EdgeInsets.all(1.4),
      shadowStrength: 0.64,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            InkWell(
              onTap: () => onExpansionChanged(!isExpanded),
              child: SizedBox(
                height: compact ? 40 : 56,
                width: double.infinity,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    Text(
                      title,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: const Color(0xFF9F4F34),
                        fontSize: compact ? 13 : 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Positioned(
                      right: compact ? 8 : 14,
                      child: AnimatedRotation(
                        turns: isExpanded ? 0.5 : 0,
                        duration: const Duration(milliseconds: 200),
                        curve: Curves.easeOut,
                        child: const Icon(
                          Icons.expand_more,
                          size: 20,
                          color: Color(0xFF9F4F34),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            AnimatedCrossFade(
              firstChild: const SizedBox(width: double.infinity),
              secondChild: Padding(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                child: Align(alignment: Alignment.centerLeft, child: child),
              ),
              crossFadeState: isExpanded
                  ? CrossFadeState.showSecond
                  : CrossFadeState.showFirst,
              duration: const Duration(milliseconds: 200),
              sizeCurve: Curves.easeOut,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRestaurantInformationTile({bool compact = false}) {
    return _buildExpandableInfoTile(
      title: 'Restaurant Information',
      isExpanded: _showRestaurantInfo,
      onExpansionChanged: (expanded) =>
          setState(() => _showRestaurantInfo = expanded),
      compact: compact,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (hasBio) ...[
            const Text(
              'About',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            Text(restaurant.bio!, style: const TextStyle(fontSize: 14)),
            const SizedBox(height: 14),
          ],
          InkWell(
            onTap: () {
              _openMenu(context);
            },
            borderRadius: BorderRadius.circular(8),
            child: const Padding(
              padding: EdgeInsets.symmetric(vertical: 2),
              child: Text(
                'Menu',
                style: TextStyle(
                  color: Color(0xFF2563EB),
                  decoration: TextDecoration.underline,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
          const SizedBox(height: 14),
          const Text(
            'Hours',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          if (weeklyHours.isEmpty)
            const Text('Hours not set')
          else
            for (final dayHours in groupedWeeklyHours)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 78,
                      child: Text(
                        '${dayHours.dayRangeLabel}:',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                    Expanded(child: Text(dayHours.summaryLabel)),
                  ],
                ),
              ),
          const SizedBox(height: 14),
          const Text(
            'Details',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          if (hasStreetAddress) ...[
            InkWell(
              onTap: () {
                _getDirections(context);
              },
              borderRadius: BorderRadius.circular(8),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text(
                  'Address: ${restaurant.streetAddress!}',
                  style: TextStyle(
                    color: ClickablePhoneText.linkColor,
                    decoration: TextDecoration.underline,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 6),
          ],
          Text('City: ${restaurant.city}'),
          const SizedBox(height: 6),
          Text('ZIP: ${restaurant.zipCode}'),
          if (hasPhone) ...[
            const SizedBox(height: 6),
            ClickablePhoneText(phone: restaurant.phone, prefix: 'Phone: '),
          ],
          if (hasWebsite) ...[
            const SizedBox(height: 6),
            InkWell(
              onTap: () {
                _openWebsite(context);
              },
              borderRadius: BorderRadius.circular(8),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text(
                  'Website: ${restaurant.website!}',
                  style: const TextStyle(
                    color: Color(0xFF2563EB),
                    decoration: TextDecoration.underline,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Color _modeAccentColor(AppMode selectedMode) {
    return selectedMode == AppMode.biteScore
        ? const Color(0xFF3D67BE)
        : const Color(0xFFD06C3B);
  }

  double _selectedModePosition(AppMode selectedMode) {
    return selectedMode == AppMode.biteSaver ? 0 : 1;
  }

  void _handleModeDragUpdate(
    DragUpdateDetails details,
    BoxConstraints constraints,
  ) {
    final width = constraints.maxWidth;
    if (width <= 0) return;

    setState(() {
      _modeDragProgress = (_modeDragProgress + (details.delta.dx / width))
          .clamp(-1, 1);
    });
  }

  void _setPressedMode(AppMode? mode) {
    if (_pressedMode == mode) return;
    setState(() {
      _pressedMode = mode;
    });
  }

  void _selectMode(AppMode mode, AppMode selectedMode) {
    if (mode == selectedMode) {
      return;
    }
    Navigator.of(context).popUntil((route) => route.isFirst);
    AppModeStateService.setMode(mode);
  }

  Widget _buildWarmModeSwitcher() {
    return ValueListenableBuilder<AppMode>(
      valueListenable: AppModeStateService.selectedMode,
      builder: (context, selectedMode, _) {
        final colorScheme = Theme.of(context).colorScheme;
        final accent = _modeAccentColor(selectedMode);
        final selectedPosition = _selectedModePosition(selectedMode);

        return Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          color: const Color(0xFFF8F1EA),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final width = constraints.maxWidth;
              final thumbWidth = (width - 4) / 2;
              final visualPosition = (selectedPosition + _modeDragProgress)
                  .clamp(0, 1)
                  .toDouble();
              final left = 2 + (visualPosition * thumbWidth);

              void handleDragEnd() {
                final targetPosition =
                    (selectedPosition + _modeDragProgress) >= 0.5 ? 1 : 0;
                setState(() {
                  _modeDragProgress = 0;
                  _pressedMode = null;
                });
                _selectMode(
                  targetPosition == 0 ? AppMode.biteSaver : AppMode.biteScore,
                  selectedMode,
                );
              }

              return GestureDetector(
                onHorizontalDragUpdate: (details) {
                  _handleModeDragUpdate(details, constraints);
                },
                onHorizontalDragEnd: (_) {
                  handleDragEnd();
                },
                child: Container(
                  width: double.infinity,
                  height: 51,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      begin: Alignment.centerLeft,
                      end: Alignment.centerRight,
                      colors: [
                        Color(0xFFD68A52),
                        Color(0xFFC66E59),
                        Color(0xFFB56678),
                        Color(0xFF7A689E),
                        Color(0xFF3364BB),
                      ],
                      stops: [0.0, 0.24, 0.50, 0.74, 1.0],
                    ),
                    borderRadius: BorderRadius.circular(26),
                    border: Border.all(
                      color: const Color(0xFFF9EEE4).withValues(alpha: 0.46),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: accent.withValues(alpha: 0.10),
                        blurRadius: 8,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: Stack(
                    children: [
                      AnimatedPositioned(
                        duration: const Duration(milliseconds: 300),
                        curve: Curves.easeOutCubic,
                        left: left,
                        top: 1,
                        bottom: 1,
                        width: thumbWidth,
                        child: AnimatedScale(
                          scale: _pressedMode == selectedMode ? 0.978 : 1.0,
                          duration: const Duration(milliseconds: 100),
                          curve: Curves.easeOut,
                          child: AnimatedOpacity(
                            opacity: _pressedMode == selectedMode ? 0.98 : 1.0,
                            duration: const Duration(milliseconds: 100),
                            curve: Curves.easeOut,
                            child: ClipRRect(
                              clipBehavior: Clip.antiAlias,
                              borderRadius: const BorderRadius.all(
                                Radius.elliptical(20.5, 17.5),
                              ),
                              child: DecoratedBox(
                                decoration: BoxDecoration(
                                  gradient: selectedMode == AppMode.biteSaver
                                      ? const LinearGradient(
                                          begin: Alignment.topLeft,
                                          end: Alignment.bottomRight,
                                          colors: [
                                            Color(0xFFEDA364),
                                            Color(0xFFD36F3A),
                                            Color(0xFFB54D24),
                                          ],
                                        )
                                      : const LinearGradient(
                                          begin: Alignment.topLeft,
                                          end: Alignment.bottomRight,
                                          colors: [
                                            Color(0xFF936AB3),
                                            Color(0xFF5668BE),
                                            Color(0xFF285CC3),
                                          ],
                                        ),
                                  borderRadius: const BorderRadius.all(
                                    Radius.elliptical(20.5, 17.5),
                                  ),
                                  border: Border.all(
                                    color: const Color(
                                      0xFFFFF6EE,
                                    ).withValues(alpha: 0.62),
                                    width: 0.8,
                                  ),
                                ),
                                child: Center(
                                  child: Text(
                                    selectedMode == AppMode.biteSaver
                                        ? 'BiteSaver'
                                        : 'BiteScore',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w800,
                                      fontSize: 14,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      Row(
                        children: [
                          Expanded(
                            child: InkWell(
                              borderRadius: BorderRadius.circular(24),
                              onHighlightChanged: (pressed) {
                                _setPressedMode(
                                  pressed ? AppMode.biteSaver : null,
                                );
                              },
                              onTap: () {
                                _selectMode(AppMode.biteSaver, selectedMode);
                              },
                              child: AnimatedScale(
                                scale: _pressedMode == AppMode.biteSaver
                                    ? 0.985
                                    : 1.0,
                                duration: const Duration(milliseconds: 100),
                                curve: Curves.easeOut,
                                child: AnimatedOpacity(
                                  opacity: _pressedMode == AppMode.biteSaver
                                      ? 0.98
                                      : 1.0,
                                  duration: const Duration(milliseconds: 100),
                                  curve: Curves.easeOut,
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 12,
                                    ),
                                    child: Center(
                                      child: Text(
                                        'BiteSaver',
                                        style: TextStyle(
                                          color:
                                              selectedMode == AppMode.biteSaver
                                              ? Colors.transparent
                                              : colorScheme.onSurfaceVariant
                                                    .withValues(alpha: 0.9),
                                          fontWeight: FontWeight.w700,
                                          fontSize: 14,
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          Expanded(
                            child: InkWell(
                              borderRadius: BorderRadius.circular(24),
                              onHighlightChanged: (pressed) {
                                _setPressedMode(
                                  pressed ? AppMode.biteScore : null,
                                );
                              },
                              onTap: () {
                                _selectMode(AppMode.biteScore, selectedMode);
                              },
                              child: AnimatedScale(
                                scale: _pressedMode == AppMode.biteScore
                                    ? 0.985
                                    : 1.0,
                                duration: const Duration(milliseconds: 100),
                                curve: Curves.easeOut,
                                child: AnimatedOpacity(
                                  opacity: _pressedMode == AppMode.biteScore
                                      ? 0.98
                                      : 1.0,
                                  duration: const Duration(milliseconds: 100),
                                  curve: Curves.easeOut,
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 12,
                                    ),
                                    child: Center(
                                      child: Text(
                                        'BiteScore',
                                        style: TextStyle(
                                          color:
                                              selectedMode == AppMode.biteScore
                                              ? Colors.transparent
                                              : colorScheme.onSurfaceVariant
                                                    .withValues(alpha: 0.9),
                                          fontWeight: FontWeight.w700,
                                          fontSize: 14,
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: DemoRedemptionStore.changes,
      builder: (context, _, __) {
        final now = DateTime.now();
        final activeCoupons = restaurant.coupons
            .where(
              (coupon) =>
                  coupon.isActiveAt(now) &&
                  DemoRedemptionStore.isAvailable(coupon.id, coupon.usageRule),
            )
            .toList();

        return Scaffold(
          backgroundColor: const Color(0xFFF8F1EA),
          appBar: AppBar(
            leadingWidth: 64,
            leading: IconButton(
              tooltip: MaterialLocalizations.of(context).backButtonTooltip,
              onPressed: () => Navigator.of(context).maybePop(),
              padding: const EdgeInsets.all(16),
              constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
              icon: const BackButtonIcon(),
            ),
            backgroundColor: const Color(0xFFF8F1EA),
            surfaceTintColor: const Color(0xFFF8F1EA),
            elevation: 0,
          ),
          bottomNavigationBar: const PersistentBottomNavigation(
            mode: AppMode.biteSaver,
          ),
          body: Column(
            children: [
              _buildWarmModeSwitcher(),
              Expanded(
                child: ScrollConfiguration(
                  behavior: ScrollConfiguration.of(
                    context,
                  ).copyWith(overscroll: false),
                  child: SingleChildScrollView(
                    physics: const ClampingScrollPhysics(),
                    padding: EdgeInsets.fromLTRB(
                      16,
                      8,
                      16,
                      16 + MediaQuery.of(context).viewPadding.bottom,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.center,
                                children: [
                                  Text(
                                    _displayText(restaurant.name, 'Restaurant'),
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(
                                      color: Color(0xFF2B1D14),
                                      fontSize: 24,
                                      fontWeight: FontWeight.w800,
                                      height: 1.05,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    _distanceLocationLine(restaurant),
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(
                                      fontSize: 14,
                                      color: Color(0xFF7F6D5F),
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            IconButton(
                              tooltip: _isFavoriteRestaurant
                                  ? 'Unsave restaurant'
                                  : 'Save restaurant',
                              onPressed: _isSavingFavoriteRestaurant
                                  ? null
                                  : _toggleRestaurantFavorite,
                              icon: Icon(
                                _isFavoriteRestaurant
                                    ? Icons.favorite
                                    : Icons.favorite_border,
                                color: _isFavoriteRestaurant
                                    ? Colors.red.shade400
                                    : const Color(0xFF9F4F34),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 14),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              flex: 44,
                              child: _buildRestaurantProfileImage(),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              flex: 56,
                              child: _buildCompactProfileActions(),
                            ),
                          ],
                        ),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: TextButton.icon(
                            onPressed: _isSubmittingReport
                                ? null
                                : _reportRestaurant,
                            style: TextButton.styleFrom(
                              foregroundColor: const Color(0xFF7F6D5F),
                              padding: EdgeInsets.zero,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            ),
                            icon: const Icon(Icons.flag_outlined, size: 16),
                            label: const Text('Report'),
                          ),
                        ),
                        const SizedBox(height: 20),
                        const Text(
                          'Available Coupons',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF2B1D14),
                          ),
                        ),
                        const SizedBox(height: 12),
                        if (activeCoupons.isEmpty)
                          _biteSaverRaisedSurface(
                            shadowStrength: 0.68,
                            child: Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(14),
                              child: const Text(
                                'No available coupons right now.',
                                style: TextStyle(color: Color(0xFF7F6D5F)),
                              ),
                            ),
                          )
                        else
                          Column(
                            children: activeCoupons.map((coupon) {
                              final isProximity = coupon.isProximityOnly;
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 10),
                                child: _biteSaverRaisedSurface(
                                  shadowStrength: 0.74,
                                  child: Material(
                                    color: Colors.transparent,
                                    child: ListTile(
                                      leading:
                                          coupon.imageUrl != null &&
                                              coupon.imageUrl!.trim().isNotEmpty
                                          ? ClipRRect(
                                              borderRadius:
                                                  BorderRadius.circular(10),
                                              child: Image.network(
                                                coupon.imageUrl!,
                                                width: 52,
                                                height: 52,
                                                fit: BoxFit.cover,
                                                errorBuilder:
                                                    (
                                                      context,
                                                      error,
                                                      stackTrace,
                                                    ) => Container(
                                                      width: 52,
                                                      height: 52,
                                                      color: const Color(
                                                        0xFFF4E8DC,
                                                      ),
                                                      child: const Icon(
                                                        Icons.local_offer,
                                                        color: Color(
                                                          0xFF94482E,
                                                        ),
                                                      ),
                                                    ),
                                              ),
                                            )
                                          : null,
                                      title: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          if (isProximity)
                                            Container(
                                              margin: const EdgeInsets.only(
                                                bottom: 6,
                                              ),
                                              padding:
                                                  const EdgeInsets.symmetric(
                                                    horizontal: 8,
                                                    vertical: 4,
                                                  ),
                                              decoration: BoxDecoration(
                                                color: Colors.deepOrange,
                                                borderRadius:
                                                    BorderRadius.circular(999),
                                              ),
                                              child: const Text(
                                                'Proximity Deal',
                                                style: TextStyle(
                                                  color: Colors.white,
                                                  fontSize: 11,
                                                  fontWeight: FontWeight.bold,
                                                ),
                                              ),
                                            ),
                                          Text(
                                            _displayText(
                                              coupon.title,
                                              'Untitled coupon',
                                            ),
                                            style: const TextStyle(
                                              color: Color(0xFF2B1D14),
                                              fontWeight: FontWeight.w700,
                                            ),
                                          ),
                                        ],
                                      ),
                                      subtitle: Text(
                                        isProximity
                                            ? '${_couponSubtitle(coupon)} - Unlocked nearby'
                                            : (coupon.couponCode == null
                                                  ? _couponSubtitle(coupon)
                                                  : '${_couponSubtitle(coupon)} - Code: ${coupon.couponCode}'),
                                        style: const TextStyle(
                                          color: Color(0xFF7F6D5F),
                                        ),
                                      ),
                                      trailing: const Icon(
                                        Icons.chevron_right,
                                        color: Color(0xFF94482E),
                                      ),
                                      onTap: () {
                                        Navigator.push(
                                          context,
                                          MaterialPageRoute(
                                            builder: (context) =>
                                                CouponDetailScreen(
                                                  coupon: coupon,
                                                  restaurant: restaurant,
                                                ),
                                          ),
                                        );
                                      },
                                    ),
                                  ),
                                ),
                              );
                            }).toList(),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _GroupedRestaurantHours {
  final String startDay;
  final String endDay;
  final String summaryLabel;
  final bool closed;

  const _GroupedRestaurantHours({
    required this.startDay,
    required this.endDay,
    required this.summaryLabel,
    required this.closed,
  });

  String get dayRangeLabel {
    final start = _shortDayName(startDay);
    final end = _shortDayName(endDay);
    if (start == end) {
      return start;
    }
    return '$start–$end';
  }

  bool matches(RestaurantBusinessHours entry) {
    return closed == entry.closed && summaryLabel == entry.summaryLabel;
  }

  _GroupedRestaurantHours copyWith({required String endDay}) {
    return _GroupedRestaurantHours(
      startDay: startDay,
      endDay: endDay,
      summaryLabel: summaryLabel,
      closed: closed,
    );
  }

  static String _shortDayName(String day) {
    return switch (day) {
      'Monday' => 'Mon',
      'Tuesday' => 'Tue',
      'Wednesday' => 'Wed',
      'Thursday' => 'Thu',
      'Friday' => 'Fri',
      'Saturday' => 'Sat',
      'Sunday' => 'Sun',
      _ => day,
    };
  }
}
