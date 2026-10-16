import 'package:flutter/material.dart';

import '../widgets/draft_legal_page.dart';

class PrivacyPolicyScreen extends StatelessWidget {
  const PrivacyPolicyScreen({super.key});

  @override
  Widget build(BuildContext context) => const DraftLegalPage(
    title: "BiteStar Privacy Policy",
    children: [
      LegalParagraph(
        "BiteStar is owned and operated by ColeSmart LLC (\"ColeSmart,\" \"we,\" \"us,\" or \"our\").",
      ),
      LegalParagraph(
        "We respect your privacy. This Privacy Policy explains what information BiteStar collects, why we use it, when it may be shared, and what choices you have regarding your information.",
      ),
      LegalSectionHeading("Information We Collect"),
      LegalSectionHeading("Account Information", subsection: true),
      LegalParagraph(
        "When you create an account, we may collect your email address, phone number, username, display name, authentication information, and account preferences, depending on how you register or sign in.",
      ),
      LegalParagraph(
        "Certain publicly available features may be accessible without creating a registered account.",
      ),
      LegalSectionHeading(
        "Restaurant and Business Information",
        subsection: true,
      ),
      LegalParagraph(
        "Restaurant owners and authorized representatives may provide restaurant names, addresses, contact details, business hours, menus, photographs, coupons, Daily Specials, and other information needed to display and manage their restaurants.",
      ),
      LegalParagraph(
        "We may maintain application status, ownership-verification information, subscription status, and related business records.",
      ),
      LegalSectionHeading(
        "Ratings, Reviews, and Photographs",
        subsection: true,
      ),
      LegalParagraph(
        "When you participate in dish ratings, we may collect your ratings, written reviews, photographs, suggested edits, reports, and other contributions.",
      ),
      LegalParagraph(
        "Some contributions may be publicly visible, along with your public display name, profile information, badges, or other permitted public contributions.",
      ),
      LegalSectionHeading("Location Information", subsection: true),
      LegalParagraph(
        "BiteStar uses location information to help users discover restaurants, coupons, Daily Specials, and dishes.",
      ),
      LegalParagraph(
        "You may enter a city, ZIP code, or another supported search location.",
      ),
      LegalParagraph(
        "If you grant location permission, BiteStar may process device-location coordinates to provide nearby results or evaluate location-dependent features.",
      ),
      LegalParagraph(
        "You can manage location permissions through your device settings.",
      ),
      LegalSectionHeading("Device and Technical Information", subsection: true),
      LegalParagraph(
        "We may process device or installation identifiers, app version, technical error information, security-verification signals, and information associated with coupon usage or other activity as needed to operate and protect BiteStar.",
      ),
      LegalParagraph(
        "Certain preferences, saved activity, and feature-related information may be stored on your device.",
      ),
      LegalSectionHeading(
        "Subscription and Payment Information",
        subsection: true,
      ),
      LegalParagraph(
        "Restaurant-owner subscriptions are processed through the applicable payment provider, currently Stripe.",
      ),
      LegalParagraph(
        "BiteStar may receive and retain subscription-status, transaction-reference, and billing-related information needed to manage service access, reconcile transactions, and fulfill legal obligations.",
      ),
      LegalSectionHeading("How We Use Information"),
      LegalParagraph(
        "We use information to operate restaurant discovery, coupons, Daily Specials, dish ratings and reviews; authenticate accounts; display permitted public contributions; manage restaurant-owner subscriptions; enforce coupon-use restrictions; provide support; prevent fraud and misuse; maintain reliability; and comply with applicable law.",
      ),
      LegalParagraph(
        "We may send necessary account-verification, password-recovery, service, and support communications.",
      ),
      LegalSectionHeading("Public Contributions"),
      LegalParagraph(
        "Dish ratings, reviews, photographs, public profiles, and other submitted content may be displayed to other users.",
      ),
      LegalParagraph(
        "Please avoid posting private information about yourself or other people.",
      ),
      LegalParagraph(
        "Reports and moderation decisions may affect whether particular contributions remain publicly visible.",
      ),
      LegalSectionHeading("Sharing Information"),
      LegalParagraph("ColeSmart LLC does not sell personal information."),
      LegalParagraph("Information may be made available when necessary:"),
      LegalBulletList([
        "To display contributions intentionally made public.",
        "To service providers supporting authentication, cloud hosting, data storage, technical operations, and subscription processing.",
        "To comply with applicable law or respond to lawful requests.",
        "To protect the service, investigate misuse, or address security issues.",
        "In connection with a legitimate business transition, subject to applicable legal requirements.",
      ]),
      LegalParagraph(
        "Service providers may include Google/Firebase, Stripe, and other providers established by the app's actual implementation.",
      ),
      LegalSectionHeading("Your Choices"),
      LegalParagraph(
        "Depending on the feature, you may update account information, manage location permissions, remove certain saved items, and request permanent account deletion.",
      ),
      LegalParagraph(
        "You may contact us regarding applicable privacy requests. Identity verification may be required.",
      ),
      LegalSectionHeading("Account Deletion and Data Retention"),
      LegalParagraph(
        "You may request permanent deletion of your BiteStar account through the available account-deletion process.",
      ),
      LegalParagraph(
        "For your security, we may require you to verify your identity before accepting the request.",
      ),
      LegalParagraph(
        "Once accepted, BiteStar begins processing the removal of your personal account information and associated contributions, including applicable reviews, ratings, votes, photographs, and saved activity.",
      ),
      LegalParagraph(
        "If you operate a restaurant-owner account, its coupons, Daily Specials, and subscription-based promotional content become unavailable. BiteStar also initiates the applicable subscription-cancellation process. Cancellation may remain pending until confirmed, and deleting an account does not automatically result in a refund.",
      ),
      LegalParagraph(
        "Certain shared restaurant information, dish catalog records, and contributions belonging to other users may remain. Deletion of your account does not automatically remove independently maintained restaurant or dish listings.",
      ),
      LegalParagraph(
        "After account deletion, certain limited records may be retained when reasonably necessary for security, fraud prevention, enforcing coupon-usage restrictions, financial recordkeeping, legal obligations, and documenting deletion requests. These may include device-identification and anti-abuse information, coupon-use restriction records, transaction references, and deletion-processing records.",
      ),
      LegalParagraph(
        "Information may also remain temporarily in service-provider backup or recovery systems. Retention periods vary by record type and purpose. Expiration of a session, security challenge, or other logical retention period does not necessarily result in immediate physical erasure.",
      ),
      LegalParagraph(
        "We retain information only as long as reasonably necessary for its applicable purposes or as otherwise required by law.",
      ),
      LegalParagraph(
        "Deletion processing may continue after you close the app. Where available, you can check the status of your request through the account-deletion process.",
      ),
      LegalSectionHeading("Security"),
      LegalParagraph(
        "We use technical and organizational safeguards intended to protect information. However, no internet-based service or storage system can be guaranteed completely secure.",
      ),
      LegalSectionHeading("Children and Parental Guidance"),
      LegalParagraph(
        "BiteStar is a general-audience food-discovery service, not an app specifically designed for children.",
      ),
      LegalParagraph(
        "The intended account policy is that users must be at least 13 years old, or satisfy any higher minimum age required by applicable law, to create accounts or submit public contributions.",
      ),
      LegalParagraph(
        "Younger children may browse publicly available information under parental supervision only where supported by applicable children's privacy requirements and the actual app implementation.",
      ),
      LegalParagraph(
        "Public reviews may contain language or opinions that parents consider inappropriate for younger visitors.",
      ),
      LegalParagraph(
        "Children's privacy safeguards and the guest-data-handling implementation require separate pre-release verification.",
      ),
      LegalSectionHeading("Your Privacy Rights"),
      LegalParagraph(
        "Depending on your location, applicable law may give you rights to request access to, correction of, or deletion of certain personal information, along with other privacy choices.",
      ),
      LegalParagraph(
        "We may need to verify your identity before acting on protected requests.",
      ),
      LegalSectionHeading("Changes to This Policy"),
      LegalParagraph(
        "We may update this Privacy Policy as BiteStar evolves or legal requirements change.",
      ),
      LegalParagraph(
        "We will update the effective date and provide additional notice when required by applicable law.",
      ),
      LegalSectionHeading("Contact"),
      LegalParagraph("ColeSmart LLC"),
      LegalParagraph("contact@colesmartllc.com"),
      LegalParagraph("https://www.colesmartllc.com/"),
    ],
  );
}
