import 'package:flutter/material.dart';

class BrowseScreen extends StatelessWidget {
  const BrowseScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Text(
          'Browse Coupons (Coming Soon)',
          style: TextStyle(fontSize: 20),
        ),
      ),
    );
  }
}