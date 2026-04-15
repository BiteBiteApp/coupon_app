import 'package:flutter/material.dart';

import 'restaurant.dart';

class RestaurantProfileData {
  final String name;
  final String city;
  final String state;
  final String zipCode;
  final String distance;
  final String email;
  final String phone;
  final String streetAddress;
  final String website;
  final String bio;
  final String latitude;
  final String longitude;
  final List<RestaurantBusinessHours> businessHours;

  const RestaurantProfileData({
    required this.name,
    required this.city,
    required this.state,
    required this.zipCode,
    required this.distance,
    required this.email,
    required this.phone,
    required this.streetAddress,
    required this.website,
    required this.bio,
    required this.latitude,
    required this.longitude,
    this.businessHours = const [],
  });

  RestaurantProfileData copyWith({
    String? name,
    String? city,
    String? state,
    String? zipCode,
    String? distance,
    String? email,
    String? phone,
    String? streetAddress,
    String? website,
    String? bio,
    String? latitude,
    String? longitude,
    List<RestaurantBusinessHours>? businessHours,
  }) {
    return RestaurantProfileData(
      name: name ?? this.name,
      city: city ?? this.city,
      state: state ?? this.state,
      zipCode: zipCode ?? this.zipCode,
      distance: distance ?? this.distance,
      email: email ?? this.email,
      phone: phone ?? this.phone,
      streetAddress: streetAddress ?? this.streetAddress,
      website: website ?? this.website,
      bio: bio ?? this.bio,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      businessHours: businessHours ?? this.businessHours,
    );
  }
}

class LocalRestaurantProfileStore {
  static final RestaurantProfileData emptyProfile = RestaurantProfileData(
    name: 'Your Restaurant Preview',
    city: 'Lecanto',
    state: 'FL',
    zipCode: '34461',
    distance: '0.8 miles away',
    email: '',
    phone: '',
    streetAddress: '',
    website: '',
    bio: '',
    latitude: '',
    longitude: '',
    businessHours: const [],
  );

  static final ValueNotifier<RestaurantProfileData> profile =
      ValueNotifier<RestaurantProfileData>(emptyProfile);

  static void updateProfile(RestaurantProfileData newProfile) {
    profile.value = newProfile;
  }

  static void resetProfile() {
    profile.value = emptyProfile;
  }
}
