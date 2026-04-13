import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/bitescore_dish.dart';
import '../models/bitescore_restaurant.dart';
import '../models/restaurant.dart';
import '../services/admin_access_service.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_sign_in_gate.dart';
import '../services/bitescore_service.dart';
import '../widgets/app_mode_switcher_bar.dart';
import '../widgets/biterater_theme.dart';
import 'bitescore_create_rate_screen.dart';
import 'bitescore_dish_detail_screen.dart';

class BiteScoreRestaurantDishesScreen extends StatefulWidget {
  final BitescoreRestaurant restaurant;
  final List<BiteScoreHomeEntry> entries;

  const BiteScoreRestaurantDishesScreen({
    super.key,
    required this.restaurant,
    required this.entries,
  });

  @override
  State<BiteScoreRestaurantDishesScreen> createState() =>
      _BiteScoreRestaurantDishesScreenState();
}

class _BiteScoreRestaurantDishesScreenState
    extends State<BiteScoreRestaurantDishesScreen> {
  late List<BiteScoreHomeEntry> _entries;
  late BitescoreRestaurant _restaurant;
  bool _isRefreshing = false;
  bool _bioExpanded = false;
  bool _hoursExpanded = false;
  bool _isFavoriteRestaurant = false;
  bool _isSavingFavoriteRestaurant = false;

  bool get _hasPhone =>
      _restaurant.phone != null && _restaurant.phone!.trim().isNotEmpty;

  bool get _hasWebsite =>
      _restaurant.website != null && _restaurant.website!.trim().isNotEmpty;

  bool get _hasDirectionsTarget {
    final hasAddress = _restaurant.address.trim().isNotEmpty ||
        _restaurant.city.trim().isNotEmpty ||
        _restaurant.zipCode.trim().isNotEmpty;
    final hasCoordinates =
        (_restaurant.latitude ?? 0) != 0 || (_restaurant.longitude ?? 0) != 0;
    return hasAddress || hasCoordinates;
  }

  User? get _currentUser => FirebaseAuth.instance.currentUser;
  bool get _isOwner =>
      _currentUser != null &&
      !_currentUser!.isAnonymous &&
      _restaurant.ownerUserId?.trim() == _currentUser!.uid;
  bool get _isAdmin => AdminAccessService.isAdminUser(_currentUser);
  bool get _canManageRestaurant => _isOwner || _isAdmin;

  ButtonStyle _bitescoreActionButtonStyle() {
    return BiteRaterTheme.filledButtonStyle();
  }

  Widget _buildBiteScoreActionButton({
    required String label,
    required VoidCallback? onPressed,
  }) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: BiteRaterTheme.brandGradient,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: BiteRaterTheme.ocean.withOpacity(0.18),
            blurRadius: 14,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: ElevatedButton(
        onPressed: onPressed,
        style: _bitescoreActionButtonStyle(),
        child: Container(
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
          child: Text(label),
        ),
      ),
    );
  }

  ButtonStyle _reportActionButtonStyle() {
    return BiteRaterTheme.outlinedButtonStyle(
      accentColor: BiteRaterTheme.grape,
    ).copyWith(
      visualDensity: VisualDensity.compact,
      padding: WidgetStateProperty.all(
        const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      ),
      textStyle: WidgetStateProperty.all(
        const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          duration: const Duration(seconds: 3),
        ),
      );
  }

  @override
  void initState() {
    super.initState();
    _restaurant = widget.restaurant;
    _entries = _sortedEntries(widget.entries);
    _refreshRestaurantData();
  }

  List<BiteScoreHomeEntry> _sortedEntries(List<BiteScoreHomeEntry> entries) {
    final sorted = [...entries]
      ..sort(
        (a, b) => b.aggregate.overallBiteScore.compareTo(
          a.aggregate.overallBiteScore,
        ),
      );
    return sorted;
  }

  Future<void> _openAddDish() async {
    final canWrite = await BiteScoreSignInGate.ensureSignedInForWrite(context);
    if (!canWrite || !mounted) {
      return;
    }

    final created = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => BiteScoreCreateRateScreen(
          existingRestaurant: _restaurant,
        ),
      ),
    );

    if (created == true && mounted) {
      await _refreshRestaurantData();
    }
  }

  Future<void> _openExistingDishReview(BiteScoreHomeEntry entry) async {
    final canWrite = await BiteScoreSignInGate.ensureSignedInForWrite(context);
    if (!canWrite || !mounted) {
      return;
    }

    final created = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => BiteScoreCreateRateScreen(
          existingEntry: entry,
        ),
      ),
    );

    if (created == true && mounted) {
      await _refreshRestaurantData();
    }
  }

  Future<void> _refreshRestaurantData() async {
    setState(() {
      _isRefreshing = true;
    });

    try {
      final refreshedRestaurant =
          await BiteScoreService.loadRestaurantById(_restaurant.id);
      final favoriteRestaurant =
          await BiteScoreService.isRestaurantFavoritedByCurrentUser(
        _restaurant.id,
      );
      final allEntries = await BiteScoreService.loadEntriesForRestaurant(
        refreshedRestaurant ?? _restaurant,
      );
      if (!mounted) {
        return;
      }

      setState(() {
        if (refreshedRestaurant != null) {
          _restaurant = refreshedRestaurant;
        }
        _entries = _sortedEntries(allEntries);
        _isFavoriteRestaurant = favoriteRestaurant;
      });
    } finally {
      if (mounted) {
        setState(() {
          _isRefreshing = false;
        });
      }
    }
  }

  Future<void> _toggleRestaurantFavorite() async {
    final canSave =
        await BiteScoreSignInGate.ensureSignedInForFavorites(context);
    if (!canSave || !mounted || _isSavingFavoriteRestaurant) {
      return;
    }

    final nextIsFavorite = !_isFavoriteRestaurant;

    setState(() {
      _isSavingFavoriteRestaurant = true;
      _isFavoriteRestaurant = nextIsFavorite;
    });

    try {
      await BiteScoreService.setRestaurantFavorite(
        restaurant: _restaurant,
        isFavorite: nextIsFavorite,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar(
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
      _showSnackBar(
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

  Future<void> _openClaimDialog() async {
    final canWrite = await BiteScoreSignInGate.ensureSignedInForWrite(context);
    if (!canWrite || !mounted) {
      return;
    }
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      return;
    }

    final submitted = await showDialog<bool>(
      context: context,
      builder: (context) {
        return _RestaurantClaimDialog(
          restaurant: _restaurant,
          currentUser: user,
        );
      },
    );

    if (submitted == true && mounted) {
      _showSnackBar('Claim request submitted for admin review.');
    }
  }

  Future<void> _openOwnerRestaurantEditor() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) {
        return _OwnerRestaurantEditDialog(restaurant: _restaurant);
      },
    );

    if (saved == true && mounted) {
      await _refreshRestaurantData();
      _showSnackBar('Restaurant information updated.');
    }
  }

  Future<void> _openOwnerDishEditor(BiteScoreHomeEntry entry) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) {
        return _OwnerDishEditDialog(dish: entry.dish);
      },
    );

    if (saved == true && mounted) {
      await _refreshRestaurantData();
      _showSnackBar('Dish updated.');
    }
  }

  Future<void> _openDirections() async {
    final addressParts = <String>[
      _restaurant.name,
      _restaurant.address,
      '${_restaurant.city}, ${_restaurant.state} ${_restaurant.zipCode}'
          .trim(),
    ]
        .map((part) => part.trim())
        .where((part) => part.isNotEmpty)
        .toList();
    final query = addressParts.isNotEmpty
        ? addressParts.join(', ')
        : '${_restaurant.latitude},${_restaurant.longitude}';
    final uri = Uri.parse(
      'https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(query)}',
    );

    final opened = await launchUrl(
      uri,
      mode: LaunchMode.externalApplication,
    );
    if (!opened && mounted) {
      _showSnackBar('Could not open maps right now.');
    }
  }

  Future<void> _callRestaurant() async {
    if (!_hasPhone) {
      _showSnackBar('No phone number available.');
      return;
    }

    final cleanedPhone =
        _restaurant.phone!.replaceAll(RegExp(r'[^0-9+]'), '');
    final opened = await launchUrl(Uri(scheme: 'tel', path: cleanedPhone));

    if (!opened && mounted) {
      _showSnackBar('Could not open the phone dialer right now.');
    }
  }

  Future<void> _openWebsite() async {
    if (!_hasWebsite) {
      _showSnackBar('No website available.');
      return;
    }

    final rawWebsite = _restaurant.website!.trim();
    final normalizedWebsite = rawWebsite.startsWith('http://') ||
            rawWebsite.startsWith('https://')
        ? rawWebsite
        : 'https://$rawWebsite';

    final opened = await launchUrl(
      Uri.parse(normalizedWebsite),
      mode: LaunchMode.externalApplication,
    );

    if (!opened && mounted) {
      _showSnackBar('Could not open the website right now.');
    }
  }

  Widget _buildRestaurantContactActions() {
    final actions = <Widget>[];

    if (_hasPhone) {
      actions.add(
        Expanded(
          child: OutlinedButton.icon(
            onPressed: _callRestaurant,
            style: _reportActionButtonStyle(),
            icon: const Icon(Icons.call_outlined, size: 18),
            label: const Text('Call'),
          ),
        ),
      );
    }

    if (_hasWebsite) {
      actions.add(
        Expanded(
          child: OutlinedButton.icon(
            onPressed: _openWebsite,
            style: _reportActionButtonStyle(),
            icon: const Icon(Icons.language_outlined, size: 18),
            label: const FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                'Website',
                maxLines: 1,
                softWrap: false,
              ),
            ),
          ),
        ),
      );
    }

    if (_hasDirectionsTarget) {
      actions.add(
        Expanded(
          child: OutlinedButton.icon(
            onPressed: _openDirections,
            style: _reportActionButtonStyle(),
            icon: const Icon(Icons.directions_outlined, size: 18),
            label: const FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                'Directions',
                maxLines: 1,
                softWrap: false,
              ),
            ),
          ),
        ),
      );
    }

    if (actions.isEmpty) {
      return const SizedBox.shrink();
    }

    return Row(
      children: [
        for (var index = 0; index < actions.length; index++) ...[
          if (index > 0) const SizedBox(width: 8),
          actions[index],
        ],
      ],
    );
  }

  Future<void> _reportIssue() async {
    final canWrite = await BiteScoreSignInGate.ensureSignedInForWrite(context);
    if (!canWrite || !mounted) {
      return;
    }

    final reportSelection = await showDialog<_RestaurantIssueReportSelection?>(
      context: context,
      builder: (context) => const _RestaurantIssueReportDialog(),
    );

    if (reportSelection == null || !mounted) {
      return;
    }

    try {
      final submitted = reportSelection.isDuplicate
          ? await BiteScoreService.submitDuplicateRestaurantReport(
              restaurant: _restaurant,
              reason: reportSelection.reason,
            )
          : await BiteScoreService.submitRestaurantReport(
              restaurant: _restaurant,
              reason: reportSelection.reason,
            );
      if (!mounted) {
        return;
      }
      _showSnackBar(
        submitted
            ? 'Report submitted for admin review.'
            : 'You already reported this restaurant issue.',
      );
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not submit this report right now.',
        ),
      );
    }
  }

  Widget _buildClaimAndReportActions() {
    final reportIssueButton = OutlinedButton.icon(
      onPressed: _reportIssue,
      style: _reportActionButtonStyle(),
      icon: const Icon(Icons.flag_outlined, size: 16),
      label: const Text('Report issue'),
    );

    if (_canManageRestaurant) {
      return SizedBox(
        width: double.infinity,
        child: reportIssueButton,
      );
    }

    if (_restaurant.isClaimed) {
      return SizedBox(
        width: double.infinity,
        child: reportIssueButton,
      );
    }

    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: _openClaimDialog,
            style: _reportActionButtonStyle(),
            icon: const Icon(Icons.verified_outlined, size: 16),
            label: const Text('Claim restaurant'),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: reportIssueButton,
        ),
      ],
    );
  }

  Widget _buildBioSection() {
    final bio = (_restaurant.bio ?? '').trim();
    if (bio.isEmpty) {
      return const SizedBox.shrink();
    }

    final isLong = bio.length > 180;

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Info',
            style: TextStyle(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            bio,
            maxLines: _bioExpanded || !isLong ? null : 4,
            overflow:
                _bioExpanded || !isLong ? TextOverflow.visible : TextOverflow.ellipsis,
            style: const TextStyle(color: Colors.black87),
          ),
          if (isLong)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () {
                  setState(() {
                    _bioExpanded = !_bioExpanded;
                  });
                },
                child: Text(_bioExpanded ? 'Show less' : 'Show more'),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildHoursSection() {
    if (_restaurant.businessHours.isEmpty) {
      return const SizedBox.shrink();
    }

    final weeklyHours = RestaurantBusinessHours.normalizedWeek(
      _restaurant.businessHours,
    );
    final todayHours = weeklyHours[DateTime.now().weekday % 7];

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Hours',
            style: TextStyle(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            todayHours.closed
                ? 'Closed today'
                : 'Open today: ${todayHours.opensAt} - ${todayHours.closesAt}',
            style: const TextStyle(
              color: BiteRaterTheme.ink,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (_hoursExpanded) ...[
            const SizedBox(height: 8),
            ...weeklyHours.map(
              (entry) => Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  '${entry.day}: ${entry.summaryLabel}',
                  style: const TextStyle(
                    color: BiteRaterTheme.mutedInk,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ],
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () {
                setState(() {
                  _hoursExpanded = !_hoursExpanded;
                });
              },
              child: Text(_hoursExpanded ? 'Hide hours' : 'Show all hours'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildClaimedBadge() {
    if (!_restaurant.isClaimed) {
      return const SizedBox.shrink();
    }

    final label = _isOwner
        ? 'Claimed by You'
        : (_isAdmin ? 'Admin Access' : 'Claimed Restaurant');

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: BiteRaterTheme.mint.withOpacity(0.10),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: BiteRaterTheme.mint.withOpacity(0.26),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.verified_outlined,
            size: 16,
            color: BiteRaterTheme.mint,
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              color: BiteRaterTheme.mint,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }

  String _restaurantAddressLabel() {
    final cleanedAddress = _restaurant.address
        .trim()
        .replaceAll(RegExp(r',?\s*USA\s*$', caseSensitive: false), '')
        .trim();
    final cityStateZip = [
      _restaurant.city.trim(),
      '${_restaurant.state.trim()} ${_restaurant.zipCode.trim()}'.trim(),
    ].where((part) => part.isNotEmpty).join(', ');

    if (cleanedAddress.isEmpty) {
      return cityStateZip;
    }

    final normalizedAddress = cleanedAddress.toLowerCase();
    final city = _restaurant.city.trim().toLowerCase();
    final state = _restaurant.state.trim().toLowerCase();
    final zipCode = _restaurant.zipCode.trim().toLowerCase();
    final alreadyHasCityStateZip =
        (city.isEmpty || normalizedAddress.contains(city)) &&
        (state.isEmpty || normalizedAddress.contains(state)) &&
        (zipCode.isEmpty || normalizedAddress.contains(zipCode));

    if (alreadyHasCityStateZip || cityStateZip.isEmpty) {
      return cleanedAddress;
    }

    return '$cleanedAddress, $cityStateZip';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BiteRaterTheme.pageBackground,
      appBar: AppBar(),
      body: Column(
        children: [
          buildPersistentAppModeSwitcher(context),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
              children: [
                BiteRaterTheme.liftedCard(
                  margin: const EdgeInsets.only(bottom: 12),
                  radius: 24,
                  borderColor: BiteRaterTheme.coral.withOpacity(0.18),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Text(
                                _restaurant.name,
                                style: const TextStyle(
                                  color: BiteRaterTheme.ink,
                                  fontSize: 22,
                                  fontWeight: FontWeight.w900,
                                  letterSpacing: 0.1,
                                ),
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
                                    ? BiteRaterTheme.coral
                                    : BiteRaterTheme.grape,
                              ),
                            ),
                          ],
                        ),
                        if (_restaurant.isClaimed) ...[
                          const SizedBox(height: 10),
                          _buildClaimedBadge(),
                        ],
                        const SizedBox(height: 8),
                        InkWell(
                          onTap: _hasDirectionsTarget ? _openDirections : null,
                          borderRadius: BorderRadius.circular(8),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 2),
                            child: Text(
                              _restaurantAddressLabel(),
                              style: TextStyle(
                                color: _hasDirectionsTarget
                                    ? BiteRaterTheme.ocean
                                    : BiteRaterTheme.ink,
                                fontWeight: FontWeight.w600,
                                decoration: _hasDirectionsTarget
                                    ? TextDecoration.underline
                                    : TextDecoration.none,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          _hasPhone
                              ? 'Phone: ${_restaurant.phone!}'
                              : 'Phone: Not available',
                          style: const TextStyle(
                            color: BiteRaterTheme.mutedInk,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (_hasPhone ||
                            _hasWebsite ||
                            _hasDirectionsTarget) ...[
                          const SizedBox(height: 10),
                          _buildRestaurantContactActions(),
                        ],
                        _buildHoursSection(),
                        _buildBioSection(),
                        BiteRaterTheme.softDivider(),
                        SizedBox(
                          width: double.infinity,
                          child: _buildBiteScoreActionButton(
                            label:
                                _isRefreshing ? 'Refreshing...' : 'Add Dish',
                            onPressed: _isRefreshing ? null : _openAddDish,
                          ),
                        ),
                        if (_canManageRestaurant) ...[
                          const SizedBox(height: 10),
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              onPressed: _isRefreshing
                                  ? null
                                  : _openOwnerRestaurantEditor,
                              style: BiteRaterTheme.outlinedButtonStyle(
                                accentColor: BiteRaterTheme.ocean,
                              ),
                              icon: const Icon(Icons.edit_outlined),
                              label: const Text('Edit Restaurant Info'),
                            ),
                          ),
                        ],
                        const SizedBox(height: 8),
                        _buildClaimAndReportActions(),
                      ],
                    ),
                  ),
                ),
                if (_entries.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 32),
                    child: Text(
                      'No dishes found for this restaurant yet.',
                      textAlign: TextAlign.center,
                    ),
                  )
                else
                  ..._entries.map((entry) {
                    final scoreLabel = entry.aggregate.overallBiteScore > 0
                        ? entry.aggregate.overallBiteScore.toStringAsFixed(0)
                        : '--';

                    return BiteRaterTheme.liftedCard(
                      margin: const EdgeInsets.only(bottom: 12),
                      radius: 20,
                      borderColor: BiteRaterTheme.grape.withOpacity(0.16),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(20),
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => BiteScoreDishDetailScreen(
                                entry: entry,
                                distanceLabel: null,
                              ),
                            ),
                          );
                        },
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    child: Text(
                                      entry.dish.name,
                                      style: const TextStyle(
                                        color: BiteRaterTheme.ink,
                                        fontWeight: FontWeight.w900,
                                        fontSize: 17,
                                        letterSpacing: 0.1,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Text(
                                            scoreLabel,
                                            style: const TextStyle(
                                              color: BiteRaterTheme.scoreFlame,
                                              fontWeight: FontWeight.w900,
                                              fontSize: 22,
                                              height: 1.0,
                                            ),
                                          ),
                                          const SizedBox(width: 6),
                                          const Text(
                                            'BiteScore',
                                            style: TextStyle(
                                              color: BiteRaterTheme.scoreFlame,
                                              fontWeight: FontWeight.w700,
                                              fontSize: 10,
                                              letterSpacing: 0.2,
                                            ),
                                          ),
                                        ],
                                      ),
                                      const SizedBox(height: 3),
                                      Text(
                                        '${entry.aggregate.ratingCount} ratings',
                                        style: const TextStyle(
                                          fontSize: 12,
                                          color: BiteRaterTheme.mutedInk,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                              BiteRaterTheme.softDivider(),
                              Row(
                                children: [
                                  OutlinedButton(
                                    onPressed: () =>
                                        _openExistingDishReview(entry),
                                    style: BiteRaterTheme.outlinedButtonStyle(
                                      accentColor: BiteRaterTheme.coral,
                                    ),
                                    child: const Text('Rate & Review'),
                                  ),
                                  if (_canManageRestaurant) ...[
                                    const SizedBox(width: 8),
                                    TextButton(
                                      onPressed: () =>
                                          _openOwnerDishEditor(entry),
                                      style: TextButton.styleFrom(
                                        foregroundColor: BiteRaterTheme.ocean,
                                      ),
                                      child: const Text('Edit Dish'),
                                    ),
                                  ],
                                  const Spacer(),
                                  const Icon(Icons.chevron_right),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  }),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _OwnerTextField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final int maxLines;
  final TextInputType? keyboardType;

  const _OwnerTextField({
    required this.controller,
    required this.label,
    this.maxLines = 1,
    this.keyboardType,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      maxLines: maxLines,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        labelText: label,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
        ),
      ),
    );
  }
}

class _RestaurantClaimDialog extends StatefulWidget {
  final BitescoreRestaurant restaurant;
  final User currentUser;

  const _RestaurantClaimDialog({
    required this.restaurant,
    required this.currentUser,
  });

  @override
  State<_RestaurantClaimDialog> createState() => _RestaurantClaimDialogState();
}

class _RestaurantClaimDialogState extends State<_RestaurantClaimDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _emailController;
  late final TextEditingController _phoneController;
  late final TextEditingController _messageController;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(
      text: widget.currentUser.displayName ?? '',
    );
    _emailController = TextEditingController(
      text: widget.currentUser.email ?? '',
    );
    _phoneController = TextEditingController(
      text: widget.currentUser.phoneNumber ?? '',
    );
    _messageController = TextEditingController();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _isSaving = true;
    });

    try {
      await BiteScoreService.submitRestaurantClaim(
        restaurantId: widget.restaurant.id,
        restaurantName: widget.restaurant.name,
        claimantName: _nameController.text,
        email: _emailController.text,
        phone: _phoneController.text,
        message: _messageController.text,
      );
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not submit your claim right now.',
            ),
          ),
        ),
      );
      setState(() {
        _isSaving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Claim this restaurant'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _OwnerTextField(
                controller: _nameController,
                label: 'Claimant name',
              ),
              const SizedBox(height: 12),
              _OwnerTextField(
                controller: _emailController,
                label: 'Email',
                keyboardType: TextInputType.emailAddress,
              ),
              const SizedBox(height: 12),
              _OwnerTextField(
                controller: _phoneController,
                label: 'Phone',
                keyboardType: TextInputType.phone,
              ),
              const SizedBox(height: 12),
              _OwnerTextField(
                controller: _messageController,
                label: 'Message (Optional)',
                maxLines: 4,
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _isSaving ? null : _submit,
          child: Text(_isSaving ? 'Submitting...' : 'Submit Claim'),
        ),
      ],
    );
  }
}

