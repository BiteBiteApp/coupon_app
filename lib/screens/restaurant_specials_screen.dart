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
    return specials
        .where((special) => special.shouldShowPubliclyAt(now))
        .toList();
  }

  String? _scheduleLabel(DailySpecial special) {
    final label = special.scheduleSummaryText();
    return label.isEmpty ? null : label;
  }

  Widget _buildSpecialTile(DailySpecial special) {
    final details = special.details?.trim();
    final scheduleLabel = _scheduleLabel(special);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF3E6),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFF2B46B), width: 0.8),
        boxShadow: const [
          BoxShadow(
            color: Color.fromRGBO(83, 52, 26, 0.08),
            blurRadius: 14,
            offset: Offset(0, 7),
          ),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.local_fire_department_outlined,
            color: Color(0xFFC95F17),
            size: 20,
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _displayText(special.title, 'Daily special'),
                  style: const TextStyle(
                    color: Color(0xFFC95F17),
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                    height: 1.08,
                  ),
                ),
                if (details != null && details.isNotEmpty) ...[
                  const SizedBox(height: 5),
                  Text(
                    details,
                    style: const TextStyle(
                      color: Color(0xFF6B4E35),
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      height: 1.24,
                    ),
                  ),
                ],
                if (scheduleLabel != null) ...[
                  const SizedBox(height: 5),
                  Text(
                    scheduleLabel,
                    style: const TextStyle(
                      color: Color(0xFF8C5A25),
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
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
              Text(
                restaurantName,
                style: const TextStyle(
                  color: Color(0xFF2B1D14),
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                  height: 1.08,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                'Daily specials posted by this restaurant.',
                style: TextStyle(
                  color: Color(0xFF7F6D5F),
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 18),
              if (isLoading)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 36),
                    child: CircularProgressIndicator(),
                  ),
                )
              else if (specials.isEmpty)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.68),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFE4D4C5)),
                  ),
                  child: const Text(
                    'No specials posted right now.',
                    style: TextStyle(
                      color: Color(0xFF7F6D5F),
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                )
              else
                for (final special in specials) ...[
                  _buildSpecialTile(special),
                  if (special != specials.last) const SizedBox(height: 10),
                ],
            ],
          );
        },
      ),
    );
  }
}
