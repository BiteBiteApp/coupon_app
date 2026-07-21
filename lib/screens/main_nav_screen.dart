import 'package:flutter/material.dart';
import 'browse_screen.dart';
import 'home_screen.dart';
import 'restaurant_auth_screen.dart';

class MainNavScreen extends StatefulWidget {
  const MainNavScreen({super.key});

  @override
  State<MainNavScreen> createState() => _MainNavScreenState();
}

class _MainNavScreenState extends State<MainNavScreen> {
  int _selectedIndex = 0;

  final List<Widget> _screens = const [
    HomeScreen(),
    BrowseScreen(),
    RestaurantAuthScreen(),
  ];

  void _onItemTapped(int index) {
    setState(() {
      _selectedIndex = index;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _screens[_selectedIndex],
      bottomNavigationBar: SafeArea(
        bottom: true,
        child: BottomNavigationBar(
          currentIndex: _selectedIndex,
          onTap: _onItemTapped,
          type: BottomNavigationBarType.fixed,
          items: const [
            BottomNavigationBarItem(
              icon: Icon(Icons.local_offer),
              label: 'Home',
            ),
            BottomNavigationBarItem(icon: Icon(Icons.search), label: 'Browse'),
            BottomNavigationBarItem(
              icon: Icon(Icons.storefront),
              label: 'Restaurant',
            ),
          ],
        ),
      ),
    );
  }
}