class _RestaurantIssueReportSelection {
  final String issueType;
  final String reason;

  const _RestaurantIssueReportSelection({
    required this.issueType,
    required this.reason,
  });

  bool get isDuplicate => issueType == 'Duplicate restaurant';
}

class _RestaurantIssueReportDialog extends StatefulWidget {
  const _RestaurantIssueReportDialog();

  @override
  State<_RestaurantIssueReportDialog> createState() =>
      _RestaurantIssueReportDialogState();
}

class _RestaurantIssueReportDialogState
    extends State<_RestaurantIssueReportDialog> {
  static const List<String> _issueTypes = <String>[
    'Duplicate restaurant',
    'Closed / no longer active',
    'Spam',
    'Incorrect information',
    'Other',
  ];

  String _selectedIssueType = _issueTypes.first;
  late final TextEditingController _otherController;

  bool get _showOtherField => _selectedIssueType == 'Other';

  @override
  void initState() {
    super.initState();
    _otherController = TextEditingController();
  }

  @override
  void dispose() {
    _otherController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Report an issue'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ..._issueTypes.map(
                (issueType) => RadioListTile<String>(
                  value: issueType,
                  groupValue: _selectedIssueType,
                  onChanged: (value) {
                    if (value == null) {
                      return;
                    }
                    setState(() {
                      _selectedIssueType = value;
                      if (!_showOtherField) {
                        _otherController.clear();
                      }
                    });
                  },
                  title: Text(issueType),
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                ),
              ),
              if (_showOtherField) ...[
                const SizedBox(height: 8),
                TextField(
                  controller: _otherController,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Tell us more',
                    hintText: 'Describe the issue',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(null),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () {
            final customText = _otherController.text.trim();
            final reason = _showOtherField && customText.isNotEmpty
                ? customText
                : _selectedIssueType;
            Navigator.of(context).pop(
              _RestaurantIssueReportSelection(
                issueType: _selectedIssueType,
                reason: reason,
              ),
            );
          },
          child: const Text('Submit report'),
        ),
      ],
    );
  }
}

