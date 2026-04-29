import 'package:flutter/material.dart';

class BiteRaterTheme {
  static const Color pageBackground = Color(0xFFF5F7FA);
  static const Color cardSurface = Color(0xFFFFFFFF);
  static const Color ink = Color(0xFF0F172A);
  static const Color mutedInk = Color(0xFF788597);
  static const Color coral = Color(0xFFD08A2D);
  static const Color peach = Color(0xFFE4B766);
  static const Color grape = Color(0xFF5E6F95);
  static const Color ocean = Color(0xFF4A78B5);
  static const Color mint = Color(0xFF5E9B97);
  static const Color scoreFlame = Color(0xFFDC2626);
  static const Color restaurantTitle = Color(0xFF44556E);
  static const Color softSearchBlue = Color(0xFFF3F6FB);
  static const Color lineBlue = Color(0xFFE5EAF2);
  static const Color cardShadow = Color(0x1F0F172A);
  static const double cardElevation = 4;
  static const List<BoxShadow> liftedShadows = <BoxShadow>[
    BoxShadow(
      color: Color(0x2E000000),
      blurRadius: 24,
      spreadRadius: 2,
      offset: Offset(0, 12),
    ),
    BoxShadow(color: Color(0x0F000000), blurRadius: 6, offset: Offset(0, 3)),
  ];
  static const List<BoxShadow> pressedLiftedShadows = <BoxShadow>[
    BoxShadow(
      color: Color(0x1F000000),
      blurRadius: 14,
      spreadRadius: 1,
      offset: Offset(0, 6),
    ),
    BoxShadow(color: Color(0x0A000000), blurRadius: 4, offset: Offset(0, 2)),
  ];

  static const LinearGradient brandGradient = LinearGradient(
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
    colors: [ocean, grape],
  );

  static const LinearGradient softHeroGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [cardSurface, Color(0xFFF7F8FB)],
  );

  static BorderRadius cardRadius([double radius = 18]) =>
      BorderRadius.circular(radius);

  static BoxDecoration liftedCardOuterDecoration({
    double radius = 20,
    bool pressed = false,
  }) {
    return BoxDecoration(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(radius),
      boxShadow: pressed ? pressedLiftedShadows : liftedShadows,
    );
  }

  static RoundedRectangleBorder liftedCardShape({
    double radius = 20,
    Color borderColor = lineBlue,
  }) {
    return RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(radius - 1),
      side: BorderSide(color: borderColor, width: 1),
    );
  }

  static Widget liftedCard({
    required Widget child,
    EdgeInsetsGeometry margin = EdgeInsets.zero,
    double radius = 20,
    Color borderColor = lineBlue,
    bool pressEnabled = false,
  }) {
    return _BiteRaterLiftedCardShell(
      margin: margin,
      radius: radius,
      borderColor: borderColor,
      pressEnabled: pressEnabled,
      child: child,
    );
  }

  static Widget pressableSection({
    required Widget child,
    VoidCallback? onTap,
    BorderRadius? borderRadius,
    BoxBorder? border,
    double pressedScale = 0.97,
    Color restingColor = cardSurface,
    Color? pressedColor,
  }) {
    return _BiteRaterPressableSection(
      onTap: onTap,
      borderRadius: borderRadius,
      border: border,
      pressedScale: pressedScale,
      restingColor: restingColor,
      pressedColor:
          pressedColor ?? Color.lerp(cardSurface, pageBackground, 0.65)!,
      child: child,
    );
  }

  static Widget softDivider() {
    return Container(
      height: 0.5,
      margin: const EdgeInsets.symmetric(vertical: 12),
      color: lineBlue.withOpacity(0.35),
    );
  }

  static BoxDecoration surfaceDecoration({
    Color accentColor = coral,
    double radius = 18,
  }) {
    return BoxDecoration(
      color: cardSurface,
      borderRadius: cardRadius(radius),
      border: Border.all(color: accentColor.withOpacity(0.14)),
      boxShadow: liftedShadows,
    );
  }

  static BoxDecoration heroSurfaceDecoration({
    Color accentColor = coral,
    double radius = 20,
  }) {
    return BoxDecoration(
      gradient: softHeroGradient,
      borderRadius: cardRadius(radius),
      border: Border.all(color: accentColor.withOpacity(0.14)),
      boxShadow: liftedShadows,
    );
  }

  static BoxDecoration chipDecoration(Color accentColor) {
    return BoxDecoration(
      color: accentColor.withOpacity(0.08),
      borderRadius: BorderRadius.circular(999),
      border: Border.all(color: accentColor.withOpacity(0.14)),
    );
  }

  static BoxDecoration statTileDecoration(Color accentColor) {
    return BoxDecoration(
      color: accentColor.withOpacity(0.06),
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: accentColor.withOpacity(0.12)),
      boxShadow: liftedShadows,
    );
  }

  static TextStyle sectionTitleStyle({double fontSize = 20}) {
    return const TextStyle(
      color: ink,
      fontSize: 20,
      fontWeight: FontWeight.w900,
      letterSpacing: 0.2,
    ).copyWith(fontSize: fontSize);
  }

  static TextStyle labelStyle() {
    return const TextStyle(
      color: mutedInk,
      fontSize: 12,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.2,
    );
  }

  static ButtonStyle outlinedButtonStyle({Color accentColor = grape}) {
    return OutlinedButton.styleFrom(
      foregroundColor: accentColor,
      side: BorderSide(color: accentColor.withOpacity(0.22)),
      backgroundColor: accentColor.withOpacity(0.04),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      textStyle: const TextStyle(fontWeight: FontWeight.w800),
    );
  }

  static ButtonStyle filledButtonStyle() {
    return ElevatedButton.styleFrom(
      foregroundColor: Colors.white,
      backgroundColor: Colors.transparent,
      shadowColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      minimumSize: const Size.fromHeight(48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      padding: EdgeInsets.zero,
      textStyle: const TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w800,
        letterSpacing: 0.2,
      ),
    );
  }
}

class _BiteRaterLiftedCardShell extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry margin;
  final double radius;
  final Color borderColor;
  final bool pressEnabled;

  const _BiteRaterLiftedCardShell({
    required this.child,
    required this.margin,
    required this.radius,
    required this.borderColor,
    required this.pressEnabled,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 120),
      curve: Curves.easeOutCubic,
      margin: margin,
      decoration: BiteRaterTheme.liftedCardOuterDecoration(radius: radius),
      child: Padding(
        padding: const EdgeInsets.all(1.4),
        child: Card(
          margin: EdgeInsets.zero,
          color: BiteRaterTheme.cardSurface,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          shape: BiteRaterTheme.liftedCardShape(
            radius: radius,
            borderColor: borderColor,
          ),
          child: child,
        ),
      ),
    );
  }
}

class _BiteRaterPressableSection extends StatelessWidget {
  final Widget child;
  final VoidCallback? onTap;
  final BorderRadius? borderRadius;
  final BoxBorder? border;
  final double pressedScale;
  final Color restingColor;
  final Color pressedColor;

  const _BiteRaterPressableSection({
    required this.child,
    required this.onTap,
    required this.borderRadius,
    required this.border,
    required this.pressedScale,
    required this.restingColor,
    required this.pressedColor,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 120),
      curve: Curves.easeOutCubic,
      decoration: BoxDecoration(
        color: restingColor,
        borderRadius: borderRadius,
        border: border,
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: borderRadius,
          child: SizedBox(width: double.infinity, child: child),
        ),
      ),
    );
  }
}
