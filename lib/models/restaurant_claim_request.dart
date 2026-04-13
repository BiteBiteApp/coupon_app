import 'package:cloud_firestore/cloud_firestore.dart';

class RestaurantClaimRequest {
  static const String collectionName = 'restaurant_claim_requests';

  final String id;
  final String restaurantId;
  final String restaurantName;
  final String? requesterUserId;
  final String claimantName;
  final String email;
  final String phone;
  final String? message;
  final String status;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const RestaurantClaimRequest({
    required this.id,
    required this.restaurantId,
    required this.restaurantName,
    required this.requesterUserId,
    required this.claimantName,
    required this.email,
    required this.phone,
    this.message,
    required this.status,
    this.createdAt,
    this.updatedAt,
  });

  Map<String, dynamic> toFirestoreMap() {
    return {
      'id': id.trim(),
      'restaurantId': restaurantId.trim(),
      'restaurantName': restaurantName.trim(),
      'requesterUserId': requesterUserId?.trim(),
      'claimantName': claimantName.trim(),
      'email': email.trim(),
      'phone': phone.trim(),
      'message': message?.trim(),
      'status': status.trim(),
      'createdAt': createdAt == null ? null : Timestamp.fromDate(createdAt!),
      'updatedAt': updatedAt == null ? null : Timestamp.fromDate(updatedAt!),
    };
  }

  static RestaurantClaimRequest? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final restaurantId = _readString(data['restaurantId']);
    final restaurantName = _readString(data['restaurantName']);
    final claimantName = _readString(data['claimantName']);
    final email = _readString(data['email']);
    final phone = _readString(data['phone']);
    final status = _readString(data['status']);

    if (restaurantId == null ||
        restaurantName == null ||
        claimantName == null ||
        email == null ||
        phone == null ||
        status == null) {
      return null;
    }

    return RestaurantClaimRequest(
      id: _readString(data['id']) ?? fallbackId,
      restaurantId: restaurantId,
      restaurantName: restaurantName,
      requesterUserId: _readString(data['requesterUserId']),
      claimantName: claimantName,
      email: email,
      phone: phone,
      message: _readString(data['message']),
      status: status,
      createdAt: _readDateTime(data['createdAt']),
      updatedAt: _readDateTime(data['updatedAt']),
    );
  }

  static String? _readString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }
    return null;
  }

  static DateTime? _readDateTime(dynamic value) {
    if (value is Timestamp) {
      return value.toDate().toLocal();
    }
    if (value is DateTime) {
      return value.toLocal();
    }
    return null;
  }
}