class _OwnerRestaurantEditDialog extends StatefulWidget {
  final BitescoreRestaurant restaurant;

  const _OwnerRestaurantEditDialog({
    required this.restaurant,
  });

  @override
  State<_OwnerRestaurantEditDialog> createState() =>
      _OwnerRestaurantEditDialogState();
}

class _OwnerRestaurantEditDialogState
    extends State<_OwnerRestaurantEditDialog> {
  static final List<String> _businessHourOptions = _buildBusinessHourOptions();

  late final TextEditingController _nameController;
  late final TextEditingController _addressController;
  late final TextEditingController _cityController;
  late final TextEditingController _stateController;
  late final TextEditingController _zipController;
  late final TextEditingController _phoneController;
  late final TextEditingController _bioController;
  late List<RestaurantBusinessHours> _businessHours;
  late final Map<String, bool> _copyPreviousDay;
  bool _businessHoursDirty = false;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.restaurant.name);
    _addressController = TextEditingController(text: widget.restaurant.address);
    _cityController = TextEditingController(text: widget.restaurant.city);
    _stateController = TextEditingController(text: widget.restaurant.state);
    _zipController = TextEditingController(text: widget.restaurant.zipCode);
    _phoneController =
        TextEditingController(text: widget.restaurant.phone ?? '');
    _bioController = TextEditingController(text: widget.restaurant.bio ?? '');
    _businessHours = RestaurantBusinessHours.normalizedWeek(
      widget.restaurant.businessHours,
    );
    _copyPreviousDay = {
      for (final day in Restaurant.businessDayNames) day: false,
    };
  }

  @override
  void dispose() {
    _nameController.dispose();
    _addressController.dispose();
    _cityController.dispose();
    _stateController.dispose();
    _zipController.dispose();
    _phoneController.dispose();
    _bioController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _isSaving = true;
    });

    try {
      await BiteScoreService.updateRestaurantAsOwner(
        restaurant: widget.restaurant,
        name: _nameController.text,
        address: _addressController.text,
        city: _cityController.text,
        state: _stateController.text,
        zipCode: _zipController.text,
        phone: _phoneController.text,
        bio: _bioController.text,
        businessHours:
            widget.restaurant.businessHours.isNotEmpty || _businessHoursDirty
                ? _businessHours
                : widget.restaurant.businessHours,
      );
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not update the restaurant right now.',
            ),
          ),
        ),
      );
      setState(() {
        _isSaving = false;
      });
    }
  }

  static List<String> _buildBusinessHourOptions() {
    final options = <String>[];
    const periods = ['AM', 'PM'];
    for (final period in periods) {
      for (var hour = 1; hour <= 12; hour += 1) {
        for (final minute in const ['00', '30']) {
          options.add('$hour:$minute $period');
        }
      }
    }
    return options;
  }

  void _updateBusinessHoursEntry(
    int dayIndex,
    RestaurantBusinessHours updatedEntry,
  ) {
    setState(() {
      _businessHoursDirty = true;
      _businessHours = [
        for (var index = 0; index < _businessHours.length; index += 1)
          index == dayIndex ? updatedEntry : _businessHours[index],
      ];
    });
  }

  void _setBusinessDayClosed(int dayIndex, bool closed) {
    _updateBusinessHoursEntry(
      dayIndex,
      _businessHours[dayIndex].copyWith(closed: closed),
    );
  }

  void _copyPreviousBusinessDayHours(int dayIndex, bool shouldCopy) {
    final day = Restaurant.businessDayNames[dayIndex];
    final previousDayIndex =
        (dayIndex - 1 + _businessHours.length) % _businessHours.length;

    setState(() {
      _businessHoursDirty = true;
      _copyPreviousDay[day] = shouldCopy;
      if (shouldCopy) {
        final previousEntry = _businessHours[previousDayIndex];
        _businessHours = [
          for (var index = 0; index < _businessHours.length; index += 1)
            index == dayIndex
                ? _businessHours[index].copyWith(
                    opensAt: previousEntry.opensAt,
                    closesAt: previousEntry.closesAt,
                    closed: previousEntry.closed,
                  )
                : _businessHours[index],
        ];
      }
    });
  }

  InputDecoration _hoursFieldDecoration(String label) {
    return InputDecoration(
      labelText: label,
      isDense: true,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
      ),
    );
  }

  Widget _buildBusinessHoursEditor() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Hours',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'Set weekly hours and copy the previous day for repeat schedules.',
          style: TextStyle(
            fontSize: 12,
            color: BiteRaterTheme.mutedInk,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 12),
        ...List.generate(
          _businessHours.length,
          (index) => _buildBusinessDayRow(index),
        ),
      ],
    );
  }

  Widget _buildBusinessDayRow(int dayIndex) {
    final entry = _businessHours[dayIndex];
    final previousDayIndex =
        (dayIndex - 1 + _businessHours.length) % _businessHours.length;
    final copiedFromPrevious = _copyPreviousDay[entry.day] ?? false;

    return Container(
      margin: EdgeInsets.only(
        bottom: dayIndex == _businessHours.length - 1 ? 0 : 12,
      ),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E8F0)),
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
                style: TextStyle(
                  fontSize: 13,
                  color: BiteRaterTheme.ink,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 6),
              Switch(
                value: entry.closed,
                onChanged: (value) => _setBusinessDayClosed(dayIndex, value),
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
              'Copy ${_businessHours[previousDayIndex].day}',
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
                    initialValue: _businessHourOptions.contains(entry.opensAt)
                        ? entry.opensAt
                        : '9:00 AM',
                    decoration: _hoursFieldDecoration('Open'),
                    items: _businessHourOptions
                        .map(
                          (option) => DropdownMenuItem<String>(
                            value: option,
                            child: Text(
                              option,
                              overflow: TextOverflow.ellipsis,
                            ),
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
                    initialValue: _businessHourOptions.contains(entry.closesAt)
                        ? entry.closesAt
                        : '5:00 PM',
                    decoration: _hoursFieldDecoration('Close'),
                    items: _businessHourOptions
                        .map(
                          (option) => DropdownMenuItem<String>(
                            value: option,
                            child: Text(
                              option,
                              overflow: TextOverflow.ellipsis,
                            ),
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

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit Restaurant Info'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _OwnerTextField(controller: _nameController, label: 'Restaurant name'),
              const SizedBox(height: 12),
              _OwnerTextField(
                controller: _addressController,
                label: 'Street address',
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _OwnerTextField(
                      controller: _cityController,
                      label: 'City',
                    ),
                  ),
                  const SizedBox(width: 12),
                  SizedBox(
                    width: 90,
                    child: _OwnerTextField(
                      controller: _stateController,
                      label: 'State',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _OwnerTextField(
                      controller: _zipController,
                      label: 'ZIP code',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _OwnerTextField(
                      controller: _phoneController,
                      label: 'Phone',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _OwnerTextField(
                controller: _bioController,
                label: 'Bio / Notes',
                maxLines: 5,
              ),
              const SizedBox(height: 16),
              _buildBusinessHoursEditor(),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _isSaving ? null : _save,
          child: Text(_isSaving ? 'Saving...' : 'Save'),
        ),
      ],
    );
  }
}

class _OwnerDishEditDialog extends StatefulWidget {
  final BitescoreDish dish;

  const _OwnerDishEditDialog({
    required this.dish,
  });

  @override
  State<_OwnerDishEditDialog> createState() => _OwnerDishEditDialogState();
}

class _OwnerDishEditDialogState extends State<_OwnerDishEditDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _categoryController;
  late final TextEditingController _priceController;
  late bool _isActive;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.dish.name);
    _categoryController =
        TextEditingController(text: widget.dish.category ?? '');
    _priceController = TextEditingController(text: widget.dish.priceLabel ?? '');
    _isActive = widget.dish.isActive;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _categoryController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _isSaving = true;
    });

    try {
      await BiteScoreService.updateDishAsOwner(
        dish: widget.dish,
        name: _nameController.text,
        category: _categoryController.text,
        priceLabel: _priceController.text,
        isActive: _isActive,
      );
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not update the dish right now.',
            ),
          ),
        ),
      );
      setState(() {
        _isSaving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit Dish'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _OwnerTextField(controller: _nameController, label: 'Dish name'),
              const SizedBox(height: 12),
              _OwnerTextField(controller: _categoryController, label: 'Category'),
              const SizedBox(height: 12),
              _OwnerTextField(
                controller: _priceController,
                label: 'Price label',
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _isActive,
                title: const Text('Dish available'),
                onChanged: (value) {
                  setState(() {
                    _isActive = value;
                  });
                },
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _isSaving ? null : _save,
          child: Text(_isSaving ? 'Saving...' : 'Save'),
        ),
      ],
    );
  }
}
