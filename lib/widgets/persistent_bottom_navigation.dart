import 'package:flutter/material.dart';

import '../screens/main_navigation_screen.dart';
import '../services/app_mode_state_service.dart';
import 'admin_content_insets.dart';
import 'bitesaver_colors.dart';

class PersistentBottomNavigation extends StatelessWidget {
  final AppMode mode;
  final int selectedIndex;

  const PersistentBottomNavigation({
    super.key,
    required this.mode,
    this.selectedIndex = 0,
  });

  void _openDestination(BuildContext context, int index) {
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(
        builder: (_) =>
            MainNavigationScreen(initialMode: mode, initialIndex: index),
      ),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final extraBottomInset =
        mediaQuery.viewPadding.bottom > mediaQuery.padding.bottom
        ? mediaQuery.viewPadding.bottom - mediaQuery.padding.bottom
        : 0.0;
    final isBiteScore = mode == AppMode.biteScore;
    final selectedIconColor = isBiteScore
        ? const Color(0xFF285CC3)
        : const Color(0xFF5F8F25);
    final selectedTextColor = isBiteScore
        ? const Color(0xFF244F9E)
        : const Color(0xFF4F7D1F);
    final items = [
      (label: 'Home', icon: Icons.home_outlined, selectedIcon: Icons.home),
      (
        label: 'Restaurant\nHub',
        icon: Icons.storefront_outlined,
        selectedIcon: Icons.storefront,
      ),
      (
        label: 'Admin',
        icon: Icons.admin_panel_settings_outlined,
        selectedIcon: Icons.admin_panel_settings,
      ),
      (
        label: 'Account',
        icon: Icons.person_outline,
        selectedIcon: Icons.person,
      ),
    ];

    final navigationBar = SizedBox(
      height: AdminContentInsets.bottomNavigationHeight,
      child: Row(
        children: [
          for (final item in items.asMap().entries)
            Expanded(
              child: InkWell(
                onTap: () => _openDestination(context, item.key),
                borderRadius: BorderRadius.circular(13),
                child: Center(
                  child: SizedBox(
                    height: 43,
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        SizedBox(
                          height: 19,
                          child: Center(
                            child: Icon(
                              item.key == selectedIndex
                                  ? item.value.selectedIcon
                                  : item.value.icon,
                              color: item.key == selectedIndex
                                  ? selectedIconColor
                                  : BiteSaverColors.mutedInk,
                              size: item.key == selectedIndex ? 21 : 19.5,
                            ),
                          ),
                        ),
                        SizedBox(
                          height: 22,
                          child: Center(
                            child: Text(
                              item.value.label,
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: item.key == selectedIndex
                                    ? selectedTextColor
                                    : BiteSaverColors.mutedInk,
                                fontWeight: item.key == selectedIndex
                                    ? FontWeight.w700
                                    : FontWeight.w500,
                                fontSize: 11.3,
                                letterSpacing: 0,
                                height: 0.96,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );

    return SafeArea(
      bottom: true,
      top: false,
      child: Container(
        color: Colors.transparent,
        padding: EdgeInsets.fromLTRB(
          isBiteScore ? 16 : 22,
          0,
          isBiteScore ? 16 : 22,
          AdminContentInsets.bottomNavigationOuterPadding + extraBottomInset,
        ),
        child: Container(
          decoration: BoxDecoration(
            color: isBiteScore
                ? const Color(0xFFF7FAFE)
                : BiteSaverColors.surface,
            borderRadius: BorderRadius.circular(isBiteScore ? 20 : 21),
            border: Border.all(
              color: isBiteScore
                  ? const Color(0xFFD8E4F3)
                  : BiteSaverColors.border,
              width: 1,
            ),
            boxShadow: [
              BoxShadow(
                color: isBiteScore
                    ? const Color.fromRGBO(36, 76, 134, 0.075)
                    : Colors.black.withValues(alpha: 0.045),
                blurRadius: isBiteScore ? 7 : 13,
                offset: Offset(0, isBiteScore ? 2 : 5),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(isBiteScore ? 20 : 21),
            child: navigationBar,
          ),
        ),
      ),
    );
  }
}
