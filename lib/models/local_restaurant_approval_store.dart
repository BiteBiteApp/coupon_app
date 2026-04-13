import 'package:flutter/material.dart';

class LocalRestaurantApprovalStore {
  static final ValueNotifier<Set<String>> approvedEmails =
      ValueNotifier<Set<String>>({});

  static bool isApproved(String email) {
    return approvedEmails.value.contains(email.toLowerCase().trim());
  }

  static void approveEmail(String email) {
    final updated = Set<String>.from(approvedEmails.value);
    updated.add(email.toLowerCase().trim());
    approvedEmails.value = updated;
  }

  static void revokeEmail(String email) {
    final updated = Set<String>.from(approvedEmails.value);
    updated.remove(email.toLowerCase().trim());
    approvedEmails.value = updated;
  }
}