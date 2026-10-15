import 'package:flutter/material.dart';

import '../widgets/bitesaver_colors.dart';

/// Static, public information: opening this route requires no services or login.
class AboutUsScreen extends StatelessWidget {
  const AboutUsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BiteSaverColors.pageBackground,
      appBar: AppBar(title: const Text('About BiteStar')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 680),
              child: DefaultTextStyle.merge(
                style: const TextStyle(
                  fontSize: 16,
                  height: 1.55,
                  color: BiteSaverColors.ink,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'BiteStar brings two ways to explore food together in one app: finding restaurant deals and discovering dishes worth trying.',
                    ),
                    const SizedBox(height: 20),
                    const Text(
                      "Looking for a great deal? Explore restaurant coupons, Daily Specials, and menus to see what's available.",
                    ),
                    const SizedBox(height: 28),
                    Semantics(
                      header: true,
                      child: Text(
                        'Rate the dish. Not the restaurant.',
                        style: TextStyle(
                          fontSize: 24,
                          height: 1.3,
                          fontWeight: FontWeight.w800,
                          color: BiteSaverColors.greenDark,
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),
                    const Text(
                      'Think about it. A restaurant might make an incredible burger but a disappointing pizza. So why give the entire restaurant one rating?',
                    ),
                    const SizedBox(height: 20),
                    const Text(
                      "BiteStar puts the spotlight on individual dishes, letting you discover what people think about the exact food you're considering ordering. Rate the dishes you've actually tried, share your experiences, and help others discover what's really worth ordering.",
                    ),
                    const SizedBox(height: 20),
                    const Text(
                      "Whether you're returning to a favorite restaurant or trying somewhere new, BiteStar helps you explore your options.",
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
