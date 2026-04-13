import 'package:coupon_app/firebase_options.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/services/customer_session_service.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  await ensureUserSignedIn();

  runApp(const CouponApp());
}

Future<void> ensureUserSignedIn() async {
  await CustomerSessionService.ensureCustomerUser();
}

class CouponApp extends StatelessWidget {
  const CouponApp({super.key});

  @override
  Widget build(BuildContext context) {
    const colorScheme = ColorScheme(
      brightness: Brightness.light,
      primary: Color(0xFF111111),
      onPrimary: Colors.white,
      secondary: Color(0xFF2A2A2A),
      onSecondary: Colors.white,
      error: Color(0xFFB3261E),
      onError: Colors.white,
      surface: Color(0xFFF5F5F3),
      onSurface: Color(0xFF111111),
      onSurfaceVariant: Color(0xFF4B4B47),
      outline: Color(0xFF8E8E88),
      outlineVariant: Color(0xFFD7D7D1),
      shadow: Color(0x1F000000),
      scrim: Color(0x52000000),
      inverseSurface: Color(0xFF1A1A18),
      onInverseSurface: Color(0xFFF3F3EF),
      inversePrimary: Color(0xFFE3E3DD),
      surfaceTint: Color(0xFF1C1C1A),
    );

    return MaterialApp(
      title: 'BiteSaver',
      debugShowCheckedModeBanner: false,
      navigatorKey: rootNavigatorKey,
      scaffoldMessengerKey: rootScaffoldMessengerKey,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: colorScheme,
        scaffoldBackgroundColor: const Color(0xFFEDEDE8),
        canvasColor: const Color(0xFFEDEDE8),
        dividerColor: colorScheme.outlineVariant,
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFFF5F5F3),
          foregroundColor: Color(0xFF111111),
          elevation: 0,
          surfaceTintColor: Colors.transparent,
          centerTitle: true,
        ),
        cardTheme: CardThemeData(
          color: const Color(0xFFFCFCFA),
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          margin: EdgeInsets.zero,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: const BorderSide(
              color: Color(0xFFD7D7D1),
            ),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: const Color(0xFFF8F8F5),
          labelStyle: const TextStyle(
            color: Color(0xFF4B4B47),
          ),
          hintStyle: const TextStyle(
            color: Color(0xFF7C7C76),
          ),
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 14,
            vertical: 14,
          ),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(
              color: Color(0xFFD7D7D1),
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(
              color: Color(0xFFD7D7D1),
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(
              color: Color(0xFF111111),
              width: 1.2,
            ),
          ),
        ),
        navigationBarTheme: NavigationBarThemeData(
          backgroundColor: const Color(0xFFF5F5F3),
          surfaceTintColor: Colors.transparent,
          indicatorColor: const Color(0xFFE3E7FF),
          elevation: 0,
          labelTextStyle: WidgetStateProperty.resolveWith((states) {
            return TextStyle(
              color: states.contains(WidgetState.selected)
                  ? const Color(0xFF111111)
                  : const Color(0xFF6E6E68),
              fontWeight: states.contains(WidgetState.selected)
                  ? FontWeight.w700
                  : FontWeight.w600,
            );
          }),
          iconTheme: WidgetStateProperty.resolveWith((states) {
            return IconThemeData(
              color: states.contains(WidgetState.selected)
                  ? const Color(0xFF2F5BFF)
                  : const Color(0xFF6E6E68),
            );
          }),
        ),
        dividerTheme: const DividerThemeData(
          color: Color(0xFFD7D7D1),
          thickness: 1,
          space: 1,
        ),
      ),
      home: const MainNavigationScreen(),
    );
  }
}
