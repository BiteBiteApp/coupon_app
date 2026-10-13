import 'package:flutter/material.dart';
import 'bitesaver_colors.dart';

/// The established customer whiteboard artwork, shared by profile and detail.
class BiteSaverSpecialsBoard extends StatelessWidget {
  final String restaurantName;
  final List<Widget> entries;
  final String emptyMessage;
  const BiteSaverSpecialsBoard({
    super.key,
    required this.restaurantName,
    required this.entries,
    this.emptyMessage = 'No specials posted right now.',
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 12),
      decoration: BoxDecoration(
        color: BiteSaverColors.surface,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFC9CDD2), width: 1.8),
        boxShadow: const [
          BoxShadow(
            color: Color.fromRGBO(15, 23, 42, 0.12),
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
          if (entries.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 28),
              child: Text(
                emptyMessage,
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
            for (var index = 0; index < entries.length; index++) ...[
              entries[index],
              if (index + 1 < entries.length) _buildBoardSeparator(),
            ],
          const SizedBox(height: 18),
          _buildMarkerTray(),
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
              color: Color.fromRGBO(15, 23, 42, 0.12),
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
}
