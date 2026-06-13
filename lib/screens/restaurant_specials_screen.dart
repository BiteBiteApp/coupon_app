import 'package:flutter/material.dart';

import '../models/daily_special.dart';
import '../models/restaurant.dart';
import '../services/app_mode_state_service.dart';
import '../services/restaurant_account_service.dart';
import '../widgets/persistent_bottom_navigation.dart';

class RestaurantSpecialsScreen extends StatefulWidget {
  final Restaurant restaurant;

  const RestaurantSpecialsScreen({super.key, required this.restaurant});

  @override
  State<RestaurantSpecialsScreen> createState() =>
      _RestaurantSpecialsScreenState();
}

class _RestaurantSpecialsScreenState extends State<RestaurantSpecialsScreen> {
  late final Future<List<DailySpecial>> _specialsFuture = _loadSpecials();

  String _displayText(String value, String fallback) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? fallback : trimmed;
  }

  Future<List<DailySpecial>> _loadSpecials() async {
    final uid = widget.restaurant.uid?.trim();
    final List<DailySpecial> specials;
    if (uid != null && uid.isNotEmpty) {
      final accountData = await RestaurantAccountService.getAccountData(uid);
      specials =
          accountData != null &&
              RestaurantAccountService.hasCouponPostingAccess(accountData)
          ? await RestaurantAccountService.loadActiveDailySpecialsForRestaurant(
              uid,
            )
          : const <DailySpecial>[];
    } else {
      specials = widget.restaurant.dailySpecials;
    }

    final now = DateTime.now();
    return DailySpecial.visibleSpecialsAt(specials, now);
  }

  String? _scheduleLabel(DailySpecial special) {
    final rawLabel = special.scheduleSummaryText(includeToday: false).trim();
    if (rawLabel.isEmpty) {
      return null;
    }

    final isAllDay = rawLabel.toLowerCase() == 'available all day';
    final timeLabel = isAllDay
        ? rawLabel
        : 'Available ${_spacedRange(rawLabel)}';

    if (special.availabilityMode == DailySpecialAvailabilityMode.todayOnly) {
      return 'Today only • $timeLabel';
    }

    return rawLabel
        .replaceAll(', Available all day', ' • Available all day')
        .replaceAll(', available all day', ' • Available all day')
        .replaceAllMapped(
          RegExp(r',\s*([0-9]{1,2}:[0-9]{2}\s[AP]M-.*)$'),
          (match) => ' • Available ${_spacedRange(match.group(1)!)}',
        );
  }

  String _spacedRange(String value) {
    return value.replaceAllMapped(RegExp(r'\s*-\s*'), (match) => ' - ');
  }

  Widget _buildWhiteboard({
    required String restaurantName,
    required List<DailySpecial> specials,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFEFA),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFC9CDD2), width: 1.8),
        boxShadow: const [
          BoxShadow(
            color: Color.fromRGBO(42, 33, 24, 0.16),
            blurRadius: 22,
            offset: Offset(0, 12),
          ),
          BoxShadow(
            color: Color.fromRGBO(255, 255, 255, 0.8),
            blurRadius: 2,
            offset: Offset(-1, -1),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            restaurantName,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF2B475C),
              fontSize: 18,
              fontWeight: FontWeight.w800,
              height: 1.12,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            "Today's Specials",
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF1F6B4A),
              fontSize: 28,
              fontWeight: FontWeight.w900,
              height: 1,
            ),
          ),
          Center(
            child: Container(
              width: 148,
              height: 3,
              margin: const EdgeInsets.only(top: 9, bottom: 18),
              decoration: BoxDecoration(
                color: const Color(0xFFFF8A3D).withValues(alpha: 0.78),
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
          if (specials.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 28),
              child: Text(
                'No specials posted right now.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Color(0xFF52606A),
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  height: 1.25,
                ),
              ),
            )
          else
            for (final special in specials) ...[
              _buildBoardSpecialEntry(special),
              if (special != specials.last) _buildBoardSeparator(),
            ],
          const SizedBox(height: 18),
          _buildMarkerTray(),
        ],
      ),
    );
  }

  Widget _buildBoardSpecialEntry(DailySpecial special) {
    final details = special.details?.trim();
    final scheduleLabel = _scheduleLabel(special);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 9,
            height: 9,
            margin: const EdgeInsets.only(top: 7),
            decoration: BoxDecoration(
              color: const Color(0xFFE86F2F).withValues(alpha: 0.9),
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _displayText(special.title, 'Daily special'),
                  style: const TextStyle(
                    color: Color(0xFF244E73),
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                    height: 1.12,
                  ),
                ),
                if (details != null && details.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    details,
                    style: const TextStyle(
                      color: Color(0xFF315A46),
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      height: 1.26,
                    ),
                  ),
                ],
                if (scheduleLabel != null) ...[
                  const SizedBox(height: 7),
                  Text(
                    scheduleLabel,
                    style: const TextStyle(
                      color: Color(0xFF8A5226),
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      height: 1.2,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBoardSeparator() {
    return Container(
      height: 1.2,
      margin: const EdgeInsets.symmetric(vertical: 16),
      color: const Color(0xFF7FAE9B).withValues(alpha: 0.22),
    );
  }

  Widget _buildMarkerTray() {
    return Align(
      alignment: Alignment.center,
      child: Container(
        width: 178,
        height: 9,
        decoration: BoxDecoration(
          color: const Color(0xFFD6D7D8),
          borderRadius: BorderRadius.circular(999),
          boxShadow: const [
            BoxShadow(
              color: Color.fromRGBO(61, 54, 48, 0.16),
              blurRadius: 4,
              offset: Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 42,
              height: 3,
              decoration: BoxDecoration(
                color: const Color(0xFF244E73),
                borderRadius: BorderRadius.circular(999),
              ),
            ),
            const SizedBox(width: 8),
            Container(
              width: 42,
              height: 3,
              decoration: BoxDecoration(
                color: const Color(0xFFE86F2F),
                borderRadius: BorderRadius.circular(999),
              ),
            ),
            const SizedBox(width: 8),
            Container(
              width: 42,
              height: 3,
              decoration: BoxDecoration(
                color: const Color(0xFF1F6B4A),
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final restaurantName = _displayText(widget.restaurant.name, 'Restaurant');

    return Scaffold(
      backgroundColor: const Color(0xFFF8F1EA),
      appBar: AppBar(
        title: const Text("Today's Specials"),
        backgroundColor: const Color(0xFFF8F1EA),
        surfaceTintColor: const Color(0xFFF8F1EA),
        elevation: 0,
      ),
      bottomNavigationBar: const PersistentBottomNavigation(
        mode: AppMode.biteSaver,
      ),
      body: FutureBuilder<List<DailySpecial>>(
        future: _specialsFuture,
        builder: (context, snapshot) {
          final specials = snapshot.data ?? const <DailySpecial>[];
          final isLoading =
              snapshot.connectionState == ConnectionState.waiting &&
              !snapshot.hasData;

          return ListView(
            padding: EdgeInsets.fromLTRB(
              16,
              10,
              16,
              18 + MediaQuery.of(context).viewPadding.bottom,
            ),
            children: [
              if (isLoading)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 36),
                    child: CircularProgressIndicator(),
                  ),
                )
              else
                _buildWhiteboard(
                  restaurantName: restaurantName,
                  specials: specials,
                ),
            ],
          );
        },
      ),
    );
  }
}
